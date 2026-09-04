// agent-manager 模块拆分（agent-manager-module-split）共享事件核心：
// 会话事件发射/分帧转换、上下文用量估算与消息构造 helper 从 agent-manager.mjs
// 逐字符搬移至此；agent-manager.mjs 继续作为 facade re-export 公共符号，
// 消费方零改动。公共 API 与注释语义保持不变。

import { EventEmitter } from 'node:events'
import { mergeQuickForgeTiming } from './tool-wiring.mjs'
import { estimateSessionContextUsage } from './auto-compaction.mjs'
import { logger } from './utils/logger.mjs'

export const agentEvents = new EventEmitter()

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

function getSessionContextUsage(session) {
  try {
    return estimateSessionContextUsage(session)
  } catch (error) {
    logger.warn(`Failed to estimate context usage for session ${session?.sessionId}:`, error?.message || error, { sessionId: session?.sessionId })
    return null
  }
}

export {
  assistantTextMessage,
  userTextMessage,
  compactedSessionTitle,
  estimateTokenReduction,
  emitSessionEvent,
  addToolTimingToEvent,
  updateRuntimeToolExecution,
  messagesWithRuntimeToolExecutions,
  runtimePendingToolCalls,
  updateSessionMessages,
  getSessionContextUsage,
}
