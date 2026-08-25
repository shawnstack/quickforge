import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getSqliteStorage } from './sqlite/database.mjs'
import { createLanAccessRepository, lanAccessConfigDigest, normalizeLanAccessConfig } from './sqlite/lan-access-repository.mjs'
import {
  LAN_ACCESS_STORAGE_PHASES,
  configureLanAccessService,
  createDefaultLanAccessMirror,
  drainLanAccessJsonMirror,
  readLanAccessStorageState,
  setLanAccessStoragePhase,
} from './lan-access-service.mjs'
import {
  defaultLanAccessConfig,
  ensureLanAccessJsonFile,
  readLanAccessJsonFile,
  writeLanAccessJsonFile,
} from './lan-access-json-file.mjs'
import { storageDir } from './storage.mjs'
import { logger } from './utils/logger.mjs'

const DEFAULT_LOCK_TTL_MS = 60_000
const DEFAULT_WAIT_TIMEOUT_MS = 65_000
const maintenanceContext = new AsyncLocalStorage()
let maintenanceCount = 0

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

/**
 * Validate and normalize the whole LAN access JSON config (`security/
 * lan-access.json`) into a canonical config. Fails closed on: malformed config
 * object, password hash/salt inconsistency, enabled-without-password, malformed
 * `tokens` array. Expired tokens are pruned exactly like `pruneTokens` on the
 * JSON side and the ≤100 cap keeps the newest entries. The count/digest are
 * computed with the exact repository digest algorithm so the SQLite replace
 * verification can compare digests 1:1.
 */
export function buildLanAccessJsonSnapshot(input, { now = () => new Date().toISOString() } = {}) {
  if (!isPlainObject(input)) throw new TypeError('LAN access JSON config must be an object')
  const config = normalizeLanAccessConfig(
    input.updatedAt ? input : { ...input, updatedAt: now() },
    { now },
  )
  return {
    config,
    tokenCount: config.tokens.length,
    digest: lanAccessConfigDigest(config),
    diagnostics: { source: 'security/lan-access.json' },
  }
}

/**
 * Default cutover JSON source reader. Missing files (ENOENT) and unreadable or
 * corrupt JSON both fall back to the default disabled config — the same
 * semantics lan-access-store applies to a missing file — so the server can
 * continue and LAN access simply starts disabled (fail-closed). The fallback is
 * materialized so repeated reads stay stable for the double-snapshot check.
 */
export async function readLanAccessJsonSource() {
  await ensureLanAccessJsonFile()
  try {
    return await readLanAccessJsonFile()
  } catch {
    const fallback = defaultLanAccessConfig()
    await writeLanAccessJsonFile(fallback)
    return fallback
  }
}

async function writeLanAccessCutoverBackup(snapshot, directory = path.join(storageDir, 'backups')) {
  await fs.mkdir(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const finalPath = path.join(directory, `quickforge-lan-access-cutover-${stamp}.json`)
  const temporaryPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`
  const backup = {
    app: 'quickforge',
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: 'lan-access',
    includeSecrets: false,
    lanAccess: { tokenCount: snapshot.tokenCount, digest: snapshot.digest },
    data: {
      lanAccess: snapshot.config,
    },
  }
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8')
    const verified = JSON.parse(await fs.readFile(temporaryPath, 'utf8'))
    const verifiedSnapshot = buildLanAccessJsonSnapshot(verified.data?.lanAccess)
    if (verified.lanAccess?.tokenCount !== snapshot.tokenCount || verified.lanAccess?.digest !== snapshot.digest
      || verifiedSnapshot.tokenCount !== snapshot.tokenCount || verifiedSnapshot.digest !== snapshot.digest) {
      throw new Error('LAN access cutover backup verification failed')
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

export function acquireLanAccessMaintenanceLock(storage, options = {}) {
  const nowMs = Number(options.now?.() ?? Date.now())
  const acquiredAt = new Date(nowMs).toISOString()
  const expiresAt = new Date(nowMs + (options.ttlMs ?? DEFAULT_LOCK_TTL_MS)).toISOString()
  const identity = isPlainObject(options.owner)
    ? { id: options.owner.id || `${options.owner.pid || process.pid}:${randomUUID()}`, pid: options.owner.pid || process.pid }
    : { id: options.owner || `${process.pid}:${randomUUID()}`, pid: process.pid }
  const isPidAlive = options.pidAlive || pidAlive
  return storage.transaction((database) => {
    const current = database.prepare('SELECT * FROM lan_access_maintenance_lock WHERE singleton = 1').get()
    if (current && current.owner === identity.id) {
      database.prepare(`UPDATE lan_access_maintenance_lock SET owner_pid = ?, operation = ?, heartbeat_at = ?, expires_at = ?
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
    database.prepare(`INSERT INTO lan_access_maintenance_lock
      (singleton, owner, owner_pid, fencing, operation, acquired_at, heartbeat_at, expires_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET owner=excluded.owner, owner_pid=excluded.owner_pid, fencing=excluded.fencing,
      operation=excluded.operation, acquired_at=excluded.acquired_at, heartbeat_at=excluded.heartbeat_at, expires_at=excluded.expires_at`)
      .run(identity.id, identity.pid, fencing, options.operation || 'lan-access-maintenance', acquiredAt, acquiredAt, expiresAt)
    return { owner: identity.id, ownerPid: identity.pid, fencing, expiresAt }
  }, { mode: 'immediate' })
}

export function renewLanAccessMaintenanceLock(storage, lease, options = {}) {
  const nowMs = Number(options.now?.() ?? Date.now())
  const heartbeatAt = new Date(nowMs).toISOString()
  const expiresAt = new Date(nowMs + (options.ttlMs ?? DEFAULT_LOCK_TTL_MS)).toISOString()
  const result = storage.prepare(`UPDATE lan_access_maintenance_lock SET heartbeat_at = ?, expires_at = ? WHERE singleton = 1 AND owner = ? AND fencing = ?`)
    .run(heartbeatAt, expiresAt, lease.owner, lease.fencing)
  lease.expiresAt = expiresAt
  return Number(result.changes) === 1
}

export function releaseLanAccessMaintenanceLock(storage, lease) {
  return Number(storage.prepare('DELETE FROM lan_access_maintenance_lock WHERE singleton = 1 AND owner = ? AND fencing = ?').run(lease.owner, lease.fencing).changes) === 1
}

async function waitForLanAccessLock(storage, options) {
  const deadline = Date.now() + (options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS)
  while (Date.now() < deadline) {
    const lease = acquireLanAccessMaintenanceLock(storage, options)
    if (lease) return lease
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs ?? 100))
  }
  throw new Error('Timed out waiting for LAN access maintenance lock')
}

export async function runLanAccessMaintenance(operation, options = {}) {
  const existing = maintenanceContext.getStore()
  if (existing) return operation(existing)
  const storage = options.storage || getSqliteStorage()
  const lease = await waitForLanAccessLock(storage, options)
  const interval = options.heartbeatIntervalMs ?? Math.max(10, Math.floor((options.ttlMs ?? DEFAULT_LOCK_TTL_MS) / 3))
  let rejectHeartbeat
  let heartbeatError = null
  const heartbeatFailure = new Promise((_, reject) => { rejectHeartbeat = reject })
  const timer = setInterval(() => {
    try {
      if (!renewLanAccessMaintenanceLock(storage, lease, options)) throw new Error('LAN access maintenance lock fencing was lost')
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
    releaseLanAccessMaintenanceLock(storage, lease)
    maintenanceCount = Math.max(0, maintenanceCount - 1)
  }
}

export function isLanAccessMaintenanceActive(storage) {
  if (!storage) {
    try { storage = getSqliteStorage() } catch { return false }
  }
  return maintenanceCount > 0 || Boolean(storage.prepare('SELECT 1 AS active FROM lan_access_maintenance_lock WHERE singleton = 1').get())
}

export function currentLanAccessMaintenanceContext() {
  return maintenanceContext.getStore() || null
}

/**
 * JSON → SQLite LAN access cutover. Phase machine:
 * json_authoritative → cutover_running → sqlite_authoritative_json_pending →
 * authoritative, backed by `lan_access_storage_state` and the independent
 * `lan_access_maintenance_lock`. Runs a stable double snapshot (+ backup reread
 * and a third stability read), then commits the SQLite replace and the pending
 * phase in one transaction. Any failure before pending returns to
 * json_authoritative; after pending the phase stays pending (fail-closed,
 * recoverable on the next start by draining the mirror).
 */
export async function initializeLanAccessCutover(options = {}) {
  const storage = options.storage || getSqliteStorage()
  const repository = options.repository || createLanAccessRepository(storage)
  configureLanAccessService({ repository, mirror: options.mirror || createDefaultLanAccessMirror() })
  const log = options.logger || logger
  const migrate = async () => {
    const current = readLanAccessStorageState()
    if (current.phase === LAN_ACCESS_STORAGE_PHASES.JSON_PENDING) {
      const drained = await drainLanAccessJsonMirror()
      if (drained.pending === 0) {
        setLanAccessStoragePhase(LAN_ACCESS_STORAGE_PHASES.AUTHORITATIVE, {
          lanTokenCount: current.lanTokenCount,
          digest: current.digest,
          backupFile: current.backupFile,
          diagnostic: current.diagnostic,
        })
        log.info('LAN access cutover promoted to authoritative', { domain: 'lan-access', phase: 'authoritative', tokenCount: current.lanTokenCount })
      }
      return readLanAccessStorageState()
    }
    if (current.phase === LAN_ACCESS_STORAGE_PHASES.AUTHORITATIVE) {
      // Routine pending/authoritative startup only drains the transactional
      // JSON mirror outbox. Strict snapshot and relationship verification stays
      // at first cutover or explicit maintenance boundaries.
      await drainLanAccessJsonMirror()
      log.info('LAN access authoritative startup mirror drain complete', { domain: 'lan-access', phase: 'authoritative' })
      return readLanAccessStorageState()
    }

    if (current.phase === LAN_ACCESS_STORAGE_PHASES.CUTOVER_RUNNING && current.backupFile) {
      log.warn('LAN access cutover recovery: rerunning the JSON migration', { domain: 'lan-access', phase: 'cutover_running', backupFile: current.backupFile })
      setLanAccessStoragePhase(LAN_ACCESS_STORAGE_PHASES.JSON_AUTHORITATIVE, {
        backupFile: current.backupFile,
        diagnostic: { operation: 'cutover_recovery', recoveredFrom: LAN_ACCESS_STORAGE_PHASES.CUTOVER_RUNNING },
      })
    }

    let backupFile = current.backupFile
    try {
      const readJson = options.readJson || readLanAccessJsonSource
      const first = buildLanAccessJsonSnapshot(await readJson())
      const second = buildLanAccessJsonSnapshot(await readJson())
      if (first.tokenCount !== second.tokenCount || first.digest !== second.digest) {
        throw new Error('LAN access JSON source changed during cutover double read')
      }
      log.info('LAN access cutover migration started', { domain: 'lan-access', tokenCount: first.tokenCount })
      if (!backupFile) backupFile = await writeLanAccessCutoverBackup(first, options.backupDirectory)
      const third = buildLanAccessJsonSnapshot(await readJson())
      if (first.tokenCount !== third.tokenCount || first.digest !== third.digest) {
        throw new Error('LAN access JSON source changed before cutover commit')
      }
      setLanAccessStoragePhase(LAN_ACCESS_STORAGE_PHASES.CUTOVER_RUNNING, {
        lanTokenCount: first.tokenCount,
        digest: first.digest,
        backupFile,
        diagnostic: first.diagnostics,
      })
      const pendingValues = {
        phase: LAN_ACCESS_STORAGE_PHASES.JSON_PENDING,
        backupFile,
        diagnostic: first.diagnostics,
      }
      repository.replaceAll(first.config, {
        expectedCount: first.tokenCount,
        expectedDigest: first.digest,
        storageState: pendingValues,
      })
      const integrity = repository.verifyIntegrity({ quickCheck: true })
      if (!integrity.ok || integrity.count !== first.tokenCount || integrity.digest !== first.digest) {
        throw new Error('LAN access SQLite replace verification failed')
      }
      // Refresh the cached phase so the mirror drain runs in pending mode.
      readLanAccessStorageState()
      const drained = await drainLanAccessJsonMirror()
      if (drained.pending === 0) {
        setLanAccessStoragePhase(LAN_ACCESS_STORAGE_PHASES.AUTHORITATIVE, {
          lanTokenCount: integrity.count,
          digest: integrity.digest,
          backupFile,
          diagnostic: first.diagnostics,
        })
      }
      const result = readLanAccessStorageState()
      log.info('LAN access cutover migration complete', { domain: 'lan-access', phase: result.phase, tokenCount: first.tokenCount })
      return result
    } catch (error) {
      const state = readLanAccessStorageState()
      if (![LAN_ACCESS_STORAGE_PHASES.JSON_PENDING, LAN_ACCESS_STORAGE_PHASES.AUTHORITATIVE].includes(state.phase)) {
        setLanAccessStoragePhase(LAN_ACCESS_STORAGE_PHASES.JSON_AUTHORITATIVE, {
          backupFile,
          diagnostic: { operation: 'cutover', errorName: error?.name || 'Error', error: error?.message || String(error) },
        })
        log.warn('LAN access cutover failed; keeping the JSON store path', { domain: 'lan-access', phase: 'json_authoritative', errorName: error?.name || 'Error', errorMessage: error?.message })
        return readLanAccessStorageState()
      }
      throw error
    }
  }
  try {
    return await runLanAccessMaintenance(migrate, { ...options, storage, operation: 'lan-access-cutover' })
  } catch (error) {
    log.error('LAN access cutover failed and blocked startup', { domain: 'lan-access', errorName: error?.name || 'Error', errorMessage: error?.message })
    throw error
  }
}
