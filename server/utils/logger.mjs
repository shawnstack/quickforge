import fs from 'node:fs'
import path from 'node:path'
import { logsDir } from '../storage.mjs'

// --- Level control ---
const LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 }
const levelNames = Object.keys(LEVELS)

const envLevel = (process.env.QUICKFORGE_LOG_LEVEL || '').toUpperCase()
const minLevel = LEVELS[envLevel] ?? LEVELS.INFO

function enabled(level) {
  return LEVELS[level] <= minLevel
}

// --- Timestamp ---
function timestamp() {
  return new Date().toISOString()
}

// --- Log file (daily rotation) ---
function logFile() {
  const date = new Date().toISOString().slice(0, 10)
  return path.join(logsDir, `server-${date}.log`)
}

// --- File write stream (async, buffered) ---
let stream = null
let streamDate = null
let flushTimer = null
const FLUSH_INTERVAL_MS = 5000
const pendingLines = []

function getStream() {
  const date = new Date().toISOString().slice(0, 10)
  if (stream && streamDate === date) return stream

  // Rotate: close old stream
  if (stream) {
    const old = stream
    stream = null
    streamDate = null
    try { old.end() } catch { /* ignore */ }
  }

  // Ensure log dir exists
  try { fs.mkdirSync(logsDir, { recursive: true }) } catch { /* ignore */ }

  stream = fs.createWriteStream(logFile(), { flags: 'a' })
  streamDate = date
  stream.on('error', () => { stream = null; streamDate = null })
  return stream
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    const s = getStream()
    if (pendingLines.length > 0) {
      const chunk = pendingLines.splice(0).join('')
      s.write(chunk)
    }
  }, FLUSH_INTERVAL_MS).unref()
}

// --- Formatting ---

/**
 * Format extra fields as key=value pairs for stderr.
 * Objects and arrays get JSON-stringified.
 */
function formatExtra(extra) {
  if (!extra || Object.keys(extra).length === 0) return ''
  const parts = []
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined || v === null) continue
    const val = typeof v === 'string' ? v : JSON.stringify(v)
    parts.push(`${k}=${val}`)
  }
  return parts.length > 0 ? ' ' + parts.join(' ') : ''
}

/**
 * Format args for structured logging:
 *   - If the first arg is a string, it's the message (msg).
 *   - If the last arg is a plain object, it's extra fields.
 *   - Everything in between is joined as message detail.
 *   - Error objects get .stack extracted.
 */
function parseArgs(args) {
  let msg = ''
  const extra = {}
  const msgParts = []

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (i === 0 && typeof a === 'string') {
      msg = a
    } else if (i === args.length - 1 && a !== null && typeof a === 'object' && !Array.isArray(a) && !(a instanceof Error)) {
      Object.assign(extra, a)
    } else if (a instanceof Error) {
      msgParts.push(a.stack || a.message)
    } else if (typeof a === 'string') {
      msgParts.push(a)
    } else if (a !== null && a !== undefined) {
      msgParts.push(JSON.stringify(a))
    }
  }

  if (msgParts.length > 0) {
    msg = msg ? `${msg} ${msgParts.join(' ')}` : msgParts.join(' ')
  }

  return { msg: msg || '', extra }
}

// --- Write ---
function writeLog(level, context, ...args) {
  if (!enabled(level)) return

  const ts = timestamp()
  const { msg, extra } = parseArgs(args)
  const merged = { ...context, ...extra }

  // stderr: human-readable
  const stderrLine = `${ts} [${level}] ${msg}${formatExtra(merged)}\n`
  process.stderr.write(stderrLine)

  // file: JSON Lines
  const jsonObj = { ts, level }
  if (msg) jsonObj.msg = msg
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== null) jsonObj[k] = v
  }
  const jsonLine = JSON.stringify(jsonObj) + '\n'

  try {
    pendingLines.push(jsonLine)
    scheduleFlush()
  } catch {
    // ignore write errors
  }
}

// --- Public API ---

function createLogger(context = {}) {
  return {
    error: (...args) => writeLog('ERROR', context, ...args),
    warn: (...args) => writeLog('WARN', context, ...args),
    info: (...args) => writeLog('INFO', context, ...args),
    debug: (...args) => writeLog('DEBUG', context, ...args),
    child: (extra) => createLogger({ ...context, ...extra }),
  }
}

/**
 * Flush pending log lines to disk synchronously (for graceful shutdown).
 */
export function flushLogger() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (pendingLines.length > 0) {
    const chunk = pendingLines.splice(0).join('')
    try {
      const s = getStream()
      s.write(chunk)
    } catch { /* ignore */ }
  }
  if (stream) {
    try { stream.end() } catch { /* ignore */ }
    stream = null
    streamDate = null
  }
}

export const logger = createLogger()
