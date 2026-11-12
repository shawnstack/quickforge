import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  persistSession: vi.fn(async () => ({ id: 'persisted' })),
  emitSessionEvent: vi.fn(),
}))

vi.mock('../../server/agent-persistence.mjs', () => ({ persistSession: mocks.persistSession }))
vi.mock('../../server/agent-session-events.mjs', async () => ({
  agentEvents: new (await import('node:events')).EventEmitter(),
  emitSessionEvent: mocks.emitSessionEvent,
  runtimePendingToolCalls: vi.fn(() => []),
}))
vi.mock('../../server/tools/definitions.mjs', () => ({
  goalReportTool: { name: 'goal_report', label: 'Report goal progress', description: 'x', parameters: {} },
}))
vi.mock('../../server/utils/logger.mjs', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const {
  createGoalReportTool,
  goalPlanningToolBlockReason,
  goalRunSettlementToolBlockReason,
  isGoalPlanning,
} = await import('../../server/goal-report-tools.mjs')
const goalState = await import('../../server/agent-goal-state.mjs')

function plannedRunningGoal(sessionId) {
  const goal = goalState.applyGoalPlan(
    goalState.createGoalState({ sessionId, objective: 'Ship goal mode' }),
    {
      criteria: [
        { description: 'Tests pass', required: true },
        { description: 'Docs look right', required: false },
      ],
      scope: ['server/'],
      summary: 'Implement the runner.',
    },
  )
  return goalState.setGoalStatus(goal, 'running', { planConfirmed: true })
}

function makeSession(overrides = {}) {
  const sessionId = overrides.sessionId || 'goal-report-session-1'
  const session = {
    sessionId,
    goal: plannedRunningGoal(sessionId),
    goalRun: null,
    goalStats: { consecutiveFailures: 0, noProgressRuns: 0, planningAttempts: 2, pauseRequested: false },
    goalTrustedToolCalls: new Map([['tool-1', 'run_command']]),
    agent: { state: { messages: [] } },
    ...overrides,
  }
  return session
}

/** Run goal_report against a session through the public tool surface. */
async function report(session, params) {
  return createGoalReportTool(session).execute('call-1', params || {})
}

async function reportError(session, params) {
  const result = await report(session, params)
  expect(result.isError).toBe(true)
  expect(result.details.type).toBe('goal_report_error')
  return result.details.code
}

describe('isGoalPlanning', () => {
  it('recognizes every planning indicator independently', () => {
    expect(isGoalPlanning(makeSession({ goal: { status: 'planning' } }))).toBe(true)
    expect(isGoalPlanning(makeSession({ goal: null, goalRun: { kind: 'planning' } }))).toBe(true)
    expect(isGoalPlanning(makeSession({ goal: null, goalSettlingRun: { kind: 'planning' } }))).toBe(true)
  })

  it('stays false for execution runs, unconfirmed goals and empty sessions', () => {
    expect(isGoalPlanning(makeSession({ goalRun: { kind: 'execution' } }))).toBe(false)
    expect(isGoalPlanning(makeSession({ goal: { status: 'awaiting_confirmation', planConfirmed: false } }))).toBe(false)
    expect(isGoalPlanning(makeSession({ goal: null }))).toBe(false)
    expect(isGoalPlanning(undefined)).toBe(false)
    expect(isGoalPlanning(null)).toBe(false)
  })
})

describe('goalPlanningToolBlockReason', () => {
  it('leaves non-planning sessions unrestricted', () => {
    expect(goalPlanningToolBlockReason(makeSession(), 'write_file', {})).toBeNull()
    expect(goalPlanningToolBlockReason(makeSession(), 'run_command', {})).toBeNull()
    expect(goalPlanningToolBlockReason(null, 'write_file', {})).toBeNull()
  })

  it('allows exactly the read-only planning whitelist', () => {
    const session = makeSession({ goal: { status: 'planning' } })
    for (const tool of ['read_file', 'grep_files', 'activate_skill', 'read_skill_resource', 'ask_user', 'goal_report', 'run_subagent']) {
      expect(goalPlanningToolBlockReason(session, tool, {})).toBeNull()
    }
    for (const tool of ['write_file', 'edit_file', 'run_command', 'todo_write', 'memory', 'mcp_tool']) {
      expect(goalPlanningToolBlockReason(session, tool, {})).toContain('read-only')
    }
  })

  it('accepts only the explore profile by name, case-insensitively', () => {
    const session = makeSession({ goal: { status: 'planning' } })
    expect(goalPlanningToolBlockReason(session, 'run_subagent', { subagent: 'explore' })).toBeNull()
    expect(goalPlanningToolBlockReason(session, 'run_subagent', { subagent: ' Explore ' })).toBeNull()
    expect(goalPlanningToolBlockReason(session, 'run_subagent', { subagent: 'general' })).toContain('not read-only')
  })

  it('accepts inline specs only with a read-only capability policy, explicit or inferred', () => {
    const session = makeSession({ goal: { status: 'planning' } })
    for (const policy of ['readonly-research', 'safe-validation', 'review-only']) {
      expect(goalPlanningToolBlockReason(session, 'run_subagent', { subagent: { capabilityPolicy: policy } })).toBeNull()
    }
    for (const policy of ['code-edit', 'docs-edit']) {
      expect(goalPlanningToolBlockReason(session, 'run_subagent', { subagent: { capabilityPolicy: policy } })).toContain('read-only subagents')
    }
    // Unknown policy names are not trusted: the policy falls back to a
    // tool-inferred one, so an empty spec still resolves read-only.
    expect(goalPlanningToolBlockReason(session, 'run_subagent', { subagent: { capabilityPolicy: 'not-a-policy' } })).toBeNull()
    expect(goalPlanningToolBlockReason(session, 'run_subagent', { subagent: { capabilityPolicy: 'not-a-policy', tools: ['write_file'] } })).toContain('read-only subagents')
    // Without an explicit policy the spec defaults to readonly-research: the
    // requested tool list alone cannot grant write access here.
    expect(goalPlanningToolBlockReason(session, 'run_subagent', { subagent: { tools: ['read_file'] } })).toBeNull()
    expect(goalPlanningToolBlockReason(session, 'run_subagent', { subagent: { tools: ['write_file'] } })).toBeNull()
    expect(goalPlanningToolBlockReason(session, 'run_subagent', {})).toBeNull()
  })
})

describe('goalRunSettlementToolBlockReason', () => {
  it('leaves sessions without settlement state unrestricted', () => {
    expect(goalRunSettlementToolBlockReason(null, 'write_file')).toBeNull()
    expect(goalRunSettlementToolBlockReason({}, 'write_file')).toBeNull()
    expect(goalRunSettlementToolBlockReason(makeSession(), 'goal_report')).toBeNull()
    expect(goalRunSettlementToolBlockReason(makeSession({ goalRun: {} }), 'write_file')).toBeNull()
  })

  it('restricts a recorded disposition to read-only inspection, with no ask_user escape', () => {
    const session = makeSession({ goalRun: { pendingDisposition: 'completed' } })
    expect(goalRunSettlementToolBlockReason(session, 'read_file')).toBeNull()
    expect(goalRunSettlementToolBlockReason(session, 'grep_files')).toBeNull()
    expect(goalRunSettlementToolBlockReason(session, 'write_file')).toContain('not allowed')
    expect(goalRunSettlementToolBlockReason(session, 'goal_report')).toContain('not allowed')
    expect(goalRunSettlementToolBlockReason(session, 'run_command')).toContain('not allowed')
    expect(goalRunSettlementToolBlockReason(session, 'ask_user')).toContain('not allowed')
  })

  it('lets a blocked verification ask the user but keeps everything else read-only', () => {
    const session = makeSession({ goalRun: { verificationBlocker: 'cannot verify' } })
    expect(goalRunSettlementToolBlockReason(session, 'read_file')).toBeNull()
    expect(goalRunSettlementToolBlockReason(session, 'ask_user')).toBeNull()
    expect(goalRunSettlementToolBlockReason(session, 'write_file')).toContain('not allowed')
    expect(goalRunSettlementToolBlockReason(session, 'run_subagent')).toContain('not allowed')
  })
})

describe('createGoalReportTool session resolution', () => {
  it('rejects without a session through both a getter and a plain value', async () => {
    await expect(createGoalReportTool(null).execute('call-1', { action: 'progress' }))
      .rejects.toThrow('No active session for goal_report.')
    await expect(createGoalReportTool(() => null).execute('call-1', { action: 'progress' }))
      .rejects.toThrow('No active session for goal_report.')
  })

  it('resolves the session through a getter on every call', async () => {
    const session = makeSession()
    const tool = createGoalReportTool(() => session)
    const result = await tool.execute('call-1', { action: 'blocked', blocker: 'stuck' })
    expect(result.isError).toBeUndefined()
    expect(session.goal.status).toBe('blocked')
  })
})

describe('goal_report admission', () => {
  it('rejects when the session has no goal', async () => {
    expect(await reportError(makeSession({ goal: null }), { action: 'progress' })).toBe('GOAL_REPORT_NO_GOAL')
  })

  it('rejects once the goal reached a terminal status', async () => {
    const session = makeSession({ goal: { status: 'cancelled' } })
    expect(await reportError(session, { action: 'progress' })).toBe('GOAL_REPORT_INACTIVE')
  })

  it('rejects a second report after the run already recorded its disposition', async () => {
    const session = makeSession({ goalRun: { pendingDisposition: 'completed' } })
    expect(await reportError(session, { action: 'progress', summary: 'again' })).toBe('GOAL_REPORT_ALREADY_REPORTED')
  })
})

describe('goal_report action="plan"', () => {
  it('records the plan and moves the goal to awaiting confirmation', async () => {
    const session = makeSession({ goal: goalState.createGoalState({ sessionId: 'goal-report-session-1', objective: 'Ship goal mode' }) })
    const result = await report(session, {
      action: 'plan',
      summary: 'Plan',
      criteria: [{ description: 'Tests pass', required: true }, { description: 'Docs look right', required: false }],
      scope: ['server/'],
    })
    expect(result.isError).toBeUndefined()
    expect(result.details.goal).toMatchObject({ status: 'awaiting_confirmation', planConfirmed: false })
    expect(result.details.goal.criteria).toHaveLength(2)
    expect(result.content[0].text).toContain('Plan recorded with 2 acceptance criteria')
    expect(session.goalStats.planningAttempts).toBe(0)
    expect(session.goal.summary).toBe('Plan')
  })

  it('validates criteria count, descriptions and summary presence', async () => {
    const planning = () => makeSession({ goal: goalState.createGoalState({ sessionId: 'goal-report-session-1', objective: 'Ship goal mode' }) })
    expect(await reportError(planning(), { action: 'plan', summary: 's' })).toBe('GOAL_REPORT_PLAN_NO_CRITERIA')
    expect(await reportError(planning(), {
      action: 'plan', summary: 's', criteria: Array.from({ length: 9 }, (_, i) => ({ description: `c${i}` })),
    })).toBe('GOAL_REPORT_PLAN_TOO_MANY_CRITERIA')
    expect(await reportError(planning(), { action: 'plan', criteria: [{ description: 'x' }] })).toBe('GOAL_REPORT_FIELD_REQUIRED')
    expect(await reportError(planning(), {
      action: 'plan', summary: 's', criteria: [{ description: '   ' }],
    })).toBe('GOAL_REPORT_PLAN_CRITERIA_DESCRIPTION')
  })

  it('rejects planning outside the planning status and every other action while planning', async () => {
    const running = makeSession()
    expect(await reportError(running, { action: 'plan', summary: 's', criteria: [{ description: 'x' }] })).toBe('GOAL_REPORT_PLAN_INVALID_STATUS')
    const planning = makeSession({ goal: { status: 'planning' } })
    const late = await report(planning, { action: 'progress', summary: 's' })
    expect(late.isError).toBe(true)
    expect(late.details.code).toBe('GOAL_REPORT_PLANNING_ONLY')
    expect(late.content[0].text).toContain('use action="plan"')
    const submitted = makeSession({ goal: { status: 'awaiting_confirmation', planConfirmed: false } })
    const afterSubmit = await report(submitted, { action: 'progress', summary: 's' })
    expect(afterSubmit.details.code).toBe('GOAL_REPORT_PLANNING_ONLY')
    expect(afterSubmit.content[0].text).toContain('The plan is already submitted')
  })
})

describe('goal_report action="progress"', () => {
  it('records evidence-backed progress and bumps the goal revision', async () => {
    const session = makeSession()
    const before = session.goal.revision
    const result = await report(session, {
      action: 'progress',
      summary: 'Halfway',
      evidence: [{ id: 'e1', description: 'tests passed', toolCallId: 'tool-1' }],
      criterionUpdates: [{ id: 'c1', status: 'passed', evidenceIds: ['e1'] }],
    })
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain(`revision ${before + 1}`)
    expect(session.goal).toMatchObject({ status: 'running', summary: 'Halfway' })
    expect(session.goal.criteria[0]).toMatchObject({ id: 'c1', status: 'passed', evidenceIds: ['e1'] })
    expect(session.goal.evidence[0]).toMatchObject({ id: 'e1', toolCallId: 'tool-1', toolName: 'run_command' })
  })

  it('requires a summary', async () => {
    expect(await reportError(makeSession(), { action: 'progress' })).toBe('GOAL_REPORT_FIELD_REQUIRED')
    expect(await reportError(makeSession(), { action: 'progress', summary: '   ' })).toBe('GOAL_REPORT_FIELD_REQUIRED')
  })

  it('rejects evidence that references an unknown tool call', async () => {
    const code = await reportError(makeSession(), {
      action: 'progress',
      summary: 's',
      evidence: [{ description: 'made up', toolCallId: 'never-run' }],
    })
    expect(code).toBe('GOAL_REPORT_EVIDENCE_UNKNOWN')
  })

  it('rejects criterion updates that do not follow the state rules', async () => {
    const session = makeSession()
    mocks.persistSession.mockClear()
    const code = await reportError(session, {
      action: 'progress',
      summary: 's',
      criterionUpdates: [{ id: 'c1', status: 'passed', evidenceIds: [] }],
    })
    expect(code).toBe('GOAL_REPORT_REJECTED')
    expect(session.goal.status).toBe('running')
    expect(mocks.persistSession).not.toHaveBeenCalled()
  })
})

describe('goal_report action="blocked" and "needs_review"', () => {
  it('marks the goal blocked with the given blocker text', async () => {
    const session = makeSession()
    const result = await report(session, { action: 'blocked', blocker: 'No test database access' })
    expect(result.isError).toBeUndefined()
    expect(session.goal).toMatchObject({ status: 'blocked', blocker: 'No test database access' })
    expect(result.content[0].text).toContain('No test database access')
  })

  it('requires a non-empty blocker', async () => {
    expect(await reportError(makeSession(), { action: 'blocked' })).toBe('GOAL_REPORT_FIELD_REQUIRED')
  })

  it('records an explicit verification blocker on the run and blocks the goal', async () => {
    const session = makeSession({ goalRun: { kind: 'execution', iteration: 1 } })
    const result = await report(session, { action: 'needs_review', blocker: 'needs a human eye' })
    expect(result.isError).toBeUndefined()
    expect(session.goalRun.verificationBlocker).toBe('needs a human eye')
    expect(session.goal).toMatchObject({ status: 'blocked', blocker: 'needs a human eye' })
  })

  it('derives the blocker from unmet required criteria when none is given', async () => {
    const session = makeSession({ goalRun: { kind: 'execution', iteration: 1 } })
    const result = await report(session, { action: 'needs_review' })
    expect(result.isError).toBeUndefined()
    expect(session.goalRun.verificationBlocker).toContain('Tests pass')
    expect(session.goal.blocker).toContain('Tests pass')
  })
})

describe('goal_report action="complete"', () => {
  function readySession() {
    const session = makeSession({ goalRun: { kind: 'execution', iteration: 1 } })
    const goal = goalState.applyGoalProgress(session.goal, {
      summary: 'All done',
      evidence: [{ id: 'e1', description: 'tests passed', toolCallId: 'tool-1' }],
      criterionUpdates: [{ id: 'c1', status: 'passed', evidenceIds: ['e1'] }],
      trustedToolNames: new Map([['tool-1', 'run_command']]),
    })
    session.goal = goal.goal
    return session
  }

  it('records the disposition without publishing completion while the run is active', async () => {
    const session = readySession()
    const result = await report(session, { action: 'complete', summary: 'All done' })
    expect(result.isError).toBeUndefined()
    expect(session.goalRun.pendingDisposition).toBe('completed')
    expect(session.goal.status).toBe('verifying')
    expect(session.goal.status).not.toBe('completed')
    expect(result.content[0].text).toContain('automatically only after this turn ends normally')
  })

  it('fails closed when required criteria are not verified', async () => {
    const session = makeSession({ goalRun: { kind: 'execution', iteration: 1 } })
    const code = await reportError(session, { action: 'complete', summary: 'Trust me' })
    expect(code).toBe('GOAL_REPORT_COMPLETE_REJECTED')
    expect(session.goalRun.pendingDisposition).toBeUndefined()
    expect(session.goal.status).toBe('running')
  })

  it('requires an active run', async () => {
    const session = readySession()
    session.goalRun = null
    expect(await reportError(session, { action: 'complete', summary: 'All done' })).toBe('GOAL_REPORT_NO_RUN')
  })
})

describe('goal_report unsupported actions', () => {
  it('rejects unknown or missing actions without touching the goal', async () => {
    const session = makeSession()
    const before = session.goal
    expect(await reportError(session, { action: 'self_destruct' })).toBe('GOAL_REPORT_UNSUPPORTED_ACTION')
    expect(await reportError(session, {})).toBe('GOAL_REPORT_UNSUPPORTED_ACTION')
    expect(await reportError(session, { action: 42 })).toBe('GOAL_REPORT_UNSUPPORTED_ACTION')
    expect(session.goal).toBe(before)
  })
})
