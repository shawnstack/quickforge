import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import { agentAccessModeFromYoloMode, agentAccessModeToYoloMode, normalizeAgentAccessMode } from '@/lib/types'
import { normalizeGoalState } from '@/lib/goal'
import { fetchJsonWithTimeout } from '../server-agent-http'
import type { ServerAgentStateSnapshot } from '../server-agent-types'
import type { ServerAgentCore } from './core'
import { STATE_REQUEST_TIMEOUT_MS } from './core'

const STATUS_REQUEST_TIMEOUT_MS = 10000

/**
 * `/status` 轻量探测的执行体（原 `ServerAgent._doRefreshStatusFromServer`，
 * 逐字迁出；并发去重由类上的包装方法负责）。
 */
export async function doRefreshStatusFromServer(core: ServerAgentCore) {
  const url = `${core.baseUrl}/api/agents/${encodeURIComponent(core.sessionId)}/status`
  try {
    const { response: res, body: status } = await fetchJsonWithTimeout<{
      stateVersion?: number
      isStreaming?: boolean
      status?: string
      errorMessage?: string
      persistDegraded?: boolean
    }>(url, STATUS_REQUEST_TIMEOUT_MS)
    if (!res.ok) {
      if (res.status === 404 && core.state.isStreaming) {
        // 会话不存在是本地可确认的事实：不受未确认回合规则限制。
        core.pendingPrompt = false
        core.applyServerStreaming(false)
        core.stopStateWatchdog()
        core.emitToListeners({ type: 'agent_end', messages: core.state.messages })
      }
      return
    }

    const typedStatus = status ?? {}
    core.lastSseEventAt = Date.now()
    if (typedStatus.persistDegraded !== undefined) {
      core.state.persistDegraded = typedStatus.persistDegraded === true ? true : undefined
    }

    const serverStateVersion = typeof typedStatus.stateVersion === 'number' && Number.isFinite(typedStatus.stateVersion)
      ? typedStatus.stateVersion
      : core.lastServerStateVersion

    if (typedStatus.isStreaming === false) {
      const wasStreaming = core.state.isStreaming
      core.stopStateWatchdog()
      // 主动查询拿到的是「此刻」的事实，优先级高于本地未确认标记：服务端
      // 说没在跑，就是没在跑（这也是未确认回合卡住时的唯一兜底）。
      core.pendingPrompt = false
      await core.refreshStateFromServer({ notify: true, forceMessages: true })
      // The lightweight status endpoint is authoritative for run completion.
      // If a stale/lower-version state snapshot was rejected, still clear the
      // optimistic streaming state so the UI cannot remain stuck loading.
      if (wasStreaming && core.state.isStreaming) {
        core.applyServerStreaming(false)
        core.state.streamingMessage = undefined
        core.state.pendingToolApproval = null
        core.state.pendingAsk = null
        core.emitToListeners({ type: 'agent_end', messages: core.state.messages })
      }
      return
    }

    if (typedStatus.isStreaming === true) {
      core.applyServerStreaming(true)
      core.state.errorMessage = typedStatus.errorMessage
    }

    if (serverStateVersion > core.lastServerStateVersion) {
      await core.refreshStateFromServer({ notify: true, forceMessages: true })
    }
  } catch {
    // Keep the watchdog alive; EventSource may recover on its own.
  }
}

/**
 * `/state` 全量快照刷新的执行体（原 `ServerAgent._doRefreshStateFromServer`，
 * 逐字迁出；并发去重由类上的包装方法负责）。
 */
export async function doRefreshStateFromServer(core: ServerAgentCore, options?: { notify?: boolean; forceMessages?: boolean }) {
  const url = `${core.baseUrl}/api/agents/${encodeURIComponent(core.sessionId)}/state`
  try {
    // Snapshot the message version and the goal watermark before the async
    // gap. The message version guards the message list; the goal watermark
    // independently guards the goal, so a goal_updated SSE frame that lands
    // while this fetch is in flight is not overwritten by an older snapshot
    // (and, because goal frames never bump stateVersion, the fetched
    // messages are still applied).
    const versionBeforeFetch = core.stateVersion
    const goalSeqBeforeFetch = core.goalStateController.capture()
    const { response: res, body } = await fetchJsonWithTimeout<ServerAgentStateSnapshot>(url, STATE_REQUEST_TIMEOUT_MS)
    if (!res.ok) {
      // If the session no longer exists (e.g. destroyed by idle timeout),
      // stop streaming so the UI doesn't get stuck showing a Stop button.
      if (res.status === 404 && core.state.isStreaming) {
        // 会话不存在是本地可确认的事实：不受未确认回合规则限制。
        core.pendingPrompt = false
        core.applyServerStreaming(false)
        core.stopStateWatchdog()
        core.emitToListeners({ type: 'agent_end', messages: core.state.messages })
      }
      return
    }
    const state = body ?? {}
    const serverStateVersion = typeof state.stateVersion === 'number' && Number.isFinite(state.stateVersion)
      ? state.stateVersion
      : undefined
    if (serverStateVersion !== undefined && serverStateVersion < core.lastServerStateVersion) {
      // Version regression: the message list in this snapshot is stale, but a
      // same-goal strictly-newer revision still wins for the goal card.
      core.goalStateController.adoptNewerRevision(state.goal, goalSeqBeforeFetch)
      return
    }

    // Snapshot-based staleness guard: any state write that happens while
    // this fetch was in flight (a concurrent SSE event that already advanced
    // this.stateVersion) discards the result — the newer event wins.
    if (versionBeforeFetch !== core.stateVersion) {
      // A concurrent SSE frame already owns the message list; the snapshot is
      // discarded for messages, but a same-goal strictly-newer revision is
      // still adopted so a goal change is not lost to the race.
      core.goalStateController.adoptNewerRevision(state.goal, goalSeqBeforeFetch)
      return
    }
    // Capture whether the server reports the same version we already
    // applied (cache-hit calibration) before advancing the watermark.
    const versionMatchesLocal = serverStateVersion !== undefined && serverStateVersion === core.lastServerStateVersion
    if (serverStateVersion !== undefined) {
      core.lastServerStateVersion = serverStateVersion
    }

    // 用**绝对位置**判断快照新旧（服务端总数 vs 本地窗口末尾），不再比较
    // 两边数组长度——窗口态下那个比较与数据新旧无关。
    const snapshotBaseSeq = typeof state.messagesAfter === 'number' ? state.messagesAfter : 0
    const serverTotal = typeof state.messagesSummary?.count === 'number'
      ? state.messagesSummary.count
      : snapshotBaseSeq + (state.messages?.length ?? 0)
    const localEnd = core.localMessageEndSeq()
    const shouldReplaceMessages = Boolean(
      state.messages
        && (
          options?.forceMessages
          || serverTotal > localEnd
          || (!core.state.isStreaming && serverTotal === localEnd)
        ),
    )
    if (shouldReplaceMessages && state.messages) {
      const changed = snapshotBaseSeq !== core.messageBaseSeq
        || JSON.stringify(core.state.messages) !== JSON.stringify(state.messages)
      if (changed) {
        core.applyLog({
          kind: 'snapshot',
          baseSeq: snapshotBaseSeq,
          messages: state.messages,
          logVersion: state.logVersion,
        })
        core.stateVersion++
        core.notifyMessageMetadataChanged()
      }
      core.state.contextUsage = state.contextUsage !== undefined ? state.contextUsage : null
    } else if (!state.messages && state.messagesSummary) {
      core.acceptGoalIterationMarkerSnapshot(state.goalIterationMarkers)
      // Split session: the state frame only carries a count summary. Fetch
      // and merge the missing tail (or refetch all when the server
      // truncated). The reconcile itself snapshots stateVersion before the
      // async gap, so concurrent SSE updates still win.
      const summaryCount = state.messagesSummary.count
      if (!options?.forceMessages && versionMatchesLocal
        && typeof summaryCount === 'number' && summaryCount === core.localMessageEndSeq()) {
        // Unchanged server version + matching summary count: the local
        // message list (e.g. hydrated from the snapshot cache) is already
        // in sync — skip the /messages fetch. forceMessages keeps the
        // explicit syncState behaviour unchanged.
      } else {
        await core.reconcileMessagesFromSummary(state.messagesSummary, state.goalIterationMarkers, options?.forceMessages)
      }
    }
    if (state.messages) core.acceptFullGoalIterationMarkerSnapshot(state.messages)
    if (state.systemPrompt !== undefined) {
      core.state.systemPrompt = state.systemPrompt
    }
    if (state.model) {
      core.state.model = state.model
    }
    if (state.thinkingLevel) {
      core.syncingThinkingLevel = true
      core.state.thinkingLevel = state.thinkingLevel as ThinkingLevel
      core.syncingThinkingLevel = false
    }
    if (state.accessMode !== undefined || state.yoloMode !== undefined) {
      const nextAccessMode = normalizeAgentAccessMode(state.accessMode, agentAccessModeFromYoloMode(state.yoloMode))
      core.state.accessMode = nextAccessMode
      core.state.yoloMode = agentAccessModeToYoloMode(nextAccessMode)
    }
    if (state.tools) {
      core.state.tools = state.tools
    }
    if (state.contextCompaction !== undefined) {
      core.state.contextCompaction = state.contextCompaction
    }
    if (state.contextUsage !== undefined) {
      core.state.contextUsage = state.contextUsage
    }
    // `/state` is a full snapshot: absence of the notice means idle.
    core.state.compactionNotice = state.compactionNotice ?? null
    if (state.pendingToolApproval !== undefined) {
      core.state.pendingToolApproval = state.pendingToolApproval
    }
    if (state.pendingToolCalls !== undefined) {
      core.state.pendingToolCalls = new Set(state.pendingToolCalls)
    }
    // /state is a full snapshot: absence of the flag means healthy.
    core.state.persistDegraded = state.persistDegraded === true ? true : undefined
    if (state.source !== undefined) {
      core.sessionSource = state.source || undefined
    }
    if (state.goal !== undefined) {
      const goalResult = core.goalStateController.adopt(normalizeGoalState(state.goal), goalSeqBeforeFetch)
      // HTTP refresh (syncState / watchdog / agent_end fallback) must notify
      // goal subscribers even when no SSE frame follows; a snapshot that lost
      // the race against a newer goal update reports `changed: false`.
      if (goalResult.changed) core.notifyGoalChanged()
    }
    if (state.isStreaming !== undefined) {
      const wasStreaming = core.state.isStreaming
      // 与 SSE state 帧同一条规则：true 清未确认标记，false 在未确认回合期间
      // 被忽略（这份快照可能是在本轮发送之前取的）。
      const adopted = core.applyServerStreaming(Boolean(state.isStreaming))
      if (adopted && state.isStreaming) {
        core.state.errorMessage = undefined
        if (!wasStreaming) {
          core.emitToListeners({ type: 'agent_start' })
        }
      } else if (adopted) {
        core.stopStateWatchdog()
        core.state.pendingToolApproval = null
        core.state.pendingAsk = null
      }
      if (adopted && options?.notify && wasStreaming && !state.isStreaming) {
        core.stateVersion++
        core.emitToListeners({ type: 'agent_end', messages: core.state.messages })
        return
      }
    }
    if (options?.notify) {
      if (state.isStreaming && shouldReplaceMessages) {
        const message = core.state.messages[core.state.messages.length - 1]
        if (message) {
          core.emitToListeners({ type: 'message_update', message })
        }
      } else if (!state.isStreaming) {
        core.emitToListeners({ type: 'message_end' })
      }
    }
  } catch {
    // ignore
  }
}
