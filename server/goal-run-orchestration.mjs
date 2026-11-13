/**
 * Goal run orchestration — the injected runnerDeps handle, commit barriers
 * (commitGoal / commitSettledGoal), run lifecycle (begin / finish / fail /
 * continue), the continuation scheduler and /goal admission. This module is
 * the sole owner of runnerDeps. Carved verbatim from agent-goal-runner.mjs
 * (zero behavior change).
 */

import { logger } from './utils/logger.mjs'
import { emitSessionEvent, runtimePendingToolCalls } from './agent-session-events.mjs'
import { persistSession } from './agent-persistence.mjs'
import { getPendingApprovalForSession } from './approval-store.mjs'
import { getPendingAskForSession } from './ask-store.mjs'
import { agentSessions } from './agent-session-store.mjs'
import * as goalState from './agent-goal-state.mjs'
import { resolveGoalMaxIterations } from './goal-settings.mjs'
import { GOAL_BUDGET_HINT, GOAL_PLANNING_PERMISSIONS, MAX_CONSECUTIVE_GOAL_FAILURES, MAX_GOAL_NO_PROGRESS_RUNS, MAX_GOAL_PLANNING_ATTEMPTS, requestError } from './goal-policy.mjs'
import { clearGoalTermination, goalStats, goalTerminationIntent, isGoalModeAvailable, resetGoalStats, resetGoalToolEvidence, withSessionGoalAdmission, waitForGoalIdle } from './goal-session-state.mjs'
import { hasGoalCompletionWaiter, recordDurableGoal } from './goal-waiters.mjs'
import { assertGoalBudget, budgetRemainingMs, usageOnly } from './goal-budget.mjs'
import { continuationVisibleText, goalContinuationPrompt, goalPlanningPrompt, planningVisibleText } from './goal-prompts.mjs'


// agent-manager injects the per-session turn-id helpers so this module never
// has to import the manager (no cycle, no extra manager exports).
let runnerDeps = {
  beginTurn: () => null,
  endTurn: () => {},
  refreshTools: async () => {},
  refreshRuntime: async () => {},
  syncMessages: () => {},
}

export function configureGoalRunner(deps = {}) {
  runnerDeps = { ...runnerDeps, ...deps }
}

function emitGoalUpdated(session) {
  // emitSessionEvent stamps stateVersion (and sessionId on the global bus).
  emitSessionEvent(session, { type: 'goal_updated', sessionId: session.sessionId, goal: session.goal || null })
}

/**
 * Commit a goal transition. `revertOnFailure` is for user-triggered API
 * actions: when the authoritative persist fails we roll memory back and report
 * the failure instead of pretending the action succeeded. Internal run
 * transitions keep the new (safe) state and simply never continue.
 */
export async function commitGoal(session, nextGoal, { revertOnFailure = false, forceMessagesReplace = false } = {}) {
  const previous = session.goal
  // Cancel is terminal and must never be overwritten by an older settlement that
  // captured a running/paused snapshot before the cancel arrived. Clearing the
  // goal (null) and committing another terminal state stay allowed; a fresh goal
  // resets the intent before it commits (see startGoalPlanning / beginGoalRun).
  if (session.goalTerminationKind === 'cancel'
    && nextGoal && nextGoal.status !== 'cancelled') {
    return false
  }
  const wasActive = Boolean(previous && goalState.isGoalActiveStatus(previous.status))
  const isActive = Boolean(nextGoal && goalState.isGoalActiveStatus(nextGoal.status))
  session.goal = nextGoal
  const markerChanged = markGoalIteration(session, nextGoal)
  let persisted = null
  try {
    persisted = markerChanged || forceMessagesReplace
      ? await persistSession(session, { forceMessagesReplace: true })
      : await persistSession(session)
  } catch (error) {
    logger.error(`Failed to persist goal for session ${session.sessionId}:`, error, { sessionId: session.sessionId })
  }
  if (!persisted) {
    logger.warn(`Goal transition for session ${session.sessionId} was not persisted; failing closed`, { sessionId: session.sessionId })
    if (revertOnFailure) {
      if (session.goal === nextGoal) session.goal = previous
      throw requestError('Failed to persist the goal. Try again.', 503, 'SESSION_PERSIST_FAILED')
    }
    if (session.goalSettlingRun && session.goal === nextGoal && !goalState.isGoalTerminalStatus(nextGoal?.status)) {
      session.goal = goalState.setGoalStatus(nextGoal, 'paused', { blocker: 'persist_failed' })
      const fallbackMarkerChanged = markGoalIteration(session, session.goal)
      try { await persistSession(session, { forceMessagesReplace: fallbackMarkerChanged || forceMessagesReplace }) } catch { /* best effort; never continue */ }
      runnerDeps.syncMessages(session)
    }
    emitGoalUpdated(session)
    return false
  }
  recordDurableGoal(session, nextGoal)
  if (wasActive !== isActive) {
    try {
      await runnerDeps.refreshTools(session)
    } catch (error) {
      logger.warn(`Failed to refresh tools after goal change for session ${session.sessionId}: ${error?.message || error}`)
    }
  }
  emitGoalUpdated(session)
  if (session.goalSettlingRun || (nextGoal?.status === 'cancelled' && session.goalRun)) runnerDeps.syncMessages(session)
  return true
}

function markGoalIteration(session, goal, messages = session.agent?.state?.messages) {
  const run = session.goalSettlingRun || (goal?.status === 'cancelled' ? session.goalRun : null)
  if (!['planning', 'execution'].includes(run?.kind) || !Array.isArray(messages)) return false
  let anchor = -1
  for (let index = messages.length - 1; index >= run.messageStart; index--) {
    if (messages[index]?.role === 'assistant') { anchor = index; break }
    if (anchor < 0 && messages[index]?.role === 'user') anchor = index
  }
  if (anchor < 0) return false
  const message = messages[anchor]
  messages[anchor] = { ...message, details: {
    ...message.details,
    quickforgeGoalIteration: {
      goalId: run.goalId, kind: run.kind, iteration: run.iteration,
      outcome: run.failed && ['running', 'verifying'].includes(goal.status) ? 'error' : goal.status,
      blocker: goal.blocker || null, finishedAt: Date.now(),
    },
  } }
  return true
}

// Planning success and completion share the same private snapshot barrier.
async function commitSettledGoal(session, next, abortGeneration) {
  const previous = session.goal
  const canSettle = () => session.goal === previous
    && (session.goalAbortGeneration || 0) === abortGeneration
    && !session.abortPending && !goalStats(session).pauseRequested
    && !goalTerminationIntent(session)
  if (!canSettle()) { await settleGoalTermination(session); return false }
  // Capture array identity, length and item identities separately from the staged
  // marker. Never clone message bodies or replay a stale transcript over live edits.
  const liveMessages = session.agent?.state?.messages
  const snapshot = [...(liveMessages || [])]
  const messagesUnchanged = () => session.agent?.state?.messages === liveMessages
    && (liveMessages?.length || 0) === snapshot.length
    && snapshot.every((message, index) => liveMessages[index] === message)
  const canPersist = () => canSettle() && messagesUnchanged()
  // Keep the live goal active throughout I/O: abort/cancel still have authority.
  const messages = [...snapshot]
  const markerChanged = markGoalIteration(session, next, messages)
  let persisted = null
  try { persisted = await persistSession(session, { goal: next, messages, canPersist, forceMessagesReplace: markerChanged }) } catch (error) {
    logger.error(`Failed to persist settled goal for session ${session.sessionId}:`, error)
  }
  if (!canSettle()) { await settleGoalTermination(session); return false }
  if (!messagesUnchanged()) {
    // A concurrent message writer invalidated the staged pair. Pause once and
    // force-save only the current live history (even after a clear/no anchor).
    await commitGoal(session, goalState.setGoalStatus(session.goal, 'paused', { blocker: 'persist_failed' }), { forceMessagesReplace: true })
    return false
  }
  if (!persisted) {
    await pauseGoalWithBlocker(session, 'persist_failed', previous)
    return false
  }
  session.goal = next
  session.agent.state.messages = messages
  recordDurableGoal(session, next)
  try {
    await runnerDeps.refreshTools(session)
  } catch (error) {
    logger.warn(`Failed to refresh tools after goal change for session ${session.sessionId}: ${error?.message || error}`)
  }
  emitGoalUpdated(session)
  runnerDeps.syncMessages(session)
  return true
}

// ---------------------------------------------------------------------------
// Starting / finishing runs
// ---------------------------------------------------------------------------

/**
 * Mark a goal run as in flight. Called by runPrompt for the initial planning
 * run and by the continuation scheduler for every later round.
 */
export function beginGoalRun(session, kind = 'execution') {
  if (!session?.goal) return null
  if (session.goalRun) return session.goalRun
  assertGoalBudget(session.goal)
  // A fresh run clears any termination intent left by a previous abort/pause;
  // the generation counter is only meaningful within a single settlement.
  clearGoalTermination(session)
  const goal = session.goal
  if (kind === 'execution') session.goal = usageOnly(goal, { iterations: 1 })
  const run = {
    kind,
    startedAt: Date.now(),
    signature: goalState.goalProgressSignature(session.goal),
    watchdog: null,
    goalId: goal.id,
    iteration: session.goal.usage.iterations,
    messageStart: session.agent?.state?.messages?.length || 0,
  }
  const remaining = budgetRemainingMs(session.goal)
  if (remaining > 0) {
    run.watchdog = setTimeout(() => {
      void handleBudgetTimeout(session, run)
    }, remaining)
    run.watchdog.unref?.()
  }
  session.goalRun = run
  return run
}

async function handleBudgetTimeout(session, run) {
  if (session.goalRun !== run) return
  const goal = session.goal
  if (!goal || !goalState.isGoalActiveStatus(goal.status)) return
  goalStats(session).pauseRequested = true
  logger.warn(`Goal for session ${session.sessionId} exceeded its active-duration budget; pausing`, { sessionId: session.sessionId })
  await commitGoal(session, goalState.setGoalStatus(goal, 'pausing', { blocker: 'duration_budget', blockerHint: GOAL_BUDGET_HINT }))
  try {
    session.agent?.abort?.()
  } catch {
    // best effort: the run-end hook still settles the goal to paused
  }
}

export function scheduleGoalContinuation(session, kind) {
  if (session.goalContinuationPending) return
  session.goalContinuationPending = true
  setImmediate(() => {
    void (async () => {
      try {
        const idle = await waitForGoalIdle(session)
        session.goalContinuationPending = false
        if (!idle) {
          await pauseGoalWithBlocker(session, 'run_did_not_finish')
          return
        }
        if (!canStartGoalRun(session, kind)) return
        await startGoalRun(session, kind)
      } catch (error) {
        session.goalContinuationPending = false
        logger.error(`Failed to continue goal for session ${session.sessionId}:`, error, { sessionId: session.sessionId })
        await pauseGoalWithBlocker(session, 'continuation_failed')
      }
    })()
  })
}

function canStartGoalRun(session, kind) {
  if (agentSessions.get(session.sessionId) !== session) return false
  const goal = session.goal
  if (!goal) return false
  if (goalState.goalBudgetExhausted(goal).exhausted) return false
  if (goalStats(session).pauseRequested) return false
  if (kind === 'planning') {
    if (goal.status !== 'planning') return false
  } else if (goal.status !== 'running' && goal.status !== 'verifying') {
    return false
  }
  if (session.agent?.state?.isStreaming || session.abortPending || session.goalRun) return false
  if (runtimePendingToolCalls(session).length) return false
  if (getPendingApprovalForSession(session.sessionId) || getPendingAskForSession(session.sessionId)) return false
  return true
}

async function startGoalRun(session, kind) {
  if (!canStartGoalRun(session, kind)) return false
  const run = beginGoalRun(session, kind)
  if (!run) return false
  const round = session.goal.usage.iterations
  const planning = kind === 'planning'
  const promptText = planning ? goalPlanningPrompt(session.goal) : goalContinuationPrompt(session.goal, round, session.goal.budget.maxIterations)
  const previous = {
    name: session.activeCommandName,
    permissions: session.activeCommandPermissions,
    prompt: session.activeCommandPrompt,
  }
  // Token ownership: a stale run's cleanup (e.g. the previous runPrompt finally
  // racing an immediately-resolved persist flush) must not wipe this round.
  session.activeCommandName = planning ? 'plan' : 'goal'
  session.activeCommandPermissions = planning ? { ...GOAL_PLANNING_PERMISSIONS } : null
  session.activeCommandPrompt = promptText
  session.activeCommandToken = run
  const turnId = runnerDeps.beginTurn(session.sessionId)
  logger.info(`Starting goal ${kind} run for session ${session.sessionId} (round ${round}/${session.goal.budget.maxIterations})`, {
    sessionId: session.sessionId,
    kind,
    round,
  })
  let promptPromise = null
  try {
    // Goal rounds call agent.prompt directly (not runPrompt), so the same
    // turn-boundary reconciliation has to happen here: a settings change made
    // while the goal was waiting must reach this round, not a later one.
    await runnerDeps.refreshRuntime(session)
    promptPromise = session.agent.prompt({
      role: 'user',
      content: planning ? planningVisibleText(Math.max(1, goalStats(session).planningAttempts + 1)) : continuationVisibleText(round, session.goal.budget.maxIterations),
      timestamp: Date.now(),
      metadata: { quickforgeGoalRun: kind },
    })
    // Explicit settle barrier: run settlement waits for this promise instead of
    // assuming the async persist flush ordered the cleanup for us.
    session.activePromptPromise = promptPromise
    await promptPromise
  } catch (error) {
    logger.error(`Goal ${kind} run failed to start for session ${session.sessionId}:`, error, { sessionId: session.sessionId })
    await settleGoalRunSafely(session, { status: 'error', error: error?.message || String(error) })
  } finally {
    if (session.activePromptPromise === promptPromise) session.activePromptPromise = null
    runnerDeps.endTurn(session.sessionId, turnId)
    if (session.activeCommandToken === run) {
      session.activeCommandName = previous.name
      session.activeCommandPermissions = previous.permissions
      session.activeCommandPrompt = previous.prompt
      session.activeCommandToken = null
    }
  }
  return true
}

async function pauseGoalWithBlocker(session, blocker, nextGoal = null, blockerHint = undefined) {
  const goal = nextGoal || session.goal
  if (!goal || goalState.isGoalTerminalStatus(goal.status)) return false
  return commitGoal(session, goalState.setGoalStatus(goal, 'paused', {
    blocker,
    ...(blockerHint ? { blockerHint } : {}),
  }))
}

/**
 * Settle a goal run whose start path threw (e.g. the prompt promise rejected)
 * without going through the manager's agent_end hook. The run must still be
 * persisted first; an unpersisted final state pauses the goal (fail closed)
 * instead of leaving a stuck `goalRun` behind.
 */
async function settleGoalRunSafely(session, info) {
  if (!session.goalRun) return
  let persisted = null
  try {
    persisted = await persistSession(session)
  } catch (error) {
    logger.error(`Failed to persist goal run settlement for session ${session.sessionId}:`, error, { sessionId: session.sessionId })
  }
  if (!persisted) {
    await failGoalRunOnPersist(session)
    return
  }
  await finishGoalRun(session, info)
}

/**
 * Commit the run's final state and, only when no abort arrived while that
 * persist was in flight, schedule the next round. `finishGoalRun` has already
 * cleared `goalRun`/`goalContinuationPending`, so without this generation check
 * a user abort during the persist await would be invisible and the goal would
 * keep running after the user stopped it.
 */
async function commitGoalAndContinue(session, next, kind, abortGeneration) {
  const planningSuccess = session.goalSettlingRun?.kind === 'planning' && next.status === 'running'
  const persisted = planningSuccess
    ? await commitSettledGoal(session, next, abortGeneration)
    : await commitGoal(session, next)
  if (!persisted) return false
  if ((session.goalAbortGeneration || 0) !== abortGeneration) {
    // A termination (abort or cancel) arrived while the persist was in flight:
    // settle to the user's intent and never schedule another round.
    await settleGoalTermination(session)
    return false
  }
  scheduleGoalContinuation(session, kind)
  return true
}

/**
 * Apply the recorded termination intent. `cancel` is terminal and wins over
 * `abort`; abort pauses with a truthful `user_aborted` blocker. Idempotent: a
 * goal already at its intended terminal/paused state is left untouched, so this
 * never re-persists over the user's decision.
 */
async function settleGoalTermination(session) {
  const goal = session.goal
  if (!goal) return
  if (goalTerminationIntent(session) === 'cancel') {
    if (goal.status === 'cancelled') return
    await commitGoal(session, goalState.setGoalStatus(goal, 'cancelled'))
    return
  }
  if (goalState.isGoalTerminalStatus(goal.status)) return
  goalStats(session).pauseRequested = false
  await commitGoal(session, goalState.setGoalStatus(goal, 'paused', { blocker: 'user_aborted' }))
}

/**
 * Run-end hook. Must be called only after the run truly finished AND the final
 * session state was persisted (the manager awaits flushSessionPersist first).
 */
export async function finishGoalRun(session, info = {}) {
  const run = session.goalRun
  if (!run) return
  const abortGeneration = session.goalAbortGeneration || 0
  session.goalRun = null
  // Close the settlement window: goalRun is already gone, so a user abort
  // arriving while the final state persists must still be observable.
  session.goalRunSettling = true
  session.goalSettlingRun = run
  if (run.watchdog) clearTimeout(run.watchdog)
  try {
    const current = session.goal
    if (!current) return

    const stats = goalStats(session)
    const durationMs = Math.max(0, Date.now() - run.startedAt)
    const next = usageOnly(current, { durationMs })

    if (goalState.isGoalTerminalStatus(next.status)) {
      await commitGoal(session, next)
      return
    }
    const endStatus = info.status || 'idle'
    if (endStatus === 'aborted' || session.abortPending) {
      // A user stop keeps any explicit blocker (budget/approval) and otherwise
      // records the abort reason; either way the goal pauses.
      stats.pauseRequested = false
      await commitGoal(session, goalState.setGoalStatus(next, 'paused', {
        blocker: next.blocker || 'user_aborted',
        ...(next.blockerHint ? { blockerHint: next.blockerHint } : {}),
      }))
      return
    }
    if (stats.pauseRequested || next.status === 'pausing') {
      stats.pauseRequested = false
      // A pause requested by an abort (rather than the pause button) must still
      // record `user_aborted` even when the run itself ended with an error and
      // carried no explicit blocker. Cancel is handled by the commit guard: the
      // goal is already terminal and this commit is refused.
      const abortIntent = goalTerminationIntent(session) === 'abort'
      await commitGoal(session, goalState.setGoalStatus(next, 'paused', {
        ...(next.blocker ? { blocker: next.blocker } : (abortIntent ? { blocker: 'user_aborted' } : {})),
        ...(next.blockerHint ? { blockerHint: next.blockerHint } : {}),
      }))
      return
    }
    const exhausted = goalState.goalBudgetExhausted(next)
    // Duration is a hard deadline; iteration usage only gates another round.
    // In particular, a verified success on the last admitted round may complete.
    if (next.budget.maxActiveDurationMs !== null && next.usage.activeDurationMs >= next.budget.maxActiveDurationMs) {
      await pauseGoalWithBlocker(session, 'duration_budget', next, GOAL_BUDGET_HINT)
      return
    }
    // A verification hand-off must not turn an error/question into an automatic retry.
    if (run.verificationBlocker) {
      await commitGoal(session, goalState.setGoalStatus(next, 'blocked', { blocker: run.verificationBlocker }))
      return
    }
    if (endStatus === 'error' || info.error) {
      if (run.kind === 'planning' && next.status === 'awaiting_confirmation') {
        await pauseGoalWithBlocker(session, 'planning_failed', next)
        return
      }
      run.failed = true
      stats.consecutiveFailures += 1
      stats.noProgressRuns += 1
      if (exhausted.exhausted) {
        await pauseGoalWithBlocker(session, exhausted.reason, next, GOAL_BUDGET_HINT)
        return
      }
      if (stats.consecutiveFailures >= MAX_CONSECUTIVE_GOAL_FAILURES) {
        await pauseGoalWithBlocker(session, 'repeated_failures', next)
        return
      }
      await commitGoalAndContinue(session, next, run.kind, abortGeneration)
      return
    }
    stats.consecutiveFailures = 0
    if (run.pendingDisposition) {
      const disposition = goalState.clearGoalBlocker(next, { status: run.pendingDisposition })
      if (run.pendingDisposition === 'completed') {
        if (!goalState.goalCompletionCheck(next).ok) {
          await pauseGoalWithBlocker(session, 'verification_failed', next)
          return
        }
        await commitSettledGoal(session, disposition, abortGeneration)
      } else {
        await commitGoal(session, disposition)
      }
      return
    }

    if (exhausted.exhausted) {
      await pauseGoalWithBlocker(session, exhausted.reason, next, GOAL_BUDGET_HINT)
      return
    }

    if (run.kind === 'planning' && next.status === 'planning') {
      stats.planningAttempts += 1
      if (stats.planningAttempts >= MAX_GOAL_PLANNING_ATTEMPTS) {
        await pauseGoalWithBlocker(session, 'planning_incomplete', next)
        return
      }
      await commitGoalAndContinue(session, next, 'planning', abortGeneration)
      return
    }

    // A submitted plan stays read-only until this normal, persisted run end.
    if (run.kind === 'planning' && next.status === 'awaiting_confirmation') {
      stats.planningAttempts = 0
      await commitGoalAndContinue(session, goalState.clearGoalBlocker(next, {
        status: 'running', planConfirmed: true,
        budget: { ...next.budget, maxActiveDurationMs: null },
      }), 'execution', abortGeneration)
      return
    }

    // Waiting states and hand-offs stop the loop.
    if (next.status === 'awaiting_confirmation' || next.status === 'needs_review' || next.status === 'blocked'
      || next.status === 'paused' || next.status === 'awaiting_input' || next.status === 'awaiting_approval') {
      if (next.status === 'awaiting_confirmation') stats.planningAttempts = 0
      await commitGoal(session, next)
      return
    }

    if (goalState.goalProgressSignature(next) === run.signature) stats.noProgressRuns += 1
    else stats.noProgressRuns = 0
    if (stats.noProgressRuns >= MAX_GOAL_NO_PROGRESS_RUNS) {
      await pauseGoalWithBlocker(session, 'no_progress', next)
      return
    }
    await commitGoalAndContinue(session, next, 'execution', abortGeneration)
  } finally {
    session.goalSettlingRun = null
    session.goalRunSettling = false
  }
}

/**
 * The run's final state could not be persisted: never continue. Memory is
 * settled to paused (best effort) so the UI shows a truthful, safe state; the
 * session is already flagged persist-degraded by the persistence layer.
 */
export async function failGoalRunOnPersist(session) {
  const run = session.goalRun
  if (!run) return
  session.goalSettlingRun = run
  session.goalRun = null
  session.goalRunSettling = true
  if (run.watchdog) clearTimeout(run.watchdog)
  try {
    goalStats(session).pauseRequested = false
    const goal = session.goal
    if (!goal || goalState.isGoalTerminalStatus(goal.status)) return
    logger.warn(`Goal run for session ${session.sessionId} finished without a durable persist; pausing`, { sessionId: session.sessionId })
    await commitGoal(session, goalState.setGoalStatus(usageOnly(goal, { durationMs: Math.max(0, Date.now() - run.startedAt) }), 'paused', { blocker: 'persist_failed' }))
  } finally {
    session.goalSettlingRun = null
    session.goalRunSettling = false
  }
}

/**
 * `/goal <objective>` — create the goal and start the read-only planning run.
 * Returns `{ error }` (rendered as a text response) or `{ commandPrompt }`.
 */
export async function startGoalPlanning(session, objective, requestSource = null, { attachments = [] } = {}) {
  const text = typeof objective === 'string' ? objective.trim() : ''
  if (!text) return { error: 'Usage: /goal <objective>', errorCode: 'GOAL_COMMAND_USAGE' }
  if (text.length > goalState.GOAL_MAX_OBJECTIVE_CHARS) {
    return { error: `Goal objective must be at most ${goalState.GOAL_MAX_OBJECTIVE_CHARS} characters.`, errorCode: 'GOAL_COMMAND_OBJECTIVE_TOO_LONG' }
  }
  if (!isGoalModeAvailable(session, requestSource)) return { error: 'Goal mode is only available in a QuickForge main chat.', errorCode: 'GOAL_COMMAND_UNAVAILABLE' }
  if (session.agent?.state?.isStreaming || session.abortPending) {
    return { error: 'The session is still running. Stop it or wait for it to finish before setting a goal.', errorCode: 'GOAL_COMMAND_SESSION_RUNNING' }
  }
  try {
    await withSessionGoalAdmission(session, async () => {
      // Re-check under the session lock: a concurrent `/goal` on this same
      // session may have committed an active goal while we waited for admission.
      const active = session.goal
      // A terminal goal can still own a scheduled serial run until Agent idle.
      // Do not let a replacement goal capture that run's waiter or transcript.
      if (hasGoalCompletionWaiter(session.sessionId)) {
        throw requestError('The previous goal is still settling. Wait for it to finish before starting a new one.', 409, 'GOAL_ACTIVE')
      }
      if (active && goalState.isGoalActiveStatus(active.status)) {
        throw requestError(
          `This chat already has an active goal (${active.status}). Pause, cancel or revise it from the goal card before starting a new one.`,
          409,
          'GOAL_ACTIVE',
        )
      }
      // A brand-new goal starts with a clean termination state: a previous cancel
      // must not make the commit guard refuse this fresh goal. Cleared inside the
      // lock so it can never wipe another request's termination intent.
      clearGoalTermination(session)
      const maxIterations = await resolveGoalMaxIterations()
      const next = goalState.createGoalState({
        sessionId: session.sessionId,
        objective: text,
        attachments,
        budget: { maxIterations, maxActiveDurationMs: null },
      })
      await commitGoal(session, next, { revertOnFailure: true })
    })
  } catch (error) {
    // requestError failures carry a stable errorCode; anything else degrades to
    // the plain message without inventing a code.
    return error.errorCode ? { error: error.message, errorCode: error.errorCode } : { error: error.message }
  }
  resetGoalStats(session)
  resetGoalToolEvidence(session)
  return { commandPrompt: goalPlanningPrompt(session.goal) }
}
