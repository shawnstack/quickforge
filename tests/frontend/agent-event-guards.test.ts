import { describe, expect, it } from 'vitest'
import {
  isBackgroundTaskStatus,
  isBotHeartbeatNotification,
  isScheduledTaskNotification,
  isScheduledTaskStarted,
} from '../../src/lib/agent-event-guards'

/**
 * 这几个判据是 SSE 事件分流的闸门：判错一个，UI 就会把「计划任务通知」当普通
 * 消息渲染，或者把心跳通知塞进对话里。它们只做一件事——按 type 字符串分流，
 * 所以测试也只要钉住「认识哪个字符串」和「其余一律不认」。
 */
describe('isBackgroundTaskStatus', () => {
  it.each(['idle', 'running', 'error', 'aborted'])('accepts the %s status', (status) => {
    expect(isBackgroundTaskStatus(status)).toBe(true)
  })

  it.each(['done', 'RUNNING', '', 'finished', null, undefined, 0, {}])('rejects %s', (value) => {
    expect(isBackgroundTaskStatus(value)).toBe(false)
  })
})

describe('event type guards', () => {
  const cases = [
    ['scheduled_task_notification', isScheduledTaskNotification],
    ['bot_heartbeat_notification', isBotHeartbeatNotification],
    ['scheduled_task_started', isScheduledTaskStarted],
  ] as const

  it.each(cases)('%s only matches its own type', (type, guard) => {
    expect(guard({ type })).toBe(true)
    for (const other of cases) {
      if (other[0] === type) continue
      expect(guard({ type: other[0] })).toBe(false)
    }
  })

  it.each(cases)('%s rejects unrelated shapes', (_type, guard) => {
    expect(guard({})).toBe(false)
    expect(guard({ type: undefined })).toBe(false)
    expect(guard({ type: 'message_end' })).toBe(false)
    expect(guard({ type: 42 })).toBe(false)
  })

  it('does not look at any other field', () => {
    // 额外字段再多也不影响判定：分流只看 type。
    expect(isBotHeartbeatNotification({ type: 'bot_heartbeat_notification', botId: 1, sessionId: 'x', status: 'error' })).toBe(true)
    expect(isBotHeartbeatNotification({ type: 'bot_heartbeat_notification', botId: null })).toBe(true)
  })
})
