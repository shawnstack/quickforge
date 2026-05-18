import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { Agent } from '@mariozechner/pi-agent-core'
import { streamSimple } from '@mariozechner/pi-ai'
import { toolHandlers, loadSkillToolContext } from './tools/index.mjs'
import { createSkillTools, workspaceTools } from './tools/definitions.mjs'
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
  handleInternalCommand,
  parseInternalCommandInvocation,
  resolveCustomCommandInvocation,
} from './custom-commands.mjs'

// ---------------------------------------------------------------------------
// Tool definitions (server-side, no REST roundtrip)
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function mergeQuickForgeTiming(details, timing) {
  if (!isPlainObject(details)) return { quickforgeTiming: timing }
  return { ...details, quickforgeTiming: timing }
}

function wrapToolDefinition(definition, context, toolPermissions) {
  const handler = toolHandlers[definition.name]
  if (!handler) throw new Error(`Missing handler for tool: ${definition.name}`)
  return {
    ...definition,
    execute: async (_toolCallId, params, signal, onUpdate) => {
      if (toolPermissions) {
        const permissionError = toolPermissions(definition.name)
        if (permissionError) throw new Error(permissionError)
      }

      const startedAt = Date.now()
      const startedAtPerf = performance.now()
      const result = await handler(params || {}, context, { signal, onUpdate })
      const finishedAt = Date.now()
      const durationMs = Math.max(0, Math.round(performance.now() - startedAtPerf))
      return {
        content: [{ type: 'text', text: result.content }],
        details: mergeQuickForgeTiming(result.details, { startedAt, finishedAt, durationMs }),
      }
    },
  }
}

async function createServerTools(projectId, projectContext, skillsContext, includeWorkspaceTools, toolPermissions) {
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
  const tools = skillTools.map((definition) => wrapToolDefinition(definition, toolContext, toolPermissions))

  if (includeWorkspaceTools && projectId && projectContext) {
    tools.push(...workspaceTools.map((definition) => wrapToolDefinition(definition, toolContext, toolPermissions)))
  }

  return tools
}

function sessionSkillsContext(session) {
  return {
    globalSkillNames: session.globalSkillNames,
    projectSkillNames: session.projectSkillNames,
  }
}

async function rebuildSessionTools(session) {
  session.agent.state.tools = await createServerTools(
    session.projectId,
    session.projectContext,
    sessionSkillsContext(session),
    !!(session.projectId && session.projectContext),
    createCommandToolPermissions(session),
  )
}

// ---------------------------------------------------------------------------
// Agent Manager
// ---------------------------------------------------------------------------

const agentSessions = new Map()

/** @typedef {{ agent: Agent, projectContext: object|null, projectId: string|null, yoloMode: boolean, model: object, thinkingLevel: string, scope: string, title: string, createdAt: string, status: string, startedAt: string|null, finishedAt: string|null, listeners: Set<function>, idleTimer: NodeJS.Timeout|null, eventBus: EventEmitter }} AgentSession */

const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes for tool approval
const commandRestrictedTools = new Set(['write_file', 'edit_file', 'replace_in_files', 'run_command'])
const safeReadTools = new Set(['read_file', 'grep_files'])
const pendingApprovals = new Map() // toolCallId → { resolve, reject, sessionId, toolName, args, timeout }

function createCommandToolPermissions(session) {
  return (toolName) => {
    const permissions = session.activeCommandPermissions
    if (!permissions || !commandRestrictedTools.has(toolName)) return null
    if (toolName === 'run_command' && permissions.allowCommands === false) {
      return `Custom command /${session.activeCommandName} does not allow running shell commands.`
    }
    if ((toolName === 'write_file' || toolName === 'edit_file' || toolName === 'replace_in_files') && permissions.allowEdit === false) {
      return `Custom command /${session.activeCommandName} does not allow editing files.`
    }
    return null
  }
}

/**
 * Create a Promise that only resolves when the user accepts or rejects the tool call.
 * The agent loop's `await config.beforeToolCall(...)` pauses on this promise,
 * effectively freezing the agent until the user decides.
 */
function createApprovalPromise(session, toolCallId, toolName, args) {
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
    }
    session.eventBus.emit('agent_event', approvalEvent)
    agentEvents.emit('agent_event', approvalEvent)
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
  session.eventBus.emit('agent_event', event)
  agentEvents.emit('agent_event', { sessionId: session.sessionId, ...event })
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
  const compacted = compactedContextMessages(messages)
  if (compacted.length < messages.length) {
    session.agent.state.messages = compacted
  }
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
  )
  if (typeof internalResponse === 'string') return { textResponse: internalResponse }
  if (internalResponse?.clear) return { clear: internalResponse }
  if (internalResponse?.compact) return { compact: internalResponse }

  if (!session.projectContext?.workspaceRoot) return { userMessage }

  const invocation = await resolveCustomCommandInvocation(userMessage, session.projectContext.workspaceRoot)
  if (!invocation) return { userMessage }

  return {
    userMessage,
    commandPrompt: invocation.systemPrompt,
    permissions: invocation.permissions,
    commandName: invocation.command.name,
  }
}

/**
 * Convert AgentMessage[] to LLM-compatible Message[].
 * Handles "user-with-attachments" → "user" with multi-modal content blocks.
 * Without this the default pi-agent-core convertToLlm silently drops
 * user-with-attachments messages, so the LLM never sees attachments.
 */
function serverConvertToLlm(messages) {
  return messages
    .filter(m => m.role !== 'artifact')
    .map(m => {
      if (m.role === 'user-with-attachments') {
        const textContent = typeof m.content === 'string'
          ? [{ type: 'text', text: m.content }]
          : [...m.content]
        if (Array.isArray(m.attachments)) {
          for (const att of m.attachments) {
            if (att.type === 'image' && att.content) {
              textContent.push({ type: 'image', data: att.content, mimeType: att.mimeType })
            } else if (att.type === 'document' && att.extractedText) {
              textContent.push({ type: 'text', text: `\n\n[Document: ${att.fileName}]\n${att.extractedText}` })
            }
          }
        }
        return { ...m, role: 'user', content: textContent }
      }
      if (m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult') return m
      return null
    })
    .filter(Boolean)
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

function transformAgentContext(messages, commandPrompt) {
  return applyActiveCommandPrompt(compactedContextMessages(messages), commandPrompt)
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
  const resolvedSystemPrompt = systemPrompt ?? (await buildSystemPrompt(projectId))

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
  const tools = await createServerTools(
    projectId,
    projectContext,
    skillsContext,
    !!(projectId && projectContext),
    (toolName) => {
      const session = agentSessions.get(sessionId)
      return session ? createCommandToolPermissions(session)(toolName) : null
    },
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

  const agent = new Agent({
    initialState: {
      systemPrompt: resolvedSystemPrompt,
      model: resolvedModel,
      thinkingLevel,
      messages,
      tools,
    },
    streamFn: streamSimple,
    getApiKey,
    sessionId,
    convertToLlm: serverConvertToLlm,
    onPayload: (payload) => {
      restoreReasoningContentInPayload(payload, agent.state.messages, agent.state.model)
    },
    transformContext: (messages) => transformAgentContext(messages, session?.activeCommandPrompt),
    beforeToolCall: async (context) => {
      const toolName = context.toolCall?.name
      const toolCallId = context.toolCall?.id
      const isSkillTool = toolName === 'activate_skill' || toolName === 'read_skill_resource'
      if (isSkillTool) return undefined
      if (!projectContext) {
        return { block: true, reason: 'No active project. Select a project to use tools.' }
      }
      const currentSession = agentSessions.get(sessionId)
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

  const session = {
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
    eventBus.emit('agent_event', forwardEvent)
    agentEvents.emit('agent_event', { sessionId, ...forwardEvent })

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

/**
 * Persist session data to storage.
 */
async function persistSession(session) {
  const { sessionId, agent, scope, projectId, title, createdAt, status, startedAt, finishedAt, model, thinkingLevel, yoloMode } = session
  const messages = compactedContextMessages(agent.state.messages)

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
  const sessionData = {
    id: sessionId,
    title,
    model,
    thinkingLevel,
    yoloMode,
    messages,
    createdAt: createdAt || now,
    lastModified: now,
    scope,
    projectId: scope === 'project' ? projectId : undefined,
    taskStatus: status,
    taskStartedAt: startedAt,
    taskFinishedAt: finishedAt,
  }

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
    lastModified: now,
    messageCount: messages.length,
    usage,
    thinkingLevel,
    preview,
    scope,
    projectId: scope === 'project' ? projectId : undefined,
    taskStatus: status,
    taskStartedAt: startedAt,
    taskFinishedAt: finishedAt,
  }

  // Write to storage atomically (read-modify-write within queue)
  try {
    await writeSessionValue(sessionId, sessionData)
    await atomicUpdate('sessions-metadata', (data) => {
      data[sessionId] = metadata
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
  session.status = 'idle'
  session.finishedAt = new Date().toISOString()
  await persistSession(session)

  const replacedEvent = {
    type: 'messages_replaced',
    reason: 'rollback',
    rollbackIndex,
    messages: session.agent.state.messages,
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
  session.status = 'idle'
  session.finishedAt = new Date().toISOString()
  await persistSession(session)
  const nextMessages = session.agent.state.messages
  emitSessionEvent(session, { type: 'message_end', messages: nextMessages })
  emitSessionEvent(session, { type: 'agent_end', messages: nextMessages })
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
    session.eventBus.emit('agent_event', { type: 'message_end', messages })
    session.eventBus.emit('agent_event', { type: 'agent_end', messages })
    agentEvents.emit('agent_event', { sessionId, type: 'message_end', messages })
    agentEvents.emit('agent_event', { sessionId, type: 'agent_end', messages })
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
        session.eventBus.emit('agent_event', { type: 'title_updated', title: aiTitle })
        agentEvents.emit('agent_event', { sessionId, type: 'title_updated', title: aiTitle })
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
    session.eventBus.emit('agent_event', event)
    agentEvents.emit('agent_event', { sessionId, ...event })
  }).finally(() => {
    session.activeCommandName = null
    session.activeCommandPermissions = null
    session.activeCommandPrompt = null
  })

  return { sessionId, status: session.status }
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
    session.eventBus.emit('agent_event', event)
    agentEvents.emit('agent_event', { sessionId, ...event })
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
    status: session.status,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    tools: session.agent.state.tools,
    messages: session.agent.state.messages,
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
