import { randomUUID } from 'node:crypto'
import { createAgent } from './agent-manager.mjs'
import { hasSession } from './storage.mjs'
import { patchBotRecord } from './bots.mjs'

/**
 * 会话在不在？——存储层没就绪时按「不在」处理。
 *
 * 这里刻意不抛：调用点（建 bot、心跳、打开）都是「有就用、没有就建」的语义，
 * 一次存储抖动应该表现为重建一次会话，而不是把一个 unhandled rejection 漏到进程里。
 */
export async function sessionExists(sessionId) {
  if (!sessionId) return false
  try {
    // hasSession 是 async 的：必须 await，否则 throw 会变成没人接的 rejected promise。
    return await hasSession(sessionId)
  } catch {
    return false
  }
}

/**
 * 确保这个 bot 的那条会话存在，并返回带 sessionId 的记录。
 *
 * 「一个 bot 一条会话」意味着这个 id 一旦定下就不再变。所以：
 *   - 已经有 id 且会话在 → 直接返回；
 *   - 已经有 id 但会话不见了（被清理/导入丢失/空会话没落盘）→ 用同一个 id 重建；
 *   - 从没有过 → 生成一个新 id。
 *
 * 建会话可能失败（比如这台机器还没配模型）。失败不该让 bot 创建失败，
 * 下次心跳或下次打开时再试一次就行。
 */
export async function ensureBotSession(bot) {
  if (!bot) return bot
  if (await sessionExists(bot.sessionId)) return bot

  const sessionId = bot.sessionId || `bot-${bot.id}-${randomUUID().slice(0, 8)}`
  await createAgent(sessionId, {
    // scope 'project' 让会话落进 bot 那个项目桶；projectId 同时决定工具的工作空间。
    scope: bot.projectId ? 'project' : 'global',
    projectId: bot.projectId || null,
    title: bot.name,
    titleSource: 'manual',
    thinkingLevel: bot.thinkingLevel || 'medium',
    accessMode: bot.accessMode || 'full-access',
    // 持久会话：绝不能被空闲清理掉，否则「一个 bot 一条会话」就断了。
    idleRetention: 'always',
    ...(bot.modelRef ? { modelRef: bot.modelRef } : {}),
    ...(bot.model ? { model: bot.model } : {}),
  })

  return patchBotRecord(bot.id, { sessionId })
}
