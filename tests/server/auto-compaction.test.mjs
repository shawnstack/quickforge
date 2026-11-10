import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTO_COMPACT_SETTINGS,
  buildAutoCompactLoopMessages,
  estimateSessionContextUsage,
  hasNewMessagesSinceCompaction,
  normalizeAutoCompactSettings,
} from '../../server/auto-compaction.mjs'

describe('auto compact settings', () => {
  it('defaults to enabled and preserves explicit settings', () => {
    expect(normalizeAutoCompactSettings(null)).toEqual(DEFAULT_AUTO_COMPACT_SETTINGS)
    expect(normalizeAutoCompactSettings({})).toEqual({
      enabled: true,
      thresholdPercent: 80,
    })
    expect(normalizeAutoCompactSettings({ enabled: false, thresholdPercent: 90 })).toEqual({
      enabled: false,
      thresholdPercent: 90,
    })
    // 旧存储里的 keepRecentTurns 已随「压缩点锚定」移除：读取时直接丢弃。
    expect(normalizeAutoCompactSettings({ thresholdPercent: 85, keepRecentTurns: 7 })).toEqual({
      enabled: true,
      thresholdPercent: 85,
    })
    // 旧存储里的 requireConfirmation 也在「压缩不再询问」后移除，同样丢弃。
    expect(normalizeAutoCompactSettings({ thresholdPercent: 70, requireConfirmation: true })).toEqual({
      enabled: true,
      thresholdPercent: 70,
    })
  })
})

describe('buildAutoCompactLoopMessages', () => {
  function textMessage(role, text) {
    return { role, content: [{ type: 'text', text }] }
  }

  function toolMessage(role) {
    return { role, content: [{ type: role === 'assistant' ? 'toolCall' : 'toolResult', name: 'tool', arguments: { query: 'x'.repeat(80) } }] }
  }

  it('skips leading orphaned toolResults after compaction', () => {
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

  it('passes messages through unchanged without compaction', () => {
    const messages = [textMessage('user', 'u1'), textMessage('assistant', 'a1')]
    expect(buildAutoCompactLoopMessages({}, messages)).toBe(messages)
  })

  it('resolves the in-run loop snapshot that lacks the summary message', () => {
    // 压缩发生在 run 内：state 已追加摘要，loop 快照是压缩前的数组副本。
    // 快照里没有摘要 → 兼容分支必须把 compactedUpToIndex 平移回快照坐标，
    // 否则会把压缩后新产生的第一条消息从模型上下文里挤掉。
    const summaryMessage = textMessage('user', 'summary')
    const preCompaction = [textMessage('user', 'request'), textMessage('assistant', 'tool call 0')]
    const stateMessages = [...preCompaction, summaryMessage]
    const session = {
      agent: { state: { messages: stateMessages } },
      contextCompaction: {
        summaryMessage,
        compactedUpToIndex: stateMessages.length,
        sourceMessageCount: stateMessages.length,
        compactedAt: new Date().toISOString(),
      },
    }

    // 压缩刚完成、还没有新消息：上下文就是摘要本身。
    expect(buildAutoCompactLoopMessages(session, preCompaction.slice())).toEqual([summaryMessage])

    // run 继续产生的消息（含第一条）必须全部进入上下文。
    const grownSnapshot = [...preCompaction, textMessage('assistant', 'tool call 1'), { role: 'toolResult', toolCallId: 'tc1', content: [{ type: 'text', text: 'result' }] }]
    session.agent.state.messages = [...stateMessages, ...grownSnapshot.slice(preCompaction.length)]
    const loop = buildAutoCompactLoopMessages(session, grownSnapshot)
    expect(loop[0]).toBe(summaryMessage)
    expect(loop.slice(1)).toEqual(grownSnapshot.slice(preCompaction.length))
  })

  it('does not shift when the snapshot already contains the summary', () => {
    // 下一次 run 的快照来自 state（含摘要）：主分支直接从最后一条摘要切片。
    const summaryMessage = textMessage('user', 'summary')
    const snapshot = [
      textMessage('user', 'old'),
      summaryMessage,
      textMessage('user', 'new request'),
      textMessage('assistant', 'answer'),
    ]
    const session = {
      agent: { state: { messages: snapshot } },
      contextCompaction: {
        summaryMessage,
        compactedUpToIndex: 2,
        sourceMessageCount: 2,
        compactedAt: new Date().toISOString(),
      },
    }

    expect(buildAutoCompactLoopMessages(session, snapshot)).toEqual([
      summaryMessage,
      snapshot[2],
      snapshot[3],
    ])
  })
})

describe('context usage after compaction', () => {
  function textMessage(role, text) {
    return { role, content: [{ type: 'text', text }] }
  }

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

    expect(usage.inputTokenSource).toBe('unavailable')
    expect(usage.breakdown.providerUsageTokens).toBe(0)
    expect(usage.inputTokens).toBe(0)
    expect(usage.percent).toBe(0)
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
    expect(usage.inputTokens).toBe(8_500)
    expect(usage.breakdown.providerUsageTokens).toBe(8_500)
    expect(usage.percent).toBe(8.5)
  })

  it('ignores stale provider usage in the tail when the summary is only a message', () => {
    // `/summary` 生成的新会话 = [摘要, 提示行, ...保留的最近几轮]，没有
    // `contextCompaction` 元数据；tail 里那条 assistant 还带着压缩前那次请求上报的
    // 72k usage。它不能被当成「当前上下文」，否则界面显示已压缩、百分比却不下降。
    const compactedAt = Date.now() - 1000
    const summary = {
      ...textMessage('user', 'The previous conversation has been compacted.\n<compact_summary>\nshort summary\n</compact_summary>'),
      details: { quickforgeCompaction: { version: 1, kind: 'summary' } },
      timestamp: compactedAt,
    }
    const messages = [
      summary,
      {
        ...textMessage('assistant', 'compaction notice'),
        details: { quickforgeCompaction: { version: 1, kind: 'notice' } },
        timestamp: compactedAt + 1,
      },
      { ...textMessage('user', 'recent question'), timestamp: compactedAt - 3000 },
      {
        ...textMessage('assistant', 'recent answer'),
        timestamp: compactedAt - 2000,
        stopReason: 'stop',
        usage: { input: 70_000, output: 2_000, cacheRead: 0, cacheWrite: 0, totalTokens: 72_000 },
      },
    ]
    const session = {
      model: { contextWindow: 100_000, maxTokens: 4_000 },
      agent: { state: { systemPrompt: '', tools: [], messages } },
    }

    const usage = estimateSessionContextUsage(session, messages)

    expect(usage.isCompacted).toBe(true)
    expect(usage.inputTokenSource).toBe('unavailable')
    expect(usage.breakdown.providerUsageTokens).toBe(0)
    expect(usage.inputTokens).toBe(0)
    expect(usage.percent).toBe(0)
  })

  it('uses provider usage again once a response lands after a message-only compaction point', () => {
    const compactedAt = Date.now() - 1000
    const summary = {
      ...textMessage('user', 'The previous conversation has been compacted.\n<compact_summary>\nshort summary\n</compact_summary>'),
      details: { quickforgeCompaction: { version: 1, kind: 'summary' } },
      timestamp: compactedAt,
    }
    const messages = [
      summary,
      {
        ...textMessage('assistant', 'compaction notice'),
        details: { quickforgeCompaction: { version: 1, kind: 'notice' } },
        timestamp: compactedAt + 1,
      },
      { ...textMessage('user', 'recent question'), timestamp: compactedAt - 3000 },
      {
        ...textMessage('assistant', 'recent answer'),
        timestamp: compactedAt - 2000,
        stopReason: 'stop',
        usage: { input: 70_000, output: 2_000, cacheRead: 0, cacheWrite: 0, totalTokens: 72_000 },
      },
      { ...textMessage('user', 'next question'), timestamp: compactedAt + 100 },
      {
        ...textMessage('assistant', 'next answer'),
        timestamp: compactedAt + 200,
        stopReason: 'stop',
        usage: { input: 8_000, output: 500, cacheRead: 0, cacheWrite: 0, totalTokens: 8_500 },
      },
    ]
    const session = {
      model: { contextWindow: 100_000, maxTokens: 4_000 },
      agent: { state: { systemPrompt: '', tools: [], messages } },
    }

    const usage = estimateSessionContextUsage(session, messages)

    expect(usage.inputTokenSource).toBe('provider')
    expect(usage.inputTokens).toBe(8_500)
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
    expect(usage.inputTokens).toBe(9_500)
  })

  it('computes percent from input tokens only when model maxTokens exceeds the context window', () => {
    // 退化场景：maxTokens(120_000) ≥ contextWindow(100_000)。纯输入口径下占用只看
    // inputTokens（provider usage 的 totalTokens 口径，31_000），不叠加预留输出 token。
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

  it('treats the message summary as the compaction point when metadata is missing', () => {
    // /summary 新会话与 fork 出来的压缩会话只有消息里的摘要，没有
    // contextCompaction 元数据。摘要后面跟着的是压缩前保留下来的最近几轮，
    // 不能因为「数组比摘要长」就认为有新内容——那会白压一次。
    const compactedAt = Date.now() - 1000
    const summaryMessage = {
      ...textMessage('user', 'compact summary'),
      timestamp: compactedAt,
      details: { quickforgeCompaction: { version: 1, kind: 'summary' } },
    }
    const noticeMessage = {
      ...textMessage('user', 'compacted notice'),
      timestamp: compactedAt + 1,
      details: { quickforgeCompaction: { version: 1, kind: 'notice' } },
    }
    const preservedTail = [
      { ...textMessage('user', 'recent question'), timestamp: compactedAt - 3000 },
      { ...textMessage('assistant', 'recent answer'), timestamp: compactedAt - 2000 },
    ]
    const session = {}

    expect(hasNewMessagesSinceCompaction(session, [summaryMessage, noticeMessage, ...preservedTail])).toBe(false)
    expect(hasNewMessagesSinceCompaction(session, [
      summaryMessage,
      noticeMessage,
      ...preservedTail,
      { ...textMessage('user', 'brand new question'), timestamp: compactedAt + 5000 },
    ])).toBe(true)
  })

  it('falls back to the tail length when nothing has timestamps', () => {
    const summaryMessage = {
      ...textMessage('user', 'compact summary'),
      details: { quickforgeCompaction: { version: 1, kind: 'summary' } },
    }
    const session = {}

    expect(hasNewMessagesSinceCompaction(session, [summaryMessage])).toBe(false)
    expect(hasNewMessagesSinceCompaction(session, [summaryMessage, textMessage('user', 'next')])).toBe(true)
  })
})
