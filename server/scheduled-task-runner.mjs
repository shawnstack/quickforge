import { logger } from './utils/logger.mjs'
import { canStartScheduledRun, configureScheduledRunsRuntimeHooks } from './scheduled-runs-maintenance.mjs'
import {
  MAX_RUN_HISTORY_PER_TASK,
  calculateNextRun,
  currentRunIdsFor,
  executionModeFor,
  getTasks,
  isRecurringTask,
  persistRun,
  repairRecurringTaskStatuses,
  requestError,
  taskRunsService,
  updateTask,
} from './scheduled-task-store.mjs'
import { executeTask, hasActiveTaskRuns, hasInFlightRuns } from './scheduled-task-executor.mjs'

// 常驻调度守护循环（从 routes/scheduled-tasks.mjs 拆出，god-module-decomposition ①）：
// 每 30 秒 tick 一次检查到期任务并派发 executeTask；start/stop 由 server/index.mjs
// 启动链调用；启动恢复（recoverStaleScheduledTaskRuns）把上次进程中断留下的
// running run 判为失败；scheduled-runs 维护窗口通过 runtime hooks 暂停/恢复本循环。
// 与 bot-runner.mjs / auto-archive.mjs 同属「常驻循环放 server 根目录」一族。

const RUN_CHECK_INTERVAL_MS = 30 * 1000
let schedulerTimer = null
let runnerDesired = false
let running = false
let tickPromise = null

export async function recoverStaleScheduledTaskRuns({ now = () => new Date() } = {}) {
  const tasks = await getTasks()
  const finishedAt = now().toISOString()
  for (const task of tasks) {
    const activeIds = currentRunIdsFor(task)
    const storedRunning = (await taskRunsService.listRuns({ taskId: task.id, status: 'running', page: 1, pageSize: MAX_RUN_HISTORY_PER_TASK })).runs
    const runningById = new Map(storedRunning.map((run) => [run.id, run]))
    for (const runId of activeIds) {
      if (!runningById.has(runId)) runningById.set(runId, { id: runId, status: 'running', trigger: 'schedule', startedAt: task.lastRunAt || task.updatedAt || finishedAt })
    }
    if (runningById.size === 0 && activeIds.length === 0) continue
    for (const run of runningById.values()) {
      const startedMs = new Date(run.startedAt).getTime()
      const durationMs = Number.isFinite(startedMs) ? Math.max(0, new Date(finishedAt).getTime() - startedMs) : 0
      const failed = { ...run, status: 'failed', errorMessage: 'Interrupted by previous process shutdown', finishedAt, durationMs }
      await persistRun(task.id, failed, 'startup-recovery')
    }
    await updateTask(task.id, (current) => ({
      ...current,
      currentRunId: null,
      currentRunIds: [],
      status: current.status === 'paused' ? 'paused' : (isRecurringTask(current) ? 'enabled' : 'failed'),
      lastRunAt: finishedAt,
      nextRunAt: isRecurringTask(current) ? (calculateNextRun(current, new Date(finishedAt)) ?? current.nextRunAt) : current.nextRunAt,
    }))
  }
}

async function schedulerTick() {
  if (running || !canStartScheduledRun()) return
  running = true
  try {
    if (!canStartScheduledRun()) return
    await repairRecurringTaskStatuses()
    const now = Date.now()
    const tasks = await getTasks()
    for (const task of tasks) {
      if (!canStartScheduledRun()) break
      if (task.status !== 'enabled') continue
      if (!task.nextRunAt || new Date(task.nextRunAt).getTime() > now) continue
      if (executionModeFor(task) === 'serial' && hasActiveTaskRuns(task)) continue
      executeTask(task, 'schedule').catch((error) => logger.error(`Scheduled task ${task.id} failed:`, error))
    }
  } finally {
    running = false
  }
}

function requestSchedulerTick() {
  if (tickPromise) return tickPromise
  tickPromise = schedulerTick()
    .catch((error) => logger.error('Scheduled task tick failed:', error))
    .finally(() => { tickPromise = null })
  return tickPromise
}

async function pauseScheduledTaskRunner() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
  }
  if (tickPromise) await tickPromise
  const tasks = await getTasks()
  if (hasInFlightRuns() || tasks.some(hasActiveTaskRuns)) {
    const error = requestError('Cannot restore scheduled tasks while a run is active', 409)
    error.errorCode = 'scheduled_runs_active'
    throw error
  }
}

function resumeScheduledTaskRunner() {
  if (runnerDesired) startScheduledTaskRunner()
}

configureScheduledRunsRuntimeHooks({ pause: pauseScheduledTaskRunner, resume: resumeScheduledTaskRunner })

export function startScheduledTaskRunner() {
  runnerDesired = true
  if (schedulerTimer || !canStartScheduledRun()) return
  schedulerTimer = setInterval(requestSchedulerTick, RUN_CHECK_INTERVAL_MS)
  requestSchedulerTick()
}

export function stopScheduledTaskRunner() {
  runnerDesired = false
  if (schedulerTimer) clearInterval(schedulerTimer)
  schedulerTimer = null
}
