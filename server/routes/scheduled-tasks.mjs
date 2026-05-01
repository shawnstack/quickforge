import { streamSimple } from '@mariozechner/pi-ai'
import { readJsonBody, sendJson, decodeSegment } from '../utils/response.mjs'
import { readStore, atomicUpdate } from '../storage.mjs'
import { createAgent, runPrompt, getSessionEventBus } from '../agent-manager.mjs'
import { getActiveProject, readProjectConfig } from '../project-config.mjs'
import { logger } from '../utils/logger.mjs'

const STORE = 'scheduled-tasks'
const RUN_CHECK_INTERVAL_MS = 30 * 1000
const cronRegex = /^(\*|\d{1,2}|\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}|\*\/\d{1,2})(\s+(\*|\d{1,2}|\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}|\*\/\d{1,2})){4}$/
const minuteMs = 60 * 1000
const hourMs = 60 * minuteMs
const dayMs = 24 * hourMs

let schedulerTimer = null
let running = false
const runningTaskIds = new Set()

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function parseTime(text) {
  const explicit = text.match(/(\d{1,2})[:：点时](?:\s*(\d{1,2})分?)?/)
  if (explicit) {
    return {
      hour: Math.min(Number(explicit[1]), 23),
      minute: Math.min(Number(explicit[2] ?? '0'), 59),
    }
  }
  if (/早上|上午/.test(text)) return { hour: 9, minute: 0 }
  if (/中午/.test(text)) return { hour: 12, minute: 0 }
  if (/下午/.test(text)) return { hour: 15, minute: 0 }
  if (/晚上|夜里/.test(text)) return { hour: 20, minute: 0 }
  return { hour: 9, minute: 0 }
}

function nextAt(hour, minute, base = new Date()) {
  const next = new Date(base)
  next.setSeconds(0, 0)
  next.setHours(hour, minute, 0, 0)
  if (next.getTime() <= base.getTime()) next.setDate(next.getDate() + 1)
  return next
}

function nextWeekdayAt(weekday, hour, minute) {
  const next = nextAt(hour, minute)
  const diff = (weekday - next.getDay() + 7) % 7
  next.setDate(next.getDate() + diff)
  return next
}

function nextMonthDayAt(day, hour, minute) {
  const now = new Date()
  const next = new Date(now)
  next.setSeconds(0, 0)
  next.setHours(hour, minute, 0, 0)
  next.setDate(Math.min(day, 28))
  if (next.getTime() <= now.getTime()) next.setMonth(next.getMonth() + 1)
  return next
}

function extractTitle(instruction) {
  return instruction
    .replace(/^(请|帮我|给我|麻烦)?/, '')
    .replace(/(每天|每日|明天|今天|每周[一二三四五六日天]?|每月\d{1,2}[号日]?|每隔\d+\s*(分钟|小时)).*?(提醒我|帮我|执行|运行|生成|检查)?/, '')
    .trim()
    .slice(0, 32) || 'AI 定时任务'
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

export function parseScheduledTaskInstruction(instruction) {
  const text = String(instruction || '').trim()
  if (!text) return { needMoreInfo: true, question: '请输入要创建的定时任务，例如：每天早上 9 点帮我生成日报。' }

  const { hour, minute } = parseTime(text)
  const title = extractTitle(text)

  const interval = text.match(/每隔\s*(\d+)\s*(分钟|小时)/)
  if (interval) {
    const amount = Number(interval[1])
    const unit = interval[2]
    return {
      needMoreInfo: false,
      task: {
        title,
        instruction: text,
        scheduleType: 'interval',
        scheduleRule: `每隔 ${amount} ${unit}`,
        nextRunAt: new Date(Date.now() + amount * (unit === '小时' ? hourMs : minuteMs)).toISOString(),
      },
    }
  }

  if (/每周/.test(text)) {
    const weekdays = ['日', '一', '二', '三', '四', '五', '六']
    const matched = text.match(/每周([一二三四五六日天])?/)
    if (!matched?.[1]) return { needMoreInfo: true, question: '你希望每周几执行？例如：每周一上午 10 点生成周报。' }
    const weekday = matched[1] === '天' ? 0 : weekdays.indexOf(matched[1])
    return {
      needMoreInfo: false,
      task: {
        title,
        instruction: text,
        scheduleType: 'weekly',
        scheduleRule: `每周${matched[1]} ${pad(hour)}:${pad(minute)}`,
        nextRunAt: nextWeekdayAt(weekday, hour, minute).toISOString(),
      },
    }
  }

  const month = text.match(/每月\s*(\d{1,2})\s*[号日]/)
  if (month) {
    const day = Math.min(Math.max(Number(month[1]), 1), 28)
    return {
      needMoreInfo: false,
      task: {
        title,
        instruction: text,
        scheduleType: 'monthly',
        scheduleRule: `每月 ${day} 号 ${pad(hour)}:${pad(minute)}`,
        nextRunAt: nextMonthDayAt(day, hour, minute).toISOString(),
      },
    }
  }

  if (/每天|每日/.test(text)) {
    return {
      needMoreInfo: false,
      task: {
        title,
        instruction: text,
        scheduleType: 'daily',
        scheduleRule: `每天 ${pad(hour)}:${pad(minute)}`,
        nextRunAt: nextAt(hour, minute).toISOString(),
      },
    }
  }

  if (/明天/.test(text)) {
    const next = new Date()
    next.setDate(next.getDate() + 1)
    next.setHours(hour, minute, 0, 0)
    return {
      needMoreInfo: false,
      task: {
        title,
        instruction: text,
        scheduleType: 'once',
        scheduleRule: `一次性：明天 ${pad(hour)}:${pad(minute)}`,
        nextRunAt: next.toISOString(),
      },
    }
  }

  if (/今天/.test(text)) {
    return {
      needMoreInfo: false,
      task: {
        title,
        instruction: text,
        scheduleType: 'once',
        scheduleRule: `一次性：今天 ${pad(hour)}:${pad(minute)}`,
        nextRunAt: nextAt(hour, minute).toISOString(),
      },
    }
  }

  return { needMoreInfo: true, question: '我还不确定执行时间。请补充频率或时间，例如：每天 9 点、每周一 10 点、每隔 30 分钟。' }
}

function calculateNextRun(task) {
  if (task.cronExpression) {
    return nextCronRun(task.cronExpression)?.toISOString()
  }
  const current = new Date(task.nextRunAt)
  if (task.scheduleType === 'once') return undefined
  if (task.scheduleType === 'interval') {
    const interval = task.scheduleRule.match(/每隔\s*(\d+)\s*(分钟|小时)/)
    const amount = Number(interval?.[1] ?? '30')
    const unit = interval?.[2] ?? '分钟'
    return new Date(Date.now() + amount * (unit === '小时' ? hourMs : minuteMs)).toISOString()
  }
  if (task.scheduleType === 'daily') return new Date(current.getTime() + dayMs).toISOString()
  if (task.scheduleType === 'weekly') return new Date(current.getTime() + 7 * dayMs).toISOString()
  if (task.scheduleType === 'monthly') {
    current.setMonth(current.getMonth() + 1)
    return current.toISOString()
  }
  return undefined
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
  const now = Date.now()
  await atomicUpdate(STORE, (data) => {
    for (const [taskId, task] of Object.entries(data)) {
      if (!task?.cronExpression || task.status !== 'expired') continue
      const nextRunAt = task.nextRunAt && new Date(task.nextRunAt).getTime() > now
        ? task.nextRunAt
        : nextCronRun(task.cronExpression)?.toISOString()
      data[taskId] = {
        ...task,
        status: 'enabled',
        nextRunAt: nextRunAt ?? new Date(Date.now() + minuteMs).toISOString(),
        updatedAt: new Date().toISOString(),
      }
    }
    return data
  })
}

async function executeTask(task, trigger = 'schedule') {
  if (runningTaskIds.has(task.id)) return
  runningTaskIds.add(task.id)
  const runId = createId()
  const startedAt = new Date().toISOString()

  await updateTask(task.id, (current) => ({
    ...current,
    status: 'running',
    currentRunId: runId,
    runs: [{ id: runId, status: 'running', trigger, startedAt }, ...(current.runs || [])].slice(0, 20),
  }))

  const sessionId = `scheduled-${task.id}-${Date.now().toString(36)}`
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

    const eventBus = getSessionEventBus(sessionId)
    const finished = new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ ok: false, error: '执行超时' }), 30 * 60 * 1000)
      eventBus?.on('agent_event', (event) => {
        if (event.type !== 'agent_end') return
        clearTimeout(timeout)
        resolve({ ok: !session.agent.state.errorMessage, error: session.agent.state.errorMessage })
      })
    })

    await runPrompt(sessionId, task.instruction)
    const result = await finished
    settled = true
    const finishedAt = new Date().toISOString()
    const latestTask = (await readStore(STORE))[task.id] ?? task
    const nextRunAt = calculateNextRun(latestTask)
    const recurring = Boolean(latestTask.cronExpression) || !['once'].includes(latestTask.scheduleType)

    await updateTask(task.id, (current) => ({
      ...current,
      status: result.ok ? (nextRunAt || recurring ? 'enabled' : 'expired') : 'failed',
      currentRunId: null,
      lastRunAt: finishedAt,
      nextRunAt: nextRunAt ?? (recurring ? new Date(Date.now() + minuteMs).toISOString() : current.nextRunAt),
      lastSessionId: sessionId,
      runs: (current.runs || []).map((run) => run.id === runId ? {
        ...run,
        status: result.ok ? 'success' : 'failed',
        result: result.ok ? `已完成，结果保存在会话 ${sessionId}` : undefined,
        errorMessage: result.error,
        sessionId,
        finishedAt,
      } : run),
    }))
  } catch (error) {
    const finishedAt = new Date().toISOString()
    await updateTask(task.id, (current) => ({
      ...current,
      status: 'failed',
      currentRunId: null,
      lastRunAt: finishedAt,
      runs: (current.runs || []).map((run) => run.id === runId ? {
        ...run,
        status: 'failed',
        errorMessage: error?.message || String(error),
        finishedAt,
      } : run),
    }))
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
    if (!parsed) {
      const error = new Error('Missing task')
      error.statusCode = 400
      throw error
    }
    const now = new Date().toISOString()
    const task = {
      id: createId(),
      title: parsed.title,
      instruction: parsed.instruction,
      scheduleType: parsed.scheduleType,
      scheduleRule: parsed.scheduleRule,
      cronExpression: parsed.cronExpression,
      nextRunAt: parsed.nextRunAt,
      model: body?.model,
      thinkingLevel: body?.thinkingLevel || (body?.model?.reasoning ? 'medium' : 'off'),
      projectId: body?.projectId || null,
      projectName: body?.projectName || null,
      status: 'enabled',
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

    if (req.method === 'DELETE' && !action) {
      await atomicUpdate(STORE, (data) => {
        delete data[taskId]
        return data
      })
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'POST' && action === 'pause') {
      const task = await updateTask(taskId, (current) => ({ ...current, status: 'paused', updatedAt: new Date().toISOString() }))
      sendJson(res, 200, { task })
      return
    }

    if (req.method === 'POST' && action === 'resume') {
      const task = await updateTask(taskId, (current) => ({ ...current, status: 'enabled', updatedAt: new Date().toISOString() }))
      sendJson(res, 200, { task })
      return
    }

    if (req.method === 'POST' && action === 'run') {
      const data = await readStore(STORE)
      const task = data[taskId]
      if (!task) {
        const error = new Error('Task not found')
        error.statusCode = 404
        throw error
      }
      executeTask(task, 'manual').catch((error) => logger.error(`Manual scheduled task ${task.id} failed:`, error))
      sendJson(res, 200, { ok: true })
      return
    }
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}
