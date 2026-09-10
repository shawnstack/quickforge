import { describe, expect, it } from 'vitest'
import {
  applyGoalCriterionUpdates,
  applyGoalPlan,
  applyGoalProgress,
  applyHumanAcceptance,
  createGoalState,
  goalAfterRestore,
  goalBudgetExhausted,
  goalCanConfirm,
  goalCanPause,
  goalCanResume,
  goalCompletionCheck,
  goalMetadataSummary,
  goalProgressSignature,
  goalStatusAfterRestore,
  goalUsageWithRun,
  goalWorkspaceKey,
  isGoalActiveStatus,
  isGoalEditableStatus,
  isGoalTerminalStatus,
  mergeGoalEvidence,
  normalizeGoalState,
  resetGoalPlan,
  setGoalStatus,
} from '../../server/agent-goal-state.mjs'

function plannedGoal(overrides = {}) {
  const base = applyGoalPlan(createGoalState({ sessionId: 'session-1', objective: 'Ship goal mode' }), {
    criteria: [
      { description: 'Tests pass', required: true },
      { description: 'Docs look right', required: false },
    ],
    scope: ['server/agent-goal-runner.mjs'],
    summary: 'Implement the runner.',
  })
  return { ...base, ...overrides }
}

describe('goal state model', () => {
  it('normalizes durable plan consent conservatively and preserves it through restore and revise', () => {
    const legacy = plannedGoal({ status: 'paused', usage: { iterations: 3, activeDurationMs: 100 } })
    delete legacy.planConfirmed
    expect(normalizeGoalState(legacy).planConfirmed).toBe(true)
    expect(normalizeGoalState({ ...legacy, usage: { iterations: 0 } }).planConfirmed).toBe(false)
    expect(normalizeGoalState({ ...legacy, status: 'awaiting_confirmation' }).planConfirmed).toBe(false)
    expect(normalizeGoalState({ ...legacy, status: 'planning' }).planConfirmed).toBe(false)
    expect(goalAfterRestore({ ...legacy, status: 'planning' })).toMatchObject({ status: 'paused', planConfirmed: false })
    const revised = resetGoalPlan(normalizeGoalState(legacy), 'Revised objective')
    const replanned = applyGoalPlan(revised, { criteria: [{ description: 'New acceptance' }], summary: 'New plan' })
    const paused = setGoalStatus(replanned, 'paused', { blocker: 'budget_duration_exhausted' })
    const restored = goalAfterRestore(normalizeGoalState(JSON.parse(JSON.stringify(paused))))
    expect(restored).toMatchObject({ planConfirmed: false, status: 'paused', usage: legacy.usage, criteria: replanned.criteria })
  })

  it('creates a planning goal with the documented defaults', () => {
    const goal = createGoalState({ sessionId: 'session-1', objective: '  Ship goal mode  ' })
    expect(goal).toMatchObject({
      sessionId: 'session-1',
      revision: 1,
      objective: 'Ship goal mode',
      status: 'planning',
      criteria: [],
      scope: [],
      summary: '',
      budget: { maxIterations: 8, maxActiveDurationMs: 120 * 60 * 1000 },
      usage: { iterations: 0, activeDurationMs: 0 },
      evidence: [],
    })
    expect(goal.id).toMatch(/^goal_/)
    expect(goal.updatedAt).toEqual(expect.any(String))
  })

  it('normalizes defensively and drops malformed list items', () => {
    const goal = normalizeGoalState({
      id: 'goal_1',
      sessionId: 'session-1',
      revision: -3,
      objective: 'x',
      status: 'running',
      criteria: [
        { id: 'c1', description: 'keep', required: true, status: 'passed', evidenceIds: ['e1', 'e1', 5] },
        { description: 'no id' },
      ],
      evidence: [{ id: 'e1', description: 'ok', toolCallId: 'tool-1' }, { description: 'no id' }],
      scope: ['a', '', 3],
      budget: { maxIterations: 2, maxActiveDurationMs: 1000 },
      usage: { iterations: 1, activeDurationMs: 10 },
    })
    expect(goal).toMatchObject({
      id: 'goal_1',
      revision: 0,
      status: 'running',
      scope: ['a'],
      criteria: [{ id: 'c1', evidenceIds: ['e1'] }],
      evidence: [{ id: 'e1', toolCallId: 'tool-1' }],
    })
    expect(normalizeGoalState(null)).toBeNull()
    expect(normalizeGoalState({ status: 'running' })).toBeNull()
    expect(normalizeGoalState({ id: 'goal_1', status: 'nope' })).toBeNull()
  })

  it('keeps status helpers aligned with the frontend contract', () => {
    expect(isGoalTerminalStatus('completed')).toBe(true)
    expect(isGoalActiveStatus('completed')).toBe(false)
    expect(isGoalActiveStatus('needs_review')).toBe(true)
    expect(goalCanConfirm('awaiting_confirmation')).toBe(true)
    expect(goalCanPause('running')).toBe(true)
    expect(goalCanPause('awaiting_confirmation')).toBe(false)
    expect(goalCanResume('needs_review')).toBe(true)
    expect(isGoalEditableStatus('paused')).toBe(true)
    expect(isGoalEditableStatus('running')).toBe(false)
  })

  it('bumps revision/updatedAt on every transition and can clear the blocker', () => {
    const goal = plannedGoal()
    const blocked = setGoalStatus(goal, 'blocked', { blocker: 'missing access' })
    expect(blocked.revision).toBe(goal.revision + 1)
    expect(blocked.blocker).toBe('missing access')
    const running = setGoalStatus(blocked, 'running')
    expect(running.blocker).toBeUndefined()
    expect(running.revision).toBe(blocked.revision + 1)
  })

  it('resetGoalPlan drops the old plan, evidence and passes', () => {
    const goal = plannedGoal({ evidence: [{ id: 'e1', description: 'x', toolCallId: 'tool-1' }] })
    const revised = resetGoalPlan(goal, 'New objective')
    expect(revised).toMatchObject({
      objective: 'New objective',
      status: 'planning',
      criteria: [],
      scope: [],
      summary: '',
      evidence: [],
    })
    expect(revised.revision).toBe(goal.revision + 1)
  })

  it('keeps the accumulated budget usage across revise', () => {
    const goal = plannedGoal({ usage: { iterations: 5, activeDurationMs: 12_000 } })
    const revised = resetGoalPlan(goal, 'New objective')
    expect(revised.usage).toEqual({ iterations: 5, activeDurationMs: 12_000 })
    expect(revised.budget).toEqual(goal.budget)
  })

  it('assigns server-owned evidence ids and rejects evidence without a tool call', () => {
    const goal = plannedGoal()
    const merged = mergeGoalEvidence(goal, [
      { description: 'tests passed', toolCallId: 'tool-1' },
      { id: 'custom', description: 'build passed', toolCallId: 'tool-2' },
      { description: 'no tool call' },
    ])
    expect(merged.added.map((entry) => entry.id)).toEqual(['e1', 'custom'])
    expect(merged.errors).toHaveLength(1)
  })

  it('never passes a criterion without evidence bound to a tool result', () => {
    const goal = plannedGoal()
    const noEvidence = applyGoalCriterionUpdates(goal, [{ id: 'c1', status: 'passed', evidenceIds: [] }])
    expect(noEvidence.errors[0]).toContain('cannot be passed without evidence')
    const unknown = applyGoalCriterionUpdates(goal, [{ id: 'c1', status: 'passed', evidenceIds: ['e9'] }])
    expect(unknown.errors[0]).toContain('unknown evidence')
    const progressed = applyGoalProgress(goal, {
      summary: 'done',
      evidence: [{ id: 'e1', description: 'tests', toolCallId: 'tool-1' }],
      criterionUpdates: [{ id: 'c1', status: 'passed', evidenceIds: ['e1'] }],
    })
    expect(progressed.errors).toEqual([])
    expect(progressed.goal.criteria[0]).toMatchObject({ status: 'passed', evidenceIds: ['e1'] })
    expect(goalCompletionCheck(progressed.goal)).toEqual({ ok: true, reason: null })
  })

  it('requires every required criterion to be evidenced before completion', () => {
    const goal = plannedGoal({
      criteria: [
        { id: 'c1', description: 'a', required: true, status: 'passed', evidenceIds: ['e1'] },
        { id: 'c2', description: 'b', required: true, status: 'needs_review', evidenceIds: [] },
      ],
      evidence: [{ id: 'e1', description: 'x', toolCallId: 'tool-1' }],
    })
    const check = goalCompletionCheck(goal)
    expect(check.ok).toBe(false)
    expect(check.reason).toContain('c2 is needs_review')
    expect(goalCompletionCheck(plannedGoal({ criteria: [] })).ok).toBe(false)
  })

  it('accounts usage without touching the progress signature', () => {
    const goal = plannedGoal()
    const usage = goalUsageWithRun(goal, { iterations: 2, durationMs: 5000 })
    expect(usage).toEqual({ iterations: 2, activeDurationMs: 5000 })
    const signature = goalProgressSignature(goal)
    expect(goalProgressSignature({ ...goal, usage })).toBe(signature)
    expect(goalProgressSignature(setGoalStatus(goal, 'verifying'))).toBe(signature)
    const progressed = applyGoalProgress(goal, { summary: 'new summary' }).goal
    expect(goalProgressSignature(progressed)).not.toBe(signature)
  })

  it('reports budget exhaustion from accumulated usage only', () => {
    const goal = plannedGoal()
    expect(goalBudgetExhausted(goal).exhausted).toBe(false)
    expect(goalBudgetExhausted({ ...goal, usage: { iterations: 8, activeDurationMs: 0 } })).toEqual({
      exhausted: true,
      reason: 'iteration_budget',
    })
    expect(goalBudgetExhausted({ ...goal, usage: { iterations: 1, activeDurationMs: goal.budget.maxActiveDurationMs } })).toEqual({
      exhausted: true,
      reason: 'duration_budget',
    })
  })

  it('maps in-flight statuses to paused on restore and keeps the rest', () => {
    for (const status of ['planning', 'running', 'verifying', 'awaiting_input', 'awaiting_approval', 'pausing']) {
      expect(goalStatusAfterRestore(status)).toBe('paused')
    }
    for (const status of ['awaiting_confirmation', 'paused', 'blocked', 'needs_review', 'completed', 'failed', 'cancelled']) {
      expect(goalStatusAfterRestore(status)).toBe(status)
    }
    const running = plannedGoal({ status: 'running' })
    const restored = goalAfterRestore(running)
    expect(restored.status).toBe('paused')
    expect(restored.blocker).toContain('restarted')
    expect(restored.revision).toBe(running.revision + 1)
    expect(goalAfterRestore(restored)).toBe(restored)
    expect(goalAfterRestore(null)).toBeNull()
  })

  it('projects metadata and workspace keys', () => {
    const goal = plannedGoal()
    expect(goalMetadataSummary(goal)).toEqual({ id: goal.id, status: 'awaiting_confirmation', updatedAt: goal.updatedAt })
    expect(goalMetadataSummary(null)).toBeUndefined()
    expect(goalWorkspaceKey({ scope: 'project', projectId: 'p1' })).toBe('project:p1')
    expect(goalWorkspaceKey({ scope: 'global', projectId: 'p1' })).toBe('global')
    // A normalized path wins over projectId, so two projectIds on the same
    // directory share one workspace.
    expect(goalWorkspaceKey({ workspaceRoot: 'C:/WS/Dir' })).toBe(goalWorkspaceKey({ workspaceRoot: 'c:\\ws\\dir' }))
    expect(goalWorkspaceKey({ scope: 'project', projectId: 'p1', workspaceRoot: 'C:/WS/Dir' }))
      .toBe(goalWorkspaceKey({ scope: 'project', projectId: 'p2', workspaceRoot: 'c:/ws/dir' }))
  })

  it('defaults criteria to required consistently when normalizing and planning', () => {
    const normalized = normalizeGoalState({ id: 'goal_1', status: 'running', criteria: [{ id: 'c1', description: 'x' }] })
    expect(normalized.criteria[0].required).toBe(true)
    const planned = applyGoalPlan(createGoalState({ sessionId: 'session-1', objective: 'x' }), {
      criteria: [{ description: 'x' }],
      summary: 'plan',
    })
    expect(planned.criteria[0].required).toBe(true)
  })

  it('records human acceptance evidence and completes only through the user API', () => {
    const goal = plannedGoal({
      status: 'needs_review',
      criteria: [
        { id: 'c1', description: 'Subjective UX', required: true, status: 'needs_review', evidenceIds: [] },
        { id: 'c2', description: 'Docs read', required: false, status: 'needs_review', evidenceIds: [] },
      ],
    })
    const accepted = applyHumanAcceptance(goal)
    expect(accepted.errors).toEqual([])
    expect(accepted.goal.status).toBe('completed')
    expect(accepted.goal.humanAcceptedAt).toEqual(expect.any(String))
    expect(accepted.goal.acceptedCriterionIds).toEqual(['c1', 'c2'])
    const humanEvidence = accepted.goal.evidence.filter((entry) => entry.source === 'human')
    expect(humanEvidence).toHaveLength(2)
    expect(humanEvidence.every((entry) => entry.toolCallId === undefined)).toBe(true)
    expect(goalCompletionCheck(accepted.goal)).toEqual({ ok: true, reason: null })
  })

  it('blocks human acceptance of failed required criteria', () => {
    const goal = plannedGoal({
      status: 'needs_review',
      criteria: [{ id: 'c1', description: 'Tests pass', required: true, status: 'failed', evidenceIds: [] }],
    })
    const result = applyHumanAcceptance(goal)
    expect(result.goal).toBe(goal)
    expect(result.errors[0]).toContain('c1')
  })

  it('does not trust human evidence without a recorded acceptance', () => {
    const goal = plannedGoal({
      criteria: [{ id: 'c1', description: 'a', required: true, status: 'passed', evidenceIds: ['h1'] }],
      evidence: [{ id: 'h1', description: 'human', source: 'human' }],
    })
    expect(goalCompletionCheck(goal).ok).toBe(false)
  })

  it('never lets goal_report fabricate human evidence', () => {
    const goal = plannedGoal()
    const merged = mergeGoalEvidence(goal, [{ description: 'x', toolCallId: 'tool-1', source: 'human' }])
    expect(merged.added).toEqual([])
    expect(merged.errors[0]).toContain('human acceptance evidence')
  })
})
