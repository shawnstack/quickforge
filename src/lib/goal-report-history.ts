import type { AppTextKey } from './i18n'

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

const actionKeys: Record<string, AppTextKey> = {
  plan: 'goalReportPlan',
  progress: 'goalReportProgress',
  blocked: 'goalReportBlocked',
  needs_review: 'goalReportReview',
  complete: 'goalReportComplete',
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
  const criteria = Array.isArray(goal.criteria)
    ? goal.criteria.map((item) => text(record(item).description)).filter(Boolean) : []
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
  const outputText = content.map((block) => {
    const item = record(block)
    return item.type === 'text' ? text(item.text) : ''
  }).filter(Boolean).join('\n')
  let jsonOutput = false
  try { JSON.parse(outputText); jsonOutput = true } catch { /* Legacy prose is safe plain text. */ }
  return {
    status, summaryKey, resultKey,
    actionKey: Object.hasOwn(actionKeys, action) ? actionKeys[action] : 'goalReportAction' as AppTextKey,
    action, summary, criteria, scope, blocker: text(goal.blocker),
    // Legacy/non-plan prose remains readable, but is not interpreted as state.
    outputText: recordedPlan || jsonOutput || status === 'running' || status === 'called' ? '' : outputText,
  }
}
