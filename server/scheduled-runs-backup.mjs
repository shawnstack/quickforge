import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getSqliteStorage } from './sqlite/database.mjs'
import { createScheduledTaskRunsRepository } from './sqlite/scheduled-task-runs-repository.mjs'
import {
  currentScheduledRunsMaintenanceContext,
  getScheduledRunsPhase,
  isScheduledRunsAuthoritative,
  runScheduledRunsMaintenance,
  splitScheduledTasksRuns,
  verifyScheduledRunsRepository,
} from './scheduled-runs-cutover.mjs'
import { readStore, storageDir, writeStore } from './storage.mjs'

const RESTORE_PLAN_FILE = path.join(storageDir, 'scheduled-runs-restore-plan.json')
const ROLL_FORWARD_STATUSES = new Set(['prepared', 'applying', 'target_applied'])
const ROLL_BACK_STATUSES = new Set(['compensating', 'compensation_failed'])

function repositoryRequired() {
  try {
    return createScheduledTaskRunsRepository(getSqliteStorage())
  } catch (error) {
    throw new Error('SQLite storage is required for authoritative scheduled runs', { cause: error })
  }
}

function groupRuns(repository, taskIds) {
  const grouped = new Map(taskIds.map((taskId) => [taskId, []]))
  if (taskIds.length === 0) return grouped
  let page = 1
  let total = null
  let count = 0
  while (true) {
    const result = repository.list({ taskIds, page, pageSize: 100 })
    if (!result || !Array.isArray(result.runs) || !Number.isInteger(result.total) || result.total < 0) {
      throw new Error('Scheduled runs repository returned an invalid backup page')
    }
    if (total === null) total = result.total
    else if (total !== result.total) throw new Error('Scheduled runs repository changed during backup export')
    for (const run of result.runs) {
      if (!taskIds.includes(run.taskId)) throw new Error('Scheduled runs repository returned an orphan backup row')
      const { taskId, source: _source, ...value } = run
      grouped.get(taskId).push(value)
      count += 1
    }
    if (count >= total) break
    if (result.runs.length === 0) throw new Error('Scheduled runs repository backup pagination was incomplete')
    page += 1
  }
  if (count !== total) throw new Error('Scheduled runs repository backup count verification failed')
  return grouped
}

export async function readScheduledTasksForBackup({
  readTasks = () => readStore('scheduled-tasks'),
  repository: repositoryOverride,
  maintenance = true,
} = {}) {
  const operation = async () => {
    const tasks = await readTasks()
    if (!isScheduledRunsAuthoritative()) return tasks
    const repository = repositoryOverride || repositoryRequired()
    const taskIds = Object.keys(tasks)
    const grouped = groupRuns(repository, taskIds)
    const logical = Object.fromEntries(Object.entries(tasks).map(([taskId, task]) => [taskId, {
      ...task,
      runs: grouped.get(taskId) || [],
    }]))
    const snapshot = splitScheduledTasksRuns(logical)
    const repositoryCount = repository.count({ taskIds })
    if (snapshot.count !== repositoryCount) {
      throw new Error('Scheduled runs logical backup count/digest verification failed')
    }
    verifyScheduledRunsRepository(repository, snapshot)
    return logical
  }
  if (!maintenance || !isScheduledRunsAuthoritative() || currentScheduledRunsMaintenanceContext()) return operation()
  return runScheduledRunsMaintenance(operation, { operation: 'scheduled-runs-backup-export', pauseRuntime: false })
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

function planSnapshot(value) {
  const snapshot = splitScheduledTasksRuns(value)
  return { count: snapshot.count, digest: snapshot.digest }
}

function validatePlan(plan) {
  if (!plan || plan.version !== 1 || plan.operation !== 'scheduled_tasks_restore' || !isPlainPlanValue(plan.before) || !isPlainPlanValue(plan.target)) {
    throw new Error('Scheduled runs restore plan is invalid')
  }
  if (!ROLL_FORWARD_STATUSES.has(plan.status) && !ROLL_BACK_STATUSES.has(plan.status)) {
    throw new Error('Scheduled runs restore plan status is invalid')
  }
  const before = planSnapshot(plan.before)
  const target = planSnapshot(plan.target)
  if (plan.beforeCount !== before.count || plan.beforeDigest !== before.digest || plan.targetCount !== target.count || plan.targetDigest !== target.digest) {
    throw new Error('Scheduled runs restore plan digest is invalid')
  }
  return plan
}

function isPlainPlanValue(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function applyLogicalTasks(tasks, repository, writeTasks = (value) => writeStore('scheduled-tasks', value)) {
  const snapshot = splitScheduledTasksRuns(tasks)
  repository.replaceAll(snapshot.entries, { source: 'restore' })
  verifyScheduledRunsRepository(repository, snapshot)
  await writeTasks(snapshot.metadata)
  const verifiedMetadata = splitScheduledTasksRuns(snapshot.metadata)
  if (verifiedMetadata.count !== 0) throw new Error('Scheduled runs restore metadata verification failed')
  return snapshot
}

function hasActiveRuns(tasks, repository) {
  for (const task of Object.values(tasks || {})) {
    if (task?.currentRunId || (Array.isArray(task?.currentRunIds) && task.currentRunIds.some(Boolean))) return true
    if (Array.isArray(task?.runs) && task.runs.some((run) => run?.status === 'running')) return true
  }
  return repository.count({ status: 'running' }) > 0
}

function activeRestoreError() {
  const error = new Error('Cannot restore scheduled tasks while a run is active')
  error.statusCode = 409
  error.errorCode = 'scheduled_runs_active'
  return error
}

export async function restoreScheduledTasks(tasks, {
  mode = 'replace',
  repository: repositoryOverride,
  readCurrent,
  writeTasks,
  planFile = RESTORE_PLAN_FILE,
  storage,
} = {}) {
  if (!isScheduledRunsAuthoritative()) {
    const current = readCurrent ? await readCurrent() : await readStore('scheduled-tasks')
    const target = mode === 'merge' ? { ...current, ...tasks } : tasks
    if (hasActiveRuns(current, { count: () => 0 })) throw activeRestoreError()
    await writeStore('scheduled-tasks', target)
    return target
  }

  const repository = repositoryOverride || repositoryRequired()
  return runScheduledRunsMaintenance(async () => {
    const current = readCurrent
      ? await readCurrent()
      : await readScheduledTasksForBackup({ repository, maintenance: false })
    if (hasActiveRuns(current, repository)) throw activeRestoreError()
    const target = mode === 'merge' ? { ...current, ...tasks } : tasks
    const beforeSnapshot = planSnapshot(current)
    const targetSnapshot = planSnapshot(target)
    let plan = {
      version: 1,
      operation: 'scheduled_tasks_restore',
      status: 'prepared',
      createdAt: new Date().toISOString(),
      before: current,
      target,
      beforeCount: beforeSnapshot.count,
      beforeDigest: beforeSnapshot.digest,
      targetCount: targetSnapshot.count,
      targetDigest: targetSnapshot.digest,
    }
    await writePlan(plan, planFile)
    try {
      plan = { ...plan, status: 'applying' }
      await writePlan(plan, planFile)
      await applyLogicalTasks(target, repository, writeTasks)
      plan = { ...plan, status: 'target_applied' }
      await writePlan(plan, planFile)
      await fs.rm(planFile, { force: true })
      return target
    } catch (error) {
      try {
        plan = { ...plan, status: 'compensating', failedAt: new Date().toISOString() }
        await writePlan(plan, planFile)
        await applyLogicalTasks(current, repository, writeTasks)
        await fs.rm(planFile, { force: true })
      } catch (compensationError) {
        await writePlan({
          ...plan,
          status: 'compensation_failed',
          compensationFailedAt: new Date().toISOString(),
          errorName: error?.name || 'Error',
          compensationErrorName: compensationError?.name || 'Error',
        }, planFile).catch(() => {})
        const retained = new Error('Scheduled task restore failed and compensation failed', { cause: compensationError })
        retained.retainScheduledRunsMaintenance = true
        throw retained
      }
      throw error
    }
  }, { storage, operation: 'scheduled-runs-restore' })
}

export async function recoverScheduledRunsRestorePlan({
  repository: repositoryOverride,
  writeTasks,
  planFile = RESTORE_PLAN_FILE,
  storage,
} = {}) {
  let plan
  try {
    plan = validatePlan(JSON.parse(await fs.readFile(planFile, 'utf8')))
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw new Error(`Scheduled runs restore plan is unreadable or invalid: ${error?.message || error}`, { cause: error })
  }
  if (!['sqlite_authoritative_json_pending', 'authoritative'].includes(getScheduledRunsPhase())) {
    throw new Error('Scheduled runs restore plan exists outside authoritative mode')
  }
  const repository = repositoryOverride || repositoryRequired()
  return runScheduledRunsMaintenance(async () => {
    const value = ROLL_BACK_STATUSES.has(plan.status) ? plan.before : plan.target
    await applyLogicalTasks(value, repository, writeTasks)
    await fs.rm(planFile, { force: true })
    return true
  }, { storage, operation: 'scheduled-runs-restore-recovery', pauseRuntime: false })
}
