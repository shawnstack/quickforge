import { beforeEach, describe, expect, it, vi } from 'vitest'

// 后台命令退出通知的分流逻辑：落定 toolResult → 推事件 → 决定这条通知是
// 立刻开跑（prompt）、塞进当前流（followUp）、还是挂起到 goal 结束。分支多、
// 每条都影响「模型的下一句话从哪来」，所以逐条锁住。
const mocks = vi.hoisted(() => ({
  emitSessionEvent: vi.fn(),
  scheduleSessionPersist: vi.fn(),
  listBackgroundCommandTasks: vi.fn(),
  activeGoalStatus: vi.fn(),
  resetIdleTimer: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../server/agent-session-events.mjs', () => ({ emitSessionEvent: mocks.emitSessionEvent }))
vi.mock('../../server/agent-persistence.mjs', () => ({ scheduleSessionPersist: mocks.scheduleSessionPersist }))
vi.mock('../../server/tools/index.mjs', () => ({ listBackgroundCommandTasks: mocks.listBackgroundCommandTasks }))
vi.mock('../../server/goal/engine.mjs', () => ({ activeGoalStatus: mocks.activeGoalStatus }))
vi.mock('../../server/agent-idle-recycler.mjs', () => ({ resetIdleTimer: mocks.resetIdleTimer }))
vi.mock('../../server/utils/logger.mjs', () => ({ logger: mocks.logger }))

const { deliverBackgroundCommandNotification } = await import('../../server/agent-background-commands.mjs')

function makeSession(options = {}) {
  const session = {
    sessionId: options.sessionId ?? 'session-1',
    agent: {
      state: {
        messages: options.messages ?? [],
        isStreaming: options.isStreaming ?? false,
      },
      followUp: vi.fn(),
      prompt: vi.fn(() => Promise.resolve()),
    },
  }
  if (options.abortPending !== undefined) session.abortPending = options.abortPending
  if (options.goalRunSettling !== undefined) session.goalRunSettling = options.goalRunSettling
  if (options.pendingBackgroundCommandNotices) session.pendingBackgroundCommandNotices = options.pendingBackgroundCommandNotices
  return session
}

function toolResultMessage(overrides = {}) {
  return {
    role: 'toolResult',
    toolCallId: 'call-1',
    content: [{ type: 'text', text: 'running…' }],
    details: { background: true, running: true, command: 'npm test' },
    ...overrides,
  }
}

function makeNotification(overrides = {}) {
  return {
    taskId: 'task-1',
    toolCallId: 'call-1',
    outputFile: 'out.log',
    phase: 'exit',
    text: '<task-notification> build finished',
    details: { status: 'completed' },
    result: { content: 'exit 0', details: { exitCode: 0 }, isError: false },
    ...overrides,
  }
}

describe('deliverBackgroundCommandNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.activeGoalStatus.mockReturnValue(null)
    mocks.listBackgroundCommandTasks.mockReturnValue([{ id: 'from-store' }])
  })

  it('does nothing without a session', () => {
    deliverBackgroundCommandNotification(null, makeNotification())
    expect(mocks.emitSessionEvent).not.toHaveBeenCalled()
  })

  it('settles the matching toolResult message and pushes the refreshed messages with the event', () => {
    const session = makeSession({ messages: [toolResultMessage()] })

    deliverBackgroundCommandNotification(session, makeNotification())

    const settled = session.agent.state.messages[0]
    expect(settled.content).toEqual([{ type: 'text', text: 'exit 0' }])
    expect(settled.details).toMatchObject({ background: false, running: false, toolCallId: 'call-1', exitCode: 0 })
    // 原有 details 不被覆盖掉。
    expect(settled.details.command).toBe('npm test')
    expect(settled.isError).toBe(false)

    const backgroundEvent = mocks.emitSessionEvent.mock.calls[0][1]
    expect(backgroundEvent.type).toBe('background_commands')
    expect(backgroundEvent.messages).toBe(session.agent.state.messages)
    // 落定过才落盘。
    expect(mocks.scheduleSessionPersist).toHaveBeenCalledWith(session)
  })

  it('marks the toolResult as an error when the result says so', () => {
    const session = makeSession({ messages: [toolResultMessage()] })

    deliverBackgroundCommandNotification(session, makeNotification({ result: { content: 'boom', isError: true } }))

    expect(session.agent.state.messages[0].isError).toBe(true)
    expect(session.agent.state.messages[0].details.running).toBe(false)
  })

  it('falls back to the task store when the notification carries no task list', () => {
    const session = makeSession({ messages: [toolResultMessage()] })

    deliverBackgroundCommandNotification(session, makeNotification())

    expect(mocks.listBackgroundCommandTasks).toHaveBeenCalledWith('session-1')
    expect(mocks.emitSessionEvent.mock.calls[0][1].backgroundCommands).toEqual([{ id: 'from-store' }])
  })

  it('prefers the task list carried by the notification', () => {
    const session = makeSession({ messages: [toolResultMessage()] })
    const tasks = [{ id: 'from-notification' }]

    deliverBackgroundCommandNotification(session, makeNotification({ tasks }))

    expect(mocks.listBackgroundCommandTasks).not.toHaveBeenCalled()
    expect(mocks.emitSessionEvent.mock.calls[0][1].backgroundCommands).toBe(tasks)
  })

  it('does not settle, persist or echo messages when no toolResult matches', () => {
    const session = makeSession({ messages: [toolResultMessage({ toolCallId: 'other-call' })] })

    deliverBackgroundCommandNotification(session, makeNotification())

    const backgroundEvent = mocks.emitSessionEvent.mock.calls[0][1]
    expect(backgroundEvent).not.toHaveProperty('messages')
    expect(mocks.scheduleSessionPersist).not.toHaveBeenCalled()
    expect(session.agent.state.messages[0].details.running).toBe(true)
  })

  it('skips the follow-up message for the start phase but still refreshes the task list', () => {
    const session = makeSession({ messages: [toolResultMessage()] })

    deliverBackgroundCommandNotification(session, makeNotification({ phase: 'start' }))

    expect(mocks.emitSessionEvent).toHaveBeenCalledTimes(1)
    expect(session.agent.prompt).not.toHaveBeenCalled()
    expect(session.agent.followUp).not.toHaveBeenCalled()
    expect(mocks.resetIdleTimer).not.toHaveBeenCalled()
  })

  it('ignores text that is not a task notification', () => {
    const session = makeSession({ messages: [toolResultMessage()] })

    deliverBackgroundCommandNotification(session, makeNotification({ text: 'just some output' }))

    expect(mocks.emitSessionEvent).toHaveBeenCalledTimes(1)
    expect(session.agent.prompt).not.toHaveBeenCalled()
  })

  it.each([
    ['isStreaming', { isStreaming: true }],
    ['abortPending', { abortPending: true }],
    ['goalRunSettling', { goalRunSettling: true }],
  ])('hands the notice to followUp while %s', (_label, options) => {
    const session = makeSession({ messages: [toolResultMessage()], ...options })

    deliverBackgroundCommandNotification(session, makeNotification())

    expect(session.agent.followUp).toHaveBeenCalledTimes(1)
    expect(session.agent.prompt).not.toHaveBeenCalled()
    expect(mocks.resetIdleTimer).toHaveBeenCalledWith(session)
  })

  it('queues the notice while a goal is running instead of starting a run', () => {
    mocks.activeGoalStatus.mockReturnValue({ status: 'running' })
    const session = makeSession({ messages: [toolResultMessage()], pendingBackgroundCommandNotices: [{ role: 'user', content: 'earlier' }] })

    deliverBackgroundCommandNotification(session, makeNotification())

    expect(session.agent.prompt).not.toHaveBeenCalled()
    expect(session.agent.followUp).not.toHaveBeenCalled()
    expect(session.pendingBackgroundCommandNotices).toHaveLength(2)
    expect(session.pendingBackgroundCommandNotices[1].content).toBe('<task-notification> build finished')
  })

  it('starts a new run when nothing is streaming and no goal is active', () => {
    const session = makeSession({ messages: [toolResultMessage()] })

    deliverBackgroundCommandNotification(session, makeNotification())

    expect(session.agent.prompt).toHaveBeenCalledTimes(1)
    const message = session.agent.prompt.mock.calls[0][0]
    expect(message.role).toBe('user')
    expect(message.content).toBe('<task-notification> build finished')
    expect(message.details.quickforgeBackgroundCommand).toEqual({
      taskId: 'task-1',
      toolCallId: 'call-1',
      outputFile: 'out.log',
      status: 'completed',
    })
    expect(typeof message.timestamp).toBe('number')
  })

  it('emits the task-notification event with the fields the UI needs, after background_commands', () => {
    const session = makeSession({ messages: [toolResultMessage()] })

    deliverBackgroundCommandNotification(session, makeNotification())

    const types = mocks.emitSessionEvent.mock.calls.map((call) => call[1].type)
    expect(types).toEqual(['background_commands', 'task-notification'])
    expect(mocks.emitSessionEvent.mock.calls[1][1]).toEqual({
      type: 'task-notification',
      taskId: 'task-1',
      toolCallId: 'call-1',
      outputFile: 'out.log',
      status: 'completed',
      text: '<task-notification> build finished',
    })
  })

  it('logs instead of throwing when the prompt rejects', async () => {
    const session = makeSession({ messages: [toolResultMessage()] })
    const error = new Error('model exploded')
    session.agent.prompt.mockImplementation(() => Promise.reject(error))

    deliverBackgroundCommandNotification(session, makeNotification())
    await Promise.resolve()

    expect(mocks.logger.error).toHaveBeenCalledTimes(1)
    expect(mocks.logger.error.mock.calls[0][0]).toContain('session-1')
    expect(mocks.logger.error.mock.calls[0][1]).toBe(error)
  })

  it('stops after the events when the session has no agent', () => {
    const session = makeSession({ messages: [toolResultMessage()] })
    delete session.agent

    expect(() => deliverBackgroundCommandNotification(session, makeNotification())).not.toThrow()
    expect(mocks.emitSessionEvent).toHaveBeenCalledTimes(1)
  })

  it('still emits background_commands when the session has no message list', () => {
    const session = { sessionId: 'session-9', agent: { state: {}, prompt: vi.fn(() => Promise.resolve()), followUp: vi.fn() } }

    deliverBackgroundCommandNotification(session, makeNotification())

    expect(mocks.emitSessionEvent.mock.calls[0][1].backgroundCommands).toEqual([{ id: 'from-store' }])
    expect(mocks.scheduleSessionPersist).not.toHaveBeenCalled()
  })
})
