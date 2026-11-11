import { logger } from './utils/logger.mjs'
import { isSessionFileRollbackBusy, runPrompt } from './agent-manager.mjs'
import { ensureBotSession, sessionExists } from './bot-session.mjs'
import {
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

const running = new Set()
let timer = null
let tickPromise = null

/**
 * 心跳指令。刻意写得像「给未来自己的便条」而不是「执行任务」——
 * 它每次醒来的第一件事是接上自己的记忆，而不是重新领一份活。
 */
export function heartbeatInstruction(bot) {
  return [
    '[心跳] 你自己醒了一次，这不是用户在跟你说话。',
    '',
    '工作空间里出现了上次醒来之后的变化。先看清楚是什么，再决定要不要动手：',
    '1. 先读 MEMORY.md，弄清自己是谁、记着什么、上次停在哪。',
    '2. 再看工作空间里新增或改动了什么。',
    '3. 该动的动手。做完把结论写回 MEMORY.md——踩过的坑、做过的决定、下次要继续的事，都记一笔。',
    '4. 如果看下来其实不值得动手，就直接说一句「不值得动」并说明为什么。',
    '   不用为了显得有用而制造工作，也不用向用户提问（他可能不在）。',
    '   真要他决定的事，写进 MEMORY.md 并标明「等你」。',
    '',
    `你的目录是 ${bot.workspacePath}，别写到别的地方去。`,
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
    await runPrompt(bot.sessionId, {
      role: 'user',
      content: heartbeatInstruction(bot),
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
