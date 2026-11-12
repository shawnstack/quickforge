import { describe, expect, it } from 'vitest'
import { createGoalState } from '../../server/agent-goal-state.mjs'
import { assertGoalBudget, budgetRemainingMs, usageOnly } from '../../server/goal-budget.mjs'

function goalWithBudget({
  iterations = 0,
  activeDurationMs = 0,
  maxIterations = 20,
  maxActiveDurationMs = null,
} = {}) {
  const goal = createGoalState({ sessionId: 'session-1', objective: 'Ship goal mode' })
  return {
    ...goal,
    budget: { maxIterations, maxActiveDurationMs },
    usage: { iterations, activeDurationMs },
  }
}

function catchBudgetError(goal) {
  try {
    assertGoalBudget(goal)
  } catch (error) {
    return error
  }
  return null
}

describe('usageOnly', () => {
  it('changes nothing by default and never bumps the revision', () => {
    const goal = goalWithBudget({ iterations: 3, activeDurationMs: 1_200 })
    const result = usageOnly(goal)
    expect(result.usage).toEqual({ iterations: 3, activeDurationMs: 1_200 })
    expect(result.revision).toBe(goal.revision)
    expect(result.updatedAt).toEqual(expect.any(String))
  })

  it('leaves the input goal untouched', () => {
    const goal = goalWithBudget({ iterations: 1, activeDurationMs: 500 })
    const frozen = JSON.parse(JSON.stringify(goal))
    usageOnly(goal, { iterations: 2, durationMs: 300 })
    expect(goal).toEqual(frozen)
  })

  it('accumulates iterations and duration across repeated accounting calls', () => {
    const once = usageOnly(goalWithBudget({ iterations: 1, activeDurationMs: 500 }), { iterations: 1, durationMs: 1_500 })
    const twice = usageOnly(once, { iterations: 2, durationMs: 500 })
    expect(twice.usage).toEqual({ iterations: 4, activeDurationMs: 2_500 })
  })

  it('truncates fractional iterations and clamps negative increments to zero', () => {
    const result = usageOnly(
      goalWithBudget({ iterations: 3, activeDurationMs: 1_000 }),
      { iterations: 1.9, durationMs: -99 },
    )
    expect(result.usage).toEqual({ iterations: 4, activeDurationMs: 1_000 })
    expect(usageOnly(goalWithBudget({ iterations: 3 }), { iterations: -10 }).usage.iterations).toBe(0)
  })
})

describe('assertGoalBudget', () => {
  it('passes while both budgets still have room, including one unit below the limit', () => {
    expect(() => assertGoalBudget(goalWithBudget({ iterations: 19, maxIterations: 20 }))).not.toThrow()
    expect(() => assertGoalBudget(goalWithBudget({
      iterations: 0,
      activeDurationMs: 59_999,
      maxActiveDurationMs: 60_000,
    }))).not.toThrow()
  })

  it('throws the documented conflict error exactly at the iteration boundary', () => {
    const error = catchBudgetError(goalWithBudget({ iterations: 5, maxIterations: 5 }))
    expect(error).toBeInstanceOf(Error)
    expect(error.statusCode).toBe(409)
    expect(error.errorCode).toBe('GOAL_BUDGET_EXHAUSTED')
    expect(error.message).toContain('iteration_budget')
    expect(error.message).toContain('extend_resume')
  })

  it('treats a null duration budget as unlimited', () => {
    expect(() => assertGoalBudget(goalWithBudget({
      iterations: 0,
      activeDurationMs: Number.MAX_SAFE_INTEGER,
      maxActiveDurationMs: null,
    }))).not.toThrow()
  })

  it('throws the duration conflict exactly at the duration boundary', () => {
    const error = catchBudgetError(goalWithBudget({
      activeDurationMs: 60_000,
      maxActiveDurationMs: 60_000,
    }))
    expect(error.errorCode).toBe('GOAL_BUDGET_EXHAUSTED')
    expect(error.message).toContain('duration_budget')
  })

  it('reports the iteration reason first when both budgets are exhausted', () => {
    const error = catchBudgetError(goalWithBudget({
      iterations: 5,
      activeDurationMs: 60_000,
      maxIterations: 5,
      maxActiveDurationMs: 60_000,
    }))
    expect(error.message).toContain('iteration_budget')
    expect(error.message).not.toContain('duration_budget')
  })
})

describe('budgetRemainingMs', () => {
  it('returns null when no duration budget is set', () => {
    expect(budgetRemainingMs(goalWithBudget({ maxActiveDurationMs: null }))).toBeNull()
  })

  it('returns the full budget before any active time is spent', () => {
    expect(budgetRemainingMs(goalWithBudget({ maxActiveDurationMs: 60_000 }))).toBe(60_000)
  })

  it('subtracts accumulated active time', () => {
    expect(budgetRemainingMs(goalWithBudget({ activeDurationMs: 10_000, maxActiveDurationMs: 60_000 }))).toBe(50_000)
  })

  it('never reports a negative remainder at or beyond the boundary', () => {
    expect(budgetRemainingMs(goalWithBudget({ activeDurationMs: 60_000, maxActiveDurationMs: 60_000 }))).toBe(0)
    expect(budgetRemainingMs(goalWithBudget({ activeDurationMs: 61_234, maxActiveDurationMs: 60_000 }))).toBe(0)
  })
})
