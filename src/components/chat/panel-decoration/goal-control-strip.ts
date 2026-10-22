import type { AppTextKey } from '@/lib/i18n'
import {
  goalBudgetExtension,
  goalV2CanPause,
  goalV2CanResume,
  isGoalSpinning,
  isGoalTerminal,
  isGoalV2,
  type GoalAction,
  type GoalActivation,
  type GoalPhase,
  type GoalRuntime,
  type GoalState,
  type GoalStatus,
} from '@/lib/goal'
import type { GoalCardTone } from './goal-card'

/**
 * Goal control strip view projection (the DOM controller that used to live here
 * was replaced by `src/components/chat/surface/GoalControlStrip.tsx`).
 *
 * One row shows the goal glyph, the phase label, the truncated objective and at
 * most a few icon buttons (pause/resume · edit · clear · open). Clicking edit
 * swaps the objective text for an inline input with save/cancel actions,
 * mirroring the queued-message editor interaction.
 *
 * The strip owns no goal state and no request lock: the surface reads the
 * ServerAgent snapshot, every action runs through the shared goal-ui wrapper
 * (which owns the pending lock, the dirty guard and the error) and the detail
 * view is opened through the shared open-summary request.
 */

/** Shared lock/dirty/error state as published by `src/lib/goal-ui.ts`. */
export type GoalControlStripUiState = {
  pending: boolean
  dirty: boolean
  error: string | null
}

/**
 * The subset of the shared `src/lib/goal-ui.ts` contract the strip consumes.
 * The surface imports the module functions directly; this alias stays as the
 * documented shape of that contract.
 */
export type GoalControlStripGoalUi = {
  requestOpenGoalSummary: (sessionId: string, goalId: string, view?: 'progress' | 'edit') => void
  getGoalUiState: (sessionId: string, goalId: string) => GoalControlStripUiState
  subscribeGoalUi: (sessionId: string, goalId: string, listener: () => void) => () => void
  runGoalUiAction: (
    sessionId: string,
    goalId: string,
    action: GoalAction,
    execute: () => Promise<unknown>,
  ) => Promise<void>
}

export type GoalControlStripView = {
  id: string
  revision: number
  status: GoalStatus
  statusKey: AppTextKey
  tone: GoalCardTone
  spinning: boolean
  /** Goal v2 phase/activation/runtime, when the server uses the v2 engine. */
  phase?: GoalPhase
  activation?: GoalActivation
  runtime?: GoalRuntime
  roundText?: string
  objective?: string
  /** The single primary action the strip may offer. */
  primaryAction: 'pause' | 'resume' | 'none'
  budgetExhausted: boolean
  /** True when the goal is editable without pausing first (v2). */
  inlineEditable: boolean
}

const STATUS_KEY: Record<GoalStatus, AppTextKey> = {
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

function toneForStatus(status: GoalStatus): GoalCardTone {
  if (status === 'completed') return 'success'
  if (status === 'failed' || status === 'cancelled') return 'danger'
  if (status === 'blocked' || status === 'needs_review') return 'warning'
  if (status === 'awaiting_confirmation' || status === 'planning') return 'info'
  return 'active'
}

const V2_STATUS_KEY: Record<GoalPhase, AppTextKey> = {
  active: 'goalPhaseActive',
  paused: 'goalPhasePaused',
  blocked: 'goalPhaseBlocked',
  complete: 'goalPhaseComplete',
}

function v2StatusKey(goal: GoalState): AppTextKey {
  if (goal.phase === 'active' && goal.activation === 'disarmed') return 'goalPhaseInterrupted'
  if (goal.phase === 'active') {
    if (goal.runtime === 'planning') return 'goalPhasePlanning'
    if (goal.runtime === 'verifying') return 'goalPhaseVerifying'
    if (goal.runtime === 'waiting_approval') return 'goalPhaseWaitingApproval'
    if (goal.runtime === 'waiting_input') return 'goalPhaseWaitingInput'
    if (goal.runtime === 'pausing') return 'goalPhasePausing'
  }
  return V2_STATUS_KEY[goal.phase ?? 'active']
}

function v2Tone(goal: GoalState): GoalCardTone {
  if (goal.phase === 'complete') return 'success'
  if (goal.phase === 'blocked') return 'warning'
  if (goal.phase === 'paused') return 'info'
  if (goal.phase === 'active' && goal.activation === 'disarmed') return 'warning'
  return 'active'
}

function v2PrimaryAction(goal: GoalState): GoalControlStripView['primaryAction'] {
  if (goal.phase === 'active' && goal.activation !== 'disarmed') return goalV2CanPause(goal) ? 'pause' : 'none'
  if (goalV2CanResume(goal)) return 'resume'
  return 'none'
}

function buildGoalControlStripViewV2(goal: GoalState): GoalControlStripView | null {
  if (goal.phase === 'complete') return null
  const maxRounds = goal.maxRounds ?? goal.budget.maxIterations
  const roundsStarted = goal.roundsStarted ?? goal.usage.iterations
  return {
    id: goal.id,
    revision: goal.revision,
    status: goal.status,
    statusKey: v2StatusKey(goal),
    tone: v2Tone(goal),
    spinning: goal.runtime === 'executing' || goal.runtime === 'verifying' || goal.runtime === 'waiting_approval' || goal.runtime === 'waiting_input' || goal.runtime === 'pausing',
    phase: goal.phase,
    activation: goal.activation,
    runtime: goal.runtime,
    roundText: maxRounds > 0 ? `${roundsStarted}/${maxRounds}` : undefined,
    objective: goal.objective,
    primaryAction: v2PrimaryAction(goal),
    budgetExhausted: goalBudgetExtension(goal).exhausted,
    // DSH parity: v2 edit works in any non-complete phase without pausing.
    // (complete goals never reach here — buildGoalControlStripViewV2 returns
    // null for them above.)
    inlineEditable: true,
  }
}

function primaryActionForStatus(status: GoalStatus): GoalControlStripView['primaryAction'] {
  if (status === 'running' || status === 'verifying' || status === 'pausing') return 'pause'
  if (status === 'paused') return 'resume'
  return 'none'
}

/**
 * Projects the authoritative goal into the strip row. Returns null for a
 * terminal goal.
 */
export function buildGoalControlStripView(goal: GoalState): GoalControlStripView | null {
  if (isGoalV2(goal)) return buildGoalControlStripViewV2(goal)
  if (isGoalTerminal(goal.status)) return null
  return {
    id: goal.id,
    revision: goal.revision,
    status: goal.status,
    statusKey: STATUS_KEY[goal.status],
    tone: toneForStatus(goal.status),
    spinning: isGoalSpinning(goal.status),
    primaryAction: primaryActionForStatus(goal.status),
    budgetExhausted: goalBudgetExtension(goal).exhausted,
    // Legacy goals must pause before the server accepts a revise.
    inlineEditable: false,
  }
}

// The imperative controller that used to live here was replaced by
// `src/components/chat/surface/GoalControlStrip.tsx`: React renders the row and
// owns the child order, edit mode and the cancel confirmation. Only the pure
// view projection above stays in the decoration layer.
