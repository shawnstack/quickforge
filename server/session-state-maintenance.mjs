import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { getSqliteStorage } from './sqlite/database.mjs'

// Session-domain maintenance lock (extracted from the retired
// session-state-cutover.mjs when the JSON→SQLite phase machine was removed):
// restore/verify operations serialize across processes through the
// `session_state_maintenance_lock` table (created by SQLite migration v6 and
// kept by schema v11), with owner liveness, fencing tokens and a TTL renewed
// by heartbeat while an operation runs.

const DEFAULT_LOCK_TTL_MS = 60_000
const DEFAULT_WAIT_TIMEOUT_MS = 65_000
const maintenanceContext = new AsyncLocalStorage()
let maintenanceCount = 0

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function ownerPid(current) {
  const value = Number(current.owner_pid)
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
