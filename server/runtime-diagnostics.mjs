import { monitorEventLoopDelay } from 'node:perf_hooks'
import { logger } from './utils/logger.mjs'

// --- Configuration (read once at module load, then frozen) ---
// Diagnostics are on by default; an explicit falsy value turns collection off.
const disabledValues = new Set(['0', 'false', 'off', 'no'])

// Sampling interval must be > 0; thresholds may be 0 (warn on every window).
function msFromEnv(name, fallback, { allowZero = false } = {}) {
  const value = Number(process.env[name])
  const valid = Number.isFinite(value) && (allowZero ? value >= 0 : value > 0)
  return valid ? Math.floor(value) : fallback
}

const diagnosticsEnabled = !disabledValues.has(String(process.env.QUICKFORGE_DIAGNOSTICS ?? '').trim().toLowerCase())
const eventLoopIntervalMs = msFromEnv('QUICKFORGE_DIAGNOSTICS_INTERVAL_MS', 5000)
const lagWarnMs = msFromEnv('QUICKFORGE_DIAGNOSTICS_LAG_WARN_MS', 100, { allowZero: true })
const slowRequestMs = msFromEnv('QUICKFORGE_DIAGNOSTICS_SLOW_REQUEST_MS', 1000, { allowZero: true })

const EVENT_LOOP_RESOLUTION_MS = 20
const LAG_WARN_THROTTLE_MS = 30_000
const MAX_PATH_KEYS = 200
const MAX_SLOW_REQUESTS = 20
const MAX_SNAPSHOT_PATHS = 20

// --- State ---
let histogram = null
let sampleTimer = null
let lastLagWarnAtMs = 0
let requestSeq = 0
// Cumulative count of settled streaming responses (SSE / NDJSON). This is NOT
// the number of currently open streams — in-flight long-lived requests stay in
// `inFlight` until they close, and the live socket/stream counts come from the
// snapshot's `sockets` / `sse.globalStreams` fields.
let streamingSettledCount = 0

const eventLoopStats = {
  resolutionMs: EVENT_LOOP_RESOLUTION_MS,
  intervalMs: eventLoopIntervalMs,
  samples: 0,
  lastMs: 0,
  minMs: 0,
  p50Ms: 0,
  p99Ms: 0,
  maxMs: 0,
  meanMs: 0,
  lastSampleAt: null,
}

// In-flight requests: id → { method, path, startedAtMs }.
const inFlight = new Map()
// Aggregated per-normalized-path timings (bounded key count).
const pathStats = new Map()
// Recent slow (non-streaming) requests, newest last (ring buffer).
const slowRequests = []

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX_PATTERN = /^[0-9a-f]{8,}$/i
const NUMERIC_PATTERN = /^\d+$/

/**
 * Collapse dynamic path segments so stats aggregate per route instead of per id:
 *   /api/agents/<id>/stream      → /api/agents/:id/stream
 *   /api/terminal/sessions/<id>  → /api/terminal/sessions/:id
 * Query strings and fragments are stripped.
 */
export function normalizePathKey(pathname) {
  if (typeof pathname !== 'string' || pathname.length === 0) return '/'
  const withoutQuery = pathname.split('?')[0].split('#')[0]
  if (!withoutQuery) return '/'
  const normalized = withoutQuery.split('/').map((segment) => {
    if (!segment) return segment
    if (NUMERIC_PATTERN.test(segment) || UUID_PATTERN.test(segment) || HEX_PATTERN.test(segment)) return ':id'
    return segment
  })
  return normalized.join('/')
}

export function isRuntimeDiagnosticsEnabled() {
  return diagnosticsEnabled
}

// perf_hooks reports event loop delays in nanoseconds; expose milliseconds.
function nsToMs(value) {
  return Number.isFinite(value) ? Math.round(value / 1e4) / 100 : 0
}

function sampleEventLoopLag() {
  if (!histogram) return
  const hasSamples = histogram.count > 0
  const minMs = hasSamples ? nsToMs(histogram.min) : 0
  const maxMs = hasSamples ? nsToMs(histogram.max) : 0
  const meanMs = hasSamples ? nsToMs(histogram.mean) : 0
  const p50Ms = hasSamples ? nsToMs(histogram.percentile(50)) : 0
  const p99Ms = hasSamples ? nsToMs(histogram.percentile(99)) : 0
  histogram.reset()

  eventLoopStats.samples += 1
  // lastMs mirrors the mean delay of the most recent sampling window.
  eventLoopStats.lastMs = meanMs
  eventLoopStats.minMs = minMs
  eventLoopStats.p50Ms = p50Ms
  eventLoopStats.p99Ms = p99Ms
  eventLoopStats.maxMs = maxMs
  eventLoopStats.meanMs = meanMs
  eventLoopStats.lastSampleAt = new Date().toISOString()

  if (p99Ms >= lagWarnMs) {
    const now = Date.now()
    if (now - lastLagWarnAtMs >= LAG_WARN_THROTTLE_MS) {
      lastLagWarnAtMs = now
      logger.warn('Event loop lag high', { p99Ms, maxMs, intervalMs: eventLoopIntervalMs })
    }
  }
}

export function startRuntimeDiagnostics() {
  if (!diagnosticsEnabled || sampleTimer) return
  try {
    histogram = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS })
    // Older/newer Node builds differ on whether the histogram starts enabled.
    histogram.enable()
  } catch {
    histogram = null
    return
  }
  sampleTimer = setInterval(sampleEventLoopLag, eventLoopIntervalMs)
  sampleTimer.unref?.()
}

export function stopRuntimeDiagnostics() {
  if (sampleTimer) {
    clearInterval(sampleTimer)
    sampleTimer = null
  }
  if (histogram) {
    try { histogram.disable() } catch { /* ignore */ }
    histogram = null
  }
}

/**
 * Register an in-flight request. Returns a handle that must be passed to
 * endHttpRequest exactly once (extra calls are ignored).
 */
export function beginHttpRequest({ method, path } = {}) {
  const startedAtMs = Date.now()
  if (!diagnosticsEnabled) return { id: null, startedAtMs }
  requestSeq += 1
  const id = requestSeq
  inFlight.set(id, { method: method || 'GET', path: path || '/', startedAtMs })
  return { id, startedAtMs }
}

function recordPathStat(pathKey, durationMs, status) {
  let stats = pathStats.get(pathKey)
  if (!stats) {
    if (pathStats.size >= MAX_PATH_KEYS) return
    stats = { count: 0, totalMs: 0, maxMs: 0, slowCount: 0, lastDurationMs: 0, lastStatus: null }
    pathStats.set(pathKey, stats)
  }
  stats.count += 1
  stats.totalMs += durationMs
  if (durationMs > stats.maxMs) stats.maxMs = durationMs
  stats.lastDurationMs = durationMs
  stats.lastStatus = status ?? null
  if (durationMs >= slowRequestMs) stats.slowCount += 1
}

function recordSlowRequest({ method, path, status, durationMs, aborted }) {
  slowRequests.push({
    at: new Date().toISOString(),
    method,
    path,
    status: status ?? null,
    durationMs,
    aborted: aborted === true,
  })
  while (slowRequests.length > MAX_SLOW_REQUESTS) slowRequests.shift()
}

/**
 * Settle a request started with beginHttpRequest. Streaming responses (SSE /
 * NDJSON) only bump streamingSettledCount: they are long-lived by design, so counting
 * them as slow requests or folding them into per-path durations would be noise.
 */
export function endHttpRequest(handle, { status, streaming, aborted } = {}) {
  if (!diagnosticsEnabled || !handle || handle.id === null || handle.id === undefined) return null
  const entry = inFlight.get(handle.id)
  if (!entry) return null
  inFlight.delete(handle.id)

  const durationMs = Date.now() - entry.startedAtMs

  if (streaming === true) {
    streamingSettledCount += 1
    return durationMs
  }

  recordPathStat(normalizePathKey(entry.path), durationMs, status)

  if (durationMs >= slowRequestMs) {
    logger.warn(`Slow HTTP request ${entry.method} ${entry.path} ${durationMs}ms`, {
      method: entry.method,
      path: entry.path,
      status,
      durationMs,
    })
    recordSlowRequest({ method: entry.method, path: entry.path, status, durationMs, aborted })
  }

  return durationMs
}

export function getRuntimeDiagnosticsSnapshot({ sockets } = {}) {
  if (!diagnosticsEnabled) return { enabled: false }

  const now = Date.now()
  const memory = process.memoryUsage()
  const paths = [...pathStats.entries()]
    .map(([path, stats]) => ({ path, ...stats }))
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, MAX_SNAPSHOT_PATHS)

  return {
    enabled: true,
    uptimeSec: Math.round(process.uptime()),
    generatedAt: new Date(now).toISOString(),
    eventLoop: { ...eventLoopStats },
    http: {
      inFlightCount: inFlight.size,
      streamingSettledCount,
      inFlight: [...inFlight.values()].map((entry) => ({
        method: entry.method,
        path: entry.path,
        elapsedMs: now - entry.startedAtMs,
      })),
      paths,
      slowRequests: [...slowRequests],
    },
    process: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
    },
    sockets: sockets ?? null,
    thresholds: { lagWarnMs, slowRequestMs },
  }
}
