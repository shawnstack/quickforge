// agent-manager 模块拆分（god-module-decomposition ⑤）后台命令通知投递：
// 后台命令退出通知（onBackgroundCommandExit）转换为 toolResult 落定、
// background_commands 事件、task-notification 跟进消息与 followUp/prompt
// 分流，从 agent-manager.mjs 逐字搬移至此；对外行为与注释语义不变。

import { emitSessionEvent } from './agent-session-events.mjs'
import { scheduleSessionPersist } from './agent-persistence.mjs'
import { listBackgroundCommandTasks } from './tools/index.mjs'
import { activeGoalStatus } from './goal/engine.mjs'
import { resetIdleTimer } from './agent-idle-recycler.mjs'
import { logger } from './utils/logger.mjs'

/**
 * Steering/follow-up bypass runPrompt's goal exclusivity check, so they must
 * reject an active goal themselves: a goal run owns the turn structure and a
 * queued user message would interleave with it (or silently derail the goal).
 */
const BACKGROUND_COMMAND_NOTICE_PREFIX = '<task-notification>'

function backgroundCommandNoticeMessage(notification) {
  return {
    role: 'user',
    content: notification.text,
    timestamp: Date.now(),
    details: {
      quickforgeBackgroundCommand: {
        taskId: notification.taskId,
        toolCallId: notification.toolCallId,
        outputFile: notification.outputFile,
        status: notification.details?.status || null,
      },
    },
  }
}

function settleBackgroundCommandToolResult(session, notification) {
  const toolCallId = notification?.toolCallId
  const result = notification?.result
  if (!toolCallId || !result) return false
  const messages = session.agent?.state?.messages
  if (!Array.isArray(messages)) return false
  const index = messages.findIndex((message) => message?.role === 'toolResult' && message.toolCallId === toolCallId)
  if (index < 0) return false
  const current = messages[index]
  const currentDetails = current.details && typeof current.details === 'object' ? current.details : {}
  const nextDetails = result.details && typeof result.details === 'object' ? result.details : {}
  messages[index] = {
    ...current,
    content: [{ type: 'text', text: String(result.content || '') }],
    details: {
      ...currentDetails,
      ...nextDetails,
      running: false,
      background: false,
      toolCallId,
    },
    isError: result.isError === true,
  }
  return true
}

export function deliverBackgroundCommandNotification(session, notification) {
  if (!session) return
  const settled = settleBackgroundCommandToolResult(session, notification)
  emitSessionEvent(session, {
    type: 'background_commands',
    backgroundCommands: Array.isArray(notification?.tasks) ? notification.tasks : listBackgroundCommandTasks(session.sessionId),
    ...(settled ? { messages: session.agent.state.messages } : {}),
  })
  if (settled) scheduleSessionPersist(session)
  if (!session.agent || notification?.phase === 'start' || !notification?.text?.startsWith(BACKGROUND_COMMAND_NOTICE_PREFIX)) return
  const message = backgroundCommandNoticeMessage(notification)
  emitSessionEvent(session, {
    type: 'task-notification',
    taskId: notification.taskId,
    toolCallId: notification.toolCallId,
    outputFile: notification.outputFile,
    status: notification.details?.status || null,
    text: notification.text,
  })
  resetIdleTimer(session)
  if (session.agent.state.isStreaming || session.abortPending || session.goalRunSettling) {
    session.agent.followUp(message)
    return
  }
  if (activeGoalStatus(session)) {
    session.pendingBackgroundCommandNotices = [
      ...(session.pendingBackgroundCommandNotices || []),
      message,
    ]
    return
  }
  const promptPromise = session.agent.prompt(message)
  promptPromise.catch((error) => {
    logger.error(`Failed to deliver background command notification for session ${session.sessionId}:`, error, { sessionId: session.sessionId })
  })
}
