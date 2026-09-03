import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Agent } from '@earendil-works/pi-agent-core'
import { streamSimpleWithAiHttpLogging } from './ai-http-logger.mjs'
import { loadSkillToolContext, abortRunningCommand } from './tools/index.mjs'
import { createSkillTools, globalMemoryTool, workspaceTools } from './tools/definitions.mjs'
import { createMcpToolDefinitions, isMcpToolName, subscribeMcpToolsetChanged } from './mcp/registry.mjs'
import { createPluginToolDefinitions, isPluginToolName } from './plugins/registry.mjs'
import { createOpenCodeAcpAgent } from './opencode-acp-agent.mjs'
import {
  composeSubagentSystemPrompt,
  formatSubagentTask,
} from './subagents.mjs'
import { agentProfileSnapshot, getAgentProfile, listSubagentProfiles } from './agent-profiles.mjs'
import { modelBindingFromModel, resolveImplicitModelPreference, resolveModelBinding } from './model-catalog.mjs'
import { agentProfileFromMarkdown } from './agent-profile-files.mjs'
import {
  applyCapabilityPolicy,
  inferCapabilityPolicy,
  modelReferenceSnapshot,
  normalizeCapabilityPolicy,
  normalizeModelReference,
  resolveAgentProfileModel,
  resolveAgentProfileThinkingLevel,
  validateAgentProfileTools,
  validateModelReference,
} from './agent-profile-schema.mjs'
import { projectContextFromId, defaultGlobalWorkspaceContext, readProjectConfig } from './project-config.mjs'
import { ensureStorage, readStore, atomicUpdate, readSessionValue, tempAgentsDir } from './storage.mjs'
import { readSessionStateRecord, saveSessionStatePair, deleteSessionState, storedMessagesState, sessionMessagesTailDigest } from './session-state-service.mjs'
import { logger } from './utils/logger.mjs'
import { publishChannelSessionChanged } from './channels/event-relay.mjs'
import { withSessionPersistenceLock } from './session-persistence-lock.mjs'
import { getGlobalMemoryRevision, isGlobalMemoryEnabled } from './global-memory.mjs'
import { buildSystemPrompt, generateAiTitle, generateTitle } from './session-utils.mjs'
import { restoreReasoningContentInPayload } from './reasoning-cache.mjs'
import {
  compactConversation,
  compactionMessageDetails,
  isCompactSummaryMessage,
  parseCompactArgs,
  saveCompactBackup,
} from './conversation-compaction.mjs'
import {
  buildAutoCompactLoopMessages,
  compactSessionInPlace,
  DEFAULT_AUTO_COMPACT_SETTINGS,
  estimateSessionContextUsage,
  maybeAutoCompactSession,
  readAutoCompactSettings,
} from './auto-compaction.mjs'
import {
  formatAgentCommandPrompt,
  formatSkillCommandPrompt,
  handleInternalCommand,
  parseInternalCommandInvocation,
  resolveCustomCommandInvocation,
} from './custom-commands.mjs'
import { mergeSkills, normalizeSkillNames } from './skills.mjs'
import {
  contextReferencesFromMessage,
  contextReferencesPrompt,
  validatePromptContextReferences,
  validateContextReferences,
  withCanonicalContextReferences,
} from './context-references.mjs'
import { serverConvertToLlm, messageText, lastAssistantText } from './message-converters.mjs'
import {
  normalizeSelectedCapabilities,
  selectedCapabilitiesFromMessage,
  selectedCapabilityPrompt,
  withCanonicalSelectedCapabilities,
} from './selected-capabilities.mjs'
import { mergeQuickForgeTiming, wrapToolDefinition, wrapMcpToolDefinition, wrapPluginToolDefinition, sessionSkillsContext } from './tool-wiring.mjs'
import {
  APPROVAL_TIMEOUT_MS,
  safeReadTools,
  pendingApprovals,
  pendingAutoCompactApprovals,
  getPendingApprovalForSession,
  getPendingAutoCompactApprovalForSession,
  commandToolPermissionError,
  createCommandToolPermissions,
} from './approval-store.mjs'
import {
  ASK_TIMEOUT_MS,
  pendingAsks,
  getPendingAskForSession,
  normalizeAskQuestions,
  formatAskResult,
} from './ask-store.mjs'

export { getPendingAskForSession, normalizeAskQuestions } from './ask-store.mjs'

// ---------------------------------------------------------------------------
// Tool definitions (server-side, no REST roundtrip)
// ---------------------------------------------------------------------------

function wrapSubagentToolDefinition(definition, parentSessionId) {
  return {
    ...definition,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const parentSession = agentSessions.get(parentSessionId)
      if (!parentSession) throw new Error('Parent session is no longer active.')
      try {
        const result = await runSubagent(parentSession, toolCallId, params || {}, signal, onUpdate)
        return {
          content: [{ type: 'text', text: result.content }],
          details: result.details,
        }
      } catch (error) {
        // 超时等错误附带的 quickforgeSubagentDetails 由 afterToolCall 取回注入
        // toolResult（pi-agent-core 对抛错 execute 只保留错误文本）。
        if (error && typeof error === 'object' && error.quickforgeSubagentDetails) {
          stashSubagentErrorDetails(toolCallId, error.quickforgeSubagentDetails)
        }
        throw error
      }
    },
  }
}

function wrapAskUserToolDefinition(definition, parentSessionId) {
  return {
    ...definition,
    execute: async (toolCallId, params) => {
      const session = agentSessions.get(parentSessionId)
      if (!session) {
        return {
          content: [{ type: 'text', text: 'No active session for ask_user.' }],
          details: { askId: null, skipped: true },
        }
      }
      return createAskUserPromise(session, toolCallId, params || {})
    },
  }
}

function wrapWorkspaceToolDefinition(definition, context, toolPermissions, options = {}) {
  if (definition.name === 'run_subagent') return wrapSubagentToolDefinition(definition, options.parentSessionId)
  if (definition.name === 'ask_user') return wrapAskUserToolDefinition(definition, options.parentSessionId)
  return wrapToolDefinition(definition, context, toolPermissions)
}

async function createServerTools(projectId, projectContext, skillsContext, includeWorkspaceTools, toolPermissions, options = {}) {
  const {
    allowedToolNames = null,
    includeSubagentTool = true,
    includeMcpTools = true,
    includePluginTools = true,
    mcpWaitForConnections = true,
    parentSessionId = null,
    sessionId = null,
    scope = 'global',
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
  const toolContext = {
    ...projectContext,
    ...skillToolContext,
    ...(sessionId ? { sessionId, scope, projectId } : {}),
  }
  const tools = skillTools
    .filter(isAllowed)
    .map((definition) => wrapToolDefinition(definition, toolContext, toolPermissions))

  if (!allowedTools && await isGlobalMemoryEnabled()) {
    tools.push(wrapToolDefinition(globalMemoryTool, toolContext, toolPermissions))
  }

  if (includeWorkspaceTools && projectContext) {
    const definitions = workspaceTools.filter((definition) => includeSubagentTool || definition.name !== 'run_subagent')
    tools.push(...definitions
      .filter(isAllowed)
      .map((definition) => wrapWorkspaceToolDefinition(definition, toolContext, toolPermissions, { parentSessionId })))
  }

  if (includeMcpTools) {
    const mcpTools = await createMcpToolDefinitions({ waitForConnections: mcpWaitForConnections })
    tools.push(...mcpTools.filter(isAllowed).map((definition) => wrapMcpToolDefinition(definition, toolPermissions)))
  }

  if (includePluginTools) {
    const pluginTools = await createPluginToolDefinitions(projectContext)
    tools.push(...pluginTools.filter(isAllowed).map((definition) => wrapPluginToolDefinition(definition, toolContext, toolPermissions)))
  }

  return tools
}

async function rebuildSessionTools(session) {
  if (session.harness === AGENT_HARNESS_OPENCODE) {
    session.agent.state.tools = []
    return
  }
  const profileToolNames = Array.isArray(session.agentProfile?.allowedTools) ? session.agentProfile.allowedTools : null
  session.agent.state.tools = await createServerTools(
    session.projectId,
    session.projectContext,
    sessionSkillsContext(session),
    !!session.projectContext,
    createCommandToolPermissions(session),
    session.agentProfile
      ? {
          allowedToolNames: profileToolNames,
          includeSubagentTool: false,
          includeMcpTools: false,
          parentSessionId: session.sessionId,
          sessionId: session.sessionId,
          scope: session.scope,
        }
      : {
          parentSessionId: session.sessionId,
          sessionId: session.sessionId,
          scope: session.scope,
        },
  )
}

// ---------------------------------------------------------------------------
// Agent Manager
// ---------------------------------------------------------------------------

const agentSessions = new Map()

const AGENT_ACCESS_MODE_DEFAULT = 'default'
const AGENT_ACCESS_MODE_FULL_ACCESS = 'full-access'
const AGENT_HARNESS_QUICKFORGE = 'quickforge'
const AGENT_HARNESS_OPENCODE = 'opencode'

export function normalizeAgentHarness(value, fallback = AGENT_HARNESS_QUICKFORGE) {
  if (value === AGENT_HARNESS_QUICKFORGE || value === AGENT_HARNESS_OPENCODE) return value
  if (fallback !== value) return normalizeAgentHarness(fallback, AGENT_HARNESS_QUICKFORGE)
  return AGENT_HARNESS_QUICKFORGE
}

export function validateAgentHarness(value) {
  if (value === undefined || value === null || value === '') return AGENT_HARNESS_QUICKFORGE
  if (value === 'claude-code') {
    throw Object.assign(new Error('Claude Code Harness is not available yet.'), { statusCode: 400 })
  }
  if (value !== AGENT_HARNESS_QUICKFORGE && value !== AGENT_HARNESS_OPENCODE) {
    throw Object.assign(new Error(`Unsupported Harness: ${value}`), { statusCode: 400 })
  }
  return value
}

function normalizeAccessMode(value, fallback = AGENT_ACCESS_MODE_DEFAULT) {
  if (value === AGENT_ACCESS_MODE_DEFAULT || value === AGENT_ACCESS_MODE_FULL_ACCESS) return value
  if (value === true || value === 'true') return AGENT_ACCESS_MODE_FULL_ACCESS
  if (value === false || value === 'false') return AGENT_ACCESS_MODE_DEFAULT
  if (fallback !== value) return normalizeAccessMode(fallback, AGENT_ACCESS_MODE_DEFAULT)
  return AGENT_ACCESS_MODE_DEFAULT
}

function yoloModeFromAccessMode(accessMode) {
  return normalizeAccessMode(accessMode) === AGENT_ACCESS_MODE_FULL_ACCESS
}

function hasFullAccess(session) {
  return normalizeAccessMode(session?.accessMode, session?.yoloMode) === AGENT_ACCESS_MODE_FULL_ACCESS
}

/** @typedef {{ agent: Agent, projectContext: object|null, projectId: string|null, accessMode: string, yoloMode: boolean, model: object, thinkingLevel: string, scope: string, title: string, createdAt: string, status: string, startedAt: string|null, finishedAt: string|null, listeners: Set<function>, idleTimer: NodeJS.Timeout|null, eventBus: EventEmitter }} AgentSession */

const IDLE_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
const ABORT_IDLE_WAIT_TIMEOUT_MS = 3000
const SUBAGENT_DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000 // 2 hours
const SUBAGENT_MAX_TIMEOUT_MS = 2 * 60 * 60 * 1000
const SUBAGENT_TRACE_THROTTLE_MS = 150
// 运行期 trace update 的 details.messages 只携带最近 N 条消息（截尾），
// 并附 messagesTotal 总条数；终态 toolResult.details.messages 保持全量。
const SUBAGENT_TRACE_MESSAGES_LIMIT = 50
// 超时错误正文中最后一条 assistant 文本的截断长度（半角字符）。
const SUBAGENT_TIMEOUT_LAST_MESSAGE_LIMIT = 600
// run_subagent 错误 details 暂存条目的兜底 TTL；正常路径 afterToolCall 即取走删除。
const SUBAGENT_ERROR_DETAILS_STASH_TTL_MS = 6 * 60 * 60 * 1000

/**
 * Create a Promise that only resolves when the user accepts or rejects the tool call.
 * The agent loop's `await config.beforeToolCall(...)` pauses on this promise,
 * effectively freezing the agent until the user decides.
 */
function createApprovalPromise(session, toolCallId, toolName, args, source) {
  if (!session) return { block: true, reason: 'No active session for tool approval.' }
  return new Promise((resolve, reject) => {
    let settled = false
    const requestedAt = Date.now()
    const expiresAt = requestedAt + APPROVAL_TIMEOUT_MS

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      pendingApprovals.delete(toolCallId)
      resolve({ block: true, reason: `Approval timeout for ${toolName}` })
    }, APPROVAL_TIMEOUT_MS)

    let onAbort = null

    const cleanup = () => {
      clearTimeout(timeout)
      if (onAbort) {
        session.agent.signal?.removeEventListener('abort', onAbort)
        onAbort = null
      }
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
      onAbort = () => {
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
      requestedAt,
      expiresAt,
    })

    emitSessionEvent(session, {
      type: 'tool_approval_required',
      sessionId: session.sessionId,
      toolCallId,
      toolName,
      args,
      source,
    })
  })
}

/**
 * Create a Promise that resolves when the user answers (or skips) an ask_user
 * tool call. The tool's execute blocks on this promise, pausing the agent loop
 * until the user responds.
 */
function createAskUserPromise(session, toolCallId, params) {
  const questions = normalizeAskQuestions(params)
  if (!questions.length) {
    return Promise.resolve({
      content: [{ type: 'text', text: formatAskResult(questions, null, true, 'no-questions') }],
      details: { askId: null, skipped: true },
    })
  }
  const askId = randomUUID()
  return new Promise((resolve) => {
    let settled = false
    const requestedAt = Date.now()
    const expiresAt = requestedAt + ASK_TIMEOUT_MS

    const timeout = setTimeout(() => {
      if (settled) return
      finish({ skipped: true, reason: 'timeout' })
    }, ASK_TIMEOUT_MS)

    let onAbort = null

    const finish = (payload) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (onAbort && session.agent.signal) session.agent.signal.removeEventListener('abort', onAbort)
      pendingAsks.delete(askId)
      const answers = payload.skipped ? null : payload.answers
      resolve({
        content: [{ type: 'text', text: formatAskResult(questions, answers, payload.skipped, payload.reason) }],
        details: { askId, questions, answers, skipped: !!payload.skipped, ...(payload.reason ? { skipReason: payload.reason } : {}) },
      })
      emitSessionEvent(session, {
        type: 'ask_user_answered',
        sessionId: session.sessionId,
        askId,
        toolCallId,
        skipped: !!payload.skipped,
        answers: answers || [],
      })
    }

    const signal = session.agent.signal
    if (signal) {
      if (signal.aborted) {
        finish({ skipped: true, reason: 'aborted' })
        return
      }
      onAbort = () => finish({ skipped: true, reason: 'aborted' })
      signal.addEventListener('abort', onAbort, { once: true })
    }

    pendingAsks.set(askId, {
      finish: (payload) => finish(payload),
      sessionId: session.sessionId,
      toolCallId,
      questions,
      requestedAt,
      expiresAt,
    })

    emitSessionEvent(session, {
      type: 'ask_user_required',
      sessionId: session.sessionId,
      askId,
      toolCallId,
      questions,
    })
  })
}

function createAcpApprovalPromise(session, request) {  return new Promise((resolve, reject) => {
    let settled = false
    const requestedAt = Date.now()
    const expiresAt = requestedAt + APPROVAL_TIMEOUT_MS
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      pendingApprovals.delete(request.toolCallId)
      resolve({ outcome: { outcome: 'cancelled' } })
    }, APPROVAL_TIMEOUT_MS)

    const cleanup = () => {
      clearTimeout(timeout)
      if (settled) return
      settled = true
      pendingApprovals.delete(request.toolCallId)
    }
    const allowOption = request.options.find((option) => option.kind === 'allow_once' || option.kind === 'allow_always')
    const rejectOption = request.options.find((option) => option.kind === 'reject_once' || option.kind === 'reject_always')

    pendingApprovals.set(request.toolCallId, {
      resolve: (approved) => {
        cleanup()
        const option = approved ? allowOption : rejectOption
        resolve(option
          ? { outcome: { outcome: 'selected', optionId: option.optionId } }
          : { outcome: { outcome: 'cancelled' } })
      },
      reject: (error) => {
        cleanup()
        reject(error)
      },
      sessionId: session.sessionId,
      toolName: request.toolName,
      args: request.args,
      source: 'opencode',
      requestedAt,
      expiresAt,
    })

    emitSessionEvent(session, {
      type: 'tool_approval_required',
      sessionId: session.sessionId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      args: request.args,
      source: 'opencode',
    })
  })
}

function createAutoCompactApprovalPromise(session, details = {}) {
  if (!session) return Promise.resolve(false)
  const approvalId = randomUUID()
  return new Promise((resolve, reject) => {
    let settled = false
    const requestedAt = Date.now()
    const expiresAt = requestedAt + APPROVAL_TIMEOUT_MS
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      pendingAutoCompactApprovals.delete(approvalId)
      resolve(false)
    }, APPROVAL_TIMEOUT_MS)

    let onAbort = null

    const cleanup = () => {
      clearTimeout(timeout)
      if (onAbort) {
        session.agent.signal?.removeEventListener('abort', onAbort)
        onAbort = null
      }
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
      onAbort = () => {
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
      usage: details.usage,
      thresholdPercent: details.settings?.thresholdPercent,
      keepRecentTurns: details.settings?.keepRecentTurns,
      requestedAt,
      expiresAt,
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

function assistantTextMessage(text, model, details) {
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
    ...(details ? { details } : {}),
  }
}

function userTextMessage(text, details) {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
    ...(details ? { details } : {}),
  }
}

function assistantErrorMessage(text, model) {
  return {
    ...assistantTextMessage('', model),
    stopReason: 'error',
    errorMessage: text,
    timestamp: Date.now(),
  }
}

export function appendAssistantErrorMessageOnce(messages, errorMessage, model) {
  const current = Array.isArray(messages) ? messages : []
  const lastMessage = current[current.length - 1]
  const errorAlreadyShown = lastMessage?.role === 'assistant'
    && lastMessage?.stopReason === 'error'
    && lastMessage?.errorMessage
  return errorAlreadyShown ? current : [...current, assistantErrorMessage(errorMessage, model)]
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

function nextSessionStateVersion(session) {
  const current = Number.isFinite(session?.stateVersion) ? session.stateVersion : 0
  session.stateVersion = current + 1
  return session.stateVersion
}

function emitSessionEvent(session, event) {
  const stateVersion = nextSessionStateVersion(session)
  const enrichedEvent = (event?.type === 'message_end' || event?.type === 'agent_end' || event?.type === 'messages_replaced' || event?.type === 'auto_compact_completed')
    && event.contextUsage === undefined
    ? { ...event, contextUsage: getSessionContextUsage(session), stateVersion }
    : { ...event, stateVersion }
  session.eventBus.emit('agent_event', transformSplitSessionEvent(session, enrichedEvent))
  agentEvents.emit('agent_event', { sessionId: session.sessionId, ...transformSplitSessionEvent(session, enrichedEvent) })
}

/**
 * F9 split-message SSE frames: split sessions never ship the full `messages`
 * array over SSE. `state` frames carry a lightweight `messagesSummary`
 * ({ count }) instead; message_end/agent_end/messages_replaced frames carry
 * only the tail that the client has not yet seen (`messagesAfter` +
 * `messages` + `messagesIncremental`), with a `messagesSummary` for the total.
 * Non-split sessions keep the legacy full-array payloads byte-for-byte, so
 * older clients and non-split sessions are unaffected. `stateVersion` is
 * never modified here.
 */
function transformSplitSessionEvent(session, event) {
  if (session.persistedMessageStorage !== 'split' || !event || typeof event !== 'object') return event
  if (event.type === 'state') {
    if (!Array.isArray(event.messages)) return event
    const next = { ...event }
    const count = next.messages.length
    delete next.messages
    next.messagesSummary = { count }
    return next
  }
  if (event.type === 'message_end' || event.type === 'agent_end' || event.type === 'messages_replaced') {
    if (!Array.isArray(event.messages)) return event
    const after = session.persistedMessageCount ?? 0
    const tail = event.messages.slice(after)
    const count = event.messages.length
    const next = { ...event }
    delete next.messages
    if (tail.length > 0) {
      next.messages = tail
      next.messagesAfter = after
      next.messagesIncremental = true
    }
    next.messagesSummary = { count }
    return next
  }
  return event
}

/**
 * Strip full messages from a session state snapshot destined for the wire
 * (GET /state, POST /restore, SSE initial state frame) when the session is
 * split. Internal consumers (shared conversations, ACP) keep the full state.
 */
export function stripSplitSessionState(state) {
  if (!state || state.messageStorage !== 'split') return state
  if (!Array.isArray(state.messages)) return state
  const next = { ...state }
  const count = next.messages.length
  delete next.messages
  next.messagesSummary = { count }
  return next
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

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function updateRuntimeToolExecution(session, event) {
  if (!event?.toolCallId) return
  if (event.type !== 'tool_execution_start' && event.type !== 'tool_execution_update' && event.type !== 'tool_execution_end') return

  const existing = session.runtimeToolExecutions?.get(event.toolCallId)
  const toolName = event.toolName ?? existing?.toolName
  if (!toolName) return
  const result = event.type === 'tool_execution_end' ? event.result : event.partialResult
  const existingDetails = isRecord(existing?.details) ? existing.details : {}
  const resultDetails = isRecord(result?.details) ? result.details : {}
  const quickforgeTiming = event.quickforgeTiming || resultDetails.quickforgeTiming || existingDetails.quickforgeTiming
  const details = {
    ...existingDetails,
    ...resultDetails,
    ...(quickforgeTiming ? { quickforgeTiming } : {}),
    sessionId: resultDetails.sessionId ?? existingDetails.sessionId ?? session.sessionId,
    toolCallId: resultDetails.toolCallId ?? existingDetails.toolCallId ?? event.toolCallId,
  }

  session.runtimeToolExecutions?.set(event.toolCallId, {
    role: 'toolResult',
    toolCallId: event.toolCallId,
    toolName,
    content: result?.content ?? existing?.content ?? [],
    details,
    isError: event.type === 'tool_execution_end' ? Boolean(event.isError) : false,
    timestamp: existing?.timestamp ?? Date.now(),
    pending: event.type !== 'tool_execution_end',
  })
}

function messagesWithRuntimeToolExecutions(session) {
  const messages = session.agent.state.messages || []
  if (!session.runtimeToolExecutions?.size) return messages

  const authoritativeToolCallIds = new Set(
    messages
      .filter((message) => message?.role === 'toolResult' && typeof message.toolCallId === 'string')
      .map((message) => message.toolCallId),
  )
  const runtimeMessages = []
  for (const [toolCallId, snapshot] of session.runtimeToolExecutions) {
    if (authoritativeToolCallIds.has(toolCallId)) {
      session.runtimeToolExecutions.delete(toolCallId)
    } else {
      const { pending: _pending, ...message } = snapshot
      runtimeMessages.push(message)
    }
  }
  return runtimeMessages.length > 0 ? [...messages, ...runtimeMessages] : messages
}

function runtimePendingToolCalls(session) {
  const pending = new Set(session.agent.state.pendingToolCalls || [])
  for (const [toolCallId, snapshot] of session.runtimeToolExecutions || []) {
    if (snapshot.pending) pending.add(toolCallId)
    else pending.delete(toolCallId)
  }
  return Array.from(pending)
}

export function markLatestAssistantProcessFinished(messages, finishedAt = Date.now()) {
  if (!Array.isArray(messages)) return false
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || message.role !== 'assistant') continue
    const details = message.details && typeof message.details === 'object' && !Array.isArray(message.details)
      ? message.details
      : {}
    if (details.quickforgeProcessFinishedAt !== undefined) return false
    messages[index] = { ...message, details: { ...details, quickforgeProcessFinishedAt: finishedAt } }
    return true
  }
  return false
}

function updateSessionMessages(session, messages) {
  session.agent.state.messages = messages
}

const CLIENT_MESSAGE_ID_FIELD = 'quickforgeClientMessageId'

function isManagedCloudModel(model) {
  return model?.provider === 'quickforge-cloud' && model?.quickforgeModelSource === 'cloud'
}

function objectMetadata(message) {
  const metadata = message?.metadata
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}
}

function logicalMessageId(message) {
  const value = objectMetadata(message)[CLIENT_MESSAGE_ID_FIELD]
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined
}

function messageWithLogicalId(message) {
  if (!message || typeof message !== 'object' || logicalMessageId(message)) return message
  return {
    ...message,
    metadata: {
      ...objectMetadata(message),
      [CLIENT_MESSAGE_ID_FIELD]: `qfcm_${randomUUID()}`,
    },
  }
}

function prepareCloudUserMessage(session, message) {
  return isManagedCloudModel(session?.model) ? messageWithLogicalId(message) : message
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

async function summarySession(session, initialUserMessage, summaryOptions) {
  if (session.harness === AGENT_HARNESS_OPENCODE) {
    throw Object.assign(new Error('OpenCode Harness does not support QuickForge summary derivation yet.'), { statusCode: 409 })
  }
  if (session.agent.state.isStreaming) {
    session.agent.state.messages = [
      ...session.agent.state.messages,
      initialUserMessage,
      assistantTextMessage('Cannot summarize while a generation is still running. Stop it or wait until it finishes, then run /summary again.', session.model),
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
    const options = parseCompactArgs(summaryOptions?.args || '')

    if (options.unsupported?.length) {
      session.agent.state.messages = [
        ...originalMessages,
        initialUserMessage,
        assistantTextMessage(`Unsupported /summary option(s): ${options.unsupported.join(', ')}\n\nSupported usage: /summary or /summary keep=0`, session.model),
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
        assistantTextMessage('Not enough earlier history to summarize. Continue chatting and run /summary again later.', session.model),
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
    ].join('\n'), compactionMessageDetails('summary'))
    const notice = assistantTextMessage([
      `已基于当前对话创建压缩后的新对话：原 ${result.originalCount} 条消息 → ${result.recentTail.length + 2} 条消息。`,
      `当前原对话已完整保留，保留最近 ${result.keepTurns} 个用户回合原文，估算新对话上下文减少约 ${reduction}%。`,
      '压缩前历史已保存到本地备份。',
    ].join('\n'), session.model, compactionMessageDetails('notice'))

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
      accessMode: session.accessMode,
      harness: session.harness,
      sourceHarnessSessionId: session.harness === AGENT_HARNESS_OPENCODE ? session.agent.harnessSessionId : null,
      yoloMode: session.yoloMode,
      model: session.model,
      modelRef: session.modelRef,
      modelAccessContext: session.modelAccessContext,
      resolvePersistedModel: true,
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

  const args = String(compactOptions?.args || '').trim()
  if (args) {
    session.agent.state.messages = [
      ...session.agent.state.messages,
      initialUserMessage,
      assistantTextMessage('Unsupported /compact option(s). Supported usage: /compact', session.model),
    ]
    session.status = 'idle'
    session.finishedAt = new Date().toISOString()
    await persistSession(session)
    const messages = session.agent.state.messages
    emitSessionEvent(session, { type: 'message_end', messages })
    emitSessionEvent(session, { type: 'agent_end', messages })
    return { sessionId: session.sessionId, status: session.status }
  }

  resetIdleTimer(session)
  session.status = 'running'
  session.startedAt = session.startedAt ?? new Date().toISOString()
  session.finishedAt = null
  session.agent.state.isStreaming = true
  session.agent.state.errorMessage = undefined
  emitSessionEvent(session, { type: 'agent_start' })

  try {
    const messages = session.agent.state.messages.slice()
    const settings = await readAutoCompactSettings().catch(() => DEFAULT_AUTO_COMPACT_SETTINGS)
    const usage = getSessionContextUsage(session)
    const result = await compactSessionInPlace({
      session,
      messages,
      keepRecentTurns: 0,
      minSourceChars: 0,
      usage,
      thresholdPercent: settings.thresholdPercent,
      emitSessionEvent,
      persistSession,
      reason: 'manual_compact',
      onBeforePersist: () => {
        finishManualSessionRun(session, 'idle')
      },
    })

    if (!result.compacted) {
      session.agent.state.messages = [
        ...messages,
        initialUserMessage,
        assistantTextMessage('Not enough earlier history to compact. Continue chatting and run /compact again later.', session.model),
      ]
      finishManualSessionRun(session, 'idle')
      await persistSession(session)
      const nextMessages = session.agent.state.messages
      emitSessionEvent(session, { type: 'message_end', messages: nextMessages })
      emitSessionEvent(session, { type: 'agent_end', messages: nextMessages })
      return { sessionId: session.sessionId, status: session.status }
    }

    const nextMessages = session.agent.state.messages
    emitSessionEvent(session, { type: 'message_end', messages: nextMessages })
    emitSessionEvent(session, { type: 'agent_end', messages: nextMessages })
    return { sessionId: session.sessionId, status: session.status }
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
  session.titleSource = 'default'
  session.titleGenerationId += 1
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

const QUICKFORGE_COMMAND_DETAILS_KEY = 'quickforgeCommand'

function normalizedPromptCommand(command) {
  return command?.type === 'plan' ? { type: 'plan' } : null
}

function objectDetails(message) {
  const details = message?.details
  return details && typeof details === 'object' && !Array.isArray(details) ? details : {}
}

function promptCommandFromMessage(message) {
  return normalizedPromptCommand(objectDetails(message)[QUICKFORGE_COMMAND_DETAILS_KEY])
}

function messageWithPromptCommand(message, command) {
  const normalized = normalizedPromptCommand(command)
  if (!normalized || !message || typeof message !== 'object') return message
  return {
    ...message,
    details: {
      ...objectDetails(message),
      [QUICKFORGE_COMMAND_DETAILS_KEY]: normalized,
    },
  }
}

function internalInvocationForPromptCommand(userMessage, command) {
  const normalized = normalizedPromptCommand(command)
  if (normalized?.type === 'plan') {
    // Derive the task from the message text. Strip a leading "/plan" so that
    // toggling plan mode while typing "/plan <task>" yields the clean task —
    // matching the slash-command parse path and avoiding a redundant prefix.
    const raw = messageText(userMessage).trim()
    const planPrefix = raw.match(/^\/plan(?:\s+([\s\S]*))?$/i)
    return { type: 'plan', args: planPrefix ? (planPrefix[1] || '').trim() : raw }
  }
  return parseInternalCommandInvocation(userMessage)
}

function planCommandState(userMessage, args) {
  return {
    userMessage: messageWithPromptCommand(userMessage, { type: 'plan' }),
    commandPrompt: formatPlanCommandPrompt(args),
    permissions: { allowEdit: false, allowCommands: false, allowSubagents: true },
    commandName: 'plan',
  }
}

function parseSlashNameAndTask(args) {
  const trimmed = String(args || '').trim()
  if (!trimmed) return { name: '', task: '' }
  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/)
  return { name: match?.[1] || '', task: (match?.[2] || '').trim() }
}

async function enabledSkillsForSession(session) {
  // Same sources as the activate_skill tool (loadSkillToolContext), resolved
  // from the session's captured skill selections and workspace.
  const skillContext = await loadSkillToolContext({
    ...sessionSkillsContext(session),
    workspaceRoot: session.projectContext?.workspaceRoot,
  })
  return mergeSkills(skillContext.globalSkills, skillContext.projectSkills)
}

function enabledSkillsLine(enabledSkills) {
  if (enabledSkills.length === 0) return 'No skills are currently enabled.'
  return `Enabled skills: ${enabledSkills.map((skill) => skill.name).join(', ')}.`
}

function availableSubagentsLine(profiles) {
  return `Available subagents: ${profiles.map((profile) => profile.name).join(', ')}.`
}

async function skillCommandState(session, userMessage, args) {
  const { name, task } = parseSlashNameAndTask(args)
  const enabledSkills = await enabledSkillsForSession(session)

  if (!name) {
    return { textResponse: ['Usage: /skill <name> [task]', '', enabledSkillsLine(enabledSkills)].join('\n') }
  }

  const skillName = normalizeSkillNames([name])[0]
  const skill = skillName ? enabledSkills.find((item) => item.name === skillName) : null
  if (!skill) {
    return {
      textResponse: [
        `Unknown or disabled skill: ${name}`,
        '',
        'Usage: /skill <name> [task]',
        '',
        enabledSkillsLine(enabledSkills),
      ].join('\n'),
    }
  }

  return {
    userMessage,
    commandPrompt: formatSkillCommandPrompt(skill.name, task),
    commandName: 'skill',
  }
}

async function agentCommandState(session, userMessage, args) {
  const { name, task } = parseSlashNameAndTask(args)
  const profileOptions = { workspaceRoot: session.projectContext?.workspaceRoot }

  if (!name) {
    const profiles = await listSubagentProfiles(profileOptions)
    return { textResponse: ['Usage: /agent <name> <task>', '', availableSubagentsLine(profiles)].join('\n') }
  }
  if (!task) {
    return { textResponse: 'Usage: /agent <name> <task>' }
  }

  const profile = await getAgentProfile(name, profileOptions)
  if (!profile || profile.enabledAsSubagent !== true) {
    const profiles = await listSubagentProfiles(profileOptions)
    return {
      textResponse: [
        `Unknown subagent: ${name}`,
        '',
        'Usage: /agent <name> <task>',
        '',
        availableSubagentsLine(profiles),
      ].join('\n'),
    }
  }

  return {
    userMessage,
    commandPrompt: formatAgentCommandPrompt(profile.name, task),
    commandName: 'agent',
  }
}

async function resolveCommandState(session, userMessage, promptCommand = null) {
  const command = normalizedPromptCommand(promptCommand) || promptCommandFromMessage(userMessage)
  const internalInvocation = internalInvocationForPromptCommand(userMessage, command)
  // /skill and /agent need session context (enabled skills, workspace-rooted
  // agent profiles), so they are resolved here before handleInternalCommand.
  if (internalInvocation?.type === 'skill') return skillCommandState(session, userMessage, internalInvocation.args)
  if (internalInvocation?.type === 'agent') return agentCommandState(session, userMessage, internalInvocation.args)
  const internalResponse = await handleInternalCommand(
    internalInvocation,
    session.projectContext?.workspaceRoot,
    session.projectContext?.project?.commandDir,
  )
  if (typeof internalResponse === 'string') return { textResponse: internalResponse }
  if (internalResponse?.clear) return { clear: internalResponse }
  if (internalResponse?.summary) return { summary: internalResponse }
  if (internalResponse?.compact) return { compact: internalResponse }
  if (internalResponse?.plan) {
    return planCommandState(userMessage, internalResponse.args)
  }
  if (internalResponse?.init) {
    if (!session.projectId) return { textResponse: 'Initialization requires an active project chat.' }
    return {
      userMessage,
      commandPrompt: formatInitCommandPrompt(),
      permissions: { allowEdit: true, allowCommands: true, allowSubagents: true },
      commandName: 'init',
    }
  }
  if (internalResponse?.review) {
    return {
      userMessage,
      commandPrompt: formatReviewCommandPrompt(internalResponse.args),
      permissions: { allowEdit: false, allowCommands: true, allowSubagents: false },
      commandName: 'review',
    }
  }
  if (internalResponse?.commit) {
    return {
      userMessage,
      commandPrompt: formatCommitCommandPrompt(internalResponse.args),
      permissions: { allowEdit: false, allowCommands: true, allowSubagents: false },
      commandName: 'commit',
    }
  }

  if (!session.projectContext?.workspaceRoot) {
    // Even without a project, user-level custom commands (~/.quickforge/commands/) are available
    const invocation = await resolveCustomCommandInvocation(
      userMessage,
      null,
      session.projectContext?.project?.commandDir,
    )
    if (!invocation) return { userMessage }

    return {
      userMessage,
      commandPrompt: invocation.systemPrompt,
      permissions: invocation.permissions,
      commandName: invocation.command.name,
    }
  }

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

function formatInitCommandPrompt() {
  return `<init_command_invocation name="init">
This /init command applies only to the current user request. Work in the current repository root. Inspect the repository as needed, then create or update the root-level \`AGENTS.md\`. If the file already exists, read it first and preserve useful repository-specific guidance while bringing it in line with the requirements below. Do not modify unrelated files.

Generate a file named AGENTS.md that serves as a contributor guide for this repository.
Your goal is to produce a clear, concise, and well-structured document with descriptive headings and actionable explanations for each section.
Follow the outline below, but adapt as needed — add sections if relevant, and omit those that do not apply to this project.

Document Requirements

- Title the document "Repository Guidelines".
- Use Markdown headings (#, ##, etc.) for structure.
- Keep the document concise. 200-400 words is optimal.
- Keep explanations short, direct, and specific to this repository.
- Provide examples where helpful (commands, directory paths, naming patterns).
- Maintain a professional, instructional tone.

Recommended Sections

Project Structure & Module Organization

- Outline the project structure, including where the source code, tests, and assets are located.

Build, Test, and Development Commands

- List key commands for building, testing, and running locally (e.g., npm test, make build).
- Briefly explain what each command does.

Coding Style & Naming Conventions

- Specify indentation rules, language-specific style preferences, and naming patterns.
- Include any formatting or linting tools used.

Testing Guidelines

- Identify testing frameworks and coverage requirements.
- State test naming conventions and how to run tests.

Commit & Pull Request Guidelines

- Summarize commit message conventions found in the project’s Git history.
- Outline pull request requirements (descriptions, linked issues, screenshots, etc.).

(Optional) Add other sections if relevant, such as Security & Configuration Tips, Architecture Overview, or Agent-Specific Instructions.
</init_command_invocation>`
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
- You may delegate bounded read-only research to subagents, but subagents must also obey this /plan turn: no file modifications and no shell commands.
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

function formatCommitCommandPrompt(message) {
  const messageText = String(message || '').trim() || '(none; generate a message from the diff and repository style)'
  return `<commit_command_invocation name="commit">
This /commit command applies only to the current user request. Create at most one local commit for the current task.

Rules for this turn:
- Inspect the current task's Git changes and commit only files related to this task; do not mix in unrelated changes.
- Never use \`git add .\`, \`git add -A\`, or \`git add --all\`; stage only explicit task-related paths.
- Run relevant validation before committing and stop if it fails. Do not modify code, bypass hooks, or alter unrelated changes.
- Create at most one local commit. Do not push, tag, release, publish, or otherwise affect a remote.
- Use the requested message below, or generate one from the diff and repository conventions when none is provided.
- Report the commit hash and message, validations run, and any remaining working tree changes.

Requested commit message:
${messageText}
</commit_command_invocation>`
}

function formatReviewCommandPrompt(scope) {
  const scopeText = String(scope || '').trim() || '(none; review the repository changes that appear relevant for a pre-commit check)'
  return `<review_command_invocation name="review">
This /review command applies only to the current user request. Perform a pre-commit self-review of the code that is about to be committed.

Rules for this turn:
- Do not modify files.
- Do not create files.
- Do not stage, unstage, commit, tag, push, publish, or otherwise change repository state.
- Do not use write_file or edit_file.
- You may use read-only tools and shell commands to inspect the workspace and run validation checks.
- Do not use subagents; perform the review directly in this turn.
- Prefer safe inspection commands such as git status, git diff, git diff --cached, and targeted lint/build/test commands.
- Treat command output as evidence; distinguish confirmed issues from risks or suggestions.

Review checklist:
1. Identify the changes under review, prioritizing staged changes when present and otherwise unstaged working tree changes.
2. Look for correctness bugs, regressions, edge cases, missing error handling, security or privacy risks, and unintended side effects.
3. Check whether tests, lint/build validation, or documentation/wiki updates are needed.
4. Call out any risky commands that should not be run automatically.
5. Output a concise review with severity, file/area, evidence, and recommended next steps. If no blocking issues are found, say so clearly.

User review scope or focus:
${scopeText}
</review_command_invocation>`
}

const tempSubagentNameRegex = /^[a-z][a-z0-9_-]{1,39}$/

function frontmatterString(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '\\"')
}

function normalizeTemporarySubagentSpec(input) {
  const spec = input && typeof input === 'object' && !Array.isArray(input) ? input : null
  if (!spec || spec.type !== 'temporary') return null
  const name = String(spec.name || '').trim().toLowerCase()
  if (!tempSubagentNameRegex.test(name)) {
    const error = new Error('Temporary subagent name must start with a letter and contain only lowercase letters, numbers, underscores, or hyphens')
    error.statusCode = 400
    throw error
  }
  const instructions = String(spec.instructions || '').trim()
  if (!instructions) {
    const error = new Error('Temporary subagent instructions are required')
    error.statusCode = 400
    throw error
  }
  const requestedTools = Array.isArray(spec.tools)
    ? [...new Set(spec.tools.map((toolName) => String(toolName || '').trim()).filter(Boolean))]
    : ['read_file', 'grep_files', 'run_command']
  const capabilityPolicy = normalizeCapabilityPolicy(spec.capabilityPolicy || 'readonly-research', requestedTools)
  validateAgentProfileTools(requestedTools, capabilityPolicy)
  const allowedTools = applyCapabilityPolicy(requestedTools, capabilityPolicy)
  const model = validateModelReference(normalizeModelReference(spec.model))
  return {
    name,
    label: String(spec.label || spec.description || name).trim().slice(0, 80) || name,
    description: String(spec.description || '').trim().slice(0, 500),
    systemPrompt: instructions,
    allowedTools,
    capabilityPolicy,
    model,
    maxRuntimeMs: spec.maxRuntimeMs,
    maxToolCalls: spec.maxToolCalls,
  }
}

function safeTempPathSegment(value, fallback) {
  const text = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
  return text || fallback
}

function temporarySubagentMarkdown(spec, parentSession, runId, expiresAt) {
  return `---
name: ${spec.name}
label: "${frontmatterString(spec.label)}"
description: "${frontmatterString(spec.description)}"
source: temporary
lifecycle: temporary
createdBy: ai
createdAt: ${new Date().toISOString()}
parentSessionId: ${frontmatterString(parentSession.sessionId)}
runId: ${runId}
expiresAt: ${expiresAt}
enabled-as-subagent: true
capabilityPolicy: ${spec.capabilityPolicy}
tools: ${spec.allowedTools.join(', ')}
model:
  mode: ${spec.model?.mode === 'fixed' ? 'fixed' : 'inherit'}${spec.model?.mode === 'fixed' ? `
  provider: ${frontmatterString(spec.model.provider)}
  modelId: ${frontmatterString(spec.model.modelId)}${spec.model.api ? `
  api: ${frontmatterString(spec.model.api)}` : ''}${spec.model.baseUrl ? `
  baseUrl: ${frontmatterString(spec.model.baseUrl)}` : ''}` : ''}
max-runtime-ms: ${Math.max(1000, Math.min(Number(spec.maxRuntimeMs || SUBAGENT_DEFAULT_TIMEOUT_MS), SUBAGENT_MAX_TIMEOUT_MS))}
max-tool-calls: ${Math.max(1, Math.min(Number(spec.maxToolCalls || 300), 300))}
---
${spec.systemPrompt}
`
}

async function createTemporarySubagentProfile(parentSession, spec) {
  await ensureStorage()
  const runId = `run_${Date.now()}_${randomUUID().slice(0, 8)}`
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const dir = path.join(tempAgentsDir, safeTempPathSegment(parentSession.sessionId, 'session'), runId)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${spec.name}.md`)
  const markdown = temporarySubagentMarkdown(spec, parentSession, runId, expiresAt)
  await fs.writeFile(file, markdown, 'utf8')
  const profile = agentProfileFromMarkdown(file, markdown, {
    source: 'temporary',
    idPrefix: `temporary:${safeTempPathSegment(parentSession.sessionId, 'session')}:${runId}`,
    relativePath: path.relative(tempAgentsDir, file).replace(/\\/g, '/'),
  })
  if (!profile) throw new Error('Failed to create temporary subagent profile')
  profile.readonly = true
  return profile
}

async function resolveSubagentProfile(parentSession, requestedSubagent) {
  const temporarySpec = normalizeTemporarySubagentSpec(requestedSubagent)
  if (temporarySpec) return createTemporarySubagentProfile(parentSession, temporarySpec)
  return getAgentProfile(requestedSubagent, { workspaceRoot: parentSession.projectContext?.workspaceRoot })
}

function formatTimeoutMinutes(timeoutMs) {
  const minutes = Number((timeoutMs / (60 * 1000)).toFixed(2))
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

/**
 * 从 subagent 消息历史提取仍在 pendingToolCalls 中的工具名（与前端
 * currentSubagentToolSummaries 相同的交集算法：assistant toolCall 块 × pending id），
 * 按出现顺序去重返回，用于超时错误摘要中的「被中断时仍在执行」。
 */
function pendingSubagentToolNames(messages, pendingToolCalls) {
  const pending = new Set(pendingToolCalls || [])
  if (pending.size === 0) return []
  const names = []
  for (const message of messages) {
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (!block || block.type !== 'toolCall' || !pending.has(block.id)) continue
      pending.delete(block.id)
      if (typeof block.name === 'string' && block.name && !names.includes(block.name)) names.push(block.name)
    }
    if (pending.size === 0) break
  }
  return names
}

/**
 * 终止类错误正文的进度摘要分段：工具调用数、被中断时仍在执行的工具、
 * 最后一条 assistant 文本（压缩空白并截断）。details 不进入 LLM 上下文
 * （omitDetailsForLlm），父模型只能通过这段文字了解 subagent 被中止前
 * 完成了什么、部分成果是否可用；超时与父运行中止共用。
 */
function subagentProgressSegments({ toolCalls, messages, pendingToolCalls }) {
  const segments = [`${toolCalls} tool call${toolCalls === 1 ? '' : 's'}`]
  const runningTools = pendingSubagentToolNames(messages, pendingToolCalls)
  if (runningTools.length > 0) segments.push(`still running: ${runningTools.join(', ')}`)
  const lastMessage = String(lastAssistantText(messages) || '').trim().replace(/\s+/g, ' ')
  if (lastMessage) {
    const truncated = lastMessage.length > SUBAGENT_TIMEOUT_LAST_MESSAGE_LIMIT
      ? `${lastMessage.slice(0, SUBAGENT_TIMEOUT_LAST_MESSAGE_LIMIT)}…`
      : lastMessage
    segments.push(`last assistant message: ${truncated}`)
  }
  return segments
}

/** 超时错误正文：保持既有首句不变（兼容既有断言与用户认知），其后追加进度摘要。 */
function buildSubagentTimeoutErrorMessage(name, timeoutMs, progress) {
  return `Subagent ${name} timed out after ${formatTimeoutMinutes(timeoutMs)}. Progress before timeout: ${subagentProgressSegments(progress).join('; ')}.`
}

/** 父运行中止错误正文：首句保持既有文案，其后追加与超时同构的进度摘要。 */
function buildSubagentAbortedErrorMessage(name, progress) {
  return `Subagent ${name} aborted with parent run. Progress before abort: ${subagentProgressSegments(progress).join('; ')}.`
}

/**
 * run_subagent 抛错时附带的结构化 details 暂存（toolCallId → { stashedAt, details }）。
 * pi-agent-core 将抛错的 execute 收口为纯文本错误结果（details 为空对象），父 Agent
 * 的 afterToolCall 从这里取回 details 注入 toolResult，使超时错误也携带完整过程
 * （messages/toolCalls/pendingToolCalls 等）持久化并在 Inspector 中可见。正常路径
 * afterToolCall 立即取走并删除；遗留条目仅按 TTL 兜底清理，防异常销毁泄漏。
 */
const stashedSubagentErrorDetails = new Map()

function stashSubagentErrorDetails(toolCallId, details) {
  if (typeof toolCallId !== 'string' || !toolCallId) return
  const now = Date.now()
  for (const [stashedId, entry] of stashedSubagentErrorDetails) {
    if (now - entry.stashedAt > SUBAGENT_ERROR_DETAILS_STASH_TTL_MS) stashedSubagentErrorDetails.delete(stashedId)
  }
  stashedSubagentErrorDetails.set(toolCallId, { stashedAt: now, details })
}

function takeStashedSubagentErrorDetails(toolCallId) {
  if (typeof toolCallId !== 'string') return undefined
  const entry = stashedSubagentErrorDetails.get(toolCallId)
  if (!entry) return undefined
  stashedSubagentErrorDetails.delete(toolCallId)
  return entry.details
}

async function runSubagent(parentSession, toolCallId, params, parentSignal, onUpdate) {
  const profile = await resolveSubagentProfile(parentSession, params?.subagent)
  if (!profile || !profile.enabledAsSubagent) {
    const error = new Error(`Unknown or disabled subagent: ${typeof params?.subagent === 'string' ? params.subagent : params?.subagent?.name || ''}`)
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
  if (!parentSession.projectContext?.workspaceRoot) {
    throw new Error('Subagents require an active workspace.')
  }
  if (!parentSession.model) {
    throw new Error('No active model is configured for the parent session.')
  }

  const timeoutMs = Math.max(1000, Math.min(Number(definition.maxRuntimeMs || SUBAGENT_DEFAULT_TIMEOUT_MS), SUBAGENT_MAX_TIMEOUT_MS))
  definition.capabilityPolicy ||= inferCapabilityPolicy(definition.allowedTools || [])
  definition.allowedTools = applyCapabilityPolicy(definition.allowedTools || [], definition.capabilityPolicy)
  const subagentSessionId = `${parentSession.sessionId}:subagent:${definition.name}:${randomUUID()}`
  const startedAt = Date.now()
  const lifecycleContext = {
    parentSessionId: parentSession.sessionId,
    subagentSessionId,
    toolCallId,
    subagent: definition.name,
    timeoutMs,
  }
  let toolCalls = 0
  let terminalLifecycleLogged = false
  const logLifecycle = (level, lifecycleEvent, extra = {}) => {
    logger[level](`Subagent lifecycle: ${lifecycleEvent}`, {
      lifecycleEvent,
      ...lifecycleContext,
      durationMs: Date.now() - startedAt,
      toolCalls,
      ...extra,
    })
  }
  const logTerminalLifecycle = (level, lifecycleEvent, extra = {}) => {
    if (terminalLifecycleLogged) return
    terminalLifecycleLogged = true
    logLifecycle(level, lifecycleEvent, extra)
  }

  logLifecycle('info', 'started')

  try {
    const { model: subagentModel, info: subagentModelInfo } = await resolveAgentProfileModel(
      definition,
      parentSession.model,
      readStore,
      parentSession.modelAccessContext || {},
    )
    const subagentThinkingLevel = resolveAgentProfileThinkingLevel(definition, parentSession.thinkingLevel, subagentModel)
    let latestMessages = []
    let latestPendingToolCalls = []
    let toolsForClient = []
    let lastTraceAt = 0
    let tracePending = false
    let traceTimer = null

    const tools = await createServerTools(
      parentSession.projectId,
      parentSession.projectContext,
      sessionSkillsContext(parentSession),
      true,
      (toolName) => {
        if (!definition.allowedTools.includes(toolName)) return `Subagent ${definition.name} is not allowed to use ${toolName}.`
        return commandToolPermissionError(parentSession, toolName)
      },
      {
        allowedToolNames: definition.allowedTools,
        includeSubagentTool: false,
        includeMcpTools: false,
      },
    )
    toolsForClient = tools.map(({ execute: _execute, prepareArguments: _prepareArguments, ...tool }) => tool)

    const emitSubagentTrace = () => {
      if (traceTimer) {
        clearTimeout(traceTimer)
        traceTimer = null
      }
      tracePending = false
      lastTraceAt = Date.now()
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
          source: definition.source,
          lifecycle: definition.lifecycle,
          profilePath: definition.filePath,
          capabilityPolicy: definition.capabilityPolicy,
          model: subagentModelInfo,
          durationMs: Date.now() - startedAt,
          messages: Array.isArray(latestMessages) ? latestMessages.slice(-SUBAGENT_TRACE_MESSAGES_LIMIT) : [],
          messagesTotal: Array.isArray(latestMessages) ? latestMessages.length : 0,
          tools: toolsForClient,
          pendingToolCalls: latestPendingToolCalls,
        },
      })
    }

    const emitSubagentTraceThrottled = () => {
      const elapsed = Date.now() - lastTraceAt
      if (elapsed >= SUBAGENT_TRACE_THROTTLE_MS) {
        emitSubagentTrace()
        return
      }
      tracePending = true
      if (traceTimer) return
      traceTimer = setTimeout(() => {
        if (tracePending) emitSubagentTrace()
      }, SUBAGENT_TRACE_THROTTLE_MS - elapsed)
    }

    // 终止类错误（超时/父运行中止）共用的终态 details：与成功终态同构并附
    // timedOut/aborted 标记，经 quickforgeSubagentDetails → stash →
    // afterToolCall 注入错误 toolResult 持久化。
    const buildTerminalSubagentDetails = (extra) => ({
      subagent: definition.name,
      label: definition.label,
      sessionId: subagentSessionId,
      parentSessionId: parentSession.sessionId,
      toolCallId,
      toolCalls,
      allowedTools: definition.allowedTools,
      timeoutMs,
      source: definition.source,
      lifecycle: definition.lifecycle,
      profilePath: definition.filePath,
      capabilityPolicy: definition.capabilityPolicy,
      model: subagentModelInfo,
      durationMs: Date.now() - startedAt,
      messages: latestMessages,
      tools: toolsForClient,
      pendingToolCalls: latestPendingToolCalls,
      ...extra,
    })

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
        model: subagentModel,
        thinkingLevel: subagentThinkingLevel,
        messages: [],
        tools,
      },
      streamFn: (streamModel, streamContext, streamOptions) => streamSimpleWithAiHttpLogging(streamModel, streamContext, {
        ...streamOptions,
        onStreamRetry: (info) => emitSessionEvent(parentSession, { type: 'model_stream_retry', ...info }),
        quickforgeInternalLogContext: lifecycleContext,
      }),
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
        const commandPermissionError = commandToolPermissionError(parentSession, toolName)
        if (commandPermissionError) return { block: true, reason: commandPermissionError }
        if (!hasFullAccess(parentSession)) {
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
      if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end' || event.type === 'message_end') {
        emitSubagentTrace()
      } else {
        emitSubagentTraceThrottled()
      }
    })

    let abortTrigger = null
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      abortTrigger ||= { type: 'timeout', triggeredAt: Date.now() }
      logLifecycle('warn', 'timeout_triggered')
      subagent.abort()
    }, timeoutMs)
    const onParentAbort = () => {
      abortTrigger ||= { type: 'parent_abort', triggeredAt: Date.now() }
      logLifecycle('warn', 'parent_aborted')
      subagent.abort()
    }
    parentSignal?.addEventListener?.('abort', onParentAbort, { once: true })

    try {
      let promptOutcome = 'resolved'
      try {
        await subagent.prompt(userMessage)
      } catch (error) {
        promptOutcome = 'rejected'
        throw error
      } finally {
        if (abortTrigger) {
          logLifecycle('warn', 'settled_after_abort', {
            abortReason: abortTrigger.type,
            waitAfterAbortMs: Date.now() - abortTrigger.triggeredAt,
            outcome: promptOutcome,
          })
        }
      }
      const terminalProgress = { toolCalls, messages: latestMessages, pendingToolCalls: latestPendingToolCalls }
      if (timedOut) {
        const timeoutError = new Error(buildSubagentTimeoutErrorMessage(definition.name, timeoutMs, terminalProgress))
        timeoutError.quickforgeSubagentDetails = buildTerminalSubagentDetails({ timedOut: true })
        throw timeoutError
      }
      if (parentSignal?.aborted) {
        const abortedError = new Error(buildSubagentAbortedErrorMessage(definition.name, terminalProgress))
        abortedError.quickforgeSubagentDetails = buildTerminalSubagentDetails({ aborted: true })
        throw abortedError
      }

      const content = lastAssistantText(subagent.state.messages) || `Subagent ${definition.name} completed without a text response.`
      logTerminalLifecycle('info', 'completed')
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
          source: definition.source,
          lifecycle: definition.lifecycle,
          profilePath: definition.filePath,
          capabilityPolicy: definition.capabilityPolicy,
          model: subagentModelInfo,
          durationMs: Date.now() - startedAt,
          messages: latestMessages,
          tools: toolsForClient,
          pendingToolCalls: latestPendingToolCalls,
        },
      }
    } catch (error) {
      // 其余运行期失败（模型流错误等）统一附带终态 details：错误正文保持上游
      // 原文（前端 stripTerminalErrorFromTrace 依赖 errorMessage 与 trace 终态
      // 错误文本精确相等来去重），过程信息只进 details 供 toolResult 持久化与
      // Inspector 恢复展示；不带 timedOut/aborted 标记，状态由 isError 驱动。
      if (error && typeof error === 'object' && !error.quickforgeSubagentDetails) {
        error.quickforgeSubagentDetails = buildTerminalSubagentDetails({})
      }
      logTerminalLifecycle('warn', 'failed', {
        outcome: timedOut ? 'timeout' : parentSignal?.aborted ? 'parent_aborted' : 'error',
        errorName: error instanceof Error ? error.name : typeof error,
      })
      throw error
    } finally {
      clearTimeout(timeout)
      parentSignal?.removeEventListener?.('abort', onParentAbort)
      emitSubagentTrace()
    }
  } catch (error) {
    logTerminalLifecycle('warn', 'failed', {
      outcome: 'error',
      errorName: error instanceof Error ? error.name : typeof error,
    })
    throw error
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

function textFromMessageContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.filter((block) => block?.type === 'text').map((block) => block.text ?? '').join('\n')
  }
  return ''
}

function applyActiveCapabilityPrompt(messages, capabilityPrompt) {
  if (!capabilityPrompt) return messages

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role !== 'user' && message?.role !== 'user-with-attachments') continue

    const visibleText = textFromMessageContent(message.content)
    const transformed = messages.slice()
    transformed[index] = {
      ...message,
      content: `${capabilityPrompt}\n\nUser request:\n${visibleText}`,
    }
    return transformed
  }

  return messages
}

function activeTurnContextPrompt(session) {
  return [session?.activeTransientContextPrompt, session?.activeCapabilityPrompt]
    .filter((prompt) => typeof prompt === 'string' && prompt.trim())
    .join('\n\n') || null
}

function compactSummaryIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (isCompactSummaryMessage(messages[index])) return index
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
  return applyActiveCapabilityPrompt(
    applyActiveCommandPrompt(compactedContextMessages(transformedMessages), session?.activeCommandPrompt),
    activeTurnContextPrompt(session),
  )
}

export const agentEvents = new EventEmitter()
agentEvents.setMaxListeners(100)

function isIdleRetainedSession(session) {
  return session?.idleRetention === 'always'
}

function resetIdleTimer(session) {
  if (session.idleTimer) clearTimeout(session.idleTimer)
  session.idleTimer = null
  if (isIdleRetainedSession(session)) return

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

function agentProfileSystemPrompt(agentProfile) {
  return agentProfile?.systemPrompt
    ? `\n\n<agent_profile_instructions>\nAgent Profile: ${agentProfile.label || agentProfile.name}\n${agentProfile.systemPrompt}\n</agent_profile_instructions>`
    : ''
}

async function resolvedSessionSystemPrompt(projectId, agentProfile) {
  return `${await buildSystemPrompt(projectId)}${agentProfileSystemPrompt(agentProfile)}`
}

async function refreshMemoryState(session) {
  const memoryEnabled = await isGlobalMemoryEnabled()
  const memoryRevision = memoryEnabled ? await getGlobalMemoryRevision() : null
  if (session.memoryEnabled === memoryEnabled && session.memoryRevision === memoryRevision) return
  session.memoryEnabled = memoryEnabled
  session.memoryRevision = memoryRevision
  if (session.managedSystemPrompt !== false) {
    session.agent.state.systemPrompt = await resolvedSessionSystemPrompt(session.projectId, session.agentProfile)
  }
  await rebuildSessionTools(session)
}

/**
 * Create or retrieve an Agent for a session.
 * If the session already has a running agent, return it.
 * Otherwise, create a new Agent and optionally restore from storage.
 */
export async function createAgent(sessionId, config = {}) {
  const existing = agentSessions.get(sessionId)
  if (existing) {
    if (config.idleRetention !== undefined) existing.idleRetention = config.idleRetention
    resetIdleTimer(existing)
    return existing
  }

  const {
    scope = 'global',
    projectId = null,
    source = null,
    channelId = null,
    channelName = null,
    accessMode: rawAccessMode,
    yoloMode = false,
    model = null,
    modelRef = null,
    modelAccessContext = null,
    resolvePersistedModel = false,
    thinkingLevel = 'off',
    messages = [],
    systemPrompt = null,
    title = 'New chat',
    titleSource = title === 'New chat' ? 'default' : 'manual',
    createdAt = new Date().toISOString(),
    lastModified = null,
    contextCompaction = null,
    harness: rawHarness,
    harnessSessionId = null,
    sourceHarnessSessionId = null,
    openCodeUsage = null,
    agentProfile = null,
    idleRetention = null,
    stateVersion = 0,
    mcpToolsMode = 'await',
  } = config
  const accessMode = normalizeAccessMode(rawAccessMode, yoloMode)
  const resolvedYoloMode = yoloModeFromAccessMode(accessMode)
  const harness = normalizeAgentHarness(rawHarness)
  // 'cached' (restore path) builds MCP tools from the current connection
  // snapshot without waiting for (re)connects; the background refresh and
  // toolset-change subscription converge active sessions afterwards.
  const mcpWaitForConnections = mcpToolsMode !== 'cached'

  // Resolve project context for tool calls. Project conversations resolve to
  // their directory; global conversations (no projectId) and any fallback fall
  // back to a synthetic default workspace context so file tools stay available.
  let projectContext = null
  if (projectId) {
    try {
      projectContext = await projectContextFromId(projectId)
    } catch {
      // project not found — fall back to the default workspace below
    }
  }
  projectContext ??= defaultGlobalWorkspaceContext()

  // Build system prompt and tools only for the native QuickForge runtime.
  const projectConfig = harness === AGENT_HARNESS_QUICKFORGE ? await readProjectConfig() : { projects: [], globalSkills: [] }
  const configuredProject = projectId
    ? projectConfig.projects.find((project) => project.id === projectId)
    : null
  const skillsContext = {
    globalSkillNames: projectConfig.globalSkills,
    projectSkillNames: configuredProject?.skills,
  }
  const profileSystemPrompt = agentProfileSystemPrompt(agentProfile)
  const resolvedSystemPrompt = harness === AGENT_HARNESS_QUICKFORGE
    ? systemPrompt ?? `${await buildSystemPrompt(projectId)}${profileSystemPrompt}`
    : ''
  if (harness === AGENT_HARNESS_OPENCODE && messages.length > 0 && !harnessSessionId && !sourceHarnessSessionId) {
    throw Object.assign(new Error('OpenCode history requires a persisted ACP session ID or an ACP fork source.'), { statusCode: 400 })
  }

  let resolvedAgentProfile = agentProfile

  // OpenCode owns its login, model, tools and context. QuickForge runtime keeps
  // the existing model resolution path unchanged.
  let resolvedModel = model
  let resolvedModelRef = modelRef
  if (!resolvedModel && harness === AGENT_HARNESS_QUICKFORGE) {
    // Try to load the active preference from storage. A stale/hidden implicit
    // preference may fall back, while an explicit session binding never does.
    try {
      const settings = await readStore('settings')
      const raw = settings?.['active-model']
      resolvedModel = await resolveImplicitModelPreference(raw, modelAccessContext || {})
    } catch {
      // ignore
    }
  }
  if (agentProfile?.model?.mode === 'fixed') {
    const profileBinding = await resolveAgentProfileModel(agentProfile, resolvedModel, readStore, modelAccessContext || {})
    resolvedModel = profileBinding.model
    resolvedModelRef = profileBinding.modelRef || null
    resolvedAgentProfile = {
      ...agentProfile,
      model: modelReferenceSnapshot(agentProfile.model),
    }
  }
  if (resolvedAgentProfile && !resolvedModel) throw new Error('No active model is configured for the agent session.')
  const resolvedBinding = harness === AGENT_HARNESS_QUICKFORGE && resolvedModel
    ? (resolvedModelRef
        ? { model: resolvedModel, modelRef: resolvedModelRef }
        : model
          ? { model: resolvedModel, modelRef: null }
          : await modelBindingFromModel(resolvedModel))
    : { model: resolvedModel, modelRef: null }
  resolvedModel = resolvedBinding.model
  const resolvedThinkingLevel = agentProfile
    ? resolveAgentProfileThinkingLevel(agentProfile, thinkingLevel, resolvedModel)
    : thinkingLevel

  // Build native tools only for QuickForge. OpenCode uses its own tools and
  // must not receive QuickForge MCP, Skills, Memory or workspace definitions.
  const profileToolNames = Array.isArray(agentProfile?.allowedTools) ? agentProfile.allowedTools : null
  const tools = harness === AGENT_HARNESS_QUICKFORGE
    ? await createServerTools(
        projectId,
        projectContext,
        skillsContext,
        !!projectContext,
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
              mcpWaitForConnections,
              parentSessionId: sessionId,
              sessionId,
              scope,
            }
          : {
              mcpWaitForConnections,
              parentSessionId: sessionId,
              sessionId,
              scope,
            },
      )
    : []

  // Resolve API key
  const getApiKey = async (provider) => {
    try {
      const keys = await readStore('provider-keys')
      return keys?.[provider] || undefined
    } catch {
      return undefined
    }
  }

  const initialMemoryEnabled = harness === AGENT_HARNESS_QUICKFORGE ? await isGlobalMemoryEnabled() : false
  const initialMemoryRevision = initialMemoryEnabled ? await getGlobalMemoryRevision() : null
  let session
  const agent = harness === AGENT_HARNESS_OPENCODE
    ? await createOpenCodeAcpAgent({
        sessionId,
        cwd: projectContext.workspaceRoot,
        messages,
        harnessSessionId,
        sourceHarnessSessionId,
        restoredUsage: openCodeUsage,
        logger,
        requestPermission: (request) => createAcpApprovalPromise(session, request),
      })
    : new Agent({
    initialState: {
      systemPrompt: resolvedSystemPrompt,
      model: resolvedModel,
      thinkingLevel: resolvedThinkingLevel,
      messages,
      tools,
    },
    streamFn: (streamModel, streamContext, streamOptions) => streamSimpleWithAiHttpLogging(streamModel, streamContext, {
      ...streamOptions,
      onStreamRetry: (info) => emitSessionEvent(session, { type: 'model_stream_retry', ...info }),
    }),
    getApiKey,
    sessionId,
    convertToLlm: serverConvertToLlm,
    onPayload: (payload) => {
      restoreReasoningContentInPayload(payload, session?.lastTransformedContextMessages || agent.state.messages, agent.state.model)
    },
    transformContext: (messages, signal) => transformSessionContext(session, messages, signal),
    afterToolCall: async ({ toolCall, isError }) => {
      if (!isError || toolCall?.name !== 'run_subagent') return undefined
      const details = takeStashedSubagentErrorDetails(toolCall?.id)
      return details ? { details } : undefined
    },
    beforeToolCall: async (context) => {
      const toolName = context.toolCall?.name
      const toolCallId = context.toolCall?.id
      const currentSession = agentSessions.get(sessionId)
      const commandPermissionError = commandToolPermissionError(currentSession, toolName)
      if (commandPermissionError) return { block: true, reason: commandPermissionError }
      const isSkillTool = toolName === 'activate_skill' || toolName === 'read_skill_resource'
      if (isSkillTool) return undefined
      // ask_user only waits for the user's answer, and todo_write only records the latest plan snapshot; neither needs approval.
      if (toolName === 'ask_user' || toolName === 'todo_write') return undefined
      if (profileToolNames && !profileToolNames.includes(toolName)) return { block: true, reason: `Agent profile ${agentProfile.name} is not allowed to use ${toolName}.` }
      if (toolName === 'manage_global_memory') return undefined
      if (toolName === 'run_subagent') {
        const requested = context.args?.subagent
        const policy = requested && typeof requested === 'object' ? normalizeCapabilityPolicy(requested.capabilityPolicy || 'readonly-research', Array.isArray(requested.tools) ? requested.tools : []) : null
        if (policy && ['code-edit', 'docs-edit'].includes(policy) && !hasFullAccess(currentSession)) {
          return { block: true, reason: `Temporary subagent capability policy ${policy} requires full access or approval.` }
        }
        return undefined
      }
      if (isMcpToolName(toolName) || isPluginToolName(toolName)) {
        if (!hasFullAccess(currentSession)) return createApprovalPromise(currentSession, toolCallId, toolName, context.args)
        return undefined
      }
      if (!projectContext?.workspaceRoot) {
        return { block: true, reason: 'No active project. Select a project to use tools.' }
      }
      if (!hasFullAccess(currentSession)) {
        // Default access: safe reads auto-pass, state-changing or external tools require approval
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
    harness,
    harnessSessionId: agent.harnessSessionId || null,
    projectContext,
    projectId,
    source: typeof source === 'string' && source.trim() ? source.trim() : null,
    channelId: typeof channelId === 'string' && channelId.trim() ? channelId.trim() : null,
    channelName: typeof channelName === 'string' && channelName.trim() ? channelName.trim() : null,
    accessMode,
    yoloMode: resolvedYoloMode,
    model: resolvedModel,
    modelRef: resolvedBinding.modelRef,
    modelAccessContext: modelAccessContext || null,
    resolvePersistedModel: resolvePersistedModel === true || Boolean(resolvedBinding.modelRef),
    thinkingLevel: resolvedThinkingLevel,
    scope,
    title,
    titleSource,
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
    activeCapabilityPrompt: null,
    activeTransientContextPrompt: null,
    eventBus,
    idleTimer: null,
    persistTimer: null,
    titleGenerationId: 0,
    titleGenerationPromise: null,
    titleGenerationPromiseId: null,
    sessionCreatedEmitted: messages.length > 0,
    toolTimings: new Map(),
    runtimeToolExecutions: new Map(),
    getApiKey,
    contextCompaction,
    agentProfile: resolvedAgentProfile ? agentProfileSnapshot(resolvedAgentProfile) : null,
    idleRetention,
    lastTransformedContextMessages: null,
    autoCompacting: false,
    stateVersion: Number.isFinite(stateVersion) ? Math.max(0, stateVersion) : 0,
    persistedStateVersion: Number.isFinite(config.persistedStateVersion) ? Math.max(0, config.persistedStateVersion) : null,
    persistedStorageRevision: Number.isFinite(config.persistedStorageRevision) ? Math.max(0, config.persistedStorageRevision) : null,
    persistedStateJson: typeof config.persistedStateJson === 'string' ? config.persistedStateJson : null,
    // F9 split-message bookkeeping: the count and tail-message digest of the
    // last authoritative persist, plus the storage representation marker. Used
    // for split-representation conflict detection and lightweight SSE frames.
    persistedMessageStorage: config.persistedMessageStorage === 'split' ? 'split' : null,
    persistedMessageCount: Number.isInteger(config.persistedMessageCount) && config.persistedMessageCount >= 0 ? config.persistedMessageCount : null,
    persistedTailDigest: typeof config.persistedTailDigest === 'string' ? config.persistedTailDigest : null,
    persistConflictCount: 0,
    // Set when an authoritative persist is skipped after CAS conflicts; cleared
    // on the next successful persist. Surfaced via getSessionState/getSessionStatus
    // so the UI can warn the user instead of silently losing messages.
    persistDegraded: null,
    lastAutoCompactAt: null,
    lastAutoCompactRejected: null,
    memoryEnabled: initialMemoryEnabled,
    memoryRevision: initialMemoryRevision,
    managedSystemPrompt: systemPrompt == null,
    /** Track active SSE connections. Only one SSE stream allowed per session to prevent
     *  connection-pool exhaustion when two browser tabs load the same session. */
    sseConnected: false,
    abortPending: false,
    abortEndEmitted: false,
  }

  // Subscribe to agent lifecycle events and forward to eventBus
  agent.subscribe(async (event) => {
    // The pi-agent-core agent loop emits agent_end with `messages` that only
    // contains messages generated during THIS run (newMessages), not the
    // complete session history.  Replace with the authoritative full state
    // before forwarding to clients.
    const timedEvent = addToolTimingToEvent(session, event)
    updateRuntimeToolExecution(session, timedEvent)
    const eventEndStatus = event.type === 'agent_end'
      ? session.agent.signal?.aborted
        ? 'aborted'
        : session.agent.state.errorMessage
          ? 'error'
          : 'idle'
      : undefined
    if (timedEvent.type === 'agent_end') {
      markLatestAssistantProcessFinished(agent.state.messages)
      // Ensure a failed run is visible in the conversation. Most failures emit
      // an assistant error message through the agent loop (handleRunFailure),
      // but a few paths (e.g. concurrent-run rejection) only set
      // `state.errorMessage`. Append an error message so the user sees the
      // reason at the end of the transcript instead of only a toast.
      const runError = session.agent.state.errorMessage
      if (runError) {
        agent.state.messages = appendAssistantErrorMessageOnce(agent.state.messages, runError, session.model)
      }
    }
    const forwardEvent = timedEvent.type === 'agent_end'
      ? {
          ...timedEvent,
          ...(timedEvent.messages ? { messages: agent.state.messages } : {}),
          status: eventEndStatus,
          ...(session.agent.state.errorMessage && timedEvent.errorMessage === undefined ? { errorMessage: session.agent.state.errorMessage } : {}),
        }
      : timedEvent

    const shouldForwardEvent = !(timedEvent.type === 'agent_end' && session.abortEndEmitted)
    if (shouldForwardEvent) {
      emitSessionEvent(session, forwardEvent)
    }

    // OpenCode runtime usage snapshots are authoritative and lightweight; the
    // debounced write keeps the latest usage durable without blocking the run.
    if (event.type === 'acp_session_usage_update') {
      scheduleSessionPersist(session)
    }

    // Track status
    if (event.type === 'agent_start') {
      session.abortEndEmitted = false
      session.status = 'running'
      session.startedAt = session.startedAt ?? new Date().toISOString()
      session.finishedAt = null
      // Persist running state immediately so a browser refresh still shows the green dot.
      // Brand-new runs have no messages until the first user message_end; persisting
      // here would only trigger the empty-session cleanup path.
      if (session.agent.state.messages.length > 0) {
        persistSession(session).catch((err) =>
          logger.error(`Failed to persist session on start ${sessionId}:`, err, { sessionId }),
        )
      }
    }

    if (event.type === 'agent_end') {
      session.abortPending = false
      session.abortEndEmitted = false
      session.status = eventEndStatus || (session.agent.state.errorMessage ? 'error' : 'idle')
      session.finishedAt = new Date().toISOString()
      session.toolTimings?.clear()
      resetIdleTimer(session)

      // Persist after run ends. Flush any debounced write so the final state is durable.
      flushSessionPersist(session).catch((err) =>
        logger.error(`Failed to persist session ${sessionId}:`, err, { sessionId }),
      )
    }

    if (event.type === 'message_end') {
      const isUserMessage = event.message?.role === 'user' || event.message?.role === 'user-with-attachments'
      const isInitialUserMessage = isUserMessage && (event.isInitialUserMessage === true || session.agent.state.messages.length === 1)
      const requiresDurableCloudMessage = isUserMessage && isManagedCloudModel(session.model) && Boolean(logicalMessageId(event.message))
      if (isInitialUserMessage || requiresDurableCloudMessage) {
        // Persist every managed Cloud user message before the provider stream starts,
        // so its logical ID survives a process restart and resolves to the same private key.
        try {
          const metadata = await flushSessionPersist(session)
          if (metadata && isInitialUserMessage) {
            if (!session.sessionCreatedEmitted) {
              session.sessionCreatedEmitted = true
              emitSessionEvent(session, { type: 'session_created', metadata })
            }
            if (session.harness === AGENT_HARNESS_QUICKFORGE) scheduleSessionTitleGeneration(session, event.message)
          }
        } catch (err) {
          logger.error(`Failed to persist user message for session ${sessionId}:`, err, { sessionId })
        }
      } else {
        // Debounced persist for crash recovery; coalesces the many message_end
        // events within a single run into infrequent full-session writes.
        scheduleSessionPersist(session)
      }
    }
  })

  agentSessions.set(sessionId, session)
  resetIdleTimer(session)
  logger.info(`Created session ${sessionId} (scope: ${scope}, project: ${projectId || 'none'}, access: ${accessMode})`, { sessionId, scope, projectId: projectId || undefined, accessMode, yoloMode: resolvedYoloMode, idleRetention: idleRetention || undefined })
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

// Fields the agent does not own; a concurrent sidebar pin/archive update is the
// only legitimate way these change between the agent's read and its CAS save.
const SESSION_STORAGE_OWNED_STATE_FIELDS = ['pinnedAt', 'archivedAt']

function stripStorageOwnedStateFields(state) {
  const next = { ...state }
  for (const field of SESSION_STORAGE_OWNED_STATE_FIELDS) delete next[field]
  return next
}

/**
 * Split-representation conflict check: does the currently stored session match
 * the message state this session last persisted? Non-split sessions carry
 * messages inline in the body, which the caller already compares via
 * persistedStateJson; split sessions need the row count + tail digest because
 * their body excludes messages.
 */
function storedMessagesMatchLastPersist(session) {
  if (session.persistedMessageStorage !== 'split') return true
  if (session.persistedMessageCount === null) return true
  const stored = storedMessagesState(session.sessionId)
  if (!stored) return true
  return stored.count === session.persistedMessageCount
    && stored.tailDigest === session.persistedTailDigest
}

function canonicalStateJson(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonicalStateJson))
  if (value && typeof value === 'object') {
    return JSON.stringify(
      Object.fromEntries(
        Object.keys(value).sort()
          .filter((key) => value[key] !== undefined)
          .map((key) => [key, canonicalStateJson(value[key])]),
      ),
    )
  }
  return JSON.stringify(value)
}

/**
 * Mark the session as persist-degraded (an authoritative persist was skipped
 * after CAS conflicts) and notify connected clients so the UI can surface a
 * non-blocking warning instead of silently losing messages.
 */
function markPersistDegraded(session, attempts) {
  session.persistDegraded = { at: new Date().toISOString(), attempts }
  emitSessionEvent(session, { type: 'persist_degraded', persistDegraded: true })
}

/**
 * Clear the degraded marker after a successful persist and notify clients so
 * the UI warning disappears.
 */
function clearPersistDegraded(session) {
  if (!session.persistDegraded) return
  session.persistDegraded = null
  emitSessionEvent(session, { type: 'persist_degraded', persistDegraded: false })
}

/**
 * Persist a full session record in one authoritative SQLite transaction with
 * revision CAS. When the CAS fails because a concurrent metadata-only change
 * (pin/archive via the sidebar) bumped the revision, re-read the current row
 * and verify the only difference from what this session last persisted is
 * storage-owned fields; then merge and retry (bounded). If the storage row
 * changed in agent-owned fields, record the conflict and refuse to overwrite
 * the other writer — never fake success by clobbering it.
 * @returns {{state: object, metadata: object, revision: number, stateVersion: number} | null}
 */
async function persistAuthoritativeSessionState(session, sessionData, metadata) {
  const sessionId = session.sessionId
  const maxAttempts = 3
  let lastConflict = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const existing = readSessionStateRecord(sessionId)
    const existingMetadata = existing?.metadata
    const mergedMetadata = {
      ...existingMetadata,
      ...metadata,
      ...(existingMetadata?.archivedAt ? { archivedAt: existingMetadata.archivedAt } : {}),
      ...(existingMetadata?.pinnedAt ? { pinnedAt: existingMetadata.pinnedAt } : {}),
    }
    const persistedState = {
      ...(existing?.state || {}),
      ...sessionData,
      ...(mergedMetadata.archivedAt ? { archivedAt: mergedMetadata.archivedAt } : {}),
      ...(mergedMetadata.pinnedAt ? { pinnedAt: mergedMetadata.pinnedAt } : {}),
    }
    try {
      const saved = await saveSessionStatePair({
        state: persistedState,
        metadata: mergedMetadata,
        expectedRevision: session.persistedStorageRevision ?? existing?.revision ?? 0,
      })
      session.persistedStateJson = canonicalStateJson(stripStorageOwnedStateFields(saved.state))
      // F9 split bookkeeping: the savePair plan tells us exactly which
      // representation was written, so the conflict-detection counters stay in
      // sync with the stored rows (append/replace/body-only on split sessions,
      // inline on small sessions).
      if (saved.state?.messageStorage === 'split') {
        session.persistedMessageStorage = 'split'
        session.persistedMessageCount = saved.messageCount ?? sessionData.messages?.length ?? 0
      } else {
        session.persistedMessageStorage = null
        session.persistedMessageCount = Array.isArray(sessionData.messages) ? sessionData.messages.length : 0
      }
      session.persistedTailDigest = sessionMessagesTailDigest(sessionData.messages)
      clearPersistDegraded(session)
      return { ...saved, metadata: mergedMetadata }
    } catch (error) {
      if (error?.errorCode !== 'SESSION_STATE_CONFLICT') throw error
      lastConflict = error
      const current = readSessionStateRecord(sessionId)
      if (!current) return null
      const previous = session.persistedStateJson
      const bodyUnchanged = previous !== null && canonicalStateJson(stripStorageOwnedStateFields(current.state)) === previous
      // Split sessions keep messages out of the body, so the body comparison
      // alone would miss concurrent message writes. Compare the stored rows
      // (count + tail digest) against what this session last persisted.
      const messagesUnchanged = storedMessagesMatchLastPersist(session)
      if (bodyUnchanged && messagesUnchanged) {
        // Only storage-owned fields changed — adopt the storage row as the new
        // baseline and retry with the fresh revision.
        session.persistedStorageRevision = current.revision
        session.persistedStateVersion = current.stateVersion
        continue
      }
      session.persistConflictCount += 1
      logger.warn(`Session ${sessionId} persist conflict: storage changed agent-owned fields; skipping overwrite`, { sessionId })
      markPersistDegraded(session, attempt)
      return null
    }
  }
  session.persistConflictCount += 1
  logger.warn(`Session ${sessionId} persist still conflicting after ${maxAttempts} merge retries`, { sessionId, reason: lastConflict?.message })
  markPersistDegraded(session, maxAttempts)
  return null
}

/**
 * Persist session data to storage.
 */
async function persistSessionUnlocked(session) {
  const { sessionId, agent, harness, harnessSessionId, scope, projectId, source, channelId, channelName, title, titleSource, createdAt, lastModified: storedLastModified, status, startedAt, finishedAt, model, modelRef, thinkingLevel, accessMode, yoloMode, contextCompaction } = session
  const messages = agent.state.messages

  if (messages.length === 0) {
    try {
      deleteSessionState(sessionId, { expectedRevision: session.persistedStorageRevision })
      session.persistedStorageRevision = null
      session.persistedStateVersion = null
      session.persistedStateJson = null
      session.persistedMessageStorage = null
      session.persistedMessageCount = null
      session.persistedTailDigest = null
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
    titleSource,
    harness,
    harnessSessionId: agent.harnessSessionId || harnessSessionId || undefined,
    openCodeUsage: harness === AGENT_HARNESS_OPENCODE && agent.state.acpSession?.usage ? agent.state.acpSession.usage : undefined,
    model,
    modelRef: modelRef || undefined,
    thinkingLevel,
    accessMode,
    yoloMode,
    messages,
    createdAt: createdAt || now,
    lastModified,
    scope,
    projectId: scope === 'project' ? projectId : undefined,
    source: source || undefined,
    channelId: channelId || undefined,
    channelName: channelName || undefined,
    taskStatus: status,
    taskStartedAt: startedAt,
    taskFinishedAt: finishedAt,
    contextCompaction: contextCompaction || undefined,
    idleRetention: session.idleRetention || undefined,
    stateVersion: Number.isFinite(session.stateVersion) ? session.stateVersion : 0,
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
    titleSource,
    createdAt: createdAt || now,
    lastModified,
    messageCount: messages.length,
    stateVersion: session.stateVersion || 0,
    usage,
    thinkingLevel,
    harness,
    harnessSessionId: agent.harnessSessionId || harnessSessionId || undefined,
    accessMode,
    yoloMode,
    preview,
    scope,
    projectId: scope === 'project' ? projectId : undefined,
    source: source || undefined,
    channelId: channelId || undefined,
    channelName: channelName || undefined,
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
    idleRetention: session.idleRetention || undefined,
  }

  // Write body + metadata as one authoritative SQLite transaction.
  let persistedMetadata
  try {
    const saved = await persistAuthoritativeSessionState(session, sessionData, metadata)
    if (!saved) return null
    session.persistedStorageRevision = saved.revision
    session.persistedStateVersion = saved.stateVersion
    persistedMetadata = saved.metadata
  } catch (err) {
    logger.error(`Failed to persist session ${sessionId}:`, err, { sessionId })
    return null
  }

  if (source === 'acp' && channelId && persistedMetadata) {
    void publishChannelSessionChanged({
      channelId,
      channelName: channelName || undefined,
      sessionId,
      projectId: scope === 'project' ? projectId : null,
      workspace: scope === 'project'
        ? { id: projectId, kind: 'project' }
        : { id: 'default', kind: 'default' },
      change: 'upsert',
      metadata: persistedMetadata,
    })
  }

  return persistedMetadata || metadata
}

// Persist slower than this (queue wait + encode + synchronous SQLite write)
// is worth a warning: large sessions write big synchronous transactions that
// stall the event loop and make every in-flight request (including /restore)
// wait. The 200ms threshold surfaces the real-world distribution, not just
// the extreme tail, so persist optimizations stay measurable.
const SLOW_PERSIST_LOG_MS = 200

async function persistSession(session) {
  const startedAt = performance.now()
  // Serialize per session (per-row revision CAS guarantees correctness);
  // cross-session persists run independently instead of piling onto one
  // global chain that also gates destroyAgent.
  const lockKey = `session:${session.sessionId}`
  const result = await withSessionPersistenceLock(() => persistSessionUnlocked(session), lockKey)
  const durationMs = performance.now() - startedAt
  if (durationMs >= SLOW_PERSIST_LOG_MS) {
    logger.warn(`Session ${session.sessionId} persist took ${Math.round(durationMs)}ms (queue wait + write)`, {
      sessionId: session.sessionId,
      durationMs: Math.round(durationMs),
      messageCount: session.agent?.state?.messages?.length ?? 0,
    })
  }
  return result
}

export async function persistSessionState(session) {
  await flushSessionPersist(session)
}

/**
 * Coalesce fire-and-forget session persists during a run.
 *
 * persistSession() serializes the ENTIRE session (all messages) on every call,
 * and the agent event loop calls it on agent_start / each message_end / agent_end.
 * Within a single run these events fire many times (one per assistant turn +
 * tool result), so writing on each one makes cumulative disk I/O O(n^2) as a
 * conversation grows. These message_end call sites are fire-and-forget
 * (crash-recovery only), so we debounce them into at most one write per
 * PERSIST_DEBOUNCE_MS. Run boundaries (agent_end) and explicit persists cancel
 * the pending timer and write the current state immediately, so the final
 * state is always durable.
 */
const PERSIST_DEBOUNCE_MS = 400

function scheduleSessionPersist(session) {
  if (session.persistTimer) return
  session.persistTimer = setTimeout(() => {
    session.persistTimer = null
    persistSession(session).catch((err) =>
      logger.error(`Failed to persist session ${session.sessionId}:`, err, { sessionId: session.sessionId }),
    )
  }, PERSIST_DEBOUNCE_MS).unref?.()
}

/**
 * Cancel any pending debounced write and persist the current state immediately.
 * Used at run boundaries (agent_end) and by explicit persistSessionState() so
 * the final state is always durable regardless of a pending timer.
 */
async function flushSessionPersist(session) {
  if (session.persistTimer) {
    clearTimeout(session.persistTimer)
    session.persistTimer = null
  }
  return persistSession(session)
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
    throw Object.assign(new Error('Generation is still running. Stop it or wait until it finishes before rolling back.'), {
      statusCode: 409,
      errorCode: 'GENERATION_STILL_RUNNING_BEFORE_ROLLBACK',
    })
  }
  if (session.harness === AGENT_HARNESS_OPENCODE) {
    throw Object.assign(new Error('OpenCode does not support rollback from a message position. This action is unavailable for OpenCode conversations.'), { statusCode: 409 })
  }

  const messages = Array.isArray(session.agent.state.messages) ? session.agent.state.messages : []
  const rollbackIndex = rollbackStartIndexFromMessage(messages, rollbackMessageIndex)
  if (rollbackIndex < 0) {
    throw Object.assign(new Error('There is no conversation turn to roll back.'), { statusCode: 400 })
  }

  const nextMessages = messages.slice(0, rollbackIndex)
  updateSessionMessages(session, nextMessages)
  const compactedUpToIndex = Number(session.contextCompaction?.compactedUpToIndex) || 0
  if (rollbackIndex < compactedUpToIndex) {
    // 撤回越过压缩点，摘要覆盖的历史被截断，压缩失效
    resetSessionCompaction(session)
  } else {
    // 撤回发生在压缩点之后，摘要仍然有效，保留压缩上下文
    session.lastTransformedContextMessages = null
  }
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

export function canApplyGeneratedTitle(session, generationId, expectedTitle) {
  return session.titleGenerationId === generationId
    && session.titleSource === 'fallback'
    && session.title === expectedTitle
}

function scheduleSessionTitleGeneration(session, userMessage) {
  if (session.titleSource !== 'fallback') return
  if (session.titleGenerationPromise && session.titleGenerationPromiseId === session.titleGenerationId) return
  const generationId = ++session.titleGenerationId
  const expectedTitle = session.title
  const promise = generateAiTitle([userMessage], session.model, session.thinkingLevel, session.getApiKey)
    .then(async (aiTitle) => {
      if (!aiTitle || aiTitle === 'New chat') return
      if (!canApplyGeneratedTitle(session, generationId, expectedTitle)) return
      session.title = aiTitle
      session.titleSource = 'ai'
      await persistSession(session)
      emitSessionEvent(session, { type: 'title_updated', title: aiTitle, titleSource: 'ai' })
    })
    .catch((err) => {
      logger.warn(`Title generation failed for session ${session.sessionId}:`, err.message || err, { sessionId: session.sessionId })
    })
    .finally(() => {
      if (session.titleGenerationPromise === promise) {
        session.titleGenerationPromise = null
        session.titleGenerationPromiseId = null
      }
    })
  session.titleGenerationPromise = promise
  session.titleGenerationPromiseId = generationId
}

async function refreshSessionModelBinding(session) {
  if (!session?.model || (!session.modelRef && session.resolvePersistedModel !== true)) return session
  const binding = await resolveModelBinding(
    session.modelRef ? { modelRef: session.modelRef } : { model: session.model },
    {
      context: session.modelAccessContext || {},
      currentModel: session.model,
      allowCurrentHidden: true,
      forExecution: true,
      legacySnapshot: session.model,
    },
  )
  session.model = binding.model
  session.modelRef = binding.modelRef
  session.resolvePersistedModel = true
  session.agent.state.model = binding.model
  return session
}

/**
 * Send a user message to the agent and start the agent loop.
 * Returns immediately; events are streamed via the event bus.
 */
export async function runPrompt(sessionId, message, selectedCapabilities = [], promptCommand = null, transientContextPrompt = null, modelAccessContext = null, contextReferences = undefined) {
  let session = await syncSessionFromStorage(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  if (session.agent.state.isStreaming || session.abortPending) {
    throw Object.assign(new Error('Generation is still running. Stop it or wait until it finishes.'), {
      statusCode: 409,
      errorCode: 'GENERATION_ALREADY_RUNNING',
    })
  }

  // Validate references before model refresh, memory refresh, idle timers, title,
  // message persistence, or agent_start side effects.
  const initialUserMessage = typeof message === 'string'
    ? { role: 'user', content: message, timestamp: new Date().toISOString() }
    : message
  const canonicalContextReferences = await validatePromptContextReferences(contextReferences, session)
  const canonicalSelectedCapabilities = normalizeSelectedCapabilities(selectedCapabilities)
  const canonicalInitialUserMessage = withCanonicalSelectedCapabilities(
    withCanonicalContextReferences(initialUserMessage, canonicalContextReferences),
    canonicalSelectedCapabilities,
  )

  if (modelAccessContext) session.modelAccessContext = modelAccessContext
  if (session.harness === AGENT_HARNESS_QUICKFORGE) await refreshSessionModelBinding(session)
  if (session.harness === AGENT_HARNESS_QUICKFORGE) await refreshMemoryState(session)
  resetIdleTimer(session)

  const commandState = session.harness === AGENT_HARNESS_QUICKFORGE
    ? await resolveCommandState(session, canonicalInitialUserMessage, promptCommand)
    : { userMessage: canonicalInitialUserMessage }
  const resolvedUserMessage = commandState.userMessage ?? canonicalInitialUserMessage

  if (session.harness === AGENT_HARNESS_OPENCODE) {
    session.agent.validatePrompt(resolvedUserMessage)
  }

  if (commandState.textResponse) {
    session.agent.state.messages = [
      ...session.agent.state.messages,
      canonicalInitialUserMessage,
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

  if (commandState.summary) {
    return summarySession(session, canonicalInitialUserMessage, commandState.summary)
  }

  if (commandState.compact) {
    return compactSession(session, canonicalInitialUserMessage, commandState.compact)
  }

  const userMessage = session.harness === AGENT_HARNESS_QUICKFORGE
    ? prepareCloudUserMessage(session, resolvedUserMessage)
    : resolvedUserMessage

  // Set a meaningful fallback immediately. The AI title request starts only
  // after the first user message has been persisted by the message_end handler.
  if (session.titleSource === 'default' && session.title === 'New chat') {
    const simpleTitle = generateTitle([userMessage])
    session.titleSource = 'fallback'
    if (simpleTitle !== 'New chat') {
      session.title = simpleTitle
    }
  }

  session.activeCommandName = commandState.commandName ?? null
  session.activeCommandPermissions = commandState.permissions ?? null
  session.activeCommandPrompt = commandState.commandPrompt ?? null
  session.activeCapabilityPrompt = selectedCapabilityPrompt(canonicalSelectedCapabilities)
  const referencePrompt = contextReferencesPrompt(canonicalContextReferences)
  session.activeTransientContextPrompt = [
    typeof transientContextPrompt === 'string' && transientContextPrompt.trim() ? transientContextPrompt : null,
    referencePrompt,
  ].filter(Boolean).join('\n\n') || null

  // Fire and forget — events come through eventBus
  session.agent.prompt(userMessage).catch((err) => {
    logger.error(`Agent prompt error for session ${sessionId}:`, err, { sessionId })
    if (session.harness === AGENT_HARNESS_OPENCODE) return
    const errorMessage = err.message || 'Unknown error'
    // Surface the failure at the end of the conversation itself so the user
    // sees the reason in the transcript, not only via toast/notification.
    session.agent.state.messages = appendAssistantErrorMessageOnce(
      session.agent.state.messages,
      errorMessage,
      session.model,
    )
    session.agent.state.errorMessage = errorMessage
    session.agent.state.isStreaming = false
    session.status = 'error'
    session.finishedAt = new Date().toISOString()
    const messages = session.agent.state.messages
    emitSessionEvent(session, { type: 'message_end', messages })
    emitSessionEvent(session, { type: 'error', error: errorMessage })
    emitSessionEvent(session, { type: 'agent_end', messages, errorMessage, status: 'error' })
    flushSessionPersist(session).catch((persistErr) =>
      logger.error(`Failed to persist session ${sessionId} after prompt error:`, persistErr, { sessionId }),
    )
  }).finally(() => {
    session.activeCommandName = null
    session.activeCommandPermissions = null
    session.activeCommandPrompt = null
    session.activeCapabilityPrompt = null
    session.activeTransientContextPrompt = null
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
export async function continueSession(sessionId, modelAccessContext = null) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  if (session.agent.state.isStreaming) {
    throw Object.assign(new Error('Generation is still running. Stop it or wait until it finishes.'), {
      statusCode: 409,
      errorCode: 'GENERATION_ALREADY_RUNNING',
    })
  }
  if (session.harness === AGENT_HARNESS_OPENCODE) {
    throw Object.assign(new Error('OpenCode does not support retry from a message position. This action is unavailable for OpenCode conversations.'), { statusCode: 409 })
  }
  if (modelAccessContext) session.modelAccessContext = modelAccessContext
  await refreshSessionModelBinding(session)

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

  const lastUserMessage = messages[lastUserIndex]
  const canonicalContextReferences = await validateContextReferences(contextReferencesFromMessage(lastUserMessage), session)
  const canonicalSelectedCapabilities = normalizeSelectedCapabilities(selectedCapabilitiesFromMessage(lastUserMessage))
  const canonicalLastUserMessage = withCanonicalSelectedCapabilities(
    withCanonicalContextReferences(lastUserMessage, canonicalContextReferences),
    canonicalSelectedCapabilities,
  )
  const commandState = await resolveCommandState(session, canonicalLastUserMessage)
  const continuedUserMessage = prepareCloudUserMessage(session, commandState.userMessage ?? canonicalLastUserMessage)
  const trimmedMessages = messages.slice(0, lastUserIndex).concat(continuedUserMessage)
  updateSessionMessages(session, trimmedMessages)
  const compactedUpToIndex = Number(session.contextCompaction?.compactedUpToIndex) || 0
  if (lastUserIndex < compactedUpToIndex) {
    // 重试点越过压缩点，摘要覆盖的历史被截断，压缩失效
    resetSessionCompaction(session)
  } else {
    // 重试点位于压缩点之后，摘要仍然有效，保留压缩上下文
    session.lastTransformedContextMessages = null
  }
  if (isManagedCloudModel(session.model) && logicalMessageId(continuedUserMessage)) {
    await flushSessionPersist(session)
  }

  resetIdleTimer(session)
  session.activeCommandName = commandState.commandName ?? null
  session.activeCommandPermissions = commandState.permissions ?? null
  session.activeCommandPrompt = commandState.commandPrompt ?? null
  session.activeCapabilityPrompt = selectedCapabilityPrompt(canonicalSelectedCapabilities)
  session.activeTransientContextPrompt = contextReferencesPrompt(canonicalContextReferences)

  session.agent.continue().catch((err) => {
    logger.error(`Agent continue error for session ${sessionId}:`, err, { sessionId })
    emitSessionEvent(session, { type: 'error', error: err.message || 'Unknown error' })
  }).finally(() => {
    session.activeCommandName = null
    session.activeCommandPermissions = null
    session.activeCommandPrompt = null
    session.activeCapabilityPrompt = null
    session.activeTransientContextPrompt = null
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
  for (const [_toolCallId, approval] of pendingApprovals) {
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
  let idleWaitTimer
  const becameIdle = await Promise.race([
    session.agent.waitForIdle().then(() => true),
    new Promise((resolve) => {
      idleWaitTimer = setTimeout(() => resolve(false), ABORT_IDLE_WAIT_TIMEOUT_MS)
      idleWaitTimer.unref?.()
    }),
  ])
  clearTimeout(idleWaitTimer)
  if (!becameIdle) {
    session.abortPending = true
    logger.warn(`Agent ${sessionId} did not become idle within ${ABORT_IDLE_WAIT_TIMEOUT_MS}ms after abort`, { sessionId })
  }

  if (session.status === 'running') {
    session.status = 'aborted'
    session.finishedAt = new Date().toISOString()
    persistSession(session).catch((err) =>
      logger.error(`Failed to persist aborted session ${sessionId}:`, err, { sessionId }),
    )
    session.abortEndEmitted = true
    const event = {
      type: 'agent_end',
      status: 'aborted',
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

  const agentMessage = prepareCloudUserMessage(session, typeof message === 'string'
    ? { role: 'user', content: message, timestamp: Date.now() }
    : message)

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

  const agentMessage = prepareCloudUserMessage(session, typeof message === 'string'
    ? { role: 'user', content: message, timestamp: Date.now() }
    : message)

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

function storedMessagesExtendLocalHistory(localMessages, storedMessages) {
  if (!Array.isArray(localMessages) || !Array.isArray(storedMessages) || storedMessages.length <= localMessages.length) return false
  return localMessages.every((message, index) => {
    const local = { ...message }
    const stored = { ...storedMessages[index] }
    delete local.processFinishedAt
    delete stored.processFinishedAt
    return JSON.stringify(local) === JSON.stringify(stored)
  })
}

export async function syncSessionFromStorage(sessionId) {
  let session = agentSessions.get(sessionId)
  if (!session) return restoreAgent(sessionId)
  if (session.agent.state.isStreaming) return session

  try {
    const stored = await readSessionValue(sessionId)
    if (!stored || !Array.isArray(stored.messages)) return session

    const localMessages = Array.isArray(session.agent.state.messages) ? session.agent.state.messages : []
    const storedStateVersion = Number.isFinite(stored.stateVersion) ? stored.stateVersion : 0
    const localStateVersion = Number.isFinite(session.stateVersion) ? session.stateVersion : 0
    const storedLastModified = Date.parse(stored.lastModified || '')
    const localLastModified = Date.parse(session.lastModified || '')
    const hasNewerVersion = storedStateVersion > localStateVersion
    const storedExtendsLocalHistory = storedMessagesExtendLocalHistory(localMessages, stored.messages)
    const hasMoreMessages = storedExtendsLocalHistory
    const hasNewerActivityAtSameVersion = storedStateVersion === localStateVersion
      && stored.messages.length === localMessages.length
      && Number.isFinite(storedLastModified)
      && (!Number.isFinite(localLastModified) || storedLastModified > localLastModified)

    if (!hasNewerVersion && !hasMoreMessages && !hasNewerActivityAtSameVersion) return session

    session.agent.state.messages = stored.messages
    session.title = stored.title || session.title
    session.titleSource = stored.titleSource || session.titleSource
    session.source = stored.source || session.source
    session.channelId = stored.channelId || session.channelId
    session.channelName = stored.channelName || session.channelName
    session.lastModified = stored.lastModified || session.lastModified
    session.status = stored.taskStatus || 'idle'
    session.startedAt = stored.taskStartedAt || null
    session.finishedAt = stored.taskFinishedAt || null
    session.contextCompaction = stored.contextCompaction || null
    session.stateVersion = Math.max(localStateVersion, storedStateVersion)
    session.runtimeToolExecutions?.clear()
    resetIdleTimer(session)
    return session
  } catch (error) {
    logger.warn(`Failed to sync session ${sessionId} from storage:`, error?.message || error, { sessionId })
    return session
  }
}

/**
 * Get the current state of a session (for page refresh recovery).
 */
export function getSessionState(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session) return null

  const messages = messagesWithRuntimeToolExecutions(session)
  return {
    sessionId: session.sessionId,
    scope: session.scope,
    projectId: session.projectId,
    source: session.source || undefined,
    channelId: session.channelId || undefined,
    channelName: session.channelName || undefined,
    harness: session.harness,
    harnessSessionId: session.agent.harnessSessionId || session.harnessSessionId || undefined,
    accessMode: session.accessMode,
    yoloMode: session.yoloMode,
    systemPrompt: session.agent.state.systemPrompt,
    model: session.model,
    modelRef: session.modelRef || undefined,
    thinkingLevel: session.thinkingLevel,
    title: session.title,
    titleSource: session.titleSource,
    createdAt: session.createdAt,
    lastModified: session.lastModified,
    stateVersion: session.stateVersion || 0,
    messageStorage: session.persistedMessageStorage === 'split' ? 'split' : undefined,
    status: session.status,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    tools: session.agent.state.tools,
    messages,
    pendingToolCalls: runtimePendingToolCalls(session),
    contextCompaction: session.contextCompaction,
    contextUsage: getSessionContextUsage(session),
    pendingToolApproval: getPendingApprovalForSession(session.sessionId),
    pendingAutoCompactApproval: getPendingAutoCompactApprovalForSession(session.sessionId),
    pendingAsk: getPendingAskForSession(session.sessionId),
    acpSession: session.harness === AGENT_HARNESS_OPENCODE ? session.agent.state.acpSession : undefined,
    isStreaming: session.abortPending ? false : session.agent.state.isStreaming,
    errorMessage: session.agent.state.errorMessage,
    persistDegraded: session.persistDegraded ? true : undefined,
  }
}

/**
 * Get a lightweight status snapshot for SSE-first state recovery.
 */
export function getSessionStatus(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session) return null

  const messages = session.agent.state.messages || []
  const lastMessage = messages[messages.length - 1]
  return {
    sessionId: session.sessionId,
    scope: session.scope,
    projectId: session.projectId,
    harness: session.harness,
    harnessSessionId: session.agent.harnessSessionId || session.harnessSessionId || undefined,
    source: session.source || undefined,
    channelId: session.channelId || undefined,
    channelName: session.channelName || undefined,
    title: session.title,
    createdAt: session.createdAt,
    lastModified: session.lastModified,
    stateVersion: session.stateVersion || 0,
    status: session.status,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    isStreaming: session.abortPending ? false : session.agent.state.isStreaming,
    errorMessage: session.agent.state.errorMessage,
    messageCount: messages.length,
    lastMessageTimestamp: lastMessage?.timestamp ?? null,
    persistDegraded: session.persistDegraded ? true : undefined,
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
 * Count sessions with a live SSE connection — the background-migration idle
 * signal's "no active stream" input
 * (docs/architecture/session-storage-background-migration-design.zh-CN.md
 * §3.3). Derived from the per-session sseConnected flags the SSE route
 * already maintains, so no extra bookkeeping is required.
 */
export function countActiveSseStreams() {
  let count = 0
  for (const session of agentSessions.values()) {
    if (session.sseConnected) count += 1
  }
  return count
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
  if (session.persistTimer) {
    clearTimeout(session.persistTimer)
    session.persistTimer = null
  }
  session.toolTimings?.clear()

  try {
    session.agent.abort()
    if (session.harness === AGENT_HARNESS_OPENCODE) await session.agent.dispose?.()
  } catch {
    // ignore
  }

  // Clean up any pending approvals for this session before removing it.
  for (const [_toolCallId, approval] of pendingApprovals) {
    if (approval.sessionId === sessionId) approval.reject(new Error('Session destroyed'))
  }
  for (const [_approvalId, approval] of pendingAutoCompactApprovals) {
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

// In-flight restores keyed by sessionId. Concurrent route handlers
// (POST /restore, GET /state, GET /messages, GET /status, SSE) all fall back
// to restoreAgent; without dedupe each raced through createAgent and the last
// agentSessions.set overwrote the others, leaking the overwritten sessions
// (listeners, idle/persist timers, OpenCode child processes) forever.
const pendingRestores = new Map()

/**
 * Try to restore an agent session from persisted storage.
 * Concurrent calls for the same session share one in-flight restore.
 * Returns the restored session, or null if not found.
 */
export function restoreAgent(sessionId) {
  const existing = agentSessions.get(sessionId)
  if (existing) return existing

  const inFlight = pendingRestores.get(sessionId)
  if (inFlight) return inFlight

  const restorePromise = restoreAgentUnlocked(sessionId).finally(() => {
    pendingRestores.delete(sessionId)
  })
  pendingRestores.set(sessionId, restorePromise)
  return restorePromise
}

async function restoreAgentUnlocked(sessionId) {
  try {
    const sessionData = await readSessionValue(sessionId)
    if (!sessionData) {
      logger.warn(`Cannot restore session ${sessionId}: no stored data found`, { sessionId })
      return null
    }

    logger.info(`Restoring session ${sessionId} from storage (scope: ${sessionData.scope}, messages: ${sessionData.messages?.length ?? 0})`, { sessionId, scope: sessionData.scope, messageCount: sessionData.messages?.length ?? 0 })

    // Read the authoritative storage record once: the body (split marker),
    // revision for CAS, and the stored message rows (count + tail digest) used
    // for split-representation conflict detection after restore.
    const record = readSessionStateRecord(sessionId)
    const storedMessages = record?.state?.messageStorage === 'split'
      ? storedMessagesState(sessionId)
      : null

    return await createAgent(sessionId, {
      scope: sessionData.scope || 'global',
      projectId: sessionData.projectId || null,
      source: sessionData.source || null,
      channelId: sessionData.channelId || null,
      channelName: sessionData.channelName || null,
      accessMode: normalizeAccessMode(sessionData.accessMode, sessionData.yoloMode),
      yoloMode: sessionData.yoloMode || false,
      model: sessionData.model,
      modelRef: sessionData.modelRef || null,
      resolvePersistedModel: true,
      // Restore must not block on MCP (re)connects: build tools from the
      // current snapshot; background refresh + toolset notification converge.
      mcpToolsMode: 'cached',
      thinkingLevel: sessionData.thinkingLevel || 'off',
      messages: sessionData.messages || [],
      title: sessionData.title || 'New chat',
      titleSource: sessionData.titleSource || (sessionData.title && sessionData.title !== 'New chat' ? 'ai' : 'default'),
      createdAt: sessionData.createdAt,
      lastModified: sessionData.lastModified,
      contextCompaction: sessionData.contextCompaction || null,
      harness: normalizeAgentHarness(sessionData.harness),
      harnessSessionId: typeof sessionData.harnessSessionId === 'string' ? sessionData.harnessSessionId : null,
      openCodeUsage: sessionData.openCodeUsage || null,
      idleRetention: sessionData.idleRetention || null,
      stateVersion: sessionData.stateVersion,
      persistedStateVersion: sessionData.stateVersion,
      persistedStorageRevision: record?.revision ?? null,
      persistedStateJson: canonicalStateJson(stripStorageOwnedStateFields(record?.state || {})),
      persistedMessageStorage: record?.state?.messageStorage === 'split' ? 'split' : null,
      persistedMessageCount: storedMessages?.count ?? (Array.isArray(sessionData.messages) ? sessionData.messages.length : 0),
      persistedTailDigest: storedMessages?.tailDigest || sessionMessagesTailDigest(sessionData.messages),
    })
  } catch (err) {
    logger.error(`Failed to restore agent ${sessionId}:`, err, { sessionId })
    if (err?.statusCode === 503 || err?.errorCode === 'OPENCODE_UNAVAILABLE') throw err
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

/**
 * Resolve a pending ask_user call with the user's answers (or a skip).
 * `answers` is an array aligned with the ask's questions:
 * `[{ choices: string[], custom?: string }]`.
 */
export function answerAsk(sessionId, askId, { answers, skipped = false } = {}) {
  const ask = pendingAsks.get(askId)
  if (!ask || ask.sessionId !== sessionId) {
    throw Object.assign(new Error('No pending ask for this session'), { statusCode: 404 })
  }
  const normalizedAnswers = (Array.isArray(answers) ? answers : []).slice(0, ask.questions.length).map((answer) => ({
    choices: (Array.isArray(answer?.choices) ? answer.choices : [])
      .filter((choice) => typeof choice === 'string')
      .map((choice) => choice.slice(0, 500))
      .slice(0, 8),
    ...(typeof answer?.custom === 'string' && answer.custom.trim()
      ? { custom: answer.custom.slice(0, 4000) }
      : {}),
  }))
  if (skipped) ask.finish({ skipped: true })
  else ask.finish({ answers: normalizedAnswers })
  return { answered: true, askId, skipped: !!skipped }
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
      harness: session.harness,
      harnessSessionId: session.agent.harnessSessionId || session.harnessSessionId || undefined,
      source: session.source || undefined,
      channelId: session.channelId || undefined,
      channelName: session.channelName || undefined,
      idleRetention: session.idleRetention || undefined,
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

// MCP toolset changes (background reconnects, startup warmup) rebuild tools
// for all active sessions so restored sessions that took a cached MCP tool
// snapshot converge without ever blocking POST /restore. refreshAllSessionTools
// rebuilds via the default await path — with servers already connected it only
// reuses connections, and an unchanged toolset signature does not notify
// again, so this never loops. registry.mjs never imports agent-manager.mjs
// (no circular dependency).
subscribeMcpToolsetChanged(() => {
  if (agentSessions.size === 0) return
  refreshAllSessionTools().catch((error) => {
    logger.warn(`Failed to refresh session tools after MCP toolset change: ${error?.message || error}`)
  })
})

/**
 * Refresh the model binding of every active QuickForge session after model
 * configuration changes (custom providers, maxTokens, ...). OpenCode owns its
 * model selection and streaming sessions are skipped (runPrompt re-resolves
 * the binding on the next message). Only sessions whose model actually
 * changed get a state event.
 */
export async function refreshAllSessionModels() {
  for (const [sessionId, session] of agentSessions) {
    if (session.harness !== AGENT_HARNESS_QUICKFORGE) continue
    if (session.agent?.state?.isStreaming) continue
    try {
      const before = JSON.stringify(session.model ?? null)
      await refreshSessionModelBinding(session)
      const after = JSON.stringify(session.model ?? null)
      if (before === after) continue
      const state = getSessionState(sessionId)
      emitSessionEvent(session, { type: 'state', ...state })
    } catch (error) {
      // The model may have been deleted (model_not_configured); runPrompt will
      // surface the same error on the next message. Log and keep other
      // sessions refreshing.
      logger.error(`Failed to refresh model for session ${sessionId}:`, error, { sessionId })
    }
  }
}

export async function updateSessionTitle(sessionId, title) {
  let session = agentSessions.get(sessionId)
  if (!session) session = await restoreAgent(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  const normalizedTitle = typeof title === 'string' ? title.trim() : ''
  if (!normalizedTitle) {
    throw Object.assign(new Error('Title must not be empty'), { statusCode: 400 })
  }
  if (normalizedTitle.length > 200) {
    throw Object.assign(new Error('Title is too long'), { statusCode: 400 })
  }

  session.titleGenerationId += 1
  session.title = normalizedTitle
  session.titleSource = 'manual'
  await persistSession(session)
  emitSessionEvent(session, { type: 'title_updated', title: normalizedTitle, titleSource: 'manual' })
  return { sessionId, title: normalizedTitle, titleSource: 'manual' }
}

export async function updateSessionAccessMode(sessionId, accessMode) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }

  session.accessMode = normalizeAccessMode(accessMode, session.accessMode)
  session.yoloMode = yoloModeFromAccessMode(session.accessMode)
  if (session.harness === AGENT_HARNESS_QUICKFORGE) await rebuildSessionTools(session)
  await persistSession(session)

  const state = getSessionState(sessionId)
  emitSessionEvent(session, { type: 'state', ...state })

  return { sessionId, accessMode: session.accessMode, yoloMode: session.yoloMode }
}

export async function updateSessionYoloMode(sessionId, yoloMode) {
  return updateSessionAccessMode(sessionId, yoloMode ? AGENT_ACCESS_MODE_FULL_ACCESS : AGENT_ACCESS_MODE_DEFAULT)
}

function requireOpenCodeHarnessSession(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session) throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  if (session.harness !== AGENT_HARNESS_OPENCODE) {
    throw Object.assign(new Error('Harness configuration is only available for OpenCode sessions.'), { statusCode: 409 })
  }
  return session
}

export async function updateSessionHarnessConfigOption(sessionId, configId, value) {
  const session = requireOpenCodeHarnessSession(sessionId)
  await session.agent.setConfigOption(configId, value)
  const state = getSessionState(sessionId)
  emitSessionEvent(session, { type: 'state', ...state })
  return { sessionId, acpSession: state.acpSession }
}

export async function updateSessionHarnessMode(sessionId, modeId) {
  const session = requireOpenCodeHarnessSession(sessionId)
  await session.agent.setMode(modeId)
  const state = getSessionState(sessionId)
  emitSessionEvent(session, { type: 'state', ...state })
  return { sessionId, acpSession: state.acpSession }
}

/**
 * Fork the entire current OpenCode session into a new QuickForge session.
 *
 * OpenCode ACP only supports whole-session `session/fork` (no message-position
 * fork), so the new agent is created with the full message history and
 * `sourceHarnessSessionId` pointing at the current ACP session. The new session
 * is persisted immediately and announced through the existing `session_forked`
 * event so clients switch to it without a message-level fork semantic.
 */
export async function forkSession(sessionId) {
  const session = requireOpenCodeHarnessSession(sessionId)
  if (session.agent.state.isStreaming) {
    throw Object.assign(new Error('Generation is still running. Stop it or wait until it finishes before forking the conversation.'), {
      statusCode: 409,
      errorCode: 'GENERATION_STILL_RUNNING_BEFORE_FORK',
    })
  }
  const sourceHarnessSessionId = session.agent.harnessSessionId
  if (!sourceHarnessSessionId) {
    throw Object.assign(new Error('This OpenCode conversation has no ACP session to fork.'), { statusCode: 409 })
  }
  const messages = session.agent.state.messages
  if (messages.length === 0) {
    throw Object.assign(new Error('There is no conversation to fork yet.'), { statusCode: 400 })
  }
  const forkedSessionId = randomUUID()
  const forkedSession = await createAgent(forkedSessionId, {
    scope: session.scope,
    projectId: session.projectId,
    accessMode: session.accessMode,
    yoloMode: session.yoloMode,
    model: session.model,
    modelRef: session.modelRef,
    modelAccessContext: session.modelAccessContext,
    resolvePersistedModel: true,
    thinkingLevel: session.thinkingLevel,
    messages,
    title: session.title,
    titleSource: session.titleSource === 'default' ? 'manual' : session.titleSource,
    createdAt: new Date().toISOString(),
    harness: session.harness,
    sourceHarnessSessionId,
    idleRetention: session.idleRetention || null,
  })
  updateSessionMessages(forkedSession, messages)
  await persistSession(forkedSession)

  emitSessionEvent(session, {
    type: 'session_forked',
    sourceSessionId: session.sessionId,
    targetSessionId: forkedSessionId,
    title: forkedSession.title,
    createdAt: forkedSession.createdAt,
    scope: forkedSession.scope,
    projectId: forkedSession.projectId,
    messages: forkedSession.agent.state.messages,
  })
  emitSessionEvent(forkedSession, { type: 'state', ...getSessionState(forkedSessionId) })
  emitSessionEvent(forkedSession, { type: 'message_end', messages: forkedSession.agent.state.messages })
  emitSessionEvent(forkedSession, { type: 'agent_end', messages: forkedSession.agent.state.messages })
  return {
    sessionId: forkedSessionId,
    title: forkedSession.title,
    createdAt: forkedSession.createdAt,
    scope: forkedSession.scope,
    projectId: forkedSession.projectId,
  }
}

/**
 * Update the model for an existing session.
 * Syncs the model to both the session record (for persistence) and the agent state (for API calls).
 * Does NOT force persistence — normal lifecycle events (message_end, agent_end) will persist
 * the updated model.
 */
export function updateSessionModel(sessionId, model, modelRef = null) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  if (session.harness === AGENT_HARNESS_OPENCODE) {
    throw Object.assign(new Error('OpenCode manages its model natively.'), { statusCode: 409 })
  }
  if (!model) {
    throw Object.assign(new Error('Missing model'), { statusCode: 400 })
  }

  session.model = model
  session.modelRef = modelRef
  session.resolvePersistedModel = true
  session.agent.state.model = model

  return { sessionId, model, modelRef: modelRef || undefined }
}

/**
 * Update the thinking level for an existing session.
 */
export function updateSessionThinkingLevel(sessionId, thinkingLevel) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  if (session.harness === AGENT_HARNESS_OPENCODE) {
    throw Object.assign(new Error('OpenCode manages its thinking level natively.'), { statusCode: 409 })
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
    let changed = false
    await atomicUpdate('sessions-metadata', (metadataStore) => {
      for (const [id, meta] of Object.entries(metadataStore)) {
        if (meta && meta.taskStatus === 'running') {
          metadataStore[id] = { ...meta, taskStatus: 'idle', taskFinishedAt: meta.taskFinishedAt ?? new Date().toISOString() }
          changed = true
        }
      }
      return metadataStore
    })
    if (changed) {
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
