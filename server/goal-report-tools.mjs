/**
 * goal_report tool — the isGoalPlanning predicate, trusted-evidence
 * validation, applyGoalReport and the tool/block-reason factories. Carved
 * verbatim from agent-goal-runner.mjs (zero behavior change).
 */

import { normalizeCapabilityPolicy } from './agent-profile-schema.mjs'
import { goalReportTool } from './tools/definitions.mjs'
import * as goalState from './agent-goal-state.mjs'
import { GOAL_PLANNING_ALLOWED_TOOLS, GOAL_READONLY_SUBAGENT_NAMES, GOAL_READONLY_SUBAGENT_POLICIES, GOAL_SETTLEMENT_ALLOWED_TOOLS } from './goal-policy.mjs'
import { goalStats, goalTrustedTools } from './goal-session-state.mjs'
import { commitGoal } from './goal-run-orchestration.mjs'
import { GOAL_CHAT_OUTPUT_RULES } from './goal-prompts.mjs'


export function isGoalPlanning(session) {
  return session?.goal?.status === 'planning' || session?.goalRun?.kind === 'planning' || session?.goalSettlingRun?.kind === 'planning'
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

function goalReportError(message, code) {
  const error = new Error(message)
  error.statusCode = 400
  error.goalReportCode = code
  return error
}

function requireText(value, field, max) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw goalReportError(`goal_report requires a non-empty ${field}.`, 'GOAL_REPORT_FIELD_REQUIRED')
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
      'GOAL_REPORT_EVIDENCE_UNKNOWN',
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
  if (!goal) throw goalReportError('There is no active goal in this session.', 'GOAL_REPORT_NO_GOAL')
  if (!goalState.isGoalActiveStatus(goal.status)) {
    throw goalReportError(`The goal is ${goal.status}; goal_report is no longer accepted.`, 'GOAL_REPORT_INACTIVE')
  }
  if (session.goalRun?.pendingDisposition) {
    throw goalReportError('The goal result was already reported for this run. Stop here; settlement requires normal run end and durable persistence.', 'GOAL_REPORT_ALREADY_REPORTED')
  }
  const action = typeof params.action === 'string' ? params.action : ''
  const planning = goal.status === 'planning'

  if (action === 'plan') {
    if (!planning) throw goalReportError(`goal_report action="plan" is only valid while planning; the goal is ${goal.status}.`, 'GOAL_REPORT_PLAN_INVALID_STATUS')
    const criteria = Array.isArray(params.criteria) ? params.criteria : []
    if (criteria.length === 0) {
      throw goalReportError('goal_report action="plan" requires at least one acceptance criterion.', 'GOAL_REPORT_PLAN_NO_CRITERIA')
    }
    if (criteria.length > goalState.GOAL_MAX_CRITERIA) {
      throw goalReportError(`goal_report supports at most ${goalState.GOAL_MAX_CRITERIA} acceptance criteria.`, 'GOAL_REPORT_PLAN_TOO_MANY_CRITERIA')
    }
    const summary = requireText(params.summary, 'summary', goalState.GOAL_MAX_SUMMARY_CHARS)
    const next = goalState.applyGoalPlan(goal, { criteria, scope: params.scope, summary })
    if (next.criteria.length === 0) throw goalReportError('goal_report action="plan" requires criteria with a description.', 'GOAL_REPORT_PLAN_CRITERIA_DESCRIPTION')
    goalStats(session).planningAttempts = 0
    await commitGoal(session, next)
    return goalReportResult(session, `Plan recorded with ${next.criteria.length} acceptance criteria. End this read-only planning turn; execution starts automatically after normal run end and durable persistence.`)
  }

  if (isGoalPlanning(session) || (goal.status === 'awaiting_confirmation' && goal.planConfirmed !== true)) {
    const guidance = planning
      ? 'use action="plan".'
      : 'The plan is already submitted. End this read-only planning turn; execution starts automatically after normal run end and durable persistence.'
    throw goalReportError(`goal_report action="${action}" is not valid while planning; ${guidance}`, 'GOAL_REPORT_PLANNING_ONLY')
  }

  const evidence = Array.isArray(params.evidence) ? params.evidence : []
  const trustedToolNames = validateEvidenceToolCalls(session, goal, evidence)
  const progressed = goalState.applyGoalProgress(goal, {
    summary: params.summary,
    evidence,
    criterionUpdates: params.criterionUpdates,
    trustedToolNames,
  })
  if (progressed.errors.length > 0) throw goalReportError(`goal_report rejected: ${progressed.errors.join('; ')}`, 'GOAL_REPORT_REJECTED')
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
      throw goalReportError(`goal_report action="complete" rejected: ${check.reason}. Verify the criteria with real tool results, or use action="blocked"/"needs_review".`, 'GOAL_REPORT_COMPLETE_REJECTED')
    }
    return settleGoalReportDisposition(session, next, 'completed',
      `All required criteria are verified. Stop here: the goal completes automatically only after this turn ends normally and its final state is persisted.\n${GOAL_CHAT_OUTPUT_RULES}`)
  }

  throw goalReportError(`Unsupported goal_report action: ${action || '(missing)'}`, 'GOAL_REPORT_UNSUPPORTED_ACTION')
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
  throw goalReportError('Goal completion/review requires an active run and its normal run-end persistence barrier.', 'GOAL_REPORT_NO_RUN')
}

export function createGoalReportTool(sessionOrGetter) {
  const getSession = typeof sessionOrGetter === 'function' ? sessionOrGetter : () => sessionOrGetter
  return {
    ...goalReportTool,
    execute: async (_toolCallId, params) => {
      const session = getSession()
      if (!session) throw goalReportError('No active session for goal_report.', 'GOAL_REPORT_NO_SESSION')
      try {
        return await applyGoalReport(session, params || {})
      } catch (error) {
        // goal_report validation failures become returned error results instead
        // of throws: pi-agent-core keeps only the message of a thrown tool
        // error, while a returned result preserves the details carrying the
        // stable code. Anything unexpected still propagates unchanged.
        if (error?.goalReportCode && error.statusCode === 400) {
          return {
            isError: true,
            content: [{ type: 'text', text: error.message }],
            details: { type: 'goal_report_error', code: error.goalReportCode },
          }
        }
        throw error
      }
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
