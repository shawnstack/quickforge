import { streamSimple } from '@mariozechner/pi-ai'
import { readJsonBody, sendJson, decodeSegment } from '../utils/response.mjs'
import { readStore, atomicUpdate } from '../storage.mjs'
import { createAgent, getSessionEventBus, agentEvents, persistSessionState, abortRun } from '../agent-manager.mjs'
import { getActiveProject, readProjectConfig } from '../project-config.mjs'
import { logger } from '../utils/logger.mjs'

const STORE = 'scheduled-tasks'
const RUN_CHECK_INTERVAL_MS = 30 * 1000
const cronRegex = /^(\*|\d{1,2}|\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}|\*\/\d{1,2})(\s+(\*|\d{1,2}|\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}|\*\/\d{1,2})){4}$/
const minuteMs = 60 * 1000
const hourMs = 60 * minuteMs
const dayMs = 24 * hourMs
const editableScheduleTypes = new Set(['once', 'daily', 'weekly', 'monthly'])
const weekDayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

let schedulerTimer = null
let running = false
const runningTaskIds = new Set()

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatLocalDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function timeFromDate(value) {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return undefined
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
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

function parseExecuteTime(value) {
  const text = String(value ?? '').trim()
  const match = text.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) throw requestError('executeTime must use HH:mm format')
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw requestError('executeTime is out of range')
  }
  return `${pad(hours)}:${pad(minutes)}`
}

function dateWithTime(base, executeTime) {
  const [hours, minutes] = parseExecuteTime(executeTime).split(':').map(Number)
  const date = new Date(base)
  date.setHours(hours, minutes, 0, 0)
  return date
}

function parseDateTime(value, fieldName) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw requestError(`${fieldName} is invalid`)
  return date
}

function nextDailyRun(executeTime, base = new Date()) {
  const next = dateWithTime(base, executeTime)
  if (next.getTime() <= base.getTime()) next.setDate(next.getDate() + 1)
  return next
}

function nextWeeklyRun(weekDay, executeTime, base = new Date()) {
  const targetDay = Number(weekDay)
  if (!Number.isInteger(targetDay) || targetDay < 0 || targetDay > 6) {
    throw requestError('weekDay must be between 0 and 6')
  }
  const next = dateWithTime(base, executeTime)
  let daysToAdd = (targetDay - next.getDay() + 7) % 7
  if (daysToAdd === 0 && next.getTime() <= base.getTime()) daysToAdd = 7
  next.setDate(next.getDate() + daysToAdd)
  return next
}

function monthlyCandidate(year, month, monthDay, executeTime) {
  const targetDay = Number(monthDay)
  if (!Number.isInteger(targetDay) || targetDay < 1 || targetDay > 31) {
    throw requestError('monthDay must be between 1 and 31')
  }
  const [hours, minutes] = parseExecuteTime(executeTime).split(':').map(Number)
  const lastDay = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(targetDay, lastDay), hours, minutes, 0, 0)
}

function nextMonthlyRun(monthDay, executeTime, base = new Date()) {
  let next = monthlyCandidate(base.getFullYear(), base.getMonth(), monthDay, executeTime)
  if (next.getTime() <= base.getTime()) {
    next = monthlyCandidate(base.getFullYear(), base.getMonth() + 1, monthDay, executeTime)
  }
  return next
}

function scheduleRuleFor(task) {
  if (task.scheduleType === 'once') return `单次 ${formatLocalDateTime(new Date(task.executeAt ?? task.nextRunAt))}`
  if (task.scheduleType === 'daily') return `每天 ${task.executeTime}`
  if (task.scheduleType === 'weekly') return `每周${weekDayNames[Number(task.weekDay ?? 1)].replace('周', '')} ${task.executeTime}`
  if (task.scheduleType === 'monthly') return `每月 ${task.monthDay} 号 ${task.executeTime}`
  return task.scheduleRule || task.cronExpression || '定时执行'
}

function parseCronField(field, min, max) {
  if (field === '*') return { any: true, values: [] }
  const values = new Set()
  for (const part of field.split(',')) {
    if (/^\*\/\d+$/.test(part)) {
      const step = Number(part.slice(2))
      for (let value = min; value <= max; value += step) values.add(value)
    } else if (/^\d+-\d+$/.test(part)) {
      const [start, end] = part.split('-').map(Number)
      for (let value = Math.max(start, min); value <= Math.min(end, max); value += 1) values.add(value)
    } else if (/^\d+$/.test(part)) {
      const value = Number(part)
      if (value >= min && value <= max) values.add(value)
    }
  }
  return { any: false, values: [...values] }
}

function cronMatches(date, cronExpression) {
  const fields = String(cronExpression || '').trim().split(/\s+/)
  if (fields.length !== 5) return false
  const checks = [
    [date.getMinutes(), parseCronField(fields[0], 0, 59)],
    [date.getHours(), parseCronField(fields[1], 0, 23)],
    [date.getDate(), parseCronField(fields[2], 1, 31)],
    [date.getMonth() + 1, parseCronField(fields[3], 1, 12)],
    [date.getDay(), parseCronField(fields[4], 0, 6)],
  ]
  return checks.every(([value, rule]) => rule.any || rule.values.includes(value))
}

function nextCronRun(cronExpression, base = new Date()) {
  const cursor = new Date(base.getTime() + minuteMs)
  cursor.setSeconds(0, 0)
  const maxChecks = 366 * 24 * 60
  for (let index = 0; index < maxChecks; index += 1) {
    if (cronMatches(cursor, cronExpression)) return cursor
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return null
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

async function parseScheduledTaskInstructionWithAi(instruction, model, thinkingLevel = 'off') {
  const text = String(instruction || '').trim()
  if (!text) return { needMoreInfo: true, question: '请输入要创建的定时任务。' }
  if (!model) return { needMoreInfo: true, question: '请先选择用于解析任务的大模型。' }

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
    const stream = streamSimple(
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

  if (scheduleType === 'cron') {
    const cronExpression = String(input?.cronExpression ?? existing.cronExpression ?? '').trim()
    if (!cronRegex.test(cronExpression)) throw requestError('cronExpression is invalid')
    const nextRunAt = nextCronRun(cronExpression)?.toISOString()
    if (!nextRunAt) throw requestError('Unable to calculate next cron run')
    return {
      title,
      instruction,
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

async function getTasks() {
  const data = await readStore(STORE)
  return Object.values(data).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

async function updateTask(taskId, updater) {
  let updated = null
  await atomicUpdate(STORE, (data) => {
    if (!data[taskId]) return data
    updated = updater(data[taskId])
    data[taskId] = updated
    return data
  })
  return updated
}

async function repairRecurringTaskStatuses() {
  await atomicUpdate(STORE, (data) => {
    for (const [taskId, task] of Object.entries(data)) {
      if (task?.status !== 'expired' || !isRecurringTask(task)) continue
      const nextRunAt = task.nextRunAt && new Date(task.nextRunAt).getTime() > Date.now()
        ? task.nextRunAt
        : calculateNextRun(task)
      if (!nextRunAt) continue
      data[taskId] = {
        ...task,
        status: 'enabled',
        nextRunAt,
        scheduleRule: scheduleRuleFor({ ...task, nextRunAt }),
        updatedAt: new Date().toISOString(),
      }
    }
    return data
  })
}

async function executeTask(task, trigger = 'schedule', onStarted) {
  if (runningTaskIds.has(task.id)) return
  runningTaskIds.add(task.id)
  const runId = createId()
  const startedAt = new Date().toISOString()
  const scheduledAt = task.nextRunAt
  let sessionId = `scheduled-${task.id}-${Date.now().toString(36)}`

  await updateTask(task.id, (current) => ({
    ...current,
    status: 'running',
    currentRunId: runId,
    lastSessionId: sessionId,
    runs: [{
      id: runId,
      status: 'running',
      trigger,
      inputContent: current.instruction,
      sessionId,
      scheduledAt,
      startedAt,
    }, ...(current.runs || [])].slice(0, 20),
  }))

  let settled = false

  try {
    const config = await readProjectConfig()
    const selectedProject = task.projectId ? config.projects.find((project) => project.id === task.projectId) : null
    const activeProject = selectedProject ?? getActiveProject(config)
    const settings = await readStore('settings')
    const yoloMode = settings?.['yolo-mode'] === true || settings?.['yolo-mode'] === 'true'

    const session = await createAgent(sessionId, {
      scope: activeProject ? 'project' : 'global',
      projectId: activeProject?.id || null,
      yoloMode,
      model: task.model,
      thinkingLevel: task.thinkingLevel,
      title: `[定时任务] ${task.title}`,
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

    await updateTask(task.id, (current) => ({
      ...current,
      lastSessionId: sessionId,
      runs: (current.runs || []).map((run) => run.id === runId ? { ...run, sessionId } : run),
    }))
    onStarted?.({ taskId: task.id, runId, sessionId })

    const eventBus = getSessionEventBus(sessionId)
    const finished = new Promise((resolve) => {
      const cleanup = (handler, timeout) => {
        clearTimeout(timeout)
        eventBus?.removeListener('agent_event', handler)
      }
      const handler = (event) => {
        if (event.type !== 'agent_end') return
        cleanup(handler, timeout)
        const errorMessage = event.errorMessage || session.agent.state.errorMessage
        const aborted = session.status === 'aborted' || session.agent.state.messages.some((message) => message?.role === 'assistant' && message?.stopReason === 'aborted')
        resolve({
          ok: !errorMessage && !aborted,
          aborted,
          error: aborted ? '已暂停执行' : errorMessage,
          messages: event.messages ?? session.agent.state.messages,
        })
      }
      const timeout = setTimeout(() => {
        cleanup(handler, timeout)
        resolve({ ok: false, aborted: false, error: '执行超时', messages: session.agent.state.messages })
      }, 30 * 60 * 1000)
      eventBus?.on('agent_event', handler)
    })

    try {
      await session.agent.continue()
    } catch (continueError) {
      if (continueError?.message === 'Request was aborted' || continueError?.message === 'Scheduled task aborted') {
        settled = true
      } else {
        throw continueError
      }
    }
    const result = await finished
    if (result.aborted) settled = true
    const finishedAt = new Date().toISOString()
    const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
    const aiResult = result.ok ? latestAssistantText(result.messages) : ''
    const latestTask = (await readStore(STORE))[task.id] ?? task
    const recurring = isRecurringTask(latestTask)
    const nextRunAt = calculateNextRun(latestTask, new Date(finishedAt))
    const nextStatus = result.aborted
      ? (recurring && nextRunAt ? 'paused' : 'failed')
      : result.ok
        ? (nextRunAt ? 'enabled' : 'expired')
        : (recurring && nextRunAt ? 'enabled' : 'failed')

    await updateTask(task.id, (current) => ({
      ...current,
      status: nextStatus,
      currentRunId: null,
      lastRunAt: finishedAt,
      nextRunAt: nextRunAt ?? current.nextRunAt,
      lastSessionId: sessionId,
      runs: (current.runs || []).map((run) => run.id === runId ? {
        ...run,
        status: result.aborted ? 'failed' : (result.ok ? 'success' : 'failed'),
        inputContent: run.inputContent ?? latestTask.instruction,
        aiResult: result.ok ? aiResult : undefined,
        result: result.ok ? (aiResult || `已完成，结果保存在会话 ${sessionId}`) : undefined,
        errorMessage: result.aborted ? '已暂停执行' : result.error,
        sessionId,
        finishedAt,
        durationMs,
      } : run),
    }))

    emitScheduledTaskNotification({
      task: latestTask,
      runId,
      sessionId,
      status: result.aborted ? 'failed' : (result.ok ? 'success' : 'failed'),
      result: aiResult,
      errorMessage: result.aborted ? '已暂停执行' : result.error,
    })
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
    await updateTask(task.id, (current) => ({
      ...current,
      status: isRecurringTask(current) ? 'enabled' : 'failed',
      currentRunId: null,
      lastRunAt: finishedAt,
      lastSessionId: sessionId,
      nextRunAt: isRecurringTask(current) ? (calculateNextRun(current, new Date(finishedAt)) ?? current.nextRunAt) : current.nextRunAt,
      runs: (current.runs || []).map((run) => run.id === runId ? {
        ...run,
        status: 'failed',
        errorMessage: error?.message || String(error),
        sessionId,
        finishedAt,
        durationMs,
      } : run),
    }))
    emitScheduledTaskNotification({
      task,
      runId,
      sessionId,
      status: 'failed',
      result: '',
      errorMessage: error?.message || String(error),
    })
  } finally {
    runningTaskIds.delete(task.id)
    if (!settled) logger.warn(`Scheduled task ${task.id} finished without normal agent_end`)
  }
}

async function schedulerTick() {
  if (running) return
  running = true
  try {
    await repairRecurringTaskStatuses()
    const now = Date.now()
    const tasks = await getTasks()
    for (const task of tasks) {
      if (task.status !== 'enabled') continue
      if (!task.nextRunAt || new Date(task.nextRunAt).getTime() > now) continue
      executeTask(task, 'schedule').catch((error) => logger.error(`Scheduled task ${task.id} failed:`, error))
    }
  } finally {
    running = false
  }
}

export function startScheduledTaskRunner() {
  if (schedulerTimer) return
  schedulerTimer = setInterval(() => {
    schedulerTick().catch((error) => logger.error('Scheduled task tick failed:', error))
  }, RUN_CHECK_INTERVAL_MS)
  schedulerTick().catch((error) => logger.error('Scheduled task initial tick failed:', error))
}

export function stopScheduledTaskRunner() {
  if (!schedulerTimer) return
  clearInterval(schedulerTimer)
  schedulerTimer = null
}

export async function handleScheduledTasksApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean)

  if (req.method === 'POST' && url.pathname === '/api/scheduled-tasks/parse') {
    const body = await readJsonBody(req)
    sendJson(res, 200, await parseScheduledTaskInstructionWithAi(body?.instruction, body?.model, body?.thinkingLevel))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/scheduled-tasks') {
    sendJson(res, 200, { tasks: await getTasks() })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/scheduled-tasks') {
    const body = await readJsonBody(req)
    const parsed = body?.task
    if (!parsed) throw requestError('Missing task')
    const now = new Date().toISOString()
    const normalized = normalizeTaskInput(parsed)
    const enabled = parsed.enabled !== false && parsed.status !== 'paused'
    const task = {
      id: createId(),
      ...normalized,
      scheduleRule: normalized.scheduleRule || scheduleRuleFor(normalized),
      model: body?.model,
      thinkingLevel: body?.thinkingLevel || (body?.model?.reasoning ? 'medium' : 'off'),
      projectId: body?.projectId || null,
      projectName: body?.projectName || null,
      status: enabled ? 'enabled' : 'paused',
      createdAt: now,
      updatedAt: now,
      runs: [],
    }
    await atomicUpdate(STORE, (data) => {
      data[task.id] = task
      return data
    })
    sendJson(res, 200, { task })
    return
  }

  if (parts[0] === 'api' && parts[1] === 'scheduled-tasks' && parts[2]) {
    const taskId = decodeSegment(parts[2])
    const action = parts[3]

    if ((req.method === 'PUT' || req.method === 'PATCH') && !action) {
      const body = await readJsonBody(req)
      const existing = (await readStore(STORE))[taskId]
      if (!existing) throw requestError('Task not found', 404)
      if (existing.status === 'running') throw requestError('Cannot edit a running task', 409)
      const parsed = body?.task
      if (!parsed) throw requestError('Missing task')
      const normalized = normalizeTaskInput(parsed, existing)
      const now = new Date().toISOString()
      const hasProject = Object.prototype.hasOwnProperty.call(body, 'projectId')
      const task = await updateTask(taskId, (current) => ({
        ...current,
        ...normalized,
        scheduleRule: normalized.scheduleRule || scheduleRuleFor(normalized),
        model: body?.model ?? current.model,
        thinkingLevel: body?.thinkingLevel ?? current.thinkingLevel,
        projectId: hasProject ? (body.projectId || null) : current.projectId,
        projectName: hasProject ? (body.projectName || null) : current.projectName,
        status: parsed.enabled === false || parsed.status === 'paused' ? 'paused' : 'enabled',
        updatedAt: now,
      }))
      sendJson(res, 200, { task })
      return
    }

    if (req.method === 'DELETE' && !action) {
      await atomicUpdate(STORE, (data) => {
        delete data[taskId]
        return data
      })
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'POST' && action === 'pause') {
      const current = (await readStore(STORE))[taskId]
      if (!current) throw requestError('Task not found', 404)
      if (current.status === 'running') {
        const run = (current.runs || []).find((item) => item.id === current.currentRunId)
        const sessionIdToAbort = run?.sessionId || current.lastSessionId
        if (sessionIdToAbort) {
          try {
            await abortRun(sessionIdToAbort)
          } catch (error) {
            logger.warn(`Failed to abort scheduled task session ${sessionIdToAbort}:`, error?.message || error)
          }
        }
      }
      const task = await updateTask(taskId, (latest) => ({ ...latest, status: 'paused', updatedAt: new Date().toISOString() }))
      sendJson(res, 200, { task })
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
      sendJson(res, 200, { task })
      return
    }

    if (req.method === 'POST' && action === 'run') {
      const data = await readStore(STORE)
      const task = data[taskId]
      if (!task) throw requestError('Task not found', 404)
      await new Promise((resolve) => {
        executeTask(task, 'manual', resolve).catch((error) => {
          logger.error(`Manual scheduled task ${task.id} failed:`, error)
          resolve()
        })
      })
      const updatedTask = (await readStore(STORE))[taskId] ?? task
      sendJson(res, 200, { ok: true, task: updatedTask })
      return
    }
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}
