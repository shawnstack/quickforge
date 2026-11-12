import { beforeEach, describe, expect, it, vi } from 'vitest'

// agent-context-transform 是每次模型请求前都要跑的接线层，但它只有一坨纯函数式
// 改写逻辑（压缩切片 + 命令/能力/瞬态提示替换最后一条 user 消息）。这里把
// 自动压缩与日志全部桩掉，只测「给定输入，拼出什么」和「什么时候记日志」。
const mocks = vi.hoisted(() => ({
  isCompactSummaryMessage: vi.fn(),
  maybeAutoCompactSession: vi.fn(),
  buildAutoCompactLoopMessages: vi.fn(),
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
  emitSessionEvent: vi.fn(),
  persistSession: vi.fn(),
}))

vi.mock('../../server/conversation-compaction.mjs', () => ({
  isCompactSummaryMessage: mocks.isCompactSummaryMessage,
}))
vi.mock('../../server/auto-compaction.mjs', () => ({
  maybeAutoCompactSession: mocks.maybeAutoCompactSession,
  buildAutoCompactLoopMessages: mocks.buildAutoCompactLoopMessages,
}))
vi.mock('../../server/utils/logger.mjs', () => ({ logger: mocks.logger }))
vi.mock('../../server/agent-session-events.mjs', () => ({ emitSessionEvent: mocks.emitSessionEvent }))
vi.mock('../../server/agent-persistence.mjs', () => ({ persistSession: mocks.persistSession }))

const { transformSessionContext } = await import('../../server/agent-context-transform.mjs')

/** 每次都新建：transformSessionContext 会往 session 上挂状态。 */
function makeSession(overrides = {}) {
  return { sessionId: 'session-1', ...overrides }
}

function userMessage(text, role = 'user') {
  return { role, content: [{ type: 'text', text }] }
}

describe('transformSessionContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isCompactSummaryMessage.mockImplementation((message) => Boolean(message?.isSummary))
    mocks.maybeAutoCompactSession.mockResolvedValue({ compacted: false })
    mocks.buildAutoCompactLoopMessages.mockImplementation((_session, messages) => messages)
  })

  it('returns the messages untouched and records them as the last transformed context', async () => {
    const session = makeSession()
    const messages = [userMessage('hi'), { role: 'assistant', content: 'hello' }]

    const result = await transformSessionContext(session, messages, new AbortController().signal)

    expect(result).toEqual(messages)
    // 记的是「改写提示词之前」的那份，后续轮级逻辑靠它对齐。
    expect(session.lastTransformedContextMessages).toEqual(messages)
    expect(mocks.logger.warn).not.toHaveBeenCalled()
    expect(mocks.logger.info).not.toHaveBeenCalled()
  })

  it('passes the session, messages and signal through to the auto-compaction step', async () => {
    const session = makeSession()
    const messages = [userMessage('hi')]
    const signal = new AbortController().signal

    await transformSessionContext(session, messages, signal)

    const call = mocks.maybeAutoCompactSession.mock.calls[0][0]
    expect(call.session).toBe(session)
    expect(call.messages).toBe(messages)
    expect(call.signal).toBe(signal)
    // 依赖是显式注入的，不是模块内硬编码。
    expect(call.emitSessionEvent).toBe(mocks.emitSessionEvent)
    expect(call.persistSession).toBe(mocks.persistSession)
    expect(call.logger).toBe(mocks.logger)
  })

  it('drops everything before the last compact summary message', async () => {
    const session = makeSession()
    const messages = [userMessage('old'), { role: 'assistant', content: 'older' }, { isSummary: true, role: 'user' }, userMessage('new')]

    const result = await transformSessionContext(session, messages, undefined)

    expect(result).toHaveLength(2)
    expect(result[0].isSummary).toBe(true)
    expect(result[1]).toEqual(userMessage('new'))
  })

  it('uses the LAST summary when several are present', async () => {
    const session = makeSession()
    const messages = [
      { isSummary: true, role: 'user', tag: 'first' },
      userMessage('middle'),
      { isSummary: true, role: 'user', tag: 'last' },
      userMessage('tail'),
    ]

    const result = await transformSessionContext(session, messages, undefined)

    expect(result.map((message) => message.tag ?? 'tail')).toEqual(['last', 'tail'])
  })

  it('keeps every message when there is no summary at all', async () => {
    const session = makeSession()
    const messages = [userMessage('a'), userMessage('b')]

    const result = await transformSessionContext(session, messages, undefined)

    expect(result).toHaveLength(2)
  })

  it('replaces the content of the last user message with the active command prompt', async () => {
    const session = makeSession({ activeCommandPrompt: 'COMMAND BODY' })
    const messages = [userMessage('first'), { role: 'assistant', content: 'ok' }, userMessage('second')]

    const result = await transformSessionContext(session, messages, undefined)

    expect(result[2]).toEqual({ role: 'user', content: 'COMMAND BODY' })
    expect(result[0]).toEqual(userMessage('first'))
    // 不可变：原数组不被改写。
    expect(messages[2]).toEqual(userMessage('second'))
  })

  it('treats user-with-attachments as a user message when applying the command prompt', async () => {
    const session = makeSession({ activeCommandPrompt: 'COMMAND BODY' })
    const messages = [{ role: 'user-with-attachments', content: [{ type: 'file', name: 'a.png' }], attachments: ['a.png'] }]

    const result = await transformSessionContext(session, messages, undefined)

    expect(result[0].content).toBe('COMMAND BODY')
    // 其余字段保留。
    expect(result[0].attachments).toEqual(['a.png'])
  })

  it('leaves messages alone when the command prompt is set but there is no user message', async () => {
    const session = makeSession({ activeCommandPrompt: 'COMMAND BODY' })
    const messages = [{ role: 'assistant', content: 'only assistant' }]

    const result = await transformSessionContext(session, messages, undefined)

    expect(result).toEqual(messages)
  })

  it('prefixes the capability prompt and only keeps text blocks as the visible request', async () => {
    const session = makeSession({ activeCapabilityPrompt: 'CAPA' })
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'line one' },
          { type: 'file', name: 'b.png' },
          { type: 'text', text: 'line two' },
        ],
      },
    ]

    const result = await transformSessionContext(session, messages, undefined)

    expect(result[0].content).toBe('CAPA\n\nUser request:\nline one\nline two')
  })

  it('joins the transient and capability prompts in that order above the capability block', async () => {
    const session = makeSession({ activeCapabilityPrompt: 'CAPA', activeTransientContextPrompt: 'TRANSIENT' })
    const messages = [userMessage('ask')]

    const result = await transformSessionContext(session, messages, undefined)

    expect(result[0].content).toBe('TRANSIENT\n\nCAPA\n\nUser request:\nask')
  })

  it('applies the command replacement first, so the capability request quotes the command body', async () => {
    // 顺序是契约：命令先落，能力提示读到的 visibleText 就是命令正文而不是用户原文。
    const session = makeSession({ activeCommandPrompt: 'COMMAND BODY', activeCapabilityPrompt: 'CAPA' })
    const messages = [userMessage('original ask')]

    const result = await transformSessionContext(session, messages, undefined)

    expect(result[0].content).toBe('CAPA\n\nUser request:\nCOMMAND BODY')
  })

  it('ignores blank prompt strings', async () => {
    const session = makeSession({ activeCapabilityPrompt: '   ', activeTransientContextPrompt: '', activeCommandPrompt: '' })
    const messages = [userMessage('ask')]

    const result = await transformSessionContext(session, messages, undefined)

    expect(result).toEqual(messages)
  })

  it('uses a plain string content as the visible request verbatim', async () => {
    const session = makeSession({ activeCapabilityPrompt: 'CAPA' })
    const messages = [{ role: 'user', content: 'plain string' }]

    const result = await transformSessionContext(session, messages, undefined)

    // 字符串 content 原样当可见文本（只有数组才按 text 块拼）。
    expect(result[0].content).toBe('CAPA\n\nUser request:\nplain string')
  })

  describe('auto-compaction logging', () => {
    it('warns about unusable usage only once per session', async () => {
      const session = makeSession()
      mocks.maybeAutoCompactSession.mockResolvedValue({ compacted: false, usage: { totalTokens: 0 }, reason: 'unknown_usage' })

      await transformSessionContext(session, [userMessage('a')], undefined)
      await transformSessionContext(session, [userMessage('b')], undefined)
      await transformSessionContext(session, [userMessage('c')], undefined)

      expect(mocks.logger.warn).toHaveBeenCalledTimes(1)
      expect(mocks.logger.warn.mock.calls[0][0]).toContain('session-1')
      expect(session._unknownUsageWarningLogged).toBe(true)
    })

    it('stays silent below the threshold', async () => {
      const session = makeSession()
      mocks.maybeAutoCompactSession.mockResolvedValue({ compacted: false, usage: { totalTokens: 10 }, reason: 'below_threshold' })

      await transformSessionContext(session, [userMessage('a')], undefined)

      expect(mocks.logger.warn).not.toHaveBeenCalled()
      expect(mocks.logger.info).not.toHaveBeenCalled()
    })

    it('logs one info line for any other skip reason', async () => {
      const session = makeSession()
      mocks.maybeAutoCompactSession.mockResolvedValue({ compacted: false, usage: { totalTokens: 10 }, reason: 'cooldown' })

      await transformSessionContext(session, [userMessage('a')], undefined)
      await transformSessionContext(session, [userMessage('b')], undefined)

      expect(mocks.logger.info).toHaveBeenCalledTimes(2)
      expect(mocks.logger.info.mock.calls[0][0]).toContain('cooldown')
      expect(mocks.logger.info.mock.calls[0][1]).toMatchObject({ sessionId: 'session-1', reason: 'cooldown' })
    })

    it('does not log when the session actually compacted', async () => {
      const session = makeSession()
      mocks.maybeAutoCompactSession.mockResolvedValue({ compacted: true, usage: { totalTokens: 10 }, reason: 'compacted' })

      await transformSessionContext(session, [userMessage('a')], undefined)

      expect(mocks.logger.warn).not.toHaveBeenCalled()
      expect(mocks.logger.info).not.toHaveBeenCalled()
    })

    it('does not log when the result carries no usage', async () => {
      const session = makeSession()
      mocks.maybeAutoCompactSession.mockResolvedValue({ compacted: false, reason: 'unknown_usage' })

      await transformSessionContext(session, [userMessage('a')], undefined)

      expect(mocks.logger.warn).not.toHaveBeenCalled()
    })
  })
})
