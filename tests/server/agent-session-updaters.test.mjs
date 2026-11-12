import { beforeEach, describe, expect, it, vi } from 'vitest'

// 会话 setter 组：改标题/权限/模型/思考档，以及「全量刷新工具」「全量刷新模型」
// 两个批量入口。这层没有业务算法，风险全在**边界与副作用**：抛什么错、先落盘
// 还是先重建工具、什么时候才推 state 事件、单个会话失败会不会拖垮整批。
const mocks = vi.hoisted(() => ({
  agentSessions: new Map(),
  restoreAgent: vi.fn(),
  refreshSessionModelBinding: vi.fn(),
  rebuildSessionTools: vi.fn(),
  persistSession: vi.fn(),
  emitSessionEvent: vi.fn(),
  normalizeAccessMode: vi.fn(),
  yoloModeFromAccessMode: vi.fn(),
  subscribeMcpToolsetChanged: vi.fn(),
  getSessionState: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../server/agent-session-store.mjs', () => ({ agentSessions: mocks.agentSessions }))
vi.mock('../../server/agent-session-lifecycle.mjs', () => ({
  restoreAgent: mocks.restoreAgent,
  refreshSessionModelBinding: mocks.refreshSessionModelBinding,
}))
vi.mock('../../server/agent-tool-assembly.mjs', () => ({ rebuildSessionTools: mocks.rebuildSessionTools }))
vi.mock('../../server/agent-persistence.mjs', () => ({ persistSession: mocks.persistSession }))
vi.mock('../../server/agent-session-events.mjs', () => ({ emitSessionEvent: mocks.emitSessionEvent }))
vi.mock('../../server/agent-access-mode.mjs', () => ({
  AGENT_ACCESS_MODE_DEFAULT: 'default',
  AGENT_ACCESS_MODE_FULL_ACCESS: 'full-access',
  normalizeAccessMode: mocks.normalizeAccessMode,
  yoloModeFromAccessMode: mocks.yoloModeFromAccessMode,
}))
vi.mock('../../server/mcp/registry.mjs', () => ({ subscribeMcpToolsetChanged: mocks.subscribeMcpToolsetChanged }))
vi.mock('../../server/agent-manager.mjs', () => ({ getSessionState: mocks.getSessionState }))
vi.mock('../../server/utils/logger.mjs', () => ({ logger: mocks.logger }))

const updaters = await import('../../server/agent-session-updaters.mjs')

// 模块在被导入时就订阅了一次 MCP 工具集变化。`vi.clearAllMocks()` 会清掉调用
// 记录，所以把回调抓在模块作用域，后面几个用例直接用它。
const mcpToolsetListener = mocks.subscribeMcpToolsetChanged.mock.calls[0]?.[0]

function makeSession(overrides = {}) {
  const session = {
    sessionId: 'session-1',
    title: 'old title',
    titleGenerationId: 3,
    accessMode: 'default',
    yoloMode: false,
    thinkingLevel: 'medium',
    model: 'model-1',
    agent: {
      state: {
        model: null,
        thinkingLevel: 'medium',
        tools: [{ name: 'a' }, { name: 'b' }],
        isStreaming: false,
      },
    },
  }
  return Object.assign(session, overrides)
}

describe('updateSessionTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agentSessions.clear()
    mocks.agentSessions.set('session-1', makeSession())
    mocks.restoreAgent.mockResolvedValue(null)
    mocks.normalizeAccessMode.mockImplementation((value, fallback) => value ?? fallback)
    mocks.yoloModeFromAccessMode.mockImplementation((mode) => mode === 'full-access')
    mocks.getSessionState.mockReturnValue({ snapshot: true })
  })

  it('trims the title, bumps the generation id and marks it as a manual edit', async () => {
    const session = mocks.agentSessions.get('session-1')

    const result = await updaters.updateSessionTitle('session-1', '  New title  ')

    expect(session.title).toBe('New title')
    expect(session.titleGenerationId).toBe(4)
    expect(session.titleSource).toBe('manual')
    expect(mocks.persistSession).toHaveBeenCalledWith(session)
    expect(mocks.emitSessionEvent).toHaveBeenCalledWith(session, {
      type: 'title_updated',
      title: 'New title',
      titleSource: 'manual',
    })
    expect(result).toEqual({ sessionId: 'session-1', title: 'New title', titleSource: 'manual' })
  })

  it('restores the session when it is not live yet', async () => {
    mocks.agentSessions.clear()
    const restored = makeSession()
    mocks.restoreAgent.mockResolvedValue(restored)

    await updaters.updateSessionTitle('session-1', 'from disk')

    expect(mocks.restoreAgent).toHaveBeenCalledWith('session-1')
    expect(restored.title).toBe('from disk')
  })

  it('rejects an unknown session with 404', async () => {
    mocks.agentSessions.clear()

    await expect(updaters.updateSessionTitle('missing', 'x')).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.persistSession).not.toHaveBeenCalled()
  })

  it.each([['empty', ''], ['blank', '   '], ['non-string', null]])('rejects an %s title with 400', async (_label, title) => {
    const session = mocks.agentSessions.get('session-1')

    await expect(updaters.updateSessionTitle('session-1', title)).rejects.toMatchObject({ statusCode: 400 })
    // 校验失败不能留下半截状态。
    expect(session.title).toBe('old title')
    expect(session.titleGenerationId).toBe(3)
    expect(mocks.persistSession).not.toHaveBeenCalled()
  })

  it('rejects a title longer than 200 characters with 400', async () => {
    await expect(updaters.updateSessionTitle('session-1', 'x'.repeat(201))).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.persistSession).not.toHaveBeenCalled()
  })

  it('accepts exactly 200 characters', async () => {
    const session = mocks.agentSessions.get('session-1')

    await updaters.updateSessionTitle('session-1', 'y'.repeat(200))

    expect(session.title).toHaveLength(200)
  })
})

describe('updateSessionAccessMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agentSessions.clear()
    mocks.agentSessions.set('session-1', makeSession())
    mocks.restoreAgent.mockResolvedValue(null)
    mocks.normalizeAccessMode.mockImplementation((value, fallback) => value ?? fallback)
    mocks.yoloModeFromAccessMode.mockImplementation((mode) => mode === 'full-access')
    mocks.getSessionState.mockReturnValue({ snapshot: true })
  })

  it('normalizes the mode, rebuilds tools, persists and pushes a state event', async () => {
    const session = mocks.agentSessions.get('session-1')

    const result = await updaters.updateSessionAccessMode('session-1', 'full-access')

    expect(mocks.normalizeAccessMode).toHaveBeenCalledWith('full-access', 'default')
    expect(session.accessMode).toBe('full-access')
    expect(session.yoloMode).toBe(true)
    // 工具重建必须在落盘之前，否则存下来的还是旧工具集。
    expect(mocks.rebuildSessionTools).toHaveBeenCalledWith(session)
    expect(mocks.rebuildSessionTools.mock.invocationCallOrder[0]).toBeLessThan(mocks.persistSession.mock.invocationCallOrder[0])
    expect(mocks.emitSessionEvent).toHaveBeenCalledWith(session, { type: 'state', snapshot: true })
    expect(result).toEqual({ sessionId: 'session-1', accessMode: 'full-access', yoloMode: true })
  })

  it('falls back to the current mode when the incoming value is not recognized', async () => {
    const session = mocks.agentSessions.get('session-1')
    session.accessMode = 'full-access'
    mocks.normalizeAccessMode.mockImplementation((_value, fallback) => fallback)

    await updaters.updateSessionAccessMode('session-1', 'nonsense')

    expect(session.accessMode).toBe('full-access')
    expect(mocks.normalizeAccessMode).toHaveBeenCalledWith('nonsense', 'full-access')
  })

  it('rejects an unknown session with 404', async () => {
    mocks.agentSessions.clear()

    await expect(updaters.updateSessionAccessMode('missing', 'default')).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.rebuildSessionTools).not.toHaveBeenCalled()
  })
})

describe('updateSessionYoloMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agentSessions.clear()
    mocks.agentSessions.set('session-1', makeSession())
    mocks.restoreAgent.mockResolvedValue(null)
    mocks.normalizeAccessMode.mockImplementation((value, fallback) => value ?? fallback)
    mocks.yoloModeFromAccessMode.mockImplementation((mode) => mode === 'full-access')
    mocks.getSessionState.mockReturnValue({})
  })

  it('maps true to full access', async () => {
    await updaters.updateSessionYoloMode('session-1', true)
    expect(mocks.agentSessions.get('session-1').accessMode).toBe('full-access')
    expect(mocks.agentSessions.get('session-1').yoloMode).toBe(true)
  })

  it('maps anything falsy to the default mode', async () => {
    mocks.agentSessions.get('session-1').accessMode = 'full-access'

    await updaters.updateSessionYoloMode('session-1', false)

    expect(mocks.agentSessions.get('session-1').accessMode).toBe('default')
    expect(mocks.agentSessions.get('session-1').yoloMode).toBe(false)
  })
})

describe('updateSessionModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agentSessions.clear()
    mocks.agentSessions.set('session-1', makeSession())
    mocks.restoreAgent.mockResolvedValue(null)
  })

  it('writes the model to both the session record and the live agent state', async () => {
    const session = mocks.agentSessions.get('session-1')
    const modelRef = { providerId: 'openai', modelId: 'model-2' }

    const result = await updaters.updateSessionModel('session-1', 'model-2', modelRef)

    expect(session.model).toBe('model-2')
    expect(session.modelRef).toBe(modelRef)
    expect(session.resolvePersistedModel).toBe(true)
    expect(session.agent.state.model).toBe('model-2')
    // 故意不落盘：等 message_end / agent_end 的生命周期事件顺带存。
    expect(mocks.persistSession).not.toHaveBeenCalled()
    expect(result).toEqual({ sessionId: 'session-1', model: 'model-2', modelRef })
  })

  it('leaves modelRef undefined when only a model id is given', async () => {
    const result = await updaters.updateSessionModel('session-1', 'model-3')

    expect(result.modelRef).toBeUndefined()
    expect(mocks.agentSessions.get('session-1').modelRef).toBeNull()
  })

  it('rejects a missing model with 400', async () => {
    await expect(updaters.updateSessionModel('session-1', '')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects an unknown session with 404', async () => {
    mocks.agentSessions.clear()

    await expect(updaters.updateSessionModel('missing', 'model-2')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('updateSessionThinkingLevel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agentSessions.clear()
    mocks.agentSessions.set('session-1', makeSession())
    mocks.restoreAgent.mockResolvedValue(null)
  })

  it('writes the level to both places without persisting', async () => {
    const session = mocks.agentSessions.get('session-1')

    const result = await updaters.updateSessionThinkingLevel('session-1', 'xhigh')

    expect(session.thinkingLevel).toBe('xhigh')
    expect(session.agent.state.thinkingLevel).toBe('xhigh')
    expect(mocks.persistSession).not.toHaveBeenCalled()
    expect(result).toEqual({ sessionId: 'session-1', thinkingLevel: 'xhigh' })
  })

  it('rejects a missing level with 400 and an unknown session with 404', async () => {
    await expect(updaters.updateSessionThinkingLevel('session-1', '')).rejects.toMatchObject({ statusCode: 400 })

    mocks.agentSessions.clear()
    await expect(updaters.updateSessionThinkingLevel('missing', 'high')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('refreshAllSessionTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agentSessions.clear()
    mocks.getSessionState.mockReturnValue({ snapshot: true })
  })

  it('reports per-session success with the tool count and pushes a state event', async () => {
    const session = makeSession()
    mocks.agentSessions.set('session-1', session)

    const result = await updaters.refreshAllSessionTools()

    expect(result).toEqual([{ sessionId: 'session-1', ok: true, toolCount: 2 }])
    expect(mocks.emitSessionEvent).toHaveBeenCalledWith(session, { type: 'state', snapshot: true })
  })

  it('keeps going when one session fails and logs it', async () => {
    const broken = makeSession({ sessionId: 'broken' })
    const fine = makeSession({ sessionId: 'fine' })
    mocks.agentSessions.set('broken', broken)
    mocks.agentSessions.set('fine', fine)
    const error = new Error('rebuild exploded')
    mocks.rebuildSessionTools.mockImplementation(async (session) => {
      if (session.sessionId === 'broken') throw error
    })

    const result = await updaters.refreshAllSessionTools()

    expect(result).toEqual([
      { sessionId: 'broken', ok: false, error: 'rebuild exploded' },
      { sessionId: 'fine', ok: true, toolCount: 2 },
    ])
    expect(mocks.logger.error).toHaveBeenCalledTimes(1)
    expect(mocks.logger.error.mock.calls[0][1]).toBe(error)
    // 失败的不推 state，成功的才推。
    expect(mocks.emitSessionEvent).toHaveBeenCalledTimes(1)
  })

  it('returns an empty report when no session is live', async () => {
    expect(await updaters.refreshAllSessionTools()).toEqual([])
  })
})

describe('refreshAllSessionModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agentSessions.clear()
    mocks.getSessionState.mockReturnValue({ snapshot: true })
  })

  it('skips streaming sessions, emits only for sessions whose model actually changed', async () => {
    const streaming = makeSession({ sessionId: 'streaming' })
    streaming.agent.state.isStreaming = true
    const unchanged = makeSession({ sessionId: 'unchanged' })
    const changed = makeSession({ sessionId: 'changed', model: 'old-model' })
    mocks.agentSessions.set('streaming', streaming)
    mocks.agentSessions.set('unchanged', unchanged)
    mocks.agentSessions.set('changed', changed)
    mocks.refreshSessionModelBinding.mockImplementation(async (session) => {
      if (session.sessionId === 'changed') session.model = 'new-model'
    })

    await updaters.refreshAllSessionModels()

    expect(mocks.refreshSessionModelBinding).toHaveBeenCalledTimes(2)
    expect(mocks.refreshSessionModelBinding).not.toHaveBeenCalledWith(streaming)
    expect(mocks.emitSessionEvent).toHaveBeenCalledTimes(1)
    expect(mocks.emitSessionEvent.mock.calls[0][0]).toBe(changed)
  })

  it('logs a failing session and keeps refreshing the rest', async () => {
    const broken = makeSession({ sessionId: 'broken' })
    const fine = makeSession({ sessionId: 'fine', model: 'old-model' })
    mocks.agentSessions.set('broken', broken)
    mocks.agentSessions.set('fine', fine)
    const error = new Error('model_not_configured')
    mocks.refreshSessionModelBinding.mockImplementation(async (session) => {
      if (session.sessionId === 'broken') throw error
      session.model = 'new-model'
    })

    await updaters.refreshAllSessionModels()

    expect(mocks.logger.error).toHaveBeenCalledTimes(1)
    expect(mocks.logger.error.mock.calls[0][1]).toBe(error)
    expect(fine.model).toBe('new-model')
  })
})

describe('MCP toolset subscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agentSessions.clear()
    mocks.getSessionState.mockReturnValue({})
  })

  it('registers a listener at import time', () => {
    // 调用记录被 beforeEach 的 clearAllMocks 清过，所以只能断言抓到的回调可用。
    expect(typeof mcpToolsetListener).toBe('function')
  })

  it('does nothing when no session is live', async () => {
    mcpToolsetListener()

    expect(mocks.rebuildSessionTools).not.toHaveBeenCalled()
  })

  it('rebuilds tools for live sessions and isolates a failing rebuild', async () => {
    mocks.agentSessions.set('session-1', makeSession())

    mcpToolsetListener()
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.rebuildSessionTools).toHaveBeenCalled()

    // refreshAllSessionTools 自己逐会话兜错，所以重连失败不会冒到订阅回调的
    // .catch：它落成一条 logger.error，而不是 logger.warn。
    mocks.rebuildSessionTools.mockRejectedValue(new Error('kaboom'))
    mcpToolsetListener()
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.logger.error).toHaveBeenCalledTimes(1)
    expect(mocks.logger.warn).not.toHaveBeenCalled()
  })
})
