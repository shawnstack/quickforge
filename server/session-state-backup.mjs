import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getSqliteStorage } from './sqlite/database.mjs'
import { createSessionStateRepository, messagesDigestFromValues, snapshotDigestLine, splitStateForStorage } from './sqlite/session-state-repository.mjs'
import {
  currentSessionStateMaintenanceContext,
  runSessionStateMaintenance,
} from './session-state-maintenance.mjs'
import {
  isSessionStateAuthoritative,
  normalizeSessionSnapshotValues,
  readSessionStorageState,
  replaceSessionStateSnapshot,
} from './session-state-service.mjs'
import { storageDir } from './storage.mjs'
import { logger } from './utils/logger.mjs'

const RESTORE_PLAN_FILE = path.join(storageDir, 'session-state-restore-plan.json')
const ROLL_FORWARD_STATUSES = new Set(['prepared', 'applying', 'target_applied'])
const ROLL_BACK_STATUSES = new Set(['compensating', 'compensation_failed'])

function repositoryRequired() {
  try {
    return createSessionStateRepository(getSqliteStorage())
  } catch (error) {
    throw new Error('SQLite storage is required for authoritative session state', { cause: error })
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalize(value[key])]))
}

function jsonDigest(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

// Replicates the repository snapshot digest algorithm (verificationDigest) over
// records that have already been normalized by normalizeSessionSnapshotValues,
// so the plan's target digest can be compared against the repository digest
// after the restore transaction commits. Split states are digested over their
// stored (stripped) body plus the messages aggregate, exactly like stored rows.
function recordsDigest(records) {
  const rows = records.map((record) => {
    const { storedState, messages } = splitStateForStorage(record.state)
    return {
      scope: record.scope,
      project_id: record.projectId || '',
      session_id: record.sessionId,
      state_digest: jsonDigest(storedState),
      metadata_digest: jsonDigest(record.metadata),
      messages_digest: messages === undefined ? '' : messagesDigestFromValues(messages),
    }
  })
  const values = rows.map((row) => snapshotDigestLine(row.scope, row.project_id, row.session_id, row.state_digest, row.metadata_digest, row.messages_digest)).sort()
  return createHash('sha256').update(values.join('\n')).digest('hex')
}

function snapshotValues(snapshot) {
  return {
    sessions: Object.fromEntries(snapshot.records.map((record) => [record.sessionId, record.state?.messageStorage === 'split'
      // Records from exportSnapshot carry the stripped body + a separate
      // `messages` array; records from normalizeSessionSnapshotValues carry the
      // already-assembled body (marker + messages inline). Keep whichever
      // representation is present — never drop the messages.
      ? { ...record.state, messages: Array.isArray(record.state.messages) ? record.state.messages : (record.messages ?? []) }
      : record.state])),
    sessionsMetadata: Object.fromEntries(snapshot.records.map((record) => [record.sessionId, record.metadata])),
  }
}

/**
 * Authoritative session state export for the backup route. Runs under the
 * session state maintenance lock so a concurrent restore can never be observed
 * mid-transaction, and fail-closes when integrity or digest verification fails.
 */
export async function exportSessionStateForBackup(options = {}) {
  const operation = async () => {
    const repository = options.repository || repositoryRequired()
    const integrity = repository.verifyIntegrity({ quickCheck: true })
    if (!integrity.ok) throw new Error('Session state integrity verification failed during backup export')
    const snapshot = repository.exportSnapshot()
    // The lightweight integrity result has no digest (null); the count
    // cross-check plus exportSnapshot's own digest computation stay.
    if (snapshot.count !== integrity.count) {
      throw new Error('Session state backup count verification failed')
    }
    return {
      ...snapshotValues(snapshot),
      count: snapshot.count,
      digest: snapshot.digest,
      phase: readSessionStorageState().phase,
    }
  }
  if (!options.maintenance || currentSessionStateMaintenanceContext()) return operation()
  return runSessionStateMaintenance(operation, { storage: options.storage, operation: 'session-state-backup-export' })
}

/**
 * Manual integrity verification entry point for the maintenance route
 * (design review suggestion 9): the startup chain only runs the lightweight
 * SQL-level check, so silent per-row digest rot would stay invisible until
 * an offline full verification. `{ full: true }` recomputes every stored
 * digest (quickCheck: false); the default is the lightweight check. Runs
 * under the session state maintenance lock (same pattern as the backup
 * export above) so the scan serializes with cutover/restore, and returns
 * only summary counters plus the elapsed time — never row payloads.
 */
export async function verifySessionStateIntegrityForMaintenance(options = {}) {
  const operation = async () => {
    const repository = options.repository || repositoryRequired()
    const startedAt = Date.now()
    // forceQuickCheck: a manual maintenance trigger must run a real quick_check
    // scan, never the process-cache/marker shortcut.
    const integrity = repository.verifyIntegrity({ quickCheck: options.full !== true, forceQuickCheck: options.forceQuickCheck === true })
    return { ...integrity, full: options.full === true, durationMs: Date.now() - startedAt }
  }
  if (!options.maintenance || currentSessionStateMaintenanceContext()) return operation()
  return runSessionStateMaintenance(operation, { storage: options.storage, operation: 'session-state-verify-integrity' })
}

// A restore rewrites every session row inside one transaction, so the WAL
// grows by roughly the library size before converging; truncating right
// after success reclaims that space (same rationale as the post-promote
// checkpoint in the cutover). Best-effort: a busy or failed checkpoint
// leaves the WAL to a later auto-checkpoint and must never fail the restore.
function checkpointWalAfterRestore(repository, operation) {
  try {
    repository.checkpointWal()
  } catch (error) {
    logger.warn('Session state WAL checkpoint failed after restore', { domain: 'session-state', operation, errorName: error?.name || 'Error', errorMessage: error?.message })
  }
}

async function writePlan(plan, planFile = RESTORE_PLAN_FILE) {
  await fs.mkdir(path.dirname(planFile), { recursive: true })
  const temporary = `${planFile}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
    await fs.rename(temporary, planFile)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

function planValuesDigest(values) {
  return recordsDigest(normalizeSessionSnapshotValues(values))
}

// Public digest helper for backup tooling: returns the exact repository-style
// digest a restored snapshot must produce, given backup values.
export function computeSessionSnapshotDigest(values) {
  return planValuesDigest(values)
}

function validatePlan(plan) {
  if (
    !plan || plan.version !== 1 || plan.operation !== 'session_state_restore' ||
    !isPlainPlanValue(plan.before) || !isPlainPlanValue(plan.target)
  ) {
    throw new Error('Session state restore plan is invalid')
  }
  if (!ROLL_FORWARD_STATUSES.has(plan.status) && !ROLL_BACK_STATUSES.has(plan.status)) {
    throw new Error('Session state restore plan status is invalid')
  }
  const beforeCount = countSessions(plan.before)
  const targetCount = countSessions(plan.target)
  if (plan.beforeCount !== beforeCount || plan.targetCount !== targetCount) {
    throw new Error('Session state restore plan count is invalid')
  }
  const beforeDigest = planValuesDigest(plan.before)
  const targetDigest = planValuesDigest(plan.target)
  if (plan.beforeDigest !== beforeDigest || plan.targetDigest !== targetDigest) {
    throw new Error('Session state restore plan digest is invalid')
  }
  return plan
}

function countSessions(values) {
  return isPlainPlanValue(values) && values.sessions && typeof values.sessions === 'object' && !Array.isArray(values.sessions)
    ? Object.keys(values.sessions).length
    : 0
}

function isPlainPlanValue(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Restore the authoritative session state from a backup snapshot. Always runs
 * under the session state maintenance lock, persists a crash-recoverable plan
 * file, and compensates back to the exact before-state if the apply or its
 * verification fails. Only touches session_states/session_index/mirror tables;
 * scheduled_task_runs and JSON config stores are never modified here.
 */
export async function restoreSessionStateSnapshot(values, options = {}) {
  if (!isSessionStateAuthoritative()) {
    throw new Error('Session state restore requires authoritative SQLite storage')
  }
  const repository = options.repository || repositoryRequired()
  const mode = options.mode === 'merge' ? 'merge' : 'replace'
  const planFile = options.planFile || RESTORE_PLAN_FILE
  return runSessionStateMaintenance(async () => {
    const before = repository.exportSnapshot()
    const beforeValues = snapshotValues(before)
    const merged = mode === 'merge'
      ? {
          sessions: { ...beforeValues.sessions, ...values.sessions },
          sessionsMetadata: { ...beforeValues.sessionsMetadata, ...values.sessionsMetadata },
        }
      : values
    // Normalize once before writing the plan: validation failures (invalid
    // bodies, metadata-only orphans) surface here and never leave a plan file.
    const targetRecords = normalizeSessionSnapshotValues(merged)
    const targetValues = snapshotValues({ records: targetRecords })
    const beforeCount = before.count
    const beforeDigest = before.digest
    const targetCount = targetRecords.length
    const targetDigest = recordsDigest(targetRecords)
    let plan = {
      version: 1,
      operation: 'session_state_restore',
      status: 'prepared',
      createdAt: new Date().toISOString(),
      before: beforeValues,
      target: targetValues,
      beforeCount,
      beforeDigest,
      targetCount,
      targetDigest,
    }
    await writePlan(plan, planFile)
    try {
      plan = { ...plan, status: 'applying' }
      await writePlan(plan, planFile)
      replaceSessionStateSnapshot(targetValues, { merge: false })
      const after = repository.exportSnapshot()
      if (after.count !== targetCount || after.digest !== targetDigest) {
        throw new Error('Session state restore count/digest verification failed')
      }
      const integrity = repository.verifyIntegrity()
      if (!integrity.ok) throw new Error('Session state restore integrity verification failed')
      plan = { ...plan, status: 'target_applied' }
      await writePlan(plan, planFile)
      await fs.rm(planFile, { force: true })
      checkpointWalAfterRestore(repository, 'session-state-restore')
      return { sessions: targetCount, sessionsMetadata: targetCount }
    } catch (error) {
      try {
        plan = { ...plan, status: 'compensating', failedAt: new Date().toISOString() }
        await writePlan(plan, planFile)
        replaceSessionStateSnapshot(beforeValues, { merge: false })
        const restored = repository.exportSnapshot()
        if (restored.count !== beforeCount || restored.digest !== beforeDigest) {
          throw new Error('Session state restore compensation verification failed', { cause: error })
        }
        await fs.rm(planFile, { force: true })
      } catch (compensationError) {
        await writePlan({
          ...plan,
          status: 'compensation_failed',
          compensationFailedAt: new Date().toISOString(),
          errorName: error?.name || 'Error',
          compensationErrorName: compensationError?.name || 'Error',
        }, planFile).catch(() => {})
        const retained = new Error('Session state restore failed and compensation failed', { cause: compensationError })
        retained.retainSessionStateMaintenance = true
        throw retained
      }
      throw error
    }
  }, {
    storage: options.storage,
    operation: 'session-state-restore',
    waitTimeoutMs: options.waitTimeoutMs,
    pollIntervalMs: options.pollIntervalMs,
  })
}

/**
 * Startup recovery for an interrupted restore plan: roll forward to the target
 * for prepared/applying/target_applied plans and roll back to the before state
 * for compensating/compensation_failed plans, then remove the plan file.
 */
export async function recoverSessionStateRestorePlan({
  repository: repositoryOverride,
  planFile = RESTORE_PLAN_FILE,
  storage,
  waitTimeoutMs,
  pollIntervalMs,
} = {}) {
  let plan
  try {
    plan = validatePlan(JSON.parse(await fs.readFile(planFile, 'utf8')))
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw new Error(`Session state restore plan is unreadable or invalid: ${error?.message || error}`, { cause: error })
  }
  if (!isSessionStateAuthoritative()) {
    throw new Error('Session state restore plan exists outside authoritative mode')
  }
  const repository = repositoryOverride || repositoryRequired()
  return runSessionStateMaintenance(async () => {
    const rollBack = ROLL_BACK_STATUSES.has(plan.status)
    const value = rollBack ? plan.before : plan.target
    replaceSessionStateSnapshot(value, { merge: false })
    const after = repository.exportSnapshot()
    if (after.count !== (rollBack ? plan.beforeCount : plan.targetCount) || after.digest !== (rollBack ? plan.beforeDigest : plan.targetDigest)) {
      throw new Error('Session state restore plan recovery verification failed')
    }
    const integrity = repository.verifyIntegrity()
    if (!integrity.ok) throw new Error('Session state restore plan recovery integrity verification failed')
    await fs.rm(planFile, { force: true })
    checkpointWalAfterRestore(repository, 'session-state-restore-recovery')
    return true
  }, {
    storage,
    operation: 'session-state-restore-recovery',
    waitTimeoutMs,
    pollIntervalMs,
  })
}
