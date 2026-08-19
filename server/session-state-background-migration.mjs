// Session-state background migration orchestrator
// (docs/architecture/session-storage-background-migration-design.zh-CN.md).
//
// Feature 2 scope: the importing → converging → idle-waiting → switching
// state machine plus its §5.2 event log. Feature 4 wires it into the startup
// chain (server/index.mjs routes json_authoritative/cutover_running stores
// here fire-and-forget via resolveSessionStateStartupRoute); progress is
// read via readSessionStateBackgroundMigrationStatus, which the
// /api/migration-status sessionState domain exposes as `background` (§6.2).
//
// Correctness anchors:
// - JSON stays authoritative for the whole task; SQLite only receives
//   bucket-level align transactions (feature 1) that never touch the phase or
//   the mirror outbox, so a crash at ANY point leaves the store bootable and
//   the task simply reruns.
// - The whole task runs inside runSessionStateMaintenance: the maintenance
//   lock is held (with heartbeat renewal) from start to finish, so a second
//   process never interleaves maintenance operations with the aligns.
// - The switch window is the only moment business writes queue up:
//   withSessionPersistenceLock (global key, taken FIRST) →
//   acquireSessionJsonWriteBarrier (feature 3) → final JSON-vs-map digest
//   verification → promoteAlignedSessionState (json_authoritative → pending →
//   authoritative in one transaction) → drain (queue is empty by construction)
//   → release barrier → release lock.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getSqliteStorage } from './sqlite/database.mjs'
import { createSessionStateRepository, digestFromLines, snapshotDigestLine } from './sqlite/session-state-repository.mjs'
import {
  createSessionBucketRecordStream,
  createSessionJsonMirrorAdapter,
  createStreamingSessionSource,
  runSessionStateMaintenance,
  summarizeSessionSource,
  verifyRegisteredCutoverBackup,
  writeCutoverBackupStream,
} from './session-state-cutover.mjs'
import { withSessionPersistenceLock } from './session-persistence-lock.mjs'
import {
  SESSION_STORAGE_PHASES,
  configureSessionStateService,
  drainSessionJsonMirror,
  readSessionStorageState,
  setSessionStoragePhase,
} from './session-state-service.mjs'
import { acquireSessionJsonWriteBarrier, createPhysicalSessionStateFsAdapter, readLastSessionWriteFinishedAt, storageDir } from './storage.mjs'
import { logger } from './utils/logger.mjs'

const DEFAULT_IDLE_THRESHOLD_MS = 15_000
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000
const DEFAULT_IDLE_POLL_INTERVAL_MS = 1_000
const DEFAULT_ROUND_DELAY_MS = 3_000
const DEFAULT_BACKUP_RETRIES = 3
const DEFAULT_ALIGN_RETRIES = 3
// runSessionStateMaintenance's waitForLock never attempts an acquisition when
// waitTimeoutMs is 0; 50ms guarantees one attempt while still failing fast
// (one poll interval) when another process holds the lock.
const DEFAULT_LOCK_WAIT_TIMEOUT_MS = 50
const LOCK_TIMEOUT_MESSAGE = 'Timed out waiting for session state maintenance lock'

const EVENT_PREFIX = 'session.background_migration'
const EVENT_MESSAGES = {
  started: 'Session background migration started',
  skipped: 'Session background migration skipped',
  'phase.reset': 'Session background migration reset cutover_running residue to json_authoritative',
  'bucket.import.started': 'Session background migration bucket import started',
  'bucket.imported': 'Session background migration bucket imported',
  'bucket.import.failed': 'Session background migration bucket import failed',
  'bucket.pruned': 'Session background migration bucket pruned',
  'converge.round': 'Session background migration convergence round finished',
  'converge.converged': 'Session background migration converged',
  'backup.started': 'Session background migration backup started',
  'backup.bucket.progress': 'Session background migration backup bucket finished',
  'backup.verify': 'Session background migration backup verified',
  'backup.done': 'Session background migration backup done',
  'backup.retried': 'Session background migration backup retry',
  'backup.abandoned': 'Session background migration backup abandoned',
  'idle.enter': 'Session background migration entered idle wait',
  'idle.signal': 'Session background migration idle signal reached',
  'idle.abandon': 'Session background migration idle wait timed out',
  'switch.lock.acquire': 'Session background migration switch window opened',
  'switch.verify': 'Session background migration switch window final verification',
  'switch.verify.retry': 'Session background migration switch window verification diff; falling back to convergence',
  'switch.promoted': 'Session background migration promoted to authoritative',
  'switch.done': 'Session background migration switch window closed',
  'task.done': 'Session background migration task done',
  'task.failed': 'Session background migration task failed',
  'task.aborted': 'Session background migration task aborted',
}

let runningTask = null
let currentStatus = null
let activeStreamCountFn = null

// Default "no active stream" signal: the SSE route already maintains a
// per-session sseConnected flag in agent-manager, so the count is derived
// instead of adding new bookkeeping. Loaded lazily to keep this module's
// static import graph as light as the cutover's.
async function defaultActiveStreamCount() {
  if (!activeStreamCountFn) {
    const { countActiveSseStreams } = await import('./agent-manager.mjs')
    activeStreamCountFn = countActiveSseStreams
  }
  return activeStreamCountFn()
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

function bucketKey(bucket) {
  return `${bucket.scope}:${bucket.scope === 'project' ? bucket.projectId : ''}`
}

function bucketLabel(bucket) {
  return bucket?.scope === 'project' ? `project:${bucket.projectId}` : 'global'
}

function errorMessage(error) {
  return error?.message || String(error)
}

function readMaintenanceLockOwner(storage) {
  try {
    const row = storage.prepare('SELECT owner, owner_pid, fencing, expires_at FROM session_state_maintenance_lock WHERE singleton = 1').get()
    if (!row) return null
    return { owner: row.owner, ownerPid: Number(row.owner_pid), fencing: Number(row.fencing), expiresAt: row.expires_at }
  } catch {
    return null
  }
}

// §10.1 legacy residue cleanup: an old synchronous cutover that crashed
// mid-window leaves cutover_running behind. Under the background chain the
// value is meaningless — JSON stayed authoritative through the crash — so once
// the maintenance lock is held, reset the phase to json_authoritative and let
// this task rerun the migration. The registered backupFile survives the reset
// verbatim (the backup pass re-verifies it); the store stays bootable the
// whole time because cutover_running already routes reads/writes through the
// JSON path.
function resetCutoverRunningResidue(task, log, storage) {
  const row = storage.prepare('SELECT phase, backup_file FROM session_storage_state WHERE singleton = 1').get()
  if (!row || row.phase !== SESSION_STORAGE_PHASES.CUTOVER_RUNNING) return
  setSessionStoragePhase(SESSION_STORAGE_PHASES.JSON_AUTHORITATIVE, {
    backupFile: row.backup_file,
    diagnostic: { operation: 'background_migration', recoveredFrom: SESSION_STORAGE_PHASES.CUTOVER_RUNNING },
  })
  log.warn(EVENT_MESSAGES['phase.reset'], {
    domain: 'session-state',
    event: `${EVENT_PREFIX}.phase.reset`,
    taskId: task.taskId,
    previousPhase: row.phase,
    backupFile: row.backup_file || null,
  })
}

async function listJsonBuckets(fsAdapter) {
  const buckets = []
  for await (const rawBucket of fsAdapter.listBuckets()) {
    buckets.push({ scope: rawBucket.scope, projectId: rawBucket.scope === 'project' ? rawBucket.projectId : null })
  }
  return buckets
}

function createStatus(taskId, startedAtMs) {
  return {
    taskId,
    state: 'importing',
    startedAt: new Date(startedAtMs).toISOString(),
    buckets: { total: 0, imported: 0 },
    convergeRound: 0,
    diffBuckets: 0,
    backup: { state: 'idle', path: null, bytes: 0, attempts: 0 },
    lastEventAt: new Date(startedAtMs).toISOString(),
    reason: null,
    failure: null,
  }
}

/**
 * Progress snapshot for the /api/migration-status background domain
 * (design §6.2). In-memory only; `done` / `failed` / `aborted` are terminal
 * states retained for diagnostics. Returns null before the first task.
 */
export function readSessionStateBackgroundMigrationStatus() {
  return currentStatus ? structuredClone(currentStatus) : null
}

// §6 startup-chain routing for the session domain (feature 4): a store still
// on json_authoritative — or carrying the legacy cutover_running residue
// (§10.1, reset under the maintenance lock once the task starts) — skips the
// synchronous cutover and hands the migration to this module, keeping the
// startup maintenance window off the session domain's back. The
// pending/authoritative phases keep the legacy four-step startup chain
// (integrity check + drain + promote/recovery), whose failures fail closed.
// Unknown phases route to the legacy chain so its integrity gates stay the
// fail-closed backstop.
export function resolveSessionStateStartupRoute(phase) {
  if (phase === SESSION_STORAGE_PHASES.JSON_AUTHORITATIVE || phase === SESSION_STORAGE_PHASES.CUTOVER_RUNNING) return 'background'
  return 'cutover'
}

/**
 * Start the background migration task (fire-and-forget by design — callers
 * do not await this in the startup chain). Resolves once the task reaches a
 * terminal state; it never rejects.
 *
 * Options (mirrors the cutover's injection style for testability):
 * logger, storage, repository, fsAdapter, mirror, owner, pidAlive, now,
 * sleep, backupDirectory, createBackupWriteStream, activeStreamCount,
 * readLastSessionWriteFinishedAt, idleThresholdMs (15s), idleTimeoutMs (5min),
 * idlePollIntervalMs (1s), roundDelayMs (3s), backupRetries (3),
 * alignRetries (3), lockWaitTimeoutMs.
 */
export function startSessionStateBackgroundMigration(options = {}) {
  if (runningTask) return runningTask.promise
  const task = { taskId: `${Date.now()}-${process.pid}`, stage: null, promise: null }
  runningTask = task
  task.promise = runBackgroundMigration(task, options).finally(() => {
    if (runningTask === task) runningTask = null
  })
  return task.promise
}

async function runBackgroundMigration(task, options) {
  const log = options.logger || logger
  const now = options.now || Date.now
  let storage = null
  try {
    storage = options.storage || getSqliteStorage()
    const repository = options.repository || createSessionStateRepository(storage)
    // a) Never start unless the store is JSON-authoritative or carries the
    // legacy cutover_running residue (§10.1: an old synchronous cutover that
    // crashed mid-window; reset under the maintenance lock below).
    const phaseRow = storage.prepare('SELECT phase FROM session_storage_state WHERE singleton = 1').get()
    const acceptablePhases = [SESSION_STORAGE_PHASES.JSON_AUTHORITATIVE, SESSION_STORAGE_PHASES.CUTOVER_RUNNING]
    if (!phaseRow || !acceptablePhases.includes(phaseRow.phase)) {
      log.info(EVENT_MESSAGES.skipped, { domain: 'session-state', event: `${EVENT_PREFIX}.skipped`, taskId: task.taskId, phase: phaseRow ? phaseRow.phase : null })
      return { started: false, taskId: task.taskId, outcome: 'skipped', reason: 'phase-not-json-authoritative', phase: phaseRow ? phaseRow.phase : null }
    }
    // b) Lock-busy pre-check with owner diagnostics (§10.2); the wrapper below
    // remains the authoritative gate.
    const busyOwner = readMaintenanceLockOwner(storage)
    if (busyOwner && Date.parse(busyOwner.expiresAt) > now()) {
      return abortTask(task, log, now, 'lock-busy', { lockOwner: busyOwner.owner, lockOwnerPid: busyOwner.ownerPid, lockFencing: busyOwner.fencing })
    }
    return await runSessionStateMaintenance(
      (context) => {
        resetCutoverRunningResidue(task, log, storage)
        return runMigrationTask(task, options, repository, context, log, now)
      },
      {
        ...options,
        storage,
        operation: 'session-state-background-migration',
        waitTimeoutMs: options.lockWaitTimeoutMs ?? DEFAULT_LOCK_WAIT_TIMEOUT_MS,
      },
    )
  } catch (error) {
    if (error?.message === LOCK_TIMEOUT_MESSAGE) {
      const owner = storage ? readMaintenanceLockOwner(storage) : null
      return abortTask(task, log, now, 'lock-busy', owner ? { lockOwner: owner.owner, lockOwnerPid: owner.ownerPid, lockFencing: owner.fencing } : {})
    }
    if (/maintenance lock/i.test(errorMessage(error))) {
      return abortTask(task, log, now, 'lock-lost', { error: errorMessage(error) })
    }
    return failTask(task, log, now, task.stage || 'startup', error)
  }
}

function ensureStatus(task, now) {
  if (!currentStatus || currentStatus.taskId !== task.taskId) currentStatus = createStatus(task.taskId, now())
  return currentStatus
}

function abortTask(task, log, now, reason, fields = {}) {
  const status = ensureStatus(task, now)
  status.state = 'aborted'
  status.reason = reason
  // §10.2: surface the maintenance-lock owner diagnostics on the snapshot
  // itself, so a second process's /api/migration-status shows "another
  // process is migrating" instead of a blank background domain.
  for (const key of ['lockOwner', 'lockOwnerPid', 'lockFencing']) {
    if (fields[key] !== undefined) status[key] = fields[key]
  }
  status.lastEventAt = new Date(now()).toISOString()
  log.warn(EVENT_MESSAGES['task.aborted'], { domain: 'session-state', event: `${EVENT_PREFIX}.task.aborted`, taskId: task.taskId, reason, ...fields })
  return { started: true, taskId: task.taskId, outcome: 'aborted', reason }
}

function failTask(task, log, now, stage, error) {
  const status = ensureStatus(task, now)
  status.state = 'failed'
  status.failure = { stage, error: errorMessage(error) }
  status.lastEventAt = new Date(now()).toISOString()
  log.error(EVENT_MESSAGES['task.failed'], {
    domain: 'session-state',
    event: `${EVENT_PREFIX}.task.failed`,
    taskId: task.taskId,
    stage,
    errorName: error?.name || 'Error',
    error: errorMessage(error),
  })
  return { started: true, taskId: task.taskId, outcome: 'failed', stage, error: errorMessage(error) }
}

async function runMigrationTask(task, options, repository, context, log, now) {
  const sleep = options.sleep || defaultSleep
  const startedAtMs = now()
  const status = createStatus(task.taskId, startedAtMs)
  currentStatus = status
  task.stage = 'importing'
  const emit = (level, event, fields = {}) => {
    status.lastEventAt = new Date(now()).toISOString()
    log[level](EVENT_MESSAGES[event] || event, { domain: 'session-state', event: `${EVENT_PREFIX}.${event}`, taskId: task.taskId, ...fields })
  }
  const setState = (state) => {
    status.state = state
    task.stage = state
  }

  const fsAdapter = options.fsAdapter || createPhysicalSessionStateFsAdapter()
  const bucketRecordStream = createSessionBucketRecordStream(fsAdapter)
  const createSource = () => createStreamingSessionSource(fsAdapter)()
  const idleThresholdMs = options.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  const idlePollIntervalMs = options.idlePollIntervalMs ?? DEFAULT_IDLE_POLL_INTERVAL_MS
  const roundDelayMs = options.roundDelayMs ?? DEFAULT_ROUND_DELAY_MS
  const backupRetries = options.backupRetries ?? DEFAULT_BACKUP_RETRIES
  const alignRetries = options.alignRetries ?? DEFAULT_ALIGN_RETRIES
  const readLastWriteMs = options.readLastSessionWriteFinishedAt || readLastSessionWriteFinishedAt
  const countActiveStreams = () => (options.activeStreamCount ? options.activeStreamCount() : defaultActiveStreamCount())

  // c) Same service wiring as the cutover; mirror stays injectable (null = no
  // JSON materialization, used by tests).
  configureSessionStateService({ repository, mirror: options.mirror !== undefined ? options.mirror : createSessionJsonMirrorAdapter() })
  const initialState = readSessionStorageState()
  if (initialState.phase !== SESSION_STORAGE_PHASES.JSON_AUTHORITATIVE) {
    throw new Error(`Session background migration requires json_authoritative phase (current: ${initialState.phase})`)
  }

  // In-memory convergence state: bucketKey -> last aligned {bucket, count,
  // digest, bytes}. While JSON stays authoritative nothing else writes SQLite
  // (design F2) and the task holds the maintenance lock, so this map is a
  // faithful digest of the SQLite content.
  const aligned = new Map()
  const failures = new Map()
  let backupKicked = false
  let switchActive = false
  let switchGate = Promise.resolve()

  // One align attempt: a fresh bucket-scoped record stream feeding the
  // bucket-level immediate transaction; bytes/sessions feed the log events.
  async function alignBucket(bucket) {
    const stats = { sessions: 0, bytes: 0 }
    const records = bucketRecordStream(bucket)
    const iterable = (async function* countedRecords() {
      for await (const record of records) {
        stats.sessions += 1
        stats.bytes += Buffer.byteLength(JSON.stringify(record.state), 'utf8')
        yield record
      }
    })()
    const result = await repository.alignBucketStream({ scope: bucket.scope, projectId: bucket.projectId ?? null }, iterable)
    return { ...result, bytes: stats.bytes }
  }

  function noteBucketFailure(key, bucket, error) {
    const attempts = (failures.get(key) || 0) + 1
    failures.set(key, attempts)
    emit('warn', 'bucket.import.failed', { bucket: bucketLabel(bucket), error: errorMessage(error), attempt: attempts })
    if (attempts >= alignRetries) {
      throw new Error(`Session background migration align retries exhausted for bucket ${bucketLabel(bucket)}`, { cause: error })
    }
    return attempts
  }

  // Read-only JSON-side pass: per-bucket digests plus the global count/digest
  // (canonical digestFromLines/snapshotDigestLine, identical to the align
  // transactions' own bookkeeping).
  async function summarizeJsonBuckets() {
    const perBucket = new Map()
    const allLines = []
    for (const bucket of await listJsonBuckets(fsAdapter)) {
      const lines = []
      for await (const record of bucketRecordStream(bucket)) {
        const line = snapshotDigestLine(record.scope, record.projectId, record.sessionId, record.stateDigest, record.metadataDigest, '')
        lines.push(line)
        allLines.push(line)
      }
      perBucket.set(bucketKey(bucket), { bucket, count: lines.length, digest: digestFromLines(lines) })
    }
    return { perBucket, count: allLines.length, digest: digestFromLines(allLines) }
  }

  function diffAgainstMap(pass) {
    const diffs = []
    for (const [key, entry] of pass.perBucket) {
      const known = aligned.get(key)
      if (!known || known.digest !== entry.digest || known.count !== entry.count) diffs.push({ key, bucket: entry.bucket })
    }
    for (const [key, known] of aligned) {
      if (!pass.perBucket.has(key)) diffs.push({ key, bucket: known.bucket, vanished: true })
    }
    return diffs
  }

  async function reconcileDiffs(diffs) {
    for (const diff of diffs) {
      const startedAt = now()
      try {
        if (diff.vanished) {
          const removed = repository.deleteBucketRows(diff.bucket)
          aligned.delete(diff.key)
          failures.delete(diff.key)
          emit('info', 'bucket.pruned', { bucket: bucketLabel(diff.bucket), removedStates: removed.removedStates })
        } else {
          const result = await alignBucket(diff.bucket)
          aligned.set(diff.key, result)
          failures.delete(diff.key)
          emit('info', 'bucket.imported', { bucket: bucketLabel(diff.bucket), sessions: result.count, bytes: result.bytes, durationMs: now() - startedAt })
        }
      } catch (error) {
        noteBucketFailure(diff.key, diff.bucket, error)
      }
    }
    status.buckets.imported = aligned.size
    status.buckets.total = Math.max(status.buckets.total, aligned.size)
  }

  async function convergeUntilStable() {
    setState('converging')
    for (;;) {
      const round = status.convergeRound + 1
      status.convergeRound = round
      const startedAt = now()
      const pass = await summarizeJsonBuckets()
      const diffs = diffAgainstMap(pass)
      status.diffBuckets = diffs.length
      emit('info', 'converge.round', { round, diffBuckets: diffs.length, diffList: diffs.map((diff) => bucketLabel(diff.bucket)) })
      if (diffs.length === 0) {
        emit('info', 'converge.converged', { round, durationMs: now() - startedAt })
        return pass
      }
      await reconcileDiffs(diffs)
      await sleep(roundDelayMs)
    }
  }

  async function* backupProgressIteration() {
    let currentKey = null
    let currentBucket = null
    let sessions = 0
    let bytes = 0
    for await (const record of createSource().iterate()) {
      const key = bucketKey(record)
      if (currentKey !== null && key !== currentKey) {
        emit('info', 'backup.bucket.progress', { bucket: bucketLabel(currentBucket), sessions, bytes })
        sessions = 0
        bytes = 0
      }
      currentKey = key
      currentBucket = record
      sessions += 1
      bytes += Buffer.byteLength(JSON.stringify(record.state), 'utf8')
      yield record
    }
    if (currentKey !== null) {
      emit('info', 'backup.bucket.progress', { bucket: bucketLabel(currentBucket), sessions, bytes })
    }
  }

  // §4: fire-and-forget backup during the idle wait. Never blocks or gates the
  // switch; bounded retries; registration waits out an open switch window and
  // is skipped (warn) once the store left json_authoritative.
  async function runBackup() {
    const backup = status.backup
    const startedAt = now()
    const directory = options.backupDirectory || path.join(storageDir, 'backups')
    for (let attempt = 1; attempt <= backupRetries; attempt++) {
      backup.attempts = attempt
      try {
        backup.state = 'running'
        emit('info', 'backup.started', { targetPath: directory, attempt })
        const summary = await summarizeSessionSource(createSource())
        const existing = readSessionStorageState().backupFile
        let targetPath = null
        if (existing) {
          const registered = await verifyRegisteredCutoverBackup(existing, summary)
          if (registered.ok) targetPath = existing
        }
        if (!targetPath) {
          targetPath = await writeCutoverBackupStream(() => backupProgressIteration(), summary, {
            directory,
            createWriteStream: options.createBackupWriteStream,
          })
        }
        const bytes = (await fs.stat(targetPath)).size
        emit('info', 'backup.verify', { path: targetPath, bytes })
        while (switchActive) await switchGate
        if (status.state === 'done' || readSessionStorageState().phase !== SESSION_STORAGE_PHASES.JSON_AUTHORITATIVE) {
          backup.state = 'abandoned'
          emit('warn', 'backup.abandoned', { path: targetPath, bytes })
          return
        }
        setSessionStoragePhase(SESSION_STORAGE_PHASES.JSON_AUTHORITATIVE, { backupFile: targetPath })
        readSessionStorageState()
        backup.state = 'done'
        backup.path = targetPath
        backup.bytes = bytes
        emit('info', 'backup.done', { path: targetPath, bytes, durationMs: now() - startedAt, attempt })
        return
      } catch (error) {
        emit('warn', 'backup.retried', { attempt, error: errorMessage(error) })
        if (attempt >= backupRetries) {
          backup.state = 'failed'
          return
        }
        await sleep(roundDelayMs)
      }
    }
  }

  async function waitForIdle() {
    setState('idle-waiting')
    emit('info', 'idle.enter')
    if (!backupKicked) {
      backupKicked = true
      void runBackup().catch(() => { /* runBackup handles its own failures */ })
    }
    const enteredAt = now()
    for (;;) {
      const activeStreams = await countActiveStreams()
      const lastWriteFinishedAt = readLastWriteMs()
      if (activeStreams === 0 && now() - lastWriteFinishedAt >= idleThresholdMs) {
        emit('info', 'idle.signal', { reason: 'no-stream+no-persist', waitedMs: now() - enteredAt, activeStreams })
        return 'signal'
      }
      if (now() - enteredAt >= idleTimeoutMs) {
        emit('warn', 'idle.abandon', { timeoutMs: idleTimeoutMs, elapsedMs: now() - enteredAt })
        return 'timeout'
      }
      await sleep(idlePollIntervalMs)
    }
  }

  async function runSwitchWindow() {
    setState('switching')
    const windowStart = now()
    switchActive = true
    let openGate
    switchGate = new Promise((resolve) => { openGate = resolve })
    try {
      return await withSessionPersistenceLock(async () => {
        const lockAt = now()
        emit('info', 'switch.lock.acquire', { waitMs: lockAt - windowStart })
        const releaseBarrier = await acquireSessionJsonWriteBarrier()
        const barrierAt = now()
        try {
          const verifyStartedAt = now()
          const pass = await summarizeJsonBuckets()
          const diffs = diffAgainstMap(pass)
          emit('info', 'switch.verify', { diffBuckets: diffs.length, diffList: diffs.map((diff) => bucketLabel(diff.bucket)), durationMs: now() - verifyStartedAt })
          if (diffs.length > 0) {
            emit('warn', 'switch.verify.retry', { diffBuckets: diffs.length, diffList: diffs.map((diff) => bucketLabel(diff.bucket)) })
            return { ok: false, diffs }
          }
          const promoted = repository.promoteAlignedSessionState({
            digest: pass.digest,
            expectedCount: pass.count,
            backupFile: readSessionStorageState().backupFile,
            diagnostic: { operation: 'background_migration', taskId: task.taskId, convergeRound: status.convergeRound },
          })
          // Refresh the service's cached phase so the next read/write routes
          // through SQLite immediately.
          readSessionStorageState()
          // The aligned import never enqueues mirror entries, so this drain is
          // an empty-queue confirmation; it also leaves the drain loop ready
          // for the post-switch authoritative writes.
          await drainSessionJsonMirror()
          emit('info', 'switch.promoted', { lockHeldMs: now() - lockAt, barrierHeldMs: now() - barrierAt })
          return { ok: true, promoted }
        } finally {
          releaseBarrier()
        }
      }).then((result) => {
        if (result.ok) emit('info', 'switch.done', { totalDurationMs: now() - windowStart })
        return result
      })
    } finally {
      switchActive = false
      openGate()
    }
  }

  const jsonBuckets = await listJsonBuckets(fsAdapter)
  emit('info', 'started', { phase: initialState.phase, bucketTotal: jsonBuckets.length, lockFencing: context.lease.fencing })
  setState('importing')
  status.buckets.total = jsonBuckets.length

  // d) Importing: prune SQLite buckets that vanished from the JSON tree, then
  // align every JSON bucket once (failures defer to the convergence rounds).
  const jsonKeys = new Set(jsonBuckets.map(bucketKey))
  for (const sqliteBucket of repository.listBucketKeys()) {
    if (jsonKeys.has(bucketKey(sqliteBucket))) continue
    const removed = repository.deleteBucketRows(sqliteBucket)
    emit('info', 'bucket.pruned', { bucket: bucketLabel(sqliteBucket), removedStates: removed.removedStates })
  }
  for (const bucket of jsonBuckets) {
    const key = bucketKey(bucket)
    let fileCount = 0
    for await (const _sessionId of fsAdapter.listSessionFiles(bucket)) fileCount += 1
    emit('info', 'bucket.import.started', { bucket: bucketLabel(bucket), fileCount })
    const startedAt = now()
    try {
      const result = await alignBucket(bucket)
      aligned.set(key, result)
      failures.delete(key)
      status.buckets.imported = aligned.size
      emit('info', 'bucket.imported', { bucket: bucketLabel(bucket), sessions: result.count, bytes: result.bytes, durationMs: now() - startedAt })
    } catch (error) {
      noteBucketFailure(key, bucket, error)
    }
  }

  for (;;) {
    await convergeUntilStable()
    const idleOutcome = await waitForIdle()
    if (idleOutcome === 'timeout') continue
    const outcome = await runSwitchWindow()
    if (outcome.ok) {
      setState('done')
      emit('info', 'task.done', { totalDurationMs: now() - startedAtMs })
      return { started: true, taskId: task.taskId, outcome: 'done', promoted: outcome.promoted }
    }
    // §3.3: final verification found writes that slipped past the barrier —
    // the release happened inside the window; realign the known diff buckets
    // and go back to convergence.
    await reconcileDiffs(outcome.diffs)
  }
}
