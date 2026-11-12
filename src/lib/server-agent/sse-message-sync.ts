import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { toolCallIdsWithoutToolResult, upsertMessage } from '@/lib/tool-execution-events'
import type { ServerAgentContextCompaction, ServerAgentContextUsage } from '../server-agent-types'
import type { ServerAgentCore } from './core'

/**
 * SSE `message_end`（原 `case 'message_end'`，逐字迁出）。
 *
 * 所有转发（含异步收尾路径里的转发）由本函数自行完成，返回 false 表示
 * 分发层不得再次转发。
 */
export function handleMessageEnd(core: ServerAgentCore, event: Record<string, unknown>): boolean {
  // Trust the SSE event data when it carries a finalized message. Tool
  // calls are executed after the assistant message_end event, so keeping
  // this message in local state lets pending run_command cards render
  // immediately instead of waiting for a full state refresh.
  const msgEvent = event as { message?: AgentMessage; messages?: AgentMessage[]; messagesAfter?: number; messagesIncremental?: boolean; messagesSummary?: { count?: number; logVersion?: number }; logVersion?: number; contextUsage?: ServerAgentContextUsage | null }
  // The partial body this stream was rendering is finalized by this
  // frame (carried by it or refetched below), so drop it to avoid
  // rendering the same message twice (list + streaming container).
  core.state.streamingMessage = undefined
  if (msgEvent.message) {
    core.state.messages = upsertMessage(core.state.messages, msgEvent.message)
    // Keep committed tool calls without any result pending so they keep
    // rendering running: tool_execution_start may arrive only after this
    // frame, and a missing pending entry would flash the idle 'called'
    // dot for one frame before the spinner returns.
    const pendingIds = toolCallIdsWithoutToolResult(msgEvent.message, core.state.messages)
    if (pendingIds.length) {
      core.state.pendingToolCalls = new Set([...core.state.pendingToolCalls, ...pendingIds])
    }
    core.replayGoalIterationMarkers()
    core.state.contextUsage = msgEvent.contextUsage !== undefined ? msgEvent.contextUsage : null
    core.stateVersion++
    core.forwardWireEvent(event)
    return false
  }
  if (msgEvent.messagesIncremental) {
    core.applyLog({
      kind: 'append',
      after: typeof msgEvent.messagesAfter === 'number' ? msgEvent.messagesAfter : core.localMessageEndSeq(),
      messages: msgEvent.messages ?? [],
      logVersion: msgEvent.logVersion,
    })
    if (typeof msgEvent.messagesSummary?.count === 'number' && msgEvent.messagesSummary.count > core.localMessageEndSeq()) {
      void core.reconcileMessagesFromSummary(msgEvent.messagesSummary, undefined, true).finally(() => {
        core.forwardWireEvent(event)
      })
      return false
    }
    core.replayGoalIterationMarkers()
    core.state.contextUsage = msgEvent.contextUsage !== undefined ? msgEvent.contextUsage : null
    core.stateVersion++
    core.forwardWireEvent(event)
    return false
  }
  if (msgEvent.messages && msgEvent.messages.length >= core.state.messages.length) {
    core.applyLog({
      kind: 'snapshot',
      baseSeq: typeof msgEvent.messagesAfter === 'number' ? msgEvent.messagesAfter : 0,
      messages: msgEvent.messages,
      logVersion: msgEvent.logVersion,
    })
    core.replayGoalIterationMarkers()
    core.state.contextUsage = msgEvent.contextUsage !== undefined ? msgEvent.contextUsage : null
    core.stateVersion++
    core.forwardWireEvent(event)
    return false
  }
  if (msgEvent.messagesSummary) {
    void core.reconcileMessagesFromSummary(msgEvent.messagesSummary).finally(() => {
      core.forwardWireEvent(event)
    })
    return false
  }
  // No messages in event — refresh from server as last resort
  void core.refreshStateFromServer().finally(() => {
    core.forwardWireEvent(event)
  })
  return false
}

/**
 * SSE `turn_end`（原 `case 'turn_end'`，逐字迁出）。
 *
 * 所有转发（含异步收尾路径里的转发）由本函数自行完成，返回 false 表示
 * 分发层不得再次转发。
 */
export function handleTurnEnd(core: ServerAgentCore, event: Record<string, unknown>): boolean {
  // turn_end carries the assistant message for this turn, but by this
  // point it is already in state and tool results may have followed it.
  // Do not upsert event.message here, otherwise it can duplicate the
  // assistant message after tool results.
  const msgEvent = event as { messages?: AgentMessage[]; messagesAfter?: number; logVersion?: number; contextUsage?: ServerAgentContextUsage | null }
  // Defensive: message_end normally cleared the partial body already,
  // but a turn_end without a preceding message_end must not leave the
  // last streamed message duplicated in the streaming container.
  core.state.streamingMessage = undefined
  if (msgEvent.messages && msgEvent.messages.length >= core.state.messages.length) {
    core.applyLog({
      kind: 'snapshot',
      baseSeq: typeof msgEvent.messagesAfter === 'number' ? msgEvent.messagesAfter : 0,
      messages: msgEvent.messages,
      logVersion: msgEvent.logVersion,
    })
    core.replayGoalIterationMarkers()
    core.state.contextUsage = msgEvent.contextUsage !== undefined ? msgEvent.contextUsage : null
    core.stateVersion++
    core.forwardWireEvent(event)
    return false
  }
  void core.refreshStateFromServer().finally(() => {
    core.forwardWireEvent(event)
  })
  return false
}

/** SSE `messages_replaced`（原 `case 'messages_replaced'`，逐字迁出）。返回是否继续转发。 */
export function handleMessagesReplaced(core: ServerAgentCore, event: Record<string, unknown>): boolean {
  const replacedEvent = event as { messages?: AgentMessage[]; messagesAfter?: number; messagesIncremental?: boolean; messagesReplaced?: boolean; messagesSummary?: { count?: number; logVersion?: number }; logVersion?: number; contextCompaction?: ServerAgentContextCompaction | null; contextUsage?: ServerAgentContextUsage | null }
  if (replacedEvent.messagesIncremental) {
    // 旧服务端的兼容分支：替换帧带增量尾。
    core.applyLog({
      kind: 'append',
      after: typeof replacedEvent.messagesAfter === 'number' ? replacedEvent.messagesAfter : core.localMessageEndSeq(),
      messages: replacedEvent.messages ?? [],
      logVersion: replacedEvent.logVersion,
    })
    core.state.streamingMessage = undefined
    core.stateVersion++
  } else if (replacedEvent.messagesSummary && !Array.isArray(replacedEvent.messages)) {
    // Split-session rollback/clear: the server truncated the history, so
    // refetch everything and replace the local list.
    void core.reconcileMessagesFromSummary(replacedEvent.messagesSummary)
  } else if (replacedEvent.messages) {
    // 替换语义：旧前缀作废，baseSeq 由服务端的 `messagesAfter` 重建。
    // 这里必须是 `replace` 而不是 `snapshot`——否则回滚后本地会保留
    // 对「已不存在的消息」的窗口假设。
    core.applyLog({
      kind: 'replace',
      baseSeq: typeof replacedEvent.messagesAfter === 'number' ? replacedEvent.messagesAfter : 0,
      messages: replacedEvent.messages,
      logVersion: replacedEvent.logVersion,
    })
    core.state.streamingMessage = undefined
    core.stateVersion++
  }
  core.replayGoalIterationMarkers()
  if (replacedEvent.contextCompaction !== undefined) {
    core.state.contextCompaction = replacedEvent.contextCompaction
  }
  if (replacedEvent.contextUsage !== undefined) {
    core.state.contextUsage = replacedEvent.contextUsage
  } else if (replacedEvent.messages || replacedEvent.messagesIncremental) {
    core.state.contextUsage = null
  }
  return true
}

/**
 * SSE `resync`（原 `case 'resync'`，逐字迁出）。
 *
 * 事件环缺口（断线太久 / 服务端重启）：错过的增量已不可重放，重取一次
 * 权威快照。这是「双端最终一致」的兜底路径，不做节流——该帧本身稀少，
 * 而缺口期间本地可能已经落后很多条。
 */
export function handleResync(core: ServerAgentCore): boolean {
  void core.syncState()
  return false
}
