import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTO_COMPACT_SETTINGS,
  DEFAULT_MAX_TAIL_CHARS,
  buildAutoCompactLoopMessages,
  estimateSessionContextUsage,
  hasNewMessagesSinceCompaction,
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

  it('recomputes compacted usage without stale provider usage from the preserved tail', () => {
    const messages = [
      textMessage('user', 'old question '.repeat(1000)),
      textMessage('assistant', 'old answer '.repeat(1000)),
      textMessage('user', 'recent question'),
      {
        ...textMessage('assistant', 'recent answer'),
        stopReason: 'stop',
        usage: { input: 70_000, output: 2_000, cacheRead: 0, cacheWrite: 0, totalTokens: 72_000 },
      },
    ]
    const session = {
      model: { contextWindow: 100_000, maxTokens: 4_000 },
      agent: { state: { systemPrompt: '', tools: [], messages } },
      contextCompaction: {
        summaryMessage: textMessage('user', 'short compact summary'),
        compactedUpToIndex: 2,
        sourceMessageCount: messages.length,
        compactedAt: new Date().toISOString(),
      },
    }

    const usage = estimateSessionContextUsage(session, messages)

    expect(usage.inputTokenSource).toBe('estimated')
    expect(usage.knownInputTokens).toBe(0)
    expect(usage.breakdown.providerUsageTokens).toBe(0)
    expect(usage.percent).toBeLessThan(10)
  })

  it('uses provider usage again after a new assistant response on the compacted context', () => {
    const messages = [
      textMessage('user', 'old question'),
      textMessage('assistant', 'old answer'),
      textMessage('user', 'recent question'),
      {
        ...textMessage('assistant', 'recent answer'),
        stopReason: 'stop',
        usage: { input: 70_000, output: 2_000, cacheRead: 0, cacheWrite: 0, totalTokens: 72_000 },
      },
      textMessage('user', 'next question'),
      {
        ...textMessage('assistant', 'next answer'),
        stopReason: 'stop',
        usage: { input: 8_000, output: 500, cacheRead: 0, cacheWrite: 0, totalTokens: 8_500 },
      },
    ]
    const session = {
      model: { contextWindow: 100_000, maxTokens: 4_000 },
      agent: { state: { systemPrompt: '', tools: [], messages } },
      contextCompaction: {
        summaryMessage: textMessage('user', 'short compact summary'),
        compactedUpToIndex: 2,
        sourceMessageCount: 4,
        compactedAt: new Date(Date.now() - 1000).toISOString(),
      },
    }

    const usage = estimateSessionContextUsage(session, messages)

    expect(usage.inputTokenSource).toBe('provider')
    expect(usage.knownInputTokens).toBe(8_500)
    expect(usage.breakdown.providerUsageTokens).toBe(8_500)
    expect(usage.percent).toBe(8.5)
  })

  it('restores provider usage from a replayed assistant after rollback', () => {
    const compactedAt = Date.now() - 1000
    const messages = [
      { ...textMessage('user', 'old question'), timestamp: compactedAt - 5000 },
      { ...textMessage('assistant', 'old answer'), timestamp: compactedAt - 4000 },
      { ...textMessage('user', 'recent question'), timestamp: compactedAt - 3000 },
      {
        ...textMessage('assistant', 'recent answer'),
        timestamp: compactedAt - 2000,
        stopReason: 'stop',
        usage: { input: 70_000, output: 2_000, cacheRead: 0, cacheWrite: 0, totalTokens: 72_000 },
      },
      { ...textMessage('user', 'replayed question'), timestamp: compactedAt + 100 },
      {
        ...textMessage('assistant', 'replayed answer'),
        timestamp: compactedAt + 200,
        stopReason: 'stop',
        usage: { input: 9_000, output: 500, cacheRead: 0, cacheWrite: 0, totalTokens: 9_500 },
      },
    ]
    const session = {
      model: { contextWindow: 100_000, maxTokens: 4_000 },
      agent: { state: { systemPrompt: '', tools: [], messages } },
      contextCompaction: {
        summaryMessage: textMessage('user', 'short compact summary'),
        compactedUpToIndex: 2,
        sourceMessageCount: messages.length,
        compactedAt: new Date(compactedAt).toISOString(),
      },
    }

    const usage = estimateSessionContextUsage(session, messages)

    expect(usage.inputTokenSource).toBe('provider')
    expect(usage.knownInputTokens).toBe(9_500)
  })

  it('computes percent from input tokens only when model maxTokens exceeds the context window', () => {
    // 退化场景：maxTokens(120_000) ≥ contextWindow(100_000)。纯输入口径下占用只看
    // inputTokens（provider usage 的 totalTokens 口径，31_000），
    // 不再叠加预留输出 token；totalTokens 恒等于 inputTokens。
    const messages = [
      textMessage('user', 'question'),
      {
        ...textMessage('assistant', 'answer'),
        stopReason: 'stop',
        usage: { input: 30_000, output: 1_000, cacheRead: 0, cacheWrite: 0, totalTokens: 31_000 },
      },
    ]
    const session = {
      model: { contextWindow: 100_000, maxTokens: 120_000 },
      agent: { state: { systemPrompt: '', tools: [], messages } },
    }

    const usage = estimateSessionContextUsage(session, messages)

    expect(usage.inputTokens).toBe(31_000)
    expect(usage.totalTokens).toBe(31_000)
    expect(usage.percent).toBe(31)
    expect('reservedOutputTokens' in usage).toBe(false)
    expect('reservedOutputTokens' in usage.breakdown).toBe(false)
  })

  it('keeps percent below 100 when the input nearly fills the context window', () => {
    // 溢出场景：输入(97_000) 接近窗口(100_000)，纯输入口径 percent = 97，
    // 不再因预留输出把百分比推到恒 ≥100%。
    const messages = [
      textMessage('user', 'question'),
      {
        ...textMessage('assistant', 'answer'),
        stopReason: 'stop',
        usage: { input: 96_000, output: 1_000, cacheRead: 0, cacheWrite: 0, totalTokens: 97_000 },
      },
    ]
    const session = {
      model: { contextWindow: 100_000, maxTokens: 8_000 },
      agent: { state: { systemPrompt: '', tools: [], messages } },
    }

    const usage = estimateSessionContextUsage(session, messages)

    expect(usage.inputTokens).toBe(97_000)
    expect(usage.percent).toBe(97)
    expect(usage.percent).toBeLessThan(100)
  })

  it('allows the next compaction check as soon as one new message exists', () => {
    const session = {
      contextCompaction: {
        summaryMessage: textMessage('user', 'summary'),
        sourceMessageCount: 4,
        compactedAt: new Date(Date.now() - 1000).toISOString(),
      },
    }
    const messages = [
      textMessage('user', 'u1'),
      textMessage('assistant', 'a1'),
      textMessage('user', 'u2'),
      textMessage('assistant', 'a2'),
    ]

    expect(hasNewMessagesSinceCompaction(session, messages)).toBe(false)
    expect(hasNewMessagesSinceCompaction(session, [...messages, textMessage('user', 'u3')])).toBe(true)
  })

  it('falls back to message timestamps for legacy compaction metadata without sourceMessageCount', () => {
    const compactedAt = Date.now() - 1000
    const session = {
      contextCompaction: {
        summaryMessage: textMessage('user', 'summary'),
        compactedAt: new Date(compactedAt).toISOString(),
      },
    }

    expect(hasNewMessagesSinceCompaction(session, [{ ...textMessage('user', 'old'), timestamp: compactedAt - 1 }])).toBe(false)
    expect(hasNewMessagesSinceCompaction(session, [{ ...textMessage('user', 'new'), timestamp: compactedAt + 1 }])).toBe(true)
  })

  it('falls back to the second user turn when the budget is effectively unlimited', () => {
    const messages = []
    messages.push(textMessage('user', 'start'))
    for (let i = 0; i < 100; i += 1) messages.push(toolMessage('assistant'), toolMessage('toolResult'))
    messages.push(textMessage('user', 'latest question'))

    expect(tailStartForRecentTurns(messages, 2, Infinity)).toBe(0)
  })
})
