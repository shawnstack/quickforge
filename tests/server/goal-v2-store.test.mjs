import { describe, expect, it } from 'vitest'
import { createGoalV2, applyGoalPlanV2, admitGoalRoundV2 } from '../../server/goal/state.mjs'
import {
  createGoalEvent,
  foldGoalEvents,
  migrateLegacyGoal,
} from '../../server/goal/store.mjs'

const NOW = Date.parse('2026-10-19T00:00:00.000Z')
const AT = new Date(NOW).toISOString()

function lifecycle() {
  const created = createGoalV2({ sessionId: 's1', objective: 'Ship it', maxRounds: 3, now: NOW })
  const planned = applyGoalPlanV2(created, { criteria: [{ description: 'Tests pass' }], summary: 'Plan' }, NOW)
  const round = admitGoalRoundV2(planned, NOW)
  return [
    createGoalEvent({ operation: 'create', goal: created, at: AT }),
    createGoalEvent({ operation: 'change', goal: planned, at: AT }),
    createGoalEvent({ operation: 'round', goal: round, at: AT }),
  ]
}

describe('goal v2 store', () => {
  it('folds create/change/round into the current goal', () => {
    const folded = foldGoalEvents(lifecycle(), { sessionId: 's1' })
    expect(folded.lastError).toBeNull()
    expect(folded.goal).toMatchObject({ phase: 'active', roundsStarted: 1, revision: 3 })
    expect(folded.goal.plan.criteria[0].description).toBe('Tests pass')
  })

  it('rejects revision gaps and invalid transitions', () => {
    const events = lifecycle()
    const gap = [events[0], { ...events[2], goal: { ...events[2].goal, revision: 9 } }]
    expect(foldGoalEvents(gap).lastError).toContain('revision gap')

    const complete = createGoalEvent({
      operation: 'change',
      goal: { ...events[1].goal, revision: 2, phase: 'complete' },
      at: AT,
    })
    const invalid = [
      events[0],
      complete,
      createGoalEvent({ operation: 'change', goal: { ...complete.goal, revision: 3, phase: 'active' }, at: AT }),
    ]
    expect(foldGoalEvents(invalid).lastError).toContain('Invalid goal phase transition')
  })

  it('rejects round admission that skips numbers or leaves active', () => {
    const events = lifecycle()
    const skip = [events[0], events[1], { ...events[2], goal: { ...events[2].goal, roundsStarted: 2 } }]
    expect(foldGoalEvents(skip).lastError).toContain('exactly one')
  })

  it('writes a tombstone on clear and stops exposing a current goal', () => {
    const events = lifecycle()
    const cleared = [
      ...events,
      createGoalEvent({
        operation: 'clear',
        goal: events[2].goal,
        at: AT,
        tombstone: { outcome: 'cancelled', reason: 'user cancelled', at: AT, goal: events[2].goal },
      }),
    ]
    const folded = foldGoalEvents(cleared)
    expect(folded.goal).toBeNull()
    expect(folded.tombstone).toMatchObject({ outcome: 'cancelled', reason: 'user cancelled' })
    expect(folded.tombstone.goal.id).toBe(events[0].goal.id)
  })

  it('migrates legacy active/blocked/completed snapshots', () => {
    const base = {
      id: 'goal_legacy',
      sessionId: 's1',
      revision: 2,
      objective: 'Legacy',
      criteria: [{ id: 'c1', description: 'x', required: true, status: 'pending', evidenceIds: [] }],
      scope: ['server'],
      summary: 'legacy plan',
      budget: { maxIterations: 7, maxActiveDurationMs: null },
      usage: { iterations: 2, activeDurationMs: 12 },
      updatedAt: AT,
    }
    const active = migrateLegacyGoal({ ...base, status: 'running' }, { sessionId: 's1', at: AT })
    expect(active.goal).toMatchObject({ phase: 'active', maxRounds: 7, roundsStarted: 2 })
    expect(active.events).toHaveLength(1)
    expect(active.events[0].operation).toBe('restore')

    const blocked = migrateLegacyGoal({ ...base, status: 'needs_review', blocker: 'manual check' }, { sessionId: 's1', at: AT })
    expect(blocked.goal.phase).toBe('blocked')
    expect(blocked.goal.blocker).toEqual({ code: 'verification_failed', message: 'manual check' })

    const complete = migrateLegacyGoal({ ...base, status: 'completed' }, { sessionId: 's1', at: AT })
    expect(complete.goal.phase).toBe('complete')
  })

  it('migrates failed/cancelled snapshots to a tombstone with an outcome', () => {
    const legacy = {
      id: 'goal_failed',
      sessionId: 's1',
      revision: 3,
      objective: 'Legacy',
      status: 'cancelled',
      criteria: [],
      scope: [],
      summary: '',
      budget: { maxIterations: 20, maxActiveDurationMs: null },
      usage: { iterations: 1, activeDurationMs: 10 },
      blocker: 'user stopped',
      updatedAt: AT,
    }
    const migrated = migrateLegacyGoal(legacy, { sessionId: 's1', at: AT })
    expect(migrated.goal).toBeNull()
    expect(migrated.tombstone).toMatchObject({ outcome: 'cancelled', reason: 'user stopped' })
    expect(migrated.events.map((event) => event.operation)).toEqual(['restore', 'clear'])
    const folded = foldGoalEvents(migrated.events)
    expect(folded.goal).toBeNull()
    expect(folded.tombstone.outcome).toBe('cancelled')
  })
})
