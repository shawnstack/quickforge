import { readJsonBody, sendJson, decodeSegment } from '../utils/response.mjs'
import { readStore, atomicUpdate } from '../storage.mjs'
import { createAgent, runPrompt, getSessionEventBus } from '../agent-manager.mjs'
import { getActiveProject, readProjectConfig } from '../project-config.mjs'
import { logger } from '../utils/logger.mjs'

const STORE = 'scheduled-tasks'
const RUN_CHECK_INTERVAL_MS = 30 * 1000
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
    const activeProject = getActiveProject(config)
    const settings = await readStore('settings')
    const yoloMode = settings?.['yolo-mode'] === true || settings?.['yolo-mode'] === 'true'

    const session = await createAgent(sessionId, {
      scope: activeProject ? 'project' : 'global',
      projectId: activeProject?.id || null,
      yoloMode,
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
    const nextRunAt = calculateNextRun(task)

    await updateTask(task.id, (current) => ({
      ...current,
      status: result.ok ? (nextRunAt ? 'enabled' : 'expired') : 'failed',
      currentRunId: null,
      lastRunAt: finishedAt,
      nextRunAt: nextRunAt ?? current.nextRunAt,
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
    sendJson(res, 200, parseScheduledTaskInstruction(body?.instruction))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/scheduled-tasks') {
    sendJson(res, 200, { tasks: await getTasks() })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/scheduled-tasks') {
    const body = await readJsonBody(req)
    const parsed = body?.task ?? parseScheduledTaskInstruction(body?.instruction).task
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
      nextRunAt: parsed.nextRunAt,
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
