import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { logger } from '@/lib/logger'
import type { ServerAgentContextUsage } from '../server-agent-types'
import type { ServerAgentCore } from './core'

/** SSE `agent_start`（原 `case 'agent_start'`，逐字迁出）。返回是否继续转发。 */
export function handleAgentStart(core: ServerAgentCore): boolean {
  core.applyServerStreaming(true)
  core.state.errorMessage = undefined
  core.state.pendingToolApproval = null
  core.state.pendingAsk = null
  core.startStateWatchdog()
  return true
}

/**
 * SSE `agent_end`（原 `case 'agent_end'`，逐字迁出）。
 *
 * 所有转发（含异步收尾路径里的转发）由本函数自行完成，返回 false 表示
 * 分发层不得再次转发。
 */
export function handleAgentEnd(core: ServerAgentCore, event: Record<string, unknown>): boolean {
  // 一条结束帧只有在「本轮已被服务端确认开始」时才属于当前这一轮。
  // 回滚 / 停止的收尾帧可能在新一轮已经发出之后才到，它描述的是上一轮：
  // 整帧丢弃——既不改运行状态、也不做收尾，连消息投影都不可信（它比本地旧）。
  if (!core.applyServerStreaming(false)) {
    logger.info('Ignored a stale agent_end: a newer run has not been confirmed yet', {
      sessionId: core.sessionId,
    })
    return false
  }
  core.stopStateWatchdog()
  const endEvent = event as { messages?: AgentMessage[]; messagesAfter?: number; messagesIncremental?: boolean; messagesSummary?: { count?: number; logVersion?: number }; logVersion?: number; messagesReplaced?: boolean; errorMessage?: string; contextUsage?: ServerAgentContextUsage | null }

  // The server normalizes pi-agent-core's agent_end payload to include
  // the authoritative full session history (non-split) or an incremental
  // tail + summary (split). Prefer that SSE payload to avoid an extra
  // /state request that would transfer the same long message list again.
  // If the event is missing messages or looks older than local state,
  // fall back to the full state fetch for safety.
  if (endEvent.messagesIncremental) {
    // 增量按**绝对 seq** 落位：`messagesAfter` 由服务端给，缺省时用本地
    // 末尾（旧服务端的兜底）。缺口会由 applyLog 触发强制对账，不猜拼接。
    core.applyLog({
      kind: 'append',
      after: typeof endEvent.messagesAfter === 'number' ? endEvent.messagesAfter : core.localMessageEndSeq(),
      messages: endEvent.messages ?? [],
      logVersion: endEvent.logVersion,
    })
    const summary = endEvent.messagesSummary
    const summaryCount = summary?.count
    if (summary && typeof summaryCount === 'number' && summaryCount > core.localMessageEndSeq()) {
      void core.reconcileMessagesFromSummary(summary, undefined, true).finally(() => {
        // 异步收尾可能晚于下一次发送：只有仍属于本轮时才写状态。
        core.applyServerStreaming(false)
        core.state.streamingMessage = undefined
        core.state.pendingToolApproval = null
        core.state.pendingAsk = null
        if (endEvent.errorMessage) core.state.errorMessage = endEvent.errorMessage
        core.forwardWireEvent(event)
      })
      return false
    }
    core.replayGoalIterationMarkers()
    core.state.contextUsage = endEvent.contextUsage !== undefined ? endEvent.contextUsage : null
    core.state.streamingMessage = undefined
    core.state.pendingToolApproval = null
    core.state.pendingAsk = null
    if (endEvent.errorMessage) core.state.errorMessage = endEvent.errorMessage
    core.stateVersion++
    core.forwardWireEvent(event)
    return false
  }
  if (endEvent.messagesSummary && (
    !Array.isArray(endEvent.messages)
    || (typeof endEvent.messagesSummary.count === 'number' && endEvent.messagesSummary.count > core.localMessageEndSeq())
  )) {
    void core.reconcileMessagesFromSummary(endEvent.messagesSummary, undefined, true).finally(() => {
      // 异步收尾可能晚于下一次发送：只有仍属于本轮时才写状态。
      core.applyServerStreaming(false)
      core.state.streamingMessage = undefined
      core.state.pendingToolApproval = null
      if (endEvent.errorMessage) core.state.errorMessage = endEvent.errorMessage
      core.forwardWireEvent(event)
    })
    return false
  }
  if (endEvent.messages && endEvent.messages.length >= core.state.messages.length) {
    core.applyLog({
      kind: 'snapshot',
      baseSeq: typeof endEvent.messagesAfter === 'number' ? endEvent.messagesAfter : 0,
      messages: endEvent.messages,
      logVersion: endEvent.logVersion,
    })
    core.replayGoalIterationMarkers()
    core.state.contextUsage = endEvent.contextUsage !== undefined ? endEvent.contextUsage : null
    core.state.streamingMessage = undefined
    core.state.pendingToolApproval = null
    core.state.pendingAsk = null
    if (endEvent.errorMessage) core.state.errorMessage = endEvent.errorMessage
    core.stateVersion++
    core.forwardWireEvent(event)
    return false
  }

  // Fallback for stale/malformed events or legacy servers.
  void core.refreshStateFromServer({ forceMessages: true }).finally(() => {
    // 异步收尾可能晚于下一次发送：只有仍属于本轮时才写状态。
    core.applyServerStreaming(false)
    core.state.streamingMessage = undefined
    core.state.pendingToolApproval = null
    core.state.pendingAsk = null
    if (endEvent.errorMessage) core.state.errorMessage = endEvent.errorMessage
    core.forwardWireEvent(event)
  })
  return false
}

/** SSE `message_update`（原 `case 'message_update'`，逐字迁出）。返回是否继续转发。 */
export function handleMessageUpdate(core: ServerAgentCore, event: Record<string, unknown>): boolean {
  // Mirror SharedServerAgent (see shared-server-agent.ts): the live
  // partial body must be exposed on state.streamingMessage so the React
  // chat surface can render streaming text. A frame without `message`
  // (older server) is forwarded as-is without touching the stream.
  const updateEvent = event as { message?: AgentMessage }
  if (updateEvent.message) core.state.streamingMessage = updateEvent.message
  // 流式增量只可能来自正在运行的回合，它本身就是「本轮已开始」的确认，
  // 所以未确认标记在这里也可以撤掉（早于服务端的 agent_start 帧到达）。
  core.pendingPrompt = false
  return true
}
