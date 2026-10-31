import { describe, expect, it } from 'vitest'
import { messageRenderKeys } from '../../src/components/chat/surface/content-parts'
import { createRenderKeyIndex } from '../../src/components/chat/surface/render-key-index'
import type { AgentMessage } from '../../src/components/chat/surface/ChatTypes'

function assistant(timestamp: number, text = 'hi'): AgentMessage {
  return { role: 'assistant', timestamp, content: [{ type: 'text', text }] } as unknown as AgentMessage
}

function user(timestamp: number, text = 'q'): AgentMessage {
  return { role: 'user', timestamp, content: text } as unknown as AgentMessage
}

describe('render key index', () => {
  it('produces exactly the keys of messageRenderKeys', () => {
    const messages = [
      user(1),
      assistant(2),
      // 同一 timestamp 重复：靠 occurrence 后缀区分。
      assistant(2, 'again'),
      user(3),
      assistant(3),
    ]
    expect(createRenderKeyIndex(messages).keys).toEqual(messageRenderKeys(messages))
  })

  it('derives the appended key exactly as the combined array would', () => {
    const messages = [user(1), assistant(2), assistant(2, 'again')]
    const index = createRenderKeyIndex(messages)
    // 与已有 identity 相同（重复 timestamp）→ 必须带 occurrence 后缀。
    const duplicate = assistant(2, 'third')
    const fresh = assistant(9)
    const combined = (message: AgentMessage) => messageRenderKeys([...messages, message])[messages.length]
    expect(index.appendKey(duplicate)).toBe(combined(duplicate))
    expect(index.appendKey(fresh)).toBe(combined(fresh))
  })

  it('keeps appendKey read-only so the same row keeps its key across frames', () => {
    const messages = [user(1), assistant(2)]
    const index = createRenderKeyIndex(messages)
    const streaming = assistant(2, 'partial')
    const first = index.appendKey(streaming)
    // 流式期间同一行每帧都会重新推导 key：值必须稳定，否则 React 每帧重挂整行。
    expect(index.appendKey(streaming)).toBe(first)
    expect(index.appendKey(streaming)).toBe(first)
    // 也不污染已提交行的 key。
    expect(index.keys).toEqual(messageRenderKeys(messages))
  })
})
