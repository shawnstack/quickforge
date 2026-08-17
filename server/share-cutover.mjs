import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getSqliteStorage } from './sqlite/database.mjs'
import { createShareRepository, normalizeShareRecord, shareSnapshotDigest } from './sqlite/share-repository.mjs'
import {
  SHARE_STORAGE_PHASES,
  configureShareService,
  drainShareJsonMirror,
  readShareStorageState,
  setShareStoragePhase,
} from './share-service.mjs'
import { readSharesJsonFile } from './share-json-file.mjs'
import { createDefaultShareMirror } from './share-service.mjs'
import { storageDir } from './storage.mjs'

const DEFAULT_LOCK_TTL_MS = 60_000
const DEFAULT_WAIT_TIMEOUT_MS = 65_000
const maintenanceContext = new AsyncLocalStorage()
let maintenanceCount = 0

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

/**
 * Validate and normalize the whole `shares/conversation-shares.json` store
 * (top-level object keyed by shareId) into canonical share records. Fails
 * closed on: missing sessionId, invalid permission/scope, malformed `tokens`
 * array, inconsistent password hash fields, key/id mismatch and duplicate
 * shareIds across keys. The count/digest are computed with the exact
 * repository digest algorithm so the SQLite replace verification can compare
 * digests 1:1.
 */
export function buildShareJsonSnapshot(shares) {
  if (!isPlainObject(shares)) throw new TypeError('Share JSON store must be an object')
  const records = []
  const seen = new Set()
  const diagnostics = { invalidRecords: [], duplicateShareIds: [] }
  for (const [key, raw] of Object.entries(shares)) {
    let record
    try {
      record = normalizeShareRecord(raw.id === undefined ? { ...raw, id: key } : raw)
    } catch (error) {
      diagnostics.invalidRecords.push(key)
      throw error instanceof Error ? error : new TypeError(`Invalid share record: ${key}`)
    }
    if (seen.has(record.id)) {
      diagnostics.duplicateShareIds.push(record.id)
      throw new TypeError(`Duplicate share ids: ${record.id}`)
    }
    seen.add(record.id)
    if (raw.id !== undefined && raw.id !== key) {
      throw new TypeError(`Share record id mismatch: ${key}`)
    }
    records.push(record)
  }
  records.sort((left, right) => left.id.localeCompare(right.id))
  return { records, count: records.length, digest: shareSnapshotDigest(records), diagnostics }
}

async function writeShareCutoverBackup(snapshot, directory = path.join(storageDir, 'backups')) {
  await fs.mkdir(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const finalPath = path.join(directory, `quickforge-shares-cutover-${stamp}.json`)
  const temporaryPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`
  const backup = {
    app: 'quickforge',
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: 'shares',
    includeSecrets: false,
    shares: { count: snapshot.count, digest: snapshot.digest },
    data: {
      shares: Object.fromEntries(snapshot.records.map((record) => [record.id, record])),
    },
  }
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8')
    const verified = JSON.parse(await fs.readFile(temporaryPath, 'utf8'))
    const verifiedSnapshot = buildShareJsonSnapshot(verified.data?.shares)
    if (verified.shares?.count !== snapshot.count || verified.shares?.digest !== snapshot.digest
      || verifiedSnapshot.count !== snapshot.count || verifiedSnapshot.digest !== snapshot.digest) {
      throw new Error('Share cutover backup verification failed')
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

export function acquireShareMaintenanceLock(storage, options = {}) {
  const nowMs = Number(options.now?.() ?? Date.now())
  const acquiredAt = new Date(nowMs).toISOString()
  const expiresAt = new Date(nowMs + (options.ttlMs ?? DEFAULT_LOCK_TTL_MS)).toISOString()
  const identity = isPlainObject(options.owner)
    ? { id: options.owner.id || `${options.owner.pid || process.pid}:${randomUUID()}`, pid: options.owner.pid || process.pid }
    : { id: options.owner || `${process.pid}:${randomUUID()}`, pid: process.pid }
  const isPidAlive = options.pidAlive || pidAlive
  return storage.transaction((database) => {
    const current = database.prepare('SELECT * FROM share_maintenance_lock WHERE singleton = 1').get()
    if (current && current.owner === identity.id) {
      database.prepare(`UPDATE share_maintenance_lock SET owner_pid = ?, operation = ?, heartbeat_at = ?, expires_at = ?
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
    database.prepare(`INSERT INTO share_maintenance_lock
      (singleton, owner, owner_pid, fencing, operation, acquired_at, heartbeat_at, expires_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET owner=excluded.owner, owner_pid=excluded.owner_pid, fencing=excluded.fencing,
      operation=excluded.operation, acquired_at=excluded.acquired_at, heartbeat_at=excluded.heartbeat_at, expires_at=excluded.expires_at`)
      .run(identity.id, identity.pid, fencing, options.operation || 'share-maintenance', acquiredAt, acquiredAt, expiresAt)
    return { owner: identity.id, ownerPid: identity.pid, fencing, expiresAt }
  }, { mode: 'immediate' })
}

export function renewShareMaintenanceLock(storage, lease, options = {}) {
  const nowMs = Number(options.now?.() ?? Date.now())
  const heartbeatAt = new Date(nowMs).toISOString()
  const expiresAt = new Date(nowMs + (options.ttlMs ?? DEFAULT_LOCK_TTL_MS)).toISOString()
  const result = storage.prepare(`UPDATE share_maintenance_lock SET heartbeat_at = ?, expires_at = ? WHERE singleton = 1 AND owner = ? AND fencing = ?`)
    .run(heartbeatAt, expiresAt, lease.owner, lease.fencing)
  lease.expiresAt = expiresAt
  return Number(result.changes) === 1
}

export function releaseShareMaintenanceLock(storage, lease) {
  return Number(storage.prepare('DELETE FROM share_maintenance_lock WHERE singleton = 1 AND owner = ? AND fencing = ?').run(lease.owner, lease.fencing).changes) === 1
}

async function waitForShareLock(storage, options) {
  const deadline = Date.now() + (options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS)
  while (Date.now() < deadline) {
    const lease = acquireShareMaintenanceLock(storage, options)
    if (lease) return lease
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs ?? 100))
  }
  throw new Error('Timed out waiting for share maintenance lock')
}

export async function runShareMaintenance(operation, options = {}) {
  const existing = maintenanceContext.getStore()
  if (existing) return operation(existing)
  const storage = options.storage || getSqliteStorage()
  const lease = await waitForShareLock(storage, options)
  const interval = options.heartbeatIntervalMs ?? Math.max(10, Math.floor((options.ttlMs ?? DEFAULT_LOCK_TTL_MS) / 3))
  let rejectHeartbeat
  let heartbeatError = null
  const heartbeatFailure = new Promise((_, reject) => { rejectHeartbeat = reject })
  const timer = setInterval(() => {
    try {
      if (!renewShareMaintenanceLock(storage, lease, options)) throw new Error('Share maintenance lock fencing was lost')
    } catch (error) {
      heartbeatError = error
      rejectHeartbeat(error)
    }
  }, interval)
  timer.unref?.()
  maintenanceCount += 1
  try {
    const context = { storage, lease }
    const result = await Promise.race([maintenanceContext.run(context, () => Promise.resolve().then(() => operation(context))), heartbeatFailure])
    if (heartbeatError) throw heartbeatError
    return result
  } finally {
    clearInterval(timer)
    releaseShareMaintenanceLock(storage, lease)
    maintenanceCount = Math.max(0, maintenanceCount - 1)
  }
}

export function isShareMaintenanceActive(storage) {
  if (!storage) {
    try { storage = getSqliteStorage() } catch { return false }
  }
  return maintenanceCount > 0 || Boolean(storage.prepare('SELECT 1 AS active FROM share_maintenance_lock WHERE singleton = 1').get())
}

export function currentShareMaintenanceContext() {
  return maintenanceContext.getStore() || null
}

/**
 * JSON → SQLite share cutover. Phase machine:
 * json_authoritative → cutover_running → sqlite_authoritative_json_pending →
 * authoritative, backed by `share_storage_state` and the independent
 * `share_maintenance_lock`. Runs a stable double snapshot (+ backup reread and
 * a third stability read), then commits the SQLite replace and the pending
 * phase in one transaction. Any failure before pending returns to
 * json_authoritative; after pending the phase stays pending (fail-closed,
 * recoverable on the next start by draining the mirror).
 */
export async function initializeShareCutover(options = {}) {
  const storage = options.storage || getSqliteStorage()
  const repository = options.repository || createShareRepository(storage)
  configureShareService({ repository, mirror: options.mirror || createDefaultShareMirror() })
  return runShareMaintenance(async () => {
    const current = readShareStorageState()
    if (current.phase === SHARE_STORAGE_PHASES.JSON_PENDING) {
      const integrity = repository.verifyIntegrity({ quickCheck: true })
      if (!integrity.ok) throw new Error('Share state pending integrity verification failed')
      const drained = await drainShareJsonMirror()
      if (drained.pending === 0) setShareStoragePhase(SHARE_STORAGE_PHASES.AUTHORITATIVE, { shareCount: integrity.count, digest: integrity.digest, backupFile: current.backupFile })
      return readShareStorageState()
    }
    if (current.phase === SHARE_STORAGE_PHASES.AUTHORITATIVE) {
      const integrity = repository.verifyIntegrity({ quickCheck: true })
      if (!integrity.ok) throw new Error('Share state authoritative integrity verification failed')
      await drainShareJsonMirror()
      return readShareStorageState()
    }

    if (current.phase === SHARE_STORAGE_PHASES.CUTOVER_RUNNING && current.backupFile) {
      setShareStoragePhase(SHARE_STORAGE_PHASES.JSON_AUTHORITATIVE, {
        backupFile: current.backupFile,
        diagnostic: { operation: 'cutover_recovery', recoveredFrom: SHARE_STORAGE_PHASES.CUTOVER_RUNNING },
      })
    }

    let backupFile = current.backupFile
    try {
      const readJson = options.readJson || readSharesJsonFile
      const first = buildShareJsonSnapshot(await readJson())
      const second = buildShareJsonSnapshot(await readJson())
      if (first.count !== second.count || first.digest !== second.digest) {
        throw new Error('Share JSON source changed during cutover double read')
      }
      if (!backupFile) backupFile = await writeShareCutoverBackup(first, options.backupDirectory)
      const third = buildShareJsonSnapshot(await readJson())
      if (first.count !== third.count || first.digest !== third.digest) {
        throw new Error('Share JSON source changed before cutover commit')
      }
      setShareStoragePhase(SHARE_STORAGE_PHASES.CUTOVER_RUNNING, {
        shareCount: first.count,
        digest: first.digest,
        backupFile,
        diagnostic: first.diagnostics,
      })
      const pendingValues = {
        phase: SHARE_STORAGE_PHASES.JSON_PENDING,
        backupFile,
        diagnostic: first.diagnostics,
      }
      repository.replaceAll(first.records, {
        expectedCount: first.count,
        expectedDigest: first.digest,
        storageState: pendingValues,
      })
      const integrity = repository.verifyIntegrity({ quickCheck: true })
      if (!integrity.ok || integrity.count !== first.count || integrity.digest !== first.digest) {
        throw new Error('Share SQLite replace verification failed')
      }
      // Refresh the cached phase so the mirror drain runs in pending mode.
      readShareStorageState()
      const drained = await drainShareJsonMirror()
      if (drained.pending === 0) {
        setShareStoragePhase(SHARE_STORAGE_PHASES.AUTHORITATIVE, {
          shareCount: integrity.count,
          digest: integrity.digest,
          backupFile,
          diagnostic: first.diagnostics,
        })
      }
      return readShareStorageState()
    } catch (error) {
      const state = readShareStorageState()
      if (![SHARE_STORAGE_PHASES.JSON_PENDING, SHARE_STORAGE_PHASES.AUTHORITATIVE].includes(state.phase)) {
        setShareStoragePhase(SHARE_STORAGE_PHASES.JSON_AUTHORITATIVE, {
          backupFile,
          diagnostic: { operation: 'cutover', errorName: error?.name || 'Error', error: error?.message || String(error) },
        })
        return readShareStorageState()
      }
      throw error
    }
  }, { ...options, storage, operation: 'share-cutover' })
}
