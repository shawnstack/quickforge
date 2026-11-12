/**
 * Per-session goal bookkeeping — mode availability, goal/stats/termination
 * accounting, trusted-tool-evidence records, the single per-session admission
 * lock and the agent idle-wait poll. Carved verbatim from
 * agent-goal-runner.mjs (zero behavior change).
 */

import * as goalState from './agent-goal-state.mjs'
import { GOAL_CONTINUATION_IDLE_WAIT_MS, GOAL_CONTINUATION_POLL_MS, GOAL_EVIDENCE_ALLOWED_TOOLS } from './goal-policy.mjs'


// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

// `shared` is a request-scoped model access overlay written by the shared
// conversation route on every prompt. It must never become the session's
// permanent identity, otherwise the owner's main chat would lose goal mode for
// good after any shared visitor typed a message. Scheduled sessions use the same
// goal runner as main chats; ACP sources stay rejected.
const REQUEST_SCOPED_MODEL_SOURCES = new Set(['shared'])

/**
 * Goal mode is available in main chats and scheduled sessions. ACP sessions
 * carry a persistent `source`; the current request may also carry a
 * request-scoped source (the shared conversation route), which must be rejected
 * for that request only — never permanently disabled for the owner.
 */
export function isGoalModeAvailable(session, requestSource = null) {
  if (!session) return false
  if (session.source && session.source !== 'scheduled') return false
  if (requestSource && requestSource !== 'scheduled') return false
  const boundSource = session.modelAccessContext?.source
  if (boundSource && boundSource !== 'scheduled' && !REQUEST_SCOPED_MODEL_SOURCES.has(boundSource)) return false
  return true
}

export function sessionGoal(session) {
  return session?.goal || null
}

export function goalStats(session) {
  if (!session.goalStats) {
    session.goalStats = { consecutiveFailures: 0, noProgressRuns: 0, planningAttempts: 0, pauseRequested: false }
  }
  return session.goalStats
}

export function resetGoalStats(session) {
  session.goalStats = { consecutiveFailures: 0, noProgressRuns: 0, planningAttempts: 0, pauseRequested: false }
}

/**
 * Unified termination intent for the active goal. `cancel` is terminal and must
 * win over any settlement already in flight; `abort` settles to `paused`. Both
 * bump `goalAbortGeneration` so a settlement awaiting its final persist can
 * observe the intent and refuse to continue or overwrite it. This is what makes
 * cancel/finish and cancel/abort deterministic instead of relying on persist
 * ordering: the intent is recorded synchronously before the terminal commit, so
 * an older settlement can only ever be downgraded by the intent, never the
 * other way around.
 */
export function goalTerminationIntent(session) {
  return session?.goalTerminationKind || null
}

export function markGoalTermination(session, kind) {
  // Never downgrade an explicit cancel to an abort/pause.
  if (session.goalTerminationKind === 'cancel') return false
  session.goalTerminationKind = kind
  session.goalAbortGeneration = (session.goalAbortGeneration || 0) + 1
  return true
}

export function clearGoalTermination(session) {
  session.goalTerminationKind = null
}

/**
 * Runtime record of successful tool executions observed during the current goal
 * version. Evidence may only reference these toolCallIds (plus the goal's own
 * persisted evidence snapshot), never arbitrary earlier session history.
 */
export function goalTrustedTools(session) {
  if (!(session.goalTrustedToolCalls instanceof Map)) session.goalTrustedToolCalls = new Map()
  return session.goalTrustedToolCalls
}

export function resetGoalToolEvidence(session) {
  session.goalTrustedToolCalls = new Map()
}

/**
 * agent-manager forwards every tool_execution_end event here. Only successful
 * results of verification tools are recorded; control-plane/delegation/skill/
 * memory tools can never become goal evidence.
 */
export function recordGoalToolExecution(session, event = {}) {
  const goal = session?.goal
  if (!goal || !goalState.isGoalActiveStatus(goal.status)) return
  const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : ''
  const toolName = typeof event.toolName === 'string' ? event.toolName : ''
  if (!toolCallId || !toolName) return
  const trusted = goalTrustedTools(session)
  if (!GOAL_EVIDENCE_ALLOWED_TOOLS.has(toolName) || !goalToolExecutionIsVerified(event, toolName)) {
    trusted.delete(toolCallId)
    return
  }
  trusted.set(toolCallId, toolName)
}

/**
 * `event.isError` only reflects the tool transport: run_command resolves with
 * `isError` unset even for a non-zero exit, and the real exit code lives in
 * `event.result.details.code`. Evidence must therefore be bound to a genuinely
 * clean command (code 0, no timeout/abort/signal); read_file/grep_files carry
 * no exit code and only need the transport success.
 */
function goalToolExecutionIsVerified(event, toolName) {
  if (event.isError === true) return false
  const details = event.result && typeof event.result === 'object'
    && event.result.details && typeof event.result.details === 'object'
    ? event.result.details
    : null
  const isCommand = toolName === 'run_command' || Boolean(details && Object.prototype.hasOwnProperty.call(details, 'code'))
  if (!isCommand) return true
  if (!details) return false
  if (details.code !== 0) return false
  if (details.timedOut === true || details.aborted === true || details.signal) return false
  return true
}

// ---------------------------------------------------------------------------
// Session goal admission
// ---------------------------------------------------------------------------

// Per-session admission queue: `re-check session.goal` + `commitGoal` is a
// read-modify-write over the session's goal, so start/confirm/resume/revise must
// run strictly one at a time for the same session. Different sessions never
// share a key and therefore never block each other (goals run in parallel).
const sessionGoalQueues = new Map()

function withGoalSessionLock(key, operation) {
  const previous = sessionGoalQueues.get(key) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(operation)
  const tail = result.then(() => undefined, () => undefined)
  sessionGoalQueues.set(key, tail)
  tail.then(() => {
    if (sessionGoalQueues.get(key) === tail) sessionGoalQueues.delete(key)
  })
  return result
}

/**
 * Serialized per-session admission: the read-modify-write over `session.goal`
 * must not interleave with another action on the same session. Different
 * sessions never block each other (goals may run in parallel).
 */
export async function withSessionGoalAdmission(session, operation) {
  return withGoalSessionLock(session.sessionId, operation)
}

export async function waitForGoalIdle(session) {
  const deadline = Date.now() + GOAL_CONTINUATION_IDLE_WAIT_MS
  for (;;) {
    if (!session.agent?.state?.isStreaming && !session.abortPending) {
      if (typeof session.agent?.waitForIdle === 'function') {
        try {
          await session.agent.waitForIdle()
        } catch {
          // ignore: idle check below is authoritative
        }
      }
      if (!session.agent?.state?.isStreaming && !session.abortPending) return true
    }
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, GOAL_CONTINUATION_POLL_MS).unref?.())
  }
}
