import { createScheduledTaskRunsRepository } from './sqlite/scheduled-task-runs-repository.mjs'
import { isScheduledRunsAuthoritative } from './scheduled-runs-cutover.mjs'

const NULLABLE_UPDATE_FIELDS = Object.freeze([
  'inputContent', 'aiResult', 'result', 'errorMessage', 'warning', 'sessionId', 'finishedAt',
  'durationMs', 'agentId', 'agentLabel', 'agentSnapshot', 'legacy',
])

function compositeKey(taskId, runId) {
  return JSON.stringify([String(taskId ?? ''), String(runId ?? '')])
}

function normalizeTasks(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value)
  return []
}

function parsePositiveInteger(value, fallback, max) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function normalizedDateBoundary(value) {
  if (value === undefined || value === null || value === '') return null
  const timestamp = new Date(String(value)).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

function runMatchesKeyword(run, keyword) {
  if (!keyword) return true
  const text = [run.taskTitle, run.inputContent, run.aiResult, run.result, run.errorMessage]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
  return text.includes(keyword.toLowerCase())
}

function updateValue(run) {
  const value = { status: run.status }
  for (const field of NULLABLE_UPDATE_FIELDS) value[field] = run[field] ?? null
  return value
}

function sortedDiagnosticsEntries(keys) {
  return [...keys]
    .map((key) => {
      const [taskId, runId] = JSON.parse(key)
      return { taskId, runId }
    })
    .sort((a, b) => a.taskId.localeCompare(b.taskId) || a.runId.localeCompare(b.runId))
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
  isAuthoritative = isScheduledRunsAuthoritative,
  logger = console,
} = {}) {
  if (typeof readTasks !== 'function') throw new TypeError('Scheduled task runs service requires readTasks')
  if (typeof getRepository !== 'function') throw new TypeError('Scheduled task runs service requires getRepository')
  if (typeof isAuthoritative !== 'function') throw new TypeError('Scheduled task runs service requires isAuthoritative')

  let repositoryInstance = null
  const taskOperations = new Map()
  const dirtyTaskIds = new Set()
  const dirtyRunKeys = new Set()
  const failureCounts = Object.create(null)
  let readDegraded = false
  let lastFailureAt = null

  async function repository() {
    if (!repositoryInstance) repositoryInstance = await getRepository()
    return repositoryInstance
  }

  function markDirty(taskId, runId) {
    dirtyTaskIds.add(taskId)
    if (runId !== undefined && runId !== null) dirtyRunKeys.add(compositeKey(taskId, runId))
  }

  function clearDirty(taskId, runId) {
    dirtyRunKeys.delete(compositeKey(taskId, runId))
    if (![...dirtyRunKeys].some((key) => JSON.parse(key)[0] === taskId)) dirtyTaskIds.delete(taskId)
  }

  function recordFailure(operation, error, { taskId, runId, phase } = {}) {
    failureCounts[operation] = (failureCounts[operation] || 0) + 1
    lastFailureAt = new Date().toISOString()
    if (taskId) markDirty(taskId, runId)
    logger?.warn?.('Scheduled task run persistence failed', {
      operation,
      taskId,
      runId,
      phase,
      errorName: error?.name || 'Error',
      errorCode: error?.code,
    })
  }

  async function performSyncRun(taskId, run, phase) {
    try {
      const repo = await repository()
      if (isAuthoritative()) {
        const result = repo.upsert(taskId, run, { source: 'runtime' })
        clearDirty(taskId, run.id)
        return result
      }
      const current = repo.get(taskId, run.id)
      const result = current
        ? repo.update(taskId, run.id, updateValue(run))
        : repo.upsert(taskId, run, { source: 'hybrid_shadow' })
      clearDirty(taskId, run.id)
      return result
    } catch (error) {
      recordFailure('sync', error, { taskId, runId: run.id, phase })
      if (isAuthoritative()) throw error
      return null
    }
  }

  async function syncRun(taskId, run, { phase = 'updated' } = {}) {
    if (!taskId || !run?.id) return null
    const previous = taskOperations.get(taskId) || Promise.resolve()
    const operation = previous.catch(() => undefined).then(() => performSyncRun(taskId, run, phase))
    taskOperations.set(taskId, operation)
    try {
      return await operation
    } finally {
      if (taskOperations.get(taskId) === operation) taskOperations.delete(taskId)
    }
  }

  async function deleteRun(taskId, runId) {
    try {
      const deleted = (await repository()).delete(taskId, runId)
      clearDirty(taskId, runId)
      return deleted
    } catch (error) {
      recordFailure('delete', error, { taskId, runId })
      if (isAuthoritative()) throw error
      return false
    }
  }

  async function performDeleteTaskRuns(taskId) {
    try {
      await (await repository()).deleteByTask(taskId)
      dirtyTaskIds.delete(taskId)
      for (const key of dirtyRunKeys) if (JSON.parse(key)[0] === taskId) dirtyRunKeys.delete(key)
      return true
    } catch (error) {
      recordFailure('deleteByTask', error, { taskId })
      if (isAuthoritative()) throw error
      return false
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

  async function listAuthoritative(filters, tasks) {
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

  async function listHybrid(filters, tasks) {
    const page = parsePositiveInteger(filters.page, 1, 100_000)
    const pageSize = parsePositiveInteger(filters.pageSize, 10, 100)
    const taskId = String(filters.taskId || '').trim()
    const status = String(filters.status || '').trim()
    const trigger = String(filters.trigger || '').trim()
    const keyword = String(filters.keyword || '').trim()
    const startedFrom = normalizedDateBoundary(filters.startedFrom)
    const startedTo = normalizedDateBoundary(filters.startedTo)
    let runs = []
    for (const task of tasks) {
      if (!task?.id) continue
      const seen = new Set()
      for (const run of Array.isArray(task.runs) ? task.runs : []) {
        if (!run?.id || seen.has(run.id)) continue
        seen.add(run.id)
        runs.push({ ...run, taskId: task.id, ...taskMetadata(task) })
      }
    }
    if (taskId) runs = runs.filter((run) => run.taskId === taskId)
    if (status) runs = runs.filter((run) => run.status === status)
    if (trigger) runs = runs.filter((run) => run.trigger === trigger)
    if (startedFrom !== null) runs = runs.filter((run) => new Date(run.startedAt).getTime() >= startedFrom)
    if (startedTo !== null) runs = runs.filter((run) => new Date(run.startedAt).getTime() <= startedTo)
    if (keyword) runs = runs.filter((run) => runMatchesKeyword(run, keyword))
    runs.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)) || String(b.id).localeCompare(String(a.id)) || String(b.taskId).localeCompare(String(a.taskId)))
    const total = runs.length
    const start = (page - 1) * pageSize
    return { runs: runs.slice(start, start + pageSize), total, page, pageSize }
  }

  async function listRuns(filters = {}) {
    await Promise.all([...taskOperations.values()].map((operation) => operation.catch(() => undefined)))
    const tasks = normalizeTasks(await readTasks())
    if (!isAuthoritative()) return listHybrid(filters, tasks)
    try {
      const result = await listAuthoritative(filters, tasks)
      readDegraded = false
      return result
    } catch (error) {
      readDegraded = true
      recordFailure('list', error, { taskId: filters.taskId || undefined })
      throw error
    }
  }

  async function recentRuns(taskId, limit = 5) {
    if (!isAuthoritative()) {
      const task = normalizeTasks(await readTasks()).find((value) => value?.id === taskId)
      return Array.isArray(task?.runs) ? task.runs.slice(0, limit) : []
    }
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 5, 200))
    return (await repository()).listByTask(taskId, { limit: normalizedLimit }).map((run) => {
      const { source: _source, ...publicRun } = run
      return publicRun
    })
  }

  function getDiagnostics() {
    return {
      dirtyTaskIds: [...dirtyTaskIds].sort(),
      dirtyRunIds: sortedDiagnosticsEntries(dirtyRunKeys),
      ownedRunIds: [],
      readDegraded,
      lastFailureAt,
      failureCounts: { ...failureCounts },
    }
  }

  return Object.freeze({ syncRun, deleteRun, deleteTaskRuns, listRuns, recentRuns, getDiagnostics })
}
