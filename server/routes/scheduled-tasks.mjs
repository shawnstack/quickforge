import { streamSimpleWithAiHttpLogging } from '../ai-http-logger.mjs'
import { DEFAULT_AI_MAX_RETRIES } from '../ai-provider-options.mjs'
import { readJsonBody, sendJson, decodeSegment } from '../utils/response.mjs'
import { readStore, atomicUpdate } from '../storage.mjs'
import { createAgent, getSessionEventBus, agentEvents, persistSessionState, abortRun } from '../agent-manager.mjs'
import { agentProfileSnapshot, getAgentProfile } from '../agent-profiles.mjs'
import { projectContextFromId, readProjectConfig } from '../project-config.mjs'
import { logger } from '../utils/logger.mjs'
import { resolveModelBinding } from '../model-catalog.mjs'
import { createScheduledTaskRunsService } from '../scheduled-task-runs-service.mjs'
import {
  assertScheduledRunsAvailable,
  canStartScheduledRun,
  configureScheduledRunsRuntimeHooks,
  isScheduledRunsAuthoritative,
  recordScheduledRunsDiagnostic,
} from '../scheduled-runs-cutover.mjs'
import {
  dayMs,
  formatLocalDateTime,
  hourMs,
  minuteMs,
  nextCronRun,
  nextDailyRun,
  nextMonthlyRun,
  nextWeeklyRun,
  normalizeExecutionMode,
  parseExecuteTime,
  timeFromDate,
} from '../utils/scheduled-tasks.mjs'

const STORE = 'scheduled-tasks'
const RUN_CHECK_INTERVAL_MS = 30 * 1000
const MAX_RUN_HISTORY_PER_TASK = 200
const cronRegex = /^(\*|\d{1,2}|\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}|\*\/\d{1,2})(\s+(\*|\d{1,2}|\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}|\*\/\d{1,2})){4}$/
const editableScheduleTypes = new Set(['once', 'daily', 'weekly', 'monthly'])
const weekDayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

let schedulerTimer = null
let runnerDesired = false
let running = false
let tickPromise = null
const runningTaskRunIds = new Map()

function executionModeFor(task) {
  return task?.executionMode === 'parallel' ? 'parallel' : 'serial'
}

function currentRunIdsFor(task) {
  const ids = []
  if (Array.isArray(task?.currentRunIds)) ids.push(...task.currentRunIds.filter(Boolean))
  if (task?.currentRunId) ids.push(task.currentRunId)
  return [...new Set(ids)]
}

function activeRunIdsFor(task) {
  const runningIds = [...(runningTaskRunIds.get(task?.id) || [])]
  return [...new Set([...runningIds, ...currentRunIdsFor(task)])]
}

function hasActiveTaskRuns(task) {
  return activeRunIdsFor(task).length > 0
}

function addActiveRun(taskId, runId) {
  const ids = runningTaskRunIds.get(taskId) || new Set()
  ids.add(runId)
  runningTaskRunIds.set(taskId, ids)
}

function removeActiveRun(taskId, runId) {
  const ids = runningTaskRunIds.get(taskId)
  if (!ids) return
  ids.delete(runId)
  if (ids.size === 0) runningTaskRunIds.delete(taskId)
}

function appendCurrentRunId(task, runId) {
  return [...new Set([...currentRunIdsFor(task), runId])]
}

function removeCurrentRunId(task, runId) {
  return currentRunIdsFor(task).filter((id) => id !== runId)
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function requestError(message, statusCode = 400) {
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

function scheduleRuleFor(task) {
  if (task.scheduleType === 'once') return `单次 ${formatLocalDateTime(new Date(task.executeAt ?? task.nextRunAt))}`
  if (task.scheduleType === 'daily') return `每天 ${task.executeTime}`
  if (task.scheduleType === 'weekly') return `每周${weekDayNames[Number(task.weekDay ?? 1)].replace('周', '')} ${task.executeTime}`
  if (task.scheduleType === 'monthly') return `每月 ${task.monthDay} 号 ${task.executeTime}`
  return task.scheduleRule || task.cronExpression || '定时执行'
}

function normalizeAiJson(text) {
  const raw = String(text || '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] ?? raw
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

function extractTitle(instruction) {
  return instruction
    .replace(/^(请|帮我|给我|麻烦)?/, '')
    .replace(/(每天|每日|明天|今天|每周[一二三四五六日天]?|每月\d{1,2}[号日]?|每隔\d+\s*(分钟|小时)).*?(提醒我|帮我|执行|运行|生成|检查)?/, '')
    .trim()
    .slice(0, 32) || 'AI 定时任务'
}

async function getApiKey(provider) {
  try {
    const keys = await readStore('provider-keys')
    return keys?.[provider] || undefined
  } catch {
    return undefined
  }
}

async function parseScheduledTaskInstructionWithAi(instruction, modelInput, thinkingLevel = 'off', context = {}) {
  const text = String(instruction || '').trim()
  if (!text) return { needMoreInfo: true, question: '请输入要创建的定时任务。' }
  if (!modelInput) return { needMoreInfo: true, question: '请先选择用于解析任务的大模型。' }
  const { model } = await resolveModelBinding(
    modelInput?.modelRef || modelInput?.model ? modelInput : { model: modelInput },
    { context, legacySnapshot: modelInput?.model || modelInput },
  )

  const now = new Date()
  const systemPrompt = `你是定时任务解析器。把用户的中文自然语言定时任务解析为 JSON。
只输出 JSON，不要 Markdown，不要解释。
字段：
- title: 简短任务名称
- instruction: 到时间后真正交给 AI 执行的指令，去掉时间规则，保留要做什么
- cronExpression: 5 位 cron，格式为 "分钟 小时 日 月 周"，周日用 0。不支持秒。
- scheduleRule: 给用户看的中文执行规则
- question: 如果时间或任务不明确，写一句追问
规则：
- 如果信息明确，question 为空字符串。
- 如果信息不明确，不要编造 cronExpression。
- 当前时间：${now.toISOString()}，本地时区：${Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'}。
示例输出：{"title":"生成日报","instruction":"生成销售日报","cronExpression":"0 9 * * *","scheduleRule":"每天 09:00","question":""}`

  try {
    const stream = streamSimpleWithAiHttpLogging(
      model,
      {
        systemPrompt,
        messages: [{ role: 'user', content: text, timestamp: Date.now() }],
        tools: [],
      },
      {
        apiKey: await getApiKey(model.provider),
        maxTokens: 600,
        temperature: 0,
        reasoning: thinkingLevel === 'off' ? undefined : thinkingLevel,
        maxRetries: DEFAULT_AI_MAX_RETRIES,
        maxRetryDelayMs: 60000,
      },
    )
    const message = await stream.result()
    const content = Array.isArray(message.content)
      ? message.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n')
      : ''
    const parsed = normalizeAiJson(content)
    if (!parsed) return { needMoreInfo: true, question: 'AI 没有返回有效 JSON，请重试或换一个模型。' }
    if (parsed.question) return { needMoreInfo: true, question: String(parsed.question) }
    if (!cronRegex.test(String(parsed.cronExpression || '').trim())) {
      return { needMoreInfo: true, question: 'AI 未能生成有效的 cron 表达式，请补充更明确的执行时间。' }
    }
    const nextRun = nextCronRun(String(parsed.cronExpression).trim())
    if (!nextRun) return { needMoreInfo: true, question: '无法计算下一次执行时间，请换一个时间规则。' }
    return {
      needMoreInfo: false,
      task: {
        title: String(parsed.title || extractTitle(text)).slice(0, 80),
        instruction: String(parsed.instruction || text).trim(),
        scheduleType: 'cron',
        scheduleRule: String(parsed.scheduleRule || parsed.cronExpression).trim(),
        cronExpression: String(parsed.cronExpression).trim(),
        nextRunAt: nextRun.toISOString(),
      },
    }
  } catch (error) {
    logger.warn('AI scheduled task parsing failed:', error?.message || error)
    return { needMoreInfo: true, question: `AI 解析失败：${error?.message || '请检查模型配置和 API Key 后重试。'}` }
  }
}

function normalizeTaskInput(input, existing = {}) {
  const title = nonEmptyString(input?.title ?? existing.title, 'title').slice(0, 80)
  const instruction = nonEmptyString(input?.instruction ?? existing.instruction, 'instruction')
  const scheduleType = String(input?.scheduleType ?? existing.scheduleType ?? 'daily')
  const agentId = Object.prototype.hasOwnProperty.call(input || {}, 'agentId') ? (input.agentId || null) : (existing.agentId || null)
  const executionMode = normalizeExecutionMode(input?.executionMode ?? existing.executionMode)

  if (scheduleType === 'cron') {
    const cronExpression = String(input?.cronExpression ?? existing.cronExpression ?? '').trim()
    if (!cronRegex.test(cronExpression)) throw requestError('cronExpression is invalid')
    const nextRunAt = nextCronRun(cronExpression)?.toISOString()
    if (!nextRunAt) throw requestError('Unable to calculate next cron run')
    return {
      title,
      instruction,
      agentId,
      executionMode,
      scheduleType: 'cron',
      scheduleRule: String(input?.scheduleRule ?? existing.scheduleRule ?? cronExpression).trim(),
      cronExpression,
      executeAt: undefined,
      executeTime: undefined,
      weekDay: undefined,
      monthDay: undefined,
      nextRunAt,
    }
  }

  if (!editableScheduleTypes.has(scheduleType)) throw requestError('scheduleType must be once, daily, weekly, or monthly')

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
    const weekDay = Number(input?.weekDay ?? existing.weekDay ?? 1)
    const nextRunAt = nextWeeklyRun(weekDay, executeTime).toISOString()
    return {
      title,
      instruction,
      agentId,
      executionMode,
      scheduleType,
      scheduleRule: `每${weekDayNames[weekDay]} ${executeTime}`,
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

function calculateNextRun(task, base = new Date()) {
  if (task.cronExpression) {
    return nextCronRun(task.cronExpression, base)?.toISOString()
  }
  if (task.scheduleType === 'once') return undefined
  if (task.scheduleType === 'interval') {
    const interval = task.scheduleRule.match(/每隔\s*(\d+)\s*(分钟|小时)/)
    const amount = Number(interval?.[1] ?? '30')
    const unit = interval?.[2] ?? '分钟'
    return new Date(base.getTime() + amount * (unit === '小时' ? hourMs : minuteMs)).toISOString()
  }
  if (task.scheduleType === 'daily' && task.executeTime) return nextDailyRun(task.executeTime, base).toISOString()
  if (task.scheduleType === 'weekly' && task.executeTime) return nextWeeklyRun(task.weekDay ?? 1, task.executeTime, base).toISOString()
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

function isRecurringTask(task) {
  return Boolean(task.cronExpression) || !['once'].includes(task.scheduleType)
}

function contentToText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
}

function latestAssistantText(messages) {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') {
      return contentToText(messages[index].content).trim()
    }
  }
  return ''
}

function truncateText(text, limit = 500) {
  const value = String(text || '').trim()
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}…`
}

function emitScheduledTaskNotification({ task, runId, sessionId, status, result, errorMessage }) {
  const ok = status === 'success'
  const message = ok ? truncateText(result || 'AI 已返回结果。', 500) : truncateText(errorMessage || '任务执行失败。', 500)
  agentEvents.emit('agent_event', {
    type: 'scheduled_task_notification',
    sessionId,
    taskId: task.id,
    runId,
    title: ok ? `定时任务「${task.title}」已完成` : `定时任务「${task.title}」执行失败`,
    status: ok ? 'idle' : 'error',
    taskStatus: status,
    message,
    result: ok ? result : undefined,
    errorMessage: ok ? undefined : errorMessage,
  })
}

function getTasks() {
  return readStore(STORE).then((data) => Object.values(data).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))))
}

async function hydrateTaskRuns(task, limit = 5) {
  if (!task || !isScheduledRunsAuthoritative()) return task
  return { ...task, runs: await taskRunsService.recentRuns(task.id, limit) }
}

async function hydrateTasksRuns(tasks, limit = 5) {
  if (!isScheduledRunsAuthoritative()) return tasks
  return Promise.all(tasks.map((task) => hydrateTaskRuns(task, limit)))
}

const taskRunsService = createScheduledTaskRunsService({
  readTasks: getTasks,
  logger,
})

function authoritativeRun(task, runId) {
  return task?.runs?.find((run) => run.id === runId) || null
}

async function persistRun(taskId, run, phase) {
  if (!run?.id) return null
  try {
    return await taskRunsService.syncRun(taskId, run, { phase })
  } catch (error) {
    logger.warn('Scheduled task run persistence rejected', {
      taskId,
      runId: run.id,
      phase,
      errorName: error?.name || 'Error',
      errorCode: error?.code,
    })
    throw error
  }
}

async function syncAuthoritativeRun(task, runId, phase) {
  const run = authoritativeRun(task, runId)
  if (!run) return null
  try {
    return await persistRun(task.id, run, phase)
  } catch (error) {
    if (isScheduledRunsAuthoritative()) throw error
    return null
  }
}

async function deleteAuthoritativeTaskRuns(taskId) {
  try {
    return await taskRunsService.deleteTaskRuns(taskId)
  } catch (error) {
    if (isScheduledRunsAuthoritative()) throw error
    return false
  }
}

async function getTaskRuns(url) {
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

async function updateTask(taskId, updater) {
  let updated = null
  try {
    await atomicUpdate(STORE, (data) => {
      if (!data[taskId]) return data
      updated = updater(data[taskId])
      if (isScheduledRunsAuthoritative() && updated) {
        const { runs: _runs, ...metadata } = updated
        updated = metadata
      }
      data[taskId] = updated
      return data
    })
  } catch (error) {
    if (isScheduledRunsAuthoritative()) {
      try { recordScheduledRunsDiagnostic('task_metadata_update', error, { taskId }) } catch { /* Preserve metadata failure. */ }
    }
    throw error
  }
  return updated
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

async function repairRecurringTaskStatuses() {
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

async function resolveExecutionProject(task) {
  if (!task.projectId) return null
  const config = await readProjectConfig()
  const selectedProject = config.projects.find((project) => project.id === task.projectId)
  if (!selectedProject) throw requestError(`绑定项目不存在或已被删除：${task.projectName || task.projectId}`, 409)

  await projectContextFromId(selectedProject.id)
  return selectedProject
}

async function executeTask(task, trigger = 'schedule', onStarted) {
  const mode = executionModeFor(task)
  const advanceNextRunAtAtStart = trigger === 'schedule' && mode === 'parallel'
  if (mode === 'serial' && hasActiveTaskRuns(task)) return
  const runId = createId()
  addActiveRun(task.id, runId)
  const startedAt = new Date().toISOString()
  const scheduledAt = task.nextRunAt
  let sessionId = `scheduled-${task.id}-${Date.now().toString(36)}`
  let executionAgent = null
  let agentWarning = null
  let agentSnapshot = null

  const createdRun = {
    id: runId,
    status: 'running',
    trigger,
    inputContent: task.instruction,
    sessionId,
    agentId: executionAgent?.id || task.agentId || null,
    agentLabel: executionAgent?.label || null,
    agentSnapshot,
    warning: agentWarning || undefined,
    scheduledAt,
    startedAt,
  }
  let currentRun = createdRun
  let started = false
  let createdTask
  if (isScheduledRunsAuthoritative()) {
    await persistRun(task.id, createdRun, 'created')
    try {
      createdTask = await updateTask(task.id, (current) => {
        const otherRunIds = activeRunIdsFor(current).filter((id) => id !== runId)
        if (mode === 'serial' && otherRunIds.length > 0) return current
        started = true
        const nextRunAt = advanceNextRunAtAtStart
          ? calculateNextRun(current, new Date(startedAt))
          : current.nextRunAt
        const activeRunIds = appendCurrentRunId(current, runId)
        return {
          ...current,
          currentRunId: activeRunIds[activeRunIds.length - 1] || null,
          currentRunIds: activeRunIds,
          lastSessionId: sessionId,
          nextRunAt,
        }
      })
    } catch (error) {
      try {
        await taskRunsService.deleteRun(task.id, runId)
      } catch (compensationError) {
        throw new Error(`Scheduled run create metadata failed and SQLite compensation failed: ${compensationError?.message || compensationError}`, { cause: compensationError })
      } finally {
        removeActiveRun(task.id, runId)
      }
      throw error
    }
    if (!started) await taskRunsService.deleteRun(task.id, runId)
  } else {
    createdTask = await updateTask(task.id, (current) => {
      const otherRunIds = activeRunIdsFor(current).filter((id) => id !== runId)
      if (mode === 'serial' && otherRunIds.length > 0) return current
      started = true
      const nextRunAt = advanceNextRunAtAtStart
        ? calculateNextRun(current, new Date(startedAt))
        : current.nextRunAt
      const activeRunIds = appendCurrentRunId(current, runId)
      return {
        ...current,
        currentRunId: activeRunIds[activeRunIds.length - 1] || null,
        currentRunIds: activeRunIds,
        lastSessionId: sessionId,
        nextRunAt,
        runs: [createdRun, ...(current.runs || [])].slice(0, MAX_RUN_HISTORY_PER_TASK),
      }
    })
  }
  if (!started) {
    removeActiveRun(task.id, runId)
    return
  }
  if (!isScheduledRunsAuthoritative()) await syncAuthoritativeRun(createdTask, runId, 'created')

  let settled = false

  try {
    const executionProject = await resolveExecutionProject(task)
    const binding = task.modelRef || task.model
      ? await resolveModelBinding(
          task.modelRef ? { modelRef: task.modelRef } : { model: task.model },
          {
            context: { source: 'scheduled', allowCloud: true },
            currentModel: task.model,
            allowCurrentHidden: true,
            forExecution: true,
            legacySnapshot: task.model,
          },
        )
      : null
    if (task.agentId) {
      executionAgent = await getAgentProfile(task.agentId, { projectId: executionProject?.id || null, workspaceRoot: executionProject?.path })
      if (!executionAgent) agentWarning = `Configured agent not found: ${task.agentId}`
    }
    agentSnapshot = executionAgent ? agentProfileSnapshot(executionAgent) : null
    const settings = await readStore('settings')
    const yoloMode = settings?.['yolo-mode'] === true || settings?.['yolo-mode'] === 'true'

    const session = await createAgent(sessionId, {
      scope: executionProject ? 'project' : 'global',
      projectId: executionProject?.id || null,
      yoloMode,
      model: binding?.model || task.model,
      modelRef: binding?.modelRef || task.modelRef || null,
      modelAccessContext: { source: 'scheduled', allowCloud: true },
      thinkingLevel: task.thinkingLevel,
      title: `[定时任务] ${task.title}`,
      agentProfile: executionAgent,
    })

    const userMessage = {
      role: 'user',
      content: [{ type: 'text', text: task.instruction }],
      timestamp: Date.now(),
    }
    session.agent.state.messages = [...session.agent.state.messages, userMessage]
    session.status = 'running'
    session.startedAt = startedAt
    session.finishedAt = null
    await persistSessionState(session)
    agentEvents.emit('agent_event', {
      sessionId,
      type: 'scheduled_task_started',
      taskId: task.id,
      runId,
      title: `[定时任务] ${task.title}`,
      scope: session.scope,
      projectId: session.projectId,
      createdAt: session.createdAt,
      message: truncateText(task.instruction, 500),
    })

    currentRun = {
      ...currentRun,
      sessionId,
      agentId: executionAgent?.id || task.agentId || null,
      agentLabel: executionAgent?.label || null,
      agentSnapshot,
      warning: agentWarning || currentRun.warning,
    }
    const resolvedTask = await updateTask(task.id, (current) => ({
      ...current,
      lastSessionId: sessionId,
      ...(!isScheduledRunsAuthoritative() ? {
        runs: (current.runs || []).map((run) => run.id === runId ? { ...run, ...currentRun } : run),
      } : {}),
    }))
    if (isScheduledRunsAuthoritative()) await persistRun(task.id, currentRun, 'resolved')
    else await syncAuthoritativeRun(resolvedTask, runId, 'resolved')
    onStarted?.({ taskId: task.id, runId, sessionId })

    const eventBus = getSessionEventBus(sessionId)
    const runtimeLimitMs = Math.max(1000, Math.min(Number(executionAgent?.maxRuntimeMs || 60 * 60 * 1000), 60 * 60 * 1000))
    let timeout = null
    let handler = null
    let timedOut = false
    let resolveFinished
    const finished = new Promise((resolve) => {
      resolveFinished = resolve
      handler = (event) => {
        if (event.type !== 'agent_end') return
        const errorMessage = event.errorMessage || session.agent.state.errorMessage
        const aborted = session.status === 'aborted' || session.agent.state.messages.some((message) => message?.role === 'assistant' && message?.stopReason === 'aborted')
        resolve({
          ok: !errorMessage && !aborted,
          aborted,
          error: aborted ? '已暂停执行' : errorMessage,
          messages: event.messages ?? session.agent.state.messages,
        })
      }
      eventBus?.on('agent_event', handler)
    })

    const runPromise = (async () => {
      try {
        await session.agent.continue()
      } catch (continueError) {
        if (continueError?.message !== 'Request was aborted' && continueError?.message !== 'Scheduled task aborted') {
          throw continueError
        }
      }
      return finished
    })()
    const timeoutPromise = new Promise((resolve) => {
      timeout = setTimeout(() => resolve({ timedOut: true }), runtimeLimitMs)
    })

    let result
    try {
      const outcome = await Promise.race([
        runPromise.then((value) => ({ result: value })),
        timeoutPromise,
      ])
      if (outcome.timedOut) {
        timedOut = true
        const abortPromise = Promise.resolve()
          .then(() => abortRun(sessionId))
          .catch((error) => {
            logger.warn(`Failed to abort timed out scheduled task ${task.id}:`, error)
          })
        await Promise.race([
          abortPromise,
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ])
        await Promise.race([
          runPromise.catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ])
        result = { ok: false, aborted: true, error: '执行超时', messages: session.agent.state.messages }
      } else {
        result = outcome.result
      }
    } finally {
      clearTimeout(timeout)
      eventBus?.removeListener('agent_event', handler)
      if (timedOut) resolveFinished?.({ ok: false, aborted: true, error: '执行超时', messages: session.agent.state.messages })
    }
    settled = true
    const finishedAt = new Date().toISOString()
    const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
    const aiResult = result.ok ? latestAssistantText(result.messages) : ''
    const latestTask = (await readStore(STORE))[task.id] ?? task
    const recurring = isRecurringTask(latestTask)
    removeActiveRun(task.id, runId)
    const remainingRunIds = removeCurrentRunId(latestTask, runId)
    const stillRunning = remainingRunIds.length > 0
    const nextRunAt = stillRunning ? latestTask.nextRunAt : (advanceNextRunAtAtStart ? latestTask.nextRunAt : calculateNextRun(latestTask, new Date(finishedAt)))
    const nextStatus = stillRunning
      ? latestTask.status
      : latestTask.status === 'paused'
        ? 'paused'
        : result.aborted
          ? (recurring && nextRunAt ? 'paused' : 'failed')
          : result.ok
            ? (nextRunAt ? 'enabled' : 'completed')
            : (recurring && nextRunAt ? 'enabled' : 'failed')

    const terminalRun = {
      ...currentRun,
      status: result.aborted ? 'failed' : (result.ok ? 'success' : 'failed'),
      inputContent: currentRun.inputContent ?? latestTask.instruction,
      aiResult: result.ok ? aiResult : undefined,
      result: result.ok ? (aiResult || `已完成，结果保存在会话 ${sessionId}`) : undefined,
      errorMessage: result.error,
      sessionId,
      agentId: executionAgent?.id || latestTask.agentId || null,
      agentLabel: executionAgent?.label || null,
      agentSnapshot,
      warning: agentWarning || currentRun.warning,
      finishedAt,
      durationMs,
    }
    let terminalPersisted = false
    if (isScheduledRunsAuthoritative()) {
      await persistRun(task.id, terminalRun, 'terminal')
      terminalPersisted = true
    }
    let terminalMetadataError = null
    let terminalTask
    try {
      terminalTask = await updateTask(task.id, (current) => ({
        ...current,
        status: nextStatus,
        currentRunId: stillRunning ? remainingRunIds[remainingRunIds.length - 1] : null,
        currentRunIds: remainingRunIds,
        lastRunAt: finishedAt,
        nextRunAt: nextRunAt ?? current.nextRunAt,
        lastSessionId: sessionId,
        ...(!isScheduledRunsAuthoritative() ? {
          runs: (current.runs || []).map((run) => run.id === runId ? terminalRun : run),
        } : {}),
      }))
    } catch (error) {
      if (!terminalPersisted) throw error
      terminalMetadataError = error
      try { recordScheduledRunsDiagnostic('terminal_metadata', error, { taskId: task.id, runId }) } catch { /* Preserve terminal success. */ }
      logger.warn('Scheduled task terminal metadata persistence failed', { taskId: task.id, runId, errorName: error?.name || 'Error' })
    }
    if (!isScheduledRunsAuthoritative()) await syncAuthoritativeRun(terminalTask, runId, 'terminal')
    if (terminalMetadataError) settled = true

    emitScheduledTaskNotification({
      task: latestTask,
      runId,
      sessionId,
      status: result.aborted ? 'failed' : (result.ok ? 'success' : 'failed'),
      result: aiResult,
      errorMessage: result.error,
    })
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
    removeActiveRun(task.id, runId)
    const failureMessage = error?.message || String(error)
    const failedRun = {
      ...currentRun,
      status: 'failed',
      errorMessage: failureMessage,
      sessionId,
      agentId: executionAgent?.id || task.agentId || null,
      agentLabel: executionAgent?.label || null,
      agentSnapshot,
      warning: agentWarning || currentRun.warning,
      finishedAt,
      durationMs,
    }
    let persistenceError = null
    if (isScheduledRunsAuthoritative()) {
      try {
        await persistRun(task.id, failedRun, 'exception-terminal')
      } catch (terminalError) {
        persistenceError = terminalError
      }
    }
    if (persistenceError) {
      try { recordScheduledRunsDiagnostic('exception_terminal', persistenceError, { taskId: task.id, runId }) } catch { /* Preserve the original failure. */ }
      logger.error('Scheduled task terminal SQLite persistence failed', { taskId: task.id, runId, errorName: persistenceError?.name || 'Error' })
      return
    }
    const failedTask = await updateTask(task.id, (current) => {
      const remainingRunIds = removeCurrentRunId(current, runId)
      const stillRunning = remainingRunIds.length > 0
      return {
        ...current,
        status: stillRunning ? current.status : (current.status === 'paused' ? 'paused' : (isRecurringTask(current) ? 'enabled' : 'failed')),
        currentRunId: stillRunning ? remainingRunIds[remainingRunIds.length - 1] : null,
        currentRunIds: remainingRunIds,
        lastRunAt: finishedAt,
        lastSessionId: sessionId,
        nextRunAt: stillRunning || advanceNextRunAtAtStart ? current.nextRunAt : (isRecurringTask(current) ? (calculateNextRun(current, new Date(finishedAt)) ?? current.nextRunAt) : current.nextRunAt),
        ...(!isScheduledRunsAuthoritative() ? {
          runs: (current.runs || []).map((run) => run.id === runId ? { ...run, ...failedRun } : run),
        } : {}),
      }
    })
    if (!isScheduledRunsAuthoritative()) await syncAuthoritativeRun(failedTask, runId, 'exception-terminal')
    emitScheduledTaskNotification({
      task,
      runId,
      sessionId,
      status: 'failed',
      result: '',
      errorMessage: error?.message || String(error),
    })
  } finally {
    if (!settled) logger.warn(`Scheduled task ${task.id} finished without normal agent_end`)
  }
}

export async function recoverStaleScheduledTaskRuns({ now = () => new Date() } = {}) {
  const tasks = await getTasks()
  const finishedAt = now().toISOString()
  for (const task of tasks) {
    const activeIds = currentRunIdsFor(task)
    const sqliteRunning = isScheduledRunsAuthoritative()
      ? (await taskRunsService.listRuns({ taskId: task.id, status: 'running', page: 1, pageSize: MAX_RUN_HISTORY_PER_TASK })).runs
      : []
    const jsonRunning = Array.isArray(task.runs) ? task.runs.filter((run) => run?.status === 'running') : []
    const runningById = new Map([...sqliteRunning, ...jsonRunning].map((run) => [run.id, run]))
    for (const runId of activeIds) {
      if (!runningById.has(runId)) runningById.set(runId, { id: runId, status: 'running', trigger: 'schedule', startedAt: task.lastRunAt || task.updatedAt || finishedAt })
    }
    if (runningById.size === 0 && activeIds.length === 0) continue
    const failedRuns = []
    for (const run of runningById.values()) {
      const startedMs = new Date(run.startedAt).getTime()
      const durationMs = Number.isFinite(startedMs) ? Math.max(0, new Date(finishedAt).getTime() - startedMs) : 0
      const failed = { ...run, status: 'failed', errorMessage: 'Interrupted by previous process shutdown', finishedAt, durationMs }
      failedRuns.push(failed)
      if (isScheduledRunsAuthoritative()) await persistRun(task.id, failed, 'startup-recovery')
    }
    await updateTask(task.id, (current) => ({
      ...current,
      currentRunId: null,
      currentRunIds: [],
      status: current.status === 'paused' ? 'paused' : (isRecurringTask(current) ? 'enabled' : 'failed'),
      lastRunAt: finishedAt,
      nextRunAt: isRecurringTask(current) ? (calculateNextRun(current, new Date(finishedAt)) ?? current.nextRunAt) : current.nextRunAt,
      ...(!isScheduledRunsAuthoritative() ? {
        runs: (current.runs || []).map((run) => failedRuns.find((failed) => failed.id === run.id) || run),
      } : {}),
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
  if (runningTaskRunIds.size > 0 || tasks.some(hasActiveTaskRuns)) {
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

export async function handleScheduledTasksApi(req, res, url, context = {}) {
  const parts = url.pathname.split('/').filter(Boolean)
  assertScheduledRunsAvailable()

  if (req.method === 'POST' && url.pathname === '/api/scheduled-tasks/parse') {
    const body = await readJsonBody(req)
    sendJson(res, 200, await parseScheduledTaskInstructionWithAi(body?.instruction, body?.modelRef ? body : body?.model, body?.thinkingLevel, context))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/scheduled-tasks') {
    sendJson(res, 200, { tasks: await hydrateTasksRuns(await getTasks()) })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/scheduled-tasks/runs') {
    sendJson(res, 200, await getTaskRuns(url))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/scheduled-tasks') {
    const body = await readJsonBody(req)
    const parsed = body?.task
    if (!parsed) throw requestError('Missing task')
    const now = new Date().toISOString()
    const normalized = normalizeTaskInput(parsed)
    const enabled = parsed.enabled !== false && parsed.status !== 'paused'
    const binding = await resolveModelBinding(body, { context, legacySnapshot: body?.model })
    const task = {
      id: createId(),
      ...normalized,
      scheduleRule: normalized.scheduleRule || scheduleRuleFor(normalized),
      executionMode: normalized.executionMode || 'serial',
      model: binding.model,
      modelRef: binding.modelRef,
      thinkingLevel: body?.thinkingLevel || (body?.model?.reasoning ? 'medium' : 'off'),
      projectId: body?.projectId || null,
      projectName: body?.projectName || null,
      status: enabled ? 'enabled' : 'paused',
      createdAt: now,
      updatedAt: now,
      ...(isScheduledRunsAuthoritative() ? {} : { runs: [] }),
    }
    await atomicUpdate(STORE, (data) => {
      data[task.id] = task
      return data
    })
    sendJson(res, 200, { task: await hydrateTaskRuns(task) })
    return
  }

  if (parts[0] === 'api' && parts[1] === 'scheduled-tasks' && parts[2]) {
    const taskId = decodeSegment(parts[2])
    const action = parts[3]

    if ((req.method === 'PUT' || req.method === 'PATCH') && !action) {
      const body = await readJsonBody(req)
      const existing = (await readStore(STORE))[taskId]
      if (!existing) throw requestError('Task not found', 404)
      if (existing.currentRunId) throw requestError('Cannot edit a running task', 409)
      const parsed = body?.task
      if (!parsed) throw requestError('Missing task')
      const normalized = normalizeTaskInput(parsed, existing)
      const binding = body?.modelRef || body?.model
        ? await resolveModelBinding(body, {
            context,
            currentModel: existing.model,
            allowCurrentHidden: true,
            legacySnapshot: body?.model,
          })
        : null
      const now = new Date().toISOString()
      const hasProject = Object.prototype.hasOwnProperty.call(body, 'projectId')
      const task = await updateTask(taskId, (current) => ({
        ...current,
        ...normalized,
        scheduleRule: normalized.scheduleRule || scheduleRuleFor(normalized),
        executionMode: normalized.executionMode || 'serial',
        model: binding?.model ?? current.model,
        modelRef: binding?.modelRef ?? current.modelRef,
        thinkingLevel: body?.thinkingLevel ?? current.thinkingLevel,
        projectId: hasProject ? (body.projectId || null) : current.projectId,
        projectName: hasProject ? (body.projectName || null) : current.projectName,
        status: parsed.enabled === false || parsed.status === 'paused' ? 'paused' : 'enabled',
        updatedAt: now,
      }))
      sendJson(res, 200, { task: await hydrateTaskRuns(task) })
      return
    }

    if (req.method === 'DELETE' && !action) {
      const existingForDelete = (await readStore(STORE))[taskId]
      const before = existingForDelete ? await hydrateTaskRuns(existingForDelete, MAX_RUN_HISTORY_PER_TASK) : null
      if (isScheduledRunsAuthoritative()) {
        await deleteAuthoritativeTaskRuns(taskId)
        try {
          await atomicUpdate(STORE, (data) => {
            delete data[taskId]
            return data
          })
        } catch (error) {
          if (before) {
            const restoredRuns = Array.isArray(before.runs) ? before.runs : []
            for (const run of restoredRuns) await persistRun(taskId, run, 'delete-compensation')
          }
          throw error
        }
      } else {
        await atomicUpdate(STORE, (data) => {
          delete data[taskId]
          return data
        })
        await deleteAuthoritativeTaskRuns(taskId)
      }
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'POST' && action === 'pause') {
      const current = (await readStore(STORE))[taskId]
      if (!current) throw requestError('Task not found', 404)
      const task = await updateTask(taskId, (latest) => ({ ...latest, status: 'paused', updatedAt: new Date().toISOString() }))
      sendJson(res, 200, { task: await hydrateTaskRuns(task) })
      return
    }

    if (req.method === 'POST' && action === 'resume') {
      const task = await updateTask(taskId, (current) => ({
        ...current,
        status: 'enabled',
        nextRunAt: current.nextRunAt && new Date(current.nextRunAt).getTime() > Date.now()
          ? current.nextRunAt
          : (calculateNextRun(current) ?? current.nextRunAt),
        updatedAt: new Date().toISOString(),
      }))
      if (!task) throw requestError('Task not found', 404)
      sendJson(res, 200, { task: await hydrateTaskRuns(task) })
      return
    }

    if (req.method === 'POST' && action === 'run') {
      const data = await readStore(STORE)
      const task = data[taskId]
      if (!task) throw requestError('Task not found', 404)
      if (executionModeFor(task) === 'serial' && hasActiveTaskRuns(task)) throw requestError('Task is already running', 409)
      await new Promise((resolve, reject) => {
        executeTask(task, 'manual', resolve).catch((error) => {
          logger.error(`Manual scheduled task ${task.id} failed:`, error)
          if (isScheduledRunsAuthoritative()) reject(error)
          else resolve()
        })
      })
      const updatedTask = (await readStore(STORE))[taskId] ?? task
      sendJson(res, 200, { ok: true, task: await hydrateTaskRuns(updatedTask) })
      return
    }
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}
