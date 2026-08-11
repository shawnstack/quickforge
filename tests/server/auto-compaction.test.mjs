import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTO_COMPACT_SETTINGS,
  DEFAULT_MAX_TAIL_CHARS,
  buildAutoCompactLoopMessages,
  normalizeAutoCompactSettings,
  tailStartForRecentTurns,
} from '../../server/auto-compaction.mjs'

describe('auto compact settings', () => {
  it('defaults to enabled with confirmation and three recent turns while preserving explicit settings', () => {
    expect(normalizeAutoCompactSettings(null)).toEqual(DEFAULT_AUTO_COMPACT_SETTINGS)
    expect(normalizeAutoCompactSettings({})).toMatchObject({
      enabled: true,
      keepRecentTurns: 3,
      requireConfirmation: true,
    })
    expect(normalizeAutoCompactSettings({ enabled: false, keepRecentTurns: 2, requireConfirmation: false })).toMatchObject({
      enabled: false,
      keepRecentTurns: 2,
      requireConfirmation: false,
    })
  })
})

describe('tailStartForRecentTurns', () => {
  function textMessage(role, text) {
    return { role, content: [{ type: 'text', text }] }
  }

  function toolMessage(role) {
    return { role, content: [{ type: role === 'assistant' ? 'toolCall' : 'toolResult', name: 'tool', arguments: { query: 'x'.repeat(80) } }] }
  }

  it('keeps the last keepRecentTurns user turns in a normal conversation', () => {
    const messages = [
      textMessage('user', 'u1'),
      textMessage('assistant', 'a1'),
      textMessage('user', 'u2'),
      textMessage('assistant', 'a2'),
      textMessage('user', 'u3'),
      textMessage('assistant', 'a3'),
    ]
    expect(tailStartForRecentTurns(messages, 2)).toBe(2)
    expect(tailStartForRecentTurns(messages, 2, DEFAULT_MAX_TAIL_CHARS)).toBe(2)
  })

  it('does not walk back past the tail char budget when user turns are sparse among tool messages', () => {
    // 2 个 user 回合（index 0 与 102），中间夹大量工具消息；按回合数回溯会回到 0，
    // 预算截断应停留在更靠后的位置
    const messages = []
    messages.push(textMessage('user', 'start'))
    for (let i = 0; i < 100; i += 1) messages.push(toolMessage('assistant'), toolMessage('toolResult'))
    messages.push(textMessage('user', 'latest question'))
    for (let i = 0; i < 40; i += 1) messages.push(toolMessage('assistant'), toolMessage('toolResult'))

    const tailStart = tailStartForRecentTurns(messages, 2, 8000)
    expect(tailStart).toBeGreaterThan(100)
    expect(tailStart).toBeLessThan(messages.length)
  })

  it('aligns a tail char budget cut to the start of the containing user turn', () => {
    // 预算会在 latest question 后面的工具链中命中，但边界必须回到该轮 user，
    // 不能把 assistant/toolResult 链从中间切开。
    const messages = []
    messages.push(textMessage('user', 'start'))
    for (let i = 0; i < 100; i += 1) messages.push(toolMessage('assistant'), toolMessage('toolResult'))
    const latestUserIndex = messages.length
    messages.push(textMessage('user', 'latest question'))
    for (let i = 0; i < 40; i += 1) messages.push(toolMessage('assistant'), toolMessage('toolResult'))

    expect(tailStartForRecentTurns(messages, 2, 8000)).toBe(latestUserIndex)
    expect(messages[latestUserIndex].role).toBe('user')
  })

  it('buildAutoCompactLoopMessages skips leading orphaned toolResults after compaction', () => {
    const summaryMessage = textMessage('user', 'summary')
    const messages = [
      textMessage('user', 'start'),
      toolMessage('assistant'),
      toolMessage('toolResult'), // compactedUpToIndex 落在孤儿 toolResult 上（旧持久化数据）
      toolMessage('toolResult'),
      textMessage('assistant', 'answer'),
      textMessage('user', 'next'),
    ]
    const session = {
      contextCompaction: {
        summaryMessage,
        compactedUpToIndex: 3,
      },
    }
    const loopMessages = buildAutoCompactLoopMessages(session, messages)
    expect(loopMessages[0]).toBe(summaryMessage)
    expect(loopMessages[1].role).not.toBe('toolResult')
    expect(loopMessages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ])
  })

  it('buildAutoCompactLoopMessages passes messages through unchanged without compaction', () => {
    const messages = [textMessage('user', 'u1'), textMessage('assistant', 'a1')]
    expect(buildAutoCompactLoopMessages({}, messages)).toBe(messages)
  })

  it('falls back to the second user turn when the budget is effectively unlimited', () => {
    const messages = []
    messages.push(textMessage('user', 'start'))
    for (let i = 0; i < 100; i += 1) messages.push(toolMessage('assistant'), toolMessage('toolResult'))
    messages.push(textMessage('user', 'latest question'))

    expect(tailStartForRecentTurns(messages, 2, Infinity)).toBe(0)
  })
})
