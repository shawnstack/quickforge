import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { getSqliteStorage } from './sqlite/database.mjs'
import { createScheduledTaskRunsRepository } from './sqlite/scheduled-task-runs-repository.mjs'

// Scheduled-runs domain maintenance lock (extracted from the retired
// scheduled-runs-cutover.mjs when the JSON→SQLite phase machine was removed):
// backup export and restore serialize across processes through the
// `scheduled_runs_maintenance_lock` table (created by the SQLite migrations),
// with owner liveness, fencing tokens and a TTL renewed by heartbeat while an
// operation runs. SQLite is the only authoritative scheduled-runs store, so
// this module owns nothing but the lock, the runtime pause hooks and the
// constant storage state surfaced by /api/migration-status.

const DEFAULT_LOCK_TTL_MS = 60_000
const DEFAULT_WAIT_TIMEOUT_MS = 65_000
const LOCK_OPERATION_BACKUP_EXPORT = 'scheduled-runs-backup-export'
let localMaintenanceCount = 0
let retainedMaintenance = null
let runtimeHooks = Object.freeze({})
const maintenanceContext = new AsyncLocalStorage()

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function lockStorageOrNull(storage) {
  if (storage) return storage
  try { return getSqliteStorage() } catch { return null }
}

function ownerPidFromRow(row) {
  const value = Number(row?.owner_pid)
  if (Number.isInteger(value) && value > 0) return value
  const parsed = Number(String(row?.owner || '').split(':', 1)[0])
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function defaultPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function normalizedLockOwner(owner) {
  if (isPlainObject(owner)) {
    return {
      id: typeof owner.id === 'string' && owner.id ? owner.id : `${owner.pid || process.pid}:${randomUUID()}`,
      pid: Number.isInteger(owner.pid) && owner.pid > 0 ? owner.pid : process.pid,
    }
  }
  return { id: typeof owner === 'string' && owner ? owner : `${process.pid}:${randomUUID()}`, pid: process.pid }
}

export function ensureScheduledRunsMaintenanceLockSchema(storage = getSqliteStorage()) {
  const columns = new Set(storage.prepare('PRAGMA table_info(scheduled_runs_maintenance_lock)').all().map((column) => column.name))
  if (!columns.has('owner_pid')) storage.exec('ALTER TABLE scheduled_runs_maintenance_lock ADD COLUMN owner_pid INTEGER')
  if (!columns.has('fencing')) storage.exec('ALTER TABLE scheduled_runs_maintenance_lock ADD COLUMN fencing INTEGER NOT NULL DEFAULT 1')
  if (!columns.has('heartbeat_at')) storage.exec('ALTER TABLE scheduled_runs_maintenance_lock ADD COLUMN heartbeat_at TEXT')
  storage.prepare(`UPDATE scheduled_runs_maintenance_lock SET
    owner_pid = COALESCE(owner_pid, CAST(substr(owner, 1, instr(owner || ':', ':') - 1) AS INTEGER)),
    fencing = COALESCE(fencing, 1), heartbeat_at = COALESCE(heartbeat_at, acquired_at)
    WHERE singleton = 1`).run()
}

function readMaintenanceLock(storage) {
  const handle = lockStorageOrNull(storage)
  if (!handle) return null
  try {
    ensureScheduledRunsMaintenanceLockSchema(handle)
    return handle.prepare('SELECT * FROM scheduled_runs_maintenance_lock WHERE singleton = 1').get() || null
  } catch {
    return null
  }
}

function localMaintenanceActive() {
  return localMaintenanceCount > 0 || retainedMaintenance !== null
}

export function isScheduledRunsMaintenanceActive(storage) {
  return localMaintenanceActive() || readMaintenanceLock(storage) !== null
}

export function canStartScheduledRun(storage) {
  return !isScheduledRunsMaintenanceActive(storage)
}

export function configureScheduledRunsRuntimeHooks(hooks = {}) {
  runtimeHooks = Object.freeze({ ...hooks })
}

export function currentScheduledRunsMaintenanceContext() {
  return maintenanceContext.getStore() || null
}

// API guard for the maintenance window: a restore rewrites every run row, so
// scheduled-task HTTP calls and scheduler ticks stay out of the way while the
// lock is held. A read-only backup export runs under the same lock but keeps the
// API available.
export function assertScheduledRunsAvailable(storage) {
  if (!localMaintenanceActive()) {
    const lock = readMaintenanceLock(storage)
    if (!lock || lock.operation === LOCK_OPERATION_BACKUP_EXPORT) return
  }
  const error = new Error('Scheduled task maintenance is in progress')
  error.statusCode = 423
  error.errorCode = 'scheduled_runs_maintenance'
  throw error
}

// Constant authoritative state for startup-state/诊断展示: there is no
// scheduled_runs_state phase to read any more — SQLite is authoritative by
// construction and the live run count comes straight from the repository.
export function readScheduledRunsStorageState(storage) {
  let runCount = null
  try {
    runCount = createScheduledTaskRunsRepository(storage || getSqliteStorage()).count()
  } catch {
    // SQLite not initialized yet (early startup diagnostics): the count is
    // simply unknown until the store opens.
  }
  return {
    phase: 'authoritative',
    runCount,
    digest: null,
    backupFile: null,
    diagnostic: null,
    updatedAt: null,
  }
}

export function acquireScheduledRunsMaintenanceLock(storage, {
  owner,
  operation,
  now = () => Date.now(),
  ttlMs = DEFAULT_LOCK_TTL_MS,
  pidAlive = defaultPidAlive,
} = {}) {
  ensureScheduledRunsMaintenanceLockSchema(storage)
  const identity = normalizedLockOwner(owner)
  const nowMs = Number(now())
  const acquiredAt = new Date(nowMs).toISOString()
  const expiresAt = new Date(nowMs + ttlMs).toISOString()
  return storage.transaction((database) => {
    const current = database.prepare('SELECT * FROM scheduled_runs_maintenance_lock WHERE singleton = 1').get()
    if (current && current.owner === identity.id) {
      const fencing = Number(current.fencing || 1)
      database.prepare(`UPDATE scheduled_runs_maintenance_lock
        SET operation = ?, owner_pid = ?, heartbeat_at = ?, expires_at = ?
        WHERE singleton = 1 AND owner = ? AND fencing = ?`)
        .run(operation || current.operation, identity.pid, acquiredAt, expiresAt, identity.id, fencing)
      return { owner: identity.id, ownerPid: identity.pid, fencing, expiresAt }
    }
    if (current) {
      const expired = Date.parse(current.expires_at) <= nowMs
      const stalePid = ownerPidFromRow(current)
      if (!expired || stalePid === null || pidAlive(stalePid)) return null
    }
    const fencing = Number(current?.fencing || 0) + 1
    database.prepare(`
      INSERT INTO scheduled_runs_maintenance_lock
        (singleton, owner, owner_pid, fencing, operation, acquired_at, heartbeat_at, expires_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET owner = excluded.owner, owner_pid = excluded.owner_pid,
        fencing = excluded.fencing, operation = excluded.operation, acquired_at = excluded.acquired_at,
        heartbeat_at = excluded.heartbeat_at, expires_at = excluded.expires_at
    `).run(identity.id, identity.pid, fencing, operation || 'scheduled-runs-maintenance', acquiredAt, acquiredAt, expiresAt)
    return { owner: identity.id, ownerPid: identity.pid, fencing, expiresAt }
  })
}

export function renewScheduledRunsMaintenanceLock(storage, lease, {
  now = () => Date.now(),
  ttlMs = DEFAULT_LOCK_TTL_MS,
} = {}) {
  if (!lease) return false
  const nowMs = Number(now())
  const heartbeatAt = new Date(nowMs).toISOString()
  const expiresAt = new Date(nowMs + ttlMs).toISOString()
  const result = storage.prepare(`UPDATE scheduled_runs_maintenance_lock
    SET heartbeat_at = ?, expires_at = ?
    WHERE singleton = 1 AND owner = ? AND fencing = ?`)
    .run(heartbeatAt, expiresAt, lease.owner, lease.fencing)
  if (Number(result.changes) !== 1) return false
  lease.expiresAt = expiresAt
  return true
}

export function releaseScheduledRunsMaintenanceLock(storage, lease) {
  if (!lease) return false
  return Number(storage.prepare(`DELETE FROM scheduled_runs_maintenance_lock
    WHERE singleton = 1 AND owner = ? AND fencing = ?`).run(lease.owner, lease.fencing).changes) === 1
}

async function waitForMaintenanceLock(storage, lockOptions) {
  const waitTimeoutMs = lockOptions.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
  const pollIntervalMs = lockOptions.pollIntervalMs ?? 100
  const deadline = Date.now() + waitTimeoutMs
  while (Date.now() < deadline) {
    const lease = acquireScheduledRunsMaintenanceLock(storage, lockOptions)
    if (lease) return lease
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
  throw new Error('Timed out waiting for scheduled runs maintenance lock')
}

export async function runScheduledRunsMaintenance(operation, options = {}) {
  const existing = maintenanceContext.getStore()
  if (existing) return operation(existing)
  const storage = options.storage || getSqliteStorage()
  const lockOptions = {
    owner: options.owner,
    operation: options.operation,
    now: options.now,
    ttlMs: options.ttlMs,
    pidAlive: options.pidAlive,
    waitTimeoutMs: options.waitTimeoutMs,
    pollIntervalMs: options.pollIntervalMs,
  }
  const lease = await waitForMaintenanceLock(storage, lockOptions)
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? Math.max(10, Math.floor((options.ttlMs ?? DEFAULT_LOCK_TTL_MS) / 3))
  let rejectHeartbeat
  let heartbeatError = null
  const heartbeatFailure = new Promise((_, reject) => { rejectHeartbeat = reject })
  const timer = setInterval(() => {
    try {
      if (!renewScheduledRunsMaintenanceLock(storage, lease, { now: options.now, ttlMs: options.ttlMs })) {
        throw new Error('Scheduled runs maintenance lock fencing was lost')
      }
    } catch (error) {
      heartbeatError = error
      rejectHeartbeat(error)
    }
  }, heartbeatIntervalMs)
  timer.unref?.()
  localMaintenanceCount += 1
  let paused = false
  try {
    if (options.pauseRuntime !== false && typeof runtimeHooks.pause === 'function') {
      await runtimeHooks.pause()
      paused = true
    }
    const context = { storage, lease }
    const result = await Promise.race([maintenanceContext.run(context, () => Promise.resolve().then(() => operation(context))), heartbeatFailure])
    if (heartbeatError) throw heartbeatError
    return result
  } catch (error) {
    if (error?.retainScheduledRunsMaintenance === true) {
      retainedMaintenance = { storage, lease, timer, paused }
      localMaintenanceCount = Math.max(0, localMaintenanceCount - 1)
      throw error
    }
    throw error
  } finally {
    if (retainedMaintenance?.lease !== lease) {
      // Reset any stale retained flag from an earlier retain: this branch
      // releases the lock normally, so retainedMaintenance must only stay set
      // while a retained lease is genuinely still held.
      retainedMaintenance = null
      clearInterval(timer)
      releaseScheduledRunsMaintenanceLock(storage, lease)
      localMaintenanceCount = Math.max(0, localMaintenanceCount - 1)
      if (paused && options.resumeRuntime !== false && typeof runtimeHooks.resume === 'function') runtimeHooks.resume()
    }
  }
}
