/**
 * Goal v2 round driver — DSH-aligned same-session automatic continuation.
 *
 * DSH contract (fully replicated):
 * - Every round is an execution round with objective + round number. No
 *   separate planning phase, no criteria/evidence gate for completion.
 * - The model marks complete/blocked via `update_goal` (or goal_report);
 *   the driver stops immediately on those terminal phases.
 * - Errors disarm continuation (no retry, no blocking reason).
 * - No no-progress detection, no repeated-failure pause, no settlement
 *   barrier: a round that ends normally schedules the next round directly.
 * - Restart/fork keeps the durable phase but disarms; the user must resume.
 */

import { logger } from '../utils/logger.mjs'
import { agentEvents, emitSessionEvent } from '../agent-session-events.mjs'
import { persistSession } from '../agent-persistence.mjs'
import { agentSessions } from '../agent-session-store.mjs'
import { isGoalActiveStatus } from '../agent-goal-state.mjs'
import { resolveGoalMaxIterations } from '../goal-settings.mjs'
import { createGoalService } from './service.mjs'
import { GoalError } from './errors.mjs'
import { createGoalReportToolV2 } from './report-tool.mjs'
import { createGoalTools } from './tools.mjs'
import { hasDirectHumanTurn, isGoalRoundTurn } from './authority.mjs'
import { goalCommandStatusText, goalRoundPromptV2 } from './prompts.mjs'

export const GOAL_PLANNING_PERMISSIONS = Object.freeze({ allowEdit: false, allowCommands: false, allowSubagents: true })
export const GOAL_PLANNING_ALLOWED_TOOLS = new Set([
  'read_file',
  'grep_files',
  'activate_skill',
  'read_skill_resource',
  'ask_user',
  'goal_report',
  'run_subagent',
])

const GOAL_CONTINUATION_IDLE_WAIT_MS = 15_000
const GOAL_CONTINUATION_POLL_MS = 200

let runnerDeps = {
  beginTurn: () => null,
  endTurn: () => {},
  refreshTools: async () => {},
  syncMessages: () => {},
}

export function configureGoalRunner(deps = {}) {
  runnerDeps = { ...runnerDeps, ...deps }
}

const services = new Map()
const durableTerminalGoals = new WeakMap()
const stoppedGoalSessions = new WeakSet()
const goalCompletionWaiters = new Map()

function serviceFor(session) {
  let service = services.get(session.sessionId)
  if (!service) {
    service = createGoalService()
    service.loadSession(session.sessionId, {
      events: Array.isArray(session.goalEvents) ? session.goalEvents : null,
      legacyGoal: session.goal || null,
    })
    services.set(session.sessionId, service)
  }
  return service
}

function syncGoal(session) {
  const service = serviceFor(session)
  session.goal = service.get(session.sessionId)
  session.goalEvents = service.getEvents(session.sessionId)
  return session.goal
}

function goalRef(session) {
  const goal = session?.goal
  return goal ? { id: goal.id, revision: goal.revision } : null
}

function emitGoalUpdated(session) {
  emitSessionEvent(session, { type: 'goal_updated', sessionId: session.sessionId, goal: session.goal || null })
}

async function persistGoal(session) {
  try {
    await persistSession(session)
    return true
  } catch (error) {
    logger.error(`Failed to persist goal state for session ${session.sessionId}:`, error, { sessionId: session.sessionId })
    return false
  }
}

async function commitGoal(session) {
  const previousGoal = session.goal
  syncGoal(session)
  const persisted = await persistGoal(session)
  emitGoalUpdated(session)
  const wasActive = Boolean(previousGoal && isGoalActiveStatus(previousGoal.status))
  const isActive = Boolean(session.goal && isGoalActiveStatus(session.goal.status))
  if (wasActive !== isActive) {
    try {
      await runnerDeps.refreshTools?.(session)
    } catch (error) {
      logger.warn(`Failed to refresh tools after goal change for session ${session.sessionId}: ${error?.message || error}`)
    }
  }
  return persisted
}

function recordDurableGoal(session) {
  if (session.goal?.phase === 'complete') {
    durableTerminalGoals.set(session, { goal: session.goal, messages: [...(session.agent?.state?.messages || [])] })
  }
}

export function isGoalModeAvailable(session, requestSource = null) {
  if (!session) return false
  if (session.source && session.source !== 'scheduled') return false
  if (requestSource && requestSource !== 'scheduled') return false
  const boundSource = session.modelAccessContext?.source
  if (boundSource && boundSource !== 'scheduled' && boundSource !== 'shared') return false
  return true
}

export function sessionGoal(session) {
  return session?.goal || null
}

export function isGoalPlanning(_session) {
  // DSH has no planning phase; every round is an execution round.
  return false
}

function goalTrustedTools(session) {
  if (!(session.goalTrustedToolCalls instanceof Map)) session.goalTrustedToolCalls = new Map()
  return session.goalTrustedToolCalls
}

function resetGoalToolEvidence(session) {
  session.goalTrustedToolCalls = new Map()
}

const GOAL_EVIDENCE_ALLOWED_TOOLS = new Set(['run_command', 'read_file', 'grep_files'])

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

export function recordGoalToolExecution(session, event = {}) {
  const goal = session?.goal
  if (!goal || goal.phase !== 'active') return
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

function requestError(message, statusCode = 409, errorCode = 'GOAL_CONFLICT') {
  return Object.assign(new Error(message), { statusCode, errorCode })
}

export async function startGoalPlanning(session, objective, requestSource = null, { attachments = [] } = {}) {
  // DSH: creating a goal just creates it; the driver starts the first round.
  const text = typeof objective === 'string' ? objective.trim() : ''
  if (!text) return { error: 'Usage: /goal <objective>', errorCode: 'GOAL_COMMAND_USAGE' }
  if (!isGoalModeAvailable(session, requestSource)) {
    return { error: 'Goal mode is only available in a QuickForge main chat.', errorCode: 'GOAL_COMMAND_UNAVAILABLE' }
  }
  try {
    const service = serviceFor(session)
    const current = service.get(session.sessionId)
    if (current && current.phase !== 'complete') {
      throw requestError('This chat already has a goal. Pause, clear or complete it before starting a new one.', 409, 'GOAL_ACTIVE')
    }
    const maxRounds = await resolveGoalMaxIterations()
    await service.create(session.sessionId, { objective: text, maxRounds, attachments })
    await commitGoal(session)
  } catch (error) {
    return error.errorCode || error.code ? { error: error.message, errorCode: error.errorCode || error.code } : { error: error.message }
  }
  resetGoalToolEvidence(session)
  // The first round starts immediately after this command turn settles.
  scheduleGoalContinuation(session, 'execution')
  return { goal: session.goal }
}

export async function handleGoalAction(session, action, objective, requestSource = null, options = {}) {
  if (!session) throw requestError('Session not found', 404, 'SESSION_NOT_FOUND')
  if (!isGoalModeAvailable(session, requestSource)) {
    throw requestError('Goal mode is not available for this session.', 409, 'GOAL_UNAVAILABLE')
  }
  const service = serviceFor(session)
  const goal = service.get(session.sessionId)
  if (!goal) throw requestError('This session has no goal.', 404, 'GOAL_NOT_FOUND')
  try {
    if (action === 'pause') {
      await service.pause(session.sessionId, goalRef(session))
      await commitGoal(session)
      if (session.agent?.state?.isStreaming) session.agent.abort?.()
      return session.goal
    }
    if (action === 'resume') {
      await service.resume(session.sessionId, goalRef(session))
      await commitGoal(session)
      scheduleGoalContinuation(session, 'execution')
      return session.goal
    }
    if (action === 'clear' || action === 'cancel') {
      await service.clear(session.sessionId, goalRef(session), {
        outcome: 'cancelled',
        reason: action === 'clear' ? 'user cleared the goal' : 'user cancelled',
      })
      await commitGoal(session)
      try { session.agent?.abort?.() } catch { /* best effort */ }
      return null
    }
    if (action === 'revise') {
      const text = typeof objective === 'string' ? objective.trim() : ''
      if (!text) throw requestError('A revised goal requires a new objective.', 400, 'GOAL_OBJECTIVE_REQUIRED')
      await service.edit(session.sessionId, goalRef(session), { objective: text })
      await commitGoal(session)
      resetGoalToolEvidence(session)
      if (session.goal?.phase === 'active') {
        scheduleGoalContinuation(session, 'execution')
      }
      return session.goal
    }
    if (action === 'extend_resume') {
      const { goalId, expectedRevision } = options
      if (typeof goalId !== 'string' || !goalId || !Number.isSafeInteger(expectedRevision) || expectedRevision <= 0) {
        throw requestError('extend_resume requires goalId and a positive integer expectedRevision only.', 400, 'GOAL_ACTION_INVALID')
      }
      if (goal.id !== goalId || goal.revision !== expectedRevision) {
        throw requestError('The goal changed. Refresh before trying again.', 409, 'GOAL_REVISION_CONFLICT')
      }
      if (goal.roundsStarted < goal.maxRounds) {
        throw requestError('Goal budget is not exhausted. Use resume instead.', 409, 'GOAL_BUDGET_NOT_EXHAUSTED')
      }
      const extendBy = await resolveGoalMaxIterations()
      await service.edit(session.sessionId, { id: goal.id, revision: goal.revision }, { maxRounds: goal.maxRounds + extendBy })
      await service.resume(session.sessionId, goalRef(session))
      await commitGoal(session)
      scheduleGoalContinuation(session, 'execution')
      return session.goal
    }
    if (action === 'confirm' || action === 'accept') {
      throw requestError('This action is no longer supported by Goal v2.', 410, 'GOAL_ACTION_INVALID')
    }
    throw requestError(`Unsupported goal action: ${action}`, 400, 'GOAL_ACTION_INVALID')
  } catch (error) {
    if (error instanceof GoalError) {
      throw Object.assign(new Error(error.message), { statusCode: error.statusCode, errorCode: error.code })
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Round driver (DSH-aligned)
// ---------------------------------------------------------------------------

export async function beginGoalRun(session, _kind = 'execution') {
  if (!session?.goal) return null
  if (session.goalRun) return session.goalRun
  const service = serviceFor(session)
  // DSH: every round is an execution round; reserve it atomically.
  const admitted = await service.admitRound(session.sessionId, goalRef(session))
  syncGoal(session)
  if (!await persistGoal(session)) {
    throw requestError('Could not persist the goal round.', 500, 'GOAL_PERSIST_FAILED')
  }
  emitGoalUpdated(session)
  const goal = session.goal
  const run = {
    kind: 'execution',
    startedAt: Date.now(),
    goalId: goal.id,
    revision: goal.revision,
    round: admitted.round,
    messageStart: session.agent?.state?.messages?.length || 0,
  }
  session.goalRun = run
  service.setRuntime(session.sessionId, 'executing')
  syncGoal(session)
  return run
}

async function waitForGoalIdle(session) {
  const deadline = Date.now() + GOAL_CONTINUATION_IDLE_WAIT_MS
  for (;;) {
    if (!session.agent?.state?.isStreaming && !session.abortPending) {
      if (typeof session.agent?.waitForIdle === 'function') {
        try { await session.agent.waitForIdle() } catch { /* idle check below is authoritative */ }
      }
      if (!session.agent?.state?.isStreaming && !session.abortPending) return true
    }
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, GOAL_CONTINUATION_POLL_MS).unref?.())
  }
}

function canStartGoalRun(session) {
  if (agentSessions.get(session.sessionId) !== session) return false
  const goal = session.goal
  if (!goal || goal.phase !== 'active') return false
  if (serviceFor(session).getActivation(session.sessionId) !== 'armed') return false
  if (goal.roundsStarted >= goal.maxRounds) return false
  if (session.goalRun || session.goalContinuationPending) return false
  if (session.agent?.state?.isStreaming || session.abortPending) return false
  return true
}

async function startGoalRun(session) {
  if (!canStartGoalRun(session)) return false
  const run = await beginGoalRun(session, 'execution')
  if (!run) return false
  const goal = session.goal
  const round = goal.roundsStarted

  const previous = {
    name: session.activeCommandName,
    permissions: session.activeCommandPermissions,
    prompt: session.activeCommandPrompt,
  }
  session.activeCommandName = 'goal'
  session.activeCommandPermissions = null
  session.activeCommandPrompt = goalRoundPromptV2(goal, round)
  session.activeCommandToken = run

  const turnId = runnerDeps.beginTurn(session.sessionId)
  logger.info(`Starting goal round ${round}/${goal.maxRounds} for session ${session.sessionId}`, {
    sessionId: session.sessionId,
    round,
  })

  let promptPromise = null
  try {
    promptPromise = session.agent.prompt({
      role: 'user',
      content: `继续执行目标（第 ${round}/${goal.maxRounds} 轮）`,
      timestamp: Date.now(),
      metadata: { quickforgeGoalRun: 'execution', quickforgeGoalRound: round },
    })
    session.activePromptPromise = promptPromise
    await promptPromise
  } catch (error) {
    logger.error(`Goal round ${round} failed for session ${session.sessionId}:`, error, { sessionId: session.sessionId })
    await finishGoalRun(session, { status: 'error', error: error?.message || String(error) })
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

function scheduleGoalContinuation(session, _kind) {
  if (session.goalContinuationPending) return
  session.goalContinuationPending = true
  setImmediate(() => {
    void (async () => {
      try {
        await waitForGoalIdle(session)
        session.goalContinuationPending = false
        if (!canStartGoalRun(session)) return
        await startGoalRun(session)
      } catch (error) {
        session.goalContinuationPending = false
        logger.error(`Failed to continue goal for session ${session.sessionId}:`, error, { sessionId: session.sessionId })
        // DSH: unexpected driver failures disarm; they don't block.
        serviceFor(session).disarm(session.sessionId)
        syncGoal(session)
        emitGoalUpdated(session)
      }
    })()
  })
}

export async function finishGoalRun(session, info = {}) {
  const run = session.goalRun
  if (!run) return
  session.goalRun = null

  const service = serviceFor(session)
  try {
    const goal = service.get(session.sessionId)
    if (!goal) return

    // DSH: check terminal state first — complete/blocked stop immediately.
    if (goal.phase === 'complete' || goal.phase === 'blocked') {
      recordDurableGoal(session)
      syncGoal(session)
      await commitGoal(session)
      return
    }

    const endStatus = info.status || 'idle'

    // DSH: user abort pauses the goal.
    if (endStatus === 'aborted' || session.abortPending) {
      if (goal.phase === 'active') {
        await service.pause(session.sessionId, goalRef(session))
      }
      syncGoal(session)
      await commitGoal(session)
      return
    }

    // DSH: errors disarm; they don't block or retry. The user can resume.
    if (endStatus === 'error' || info.error) {
      serviceFor(session).disarm(session.sessionId)
      syncGoal(session)
      await commitGoal(session)
      return
    }

    // DSH: normal end. Round limit check, then schedule the next round.
    syncGoal(session)
    await commitGoal(session)
    if (goal.phase === 'active' && goal.roundsStarted < goal.maxRounds) {
      scheduleGoalContinuation(session, 'execution')
    } else if (goal.phase === 'active' && goal.roundsStarted >= goal.maxRounds) {
      await service.block(session.sessionId, goalRef(session), {
        code: 'round_limit',
        message: `Goal reached its configured limit of ${goal.maxRounds} rounds.`,
      })
      syncGoal(session)
      await commitGoal(session)
    }
  } finally {
    await runnerDeps.refreshTools?.(session)
  }
}

export async function failGoalRunOnPersist(session) {
  const run = session.goalRun
  if (!run) return
  session.goalRun = null
  const service = serviceFor(session)
  try {
    const goal = service.get(session.sessionId)
    if (goal?.phase === 'active') {
      // DSH: persist failure disarms.
      service.disarm(session.sessionId)
      syncGoal(session)
      emitGoalUpdated(session)
    }
  } finally {
    await runnerDeps.refreshTools?.(session)
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export function createGoalReportTool(sessionOrGetter) {
  const getSession = typeof sessionOrGetter === 'function' ? sessionOrGetter : () => sessionOrGetter
  const session = getSession()
  const tool = createGoalReportToolV2({
    service: serviceFor(session),
    session,
    getRun: () => session?.goalRun || null,
    getTrustedToolNames: () => goalTrustedTools(session),
  })
  return {
    ...tool,
    execute: async (toolCallId, params) => {
      const outcome = await tool.execute(toolCallId, params)
      syncGoal(session)
      await persistGoal(session)
      emitGoalUpdated(session)
      return outcome
    },
  }
}

export function createGoalControlTools(session) {
  const requestAllowed = () => session?.modelAccessContext?.source !== 'shared'
  return createGoalTools({
    service: serviceFor(session),
    sessionId: session.sessionId,
    canCreate: () => requestAllowed() && hasDirectHumanTurn(session) && (!session.goal || session.goal.phase === 'complete'),
    canMutate: (action) => {
      if (!requestAllowed()) return false
      if (action === 'complete' || action === 'blocked') return hasDirectHumanTurn(session) || isGoalRoundTurn(session)
      return hasDirectHumanTurn(session)
    },
    onCreate: async () => {
      await commitGoal(session)
      resetGoalToolEvidence(session)
      scheduleGoalContinuation(session, 'execution')
    },
    onChanged: async (action, goal) => {
      await commitGoal(session)
      if (action === 'complete') {
        recordDurableGoal(session)
        return
      }
      if (action === 'resume') {
        scheduleGoalContinuation(session, 'execution')
      } else if (action === 'edit' && goal?.phase === 'active') {
        scheduleGoalContinuation(session, 'execution')
      }
    },
  })
}

export function goalPlanningToolBlockReason(_session, _toolName, _args = {}) {
  // DSH has no planning phase; no tool blocking.
  return null
}

export function goalRunSettlementToolBlockReason(_session, _toolName) {
  // DSH has no settlement window; no tool blocking.
  return null
}

// ---------------------------------------------------------------------------
// Notification hooks (approval / ask)
// ---------------------------------------------------------------------------

export async function notifyGoalAbort(session) {
  if (!session?.goalRun) return
  session.goalTerminationKind = 'abort'
  session.goalAbortGeneration = (session.goalAbortGeneration || 0) + 1
}

export async function notifyGoalApprovalRequested(session) {
  if (!session?.goal) return
  serviceFor(session).setRuntime(session.sessionId, 'waiting_approval')
  syncGoal(session)
  emitGoalUpdated(session)
}

export async function notifyGoalApprovalOutcome(session, { outcome } = {}) {
  if (!session?.goal) return
  serviceFor(session).setRuntime(session.sessionId, outcome === 'rejected' ? 'idle' : 'executing')
  syncGoal(session)
  emitGoalUpdated(session)
}

export async function notifyGoalAskRequested(session) {
  if (!session?.goal) return
  serviceFor(session).setRuntime(session.sessionId, 'waiting_input')
  syncGoal(session)
  emitGoalUpdated(session)
}

export async function notifyGoalAskOutcome(session, { skipped = false } = {}) {
  if (!session?.goal) return
  serviceFor(session).setRuntime(session.sessionId, skipped ? 'idle' : 'executing')
  syncGoal(session)
  emitGoalUpdated(session)
}

export function stopGoalForSession(session) {
  if (!session?.sessionId) return
  const service = services.get(session.sessionId)
  if (service) service.disarm(session.sessionId)
  session.goalRun = null
  session.goalContinuationPending = false
  stoppedGoalSessions.add(session)
}

export async function clearTerminalGoal(session) {
  const goal = session?.goal
  if (!goal || goal.phase !== 'complete') return false
  await serviceFor(session).clear(session.sessionId, goalRef(session), { outcome: 'completed', reason: '' })
  syncGoal(session)
  await commitGoal(session)
  return true
}

// ---------------------------------------------------------------------------
// Completion waiter (scheduled tasks)
// ---------------------------------------------------------------------------

export function hasGoalCompletionWaiter(sessionId) {
  return Boolean(goalCompletionWaiters.get(sessionId)?.size)
}

export function waitForGoalCompletion(sessionId, goalId) {
  if (!goalId) return Promise.reject(new Error('No goal was created for this run.'))
  const session = agentSessions.get(sessionId)
  if (!session) return Promise.reject(new Error('Goal session was removed before completion.'))
  let waiters = goalCompletionWaiters.get(sessionId)
  if (!waiters) { waiters = new Set(); goalCompletionWaiters.set(sessionId, waiters) }
  return new Promise((resolve, reject) => {
    let checking = false
    let finished = false
    const cleanup = () => {
      finished = true
      agentEvents.removeListener('agent_event', onEvent)
      waiters.delete(dispose)
      if (!waiters.size) goalCompletionWaiters.delete(sessionId)
    }
    const dispose = () => {
      if (finished) return
      cleanup()
      void Promise.resolve().then(async () => {
        while (!await waitForGoalIdle(session)) { /* keep waiting for abort */ }
        reject(new Error('Goal session was removed before completion.'))
      })
    }
    waiters.add(dispose)
    const check = async () => {
      if (checking || finished) return
      if (agentSessions.get(sessionId) !== session || stoppedGoalSessions.has(session)) {
        dispose()
        return
      }
      const terminal = durableTerminalGoals.get(session)
      if (terminal?.goal.id !== goalId) {
        if (session.goal?.id !== goalId) dispose()
        return
      }
      checking = true
      try {
        while (!finished) {
          const idle = await waitForGoalIdle(session)
          if (finished) return
          if (agentSessions.get(sessionId) !== session || stoppedGoalSessions.has(session)) {
            dispose()
            return
          }
          if (idle && !session.goalRun && !session.activePromptPromise) {
            cleanup()
            resolve(terminal)
            return
          }
          await new Promise((done) => setTimeout(done, GOAL_CONTINUATION_POLL_MS).unref?.())
        }
      } catch (error) {
        cleanup()
        reject(error)
      }
    }
    const onEvent = (event) => {
      if (event.sessionId === sessionId) void check()
    }
    if (stoppedGoalSessions.has(session)) dispose()
    else {
      agentEvents.on('agent_event', onEvent)
      void check()
    }
  })
}

export function goalStatusText(session) {
  return goalCommandStatusText(session?.goal || null)
}
