import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import { agentAccessModeFromYoloMode, agentAccessModeToYoloMode, normalizeAgentAccessMode } from '@/lib/agent-access-mode'
import { normalizeGoalState } from '@/lib/goal'
import type { ServerAgentStateSnapshot } from '../server-agent-types'
import type { ServerAgentCore } from './core'

/**
 * SSE `state` 帧：整份权威快照的采纳（原 `handleSseEvent` 的 `case 'state'`，
 * 逐字迁出）。返回是否继续把原始帧转发给订阅者（state 帧从不转发）。
 */
export function handleStateFrame(core: ServerAgentCore, event: Record<string, unknown>): boolean {
  // Initial state snapshot from server (e.g. after page refresh / SSE reconnect).
  // Guard against SSE reconnect overwriting client messages with a stale
  // server snapshot: only accept server messages if the client has none
  // (initial load) or if the server has at least as many messages.
  const s = event as ServerAgentStateSnapshot
  if (s.source !== undefined) {
    core.sessionSource = s.source || undefined
  }
  if (s.systemPrompt !== undefined) {
    core.state.systemPrompt = s.systemPrompt
  }
  if (s.messages) {
    // 用**绝对位置**判断快照新旧：服务端总数 vs 本地窗口末尾。
    // 旧实现比较 `s.messages.length > this.state.messages.length`，在
    // 窗口态下恒成立/恒不成立，取决于窗口起点，与数据新旧无关。
    const snapshotBaseSeq = typeof s.messagesAfter === 'number' ? s.messagesAfter : 0
    const serverTotal = typeof s.messagesSummary?.count === 'number'
      ? s.messagesSummary.count
      : snapshotBaseSeq + s.messages.length
    const localEnd = core.localMessageEndSeq()
    const acceptSnapshot = serverTotal > localEnd
      || (!core.state.isStreaming && serverTotal === localEnd)
    const changed = snapshotBaseSeq !== core.messageBaseSeq
      || JSON.stringify(core.state.messages) !== JSON.stringify(s.messages)
    if (acceptSnapshot && changed) {
      core.applyLog({
        kind: 'snapshot',
        baseSeq: snapshotBaseSeq,
        messages: s.messages,
        logVersion: s.logVersion,
      })
      core.stateVersion++
      core.notifyMessageMetadataChanged()
    }
  }
  // Streaming protects the body, not identity-checked final metadata.
  if (s.messages) core.acceptFullGoalIterationMarkerSnapshot(s.messages)
  if (s.model) {
    core.state.model = s.model
  }
  if (s.thinkingLevel) {
    core.syncingThinkingLevel = true
    core.state.thinkingLevel = s.thinkingLevel as ThinkingLevel
    core.syncingThinkingLevel = false
  }
  if (s.accessMode !== undefined || s.yoloMode !== undefined) {
    const nextAccessMode = normalizeAgentAccessMode(s.accessMode, agentAccessModeFromYoloMode(s.yoloMode))
    core.state.accessMode = nextAccessMode
    core.state.yoloMode = agentAccessModeToYoloMode(nextAccessMode)
  }
  if (s.tools) {
    core.state.tools = s.tools
  }
  if (s.contextCompaction !== undefined) {
    core.state.contextCompaction = s.contextCompaction
  }
  if (s.contextUsage !== undefined) {
    core.state.contextUsage = s.contextUsage
  } else if (s.messages) {
    core.state.contextUsage = null
  }
  // State frames are full snapshots: an absent notice means idle, so a
  // reconnect after the compaction settled cannot resurrect the row.
  core.state.compactionNotice = s.compactionNotice ?? null
  if (s.pendingToolApproval !== undefined) {
    core.state.pendingToolApproval = s.pendingToolApproval
  }
  if (s.pendingAsk !== undefined) {
    core.state.pendingAsk = s.pendingAsk
  }
  if (s.pendingToolCalls !== undefined) {
    core.state.pendingToolCalls = new Set(s.pendingToolCalls)
  }
  if (s.backgroundCommands !== undefined) {
    core.state.backgroundCommands = s.backgroundCommands
  }
  // State frames are full snapshots: absence of the flag means healthy.
  core.state.persistDegraded = s.persistDegraded === true ? true : undefined
  if (s.goal !== undefined) {
    // The state frame returns below without forwarding, so a real goal
    // change must be broadcast explicitly (a repeat snapshot / stale
    // revision reports `changed: false` and stays silent).
    const goalResult = core.goalStateController.adopt(normalizeGoalState(s.goal))
    if (goalResult.changed) core.notifyGoalChanged()
  }
  let wasStreaming = core.state.isStreaming
  if (s.isStreaming !== undefined) {
    // 权威运行状态：true 清未确认标记；false 在未确认回合期间被忽略，
    // 因为那条「结束」属于上一轮（回滚/停止的收尾帧可能还在飞）。
    const adopted = core.applyServerStreaming(s.isStreaming)
    if (adopted) {
      if (s.isStreaming) {
        core.startStateWatchdog()
      } else {
        core.stopStateWatchdog()
      }
    } else {
      wasStreaming = false
    }
  }
  // Emit the correct lifecycle event so the sidebar green dot stays in sync
  if (s.isStreaming === true) {
    core.state.errorMessage = undefined
    core.emitToListeners({ type: 'agent_start' })
  } else if (wasStreaming) {
    // Mirror the agent_end case: the run is over, so the streaming
    // partial must not linger (a reconnect frame that reports the run
    // finished without the client ever seeing message_end).
    core.state.streamingMessage = undefined
    core.state.pendingToolApproval = null
    core.state.pendingAsk = null
    core.stateVersion++
    core.emitToListeners({ type: 'agent_end', messages: core.state.messages })
  }
  if (!s.messages && s.messagesSummary) {
    core.acceptGoalIterationMarkerSnapshot(s.goalIterationMarkers)
    // Reapply inside the reconcile's version guard after missing messages
    // arrive. Capture after this frame's own lifecycle writes.
    void core.reconcileMessagesFromSummary(s.messagesSummary, s.goalIterationMarkers)
  }
  return false
}
