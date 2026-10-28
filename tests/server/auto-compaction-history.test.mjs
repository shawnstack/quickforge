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

const { compactSessionInPlace, MAX_CONTEXT_COMPACTION_HISTORY } = await import('../../server/auto-compaction.mjs')

function textMessage(role, text, timestamp) {
  return { role, content: [{ type: 'text', text }], timestamp }
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
      keepRecentTurns: 0,
      reason: 'auto_compact',
    })
    expect(first.compacted).toBe(true)
    const firstHistory = session.contextCompaction.history
    expect(firstHistory).toHaveLength(1)
    // The divider anchor is the messages length at the instant it ran ...
    expect(firstHistory[0].occurredAtIndex).toBe(2)
    // ... and the range edge may differ once recent turns are kept.
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
      keepRecentTurns: 0,
      reason: 'auto_compact',
    })
    expect(second.compacted).toBe(true)
    const history = session.contextCompaction.history
    // The first line is never replaced: a second compaction adds a line.
    expect(history).toHaveLength(2)
    expect(history[0].occurredAtIndex).toBe(2)
    expect(history[1].occurredAtIndex).toBe(5)
    // Legacy single-record fields still describe the newest compaction.
    expect(session.contextCompaction.compactedUpToIndex).toBe(5)
    expect(session.contextCompaction.compactedAt).toBe(history[1].compactedAt)
  })

  it('records a range edge earlier than the moment it ran when recent turns are kept', async () => {
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
      keepRecentTurns: 1,
      reason: 'auto_compact',
    })

    expect(result.compacted).toBe(true)
    const entry = session.contextCompaction.history[0]
    // Kept turn starts at message 2, but the compaction physically ran at the end.
    expect(entry.boundaryIndex).toBe(2)
    expect(entry.occurredAtIndex).toBe(4)
  })

  it('still compacts a single-user-turn session with an empty tail', async () => {
    // The only user turn starts at index 0, so keeping "one turn" keeps
    // everything. Compaction must run with an empty tail instead of returning
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
      keepRecentTurns: 1,
      reason: 'auto_compact',
    })

    expect(result.compacted).toBe(true)
    expect(result.tailStart).toBe(messages.length)
    expect(session.contextCompaction.history[0].occurredAtIndex).toBe(messages.length)
    expect(session.contextCompaction.history[0].boundaryIndex).toBe(messages.length)
  })

  it('caps the history so a long session cannot grow the body without bound', async () => {
    const messages = [textMessage('user', 'question', 1), textMessage('assistant', 'answer', 2)]
    const session = createSession(messages)
    session.contextCompaction = {
      compactedUpToIndex: 0,
      history: Array.from({ length: MAX_CONTEXT_COMPACTION_HISTORY }, (_, index) => ({
        compactedAt: new Date(index).toISOString(),
        occurredAtIndex: 100 + index,
        boundaryIndex: 100 + index,
      })),
    }

    await compactSessionInPlace({ session, messages, keepRecentTurns: 0, reason: 'auto_compact' })

    const history = session.contextCompaction.history
    expect(history).toHaveLength(MAX_CONTEXT_COMPACTION_HISTORY)
    // Oldest entry dropped, newest appended.
    expect(history[0].occurredAtIndex).toBe(101)
    expect(history.at(-1).occurredAtIndex).toBe(2)
  })
})
