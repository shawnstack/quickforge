/**
 * 浏览器侧连接池 / 请求排队诊断采集器。
 *
 * 目的：在 DevTools 控制台执行 `window.__quickforgePerf()` 就能区分
 * 「浏览器 HTTP/1.1 同源 6 连接池耗尽（请求在浏览器侧排队）」与「服务端阻塞」：
 * - 排队时长取 PerformanceResourceTiming 的 `requestStart - startTime`；
 * - 常驻长连接数来自包装后的 `window.fetch`（SSE / NDJSON 流式响应）；
 * - 排队超过阈值的请求会 console.warn，同 path 在节流窗口内只告警一次。
 *
 * 约束：
 * - 所有外部依赖（performance / PerformanceObserver / fetch / console / 计时器 / now）
 *   都可通过 options 注入，默认取全局，便于单测；
 * - `VITE_QUICKFORGE_DIAGNOSTICS=0` 时 start 直接 no-op（报告显示采集已关闭）；
 * - 重复调用 start 复用同一会话，fetch 包装幂等，不会叠加多层包装。
 */

/** 排队超过该阈值即视为「慢排队」并告警（ms）。 */
export const DIAGNOSTICS_SLOW_QUEUE_MS = 500
/** 同一 path 的告警节流窗口（ms）。 */
export const DIAGNOSTICS_WARN_THROTTLE_MS = 30_000
/** 会话内保留的最近慢排队样本条数。 */
export const DIAGNOSTICS_SLOW_SAMPLE_LIMIT = 50
/** 报告中「慢排队 / 慢请求 / 按路径」榜单条数。 */
export const DIAGNOSTICS_REPORT_TOP_LIMIT = 5
/** 告警节流表清理间隔（ms）。 */
export const DIAGNOSTICS_WARN_PRUNE_INTERVAL_MS = 60_000

/** 包装后的 fetch 上的标记，用于保证重复包装幂等。 */
const FETCH_WRAPPED_FLAG = '__quickforgeConnectionDiagnostics'
/** 视为常驻长连接的响应 content-type 片段。 */
const LONG_LIVED_CONTENT_TYPES = ['text/event-stream', 'application/x-ndjson']
/** 无需依赖 base 即可判定为「本机服务」的 hostname（dev 下前端 :5176 与 API :32176 端口不同）。 */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** 采集所需的最小 PerformanceResourceTiming 结构（便于注入与单测）。 */
export type DiagnosticsResourceEntry = {
  name: string
  startTime: number
  requestStart: number
  duration: number
}

/** 单条请求样本。 */
export type DiagnosticsSample = {
  /** 请求路径（URL 的 pathname，解析失败时退化为原始 URL）。 */
  path: string
  /** 原始 URL。 */
  url: string
  /** 浏览器侧排队时长 `requestStart - startTime`（ms，负数按 0 计）。 */
  queueMs: number
  /** 请求总耗时（ms）。 */
  durationMs: number
}

/** 按路径聚合的统计。 */
export type DiagnosticsPathStat = {
  path: string
  count: number
  /** 累计排队时长（ms，即各次 queueMs 之和）。 */
  totalMs: number
  maxQueueMs: number
  maxDurationMs: number
}

export type DiagnosticsSummary = {
  /** 输入条目总数。 */
  total: number
  /** 命中 isTrackedUrl 的条目数。 */
  tracked: number
  /** 命中条目中的最大排队时长（ms）。 */
  maxQueueMs: number
  /** 排队超过阈值的样本，按排队时长降序，最多 slowQueueLimit 条。 */
  slowQueue: DiagnosticsSample[]
  /** 按路径聚合，按 maxQueueMs 降序。 */
  byPath: DiagnosticsPathStat[]
  /** 排队超过阈值的条目数（不受 slowQueue 条数限制影响）。 */
  queueWarnCount: number
}

export type SummarizeResourceEntriesOptions = {
  /** 同源判定基准（通常是 `location.href`）。 */
  base?: string
  /** 慢排队阈值（ms），默认 DIAGNOSTICS_SLOW_QUEUE_MS。 */
  slowQueueMs?: number
  /** slowQueue 返回条数上限，默认 10。 */
  slowQueueLimit?: number
  /** 自定义过滤（默认 isTrackedUrl(url, base)）。 */
  isTracked?: (url: string) => boolean
}

/** 是否采集：同源，或 hostname 为 localhost / 127.0.0.1 / ::1。 */
export function isTrackedUrl(url: string, base?: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false

  let target: URL
  try {
    target = base ? new URL(url, base) : new URL(url)
  } catch {
    return false
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false
  if (LOCAL_HOSTNAMES.has(target.hostname)) return true
  if (!base) return false

  try {
    return new URL(base).origin === target.origin
  } catch {
    return false
  }
}

/** 纯函数：汇总 PerformanceResourceTiming，只统计 isTrackedUrl 命中的条目。 */
export function summarizeResourceEntries(
  entries: readonly DiagnosticsResourceEntry[],
  options: SummarizeResourceEntriesOptions = {},
): DiagnosticsSummary {
  const slowQueueMs = options.slowQueueMs ?? DIAGNOSTICS_SLOW_QUEUE_MS
  const slowQueueLimit = options.slowQueueLimit ?? DIAGNOSTICS_REPORT_TOP_LIMIT * 2
  const isTracked = options.isTracked ?? ((url: string) => isTrackedUrl(url, options.base))

  let tracked = 0
  let maxQueueMs = 0
  let queueWarnCount = 0
  const slowQueue: DiagnosticsSample[] = []
  const byPath = new Map<string, DiagnosticsPathStat>()

  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string') continue
    if (!isTracked(entry.name)) continue

    tracked += 1
    const sample = toSample(entry)
    maxQueueMs = Math.max(maxQueueMs, sample.queueMs)
    accumulatePathStat(byPath, sample)

    if (sample.queueMs >= slowQueueMs) {
      queueWarnCount += 1
      insertTopSample(slowQueue, sample, slowQueueLimit, queueMetric)
    }
  }

  return {
    total: entries.length,
    tracked,
    maxQueueMs,
    slowQueue,
    byPath: sortPathStats(byPath),
    queueWarnCount,
  }
}

export type DiagnosticsConsole = {
  warn: (...args: unknown[]) => void
}

/** PerformanceObserver 回调参数的最小结构。 */
export type DiagnosticsObserverEntryList = {
  getEntries(): readonly unknown[]
}

/** PerformanceObserver 的最小结构（便于注入）。 */
export type DiagnosticsObserverHandle = {
  observe(options: { type: 'resource'; buffered?: boolean }): void
  disconnect(): void
}

export type DiagnosticsObserverFactory = (
  callback: (list: DiagnosticsObserverEntryList) => void,
) => DiagnosticsObserverHandle | null

export type BrowserConnectionDiagnosticsOptions = {
  /** 采集开关，默认取 `VITE_QUICKFORGE_DIAGNOSTICS !== '0'`。 */
  enabled?: boolean
  /** 同源判定基准，默认 `location.href`（不可用时忽略同源判定）。 */
  base?: string
  slowQueueMs?: number
  warnThrottleMs?: number
  slowSampleLimit?: number
  reportTopLimit?: number
  /** 计时来源，默认 globalThis.performance。 */
  performance?: { now(): number }
  /** PerformanceObserver 工厂，默认用全局 PerformanceObserver；不可用/传 null 时跳过排队采集。 */
  performanceObserver?: DiagnosticsObserverFactory | null
  /** 被包装的 fetch，默认 globalThis.fetch；传 null 表示不包装。 */
  fetch?: typeof fetch | null
  /** 告警输出，默认 globalThis.console。 */
  console?: DiagnosticsConsole
  setTimeout?: (handler: () => void, timeoutMs: number) => number
  clearTimeout?: (handle: number) => void
  /** 时钟（ms），默认 performance.now()。 */
  now?: () => number
  /** 自定义过滤，默认 isTrackedUrl(url, base)。 */
  isTracked?: (url: string) => boolean
}

export type BrowserConnectionDiagnosticsSession = {
  stop(): void
}

type DiagnosticsState = {
  enabled: boolean
  running: boolean
  slowQueueMs: number
  warnThrottleMs: number
  slowSampleLimit: number
  reportTopLimit: number
  totalEntries: number
  trackedEntries: number
  queueWarnCount: number
  maxQueueMs: number
  inFlight: number
  activeLongLived: number
  /** 最近慢排队样本（环形，最多 slowSampleLimit 条）。 */
  slowQueue: DiagnosticsSample[]
  /** 慢请求榜单（按 durationMs 降序，最多 reportTopLimit 条）。 */
  slowRequests: DiagnosticsSample[]
  byPath: Map<string, DiagnosticsPathStat>
  /** path -> 上次告警时间，用于节流。 */
  warnedAt: Map<string, number>
}

/** 当前（或最近一次）采集状态，供 formatDiagnosticsReport 读取。 */
let activeState: DiagnosticsState | null = null
/** 当前会话：重复 start 时复用，避免重复注册 observer。 */
let activeSession: BrowserConnectionDiagnosticsSession | null = null

const NOOP_SESSION: BrowserConnectionDiagnosticsSession = {
  stop: () => {
    // 采集关闭时无需清理
  },
}

/** 采集开关：`VITE_QUICKFORGE_DIAGNOSTICS=0` 关闭。 */
export function isBrowserDiagnosticsEnabled(): boolean {
  return import.meta.env?.VITE_QUICKFORGE_DIAGNOSTICS !== '0'
}

/**
 * 启动采集：PerformanceObserver 监听 resource 条目 + 包装 fetch 统计连接。
 * 重复调用复用同一会话（fetch 包装幂等）。
 */
export function startBrowserConnectionDiagnostics(
  options: BrowserConnectionDiagnosticsOptions = {},
): BrowserConnectionDiagnosticsSession {
  if (activeSession) return activeSession

  const enabled = options.enabled ?? isBrowserDiagnosticsEnabled()
  if (!enabled) return NOOP_SESSION

  const consoleImpl = options.console ?? globalThis.console
  const performanceImpl = options.performance ?? globalThis.performance
  const now =
    options.now ??
    (() => (performanceImpl && typeof performanceImpl.now === 'function' ? performanceImpl.now() : Date.now()))
  const schedule = options.setTimeout ?? defaultSchedule
  const cancel = options.clearTimeout ?? ((handle: number) => globalThis.clearTimeout(handle))
  const base = options.base ?? (typeof globalThis.location === 'undefined' ? undefined : globalThis.location.href)
  const isTracked = options.isTracked ?? ((url: string) => isTrackedUrl(url, base))

  const state: DiagnosticsState = {
    enabled: true,
    running: true,
    slowQueueMs: options.slowQueueMs ?? DIAGNOSTICS_SLOW_QUEUE_MS,
    warnThrottleMs: options.warnThrottleMs ?? DIAGNOSTICS_WARN_THROTTLE_MS,
    slowSampleLimit: options.slowSampleLimit ?? DIAGNOSTICS_SLOW_SAMPLE_LIMIT,
    reportTopLimit: options.reportTopLimit ?? DIAGNOSTICS_REPORT_TOP_LIMIT,
    totalEntries: 0,
    trackedEntries: 0,
    queueWarnCount: 0,
    maxQueueMs: 0,
    inFlight: 0,
    activeLongLived: 0,
    slowQueue: [],
    slowRequests: [],
    byPath: new Map<string, DiagnosticsPathStat>(),
    warnedAt: new Map<string, number>(),
  }
  activeState = state

  // --- resource 条目：排队时长采集与告警 ---------------------------------
  const handleEntry = (raw: unknown) => {
    const entry = raw as Partial<DiagnosticsResourceEntry> | null | undefined
    if (
      !entry ||
      typeof entry.name !== 'string' ||
      typeof entry.startTime !== 'number' ||
      typeof entry.duration !== 'number'
    ) {
      return
    }

    state.totalEntries += 1
    if (!isTracked(entry.name)) return
    state.trackedEntries += 1

    const sample = toSample({
      name: entry.name,
      startTime: entry.startTime,
      duration: entry.duration,
      requestStart: typeof entry.requestStart === 'number' ? entry.requestStart : 0,
    })

    state.maxQueueMs = Math.max(state.maxQueueMs, sample.queueMs)
    accumulatePathStat(state.byPath, sample)
    insertTopSample(state.slowRequests, sample, state.reportTopLimit, durationMetric)

    if (sample.queueMs >= state.slowQueueMs) {
      state.queueWarnCount += 1
      state.slowQueue.push(sample)
      if (state.slowQueue.length > state.slowSampleLimit) state.slowQueue.shift()
      warnSlowQueue(state, sample, consoleImpl, now())
    }
  }

  const observerFactory = options.performanceObserver === undefined ? createDefaultObserverFactory() : options.performanceObserver
  let observer: DiagnosticsObserverHandle | null = null
  if (observerFactory) {
    try {
      observer = observerFactory((list) => {
        for (const entry of list.getEntries()) handleEntry(entry)
      })
      observer?.observe({ type: 'resource', buffered: true })
    } catch {
      // observer 不可用（如沙箱/旧浏览器）时仍保留 fetch 连接统计
      observer = null
    }
  }

  // --- 告警节流表清理：避免长期运行时 Map 无限增长 ------------------------
  let pruneHandle: number | null = null
  const schedulePrune = () => {
    pruneHandle = schedule(() => {
      pruneHandle = null
      pruneExpiredWarnings(state, now())
      if (state.running) schedulePrune()
    }, DIAGNOSTICS_WARN_PRUNE_INTERVAL_MS)
  }
  schedulePrune()

  // --- fetch 包装：in-flight + 常驻长连接 ---------------------------------
  const restoreFetch = installFetchTracking(state, options)

  const session: BrowserConnectionDiagnosticsSession = {
    stop() {
      if (!state.running) return
      state.running = false
      try {
        observer?.disconnect()
      } catch {
        // disconnect 失败不影响停止流程
      }
      observer = null
      if (pruneHandle !== null) {
        cancel(pruneHandle)
        pruneHandle = null
      }
      restoreFetch?.()
      if (activeSession === session) activeSession = null
    },
  }
  activeSession = session
  return session
}

/** 生成可读的多行诊断报告（供 `window.__quickforgePerf()` 使用）。 */
export function formatDiagnosticsReport(): string {
  // 环境变量关闭优先于会话状态：此时 start 是 no-op，报告应明确显示采集已关闭
  if (!isBrowserDiagnosticsEnabled()) {
    return ['[QuickForge] 浏览器连接池诊断', '采集：已关闭（VITE_QUICKFORGE_DIAGNOSTICS=0）'].join('\n')
  }

  const state = activeState
  if (!state) {
    return ['[QuickForge] 浏览器连接池诊断', '采集：未启动（startBrowserConnectionDiagnostics() 尚未运行）'].join('\n')
  }

  const lines = [
    '[QuickForge] 浏览器连接池诊断',
    `采集：${state.running ? '运行中' : '已停止'}（排队阈值 ${state.slowQueueMs}ms，告警节流 ${state.warnThrottleMs}ms）`,
    `in-flight: ${state.inFlight} | activeLongLived: ${state.activeLongLived}`,
    `采样：命中 ${state.trackedEntries} / 共 ${state.totalEntries} 条 | 排队超阈值：${state.queueWarnCount} 次 | 最大排队：${roundMs(state.maxQueueMs)}ms`,
  ]

  const slowQueue = [...state.slowQueue].sort((left, right) => right.queueMs - left.queueMs).slice(0, state.reportTopLimit)
  lines.push(`慢排队 top ${slowQueue.length}（阈值 ${state.slowQueueMs}ms）：`)
  if (slowQueue.length === 0) {
    lines.push('  （无超过阈值的请求）')
  } else {
    slowQueue.forEach((sample, index) => {
      lines.push(`  ${index + 1}) ${sample.path} 排队 ${roundMs(sample.queueMs)}ms · 耗时 ${roundMs(sample.durationMs)}ms`)
    })
  }

  const slowRequests = state.slowRequests.slice(0, state.reportTopLimit)
  lines.push(`慢请求 top ${slowRequests.length}：`)
  if (slowRequests.length === 0) {
    lines.push('  （暂无采样）')
  } else {
    slowRequests.forEach((sample, index) => {
      lines.push(`  ${index + 1}) ${sample.path} 耗时 ${roundMs(sample.durationMs)}ms · 排队 ${roundMs(sample.queueMs)}ms`)
    })
  }

  const byPath = sortPathStats(state.byPath).slice(0, state.reportTopLimit)
  lines.push(`按路径 top ${byPath.length}：`)
  if (byPath.length === 0) {
    lines.push('  （暂无采样）')
  } else {
    byPath.forEach((stat, index) => {
      lines.push(
        `  ${index + 1}) ${stat.path} 次数 ${stat.count} · 累计排队 ${roundMs(stat.totalMs)}ms · 最大排队 ${roundMs(stat.maxQueueMs)}ms · 最大耗时 ${roundMs(stat.maxDurationMs)}ms`,
      )
    })
  }

  lines.push('提示：最大排队很大而耗时接近 → 浏览器侧排队；排队很小但耗时很长 → 服务端阻塞。')
  return lines.join('\n')
}

// --- 内部实现 ----------------------------------------------------------------

function toSample(entry: DiagnosticsResourceEntry): DiagnosticsSample {
  return {
    path: pathOf(entry.name),
    url: entry.name,
    queueMs: queueMsOf(entry),
    durationMs: Number.isFinite(entry.duration) ? Math.max(0, entry.duration) : 0,
  }
}

function queueMsOf(entry: DiagnosticsResourceEntry): number {
  if (!Number.isFinite(entry.startTime) || !Number.isFinite(entry.requestStart)) return 0
  // 跨域未带 Timing-Allow-Origin 时 requestStart 为 0：视为不可测量
  if (entry.requestStart <= 0) return 0
  return Math.max(0, entry.requestStart - entry.startTime)
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || url
  } catch {
    return url
  }
}

function accumulatePathStat(byPath: Map<string, DiagnosticsPathStat>, sample: DiagnosticsSample): void {
  const existing = byPath.get(sample.path)
  if (existing) {
    existing.count += 1
    existing.totalMs += sample.queueMs
    existing.maxQueueMs = Math.max(existing.maxQueueMs, sample.queueMs)
    existing.maxDurationMs = Math.max(existing.maxDurationMs, sample.durationMs)
    return
  }
  byPath.set(sample.path, {
    path: sample.path,
    count: 1,
    totalMs: sample.queueMs,
    maxQueueMs: sample.queueMs,
    maxDurationMs: sample.durationMs,
  })
}

function sortPathStats(byPath: Map<string, DiagnosticsPathStat>): DiagnosticsPathStat[] {
  return [...byPath.values()].sort(
    (left, right) => right.maxQueueMs - left.maxQueueMs || right.count - left.count || left.path.localeCompare(right.path),
  )
}

function queueMetric(sample: DiagnosticsSample): number {
  return sample.queueMs
}

function durationMetric(sample: DiagnosticsSample): number {
  return sample.durationMs
}

function insertTopSample(
  list: DiagnosticsSample[],
  sample: DiagnosticsSample,
  limit: number,
  metric: (sample: DiagnosticsSample) => number,
): void {
  if (limit <= 0) return
  if (list.length >= limit && metric(sample) <= metric(list[list.length - 1])) return
  list.push(sample)
  list.sort((left, right) => metric(right) - metric(left))
  if (list.length > limit) list.length = limit
}

function warnSlowQueue(
  state: DiagnosticsState,
  sample: DiagnosticsSample,
  consoleImpl: DiagnosticsConsole,
  at: number,
): void {
  const lastWarnAt = state.warnedAt.get(sample.path)
  if (lastWarnAt !== undefined && at - lastWarnAt < state.warnThrottleMs) return
  state.warnedAt.set(sample.path, at)
  consoleImpl.warn(
    `[QuickForge] 请求在浏览器侧排队 ${roundMs(sample.queueMs)}ms（阈值 ${state.slowQueueMs}ms）：${sample.path} · 耗时 ${roundMs(sample.durationMs)}ms` +
      ' — 若同时存在常驻长连接，可能是同源连接池耗尽',
  )
}

function pruneExpiredWarnings(state: DiagnosticsState, at: number): void {
  for (const [path, lastWarnAt] of state.warnedAt) {
    if (at - lastWarnAt >= state.warnThrottleMs) state.warnedAt.delete(path)
  }
}

function roundMs(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0
}

/** 默认计时器：优先 window.setTimeout（浏览器句柄为 number），Node 环境收敛为 number。 */
function defaultSchedule(handler: () => void, timeoutMs: number): number {
  if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
    return window.setTimeout(handler, timeoutMs)
  }
  return globalThis.setTimeout(handler, timeoutMs) as unknown as number
}

function createDefaultObserverFactory(): DiagnosticsObserverFactory | null {
  if (typeof PerformanceObserver === 'undefined') return null
  return (callback) => new PerformanceObserver((list) => callback(list))
}

function isLongLivedContentType(value: string | null): boolean {
  if (!value) return false
  const normalized = value.toLowerCase()
  return LONG_LIVED_CONTENT_TYPES.some((type) => normalized.includes(type))
}

function isWrappedFetch(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    (value as unknown as Record<string, unknown>)[FETCH_WRAPPED_FLAG] === true
  )
}

/**
 * 包装 fetch：透传参数与返回值（保留原 fetch 的 this 绑定），统计 in-flight 与常驻长连接。
 * 幂等：已包装过的 fetch 直接跳过；options.fetch 注入时同样包装它并写回全局，stop 时还原。
 */
function installFetchTracking(
  state: DiagnosticsState,
  options: BrowserConnectionDiagnosticsOptions,
): (() => void) | null {
  const fetchImpl =
    options.fetch !== undefined
      ? options.fetch
      : typeof globalThis.fetch === 'function'
        ? globalThis.fetch
        : null

  if (!fetchImpl || isWrappedFetch(fetchImpl)) return null

  const original = fetchImpl
  const wrapped = async function trackedFetch(
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    state.inFlight += 1
    let response: Response
    try {
      response = await original.call(this, input, init)
    } catch (error) {
      state.inFlight = Math.max(0, state.inFlight - 1)
      throw error
    }
    state.inFlight = Math.max(0, state.inFlight - 1)

    if (isLongLivedContentType(response?.headers?.get?.('content-type') ?? null)) {
      state.activeLongLived += 1
      watchStreamingResponse(response, state)
    }
    return response
  } as typeof fetch

  Object.defineProperty(wrapped, FETCH_WRAPPED_FLAG, { value: true, enumerable: false })

  try {
    globalThis.fetch = wrapped
  } catch {
    // 只读环境（部分沙箱）下忽略，连接统计退化为不可用
    return null
  }

  return () => {
    if (globalThis.fetch === wrapped) globalThis.fetch = original
  }
}

/** 通过克隆响应体观测流式响应何时结束，结束/异常时释放常驻长连接计数。 */
function watchStreamingResponse(response: Response, state: DiagnosticsState): void {
  const release = () => {
    state.activeLongLived = Math.max(0, state.activeLongLived - 1)
  }

  let clone: Response
  try {
    clone = response.clone()
  } catch {
    release()
    return
  }

  const body = clone.body
  if (!body || typeof body.getReader !== 'function') {
    release()
    return
  }

  const reader = body.getReader()
  void (async () => {
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
      }
    } catch {
      // 响应体中断/取消：同样视为连接已释放
    } finally {
      release()
    }
  })()
}
