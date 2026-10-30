// agent-manager 模块拆分（agent-manager-module-split）共享事件核心：
// 会话事件发射/分帧转换、上下文用量估算与消息构造 helper 从 agent-manager.mjs
// 逐字符搬移至此；agent-manager.mjs 继续作为 facade re-export 公共符号，
// 消费方零改动。公共 API 与注释语义保持不变。

import { EventEmitter } from 'node:events'
import { mergeQuickForgeTiming } from './tool-wiring.mjs'
import { estimateSessionContextUsage } from './auto-compaction.mjs'
import { globalEventLog } from './event-log.mjs'
import {
  bumpMessageLogVersion,
  goalIterationMarkers,
  messageIdentity,
  messageLogVersion,
  projectSessionSnapshot,
} from './message-log.mjs'
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

/**
 * 消息日志版本守卫：只在「消息数组真的变了」时推进 `messageLogVersion`。
 *
 * 用「条数 + 尾消息身份」做指纹而不是深比较：每帧 `message_end` 都带完整
 * messages，深比较是 O(会话字节数)。指纹必须存值而不是数组引用——append 是
 * 原地 push，引用比较永远相等。
 */
function trackMessageLogVersion(session, event) {
  const messages = Array.isArray(event?.messages) ? event.messages : null
  if (!messages) return messageLogVersion(session)
  const fingerprint = {
    length: messages.length,
    lastIdentity: messageIdentity(messages[messages.length - 1]),
  }
  const previous = session.messageLogFingerprint
  if (!previous || previous.length !== fingerprint.length || previous.lastIdentity !== fingerprint.lastIdentity) {
    session.messageLogFingerprint = fingerprint
    return bumpMessageLogVersion(session)
  }
  return messageLogVersion(session)
}

/**
 * 会话事件出口。
 *
 * 顺序是契约的一部分：先推进 `stateVersion`（帧新鲜度水位），再推进
 * `logVersion`（消息变更水位），然后发布到全局事件环拿到 `logSeq`（SSE 的
 * `id:`），最后广播。
 *
 * **这里发出的是完整事件**（含完整 messages）。裁到「本连接还没见过的尾部
 * 窗口」是连接层的职责（`createConnectionProjector`）。旧实现用会话级
 * `deliveredMessageCount` 在这里裁剪，两个客户端共享同一个投递位置，后加入者
 * 会从别人的进度开始收增量——这是「同 session 双端内容不一致」的硬伤。
 */
function emitSessionEvent(session, event) {
  const stateVersion = nextSessionStateVersion(session)
  const logVersion = trackMessageLogVersion(session, event)
  const enrichedEvent = (event?.type === 'message_end' || event?.type === 'agent_end' || event?.type === 'messages_replaced' || event?.type === 'auto_compact_completed')
    && event.contextUsage === undefined
    ? { ...event, contextUsage: getSessionContextUsage(session), stateVersion, logVersion }
    : { ...event, stateVersion, logVersion }
  const wireEvent = transformSplitSessionEvent(session, enrichedEvent)
  wireEvent.logSeq = globalEventLog.publish(session.sessionId, wireEvent)
  logSseFrame(session, wireEvent)
  session.eventBus.emit('agent_event', wireEvent)
  agentEvents.emit('agent_event', { sessionId: session.sessionId, ...wireEvent })
}

// SSE 帧流水日志（thinking→final-reply 丢失取证）：只记关键帧，跳过高频
// message_update 流式帧。每行：会话短 id + 帧类型 + 决定性统计，用于对照
// 「服务端发了什么」与「前端收到什么」（前端断帧时此日志仍完整）。
const SSE_FRAME_LOG_TYPES = new Set(['message_end', 'agent_end', 'messages_replaced', 'state', 'tool_execution_end', 'turn_end'])

function logSseFrame(session, wireEvent) {
  if (!SSE_FRAME_LOG_TYPES.has(wireEvent?.type)) return
  const sid = String(session.sessionId || '').slice(0, 8)
  let detail = ''
  if (wireEvent.type === 'message_end') {
    const message = wireEvent.message
    const blockTypes = Array.isArray(message?.content) ? message.content.map((block) => block?.type).join('+') : typeof message?.content
    detail = `msg=${message?.role ?? 'none'}(${blockTypes ?? '?'}) tail=${Array.isArray(wireEvent.messages) ? wireEvent.messages.length : 0} incr=${wireEvent.messagesIncremental === true}`
  } else if (wireEvent.type === 'agent_end' || wireEvent.type === 'messages_replaced') {
    detail = `msgs=${Array.isArray(wireEvent.messages) ? wireEvent.messages.length : 0} after=${wireEvent.messagesAfter ?? '-'} incr=${wireEvent.messagesIncremental === true} summary=${wireEvent.messagesSummary?.count ?? '-'}`
  } else if (wireEvent.type === 'state') {
    detail = `msgs=${Array.isArray(wireEvent.messages) ? wireEvent.messages.length : 'strip'} summary=${wireEvent.messagesSummary?.count ?? '-'} streaming=${wireEvent.isStreaming === true}`
  } else if (wireEvent.type === 'tool_execution_end') {
    detail = `tool=${wireEvent.toolName ?? wireEvent.toolCallId ?? '?'}`
  } else if (wireEvent.type === 'turn_end') {
    detail = `v${wireEvent.stateVersion ?? '?'}`
  }
  logger.info(`[sse-frame] ${sid} ${wireEvent.type} ${detail}`, { sessionId: session.sessionId })
}

/**
 * F9 split-message SSE frames: split sessions never ship the full `messages`
 * array over SSE. `state` frames carry a lightweight `messagesSummary`
 * ({ count }) and sparse `goalIterationMarkers` instead; the latter retains
 * same-count metadata changes on reconnect without shipping message bodies.
 * message_end/agent_end/messages_replaced frames carry
 * only the tail that the client has not yet seen (`messagesAfter` +
 * `messages` + `messagesIncremental`), with a `messagesSummary` for the total.
 * Non-split sessions keep the legacy full-array payloads byte-for-byte, so
 * older clients and non-split sessions are unaffected. `stateVersion` is
 * never modified here.
 */
/**
 * SSE 事件形状修正：split 会话的 `state` 帧补上 `messagesSummary` 与**绝对
 * seq** 的 goal 迭代标记；消息体保持完整，由连接层按游标裁剪。
 *
 * 旧实现直接删掉 `messages`，再用会话级游标切尾（`deliveredMessageCount`）。
 * 现在这层只加元数据，不做任何「按会话」的裁剪——裁剪必须按连接做。
 */
function transformSplitSessionEvent(session, event) {
  if (!event || typeof event !== 'object') return event
  if (event.type !== 'state') return event
  const next = { ...event }
  if (Array.isArray(next.messages)) {
    const logVersion = messageLogVersion(session)
    next.goalIterationMarkers = goalIterationMarkers(next.messages, 0)
    next.messagesSummary = { count: next.messages.length, logVersion }
  }
  return next
}

/**
 * 会话状态快照（`/state`、`/restore`、会话级 SSE 初始帧共用）。
 *
 * 返回「尾部窗口 + `messagesAfter` + `logVersion`」，而不是把消息整体删掉：
 * 客户端一次请求就能自洽渲染，不再依赖「先 /state 再 /messages」两次请求之间
 * 的一致性——那两次之间原本没有任何版本校验。
 *
 * 函数名保留（`stripSplitSessionState`）以免破坏既有 import，语义已改为
 * 「按消息日志投影快照」。
 */
export function stripSplitSessionState(state) {
  return projectSessionSnapshot(state)
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
