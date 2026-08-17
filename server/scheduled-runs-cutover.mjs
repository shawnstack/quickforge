import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getSqliteStorage } from './sqlite/database.mjs'
import { createScheduledTaskRunsRepository } from './sqlite/scheduled-task-runs-repository.mjs'
import { readStore, storageDir, writeStore } from './storage.mjs'
import { logger } from './utils/logger.mjs'

export const SCHEDULED_RUNS_PHASES = Object.freeze({
  HYBRID: 'hybrid',
  CUTOVER_RUNNING: 'cutover_running',
  JSON_PENDING: 'sqlite_authoritative_json_pending',
  AUTHORITATIVE: 'authoritative',
})

const DEFAULT_LOCK_TTL_MS = 60_000
const DEFAULT_WAIT_TIMEOUT_MS = 65_000
let cachedPhase = SCHEDULED_RUNS_PHASES.HYBRID
let localMaintenanceCount = 0
let retainedMaintenance = null
let runtimeHooks = Object.freeze({})
const maintenanceContext = new AsyncLocalStorage()

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

export function scheduledRunsDigest(entries) {
  const canonical = [...entries]
    .map(({ taskId, run }) => {
      const normalizedRun = { ...run }
      delete normalizedRun.taskId
      delete normalizedRun.source
      delete normalizedRun.updatedAt
      for (const field of ['agentId', 'agentLabel', 'agentSnapshot']) {
        if (normalizedRun[field] === undefined) normalizedRun[field] = null
      }
      return { taskId, run: canonicalize(normalizedRun) }
    })
    .sort((a, b) => String(a.taskId).localeCompare(String(b.taskId)) || String(a.run.id).localeCompare(String(b.run.id)))
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

export function splitScheduledTasksRuns(tasksValue) {
  const tasks = isPlainObject(tasksValue) ? tasksValue : {}
  const metadata = {}
  const entries = []
  for (const [recordId, task] of Object.entries(tasks)) {
    if (!isPlainObject(task)) throw new TypeError(`Invalid scheduled task: ${recordId}`)
    const taskId = typeof task.id === 'string' && task.id.trim() ? task.id : recordId
    if (!taskId || taskId !== recordId) throw new TypeError(`Scheduled task id mismatch: ${recordId}`)
    const seen = new Set()
    const runs = task.runs === undefined ? [] : task.runs
    if (!Array.isArray(runs)) throw new TypeError(`Scheduled task runs must be an array: ${taskId}`)
    for (const run of runs) {
      if (!isPlainObject(run)) throw new TypeError(`Invalid scheduled task run: ${taskId}`)
      if (typeof run.id !== 'string' || !run.id.trim()) throw new TypeError(`Scheduled task run id is required: ${taskId}`)
      if (seen.has(run.id)) throw new TypeError(`Duplicate scheduled task run: ${taskId}/${run.id}`)
      if (!['running', 'success', 'failed'].includes(run.status)) throw new TypeError(`Invalid scheduled task run status: ${taskId}/${run.id}`)
      if (typeof run.startedAt !== 'string' || !run.startedAt.trim() || Number.isNaN(new Date(run.startedAt).getTime())) {
        throw new TypeError(`Invalid scheduled task run startedAt: ${taskId}/${run.id}`)
      }
      seen.add(run.id)
      entries.push({ taskId, run: structuredClone(run), source: 'json_cutover' })
    }
    const { runs: _runs, ...taskMetadata } = task
    metadata[recordId] = taskMetadata
  }
  return { metadata, entries, count: entries.length, digest: scheduledRunsDigest(entries) }
}

export function getScheduledRunsPhase() {
  return cachedPhase
}

export function isScheduledRunsAuthoritative() {
  return cachedPhase === SCHEDULED_RUNS_PHASES.JSON_PENDING || cachedPhase === SCHEDULED_RUNS_PHASES.AUTHORITATIVE
}

export function configureScheduledRunsRuntimeHooks(hooks = {}) {
  runtimeHooks = Object.freeze({ ...hooks })
}

export function currentScheduledRunsMaintenanceContext() {
  return maintenanceContext.getStore() || null
}

function lockStorageOrNull(storage) {
  if (storage) return storage
  try { return getSqliteStorage() } catch { return null }
}

export function readScheduledRunsMaintenanceLock(storage) {
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
  return localMaintenanceActive() || readScheduledRunsMaintenanceLock(storage) !== null
}

export function canStartScheduledRun(storage) {
  return !isScheduledRunsMaintenanceActive(storage)
}

export function recordScheduledRunsDiagnostic(operation, error, details = {}, storage = getSqliteStorage()) {
  const diagnostic = {
    operation,
    ...details,
    errorName: error?.name || 'Error',
    errorCode: error?.code,
    recordedAt: new Date().toISOString(),
  }
  storage.prepare('UPDATE scheduled_runs_state SET diagnostic_json = ?, updated_at = ? WHERE singleton = 1')
    .run(JSON.stringify(diagnostic), diagnostic.recordedAt)
  return diagnostic
}

export function assertScheduledRunsAvailable(storage) {
  if (!localMaintenanceActive()) {
    const lock = readScheduledRunsMaintenanceLock(storage)
    if (!lock || lock.operation === 'scheduled-runs-backup-export') return
  }
  const error = new Error('Scheduled task maintenance is in progress')
  error.statusCode = 423
  error.errorCode = 'scheduled_runs_maintenance'
  throw error
}

function readState(storage) {
  const row = storage.prepare('SELECT * FROM scheduled_runs_state WHERE singleton = 1').get()
  if (!row) throw new Error('Scheduled runs state is missing')
  return {
    phase: row.phase,
    runCount: row.run_count === null ? null : Number(row.run_count),
    digest: row.digest,
    backupFile: row.backup_file,
    diagnostic: row.diagnostic_json ? JSON.parse(row.diagnostic_json) : null,
    updatedAt: row.updated_at,
  }
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

export function readScheduledRunsState(storage = getSqliteStorage()) {
  ensureScheduledRunsMaintenanceLockSchema(storage)
  const state = readState(storage)
  cachedPhase = state.phase
  return state
}

function updateState(database, phase, values = {}) {
  database.prepare(`
    UPDATE scheduled_runs_state SET
      phase = ?, run_count = ?, digest = ?, backup_file = ?, diagnostic_json = ?, updated_at = ?
    WHERE singleton = 1
  `).run(
    phase,
    values.runCount ?? null,
    values.digest ?? null,
    values.backupFile ?? null,
    values.diagnostic ? JSON.stringify(values.diagnostic) : null,
    new Date().toISOString(),
  )
  cachedPhase = phase
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
      const stalePid = ownerPidFromRow(current)
      if (stalePid === null || pidAlive(stalePid)) return null
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
      clearInterval(timer)
      releaseScheduledRunsMaintenanceLock(storage, lease)
      localMaintenanceCount = Math.max(0, localMaintenanceCount - 1)
      if (paused && options.resumeRuntime !== false && typeof runtimeHooks.resume === 'function') runtimeHooks.resume()
    }
  }
}

async function writeLogicalCutoverBackup(tasks, snapshot, backupDirectory) {
  const directory = backupDirectory || path.join(storageDir, 'backups')
  await fs.mkdir(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const finalPath = path.join(directory, `quickforge-scheduled-runs-cutover-${stamp}.json`)
  const temporaryPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`
  const backup = {
    app: 'quickforge',
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: 'config',
    includeSecrets: false,
    scheduledRuns: { count: snapshot.count, digest: snapshot.digest },
    data: { scheduledTasks: tasks },
  }
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8')
    const verified = JSON.parse(await fs.readFile(temporaryPath, 'utf8'))
    const verifiedSnapshot = splitScheduledTasksRuns(verified.data.scheduledTasks)
    if (verifiedSnapshot.count !== snapshot.count || verifiedSnapshot.digest !== snapshot.digest) throw new Error('Scheduled runs cutover backup verification failed')
    await fs.rename(temporaryPath, finalPath)
    return finalPath
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

async function slimJson(readTasks, writeTasks, metadata) {
  await writeTasks(metadata)
  const verified = splitScheduledTasksRuns(await readTasks())
  if (verified.count !== 0) throw new Error('Scheduled task JSON slimming verification failed')
}

export function verifyScheduledRunsRepository(repository, snapshot) {
  const taskIds = Object.keys(snapshot.metadata)
  const first = repository.list({ page: 1, pageSize: 100, taskIds })
  let entries = first.runs.map((run) => {
    const { taskId, source: _source, ...value } = run
    return { taskId, run: value }
  })
  for (let page = 2; entries.length < first.total; page += 1) {
    const next = repository.list({ page, pageSize: 100, taskIds })
    entries = entries.concat(next.runs.map((run) => {
      const { taskId, source: _source, ...value } = run
      return { taskId, run: value }
    }))
  }
  const digest = scheduledRunsDigest(entries)
  if (entries.length !== snapshot.count || digest !== snapshot.digest) throw new Error('Scheduled runs SQLite count/digest verification failed')
}

export async function initializeScheduledRunsCutover(options = {}) {
  const storage = options.storage || getSqliteStorage()
  const repository = options.repository || createScheduledTaskRunsRepository(storage)
  const readTasks = options.readTasks || (() => readStore('scheduled-tasks'))
  const writeTasks = options.writeTasks || ((tasks) => writeStore('scheduled-tasks', tasks))
  const log = options.logger || logger

  return runScheduledRunsMaintenance(async () => {
    let state = readState(storage)
    cachedPhase = state.phase
    if (state.phase === SCHEDULED_RUNS_PHASES.JSON_PENDING) {
      try {
        const snapshot = splitScheduledTasksRuns(await readTasks())
        await slimJson(readTasks, writeTasks, snapshot.metadata)
        storage.transaction((database) => updateState(database, SCHEDULED_RUNS_PHASES.AUTHORITATIVE, state))
      } catch (error) {
        recordScheduledRunsDiagnostic('json_slim_retry', error, {}, storage)
        log.warn('Scheduled runs JSON slimming remains pending', { errorName: error?.name || 'Error' })
      }
      return readState(storage)
    }

    if (state.phase === SCHEDULED_RUNS_PHASES.AUTHORITATIVE) {
      try {
        const snapshot = splitScheduledTasksRuns(await readTasks())
        if (snapshot.count > 0) await slimJson(readTasks, writeTasks, snapshot.metadata)
        storage.health({ quickCheck: true })
      } catch (error) {
        recordScheduledRunsDiagnostic('authoritative_validation', error, {}, storage)
        const blocked = new Error('Scheduled runs authoritative startup validation failed', { cause: error })
        throw blocked
      }
      return readState(storage)
    }

    let tasks
    let snapshot
    let backupFile = state.backupFile
    try {
      tasks = await readTasks()
      snapshot = splitScheduledTasksRuns(tasks)
      if (!backupFile) backupFile = await writeLogicalCutoverBackup(tasks, snapshot, options.backupDirectory)
      storage.transaction((database) => updateState(database, SCHEDULED_RUNS_PHASES.CUTOVER_RUNNING, {
        runCount: snapshot.count,
        digest: snapshot.digest,
        backupFile,
      }))
      storage.transaction((database) => {
        repository.replaceAll(snapshot.entries, { source: 'json_cutover' })
        verifyScheduledRunsRepository(repository, snapshot)
        updateState(database, SCHEDULED_RUNS_PHASES.JSON_PENDING, {
          runCount: snapshot.count,
          digest: snapshot.digest,
          backupFile,
        })
      })
    } catch (error) {
      const current = readState(storage)
      if (![SCHEDULED_RUNS_PHASES.JSON_PENDING, SCHEDULED_RUNS_PHASES.AUTHORITATIVE].includes(current.phase)) {
        storage.transaction((database) => updateState(database, SCHEDULED_RUNS_PHASES.HYBRID, {
          backupFile,
          diagnostic: { operation: 'cutover', error: error?.message || String(error) },
        }))
        log.warn('Scheduled runs cutover stayed in hybrid mode', { errorName: error?.name || 'Error' })
        return readState(storage)
      }
      throw error
    }

    try {
      await slimJson(readTasks, writeTasks, snapshot.metadata)
      storage.transaction((database) => updateState(database, SCHEDULED_RUNS_PHASES.AUTHORITATIVE, {
        runCount: snapshot.count,
        digest: snapshot.digest,
        backupFile,
      }))
    } catch (error) {
      recordScheduledRunsDiagnostic('authoritative_json_slim', error, {}, storage)
      log.warn('Scheduled runs JSON slimming is pending', { errorName: error?.name || 'Error' })
    }
    return readState(storage)
  }, {
    storage,
    owner: options.owner,
    operation: 'scheduled-runs-cutover',
    now: options.now,
    ttlMs: options.ttlMs,
    heartbeatIntervalMs: options.heartbeatIntervalMs,
    waitTimeoutMs: options.waitTimeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    pidAlive: options.pidAlive,
    pauseRuntime: false,
  })
}
