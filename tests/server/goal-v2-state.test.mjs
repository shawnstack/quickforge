import { describe, expect, it } from 'vitest'
import {
  admitGoalRoundV2,
  blockGoalV2,
  completeGoalV2,
  createGoalV2,
  editGoalV2,
  goalMetadataSummaryV2,
  legacyStatusFromV2,
  normalizeGoalV2,
  pauseGoalV2,
  resumeGoalV2,
} from '../../server/goal/state.mjs'

const NOW = Date.parse('2026-10-19T00:00:00.000Z')

/**
 * A goal carrying a plan. v2 has no plan writer any more (completion is a single
 * model-declared transition), but restored legacy snapshots still hold plans, so
 * normalization and the edit-invalidation contract are exercised with a literal.
 */
function planned(overrides = {}) {
  const base = createGoalV2({ sessionId: 's1', objective: 'Ship it', now: NOW })
  return {
    ...base,
    plan: {
      criteria: [
        { id: 'c1', description: 'Tests pass', required: true, status: 'pending', evidenceIds: [] },
        { id: 'c2', description: 'Docs updated', required: false, status: 'pending', evidenceIds: [] },
      ],
      scope: ['server/goal'],
      summary: 'Implement goal v2.',
      submittedAt: new Date(NOW).toISOString(),
    },
    ...overrides,
  }
}

describe('goal v2 state', () => {
  it('creates an active goal with four-phase fields and round budget', () => {
    const goal = createGoalV2({ sessionId: 's1', objective: '  Ship it  ', maxRounds: 8, now: NOW })
    expect(goal).toMatchObject({
      sessionId: 's1',
      revision: 1,
      objective: 'Ship it',
      phase: 'active',
      maxRounds: 8,
      roundsStarted: 0,
      plan: null,
      evidence: [],
      blocker: null,
      usage: { activeDurationMs: 0 },
    })
    expect(goal.id).toMatch(/^goal_/)
  })

  it('editing the objective invalidates the old plan and evidence, editing rounds does not', () => {
    const goal = planned({ evidence: [{ id: 'e1', description: 'x', toolCallId: 't1' }] })
    const roundsOnly = editGoalV2(goal, { maxRounds: 30 }, NOW)
    expect(roundsOnly.plan).toEqual(goal.plan)
    expect(roundsOnly.evidence).toEqual(goal.evidence)
    const revised = editGoalV2(goal, { objective: 'Ship it better' }, NOW)
    expect(revised.objective).toBe('Ship it better')
    expect(revised.plan).toBeNull()
    expect(revised.evidence).toEqual([])
    expect(revised.phase).toBe('active')
  })

  it('transitions through pause/resume/block/complete and enforces phases', () => {
    const goal = planned()
    const paused = pauseGoalV2(goal, NOW)
    expect(paused.phase).toBe('paused')
    const resumed = resumeGoalV2(paused, NOW)
    expect(resumed.phase).toBe('active')
    const blocked = blockGoalV2(resumed, { code: 'round_limit', message: 'limit' }, NOW)
    expect(blocked.phase).toBe('blocked')
    expect(blocked.blocker).toEqual({ code: 'round_limit', message: 'limit' })
    const completed = completeGoalV2(blocked, { by: 'user', now: NOW })
    expect(completed.phase).toBe('complete')
    expect(completed.completedBy).toBe('user')
    expect(() => pauseGoalV2(completed, NOW)).toThrow(/Cannot pause/)
  })

  it('admits rounds only while active and below the limit', () => {
    const goal = createGoalV2({ sessionId: 's1', objective: 'x', maxRounds: 2, now: NOW })
    const first = admitGoalRoundV2(goal, NOW)
    expect(first.roundsStarted).toBe(1)
    const second = admitGoalRoundV2(first, NOW)
    expect(second.roundsStarted).toBe(2)
    expect(() => admitGoalRoundV2(second, NOW)).toThrow(/limit/)
    expect(() => resumeGoalV2({ ...second, phase: 'paused' }, NOW)).toThrow(/exhausted/)
  })

  it('normalizes v2 and legacy snapshots and projects a legacy status', () => {
    const goal = planned()
    const normalized = normalizeGoalV2(JSON.parse(JSON.stringify(goal)))
    expect(normalized).toMatchObject({ id: goal.id, phase: 'active', revision: goal.revision })
    expect(normalized.plan.criteria).toHaveLength(2)

    const legacy = normalizeGoalV2({
      id: 'goal_legacy',
      sessionId: 's1',
      revision: 4,
      objective: 'Legacy',
      status: 'needs_review',
      criteria: [{ id: 'c1', description: 'x', required: true, status: 'needs_review' }],
      budget: { maxIterations: 20, maxActiveDurationMs: null },
      usage: { iterations: 3, activeDurationMs: 10 },
      blocker: 'needs a human',
    })
    expect(legacy).toMatchObject({
      phase: 'blocked',
      maxRounds: 20,
      roundsStarted: 3,
      blocker: { code: 'verification_failed', message: 'needs a human' },
    })
    expect(legacyStatusFromV2(legacy, { activation: 'disarmed', runtime: 'idle' })).toBe('needs_review')
    expect(legacyStatusFromV2({ ...goal, phase: 'active' }, { activation: 'disarmed' })).toBe('paused')
  })

  it('projects metadata with phase and revision', () => {
    const goal = planned()
    expect(goalMetadataSummaryV2(goal)).toEqual({
      id: goal.id,
      phase: 'active',
      revision: goal.revision,
      updatedAt: goal.updatedAt,
    })
  })
})
