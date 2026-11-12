/**
 * Goal budget assertions and usage accounting. Carved verbatim from
 * agent-goal-runner.mjs (zero behavior change).
 */

import * as goalState from './agent-goal-state.mjs'
import { GOAL_BUDGET_HINT, requestError } from './goal-policy.mjs'


export function usageOnly(goal, { iterations = 0, durationMs = 0 } = {}) {
  // Accounting never bumps revision: the progress signature must reflect real
  // plan/evidence/summary movement, not bookkeeping.
  return {
    ...goal,
    usage: goalState.goalUsageWithRun(goal, { iterations, durationMs }),
    updatedAt: new Date().toISOString(),
  }
}

export function assertGoalBudget(goal) {
  const budget = goalState.goalBudgetExhausted(goal)
  if (budget.exhausted) {
    throw requestError(`Goal budget exhausted (${budget.reason}). ${GOAL_BUDGET_HINT}`, 409, 'GOAL_BUDGET_EXHAUSTED')
  }
}

export function budgetRemainingMs(goal) {
  return goal.budget.maxActiveDurationMs === null ? null : Math.max(0, goal.budget.maxActiveDurationMs - goal.usage.activeDurationMs)
}
