import { logger } from './utils/logger.mjs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  agentEvents,
  getSessionEventBus,
  isSessionFileRollbackBusy,
  runPrompt,
} from './agent-manager.mjs'
import { agentSessions } from './agent-session-store.mjs'
import { ensureBotSession, sessionExists } from './bot-session.mjs'
import {
  BOT_HEARTBEAT_TEMPLATE_FILE,
  defaultHeartbeatTemplate,
  ensureBotWorkspace,
  getBotRecord,
  inspectBotWork,
  listBotRecords,
  nextHeartbeatAt,
  patchBotRecord,
} from './bots.mjs'

// ---------------------------------------------------------------------------
// Bot 心跳
//
// 与「定时任务」的区别：
//   1. 唤醒同一个会话，不新建。这就是「一个 bot 只有一条会话」。
//   2. 没有信号就不叫醒模型 —— 闲着的班次只在记录里记一笔，
//      不往对话里写任何东西，否则一天几十条「我醒了」会把会话淹掉。
// ---------------------------------------------------------------------------

export const BOT_CHECK_INTERVAL_MS = 30 * 1000

// ---------------------------------------------------------------------------
// [报告] 首行契约：心跳轮回复的首行以 [报告] 开头才算有事要通知用户。
// 这是服务端发 bot_heartbeat_notification 的唯一依据；无标记、idle 跳、
// 心跳自身报错都不发。
// ---------------------------------------------------------------------------
export const BOT_HEARTBEAT_REPORT_PREFIX = '[报告]'

const BOT_HEARTBEAT_WATCH_TIMEOUT_MS = 60 * 60 * 1000

export function parseHeartbeatReport(messages) {
  const list = Array.isArray(messages) ? messages : []
  for (let i = list.length - 1; i >= 0; i--) {
    const message = list[i]
    if (message?.role !== 'assistant' || typeof message.content !== 'string') continue
    const firstLine = message.content.split('\n')[0].trim()
    if (!firstLine) continue
    if (!firstLine.startsWith(BOT_HEARTBEAT_REPORT_PREFIX)) return null
    const summary = firstLine.slice(BOT_HEARTBEAT_REPORT_PREFIX.length).trim()
    return summary || '有事找你'
  }
  return null
}

/**
 * 心跳轮结束后看一眼有没有 [报告]。挂在会话事件总线上等 agent_end，
 * 不阻塞 runner 的 tick 链；watcher 只负责读与发通知，不参与心跳状态机。
 */
function watchBotHeartbeatReport(bot, sessionId, reportKey) {
  const eventBus = getSessionEventBus(sessionId)
  if (!eventBus) return
  let done = false
  const finish = () => {
    if (done) return
    done = true
    clearTimeout(timer)
    eventBus.removeListener('agent_event', handler)
  }
  const handler = (event) => {
    if (event.type !== 'agent_end') return
    const messages = Array.isArray(event.messages)
      ? event.messages
      : agentSessions.get(sessionId)?.agent?.state?.messages
    const summary = parseHeartbeatReport(messages)
    finish()
    if (!summary) return
    agentEvents.emit('agent_event', {
      type: 'bot_heartbeat_notification',
      sessionId,
      botId: bot.id,
      reportKey,
      title: `BOT「${bot.name}」有事报告`,
      status: 'idle',
      message: summary.length > 120 ? `${summary.slice(0, 120)}…` : summary,
    })
  }
  const timer = setTimeout(finish, BOT_HEARTBEAT_WATCH_TIMEOUT_MS)
  timer.unref?.()
  eventBus.on('agent_event', handler)
}

const running = new Set()
let timer = null
let tickPromise = null

/**
 * 心跳指令 = 固定头（处境 + 自进化授权 + 目录）+ bot 自己的操作模板 + 固定尾（硬契约）。
 *
 * 模板（.bot/heartbeat.md）是 bot 可自我修改的工作方式——指令和记忆一样交给它演化；
 * 但首尾两段钉在服务端：[报告] 是发通知的唯一依据、不 commit 是他人项目的安全绳，
 * bot 重写模板也改不掉它们。模板缺失（存量 bot / 手工删除）时回退种子文案，
 * 行为与模板化之前完全一致。
 */
export async function heartbeatInstruction(bot) {
  let template
  try {
    template = await fs.readFile(path.join(bot.workspacePath, BOT_HEARTBEAT_TEMPLATE_FILE), 'utf8')
  } catch {
    template = defaultHeartbeatTemplate()
  }
  const body = template.trim() || defaultHeartbeatTemplate()
  return [
    `[心跳] 你醒了，不是用户在说话。这是你的自主时间。你的目录：${bot.workspacePath}。`,
    '',
    '你的两份东西都可以自己改：操作模板 .bot/heartbeat.md（你每次醒来怎么干活）、记忆 MEMORY.md（你是谁、在做什么）。觉得不好用就改，改完下一跳生效——改它们本身就是自我进化的一部分。',
    '',
    '用户的项目的活，你负责发现、拆解、派活、验收：实现不在本会话里做——用 quickforge-api 的 spawn 派给绑定该项目的子会话去实现（探索、只读可以直接走 API），派活时把规矩带过去（留痕、不 commit、回报结果），用 show / messages 收结果再验收。',
    '',
    body,
    '',
    '首行以 [报告] 开头，他才会收到通知（60 字内说清）；没有就不带。不向他提问。改动永远不 commit——留在工作区让用户决定去留。',
  ].join('\n')
}

async function markIdle(bot, reason) {
  const heartbeat = {
    ...bot.heartbeat,
    idleCount: (bot.heartbeat?.idleCount ?? 0) + 1,
    lastIdleReason: reason,
    nextRunAt: nextHeartbeatAt(bot),
  }
  await patchBotRecord(bot.id, { heartbeat })
  return {
    woke: false,
    reason,
    nextRunAt: heartbeat.nextRunAt,
  }
}

/**
 * 跑一次心跳判定（可能叫醒模型，也可能只记一笔）。
 *
 * @param {object} bot  bot 记录
 * @param {{ manual?: boolean }} options 手动触发时跳过「有没有活」的判定
 */
export async function runBotHeartbeat(bot, options = {}) {
  if (running.has(bot.id)) {
    return { woke: false, reason: 'already-waking' }
  }
  // 补播种（幂等）：存量的 bot 建于模板化之前，目录里还没有 .bot/heartbeat.md；
  // ensureBotWorkspace 只在文件缺失时写，不会覆盖它已有的演化。
  await ensureBotWorkspace(bot).catch(() => {})
  if (!bot?.sessionId || !(await sessionExists(bot.sessionId))) {
    // 会话可能在上次创建时没建起来（比如当时没配模型）。这里补一次，
    // 补不上就当作这一班没醒，不写错误进记录。
    try {
      bot = await ensureBotSession(bot)
    } catch (error) {
      logger.warn(`Bot ${bot?.name} has no session yet:`, error)
      return { woke: false, reason: 'no-session' }
    }
  }
  if (!bot?.sessionId) {
    return { woke: false, reason: 'no-session' }
  }
  if (isSessionFileRollbackBusy(bot.sessionId)) {
    // 你正在跟它说话，或者上一班还没结束：这一班直接跳过，不排队、不抢占上下文。
    return markIdle(bot, 'busy')
  }

  if (!options.manual) {
    const work = await inspectBotWork(bot)
    if (!work.hasWork) return markIdle(bot, work.reason)
  }

  running.add(bot.id)
  try {
    const startedAt = new Date().toISOString()
    // 走普通 prompt 通道，落库后 role 就是 user。带上 details 标记，前端才分得清
    // 「它自己醒的」和「用户说的」——不然一打开会话就是一串用户没说过的话。
    // watcher 必须在 runPrompt 之前挂好，避免极快收跳的竞态。
    watchBotHeartbeatReport(bot, bot.sessionId, `${bot.id}:${startedAt}`)
    await runPrompt(bot.sessionId, {
      role: 'user',
      content: await heartbeatInstruction(bot),
      timestamp: startedAt,
      details: { quickforgeBotHeartbeat: { version: 1 } },
    }, [], null, null, { source: 'bot-heartbeat' })
    const heartbeat = {
      ...bot.heartbeat,
      lastWakeAt: startedAt,
      lastSessionId: bot.sessionId,
      wakeCount: (bot.heartbeat?.wakeCount ?? 0) + 1,
      lastIdleReason: null,
      lastError: null,
      nextRunAt: nextHeartbeatAt(bot),
    }
    await patchBotRecord(bot.id, { heartbeat })
    logger.info(`Bot heartbeat woke ${bot.name} (${bot.id})`, { manual: Boolean(options.manual) })
    return { woke: true, reason: options.manual ? 'manual' : 'signal', nextRunAt: heartbeat.nextRunAt }
  } catch (error) {
    // 409（会话正在生成）是正常的抢跑，不算失败，也不该把错误写进记录。
    const code = error?.statusCode === 409 || error?.errorCode === 'GENERATION_ALREADY_RUNNING'
    const heartbeat = {
      ...bot.heartbeat,
      lastError: code ? null : (error?.message || String(error)),
      nextRunAt: nextHeartbeatAt(bot),
      ...(code ? { lastIdleReason: 'generating' } : {}),
    }
    await patchBotRecord(bot.id, { heartbeat }).catch(() => {})
    if (!code) logger.error(`Bot heartbeat failed for ${bot.name} (${bot.id}):`, error)
    return { woke: false, reason: code ? 'generating' : 'error' }
  } finally {
    running.delete(bot.id)
  }
}

async function botTick() {
  const bots = await listBotRecords()
  const now = Date.now()
  for (const bot of bots) {
    const heartbeat = bot.heartbeat || {}
    if (!heartbeat.enabled) continue
    if (!heartbeat.nextRunAt) {
      await patchBotRecord(bot.id, { heartbeat: { ...heartbeat, nextRunAt: nextHeartbeatAt(bot) } }).catch(() => {})
      continue
    }
    if (Date.parse(heartbeat.nextRunAt) > now) continue
    const latest = await getBotRecord(bot.id)
    if (!latest) continue
    await runBotHeartbeat(latest).catch((error) => {
      logger.error(`Bot tick failed for ${bot.id}:`, error)
    })
  }
}

export function requestBotTick() {
  if (tickPromise) return tickPromise
  tickPromise = botTick()
    .catch((error) => logger.error('Bot tick failed:', error))
    .finally(() => { tickPromise = null })
  return tickPromise
}

export function startBotRunner() {
  if (timer) return
  timer = setInterval(requestBotTick, BOT_CHECK_INTERVAL_MS)
  timer.unref?.()
  requestBotTick()
}

export function stopBotRunner() {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
