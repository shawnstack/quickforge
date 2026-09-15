import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/agent-manager.mjs', () => ({
  createAgent: vi.fn(async (sessionId, options = {}) => ({
    sessionId,
    title: options.title || 'Untitled',
    createdAt: new Date().toISOString(),
    agent: { state: { messages: [] } },
  })),
  resetIdleTimer: vi.fn(),
}))
vi.mock('../../server/agent-persistence.mjs', () => ({
  persistSession: vi.fn(async () => {}),
}))
vi.mock('../../server/agent-session-events.mjs', () => ({
  assistantTextMessage: (text, model, details) => ({
    role: 'assistant',
    text,
    modelId: model?.id,
    details,
  }),
  userTextMessage: (text, details) => ({ role: 'user', text, details }),
  compactedSessionTitle: (title) => {
    const base = typeof title === 'string' && title.trim() ? title.trim() : 'New chat'
    return base === 'New chat' ? 'Compacted chat' : `Compacted: ${base}`
  },
  estimateTokenReduction: vi.fn(() => 50),
  emitSessionEvent: vi.fn(),
  updateSessionMessages: (session, messages) => {
    session.agent.state.messages = messages
  },
  getSessionContextUsage: vi.fn(() => ({ percent: 10 })),
}))
vi.mock('../../server/conversation-compaction.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    compactConversation: vi.fn(),
    saveCompactBackup: vi.fn(async () => '/backup.json'),
  }
})
vi.mock('../../server/auto-compaction.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    compactSessionInPlace: vi.fn(),
    readAutoCompactSettings: vi.fn(async () => ({ thresholdPercent: 65 })),
  }
})
vi.mock('../../server/session-utils.mjs', () => ({
  generateAiTitle: vi.fn(async () => 'AI compacted title'),
}))

const {
  summarySession,
  compactSession,
  clearSession,
  resetSessionCompaction,
} = await import('../../server/agent-compaction.mjs')
const { compactConversation, saveCompactBackup } = await import('../../server/conversation-compaction.mjs')
const { compactSessionInPlace, readAutoCompactSettings, DEFAULT_AUTO_COMPACT_SETTINGS } = await import('../../server/auto-compaction.mjs')
const { generateAiTitle } = await import('../../server/session-utils.mjs')
const { createAgent, resetIdleTimer } = await import('../../server/agent-manager.mjs')
const { persistSession } = await import('../../server/agent-persistence.mjs')
const { emitSessionEvent } = await import('../../server/agent-session-events.mjs')

function textMessage(role, text) {
  return { role, content: [{ type: 'text', text }] }
}

function makeSession(overrides = {}) {
  return {
    sessionId: 'session-1',
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    title: 'Original chat',
    titleSource: 'ai',
    titleGenerationId: 0,
    scope: 'global',
    projectId: null,
    accessMode: 'default',
    yoloMode: false,
    model: { provider: 'mock', id: 'mock-model' },
    modelRef: { provider: 'mock', id: 'mock-model' },
    modelAccessContext: null,
    thinkingLevel: 'off',
    getApiKey: undefined,
    agent: {
      state: {
        isStreaming: false,
        messages: [],
        errorMessage: undefined,
        streamingMessage: undefined,
      },
    },
    contextCompaction: null,
    lastAutoCompactAt: null,
    lastAutoCompactRejected: null,
    lastTransformedContextMessages: null,
    autoCompacting: false,
    ...overrides,
  }
}

const initialUserMessage = textMessage('user', '/summary')

function successfulCompactionResult() {
  const recentTail = [textMessage('user', 'u3'), textMessage('assistant', 'a3')]
  return {
    skipped: false,
    summary: 'Compact summary text',
    keepTurns: 1,
    originalCount: 6,
    recentTail,
    originalApproxChars: 2000,
    finalApproxChars: 200,
  }
}

function emittedTypes() {
  return emitSessionEvent.mock.calls.map(([, event]) => event.type)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resetSessionCompaction', () => {
  it('clears all compaction-related session state', () => {
    const session = makeSession({
      contextCompaction: { summaryMessage: textMessage('user', 'summary') },
      lastAutoCompactAt: '2024-01-01T00:00:00.000Z',
      lastAutoCompactRejected: '2024-01-01T00:00:00.000Z',
      lastTransformedContextMessages: [],
      autoCompacting: true,
    })

    resetSessionCompaction(session)

    expect(session.contextCompaction).toBeNull()
    expect(session.lastAutoCompactAt).toBeNull()
    expect(session.lastAutoCompactRejected).toBeNull()
    expect(session.lastTransformedContextMessages).toBeNull()
    expect(session.autoCompacting).toBe(false)
  })
})

describe('summarySession', () => {
  it('rejects summarizing while a generation is streaming', async () => {
    const session = makeSession()
    session.agent.state.isStreaming = true

    const result = await summarySession(session, initialUserMessage, { args: '' })

    expect(compactConversation).not.toHaveBeenCalled()
    expect(session.agent.state.messages).toHaveLength(2)
    expect(session.agent.state.messages[0]).toBe(initialUserMessage)
    expect(session.agent.state.messages[1].text).toMatch(/Cannot summarize while a generation is still running/)
    expect(persistSession).toHaveBeenCalledWith(session)
    expect(emittedTypes()).toEqual(['message_end', 'agent_end'])
    expect(result).toEqual({ sessionId: 'session-1', status: 'idle' })
  })

  it('rejects unsupported /summary options without invoking the model', async () => {
    const session = makeSession()

    const result = await summarySession(session, initialUserMessage, { args: 'foo=1' })

    expect(compactConversation).not.toHaveBeenCalled()
    expect(session.agent.state.messages.at(-1).text).toMatch(/Unsupported \/summary option\(s\): foo=1/)
    expect(session.status).toBe('idle')
    expect(session.agent.state.isStreaming).toBe(false)
    expect(session.agent.state.errorMessage).toBeUndefined()
    expect(session.finishedAt).toBeTruthy()
    expect(persistSession).toHaveBeenCalled()
    expect(emittedTypes()).toEqual(['agent_start', 'message_end', 'agent_end'])
    expect(result).toEqual({ sessionId: 'session-1', status: 'idle' })
  })

  it('explains when there is not enough earlier history to summarize', async () => {
    const session = makeSession()
    compactConversation.mockResolvedValueOnce({ skipped: true, reason: 'not_enough_history' })

    const result = await summarySession(session, initialUserMessage, { args: '' })

    expect(saveCompactBackup).not.toHaveBeenCalled()
    expect(createAgent).not.toHaveBeenCalled()
    expect(session.agent.state.messages.at(-1).text).toMatch(/Not enough earlier history to summarize/)
    expect(session.status).toBe('idle')
    expect(result).toEqual({ sessionId: 'session-1', status: 'idle' })
  })

  it('forks a compacted session with AI title and emits session_forked', async () => {
    const session = makeSession({
      status: 'running',
      startedAt: '2024-01-01T00:00:00.000Z',
      finishedAt: '2024-01-01T00:01:00.000Z',
    })
    session.agent.state.errorMessage = 'previous error'
    compactConversation.mockResolvedValueOnce(successfulCompactionResult())

    const result = await summarySession(session, initialUserMessage, { args: 'keep=1' })

    expect(compactConversation).toHaveBeenCalledWith(expect.objectContaining({
      messages: session.agent.state.messages.slice(),
      model: session.model,
      thinkingLevel: 'off',
      keepTurns: 1,
    }))
    expect(saveCompactBackup).toHaveBeenCalledWith('session-1', expect.any(Array))

    expect(createAgent).toHaveBeenCalledTimes(1)
    const [compactedSessionId, options] = createAgent.mock.calls[0]
    expect(compactedSessionId).toEqual(expect.any(String))
    expect(options).toMatchObject({
      scope: 'global',
      projectId: null,
      accessMode: 'default',
      yoloMode: false,
      model: session.model,
      modelRef: session.modelRef,
      resolvePersistedModel: true,
      thinkingLevel: 'off',
      title: 'AI compacted title',
    })
    const compactedMessages = options.messages
    expect(compactedMessages).toHaveLength(4) // summary + notice + 2 tail messages
    expect(compactedMessages[0].role).toBe('user')
    expect(compactedMessages[0].text).toContain('<compact_summary>')
    expect(compactedMessages[0].text).toContain('Compact summary text')
    expect(compactedMessages[1].role).toBe('assistant')
    expect(compactedMessages[1].text).toContain('原 6 条消息')
    expect(compactedMessages[1].text).toContain('减少约 50%')
    expect(compactedMessages[2].content[0].text).toBe('u3')
    expect(compactedMessages[3].content[0].text).toBe('a3')

    const compactedSession = await createAgent.mock.results[0].value
    expect(compactedSession.agent.state.messages).toBe(compactedMessages)
    expect(persistSession).toHaveBeenCalledWith(compactedSession)

    // 源会话状态在 fork 后恢复
    expect(session.status).toBe('running')
    expect(session.startedAt).toBe('2024-01-01T00:00:00.000Z')
    expect(session.finishedAt).toBe('2024-01-01T00:01:00.000Z')
    expect(session.agent.state.errorMessage).toBe('previous error')
    expect(persistSession).toHaveBeenCalledWith(session)

    expect(emittedTypes()).toEqual([
      'agent_start',
      'agent_end',
      'session_forked',
      'message_end',
      'agent_end',
    ])
    const forkedEvent = emitSessionEvent.mock.calls.find(([, event]) => event.type === 'session_forked')
    expect(forkedEvent[0]).toBe(session)
    expect(forkedEvent[1]).toMatchObject({
      sourceSessionId: 'session-1',
      targetSessionId: compactedSessionId,
      title: 'AI compacted title',
    })
    expect(result).toEqual({ sessionId: 'session-1', status: 'running', compactedSessionId })
  })

  it('falls back to the compacted title when AI title generation is unusable', async () => {
    const session = makeSession({ title: 'Original chat' })
    compactConversation.mockResolvedValueOnce(successfulCompactionResult())
    generateAiTitle.mockResolvedValueOnce('New chat')

    await summarySession(session, initialUserMessage, { args: '' })

    expect(createAgent.mock.calls[0][1].title).toBe('Compacted: Original chat')
  })

  it('fails the session with an error message when compaction throws', async () => {
    const session = makeSession()
    compactConversation.mockRejectedValueOnce(new Error('boom'))

    const result = await summarySession(session, initialUserMessage, { args: '' })

    expect(createAgent).not.toHaveBeenCalled()
    expect(session.agent.state.messages.at(-1).text).toBe('Conversation compaction failed: boom')
    expect(session.status).toBe('error')
    expect(session.agent.state.errorMessage).toBe('boom')
    expect(session.agent.state.isStreaming).toBe(false)
    expect(persistSession).toHaveBeenCalledWith(session)
    expect(emittedTypes()).toEqual(['agent_start', 'error', 'agent_end'])
    const errorEvent = emitSessionEvent.mock.calls.find(([, event]) => event.type === 'error')
    expect(errorEvent[1].error).toBe('boom')
    expect(result).toEqual({ sessionId: 'session-1', status: 'error' })
  })
})

describe('compactSession', () => {
  it('rejects compacting while a generation is streaming', async () => {
    const session = makeSession()
    session.agent.state.isStreaming = true

    const result = await compactSession(session, initialUserMessage, { args: '' })

    expect(compactSessionInPlace).not.toHaveBeenCalled()
    expect(session.agent.state.messages.at(-1).text).toMatch(/Cannot compact while a generation is still running/)
    expect(emittedTypes()).toEqual(['message_end', 'agent_end'])
    expect(result).toEqual({ sessionId: 'session-1', status: 'idle' })
  })

  it('rejects any /compact arguments', async () => {
    const session = makeSession()

    const result = await compactSession(session, initialUserMessage, { args: 'now' })

    expect(compactSessionInPlace).not.toHaveBeenCalled()
    expect(session.agent.state.messages.at(-1).text).toBe('Unsupported /compact option(s). Supported usage: /compact')
    expect(session.status).toBe('idle')
    expect(session.agent.state.isStreaming).toBe(false)
    expect(session.finishedAt).toBeTruthy()
    expect(emittedTypes()).toEqual(['message_end', 'agent_end'])
    expect(result).toEqual({ sessionId: 'session-1', status: 'idle' })
  })

  it('compacts in place with manual-compaction parameters', async () => {
    const session = makeSession()
    compactSessionInPlace.mockImplementationOnce(async ({ onBeforePersist }) => {
      onBeforePersist()
      return { compacted: true }
    })

    const result = await compactSession(session, initialUserMessage, { args: '' })

    expect(readAutoCompactSettings).toHaveBeenCalled()
    expect(compactSessionInPlace).toHaveBeenCalledWith(expect.objectContaining({
      session,
      messages: session.agent.state.messages.slice(),
      keepRecentTurns: 0,
      minSourceChars: 0,
      thresholdPercent: 65,
      reason: 'manual_compact',
      emitSessionEvent,
      persistSession,
    }))
    // onBeforePersist → finishManualSessionRun
    expect(session.status).toBe('idle')
    expect(session.finishedAt).toBeTruthy()
    expect(session.agent.state.isStreaming).toBe(false)
    expect(session.agent.state.errorMessage).toBeUndefined()
    expect(emittedTypes()).toEqual(['agent_start', 'message_end', 'agent_end'])
    expect(result).toEqual({ sessionId: 'session-1', status: 'idle' })
  })

  it('falls back to default threshold when settings cannot be read', async () => {
    const session = makeSession()
    readAutoCompactSettings.mockRejectedValueOnce(new Error('settings unavailable'))
    compactSessionInPlace.mockResolvedValueOnce({ compacted: true })

    await compactSession(session, initialUserMessage, { args: '' })

    expect(compactSessionInPlace.mock.calls[0][0].thresholdPercent).toBe(DEFAULT_AUTO_COMPACT_SETTINGS.thresholdPercent)
  })

  it('explains when there is not enough earlier history to compact', async () => {
    const session = makeSession()
    compactSessionInPlace.mockResolvedValueOnce({ compacted: false })

    const result = await compactSession(session, initialUserMessage, { args: '' })

    expect(session.agent.state.messages.at(-1).text).toMatch(/Not enough earlier history to compact/)
    expect(session.status).toBe('idle')
    expect(session.agent.state.isStreaming).toBe(false)
    expect(persistSession).toHaveBeenCalled()
    expect(emittedTypes()).toEqual(['agent_start', 'message_end', 'agent_end'])
    expect(result).toEqual({ sessionId: 'session-1', status: 'idle' })
  })

  it('fails the session with an error message when in-place compaction throws', async () => {
    const session = makeSession()
    compactSessionInPlace.mockRejectedValueOnce(new Error('network down'))

    const result = await compactSession(session, initialUserMessage, { args: '' })

    expect(session.agent.state.messages.at(-1).text).toBe('Conversation compaction failed: network down')
    expect(session.status).toBe('error')
    expect(session.agent.state.errorMessage).toBe('network down')
    expect(emittedTypes()).toEqual(['agent_start', 'error', 'agent_end'])
    expect(result).toEqual({ sessionId: 'session-1', status: 'error' })
  })
})

describe('clearSession', () => {
  it('rejects clearing while a generation is streaming', async () => {
    const session = makeSession()
    session.agent.state.isStreaming = true

    const result = await clearSession(session)

    expect(session.agent.state.messages.at(-1).text).toMatch(/Cannot clear while a generation is still running/)
    expect(emittedTypes()).toEqual(['message_end', 'agent_end'])
    expect(result).toEqual({ sessionId: 'session-1', status: 'idle' })
  })

  it('clears messages, compaction state and resets the title', async () => {
    const session = makeSession({
      status: 'running',
      startedAt: '2024-01-01T00:00:00.000Z',
      title: 'Working chat',
      titleSource: 'ai',
      titleGenerationId: 2,
      contextCompaction: { summaryMessage: textMessage('user', 'summary') },
      lastAutoCompactAt: '2024-01-01T00:00:00.000Z',
      autoCompacting: true,
    })
    session.agent.state.messages = [textMessage('user', 'u1'), textMessage('assistant', 'a1')]

    const result = await clearSession(session)

    expect(session.agent.state.messages).toEqual([])
    expect(session.contextCompaction).toBeNull()
    expect(session.lastAutoCompactAt).toBeNull()
    expect(session.autoCompacting).toBe(false)
    expect(session.status).toBe('idle')
    expect(session.startedAt).toBeNull()
    expect(session.finishedAt).toBeTruthy()
    expect(session.title).toBe('New chat')
    expect(session.titleSource).toBe('default')
    expect(session.titleGenerationId).toBe(3)
    expect(persistSession).toHaveBeenCalledWith(session)
    expect(emittedTypes()).toEqual(['message_end', 'agent_end', 'title_updated'])
    expect(result).toEqual({ sessionId: 'session-1', status: 'idle', cleared: true })
  })
})
