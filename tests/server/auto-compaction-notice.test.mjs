import { beforeEach, describe, expect, it, vi } from 'vitest'

// `maybeAutoCompactSession` is the only place that decides whether a run needs a
// summarization round trip. It reads settings from storage and calls the
// summarizer, so both are mocked: these tests are about the *notice contract*
// (which phase is published when, and which outcome each path reports), not
// about token accounting.
vi.mock('../../server/storage.mjs', () => ({
  readStore: vi.fn(async () => ({
    'auto-compact-settings': {
      enabled: true,
      thresholdPercent: 50,
    },
  })),
}))
vi.mock('../../server/conversation-compaction.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    compactConversation: vi.fn(async () => ({ summary: 'summarized history', originalApproxChars: 4000, finalApproxChars: 800 })),
    saveCompactBackup: vi.fn(async () => '/backup.json'),
  }
})

const {
  COMPACTION_NOTICE_PHASES,
  maybeAutoCompactSession,
} = await import('../../server/auto-compaction.mjs')

function textMessage(role, size = 200) {
  return { role, content: [{ type: 'text', text: 'x'.repeat(size) }], timestamp: Date.now() }
}

/** A session whose context is already over the 50% threshold. */
function makeSession(overrides = {}) {
  return {
    sessionId: 'session-auto',
    model: { contextWindow: 1000 },
    thinkingLevel: 'off',
    getApiKey: async () => 'key',
    autoCompacting: false,
    compactionNotice: null,
    contextCompaction: null,
    agent: {
      state: {
        systemPrompt: '',
        tools: [],
        messages: [],
        usage: { input: 900, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 900 },
      },
      signal: undefined,
    },
    ...overrides,
  }
}

/** Long enough history that `not_enough_history` cannot short-circuit. */
function longHistory() {
  const messages = []
  for (let turn = 0; turn < 6; turn++) {
    messages.push(textMessage('user'))
    messages.push({ ...textMessage('assistant'), usage: { input: 900, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 900 } })
  }
  return messages
}

/** Only the notice frames, newest last, with `null` for "idle". */
function noticeEvents(emitSessionEvent) {
  return emitSessionEvent.mock.calls
    .map(([, event]) => event)
    .filter((event) => event?.type === 'auto_compact_state')
    .map((event) => event.compactionNotice ?? null)
}

function eventTypes(emitSessionEvent) {
  return emitSessionEvent.mock.calls.map(([, event]) => event.type)
}

describe('maybeAutoCompactSession notice projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('publishes summarizing, then clears it on success', async () => {
    const emitSessionEvent = vi.fn()
    const persistSession = vi.fn(async () => {})
    const session = makeSession()

    const result = await maybeAutoCompactSession({
      session,
      messages: longHistory(),
      emitSessionEvent,
      persistSession,
    })

    expect(result.compacted).toBe(true)
    const phases = noticeEvents(emitSessionEvent).map((notice) => notice?.phase ?? null)
    // Entering the phase and leaving it are both published; the last frame is
    // `null`, so the surface has no way to render a stale "summarizing" row.
    expect(phases).toEqual([COMPACTION_NOTICE_PHASES.SUMMARIZING, null])
    expect(session.compactionNotice).toBeNull()
  })

  it('never asks for approval — no approval id, no approval events', async () => {
    const emitSessionEvent = vi.fn()
    const session = makeSession()

    await maybeAutoCompactSession({
      session,
      messages: longHistory(),
      emitSessionEvent,
      persistSession: vi.fn(async () => {}),
    })

    // Compaction is an internal detail: the transcript stays in the timeline, so
    // it is never gated on a user decision.
    const types = eventTypes(emitSessionEvent)
    expect(types).not.toContain('auto_compact_approval_required')
    expect(types).not.toContain('auto_compact_approval_settled')
    const published = noticeEvents(emitSessionEvent).filter(Boolean)
    expect(published).not.toHaveLength(0)
    for (const notice of published) {
      expect(notice).not.toHaveProperty('approvalId')
    }
  })

  it('stays silent below the threshold', async () => {
    const emitSessionEvent = vi.fn()
    const session = makeSession()

    const result = await maybeAutoCompactSession({
      session,
      // 判断阈值必须先有上报值：这里 totalTokens 占 1000 窗口的 10%，远低于 50%。
      messages: [
        textMessage('user', 4),
        {
          ...textMessage('assistant', 4),
          usage: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 100 },
        },
      ],
      emitSessionEvent,
      persistSession: vi.fn(async () => {}),
    })

    expect(result).toMatchObject({ compacted: false, reason: 'below_threshold' })
    expect(noticeEvents(emitSessionEvent)).toEqual([])
  })

  it('reports a missing context window instead of silently skipping', async () => {
    const emitSessionEvent = vi.fn()
    // 模型没有 contextWindow：第 4 关直接返回，不该走到用量判定，也不该静默。
    const session = makeSession({ model: {} })

    const result = await maybeAutoCompactSession({
      session,
      messages: [textMessage('user', 4), textMessage('assistant', 4)],
      emitSessionEvent,
      persistSession: vi.fn(async () => {}),
    })

    expect(result).toMatchObject({ compacted: false, reason: 'missing_context_window' })
    expect(noticeEvents(emitSessionEvent)).toEqual([])
  })

  it('reports unknown usage separately from below the threshold', async () => {
    const emitSessionEvent = vi.fn()
    const session = makeSession()

    // 没有任何 assistant usage 上报：数值未知，阈值根本没被判断。这条不能报成
    // below_threshold，否则排查时会读成「还早」，实际是自动压缩已经不会发生。
    const result = await maybeAutoCompactSession({
      session,
      messages: [textMessage('user', 4), textMessage('assistant', 4)],
      emitSessionEvent,
      persistSession: vi.fn(async () => {}),
    })

    expect(result).toMatchObject({ compacted: false, reason: 'unknown_usage' })
    expect(noticeEvents(emitSessionEvent)).toEqual([])
  })

  it('clears the notice when summarizing throws and reports auto_compact_failed', async () => {
    const emitSessionEvent = vi.fn()
    const session = makeSession()
    const { compactConversation } = await import('../../server/conversation-compaction.mjs')
    compactConversation.mockRejectedValueOnce(new Error('upstream exploded'))

    const result = await maybeAutoCompactSession({
      session,
      messages: longHistory(),
      emitSessionEvent,
      persistSession: vi.fn(async () => {}),
    })

    expect(result).toMatchObject({ compacted: false, reason: 'error' })
    expect(session.compactionNotice).toBeNull()
    // Failed is deliberately not a server-owned phase: the surface renders it
    // ephemerally from the event, so the projection can never stay stale.
    expect(noticeEvents(emitSessionEvent).at(-1)).toBeNull()
    expect(eventTypes(emitSessionEvent)).toContain('auto_compact_failed')
  })

  it('does not compact again when nothing new arrived since the last compaction', async () => {
    const emitSessionEvent = vi.fn()
    const messages = longHistory()
    const session = makeSession({
      contextCompaction: {
        summaryMessage: textMessage('user'),
        compactedAt: new Date(Date.now() + 60_000).toISOString(),
        sourceMessageCount: messages.length + 10,
      },
    })

    const result = await maybeAutoCompactSession({
      session,
      messages,
      emitSessionEvent,
      persistSession: vi.fn(async () => {}),
    })

    expect(result).toMatchObject({ compacted: false })
    expect(noticeEvents(emitSessionEvent)).toEqual([])
  })
})
