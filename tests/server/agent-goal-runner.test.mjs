import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentSessions } from '../../server/agent-session-store.mjs'

const mocks = vi.hoisted(() => ({
  persistSession: vi.fn(async () => ({ id: 'persisted' })),
  emitSessionEvent: vi.fn(),
  readStore: vi.fn(async () => ({})),
  readSessionStateRecord: vi.fn(() => null),
  refreshTools: vi.fn(async () => {}),
  pendingApproval: vi.fn(() => null),
  pendingAsk: vi.fn(() => null),
  pendingTools: vi.fn(() => []),
}))

vi.mock('../../server/agent-persistence.mjs', () => ({ persistSession: mocks.persistSession }))
vi.mock('../../server/agent-session-events.mjs', () => ({
  emitSessionEvent: mocks.emitSessionEvent,
  runtimePendingToolCalls: mocks.pendingTools,
}))
vi.mock('../../server/approval-store.mjs', () => ({ getPendingApprovalForSession: mocks.pendingApproval }))
vi.mock('../../server/ask-store.mjs', () => ({ getPendingAskForSession: mocks.pendingAsk }))
vi.mock('../../server/storage.mjs', () => ({ readStore: mocks.readStore }))
vi.mock('../../server/session-state-service.mjs', () => ({ readSessionStateRecord: mocks.readSessionStateRecord }))
vi.mock('../../server/tools/definitions.mjs', () => ({
  goalReportTool: { name: 'goal_report', label: 'Report goal progress', description: 'x', parameters: {} },
}))
vi.mock('../../server/agent-profile-schema.mjs', () => ({
  normalizeCapabilityPolicy: (value, tools = []) => (
    value || (tools.includes('write_file') ? 'code-edit' : 'readonly-research')
  ),
}))
vi.mock('../../server/utils/logger.mjs', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const {
  beginGoalRun,
  clearTerminalGoal,
  configureGoalRunner,
  createGoalReportTool,
  failGoalRunOnPersist,
  finishGoalRun,
  goalPlanningPrompt,
  goalContinuationPrompt,
  goalPlanningToolBlockReason,
  goalRunSettlementToolBlockReason,
  handleGoalAction,
  isGoalModeAvailable,
  notifyGoalAbort,
  notifyGoalApprovalOutcome,
  notifyGoalApprovalRequested,
  notifyGoalAskOutcome,
  notifyGoalAskRequested,
  recordGoalToolExecution,
  startGoalPlanning,
} = await import('../../server/agent-goal-runner.mjs')

it('planning and continuation delegate announcements to UI while preserving substantive output and completion barrier', () => {
  const goal = { objective: 'test', criteria: [], evidence: [], scope: [], status: 'running' }
  for (const prompt of [goalPlanningPrompt(goal), goalContinuationPrompt(goal, 2, 8)]) {
    expect(prompt).toContain('Do not repeat the round number, announce continuing or replanning')
    expect(prompt).toContain('submitting complete / waiting for settlement')
    expect(prompt).toContain('Keep substantive analysis, necessary questions, concrete blockers, and a concise final summary')
    expect(prompt).toContain('Never claim the goal is completed before')
  }
})

function toolResult(toolCallId, { isError = false, toolName = 'run_command' } = {}) {
  return { role: 'toolResult', toolCallId, toolName, content: [{ type: 'text', text: 'ok' }], isError }
}

/** Real run_command tool result shape: exit info lives in details. */
function commandResult({ code = 0, signal = null, timedOut = false, aborted = false } = {}) {
  return {
    content: [{ type: 'text', text: 'ok' }],
    details: { code, signal, timedOut, aborted },
  }
}

/** Simulate the manager's tool_execution_end forward for a successful tool. */
function trustTool(session, toolCallId, { toolName = 'run_command', isError = false, result } = {}) {
  recordGoalToolExecution(session, {
    toolCallId,
    toolName,
    isError,
    result: result ?? (toolName === 'run_command' ? commandResult() : undefined),
  })
}

function makeSession(overrides = {}) {
  const session = {
    sessionId: 'goal-session-1',
    scope: 'global',
    projectId: null,
    source: null,
    goal: null,
    goalRun: null,
    goalStats: null,
    goalContinuationPending: false,
    goalRunSettling: false,
    goalAbortGeneration: 0,
    goalTerminationKind: null,
    abortPending: false,
    activeCommandName: null,
    activeCommandPermissions: null,
    activeCommandPrompt: null,
    agent: {
      state: { isStreaming: false, messages: [] },
      prompt: vi.fn(async () => {}),
      abort: vi.fn(),
      waitForIdle: vi.fn(async () => {}),
    },
    ...overrides,
  }
  agentSessions.set(session.sessionId, session)
  return session
}

async function startedGoal(session, objective = 'Ship goal mode') {
  const result = await startGoalPlanning(session, objective)
  expect(result.error).toBeUndefined()
  return result
}

async function confirmedGoal(session) {
  await startedGoal(session)
  await planGoal(session)
  await handleGoalAction(session, 'confirm')
  // Let the first continuation run and settle it deterministically: the run
  // hook is what normally clears goalRun at agent_end.
  await vi.waitFor(() => expect(session.agent.prompt).toHaveBeenCalledTimes(1))
  session.agent.state.isStreaming = false
  session.goalContinuationPending = true
  await finishGoalRun(session, { status: 'idle' })
  session.goalContinuationPending = false
  return session.goal
}

async function planGoal(session, criteria = [{ description: 'Tests pass', required: true }]) {
  const tool = createGoalReportTool(session)
  await tool.execute('call-plan', { action: 'plan', summary: 'Plan', criteria, scope: ['server/'] })
}

function resetRunStats(session) {
  session.goalStats = { consecutiveFailures: 0, noProgressRuns: 0, planningAttempts: 0, pauseRequested: false }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function completedGoalBody(session, action = 'complete') {
  beginGoalRun(session, 'execution')
  trustTool(session, 'tool-1')
  const result = await createGoalReportTool(session).execute('call-complete', {
    action,
    summary: 'All done',
    evidence: [{ id: 'e1', description: 'tests passed', toolCallId: 'tool-1' }],
    criterionUpdates: [{ id: 'c1', status: 'passed', evidenceIds: ['e1'] }],
  })
  await finishGoalRun(session, { status: 'idle' })
  return result
}

function extendGoal(session, options = {}) {
  return handleGoalAction(session, 'extend_resume', undefined, null, {
    goalId: session.goal.id, expectedRevision: session.goal.revision, ...options,
  })
}

describe('goal runner', () => {
  it('auto-starts a persisted normal plan, staying read-only through the planning turn without a duration watchdog', async () => {
    const session = makeSession()
    await startedGoal(session)
    const run = beginGoalRun(session, 'planning')
    expect(run.watchdog).toBeNull()
    run.startedAt -= 9_000_000
    await planGoal(session)
    expect(goalPlanningToolBlockReason(session, 'write_file', {})).toBeTruthy()
    expect(session.agent.prompt).not.toHaveBeenCalled()
    const gate = deferred()
    mocks.persistSession.mockImplementationOnce(() => gate.promise)
    const finishing = finishGoalRun(session, { status: 'idle' })
    await Promise.resolve()
    expect(session.agent.prompt).not.toHaveBeenCalled()
    expect(session.goalRun).toBeNull()
    expect(goalPlanningToolBlockReason(session, 'write_file', {})).toBeTruthy()
    expect(goalPlanningToolBlockReason(session, 'run_command', {})).toBeTruthy()
    expect(goalPlanningToolBlockReason(session, 'read_file', {})).toBeNull()
    gate.resolve({ id: 'saved' })
    await finishing
    expect(session.goal).toMatchObject({ status: 'running', planConfirmed: true, budget: { maxActiveDurationMs: null } })
    expect(session.goal.usage.activeDurationMs).toBeGreaterThanOrEqual(9_000_000)
    await vi.waitFor(() => expect(session.agent.prompt).toHaveBeenCalledTimes(1))
    await handleGoalAction(session, 'cancel')
  })

  it.each(['error', 'aborted', 'persist'])('does not auto-start a submitted plan after %s', async (ending) => {
    const session = makeSession()
    await startedGoal(session)
    beginGoalRun(session, 'planning')
    await planGoal(session)
    if (ending === 'persist') await failGoalRunOnPersist(session)
    else await finishGoalRun(session, { status: ending })
    expect(session.goal.status).toBe('paused')
    expect(session.goalContinuationPending).toBe(false)
    expect(session.agent.prompt).not.toHaveBeenCalled()
  })

  it.each(['abort', 'cancel', 'failure'])('does not auto-start when planning final persist races %s', async (intent) => {
    const session = makeSession()
    await startedGoal(session)
    beginGoalRun(session, 'planning')
    await planGoal(session)
    const gate = deferred()
    mocks.persistSession.mockImplementationOnce(() => gate.promise)
    const finishing = finishGoalRun(session, { status: 'idle' })
    await Promise.resolve()
    if (intent === 'abort') await notifyGoalAbort(session)
    if (intent === 'cancel') await handleGoalAction(session, 'cancel')
    gate.resolve(intent === 'failure' ? null : { id: 'saved' })
    await finishing
    expect(session.goal.status).toBe(intent === 'cancel' ? 'cancelled' : 'paused')
    expect(session.goalContinuationPending).toBe(false)
    expect(session.agent.prompt).not.toHaveBeenCalled()
  })

  it('resumes a legacy duration-only pause without resetting usage or adding iterations', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    session.goal.status = 'paused'
    session.goal.blocker = 'duration_budget'
    session.goal.budget.maxActiveDurationMs = 1000
    session.goal.usage.activeDurationMs = 2000
    const iterations = session.goal.usage.iterations
    const resumed = await handleGoalAction(session, 'resume')
    expect(resumed).toMatchObject({ status: 'running', budget: { maxIterations: 8, maxActiveDurationMs: null }, usage: { iterations, activeDurationMs: 2000 } })
    expect(resumed.blocker).toBeFalsy()
    await handleGoalAction(session, 'cancel')
  })

  it.each(['idle', 'error'])('keeps needs_review blocked after a necessary question and %s ending', async (status) => {
    const session = makeSession()
    await confirmedGoal(session)
    const prompts = session.agent.prompt.mock.calls.length
    beginGoalRun(session, 'execution')
    await createGoalReportTool(session).execute('review', { action: 'needs_review', blocker: 'Missing verification access' })
    for (const tool of ['write_file', 'run_command', 'run_subagent', 'goal_report']) {
      expect(goalRunSettlementToolBlockReason(session, tool)).toBeTruthy()
    }
    expect(goalRunSettlementToolBlockReason(session, 'ask_user')).toBeNull()
    expect(goalRunSettlementToolBlockReason(session, 'read_file')).toBeNull()
    await notifyGoalAskRequested(session)
    await notifyGoalAskOutcome(session)
    expect(goalRunSettlementToolBlockReason(session, 'write_file')).toBeTruthy()
    await finishGoalRun(session, { status })
    expect(session.goal).toMatchObject({ status: 'blocked', blocker: 'Missing verification access', evidence: [] })
    expect(session.goal.criteria[0].status).toBe('pending')
    expect(session.goalContinuationPending).toBe(false)
    expect(session.agent.prompt).toHaveBeenCalledTimes(prompts)
  })

  it('reports unverifiable criteria as blocked without human acceptance or fabricated passes', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    beginGoalRun(session, 'execution')
    await createGoalReportTool(session).execute('review', { action: 'needs_review', summary: 'Cannot verify subjective appearance' })
    expect(session.goal.status).toBe('blocked')
    expect(session.goal.blocker).toContain('Unable to verify')
    expect(session.goal.criteria[0].status).toBe('pending')
    expect(session.goal.evidence).toEqual([])
    await finishGoalRun(session, { status: 'idle' })
    expect(session.goal.status).toBe('blocked')
  })

  async function reportedRun() {
    const session = makeSession()
    await confirmedGoal(session)
    session.agent.state.messages.push({ role: 'assistant', content: 'previous' })
    beginGoalRun(session, 'execution')
    session.agent.state.messages.push({ role: 'user', content: 'continue' }, { role: 'assistant', content: 'done' })
    trustTool(session, 'tool-1')
    const result = await createGoalReportTool(session).execute('complete', {
      action: 'complete', summary: 'done',
      evidence: [{ id: 'e1', description: 'tests', toolCallId: 'tool-1' }],
      criterionUpdates: [{ id: 'c1', status: 'passed', evidenceIds: ['e1'] }],
    })
    expect(JSON.stringify(result)).toContain('submitting complete / waiting for settlement')
    expect(JSON.stringify(result)).toContain('Never claim the goal is completed before')
    return session
  }

  it.each(['error', 'aborted'])('never completes a reported run ending %s', async (status) => {
    const session = await reportedRun()
    session.goalContinuationPending = true
    await finishGoalRun(session, { status })
    expect(session.goal.status).not.toBe('completed')
    expect(session.agent.state.messages[0].details).toBeUndefined()
    expect(session.agent.state.messages[2].details.quickforgeGoalIteration.outcome).toBe(status === 'error' ? 'error' : 'paused')
  })

  it('keeps completion private until durable and synchronizes its message marker', async () => {
    const session = await reportedRun()
    const syncMessages = vi.fn()
    configureGoalRunner({ syncMessages })
    const gate = deferred()
    mocks.persistSession.mockImplementationOnce(async (_session, options) => {
      expect(options.goal.status).toBe('completed')
      expect(options.messages[2].details.quickforgeGoalIteration.outcome).toBe('completed')
      return gate.promise
    })
    const finishing = finishGoalRun(session, { status: 'idle' })
    expect(session.goal.status).toBe('verifying')
    expect(session.agent.state.messages[2].details).toBeUndefined()
    gate.resolve({ id: 'persisted' })
    await finishing
    expect(session.goal.status).toBe('completed')
    expect(session.agent.state.messages[2].details.quickforgeGoalIteration).toMatchObject({ goalId: session.goal.id, iteration: 2, outcome: 'completed' })
    expect(syncMessages).toHaveBeenCalledWith(session)
  })

  it.each(['abort', 'cancel', 'persist_failure'])('fails closed when %s arrives during completion persistence', async (intent) => {
    const session = await reportedRun()
    const gate = deferred()
    mocks.persistSession.mockImplementationOnce(() => gate.promise)
    const finishing = finishGoalRun(session, { status: 'idle' })
    if (intent === 'abort') await notifyGoalAbort(session)
    if (intent === 'cancel') await handleGoalAction(session, 'cancel')
    gate.resolve(intent === 'persist_failure' ? null : { id: 'persisted' })
    await finishing
    expect(session.goal.status).toBe(intent === 'cancel' ? 'cancelled' : 'paused')
    expect(session.agent.state.messages[2].details.quickforgeGoalIteration.outcome).not.toBe('completed')
    expect(session.goalContinuationPending).toBe(false)
  })

  it('completes verified success on the final admitted iteration', async () => {
    const session = await reportedRun()
    session.goal.usage.iterations = session.goal.budget.maxIterations
    session.goalRun.iteration = session.goal.budget.maxIterations
    await finishGoalRun(session, { status: 'idle' })
    expect(session.goal.status).toBe('completed')
    expect(session.agent.state.messages[2].details.quickforgeGoalIteration).toMatchObject({ iteration: 8, outcome: 'completed' })
  })

  it.each(['error', 'aborted', 'duration', 'both', 'unfinished'])('does not complete the last iteration when %s', async (ending) => {
    const session = await reportedRun()
    session.goal.usage.iterations = session.goal.budget.maxIterations
    if (ending === 'duration' || ending === 'both') {
      session.goal.budget.maxActiveDurationMs = 7200000 // Legacy live finite budget.
      session.goal.usage.activeDurationMs = 7200000
    }
    if (ending === 'duration') session.goal.usage.iterations = 2
    if (ending === 'unfinished') session.goalRun.pendingDisposition = null
    await finishGoalRun(session, { status: ending === 'error' || ending === 'aborted' ? ending : 'idle' })
    expect(session.goal.status).toBe('paused')
    expect(session.goal.blocker).toBe(ending === 'aborted' ? 'user_aborted' : ending === 'duration' || ending === 'both' ? 'duration_budget' : 'iteration_budget')
    expect(session.goalContinuationPending).toBe(false)
  })

  it('anchors user-only rounds locally and leaves previous assistants untouched', async () => {
    const session = await reportedRun()
    session.agent.state.messages.pop()
    await finishGoalRun(session, { status: 'idle' })
    expect(session.agent.state.messages[0].details).toBeUndefined()
    expect(session.agent.state.messages[1].details.quickforgeGoalIteration.outcome).toBe('completed')
  })

  it('pauses with a marker when the initial run persist fails', async () => {
    const session = await reportedRun()
    await failGoalRunOnPersist(session)
    expect(session.goal).toMatchObject({ status: 'paused', blocker: 'persist_failed' })
    expect(session.agent.state.messages[2].details.quickforgeGoalIteration.outcome).toBe('paused')
  })

  it('does not complete without an active run', async () => {
    const session = await reportedRun()
    clearTimeout(session.goalRun.watchdog)
    session.goalRun = null
    await expect(createGoalReportTool(session).execute('complete', { action: 'complete' })).rejects.toThrow('active run')
  })

  it.each(['duration', 'iterations', 'both'])('extends only exhausted limits (%s), preserving progress and usage', async (dimension) => {
    const session = makeSession()
    await startedGoal(session)
    await planGoal(session)
    session.goal.status = 'paused'
    session.goal.planConfirmed = true // Fixture represents an already confirmed execution plan.
    session.goal.budget.maxActiveDurationMs = 7200000 // Legacy limit is removed, not extended.
    session.goal.usage = { iterations: dimension === 'duration' ? 2 : 8, activeDurationMs: dimension === 'iterations' ? 100 : 7200000 }
    session.goal.evidence = [{ id: 'e1', description: 'Saved result' }]
    const previous = structuredClone(session.goal)
    const next = await extendGoal(session)
    expect(next).toMatchObject({ id: previous.id, criteria: previous.criteria, evidence: previous.evidence, summary: previous.summary, scope: previous.scope, usage: previous.usage, status: 'running' })
    expect(next.revision).toBe(previous.revision + 1)
    expect(next.budget).toEqual({ maxIterations: dimension === 'duration' ? 8 : 16, maxActiveDurationMs: null })
    await handleGoalAction(session, 'cancel')
  })

  it.each(['pendingApproval', 'pendingAsk', 'pendingTools'])('rejects extension with %s', async (pending) => {
    const session = makeSession()
    await startedGoal(session)
    session.goal.status = 'paused'
    session.goal.usage.iterations = 8
    mocks[pending].mockReturnValue(pending === 'pendingTools' ? [{}] : {})
    await expect(extendGoal(session)).rejects.toMatchObject({ errorCode: 'GOAL_SESSION_BUSY' })
    expect(session.goal.budget.maxIterations).toBe(8)
  })

  it('keeps cancellation when extension persistence fails concurrently', async () => {
    const session = makeSession()
    await startedGoal(session)
    session.goal.status = 'paused'
    session.goal.usage.iterations = 8
    const gate = deferred()
    mocks.persistSession.mockImplementationOnce(() => gate.promise)
    const extension = extendGoal(session)
    const assertion = expect(extension).rejects.toMatchObject({ errorCode: 'SESSION_PERSIST_FAILED' })
    await vi.waitFor(() => expect(session.goal.status).toBe('planning'))
    await handleGoalAction(session, 'cancel')
    gate.resolve(null)
    await assertion
    expect(session.goal.status).toBe('cancelled')
    expect(session.agent.prompt).not.toHaveBeenCalled()
  })

  it('charges planning duration even when final persistence fails', async () => {
    const session = makeSession()
    await startedGoal(session)
    const run = beginGoalRun(session, 'planning')
    run.startedAt -= 1500
    await failGoalRunOnPersist(session)
    expect(session.goal.usage.iterations).toBe(0)
    expect(session.goal.usage.activeDurationMs).toBeGreaterThanOrEqual(1500)
    expect(session.goal.status).toBe('paused')
  })

  it('serializes duplicate revision requests and never adds twice', async () => {
    const session = makeSession()
    await startedGoal(session)
    session.goal.status = 'blocked'
    session.goal.budget.maxActiveDurationMs = 7200000
    session.goal.usage.activeDurationMs = 7200000
    const expectedRevision = session.goal.revision
    const results = await Promise.allSettled([extendGoal(session, { expectedRevision }), extendGoal(session, { expectedRevision })])
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(results[1].reason.errorCode).toBe('GOAL_REVISION_CONFLICT')
    expect(session.goal.status).toBe('planning')
    expect(session.goal.budget.maxActiveDurationMs).toBeNull()
    await handleGoalAction(session, 'cancel')
    await expect(extendGoal(session, { expectedRevision })).rejects.toMatchObject({ errorCode: 'GOAL_REVISION_CONFLICT' })
  })

  it('rolls back the budget and state when extension persist fails and never starts', async () => {
    const session = makeSession()
    await startedGoal(session)
    session.goal.status = 'paused'
    session.goal.usage.iterations = 8
    const previous = structuredClone(session.goal)
    mocks.persistSession.mockResolvedValueOnce(null)
    await expect(extendGoal(session)).rejects.toMatchObject({ errorCode: 'SESSION_PERSIST_FAILED' })
    expect(session.goal).toEqual(previous)
    expect(session.goalContinuationPending).toBe(false)
    expect(session.agent.prompt).not.toHaveBeenCalled()
  })

  it.each(['streaming', 'abortPending', 'goalRunSettling', 'goalContinuationPending', 'activePromptPromise', 'goalRun'])('rejects extension while busy: %s', async (busy) => {
    const session = makeSession()
    await startedGoal(session)
    session.goal.status = 'paused'
    session.goal.usage.iterations = 8
    if (busy === 'streaming') session.agent.state.isStreaming = true
    else session[busy] = true
    await expect(extendGoal(session)).rejects.toMatchObject({ errorCode: 'GOAL_SESSION_BUSY' })
    session[busy] = null
  })

  it.each(['completed', 'failed', 'cancelled', 'running'])('rejects extension from %s', async (status) => {
    const session = makeSession()
    await startedGoal(session)
    session.goal.status = status
    session.goal.usage.iterations = 8
    await expect(extendGoal(session)).rejects.toMatchObject({ errorCode: 'GOAL_ACTION_INVALID' })
  })

  it('rejects non-exhausted extension, invalid CAS and arbitrary budgets', async () => {
    const session = makeSession()
    await startedGoal(session)
    session.goal.status = 'paused'
    await expect(extendGoal(session)).rejects.toMatchObject({ errorCode: 'GOAL_BUDGET_NOT_EXHAUSTED' })
    for (const expectedRevision of [0, -1, 1.5, '1', null]) {
      await expect(extendGoal(session, { expectedRevision })).rejects.toMatchObject({ statusCode: 400 })
    }
    await expect(extendGoal(session, { budget: { maxIterations: 100 } })).rejects.toMatchObject({ statusCode: 400 })
    await expect(extendGoal(session, { goalId: 'other' })).rejects.toMatchObject({ errorCode: 'GOAL_REVISION_CONFLICT' })
  })

  it('starts execution only after the extension is durable, retaining consumed rounds', async () => {
    const session = makeSession()
    await startedGoal(session)
    await planGoal(session)
    session.goal.status = 'needs_review'
    session.goal.planConfirmed = true // Review is reached after confirmed execution.
    session.goal.usage = { iterations: 8, activeDurationMs: 1200 }
    const gate = deferred()
    mocks.persistSession.mockImplementationOnce(() => gate.promise)
    const extension = extendGoal(session)
    await vi.waitFor(() => expect(session.goal.budget.maxIterations).toBe(16))
    expect(session.agent.prompt).not.toHaveBeenCalled()
    gate.resolve({ id: 'persisted' })
    await extension
    await vi.waitFor(() => expect(session.agent.prompt).toHaveBeenCalledTimes(1))
    expect(session.goal.usage).toEqual({ iterations: 9, activeDurationMs: 1200 })
    expect(session.goalRun.kind).toBe('execution')
    await handleGoalAction(session, 'cancel')
  })

  it('charges initial successful planning and preserves its usage through manual revise', async () => {
    const session = makeSession()
    await startedGoal(session)
    const run = beginGoalRun(session, 'planning')
    run.startedAt -= 1200
    await planGoal(session)
    await finishGoalRun(session, { status: 'idle' })
    expect(session.goal.status).toBe('running')
    expect(session.goal.usage.iterations).toBe(0)
    expect(session.goal.usage.activeDurationMs).toBeGreaterThanOrEqual(1200)
    const usage = { ...session.goal.usage }
    await handleGoalAction(session, 'pause')
    await handleGoalAction(session, 'revise', 'Revised objective')
    expect(session.goal.usage).toEqual(usage)
    await handleGoalAction(session, 'cancel')
  })

  it('counts failed planning time and stops before retry at exhausted duration', async () => {
    const session = makeSession()
    await startedGoal(session)
    const run = beginGoalRun(session, 'planning')
    run.startedAt -= 7200000
    await finishGoalRun(session, { status: 'error' })
    expect(session.goal).toMatchObject({ status: 'planning', usage: { iterations: 0 }, budget: { maxActiveDurationMs: null } })
    expect(session.goal.usage.activeDurationMs).toBeGreaterThanOrEqual(7200000)
    expect(session.goalContinuationPending).toBe(true)
    await handleGoalAction(session, 'cancel')
  })

  it('allows the eighth execution but never starts a ninth after error', async () => {
    const session = makeSession()
    await startedGoal(session)
    session.goal.status = 'running'
    session.goal.usage.iterations = 7
    expect(beginGoalRun(session)).toBeTruthy()
    expect(session.goal.usage.iterations).toBe(8)
    await finishGoalRun(session, { status: 'error' })
    expect(session.goal.blocker).toBe('iteration_budget')
    expect(session.goalContinuationPending).toBe(false)
    expect(() => beginGoalRun(session)).toThrow('budget exhausted')
    expect(session.goalRun).toBeNull()
  })

  it('gates zero-duration begin, confirm and revise without resetting usage', async () => {
    const session = makeSession()
    await startedGoal(session)
    await planGoal(session)
    session.goal.budget.maxActiveDurationMs = 0
    const usage = structuredClone(session.goal.usage)
    expect(() => beginGoalRun(session, 'planning')).toThrow('budget exhausted')
    await handleGoalAction(session, 'revise', 'New objective')
    expect(session.goal.budget.maxActiveDurationMs).toBeNull()
    expect(session.goal.usage).toEqual(usage)
    await handleGoalAction(session, 'cancel')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pendingApproval.mockReturnValue(null)
    mocks.pendingAsk.mockReturnValue(null)
    mocks.pendingTools.mockReturnValue([])
    mocks.persistSession.mockResolvedValue({ id: 'persisted' })
    mocks.readStore.mockResolvedValue({})
    mocks.readSessionStateRecord.mockReturnValue(null)
    configureGoalRunner({
      beginTurn: () => 'turn-1',
      endTurn: () => {},
      refreshTools: mocks.refreshTools,
    })
  })

  afterEach(() => {
    for (const session of agentSessions.values()) {
      if (session.agent?.state) session.agent.state.isStreaming = false
      session.abortPending = false
      session.goalContinuationPending = false
      session.goalRunSettling = false
      if (session.goalRun?.watchdog) clearTimeout(session.goalRun.watchdog)
      session.goalRun = null
    }
    agentSessions.clear()
  })

  it('starts a read-only planning goal for /goal and persists it in the session body', async () => {
    const session = makeSession()
    const result = await startedGoal(session, '  Ship goal mode  ')

    expect(result.commandPrompt).toContain('<goal_planning')
    expect(result.commandPrompt).toContain('READ-ONLY')
    expect(session.goal).toMatchObject({ objective: 'Ship goal mode', status: 'planning', sessionId: session.sessionId })
    expect(mocks.persistSession).toHaveBeenCalledWith(session)
    expect(mocks.emitSessionEvent).toHaveBeenCalledWith(session, expect.objectContaining({ type: 'goal_updated', goal: session.goal }))
  })

  it('rejects a second goal in the same session and in the same workspace', async () => {
    const session = makeSession()
    await startedGoal(session)
    expect((await startGoalPlanning(session, 'another')).error).toContain('already has an active goal')

    const other = makeSession({ sessionId: 'goal-session-2' })
    other.goal = session.goal
    expect((await startGoalPlanning(makeSession({ sessionId: 'goal-session-3' }), 'third')).error)
      .toContain('already has an active goal in another chat')
  })

  it('detects a workspace conflict through persisted metadata and the authoritative body', async () => {
    mocks.readStore.mockResolvedValue({
      'goal-session-other': { id: 'goal-session-other', scope: 'global', goal: { id: 'goal_x', status: 'awaiting_confirmation' } },
    })
    mocks.readSessionStateRecord.mockReturnValue({ state: { goal: { id: 'goal_x', status: 'awaiting_confirmation' } } })
    const session = makeSession({ sessionId: 'goal-session-4' })
    expect((await startGoalPlanning(session, 'blocked')).error).toContain('another chat')

    // Stale metadata (the stored goal is already finished) must not block.
    mocks.readSessionStateRecord.mockReturnValue({ state: { goal: { id: 'goal_x', status: 'cancelled' } } })
    const free = makeSession({ sessionId: 'goal-session-5' })
    expect((await startGoalPlanning(free, 'allowed')).error).toBeUndefined()
  })

  it('does not offer goal mode to ACP / channel sessions', async () => {
    const acp = makeSession({ sessionId: 'acp-session', source: 'acp' })
    expect(isGoalModeAvailable(acp)).toBe(false)
    expect((await startGoalPlanning(acp, 'nope')).error).toContain('QuickForge main chat')
    await expect(handleGoalAction(acp, 'confirm')).rejects.toMatchObject({ statusCode: 409, errorCode: 'GOAL_UNAVAILABLE' })
  })

  it('records the plan as awaiting_confirmation and only then allows execution', async () => {
    const session = makeSession()
    await startedGoal(session)
    expect(goalPlanningToolBlockReason(session, 'run_command')).toContain('read-only')
    expect(goalPlanningToolBlockReason(session, 'write_file')).toContain('read-only')
    // todo_write is gated by the shared /plan whitelist; the goal planning
    // whitelist must agree instead of claiming a capability that never worked.
    expect(goalPlanningToolBlockReason(session, 'todo_write')).toContain('read-only')
    expect(goalPlanningToolBlockReason(session, 'run_subagent', { subagent: { capabilityPolicy: 'code-edit' } })).toContain('read-only subagents')
    expect(goalPlanningToolBlockReason(session, 'run_subagent', { subagent: { capabilityPolicy: 'docs-edit' } })).toContain('read-only subagents')
    expect(goalPlanningToolBlockReason(session, 'run_subagent', { subagent: { capabilityPolicy: 'readonly-research' } })).toBeNull()
    // Named profiles: only the built-in read-only explore profile is allowed.
    expect(goalPlanningToolBlockReason(session, 'run_subagent', { subagent: 'general' })).toContain('not read-only')
    expect(goalPlanningToolBlockReason(session, 'run_subagent', { subagent: 'explore' })).toBeNull()
    expect(goalPlanningToolBlockReason(session, 'goal_report')).toBeNull()

    await planGoal(session, [{ description: 'Tests pass', required: true }, { description: 'Nice UI', required: false }])
    expect(session.goal).toMatchObject({ status: 'awaiting_confirmation' })
    expect(session.goal.criteria.map((criterion) => criterion.id)).toEqual(['c1', 'c2'])
    expect(session.goal.criteria[1].required).toBe(false)
    expect(goalPlanningToolBlockReason(session, 'run_command')).toBeNull()
  })

  it('confirms the goal and starts a bounded continuation run with a fresh turn id', async () => {
    const session = makeSession()
    let promptTextDuringRun = null
    session.agent.prompt = vi.fn(async () => { promptTextDuringRun = session.activeCommandPrompt })
    await startedGoal(session)
    await planGoal(session)

    await handleGoalAction(session, 'confirm')
    expect(session.goal.status).toBe('running')
    await vi.waitFor(() => expect(session.agent.prompt).toHaveBeenCalledTimes(1))

    const promptArg = session.agent.prompt.mock.calls[0][0]
    expect(promptArg).toMatchObject({ role: 'user', metadata: { quickforgeGoalRun: 'execution' } })
    expect(promptArg.content).toContain('继续执行目标')
    expect(promptTextDuringRun).toContain('<goal_continuation')
    expect(session.goal.usage.iterations).toBe(1)
    // The continuation never truncates history.
    expect(session.agent.state.messages).toEqual([])
  })

  it('never lets the model complete a goal on its own and requires bound evidence', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    const tool = createGoalReportTool(session)

    await expect(tool.execute('call-1', { action: 'complete', summary: 'done' }))
      .rejects.toThrow('required acceptance criteria are not verified')
    await expect(tool.execute('call-2', {
      action: 'complete',
      summary: 'done',
      evidence: [{ id: 'e1', description: 'fake', toolCallId: 'missing-tool' }],
    })).rejects.toThrow('unknown toolCallId')
    // A criterion cannot be passed by claim alone, even with a valid tool id.
    trustTool(session, 'tool-1')
    await expect(tool.execute('call-3', {
      action: 'complete',
      summary: 'done',
      evidence: [{ id: 'e1', description: 'tests', toolCallId: 'tool-1' }],
      criterionUpdates: [{ id: 'c1', status: 'passed', evidenceIds: [] }],
    })).rejects.toThrow('cannot be passed without evidence')

    const result = await completedGoalBody(session)
    expect(result.content[0].text).toContain('completes automatically')
    expect(session.goal.status).toBe('completed')
  })

  it('retains explicit human acceptance for needs_review', async () => {
    const session = makeSession()
    await startedGoal(session)
    await planGoal(session, [
      { description: 'Tests pass', required: true },
      { description: 'Subjective UX', required: false },
    ])
    await handleGoalAction(session, 'confirm')
    await vi.waitFor(() => expect(session.agent.prompt).toHaveBeenCalledTimes(1))
    session.agent.state.isStreaming = false
    session.goalContinuationPending = true
    await finishGoalRun(session, { status: 'idle' })
    session.goalContinuationPending = false

    beginGoalRun(session, 'execution')
    trustTool(session, 'tool-1')
    await createGoalReportTool(session).execute('call-complete', {
      action: 'needs_review',
      summary: 'All done',
      evidence: [{ id: 'e1', description: 'tests passed', toolCallId: 'tool-1' }],
      criterionUpdates: [
        { id: 'c1', status: 'passed', evidenceIds: ['e1'] },
        { id: 'c2', status: 'needs_review' },
      ],
    })
    await finishGoalRun(session, { status: 'idle' })
    expect(session.goal.status).toBe('blocked')
    session.goal.status = 'needs_review' // Persisted legacy review remains compatible with accept.
    session.agent.prompt.mockClear()
    const goal = await handleGoalAction(session, 'accept')
    expect(goal.status).toBe('completed')
    expect(goal.humanAcceptedAt).toEqual(expect.any(String))
    // Only the criterion that still needed human judgement is accepted; the
    // tool-verified one keeps its tool evidence.
    expect(goal.acceptedCriterionIds).toEqual(['c2'])
    expect(goal.criteria[0].status).toBe('passed')
    expect(goal.criteria[1].status).toBe('passed')
    const humanEvidence = goal.evidence.find((entry) => entry.source === 'human')
    expect(humanEvidence).toBeDefined()
    // Human evidence is distinct from tool evidence: no fabricated toolCallId.
    expect(humanEvidence.toolCallId).toBeUndefined()
    expect(session.agent.prompt).not.toHaveBeenCalled()
  })

  it('resume of a verified needs_review goal keeps executing instead of completing', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    await completedGoalBody(session, 'needs_review')
    expect(session.goal.status).toBe('blocked')

    session.agent.prompt.mockClear()
    const goal = await handleGoalAction(session, 'resume')
    expect(goal.status).toBe('running')
    expect(goal.status).not.toBe('completed')
    await vi.waitFor(() => expect(session.agent.prompt).toHaveBeenCalled())
  })

  it('refuses to accept failed required criteria and only accepts needs_review', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    await expect(handleGoalAction(session, 'accept')).rejects.toMatchObject({ errorCode: 'GOAL_ACTION_INVALID' })

    session.goal = {
      ...session.goal,
      status: 'needs_review',
      criteria: [{ id: 'c1', description: 'Tests pass', required: true, status: 'failed', evidenceIds: [] }],
    }
    await expect(handleGoalAction(session, 'accept')).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'GOAL_ACCEPT_BLOCKED',
      message: expect.stringContaining('Resume the goal to fix them'),
    })
    expect(session.goal.status).toBe('needs_review')
  })

  it('resumes a needs_review goal into another round when criteria are not verified', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    beginGoalRun(session, 'execution')
    await createGoalReportTool(session).execute('call-1', { action: 'needs_review', summary: 'needs a look' })
    await finishGoalRun(session, { status: 'idle' })
    expect(session.goal.status).toBe('blocked')

    await handleGoalAction(session, 'resume')
    expect(session.goal.status).toBe('running')
    await vi.waitFor(() => expect(session.agent.prompt).toHaveBeenCalled())
  })

  it('pauses a running goal as pausing until the run really settles', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    session.agent.state.isStreaming = true
    beginGoalRun(session, 'execution')

    const paused = await handleGoalAction(session, 'pause')
    expect(paused.status).toBe('pausing')

    session.agent.state.isStreaming = false
    await finishGoalRun(session, { status: 'idle' })
    expect(session.goal.status).toBe('paused')
    expect(session.goalRun).toBeNull()
  })

  it('turns a user abort into paused instead of continuing', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    beginGoalRun(session, 'execution')

    await notifyGoalAbort(session)
    expect(session.goal.status).toBe('pausing')
    await finishGoalRun(session, { status: 'aborted' })
    expect(session.goal).toMatchObject({ status: 'paused', blocker: 'user_aborted' })
  })

  it('stops a pending continuation when the user aborts while the final persist is in flight', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    session.agent.prompt.mockClear()
    resetRunStats(session)
    beginGoalRun(session, 'execution')
    session.agent.state.isStreaming = false

    // Hold the settlement's final persist open to model the exact window where
    // goalRun is already cleared but no continuation is pending yet.
    const persistGate = deferred()
    mocks.persistSession.mockReturnValueOnce(persistGate.promise)
    const finishing = finishGoalRun(session, { status: 'idle' })
    expect(session.goalRun).toBeNull()
    expect(session.goalRunSettling).toBe(true)

    await notifyGoalAbort(session)
    expect(session.goalAbortGeneration).toBe(1)

    persistGate.resolve({ id: 'persisted' })
    await finishing

    expect(session.goal).toMatchObject({ status: 'paused', blocker: 'user_aborted' })
    expect(session.goalRunSettling).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(session.agent.prompt).not.toHaveBeenCalled()
  })

  it('refuses to resume while abortPending or a tool call is pending', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    await handleGoalAction(session, 'pause').catch(() => {})
    session.goal = { ...session.goal, status: 'paused' }
    session.abortPending = true
    await expect(handleGoalAction(session, 'resume')).rejects.toMatchObject({ statusCode: 409, errorCode: 'GOAL_SESSION_BUSY' })
    session.abortPending = false
    session.agent.state.isStreaming = true
    await expect(handleGoalAction(session, 'resume')).rejects.toMatchObject({ errorCode: 'GOAL_SESSION_BUSY' })
  })

  it('stops on budget exhaustion instead of continuing forever', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    session.goal = { ...session.goal, usage: { iterations: 7, activeDurationMs: 0 } }
    session.goalContinuationPending = true // isolate the accounting from scheduling
    resetRunStats(session)
    beginGoalRun(session, 'execution')
    expect(session.goal.usage.iterations).toBe(8)
    await finishGoalRun(session, { status: 'idle' })
    expect(session.goal).toMatchObject({ status: 'paused', blocker: 'iteration_budget' })
  })

  it('stops after repeated runs without progress', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    session.goalContinuationPending = true
    resetRunStats(session)
    beginGoalRun(session, 'execution')
    await finishGoalRun(session, { status: 'idle' })
    expect(session.goal.status).toBe('running')
    beginGoalRun(session, 'execution')
    await finishGoalRun(session, { status: 'idle' })
    expect(session.goal).toMatchObject({ status: 'paused', blocker: 'no_progress' })
  })

  it('pauses when a tool approval is rejected or times out', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    beginGoalRun(session, 'execution')
    await notifyGoalApprovalRequested(session)
    expect(session.goal.status).toBe('awaiting_approval')
    await notifyGoalApprovalOutcome(session, { outcome: 'rejected' })
    expect(session.goal).toMatchObject({ status: 'paused', blocker: 'approval_rejected' })
    await finishGoalRun(session, { status: 'idle' })
    expect(session.goal.status).toBe('paused')

    const second = makeSession({ sessionId: 'goal-session-approval', scope: 'project', projectId: 'approval-project' })
    await confirmedGoal(second)
    beginGoalRun(second, 'execution')
    await notifyGoalApprovalRequested(second)
    await notifyGoalApprovalOutcome(second, { outcome: 'timeout' })
    expect(second.goal).toMatchObject({ status: 'paused', blocker: 'approval_timeout' })
  })

  it('pauses when the user skips an ask', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    beginGoalRun(session, 'execution')
    await notifyGoalAskRequested(session)
    expect(session.goal.status).toBe('awaiting_input')
    await notifyGoalAskOutcome(session, { skipped: true })
    expect(session.goal).toMatchObject({ status: 'paused', blocker: 'ask_skipped' })
  })

  it('fails closed when the final persist did not succeed', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    session.agent.prompt.mockClear()
    beginGoalRun(session, 'execution')

    mocks.persistSession.mockResolvedValue(null)
    await failGoalRunOnPersist(session)
    expect(session.goal).toMatchObject({ status: 'paused', blocker: 'persist_failed' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(session.agent.prompt).not.toHaveBeenCalled()
  })

  it('revise re-plans from a quiescent state and drops the old acceptance', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    trustTool(session, 'tool-1')
    await createGoalReportTool(session).execute('call-1', {
      action: 'progress',
      summary: 'half way',
      evidence: [{ id: 'e1', description: 'tests', toolCallId: 'tool-1' }],
      criterionUpdates: [{ id: 'c1', status: 'passed', evidenceIds: ['e1'] }],
    })
    await handleGoalAction(session, 'pause')
    expect(session.goal.status).toBe('paused')

    const revised = await handleGoalAction(session, 'revise', 'New objective')
    expect(revised).toMatchObject({ objective: 'New objective', status: 'planning', criteria: [], evidence: [] })
    expect(revised.revision).toBeGreaterThan(session.goal.revision - 1)
    await vi.waitFor(() => expect(session.agent.prompt).toHaveBeenCalled())
  })

  it('rejects revise outside quiescent states and without a new objective', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    await expect(handleGoalAction(session, 'revise', 'x')).rejects.toMatchObject({ errorCode: 'GOAL_ACTION_INVALID' })
    await handleGoalAction(session, 'pause')
    await expect(handleGoalAction(session, 'revise', '  ')).rejects.toMatchObject({ errorCode: 'GOAL_OBJECTIVE_REQUIRED' })
  })

  it('cancels the goal, stops scheduling and clears a finished goal on the next prompt', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    const cancelled = await handleGoalAction(session, 'cancel')
    expect(cancelled.status).toBe('cancelled')
    await finishGoalRun(session, { status: 'idle' })
    expect(session.goal.status).toBe('cancelled')

    expect(await clearTerminalGoal(session)).toBe(true)
    expect(session.goal).toBeNull()
    expect(mocks.emitSessionEvent).toHaveBeenLastCalledWith(session, expect.objectContaining({ type: 'goal_updated', goal: null }))
  })

  it('refreshes the tool set only when the goal becomes active or finishes', async () => {
    const session = makeSession()
    mocks.refreshTools.mockClear()
    await startedGoal(session)
    expect(mocks.refreshTools).toHaveBeenCalledTimes(1)
    await planGoal(session)
    expect(mocks.refreshTools).toHaveBeenCalledTimes(1)
    await handleGoalAction(session, 'cancel')
    expect(mocks.refreshTools).toHaveBeenCalledTimes(2)
  })

  it('rejects goal mode only for the request that carries a shared source, never permanently', async () => {
    const session = makeSession({ sessionId: 'shared-session', modelAccessContext: { source: 'shared' } })
    // The shared request itself is rejected: it carries the request-scoped source.
    expect(isGoalModeAvailable(session, 'shared')).toBe(false)
    expect((await startGoalPlanning(session, 'nope', 'shared')).error).toContain('QuickForge main chat')
    await expect(handleGoalAction(session, 'confirm', undefined, 'shared')).rejects.toMatchObject({ statusCode: 409, errorCode: 'GOAL_UNAVAILABLE' })
    expect(session.goal).toBeNull()

    // The overlay must not lock the owner out: without a request source the same
    // session keeps full goal access.
    expect(isGoalModeAvailable(session)).toBe(true)
    expect((await startGoalPlanning(session, 'Ship goal mode')).error).toBeUndefined()
    expect(session.goal).toMatchObject({ status: 'planning' })
  })

  it('still rejects ACP sessions and real session-bound model sources', async () => {
    const acp = makeSession({ sessionId: 'acp-source-session', source: 'acp' })
    expect(isGoalModeAvailable(acp)).toBe(false)
    const scheduled = makeSession({ sessionId: 'scheduled-source-session', modelAccessContext: { source: 'scheduled' } })
    expect(isGoalModeAvailable(scheduled)).toBe(false)
    expect(isGoalModeAvailable(scheduled, null)).toBe(false)
    // A request-scoped source is only denied for that request.
    expect(isGoalModeAvailable(scheduled, 'scheduled')).toBe(false)
  })

  it('lets the owner create, confirm and pause a goal after a shared request was rejected', async () => {
    const session = makeSession({ sessionId: 'shared-owner-session', modelAccessContext: { source: 'shared' } })
    expect((await startGoalPlanning(session, 'nope', 'shared')).error).toContain('QuickForge main chat')
    expect(session.goal).toBeNull()

    await startedGoal(session, 'Ship goal mode')
    await planGoal(session)
    await handleGoalAction(session, 'confirm')
    expect(session.goal.status).toBe('running')
    await vi.waitFor(() => expect(session.agent.prompt).toHaveBeenCalled())
    session.agent.state.isStreaming = true
    const paused = await handleGoalAction(session, 'pause')
    expect(paused.status).toBe('pausing')
    session.agent.state.isStreaming = false
    await finishGoalRun(session, { status: 'idle' })
    expect(session.goal.status).toBe('paused')
  })

  it('rejects evidence taken from arbitrary earlier tool history', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    // The transcript contains an old successful tool result, but no
    // tool_execution_end was recorded for the current goal version.
    session.agent.state.messages = [toolResult('tool-old')]
    await expect(createGoalReportTool(session).execute('call-1', {
      action: 'progress',
      summary: 'old',
      evidence: [{ id: 'e1', description: 'old', toolCallId: 'tool-old' }],
    })).rejects.toThrow('unknown toolCallId: tool-old')
  })

  it('never trusts delegation/skill/control-plane tool results as evidence', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    trustTool(session, 'sub-1', { toolName: 'run_subagent' })
    trustTool(session, 'todo-1', { toolName: 'todo_write' })
    trustTool(session, 'skill-1', { toolName: 'activate_skill' })
    trustTool(session, 'mem-1', { toolName: 'manage_global_memory' })
    trustTool(session, 'ask-1', { toolName: 'ask_user' })
    trustTool(session, 'goal-1', { toolName: 'goal_report' })
    for (const toolCallId of ['sub-1', 'todo-1', 'skill-1', 'mem-1', 'ask-1', 'goal-1']) {
      await expect(createGoalReportTool(session).execute(`call-${toolCallId}`, {
        action: 'progress',
        summary: 'x',
        evidence: [{ id: 'e1', description: 'x', toolCallId }],
      })).rejects.toThrow(`unknown toolCallId: ${toolCallId}`)
    }
  })

  it('accepts command evidence only from a clean exit, never from transport success', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    trustTool(session, 'ok-1')
    // Real event shape: isError=false but the exit code/termination is not clean.
    trustTool(session, 'code-1', { result: commandResult({ code: 1 }) })
    trustTool(session, 'code-null', { result: commandResult({ code: null }) })
    trustTool(session, 'signal-1', { result: commandResult({ signal: 'SIGTERM' }) })
    trustTool(session, 'timeout-1', { result: commandResult({ code: null, timedOut: true }) })
    trustTool(session, 'abort-1', { result: commandResult({ code: 0, aborted: true }) })
    // A transport success without a result must not become evidence either.
    recordGoalToolExecution(session, { toolCallId: 'no-result', toolName: 'run_command', isError: false })

    const tool = createGoalReportTool(session)
    await expect(tool.execute('call-ok', {
      action: 'progress',
      summary: 'x',
      evidence: [{ id: 'e-ok', description: 'x', toolCallId: 'ok-1' }],
    })).resolves.toBeDefined()
    for (const toolCallId of ['code-1', 'code-null', 'signal-1', 'timeout-1', 'abort-1', 'no-result']) {
      await expect(tool.execute(`call-${toolCallId}`, {
        action: 'progress',
        summary: 'x',
        evidence: [{ id: `e-${toolCallId}`, description: 'x', toolCallId }],
      })).rejects.toThrow(`unknown toolCallId: ${toolCallId}`)
    }
  })

  it('keeps non-command evidence tools valid on transport success without an exit code', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    recordGoalToolExecution(session, { toolCallId: 'read-1', toolName: 'read_file', isError: false })
    recordGoalToolExecution(session, { toolCallId: 'grep-1', toolName: 'grep_files', isError: false })
    await expect(createGoalReportTool(session).execute('call-1', {
      action: 'progress',
      summary: 'x',
      evidence: [{ id: 'e1', description: 'x', toolCallId: 'read-1' }, { id: 'e2', description: 'x', toolCallId: 'grep-1' }],
    })).resolves.toBeDefined()
  })


  it('persists the trusted tool name on evidence and rejects fabricated human evidence', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    trustTool(session, 'tool-1', { toolName: 'run_command' })
    await createGoalReportTool(session).execute('call-1', {
      action: 'progress',
      summary: 'x',
      evidence: [{ id: 'e1', description: 'tests', toolCallId: 'tool-1' }],
    })
    expect(session.goal.evidence[0]).toMatchObject({ id: 'e1', toolCallId: 'tool-1', toolName: 'run_command' })
    await expect(createGoalReportTool(session).execute('call-2', {
      action: 'progress',
      summary: 'x',
      evidence: [{ id: 'e2', description: 'human', toolCallId: 'tool-1', source: 'human' }],
    })).rejects.toThrow('human acceptance evidence can only be recorded by the user')
  })

  it('defers automatic completion until the run truly finished and blocks further writes', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    beginGoalRun(session, 'execution')
    trustTool(session, 'tool-1')
    const result = await createGoalReportTool(session).execute('call-1', {
      action: 'complete',
      summary: 'done',
      evidence: [{ id: 'e1', description: 'tests', toolCallId: 'tool-1' }],
      criterionUpdates: [{ id: 'c1', status: 'passed', evidenceIds: ['e1'] }],
    })
    expect(result.content[0].text).toContain('ends normally')
    expect(session.goal.status).toBe('verifying')
    expect(session.goal.status).not.toBe('needs_review')
    expect(goalRunSettlementToolBlockReason(session, 'write_file')).toContain('not allowed')
    expect(goalRunSettlementToolBlockReason(session, 'goal_report')).toContain('not allowed')
    expect(goalRunSettlementToolBlockReason(session, 'read_file')).toBeNull()
    await expect(createGoalReportTool(session).execute('call-2', { action: 'progress', summary: 'more' }))
      .rejects.toThrow('already reported')
    await finishGoalRun(session, { status: 'idle' })
    expect(session.goal.status).toBe('completed')
  })

  it('keeps the run and goal alive when cancel cannot persist', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    beginGoalRun(session, 'execution')
    const run = session.goalRun
    mocks.persistSession.mockResolvedValue(null)
    await expect(handleGoalAction(session, 'cancel')).rejects.toMatchObject({ errorCode: 'SESSION_PERSIST_FAILED' })
    expect(session.goal.status).toBe('running')
    expect(session.goalRun).toBe(run)
    expect(run.watchdog).toBeNull()
    expect(session.goalContinuationPending).toBe(false)
    // The termination intent must roll back too: a later settlement must not
    // treat the failed cancel as a user stop.
    expect(session.goalTerminationKind).toBeNull()
    expect(session.goalAbortGeneration).toBe(0)
  })

  it('lets cancel win over a settlement whose final persist is still in flight', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    session.agent.prompt.mockClear()
    resetRunStats(session)
    beginGoalRun(session, 'execution')
    session.agent.state.isStreaming = false

    // Hold the settlement's final persist open: goalRun is already cleared and
    // the run is settling while the user cancels.
    const finishGate = deferred()
    mocks.persistSession.mockReturnValueOnce(finishGate.promise)
    const finishing = finishGoalRun(session, { status: 'idle' })
    expect(session.goalRun).toBeNull()
    expect(session.goalRunSettling).toBe(true)

    const cancelGate = deferred()
    mocks.persistSession.mockReturnValueOnce(cancelGate.promise)
    const cancelling = handleGoalAction(session, 'cancel')
    expect(session.goal.status).toBe('cancelled')
    expect(session.goalTerminationKind).toBe('cancel')

    finishGate.resolve({ id: 'persisted' })
    await finishing
    // The old settlement must not downgrade cancelled back to running/paused.
    expect(session.goal.status).toBe('cancelled')

    cancelGate.resolve({ id: 'persisted' })
    await cancelling

    expect(session.goal.status).toBe('cancelled')
    expect(session.goalRunSettling).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(session.agent.prompt).not.toHaveBeenCalled()
  })

  it('keeps a cancelled goal terminal when an abort races the cancel persist', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    beginGoalRun(session, 'execution')
    session.agent.state.isStreaming = false

    const cancelGate = deferred()
    mocks.persistSession.mockReturnValueOnce(cancelGate.promise)
    const cancelling = handleGoalAction(session, 'cancel')
    expect(session.goal.status).toBe('cancelled')

    // An abort arriving after the cancel must be a no-op, never a downgrade to
    // paused/user_aborted.
    await notifyGoalAbort(session)
    expect(session.goal.status).toBe('cancelled')
    expect(session.goalTerminationKind).toBe('cancel')

    cancelGate.resolve({ id: 'persisted' })
    await cancelling
    expect(session.goal).toMatchObject({ status: 'cancelled' })
    expect(session.goal.blocker).toBeUndefined()
    expect(session.goalRun).toBeNull()
  })

  it('records user_aborted when an abort lands during the error settlement persist', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    session.agent.prompt.mockClear()
    resetRunStats(session)
    beginGoalRun(session, 'execution')
    session.agent.state.isStreaming = false

    const finishGate = deferred()
    mocks.persistSession.mockReturnValueOnce(finishGate.promise)
    const finishing = finishGoalRun(session, { status: 'error', error: 'boom' })
    expect(session.goalRunSettling).toBe(true)

    await notifyGoalAbort(session)
    expect(session.goalTerminationKind).toBe('abort')
    expect(session.goalAbortGeneration).toBe(1)

    finishGate.resolve({ id: 'persisted' })
    await finishing
    expect(session.goal).toMatchObject({ status: 'paused', blocker: 'user_aborted' })
    expect(session.goalRunSettling).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(session.agent.prompt).not.toHaveBeenCalled()
  })

  it('settles an aborted run with user_aborted even when the run ended in error', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    resetRunStats(session)
    beginGoalRun(session, 'execution')
    session.agent.state.isStreaming = false

    await notifyGoalAbort(session)
    expect(session.goal.status).toBe('pausing')
    await finishGoalRun(session, { status: 'error', error: 'boom' })
    expect(session.goal).toMatchObject({ status: 'paused', blocker: 'user_aborted' })
  })

  it('aborts a confirmed goal during the continuation window before any run starts', async () => {
    const session = makeSession()
    await startedGoal(session)
    await planGoal(session)
    session.agent.prompt.mockClear()
    await handleGoalAction(session, 'confirm')
    expect(session.goalContinuationPending).toBe(true)
    expect(session.goalRun).toBeNull()

    await notifyGoalAbort(session)
    expect(session.goal).toMatchObject({ status: 'paused', blocker: 'user_aborted' })
    expect(session.goalContinuationPending).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(session.agent.prompt).not.toHaveBeenCalled()
  })

  it('serializes concurrent goal starts in the same workspace', async () => {
    const a = makeSession({ sessionId: 'goal-concurrent-a' })
    const b = makeSession({ sessionId: 'goal-concurrent-b' })
    const results = await Promise.all([startGoalPlanning(a, 'A'), startGoalPlanning(b, 'B')])
    const errors = results.filter((result) => result.error)
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toContain('another chat')
    expect([a.goal, b.goal].filter(Boolean)).toHaveLength(1)
  })

  it('treats two projectIds on the same workspace path as one workspace', async () => {
    const a = makeSession({
      sessionId: 'goal-path-a',
      scope: 'project',
      projectId: 'p1',
      projectContext: { workspaceRoot: 'C:/ws/shared' },
    })
    const b = makeSession({
      sessionId: 'goal-path-b',
      scope: 'project',
      projectId: 'p2',
      projectContext: { workspaceRoot: 'c:\\ws\\shared' },
    })
    expect((await startGoalPlanning(a, 'A')).error).toBeUndefined()
    expect((await startGoalPlanning(b, 'B')).error).toContain('another chat')
  })

  it('adds only one budget tranche and remains durably paused if usage still exhausts it', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    await handleGoalAction(session, 'pause')
    session.agent.prompt.mockClear()
    session.goal.usage = { iterations: 24, activeDurationMs: 21_600_000 }
    const usage = { ...session.goal.usage }
    const extend = () => handleGoalAction(session, 'extend_resume', undefined, null, {
      goalId: session.goal.id, expectedRevision: session.goal.revision,
    })
    await extend()
    expect(session.goal).toMatchObject({ status: 'paused', budget: { maxIterations: 16, maxActiveDurationMs: null }, usage })
    expect(session.goal.blocker).toContain('budget')
    expect(session.goal.blockerHint).toContain('extend_resume')
    expect(session.goalContinuationPending).toBe(false)
    expect(mocks.persistSession).toHaveBeenLastCalledWith(session)
    await extend()
    expect(session.goal).toMatchObject({ status: 'paused', budget: { maxIterations: 24, maxActiveDurationMs: null }, usage })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(session.agent.prompt).not.toHaveBeenCalled()
  })

  it('preserves unconfirmed planning across budget settlement, restore and extension', async () => {
    const { normalizeGoalState, goalAfterRestore } = await import('../../server/agent-goal-state.mjs')
    const session = makeSession()
    await startedGoal(session)
    beginGoalRun(session, 'planning')
    await planGoal(session)
    session.goal.budget.maxActiveDurationMs = 7200000
    session.goalRun.startedAt = Date.now() - 7200000
    await finishGoalRun(session, { status: 'idle' })
    expect(session.goal).toMatchObject({ status: 'paused', planConfirmed: false })
    const criteria = session.goal.criteria
    session.goal = goalAfterRestore(normalizeGoalState(JSON.parse(JSON.stringify(session.goal))))
    await handleGoalAction(session, 'extend_resume', undefined, null, {
      goalId: session.goal.id, expectedRevision: session.goal.revision,
    })
    expect(session.goal).toMatchObject({ status: 'running', planConfirmed: true, criteria, budget: { maxActiveDurationMs: null } })
    expect(session.goalContinuationPending).toBe(true)
    expect(session.agent.prompt).not.toHaveBeenCalled()
    expect(session.goal).toMatchObject({ status: 'running', planConfirmed: true })
    await notifyGoalAbort(session)
  })

  it('resume requires confirmation for an interrupted revised plan despite historical execution', async () => {
    const { resetGoalPlan, applyGoalPlan, normalizeGoalState, goalAfterRestore } = await import('../../server/agent-goal-state.mjs')
    const session = makeSession()
    await confirmedGoal(session)
    session.agent.prompt.mockClear()
    const revised = resetGoalPlan(session.goal, 'New objective')
    session.goal = applyGoalPlan(revised, { criteria: [{ description: 'New check' }], summary: 'New plan' })
    session.goal.status = 'paused'
    session.goal = goalAfterRestore(normalizeGoalState(JSON.parse(JSON.stringify(session.goal))))
    expect(session.goal.usage.iterations).toBeGreaterThan(0)
    await handleGoalAction(session, 'resume')
    expect(session.goal).toMatchObject({ status: 'running', planConfirmed: true, summary: 'New plan' })
    expect(session.goalContinuationPending).toBe(true)
    expect(session.agent.prompt).not.toHaveBeenCalled()
    await handleGoalAction(session, 'cancel')
  })

  it('safely requests confirmation for legacy paused plans with no execution history', async () => {
    const session = makeSession()
    await startedGoal(session)
    await planGoal(session)
    delete session.goal.planConfirmed
    session.goal.status = 'paused'
    await handleGoalAction(session, 'resume')
    expect(session.goal.status).toBe('running')
    expect(session.goalContinuationPending).toBe(true)
    await handleGoalAction(session, 'cancel')
  })

  it('refuses to resume a budget-exhausted goal and points at extend_resume', async () => {
    const session = makeSession()
    await confirmedGoal(session)
    await handleGoalAction(session, 'pause')
    session.goal = { ...session.goal, usage: { iterations: 8, activeDurationMs: 0 } }
    await expect(handleGoalAction(session, 'resume')).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'GOAL_BUDGET_EXHAUSTED',
      message: expect.stringContaining('Use extend_resume'),
    })
    expect(session.goal.usage.iterations).toBe(8)
  })
})
