// agent-manager 模块拆分（god-module-decomposition ⑤）轮级归因状态：
// sessionTurnIds Map 与 begin/end/clear 访问器从 agent-manager.mjs 搬移至此；
// currentSessionTurnId 经 agent-manager.mjs facade re-export（契约测试
// INTERNAL_SHARED_EXPORTS 锁定），行为与注释语义保持不变。

import { randomUUID } from 'node:crypto'

// One user-triggered main run (runPrompt) or retry run (continueSession)
// defines one rollback turn. Every journaled write during the run (including
// subagent writes attributed to the parent session) carries the id via the
// tool context; it is cleared when the run ends. A retry generates its own
// id: the frontend rolls a turn back by the group of ids that share one user
// message. Runtime-only on purpose: it must never leak into the persisted
// session state.
export const sessionTurnIds = new Map()

export function currentSessionTurnId(sessionId) {
  return sessionTurnIds.get(sessionId) || null
}

/** 登记一轮并返回新 turnId（runPrompt / continueSession / goal runner 共用）。 */
export function beginSessionTurn(sessionId) {
  const turnId = randomUUID()
  sessionTurnIds.set(sessionId, turnId)
  return turnId
}

// 条件清除：仅当当前登记的还是这个 turnId（或调用方未指定）时才删除——
// goal 续行先于本轮 .finally 清理启动时不会误删新一轮的登记。
export function endSessionTurn(sessionId, turnId) {
  if (turnId === undefined || sessionTurnIds.get(sessionId) === turnId) sessionTurnIds.delete(sessionId)
}

export function clearSessionTurn(sessionId) {
  sessionTurnIds.delete(sessionId)
}
