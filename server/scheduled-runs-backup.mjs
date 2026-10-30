import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getSqliteStorage } from './sqlite/database.mjs'
import { createScheduledTaskRunsRepository } from './sqlite/scheduled-task-runs-repository.mjs'
import {
  currentScheduledRunsMaintenanceContext,
  runScheduledRunsMaintenance,
} from './scheduled-runs-maintenance.mjs'
import { readStore, storageDir, writeStore } from './storage.mjs'

// Scheduled-runs backup/restore. SQLite is the single authoritative store: the
// v1 backup shape keeps task metadata in `scheduledTasks` and the runs in the
// `scheduled_task_runs` table, so export reads a consistent snapshot through
// the repository and restore rewrites both halves inside the maintenance lock.

const RESTORE_PLAN_FILE = path.join(storageDir, 'scheduled-runs-restore-plan.json')
const ROLL_FORWARD_STATUSES = new Set(['prepared', 'applying', 'target_applied'])
const ROLL_BACK_STATUSES = new Set(['compensating', 'compensation_failed'])

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

// Splits the v1 `scheduledTasks` payload into repository entries plus the
// metadata-only task records that stay in the JSON store.
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
      entries.push({ taskId, run: structuredClone(run), source: 'v1_import' })
    }
    const { runs: _runs, ...taskMetadata } = task
    metadata[recordId] = taskMetadata
  }
  return { metadata, entries, count: entries.length, digest: scheduledRunsDigest(entries) }
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
  if (!maintenance || currentScheduledRunsMaintenanceContext()) return operation()
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
  const repository = repositoryOverride || repositoryRequired()
  return runScheduledRunsMaintenance(async () => {
    const value = ROLL_BACK_STATUSES.has(plan.status) ? plan.before : plan.target
    await applyLogicalTasks(value, repository, writeTasks)
    await fs.rm(planFile, { force: true })
    return true
  }, { storage, operation: 'scheduled-runs-restore-recovery', pauseRuntime: false })
}
