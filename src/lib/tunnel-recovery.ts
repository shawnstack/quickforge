/**
 * 隧道恢复协调器：断线重连后优先“免刷新”恢复，仅在对账失败时整页刷新兜底。
 *
 * 职责边界（最小、低耦合，不依赖 React）：
 * - probe：端口探活由调用方（RemoteTunnelOverlay）注入，复用其现有探测逻辑；
 * - 对账：通过现有 HTTP API 校验服务可用性（GET /api/health）与运行任务状态
 *   （GET /api/agents，返回 { sessions }），失败最多重试一次；
 * - 通知：对账通过后 dispatch 标准 `online` 事件与自定义
 *   `quickforge:tunnel-recovered` 事件。应用层监听者必须通过
 *   detail.waitUntil(task) 同步注册真实状态对账任务；协调器会等待全部任务
 *   完成才认为免刷新恢复成功，否则（无监听者 / 任一任务 reject / 超时）整页刷新兜底；
 * - 兜底：对账始终失败或通知未完成时 window.location.reload() 保证整站一致。
 *
 * 防重入：module 级 in-flight 锁，同一时刻只允许一路恢复流程。
 */

export const TUNNEL_RECOVERED_EVENT = 'quickforge:tunnel-recovered'

/**
 * quickforge:tunnel-recovered 事件的 detail。
 * 应用层监听者必须在事件回调内同步调用 waitUntil 注册对账任务；
 * 协调器会等待所有注册任务成功后才判定免刷新恢复完成。
 */
export type TunnelRecoveredEventDetail = {
  /** 事件派发时间戳（ms）。 */
  at: number
  /** 注册对账任务；必须在监听器内同步调用。 */
  waitUntil: (task: Promise<unknown>) => void
}

export type TunnelRecoveryResult =
  | { status: 'recovered' }
  | { status: 'reloaded' }
  | { status: 'deferred'; reason: 'probe-failed' | 'in-flight' }

export type TunnelRecoveryDeps = {
  /** 探测本地隧道端口是否可访问（由 RemoteTunnelOverlay 注入 probeTunnel）。 */
  probe: () => Promise<boolean>
  /** 对账用的 fetch 实现（测试可注入）。默认 globalThis.fetch。 */
  fetchImpl?: typeof fetch
  /** 整页刷新兜底（测试可注入）。默认 window.location.reload。 */
  reload?: () => void
  /** 事件派发（测试可注入）。默认 window.dispatchEvent。 */
  dispatchEvent?: (event: Event) => boolean
  /** 对账失败重试间隔 ms。默认 700，与 probe 重试间隔一致。 */
  retryDelayMs?: number
  /** 对账最多尝试次数（含首次）。默认 2，即失败最多重试一次。 */
  maxAttempts?: number
  /** 单个对账请求超时 ms。默认 3000。 */
  timeoutMs?: number
  /** 等待应用层 waitUntil 对账任务完成的超时 ms。默认 5000。 */
  recoveryWaitTimeoutMs?: number
}

/** module 级防重入锁：同一时刻只允许一路恢复流程。 */
let activeRecovery: Promise<TunnelRecoveryResult> | null = null

export async function recoverTunnelConnection(deps: TunnelRecoveryDeps): Promise<TunnelRecoveryResult> {
  if (activeRecovery) return { status: 'deferred', reason: 'in-flight' }
  activeRecovery = runRecovery(deps)
  try {
    return await activeRecovery
  } finally {
    activeRecovery = null
  }
}

async function runRecovery(deps: TunnelRecoveryDeps): Promise<TunnelRecoveryResult> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  const reload = deps.reload ?? (() => window.location.reload())
  const dispatch = deps.dispatchEvent ?? ((event: Event) => window.dispatchEvent(event))
  const maxAttempts = deps.maxAttempts ?? 2
  const retryDelayMs = deps.retryDelayMs ?? 700
  const timeoutMs = deps.timeoutMs ?? 3000
  const recoveryWaitTimeoutMs = deps.recoveryWaitTimeoutMs ?? 5000

  // 1) 端口探活：未就绪则保持覆盖层等待下一次状态事件，不刷新。
  if (!(await safeProbe(deps.probe))) {
    return { status: 'deferred', reason: 'probe-failed' }
  }

  // 2) 服务可用性 + 运行任务状态对账；失败最多重试一次。
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs)
    if (await reconcile(fetchImpl, timeoutMs)) {
      // 3) 免刷新恢复：等待应用层 waitUntil 对账任务完成；无监听者 / 任一任务
      //    reject / 超时都视为通知未完成，走 reload 兜底（不声称已恢复）。
      if (await notifyAppLayer(dispatch, recoveryWaitTimeoutMs)) {
        return { status: 'recovered' }
      }
      break
    }
  }

  // 4) 兜底：页面状态可能不一致，整页刷新让全站重建。
  try {
    reload()
  } catch {
    // reload 抛错（如测试环境未注入）时静默，状态仍按 reloaded 返回。
  }
  return { status: 'reloaded' }
}

async function safeProbe(probe: () => Promise<boolean>): Promise<boolean> {
  try {
    return await probe()
  } catch {
    return false
  }
}

/**
 * 服务可用性 / 运行任务状态对账：
 * - GET /api/health 返回 200（服务可用）；
 * - GET /api/agents 返回 200 且 body.sessions 为数组（运行任务状态可读）。
 */
async function reconcile(fetchImpl: typeof fetch, timeoutMs: number): Promise<boolean> {
  const [health, agents] = await Promise.all([
    fetchJson(fetchImpl, '/api/health', timeoutMs),
    fetchJson(fetchImpl, '/api/agents', timeoutMs),
  ])
  if (!health?.ok || !agents?.ok) return false
  const agentsBody = agents.body as { sessions?: unknown } | null
  return Array.isArray(agentsBody?.sessions)
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; body: unknown } | null> {
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { cache: 'no-store', signal: controller.signal })
    const body = res.ok ? await res.json().catch(() => null) : null
    return { ok: res.ok, body }
  } catch {
    return null
  } finally {
    globalThis.clearTimeout(timer)
  }
}

/**
 * 派发标准 online 事件 + 自定义恢复事件，并等待应用层 waitUntil 对账完成：
 * - 至少注册一个 waitUntil 任务，否则视为没有恢复监听者（通知未完成）；
 * - 全部任务成功才认为已恢复；任一 reject 或超过 waitTimeoutMs 视为通知未完成。
 */
async function notifyAppLayer(dispatch: (event: Event) => boolean, waitTimeoutMs: number): Promise<boolean> {
  let registeredCount = 0
  const tasks: Promise<unknown>[] = []
  const detail: TunnelRecoveredEventDetail = {
    at: Date.now(),
    waitUntil: (task) => {
      registeredCount += 1
      tasks.push(task)
    },
  }
  try {
    dispatch(new Event('online'))
    dispatch(new CustomEvent(TUNNEL_RECOVERED_EVENT, { detail }))
  } catch {
    // 事件派发抛错（监听者异常）视为通知未完成。
    return false
  }

  // 没有任何监听者注册对账任务：整页刷新兜底。
  if (registeredCount === 0) return false

  const allTasks = Promise.all(tasks)
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const waitTimeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = globalThis.setTimeout(
      () => reject(new Error('tunnel recovery waitUntil timeout')),
      waitTimeoutMs,
    )
  })
  try {
    await Promise.race([allTasks, waitTimeout])
    return true
  } catch {
    return false
  } finally {
    globalThis.clearTimeout(timeoutHandle)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
