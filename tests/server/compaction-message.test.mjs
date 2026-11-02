import { describe, expect, it, vi } from 'vitest'

// 只替换模型摘要调用与磁盘备份，保留真实的 details / 摘要解析实现。
const control = { failNext: false }
vi.mock('../../server/conversation-compaction.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    compactConversation: vi.fn(async () => {
      if (control.failNext) throw new Error('summary failed')
      return { summary: 'rolling summary' }
    }),
    saveCompactBackup: vi.fn(async () => {}),
  }
})

const {
  buildAutoCompactLoopMessages,
  compactSessionInPlace,
  ensureCompactionMessage,
  lastCompactionMessageIndex,
} = await import('../../server/auto-compaction.mjs')
const { isCompactSummaryMessage } = await import('../../server/conversation-compaction.mjs')

function textMessage(role, text, timestamp) {
  return { role, content: [{ type: 'text', text }], timestamp }
}

function createSession(messages) {
  return {
    sessionId: 'session-compaction-message',
    model: { provider: 'test', id: 'test-model', contextWindow: 200000, maxTokens: 8192 },
    thinkingLevel: 'off',
    getApiKey: async () => 'test-key',
    contextCompaction: null,
    agent: { state: { systemPrompt: 'system prompt', messages, tools: [] } },
  }
}

function summaryMessage(text = 'legacy summary') {
  return {
    role: 'user',
    content: [{ type: 'text', text: '<compact_summary>' + text + '</compact_summary>' }],
    details: { quickforgeCompaction: { version: 1, kind: 'summary', compactedAt: '2026-01-01T00:00:00.000Z' } },
    timestamp: 100,
  }
}

describe('compaction message (plan B)', () => {
  it('inserts the summary as a real message at the compaction point (the array end)', async () => {
    const messages = [
      textMessage('user', 'q1', 1),
      textMessage('assistant', 'a1', 2),
      textMessage('user', 'q2', 3),
      textMessage('assistant', 'a2', 4),
    ]
    const session = createSession(messages)

    const result = await compactSessionInPlace({ session, messages, reason: 'auto_compact' })

    expect(result.compacted).toBe(true)
    const next = session.agent.state.messages
    expect(next).toHaveLength(5)
    // 压缩点 = 压缩发生那一刻的数组末尾，摘要消息就是最后一行：线以上的
    // 全部历史（含本轮用户回合）并入摘要，之后的流式消息排在线下方。
    expect(isCompactSummaryMessage(next[4])).toBe(true)
    expect(next[4].details.quickforgeCompaction.kind).toBe('summary')
    // 插入点之前的消息原样保留（纯追加，不是重建）。
    expect(next.slice(0, 4)).toEqual(messages)
    // 派生下标 = 压缩消息下标 + 1。
    expect(session.contextCompaction.compactedUpToIndex).toBe(5)
    expect(session.contextCompaction.sourceMessageCount).toBe(5)
  })

  it('appends the divider after an in-flight tool chain instead of hoisting it above the user turn', async () => {
    const messages = [
      textMessage('user', 'current request', 1),
      { role: 'assistant', content: [{ type: 'toolCall', name: 'grep', arguments: { query: 'x' } }], timestamp: 2 },
      { role: 'toolResult', toolCallId: 'tc1', content: [{ type: 'text', text: 'hits' }], timestamp: 3 },
    ]
    const session = createSession(messages)

    const result = await compactSessionInPlace({ session, messages, reason: 'auto_compact' })

    expect(result.compacted).toBe(true)
    const next = session.agent.state.messages
    // run 内压缩发生在工具链之后：线在链尾，而不是被抬到用户消息上方。
    expect(isCompactSummaryMessage(next[3])).toBe(true)
    expect(next[3]).toBe(result.messages.at(-1))
    // 模型上下文 = 摘要 + 线后新消息；线以上不再重放。
    expect(buildAutoCompactLoopMessages(session, next)).toEqual([next[3]])
  })

  it('leaves messages untouched when the summary call fails', async () => {
    control.failNext = true
    const messages = [textMessage('user', 'q1', 1), textMessage('assistant', 'a1', 2)]
    const session = createSession(messages)

    await expect(compactSessionInPlace({ session, messages, reason: 'auto_compact' }))
      .rejects.toThrow('summary failed')

    expect(session.agent.state.messages).toEqual(messages)
    expect(session.contextCompaction).toBeNull()
    control.failNext = false
  })

  it('builds the model context from the last compaction message', () => {
    const first = summaryMessage('one')
    const second = { ...summaryMessage('two'), timestamp: 200 }
    const messages = [
      textMessage('user', 'q1', 1),
      first,
      textMessage('assistant', 'a1', 2),
      second,
      textMessage('assistant', 'a2', 3),
    ]
    const session = createSession(messages)

    const loop = buildAutoCompactLoopMessages(session, messages)

    // 只剩「最后一条压缩消息 + 它之后的回答」。
    expect(loop).toHaveLength(2)
    expect(loop[0]).toBe(second)
    expect(lastCompactionMessageIndex(messages)).toBe(3)
  })

  it('falls back to the virtual summary for sessions that were never migrated', () => {
    const messages = [textMessage('user', 'q1', 1), textMessage('assistant', 'a1', 2)]
    const summary = summaryMessage('legacy')
    const session = {
      ...createSession(messages),
      contextCompaction: { summaryMessage: summary, compactedUpToIndex: 1, sourceMessageCount: 2 },
    }

    const loop = buildAutoCompactLoopMessages(session, messages)

    expect(loop[0]).toBe(summary)
    expect(loop).toHaveLength(2)
  })

  it('migrates a legacy session once and stays idempotent', () => {
    const messages = [textMessage('user', 'q1', 1), textMessage('assistant', 'a1', 2), textMessage('user', 'q2', 3)]
    const summary = summaryMessage('legacy')
    const session = createSession(messages)
    session.contextCompaction = {
      summaryMessage: summary,
      compactedUpToIndex: 2,
      compactedAt: '2026-01-01T00:00:00.000Z',
      sourceMessageCount: 3,
      history: [{ occurredAtIndex: 2, boundaryIndex: 2, summaryMessage: summary }],
    }

    expect(ensureCompactionMessage(session)).toBe(true)
    expect(session.agent.state.messages).toHaveLength(4)
    expect(isCompactSummaryMessage(session.agent.state.messages[2])).toBe(true)
    expect(session.contextCompaction.compactedUpToIndex).toBe(3)

    // 再跑一次不再改动（幂等）。
    expect(ensureCompactionMessage(session)).toBe(false)
    expect(session.agent.state.messages).toHaveLength(4)
  })
})
