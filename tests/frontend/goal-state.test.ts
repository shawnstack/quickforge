import { describe, expect, it } from 'vitest'
import {
  GOAL_STATUSES,
  goalAcceptanceCheck,
  goalBudgetExtension,
  goalCanAccept,
  goalCanCancel,
  goalCanConfirm,
  goalCanPause,
  goalCanResume,
  goalDurationMinutes,
  goalIsEditable,
  isGoalAction,
  isGoalActive,
  isGoalSpinning,
  isGoalStatus,
  isGoalTerminal,
  normalizeGoalState,
  type GoalState,
  type GoalStatus,
} from '../../src/lib/goal'

function goal(overrides: Partial<GoalState> = {}): GoalState {
  return {
    id: 'goal-1',
    sessionId: 'session-1',
    revision: 1,
    objective: 'Ship the feature',
    status: 'running',
    criteria: [],
    scope: [],
    summary: '',
    budget: { maxIterations: 10, maxActiveDurationMs: 600_000 },
    usage: { iterations: 2, activeDurationMs: 120_000 },
    evidence: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('goalBudgetExtension', () => {
  it.each([
    [2, 120_000, 0, 0, false],
    [10, 120_000, 8, 0, false],
    [2, 600_000, 0, 7_200_000, false],
    [10, 600_000, 8, 7_200_000, false],
    [18, 600_000, 8, 7_200_000, true],
    [10, 7_800_000, 8, 7_200_000, true],
  ])('grants exhausted dimensions only (%s iterations / %s ms)', (usedIterations, usedDuration, iterations, activeDurationMs, stillExhausted) => {
    const state = goal({ usage: { iterations: usedIterations as number, activeDurationMs: usedDuration as number } })
    const before = JSON.stringify(state)
    expect(goalBudgetExtension(state)).toEqual({ iterations, activeDurationMs, exhausted: !!(iterations || activeDurationMs), stillExhausted })
    expect(JSON.stringify(state)).toBe(before)
    expect(isGoalAction('extend_resume')).toBe(true)
  })
})

describe('normalizeGoalState', () => {
  it.each([
    ['planning', true, 9, false],
    ['awaiting_confirmation', true, 9, false],
    ['paused', false, 9, false],
    ['running', true, 0, true],
    ['paused', undefined, 0, false],
    ['paused', undefined, 1, true],
    ['paused', undefined, 0.5, true],
    ['blocked', undefined, 2, true],
    ['needs_review', undefined, 2, true],
    ['planning', undefined, 9, false],
    ['awaiting_confirmation', undefined, 9, false],
    ['paused', 'invalid', 0, false],
  ])('matches server plan consent compatibility: %s / %s / %s', async (status, planConfirmed, iterations, expected) => {
    const { normalizeGoalState: normalizeServerGoal } = await import('../../server/agent-goal-state.mjs')
    const raw = { ...goal(), status, planConfirmed, usage: { iterations, activeDurationMs: 0 } }
    const normalized = normalizeGoalState(raw)
    expect(normalized?.planConfirmed).toBe(expected)
    expect(normalized?.planConfirmed).toBe(normalizeServerGoal(raw)?.planConfirmed)
    expect(raw.planConfirmed).toBe(planConfirmed)
  })

  it('defaults missing or malformed legacy usage to unconfirmed', () => {
    for (const usage of [undefined, null, {}, { iterations: 'bad' }, { iterations: -1 }]) {
      expect(normalizeGoalState({ id: 'goal-1', status: 'paused', usage })?.planConfirmed).toBe(false)
    }
  })

  it('returns null for a missing or unrecognizable goal', () => {
    expect(normalizeGoalState(null)).toBeNull()
    expect(normalizeGoalState(undefined)).toBeNull()
    expect(normalizeGoalState('goal')).toBeNull()
    expect(normalizeGoalState({})).toBeNull()
    expect(normalizeGoalState({ id: 'goal-1' })).toBeNull()
    expect(normalizeGoalState({ id: 'goal-1', status: 'not-a-status' })).toBeNull()
    expect(normalizeGoalState({ status: 'running' })).toBeNull()
  })

  it('normalizes a full payload and keeps unknown optional fields compatible', () => {
    const normalized = normalizeGoalState({
      ...goal(),
      blocker: 'Waiting on a dependency',
      futureField: { anything: true },
    })
    expect(normalized).not.toBeNull()
    expect(normalized).toMatchObject({
      id: 'goal-1',
      sessionId: 'session-1',
      revision: 1,
      objective: 'Ship the feature',
      status: 'running',
      blocker: 'Waiting on a dependency',
    })
    expect(normalized).not.toHaveProperty('futureField')
  })

  it('coerces missing scalars and drops malformed list entries', () => {
    const normalized = normalizeGoalState({
      id: 'goal-1',
      status: 'running',
      criteria: [
        { id: 'c1', description: 'Builds', required: true, status: 'passed', evidenceIds: ['e1', 7] },
        { description: 'missing id' },
        'not-an-object',
      ],
      scope: ['src/**', '', 3],
      evidence: [
        { id: 'e1', description: 'npm test', toolCallId: 'call-1' },
        { id: 'e2', description: 'manual review', source: 'human', acceptedAt: '2026-01-02T00:00:00.000Z' },
        { description: 'missing id' },
      ],
      budget: { maxIterations: '10', maxActiveDurationMs: -5 },
      usage: { iterations: 1.9 },
      revision: -3,
    })
    expect(normalized).toMatchObject({
      sessionId: '',
      revision: 0,
      objective: '',
      summary: '',
      updatedAt: '',
      budget: { maxIterations: 0, maxActiveDurationMs: 0 },
      usage: { iterations: 1, activeDurationMs: 0 },
      scope: ['src/**'],
      criteria: [{ id: 'c1', description: 'Builds', required: true, status: 'passed', evidenceIds: ['e1'] }],
      evidence: [
        { id: 'e1', description: 'npm test', toolCallId: 'call-1' },
        { id: 'e2', description: 'manual review', source: 'human', acceptedAt: '2026-01-02T00:00:00.000Z' },
      ],
    })
    expect(normalized).not.toHaveProperty('blocker')
  })

  it('keeps the optional evidence origin fields and omits them when absent', () => {
    const normalized = normalizeGoalState({
      id: 'goal-1',
      status: 'needs_review',
      evidence: [
        { id: 'e1', description: 'tool result', toolCallId: 'call-1', toolName: 'run_command' },
        { id: 'e2', description: 'human accepted', source: 'human', acceptedAt: '2026-01-02T00:00:00.000Z' },
      ],
    })
    expect(normalized?.evidence[0]).toEqual({
      id: 'e1',
      description: 'tool result',
      toolCallId: 'call-1',
      toolName: 'run_command',
    })
    expect(normalized?.evidence[1]).toEqual({
      id: 'e2',
      description: 'human accepted',
      source: 'human',
      acceptedAt: '2026-01-02T00:00:00.000Z',
    })
  })

  it('keeps the optional acceptance and blocker fields and omits them when absent', () => {
    const normalized = normalizeGoalState({
      id: 'goal-1',
      status: 'paused',
      blocker: 'duration_budget',
      blockerHint: 'Budget exhausted. Cancel this goal and start a new one.',
      humanAcceptedAt: '2026-01-02T00:00:00.000Z',
      acceptedCriterionIds: ['c1', 'c1', '', 7],
    })
    expect(normalized).toMatchObject({
      blocker: 'duration_budget',
      blockerHint: 'Budget exhausted. Cancel this goal and start a new one.',
      humanAcceptedAt: '2026-01-02T00:00:00.000Z',
      acceptedCriterionIds: ['c1'],
    })
    expect(normalizeGoalState({ id: 'goal-1', status: 'running' })).not.toHaveProperty('blockerHint')
  })

  it('normalizes a real server acceptance payload (applyHumanAcceptance)', async () => {
    // Read the payload the server actually produces instead of assuming a
    // hand-written contract; a field rename on either side must fail here.
    const {
      createGoalState,
      applyGoalPlan,
      applyGoalProgress,
      applyHumanAcceptance,
      setGoalStatus,
    } = await import('../../server/agent-goal-state.mjs')

    const planned = applyGoalPlan(createGoalState({ sessionId: 'session-1', objective: 'Ship it' }), {
      criteria: [{ description: 'Builds' }, { description: 'Docs updated', required: false }],
      scope: ['src/**'],
      summary: 'plan',
    })
    const progressed = applyGoalProgress(planned, {
      evidence: [{ id: 'e1', description: 'npm run build', toolCallId: 'call-1' }],
      criterionUpdates: [{ id: 'c1', status: 'passed', evidenceIds: ['e1'] }],
      trustedToolNames: new Map([['call-1', 'run_command']]),
    }).goal
    const accepted = applyHumanAcceptance(progressed).goal

    const normalized = normalizeGoalState(accepted)
    expect(normalized).not.toBeNull()
    expect(normalized!.status).toBe('completed')
    expect(normalized!.humanAcceptedAt).toBe(accepted.humanAcceptedAt)
    expect(normalized!.acceptedCriterionIds).toEqual(accepted.acceptedCriterionIds)

    const humanEvidence = normalized!.evidence.find((entry) => entry.source === 'human')
    expect(humanEvidence?.acceptedAt).toBe(accepted.humanAcceptedAt)
    const toolEvidence = normalized!.evidence.find((entry) => entry.toolCallId === 'call-1')
    expect(toolEvidence?.toolName).toBe('run_command')

    // The budget blocker the server writes alongside its hint survives too.
    const paused = setGoalStatus(createGoalState({ sessionId: 'session-1', objective: 'Ship it' }), 'paused', {
      blocker: 'duration_budget',
      blockerHint: 'Budget exhausted. Cancel this goal and start a new one.',
    })
    const normalizedPaused = normalizeGoalState(paused)
    expect(normalizedPaused?.blocker).toBe('duration_budget')
    expect(normalizedPaused?.blockerHint).toBe(paused.blockerHint)
  })

  it('falls back an unknown criterion status to pending', () => {
    const normalized = normalizeGoalState({
      id: 'goal-1',
      status: 'running',
      criteria: [{ id: 'c1', description: 'x', status: 'mystery' }],
    })
    expect(normalized?.criteria[0].status).toBe('pending')
  })
})

describe('goal status semantics', () => {
  const all: GoalStatus[] = [...GOAL_STATUSES]

  it('classifies terminal, active and spinning states', () => {
    for (const status of all) {
      expect(isGoalStatus(status)).toBe(true)
      expect(isGoalTerminal(status)).toBe(['completed', 'failed', 'cancelled'].includes(status))
      expect(isGoalSpinning(status)).toBe([
        'planning', 'running', 'verifying', 'awaiting_input', 'awaiting_approval', 'pausing',
      ].includes(status))
      // Terminal states are never active; every non-terminal state is active.
      expect(isGoalActive(status)).toBe(!isGoalTerminal(status))
    }
    expect(isGoalStatus('nope')).toBe(false)
    expect(isGoalStatus(undefined)).toBe(false)
  })

  it('gates each action to the states that allow it', () => {
    expect(all.filter(goalCanConfirm)).toEqual(['awaiting_confirmation'])
    expect(all.filter(goalIsEditable)).toEqual(['awaiting_confirmation', 'paused', 'blocked'])
    expect(all.filter(goalCanPause)).toEqual(['running', 'verifying'])
    expect(all.filter(goalCanResume)).toEqual(['paused', 'blocked', 'needs_review'])
    expect(all.filter(goalCanCancel)).toEqual([
      'planning', 'awaiting_confirmation', 'running', 'verifying', 'awaiting_input',
      'awaiting_approval', 'pausing', 'paused', 'blocked', 'needs_review',
    ])
  })

  it('accepts every goal action, including the explicit human accept', () => {
    for (const action of ['confirm', 'pause', 'resume', 'cancel', 'revise', 'accept'] as const) {
      expect(isGoalAction(action)).toBe(true)
    }
    expect(isGoalAction('approve')).toBe(false)
    expect(isGoalAction(undefined)).toBe(false)
  })

  it('pausing is not treated as stopped', () => {
    expect(goalCanPause('pausing')).toBe(false)
    expect(goalCanResume('pausing')).toBe(false)
    expect(isGoalSpinning('pausing')).toBe(true)
    expect(isGoalTerminal('pausing')).toBe(false)
  })
})

describe('goalAcceptanceCheck / goalCanAccept', () => {
  const passedCriterion = { id: 'c1', description: 'Builds', required: true, status: 'passed' as const, evidenceIds: ['e1'] }
  const evidence = { id: 'e1', description: 'npm run build', toolCallId: 'call-1' }
  const failedCriterion = { id: 'c1', description: 'Builds', required: true, status: 'failed' as const, evidenceIds: [] }

  it('accepts needs_review as an explicit human decision when nothing required failed', () => {
    // Machine-verified required criteria still pass the gate.
    expect(goalAcceptanceCheck(goal({ status: 'needs_review', criteria: [passedCriterion], evidence: [evidence] })))
      .toEqual({ ok: true, reason: '' })

    // Pending / needs_review required criteria are exactly what the human is
    // signing off on; the backend records human evidence for them.
    expect(goalAcceptanceCheck(goal({
      status: 'needs_review',
      criteria: [{ id: 'c1', description: 'Looks right', required: true, status: 'needs_review', evidenceIds: [] }],
    })).ok).toBe(true)
    expect(goalAcceptanceCheck(goal({
      status: 'needs_review',
      criteria: [{ id: 'c1', description: 'Manual check', required: true, status: 'pending', evidenceIds: [] }],
    })).ok).toBe(true)

    // Evidence is no longer required to carry a toolCallId in the UI mirror:
    // human-accepted evidence (and the backend) is authoritative.
    expect(goalAcceptanceCheck(goal({
      status: 'needs_review',
      criteria: [passedCriterion],
      evidence: [{ id: 'e1', description: 'reviewed by hand', source: 'human', acceptedAt: '2026-01-02T00:00:00.000Z' }],
    })).ok).toBe(true)
  })

  it('blocks acceptance when a required criterion failed', () => {
    const blocked = goalAcceptanceCheck(goal({ status: 'needs_review', criteria: [failedCriterion] }))
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toContain('c1')

    // Optional failures never block an explicit human acceptance.
    expect(goalAcceptanceCheck(goal({
      status: 'needs_review',
      criteria: [{ ...failedCriterion, required: false }],
    })).ok).toBe(true)
  })

  it('only needs_review can be accepted', () => {
    expect(goalCanAccept(goal({ status: 'needs_review', criteria: [] }))).toBe(true)
    expect(goalCanAccept(goal({ status: 'running', criteria: [] }))).toBe(false)
    expect(goalCanAccept(goal({ status: 'needs_review', criteria: [failedCriterion] }))).toBe(false)
  })
})

describe('goalDurationMinutes', () => {
  it('never reports a fabricated fraction or percentage', () => {
    expect(goalDurationMinutes(0)).toBe(0)
    expect(goalDurationMinutes(-1000)).toBe(0)
    expect(goalDurationMinutes(1)).toBe(1)
    expect(goalDurationMinutes(59_000)).toBe(1)
    expect(goalDurationMinutes(90_000)).toBe(2)
    expect(goalDurationMinutes(Number.NaN)).toBe(0)
  })
})
