import { describe, expect, it } from 'vitest'
import { createTurnErrorTracker, turnErrorKeyOf } from '../../src/components/chat/panel-decoration/turn-error-state'

// 回合错误重试循环状态机：计数只由 UI 层持有（retryFromMessage 会把旧错误从
// 消息历史里裁剪掉），语义见模块头注释。

describe('turn error tracker', () => {
  const firstKey = turnErrorKeyOf({ errorMessage: 'AI stream idle timeout after 60000ms', timestamp: 1 })
  const secondKey = turnErrorKeyOf({ errorMessage: 'AI stream idle timeout after 60000ms', timestamp: 2 })

  it('derives the error key from timestamp and message text', () => {
    expect(turnErrorKeyOf({ errorMessage: 'boom', timestamp: 5 })).toBe('5:boom')
    expect(turnErrorKeyOf({ errorMessage: 'boom', timestamp: 5 })).not.toBe(turnErrorKeyOf({ errorMessage: 'boom', timestamp: 6 }))
    expect(turnErrorKeyOf({ errorMessage: undefined, timestamp: 0 })).toBe('0:')
  })

  it('shows a plain error first and transitions to retrying only after a retry click', () => {
    const tracker = createTurnErrorTracker()
    expect(tracker.observe(true, false, firstKey)).toEqual({ retrying: false, escalated: false, retryCount: 0 })

    tracker.noteRetryClicked(firstKey)
    expect(tracker.observe(true, false, firstKey)).toEqual({ retrying: true, escalated: false, retryCount: 1 })
  })

  it('escalates when a new error follows a retried one and keeps counting', () => {
    const tracker = createTurnErrorTracker()
    tracker.noteRetryClicked(firstKey)
    expect(tracker.observe(true, false, secondKey)).toEqual({ retrying: false, escalated: true, retryCount: 1 })

    tracker.noteRetryClicked(secondKey)
    expect(tracker.observe(true, false, firstKey)).toEqual({ retrying: false, escalated: true, retryCount: 2 })
  })

  it('resets once streaming recovers, even while the retried error is still presented', () => {
    const tracker = createTurnErrorTracker()
    tracker.noteRetryClicked(firstKey)
    // 重试成功：错误被裁剪后开始流式 → 清零。
    expect(tracker.observe(false, true, '')).toEqual({ retrying: false, escalated: false, retryCount: 0 })
    expect(tracker.observe(true, false, secondKey)).toEqual({ retrying: false, escalated: false, retryCount: 0 })
  })

  it('keeps the count while a retry outcome is pending (error trimmed, not yet streaming)', () => {
    const tracker = createTurnErrorTracker()
    tracker.noteRetryClicked(firstKey)
    expect(tracker.observe(false, false, '')).toEqual({ retrying: false, escalated: false, retryCount: 1 })
  })

  it('resets when the error disappears without a pending retry (user moved on)', () => {
    const tracker = createTurnErrorTracker()
    tracker.noteRetryClicked(firstKey)
    tracker.observe(true, false, secondKey) // escalated, pending cleared
    expect(tracker.observe(false, false, '')).toEqual({ retrying: false, escalated: false, retryCount: 0 })
  })

  it('starts fresh per tracker instance (per chat panel / agent)', () => {
    const first = createTurnErrorTracker()
    const second = createTurnErrorTracker()
    first.noteRetryClicked(firstKey)
    expect(second.observe(true, false, firstKey)).toEqual({ retrying: false, escalated: false, retryCount: 0 })
  })
})
