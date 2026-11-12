import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { logger } from '../utils/logger.mjs'
import { getSessionStatus, isSessionFileRollbackBusy, updateSessionTitle } from '../agent-manager.mjs'
import { ensureBotSession } from '../bot-session.mjs'
import {
  BOT_STORE,
  DEFAULT_MASCOT,
  appendBotInbox,
  ensureBotProject,
  ensureBotWorkspace,
  listBotRecords,
  nextHeartbeatAt,
  normalizeBotName,
  normalizeBotRecord,
  patchBotRecord,
  readBotMemory,
  removeBotRecord,
  reorderBotRecords,
  requireBotRecord,
  saveBotRecord,
  writeBotMemory,
} from '../bots.mjs'
import { atomicProjectConfigUpdate } from '../storage.mjs'
import { runBotHeartbeat } from '../bot-runner.mjs'

function requestError(message, statusCode = 400, errorCode = null) {
  const error = new Error(message)
  error.statusCode = statusCode
  if (errorCode) error.errorCode = errorCode
  return error
}

function publicBot(bot) {
  return {
    id: bot.id,
    name: bot.name,
    workspacePath: bot.workspacePath,
    memoryFile: bot.memoryFile,
    projectId: bot.projectId,
    sessionId: bot.sessionId,
    thinkingLevel: bot.thinkingLevel,
    accessMode: bot.accessMode,
    sortOrder: bot.sortOrder ?? null,
    heartbeat: bot.heartbeat,
    mascot: bot.mascot ?? DEFAULT_MASCOT,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
  }
}

async function buildBotList() {
  const bots = await listBotRecords()
  return bots.map((bot) => ({
    ...publicBot(bot),
    busy: bot.sessionId ? isSessionFileRollbackBusy(bot.sessionId) : false,
    status: bot.sessionId ? (getSessionStatus(bot.sessionId)?.status ?? 'idle') : 'idle',
  }))
}

async function createBot(body) {
  const name = normalizeBotName(body?.name)
  const existing = await listBotRecords()
  if (existing.some((bot) => bot.name === name)) {
    throw requestError('A bot with this name already exists', 409, 'BOT_NAME_TAKEN')
  }

  let bot = normalizeBotRecord({
    name,
    thinkingLevel: body?.thinkingLevel ?? 'medium',
    modelRef: body?.modelRef ?? null,
    model: body?.model ?? null,
    mascot: body?.mascot,
    // 新 bot 排在列表末尾；顺序之后可由拖动排序改写。
    sortOrder: existing.length,
  })

  await ensureBotWorkspace(bot)
  const { project } = await ensureBotProject({ name, workspacePath: bot.workspacePath })
  bot = { ...bot, projectId: project.id }
  bot = await saveBotRecord(bot)

  // 一个 bot 只有一条会话：建的时候就把这条会话建出来，心跳之后一直复用它。
  // 建会话失败不阻断创建（比如这台机器还没配模型），下次心跳会再试。
  try {
    bot = await ensureBotSession(bot)
  } catch (error) {
    logger.warn(`Bot ${bot.name} created without a session yet:`, error)
  }

  bot = await patchBotRecord(bot.id, {
    heartbeat: {
      ...bot.heartbeat,
      enabled: body?.heartbeat?.enabled ?? true,
      intervalMinutes: body?.heartbeat?.intervalMinutes ?? bot.heartbeat.intervalMinutes,
      nextRunAt: nextHeartbeatAt(bot),
    },
  })

  return bot
}

async function deleteBotProject(projectId) {
  if (!projectId) return
  try {
    await atomicProjectConfigUpdate((config) => {
      config.projects = config.projects.filter((project) => project.id !== projectId)
      if (config.activeProjectId === projectId) config.activeProjectId = config.projects[0]?.id ?? null
      return config
    })
  } catch (error) {
    logger.warn('Failed to remove bot project registration:', error)
  }
}

export async function handleBotsApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean) // ['api','bots',...]
  const [, , rawId, rawSub] = parts
  const botId = rawId ? decodeSegment(rawId) : null
  const sub = rawSub ? decodeSegment(rawSub) : null

  // PUT /api/bots/reorder：整组重排（body: { orderedIds }）。放在 :id 分发之前，
  // 否则 'reorder' 会被当成 botId 直接 404。与 PUT /api/project/reorder 同构。
  if (rawId === 'reorder' && !sub) {
    if (req.method !== 'PUT') throw requestError('Method not allowed', 405)
    const body = await readJsonBody(req)
    const bots = await reorderBotRecords(body?.orderedIds)
    if (!bots) throw requestError('orderedIds must be an array of bot ids')
    sendJson(res, 200, { bots: bots.map((bot) => publicBot(bot)) })
    return
  }

  if (!botId) {
    if (req.method === 'GET') {
      sendJson(res, 200, { bots: await buildBotList() })
      return
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      const bot = await createBot(body || {})
      logger.info(`Created bot ${bot.name} (${bot.id})`, { workspace: bot.workspacePath })
      sendJson(res, 201, { bot: publicBot(bot) })
      return
    }
    throw requestError('Method not allowed', 405)
  }

  if (!sub) {
    if (req.method === 'GET') {
      const bot = await requireBotRecord(botId)
      sendJson(res, 200, {
        bot: publicBot(bot),
        busy: bot.sessionId ? isSessionFileRollbackBusy(bot.sessionId) : false,
        status: bot.sessionId ? (getSessionStatus(bot.sessionId)?.status ?? 'idle') : 'idle',
      })
      return
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      const existing = await requireBotRecord(botId)
      const body = await readJsonBody(req)
      const patch = {}
      if (body?.name !== undefined && body.name !== existing.name) {
        const name = normalizeBotName(body.name)
        const others = await listBotRecords()
        if (others.some((bot) => bot.id !== botId && bot.name === name)) {
          throw requestError('A bot with this name already exists', 409, 'BOT_NAME_TAKEN')
        }
        patch.name = name
      }
      if (body?.thinkingLevel !== undefined) patch.thinkingLevel = body.thinkingLevel
      if (body?.modelRef !== undefined) patch.modelRef = body.modelRef
      if (body?.model !== undefined) patch.model = body.model
      if (body?.accessMode !== undefined) patch.accessMode = body.accessMode
      // 只合并传入的那几项：颜色和开关可以分开改，其余沿用上一次的值。
      if (body?.mascot !== undefined) patch.mascot = body.mascot

      if (body?.heartbeat !== undefined) {
        const nextHeartbeat = { ...existing.heartbeat, ...(body.heartbeat || {}) }
        if (nextHeartbeat.intervalMinutes !== existing.heartbeat.intervalMinutes
          || (nextHeartbeat.enabled && !existing.heartbeat.enabled)) {
          nextHeartbeat.nextRunAt = nextHeartbeatAt(
            { heartbeat: { ...existing.heartbeat, intervalMinutes: nextHeartbeat.intervalMinutes } },
          )
        }
        if (!nextHeartbeat.enabled) nextHeartbeat.nextRunAt = null
        if (nextHeartbeat.enabled && !nextHeartbeat.nextRunAt) {
          nextHeartbeat.nextRunAt = nextHeartbeatAt({ heartbeat: nextHeartbeat })
        }
        patch.heartbeat = nextHeartbeat
      }

      const bot = await patchBotRecord(botId, patch)
      if (patch.name !== undefined && patch.name !== existing.name) {
        // 改名同步两处外部引用，都按尽力而为处理：失败不回滚改名，只记日志。
        // ① projects.json 里 kind:'bot' 项目的显示名（ensureBotProject 原地更新）；
        // ② 这条持久会话的标题——只在建会话时写过一次，此后不跟名字走。会话还没
        //    落盘时 404 属正常，下次 ensureBotSession 自然用新名字。
        try {
          await ensureBotProject({ name: bot.name, workspacePath: bot.workspacePath })
        } catch (error) {
          logger.warn(`Failed to sync project name for bot ${bot.id}:`, error)
        }
        if (bot.sessionId) {
          try {
            await updateSessionTitle(bot.sessionId, bot.name)
          } catch (error) {
            logger.warn(`Failed to sync session title for bot ${bot.id}:`, error)
          }
        }
      }
      sendJson(res, 200, { bot: publicBot(bot) })
      return
    }

    if (req.method === 'DELETE') {
      const existing = await removeBotRecord(botId)
      if (!existing) throw requestError('Bot not found', 404, 'BOT_NOT_FOUND')
      await deleteBotProject(existing.projectId)
      sendJson(res, 200, { ok: true })
      return
    }

    throw requestError('Method not allowed', 405)
  }

  if (sub === 'session') {
    // 打开 bot 之前先确认它那条会话还在。
    //
    // 为什么需要这一步：空会话在持久化时会被当作空壳清理掉，所以 bot 记录里的
    // sessionId 只是「同一个 id 永远用它」，不保证内存/存储里此刻有它。
    // 打开、心跳、催醒都走这个 ensure，语义才一致。
    if (req.method !== 'POST') throw requestError('Method not allowed', 405)
    const bot = await requireBotRecord(botId)
    try {
      const ensured = await ensureBotSession(bot)
      sendJson(res, 200, { sessionId: ensured.sessionId })
    } catch (error) {
      logger.warn(`Failed to ensure session for bot ${bot.name}:`, error)
      throw requestError('Unable to open this bot right now', 502, 'BOT_SESSION_UNAVAILABLE')
    }
    return
  }

  if (sub === 'memory') {
    const bot = await requireBotRecord(botId)
    if (req.method === 'GET') {
      sendJson(res, 200, { content: await readBotMemory(bot), file: bot.memoryFile })
      return
    }
    if (req.method === 'PUT' || req.method === 'PATCH') {
      const body = await readJsonBody(req)
      if (typeof body?.content !== 'string') throw requestError('content is required')
      await writeBotMemory(bot, body.content)
      sendJson(res, 200, { ok: true, file: bot.memoryFile })
      return
    }
    throw requestError('Method not allowed', 405)
  }

  if (sub === 'wake') {
    if (req.method !== 'POST') throw requestError('Method not allowed', 405)
    const bot = await requireBotRecord(botId)
    const result = await runBotHeartbeat(bot, { manual: true })
    sendJson(res, 200, result)
    return
  }

  if (sub === 'inbox') {
    if (req.method !== 'POST') throw requestError('Method not allowed', 405)
    const bot = await requireBotRecord(botId)
    const body = await readJsonBody(req)
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (!text) throw requestError('text is required')
    if (text.length > 20000) throw requestError('text is too long')
    const file = await appendBotInbox(bot, text)
    // 只提前节拍，不直接唤醒：保持单飞约束，下一轮 runner 扫描（≤30s）即醒。
    if (bot.heartbeat?.enabled) {
      await patchBotRecord(bot.id, {
        heartbeat: { ...bot.heartbeat, nextRunAt: new Date().toISOString() },
      })
    }
    logger.info(`Fed bot ${bot.name} (${bot.id})`, { chars: text.length })
    sendJson(res, 200, { ok: true, file })
    return
  }

  throw requestError('Not found', 404)
}

export { BOT_STORE }
