/**
 * Goal mode runner — session-bound, bounded multi-round execution.
 *
 * Design constraints (see the feature contract):
 * - A goal is bound to exactly one QuickForge main-chat session. A session holds
 *   at most one active goal at a time; different sessions — including global
 *   chats sharing the same workspace directory — may run goals in parallel.
 * - Planning runs are forced read-only by reusing the `/plan` permission
 *   whitelist; only after normal planning settlement and persistence does
 *   execution use the session's normal access mode and approval flow.
 * - Continuations keep the full history and start a fresh turn id; they are
 *   scheduled only after the previous run really finished AND its final state
 *   was persisted successfully (fail-closed: a failed persist pauses the goal).
 * - `goal_report action:"complete"` validates evidence bound to real successful
 *   tool results. Normal run-end and durable persistence are required before
 *   automatic completion; subjective criteria can still use `needs_review`.
 * - No progress, repeated failures, rejected/timed-out approvals and skipped
 *   questions pause the goal instead of continuing forever.
 *
 * Everything here is composed from `agent-goal-state.mjs` (pure) plus the
 * existing session/persistence/event modules; `agent-manager.mjs` only calls
 * the exported hooks.
 */

import { logger } from './utils/logger.mjs'
import { emitSessionEvent, runtimePendingToolCalls } from './agent-session-events.mjs'
import { persistSession } from './agent-persistence.mjs'
import { getPendingApprovalForSession } from './approval-store.mjs'
import { getPendingAskForSession } from './ask-store.mjs'
import { agentSessions } from './agent-session-store.mjs'
import { normalizeCapabilityPolicy } from './agent-profile-schema.mjs'
import { goalReportTool } from './tools/definitions.mjs'
import * as goalState from './agent-goal-state.mjs'

export const GOAL_PLANNING_PERMISSIONS = Object.freeze({ allowEdit: false, allowCommands: false, allowSubagents: true })
// Planning must stay read-only even for full-access sessions: no commands, no
// MCP/plugins, no writes, no writable subagents. todo_write is deliberately
// absent: the shared /plan whitelist (approval-store.planAllowedTools) gates it
// first, so allowing it here would only claim a capability that never worked.
export const GOAL_PLANNING_ALLOWED_TOOLS = new Set([
  'read_file',
  'grep_files',
  'activate_skill',
  'read_skill_resource',
  'ask_user',
  'goal_report',
  'run_subagent',
])
const GOAL_READONLY_SUBAGENT_POLICIES = new Set(['readonly-research', 'safe-validation', 'review-only'])
// Named profiles are resolved synchronously; only the built-in read-only
// profile is accepted during planning. Anything else must be an inline spec
// with an explicit read-only capabilityPolicy.
const GOAL_READONLY_SUBAGENT_NAMES = new Set(['explore'])

const MAX_CONSECUTIVE_GOAL_FAILURES = 2
const MAX_GOAL_NO_PROGRESS_RUNS = 2
const MAX_GOAL_PLANNING_ATTEMPTS = 3
const GOAL_CONTINUATION_IDLE_WAIT_MS = 15_000
const GOAL_CONTINUATION_POLL_MS = 200
// Only tools that can produce verifiable output count as goal evidence. Control
// plane (goal_report/todo_write/ask_user), delegation (run_subagent), skills,
// memory and other tools are never evidence: a successful tool result is not a
// semantic verification of the goal.
const GOAL_EVIDENCE_ALLOWED_TOOLS = new Set(['run_command', 'read_file', 'grep_files'])
// After goal_report(action="complete") is recorded, the rest of the turn is
// limited to read-only inspection so nothing can mutate the workspace or the
// report before the user is asked to review a quiescent goal.
const GOAL_SETTLEMENT_ALLOWED_TOOLS = new Set(['read_file', 'grep_files'])
const GOAL_BUDGET_HINT = 'Budget exhausted. Use extend_resume to add the default budget to exhausted limits and continue this goal; accumulated usage and progress are preserved.'

// agent-manager injects the per-session turn-id helpers so this module never
// has to import the manager (no cycle, no extra manager exports).
let runnerDeps = {
  beginTurn: () => null,
  endTurn: () => {},
  refreshTools: async () => {},
  syncMessages: () => {},
}

export function configureGoalRunner(deps = {}) {
  runnerDeps = { ...runnerDeps, ...deps }
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

// `shared` is a request-scoped model access overlay written by the shared
// conversation route on every prompt. It must never become the session's
// permanent identity, otherwise the owner's main chat would lose goal mode for
// good after any shared visitor typed a message. Real session-bound sources
// (acp/scheduled) are the session's identity and stay rejected.
const REQUEST_SCOPED_MODEL_SOURCES = new Set(['shared'])

/**
 * Goal mode is only available in a QuickForge main chat. ACP / channel sessions
 * carry a persistent `source`; the current request may also carry a
 * request-scoped source (the shared conversation route), which must be rejected
 * for that request only — never permanently disabled for the owner.
 */
export function isGoalModeAvailable(session, requestSource = null) {
  if (!session) return false
  if (session.source) return false
  if (requestSource) return false
  const boundSource = session.modelAccessContext?.source
  if (boundSource && !REQUEST_SCOPED_MODEL_SOURCES.has(boundSource)) return false
  return true
}

export function sessionGoal(session) {
  return session?.goal || null
}

export function isGoalPlanning(session) {
  return session?.goal?.status === 'planning' || session?.goalRun?.kind === 'planning' || session?.goalSettlingRun?.kind === 'planning'
}

export function isGoalRunActive(session) {
  return Boolean(session?.goalRun)
}

function goalStats(session) {
  if (!session.goalStats) {
    session.goalStats = { consecutiveFailures: 0, noProgressRuns: 0, planningAttempts: 0, pauseRequested: false }
  }
  return session.goalStats
}

function resetGoalStats(session) {
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
function goalTerminationIntent(session) {
  return session?.goalTerminationKind || null
}

function markGoalTermination(session, kind) {
  // Never downgrade an explicit cancel to an abort/pause.
  if (session.goalTerminationKind === 'cancel') return false
  session.goalTerminationKind = kind
  session.goalAbortGeneration = (session.goalAbortGeneration || 0) + 1
  return true
}

function clearGoalTermination(session) {
  session.goalTerminationKind = null
}

/**
 * Runtime record of successful tool executions observed during the current goal
 * version. Evidence may only reference these toolCallIds (plus the goal's own
 * persisted evidence snapshot), never arbitrary earlier session history.
 */
function goalTrustedTools(session) {
  if (!(session.goalTrustedToolCalls instanceof Map)) session.goalTrustedToolCalls = new Map()
  return session.goalTrustedToolCalls
}

function resetGoalToolEvidence(session) {
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

function requestError(message, statusCode = 409, errorCode = 'GOAL_CONFLICT') {
  return Object.assign(new Error(message), { statusCode, errorCode })
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
async function commitGoal(session, nextGoal, { revertOnFailure = false, forceMessagesReplace = false } = {}) {
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
  try {
    await runnerDeps.refreshTools(session)
  } catch (error) {
    logger.warn(`Failed to refresh tools after goal change for session ${session.sessionId}: ${error?.message || error}`)
  }
  emitGoalUpdated(session)
  runnerDeps.syncMessages(session)
  return true
}

function usageOnly(goal, { iterations = 0, durationMs = 0 } = {}) {
  // Accounting never bumps revision: the progress signature must reflect real
  // plan/evidence/summary movement, not bookkeeping.
  return {
    ...goal,
    usage: goalState.goalUsageWithRun(goal, { iterations, durationMs }),
    updatedAt: new Date().toISOString(),
  }
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
async function withSessionGoalAdmission(session, operation) {
  return withGoalSessionLock(session.sessionId, operation)
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const GOAL_CHAT_OUTPUT_RULES = `The UI owns goal status and iteration announcements. Do not repeat the round number, announce continuing or replanning, or narrate submitting complete / waiting for settlement in chat.
Keep substantive analysis, necessary questions, concrete blockers, and a concise final summary of actual work and verification. Never claim the goal is completed before the server's normal-end and persistence barrier.`

export function goalPlanningPrompt(goal) {
  return `<goal_planning objective="${escapeXmlAttribute(goal.objective)}">
Plan this goal before any execution. This planning turn is READ-ONLY: you may read files, search, load skills and delegate read-only research subagents, but you must not write files, run commands, use MCP/plugin tools, or start the work.

Then call goal_report exactly once with action="plan" providing:
- criteria: 2-8 acceptance criteria. Each criterion must be objectively verifiable (a command, test, file state, or observable output). Mark subjective or human-judgment criteria as required=false. Never invent criteria you cannot verify.
- scope: the files/areas the work will touch.
- summary: a concise plan (steps, order, validation commands).

Rules:
- Do not execute during this planning turn. Execution starts automatically only after this turn ends normally and is durably saved; no plan confirmation is required.
- Keep the objective exactly as given; scope changes require the user to revise the goal.
${GOAL_CHAT_OUTPUT_RULES}
</goal_planning>`
}

export function goalContinuationPrompt(goal, round, maxRounds) {
  const criteria = goal.criteria.length
    ? goal.criteria.map((criterion) => {
      const evidence = criterion.evidenceIds.length ? criterion.evidenceIds.join(', ') : '-'
      return `- [${criterion.id}]${criterion.required ? ' (required)' : ''} ${criterion.status}: ${criterion.description} (evidence: ${evidence})`
    }).join('\n')
    : '- (no criteria recorded yet)'
  const evidence = goal.evidence.length
    ? goal.evidence.map((entry) => `- [${entry.id}] ${entry.description} (toolCallId: ${entry.toolCallId || 'none'})`).join('\n')
    : '- (none)'
  return `<goal_continuation round="${round}" max_rounds="${maxRounds}" status="${goal.status}">
Objective: ${goal.objective}
Scope: ${goal.scope.length ? goal.scope.join(', ') : '(not recorded)'}
Summary so far: ${goal.summary || '(none)'}

Acceptance criteria:
${criteria}

Evidence:
${evidence}

Continue executing this goal now. Work in small verified steps and call goal_report(action="progress") whenever the plan or evidence changes:
- Evidence must reference the toolCallId of a real, successful tool result from this session (read_file, run_command, tests, build...). goal_report/todo_write/ask_user results are not evidence.
- A criterion may only be marked "passed" when it has evidence bound to such a tool result. Never mark a criterion passed on your own judgement.
- Never fabricate passes for unverifiable criteria. Report blocked with a concrete verification limitation, or ask a necessary question; do not request a final human sign-off.
- Completed todos are not acceptance evidence.
- If you are blocked (missing access, failing environment, ambiguous requirement), call goal_report(action="blocked") with a concrete blocker instead of looping.
- When every required criterion is verified, call goal_report(action="complete") and end this turn. The server completes the goal automatically after a normal run end and durable persistence; do not claim completion before that barrier.
${GOAL_CHAT_OUTPUT_RULES}
</goal_continuation>`
}

function continuationVisibleText(round, maxRounds) {
  return `继续执行目标（第 ${round}/${maxRounds} 轮）`
}

function planningVisibleText(attempt) {
  return `重新规划目标（第 ${attempt} 次）`
}

function escapeXmlAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// ---------------------------------------------------------------------------
// Starting / finishing runs
// ---------------------------------------------------------------------------

function assertGoalBudget(goal) {
  const budget = goalState.goalBudgetExhausted(goal)
  if (budget.exhausted) {
    throw requestError(`Goal budget exhausted (${budget.reason}). ${GOAL_BUDGET_HINT}`, 409, 'GOAL_BUDGET_EXHAUSTED')
  }
}

function budgetRemainingMs(goal) {
  return goal.budget.maxActiveDurationMs === null ? null : Math.max(0, goal.budget.maxActiveDurationMs - goal.usage.activeDurationMs)
}

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

function scheduleGoalContinuation(session, kind) {
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

async function waitForGoalIdle(session) {
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

/**
 * `/goal <objective>` — create the goal and start the read-only planning run.
 * Returns `{ error }` (rendered as a text response) or `{ commandPrompt }`.
 */
export async function startGoalPlanning(session, objective, requestSource = null) {
  const text = typeof objective === 'string' ? objective.trim() : ''
  if (!text) return { error: 'Usage: /goal <objective>' }
  if (text.length > goalState.GOAL_MAX_OBJECTIVE_CHARS) {
    return { error: `Goal objective must be at most ${goalState.GOAL_MAX_OBJECTIVE_CHARS} characters.` }
  }
  if (!isGoalModeAvailable(session, requestSource)) return { error: 'Goal mode is only available in a QuickForge main chat.' }
  if (session.agent?.state?.isStreaming || session.abortPending) {
    return { error: 'The session is still running. Stop it or wait for it to finish before setting a goal.' }
  }
  try {
    await withSessionGoalAdmission(session, async () => {
      // Re-check under the session lock: a concurrent `/goal` on this same
      // session may have committed an active goal while we waited for admission.
      const active = session.goal
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
      const next = goalState.createGoalState({ sessionId: session.sessionId, objective: text })
      await commitGoal(session, next, { revertOnFailure: true })
    })
  } catch (error) {
    return { error: error.message }
  }
  resetGoalStats(session)
  resetGoalToolEvidence(session)
  return { commandPrompt: goalPlanningPrompt(session.goal) }
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
    const budget = { ...goal.budget }
    if (goal.usage.iterations >= budget.maxIterations) budget.maxIterations += goalState.GOAL_BUDGET_DEFAULTS.maxIterations
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
  const run = session.goalRun
  if (run?.watchdog) clearTimeout(run.watchdog)
  session.goalRun = null
  session.goalRunSettling = false
  session.goalContinuationPending = false
  session.goalTerminationKind = null
  session.goalStats = null
  session.goalTrustedToolCalls = null
}

// ---------------------------------------------------------------------------
// goal_report tool
// ---------------------------------------------------------------------------

/**
 * Trusted toolCallIds for the current goal version: the runtime record of
 * successful verification tool executions plus the goal's own persisted
 * evidence snapshot (written only after that same validation passed). Arbitrary
 * earlier session history, control-plane tools, subagents, skills and memory
 * tools are never trusted.
 */
function trustedToolCallNames(session, goal) {
  const trusted = new Map(goalTrustedTools(session))
  for (const entry of goal?.evidence || []) {
    if (entry?.toolCallId && !trusted.has(entry.toolCallId)) {
      trusted.set(entry.toolCallId, entry.toolName || '')
    }
  }
  return trusted
}

function goalReportError(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function requireText(value, field, max) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw goalReportError(`goal_report requires a non-empty ${field}.`)
  return text.length > max ? text.slice(0, max) : text
}

function validateEvidenceToolCalls(session, goal, evidence) {
  const available = trustedToolCallNames(session, goal)
  if (!Array.isArray(evidence) || evidence.length === 0) return available
  const invalid = evidence
    .filter((entry) => entry && typeof entry === 'object' && typeof entry.toolCallId === 'string' && entry.toolCallId)
    .map((entry) => entry.toolCallId)
    .filter((toolCallId) => !available.has(toolCallId))
  if (invalid.length > 0) {
    throw goalReportError(
      `goal_report evidence must reference successful tool results from this goal; unknown toolCallId: ${[...new Set(invalid)].join(', ')}. Run the verification command first.`,
    )
  }
  return available
}

function goalReportResult(session, text) {
  return {
    content: [{ type: 'text', text }],
    details: { type: 'goal_report_result', goal: session.goal || null },
  }
}

async function applyGoalReport(session, params) {
  const goal = session.goal
  if (!goal) throw goalReportError('There is no active goal in this session.')
  if (!goalState.isGoalActiveStatus(goal.status)) {
    throw goalReportError(`The goal is ${goal.status}; goal_report is no longer accepted.`)
  }
  if (session.goalRun?.pendingDisposition) {
    throw goalReportError('The goal result was already reported for this run. Stop here; settlement requires normal run end and durable persistence.')
  }
  const action = typeof params.action === 'string' ? params.action : ''
  const planning = goal.status === 'planning'

  if (action === 'plan') {
    if (!planning) throw goalReportError(`goal_report action="plan" is only valid while planning; the goal is ${goal.status}.`)
    const criteria = Array.isArray(params.criteria) ? params.criteria : []
    if (criteria.length === 0) {
      throw goalReportError('goal_report action="plan" requires at least one acceptance criterion.')
    }
    if (criteria.length > goalState.GOAL_MAX_CRITERIA) {
      throw goalReportError(`goal_report supports at most ${goalState.GOAL_MAX_CRITERIA} acceptance criteria.`)
    }
    const summary = requireText(params.summary, 'summary', goalState.GOAL_MAX_SUMMARY_CHARS)
    const next = goalState.applyGoalPlan(goal, { criteria, scope: params.scope, summary })
    if (next.criteria.length === 0) throw goalReportError('goal_report action="plan" requires criteria with a description.')
    goalStats(session).planningAttempts = 0
    await commitGoal(session, next)
    return goalReportResult(session, `Plan recorded with ${next.criteria.length} acceptance criteria. End this read-only planning turn; execution starts automatically after normal run end and durable persistence.`)
  }

  if (isGoalPlanning(session) || (goal.status === 'awaiting_confirmation' && goal.planConfirmed !== true)) {
    const guidance = planning
      ? 'use action="plan".'
      : 'The plan is already submitted. End this read-only planning turn; execution starts automatically after normal run end and durable persistence.'
    throw goalReportError(`goal_report action="${action}" is not valid while planning; ${guidance}`)
  }

  const evidence = Array.isArray(params.evidence) ? params.evidence : []
  const trustedToolNames = validateEvidenceToolCalls(session, goal, evidence)
  const progressed = goalState.applyGoalProgress(goal, {
    summary: params.summary,
    evidence,
    criterionUpdates: params.criterionUpdates,
    trustedToolNames,
  })
  if (progressed.errors.length > 0) throw goalReportError(`goal_report rejected: ${progressed.errors.join('; ')}`)
  let next = progressed.goal

  if (action === 'progress') {
    requireText(params.summary, 'summary', goalState.GOAL_MAX_SUMMARY_CHARS)
    await commitGoal(session, next)
    return goalReportResult(session, `Goal progress recorded (revision ${session.goal.revision}).`)
  }

  if (action === 'blocked') {
    const blocker = requireText(params.blocker, 'blocker', goalState.GOAL_MAX_BLOCKER_CHARS)
    next = goalState.setGoalStatus(next, 'blocked', { blocker })
    await commitGoal(session, next)
    return goalReportResult(session, `Goal marked blocked: ${blocker}`)
  }

  if (action === 'needs_review') {
    const reason = typeof params.blocker === 'string' && params.blocker.trim()
      ? params.blocker.trim() : `Unable to verify criteria automatically: ${next.criteria.filter((entry) => entry.required && entry.status !== 'passed').map((entry) => entry.description).join('; ') || 'verification evidence unavailable'}`
    if (session.goalRun) session.goalRun.verificationBlocker = reason
    await commitGoal(session, goalState.setGoalStatus(next, 'blocked', { blocker: reason }))
    return goalReportResult(session, `Goal blocked: ${reason}. Obtain missing evidence or ask a necessary question; no human sign-off is required.`)
  }

  if (action === 'complete') {
    const check = goalState.goalCompletionCheck(next)
    if (!check.ok) {
      // Fail closed: the model cannot self-approve. Nothing is committed.
      throw goalReportError(`goal_report action="complete" rejected: ${check.reason}. Verify the criteria with real tool results, or use action="blocked"/"needs_review".`)
    }
    return settleGoalReportDisposition(session, next, 'completed',
      `All required criteria are verified. Stop here: the goal completes automatically only after this turn ends normally and its final state is persisted.\n${GOAL_CHAT_OUTPUT_RULES}`)
  }

  throw goalReportError(`Unsupported goal_report action: ${action || '(missing)'}`)
}

/**
 * Record the disposition without publishing completion while a run is active.
 * The rest of the turn is read-only; finishGoalRun applies the normal-end,
 * termination and persistence barriers before publishing the final state.
 */
async function settleGoalReportDisposition(session, next, disposition, message) {
  if (session.goalRun) {
    session.goalRun.pendingDisposition = disposition
    await commitGoal(session, goalState.setGoalStatus(next, 'verifying'))
    return goalReportResult(session, message)
  }
  throw goalReportError('Goal completion/review requires an active run and its normal run-end persistence barrier.')
}

export function createGoalReportTool(sessionOrGetter) {
  const getSession = typeof sessionOrGetter === 'function' ? sessionOrGetter : () => sessionOrGetter
  return {
    ...goalReportTool,
    execute: async (_toolCallId, params) => {
      const session = getSession()
      if (!session) throw goalReportError('No active session for goal_report.')
      return applyGoalReport(session, params || {})
    },
  }
}

// Exported for targeted tests: the planning permission gate used by
// agent-manager.beforeToolCall while a goal is still planning.
export function goalPlanningToolBlockReason(session, toolName, args = {}) {
  if (!isGoalPlanning(session)) return null
  if (!GOAL_PLANNING_ALLOWED_TOOLS.has(toolName)) {
    return `Goal planning is read-only and cannot use ${toolName}.`
  }
  if (toolName === 'run_subagent') {
    const requested = args?.subagent
    if (typeof requested === 'string') {
      const name = requested.trim().toLowerCase()
      if (!GOAL_READONLY_SUBAGENT_NAMES.has(name)) {
        return `Goal planning only allows read-only subagents; "${requested}" is not read-only. Use the explore profile or an inline spec with a read-only capabilityPolicy.`
      }
      return null
    }
    if (requested && typeof requested === 'object') {
      const policy = normalizeCapabilityPolicy(
        requested.capabilityPolicy || 'readonly-research',
        Array.isArray(requested.tools) ? requested.tools : [],
      )
      if (!GOAL_READONLY_SUBAGENT_POLICIES.has(policy)) {
        return `Goal planning only allows read-only subagents (requested policy: ${policy}).`
      }
    }
  }
  return null
}

/**
 * Once goal_report recorded the run's completion disposition, the remaining
 * turn is restricted to read-only inspection: no further goal_report, no
 * writes/commands/subagents/memory, so nothing can change the verified result
 * before the user reviews a quiescent goal.
 */
export function goalRunSettlementToolBlockReason(session, toolName) {
  if (session?.goalRun?.verificationBlocker) {
    if (GOAL_SETTLEMENT_ALLOWED_TOOLS.has(toolName) || toolName === 'ask_user') return null
    return `Goal verification is blocked; ${toolName} is not allowed before an explicit resume.`
  }
  if (!session?.goalRun?.pendingDisposition) return null
  if (GOAL_SETTLEMENT_ALLOWED_TOOLS.has(toolName)) return null
  return `The goal result is already reported; ${toolName} is not allowed while the turn finishes.`
}
