/**
 * Goal v2 model-facing `goal_report` tool.
 *
 * Planning/progress/evidence remain QuickForge policy; the lifecycle stays in
 * `service.mjs`. Completion is a two-stage intent: this tool only validates and
 * marks `verifying`; the runner publishes `complete` after normal run end and
 * durable persistence.
 */

import { goalReportTool } from '../tools/definitions.mjs'
import { GoalError } from './errors.mjs'

function goalReportError(message, code) {
  const error = new Error(message)
  error.goalReportCode = code
  return error
}

function result(session, text, goal) {
  return {
    content: [{ type: 'text', text }],
    details: { type: 'goal_report_result', goal: goal ?? session?.goal ?? null },
  }
}

function trustedNames(goal, getTrustedToolNames) {
  const trusted = new Map()
  for (const entry of goal?.evidence || []) {
    if (entry?.toolCallId && !trusted.has(entry.toolCallId)) trusted.set(entry.toolCallId, entry.toolName || '')
  }
  for (const [toolCallId, toolName] of getTrustedToolNames?.() || []) {
    if (toolCallId && !trusted.has(toolCallId)) trusted.set(toolCallId, toolName || '')
  }
  return trusted
}

function validateEvidence(goal, evidence, getTrustedToolNames) {
  if (!Array.isArray(evidence) || evidence.length === 0) return trustedNames(goal, getTrustedToolNames)
  const trusted = trustedNames(goal, getTrustedToolNames)
  const invalid = evidence
    .filter((entry) => entry && typeof entry === 'object' && typeof entry.toolCallId === 'string' && entry.toolCallId)
    .map((entry) => entry.toolCallId)
    .filter((toolCallId) => !trusted.has(toolCallId))
  if (invalid.length) {
    throw goalReportError(
      `goal_report evidence must reference successful tool results from this goal; unknown toolCallId: ${[...new Set(invalid)].join(', ')}. Run the verification command first.`,
      'GOAL_REPORT_EVIDENCE_UNKNOWN',
    )
  }
  return trusted
}

/**
 * @param {{
 *   service: ReturnType<import('./service.mjs').createGoalService>,
 *   session: object,
 *   getRun?: () => object|null,
 *   getTrustedToolNames?: () => Map<string,string>,
 * }} deps
 */
export function createGoalReportToolV2({ service, session, getRun = () => null, getTrustedToolNames = () => new Map() }) {
  return {
    ...goalReportTool,
    execute: async (_toolCallId, params = {}) => {
      const sessionId = session?.sessionId
      if (!sessionId) {
        throw goalReportError('No active session for goal_report.', 'GOAL_REPORT_NO_SESSION')
      }
      try {
        const goal = service.get(sessionId)
        if (!goal) throw goalReportError('There is no active goal in this session.', 'GOAL_REPORT_NO_GOAL')
        if (goal.phase !== 'active') {
          throw goalReportError(`The goal is ${goal.phase}; goal_report is no longer accepted.`, 'GOAL_REPORT_INACTIVE')
        }
        const run = getRun()
        const action = typeof params.action === 'string' ? params.action : ''
        const ref = { id: goal.id, revision: goal.revision }

        if (action === 'plan') {
          if (run && run.kind !== 'planning') {
            throw goalReportError('goal_report action="plan" is only valid during the read-only planning run.', 'GOAL_REPORT_PLAN_INVALID_STATUS')
          }
          if (goal.plan && !run) {
            throw goalReportError('The goal already has a plan; start a new run before replacing it.', 'GOAL_REPORT_PLAN_INVALID_STATUS')
          }
          const next = await service.reportPlan(sessionId, ref, {
            criteria: params.criteria,
            scope: params.scope,
            summary: params.summary,
          })
          return result(session, `Plan recorded with ${next.plan?.criteria?.length ?? 0} acceptance criteria. End this read-only planning turn; execution starts automatically after normal run end and durable persistence.`, next)
        }

        if (!goal.plan) {
          throw goalReportError('goal_report requires a submitted plan before progress or completion.', 'GOAL_REPORT_PLANNING_ONLY')
        }

        if (action === 'progress') {
          const evidence = Array.isArray(params.evidence) ? params.evidence : []
          const trustedToolNames = validateEvidence(goal, evidence, getTrustedToolNames)
          const next = await service.reportProgress(sessionId, ref, {
            summary: params.summary,
            evidence,
            criterionUpdates: params.criterionUpdates,
            trustedToolNames,
          })
          return result(session, `Goal progress recorded (revision ${next.revision}).`, next)
        }

        if (action === 'blocked' || action === 'needs_review') {
          const message = typeof params.blocker === 'string' && params.blocker.trim()
            ? params.blocker.trim()
            : action === 'needs_review'
              ? `Unable to verify criteria automatically: ${goal.plan.criteria.filter((entry) => entry.required && entry.status !== 'passed').map((entry) => entry.description).join('; ') || 'verification evidence unavailable'}`
              : ''
          if (!message) throw goalReportError('goal_report action="blocked" requires a concrete blocker.', 'GOAL_REPORT_FIELD_REQUIRED')
          const next = await service.block(sessionId, ref, {
            code: action === 'needs_review' ? 'verification_failed' : 'model_reported',
            message,
          })
          if (run) run.verificationBlocker = message
          return result(session, `Goal blocked: ${message}.`, next)
        }

        if (action === 'complete') {
          if (!run) {
            throw goalReportError('Goal completion requires an active run and its normal run-end persistence barrier.', 'GOAL_REPORT_NO_RUN')
          }
          const intent = await service.requestComplete(sessionId, ref)
          run.pendingCompletion = true
          run.pendingGoal = intent.goal
          return result(session, 'All required criteria are verified. Stop here: the goal completes automatically only after this turn ends normally and its final state is persisted.', intent.goal)
        }

        throw goalReportError(`Unsupported goal_report action: ${action || '(missing)'}`, 'GOAL_REPORT_UNSUPPORTED_ACTION')
      } catch (error) {
        if (error instanceof GoalError) {
          return {
            isError: true,
            content: [{ type: 'text', text: error.message }],
            details: { type: 'goal_report_error', code: error.code },
          }
        }
        if (error?.goalReportCode) {
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
