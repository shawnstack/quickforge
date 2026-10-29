import { describe, expect, it } from 'vitest'
import { rollbackStartIndexFromMessage } from '../../server/agent-manager.mjs'

// 前端 src/lib/message-utils.ts 有一份同构实现；本文件锁定服务端权威实现的行为，
// 两侧必须保持一致：回滚永远可用——非 user 索引回退到本轮 user（找不到就以自身
// 截断），索引 clamp 到有效范围；仅空会话 / 非有限数返回 -1（无操作）。
function message(role, extra = {}) {
  return { role, content: '', ...extra }
}

describe('rollbackStartIndexFromMessage (server)', () => {
  it('anchors on the clicked user message', () => {
    const messages = [
      message('user'),
      message('assistant'),
      message('user-with-attachments'),
      message('assistant'),
    ]

    expect(rollbackStartIndexFromMessage(messages, 0)).toBe(0)
    expect(rollbackStartIndexFromMessage(messages, 2)).toBe(2)
  })

  it('falls back to the turn-leading user message for an assistant message', () => {
    const messages = [
      message('user'),
      message('assistant'),
      message('user'),
      message('assistant'),
    ]

    expect(rollbackStartIndexFromMessage(messages, 1)).toBe(0)
    expect(rollbackStartIndexFromMessage(messages, 3)).toBe(2)
  })

  it('anchors on an orphan assistant turn instead of refusing to roll back', () => {
    const messages = [
      message('assistant', { stopReason: 'error', errorMessage: 'failed before user persisted' }),
      message('user'),
      message('assistant'),
    ]

    expect(rollbackStartIndexFromMessage(messages, 0)).toBe(0)
  })

  it('rolls a toolResult index back to its turn-leading user message', () => {
    const messages = [
      message('user'),
      message('assistant', { stopReason: 'toolUse' }),
      message('toolResult', { toolCallId: 'call-1' }),
      message('assistant', { stopReason: 'endTurn' }),
    ]

    expect(rollbackStartIndexFromMessage(messages, 2)).toBe(0)
  })

  it('clamps a drifted index into range instead of refusing', () => {
    const messages = [
      message('user'),
      message('assistant'),
      message('user'),
      message('assistant', { stopReason: 'endTurn' }),
    ]

    expect(rollbackStartIndexFromMessage(messages, 99)).toBe(2)
    expect(rollbackStartIndexFromMessage(messages, -7)).toBe(0)
    expect(rollbackStartIndexFromMessage(messages, 1.9)).toBe(0)
  })

  it('returns -1 (no-op) only for empty conversations or non-finite input', () => {
    expect(rollbackStartIndexFromMessage([], 0)).toBe(-1)
    expect(rollbackStartIndexFromMessage(undefined, 0)).toBe(-1)
    expect(rollbackStartIndexFromMessage([message('user')], 'x')).toBe(-1)
  })
})
