import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getSqliteStorage } from './sqlite/database.mjs'
import { createLanAccessRepository, lanAccessConfigDigest } from './sqlite/lan-access-repository.mjs'
import {
  buildLanAccessJsonSnapshot,
  currentLanAccessMaintenanceContext,
  runLanAccessMaintenance,
} from './lan-access-cutover.mjs'
import { getLanAccessStoragePhase, isLanAccessStorageAuthoritative } from './lan-access-service.mjs'
import { storageDir } from './storage.mjs'

// F11 Phase 3 lan-access backup/restore: mirrors the session-state/share backup
// pattern in the independent lan-access storage domain. Exports run under the
// lan-access maintenance lock with quick_check + verifyIntegrity + exportSnapshot
// (count/digest fail closed). Restores run under the same lock, persist a
// crash-recoverable plan file and compensate back to the exact before-state if
// the apply or its verification fails. Only lan_access_state /
// lan_access_tokens / lan_access_json_mirror_queue are touched;
// scheduled_task_runs, session_index, session_messages and share_sessions are
// never modified here. The exported config keeps token hashes only (raw secrets
// never leave the issuer) and strips the repository-internal revision.
const RESTORE_PLAN_FILE = path.join(storageDir, 'lan-access-restore-plan.json')
const ROLL_FORWARD_STATUSES = new Set(['prepared', 'applying', 'target_applied'])
const ROLL_BACK_STATUSES = new Set(['compensating', 'compensation_failed'])

function repositoryRequired() {
  try {
    return createLanAccessRepository(getSqliteStorage())
  } catch (error) {
    throw new Error('SQLite storage is required for authoritative LAN access state', { cause: error })
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function isPlainPlanValue(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// Strip repository-internal fields before writing the config into backups or
// plans so the exported JSON is exactly the v1 lan-access.json shape. Token
// hashes stay (they are already hash-only — never plaintext secrets).
function publicLanAccessConfig(config) {
  if (!isPlainObject(config)) return config
  const rest = { ...config }
  delete rest.revision
  return rest
}

// Public digest helper for backup tooling: returns the exact repository-style
// digest a restored snapshot must produce, given backup `{ lanAccess: config }`.
export function computeLanAccessSnapshotDigest(values) {
  if (!isPlainPlanValue(values) || !isPlainObject(values.lanAccess)) return ''
  return lanAccessConfigDigest(buildLanAccessJsonSnapshot(values.lanAccess).config)
}

function countLanAccessTokens(values) {
  if (!isPlainPlanValue(values) || !isPlainObject(values.lanAccess)) return 0
  return buildLanAccessJsonSnapshot(values.lanAccess).tokenCount
}

/**
 * Authoritative lan-access state export for the backup route and offline tools.
 * Runs under the lan-access maintenance lock so a concurrent restore can never
 * be observed mid-transaction, and fail-closes when integrity or digest
 * verification fails.
 */
export async function exportLanAccessStateForBackup(options = {}) {
  const operation = async () => {
    const repository = options.repository || repositoryRequired()
    const integrity = repository.verifyIntegrity({ quickCheck: true })
    if (!integrity.ok) throw new Error('LAN access state integrity verification failed during backup export')
    const snapshot = repository.exportSnapshot()
    if (snapshot.tokenCount !== integrity.count || snapshot.digest !== integrity.digest) {
      throw new Error('LAN access backup count/digest verification failed')
    }
    return {
      lanAccess: publicLanAccessConfig(snapshot.config),
      config: snapshot.config,
      count: snapshot.tokenCount,
      digest: snapshot.digest,
      phase: getLanAccessStoragePhase(),
    }
  }
  if (!options.maintenance || currentLanAccessMaintenanceContext()) return operation()
  return runLanAccessMaintenance(operation, { storage: options.storage, operation: 'lan-access-backup-export' })
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

function validatePlan(plan) {
  if (
    !plan || plan.version !== 1 || plan.operation !== 'lan_access_state_restore' ||
    !isPlainPlanValue(plan.before) || !isPlainPlanValue(plan.target)
  ) {
    throw new Error('LAN access restore plan is invalid')
  }
  if (!ROLL_FORWARD_STATUSES.has(plan.status) && !ROLL_BACK_STATUSES.has(plan.status)) {
    throw new Error('LAN access restore plan status is invalid')
  }
  const beforeCount = countLanAccessTokens(plan.before)
  const targetCount = countLanAccessTokens(plan.target)
  if (plan.beforeCount !== beforeCount || plan.targetCount !== targetCount) {
    throw new Error('LAN access restore plan count is invalid')
  }
  const beforeDigest = computeLanAccessSnapshotDigest(plan.before)
  const targetDigest = computeLanAccessSnapshotDigest(plan.target)
  if (plan.beforeDigest !== beforeDigest || plan.targetDigest !== targetDigest) {
    throw new Error('LAN access restore plan digest is invalid')
  }
  return plan
}

/**
 * Restore the authoritative lan-access state from a backup snapshot. Always
 * runs under the lan-access maintenance lock, persists a crash-recoverable plan
 * file, and compensates back to the exact before-state if the apply or its
 * verification fails. replace mode wipes the local config; merge mode keeps
 * local config fields (including local tokens) while backup fields override
 * same-key entries. `values` is the v1 lan-access.json shape
 * (`{ lanAccess: config }`). The restore overwrites the `enabled` switch when
 * the backup carries one, so import UIs warn before applying.
 */
export async function restoreLanAccessStateSnapshot(values, options = {}) {
  if (!isLanAccessStorageAuthoritative()) {
    throw new Error('LAN access state restore requires authoritative SQLite storage')
  }
  if (!isPlainPlanValue(values) || !isPlainObject(values.lanAccess)) {
    throw new TypeError('LAN access restore values must be a lanAccess config object')
  }
  const repository = options.repository || repositoryRequired()
  const mode = options.mode === 'merge' ? 'merge' : 'replace'
  const planFile = options.planFile || RESTORE_PLAN_FILE
  return runLanAccessMaintenance(async () => {
    const before = repository.exportSnapshot()
    const beforeConfig = publicLanAccessConfig(before.config)
    const merged = mode === 'merge'
      ? { ...beforeConfig, ...values.lanAccess }
      : values.lanAccess
    // Normalize once before writing the plan: validation failures (invalid
    // config, enabled-without-password, malformed tokens) surface here and
    // never leave a plan file.
    const targetSnapshot = buildLanAccessJsonSnapshot(merged)
    const targetConfig = publicLanAccessConfig(targetSnapshot.config)
    const beforeCount = before.tokenCount
    const beforeDigest = before.digest
    const targetCount = targetSnapshot.tokenCount
    const targetDigest = targetSnapshot.digest
    let plan = {
      version: 1,
      operation: 'lan_access_state_restore',
      status: 'prepared',
      createdAt: new Date().toISOString(),
      before: { lanAccess: beforeConfig },
      target: { lanAccess: targetConfig },
      beforeCount,
      beforeDigest,
      targetCount,
      targetDigest,
    }
    await writePlan(plan, planFile)
    try {
      plan = { ...plan, status: 'applying' }
      await writePlan(plan, planFile)
      repository.replaceAll(targetConfig, { expectedCount: targetCount, expectedDigest: targetDigest })
      const after = repository.exportSnapshot()
      if (after.tokenCount !== targetCount || after.digest !== targetDigest) {
        throw new Error('LAN access restore count/digest verification failed')
      }
      const integrity = repository.verifyIntegrity()
      if (!integrity.ok) throw new Error('LAN access restore integrity verification failed')
      plan = { ...plan, status: 'target_applied' }
      await writePlan(plan, planFile)
      await fs.rm(planFile, { force: true })
      return { lanAccess: targetCount }
    } catch (error) {
      try {
        plan = { ...plan, status: 'compensating', failedAt: new Date().toISOString() }
        await writePlan(plan, planFile)
        const beforeSnapshot = buildLanAccessJsonSnapshot(beforeConfig)
        repository.replaceAll(beforeSnapshot.config, { expectedCount: beforeCount, expectedDigest: beforeDigest })
        const restored = repository.exportSnapshot()
        if (restored.tokenCount !== beforeCount || restored.digest !== beforeDigest) {
          throw new Error('LAN access restore compensation verification failed', { cause: error })
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
        const retained = new Error('LAN access restore failed and compensation failed', { cause: compensationError })
        retained.retainLanAccessMaintenance = true
        throw retained
      }
      throw error
    }
  }, { storage: options.storage, operation: 'lan-access-restore' })
}

/**
 * Startup recovery for an interrupted lan-access restore plan: roll forward to
 * the target for prepared/applying/target_applied plans and roll back to the
 * before state for compensating/compensation_failed plans, then remove the plan
 * file.
 */
export async function recoverLanAccessRestorePlan({
  repository: repositoryOverride,
  planFile = RESTORE_PLAN_FILE,
  storage,
} = {}) {
  let plan
  try {
    plan = validatePlan(JSON.parse(await fs.readFile(planFile, 'utf8')))
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw new Error(`LAN access restore plan is unreadable or invalid: ${error?.message || error}`, { cause: error })
  }
  if (!isLanAccessStorageAuthoritative()) {
    throw new Error('LAN access restore plan exists outside authoritative mode')
  }
  const repository = repositoryOverride || repositoryRequired()
  return runLanAccessMaintenance(async () => {
    const rollBack = ROLL_BACK_STATUSES.has(plan.status)
    const values = rollBack ? plan.before : plan.target
    const snapshot = buildLanAccessJsonSnapshot(values.lanAccess)
    const expectedCount = rollBack ? plan.beforeCount : plan.targetCount
    const expectedDigest = rollBack ? plan.beforeDigest : plan.targetDigest
    repository.replaceAll(snapshot.config, { expectedCount, expectedDigest })
    const after = repository.exportSnapshot()
    if (after.tokenCount !== expectedCount || after.digest !== expectedDigest) {
      throw new Error('LAN access restore plan recovery verification failed')
    }
    const integrity = repository.verifyIntegrity()
    if (!integrity.ok) throw new Error('LAN access restore plan recovery integrity verification failed')
    await fs.rm(planFile, { force: true })
    return true
  }, { storage, operation: 'lan-access-restore-recovery' })
}
