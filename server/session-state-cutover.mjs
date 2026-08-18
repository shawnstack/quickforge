import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { getSqliteStorage } from './sqlite/database.mjs'
import { createSessionStateRepository, snapshotDigestLine } from './sqlite/session-state-repository.mjs'
import {
  SESSION_STORAGE_PHASES,
  configureSessionStateService,
  drainSessionJsonMirror,
  readSessionStorageState,
  setSessionStoragePhase,
} from './session-state-service.mjs'
import {
  createPhysicalSessionStateFsAdapter,
  materializeSessionJsonMirrorEntry,
  storageDir,
} from './storage.mjs'

const DEFAULT_LOCK_TTL_MS = 60_000
const DEFAULT_WAIT_TIMEOUT_MS = 65_000
const maintenanceContext = new AsyncLocalStorage()
let maintenanceCount = 0

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalize(value[key])]))
}

function digestJson(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function normalizeBucket(raw) {
  if (raw.scope === 'global') {
    if (raw.projectId !== undefined && raw.projectId !== null && raw.projectId !== '') throw new TypeError('Global session bucket cannot have projectId')
    return { scope: 'global', projectId: null }
  }
  if (raw.scope !== 'project' || typeof raw.projectId !== 'string' || !raw.projectId.trim() || raw.projectId === '.' || raw.projectId === '..' || /[\\/]/.test(raw.projectId)) {
    throw new TypeError('Invalid session bucket')
  }
  return { scope: 'project', projectId: raw.projectId }
}

function deriveMetadata(sessionId, state, bucket) {
  const createdAt = typeof state.createdAt === 'string'
    ? state.createdAt
    : (typeof state.lastModified === 'string' ? state.lastModified : '1970-01-01T00:00:00.000Z')
  return {
    id: sessionId,
    title: typeof state.title === 'string' ? state.title : 'New chat',
    titleSource: state.titleSource,
    createdAt,
    lastModified: typeof state.lastModified === 'string' ? state.lastModified : createdAt,
    messageCount: state.messages.length,
    stateVersion: Number.isInteger(state.stateVersion) && state.stateVersion >= 0 ? state.stateVersion : 0,
    thinkingLevel: typeof state.thinkingLevel === 'string' ? state.thinkingLevel : 'off',
    scope: bucket.scope,
    ...(bucket.scope === 'project' ? { projectId: bucket.projectId } : {}),
    taskStatus: state.taskStatus || 'idle',
    taskStartedAt: state.taskStartedAt ?? null,
    taskFinishedAt: state.taskFinishedAt ?? null,
  }
}

// Per-session normalization shared verbatim by the materialized snapshot
// (buildSessionJsonSnapshot) and the streaming cutover source below —
// validation, shaping and diagnostics MUST stay identical between the two
// paths; the snapshot tests are the parity anchor. Returns null for
// metadata-only orphans (diagnostics already recorded; orphans are excluded
// from records, backups and the SQLite import).
function normalizeSessionEntry(bucket, sessionId, rawState, rawMetadata, diagnostics) {
  if (!rawState && rawMetadata) {
    diagnostics.metadataOnly.push(sessionId)
    diagnostics.orphanDeletes.push({ scope: bucket.scope, projectId: bucket.projectId, sessionId })
    return null
  }
  if (!isPlainObject(rawState)) throw new TypeError(`Invalid session state: ${sessionId}`)
  if (!Array.isArray(rawState.messages)) throw new TypeError(`Session messages must be an array: ${sessionId}`)
  if (rawState.id !== undefined && rawState.id !== sessionId) throw new TypeError(`Session body id mismatch: ${sessionId}`)
  if (rawState.scope !== undefined && rawState.scope !== bucket.scope) throw new TypeError(`Session body scope mismatch: ${sessionId}`)
  if (bucket.scope === 'project' && rawState.projectId !== undefined && rawState.projectId !== bucket.projectId) throw new TypeError(`Session body project mismatch: ${sessionId}`)
  if (bucket.scope === 'global' && rawState.projectId !== undefined && rawState.projectId !== null) throw new TypeError(`Global session body project mismatch: ${sessionId}`)
  let metadata
  if (rawMetadata === undefined) {
    diagnostics.bodyOnly.push(sessionId)
    metadata = deriveMetadata(sessionId, rawState, bucket)
  } else {
    if (!isPlainObject(rawMetadata)) throw new TypeError(`Invalid session metadata: ${sessionId}`)
    if (rawMetadata.id !== undefined && rawMetadata.id !== sessionId) throw new TypeError(`Session metadata id mismatch: ${sessionId}`)
    if (rawMetadata.scope !== undefined && rawMetadata.scope !== bucket.scope) throw new TypeError(`Session metadata scope mismatch: ${sessionId}`)
    if (bucket.scope === 'project' && rawMetadata.projectId !== undefined && rawMetadata.projectId !== bucket.projectId) throw new TypeError(`Session metadata project mismatch: ${sessionId}`)
    if (bucket.scope === 'global' && rawMetadata.projectId !== undefined && rawMetadata.projectId !== null) throw new TypeError(`Global session metadata project mismatch: ${sessionId}`)
    metadata = structuredClone(rawMetadata)
  }
  const stateVersion = rawState.stateVersion ?? metadata.stateVersion ?? 0
  if (!Number.isInteger(stateVersion) || stateVersion < 0) throw new TypeError(`Invalid session stateVersion: ${sessionId}`)
  const state = { ...structuredClone(rawState), id: sessionId, scope: bucket.scope, stateVersion }
  metadata = { ...metadata, id: sessionId, scope: bucket.scope, stateVersion }
  if (bucket.scope === 'project') {
    state.projectId = bucket.projectId
    metadata.projectId = bucket.projectId
  } else {
    delete state.projectId
    delete metadata.projectId
  }
  for (const field of ['pinnedAt', 'archivedAt']) {
    if (metadata[field] !== undefined) state[field] = metadata[field]
  }
  return { ...bucket, sessionId, stateVersion, state, metadata, stateDigest: digestJson(state), metadataDigest: digestJson(metadata) }
}

export function buildSessionJsonSnapshot(buckets) {
  if (!Array.isArray(buckets)) throw new TypeError('Session buckets must be an array')
  const records = []
  const diagnostics = { bodyOnly: [], metadataOnly: [], orphanDeletes: [], duplicateSessionIds: [] }
  const seen = new Set()
  for (const rawBucket of buckets) {
    const bucket = normalizeBucket(rawBucket)
    if (!isPlainObject(rawBucket.sessions) || !isPlainObject(rawBucket.metadata)) throw new TypeError('Session bucket stores must be objects')
    const ids = new Set([...Object.keys(rawBucket.sessions), ...Object.keys(rawBucket.metadata)])
    for (const sessionId of ids) {
      if (seen.has(sessionId)) diagnostics.duplicateSessionIds.push(sessionId)
      seen.add(sessionId)
      const record = normalizeSessionEntry(bucket, sessionId, rawBucket.sessions[sessionId], rawBucket.metadata[sessionId], diagnostics)
      if (record) records.push(record)
    }
  }
  if (diagnostics.duplicateSessionIds.length > 0) throw new TypeError(`Duplicate session ids across buckets: ${[...new Set(diagnostics.duplicateSessionIds)].join(', ')}`)
  // Startup cutover holds the maintenance lock with no concurrent writes, so
  // metadata-only orphans are stale residue of already-deleted sessions: they
  // are dropped above (excluded from records) and recorded in diagnostics for
  // audit instead of blocking the migration. Orphans ride the mirror delete
  // queue (`orphanDeletes` passed to replaceAll as `mirrorDeletes`) so the
  // drain physically clears their leftover JSON metadata; otherwise
  // initializeSessionIndex could re-import that residue on a later boot and
  // the orphaned index rows would fail the next startup integrity check.
  records.sort((left, right) => left.sessionId.localeCompare(right.sessionId))
  // F9 v7: the canonical snapshot digest line now includes a `messagesDigest`
  // slot. JSON imports are always non-split (messages inline in the body), so
  // they contribute an empty messages digest — matching the repository digest
  // of freshly imported (non-split) SQLite rows.
  const digest = createHash('sha256').update(records.map((record) => snapshotDigestLine(record.scope, record.projectId, record.sessionId, record.stateDigest, record.metadataDigest, '')).join('\n')).digest('hex')
  return { records, count: records.length, digest, diagnostics }
}

// Streaming cutover source: each pass consumes the fsAdapter lazily — one
// bucket listing, one metadata bucket parse and one session file parse at a
// time — so a multi-GB library never needs to be fully resident. Only the
// small per-pass summary (digest lines + diagnostics) survives a full
// iteration. Records are normalized by the shared normalizeSessionEntry, and
// the summary digest is computed from digest lines sorted by sessionId, which
// matches buildSessionJsonSnapshot's snapshot digest exactly. Bucket-local
// iteration order is sorted session ids; duplicate/orphan detection is
// order-independent. Returns a factory: each call produces one independent
// { iterate, getSummary } pass over the source.
export function createStreamingSessionSource(fsAdapter) {
  return () => {
    const digestEntries = []
    const diagnostics = { bodyOnly: [], metadataOnly: [], orphanDeletes: [], duplicateSessionIds: [] }
    const seen = new Set()
    let count = 0
    let completed = false
    const iterate = async function* streamSessionRecords() {
      for await (const rawBucket of fsAdapter.listBuckets()) {
        const bucket = normalizeBucket(rawBucket)
        const metadata = await fsAdapter.readMetadataBucket(rawBucket)
        if (!isPlainObject(metadata)) throw new TypeError('Session bucket stores must be objects')
        const fileIds = new Set()
        for await (const sessionId of fsAdapter.listSessionFiles(rawBucket)) fileIds.add(sessionId)
        const ids = [...new Set([...fileIds, ...Object.keys(metadata)])].sort((left, right) => left.localeCompare(right))
        for (const sessionId of ids) {
          if (seen.has(sessionId)) diagnostics.duplicateSessionIds.push(sessionId)
          seen.add(sessionId)
          const rawState = fileIds.has(sessionId) ? await fsAdapter.readSessionState(rawBucket, sessionId) : undefined
          const record = normalizeSessionEntry(bucket, sessionId, rawState, metadata[sessionId], diagnostics)
          if (!record) continue
          count += 1
          digestEntries.push({ sessionId, line: snapshotDigestLine(record.scope, record.projectId, record.sessionId, record.stateDigest, record.metadataDigest, '') })
          yield record
        }
      }
      completed = true
    }
    return {
      iterate,
      getSummary() {
        if (!completed) throw new Error('Session source summary is not ready before the iteration completes')
        if (diagnostics.duplicateSessionIds.length > 0) throw new TypeError(`Duplicate session ids across buckets: ${[...new Set(diagnostics.duplicateSessionIds)].join(', ')}`)
        digestEntries.sort((left, right) => left.sessionId.localeCompare(right.sessionId))
        const digest = createHash('sha256').update(digestEntries.map((entry) => entry.line).join('\n')).digest('hex')
        return { count, digest, diagnostics }
      },
    }
  }
}

// readBuckets keeps the historical injection path for tests and small data
// sets: each pass calls readBuckets() exactly once, materializes one full
// snapshot (buildSessionJsonSnapshot) and replays its records. The summary is
// structurally identical to the streaming source, so the cutover flow below
// is agnostic to which source factory it was given.
function createReadBucketsSessionSource(readBuckets) {
  return () => {
    let snapshot = null
    const iterate = async function* snapshotSessionRecords() {
      snapshot = buildSessionJsonSnapshot(await readBuckets())
      yield* snapshot.records
    }
    return {
      iterate,
      getSummary() {
        if (!snapshot) throw new Error('Session source summary is not ready before the iteration completes')
        return { count: snapshot.count, digest: snapshot.digest, diagnostics: snapshot.diagnostics }
      },
    }
  }
}

async function summarizeSessionSource(source) {
  let consumed = 0
  for await (const _record of source.iterate()) consumed += 1
  const summary = source.getSummary()
  if (summary.count !== consumed) throw new Error('Session source summary count mismatch')
  return summary
}

function sameSessionSourceSummary(left, right) {
  return left.count === right.count && left.digest === right.digest
    && JSON.stringify(left.diagnostics) === JSON.stringify(right.diagnostics)
}

// Streaming v1 backup writer: the output JSON shape matches the old
// materialized writer exactly ({app, version, exportedAt, scope,
// includeSecrets, sessionState, data:{sessions, sessionsMetadata}}), but
// states are streamed record-by-record so the library never lives in memory
// as a whole. The sessions section is written while iterating; metadata JSON
// strings (small per-session summaries) are buffered for the second section —
// states themselves are never buffered. Verification is byte-level: the
// write-side sha256/byte counter is re-checked against a chunked
// createReadStream re-read plus a first/last byte sanity check, replacing the
// old "read whole file + re-parse + re-snapshot" verification. The streamed
// records' digest is also re-accumulated and compared against `summary`, so a
// source that changed since the double read fails closed here.
async function writeCutoverBackupStream(createIteration, summary, options = {}) {
  const directory = options.directory || path.join(storageDir, 'backups')
  await fs.mkdir(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const finalPath = path.join(directory, `quickforge-session-state-cutover-${stamp}.json`)
  const temporaryPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`
  const openWriteStream = options.createWriteStream || createWriteStream
  try {
    const stream = openWriteStream(temporaryPath, { encoding: 'utf8' })
    const failures = []
    stream.on('error', (error) => { failures.push(error) })
    const written = createHash('sha256')
    let bytes = 0
    const write = async (chunk) => {
      written.update(chunk)
      bytes += Buffer.byteLength(chunk, 'utf8')
      if (stream.write(chunk, 'utf8')) {
        if (failures.length > 0) throw failures[0]
        return
      }
      await new Promise((resolve, reject) => {
        const onDrain = () => { cleanup(); resolve() }
        const onError = (error) => { cleanup(); reject(error) }
        const cleanup = () => { stream.off('drain', onDrain); stream.off('error', onError) }
        stream.once('drain', onDrain)
        stream.once('error', onError)
      })
    }
    await write(`{\n  "app": "quickforge",\n  "version": 1,\n  "exportedAt": ${JSON.stringify(new Date().toISOString())},\n  "scope": "sessions",\n  "includeSecrets": false,\n  "sessionState": {\n    "count": ${summary.count},\n    "digest": ${JSON.stringify(summary.digest)}\n  },\n  "data": {\n    "sessions": {`)
    const digestEntries = []
    let count = 0
    let firstSession = true
    const metadataChunks = []
    for await (const record of createIteration()) {
      digestEntries.push({ sessionId: record.sessionId, line: snapshotDigestLine(record.scope, record.projectId, record.sessionId, record.stateDigest, record.metadataDigest, '') })
      count += 1
      const prefix = firstSession ? '' : ','
      await write(`${prefix}\n      ${JSON.stringify(record.sessionId)}: ${JSON.stringify(record.state)}`)
      metadataChunks.push(`${prefix}\n      ${JSON.stringify(record.sessionId)}: ${JSON.stringify(record.metadata)}`)
      firstSession = false
    }
    await write(`\n    },\n    "sessionsMetadata": {`)
    for (const metadataChunk of metadataChunks) {
      await write(metadataChunk)
    }
    await write(`\n    }\n  }\n}`)
    await new Promise((resolve, reject) => {
      const onError = (error) => { cleanup(); reject(error) }
      const cleanup = () => { stream.off('error', onError) }
      stream.once('error', onError)
      stream.end(() => { cleanup(); resolve() })
    })
    if (count !== summary.count) throw new Error('Session JSON source changed before cutover commit')
    digestEntries.sort((left, right) => left.sessionId.localeCompare(right.sessionId))
    const digest = createHash('sha256').update(digestEntries.map((entry) => entry.line).join('\n')).digest('hex')
    if (digest !== summary.digest) throw new Error('Session JSON source changed before cutover commit')
    const reread = createHash('sha256')
    let rereadBytes = 0
    let firstByte = -1
    let lastByte = -1
    await new Promise((resolve, reject) => {
      const reader = createReadStream(temporaryPath)
      reader.on('data', (chunk) => {
        if (firstByte === -1) firstByte = chunk[0]
        lastByte = chunk[chunk.length - 1]
        reread.update(chunk)
        rereadBytes += chunk.length
      })
      reader.once('error', reject)
      reader.once('end', () => resolve())
    })
    if (reread.digest('hex') !== written.digest('hex') || rereadBytes !== bytes || firstByte !== 0x7b || lastByte !== 0x7d) {
      throw new Error('Session cutover backup verification failed')
    }
    await fs.rename(temporaryPath, finalPath)
    return finalPath
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

function ownerPid(row) {
  const value = Number(row?.owner_pid)
  return Number.isInteger(value) && value > 0 ? value : null
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error?.code === 'EPERM' }
}

export function acquireSessionStateMaintenanceLock(storage, options = {}) {
  const nowMs = Number(options.now?.() ?? Date.now())
  const acquiredAt = new Date(nowMs).toISOString()
  const expiresAt = new Date(nowMs + (options.ttlMs ?? DEFAULT_LOCK_TTL_MS)).toISOString()
  const identity = isPlainObject(options.owner)
    ? { id: options.owner.id || `${options.owner.pid || process.pid}:${randomUUID()}`, pid: options.owner.pid || process.pid }
    : { id: options.owner || `${process.pid}:${randomUUID()}`, pid: process.pid }
  const isPidAlive = options.pidAlive || pidAlive
  return storage.transaction((database) => {
    const current = database.prepare('SELECT * FROM session_state_maintenance_lock WHERE singleton = 1').get()
    if (current && current.owner === identity.id) {
      database.prepare(`UPDATE session_state_maintenance_lock SET owner_pid = ?, operation = ?, heartbeat_at = ?, expires_at = ?
        WHERE singleton = 1 AND owner = ? AND fencing = ?`)
        .run(identity.pid, options.operation || current.operation, acquiredAt, expiresAt, identity.id, current.fencing)
      return { owner: identity.id, ownerPid: identity.pid, fencing: Number(current.fencing), expiresAt }
    }
    if (current) {
      const expired = Date.parse(current.expires_at) <= nowMs
      const pid = ownerPid(current)
      if (!expired || pid === null || isPidAlive(pid)) return null
    }
    const fencing = Number(current?.fencing || 0) + 1
    database.prepare(`INSERT INTO session_state_maintenance_lock
      (singleton, owner, owner_pid, fencing, operation, acquired_at, heartbeat_at, expires_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET owner=excluded.owner, owner_pid=excluded.owner_pid, fencing=excluded.fencing,
      operation=excluded.operation, acquired_at=excluded.acquired_at, heartbeat_at=excluded.heartbeat_at, expires_at=excluded.expires_at`)
      .run(identity.id, identity.pid, fencing, options.operation || 'session-state-maintenance', acquiredAt, acquiredAt, expiresAt)
    return { owner: identity.id, ownerPid: identity.pid, fencing, expiresAt }
  }, { mode: 'immediate' })
}

export function renewSessionStateMaintenanceLock(storage, lease, options = {}) {
  const nowMs = Number(options.now?.() ?? Date.now())
  const heartbeatAt = new Date(nowMs).toISOString()
  const expiresAt = new Date(nowMs + (options.ttlMs ?? DEFAULT_LOCK_TTL_MS)).toISOString()
  const result = storage.prepare(`UPDATE session_state_maintenance_lock SET heartbeat_at = ?, expires_at = ? WHERE singleton = 1 AND owner = ? AND fencing = ?`)
    .run(heartbeatAt, expiresAt, lease.owner, lease.fencing)
  lease.expiresAt = expiresAt
  return Number(result.changes) === 1
}

export function releaseSessionStateMaintenanceLock(storage, lease) {
  return Number(storage.prepare('DELETE FROM session_state_maintenance_lock WHERE singleton = 1 AND owner = ? AND fencing = ?').run(lease.owner, lease.fencing).changes) === 1
}

async function waitForLock(storage, options) {
  const deadline = Date.now() + (options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS)
  while (Date.now() < deadline) {
    const lease = acquireSessionStateMaintenanceLock(storage, options)
    if (lease) return lease
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs ?? 100))
  }
  throw new Error('Timed out waiting for session state maintenance lock')
}

export async function runSessionStateMaintenance(operation, options = {}) {
  const existing = maintenanceContext.getStore()
  if (existing) return operation(existing)
  const storage = options.storage || getSqliteStorage()
  const lease = await waitForLock(storage, options)
  const interval = options.heartbeatIntervalMs ?? Math.max(10, Math.floor((options.ttlMs ?? DEFAULT_LOCK_TTL_MS) / 3))
  const timer = setInterval(() => {
    try {
      if (!renewSessionStateMaintenanceLock(storage, lease, options)) throw new Error('Session state maintenance lock fencing was lost')
    } catch (error) {
      heartbeatError = error
      rejectHeartbeat(error)
    }
  }, interval)
  timer.unref?.()
  let rejectHeartbeat
  let heartbeatError = null
  const heartbeatFailure = new Promise((_, reject) => { rejectHeartbeat = reject })
  maintenanceCount += 1
  try {
    const context = { storage, lease }
    const result = await Promise.race([maintenanceContext.run(context, () => Promise.resolve().then(() => operation(context))), heartbeatFailure])
    if (heartbeatError) throw heartbeatError
    return result
  } finally {
    clearInterval(timer)
    releaseSessionStateMaintenanceLock(storage, lease)
    maintenanceCount = Math.max(0, maintenanceCount - 1)
  }
}

export function isSessionStateMaintenanceActive(storage) {
  if (!storage) {
    try { storage = getSqliteStorage() } catch { return false }
  }
  return maintenanceCount > 0 || Boolean(storage.prepare('SELECT 1 AS active FROM session_state_maintenance_lock WHERE singleton = 1').get())
}

export function currentSessionStateMaintenanceContext() {
  return maintenanceContext.getStore() || null
}

function mirrorAdapter() {
  async function materialize(entry) {
    await materializeSessionJsonMirrorEntry(entry)
  }
  return { upsert: materialize, delete: materialize }
}

function integrityFailureSummary(integrity) {
  const summary = Object.entries(integrity)
    .filter(([key, value]) => !['ok', 'count', 'digest'].includes(key) && Number(value) > 0)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ')
  return summary || 'unknown'
}

// session_index is a pure projection of session_states, but
// initializeSessionIndex rebuilds it from the JSON source, which can drift
// from authoritative rows (e.g. orphan metadata residue re-imported after a
// failed mirror drain). Rebuilding the projection from the authoritative
// states is lossless self-healing: on integrity failure, rebuild the index
// and re-verify, and only fail closed if the re-check still fails.
function verifyIntegrityWithIndexSelfHeal(repository, phase) {
  const first = repository.verifyIntegrity({ quickCheck: true })
  if (first.ok) return first
  repository.rebuildIndex()
  const second = repository.verifyIntegrity({ quickCheck: true })
  if (!second.ok) throw new Error(`Session state ${phase} integrity verification failed (${integrityFailureSummary(first)})`)
  return second
}

export async function initializeSessionStateCutover(options = {}) {
  const storage = options.storage || getSqliteStorage()
  const repository = options.repository || createSessionStateRepository(storage)
  configureSessionStateService({ repository, mirror: options.mirror || mirrorAdapter() })
  return runSessionStateMaintenance(async () => {
    const current = readSessionStorageState()
    if (current.phase === SESSION_STORAGE_PHASES.JSON_PENDING) {
      const integrity = verifyIntegrityWithIndexSelfHeal(repository, 'pending')
      const drained = await drainSessionJsonMirror()
      // integrity is the lightweight (SQL-level) check — its digest is null.
      // The verified digest persisted by replaceAll's storageState stays
      // authoritative when promoting to authoritative.
      if (drained.pending === 0) setSessionStoragePhase(SESSION_STORAGE_PHASES.AUTHORITATIVE, { stateCount: integrity.count, digest: current.digest, backupFile: current.backupFile })
      return readSessionStorageState()
    }
    if (current.phase === SESSION_STORAGE_PHASES.AUTHORITATIVE) {
      verifyIntegrityWithIndexSelfHeal(repository, 'authoritative')
      await drainSessionJsonMirror()
      return readSessionStorageState()
    }

    if (current.phase === SESSION_STORAGE_PHASES.CUTOVER_RUNNING && current.backupFile) {
      setSessionStoragePhase(SESSION_STORAGE_PHASES.JSON_AUTHORITATIVE, {
        backupFile: current.backupFile,
        diagnostic: { operation: 'cutover_recovery', recoveredFrom: SESSION_STORAGE_PHASES.CUTOVER_RUNNING },
      })
    }

    let backupFile = current.backupFile
    try {
      // Streaming cutover (step 2): the json_authoritative migration path runs
      // FOUR independent full iterations of the JSON source — (1) summary,
      // (2) summary re-read, (3) streaming backup write (or summary-only when
      // a backup already exists) and (4) replaceAllStream import. Only the
      // small summaries (digest lines + diagnostics) survive between passes,
      // so peak memory is bounded by the largest single session instead of
      // the whole library. options.readBuckets keeps the materialized
      // injection path for tests; the production default streams the physical
      // layout one file at a time via the fsAdapter.
      const createSource = options.readBuckets
        ? createReadBucketsSessionSource(options.readBuckets)
        : createStreamingSessionSource(options.fsAdapter || createPhysicalSessionStateFsAdapter())
      const first = await summarizeSessionSource(createSource())
      const second = await summarizeSessionSource(createSource())
      if (!sameSessionSourceSummary(first, second)) throw new Error('Session JSON source changed during cutover double read')
      if (!backupFile) {
        backupFile = await writeCutoverBackupStream(() => createSource().iterate(), first, {
          directory: options.backupDirectory,
          createWriteStream: options.createBackupWriteStream,
        })
      } else {
        const third = await summarizeSessionSource(createSource())
        if (!sameSessionSourceSummary(first, third)) throw new Error('Session JSON source changed before cutover commit')
      }
      setSessionStoragePhase(SESSION_STORAGE_PHASES.CUTOVER_RUNNING, {
        stateCount: first.count,
        digest: first.digest,
        backupFile,
        diagnostic: first.diagnostics,
      })
      const pendingValues = {
        phase: SESSION_STORAGE_PHASES.JSON_PENDING,
        backupFile,
        diagnostic: first.diagnostics,
      }
      // replaceAllStream consumes the 4th source pass record-by-record inside
      // its own immediate transaction and verifies expectedDigest there.
      await repository.replaceAllStream(createSource().iterate(), {
        expectedCount: first.count,
        expectedDigest: first.digest,
        storageState: pendingValues,
        mirrorDeletes: first.diagnostics.orphanDeletes,
      })
      // replaceAll already verified expectedDigest inside its transaction, so
      // the post-replace check re-asserts SQL-level integrity and the count
      // only (the lightweight verification digest is null by design).
      const integrity = repository.verifyIntegrity({ quickCheck: true })
      if (!integrity.ok || integrity.count !== first.count) throw new Error('Session SQLite replace verification failed')
      readSessionStorageState()
      const drained = await drainSessionJsonMirror()
      if (drained.pending === 0) setSessionStoragePhase(SESSION_STORAGE_PHASES.AUTHORITATIVE, { stateCount: integrity.count, digest: first.digest, backupFile, diagnostic: first.diagnostics })
      return readSessionStorageState()
    } catch (error) {
      const state = readSessionStorageState()
      if (![SESSION_STORAGE_PHASES.JSON_PENDING, SESSION_STORAGE_PHASES.AUTHORITATIVE].includes(state.phase)) {
        setSessionStoragePhase(SESSION_STORAGE_PHASES.JSON_AUTHORITATIVE, {
          backupFile,
          diagnostic: { operation: 'cutover', errorName: error?.name || 'Error', error: error?.message || String(error) },
        })
        return readSessionStorageState()
      }
      throw error
    }
  }, { ...options, storage, operation: 'session-state-cutover' })
}
