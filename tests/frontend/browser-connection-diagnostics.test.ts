import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DIAGNOSTICS_WARN_THROTTLE_MS,
  formatDiagnosticsReport,
  isTrackedUrl,
  startBrowserConnectionDiagnostics,
  summarizeResourceEntries,
  type BrowserConnectionDiagnosticsOptions,
  type BrowserConnectionDiagnosticsSession,
  type DiagnosticsObserverEntryList,
  type DiagnosticsObserverFactory,
  type DiagnosticsResourceEntry,
} from '../../src/lib/browser-connection-diagnostics'

// --- Fakes -------------------------------------------------------------------

type FakeObserver = {
  callback: (list: DiagnosticsObserverEntryList) => void
  observed: { type: 'resource'; buffered?: boolean }[]
  disconnected: boolean
}

function createFakeObserver() {
  const observers: FakeObserver[] = []
  const factory: DiagnosticsObserverFactory = (callback) => {
    const observer: FakeObserver = { callback, observed: [], disconnected: false }
    observers.push(observer)
    return {
      observe(options) {
        observer.observed.push(options)
      },
      disconnect() {
        observer.disconnected = true
      },
    }
  }
  return {
    factory,
    observers,
    emit(entries: DiagnosticsResourceEntry[]) {
      for (const observer of observers) observer.callback({ getEntries: () => entries })
    },
  }
}

function entry(name: string, startTime: number, requestStart: number, duration: number): DiagnosticsResourceEntry {
  return { name, startTime, requestStart, duration }
}

function silentConsole() {
  return { warn: () => {} }
}

const sessions: BrowserConnectionDiagnosticsSession[] = []

/** 统一注入手动计时器，避免测试进程残留 prune 定时器。 */
function startDiagnostics(options: BrowserConnectionDiagnosticsOptions = {}): BrowserConnectionDiagnosticsSession {
  const session = startBrowserConnectionDiagnostics({
    console: silentConsole(),
    setTimeout: () => 0,
    clearTimeout: () => {},
    ...options,
  })
  sessions.push(session)
  return session
}

async function flushMacrotask() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  for (const session of sessions.splice(0)) session.stop()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

// --- 报告初始状态（必须保持在文件最前：其他用例启动采集后模块级状态会保留） --------

describe('formatDiagnosticsReport before start', () => {
  it('未启动时给出启动提示', () => {
    expect(formatDiagnosticsReport()).toContain('采集：未启动')
  })
})

// --- isTrackedUrl ------------------------------------------------------------

describe('isTrackedUrl', () => {
  it('同源或本机 hostname（不同端口）都命中', () => {
    expect(isTrackedUrl('/api/health', 'http://localhost:5176/')).toBe(true)
    expect(isTrackedUrl('http://localhost:5176/api/health', 'http://localhost:5176/')).toBe(true)
    // dev 下前端 :5176 与 API :32176 不同端口，按 hostname 判定
    expect(isTrackedUrl('http://localhost:32176/api/agents')).toBe(true)
    expect(isTrackedUrl('http://127.0.0.1:32176/api/agents')).toBe(true)
    expect(isTrackedUrl('http://[::1]:32176/api/agents')).toBe(true)
  })

  it('跨域、非 http 协议、非法地址与无 base 的相对路径都不命中', () => {
    expect(isTrackedUrl('https://cdn.example.com/x.js', 'http://localhost:5176/')).toBe(false)
    expect(isTrackedUrl('data:text/plain,hello', 'http://localhost:5176/')).toBe(false)
    expect(isTrackedUrl('blob:http://localhost:5176/abc', 'http://localhost:5176/')).toBe(false)
    expect(isTrackedUrl('not a url')).toBe(false)
    expect(isTrackedUrl('')).toBe(false)
    expect(isTrackedUrl('/api/health')).toBe(false)
  })
})

// --- summarizeResourceEntries ------------------------------------------------

describe('summarizeResourceEntries', () => {
  it('按 requestStart - startTime 计算排队时长，并过滤非同源条目', () => {
    const summary = summarizeResourceEntries(
      [
        entry('http://localhost:5176/api/slow', 100, 700, 900),
        entry('https://cdn.example.com/x.js', 100, 900, 1_000),
        entry('http://127.0.0.1:32176/api/fast', 0, 10, 20),
      ],
      { base: 'http://localhost:5176/' },
    )

    expect(summary.total).toBe(3)
    expect(summary.tracked).toBe(2)
    expect(summary.maxQueueMs).toBe(600)
    expect(summary.queueWarnCount).toBe(1)
    expect(summary.slowQueue).toHaveLength(1)
    expect(summary.slowQueue[0].path).toBe('/api/slow')
    expect(summary.slowQueue[0].queueMs).toBe(600)
    expect(summary.slowQueue[0].durationMs).toBe(900)
  })

  it('requestStart 不可测量（0）或早于 startTime 时排队按 0 计', () => {
    const summary = summarizeResourceEntries(
      [entry('http://localhost:5176/api/cached', 10, 0, 30), entry('http://localhost:5176/api/weird', 100, 50, 30)],
      { slowQueueMs: 1 },
    )

    expect(summary.maxQueueMs).toBe(0)
    expect(summary.queueWarnCount).toBe(0)
    expect(summary.slowQueue).toHaveLength(0)
  })

  it('按 path 聚合 count / 累计排队 / 最大排队 / 最大耗时', () => {
    const summary = summarizeResourceEntries(
      [
        entry('http://localhost:5176/api/a?x=1', 0, 100, 150),
        entry('http://localhost:5176/api/a?x=2', 0, 300, 500),
        entry('http://localhost:5176/api/b', 0, 10, 20),
      ],
      { slowQueueMs: 1_000 },
    )

    expect(summary.byPath.map((stat) => stat.path)).toEqual(['/api/a', '/api/b'])
    expect(summary.byPath[0]).toEqual({
      path: '/api/a',
      count: 2,
      totalMs: 400,
      maxQueueMs: 300,
      maxDurationMs: 500,
    })
    expect(summary.byPath[1]).toEqual({
      path: '/api/b',
      count: 1,
      totalMs: 10,
      maxQueueMs: 10,
      maxDurationMs: 20,
    })
  })

  it('slowQueue 按排队降序且受 slowQueueLimit 限制，queueWarnCount 不受限制', () => {
    const summary = summarizeResourceEntries(
      [
        entry('http://localhost:5176/api/a', 0, 600, 700),
        entry('http://localhost:5176/api/b', 0, 900, 1_000),
        entry('http://localhost:5176/api/c', 0, 800, 900),
      ],
      { slowQueueMs: 500, slowQueueLimit: 2 },
    )

    expect(summary.queueWarnCount).toBe(3)
    expect(summary.slowQueue.map((sample) => sample.path)).toEqual(['/api/b', '/api/c'])
  })
})

// --- startBrowserConnectionDiagnostics ---------------------------------------

describe('startBrowserConnectionDiagnostics', () => {
  it('采集 resource 条目并在排队超阈值时告警，同 path 30s 内只告警一次', () => {
    const observer = createFakeObserver()
    const warnings: unknown[][] = []
    let clock = 1_000
    const session = startDiagnostics({
      console: {
        warn: (...args: unknown[]) => {
          warnings.push(args)
        },
      },
      performanceObserver: observer.factory,
      now: () => clock,
      fetch: null,
    })

    expect(observer.observers).toHaveLength(1)
    expect(observer.observers[0].observed).toEqual([{ type: 'resource', buffered: true }])

    // 未超阈值：不告警
    observer.emit([entry('http://localhost:5176/api/fast', 0, 100, 120)])
    expect(warnings).toHaveLength(0)

    const slow = entry('http://localhost:5176/api/slow', 0, 900, 1_000)
    observer.emit([slow])
    expect(warnings).toHaveLength(1)
    expect(String(warnings[0][0])).toContain('/api/slow')
    expect(String(warnings[0][0])).toContain('排队 900ms')

    // 同一 path 在节流窗口内不再告警
    observer.emit([slow])
    expect(warnings).toHaveLength(1)

    // 其他 path 不受该 path 的节流影响
    observer.emit([entry('http://localhost:5176/api/other', 0, 700, 800)])
    expect(warnings).toHaveLength(2)

    // 超过节流窗口后同一 path 再次告警
    clock += DIAGNOSTICS_WARN_THROTTLE_MS
    observer.emit([slow])
    expect(warnings).toHaveLength(3)

    const report = formatDiagnosticsReport()
    expect(report).toContain('采集：运行中')
    expect(report).toContain('in-flight: 0')
    expect(report).toContain('activeLongLived: 0')
    expect(report).toContain('排队超阈值：4 次')
    expect(report).toContain('最大排队：900ms')
    expect(report).toContain('慢排队 top 4')
    expect(report).toContain('/api/slow 排队 900ms')
    expect(report).toContain('慢请求 top 5')
    expect(report).toContain('按路径 top 3')

    session.stop()
    expect(observer.observers[0].disconnected).toBe(true)
    expect(formatDiagnosticsReport()).toContain('采集：已停止')
  })

  it('包装 fetch：统计 in-flight 与常驻长连接，重复 start 幂等，stop 恢复原 fetch', async () => {
    const observer = createFakeObserver()
    let resolveFetch: ((response: Response) => void) | undefined
    const fakeFetch = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve
    }))
    vi.stubGlobal('fetch', fakeFetch)

    let closeStream: (() => void) | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: 1\n\n'))
        closeStream = () => controller.close()
      },
    })
    const sseResponse = new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } })

    const session = startDiagnostics({ performanceObserver: observer.factory })
    const wrappedFetch = globalThis.fetch
    expect(wrappedFetch).not.toBe(fakeFetch)

    const pending = wrappedFetch('/api/agents/events')
    expect(formatDiagnosticsReport()).toContain('in-flight: 1')

    resolveFetch?.(sseResponse)
    await pending
    expect(formatDiagnosticsReport()).toContain('in-flight: 0')
    expect(formatDiagnosticsReport()).toContain('activeLongLived: 1')

    // 重复 start：复用会话，不重复包装 fetch、不重复注册 observer
    const secondSession = startDiagnostics({ performanceObserver: observer.factory })
    expect(secondSession).toBe(session)
    expect(globalThis.fetch).toBe(wrappedFetch)
    expect(observer.observers).toHaveLength(1)

    // 响应体结束：常驻长连接释放
    closeStream?.()
    await flushMacrotask()
    expect(formatDiagnosticsReport()).toContain('activeLongLived: 0')

    session.stop()
    expect(globalThis.fetch).toBe(fakeFetch)
  })

  it('普通 JSON 响应不计入常驻长连接，且 fetch 参数透传', async () => {
    const observer = createFakeObserver()
    const fakeFetch = vi.fn(async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fakeFetch)

    startDiagnostics({ performanceObserver: observer.factory })
    const response = await globalThis.fetch('/api/health', { method: 'POST' })

    expect(await response.json()).toEqual({ ok: true })
    expect(fakeFetch).toHaveBeenCalledWith('/api/health', { method: 'POST' })
    expect(formatDiagnosticsReport()).toContain('in-flight: 0')
    expect(formatDiagnosticsReport()).toContain('activeLongLived: 0')
  })

  it('options.fetch 注入时包装注入实现，stop 后还原', async () => {
    const observer = createFakeObserver()
    // 占位全局 fetch：afterEach 的 unstubAllGlobals 会把它恢复回真实实现
    vi.stubGlobal('fetch', vi.fn())
    const injected = vi.fn(async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }))

    const session = startDiagnostics({ fetch: injected, performanceObserver: observer.factory })
    const wrappedFetch = globalThis.fetch
    expect(wrappedFetch).not.toBe(injected)

    await wrappedFetch('/api/health')
    expect(injected).toHaveBeenCalledTimes(1)
    expect(formatDiagnosticsReport()).toContain('in-flight: 0')

    session.stop()
    expect(globalThis.fetch).toBe(injected)
  })

  it('fetch 不可用时跳过包装且不抛错', () => {
    const observer = createFakeObserver()
    vi.stubGlobal('fetch', undefined)

    const session = startDiagnostics({ performanceObserver: observer.factory })

    expect(globalThis.fetch).toBeUndefined()
    expect(() => session.stop()).not.toThrow()
  })

  it('VITE_QUICKFORGE_DIAGNOSTICS=0 时 start 直接 no-op', () => {
    vi.stubEnv('VITE_QUICKFORGE_DIAGNOSTICS', '0')
    const observer = createFakeObserver()
    const fakeFetch = vi.fn()
    vi.stubGlobal('fetch', fakeFetch)

    const session = startDiagnostics({ performanceObserver: observer.factory })

    expect(observer.observers).toHaveLength(0)
    expect(globalThis.fetch).toBe(fakeFetch)
    expect(formatDiagnosticsReport()).toContain('采集：已关闭')
    expect(() => session.stop()).not.toThrow()
  })

  it('enabled: false 时同样不采集', () => {
    const observer = createFakeObserver()
    const fakeFetch = vi.fn()
    vi.stubGlobal('fetch', fakeFetch)

    const session = startDiagnostics({ enabled: false, performanceObserver: observer.factory })

    expect(observer.observers).toHaveLength(0)
    expect(globalThis.fetch).toBe(fakeFetch)
    expect(() => session.stop()).not.toThrow()
  })
})

// --- Source contracts --------------------------------------------------------

const mainSource = readFileSync(new URL('../../src/main.tsx', import.meta.url), 'utf8')

describe('browser diagnostics source contracts', () => {
  it('main.tsx 在 patchThinkingSelector 之后接线 start 与 window.__quickforgePerf', () => {
    expect(mainSource).toContain('startBrowserConnectionDiagnostics()')
    expect(mainSource).toContain('__quickforgePerf')
    expect(mainSource).toContain('formatDiagnosticsReport()')
    expect(mainSource.indexOf('patchThinkingSelector({ hideSelector: true })')).toBeLessThan(
      mainSource.indexOf('startBrowserConnectionDiagnostics()'),
    )
  })
})
