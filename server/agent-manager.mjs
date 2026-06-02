import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { Agent } from '@earendil-works/pi-agent-core'
import { streamSimpleWithAiHttpLogging } from './ai-http-logger.mjs'
import { loadSkillToolContext, abortRunningCommand } from './tools/index.mjs'
import { createSkillTools, workspaceTools } from './tools/definitions.mjs'
import { createMcpToolDefinitions } from './mcp/registry.mjs'
import {
  composeSubagentSystemPrompt,
  formatSubagentTask,
} from './subagents.mjs'
import { agentProfileSnapshot, getAgentProfile } from './agent-profiles.mjs'
import { projectContextFromId, readProjectConfig } from './project-config.mjs'
import { readStore, atomicUpdate, readSessionValue, writeSessionValue, deleteSessionValue } from './storage.mjs'
import { logger } from './utils/logger.mjs'
import { buildSystemPrompt, generateAiTitle, generateTitle } from './session-utils.mjs'
import { restoreReasoningContentInPayload } from './reasoning-cache.mjs'
import {
  compactConversation,
  parseCompactArgs,
  saveCompactBackup,
} from './conversation-compaction.mjs'
import {
  buildAutoCompactLoopMessages,
  estimateSessionContextUsage,
  maybeAutoCompactSession,
} from './auto-compaction.mjs'
import {
  handleInternalCommand,
  parseInternalCommandInvocation,
  resolveCustomCommandInvocation,
} from './custom-commands.mjs'
import { omitDetailsForLlm, serverConvertToLlm, messageText, lastAssistantText } from './message-converters.mjs'
import { isPlainObject, mergeQuickForgeTiming, wrapToolDefinition, wrapMcpToolDefinition, sessionSkillsContext } from './tool-wiring.mjs'
import {
  APPROVAL_TIMEOUT_MS,
  commandRestrictedTools,
  safeReadTools,
  pendingApprovals,
  pendingAutoCompactApprovals,
  commandToolPermissionError,
  createCommandToolPermissions,
} from './approval-store.mjs'

// ---------------------------------------------------------------------------
// Tool definitions (server-side, no REST roundtrip)
// ---------------------------------------------------------------------------

function wrapSubagentToolDefinition(definition, parentSessionId) {
  return {
    ...definition,
    execute: async (_toolCallId, params, signal, onUpdate) => {
      const parentSession = agentSessions.get(parentSessionId)
      if (!parentSession) throw new Error('Parent session is no longer active.')
      const result = await runSubagent(parentSession, params || {}, signal, onUpdate)
      return {
        content: [{ type: 'text', text: result.content }],
        details: result.details,
      }
    },
  }
}

function wrapWorkspaceToolDefinition(definition, context, toolPermissions, options = {}) {
  if (definition.name === 'run_subagent') return wrapSubagentToolDefinition(definition, options.parentSessionId)
  return wrapToolDefinition(definition, context, toolPermissions)
}

async function createServerTools(projectId, projectContext, skillsContext, includeWorkspaceTools, toolPermissions, options = {}) {
  const {
    allowedToolNames = null,
    includeSubagentTool = true,
    includeMcpTools = true,
    parentSessionId = null,
  } = options
  const allowedTools = allowedToolNames ? new Set(allowedToolNames) : null
  const isAllowed = (definition) => !allowedTools || allowedTools.has(definition.name)

  const skillTools = await createSkillTools({
    globalSkillNames: skillsContext.globalSkillNames,
    projectSkillNames: skillsContext.projectSkillNames,
    workspaceRoot: projectContext?.workspaceRoot,
  })
  const skillToolContext = await loadSkillToolContext({
    globalSkillNames: skillsContext.globalSkillNames,
    projectSkillNames: skillsContext.projectSkillNames,
    workspaceRoot: projectContext?.workspaceRoot,
  })
  const toolContext = { ...projectContext, ...skillToolContext }
  const tools = skillTools
    .filter(isAllowed)
    .map((definition) => wrapToolDefinition(definition, toolContext, toolPermissions))

  if (includeWorkspaceTools && projectId && projectContext) {
    const definitions = workspaceTools.filter((definition) => includeSubagentTool || definition.name !== 'run_subagent')
    tools.push(...definitions
      .filter(isAllowed)
      .map((definition) => wrapWorkspaceToolDefinition(definition, toolContext, toolPermissions, { parentSessionId })))
  }

  if (includeMcpTools) {
    const mcpTools = await createMcpToolDefinitions()
    tools.push(...mcpTools.filter(isAllowed).map((definition) => wrapMcpToolDefinition(definition, toolPermissions)))
  }

  return tools
}

async function rebuildSessionTools(session) {
  session.agent.state.tools = await createServerTools(
    session.projectId,
    session.projectContext,
    sessionSkillsContext(session),
    !!(session.projectId && session.projectContext),
    createCommandToolPermissions(session),
    { parentSessionId: session.sessionId },
  )
}

// ---------------------------------------------------------------------------
// Agent Manager
// ---------------------------------------------------------------------------

const agentSessions = new Map()

/** @typedef {{ agent: Agent, projectContext: object|null, projectId: string|null, yoloMode: boolean, model: object, thinkingLevel: string, scope: string, title: string, createdAt: string, status: string, startedAt: string|null, finishedAt: string|null, listeners: Set<function>, idleTimer: NodeJS.Timeout|null, eventBus: EventEmitter }} AgentSession */

const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const SUBAGENT_DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

/**
 * Create a Promise that only resolves when the user accepts or rejects the tool call.
 * The agent loop's `await config.beforeToolCall(...)` pauses on this promise,
 * effectively freezing the agent until the user decides.
 */
function createApprovalPromise(session, toolCallId, toolName, args, source) {
  if (!session) return { block: true, reason: 'No active session for tool approval.' }
  return new Promise((resolve, reject) => {
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      pendingApprovals.delete(toolCallId)
      resolve({ block: true, reason: `Approval timeout for ${toolName}` })
    }, APPROVAL_TIMEOUT_MS)

    const cleanup = () => {
      clearTimeout(timeout)
      if (settled) return
      settled = true
      pendingApprovals.delete(toolCallId)
    }

    // Listen for abort signal so the promise rejects when the user stops the run
    const signal = session.agent.signal
    if (signal) {
      if (signal.aborted) {
        cleanup()
        reject(new Error('Run aborted'))
        return
      }
      const onAbort = () => {
        cleanup()
        reject(new Error('Run aborted'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    pendingApprovals.set(toolCallId, {
      resolve: (approved) => {
        cleanup()
        resolve(approved ? undefined : { block: true, reason: `User rejected ${toolName}` })
      },
      reject: (err) => {
        cleanup()
        reject(err)
      },
      sessionId: session.sessionId,
      toolName,
      args,
      source,
    })

    // Notify the frontend via both the session-level and global event buses.
    // The global SSE handler (/api/agents/events) only listens to `agentEvents`,
    // so events emitted only on session.eventBus never reach the client.
    const approvalEvent = {
      type: 'tool_approval_required',
      sessionId: session.sessionId,
      toolCallId,
      toolName,
      args,
      source,
    }
    session.eventBus.emit('agent_event', approvalEvent)
    agentEvents.emit('agent_event', approvalEvent)
  })
}

function createAutoCompactApprovalPromise(session, details = {}) {
  if (!session) return Promise.resolve(false)
  const approvalId = randomUUID()
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      pendingAutoCompactApprovals.delete(approvalId)
      resolve(false)
    }, APPROVAL_TIMEOUT_MS)

    const cleanup = () => {
      clearTimeout(timeout)
      if (settled) return
      settled = true
      pendingAutoCompactApprovals.delete(approvalId)
    }

    const signal = session.agent.signal
    if (signal) {
      if (signal.aborted) {
        cleanup()
        reject(new Error('Run aborted'))
        return
      }
      const onAbort = () => {
        cleanup()
        reject(new Error('Run aborted'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    pendingAutoCompactApprovals.set(approvalId, {
      resolve: (approved) => {
        cleanup()
        resolve(approved === true)
      },
      reject: (err) => {
        cleanup()
        reject(err)
      },
      sessionId: session.sessionId,
    })

    emitSessionEvent(session, {
      type: 'auto_compact_approval_required',
      approvalId,
      usage: details.usage,
      thresholdPercent: details.settings?.thresholdPercent,
      keepRecentTurns: details.settings?.keepRecentTurns,
    })
  })
}

function assistantTextMessage(text, model) {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model?.api || 'unknown',
    provider: model?.provider || 'unknown',
    model: model?.id || model?.name || 'unknown',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

function userTextMessage(text) {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  }
}

function compactedSessionTitle(title) {
  const base = typeof title === 'string' && title.trim() ? title.trim() : 'New chat'
  if (base === 'New chat') return 'Compacted chat'
  return `Compacted: ${base}`
}

function estimateTokenReduction(originalChars, finalChars) {
  if (!originalChars || originalChars <= 0) return 0
  return Math.max(0, Math.min(99, Math.round(((originalChars - finalChars) / originalChars) * 100)))
}

function emitSessionEvent(session, event) {
  const enrichedEvent = (event?.type === 'message_end' || event?.type === 'agent_end' || event?.type === 'messages_replaced' || event?.type === 'auto_compact_completed')
    && event.contextUsage === undefined
    ? { ...event, contextUsage: getSessionContextUsage(session) }
    : event
  session.eventBus.emit('agent_event', enrichedEvent)
  agentEvents.emit('agent_event', { sessionId: session.sessionId, ...enrichedEvent })
}

function addToolTimingToEvent(session, event) {
  if (!event || typeof event !== 'object') return event
  if (event.type === 'tool_execution_start' && event.toolCallId) {
    const timing = {
      startedAt: Date.now(),
      startedAtPerf: performance.now(),
    }
    session.toolTimings?.set(event.toolCallId, timing)
    return { ...event, quickforgeTiming: { startedAt: timing.startedAt } }
  }
  if (event.type === 'tool_execution_end' && event.toolCallId) {
    const timing = session.toolTimings?.get(event.toolCallId)
    if (!timing) return event
    session.toolTimings?.delete(event.toolCallId)
    const finishedAt = Date.now()
    const durationMs = Math.max(0, Math.round(performance.now() - timing.startedAtPerf))
    const quickforgeTiming = { startedAt: timing.startedAt, finishedAt, durationMs }
    return {
      ...event,
      quickforgeTiming,
      result: event.result
        ? { ...event.result, details: mergeQuickForgeTiming(event.result.details, quickforgeTiming) }
        : event.result,
    }
  }
  return event
}

function updateSessionMessages(session, messages) {
  session.agent.state.messages = messages
}

function resetSessionCompaction(session) {
  session.contextCompaction = null
  session.lastAutoCompactAt = null
  session.lastAutoCompactRejected = null
  session.lastTransformedContextMessages = null
  session.autoCompacting = false
}

function finishManualSessionRun(session, status, errorMessage) {
  session.status = status
  session.finishedAt = new Date().toISOString()
  session.agent.state.isStreaming = false
  session.agent.state.streamingMessage = undefined
  session.agent.state.errorMessage = errorMessage
}

async function compactSession(session, initialUserMessage, compactOptions) {
  if (session.agent.state.isStreaming) {
    session.agent.state.messages = [
      ...session.agent.state.messages,
      initialUserMessage,
      assistantTextMessage('Cannot compact while a generation is still running. Stop it or wait until it finishes, then run /compact again.', session.model),
    ]
    await persistSession(session)
    const messages = session.agent.state.messages
    emitSessionEvent(session, { type: 'message_end', messages })
    emitSessionEvent(session, { type: 'agent_end', messages })
    return { sessionId: session.sessionId, status: session.status }
  }

  const sourceStatus = session.status
  const sourceStartedAt = session.startedAt
  const sourceFinishedAt = session.finishedAt
  const sourceErrorMessage = session.agent.state.errorMessage

  resetIdleTimer(session)
  session.status = 'running'
  session.startedAt = session.startedAt ?? new Date().toISOString()
  session.finishedAt = null
  session.agent.state.isStreaming = true
  session.agent.state.errorMessage = undefined
  emitSessionEvent(session, { type: 'agent_start' })

  try {
    const originalMessages = session.agent.state.messages.slice()
    const options = parseCompactArgs(compactOptions?.args || '')

    if (options.unsupported?.length) {
      session.agent.state.messages = [
        ...originalMessages,
        initialUserMessage,
        assistantTextMessage(`Unsupported /compact option(s): ${options.unsupported.join(', ')}\n\nSupported usage: /compact or /compact keep=0`, session.model),
      ]
      finishManualSessionRun(session, 'idle')
      await persistSession(session)
      const messages = session.agent.state.messages
      emitSessionEvent(session, { type: 'message_end', messages })
      emitSessionEvent(session, { type: 'agent_end', messages })
      return { sessionId: session.sessionId, status: session.status }
    }

    const result = await compactConversation({
      messages: originalMessages,
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      getApiKey: session.getApiKey,
      keepTurns: options.keepTurns,
    })

    if (result.skipped) {
      session.agent.state.messages = [
        ...originalMessages,
        initialUserMessage,
        assistantTextMessage('Not enough earlier history to compact. Continue chatting and run /compact again later.', session.model),
      ]
      finishManualSessionRun(session, 'idle')
      await persistSession(session)
      const messages = session.agent.state.messages
      emitSessionEvent(session, { type: 'message_end', messages })
      emitSessionEvent(session, { type: 'agent_end', messages })
      return { sessionId: session.sessionId, status: session.status }
    }

    await saveCompactBackup(session.sessionId, originalMessages)

    const reduction = estimateTokenReduction(result.originalApproxChars, result.finalApproxChars)
    const summaryMessage = userTextMessage([
      'The previous conversation has been compacted. Treat the following summary as the authoritative replacement for earlier history. If information is missing, ask for clarification instead of guessing.',
      '',
      '<compact_summary>',
      result.summary,
      '</compact_summary>',
    ].join('\n'))
    const notice = assistantTextMessage([
      `已基于当前对话创建压缩后的新对话：原 ${result.originalCount} 条消息 → ${result.recentTail.length + 2} 条消息。`,
      `当前原对话已完整保留，保留最近 ${result.keepTurns} 个用户回合原文，估算新对话上下文减少约 ${reduction}%。`,
      '压缩前历史已保存到本地备份。',
    ].join('\n'), session.model)

    const compactedMessages = [summaryMessage, notice, ...result.recentTail]
    const titleSourceMessages = [summaryMessage, ...result.recentTail]
    const aiTitle = await generateAiTitle(titleSourceMessages, session.model, session.thinkingLevel, session.getApiKey)
    const compactedTitle = aiTitle && aiTitle !== 'New chat'
      ? aiTitle
      : compactedSessionTitle(session.title)
    const compactedSessionId = randomUUID()
    const compactedSession = await createAgent(compactedSessionId, {
      scope: session.scope,
      projectId: session.projectId,
      yoloMode: session.yoloMode,
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      messages: compactedMessages,
      title: compactedTitle,
      createdAt: new Date().toISOString(),
    })
    updateSessionMessages(compactedSession, compactedMessages)
    await persistSession(compactedSession)

    session.status = sourceStatus
    session.startedAt = sourceStartedAt
    session.finishedAt = sourceFinishedAt
    session.agent.state.isStreaming = false
    session.agent.state.streamingMessage = undefined
    session.agent.state.errorMessage = sourceErrorMessage
    await persistSession(session)

    const messages = session.agent.state.messages
    emitSessionEvent(session, { type: 'agent_end', messages })
    emitSessionEvent(session, {
      type: 'session_forked',
      sourceSessionId: session.sessionId,
      targetSessionId: compactedSessionId,
      title: compactedSession.title,
      createdAt: compactedSession.createdAt,
      scope: compactedSession.scope,
      projectId: compactedSession.projectId,
      messages: compactedSession.agent.state.messages,
    })
    emitSessionEvent(compactedSession, { type: 'message_end', messages: compactedSession.agent.state.messages })
    emitSessionEvent(compactedSession, { type: 'agent_end', messages: compactedSession.agent.state.messages })
    return { sessionId: session.sessionId, status: session.status, compactedSessionId }
  } catch (err) {
    const errorMessage = err?.message || 'Conversation compaction failed'
    session.agent.state.messages = [
      ...session.agent.state.messages,
      initialUserMessage,
      assistantTextMessage(`Conversation compaction failed: ${errorMessage}`, session.model),
    ]
    finishManualSessionRun(session, 'error', errorMessage)
    await persistSession(session)
    const messages = session.agent.state.messages
    emitSessionEvent(session, { type: 'error', error: errorMessage })
    emitSessionEvent(session, { type: 'agent_end', messages, errorMessage })
    return { sessionId: session.sessionId, status: session.status }
  }
}

async function clearSession(session) {
  if (session.agent.state.isStreaming) {
    session.agent.state.messages = [
      ...session.agent.state.messages,
      assistantTextMessage('Cannot clear while a generation is still running. Stop it or wait until it finishes, then run /clear again.', session.model),
    ]
    await persistSession(session)
    const messages = session.agent.state.messages
    emitSessionEvent(session, { type: 'message_end', messages })
    emitSessionEvent(session, { type: 'agent_end', messages })
    return { sessionId: session.sessionId, status: session.status }
  }

  updateSessionMessages(session, [])
  resetSessionCompaction(session)
  session.status = 'idle'
  session.startedAt = null
  session.finishedAt = new Date().toISOString()
  session.title = 'New chat'
  session.titleGenerated = false
  session.agent.state.isStreaming = false
  session.agent.state.streamingMessage = undefined
  session.agent.state.errorMessage = undefined

  await persistSession(session)
  const messages = session.agent.state.messages
  emitSessionEvent(session, { type: 'message_end', messages })
  emitSessionEvent(session, { type: 'agent_end', messages })
  emitSessionEvent(session, { type: 'title_updated', title: session.title })
  return { sessionId: session.sessionId, status: session.status, cleared: true }
}

async function resolveCommandState(session, userMessage) {
  const internalResponse = await handleInternalCommand(
    parseInternalCommandInvocation(userMessage),
    session.projectContext?.workspaceRoot,
    session.projectContext?.project?.commandDir,
  )
  if (typeof internalResponse === 'string') return { textResponse: internalResponse }
  if (internalResponse?.clear) return { clear: internalResponse }
  if (internalResponse?.compact) return { compact: internalResponse }
  if (internalResponse?.plan) {
    return {
      userMessage,
      commandPrompt: formatPlanCommandPrompt(internalResponse.args),
      permissions: { allowEdit: false, allowCommands: false },
      commandName: 'plan',
    }
  }

  if (!session.projectContext?.workspaceRoot) return { userMessage }

  const invocation = await resolveCustomCommandInvocation(
    userMessage,
    session.projectContext.workspaceRoot,
    session.projectContext.project?.commandDir,
  )
  if (!invocation) return { userMessage }

  return {
    userMessage,
    commandPrompt: invocation.systemPrompt,
    permissions: invocation.permissions,
    commandName: invocation.command.name,
  }
}

function formatPlanCommandPrompt(task) {
  const taskText = String(task || '').trim()
  return `<plan_command_invocation name="plan">
This /plan command applies only to the current user request. Generate an implementation plan before execution.

Rules for this turn:
- Do not modify files.
- Do not create files.
- Do not run shell commands.
- Do not use write_file, edit_file, run_command, or any other state-changing tool.
- You may use read-only tools such as read_file and grep_files if needed to inspect the project.
- Output the plan and then stop. Do not start implementation.

Plan should include:
1. Task understanding
2. Relevant files or areas to inspect/change
3. Step-by-step implementation plan
4. Risks or assumptions
5. Validation commands/checks to run after implementation
6. Whether documentation/wiki updates are needed

End by telling the user they can reply “允许”, “按计划执行”, or an equivalent approval phrase to continue in a normal follow-up turn.

User task:
${taskText}
</plan_command_invocation>`
}

async function runSubagent(parentSession, params, parentSignal, onUpdate) {
  const profile = await getAgentProfile(params?.subagent)
  if (!profile || !profile.enabledAsSubagent) {
    const error = new Error(`Unknown or disabled subagent: ${params?.subagent || ''}`)
    error.statusCode = 400
    throw error
  }
  const definition = profile

  const task = String(params?.task || '').trim()
  if (!task) {
    const error = new Error('task is required')
    error.statusCode = 400
    throw error
  }
  if (!parentSession.projectId || !parentSession.projectContext) {
    throw new Error('Subagents require an active project workspace.')
  }
  if (!parentSession.model) {
    throw new Error('No active model is configured for the parent session.')
  }

  const timeoutMs = Math.max(1000, Math.min(Number(definition.maxRuntimeMs || SUBAGENT_DEFAULT_TIMEOUT_MS), 30 * 60 * 1000))
  const subagentSessionId = `${parentSession.sessionId}:subagent:${definition.name}:${randomUUID()}`
  const startedAt = Date.now()
  let toolCalls = 0
  let latestMessages = []
  let latestPendingToolCalls = []
  let toolsForClient = []

  const tools = await createServerTools(
    parentSession.projectId,
    parentSession.projectContext,
    sessionSkillsContext(parentSession),
    true,
    (toolName) => {
      if (!definition.allowedTools.includes(toolName)) return `Subagent ${definition.name} is not allowed to use ${toolName}.`
      return null
    },
    {
      allowedToolNames: definition.allowedTools,
      includeSubagentTool: false,
      includeMcpTools: false,
    },
  )
  toolsForClient = tools.map(({ execute, prepareArguments, ...tool }) => tool)

  const emitSubagentTrace = () => {
    onUpdate?.({
      content: [],
      details: {
        subagent: definition.name,
        label: definition.label,
        sessionId: subagentSessionId,
        parentSessionId: parentSession.sessionId,
        toolCalls,
        allowedTools: definition.allowedTools,
        timeoutMs,
        durationMs: Date.now() - startedAt,
        messages: latestMessages,
        tools: toolsForClient,
        pendingToolCalls: latestPendingToolCalls,
      },
    })
  }

  const systemPrompt = composeSubagentSystemPrompt({
    definition,
    parentSystemPrompt: parentSession.agent.state.systemPrompt,
    projectContext: parentSession.projectContext,
  })
  const userMessage = {
    role: 'user',
    content: [{ type: 'text', text: formatSubagentTask(params) }],
    timestamp: Date.now(),
  }
  const subagent = new Agent({
    initialState: {
      systemPrompt,
      model: parentSession.model,
      thinkingLevel: parentSession.thinkingLevel,
      messages: [],
      tools,
    },
    streamFn: streamSimpleWithAiHttpLogging,
    getApiKey: parentSession.getApiKey,
    sessionId: subagentSessionId,
    convertToLlm: serverConvertToLlm,
    onPayload: (payload) => {
      restoreReasoningContentInPayload(payload, subagent.state.messages, subagent.state.model)
    },
    beforeToolCall: async (context) => {
      const toolName = context.toolCall?.name
      toolCalls += 1
      emitSubagentTrace()
      if (toolCalls > Number(definition.maxToolCalls || 300)) {
        return { block: true, reason: `Subagent ${definition.name} exceeded its tool-call budget.` }
      }
      if (!definition.allowedTools.includes(toolName)) {
        return { block: true, reason: `Subagent ${definition.name} is not allowed to use ${toolName}.` }
      }
      if (!parentSession.yoloMode) {
        if (safeReadTools.has(toolName)) return undefined
        return createApprovalPromise(parentSession, context.toolCall?.id, toolName, context.args, {
          type: 'subagent',
          subagent: definition.name,
          label: definition.label,
          sessionId: subagentSessionId,
        })
      }
      return undefined
    },
  })

  subagent.subscribe((event) => {
    latestMessages = subagent.state.messages.slice()
    latestPendingToolCalls = Array.from(subagent.state.pendingToolCalls || [])
    if (event.type === 'message_start' || event.type === 'message_update') {
      if (event.message?.role === 'assistant') {
        latestMessages = [...latestMessages, event.message]
      }
    }
    emitSubagentTrace()
  })

  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    subagent.abort()
  }, timeoutMs)
  const onParentAbort = () => subagent.abort()
  parentSignal?.addEventListener?.('abort', onParentAbort, { once: true })

  try {
    await subagent.prompt(userMessage)
    if (timedOut) throw new Error(`Subagent ${definition.name} timed out after ${timeoutMs}ms.`)
    if (parentSignal?.aborted) throw new Error(`Subagent ${definition.name} aborted with parent run.`)
  } finally {
    clearTimeout(timeout)
    parentSignal?.removeEventListener?.('abort', onParentAbort)
  }

  const content = lastAssistantText(subagent.state.messages) || `Subagent ${definition.name} completed without a text response.`
  return {
    content,
    details: {
      subagent: definition.name,
      label: definition.label,
      sessionId: subagentSessionId,
      parentSessionId: parentSession.sessionId,
      toolCalls,
      allowedTools: definition.allowedTools,
      timeoutMs,
      durationMs: Date.now() - startedAt,
      messages: latestMessages,
      tools: toolsForClient,
      pendingToolCalls: latestPendingToolCalls,
    },
  }
}

function applyActiveCommandPrompt(messages, commandPrompt) {
  if (!commandPrompt) return messages

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role !== 'user' && message?.role !== 'user-with-attachments') continue

    const transformed = messages.slice()
    transformed[index] = {
      ...message,
      content: commandPrompt,
    }
    return transformed
  }

  return messages
}

function compactSummaryIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    const content = message?.content
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.filter((block) => block?.type === 'text').map((block) => block.text ?? '').join('\n')
        : ''
    if (message?.role === 'user' && text.includes('<compact_summary>')) return index
  }
  return -1
}

function compactedContextMessages(messages) {
  const index = compactSummaryIndex(messages)
  return index >= 0 ? messages.slice(index) : messages
}

async function transformSessionContext(session, messages, signal) {
  const autoCompactResult = await maybeAutoCompactSession({
    session,
    messages,
    signal,
    emitSessionEvent,
    persistSession,
    logger,
    confirmAutoCompact: createAutoCompactApprovalPromise,
  })
  if (!autoCompactResult.compacted && autoCompactResult.usage && autoCompactResult.reason && autoCompactResult.reason !== 'below_threshold') {
    logger.info(`Auto compact skipped for session ${session.sessionId}: ${autoCompactResult.reason}`, {
      sessionId: session.sessionId,
      reason: autoCompactResult.reason,
      usage: autoCompactResult.usage,
    })
  }
  const transformedMessages = buildAutoCompactLoopMessages(session, messages)
  session.lastTransformedContextMessages = transformedMessages
  return applyActiveCommandPrompt(compactedContextMessages(transformedMessages), session?.activeCommandPrompt)
}

export const agentEvents = new EventEmitter()
agentEvents.setMaxListeners(100)

function resetIdleTimer(session) {
  if (session.idleTimer) clearTimeout(session.idleTimer)
  session.idleTimer = setTimeout(() => {
    if (session.status === 'running') {
      logger.info(`Session ${session.sessionId} idle timer fired but still running, resetting...`, { sessionId: session.sessionId, status: session.status })
      resetIdleTimer(session)
      return
    }
    logger.info(`Session ${session.sessionId} idle timeout (${IDLE_TIMEOUT_MS / 1000}s), destroying...`, { sessionId: session.sessionId })
    destroyAgent(session.sessionId).catch((err) =>
      logger.error(`Failed to destroy idle agent ${session.sessionId}:`, err, { sessionId: session.sessionId }),
    )
  }, IDLE_TIMEOUT_MS)
}

/**
 * Reset the idle timer for a session (e.g. on SSE activity).
 * Returns true if the session was found.
 */
export function touchSession(sessionId) {
  const session = agentSessions.get(sessionId)
  if (session) {
    resetIdleTimer(session)
    return true
  }
  return false
}

/**
 * Create or retrieve an Agent for a session.
 * If the session already has a running agent, return it.
 * Otherwise, create a new Agent and optionally restore from storage.
 */
export async function createAgent(sessionId, config = {}) {
  const existing = agentSessions.get(sessionId)
  if (existing) {
    resetIdleTimer(existing)
    return existing
  }

  const {
    scope = 'global',
    projectId = null,
    yoloMode = false,
    model = null,
    thinkingLevel = 'off',
    messages = [],
    systemPrompt = null,
    title = 'New chat',
    createdAt = new Date().toISOString(),
    lastModified = null,
    contextCompaction = null,
    agentProfile = null,
  } = config

  // Resolve project context for tool calls
  let projectContext = null
  if (projectId) {
    try {
      projectContext = await projectContextFromId(projectId)
    } catch {
      // project not found — run without tools
    }
  }

  // Build system prompt
  const projectConfig = await readProjectConfig()
  const configuredProject = projectId
    ? projectConfig.projects.find((project) => project.id === projectId)
    : null
  const skillsContext = {
    globalSkillNames: projectConfig.globalSkills,
    projectSkillNames: configuredProject?.skills,
  }
  const profileSystemPrompt = agentProfile?.systemPrompt ? `\n\n<agent_profile_instructions>\nAgent Profile: ${agentProfile.label || agentProfile.name}\n${agentProfile.systemPrompt}\n</agent_profile_instructions>` : ''
  const resolvedSystemPrompt = systemPrompt ?? `${await buildSystemPrompt(projectId)}${profileSystemPrompt}`

  // Resolve model
  let resolvedModel = model
  if (!resolvedModel) {
    // Try to load from storage
    try {
      const settings = await readStore('settings')
      const raw = settings?.['active-model']
      if (raw) resolvedModel = typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch {
      // ignore
    }
  }

  // Build skills tools for enabled skills, plus workspace tools when a project is available.
  const profileToolNames = Array.isArray(agentProfile?.allowedTools) ? agentProfile.allowedTools : null
  const tools = await createServerTools(
    projectId,
    projectContext,
    skillsContext,
    !!(projectId && projectContext),
    (toolName) => {
      if (profileToolNames && !profileToolNames.includes(toolName)) return `Agent profile ${agentProfile.name} is not allowed to use ${toolName}.`
      const session = agentSessions.get(sessionId)
      return session ? createCommandToolPermissions(session)(toolName) : null
    },
    agentProfile
      ? {
          allowedToolNames: profileToolNames,
          includeSubagentTool: false,
          includeMcpTools: false,
          parentSessionId: sessionId,
        }
      : { parentSessionId: sessionId },
  )

  // Resolve API key
  const getApiKey = async (provider) => {
    try {
      const keys = await readStore('provider-keys')
      return keys?.[provider] || undefined
    } catch {
      return undefined
    }
  }

  let session
  const agent = new Agent({
    initialState: {
      systemPrompt: resolvedSystemPrompt,
      model: resolvedModel,
      thinkingLevel,
      messages,
      tools,
    },
    streamFn: streamSimpleWithAiHttpLogging,
    getApiKey,
    sessionId,
    convertToLlm: serverConvertToLlm,
    onPayload: (payload) => {
      restoreReasoningContentInPayload(payload, session?.lastTransformedContextMessages || agent.state.messages, agent.state.model)
    },
    transformContext: (messages, signal) => transformSessionContext(session, messages, signal),
    beforeToolCall: async (context) => {
      const toolName = context.toolCall?.name
      const toolCallId = context.toolCall?.id
      const currentSession = agentSessions.get(sessionId)
      const commandPermissionError = commandToolPermissionError(currentSession, toolName)
      if (commandPermissionError) return { block: true, reason: commandPermissionError }
      const isSkillTool = toolName === 'activate_skill' || toolName === 'read_skill_resource'
      if (isSkillTool) return undefined
      if (profileToolNames && !profileToolNames.includes(toolName)) return { block: true, reason: `Agent profile ${agentProfile.name} is not allowed to use ${toolName}.` }
      if (toolName === 'run_subagent') return undefined
      if (isMcpToolName(toolName)) {
        if (!currentSession?.yoloMode) return createApprovalPromise(currentSession, toolCallId, toolName, context.args)
        return undefined
      }
      if (!projectContext) {
        return { block: true, reason: 'No active project. Select a project to use tools.' }
      }
      if (!currentSession?.yoloMode) {
        // YOLO OFF: safe reads auto-pass, dangerous writes require approval
        if (safeReadTools.has(toolName)) return undefined
        return createApprovalPromise(currentSession, toolCallId, toolName, context.args)
      }
      return undefined
    },
  })

  const eventBus = new EventEmitter()
  eventBus.setMaxListeners(100)

  session = {
    sessionId,
    agent,
    projectContext,
    projectId,
    yoloMode,
    model: resolvedModel,
    thinkingLevel,
    scope,
    title,
    createdAt,
    lastModified,
    globalSkillNames: skillsContext.globalSkillNames,
    projectSkillNames: skillsContext.projectSkillNames,
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    activeCommandName: null,
    activeCommandPermissions: null,
    activeCommandPrompt: null,
    eventBus,
    idleTimer: null,
    titleGenerated: false,
    toolTimings: new Map(),
    getApiKey,
    contextCompaction,
    agentProfile: agentProfile ? agentProfileSnapshot(agentProfile) : null,
    lastTransformedContextMessages: null,
    autoCompacting: false,
    lastAutoCompactAt: null,
    lastAutoCompactRejected: null,
    /** Track active SSE connections. Only one SSE stream allowed per session to prevent
     *  connection-pool exhaustion when two browser tabs load the same session. */
    sseConnected: false,
  }

  // Subscribe to agent lifecycle events and forward to eventBus
  agent.subscribe((event) => {
    // The pi-agent-core agent loop emits agent_end with `messages` that only
    // contains messages generated during THIS run (newMessages), not the
    // complete session history.  Replace with the authoritative full state
    // before forwarding to clients.
    const timedEvent = addToolTimingToEvent(session, event)
    const forwardEvent = timedEvent.type === 'agent_end' && timedEvent.messages
      ? { ...timedEvent, messages: agent.state.messages }
      : timedEvent

    // Forward all events to the session event bus and the global bus.
    emitSessionEvent(session, forwardEvent)

    // Track status
    if (event.type === 'agent_start') {
      session.status = 'running'
      session.startedAt = session.startedAt ?? new Date().toISOString()
      session.finishedAt = null
      // Persist running state immediately so a browser refresh still shows the green dot
      persistSession(session).catch((err) =>
        logger.error(`Failed to persist session on start ${sessionId}:`, err, { sessionId }),
      )
    }

    if (event.type === 'agent_end') {
      session.status = session.agent.state.errorMessage ? 'error' : 'idle'
      session.finishedAt = new Date().toISOString()
      resetIdleTimer(session)

      // Persist after run ends
      persistSession(session).catch((err) =>
        logger.error(`Failed to persist session ${sessionId}:`, err, { sessionId }),
      )
    }

    if (event.type === 'message_end') {
      // Do a lightweight persist on message_end for crash recovery
      persistSession(session).catch((err) =>
        logger.error(`Failed to persist session ${sessionId}:`, err, { sessionId }),
      )
    }
  })

  agentSessions.set(sessionId, session)
  resetIdleTimer(session)
  logger.info(`Created session ${sessionId} (scope: ${scope}, project: ${projectId || 'none'}, yolo: ${yoloMode})`, { sessionId, scope, projectId: projectId || undefined, yoloMode })
  return session
}

function messageTimestampMs(message) {
  const timestamp = message?.timestamp
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) return timestamp
  if (typeof timestamp === 'string') {
    const trimmed = timestamp.trim()
    if (!trimmed) return undefined
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) return numeric
    const parsed = Date.parse(trimmed)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

function sessionLastModifiedFromMessages(messages, fallback) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const timestamp = messageTimestampMs(messages[index])
    if (timestamp !== undefined) return new Date(timestamp).toISOString()
  }

  const fallbackMs = Date.parse(fallback)
  return Number.isNaN(fallbackMs) ? new Date().toISOString() : new Date(fallbackMs).toISOString()
}

/**
 * Persist session data to storage.
 */
async function persistSession(session) {
  const { sessionId, agent, scope, projectId, title, createdAt, lastModified: storedLastModified, status, startedAt, finishedAt, model, thinkingLevel, yoloMode, contextCompaction } = session
  const messages = agent.state.messages

  if (messages.length === 0) {
    try {
      await deleteSessionValue(sessionId)
      await atomicUpdate('sessions-metadata', (data) => {
        delete data[sessionId]
        return data
      })
    } catch (err) {
      logger.error(`Failed to remove empty session ${sessionId}:`, err, { sessionId })
    }
    return
  }

  const now = new Date().toISOString()
  const lastModified = sessionLastModifiedFromMessages(messages, storedLastModified || createdAt || now)
  const sessionData = {
    id: sessionId,
    title,
    model,
    thinkingLevel,
    yoloMode,
    messages,
    createdAt: createdAt || now,
    lastModified,
    scope,
    projectId: scope === 'project' ? projectId : undefined,
    taskStatus: status,
    taskStartedAt: startedAt,
    taskFinishedAt: finishedAt,
    contextCompaction: contextCompaction || undefined,
  }
  session.lastModified = lastModified

  // Calculate usage
  let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.usage) {
      usage.input += msg.usage.input ?? 0
      usage.output += msg.usage.output ?? 0
      usage.cacheRead += msg.usage.cacheRead ?? 0
      usage.cacheWrite += msg.usage.cacheWrite ?? 0
      usage.totalTokens += msg.usage.totalTokens ?? 0
    }
  }

  // Generate preview from last assistant message
  let preview = ''
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      const content = messages[i].content
      if (Array.isArray(content)) {
        preview = content
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join(' ')
          .slice(0, 200)
      } else if (typeof content === 'string') {
        preview = content.slice(0, 200)
      }
      break
    }
  }

  const metadata = {
    id: sessionId,
    title,
    createdAt: createdAt || now,
    lastModified,
    messageCount: messages.length,
    usage,
    thinkingLevel,
    yoloMode,
    preview,
    scope,
    projectId: scope === 'project' ? projectId : undefined,
    taskStatus: status,
    taskStartedAt: startedAt,
    taskFinishedAt: finishedAt,
    contextCompaction: contextCompaction ? {
      compactedAt: contextCompaction.compactedAt,
      compactedUpToIndex: contextCompaction.compactedUpToIndex,
      keepRecentTurns: contextCompaction.keepRecentTurns,
      thresholdPercent: contextCompaction.thresholdPercent,
      usageBefore: contextCompaction.usageBefore,
    } : undefined,
  }

  // Write to storage atomically (read-modify-write within queue)
  try {
    await writeSessionValue(sessionId, sessionData)
    await atomicUpdate('sessions-metadata', (data) => {
      data[sessionId] = {
        ...metadata,
        pinnedAt: data[sessionId]?.pinnedAt,
      }
      return data
    })
  } catch (err) {
    logger.error(`Failed to persist session ${sessionId}:`, err, { sessionId })
  }
}

export async function persistSessionState(session) {
  await persistSession(session)
}

export function rollbackStartIndexFromMessage(messages, messageIndex) {
  let rollbackIndex = Number(messageIndex)
  if (!Number.isInteger(rollbackIndex) || rollbackIndex < 0 || rollbackIndex >= messages.length) return -1

  if (messages[rollbackIndex]?.role === 'assistant') {
    for (let index = rollbackIndex - 1; index >= 0; index--) {
      if (messages[index].role === 'user' || messages[index].role === 'user-with-attachments') {
        rollbackIndex = index
        break
      }
    }
  }

  const message = messages[rollbackIndex]
  if (!message || (message.role !== 'user' && message.role !== 'user-with-attachments')) return -1
  return rollbackIndex
}

export async function rollbackSessionMessages(sessionId, rollbackMessageIndex) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  if (session.agent.state.isStreaming) {
    throw Object.assign(new Error('Generation is still running. Stop it or wait until it finishes before rolling back.'), { statusCode: 409 })
  }

  const messages = Array.isArray(session.agent.state.messages) ? session.agent.state.messages : []
  const rollbackIndex = rollbackStartIndexFromMessage(messages, rollbackMessageIndex)
  if (rollbackIndex < 0) {
    throw Object.assign(new Error('There is no conversation turn to roll back.'), { statusCode: 400 })
  }

  const nextMessages = messages.slice(0, rollbackIndex)
  updateSessionMessages(session, nextMessages)
  resetSessionCompaction(session)
  session.status = 'idle'
  session.finishedAt = new Date().toISOString()
  await persistSession(session)

  const replacedEvent = {
    type: 'messages_replaced',
    reason: 'rollback',
    rollbackIndex,
    messages: session.agent.state.messages,
    contextCompaction: session.contextCompaction,
    contextUsage: getSessionContextUsage(session),
  }
  emitSessionEvent(session, replacedEvent)
  emitSessionEvent(session, { type: 'message_end', messages: session.agent.state.messages })
  emitSessionEvent(session, { type: 'agent_end', messages: session.agent.state.messages })

  return { session: getSessionState(sessionId), rollbackIndex }
}

export async function replaceSessionMessages(sessionId, messages) {
  const session = agentSessions.get(sessionId)
  if (!session) return null
  if (session.agent.state.isStreaming) {
    throw Object.assign(new Error('Generation is still running. Stop it or wait until it finishes before rolling back.'), { statusCode: 409 })
  }
  updateSessionMessages(session, Array.isArray(messages) ? messages : [])
  resetSessionCompaction(session)
  session.status = 'idle'
  session.finishedAt = new Date().toISOString()
  await persistSession(session)
  const nextMessages = session.agent.state.messages
  const contextUsage = getSessionContextUsage(session)
  emitSessionEvent(session, { type: 'message_end', messages: nextMessages, contextUsage })
  emitSessionEvent(session, { type: 'agent_end', messages: nextMessages, contextUsage })
  return getSessionState(sessionId)
}

/**
 * Send a user message to the agent and start the agent loop.
 * Returns immediately; events are streamed via the event bus.
 */
export async function runPrompt(sessionId, message) {
  let session = agentSessions.get(sessionId)
  if (!session) {
    session = await restoreAgent(sessionId)
  }
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }

  resetIdleTimer(session)

  // Build user message
  const initialUserMessage = typeof message === 'string'
    ? { role: 'user', content: message, timestamp: new Date().toISOString() }
    : message
  const commandState = await resolveCommandState(session, initialUserMessage)
  const userMessage = commandState.userMessage ?? initialUserMessage

  if (commandState.textResponse) {
    session.agent.state.messages = [
      ...session.agent.state.messages,
      initialUserMessage,
      assistantTextMessage(commandState.textResponse, session.model),
    ]
    await persistSession(session)
    const messages = session.agent.state.messages
    emitSessionEvent(session, { type: 'message_end', messages })
    emitSessionEvent(session, { type: 'agent_end', messages })
    return { sessionId, status: session.status }
  }

  if (commandState.clear) {
    return clearSession(session)
  }

  if (commandState.compact) {
    return compactSession(session, initialUserMessage, commandState.compact)
  }

  // AI title generation on first user message (fire-and-forget, before agent runs)
  if (!session.titleGenerated && session.title === 'New chat') {
    // Set a simple fallback title immediately so the sidebar shows something
    // meaningful even if AI title generation fails or is slow.
    const simpleTitle = generateTitle([userMessage])
    if (simpleTitle !== 'New chat') {
      session.title = simpleTitle
    }
    session.titleGenerated = true
    generateAiTitle([userMessage], session.model, session.thinkingLevel, session.getApiKey).then(async (aiTitle) => {
      if (aiTitle && aiTitle !== 'New chat') {
        session.title = aiTitle
        await persistSession(session)
        emitSessionEvent(session, { type: 'title_updated', title: aiTitle })
      }
    }).catch((err) => {
      logger.warn(`Title generation failed for session ${sessionId}:`, err.message || err, { sessionId })
    })
  }

  session.activeCommandName = commandState.commandName ?? null
  session.activeCommandPermissions = commandState.permissions ?? null
  session.activeCommandPrompt = commandState.commandPrompt ?? null

  // Fire and forget — events come through eventBus
  session.agent.prompt(userMessage).catch((err) => {
    logger.error(`Agent prompt error for session ${sessionId}:`, err, { sessionId })
    const event = {
      type: 'error',
      error: err.message || 'Unknown error',
    }
    emitSessionEvent(session, event)
  }).finally(() => {
    session.activeCommandName = null
    session.activeCommandPermissions = null
    session.activeCommandPrompt = null
  })

  return { sessionId, status: session.status }
}

/**
 * Continue generation from the current last message (must be a user or
 * tool-result message).  Used by the retry button to regenerate a response
 * in-place without appending a new user message.
 *
 * Trims messages to keep up to and including the last user message,
 * removing the assistant response that follows it.
 */
export async function continueSession(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  if (session.agent.state.isStreaming) {
    throw Object.assign(new Error('Generation is still running. Stop it or wait until it finishes.'), { statusCode: 409 })
  }

  const messages = Array.isArray(session.agent.state.messages) ? session.agent.state.messages : []

  // Find the last user message and trim everything after it (the assistant response)
  let lastUserIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' || messages[i].role === 'user-with-attachments') {
      lastUserIndex = i
      break
    }
  }
  if (lastUserIndex < 0) {
    throw Object.assign(new Error('Cannot continue: no user message found.'), { statusCode: 400 })
  }

  const trimmedMessages = messages.slice(0, lastUserIndex + 1)
  updateSessionMessages(session, trimmedMessages)
  resetSessionCompaction(session)

  resetIdleTimer(session)
  session.agent.continue().catch((err) => {
    logger.error(`Agent continue error for session ${sessionId}:`, err, { sessionId })
    emitSessionEvent(session, { type: 'error', error: err.message || 'Unknown error' })
  })

  return { sessionId, status: 'running' }
}

/**
 * Abort the current agent run.
 */
export async function abortRun(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }

  // Clean up any pending tool approvals for this session
  for (const [toolCallId, approval] of pendingApprovals) {
    if (approval.sessionId === sessionId) {
      approval.reject(new Error('Run aborted'))
    }
  }
  for (const [approvalId, approval] of pendingAutoCompactApprovals) {
    if (approval.sessionId === sessionId) {
      approval.reject(new Error('Run aborted'))
      pendingAutoCompactApprovals.delete(approvalId)
    }
  }

  session.agent.abort()
  await session.agent.waitForIdle()

  if (session.status === 'running') {
    session.status = 'aborted'
    session.finishedAt = new Date().toISOString()
    persistSession(session).catch((err) =>
      logger.error(`Failed to persist aborted session ${sessionId}:`, err, { sessionId }),
    )
    const event = {
      type: 'agent_end',
      messages: session.agent.state.messages,
    }
    emitSessionEvent(session, event)
  }

  return { sessionId, aborted: true }
}

/**
 * Queue a steering message to inject after the current assistant turn.
 */
export function steerAgent(sessionId, message) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }

  const agentMessage = typeof message === 'string'
    ? { role: 'user', content: message, timestamp: Date.now() }
    : message

  session.agent.steer(agentMessage)
  return { sessionId, steered: true }
}

/**
 * Queue a follow-up message to process after the agent would otherwise stop.
 */
export function followUpAgent(sessionId, message) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }

  const agentMessage = typeof message === 'string'
    ? { role: 'user', content: message, timestamp: Date.now() }
    : message

  session.agent.followUp(agentMessage)
  return { sessionId, followUp: true }
}

function getSessionContextUsage(session) {
  try {
    return estimateSessionContextUsage(session)
  } catch (error) {
    logger.warn(`Failed to estimate context usage for session ${session?.sessionId}:`, error?.message || error, { sessionId: session?.sessionId })
    return null
  }
}

/**
 * Get the current state of a session (for page refresh recovery).
 */
export function getSessionState(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session) return null

  return {
    sessionId: session.sessionId,
    scope: session.scope,
    projectId: session.projectId,
    yoloMode: session.yoloMode,
    systemPrompt: session.agent.state.systemPrompt,
    model: session.model,
    thinkingLevel: session.thinkingLevel,
    title: session.title,
    createdAt: session.createdAt,
    lastModified: session.lastModified,
    status: session.status,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    tools: session.agent.state.tools,
    messages: session.agent.state.messages,
    contextCompaction: session.contextCompaction,
    contextUsage: getSessionContextUsage(session),
    isStreaming: session.agent.state.isStreaming,
    errorMessage: session.agent.state.errorMessage,
  }
}

/**
 * Try to claim the SSE slot for a session. Returns true if acquired, false if
 * another tab already holds the SSE connection for this session.
 */
export function tryAcquireSse(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session || session.sseConnected) return false
  session.sseConnected = true
  return true
}

/**
 * Check whether a session already has an active SSE connection, without
 * acquiring it. For use by lightweight HEAD probes.
 */
export function isSseConnected(sessionId) {
  const session = agentSessions.get(sessionId)
  return session ? session.sseConnected : false
}

/**
 * Release the SSE slot for a session.
 */
export function releaseSse(sessionId) {
  const session = agentSessions.get(sessionId)
  if (session) session.sseConnected = false
}

/**
 * Get the event bus for a session (for SSE connections).
 */
export function getSessionEventBus(sessionId) {
  const session = agentSessions.get(sessionId)
  return session?.eventBus ?? null
}

/**
 * Destroy an agent session.
 */
export async function destroyAgent(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session) return

  logger.info(`Destroying session ${sessionId} (status: ${session.status})`, { sessionId, status: session.status })

  if (session.idleTimer) clearTimeout(session.idleTimer)

  try {
    session.agent.abort()
  } catch {
    // ignore
  }

  // Clean up any pending approvals for this session before removing it.
  for (const [toolCallId, approval] of pendingApprovals) {
    if (approval.sessionId === sessionId) approval.reject(new Error('Session destroyed'))
  }
  for (const [approvalId, approval] of pendingAutoCompactApprovals) {
    if (approval.sessionId === sessionId) approval.reject(new Error('Session destroyed'))
  }

  // Final persist (empty sessions are cleaned up by persistSession)
  try {
    await persistSession(session)
  } catch {
    // ignore
  }

  session.eventBus.removeAllListeners()
  agentSessions.delete(sessionId)
}

/**
 * Try to restore an agent session from persisted storage.
 * Returns the restored session, or null if not found.
 */
export async function restoreAgent(sessionId) {
  const existing = agentSessions.get(sessionId)
  if (existing) return existing

  try {
    const sessionData = await readSessionValue(sessionId)
    if (!sessionData) {
      logger.warn(`Cannot restore session ${sessionId}: no stored data found`, { sessionId })
      return null
    }

    logger.info(`Restoring session ${sessionId} from storage (scope: ${sessionData.scope}, messages: ${sessionData.messages?.length ?? 0})`, { sessionId, scope: sessionData.scope, messageCount: sessionData.messages?.length ?? 0 })

    return await createAgent(sessionId, {
      scope: sessionData.scope || 'global',
      projectId: sessionData.projectId || null,
      yoloMode: sessionData.yoloMode || false,
      model: sessionData.model,
      thinkingLevel: sessionData.thinkingLevel || 'off',
      messages: sessionData.messages || [],
      title: sessionData.title || 'New chat',
      createdAt: sessionData.createdAt,
      lastModified: sessionData.lastModified,
      contextCompaction: sessionData.contextCompaction || null,
    })
  } catch (err) {
    logger.error(`Failed to restore agent ${sessionId}:`, err, { sessionId })
    return null
  }
}

/**
 * Approve a pending tool call, allowing it to execute.
 */
export function approveToolCall(sessionId, toolCallId) {
  const approval = pendingApprovals.get(toolCallId)
  if (!approval || approval.sessionId !== sessionId) {
    throw Object.assign(new Error('No pending approval for this tool call'), { statusCode: 404 })
  }
  approval.resolve(true)
  return { approved: true, toolCallId }
}

/**
 * Reject a pending tool call, skipping its execution.
 */
export function rejectToolCall(sessionId, toolCallId) {
  const approval = pendingApprovals.get(toolCallId)
  if (!approval || approval.sessionId !== sessionId) {
    throw Object.assign(new Error('No pending approval for this tool call'), { statusCode: 404 })
  }
  approval.resolve(false)
  return { rejected: true, toolCallId }
}

export function approveAutoCompact(sessionId, approvalId) {
  const approval = pendingAutoCompactApprovals.get(approvalId)
  if (!approval || approval.sessionId !== sessionId) {
    throw Object.assign(new Error('No pending auto compact approval for this session'), { statusCode: 404 })
  }
  approval.resolve(true)
  return { approved: true, approvalId }
}

export function rejectAutoCompact(sessionId, approvalId) {
  const approval = pendingAutoCompactApprovals.get(approvalId)
  if (!approval || approval.sessionId !== sessionId) {
    throw Object.assign(new Error('No pending auto compact approval for this session'), { statusCode: 404 })
  }
  approval.resolve(false)
  return { rejected: true, approvalId }
}

export function abortToolCall(sessionId, toolCallId) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  const aborted = abortRunningCommand(toolCallId)
  if (!aborted) {
    throw Object.assign(new Error('No running command for this tool call'), { statusCode: 404 })
  }
  return { aborted: true, toolCallId }
}

/**
 * List all active sessions.
 */
export function listSessions() {
  const result = []
  for (const [id, session] of agentSessions) {
    result.push({
      sessionId: id,
      scope: session.scope,
      status: session.status,
      title: session.title,
    })
  }
  return result
}

export async function refreshAllSessionTools() {
  const result = []
  for (const [sessionId, session] of agentSessions) {
    try {
      await rebuildSessionTools(session)
      const state = getSessionState(sessionId)
      emitSessionEvent(session, { type: 'state', ...state })
      result.push({ sessionId, ok: true, toolCount: session.agent.state.tools?.length || 0 })
    } catch (error) {
      logger.error(`Failed to refresh tools for session ${sessionId}:`, error, { sessionId })
      result.push({ sessionId, ok: false, error: error?.message || 'Failed to refresh tools' })
    }
  }
  return result
}

export async function updateSessionYoloMode(sessionId, yoloMode) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }

  session.yoloMode = Boolean(yoloMode)
  await rebuildSessionTools(session)
  await persistSession(session)

  const state = getSessionState(sessionId)
  emitSessionEvent(session, { type: 'state', ...state })

  return { sessionId, yoloMode: session.yoloMode }
}

/**
 * Update the model for an existing session.
 * Syncs the model to both the session record (for persistence) and the agent state (for API calls).
 * Does NOT force persistence — normal lifecycle events (message_end, agent_end) will persist
 * the updated model.
 */
export function updateSessionModel(sessionId, model) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  if (!model) {
    throw Object.assign(new Error('Missing model'), { statusCode: 400 })
  }

  session.model = model
  session.agent.state.model = model

  return { sessionId, model }
}

/**
 * Update the thinking level for an existing session.
 */
export function updateSessionThinkingLevel(sessionId, thinkingLevel) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  if (!thinkingLevel) {
    throw Object.assign(new Error('Missing thinkingLevel'), { statusCode: 400 })
  }

  session.thinkingLevel = thinkingLevel
  session.agent.state.thinkingLevel = thinkingLevel

  return { sessionId, thinkingLevel }
}

/**
 * Reset stale `taskStatus: 'running'` entries in persisted session metadata.
 * Called on server startup — any sessions marked as running are clearly stale
 * since the server just started fresh.
 */
export async function resetStaleTaskStatuses() {
  try {
    const metadataStore = await readStore('sessions-metadata')
    let changed = false
    for (const [id, meta] of Object.entries(metadataStore)) {
      if (meta && meta.taskStatus === 'running') {
        metadataStore[id] = { ...meta, taskStatus: 'idle', taskFinishedAt: meta.taskFinishedAt ?? new Date().toISOString() }
        changed = true
      }
    }
    if (changed) {
      await atomicUpdate('sessions-metadata', () => metadataStore)
      logger.info('Reset stale task statuses in persisted metadata')
    }
  } catch (err) {
    logger.error('Failed to reset stale task statuses:', err)
  }
}

/**
 * Clean up all agents on shutdown.
 */
export async function shutdown() {
  const ids = [...agentSessions.keys()]
  await Promise.all(ids.map((id) => destroyAgent(id)))
}
