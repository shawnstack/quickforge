import { t, type AppTextKey } from '@/lib/i18n'
import {
  goalAcceptanceCheck,
  goalCanCancel,
  goalCanPause,
  goalCanResume,
  goalDurationMinutes,
  goalIsEditable,
  isGoalSpinning,
  type GoalCriterionStatus,
  type GoalEvidence,
  type GoalState,
  type GoalStatus,
} from '@/lib/goal'

/**
 * Goal card viewmodel — a pure projection of the session goal for the surfaces
 * that mirror it (summary section, pinned summary, inspector). It owns no
 * server state: callers read the authoritative ServerAgent goal and post goal
 * actions themselves.
 *
 * The projection never invents progress: it shows the server-provided status,
 * objective, acceptance criteria, scope, budget/usage and evidence. It reuses
 * the approval/ask cards for tool approval and user questions — this card
 * never authorizes tools.
 */

export type GoalCardTone = 'info' | 'active' | 'warning' | 'success' | 'danger'

export type GoalCardCriteriaView = {
  id: string
  description: string
  required: boolean
  status: GoalCriterionStatus
  statusKey: string
  evidenceCount: number
}

export type GoalCardViewModel = {
  id: string
  revision: number
  status: GoalStatus
  statusKey: string
  tone: GoalCardTone
  spinning: boolean
  objective: string
  summary: string
  blocker: string
  /** Human-readable explanation of the blocker (e.g. budget exhaustion). */
  blockerHint: string
  editable: boolean
  pausable: boolean
  resumable: boolean
  cancellable: boolean
  /** The server would reject `accept` (a required criterion failed). */
  acceptBlocked: boolean
  /** `needs_review`: continuing hands the goal back to the model. */
  continuing: boolean
  noteKeys: string[]
  criteria: GoalCardCriteriaView[]
  scope: string[]
  budget: { iterations: number; minutes: number }
  usage: { iterations: number; minutes: number }
  evidence: GoalEvidence[]
}

const STATUS_KEY: Record<GoalStatus, string> = {
  planning: 'goalStatusPlanning',
  awaiting_confirmation: 'goalStatusAwaitingConfirmation',
  running: 'goalStatusRunning',
  verifying: 'goalStatusVerifying',
  awaiting_input: 'goalStatusAwaitingInput',
  awaiting_approval: 'goalStatusAwaitingApproval',
  pausing: 'goalStatusPausing',
  paused: 'goalStatusPaused',
  blocked: 'goalStatusBlocked',
  needs_review: 'goalStatusNeedsReview',
  completed: 'goalStatusCompleted',
  failed: 'goalStatusFailed',
  cancelled: 'goalStatusCancelled',
}

const CRITERION_STATUS_KEY: Record<GoalCriterionStatus, string> = {
  pending: 'goalCriterionPending',
  passed: 'goalCriterionPassed',
  failed: 'goalCriterionFailed',
  needs_review: 'goalCriterionNeedsReview',
}

// Machine blocker codes the server sets when it pauses a goal (e.g. an exhausted
// budget). The raw code is not user-facing, so map the ones we know and fall
// back to the server text for everything else.
const BLOCKER_KEY: Record<string, string> = {
  iteration_budget: 'goalBlockerIterationBudget',
  duration_budget: 'goalBlockerDurationBudget',
  persist_failed: 'goalBlockerPersistFailed',
  user_aborted: 'goalBlockerUserAborted',
  planning_failed: 'goalBlockerPlanningFailed',
  repeated_failures: 'goalBlockerRepeatedFailures',
  verification_failed: 'goalBlockerVerificationFailed',
  planning_incomplete: 'goalBlockerPlanningIncomplete',
  no_progress: 'goalBlockerNoProgress',
  run_did_not_finish: 'goalBlockerRunDidNotFinish',
  continuation_failed: 'goalBlockerContinuationFailed',
  approval_timeout: 'goalBlockerApprovalTimeout',
  approval_rejected: 'goalBlockerApprovalRejected',
  ask_skipped: 'goalBlockerAskSkipped',
  // The server's state-recovery path persists this exact English sentence as
  // the blocker instead of a machine code, so match the sentence itself.
  'Server restarted while the goal was in flight; resume to continue.': 'goalBlockerRestarted',
}

// Frontend mirror of the fixed budget-exhaustion hint the server writes
// (GOAL_BUDGET_HINT in server/agent-goal-runner.mjs). Exact equality swaps the
// English sentence for localized copy; every other hint passes through.
const GOAL_BUDGET_HINT_TEXT = 'Budget exhausted. Use extend_resume to add the default budget to exhausted limits and continue this goal; accumulated usage and progress are preserved.'

/** Localize the fixed budget hint; any other server hint passes through as-is. */
function localizedGoalBlockerHint(hint: string | null | undefined): string {
  return hint === GOAL_BUDGET_HINT_TEXT ? t('goalBlockerBudgetHint') : (hint ?? '')
}

function blockerText(goal: GoalState): string {
  const blocker = goal.blocker ?? ''
  const key = BLOCKER_KEY[blocker]
  return key ? t(key as AppTextKey) : blocker
}

function toneForStatus(status: GoalStatus): GoalCardTone {
  if (status === 'completed') return 'success'
  if (status === 'failed' || status === 'cancelled') return 'danger'
  if (status === 'blocked' || status === 'needs_review') return 'warning'
  if (status === 'awaiting_confirmation' || status === 'planning') return 'info'
  return 'active'
}

function noteKeysForStatus(goal: GoalState): string[] {
  switch (goal.status) {
    case 'awaiting_confirmation':
      return ['goalConfirmNote']
    case 'running':
    case 'verifying':
      return ['goalPauseCancelNote', 'goalScopeChangeNote']
    case 'awaiting_input':
      return ['goalAwaitingInputNote']
    case 'awaiting_approval':
      return ['goalAwaitingApprovalNote']
    case 'pausing':
      return ['goalPausingNote']
    case 'paused':
    case 'blocked':
      return ['goalPauseCancelNote', 'goalResumeNote', 'goalScopeChangeNote']
    case 'needs_review':
      // Both actions are always offered; the note explains what each one means.
      // A failed required criterion disables acceptance and says why.
      return ['goalNeedsReviewContinueNote']
    case 'completed':
      return ['goalCompletedNote']
    case 'failed':
      return ['goalFailedNote']
    case 'cancelled':
      return ['goalCancelledNote']
    default:
      return []
  }
}

/** Pure projection of a GoalState into everything the card renders. */
export function buildGoalCardViewModel(goal: GoalState): GoalCardViewModel {
  const acceptance = goal.status === 'needs_review' ? goalAcceptanceCheck(goal) : null
  return {
    id: goal.id,
    revision: goal.revision,
    status: goal.status,
    statusKey: STATUS_KEY[goal.status],
    tone: toneForStatus(goal.status),
    spinning: isGoalSpinning(goal.status),
    objective: goal.objective,
    summary: goal.summary,
    blocker: blockerText(goal),
    blockerHint: localizedGoalBlockerHint(goal.blockerHint),
    editable: goalIsEditable(goal.status),
    pausable: goalCanPause(goal.status),
    resumable: goalCanResume(goal.status),
    cancellable: goalCanCancel(goal.status),
    acceptBlocked: acceptance !== null && !acceptance.ok,
    continuing: acceptance !== null,
    noteKeys: noteKeysForStatus(goal),
    criteria: goal.criteria.map((criterion) => ({
      id: criterion.id,
      description: criterion.description,
      required: criterion.required,
      status: criterion.status,
      statusKey: CRITERION_STATUS_KEY[criterion.status],
      evidenceCount: criterion.evidenceIds.length,
    })),
    scope: [...goal.scope],
    budget: {
      iterations: goal.budget.maxIterations,
      minutes: goalDurationMinutes(goal.budget.maxActiveDurationMs),
    },
    usage: {
      iterations: goal.usage.iterations,
      minutes: goalDurationMinutes(goal.usage.activeDurationMs),
    },
    evidence: goal.evidence.map((entry) => ({ ...entry })),
  }
}
