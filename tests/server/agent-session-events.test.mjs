import { describe, expect, it } from 'vitest'
import { appendAssistantErrorMessageOnce } from '../../server/agent-manager.mjs'

// 自 agent-harness.test.mjs 迁移（该文件随 harness 概念删除）；本用例只覆盖
// agent-session-events 的通用错误消息追加行为，与 harness 无关。
describe('agent session events', () => {
  it('does not append a duplicate assistant error message', () => {
    const existing = [{ role: 'assistant', stopReason: 'error', errorMessage: 'failed' }]
    expect(appendAssistantErrorMessageOnce(existing, 'failed', null)).toBe(existing)
    expect(appendAssistantErrorMessageOnce([], 'failed', null)).toEqual([
      expect.objectContaining({ role: 'assistant', stopReason: 'error', errorMessage: 'failed' }),
    ])
  })
})
