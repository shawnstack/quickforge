import { t, type AppTextKey } from './i18n'

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

type GoalReportCriterionStatus = 'pending' | 'passed' | 'failed' | 'needs_review'

function goalReportCriterionStatus(value: unknown): GoalReportCriterionStatus {
  const status = text(value)
  return status === 'passed' || status === 'failed' || status === 'needs_review' ? status : 'pending'
}

const actionKeys: Record<string, AppTextKey> = {
  plan: 'goalReportPlan',
  progress: 'goalReportProgress',
  blocked: 'goalReportBlocked',
  needs_review: 'goalReportReview',
  complete: 'goalReportComplete',
}

// Machine error codes the server reports on a rejected goal_report call
// (details.type === 'goal_report_error'); a known code replaces the server's
// English reason text with localized copy in the history view.
const GOAL_REPORT_ERROR_KEY: Record<string, AppTextKey> = {
  GOAL_REPORT_FIELD_REQUIRED: 'goalReportErrorFieldRequired',
  GOAL_REPORT_EVIDENCE_UNKNOWN: 'goalReportErrorEvidenceUnknown',
  GOAL_REPORT_NO_GOAL: 'goalReportErrorNoGoal',
  GOAL_REPORT_INACTIVE: 'goalReportErrorInactive',
  GOAL_REPORT_ALREADY_REPORTED: 'goalReportErrorAlreadyReported',
  GOAL_REPORT_PLAN_INVALID_STATUS: 'goalReportErrorPlanInvalidStatus',
  GOAL_REPORT_PLAN_NO_CRITERIA: 'goalReportErrorPlanNoCriteria',
  GOAL_REPORT_PLAN_TOO_MANY_CRITERIA: 'goalReportErrorPlanTooManyCriteria',
  GOAL_REPORT_PLAN_CRITERION_DESCRIPTION: 'goalReportErrorPlanCriterionDescription',
  GOAL_REPORT_PLANNING_ONLY: 'goalReportErrorPlanningOnly',
  GOAL_REPORT_REJECTED: 'goalReportErrorRejected',
  GOAL_REPORT_COMPLETE_REJECTED: 'goalReportErrorCompleteRejected',
  GOAL_REPORT_UNSUPPORTED_ACTION: 'goalReportErrorUnsupportedAction',
  GOAL_REPORT_NO_RUN: 'goalReportErrorNoRun',
  GOAL_REPORT_NO_SESSION: 'goalReportErrorNoSession',
}

/** A tool-result audit snapshot, never the live Goal or an action surface. */
export function buildGoalReportHistoryViewModel(params: unknown, result: unknown, isStreaming = false) {
  const input = record(params)
  const output = record(result)
  const details = record(output.details)
  const action = text(input.action)
  const status: 'error' | 'running' | 'done' | 'called' = output.isError === true || details.aborted === true || details.timedOut === true
    ? 'error' : isStreaming ? 'running' : result ? 'done' : 'called'
  const goal = status === 'done' && details.type === 'goal_report_result' ? record(details.goal) : {}
  const summary = text(goal.summary)
  const criteriaDetails: Array<{ description: string; status: GoalReportCriterionStatus }> = Array.isArray(goal.criteria)
    ? goal.criteria.map((item) => {
        const rec = record(item)
        const description = text(rec.description)
        return { description, status: goalReportCriterionStatus(rec.status) }
      }).filter((item) => item.description)
    : []
  const criteria = criteriaDetails.map((item) => item.description)
  const scope = texts(goal.scope)
  // Do not infer a recorded plan from request arguments or a legacy prose result.
  const recordedPlan = action === 'plan' && Boolean(summary) && criteria.length > 0
  const summaryKey: AppTextKey = status === 'error' ? 'goalReportFailed'
    : status === 'running' ? 'goalReportRunning'
      : recordedPlan ? 'goalReportPlanRecorded' : 'goalReportTitle'
  const historicalWaiting = recordedPlan && goal.status === 'awaiting_confirmation'
  const resultKey: AppTextKey = historicalWaiting ? 'goalReportWasWaiting'
    : status === 'done' ? 'goalReportHistoricalResult' : 'goalReportNoResult'
  const content = Array.isArray(output.content) ? output.content : []
  let outputText = content.map((block) => {
    const item = record(block)
    return item.type === 'text' ? text(item.text) : ''
  }).filter(Boolean).join('\n')
  // A machine-rejected goal_report carries its reason code in details; a known
  // code shows localized copy instead of the server's English sentence. Missing
  // or unknown codes (legacy data, aborted/timed-out calls) pass through as-is.
  const errorCode = details.type === 'goal_report_error' ? text(details.code) : ''
  const errorKey = status === 'error' && errorCode ? GOAL_REPORT_ERROR_KEY[errorCode] : undefined
  if (errorKey) outputText = t(errorKey)
  let jsonOutput = false
  try { JSON.parse(outputText); jsonOutput = true } catch { /* Legacy prose is safe plain text. */ }
  return {
    status, summaryKey, resultKey,
    actionKey: Object.hasOwn(actionKeys, action) ? actionKeys[action] : 'goalReportAction' as AppTextKey,
    action, summary, criteria, criteriaDetails, scope, blocker: text(goal.blocker),
    // Legacy/non-plan prose remains readable, but is not interpreted as state.
    outputText: recordedPlan || jsonOutput || status === 'running' || status === 'called' ? '' : outputText,
  }
}
