import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { logger } from '@/lib/logger'
import type { GoalIterationMarkerSnapshot } from '../server-agent-types'
import { fetchSessionMessagesPage, type SessionMessagesPage } from './messages-channel'
import type { ServerAgentCore } from './core'

/**
 * Split 会话拉尾恢复的退避重试表：SSE 断连窗口吞掉收尾帧（message_end /
 * agent_end）后，重连或 watchdog 触发的 /messages 拉尾若恰好瞬时失败
 * （网络仍抖动），不能让最终回答永久停留在服务端——按此表重试，耗尽即放弃
 * （后端不可达场景由 reconnect-notice 提示与 watchdog 后续轮询兜底）。
 */
const MESSAGE_RECONCILE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000]
/**
 * 补齐全量历史的退避表（毫秒）。首试立即，之后 1s / 3s / 8s / 20s。
 *
 * 为什么要重试：只读视图只给尾部 200 条，更早历史全靠这一次全量拉取。手机
 * 走 Tailscale 时这条请求是 MB 级，超时、切网、后台挂起都可能让它失败；旧实现
 * 「调用方只调一次 + 失败静默 + 期间有 SSE 帧就丢弃结果」三者叠加，等于让那一端
 * 永远停在 200 条，直到手动刷新。现在补齐是幂等、可重入、失败会重试的收敛动作。
 */
const HISTORY_HYDRATE_RETRY_DELAYS_MS = [0, 1_000, 3_000, 8_000, 20_000]

async function fetchMessagesFromServer(core: ServerAgentCore, after: number): Promise<SessionMessagesPage | null> {
  return fetchSessionMessagesPage(core.baseUrl, core.sessionId, after)
}

/**
 * 全量重拉会话消息（回滚/清理场景）。失败（异常或非 2xx 页）显式返回
 * null 与“服务端确实为空”（[]）区分：前者交给调用方重试，后者是合法
 * 终态。restore/create 走的模块级 fetchAllSessionMessages 保持静默
 * 降级语义，不受影响。
 */
async function fetchAllMessagesFromServer(core: ServerAgentCore): Promise<AgentMessage[] | null> {
  const all: AgentMessage[] = []
  let after = 0
  for (let guard = 0; guard < 128; guard += 1) {
    let page: SessionMessagesPage | null
    try {
      page = await fetchSessionMessagesPage(core.baseUrl, core.sessionId, after)
    } catch {
      return null
    }
    if (!page) return null
    all.push(...page.messages)
    if (!page.hasMore || page.messages.length === 0) break
    after += page.messages.length
  }
  return all
}

/**
 * 把尾部窗口补齐为全量消息。
 *
 * 只读视图（`loadView`）只带回尾部窗口以便首屏快速上屏，但界面必须能滚到
 * 更早的历史。增量对账按「服务端索引」工作，它只会往后拉新消息、不会补前缀，
 * 所以这里显式做一次全量替换，并把窗口偏移归零。
 *
 * `beforeReplace` 在**真正替换的前一刻**同步调用：调用方用它捕获滚动锚点。
 * 不能在发起请求时就捕获——补齐要走一次网络往返，用户可能在这期间滚动，
 * 用过期锚点会把视口恢复到他早已离开的位置。
 *
 * 幂等且可重复调用：已经是全量（偏移 0）时直接返回。失败保持窗口状态不变。
 *
 * 补齐全量历史：把本地尾部窗口向前扩到会话开头。
 * 幂等、可重入：`baseSeq === 0` 时直接返回 true。返回 false 表示这次没成功
 * （网络失败 / 服务端无响应），调用方（`ensureFullHistory`）会退避重试。
 *
 * 与旧实现的区别（都是「补齐永久失败」的成因）：
 * - 不再因为「拉取期间有 SSE 帧推进了 stateVersion」就整段丢弃：服务端全量
 *   作为基底，本地更长的尾部保留，合并后提交；
 * - 不再静默吞掉失败，返回值让上层可以重试。
 */
export async function hydrateFullHistory(core: ServerAgentCore, beforeReplace?: () => (() => void) | void): Promise<boolean> {
  if (core.disposed || core.messageBaseSeq <= 0) return true
  let all: AgentMessage[] | null
  try {
    all = await fetchAllMessagesFromServer(core)
  } catch {
    return false
  }
  if (core.disposed) return false
  if (!all) return false
  if (all.length <= core.state.messages.length) {
    // 服务端没有更多历史：清掉窗口标记，停止把它当窗口处理。
    core.messageBaseSeq = 0
    return true
  }
  const localEnd = core.localMessageEndSeq()
  // 拉取期间本地可能已被 SSE 推进到更后面：以服务端全量为基底，把本地超出
  // 的部分接上，避免这次补齐把刚到的消息回退掉（旧实现直接丢弃整份结果）。
  const merged = all.length >= localEnd
    ? all
    : [...all, ...core.state.messages.slice(all.length - core.messageBaseSeq)]
  // 一次性替换，不分批。
  //
  // 曾尝试「按 60 条逐帧向前扩展」以削平长任务，**实测更差**：累计阻塞从
  // ~1.1s 涨到 5.0s、长任务从 2 个变成 35 个。原因是每次提交都要重建整张列表
  // （React 协调 + 装饰重算），增量收益被重复成本吃掉。保持单次替换。
  const cancelAnchor = beforeReplace?.()
  // 补齐 = 整表替换，baseSeq 归零。走 applyLog 保证「数组 + 偏移」成对更新。
  core.applyLog({ kind: 'snapshot', baseSeq: 0, messages: merged })
  core.state.contextUsage = null
  core.stateVersion++
  core.notifyMessageMetadataChanged()
  // If no commit consumed the anchor (e.g. unmounted), release it so it cannot
  // shift scroll at some later, unrelated commit. Guarded: this module is also
  // used outside a DOM (tests, ACP), where `window` does not exist.
  if (typeof cancelAnchor === 'function') {
    const defer = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)
    defer(() => cancelAnchor())
  }
  return true
}

/**
 * 收敛循环：反复尝试补齐，直到 `baseSeq === 0` 或退避表耗尽。
 *
 * 这是 UI 唯一该调用的入口。可被多次触发（首帧后 / 页面重新可见 / 网络恢复），
 * 已补齐时是零成本早退。
 */
export async function ensureFullHistory(core: ServerAgentCore, beforeReplace?: () => (() => void) | void): Promise<boolean> {
  for (const delay of HISTORY_HYDRATE_RETRY_DELAYS_MS) {
    if (core.disposed) return false
    if (core.messageBaseSeq <= 0) return true
    if (delay > 0) {
      await sleepBeforeHistoryHydrate(core, delay)
      if (core.disposed) return false
      if (core.messageBaseSeq <= 0) return true
    }
    if (await hydrateFullHistory(core, beforeReplace)) return true
  }
  return core.messageBaseSeq <= 0
}

/** 可中断的等待：dispose 时立即放行，避免定时器把实例吊在内存里。 */
function sleepBeforeHistoryHydrate(core: ServerAgentCore, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      core.historyHydrateWaiter = null
      resolve()
    }, ms)
    core.historyHydrateWaiter = { timer, resolve }
  })
}

/**
 * 拉尾恢复失败的退避重试：`attempt` 从 0 起，第 attempt 次失败后延迟
 * `MESSAGE_RECONCILE_RETRY_DELAYS_MS[attempt]` 再整体重跑 reconcile。
 * 重跑会重新快照 stateVersion（期间有更新的 SSE 事件补齐消息即自然放弃）、
 * 重新读本地 messages（count 已追平则空转返回），成功路径无需感知本方法。
 */
function scheduleMessageReconcileRetry(
  core: ServerAgentCore,
  summary: { count?: number },
  markers?: GoalIterationMarkerSnapshot[],
  forceMessages = false,
  attempt = 0,
) {
  if (core.disposed) return
  if (attempt >= MESSAGE_RECONCILE_RETRY_DELAYS_MS.length) {
    logger.warn('Message tail reconcile retries exhausted', {
      sessionId: core.sessionId,
      summaryCount: summary.count,
      localCount: core.state.messages.length,
    })
    return
  }
  const delay = MESSAGE_RECONCILE_RETRY_DELAYS_MS[attempt]
  if (core.messageReconcileRetryTimer !== null) return
  core.messageReconcileRetryTimer = setTimeout(() => {
    core.messageReconcileRetryTimer = null
    if (core.disposed) return
    void reconcileMessagesFromSummary(core, summary, markers, forceMessages, attempt + 1)
  }, delay)
}

/**
 * Reconcile local messages against a `messagesSummary` (count) received in a
 * state frame for a split session. Snapshot-based staleness guard: any state
 * write that happens while the fetch is in flight (a concurrent SSE event
 * that already advanced this.stateVersion) discards the result — the newer
 * event is authoritative.
 *
 * 消息实际合入（stateVersion 前进）即在 finish() 广播
 * message_metadata_updated：state 帧驱动的拉尾在 reconcile 之前已同步发出
 * agent_end（当时消息尚未补齐），没有任何后续转发事件兜底，不广播会让
 * 已合入的最终回答停留在内存里不渲染（“最终答案刷新才显示”）。
 * 拉尾跨页（服务端单页 500 条上限）时以整体重跑续拉下一页，每页重置
 * 重试预算；全量重拉（回滚/清理场景）的失败同样进退避重试。
 */
export async function reconcileMessagesFromSummary(core: ServerAgentCore, summary: { count?: number }, markers?: GoalIterationMarkerSnapshot[], forceMessages = false, retryAttempt = 0): Promise<void> {
  const versionBefore = core.stateVersion
  const localCount = core.state.messages.length
  // Server-side index of the local list's first message. 0 for a full
  // restore/create; > 0 when the list came from a read-only tail window
  // (`loadView`). All count comparisons below are in server indices, so the
  // offset has to participate — otherwise a 200-message window over a
  // 1000-message session looks like a 800-message server-side truncation and
  // triggers a pointless full refetch.
  const windowOffset = core.messageBaseSeq
  const localEnd = windowOffset + localCount
  const isCurrent = () => versionBefore === core.stateVersion
    && (!markers || markers === core.latestGoalIterationMarkers)
  const finish = () => {
    const versionAfterMessages = core.stateVersion
    // An ordinary agent_end page can win the race against a marker page.
    // Replay the latest accepted snapshot, never the request's captured one.
    core.replayGoalIterationMarkers()
    // 合入即广播：state 帧驱动的拉尾没有任何后续转发事件（agent_end 已在
    // reconcile 之前同步发出），若只在 markers 存在时通知，无 goal 的普通
    // 会话会把已合入的最终回答留在内存里不渲染（“刷新才显示”）。
    // marker replay 若自行改写消息会先广播并推进版本，此时不再双发。
    if (versionAfterMessages !== versionBefore && core.stateVersion === versionAfterMessages) {
      core.notifyMessageMetadataChanged()
    }
  }
  if (!forceMessages && markers && summary.count === localEnd) {
    finish()
    return
  }

  if (typeof summary.count === 'number' && summary.count < localEnd) {
    // Server truncated below the visible end (rollback/clear/compaction):
    // the incremental tail does not apply — refetch everything and replace.
    const all = await fetchAllMessagesFromServer(core)
    if (!isCurrent()) return
    if (all === null) {
      // 全量重拉失败（异常或非 2xx 页）：与拉尾同口径退避重试。
      scheduleMessageReconcileRetry(core, summary, markers, forceMessages, retryAttempt)
      return
    }
    // The refetch restored the full list, so the window offset no longer applies.
    core.applyLog({ kind: 'snapshot', baseSeq: 0, messages: all })
    core.state.contextUsage = null
    core.stateVersion++
    finish()
    return
  }

  // When the counts already match, the final text may have replaced the last
  // message in place. Only then re-read that message; a larger server count
  // still means the missing tail starts after the local list.
  // `localEnd` (not `localCount`) so a tail window asks the server from the
  // right index instead of restarting at the window length.
  const summaryCount = typeof summary.count === 'number' ? summary.count : undefined
  const after = forceMessages && summaryCount === localEnd
    ? Math.max(windowOffset, localEnd - 1)
    : localEnd
  let page: SessionMessagesPage | null
  try {
    page = await fetchMessagesFromServer(core, after)
  } catch (error) {
    logger.warn('Message tail reconcile fetch failed', {
      sessionId: core.sessionId,
      attempt: retryAttempt,
      error: error instanceof Error ? error.message : String(error),
    })
    scheduleMessageReconcileRetry(core, summary, markers, forceMessages, retryAttempt)
    return
  }
  if (!isCurrent()) return
  if (!page) {
    // 拉尾瞬时失败（网络仍抖动）：按退避表重试。静默放弃会让断连窗口
    // 丢失的收尾帧把最终回答永久留在服务端（“刷新才看到”的根因）。
    scheduleMessageReconcileRetry(core, summary, markers, forceMessages, retryAttempt)
    return
  }
  if (core.messageReconcileRetryTimer !== null) {
    clearTimeout(core.messageReconcileRetryTimer)
    core.messageReconcileRetryTimer = null
  }
  if (page.count < after) {
    // Server has fewer messages than the client assumed (rollback without a
    // summary count update): full refetch replace.
    const all = await fetchAllMessagesFromServer(core)
    if (!isCurrent()) return
    if (all === null) {
      scheduleMessageReconcileRetry(core, summary, markers, forceMessages, retryAttempt)
      return
    }
    core.applyLog({ kind: 'snapshot', baseSeq: 0, messages: all })
    core.state.contextUsage = null
    core.stateVersion++
    finish()
    return
  }
  if (page.messages.length > 0) {
    // 窗口偏移与空洞由 applyLog 统一处理（旧实现走 mergeWindowedMessages
    // 这一条单独的旁路，其它增量路径绕过它就会错位）。
    const applied = core.applyLog({ kind: 'append', after, messages: page.messages })
    if (applied.outcome === 'applied') {
      core.state.contextUsage = null
      core.stateVersion++
    }
  }
  if (page.hasMore && page.messages.length > 0) {
    // 服务端 /messages 单页上限 500：断连窗口丢多条消息时尾部可能跨页。
    // 本地 count 已随本页前进，整体重跑拉下一页；预算重置（每页各持有
    // 完整重试表），后续页失败自然进 scheduleMessageReconcileRetry。
    return reconcileMessagesFromSummary(core, summary, markers, forceMessages, 0)
  }
  finish()
}
