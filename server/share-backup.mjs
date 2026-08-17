import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getSqliteStorage } from './sqlite/database.mjs'
import { createShareRepository, shareSnapshotDigest } from './sqlite/share-repository.mjs'
import {
  buildShareJsonSnapshot,
  currentShareMaintenanceContext,
  runShareMaintenance,
} from './share-cutover.mjs'
import { getShareStoragePhase, isShareStorageAuthoritative } from './share-service.mjs'
import { storageDir } from './storage.mjs'

// F10 Phase 3 share backup/restore: mirrors the session-state-backup pattern in
// the independent share storage domain. Exports run under the share maintenance
// lock with quick_check + verifyIntegrity + exportSnapshot (count/digest fail
// closed). Restores run under the same lock, persist a crash-recoverable plan
// file and compensate back to the exact before-state if the apply or its
// verification fails. Only share_sessions/share_tokens/share_json_mirror_queue
// are touched; scheduled_task_runs, session_index and session_messages are
// never modified here.
const RESTORE_PLAN_FILE = path.join(storageDir, 'share-restore-plan.json')
const ROLL_FORWARD_STATUSES = new Set(['prepared', 'applying', 'target_applied'])
const ROLL_BACK_STATUSES = new Set(['compensating', 'compensation_failed'])

function repositoryRequired() {
  try {
    return createShareRepository(getSqliteStorage())
  } catch (error) {
    throw new Error('SQLite storage is required for authoritative share state', { cause: error })
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function isPlainPlanValue(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// Strip repository-internal fields before writing records into backups or plans
// so the exported JSON is exactly the v1 conversation-shares.json shape.
function publicShareRecord(record) {
  if (!isPlainObject(record)) return record
  const rest = { ...record }
  delete rest.revision
  delete rest.deletedAt
  return rest
}

function shareValuesFromRecords(records) {
  return {
    shares: Object.fromEntries((Array.isArray(records) ? records : []).map((record) => [record.id, publicShareRecord(record)])),
  }
}

// Public digest helper for backup tooling: returns the exact repository-style
// digest a restored snapshot must produce, given backup `{ shares }` values.
export function computeShareSnapshotDigest(values) {
  return shareSnapshotDigest(buildShareJsonSnapshot(values?.shares).records)
}

/**
 * Authoritative share state export for the backup route and offline tools.
 * Runs under the share maintenance lock so a concurrent restore can never be
 * observed mid-transaction, and fail-closes when integrity or digest
 * verification fails.
 */
export async function exportShareStateForBackup(options = {}) {
  const operation = async () => {
    const repository = options.repository || repositoryRequired()
    const integrity = repository.verifyIntegrity({ quickCheck: true })
    if (!integrity.ok) throw new Error('Share state integrity verification failed during backup export')
    const snapshot = repository.exportSnapshot()
    if (snapshot.count !== integrity.count || snapshot.digest !== integrity.digest) {
      throw new Error('Share backup count/digest verification failed')
    }
    return {
      ...shareValuesFromRecords(snapshot.records),
      records: snapshot.records,
      count: snapshot.count,
      digest: snapshot.digest,
      phase: getShareStoragePhase(),
    }
  }
  if (!options.maintenance || currentShareMaintenanceContext()) return operation()
  return runShareMaintenance(operation, { storage: options.storage, operation: 'share-backup-export' })
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

function countShares(values) {
  return isPlainPlanValue(values) && values.shares && typeof values.shares === 'object' && !Array.isArray(values.shares)
    ? Object.keys(values.shares).length
    : 0
}

function validatePlan(plan) {
  if (
    !plan || plan.version !== 1 || plan.operation !== 'share_state_restore' ||
    !isPlainPlanValue(plan.before) || !isPlainPlanValue(plan.target)
  ) {
    throw new Error('Share restore plan is invalid')
  }
  if (!ROLL_FORWARD_STATUSES.has(plan.status) && !ROLL_BACK_STATUSES.has(plan.status)) {
    throw new Error('Share restore plan status is invalid')
  }
  const beforeCount = countShares(plan.before)
  const targetCount = countShares(plan.target)
  if (plan.beforeCount !== beforeCount || plan.targetCount !== targetCount) {
    throw new Error('Share restore plan count is invalid')
  }
  const beforeDigest = computeShareSnapshotDigest(plan.before)
  const targetDigest = computeShareSnapshotDigest(plan.target)
  if (plan.beforeDigest !== beforeDigest || plan.targetDigest !== targetDigest) {
    throw new Error('Share restore plan digest is invalid')
  }
  return plan
}

/**
 * Restore the authoritative share state from a backup snapshot. Always runs
 * under the share maintenance lock, persists a crash-recoverable plan file, and
 * compensates back to the exact before-state if the apply or its verification
 * fails. replace mode wipes local shares; merge mode keeps local-only records
 * while backup records override same-key entries. `values` is the v1
 * conversation-shares.json shape (`{ shares: { [shareId]: record } }`).
 */
export async function restoreShareStateSnapshot(values, options = {}) {
  if (!isShareStorageAuthoritative()) {
    throw new Error('Share state restore requires authoritative SQLite storage')
  }
  if (!isPlainPlanValue(values) || !isPlainObject(values.shares)) {
    throw new TypeError('Share restore values must be a shares object')
  }
  const repository = options.repository || repositoryRequired()
  const mode = options.mode === 'merge' ? 'merge' : 'replace'
  const planFile = options.planFile || RESTORE_PLAN_FILE
  return runShareMaintenance(async () => {
    const before = repository.exportSnapshot()
    const beforeValues = shareValuesFromRecords(before.records)
    const merged = mode === 'merge'
      ? { ...beforeValues.shares, ...values.shares }
      : values.shares
    // Normalize once before writing the plan: validation failures (invalid
    // records, duplicate ids) surface here and never leave a plan file.
    const targetRecords = buildShareJsonSnapshot(merged).records
    const targetValues = shareValuesFromRecords(targetRecords)
    const beforeCount = before.count
    const beforeDigest = before.digest
    const targetCount = targetRecords.length
    const targetDigest = shareSnapshotDigest(targetRecords)
    let plan = {
      version: 1,
      operation: 'share_state_restore',
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
      repository.replaceAll(targetRecords, { expectedCount: targetCount, expectedDigest: targetDigest })
      const after = repository.exportSnapshot()
      if (after.count !== targetCount || after.digest !== targetDigest) {
        throw new Error('Share restore count/digest verification failed')
      }
      const integrity = repository.verifyIntegrity()
      if (!integrity.ok) throw new Error('Share restore integrity verification failed')
      plan = { ...plan, status: 'target_applied' }
      await writePlan(plan, planFile)
      await fs.rm(planFile, { force: true })
      return { shares: targetCount }
    } catch (error) {
      try {
        plan = { ...plan, status: 'compensating', failedAt: new Date().toISOString() }
        await writePlan(plan, planFile)
        const beforeRecords = buildShareJsonSnapshot(beforeValues.shares).records
        repository.replaceAll(beforeRecords, { expectedCount: beforeCount, expectedDigest: beforeDigest })
        const restored = repository.exportSnapshot()
        if (restored.count !== beforeCount || restored.digest !== beforeDigest) {
          throw new Error('Share restore compensation verification failed', { cause: error })
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
        const retained = new Error('Share restore failed and compensation failed', { cause: compensationError })
        retained.retainShareMaintenance = true
        throw retained
      }
      throw error
    }
  }, { storage: options.storage, operation: 'share-restore' })
}

/**
 * Startup recovery for an interrupted share restore plan: roll forward to the
 * target for prepared/applying/target_applied plans and roll back to the before
 * state for compensating/compensation_failed plans, then remove the plan file.
 */
export async function recoverShareRestorePlan({
  repository: repositoryOverride,
  planFile = RESTORE_PLAN_FILE,
  storage,
} = {}) {
  let plan
  try {
    plan = validatePlan(JSON.parse(await fs.readFile(planFile, 'utf8')))
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw new Error(`Share restore plan is unreadable or invalid: ${error?.message || error}`, { cause: error })
  }
  if (!isShareStorageAuthoritative()) {
    throw new Error('Share restore plan exists outside authoritative mode')
  }
  const repository = repositoryOverride || repositoryRequired()
  return runShareMaintenance(async () => {
    const rollBack = ROLL_BACK_STATUSES.has(plan.status)
    const records = buildShareJsonSnapshot(rollBack ? plan.before.shares : plan.target.shares).records
    const expectedCount = rollBack ? plan.beforeCount : plan.targetCount
    const expectedDigest = rollBack ? plan.beforeDigest : plan.targetDigest
    repository.replaceAll(records, { expectedCount, expectedDigest })
    const after = repository.exportSnapshot()
    if (after.count !== expectedCount || after.digest !== expectedDigest) {
      throw new Error('Share restore plan recovery verification failed')
    }
    const integrity = repository.verifyIntegrity()
    if (!integrity.ok) throw new Error('Share restore plan recovery integrity verification failed')
    await fs.rm(planFile, { force: true })
    return true
  }, { storage, operation: 'share-restore-recovery' })
}
