import { describe, expect, it, vi } from 'vitest'

// Keep the real helpers (compactionMessageDetails / extractCompactSummaryText),
// stub only the model round-trip and the on-disk backup.
vi.mock('../../server/conversation-compaction.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    compactConversation: vi.fn(async () => ({ summary: 'rolling summary' })),
    saveCompactBackup: vi.fn(async () => {}),
  }
})

const {
  buildAutoCompactLoopMessages,
  compactSessionInPlace,
  estimateSessionContextUsage,
} = await import('../../server/auto-compaction.mjs')

function textMessage(role, text, timestamp) {
  return { role, content: [{ type: 'text', text }], timestamp }
}

function summaryStub(text) {
  return {
    role: 'user',
    content: [{ type: 'text', text: `<compact_summary>${text}</compact_summary>` }],
    details: { quickforgeCompaction: { version: 1, kind: 'summary' } },
    timestamp: 0,
  }
}

function createSession(messages) {
  return {
    sessionId: 'session-history-1',
    model: { provider: 'test', id: 'test-model', contextWindow: 200000, maxTokens: 8192 },
    thinkingLevel: 'off',
    getApiKey: async () => 'test-key',
    contextCompaction: null,
    agent: { state: { systemPrompt: 'system prompt', messages, tools: [] } },
  }
}

/**
 * pi-agent-core runs on a copy of the messages taken when the run starts. When
 * that copy already holds a summary from an earlier run, a compaction during
 * this run lands only in state, so the copy's last summary is the stale one.
 */
describe('compaction during a run whose snapshot already holds an older summary', () => {
  function startRun() {
    const oldSummary = summaryStub('old summary')
    const stateMessages = [
      textMessage('user', 'early request', 1),
      oldSummary,
      textMessage('user', 'current request', 2),
      textMessage('assistant', 'x'.repeat(4000), 3),
    ]
    const session = createSession(stateMessages)
    session.contextCompaction = {
      summaryMessage: oldSummary,
      compactedUpToIndex: 2,
      sourceMessageCount: 2,
      compactedAt: new Date(1).toISOString(),
    }
    return { session, oldSummary, snapshot: stateMessages.slice() }
  }

  // The loop appends each new message to its copy and to state.
  function appendToRun(session, snapshot, ...messages) {
    snapshot.push(...messages)
    session.agent.state.messages.push(...messages)
  }

  function assistantWithUsage(text, totalTokens) {
    return {
      ...textMessage('assistant', text, Date.now() + 1000),
      stopReason: 'stop',
      usage: { input: totalTokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens },
    }
  }

  it('sends the new summary instead of the stale one from the snapshot', async () => {
    const { session, oldSummary, snapshot } = startRun()

    await compactSessionInPlace({ session, messages: snapshot, reason: 'auto_compact' })
    const newSummary = session.contextCompaction.summaryMessage
    expect(newSummary).not.toBe(oldSummary)
    expect(buildAutoCompactLoopMessages(session, snapshot)).toEqual([newSummary])

    const next = assistantWithUsage('continued work', 1234)
    appendToRun(session, snapshot, next)
    const loop = buildAutoCompactLoopMessages(session, snapshot)
    expect(loop).toEqual([newSummary, next])
    expect(loop).not.toContain(oldSummary)
  })

  it('counts the provider usage reported after the compaction', async () => {
    const { session, snapshot } = startRun()

    await compactSessionInPlace({ session, messages: snapshot, reason: 'auto_compact' })
    appendToRun(session, snapshot, assistantWithUsage('continued work', 1234))

    // Same accounting the threshold check uses on the loop's copy. Getting the
    // compaction point wrong here reads as "unknown" and stops compaction.
    const usage = estimateSessionContextUsage(session, snapshot)
    expect(usage.inputTokenSource).toBe('provider')
    expect(usage.inputTokens).toBe(1234)
  })

  it('keeps only the latest summary after a second compaction in the same run', async () => {
    const { session, oldSummary, snapshot } = startRun()

    await compactSessionInPlace({ session, messages: snapshot, reason: 'auto_compact' })
    const firstInRunSummary = session.contextCompaction.summaryMessage
    appendToRun(session, snapshot, assistantWithUsage('more work', 1234))

    await compactSessionInPlace({ session, messages: snapshot, reason: 'auto_compact' })
    const latestSummary = session.contextCompaction.summaryMessage
    expect(latestSummary).not.toBe(firstInRunSummary)

    const next = assistantWithUsage('after second compaction', 2000)
    appendToRun(session, snapshot, next)
    const loop = buildAutoCompactLoopMessages(session, snapshot)
    expect(loop).toEqual([latestSummary, next])
    expect(loop).not.toContain(oldSummary)
    expect(loop).not.toContain(firstInRunSummary)
  })

  it('still reads from the summary once the next run snapshot includes it', async () => {
    const { session, snapshot } = startRun()

    await compactSessionInPlace({ session, messages: snapshot, reason: 'auto_compact' })
    const newSummary = session.contextCompaction.summaryMessage
    const nextRunSnapshot = session.agent.state.messages.slice()

    expect(buildAutoCompactLoopMessages(session, nextRunSnapshot)).toEqual([newSummary])
  })
})

/**
 * Rolling compaction appends one record per pass instead of overwriting the
 * single record, so the timeline can render one divider per compaction at the
 * moment each one really happened.
 */
describe('contextCompaction.history', () => {
  it('appends one entry per compaction with the physical position it ran at', async () => {
    const messages = [textMessage('user', 'question', 1), textMessage('assistant', 'answer', 2)]
    const session = createSession(messages)

    const first = await compactSessionInPlace({
      session,
      messages,
      reason: 'auto_compact',
    })
    expect(first.compacted).toBe(true)
    const firstHistory = session.contextCompaction.history
    expect(firstHistory).toHaveLength(1)
    // The divider anchor is the messages length at the instant it ran; with the
    // cut anchored at the compaction point the boundary is the same coordinate.
    expect(firstHistory[0].occurredAtIndex).toBe(2)
    expect(firstHistory[0].boundaryIndex).toBe(2)
    expect(typeof firstHistory[0].compactedAt).toBe('string')

    messages.push(
      textMessage('assistant', 'tool call', 3),
      textMessage('toolResult', 'tool output', 4),
      textMessage('assistant', 'more', 5),
    )

    const second = await compactSessionInPlace({
      session,
      messages,
      reason: 'auto_compact',
    })
    expect(second.compacted).toBe(true)
    const history = session.contextCompaction.history
    // The first line is never replaced: a second compaction adds a line.
    expect(history).toHaveLength(2)
    expect(history[0].occurredAtIndex).toBe(2)
    expect(history[1].occurredAtIndex).toBe(5)
    // Legacy single-record fields still describe the newest compaction.
    // 插入压缩消息后 tail 的起点是「压缩消息下标 + 1」。
    expect(session.contextCompaction.compactedUpToIndex).toBe(6)
    expect(session.contextCompaction.compactedAt).toBe(history[1].compactedAt)
  })

  it('records the compaction point as both the boundary and the divider anchor', async () => {
    const messages = [
      textMessage('user', 'first question', 1),
      textMessage('assistant', 'first answer', 2),
      textMessage('user', 'second question', 3),
      textMessage('assistant', 'second answer', 4),
    ]
    const session = createSession(messages)

    const result = await compactSessionInPlace({
      session,
      messages,
      reason: 'auto_compact',
    })

    expect(result.compacted).toBe(true)
    const entry = session.contextCompaction.history[0]
    // 压缩点 = 当时数组末尾（index 4）：线锚与摘要边界是同一个坐标，
    // 用户回合不再被整轮保留在线下方。
    expect(entry.occurredAtIndex).toBe(4)
    expect(entry.boundaryIndex).toBe(4)
    const inserted = session.agent.state.messages[4]
    expect(inserted.details.quickforgeCompaction.kind).toBe('summary')
    expect(session.contextCompaction.compactedUpToIndex).toBe(5)
  })

  it('still compacts a single-user-turn session with an empty tail', async () => {
    // The only user turn starts at index 0 and the whole history (including it)
    // is summarized. Compaction must run instead of returning
    // `not_enough_history` forever.
    const messages = [
      textMessage('user', 'question', 1),
      textMessage('assistant', 'answer', 2),
      textMessage('toolResult', 'tool output', 3),
      textMessage('assistant', 'more', 4),
    ]
    const session = createSession(messages)

    const result = await compactSessionInPlace({
      session,
      messages,
      reason: 'auto_compact',
    })

    expect(result.compacted).toBe(true)
    expect(result.tailStart).toBe(messages.length)
    expect(session.contextCompaction.history[0].occurredAtIndex).toBe(messages.length)
    expect(session.contextCompaction.history[0].boundaryIndex).toBe(messages.length)
  })

  it('keeps every compaction record instead of truncating the history', async () => {
    const EXISTING = 25
    const messages = [textMessage('user', 'question', 1), textMessage('assistant', 'answer', 2)]
    const session = createSession(messages)
    session.contextCompaction = {
      compactedUpToIndex: 0,
      history: Array.from({ length: EXISTING }, (_, index) => ({
        compactedAt: new Date(index).toISOString(),
        occurredAtIndex: 100 + index,
        boundaryIndex: 100 + index,
        summaryMessage: summaryStub(`old ${index}`),
      })),
    }

    await compactSessionInPlace({ session, messages, reason: 'auto_compact' })

    const history = session.contextCompaction.history
    // 每一次压缩都是独立过程：不截断、不覆盖，最新一条追加在末尾。
    expect(history).toHaveLength(EXISTING + 1)
    expect(history[0].occurredAtIndex).toBe(100)
    // 旧记录自带当次摘要，回滚删掉消息后仍然保留。
    expect(history[0].summaryMessage).toBeDefined()
    expect(history.at(-1).occurredAtIndex).toBe(2)
    expect(history.at(-1).summaryMessage).toBe(session.contextCompaction.summaryMessage)
  })
})
