import { describe, expect, it, vi } from 'vitest'
import { createGoalPlanConfirmationController, currentGoalPlan } from '../../src/components/chat/panel-decoration/goal-plan-confirmation'
import { normalizeGoalState, goalBudgetExtension, goalCanConfirm, goalCanResume } from '../../src/lib/goal'

describe('automatic Goal planning compatibility', () => {
  it('never turns historical plans into current confirmation actions', () => {
    const onConfirm = vi.fn()
    const panel = { querySelectorAll: vi.fn(() => []) } as unknown as HTMLElement
    const controller = createGoalPlanConfirmationController({ panel, enabled: () => true, getSessionId: () => 's', getGoal: () => null, getMessages: () => [], isStreaming: () => false, onConfirm })
    controller.update()
    controller.update()
    controller.cleanup()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(currentGoalPlan([], null, 's')).toBeNull()
    expect(goalCanConfirm('awaiting_confirmation')).toBe(false)
    expect(goalCanResume('awaiting_confirmation')).toBe(true)
  })

  it('preserves JSON null unlimited duration and grants only exhausted iterations', () => {
    const goal = normalizeGoalState({ id: 'goal', status: 'paused', budget: { maxIterations: 8, maxActiveDurationMs: null }, usage: { iterations: 8, activeDurationMs: 99_000_000 } })!
    expect(goal.budget.maxActiveDurationMs).toBeNull()
    expect(normalizeGoalState(JSON.parse(JSON.stringify(goal)))!.budget.maxActiveDurationMs).toBeNull()
    expect(goalBudgetExtension(goal)).toEqual({ iterations: 8, activeDurationMs: 0, exhausted: true, stillExhausted: false })
    goal.usage.iterations = 1
    expect(goalBudgetExtension(goal).exhausted).toBe(false)
    goal.budget.maxActiveDurationMs = 7200000
    expect(goalBudgetExtension(goal)).toEqual({ iterations: 0, activeDurationMs: 0, exhausted: true, stillExhausted: false })
  })
})
