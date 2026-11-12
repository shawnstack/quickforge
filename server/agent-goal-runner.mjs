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
 *
 * Split note: this file is now a thin re-export facade. The implementation
 * lives in the single-responsibility goal-* modules below; the 26 exported
 * names (and every internal behavior) are unchanged.
 */

export {
  GOAL_PLANNING_PERMISSIONS,
  GOAL_PLANNING_ALLOWED_TOOLS,
} from './goal-policy.mjs'
export {
  isGoalModeAvailable,
  sessionGoal,
  recordGoalToolExecution,
} from './goal-session-state.mjs'
export {
  hasGoalCompletionWaiter,
  waitForGoalCompletion,
} from './goal-waiters.mjs'
export {
  goalPlanningPrompt,
  goalContinuationPrompt,
} from './goal-prompts.mjs'
export {
  configureGoalRunner,
  beginGoalRun,
  finishGoalRun,
  failGoalRunOnPersist,
  startGoalPlanning,
} from './goal-run-orchestration.mjs'
export {
  handleGoalAction,
  clearTerminalGoal,
  notifyGoalApprovalRequested,
  notifyGoalApprovalOutcome,
  notifyGoalAskRequested,
  notifyGoalAskOutcome,
  notifyGoalAbort,
  stopGoalForSession,
} from './goal-actions.mjs'
export {
  createGoalReportTool,
  goalPlanningToolBlockReason,
  goalRunSettlementToolBlockReason,
  isGoalPlanning,
} from './goal-report-tools.mjs'
