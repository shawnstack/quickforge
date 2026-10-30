import { createScheduledTaskRunsRepository } from './sqlite/scheduled-task-runs-repository.mjs'

// Scheduled task runs service: the `scheduled_task_runs` table is the only
// authoritative run store (the retired JSON mirror/phase machine is gone), so
// every read and write below goes straight through the repository. The service
// keeps per-task write serialization (a run for the same task is upserted in
// call order), the public run projections used by the routes and the failure
// diagnostics surfaced by the route layer.

function normalizeTasks(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value)
  return []
}

function taskMetadata(task) {
  return {
    taskTitle: task.title,
    scheduleRule: task.scheduleRule,
    projectName: task.projectName,
  }
}

export function createScheduledTaskRunsService({
  readTasks,
  getRepository = () => createScheduledTaskRunsRepository(),
  logger = console,
} = {}) {
  if (typeof readTasks !== 'function') throw new TypeError('Scheduled task runs service requires readTasks')
  if (typeof getRepository !== 'function') throw new TypeError('Scheduled task runs service requires getRepository')

  let repositoryInstance = null
  const taskOperations = new Map()
  const failureCounts = Object.create(null)
  let readDegraded = false
  let lastFailureAt = null

  async function repository() {
    if (!repositoryInstance) repositoryInstance = await getRepository()
    return repositoryInstance
  }

  function recordFailure(operation, error, { taskId, runId, stage } = {}) {
    failureCounts[operation] = (failureCounts[operation] || 0) + 1
    lastFailureAt = new Date().toISOString()
    logger?.warn?.('Scheduled task run persistence failed', {
      operation,
      taskId,
      runId,
      stage,
      errorName: error?.name || 'Error',
      errorCode: error?.code,
    })
  }

  async function performSyncRun(taskId, run, stage) {
    try {
      return (await repository()).upsert(taskId, run, { source: 'runtime' })
    } catch (error) {
      recordFailure('sync', error, { taskId, runId: run.id, stage })
      throw error
    }
  }

  async function syncRun(taskId, run, { stage = 'updated' } = {}) {
    if (!taskId || !run?.id) return null
    const previous = taskOperations.get(taskId) || Promise.resolve()
    const operation = previous.catch(() => undefined).then(() => performSyncRun(taskId, run, stage))
    taskOperations.set(taskId, operation)
    try {
      return await operation
    } finally {
      if (taskOperations.get(taskId) === operation) taskOperations.delete(taskId)
    }
  }

  async function deleteRun(taskId, runId) {
    try {
      return (await repository()).delete(taskId, runId)
    } catch (error) {
      recordFailure('delete', error, { taskId, runId })
      throw error
    }
  }

  async function performDeleteTaskRuns(taskId) {
    try {
      return (await repository()).deleteByTask(taskId) >= 0
    } catch (error) {
      recordFailure('deleteByTask', error, { taskId })
      throw error
    }
  }

  async function deleteTaskRuns(taskId) {
    if (!taskId) return false
    const previous = taskOperations.get(taskId) || Promise.resolve()
    const operation = previous.catch(() => undefined).then(() => performDeleteTaskRuns(taskId))
    taskOperations.set(taskId, operation)
    try {
      return await operation
    } finally {
      if (taskOperations.get(taskId) === operation) taskOperations.delete(taskId)
    }
  }

  async function listRepositoryRuns(filters, tasks) {
    const repo = await repository()
    const metadataById = new Map(tasks.filter((task) => task?.id).map((task) => [task.id, task]))
    const currentTaskIds = [...metadataById.keys()]
    const keyword = String(filters.keyword || '').trim()
    const keywordTaskIds = keyword
      ? tasks.filter((task) => String(task?.title || '').toLowerCase().includes(keyword.toLowerCase())).map((task) => task.id)
      : undefined
    const result = repo.list({
      page: filters.page,
      pageSize: filters.pageSize,
      taskId: filters.taskId,
      taskIds: currentTaskIds,
      status: filters.status,
      trigger: filters.trigger,
      keyword,
      keywordTaskIds,
      startedFrom: filters.startedFrom,
      startedTo: filters.startedTo,
    })
    return {
      ...result,
      runs: result.runs.map((run) => {
        const { source: _source, ...publicRun } = run
        return { ...publicRun, ...taskMetadata(metadataById.get(run.taskId)) }
      }),
    }
  }

  async function listRuns(filters = {}) {
    await Promise.all([...taskOperations.values()].map((operation) => operation.catch(() => undefined)))
    const tasks = normalizeTasks(await readTasks())
    try {
      const result = await listRepositoryRuns(filters, tasks)
      readDegraded = false
      return result
    } catch (error) {
      readDegraded = true
      recordFailure('list', error, { taskId: filters.taskId || undefined })
      throw error
    }
  }

  async function recentRuns(taskId, limit = 5) {
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 5, 200))
    return (await repository()).listByTask(taskId, { limit: normalizedLimit }).map((run) => {
      const { source: _source, ...publicRun } = run
      return publicRun
    })
  }

  function getDiagnostics() {
    return {
      readDegraded,
      lastFailureAt,
      failureCounts: { ...failureCounts },
    }
  }

  return Object.freeze({ syncRun, deleteRun, deleteTaskRuns, listRuns, recentRuns, getDiagnostics })
}
