import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 空闲回收只有一条主线：10 分钟没事就把会话销毁，但「还在跑」「还有目标等待」
// 「还有后台命令」三种情况必须只重置计时器。判据写反就会在用户看得见的地方把
// 正在干活的会话连根拔掉。
const mocks = vi.hoisted(() => ({
  agentSessions: new Map(),
  hasGoalCompletionWaiter: vi.fn(),
  listBackgroundCommandTasks: vi.fn(),
  destroyAgent: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../server/agent-session-store.mjs', () => ({ agentSessions: mocks.agentSessions }))
vi.mock('../../server/goal/engine.mjs', () => ({ hasGoalCompletionWaiter: mocks.hasGoalCompletionWaiter }))
vi.mock('../../server/tools/index.mjs', () => ({ listBackgroundCommandTasks: mocks.listBackgroundCommandTasks }))
vi.mock('../../server/agent-session-lifecycle.mjs', () => ({ destroyAgent: mocks.destroyAgent }))
vi.mock('../../server/utils/logger.mjs', () => ({ logger: mocks.logger }))

const { resetIdleTimer, touchSession } = await import('../../server/agent-idle-recycler.mjs')

const TEN_MINUTES = 10 * 60 * 1000

function makeSession(overrides = {}) {
  return { sessionId: 'session-1', status: 'idle', idleTimer: null, ...overrides }
}

describe('resetIdleTimer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agentSessions.clear()
    vi.useFakeTimers()
    mocks.hasGoalCompletionWaiter.mockReturnValue(false)
    mocks.listBackgroundCommandTasks.mockReturnValue([])
    mocks.destroyAgent.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('arms a timer for an ordinary session', () => {
    const session = makeSession()

    resetIdleTimer(session)

    expect(session.idleTimer).toBeTruthy()
    expect(mocks.destroyAgent).not.toHaveBeenCalled()
  })

  it('does not arm anything for a session that must be retained', () => {
    const session = makeSession({ idleRetention: 'always' })

    resetIdleTimer(session)

    expect(session.idleTimer).toBeNull()
    vi.advanceTimersByTime(TEN_MINUTES)
    expect(mocks.destroyAgent).not.toHaveBeenCalled()
  })

  it('replaces an existing timer instead of stacking a second one', () => {
    const session = makeSession()
    resetIdleTimer(session)
    const first = session.idleTimer

    resetIdleTimer(session)

    expect(session.idleTimer).not.toBe(first)
    vi.advanceTimersByTime(TEN_MINUTES)
    // 旧计时器已被清掉，只应该销毁一次。
    expect(mocks.destroyAgent).toHaveBeenCalledTimes(1)
  })

  it('destroys the session after ten minutes of idleness', () => {
    const session = makeSession()

    resetIdleTimer(session)
    vi.advanceTimersByTime(TEN_MINUTES)

    expect(mocks.destroyAgent).toHaveBeenCalledWith('session-1')
    expect(mocks.logger.info.mock.calls[0][0]).toContain('idle timeout')
  })

  it('only re-arms while the session is still running', () => {
    const session = makeSession({ status: 'running' })

    resetIdleTimer(session)
    vi.advanceTimersByTime(TEN_MINUTES)

    expect(mocks.destroyAgent).not.toHaveBeenCalled()
    expect(session.idleTimer).toBeTruthy()
    expect(mocks.logger.info.mock.calls[0][0]).toContain('still running')

    // 跑完了，下一个窗口到点就该销毁。
    session.status = 'idle'
    vi.advanceTimersByTime(TEN_MINUTES)
    expect(mocks.destroyAgent).toHaveBeenCalledTimes(1)
  })

  it('only re-arms while a goal completion waiter is registered', () => {
    const session = makeSession()
    mocks.hasGoalCompletionWaiter.mockReturnValue(true)

    resetIdleTimer(session)
    vi.advanceTimersByTime(TEN_MINUTES)

    expect(mocks.destroyAgent).not.toHaveBeenCalled()
    expect(mocks.hasGoalCompletionWaiter).toHaveBeenCalledWith('session-1')
  })

  it('only re-arms while background commands still own the session', () => {
    const session = makeSession()
    mocks.listBackgroundCommandTasks.mockReturnValue([{ id: 'task-1' }])

    resetIdleTimer(session)
    vi.advanceTimersByTime(TEN_MINUTES)

    expect(mocks.destroyAgent).not.toHaveBeenCalled()
    expect(mocks.logger.info.mock.calls[0][0]).toContain('background commands')
  })

  it('logs instead of throwing when destroy fails', async () => {
    const session = makeSession()
    const failure = new Error('destroy failed')
    mocks.destroyAgent.mockRejectedValue(failure)

    resetIdleTimer(session)
    vi.advanceTimersByTime(TEN_MINUTES)
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.logger.error).toHaveBeenCalledTimes(1)
    expect(mocks.logger.error.mock.calls[0][1]).toBe(failure)
  })
})

describe('touchSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agentSessions.clear()
    vi.useFakeTimers()
    mocks.hasGoalCompletionWaiter.mockReturnValue(false)
    mocks.listBackgroundCommandTasks.mockReturnValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resets the timer for a live session and reports a hit', () => {
    const session = makeSession()
    mocks.agentSessions.set('session-1', session)

    expect(touchSession('session-1')).toBe(true)
    expect(session.idleTimer).toBeTruthy()
  })

  it('reports a miss for an unknown session', () => {
    expect(touchSession('missing')).toBe(false)
  })
})
