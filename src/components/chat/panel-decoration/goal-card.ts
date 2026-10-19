import { t, type AppTextKey } from '@/lib/i18n'
import {
  goalAcceptanceCheck,
  goalCanCancel,
  goalCanPause,
  goalCanResume,
  goalDurationMinutes,
  goalIsEditable,
  isGoalSpinning,
  isGoalV2,
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
  round_limit: 'goalBlockerIterationBudget',
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
  const code = goal.blockerInfo?.code
  if (code && BLOCKER_KEY[code]) return t(BLOCKER_KEY[code] as AppTextKey)
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

function v2StatusKey(goal: GoalState): string {
  if (goal.phase === 'active' && goal.activation === 'disarmed') return 'goalPhaseInterrupted'
  if (goal.phase === 'active') {
    if (goal.runtime === 'planning') return 'goalPhasePlanning'
    if (goal.runtime === 'verifying') return 'goalPhaseVerifying'
    if (goal.runtime === 'waiting_approval') return 'goalPhaseWaitingApproval'
    if (goal.runtime === 'waiting_input') return 'goalPhaseWaitingInput'
    if (goal.runtime === 'pausing') return 'goalPhasePausing'
    return 'goalPhaseActive'
  }
  if (goal.phase === 'paused') return 'goalPhasePaused'
  if (goal.phase === 'blocked') return 'goalPhaseBlocked'
  return 'goalPhaseComplete'
}

function v2Tone(goal: GoalState): GoalCardTone {
  if (goal.phase === 'complete') return 'success'
  if (goal.phase === 'blocked') return 'warning'
  if (goal.phase === 'paused') return 'info'
  if (goal.phase === 'active' && goal.activation === 'disarmed') return 'warning'
  return 'active'
}

function v2NoteKeys(goal: GoalState): string[] {
  if (goal.phase === 'paused' || goal.phase === 'blocked') {
    return ['goalPauseCancelNote', 'goalResumeNote', 'goalScopeChangeNote']
  }
  if (goal.phase === 'complete') return ['goalCompletedNote']
  if (goal.activation === 'disarmed') return ['goalResumeNote', 'goalScopeChangeNote']
  return ['goalPauseCancelNote', 'goalScopeChangeNote']
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
  const v2 = isGoalV2(goal)
  const acceptance = !v2 && goal.status === 'needs_review' ? goalAcceptanceCheck(goal) : null
  const budgetIterations = goal.maxRounds ?? goal.budget.maxIterations
  const usageIterations = goal.roundsStarted ?? goal.usage.iterations
  return {
    id: goal.id,
    revision: goal.revision,
    status: goal.status,
    statusKey: v2 ? v2StatusKey(goal) : STATUS_KEY[goal.status],
    tone: v2 ? v2Tone(goal) : toneForStatus(goal.status),
    spinning: v2
      ? ['executing', 'verifying', 'waiting_approval', 'waiting_input', 'pausing'].includes(goal.runtime ?? '')
      : isGoalSpinning(goal.status),
    objective: goal.objective,
    summary: goal.summary,
    blocker: blockerText(goal),
    blockerHint: localizedGoalBlockerHint(goal.blockerHint),
    editable: v2 ? goal.phase !== 'complete' : goalIsEditable(goal.status),
    pausable: v2 ? goal.phase === 'active' && goal.activation !== 'disarmed' : goalCanPause(goal.status),
    resumable: v2 ? (goal.phase === 'paused' || goal.phase === 'blocked' || (goal.phase === 'active' && goal.activation === 'disarmed')) : goalCanResume(goal.status),
    cancellable: v2 ? goal.phase !== 'complete' : goalCanCancel(goal.status),
    acceptBlocked: acceptance !== null && !acceptance.ok,
    continuing: acceptance !== null,
    noteKeys: v2 ? v2NoteKeys(goal) : noteKeysForStatus(goal),
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
      iterations: budgetIterations,
      minutes: goalDurationMinutes(goal.budget.maxActiveDurationMs),
    },
    usage: {
      iterations: usageIterations,
      minutes: goalDurationMinutes(goal.usage.activeDurationMs),
    },
    evidence: goal.evidence.map((entry) => ({ ...entry })),
  }
}
