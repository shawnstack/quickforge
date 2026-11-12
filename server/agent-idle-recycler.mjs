// agent-manager 模块拆分（god-module-decomposition ⑤）空闲会话回收：
// resetIdleTimer / touchSession（空闲超时销毁、运行中/后台命令重置、
// idleRetention 保留策略）从 agent-manager.mjs 逐字搬移至此；
// resetIdleTimer / touchSession 经 agent-manager.mjs facade re-export
// （契约测试 INTERNAL_SHARED_EXPORTS 锁定），行为与注释语义不变。

import { agentSessions } from './agent-session-store.mjs'
import { hasGoalCompletionWaiter } from './goal/engine.mjs'
import { listBackgroundCommandTasks } from './tools/index.mjs'
// 会话销毁（destroyAgent）位于 agent-session-lifecycle.mjs。
import { destroyAgent } from './agent-session-lifecycle.mjs'
import { logger } from './utils/logger.mjs'

const IDLE_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

function isIdleRetainedSession(session) {
  return session?.idleRetention === 'always'
}

export function resetIdleTimer(session) {
  if (session.idleTimer) clearTimeout(session.idleTimer)
  session.idleTimer = null
  if (isIdleRetainedSession(session)) return

  session.idleTimer = setTimeout(() => {
    if (session.status === 'running' || hasGoalCompletionWaiter(session.sessionId)) {
      logger.info(`Session ${session.sessionId} idle timer fired but still running, resetting...`, { sessionId: session.sessionId, status: session.status })
      resetIdleTimer(session)
      return
    }
    // A running background command still owns this session: its exit
    // notification (followUp / next prompt) is delivered through the live
    // session object, and the process is only stopped by an explicit destroy.
    if (listBackgroundCommandTasks(session.sessionId).length > 0) {
      logger.info(`Session ${session.sessionId} idle timer fired but background commands are still running, resetting...`, { sessionId: session.sessionId })
      resetIdleTimer(session)
      return
    }
    logger.info(`Session ${session.sessionId} idle timeout (${IDLE_TIMEOUT_MS / 1000}s), destroying...`, { sessionId: session.sessionId })
    destroyAgent(session.sessionId).catch((err) =>
      logger.error(`Failed to destroy idle agent ${session.sessionId}:`, err, { sessionId: session.sessionId }),
    )
  }, IDLE_TIMEOUT_MS)
}

/**
 * Reset the idle timer for a session (e.g. on SSE activity).
 * Returns true if the session was found.
 */
export function touchSession(sessionId) {
  const session = agentSessions.get(sessionId)
  if (session) {
    resetIdleTimer(session)
    return true
  }
  return false
}
