import { afterEach, describe, expect, it, vi } from 'vitest'

// goal-waiters reaches the process-global event bus; give this file an
// isolated emitter so leaked listeners from other suites cannot interfere.
vi.mock('../../server/agent-session-events.mjs', async () => ({
  agentEvents: new (await import('node:events')).EventEmitter(),
  emitSessionEvent: vi.fn(),
  runtimePendingToolCalls: vi.fn(() => []),
}))

const {
  deleteDurableTerminalGoal,
  getGoalCompletionWaiterSet,
  hasGoalCompletionWaiter,
  markGoalSessionStopped,
  recordDurableGoal,
  waitForGoalCompletion,
} = await import('../../server/goal-waiters.mjs')
const { agentSessions } = await import('../../server/agent-session-store.mjs')
const goalState = await import('../../server/agent-goal-state.mjs')

const agentEvents = (await import('../../server/agent-session-events.mjs')).agentEvents

const activeSessionIds = []
afterEach(() => {
  for (const sessionId of activeSessionIds.splice(0)) agentSessions.delete(sessionId)
  agentEvents.removeAllListeners('agent_event')
})

function makeSession(sessionId, goal = null, overrides = {}) {
  const session = {
    sessionId,
    goal,
    goalRun: null,
    goalRunSettling: false,
    activePromptPromise: null,
    abortPending: false,
    agent: {
      state: { isStreaming: false, messages: [] },
      waitForIdle: vi.fn(async () => {}),
    },
    ...overrides,
  }
  agentSessions.set(sessionId, session)
  activeSessionIds.push(sessionId)
  return session
}

function activeGoal(sessionId) {
  return goalState.setGoalStatus(
    goalState.createGoalState({ sessionId, objective: 'Ship goal mode' }),
    'running',
  )
}

function terminalGoal(sessionId, status = 'completed') {
  return goalState.setGoalStatus(
    goalState.createGoalState({ sessionId, objective: 'Ship goal mode' }),
    status,
  )
}

/** Track settlement without forcing the caller to await a specific outcome. */
function track(promise) {
  const state = { settled: false, value: undefined, error: undefined }
  promise.then(
    (value) => { state.settled = true; state.value = value },
    (error) => { state.settled = true; state.error = error },
  )
  return state
}

async function flushAsync(ms = 25) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

describe('waitForGoalCompletion admission', () => {
  it('rejects a wait without a goalId before touching the session store', async () => {
    const listeners = agentEvents.listenerCount('agent_event')
    await expect(waitForGoalCompletion('any-session', '')).rejects.toThrow('No goal was created')
    await expect(waitForGoalCompletion('any-session', undefined)).rejects.toThrow('No goal was created')
    expect(hasGoalCompletionWaiter('any-session')).toBe(false)
    expect(agentEvents.listenerCount('agent_event')).toBe(listeners)
  })

  it('rejects a wait for an unknown session without registering anything', async () => {
    const listeners = agentEvents.listenerCount('agent_event')
    await expect(waitForGoalCompletion('missing-session', 'goal_1')).rejects.toThrow('removed')
    expect(hasGoalCompletionWaiter('missing-session')).toBe(false)
    expect(agentEvents.listenerCount('agent_event')).toBe(listeners)
  })

  it('disposes immediately when the session was already marked stopped', async () => {
    const session = makeSession('waiters-stopped', activeGoal('waiters-stopped'))
    markGoalSessionStopped(session)
    const listeners = agentEvents.listenerCount('agent_event')
    const state = track(waitForGoalCompletion(session.sessionId, 'goal_1'))
    await vi.waitFor(() => expect(state.settled).toBe(true))
    expect(state.error?.message).toContain('removed')
    expect(hasGoalCompletionWaiter(session.sessionId)).toBe(false)
    expect(agentEvents.listenerCount('agent_event')).toBe(listeners)
  })
})

describe('waitForGoalCompletion registration and cleanup', () => {
  it('exposes the live waiter set while pending and removes it on settlement', async () => {
    const session = makeSession('waiters-register', activeGoal('waiters-register'))
    const listeners = agentEvents.listenerCount('agent_event')
    const state = track(waitForGoalCompletion(session.sessionId, session.goal.id))
    expect(hasGoalCompletionWaiter(session.sessionId)).toBe(true)
    expect(getGoalCompletionWaiterSet(session.sessionId)).toBeInstanceOf(Set)
    expect(getGoalCompletionWaiterSet(session.sessionId)).toHaveLength(1)
    expect(agentEvents.listenerCount('agent_event')).toBe(listeners + 1)
    expect(getGoalCompletionWaiterSet('never-registered')).toBeUndefined()

    recordDurableGoal(session, goalState.setGoalStatus(session.goal, 'completed'))
    agentEvents.emit('agent_event', { sessionId: session.sessionId })
    await vi.waitFor(() => expect(state.settled).toBe(true))
    expect(state.error).toBeUndefined()
    expect(hasGoalCompletionWaiter(session.sessionId)).toBe(false)
    expect(getGoalCompletionWaiterSet(session.sessionId)).toBeUndefined()
    expect(agentEvents.listenerCount('agent_event')).toBe(listeners)
  })

  it('resolves every concurrent waiter for the same goal with the same snapshot', async () => {
    const session = makeSession('waiters-multi', activeGoal('waiters-multi'))
    const first = track(waitForGoalCompletion(session.sessionId, session.goal.id))
    const second = track(waitForGoalCompletion(session.sessionId, session.goal.id))
    expect(getGoalCompletionWaiterSet(session.sessionId)).toHaveLength(2)

    recordDurableGoal(session, goalState.setGoalStatus(session.goal, 'completed'))
    agentEvents.emit('agent_event', { sessionId: session.sessionId })
    await vi.waitFor(() => expect(first.settled && second.settled).toBe(true))
    expect(first.error).toBeUndefined()
    expect(second.error).toBeUndefined()
    expect(first.value).toEqual(second.value)
    expect(first.value.goal).toMatchObject({ status: 'completed' })
    expect(hasGoalCompletionWaiter(session.sessionId)).toBe(false)
  })

  it('keeps a waiter pending across events while only nonterminal snapshots exist', async () => {
    const session = makeSession('waiters-nonterminal', activeGoal('waiters-nonterminal'))
    const state = track(waitForGoalCompletion(session.sessionId, session.goal.id))
    recordDurableGoal(session, session.goal)
    agentEvents.emit('agent_event', { sessionId: session.sessionId })
    await flushAsync()
    expect(state.settled).toBe(false)
    expect(hasGoalCompletionWaiter(session.sessionId)).toBe(true)

    recordDurableGoal(session, goalState.setGoalStatus(session.goal, 'completed'))
    agentEvents.emit('agent_event', { sessionId: session.sessionId })
    await vi.waitFor(() => expect(state.settled).toBe(true))
    expect(state.error).toBeUndefined()
  })
})

describe('waitForGoalCompletion resolution contract', () => {
  it('resolves with the durable terminal snapshot including its messages', async () => {
    const session = makeSession('waiters-resolve', { id: 'goal_1', status: 'running' })
    session.agent.state.messages.push({ role: 'assistant', content: 'final answer' })
    const goal = terminalGoal(session.sessionId)
    recordDurableGoal(session, goal)
    const state = track(waitForGoalCompletion(session.sessionId, goal.id))
    await vi.waitFor(() => expect(state.settled).toBe(true))
    expect(state.value.goal).toEqual(goal)
    expect(state.value.messages).toEqual([{ role: 'assistant', content: 'final answer' }])
  })

  it('freezes the snapshot messages at record time', async () => {
    const session = makeSession('waiters-freeze', { id: 'goal_1', status: 'running' })
    const goal = terminalGoal(session.sessionId)
    session.agent.state.messages.push({ role: 'assistant', content: 'captured' })
    recordDurableGoal(session, goal)
    const state = track(waitForGoalCompletion(session.sessionId, goal.id))
    session.agent.state.messages.push({ role: 'user', content: 'later unrelated message' })
    agentEvents.emit('agent_event', { sessionId: session.sessionId })
    await vi.waitFor(() => expect(state.settled).toBe(true))
    expect(state.value.messages).toEqual([{ role: 'assistant', content: 'captured' }])
  })

  it('holds resolution while the goal run is still active, then resolves once it clears', async () => {
    const session = makeSession('waiters-run-active', { id: 'goal_1', status: 'running' })
    const goal = terminalGoal(session.sessionId)
    recordDurableGoal(session, goal)
    session.goalRun = { kind: 'execution', iteration: 1 }
    const state = track(waitForGoalCompletion(session.sessionId, goal.id))
    agentEvents.emit('agent_event', { sessionId: session.sessionId })
    await flushAsync()
    expect(state.settled).toBe(false)
    session.goalRun = null
    await vi.waitFor(() => expect(state.settled).toBe(true), { timeout: 2000 })
    expect(state.error).toBeUndefined()
  })
})

describe('waitForGoalCompletion disposal', () => {
  it('rejects a waiter whose session goal was replaced by another goal', async () => {
    const session = makeSession('waiters-replaced', activeGoal('waiters-replaced'))
    const listeners = agentEvents.listenerCount('agent_event')
    const state = track(waitForGoalCompletion(session.sessionId, session.goal.id))
    session.goal = activeGoal('other-session')
    agentEvents.emit('agent_event', { sessionId: session.sessionId })
    await vi.waitFor(() => expect(state.settled).toBe(true))
    expect(state.error?.message).toContain('removed')
    expect(hasGoalCompletionWaiter(session.sessionId)).toBe(false)
    expect(agentEvents.listenerCount('agent_event')).toBe(listeners)
  })

  it('rejects a waiter whose session left the store even when a terminal snapshot exists', async () => {
    const session = makeSession('waiters-removed', { id: 'goal_1', status: 'running' })
    const goal = terminalGoal(session.sessionId)
    recordDurableGoal(session, goal)
    const state = track(waitForGoalCompletion(session.sessionId, goal.id))
    agentSessions.delete(session.sessionId)
    agentEvents.emit('agent_event', { sessionId: session.sessionId })
    await vi.waitFor(() => expect(state.settled).toBe(true))
    expect(state.error?.message).toContain('removed')
    expect(hasGoalCompletionWaiter(session.sessionId)).toBe(false)
  })

  it('forgets a deleted terminal snapshot and rejects once the live goal is gone too', async () => {
    const session = makeSession('waiters-deleted', activeGoal('waiters-deleted'))
    recordDurableGoal(session, goalState.setGoalStatus(session.goal, 'completed'))
    deleteDurableTerminalGoal(session)
    const state = track(waitForGoalCompletion(session.sessionId, session.goal.id))
    await flushAsync()
    expect(state.settled).toBe(false)
    session.goal = null
    agentEvents.emit('agent_event', { sessionId: session.sessionId })
    await vi.waitFor(() => expect(state.settled).toBe(true))
    expect(state.error?.message).toContain('removed')
    expect(hasGoalCompletionWaiter(session.sessionId)).toBe(false)
  })
})
