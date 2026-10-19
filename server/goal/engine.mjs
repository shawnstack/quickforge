/**
 * Goal engine facade.
 *
 * New goals run through the v2 engine when the deployment/session opts in;
 * legacy goals keep the old runner so existing sessions and tests stay valid
 * during the migration. The chosen engine is sticky on the session: once a v2
 * goal exists, every later hook must use v2.
 */

import * as legacy from '../agent-goal-runner.mjs'
import * as v2 from './runner.mjs'
import { agentSessions } from '../agent-session-store.mjs'

export const GOAL_PLANNING_PERMISSIONS = v2.GOAL_PLANNING_PERMISSIONS

export function resolveGoalEngine(session) {
  if (!session) return 'legacy'
  if (session.goal?.phase) return 'v2'
  if (session.goalEngine === 'v2') return 'v2'
  return 'legacy'
}

export function configureGoalRunner(deps = {}) {
  legacy.configureGoalRunner(deps)
  v2.configureGoalRunner(deps)
}

export function isGoalModeAvailable(session, requestSource = null) {
  return v2.isGoalModeAvailable(session, requestSource)
}

export function sessionGoal(session) {
  return session?.goal || null
}

export function isGoalPlanning(session) {
  return resolveGoalEngine(session) === 'v2' ? v2.isGoalPlanning(session) : legacy.isGoalPlanning(session)
}

export async function startGoalPlanning(session, objective, requestSource = null, options = {}) {
  // A brand-new session follows the deployment setting until its first goal
  // pins the engine. Explicit session/config choices always win.
  if (session && !session.goal && !session.goalEngine) {
    try {
      const { readGoalEngine } = await import('../goal-settings.mjs')
      const engine = await readGoalEngine()
      if (engine === 'v2') session.goalEngine = 'v2'
    } catch {
      // settings read failure keeps the legacy default
    }
  }
  return resolveGoalEngine(session) === 'v2'
    ? v2.startGoalPlanning(session, objective, requestSource, options)
    : legacy.startGoalPlanning(session, objective, requestSource, options)
}

export function handleGoalAction(session, action, objective, requestSource = null, options = {}) {
  return resolveGoalEngine(session) === 'v2'
    ? v2.handleGoalAction(session, action, objective, requestSource, options)
    : legacy.handleGoalAction(session, action, objective, requestSource, options)
}

export function beginGoalRun(session, kind = 'execution') {
  return resolveGoalEngine(session) === 'v2'
    ? v2.beginGoalRun(session, kind)
    : legacy.beginGoalRun(session, kind)
}

export function finishGoalRun(session, info = {}) {
  return resolveGoalEngine(session) === 'v2'
    ? v2.finishGoalRun(session, info)
    : legacy.finishGoalRun(session, info)
}

export function failGoalRunOnPersist(session) {
  return resolveGoalEngine(session) === 'v2'
    ? v2.failGoalRunOnPersist(session)
    : legacy.failGoalRunOnPersist(session)
}

export function createGoalReportTool(sessionOrGetter) {
  const session = typeof sessionOrGetter === 'function' ? sessionOrGetter() : sessionOrGetter
  return resolveGoalEngine(session) === 'v2'
    ? v2.createGoalReportTool(sessionOrGetter)
    : legacy.createGoalReportTool(sessionOrGetter)
}

export function recordGoalToolExecution(session, event = {}) {
  return resolveGoalEngine(session) === 'v2'
    ? v2.recordGoalToolExecution(session, event)
    : legacy.recordGoalToolExecution(session, event)
}

export function goalPlanningToolBlockReason(session, toolName, args = {}) {
  return resolveGoalEngine(session) === 'v2'
    ? v2.goalPlanningToolBlockReason(session, toolName, args)
    : legacy.goalPlanningToolBlockReason(session, toolName, args)
}

export function createGoalControlTools(session) {
  return resolveGoalEngine(session) === 'v2' ? v2.createGoalControlTools(session) : []
}

export function goalRunSettlementToolBlockReason(session, toolName) {
  return resolveGoalEngine(session) === 'v2'
    ? v2.goalRunSettlementToolBlockReason(session, toolName)
    : legacy.goalRunSettlementToolBlockReason(session, toolName)
}

export function notifyGoalAbort(session) {
  return resolveGoalEngine(session) === 'v2' ? v2.notifyGoalAbort(session) : legacy.notifyGoalAbort(session)
}

export function notifyGoalApprovalRequested(session) {
  return resolveGoalEngine(session) === 'v2' ? v2.notifyGoalApprovalRequested(session) : legacy.notifyGoalApprovalRequested(session)
}

export function notifyGoalApprovalOutcome(session, outcome) {
  return resolveGoalEngine(session) === 'v2' ? v2.notifyGoalApprovalOutcome(session, outcome) : legacy.notifyGoalApprovalOutcome(session, outcome)
}

export function notifyGoalAskRequested(session) {
  return resolveGoalEngine(session) === 'v2' ? v2.notifyGoalAskRequested(session) : legacy.notifyGoalAskRequested(session)
}

export function notifyGoalAskOutcome(session, outcome) {
  return resolveGoalEngine(session) === 'v2' ? v2.notifyGoalAskOutcome(session, outcome) : legacy.notifyGoalAskOutcome(session, outcome)
}

export function stopGoalForSession(session) {
  return resolveGoalEngine(session) === 'v2' ? v2.stopGoalForSession(session) : legacy.stopGoalForSession(session)
}

export function clearTerminalGoal(session) {
  return resolveGoalEngine(session) === 'v2' ? v2.clearTerminalGoal(session) : legacy.clearTerminalGoal(session)
}

export function hasGoalCompletionWaiter(sessionId) {
  return v2.hasGoalCompletionWaiter(sessionId) || legacy.hasGoalCompletionWaiter(sessionId)
}

export function waitForGoalCompletion(sessionId, goalId) {
  const session = agentSessions.get(sessionId)
  return session?.goal?.phase
    ? v2.waitForGoalCompletion(sessionId, goalId)
    : legacy.waitForGoalCompletion(sessionId, goalId)
}

export function goalStatusText(session) {
  return v2.goalStatusText(session)
}
