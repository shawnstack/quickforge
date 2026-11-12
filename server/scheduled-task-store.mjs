import { readStore, atomicUpdate } from './storage.mjs'
import { logger } from './utils/logger.mjs'
import { createScheduledTaskRunsService } from './scheduled-task-runs-service.mjs'
import {
  dayMs,
  formatLocalDateTime,
  nextIntervalRun,
  normalizeInterval,
  normalizeWeekDays,
  nextWeeklyDaysRun,
  nextCronRun,
  isValidCronExpression,
  nextDailyRun,
  nextMonthlyRun,
  normalizeExecutionMode,
  parseExecuteTime,
  timeFromDate,
} from './utils/scheduled-tasks.mjs'

// 定时任务域的共享核心：任务记录（scheduled-tasks store）的领域规则与存取。
// 从 routes/scheduled-tasks.mjs 拆出（god-module-decomposition ①）：输入归一化、
// 下次运行推算、任务 CRUD、运行历史（SQLite runs）装配与循环任务状态修复都在这里；
// HTTP 路由在 routes/scheduled-tasks.mjs，执行编排在 scheduled-task-executor.mjs，
// 调度循环在 scheduled-task-runner.mjs。纯时间算法仍集中在 utils/scheduled-tasks.mjs。

export const MAX_RUN_HISTORY_PER_TASK = 200
const STORE = 'scheduled-tasks'
const editableScheduleTypes = new Set(['once', 'interval', 'daily', 'weekly', 'monthly'])
const weekDayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function requestError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function nonEmptyString(value, fieldName) {
  const text = String(value ?? '').trim()
  if (!text) throw requestError(`${fieldName} is required`)
  return text
}

function parseDateTime(value, fieldName) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw requestError(`${fieldName} is invalid`)
  return date
}

export function scheduleRuleFor(task) {
  if (task.scheduleType === 'once') return `单次 ${formatLocalDateTime(new Date(task.executeAt ?? task.nextRunAt))}`
  if (task.scheduleType === 'daily') return `每天 ${task.executeTime}`
  if (task.scheduleType === 'weekly') return `${(task.weekDays ?? [Number(task.weekDay ?? 1)]).map((day) => weekDayNames[day]).join('、')} ${task.executeTime}`
  if (task.scheduleType === 'interval') {
    const { intervalValue, intervalUnit } = normalizeInterval(task)
    return `每隔 ${intervalValue} ${{ minute: '分钟', hour: '小时', day: '天' }[intervalUnit]}`
  }
  if (task.scheduleType === 'monthly') return `每月 ${task.monthDay} 号 ${task.executeTime}`
  return task.scheduleRule || task.cronExpression || '定时执行'
}

export function normalizeTaskInput(input, existing = {}) {
  const normalized = normalizeTaskSchedule(input, existing)
  return {
    intervalValue: undefined,
    intervalUnit: undefined,
    weekDays: undefined,
    ...normalized,
  }
}

function normalizeTaskSchedule(input, existing = {}) {
  const title = nonEmptyString(input?.title ?? existing.title, 'title').slice(0, 80)
  const instruction = nonEmptyString(input?.instruction ?? existing.instruction, 'instruction')
  const scheduleType = String(input?.scheduleType ?? existing.scheduleType ?? 'daily')
  const agentId = Object.prototype.hasOwnProperty.call(input || {}, 'agentId') ? (input.agentId || null) : (existing.agentId || null)
  const executionMode = normalizeExecutionMode(input?.executionMode ?? existing.executionMode)

  if (scheduleType === 'cron') {
    const cronExpression = String(input?.cronExpression ?? existing.cronExpression ?? '').trim()
    const unchangedCron = existing.scheduleType === 'cron' && cronExpression === existing.cronExpression
    if (!unchangedCron && !isValidCronExpression(cronExpression)) throw requestError('cronExpression is invalid')
    const nextRunAt = nextCronRun(cronExpression)?.toISOString()
    if (!nextRunAt) throw requestError('Unable to calculate next cron run')
    return {
      title,
      instruction,
      agentId,
      executionMode,
      scheduleType: 'cron',
      scheduleRule: String(input?.scheduleRule ?? (existing.scheduleType === 'cron' && existing.cronExpression === cronExpression ? existing.scheduleRule : undefined) ?? cronExpression).trim(),
      cronExpression,
      executeAt: undefined,
      executeTime: undefined,
      weekDay: undefined,
      monthDay: undefined,
      nextRunAt,
    }
  }

  if (!editableScheduleTypes.has(scheduleType)) throw requestError('scheduleType must be once, interval, daily, weekly, monthly, or cron')

  if (scheduleType === 'interval') {
    if (existing.scheduleType !== 'interval' && (input?.intervalValue === undefined || input?.intervalUnit === undefined || !input?.executeAt)) {
      throw requestError('intervalValue, intervalUnit, and executeAt are required for interval schedules')
    }
    const { intervalValue, intervalUnit } = normalizeInterval({ ...existing, ...input })
    const executeAt = parseDateTime(input?.executeAt ?? existing.executeAt ?? input?.nextRunAt ?? existing.nextRunAt, 'executeAt')
    const unchangedAnchor = existing.scheduleType === 'interval' && executeAt.toISOString() === (existing.executeAt ?? existing.nextRunAt)
    if (!unchangedAnchor && executeAt.getTime() <= Date.now()) throw requestError('executeAt must be in the future')
    const intervalTask = { intervalValue, intervalUnit, executeAt: executeAt.toISOString(), scheduleType }
    return {
      title, instruction, agentId, executionMode, ...intervalTask,
      scheduleRule: scheduleRuleFor(intervalTask),
      cronExpression: undefined, executeTime: undefined, weekDay: undefined, monthDay: undefined,
      nextRunAt: nextIntervalRun(intervalTask).toISOString(),
    }
  }

  if (scheduleType === 'once') {
    const executeAt = parseDateTime(input?.executeAt ?? input?.nextRunAt ?? existing.executeAt ?? existing.nextRunAt, 'executeAt')
    if (executeAt.getTime() <= Date.now()) throw requestError('executeAt must be in the future')
    return {
      title,
      instruction,
      agentId,
      executionMode,
      scheduleType,
      scheduleRule: `单次 ${formatLocalDateTime(executeAt)}`,
      cronExpression: undefined,
      executeAt: executeAt.toISOString(),
      executeTime: undefined,
      weekDay: undefined,
      monthDay: undefined,
      nextRunAt: executeAt.toISOString(),
    }
  }

  const executeTime = parseExecuteTime(input?.executeTime ?? existing.executeTime ?? timeFromDate(existing.nextRunAt) ?? '09:00')

  if (scheduleType === 'daily') {
    const nextRunAt = nextDailyRun(executeTime).toISOString()
    return {
      title,
      instruction,
      agentId,
      executionMode,
      scheduleType,
      scheduleRule: `每天 ${executeTime}`,
      cronExpression: undefined,
      executeAt: undefined,
      executeTime,
      weekDay: undefined,
      monthDay: undefined,
      nextRunAt,
    }
  }

  if (scheduleType === 'weekly') {
    const weekDays = normalizeWeekDays(input?.weekDays !== undefined ? input.weekDays : input?.weekDay !== undefined ? [Number(input.weekDay)] : existing.weekDays ?? [Number(existing.weekDay ?? 1)])
    const weekDay = weekDays[0]
    const nextRunAt = nextWeeklyDaysRun(weekDays, executeTime).toISOString()
    return {
      title,
      instruction,
      agentId,
      executionMode,
      scheduleType,
      scheduleRule: `${weekDays.map((day) => weekDayNames[day]).join('、')} ${executeTime}`,
      weekDays,
      cronExpression: undefined,
      executeAt: undefined,
      executeTime,
      weekDay,
      monthDay: undefined,
      nextRunAt,
    }
  }

  const monthDay = Number(input?.monthDay ?? existing.monthDay ?? 1)
  const nextRunAt = nextMonthlyRun(monthDay, executeTime).toISOString()
  return {
    title,
    instruction,
    agentId,
    executionMode,
    scheduleType,
    scheduleRule: `每月 ${monthDay} 号 ${executeTime}`,
    cronExpression: undefined,
    executeAt: undefined,
    executeTime,
    weekDay: undefined,
    monthDay,
    nextRunAt,
  }
}

export function calculateNextRun(task, base = new Date()) {
  if (task.cronExpression) {
    return nextCronRun(task.cronExpression, base)?.toISOString()
  }
  if (task.scheduleType === 'once') return undefined
  if (task.scheduleType === 'interval') return nextIntervalRun(task, base).toISOString()
  if (task.scheduleType === 'daily' && task.executeTime) return nextDailyRun(task.executeTime, base).toISOString()
  if (task.scheduleType === 'weekly' && task.executeTime) return nextWeeklyDaysRun(task.weekDays ?? [Number(task.weekDay ?? 1)], task.executeTime, base).toISOString()
  if (task.scheduleType === 'monthly' && task.executeTime) return nextMonthlyRun(task.monthDay ?? 1, task.executeTime, base).toISOString()

  const current = new Date(task.nextRunAt)
  if (task.scheduleType === 'daily') return new Date(current.getTime() + dayMs).toISOString()
  if (task.scheduleType === 'weekly') return new Date(current.getTime() + 7 * dayMs).toISOString()
  if (task.scheduleType === 'monthly') {
    current.setMonth(current.getMonth() + 1)
    return current.toISOString()
  }
  return undefined
}

export function isRecurringTask(task) {
  return Boolean(task.cronExpression) || !['once'].includes(task.scheduleType)
}

export function executionModeFor(task) {
  return task?.executionMode === 'parallel' ? 'parallel' : 'serial'
}

export function currentRunIdsFor(task) {
  const ids = []
  if (Array.isArray(task?.currentRunIds)) ids.push(...task.currentRunIds.filter(Boolean))
  if (task?.currentRunId) ids.push(task.currentRunId)
  return [...new Set(ids)]
}

export function appendCurrentRunId(task, runId) {
  return [...new Set([...currentRunIdsFor(task), runId])]
}

export function removeCurrentRunId(task, runId) {
  return currentRunIdsFor(task).filter((id) => id !== runId)
}

export function getTasks() {
  return readStore(STORE).then((data) => Object.values(data).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))))
}

export async function getTask(taskId) {
  return (await readStore(STORE))[taskId]
}

export async function createTaskRecord(task) {
  await atomicUpdate(STORE, (data) => {
    data[task.id] = task
    return data
  })
}

export async function removeTaskRecord(taskId) {
  await atomicUpdate(STORE, (data) => {
    delete data[taskId]
    return data
  })
}

export async function updateTask(taskId, updater) {
  let updated = null
  await atomicUpdate(STORE, (data) => {
    if (!data[taskId]) return data
    updated = updater(data[taskId])
    if (updated) {
      // Runs live in SQLite (`scheduled_task_runs`); the task record keeps
      // metadata only.
      const { runs: _runs, ...metadata } = updated
      updated = metadata
    }
    data[taskId] = updated
    return data
  })
  return updated
}

export async function hydrateTaskRuns(task, limit = 5) {
  if (!task) return task
  return { ...task, runs: await taskRunsService.recentRuns(task.id, limit) }
}

export async function hydrateTasksRuns(tasks, limit = 5) {
  return Promise.all(tasks.map((task) => hydrateTaskRuns(task, limit)))
}

export const taskRunsService = createScheduledTaskRunsService({
  readTasks: getTasks,
  logger,
})

export async function persistRun(taskId, run, stage) {
  if (!run?.id) return null
  try {
    return await taskRunsService.syncRun(taskId, run, { stage })
  } catch (error) {
    logger.warn('Scheduled task run persistence rejected', {
      taskId,
      runId: run.id,
      stage,
      errorName: error?.name || 'Error',
      errorCode: error?.code,
    })
    throw error
  }
}

export async function getTaskRuns(url) {
  const params = url.searchParams
  return taskRunsService.listRuns({
    page: params.get('page'),
    pageSize: params.get('pageSize'),
    taskId: params.get('taskId'),
    status: params.get('status'),
    trigger: params.get('trigger'),
    keyword: params.get('keyword'),
    startedFrom: params.get('startedFrom'),
    startedTo: params.get('startedTo'),
  })
}

function recurringTaskStatusRepair(task, now) {
  if (task?.status !== 'completed' || !isRecurringTask(task)) return null
  const nextRunAt = task.nextRunAt && new Date(task.nextRunAt).getTime() > now.getTime()
    ? task.nextRunAt
    : calculateNextRun(task, now)
  if (!nextRunAt) return null
  return {
    ...task,
    status: 'enabled',
    nextRunAt,
    scheduleRule: scheduleRuleFor({ ...task, nextRunAt }),
    updatedAt: now.toISOString(),
  }
}

export async function repairRecurringTaskStatuses() {
  const now = new Date()
  const snapshot = await readStore(STORE)
  if (!Object.values(snapshot).some((task) => recurringTaskStatusRepair(task, now))) return

  await atomicUpdate(STORE, (data) => {
    for (const [taskId, task] of Object.entries(data)) {
      const repaired = recurringTaskStatusRepair(task, now)
      if (repaired) data[taskId] = repaired
    }
    return data
  })
}
