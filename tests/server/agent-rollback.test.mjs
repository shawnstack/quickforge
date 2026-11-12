import { beforeEach, describe, expect, it, vi } from 'vitest'

// 消息回滚是**破坏性**操作：算错一个下标就删掉用户没打算删的对话，而压缩点
// 与 bot 会话这两块又是「删了之后修不回来」的。所以这里把下标算术和四道拒绝
// 门逐条锁住。
const mocks = vi.hoisted(() => ({
  agentSessions: new Map(),
  restoreAgent: vi.fn(),
  activeGoalStatus: vi.fn(),
  readProjectConfig: vi.fn(),
  updateSessionMessages: vi.fn(),
  emitSessionEvent: vi.fn(),
  getSessionContextUsage: vi.fn(),
  lastCompactionMessageIndex: vi.fn(),
  syncCompactionIndex: vi.fn(),
  resetSessionCompaction: vi.fn(),
  persistSession: vi.fn(),
  getSessionState: vi.fn(),
}))

vi.mock('../../server/agent-session-store.mjs', () => ({ agentSessions: mocks.agentSessions }))
vi.mock('../../server/agent-session-lifecycle.mjs', () => ({ restoreAgent: mocks.restoreAgent }))
vi.mock('../../server/goal/engine.mjs', () => ({ activeGoalStatus: mocks.activeGoalStatus }))
vi.mock('../../server/project-config.mjs', () => ({ readProjectConfig: mocks.readProjectConfig }))
vi.mock('../../server/agent-session-events.mjs', () => ({
  updateSessionMessages: mocks.updateSessionMessages,
  emitSessionEvent: mocks.emitSessionEvent,
  getSessionContextUsage: mocks.getSessionContextUsage,
}))
vi.mock('../../server/auto-compaction.mjs', () => ({
  lastCompactionMessageIndex: mocks.lastCompactionMessageIndex,
  syncCompactionIndex: mocks.syncCompactionIndex,
}))
vi.mock('../../server/agent-compaction.mjs', () => ({ resetSessionCompaction: mocks.resetSessionCompaction }))
vi.mock('../../server/agent-persistence.mjs', () => ({ persistSession: mocks.persistSession }))
vi.mock('../../server/agent-manager.mjs', () => ({ getSessionState: mocks.getSessionState }))

const { rollbackStartIndexFromMessage, rollbackSessionMessages } = await import('../../server/agent-rollback.mjs')

const user = (text) => ({ role: 'user', content: text })
const assistant = (text) => ({ role: 'assistant', content: text })

function conversation() {
  return [user('u1'), assistant('a1'), user('u2'), assistant('a2')]
}

function makeSession(overrides = {}) {
  const session = {
    sessionId: 'session-1',
    projectId: null,
    status: 'running',
    contextCompaction: null,
    lastTransformedContextMessages: ['stale context'],
    agent: { state: { isStreaming: false, messages: conversation() } },
  }
  return Object.assign(session, overrides)
}

describe('rollbackStartIndexFromMessage', () => {
  it.each([
    ['no messages', [], 0],
    ['non-array', null, 0],
  ])('returns -1 for %s', (_label, messages, index) => {
    expect(rollbackStartIndexFromMessage(messages, index)).toBe(-1)
  })

  it.each([['not a number', 'oops'], ['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY]])(
    'returns -1 when the index is %s',
    (_label, index) => {
      expect(rollbackStartIndexFromMessage(conversation(), index)).toBe(-1)
    },
  )

  it('anchors on a user message', () => {
    expect(rollbackStartIndexFromMessage(conversation(), 2)).toBe(2)
  })

  it('treats user-with-attachments the same as user', () => {
    const messages = [user('u1'), { role: 'user-with-attachments', content: 'u2' }]
    expect(rollbackStartIndexFromMessage(messages, 1)).toBe(1)
  })

  it('walks back to the opening user message of the turn for non-user roles', () => {
    // 点 assistant a2 → 回退到 u2，而不是只删 a2。
    expect(rollbackStartIndexFromMessage(conversation(), 3)).toBe(2)
  })

  it('falls back to the clicked message when no earlier user message exists', () => {
    const messages = [{ role: 'toolResult', content: 'orphan' }, assistant('a1')]
    expect(rollbackStartIndexFromMessage(messages, 1)).toBe(1)
  })

  it('clamps out-of-range and fractional indexes', () => {
    const messages = conversation()
    // 99 先夹到末条（assistant），再按规则回退到本轮开头的 user。
    expect(rollbackStartIndexFromMessage(messages, 99)).toBe(2)
    expect(rollbackStartIndexFromMessage(messages, -5)).toBe(0)
    expect(rollbackStartIndexFromMessage(messages, 2.9)).toBe(2)
  })

  it('returns -1 for a hole in the array', () => {
    const sparse = new Array(1)
    expect(rollbackStartIndexFromMessage(sparse, 0)).toBe(-1)
  })
})

describe('rollbackSessionMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agentSessions.clear()
    mocks.restoreAgent.mockResolvedValue(null)
    mocks.activeGoalStatus.mockReturnValue(null)
    mocks.readProjectConfig.mockResolvedValue({ projects: [{ id: 'p-bot', kind: 'bot' }, { id: 'p-normal', kind: 'project' }] })
    mocks.updateSessionMessages.mockImplementation((session, messages) => {
      session.agent.state.messages = messages
    })
    mocks.getSessionContextUsage.mockReturnValue({ totalTokens: 42 })
    mocks.getSessionState.mockReturnValue({ snapshot: true })
    mocks.lastCompactionMessageIndex.mockReturnValue(-1)
    mocks.persistSession.mockResolvedValue(undefined)
  })

  it('rejects an unknown session with 404', async () => {
    await expect(rollbackSessionMessages('missing', 1)).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.persistSession).not.toHaveBeenCalled()
  })

  it('rejects while a generation is still streaming', async () => {
    const session = makeSession()
    session.agent.state.isStreaming = true
    mocks.agentSessions.set('session-1', session)

    await expect(rollbackSessionMessages('session-1', 1)).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'GENERATION_STILL_RUNNING_BEFORE_ROLLBACK',
    })
    expect(mocks.persistSession).not.toHaveBeenCalled()
  })

  it('rejects while a goal is active', async () => {
    mocks.agentSessions.set('session-1', makeSession())
    mocks.activeGoalStatus.mockReturnValue({ status: 'running' })

    await expect(rollbackSessionMessages('session-1', 1)).rejects.toMatchObject({ statusCode: 409, errorCode: 'GOAL_ACTIVE' })
    expect(mocks.readProjectConfig).not.toHaveBeenCalled()
  })

  it('rejects bot sessions unconditionally because their history is the memory', async () => {
    mocks.agentSessions.set('session-1', makeSession({ projectId: 'p-bot' }))

    await expect(rollbackSessionMessages('session-1', 1)).rejects.toMatchObject({
      statusCode: 403,
      errorCode: 'BOT_SESSION_IMMUTABLE',
    })
    expect(mocks.updateSessionMessages).not.toHaveBeenCalled()
    expect(mocks.persistSession).not.toHaveBeenCalled()
  })

  it('allows an ordinary project session through the bot guard', async () => {
    mocks.agentSessions.set('session-1', makeSession({ projectId: 'p-normal' }))

    await rollbackSessionMessages('session-1', 2)

    expect(mocks.readProjectConfig).toHaveBeenCalled()
    expect(mocks.persistSession).toHaveBeenCalled()
  })

  it('skips the project probe entirely for global sessions', async () => {
    mocks.agentSessions.set('session-1', makeSession())

    await rollbackSessionMessages('session-1', 2)

    expect(mocks.readProjectConfig).not.toHaveBeenCalled()
  })

  it('truncates the transcript, marks the session idle and broadcasts three events', async () => {
    const session = makeSession()
    mocks.agentSessions.set('session-1', session)

    const result = await rollbackSessionMessages('session-1', 2)

    expect(mocks.updateSessionMessages).toHaveBeenCalledWith(session, [user('u1'), assistant('a1')])
    expect(session.status).toBe('idle')
    expect(typeof session.finishedAt).toBe('string')
    expect(mocks.persistSession).toHaveBeenCalledWith(session)

    const types = mocks.emitSessionEvent.mock.calls.map((call) => call[1].type)
    expect(types).toEqual(['messages_replaced', 'message_end', 'agent_end'])

    const replaced = mocks.emitSessionEvent.mock.calls[0][1]
    expect(replaced).toMatchObject({ reason: 'rollback', rollbackIndex: 2, contextUsage: { totalTokens: 42 } })
    expect(replaced.messages).toBe(session.agent.state.messages)

    expect(result).toEqual({ session: { snapshot: true }, rollbackIndex: 2 })
  })

  it('restores a session that is not live yet', async () => {
    const restored = makeSession()
    mocks.restoreAgent.mockResolvedValue(restored)

    await rollbackSessionMessages('session-1', 2)

    expect(mocks.restoreAgent).toHaveBeenCalledWith('session-1')
    expect(mocks.persistSession).toHaveBeenCalledWith(restored)
  })

  it('treats an empty session as a successful no-op at index 0', async () => {
    const session = makeSession()
    session.agent.state.messages = []
    mocks.agentSessions.set('session-1', session)

    const result = await rollbackSessionMessages('session-1', 3)

    expect(result.rollbackIndex).toBe(0)
    expect(mocks.updateSessionMessages).toHaveBeenCalledWith(session, [])
  })

  it('tolerates a missing message array', async () => {
    const session = makeSession()
    session.agent.state.messages = undefined
    mocks.agentSessions.set('session-1', session)

    const result = await rollbackSessionMessages('session-1', 1)

    expect(result.rollbackIndex).toBe(0)
  })

  it('re-syncs the compaction index when the summary message survives the cut', async () => {
    const session = makeSession()
    mocks.agentSessions.set('session-1', session)
    mocks.lastCompactionMessageIndex.mockReturnValue(1)

    await rollbackSessionMessages('session-1', 2)

    const nextMessages = [user('u1'), assistant('a1')]
    expect(mocks.syncCompactionIndex).toHaveBeenCalledWith(session, 1, 2, nextMessages[1])
    expect(session.lastTransformedContextMessages).toBeNull()
    expect(mocks.resetSessionCompaction).not.toHaveBeenCalled()
  })

  it('keeps a legacy compaction when the cut stays after its point', async () => {
    const session = makeSession({ contextCompaction: { compactedUpToIndex: 1 } })
    mocks.agentSessions.set('session-1', session)

    await rollbackSessionMessages('session-1', 2)

    expect(session.lastTransformedContextMessages).toBeNull()
    expect(mocks.resetSessionCompaction).not.toHaveBeenCalled()
  })

  it('resets the compaction when the cut goes before the legacy point', async () => {
    const session = makeSession({ contextCompaction: { compactedUpToIndex: 3 } })
    mocks.agentSessions.set('session-1', session)

    await rollbackSessionMessages('session-1', 2)

    expect(mocks.resetSessionCompaction).toHaveBeenCalledWith(session)
  })

  it('leaves sessions that never compacted alone', async () => {
    const session = makeSession()
    mocks.agentSessions.set('session-1', session)

    await rollbackSessionMessages('session-1', 2)

    expect(mocks.syncCompactionIndex).not.toHaveBeenCalled()
    expect(mocks.resetSessionCompaction).not.toHaveBeenCalled()
    expect(session.lastTransformedContextMessages).toEqual(['stale context'])
  })
})
