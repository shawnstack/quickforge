// agent-manager 模块拆分（god-module-decomposition ⑤）消息回滚：
// rollbackStartIndexFromMessage（回滚起点下标算术，与前端
// src/lib/message-utils.ts 同构）与 rollbackSessionMessages（运行中拒绝、
// goal/bot 会话保护、压缩点派生下标重算、messages_replaced 广播）从
// agent-manager.mjs 逐字搬移至此；两个函数均为公共 API 经
// agent-manager.mjs facade re-export，行为与注释语义不变。

import { agentSessions } from './agent-session-store.mjs'
import { restoreAgent } from './agent-session-lifecycle.mjs'
import { activeGoalStatus } from './goal/engine.mjs'
import { readProjectConfig } from './project-config.mjs'
import {
  updateSessionMessages,
  emitSessionEvent,
  getSessionContextUsage,
} from './agent-session-events.mjs'
import { lastCompactionMessageIndex, syncCompactionIndex } from './auto-compaction.mjs'
import { resetSessionCompaction } from './agent-compaction.mjs'
import { persistSession } from './agent-persistence.mjs'
// getSessionState 是 agent-manager.mjs 里唯一的查询工厂实例（组合根），
// 这里经 facade 取同一实例，避免第二份闭包状态。
import { getSessionState } from './agent-manager.mjs'

/**
 * 回滚起点：删除该索引处的消息及其之后的所有消息。
 *
 * 回滚永远可用，不做「找不到锚点就拒绝」的限制：
 * - 点击 user 消息 → 以它自身为锚点；
 * - 点击其他角色（assistant / toolResult / 孤立轮）→ 回退到本轮开头的 user，
 *   找不到（例如报错产生的孤立轮）就以该消息自身为截断点。
 * 索引会 clamp 到有效范围（UI 窗口数组与权威消息数组可能瞬时错位），
 * 仅当会话没有任何消息或输入不是有限数时返回 -1（无操作）。
 * 与前端 src/lib/message-utils.ts 保持同构。
 */
export function rollbackStartIndexFromMessage(messages, messageIndex) {
  if (!Array.isArray(messages) || messages.length === 0) return -1

  const requested = Number(messageIndex)
  if (!Number.isFinite(requested)) return -1

  const rollbackIndex = Math.max(0, Math.min(Math.trunc(requested), messages.length - 1))
  const message = messages[rollbackIndex]
  if (!message) return -1

  if (message.role === 'user' || message.role === 'user-with-attachments') {
    return rollbackIndex
  }

  for (let index = rollbackIndex - 1; index >= 0; index--) {
    if (messages[index].role === 'user' || messages[index].role === 'user-with-attachments') {
      return index
    }
  }
  return rollbackIndex
}

export async function rollbackSessionMessages(sessionId, rollbackMessageIndex) {
  let session = agentSessions.get(sessionId)
  if (!session) session = await restoreAgent(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  if (session.agent.state.isStreaming) {
    throw Object.assign(new Error('Generation is still running. Stop it or wait until it finishes before rolling back.'), {
      statusCode: 409,
      errorCode: 'GENERATION_STILL_RUNNING_BEFORE_ROLLBACK',
    })
  }
  // Rolling back the transcript of a goal would desync the goal's evidence and
  // criteria from the conversation; require pause/cancel first.
  if (activeGoalStatus(session)) {
    throw Object.assign(new Error('This chat has an active goal. Pause or cancel it before rolling back messages.'), {
      statusCode: 409,
      errorCode: 'GOAL_ACTIVE',
    })
  }
  // bot 的会话是它的长期记忆。截断会让记忆和压缩指针脱钩：压缩把前半段换成
  // 一条真消息（摘要），`contextCompaction.summaryMessage` 指着数组里那一条，
  // 回滚到压缩点之前指针悬空、回滚到之后摘要描述的那段已不存在，此后每轮喂给
  // 模型的都是幻象；没压过的 bot 被剪一刀同样是挖走一块记忆。所以无条件拒绝，
  // 不看「有没有压缩过」。文件回滚（/rollback-turn）不碰 messages，照常可用。
  //
  // 判据读项目配置本身，不读「项目上下文」：kind 就是配置里的一个字段，而
  // projectContextFromId 找不到项目会静默回退 global（kind 读成 undefined，
  // bot 直接漏过去）；registeredProjectContextFromId 虽不回落，却要
  // assertDirectory 并建缓存——bot 目录一时不可用就会把 403 变成放行。
  // 全局会话在配置里查不到，`undefined` 即「不是 bot」，行为与改动前一致。
  if (session.projectId) {
    const sessionProject = (await readProjectConfig()).projects
      .find((item) => item.id === session.projectId)
    if (sessionProject?.kind === 'bot') {
      throw Object.assign(new Error('bot 的会话是它的长期记忆，不能回滚。'), {
        statusCode: 403,
        errorCode: 'BOT_SESSION_IMMUTABLE',
      })
    }
  }

  const messages = Array.isArray(session.agent.state.messages) ? session.agent.state.messages : []
  // 回滚不再有「没有可回滚的对话轮次」的拒绝路径：索引已由
  // rollbackStartIndexFromMessage clamp 到有效范围；空会话（-1）视为无操作，
  // 保持幂等成功（客户端只是与权威数组瞬时错位，静默收敛）。
  const rollbackIndex = Math.max(0, rollbackStartIndexFromMessage(messages, rollbackMessageIndex))

  const nextMessages = messages.slice(0, rollbackIndex)
  updateSessionMessages(session, nextMessages)
  // 方案 B：压缩点就是一条消息。截断把它删掉 ⇒ 压缩自然失效；保留则重算派生下标。
  const compactionIndex = lastCompactionMessageIndex(nextMessages)
  const legacyCut = Number(session.contextCompaction?.compactedUpToIndex) || 0
  if (compactionIndex >= 0) {
    syncCompactionIndex(session, compactionIndex, nextMessages.length, nextMessages[compactionIndex])
    session.lastTransformedContextMessages = null
  } else if (session.contextCompaction && legacyCut > 0 && rollbackIndex >= legacyCut) {
    // 还没迁移成消息的旧会话：截断点仍在压缩点之后，摘要依然有效。
    session.lastTransformedContextMessages = null
  } else if (session.contextCompaction) {
    resetSessionCompaction(session)
  }
  session.status = 'idle'
  session.finishedAt = new Date().toISOString()
  await persistSession(session)

  const replacedEvent = {
    type: 'messages_replaced',
    reason: 'rollback',
    rollbackIndex,
    messages: session.agent.state.messages,
    contextCompaction: session.contextCompaction,
    contextUsage: getSessionContextUsage(session),
  }
  emitSessionEvent(session, replacedEvent)
  emitSessionEvent(session, { type: 'message_end', messages: session.agent.state.messages })
  emitSessionEvent(session, { type: 'agent_end', messages: session.agent.state.messages })

  return { session: getSessionState(sessionId), rollbackIndex }
}
