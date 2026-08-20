#!/usr/bin/env node
/**
 * F9 phase 1 benchmark — whole-body session messages storage.
 *
 * Decision-first: before splitting `messages` out of the session body, measure
 * whether whole-body read/write/transport is a user-perceptible bottleneck.
 * This script runs against an isolated mkdtemp data dir ONLY and never touches
 * the real ~/.quickforge. It is a developer tool; it does not enter runtime or
 * regular CI.
 *
 * Metrics per scale (message count):
 *  - saveMs:      authoritative saveSessionStatePair single commit
 *                 (synchronize + canonical JSON serialize + SHA-256 digest +
 *                  BEGIN IMMEDIATE INSERT INTO sessions +
 *                  session_messages row extraction — storage v2)
 *  - encodeMs:    canonical JSON + digest portion alone (replicates the
 *                 repository jsonAndDigest algorithm for decomposition)
 *  - readMs:      readSessionStateValue full-state deserialization
 *                 (SQL SELECT + JSON.parse of body_json + message rows)
 *  - stateBytes / sseStateBytes: GET /state wire bytes and the SSE initial
 *                 `event: state` frame bytes (transport amplification)
 *  - jsonWriteMs: v1 JSON layout write via the offline escape-hatch writer
 *                 writeSessionStateJsonBody (pretty JSON, tmp + rename
 *                 atomic write) — storage v2 keeps SQLite authoritative
 *  - messagesShare / split elimination estimates: share of bytes that
 *                 incremental message storage would remove from the body
 *
 * Usage:
 *   node scripts/session-message-benchmark.mjs [count...] [--contentChars N] [--runs N] [--reads N]
 *
 * Examples:
 *   node scripts/session-message-benchmark.mjs                        # 500 2000 (defaults)
 *   node scripts/session-message-benchmark.mjs 100 500 2000 5000 --runs 3
 *
 * Output: one JSON line per scale + a meta line + a decision line on stdout;
 * a readable summary on stderr.
 */

import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const SAVE_MS_THRESHOLD = 100
const READ_MS_THRESHOLD = 100
const TRANSPORT_BYTES_THRESHOLD = 1024 * 1024
const DEFAULT_CONTENT_CHARS = 512
const DEFAULT_RUNS = 5
const DEFAULT_READS = 10
const DEFAULT_COUNTS = [500, 2000]

const WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
  'magna', 'aliqua', 'enim', 'minim', 'veniam', 'quis', 'nostrud', 'exercitation',
  'ullamco', 'laboris', 'nisi', 'aliquip', 'commodo', 'consequat',
]

function parseArgs() {
  const positional = []
  let contentChars = DEFAULT_CONTENT_CHARS
  let runs = DEFAULT_RUNS
  let reads = DEFAULT_READS
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--contentChars' || arg === '--content-chars') contentChars = Number(args[++index]) || DEFAULT_CONTENT_CHARS
    else if (arg === '--runs') runs = Number(args[++index]) || DEFAULT_RUNS
    else if (arg === '--reads') reads = Number(args[++index]) || DEFAULT_READS
    else if (/^\d+$/.test(arg)) positional.push(Number(arg))
  }
  const counts = positional.filter((value) => Number.isSafeInteger(value) && value > 0)
  if (counts.length === 0) counts.push(...DEFAULT_COUNTS)
  return { counts, contentChars, runs, reads }
}

// Storage v2 note: the benchmark initializes SQLite through the process-wide
// initializeSqliteStorage (see main below) because session-state-service
// resolves its repository through getSqliteStorage() internally — a bare
// DatabaseSync handle is no longer enough even with an injected repository.

function elapsedMs(start) {
  return Number(process.hrtime.bigint() - start) / 1_000_000
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function fillerText(index, chars) {
  let text = `[m${index}] `
  while (text.length < chars) text += `${WORDS[(text.length + index) % WORDS.length]} `
  return text.slice(0, chars)
}

function buildMessages(count, charsPerMessage, startTime) {
  const messages = []
  for (let index = 0; index < count; index += 1) {
    messages.push({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text: fillerText(index, charsPerMessage) }],
      timestamp: startTime + index * 1000,
    })
  }
  return messages
}

function buildState(sessionId, messages, stateVersion) {
  const now = new Date().toISOString()
  return {
    id: sessionId,
    scope: 'global',
    stateVersion,
    title: `Benchmark session (${messages.length} messages)`,
    createdAt: now,
    lastModified: now,
    updatedAt: now,
    messages,
  }
}

function buildMetadata(sessionId, messages, stateVersion) {
  const now = new Date().toISOString()
  return {
    id: sessionId,
    scope: 'global',
    stateVersion,
    title: `Benchmark session (${messages.length} messages)`,
    messageCount: messages.length,
    createdAt: now,
    lastModified: now,
  }
}

// Replicates the canonical JSON + SHA-256 digest step of the repository
// (session-state-repository.mjs jsonAndDigest) so we can decompose the save
// cost into "serialization+digest" vs "SQLite commit + fixed overhead".
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function encodeAndDigest(value) {
  const parsed = JSON.parse(JSON.stringify(value))
  const json = JSON.stringify(canonicalize(parsed))
  return { json, digest: createHash('sha256').update(json).digest('hex') }
}

// Replicates the SSE writer framing in server/routes/agent.mjs writeSseEvent.
function sseFrameBytes(event, data) {
  const payload = JSON.stringify(data)
  const lines = payload.split('\n')
  let bytes = Buffer.byteLength(`event: ${event}\n`, 'utf8')
  for (const line of lines) bytes += Buffer.byteLength(`data: ${line}\n`, 'utf8')
  bytes += 2 // trailing blank line (\n\n)
  return bytes
}

function measureSaves(save, sessionId, state, metadata, runs) {
  const timings = []
  let saved = null
  for (let run = 0; run < runs; run += 1) {
    const version = run + 1
    const start = process.hrtime.bigint()
    saved = save({
      state: buildState(sessionId, state.messages, version),
      metadata: buildMetadata(sessionId, state.messages, version),
      expectedRevision: saved?.revision ?? null,
    })
    timings.push(elapsedMs(start))
  }
  return { timings, saved }
}

function measureReads(read, sessionId, reads) {
  const timings = []
  for (let run = 0; run < reads; run += 1) {
    const start = process.hrtime.bigint()
    read(sessionId)
    timings.push(elapsedMs(start))
  }
  return timings
}

async function measureJsonWrites(write, sessionId, state, runs) {
  const timings = []
  for (let run = 0; run < runs; run += 1) {
    const start = process.hrtime.bigint()
    await write(sessionId, state)
    timings.push(elapsedMs(start))
  }
  return timings
}

async function main() {
  const { counts, contentChars, runs, reads } = parseArgs()

  const directory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-session-message-benchmark-'))
  // Route every storage path (storage.mjs dataDir AND the process-wide SQLite
  // handle) into the isolated scratch dir BEFORE any project module loads.
  // All project imports are dynamic for this reason: server/utils/logger.mjs
  // statically imports storage.mjs, so a static import would evaluate
  // storage.mjs with the parent environment's QUICKFORGE_DATA_DIR
  // (potentially the real data dir).
  process.env.QUICKFORGE_DATA_DIR = directory
  const [{ initializeSqliteStorage, closeSqliteStorage }, { createSessionStateRepository }, { configureSessionStateService, readSessionStateValue, saveSessionStatePair }, { writeSessionStateJsonBody }] = await Promise.all([
    import('../server/sqlite/database.mjs'),
    import('../server/sqlite/session-state-repository.mjs'),
    import('../server/session-state-service.mjs'),
    import('../server/storage.mjs'),
  ])

  const rows = []
  let schemaVersion = null
  try {
    for (const count of counts) {
      // Storage v2: session-state-service resolves its repository through the
      // process-wide getSqliteStorage(), so the benchmark must initialize (and
      // close) SQLite through initializeSqliteStorage per scale — a bare
      // DatabaseSync handle is no longer enough even with an injected
      // repository.
      const storage = await initializeSqliteStorage({ databasePath: path.join(directory, `bench-${count}.sqlite3`) })
      try {
        schemaVersion = storage.health().schemaVersion
        const repository = createSessionStateRepository(storage)
        configureSessionStateService({ repository })

        const sessionId = `bench-${count}`
        const startTime = Date.UTC(2026, 0, 1)
        const messages = buildMessages(count, contentChars, startTime)
        const state = buildState(sessionId, messages, 1)
        const metadata = buildMetadata(sessionId, messages, 1)

        const encodeStart = process.hrtime.bigint()
        const encoded = encodeAndDigest(state)
        const encodeMs = elapsedMs(encodeStart)

        const { timings: saveTimings } = measureSaves(saveSessionStatePair, sessionId, state, metadata, runs)
        const saveMs = median(saveTimings)

        const readTimings = measureReads(readSessionStateValue, sessionId, reads)
        const readMs = median(readTimings)

        const stateJson = JSON.stringify(state)
        const stateBytes = Buffer.byteLength(stateJson, 'utf8')
        const sseStateBytes = sseFrameBytes('state', state)
        const messagesBytes = Buffer.byteLength(JSON.stringify(messages), 'utf8')
        const mirrorJsonBytes = Buffer.byteLength(`${JSON.stringify(state, null, 2)}\n`, 'utf8')
        const canonicalJsonBytes = Buffer.byteLength(encoded.json, 'utf8')
        const messagesShare = stateBytes === 0 ? 0 : messagesBytes / stateBytes

        // v1 JSON layout write — storage v2 keeps SQLite authoritative, so the
        // JSON write under measurement is the offline escape-hatch writer
        // (per-session body file, pretty JSON, tmp + rename atomic write).
        const bucket = { scope: 'global', projectId: null }
        const jsonWriteTimings = await measureJsonWrites(async (writeSessionId, writeState) => {
          await writeSessionStateJsonBody(bucket, writeSessionId, writeState)
        }, sessionId, state, runs)
        const jsonWriteMs = median(jsonWriteTimings)

        const row = {
          benchmark: 'session-message-storage',
          kind: 'scale',
          messageCount: count,
          estimatedTokens: Math.round(messages.reduce((sum, message) => sum + message.content.reduce((acc, part) => acc + (part.text?.length || 0), 0), 0) / 4),
          stateBytes,
          sseStateBytes,
          canonicalJsonBytes,
          mirrorJsonBytes,
          messagesBytes,
          messagesShare,
          saveMs: round1(saveMs),
          saveMsMin: round1(Math.min(...saveTimings)),
          saveMsMax: round1(Math.max(...saveTimings)),
          encodeMs: round1(encodeMs),
          sqliteCommitMs: round1(saveMs - encodeMs),
          readMs: round1(readMs),
          readMsMin: round1(Math.min(...readTimings)),
          readMsMax: round1(Math.max(...readTimings)),
          jsonWriteMs: round1(jsonWriteMs),
          thresholds: {
            saveMs: SAVE_MS_THRESHOLD,
            readMs: READ_MS_THRESHOLD,
            transportBytes: TRANSPORT_BYTES_THRESHOLD,
          },
          exceeded: {
            saveMs: saveMs > SAVE_MS_THRESHOLD,
            readMs: readMs > READ_MS_THRESHOLD,
            transport: stateBytes > TRANSPORT_BYTES_THRESHOLD,
          },
          splitElimination: {
            serializationShare: round4(messagesShare),
            saveTimeLowerBound: round4(messagesShare * (encodeMs / saveMs)),
          },
        }
        // F9 Phase 3: measure the lightweight state frame a split session
        // ships after the messages move into session_messages (summary instead
        // of the full list) and the incremental message_end frame. Storage v2
        // splits EVERY session, so a fresh save of any size exercises the
        // message-row path.
        {
          const splitCount = Math.max(count, 2)
          const splitMessages = buildMessages(splitCount, contentChars, startTime)
          const splitId = `bench-split-${count}`
          saveSessionStatePair({
            state: buildState(splitId, splitMessages, 1),
            metadata: buildMetadata(splitId, splitMessages, 1),
          })
          const splitState = { ...buildState(splitId, splitMessages, 2), messages: undefined, messagesSummary: { count: splitCount } }
          const splitStateBytes = sseFrameBytes('state', splitState)
          const appended = buildMessages(Math.max(2, Math.min(5, splitCount)), splitCount, startTime)
          const splitAppendBytes = sseFrameBytes('message_end', {
            type: 'message_end',
            messages: appended,
            messagesAfter: splitCount,
            messagesIncremental: true,
            stateVersion: 2,
          })
          row.splitStateBytes = splitStateBytes
          row.splitAppendBytes = splitAppendBytes
          row.stateFrameSavingsBytes = stateBytes - splitStateBytes
          row.stateFrameReduction = round4(stateBytes === 0 ? 0 : 1 - splitStateBytes / stateBytes)
        }
        rows.push(row)
        process.stdout.write(`${JSON.stringify(row)}\n`)
      } finally {
        await closeSqliteStorage().catch(() => {})
        configureSessionStateService({ repository: null })
      }
    }

    const decision = makeDecision(rows)
    process.stdout.write(`${JSON.stringify({
      benchmark: 'session-message-storage',
      kind: 'meta',
      scratchDir: directory,
      schemaVersion,
      sqliteVersion: process.versions.sqlite,
      contentChars,
      runs,
      reads,
    })}\n`)
    process.stdout.write(`${JSON.stringify(decision)}\n`)
    writeSummary(rows, decision)
  } finally {
    configureSessionStateService({ repository: null })
    await closeSqliteStorage().catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
}

function makeDecision(rows) {
  const worstSave = rows.reduce((max, row) => Math.max(max, row.saveMs), 0)
  const worstRead = rows.reduce((max, row) => Math.max(max, row.readMs), 0)
  const worstTransportBytes = rows.reduce((max, row) => Math.max(max, row.stateBytes), 0)
  const saveExceeded = rows.some((row) => row.exceeded.saveMs)
  const readExceeded = rows.some((row) => row.exceeded.readMs)
  const transportExceeded = rows.some((row) => row.exceeded.transport)
  const splitJustified = saveExceeded || readExceeded || transportExceeded
  return {
    benchmark: 'session-message-storage',
    kind: 'decision',
    worstSaveMs: round1(worstSave),
    worstReadMs: round1(worstRead),
    worstTransportBytes: worstTransportBytes,
    userPerceptible: { saveMs: saveExceeded, readMs: readExceeded, transport: transportExceeded },
    recommendation: splitJustified ? 'split-messages-justified' : 'no-evidence-keep-whole-body',
    rationale: splitJustified
      ? `Whole-body messages exceed a user-perceptible threshold (save>${SAVE_MS_THRESHOLD}ms / read>${READ_MS_THRESHOLD}ms / wire>1MB).`
      : `No measured scale exceeded a user-perceptible threshold (save<=${SAVE_MS_THRESHOLD}ms, read<=${READ_MS_THRESHOLD}ms, wire<=1MB); splitting messages is not justified by data.`,
  }
}

function writeSummary(rows, decision) {
  const lines = []
  lines.push('=== session-message-storage benchmark (readable summary) ===')
  lines.push('scale    tokens≈   save(ms)   read(ms)  GET bytes   SSE bytes   mirror bytes  JSON写(ms)  msgs占比  save拆分下界  SSE拆分帧  增量帧')
  for (const row of rows) {
    lines.push(
      `${String(row.messageCount).padStart(6)} ${String(row.estimatedTokens).padStart(8)} ${row.saveMs.toFixed(1).padStart(8)} ${row.readMs.toFixed(1).padStart(8)} ${formatBytes(row.stateBytes).padStart(10)} ${formatBytes(row.sseStateBytes).padStart(10)} ${formatBytes(row.mirrorJsonBytes).padStart(12)} ${row.jsonWriteMs.toFixed(1).padStart(8)} ${(row.messagesShare * 100).toFixed(1).padStart(6)}% ${(row.splitElimination.saveTimeLowerBound * 100).toFixed(1).padStart(7)}% ${formatBytes(row.splitStateBytes).padStart(10)} ${formatBytes(row.splitAppendBytes).padStart(8)}`,
    )
  }
  lines.push('')
  lines.push(`阈值: 单次保存/读取 > ${SAVE_MS_THRESHOLD}ms, 单会话传输 > 1MB`)
  lines.push(`最差: save ${decision.worstSaveMs}ms / read ${decision.worstReadMs}ms / transport ${formatBytes(decision.worstTransportBytes)}`)
  lines.push(`用户可感知: ${JSON.stringify(decision.userPerceptible)}`)
  lines.push(`决策: ${decision.recommendation}`)
  lines.push(decision.rationale)
  process.stderr.write(`${lines.join('\n')}\n`)
}

function round1(value) {
  return Math.round(value * 10) / 10
}

function round4(value) {
  return Math.round(value * 10000) / 10000
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${bytes}B`
}

await main()
