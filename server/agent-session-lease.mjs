// 会话租约的进程内装配层：把纯租约表（session-lease.mjs）接到会话存储与
// 会话事件总线上。放在这里而不是 agent-session-queries.mjs，是因为它需要
// emitSessionEvent（广播 `session_lease` 帧），而 queries 模块刻意只做投影。
//
// agent-manager.mjs 作为 facade re-export 这些函数，路由层按既有风格从
// agent-manager 取值，无需知道本模块的存在。

import { agentSessions } from './agent-session-store.mjs'
import { emitSessionEvent } from './agent-session-events.mjs'
import { createSessionLeaseStore } from './session-lease.mjs'

function publishToSession(sessionId, lease) {
  const session = agentSessions.get(sessionId)
  // 会话不在内存时无需广播：任何客户端要读它都得先 restore，restore 后的
  // state 帧会把当前租约一起带下去。
  if (!session) return
  emitSessionEvent(session, { type: 'session_lease', lease })
}

const store = createSessionLeaseStore({ publish: publishToSession })

/** 获取或续约租约。 */
export function acquireSessionLease(sessionId, clientId) {
  return store.acquire(sessionId, clientId)
}

/** 主动接管租约（用户显式点击「在此窗口接管」）。 */
export function takeOverSessionLease(sessionId, clientId) {
  return store.forceTake(sessionId, clientId)
}

/** 释放租约（只允许持有者）。 */
export function releaseSessionLease(sessionId, clientId) {
  return store.release(sessionId, clientId)
}

/** 只读查询当前有效租约。 */
export function getSessionLease(sessionId) {
  return store.get(sessionId)
}

/** 写权限判定，供写路由的统一守卫使用。 */
export function canWriteSession(sessionId, clientId) {
  return store.canWrite(sessionId, clientId)
}

/** 会话销毁时清理租约（`destroyAgent`）。 */
export function clearSessionLease(sessionId, options) {
  return store.clear(sessionId, options)
}

/** 测试/诊断用。 */
export function sessionLeaseStore() {
  return store
}
