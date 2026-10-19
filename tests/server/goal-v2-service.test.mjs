import { describe, expect, it, vi } from 'vitest'
import { createGoalService } from '../../server/goal/service.mjs'

const NOW = Date.parse('2026-10-19T00:00:00.000Z')

function service(overrides = {}) {
  return createGoalService({ now: () => NOW, ...overrides })
}

describe('goal v2 service', () => {
  it('creates one active goal, arms it, and rejects a second unfinished goal', async () => {
    const goals = service()
    goals.loadSession('s1')
    const goal = await goals.create('s1', { objective: 'Ship it', maxRounds: 4 })
    expect(goal).toMatchObject({ phase: 'active', activation: 'armed', runtime: 'planning', maxRounds: 4 })
    expect(goal.status).toBe('planning')
    await expect(goals.create('s1', { objective: 'Another' })).rejects.toMatchObject({ code: 'GOAL_ALREADY_EXISTS' })
  })

  it('rejects stale revisions on every mutation', async () => {
    const goals = service()
    goals.loadSession('s1')
    const created = await goals.create('s1', { objective: 'Ship it' })
    const updated = await goals.edit('s1', { id: created.id, revision: created.revision }, { maxRounds: 9 })
    expect(updated.maxRounds).toBe(9)
    await expect(goals.pause('s1', { id: created.id, revision: created.revision })).rejects.toMatchObject({
      code: 'GOAL_REVISION_CONFLICT',
    })
  })

  it('uses four durable phases and disarms on restart while keeping the phase', async () => {
    const goals = service()
    goals.loadSession('s1')
    const created = await goals.create('s1', { objective: 'Ship it' })
    const events = goals.getEvents('s1')

    const restored = service()
    const loaded = restored.loadSession('s1', { events })
    expect(loaded).toMatchObject({ id: created.id, phase: 'active', activation: 'disarmed' })
    expect(loaded.status).toBe('paused')
    expect(restored.getActivation('s1')).toBe('disarmed')
  })

  it('migrates an in-flight legacy goal to active/disarmed instead of writing a paused phase', () => {
    const goals = service()
    const loaded = goals.loadSession('s1', {
      legacyGoal: {
        id: 'goal_legacy',
        sessionId: 's1',
        revision: 3,
        objective: 'Legacy',
        status: 'running',
        criteria: [{ id: 'c1', description: 'x', required: true, status: 'pending', evidenceIds: [] }],
        scope: [],
        summary: '',
        budget: { maxIterations: 20, maxActiveDurationMs: null },
        usage: { iterations: 2, activeDurationMs: 10 },
        updatedAt: new Date(NOW).toISOString(),
      },
    })
    expect(loaded).toMatchObject({ phase: 'active', activation: 'disarmed', roundsStarted: 2 })
  })

  it('records a plan, evidence and completion intent', async () => {
    const goals = service()
    goals.loadSession('s1')
    const created = await goals.create('s1', { objective: 'Ship it' })
    const planned = await goals.reportPlan('s1', { id: created.id, revision: created.revision }, {
      criteria: [{ description: 'Tests pass' }],
      summary: 'Plan',
    })
    expect(planned.plan.criteria).toHaveLength(1)
    const progressed = await goals.reportProgress('s1', { id: planned.id, revision: planned.revision }, {
      evidence: [{ description: 'tests', toolCallId: 'tool-1' }],
      criterionUpdates: [{ id: 'c1', status: 'passed', evidenceIds: ['e1'] }],
    })
    expect(progressed.criteria[0].status).toBe('passed')
    const intent = await goals.requestComplete('s1', { id: progressed.id, revision: progressed.revision })
    expect(intent.check.ok).toBe(true)
    expect(intent.goal.runtime).toBe('verifying')
    expect(intent.goal.status).toBe('verifying')
    expect(intent.goal.phase).toBe('active')
  })

  it('admits rounds only while armed and never counts planning as a round', async () => {
    const goals = service()
    goals.loadSession('s1')
    const created = await goals.create('s1', { objective: 'Ship it', maxRounds: 2 })
    const round = await goals.admitRound('s1', { id: created.id, revision: created.revision })
    expect(round.round).toBe(1)
    expect(goals.get('s1').roundsStarted).toBe(1)

    goals.disarm('s1')
    await expect(goals.admitRound('s1', { id: round.goal.id, revision: round.goal.revision })).rejects.toMatchObject({
      code: 'GOAL_NOT_ACTIVE',
    })
    goals.arm('s1')
    const second = await goals.admitRound('s1', { id: round.goal.id, revision: round.goal.revision })
    expect(second.round).toBe(2)
    await expect(goals.admitRound('s1', { id: second.goal.id, revision: second.goal.revision })).rejects.toMatchObject({
      code: 'GOAL_ROUND_LIMIT',
    })
  })

  it('pause disarms, resume re-arms, block records a code, clear writes a tombstone', async () => {
    const goals = service()
    goals.loadSession('s1')
    const created = await goals.create('s1', { objective: 'Ship it' })
    const paused = await goals.pause('s1', { id: created.id, revision: created.revision })
    expect(paused).toMatchObject({ phase: 'paused', activation: 'disarmed', status: 'paused' })
    const resumed = await goals.resume('s1', { id: paused.id, revision: paused.revision })
    expect(resumed).toMatchObject({ phase: 'active', activation: 'armed' })
    const blocked = await goals.block('s1', { id: resumed.id, revision: resumed.revision }, {
      code: 'round_limit',
      message: 'No rounds left.',
    })
    expect(blocked).toMatchObject({ phase: 'blocked', activation: 'disarmed' })
    expect(blocked.blocker).toBe('No rounds left.')
    const cleared = await goals.clear('s1', { id: blocked.id, revision: blocked.revision }, {
      outcome: 'cancelled',
      reason: 'user stopped',
    })
    expect(cleared.goal).toBeNull()
    expect(cleared.tombstone).toMatchObject({ outcome: 'cancelled', reason: 'user stopped' })
  })

  it('re-arms an active-but-disarmed goal without changing its phase', async () => {
    const goals = service()
    goals.loadSession('s1')
    const created = await goals.create('s1', { objective: 'Ship it' })
    const events = goals.getEvents('s1')
    const restored = service()
    const loaded = restored.loadSession('s1', { events })
    expect(loaded).toMatchObject({ phase: 'active', activation: 'disarmed' })
    const resumed = await restored.resume('s1', { id: loaded.id, revision: loaded.revision })
    expect(resumed).toMatchObject({ phase: 'active', activation: 'armed' })
    expect(restored.getEvents('s1')).toHaveLength(events.length)
  })

  it('does not publish state when persistence fails', async () => {
    const persist = vi.fn(async () => {
      throw new Error('disk full')
    })
    const goals = service({ persist })
    goals.loadSession('s1')
    await expect(goals.create('s1', { objective: 'Ship it' })).rejects.toMatchObject({ code: 'GOAL_PERSIST_FAILED' })
    expect(goals.get('s1')).toBeNull()
    expect(persist).toHaveBeenCalledTimes(1)
  })
})
