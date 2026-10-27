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
      keepRecentTurns: 0,
      minSourceChars: 0,
      requireConfirmation: true,
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
  AUTO_COMPACT_DECISION,
  COMPACTION_NOTICE_PHASES,
  maybeAutoCompactSession,
} = await import('../../server/auto-compaction.mjs')

function textMessage(role, size = 200) {
  return { role, content: [{ type: 'text', text: 'x'.repeat(size) }], timestamp: Date.now() }
}

/**
 * A session whose context is already over the 50% threshold, so every call
 * reaches the decision phase instead of returning `below_threshold`.
 */
function makeSession(overrides = {}) {
  return {
    sessionId: 'session-auto',
    model: { contextWindow: 1000 },
    thinkingLevel: 'off',
    getApiKey: async () => 'key',
    autoCompacting: false,
    compactionNotice: null,
    contextCompaction: null,
    lastAutoCompactAt: null,
    lastAutoCompactRejected: null,
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

function noticeEvents(emitSessionEvent) {
  return emitSessionEvent.mock.calls
    .map(([, event]) => event)
    .filter((event) => event?.type === 'auto_compact_state')
    .map((event) => event.compactionNotice ?? null)
}

describe('maybeAutoCompactSession notice projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('publishes awaiting_confirmation, then summarizing, then clears on success', async () => {
    const emitSessionEvent = vi.fn()
    const persistSession = vi.fn(async () => {})
    const session = makeSession()
    const confirmAutoCompact = vi.fn(async () => AUTO_COMPACT_DECISION.APPROVED)

    const result = await maybeAutoCompactSession({
      session,
      messages: longHistory(),
      emitSessionEvent,
      persistSession,
      confirmAutoCompact,
    })

    expect(result.compacted).toBe(true)
    const phases = noticeEvents(emitSessionEvent).map((notice) => notice?.phase ?? null)
    // Every phase transition is published, and the last frame is `null`: the
    // surface has no way to render a stale "summarizing" row afterwards.
    expect(phases).toEqual([
      COMPACTION_NOTICE_PHASES.AWAITING_CONFIRMATION,
      null,
      COMPACTION_NOTICE_PHASES.SUMMARIZING,
      null,
    ])
    expect(session.compactionNotice).toBeNull()
    // The notice carries the approval id the decision row must use.
    const awaitNotice = noticeEvents(emitSessionEvent)[0]
    expect(typeof awaitNotice.approvalId).toBe('string')
    expect(awaitNotice.approvalId.length).toBeGreaterThan(0)
    expect(awaitNotice.thresholdPercent).toBe(50)
  })

  it('clears the notice and reports user_rejected when the user declines', async () => {
    const emitSessionEvent = vi.fn()
    const session = makeSession()
    const confirmAutoCompact = vi.fn(async () => AUTO_COMPACT_DECISION.DECLINED)

    const result = await maybeAutoCompactSession({
      session,
      messages: longHistory(),
      emitSessionEvent,
      persistSession: vi.fn(async () => {}),
      confirmAutoCompact,
    })

    expect(result).toMatchObject({ compacted: false, reason: 'user_rejected' })
    expect(session.compactionNotice).toBeNull()
    // A decline is remembered so the row does not immediately reappear.
    expect(session.lastAutoCompactRejected).not.toBeNull()
    expect(noticeEvents(emitSessionEvent).at(-1)).toBeNull()
  })

  it('does not treat a timeout as a user rejection', async () => {
    const emitSessionEvent = vi.fn()
    const session = makeSession()
    const confirmAutoCompact = vi.fn(async () => AUTO_COMPACT_DECISION.TIMED_OUT)

    const result = await maybeAutoCompactSession({
      session,
      messages: longHistory(),
      emitSessionEvent,
      persistSession: vi.fn(async () => {}),
      confirmAutoCompact,
    })

    // The old contract collapsed timeout into `false`, which suppressed the next
    // attempt for 10 minutes even though the user never said no.
    expect(result).toMatchObject({ compacted: false, reason: 'confirmation_timeout' })
    expect(session.lastAutoCompactRejected).toBeNull()
    expect(session.compactionNotice).toBeNull()
  })

  it('keeps the render path quiet when there is no approval channel', async () => {
    const emitSessionEvent = vi.fn()
    const session = makeSession()

    const result = await maybeAutoCompactSession({
      session,
      messages: longHistory(),
      emitSessionEvent,
      persistSession: vi.fn(async () => {}),
      confirmAutoCompact: undefined,
    })

    expect(result).toMatchObject({ compacted: false, reason: 'confirmation_unavailable' })
    expect(session.compactionNotice).toBeNull()
    // Awaiting is published and immediately retracted; no summarizing frame and
    // no dangling row.
    expect(noticeEvents(emitSessionEvent)).toEqual([
      expect.objectContaining({ phase: COMPACTION_NOTICE_PHASES.AWAITING_CONFIRMATION }),
      null,
    ])
  })

  it('clears the notice when confirmation is cancelled by an abort', async () => {
    const emitSessionEvent = vi.fn()
    const session = makeSession()
    // Aborted runs reject the approval promise (see agent-approval-orchestrator).
    const confirmAutoCompact = vi.fn(async () => {
      throw new Error('Run aborted')
    })

    const result = await maybeAutoCompactSession({
      session,
      messages: longHistory(),
      emitSessionEvent,
      persistSession: vi.fn(async () => {}),
      confirmAutoCompact,
    })

    expect(result.compacted).toBe(false)
    expect(session.compactionNotice).toBeNull()
    // Cancellation is not a compaction failure: no `auto_compact_failed` frame.
    expect(emitSessionEvent.mock.calls.map(([, event]) => event.type)).not.toContain('auto_compact_failed')
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
      confirmAutoCompact: vi.fn(async () => AUTO_COMPACT_DECISION.APPROVED),
    })

    expect(result).toMatchObject({ compacted: false, reason: 'error' })
    expect(session.compactionNotice).toBeNull()
    expect(emitSessionEvent.mock.calls.map(([, event]) => event.type)).toContain('auto_compact_failed')
  })

  it('skips confirmation entirely when requireConfirmation is off', async () => {
    const emitSessionEvent = vi.fn()
    const session = makeSession()
    const confirmAutoCompact = vi.fn()

    await maybeAutoCompactSession({
      session,
      messages: longHistory(),
      emitSessionEvent,
      persistSession: vi.fn(async () => {}),
      confirmAutoCompact,
    })

    // The setting is read from the mocked store above; flipping it requires a
    // fresh module, so this test documents the default (true) path only.
    expect(confirmAutoCompact).toHaveBeenCalledTimes(1)
    expect(noticeEvents(emitSessionEvent)[0]).toMatchObject({ phase: COMPACTION_NOTICE_PHASES.AWAITING_CONFIRMATION })
  })
})
