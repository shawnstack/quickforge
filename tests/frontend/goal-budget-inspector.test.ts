import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GoalActionOptions, GoalState } from '../../src/lib/goal'

const state = vi.hoisted(() => ({ confirmation: null as GoalActionOptions | null }))
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return { ...actual, useState: (initial: unknown) => actual.useState(initial === null ? state.confirmation : initial) }
})
vi.mock('@earendil-works/pi-web-ui', () => ({ translations: { en: {}, zh: {} } }))
import { GoalInspectorContent } from '../../src/components/workspace/GoalInspectorContent'
import { applyAppLanguageFromSnapshot } from '../../src/lib/i18n'
import { clearGoalUi, setGoalUiDraft } from '../../src/lib/goal-ui'

const goal: GoalState = {
  id: 'budget-goal', sessionId: 'budget-session', revision: 7, objective: 'Ship', status: 'paused',
  criteria: [], evidence: [], scope: [], summary: '', updatedAt: '',
  budget: { maxIterations: 8, maxActiveDurationMs: 1_800_000 },
  usage: { iterations: 16, activeDurationMs: 1_800_000 },
}
const render = (patch: Partial<GoalState> = {}) => renderToStaticMarkup(createElement(GoalInspectorContent, {
  goal: { ...goal, ...patch }, sessionId: goal.sessionId, active: true, view: 'progress',
  onViewChange: () => {}, onAction: async () => {}, onSave: async () => {},
}))
afterEach(() => { state.confirmation = null; clearGoalUi(goal.sessionId, goal.id) })
applyAppLanguageFromSnapshot('en')

describe('budget confirmation SSR', () => {
  it('hides the duration budget row when unlimited, without invalid meter values', () => {
    const html = render({ budget: { maxIterations: 8, maxActiveDurationMs: null }, usage: { iterations: 1, activeDurationMs: 9_000_000 } })
    expect(html).not.toContain('Unlimited')
    expect(html).not.toContain('Elapsed (min)')
    expect(html).not.toMatch(/NaN|Infinity|width:null|width:undefined/)
    expect(html).not.toContain('Exhausted')
  })
  it('shows plan confirmation, not running actions, after an unconfirmed resume response', () => {
    const html = render({ status: 'awaiting_confirmation', planConfirmed: false })
    expect(html).toContain('Plan ready')
    // The scroll container and pinned bottom action bar structure (G-01).
    expect(html).toContain('quickforge-goal-inspector-scroll')
    expect(html).toContain('quickforge-goal-inspector-footer')
    expect(html).not.toMatch(/<button[^>]*>Confirm goal<\/button>/)
    expect(html).toContain('Add budget and continue')
    expect(html).not.toContain('>Resume</button>')
  })

  it('still offers explicit budget extension when the authoritative response remains paused', () => {
    const html = render({ status: 'paused', planConfirmed: true,
      budget: { maxIterations: 16, maxActiveDurationMs: 3_600_000 } })
    expect(html).toContain('Paused')
    expect(html).toMatch(/<button[^>]*>Add budget and continue<\/button>/)
    expect(html).not.toContain('role="group"')
    expect(html).not.toContain('>Confirm goal</button>')
  })

  it('requires an explicit confirmation before showing the grant', () => {
    const initial = render()
    state.confirmation = { goalId: goal.id, expectedRevision: goal.revision }
    const confirmed = render()
    expect(initial).not.toContain('role="group"')
    expect(confirmed).toContain('role="group"')
    // The grant line replaces the old raw-millisecond concatenation (G-09).
    expect(confirmed).toContain('Add 8 iterations only if exhausted; remove the legacy time limit')
    expect(confirmed).not.toContain('1800000')
    // Structured budget meters carry the usage/limit, not raw milliseconds.
    expect(confirmed.match(/quickforge-goal-inspector-meter-fill" style="width:100%"/g)).toHaveLength(2)
    expect(confirmed.match(/quickforge-goal-inspector-chip/g)).toHaveLength(2)
    expect(confirmed).toContain('Exhausted')
    expect(confirmed).toMatch(/<button[^>]*>Confirm goal<\/button>/)
    expect(confirmed).toContain('Usage still reaches the new limit')
  })
  it.each([{ revision: 8 }, { id: 'replacement' }, { status: 'running' as const }])('disables stale confirmation: %j', (patch) => {
    state.confirmation = { goalId: goal.id, expectedRevision: goal.revision }
    expect(render(patch)).toMatch(/<button[^>]*disabled[^>]*>Confirm goal<\/button>/)
  })
  it('shares the retained dirty lock with the confirmation', () => {
    state.confirmation = { goalId: goal.id, expectedRevision: goal.revision }
    setGoalUiDraft(goal.sessionId, goal.id, { objective: goal.objective, text: 'changed', editing: true })
    expect(render()).toMatch(/<button[^>]*disabled[^>]*>Confirm goal<\/button>/)
  })
})
