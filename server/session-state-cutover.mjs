import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
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
  materializeSessionJsonMirrorEntry,
  readPhysicalSessionStateBuckets,
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

export function buildSessionJsonSnapshot(buckets) {
  if (!Array.isArray(buckets)) throw new TypeError('Session buckets must be an array')
  const records = []
  const diagnostics = { bodyOnly: [], metadataOnly: [], duplicateSessionIds: [] }
  const seen = new Set()
  for (const rawBucket of buckets) {
    const bucket = normalizeBucket(rawBucket)
    if (!isPlainObject(rawBucket.sessions) || !isPlainObject(rawBucket.metadata)) throw new TypeError('Session bucket stores must be objects')
    const ids = new Set([...Object.keys(rawBucket.sessions), ...Object.keys(rawBucket.metadata)])
    for (const sessionId of ids) {
      if (seen.has(sessionId)) diagnostics.duplicateSessionIds.push(sessionId)
      seen.add(sessionId)
      const rawState = rawBucket.sessions[sessionId]
      const rawMetadata = rawBucket.metadata[sessionId]
      if (!rawState && rawMetadata) {
        diagnostics.metadataOnly.push(sessionId)
        continue
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
      records.push({ ...bucket, sessionId, stateVersion, state, metadata, stateDigest: digestJson(state), metadataDigest: digestJson(metadata) })
    }
  }
  if (diagnostics.duplicateSessionIds.length > 0) throw new TypeError(`Duplicate session ids across buckets: ${[...new Set(diagnostics.duplicateSessionIds)].join(', ')}`)
  if (diagnostics.metadataOnly.length > 0) throw new TypeError(`Metadata-only session orphans: ${diagnostics.metadataOnly.join(', ')}`)
  records.sort((left, right) => left.sessionId.localeCompare(right.sessionId))
  // F9 v7: the canonical snapshot digest line now includes a `messagesDigest`
  // slot. JSON imports are always non-split (messages inline in the body), so
  // they contribute an empty messages digest — matching the repository digest
  // of freshly imported (non-split) SQLite rows.
  const digest = createHash('sha256').update(records.map((record) => snapshotDigestLine(record.scope, record.projectId, record.sessionId, record.stateDigest, record.metadataDigest, '')).join('\n')).digest('hex')
  return { records, count: records.length, digest, diagnostics }
}

async function writeCutoverBackup(snapshot, directory = path.join(storageDir, 'backups')) {
  await fs.mkdir(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const finalPath = path.join(directory, `quickforge-session-state-cutover-${stamp}.json`)
  const temporaryPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`
  const backup = {
    app: 'quickforge',
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: 'sessions',
    includeSecrets: false,
    sessionState: { count: snapshot.count, digest: snapshot.digest },
    data: {
      sessions: Object.fromEntries(snapshot.records.map((record) => [record.sessionId, record.state])),
      sessionsMetadata: Object.fromEntries(snapshot.records.map((record) => [record.sessionId, record.metadata])),
    },
  }
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8')
    const verified = JSON.parse(await fs.readFile(temporaryPath, 'utf8'))
    const grouped = new Map()
    for (const [sessionId, state] of Object.entries(verified.data.sessions)) {
      const scope = state?.scope === 'project' ? 'project' : 'global'
      const projectId = scope === 'project' ? state?.projectId : null
      const key = scope === 'project' ? `project:${projectId}` : 'global'
      if (!grouped.has(key)) grouped.set(key, { scope, projectId, sessions: {}, metadata: {} })
      grouped.get(key).sessions[sessionId] = state
      if (Object.prototype.hasOwnProperty.call(verified.data.sessionsMetadata, sessionId)) {
        grouped.get(key).metadata[sessionId] = verified.data.sessionsMetadata[sessionId]
      }
    }
    for (const [sessionId, metadata] of Object.entries(verified.data.sessionsMetadata)) {
      if (!Object.prototype.hasOwnProperty.call(verified.data.sessions, sessionId)) {
        const scope = metadata?.scope === 'project' ? 'project' : 'global'
        const projectId = scope === 'project' ? metadata?.projectId : null
        const key = scope === 'project' ? `project:${projectId}` : 'global'
        if (!grouped.has(key)) grouped.set(key, { scope, projectId, sessions: {}, metadata: {} })
        grouped.get(key).metadata[sessionId] = metadata
      }
    }
    const verifiedSnapshot = buildSessionJsonSnapshot([...grouped.values()])
    if (verified.sessionState?.count !== snapshot.count || verified.sessionState?.digest !== snapshot.digest || verifiedSnapshot.count !== snapshot.count || verifiedSnapshot.digest !== snapshot.digest) {
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

export async function initializeSessionStateCutover(options = {}) {
  const storage = options.storage || getSqliteStorage()
  const repository = options.repository || createSessionStateRepository(storage)
  configureSessionStateService({ repository, mirror: options.mirror || mirrorAdapter() })
  return runSessionStateMaintenance(async () => {
    const current = readSessionStorageState()
    if (current.phase === SESSION_STORAGE_PHASES.JSON_PENDING) {
      const integrity = repository.verifyIntegrity({ quickCheck: true })
      if (!integrity.ok) throw new Error('Session state pending integrity verification failed')
      const drained = await drainSessionJsonMirror()
      if (drained.pending === 0) setSessionStoragePhase(SESSION_STORAGE_PHASES.AUTHORITATIVE, { stateCount: integrity.count, digest: integrity.digest, backupFile: current.backupFile })
      return readSessionStorageState()
    }
    if (current.phase === SESSION_STORAGE_PHASES.AUTHORITATIVE) {
      const integrity = repository.verifyIntegrity({ quickCheck: true })
      if (!integrity.ok) throw new Error('Session state authoritative integrity verification failed')
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
      const first = buildSessionJsonSnapshot(await (options.readBuckets || readPhysicalSessionStateBuckets)())
      const second = buildSessionJsonSnapshot(await (options.readBuckets || readPhysicalSessionStateBuckets)())
      if (first.count !== second.count || first.digest !== second.digest) throw new Error('Session JSON source changed during cutover double read')
      if (!backupFile) backupFile = await writeCutoverBackup(first, options.backupDirectory)
      const third = buildSessionJsonSnapshot(await (options.readBuckets || readPhysicalSessionStateBuckets)())
      if (first.count !== third.count || first.digest !== third.digest) throw new Error('Session JSON source changed before cutover commit')
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
      repository.replaceAll(first.records, {
        expectedCount: first.count,
        expectedDigest: first.digest,
        storageState: pendingValues,
      })
      const integrity = repository.verifyIntegrity({ quickCheck: true })
      if (!integrity.ok || integrity.count !== first.count || integrity.digest !== first.digest) throw new Error('Session SQLite replace verification failed')
      readSessionStorageState()
      const drained = await drainSessionJsonMirror()
      if (drained.pending === 0) setSessionStoragePhase(SESSION_STORAGE_PHASES.AUTHORITATIVE, { stateCount: integrity.count, digest: integrity.digest, backupFile, diagnostic: first.diagnostics })
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
