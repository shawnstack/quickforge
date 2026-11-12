/**
 * User-facing goal actions — handleGoalAction and the private action table
 * (confirm/pause/resume/extend/cancel/revise/accept), clearTerminalGoal, the
 * approval/ask/abort notification hooks and stopGoalForSession. Shared
 * waiters state is reached only through goal-waiters accessors. Carved
 * verbatim from agent-goal-runner.mjs (zero behavior change).
 */

import { runtimePendingToolCalls } from './agent-session-events.mjs'
import { getPendingApprovalForSession } from './approval-store.mjs'
import { getPendingAskForSession } from './ask-store.mjs'
import * as goalState from './agent-goal-state.mjs'
import { resolveGoalMaxIterations } from './goal-settings.mjs'
import { GOAL_BUDGET_HINT, requestError } from './goal-policy.mjs'
import { clearGoalTermination, goalStats, goalTerminationIntent, isGoalModeAvailable, markGoalTermination, resetGoalStats, resetGoalToolEvidence, withSessionGoalAdmission } from './goal-session-state.mjs'
import { deleteDurableTerminalGoal, getGoalCompletionWaiterSet, markGoalSessionStopped } from './goal-waiters.mjs'
import { assertGoalBudget } from './goal-budget.mjs'
import { commitGoal, scheduleGoalContinuation } from './goal-run-orchestration.mjs'


// ---------------------------------------------------------------------------
// User actions
// ---------------------------------------------------------------------------

function assertQuiescent(session) {
  if (session.agent?.state?.isStreaming || session.abortPending) {
    throw requestError('The session is still running. Pause it or wait for it to finish.', 409, 'GOAL_SESSION_BUSY')
  }
  if (session.goalRun) {
    throw requestError('A goal run is still finishing. Try again in a moment.', 409, 'GOAL_SESSION_BUSY')
  }
  if (runtimePendingToolCalls(session).length || getPendingApprovalForSession(session.sessionId)) {
    throw requestError('A tool call is still pending. Resolve it before changing the goal.', 409, 'GOAL_SESSION_BUSY')
  }
  if (getPendingAskForSession(session.sessionId)) {
    throw requestError('A question is still waiting for your answer.', 409, 'GOAL_SESSION_BUSY')
  }
}

export async function handleGoalAction(session, action, objective, requestSource = null, options = {}) {
  if (!session) throw requestError('Session not found', 404, 'SESSION_NOT_FOUND')
  if (!isGoalModeAvailable(session, requestSource)) {
    throw requestError('Goal mode is not available for this session.', 409, 'GOAL_UNAVAILABLE')
  }
  const current = session.goal
  if (!current) throw requestError('This session has no goal.', 404, 'GOAL_NOT_FOUND')
  switch (action) {
    case 'confirm':
      return confirmGoal(session, current)
    case 'pause':
      return pauseGoal(session, current)
    case 'resume':
      return resumeGoal(session, current)
    case 'extend_resume':
      return extendResumeGoal(session, options)
    case 'cancel':
      return cancelGoal(session, current)
    case 'revise':
      return reviseGoal(session, current, objective)
    case 'accept':
      return acceptGoal(session, current)
    default:
      throw requestError(`Unsupported goal action: ${action}`, 400, 'GOAL_ACTION_INVALID')
  }
}

async function extendResumeGoal(session, options) {
  if (typeof options.goalId !== 'string' || !options.goalId.trim()
    || !Number.isSafeInteger(options.expectedRevision) || options.expectedRevision <= 0
    || Object.keys(options).some((key) => !['action', 'goalId', 'expectedRevision'].includes(key))) {
    throw requestError('extend_resume requires goalId and a positive integer expectedRevision only.', 400, 'GOAL_ACTION_INVALID')
  }
  let kind
  await withSessionGoalAdmission(session, async () => {
    const goal = session.goal
    if (goal?.id !== options.goalId || goal?.revision !== options.expectedRevision) {
      throw requestError('The goal changed. Refresh before trying again.', 409, 'GOAL_REVISION_CONFLICT')
    }
    if (!goalState.goalCanResume(goal.status)) {
      throw requestError(`Cannot extend a goal in status ${goal.status}.`, 409, 'GOAL_ACTION_INVALID')
    }
    assertQuiescent(session)
    if (session.goalRunSettling || session.goalContinuationPending || session.activePromptPromise) {
      throw requestError('A goal run is still finishing.', 409, 'GOAL_SESSION_BUSY')
    }
    if (!goalState.goalBudgetExhausted(goal).exhausted) {
      throw requestError('Goal budget is not exhausted. Use resume instead.', 409, 'GOAL_BUDGET_NOT_EXHAUSTED')
    }
    // Each extension adds one full settings-configured tranche (default budget).
    const extendBy = await resolveGoalMaxIterations()
    const budget = { ...goal.budget }
    if (goal.usage.iterations >= budget.maxIterations) budget.maxIterations += extendBy
    budget.maxActiveDurationMs = null
    const exhausted = goalState.goalBudgetExhausted({ ...goal, budget })
    const status = exhausted.exhausted ? 'paused' : goalResumeStatus(goal)
    const next = exhausted.exhausted
      ? goalState.setGoalStatus(goal, 'paused', { budget, blocker: exhausted.reason, blockerHint: GOAL_BUDGET_HINT })
      : goalState.clearGoalBlocker(goal, { budget, status, planConfirmed: status === 'running' })
    await commitGoal(session, next, { revertOnFailure: true })
    kind = status === 'planning' ? 'planning' : status === 'running' ? 'execution' : null
    resetGoalStats(session)
  })
  if (kind) scheduleGoalContinuation(session, kind)
  return session.goal
}

async function confirmGoal(session, goal) {
  if (!goalState.goalCanConfirm(goal.status)) {
    throw requestError(`Cannot confirm a goal in status ${goal.status}.`, 409, 'GOAL_ACTION_INVALID')
  }
  assertQuiescent(session)
  await withSessionGoalAdmission(session, async () => {
    // Re-check under the session lock: a concurrent action may have moved the
    // goal (or cancelled it) while we waited for admission.
    if (!goalState.goalCanConfirm(session.goal?.status)) {
      throw requestError(`Cannot confirm a goal in status ${session.goal?.status ?? goal.status}.`, 409, 'GOAL_ACTION_INVALID')
    }
    assertQuiescent(session)
    const resumed = withUnlimitedTime(session.goal)
    assertGoalBudget(resumed)
    resetGoalStats(session)
    const next = goalState.clearGoalBlocker(resumed, { status: 'running', planConfirmed: true })
    await commitGoal(session, next, { revertOnFailure: true })
  })
  scheduleGoalContinuation(session, 'execution')
  return session.goal
}

async function pauseGoal(session, goal) {
  if (!goalState.goalCanPause(goal.status) && goal.status !== 'pausing') {
    throw requestError(`Cannot pause a goal in status ${goal.status}.`, 409, 'GOAL_ACTION_INVALID')
  }
  if (goal.status === 'paused') return goal
  goalStats(session).pauseRequested = true
  const busy = Boolean(session.agent?.state?.isStreaming || session.abortPending || session.goalRun)
  const next = goalState.setGoalStatus(goal, busy ? 'pausing' : 'paused')
  await commitGoal(session, next, { revertOnFailure: true })
  return session.goal
}

function withUnlimitedTime(goal) {
  return { ...goal, budget: { ...goal.budget, maxActiveDurationMs: null } }
}

function goalResumeStatus(goal) {
  if (!goal.criteria.length) return 'planning'
  return 'running'
}

async function resumeGoal(session, goal) {
  if (!goalState.goalCanResume(goal.status)) {
    throw requestError(`Cannot resume a goal in status ${goal.status}.`, 409, 'GOAL_ACTION_INVALID')
  }
  assertQuiescent(session)
  const budget = goalState.goalBudgetExhausted(withUnlimitedTime(goal))
  if (budget.exhausted) {
    // Resuming would burn the next round and immediately pause again. The
    // accumulated usage is never reset (revise must not bypass the budget).
    throw requestError(
      `Goal budget exhausted (${budget.reason}). ${GOAL_BUDGET_HINT}`,
      409,
      'GOAL_BUDGET_EXHAUSTED',
    )
  }
  let status
  await withSessionGoalAdmission(session, async () => {
    if (!goalState.goalCanResume(session.goal?.status)) {
      throw requestError(`Cannot resume a goal in status ${session.goal?.status ?? goal.status}.`, 409, 'GOAL_ACTION_INVALID')
    }
    assertQuiescent(session)
    const resumed = withUnlimitedTime(session.goal)
    assertGoalBudget(resumed)
    resetGoalStats(session)
    status = goalResumeStatus(resumed)
    await commitGoal(session, goalState.clearGoalBlocker(resumed, { status, planConfirmed: status === 'running' }), { revertOnFailure: true })
  })
  if (status !== 'awaiting_confirmation') scheduleGoalContinuation(session, status === 'planning' ? 'planning' : 'execution')
  return session.goal
}

/**
 * Explicit user acceptance of a needs_review goal. The model can never call
 * this; only the user-facing API reaches it. Criteria that still need human
 * judgement are accepted with persisted human evidence, while failed required
 * criteria block acceptance (the user must resume execution and fix them).
 */
async function acceptGoal(session, goal) {
  if (goal.status !== 'needs_review') {
    throw requestError(`Accept requires a goal in needs_review; current status is ${goal.status}.`, 409, 'GOAL_ACTION_INVALID')
  }
  assertQuiescent(session)
  const accepted = goalState.applyHumanAcceptance(goal)
  if (accepted.errors.length > 0) {
    throw requestError(
      `${accepted.errors.join('; ')}. Resume the goal to fix them instead.`,
      409,
      'GOAL_ACCEPT_BLOCKED',
    )
  }
  await commitGoal(session, accepted.goal, { revertOnFailure: true })
  return session.goal
}

async function cancelGoal(session, goal) {
  if (goalState.isGoalTerminalStatus(goal.status)) return goal
  const stats = goalStats(session)
  const previousPauseRequested = stats.pauseRequested
  const previousIntent = goalTerminationIntent(session)
  const previousGeneration = session.goalAbortGeneration || 0
  stats.pauseRequested = true
  // Record the terminal intent before committing so an in-flight settlement
  // (abort or run-end) can observe it and is refused from overwriting the
  // cancelled state with paused/running. The generation bump also makes that
  // settlement skip its continuation.
  markGoalTermination(session, 'cancel')
  // Fail closed: the run/watchdog are only torn down after the cancelled state
  // is durable. If the persist fails the goal stays active with its live run,
  // and the user can simply retry cancel instead of being stuck.
  try {
    await commitGoal(session, goalState.setGoalStatus(goal, 'cancelled'), { revertOnFailure: true })
  } catch (error) {
    // Roll the intent back: the goal is still active and must keep running, so a
    // later settlement must not treat this as a user termination.
    session.goalTerminationKind = previousIntent
    session.goalAbortGeneration = previousGeneration
    stats.pauseRequested = previousPauseRequested
    throw error
  }
  const run = session.goalRun
  if (run?.watchdog) clearTimeout(run.watchdog)
  session.goalRun = null
  session.goalContinuationPending = false
  try {
    session.agent?.abort?.()
  } catch {
    // best effort: the goal is already cancelled and cannot continue
  }
  return session.goal
}

async function reviseGoal(session, goal, objective) {
  const text = typeof objective === 'string' ? objective.trim() : ''
  if (!text) throw requestError('A revised goal requires a new objective.', 400, 'GOAL_OBJECTIVE_REQUIRED')
  if (text.length > goalState.GOAL_MAX_OBJECTIVE_CHARS) {
    throw requestError(`Goal objective must be at most ${goalState.GOAL_MAX_OBJECTIVE_CHARS} characters.`, 400, 'GOAL_OBJECTIVE_REQUIRED')
  }
  if (!goalState.isGoalEditableStatus(goal.status)) {
    throw requestError(`Revise requires a quiescent goal (awaiting_confirmation, paused or blocked); current status is ${goal.status}.`, 409, 'GOAL_ACTION_INVALID')
  }
  assertQuiescent(session)
  await withSessionGoalAdmission(session, async () => {
    if (!goalState.isGoalEditableStatus(session.goal?.status)) {
      throw requestError(`Revise requires a quiescent goal (awaiting_confirmation, paused or blocked); current status is ${session.goal?.status ?? goal.status}.`, 409, 'GOAL_ACTION_INVALID')
    }
    assertQuiescent(session)
    const revised = withUnlimitedTime(session.goal)
    assertGoalBudget(revised)
    resetGoalStats(session)
    // Replanning is read-only; cumulative iteration usage is preserved.
    await commitGoal(session, goalState.resetGoalPlan(revised, text), { revertOnFailure: true })
  })
  resetGoalToolEvidence(session)
  scheduleGoalContinuation(session, 'planning')
  return session.goal
}

/** A finished goal stops occupying the card once the user moves on. */
export async function clearTerminalGoal(session) {
  const goal = session?.goal
  if (!goal || !goalState.isGoalTerminalStatus(goal.status)) return false
  await commitGoal(session, null)
  clearGoalTermination(session)
  return true
}

// ---------------------------------------------------------------------------
// Approval / ask / abort hooks (existing mechanisms, goal-aware status only)
// ---------------------------------------------------------------------------

function goalRunStatusTarget(session) {
  const goal = session?.goal
  if (!goal || !session.goalRun) return null
  if (goal.status !== 'running' && goal.status !== 'verifying') return null
  return goal
}

export async function notifyGoalApprovalRequested(session) {
  const goal = goalRunStatusTarget(session)
  if (!goal) return
  await commitGoal(session, goalState.setGoalStatus(goal, 'awaiting_approval'))
}

export async function notifyGoalApprovalOutcome(session, { outcome } = {}) {
  const goal = session?.goal
  if (!goal || !session.goalRun) return
  if (outcome === 'approved') {
    if (goal.status !== 'awaiting_approval') return
    await commitGoal(session, goalState.setGoalStatus(goal, 'running'))
    return
  }
  if (outcome === 'rejected' || outcome === 'timeout') {
    goalStats(session).pauseRequested = true
    const blocker = outcome === 'timeout' ? 'approval_timeout' : 'approval_rejected'
    await commitGoal(session, goalState.setGoalStatus(goal, 'paused', { blocker }))
  }
  // 'aborted' is settled by the run-end hook (user_aborted).
}

export async function notifyGoalAskRequested(session) {
  const goal = goalRunStatusTarget(session)
  if (!goal) return
  await commitGoal(session, goalState.setGoalStatus(goal, 'awaiting_input'))
}

export async function notifyGoalAskOutcome(session, { skipped = false } = {}) {
  const goal = session?.goal
  if (!goal || !session.goalRun) return
  if (skipped) {
    goalStats(session).pauseRequested = true
    await commitGoal(session, goalState.setGoalStatus(goal, 'paused', { blocker: 'ask_skipped' }))
    return
  }
  if (goal.status === 'awaiting_input') await commitGoal(session, goalState.setGoalStatus(goal, 'running'))
}

/**
 * User pressed stop / aborted the run: pause instead of continuing. A
 * continuation may be scheduled but not started yet (goalRun is null during the
 * idle-wait window); abort must still stop it, so pauseRequested is set and the
 * goal is settled to paused without a run to wait for.
 */
export async function notifyGoalAbort(session) {
  const goal = session?.goal
  if (!goal || goalState.isGoalTerminalStatus(goal.status)) return
  const hadRun = Boolean(session.goalRun)
  const pendingContinuation = Boolean(session.goalContinuationPending)
  const settling = Boolean(session.goalRunSettling)
  if (!hadRun && !pendingContinuation && !settling) return
  goalStats(session).pauseRequested = true
  // Record the abort intent and bump the generation so a settlement already
  // awaiting its final persist can observe the abort, refuse to schedule the
  // next round, and settle with a truthful `user_aborted` blocker.
  markGoalTermination(session, 'abort')
  if (settling) return
  if (hadRun) {
    if (goal.status === 'pausing') return
    await commitGoal(session, goalState.setGoalStatus(goal, 'pausing'))
    return
  }
  // No run to settle: go straight to paused so the pending continuation cannot
  // start a new round.
  session.goalContinuationPending = false
  await commitGoal(session, goalState.setGoalStatus(goal, 'paused', { blocker: 'user_aborted' }))
}

/** destroyAgent: drop runtime-only goal bookkeeping without touching storage. */
export function stopGoalForSession(session) {
  if (!session) return
  markGoalSessionStopped(session)
  for (const dispose of getGoalCompletionWaiterSet(session.sessionId) || []) dispose()
  deleteDurableTerminalGoal(session)
  const run = session.goalRun
  if (run?.watchdog) clearTimeout(run.watchdog)
  session.goalRun = null
  session.goalRunSettling = false
  session.goalContinuationPending = false
  session.goalTerminationKind = null
  session.goalStats = null
  session.goalTrustedToolCalls = null
}
