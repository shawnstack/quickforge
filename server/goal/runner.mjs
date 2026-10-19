/**
 * Goal v2 runner — same-session, bounded automatic continuation over the v2
 * service. The legacy runner remains available during migration; this module
 * exposes the same hook names so `goal/engine.mjs` can choose one per session.
 */

import { logger } from '../utils/logger.mjs'
import { agentEvents, emitSessionEvent, runtimePendingToolCalls } from '../agent-session-events.mjs'
import { persistSession } from '../agent-persistence.mjs'
import { getPendingApprovalForSession } from '../approval-store.mjs'
import { getPendingAskForSession } from '../ask-store.mjs'
import { agentSessions } from '../agent-session-store.mjs'
import { normalizeCapabilityPolicy } from '../agent-profile-schema.mjs'
import { isGoalActiveStatus } from '../agent-goal-state.mjs'
import { resolveGoalMaxIterations } from '../goal-settings.mjs'
import { createGoalService } from './service.mjs'
import { GoalError } from './errors.mjs'
import { createGoalReportToolV2 } from './report-tool.mjs'
import { createGoalTools } from './tools.mjs'
import { hasDirectHumanTurn, isGoalRoundTurn } from './authority.mjs'
import {
  goalCommandStatusText,
  goalPlanningPromptV2,
  goalRoundPromptV2,
} from './prompts.mjs'

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

const GOAL_READONLY_SUBAGENT_POLICIES = new Set(['readonly-research', 'safe-validation', 'review-only'])
const GOAL_READONLY_SUBAGENT_NAMES = new Set(['explore'])
const GOAL_EVIDENCE_ALLOWED_TOOLS = new Set(['run_command', 'read_file', 'grep_files'])
const GOAL_SETTLEMENT_ALLOWED_TOOLS = new Set(['read_file', 'grep_files'])
const MAX_CONSECUTIVE_GOAL_FAILURES = 2
const MAX_GOAL_NO_PROGRESS_RUNS = 2
const MAX_GOAL_PLANNING_ATTEMPTS = 3
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

export function isGoalPlanning(session) {
  if (!session) return false
  return session.goalRun?.kind === 'planning' || session.goalSettlingRun?.kind === 'planning'
}

function goalStats(session) {
  if (!session.goalStats) {
    session.goalStats = {
      consecutiveFailures: 0,
      noProgressRuns: 0,
      planningAttempts: 0,
      pauseRequested: false,
    }
  }
  return session.goalStats
}

function resetGoalStats(session) {
  session.goalStats = null
}

function goalTrustedTools(session) {
  if (!(session.goalTrustedToolCalls instanceof Map)) session.goalTrustedToolCalls = new Map()
  return session.goalTrustedToolCalls
}

function resetGoalToolEvidence(session) {
  session.goalTrustedToolCalls = new Map()
}

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

function assertQuiescent(session) {
  if (session.agent?.state?.isStreaming || session.abortPending) {
    throw requestError('The session is still running. Pause it or wait for it to finish.', 409, 'GOAL_SESSION_BUSY')
  }
  if (session.goalRun || session.goalRunSettling) {
    throw requestError('A goal run is still finishing. Try again in a moment.', 409, 'GOAL_SESSION_BUSY')
  }
  if (runtimePendingToolCalls(session).length || getPendingApprovalForSession(session.sessionId)) {
    throw requestError('A tool call is still pending. Resolve it before changing the goal.', 409, 'GOAL_SESSION_BUSY')
  }
  if (getPendingAskForSession(session.sessionId)) {
    throw requestError('A question is still waiting for your answer.', 409, 'GOAL_SESSION_BUSY')
  }
}

export async function startGoalPlanning(session, objective, requestSource = null, { attachments = [] } = {}) {
  const text = typeof objective === 'string' ? objective.trim() : ''
  if (!text) return { error: 'Usage: /goal <objective>', errorCode: 'GOAL_COMMAND_USAGE' }
  if (!isGoalModeAvailable(session, requestSource)) {
    return { error: 'Goal mode is only available in a QuickForge main chat.', errorCode: 'GOAL_COMMAND_UNAVAILABLE' }
  }
  if (session.agent?.state?.isStreaming || session.abortPending) {
    return { error: 'The session is still running. Stop it or wait for it to finish before setting a goal.', errorCode: 'GOAL_COMMAND_SESSION_RUNNING' }
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
  resetGoalStats(session)
  resetGoalToolEvidence(session)
  return { commandPrompt: goalPlanningPromptV2(session.goal) }
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
      assertQuiescent(session)
      await service.resume(session.sessionId, goalRef(session))
      await commitGoal(session)
      resetGoalStats(session)
      scheduleGoalContinuation(session, session.goal.plan ? 'execution' : 'planning')
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
      // DSH parity: edit never requires quiescence and never changes the
      // durable phase. An armed active goal keeps running — the revision
      // fence invalidates in-flight rounds and the driver continues on the
      // new revision (objective edits invalidate the old plan). A paused or
      // blocked goal stays stopped until the user explicitly resumes.
      const text = typeof objective === 'string' ? objective.trim() : ''
      if (!text) throw requestError('A revised goal requires a new objective.', 400, 'GOAL_OBJECTIVE_REQUIRED')
      await service.edit(session.sessionId, goalRef(session), { objective: text })
      await commitGoal(session)
      resetGoalStats(session)
      resetGoalToolEvidence(session)
      if (session.goal?.phase === 'active') {
        scheduleGoalContinuation(session, 'planning')
      }
      return session.goal
    }
    if (action === 'extend_resume') {
      const { goalId, expectedRevision } = options
      if (typeof goalId !== 'string' || !goalId || !Number.isSafeInteger(expectedRevision) || expectedRevision <= 0) {
        throw requestError('extend_resume requires goalId and a positive integer expectedRevision only.', 400, 'GOAL_ACTION_INVALID')
      }
      assertQuiescent(session)
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
      resetGoalStats(session)
      scheduleGoalContinuation(session, session.goal.plan ? 'execution' : 'planning')
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

export async function beginGoalRun(session, kind = 'execution') {
  if (!session?.goal) return null
  if (session.goalRun) return session.goalRun
  const service = serviceFor(session)
  let round = session.goal.roundsStarted
  if (kind === 'execution') {
    const admitted = await service.admitRound(session.sessionId, goalRef(session))
    round = admitted.round
    syncGoal(session)
    if (!await persistGoal(session)) {
      throw requestError('Could not persist the goal round.', 500, 'GOAL_PERSIST_FAILED')
    }
    emitGoalUpdated(session)
  }
  const goal = session.goal
  const run = {
    kind,
    startedAt: Date.now(),
    signature: JSON.stringify({ plan: goal.plan, evidence: goal.evidence, roundsStarted: goal.roundsStarted }),
    goalId: goal.id,
    iteration: round,
    messageStart: session.agent?.state?.messages?.length || 0,
    pendingCompletion: false,
  }
  session.goalRun = run
  service.setRuntime(session.sessionId, kind === 'planning' ? 'planning' : 'executing')
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

function canStartGoalRun(session, kind) {
  if (agentSessions.get(session.sessionId) !== session) return false
  const goal = session.goal
  if (!goal || goal.phase !== 'active') return false
  if (serviceFor(session).getActivation(session.sessionId) !== 'armed') return false
  if (goal.roundsStarted >= goal.maxRounds) return false
  if (session.goalRun || session.goalContinuationPending) return false
  if (session.agent?.state?.isStreaming || session.abortPending) return false
  if (runtimePendingToolCalls(session).length) return false
  if (getPendingApprovalForSession(session.sessionId) || getPendingAskForSession(session.sessionId)) return false
  if (kind === 'planning') return !goal.plan
  return Boolean(goal.plan)
}

async function startGoalRun(session, kind) {
  if (!canStartGoalRun(session, kind)) return false
  const run = await beginGoalRun(session, kind)
  if (!run) return false
  const round = session.goal.roundsStarted
  const planning = kind === 'planning'
  const promptText = planning ? goalPlanningPromptV2(session.goal) : goalRoundPromptV2(session.goal, round)
  const previous = {
    name: session.activeCommandName,
    permissions: session.activeCommandPermissions,
    prompt: session.activeCommandPrompt,
  }
  session.activeCommandName = planning ? 'plan' : 'goal'
  session.activeCommandPermissions = planning ? { ...GOAL_PLANNING_PERMISSIONS } : null
  session.activeCommandPrompt = promptText
  session.activeCommandToken = run
  const turnId = runnerDeps.beginTurn(session.sessionId)
  logger.info(`Starting goal ${kind} run for session ${session.sessionId} (round ${round}/${session.goal.maxRounds})`, {
    sessionId: session.sessionId,
    kind,
    round,
  })
  let promptPromise = null
  try {
    promptPromise = session.agent.prompt({
      role: 'user',
      content: planning ? `重新规划目标（第 ${goalStats(session).planningAttempts + 1} 次）` : `继续执行目标（第 ${round}/${session.goal.maxRounds} 轮）`,
      timestamp: Date.now(),
      metadata: { quickforgeGoalRun: kind, quickforgeGoalRound: round },
    })
    session.activePromptPromise = promptPromise
    await promptPromise
  } catch (error) {
    logger.error(`Goal ${kind} run failed to start for session ${session.sessionId}:`, error, { sessionId: session.sessionId })
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

async function pauseGoalWithBlocker(session, code, message = code) {
  const goal = session.goal
  if (!goal || goal.phase !== 'active') return false
  const service = serviceFor(session)
  try {
    await service.block(session.sessionId, goalRef(session), { code, message })
    await commitGoal(session)
    return true
  } catch (error) {
    logger.warn(`Could not block goal for session ${session.sessionId}: ${error?.message || String(error)}`)
    return false
  }
}

export async function finishGoalRun(session, info = {}) {
  const run = session.goalRun
  if (!run) return
  const abortGeneration = session.goalAbortGeneration || 0
  session.goalRun = null
  session.goalRunSettling = true
  session.goalSettlingRun = run
  const service = serviceFor(session)
  try {
    const goal = service.get(session.sessionId)
    if (!goal) return
    if (goal.phase === 'complete') {
      syncGoal(session)
      await commitGoal(session)
      return
    }
    const endStatus = info.status || 'idle'
    if (endStatus === 'aborted' || session.abortPending) {
      if (goal.phase === 'active') await service.pause(session.sessionId, goalRef(session))
      syncGoal(session)
      await commitGoal(session)
      return
    }
    if (goalStats(session).pauseRequested) {
      goalStats(session).pauseRequested = false
      if (goal.phase === 'active') await service.pause(session.sessionId, goalRef(session))
      syncGoal(session)
      await commitGoal(session)
      return
    }
    if (run.pendingCompletion) {
      const check = service.get(session.sessionId)
      if (check?.phase === 'active') {
        await service.complete(session.sessionId, goalRef(session), { by: 'verified' })
        syncGoal(session)
        recordDurableGoal(session)
        await commitGoal(session)
        return
      }
    }
    if (run.verificationBlocker) {
      if (goal.phase === 'active') {
        await service.block(session.sessionId, goalRef(session), { code: 'verification_failed', message: run.verificationBlocker })
      }
      syncGoal(session)
      await commitGoal(session)
      return
    }
    if (endStatus === 'error' || info.error) {
      const stats = goalStats(session)
      stats.consecutiveFailures += 1
      stats.noProgressRuns += 1
      if (stats.consecutiveFailures >= MAX_CONSECUTIVE_GOAL_FAILURES) {
        await pauseGoalWithBlocker(session, 'repeated_failures')
        return
      }
      await commitGoal(session)
      scheduleGoalContinuation(session, run.kind)
      return
    }
    goalStats(session).consecutiveFailures = 0
    if (run.kind === 'planning') {
      if (goal.plan) {
        goalStats(session).planningAttempts = 0
        syncGoal(session)
        await commitGoal(session)
        scheduleGoalContinuation(session, 'execution')
        return
      }
      const stats = goalStats(session)
      stats.planningAttempts += 1
      if (stats.planningAttempts >= MAX_GOAL_PLANNING_ATTEMPTS) {
        await pauseGoalWithBlocker(session, 'planning_incomplete')
        return
      }
      await commitGoal(session)
      scheduleGoalContinuation(session, 'planning')
      return
    }
    const signature = JSON.stringify({ plan: goal.plan, evidence: goal.evidence, roundsStarted: goal.roundsStarted })
    const stats = goalStats(session)
    if (signature === run.signature) stats.noProgressRuns += 1
    else stats.noProgressRuns = 0
    if (stats.noProgressRuns >= MAX_GOAL_NO_PROGRESS_RUNS) {
      await pauseGoalWithBlocker(session, 'no_progress')
      return
    }
    syncGoal(session)
    await commitGoal(session)
    if ((session.goalAbortGeneration || 0) !== abortGeneration) return
    scheduleGoalContinuation(session, 'execution')
  } finally {
    session.goalSettlingRun = null
    session.goalRunSettling = false
    await runnerDeps.refreshTools?.(session)
  }
}

function recordDurableGoal(session) {
  if (session.goal?.phase === 'complete') {
    durableTerminalGoals.set(session, { goal: session.goal, messages: [...(session.agent?.state?.messages || [])] })
  }
}

export async function failGoalRunOnPersist(session) {
  const run = session.goalRun
  if (!run) return
  session.goalRun = null
  session.goalRunSettling = true
  session.goalSettlingRun = run
  try {
    const goal = serviceFor(session).get(session.sessionId)
    if (goal?.phase === 'active') {
      await serviceFor(session).block(session.sessionId, goalRef(session), { code: 'persist_failed', message: 'The goal state could not be persisted.' })
      syncGoal(session)
      emitGoalUpdated(session)
    }
  } finally {
    session.goalSettlingRun = null
    session.goalRunSettling = false
    await runnerDeps.refreshTools?.(session)
  }
}

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
    // DSH-shaped model autonomy: a direct human turn can create/edit/pause or
    // re-arm; an admitted goal round can report blocked. `goal_report` remains
    // the evidence-bearing completion path for goal rounds.
    canCreate: () => requestAllowed() && hasDirectHumanTurn(session) && (!session.goal || session.goal.phase === 'complete'),
    canMutate: (action) => {
      if (!requestAllowed()) return false
      if (action === 'complete' || action === 'blocked') return hasDirectHumanTurn(session) || isGoalRoundTurn(session)
      return hasDirectHumanTurn(session)
    },
    onCreate: async () => {
      await commitGoal(session)
      resetGoalStats(session)
      resetGoalToolEvidence(session)
      scheduleGoalContinuation(session, 'planning')
    },
    onChanged: async (action, goal) => {
      await commitGoal(session)
      if (action === 'complete') {
        recordDurableGoal(session)
        return
      }
      if (action === 'resume') {
        resetGoalStats(session)
        scheduleGoalContinuation(session, goal?.plan ? 'execution' : 'planning')
      } else if (action === 'edit' && goal?.phase === 'active') {
        scheduleGoalContinuation(session, goal.plan ? 'execution' : 'planning')
      }
    },
  })
}

export function goalPlanningToolBlockReason(session, toolName, args = {}) {
  if (!isGoalPlanning(session)) return null
  if (!GOAL_PLANNING_ALLOWED_TOOLS.has(toolName)) {
    return `Goal planning is read-only and cannot use ${toolName}.`
  }
  if (toolName === 'run_subagent') {
    const requested = args?.subagent
    if (typeof requested === 'string') {
      const name = requested.trim().toLowerCase()
      if (!GOAL_READONLY_SUBAGENT_NAMES.has(name)) return `Goal planning only allows read-only subagents; "${requested}" is not read-only.`
      return null
    }
    if (requested && typeof requested === 'object') {
      const policy = normalizeCapabilityPolicy(requested.capabilityPolicy || 'readonly-research', Array.isArray(requested.tools) ? requested.tools : [])
      if (!GOAL_READONLY_SUBAGENT_POLICIES.has(policy)) return `Goal planning only allows read-only subagents (requested policy: ${policy}).`
    }
  }
  return null
}

export function goalRunSettlementToolBlockReason(session, toolName) {
  if (!session?.goalRun?.pendingCompletion) return null
  if (GOAL_SETTLEMENT_ALLOWED_TOOLS.has(toolName) || toolName === 'ask_user') return null
  return 'The goal result was already reported. The rest of this turn is read-only; end the turn and let the server settle.'
}

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
          if (idle && !session.goalRun && !session.goalRunSettling && !session.activePromptPromise) {
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
