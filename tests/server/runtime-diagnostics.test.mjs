import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('../../server/utils/logger.mjs', () => ({ logger: mocks.logger }))

const DIAGNOSTICS_ENV_KEYS = [
  'QUICKFORGE_DIAGNOSTICS',
  'QUICKFORGE_DIAGNOSTICS_INTERVAL_MS',
  'QUICKFORGE_DIAGNOSTICS_LAG_WARN_MS',
  'QUICKFORGE_DIAGNOSTICS_SLOW_REQUEST_MS',
]

const savedEnv = {}
for (const key of DIAGNOSTICS_ENV_KEYS) savedEnv[key] = process.env[key]

// The module freezes its env config at evaluation time, so every test loads a
// fresh module instance through vi.resetModules().
function applyEnv(env) {
  for (const key of DIAGNOSTICS_ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key]
    else process.env[key] = env[key]
  }
}

let loaded = null

async function loadDiagnostics(env = {}) {
  applyEnv(env)
  vi.resetModules()
  loaded = await import('../../server/runtime-diagnostics.mjs')
  return loaded
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(() => {
  loaded?.stopRuntimeDiagnostics()
  loaded = null
  applyEnv(savedEnv)
  vi.clearAllMocks()
  vi.resetModules()
})

describe('runtime diagnostics', () => {
  it('is enabled by default and exposes a complete snapshot', async () => {
    const diagnostics = await loadDiagnostics()

    expect(diagnostics.isRuntimeDiagnosticsEnabled()).toBe(true)

    const snapshot = diagnostics.getRuntimeDiagnosticsSnapshot({ sockets: 4 })
    expect(snapshot.enabled).toBe(true)
    expect(typeof snapshot.uptimeSec).toBe('number')
    expect(typeof snapshot.generatedAt).toBe('string')
    expect(snapshot.eventLoop).toMatchObject({
      resolutionMs: 20,
      intervalMs: 5000,
      samples: 0,
      lastMs: 0,
      p50Ms: 0,
      p99Ms: 0,
      maxMs: 0,
      meanMs: 0,
      lastSampleAt: null,
    })
    expect(snapshot.http).toMatchObject({
      inFlightCount: 0,
      streamingSettledCount: 0,
      inFlight: [],
      paths: [],
      slowRequests: [],
    })
    expect(snapshot.process.rss).toBeGreaterThan(0)
    expect(snapshot.process.heapUsed).toBeGreaterThan(0)
    expect(snapshot.process.heapTotal).toBeGreaterThan(0)
    expect(typeof snapshot.process.external).toBe('number')
    expect(snapshot.sockets).toBe(4)
    expect(snapshot.thresholds).toEqual({ lagWarnMs: 100, slowRequestMs: 1000 })

    expect(diagnostics.getRuntimeDiagnosticsSnapshot().sockets).toBeNull()
  })

  it('reads sampling interval and thresholds from env', async () => {
    const diagnostics = await loadDiagnostics({
      QUICKFORGE_DIAGNOSTICS_INTERVAL_MS: '250',
      QUICKFORGE_DIAGNOSTICS_LAG_WARN_MS: '40',
      QUICKFORGE_DIAGNOSTICS_SLOW_REQUEST_MS: '25',
    })

    const snapshot = diagnostics.getRuntimeDiagnosticsSnapshot()
    expect(snapshot.eventLoop.intervalMs).toBe(250)
    expect(snapshot.thresholds).toEqual({ lagWarnMs: 40, slowRequestMs: 25 })
  })

  it('falls back to defaults for invalid env values', async () => {
    const diagnostics = await loadDiagnostics({
      QUICKFORGE_DIAGNOSTICS_INTERVAL_MS: 'nope',
      QUICKFORGE_DIAGNOSTICS_LAG_WARN_MS: '-5',
      QUICKFORGE_DIAGNOSTICS_SLOW_REQUEST_MS: 'abc',
    })

    const snapshot = diagnostics.getRuntimeDiagnosticsSnapshot()
    expect(snapshot.eventLoop.intervalMs).toBe(5000)
    expect(snapshot.thresholds).toEqual({ lagWarnMs: 100, slowRequestMs: 1000 })
  })

  it.each(['0', 'false', 'off', 'no'])('is disabled by QUICKFORGE_DIAGNOSTICS=%s', async (value) => {
    const diagnostics = await loadDiagnostics({ QUICKFORGE_DIAGNOSTICS: value })

    expect(diagnostics.isRuntimeDiagnosticsEnabled()).toBe(false)
    expect(diagnostics.getRuntimeDiagnosticsSnapshot()).toEqual({ enabled: false })

    const handle = diagnostics.beginHttpRequest({ method: 'GET', path: '/api/health' })
    expect(handle.id).toBeNull()
    expect(diagnostics.endHttpRequest(handle, { status: 200 })).toBeNull()

    diagnostics.startRuntimeDiagnostics()
    diagnostics.stopRuntimeDiagnostics()
    expect(mocks.logger.warn).not.toHaveBeenCalled()
  })

  it('settles each request handle exactly once', async () => {
    const diagnostics = await loadDiagnostics()

    const handle = diagnostics.beginHttpRequest({ method: 'GET', path: '/api/health' })
    expect(diagnostics.getRuntimeDiagnosticsSnapshot().http.inFlightCount).toBe(1)

    const durationMs = diagnostics.endHttpRequest(handle, { status: 200 })
    expect(durationMs).toBeGreaterThanOrEqual(0)
    expect(diagnostics.endHttpRequest(handle, { status: 500 })).toBeNull()

    const snapshot = diagnostics.getRuntimeDiagnosticsSnapshot()
    expect(snapshot.http.inFlightCount).toBe(0)
    expect(snapshot.http.paths).toHaveLength(1)
    expect(snapshot.http.paths[0]).toMatchObject({
      path: '/api/health',
      count: 1,
      slowCount: 0,
      lastStatus: 200,
    })
  })

  it('reports in-flight requests with elapsed time', async () => {
    const diagnostics = await loadDiagnostics()

    diagnostics.beginHttpRequest({ method: 'POST', path: '/api/agent/chat' })
    await sleep(5)

    const snapshot = diagnostics.getRuntimeDiagnosticsSnapshot()
    expect(snapshot.http.inFlightCount).toBe(1)
    expect(snapshot.http.inFlight).toHaveLength(1)
    expect(snapshot.http.inFlight[0].method).toBe('POST')
    expect(snapshot.http.inFlight[0].path).toBe('/api/agent/chat')
    expect(snapshot.http.inFlight[0].elapsedMs).toBeGreaterThanOrEqual(5)
  })

  it('records slow requests, aggregates normalized paths and logs a warning', async () => {
    const diagnostics = await loadDiagnostics({ QUICKFORGE_DIAGNOSTICS_SLOW_REQUEST_MS: '1' })

    const handle = diagnostics.beginHttpRequest({ method: 'GET', path: '/api/sessions/42/messages' })
    await sleep(5)
    const durationMs = diagnostics.endHttpRequest(handle, { status: 200 })

    expect(durationMs).toBeGreaterThanOrEqual(1)

    const snapshot = diagnostics.getRuntimeDiagnosticsSnapshot()
    expect(snapshot.http.slowRequests).toHaveLength(1)
    expect(snapshot.http.slowRequests[0]).toMatchObject({
      method: 'GET',
      path: '/api/sessions/42/messages',
      status: 200,
      aborted: false,
    })
    expect(snapshot.http.paths).toHaveLength(1)
    expect(snapshot.http.paths[0]).toMatchObject({
      path: '/api/sessions/:id/messages',
      count: 1,
      slowCount: 1,
      lastStatus: 200,
    })

    expect(mocks.logger.warn).toHaveBeenCalledTimes(1)
    const [message, extra] = mocks.logger.warn.mock.calls[0]
    expect(message).toContain('Slow HTTP request GET /api/sessions/42/messages')
    expect(extra).toMatchObject({ method: 'GET', path: '/api/sessions/42/messages', status: 200 })
  })

  it('excludes streaming responses from slow requests and path stats', async () => {
    const diagnostics = await loadDiagnostics({ QUICKFORGE_DIAGNOSTICS_SLOW_REQUEST_MS: '1' })

    const handle = diagnostics.beginHttpRequest({ method: 'GET', path: '/api/agents/abc123def456/stream' })
    await sleep(5)
    const durationMs = diagnostics.endHttpRequest(handle, { status: 200, streaming: true })

    expect(durationMs).toBeGreaterThanOrEqual(1)

    const snapshot = diagnostics.getRuntimeDiagnosticsSnapshot()
    expect(snapshot.http.streamingSettledCount).toBe(1)
    expect(snapshot.http.slowRequests).toEqual([])
    expect(snapshot.http.paths).toEqual([])
    expect(mocks.logger.warn).not.toHaveBeenCalled()
  })

  it('keeps only the 20 most recent slow requests', async () => {
    const diagnostics = await loadDiagnostics({ QUICKFORGE_DIAGNOSTICS_SLOW_REQUEST_MS: '1' })

    for (let i = 0; i < 22; i += 1) {
      const handle = diagnostics.beginHttpRequest({ method: 'GET', path: `/api/sessions/${i}` })
      await sleep(2)
      diagnostics.endHttpRequest(handle, { status: 200 })
    }

    const snapshot = diagnostics.getRuntimeDiagnosticsSnapshot()
    expect(snapshot.http.slowRequests).toHaveLength(20)
    expect(snapshot.http.slowRequests[0].path).toBe('/api/sessions/2')
    expect(snapshot.http.slowRequests[19].path).toBe('/api/sessions/21')
  })

  it('drops new path keys once the 200-key cap is reached', async () => {
    const diagnostics = await loadDiagnostics()

    for (let i = 0; i < 200; i += 1) {
      const handle = diagnostics.beginHttpRequest({ method: 'GET', path: `/api/thing/route-${i}` })
      diagnostics.endHttpRequest(handle, { status: 200 })
    }
    // Beyond the cap: these would dominate the totalMs ordering if tracked.
    for (let i = 200; i < 205; i += 1) {
      const handle = diagnostics.beginHttpRequest({ method: 'GET', path: `/api/thing/route-${i}` })
      await sleep(5)
      diagnostics.endHttpRequest(handle, { status: 200 })
    }

    const snapshot = diagnostics.getRuntimeDiagnosticsSnapshot()
    expect(snapshot.http.paths).toHaveLength(20)
    for (const entry of snapshot.http.paths) {
      expect(Number(entry.path.split('-')[1])).toBeLessThan(200)
    }
  })

  it('normalizes dynamic path segments', async () => {
    const { normalizePathKey } = await loadDiagnostics()

    expect(normalizePathKey('/api/agents/abc123def456/stream')).toBe('/api/agents/:id/stream')
    expect(normalizePathKey('/api/terminal/sessions/42')).toBe('/api/terminal/sessions/:id')
    expect(normalizePathKey('/api/sessions/3f2504e0-4f89-11d3-9a0c-0305e82c3301/messages')).toBe('/api/sessions/:id/messages')
    expect(normalizePathKey('/api/sessions/42/messages?limit=10')).toBe('/api/sessions/:id/messages')
    expect(normalizePathKey('/api/health')).toBe('/api/health')
    expect(normalizePathKey('/api/agents/live-agent/stream')).toBe('/api/agents/live-agent/stream')
    expect(normalizePathKey('')).toBe('/')
  })

  it('samples event loop lag, warns once per throttle window and stops cleanly', async () => {
    // Threshold 0 makes the warn path deterministic: every sampling window
    // exceeds it, and the 30s throttle must still emit a single warning.
    const diagnostics = await loadDiagnostics({
      QUICKFORGE_DIAGNOSTICS_INTERVAL_MS: '50',
      QUICKFORGE_DIAGNOSTICS_LAG_WARN_MS: '0',
    })

    diagnostics.startRuntimeDiagnostics()
    diagnostics.startRuntimeDiagnostics()
    try {
      await sleep(200)

      const snapshot = diagnostics.getRuntimeDiagnosticsSnapshot()
      expect(snapshot.eventLoop.samples).toBeGreaterThan(0)
      expect(typeof snapshot.eventLoop.lastSampleAt).toBe('string')
      expect(snapshot.eventLoop.p99Ms).toBeGreaterThanOrEqual(0)

      const lagWarnings = mocks.logger.warn.mock.calls.filter(([message]) => message === 'Event loop lag high')
      expect(lagWarnings).toHaveLength(1)
      expect(lagWarnings[0][1]).toMatchObject({ intervalMs: 50 })
    } finally {
      diagnostics.stopRuntimeDiagnostics()
      diagnostics.stopRuntimeDiagnostics()
    }
  })
})
