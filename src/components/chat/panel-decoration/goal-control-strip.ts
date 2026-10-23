import { t, type AppTextKey } from '@/lib/i18n'
import {
  goalBudgetExtension,
  goalV2CanPause,
  goalV2CanResume,
  goalDurationMinutes,
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
import { buildGoalBlockerText, type GoalCardTone } from './goal-card'

/**
 * Goal control strip view projection (the DOM controller that used to live here
 * was replaced by `src/components/chat/surface/GoalControlStrip.tsx`).
 *
 * 方案 A（目标卡）把这条 affordance 从「单行 + 4 个同权重图标」改成三段结构：
 *
 * 1. 身份行：状态图标 + **5 个用户可见状态词**之一 + 次要阶段说明 + 唯一主操作；
 * 2. 目标行：objective（两行截断），编辑态替换成输入框；
 * 3. 进度行：验收分段条 + `3/5` + 轮次 + 累计用时。
 *
 * 点击展开后在原位显示验收清单、预算与低频操作，低频/危险动作（编辑、清除、
 * 打开完整面板）收进「⋯」菜单，不再与主操作同权重相邻。
 *
 * 服务器仍然是唯一权威：投影只读 `GoalState`，动作由 `src/lib/goal-ui.ts` 的
 * 共享锁包住后 POST，条带自身不持有任何 goal 状态。
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

/**
 * The single primary action the strip may offer.
 * - `pause` / `resume`: POST the goal action.
 * - `attention`: the engine is waiting for the user (tool approval / question);
 *   the strip scrolls to that card instead of opening another surface.
 */
export type GoalControlStripAction = 'pause' | 'resume' | 'attention' | 'none'

export type GoalControlStripView = {
  id: string
  revision: number
  status: GoalStatus
  /**
   * The five user-facing state words (方案 A3). Every server status/phase/runtime
   * combination collapses into one of them; the precise machine state stays in
   * `statusKey` and in the secondary `phaseDetail` line.
   */
  statusWordKey: AppTextKey
  /** Raw per-status key (13 values); kept for callers that show the exact state. */
  statusKey: AppTextKey
  tone: GoalCardTone
  spinning: boolean
  /** Goal v2 phase/activation/runtime, when the server uses the v2 engine. */
  phase?: GoalPhase
  activation?: GoalActivation
  runtime?: GoalRuntime
  /** Secondary, lower-emphasis line: round + what the engine is doing now. */
  phaseDetail: string
  roundText?: string
  objective?: string
  primaryAction: GoalControlStripAction
  /** Label of the single solid primary button. */
  primaryLabelKey: AppTextKey
  /**
   * `true` when the primary action cannot be dispatched inline and must be
   * confirmed in the inspector (budget extension is CAS-bound to a revision).
   */
  primaryOpensInspector: boolean
  budgetExhausted: boolean
  /** True when the goal is editable without pausing first (v2). */
  inlineEditable: boolean
  criteriaPassed: number
  criteriaTotal: number
  /** Whole minutes of recorded active time; 0 hides the segment. */
  durationMinutes: number
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

function v2PrimaryAction(goal: GoalState): GoalControlStripAction {
  if (goal.phase === 'active' && goal.activation !== 'disarmed') {
    return goalV2CanPause(goal) ? 'pause' : 'none'
  }
  if (goalV2CanResume(goal)) return 'resume'
  return 'none'
}

/**
 * Waiting states are not "resume" states: the engine is blocked on a card the
 * user must answer in the chat. The strip offers one action that reveals that
 * card instead of opening a second surface.
 */
function isWaitingOnUser(goal: GoalState): boolean {
  if (isGoalV2(goal)) return goal.runtime === 'waiting_approval' || goal.runtime === 'waiting_input'
  return goal.status === 'awaiting_approval' || goal.status === 'awaiting_input'
}

/** 13 statuses → the five words the user actually needs (方案 A3). */
function stateWordFor(goal: GoalState): AppTextKey {
  if (isWaitingOnUser(goal)) return 'goalStateNeedsYou'
  if (isGoalV2(goal)) {
    if (goal.phase === 'complete') return 'goalStateDone'
    if (goal.phase === 'blocked') return 'goalStateBlocked'
    if (goal.phase === 'paused' || goal.activation === 'disarmed') return 'goalStatePaused'
    return 'goalStateRunning'
  }
  switch (goal.status) {
    case 'paused':
      return 'goalStatePaused'
    case 'blocked':
    case 'needs_review':
      return 'goalStateBlocked'
    case 'completed':
      return 'goalStateDone'
    default:
      return 'goalStateRunning'
  }
}

function rounds(goal: GoalState): { started: number; max: number; text?: string } {
  const max = goal.maxRounds ?? goal.budget.maxIterations
  const started = goal.roundsStarted ?? goal.usage.iterations
  return { started, max, text: max > 0 ? `${started}/${max}` : undefined }
}

/** Secondary line: "第 3/20 轮" for a healthy run, the blocker/step for the rest. */
function phaseDetailFor(goal: GoalState): string {
  const { text } = rounds(goal)
  const round = text ?? String(goal.roundsStarted ?? goal.usage.iterations ?? 0)
  if (isGoalV2(goal)) {
    if (goal.phase === 'blocked') return buildGoalBlockerText(goal) || t('goalStateBlocked')
    if (goal.phase === 'paused') return t('goalPhaseDetailPausedAt', { round })
    if (goal.phase === 'active' && goal.activation === 'disarmed') return t('goalPhaseDetailInterrupted')
    if (goal.runtime === 'planning') return t('goalPhaseDetailPlanning')
    if (goal.runtime === 'verifying') return t('goalPhaseDetailVerifying')
    if (goal.runtime === 'pausing') return t('goalPhaseDetailPausing')
    if (goal.runtime === 'waiting_approval') return t('goalPhaseDetailWaitingApproval')
    if (goal.runtime === 'waiting_input') return t('goalPhaseDetailWaitingInput')
    if (goalBudgetExtension(goal).exhausted) return t('goalPhaseDetailBudget')
    return text ? t('goalPhaseDetailRound', { round: text }) : ''
  }
  if (goal.status === 'blocked' || goal.status === 'needs_review' || goal.status === 'failed') {
    return buildGoalBlockerText(goal) || t(STATUS_KEY[goal.status])
  }
  if (goal.status === 'paused') return t('goalPhaseDetailPausedAt', { round })
  if (goalBudgetExtension(goal).exhausted) return t('goalPhaseDetailBudget')
  return text ? t('goalPhaseDetailRound', { round: text }) : ''
}

function criteriaTally(goal: GoalState): { passed: number; total: number } {
  let passed = 0
  for (const criterion of goal.criteria) {
    if (criterion.status === 'passed') passed += 1
  }
  return { passed, total: goal.criteria.length }
}

function baseView(goal: GoalState) {
  const tally = criteriaTally(goal)
  const extension = goalBudgetExtension(goal)
  return {
    id: goal.id,
    revision: goal.revision,
    status: goal.status,
    statusWordKey: stateWordFor(goal),
    phaseDetail: phaseDetailFor(goal),
    budgetExhausted: extension.exhausted,
    criteriaPassed: tally.passed,
    criteriaTotal: tally.total,
    durationMinutes: goalDurationMinutes(goal.usage.activeDurationMs),
  }
}

function buildGoalControlStripViewV2(goal: GoalState): GoalControlStripView | null {
  if (goal.phase === 'complete') return null
  const r = rounds(goal)
  const primaryAction = v2PrimaryAction(goal)
  const extension = goalBudgetExtension(goal)
  return {
    ...baseView(goal),
    statusKey: v2StatusKey(goal),
    tone: v2Tone(goal),
    spinning: goal.runtime === 'executing' || goal.runtime === 'verifying' || goal.runtime === 'waiting_approval' || goal.runtime === 'waiting_input' || goal.runtime === 'pausing',
    phase: goal.phase,
    activation: goal.activation,
    runtime: goal.runtime,
    roundText: r.text,
    objective: goal.objective,
    primaryAction,
    primaryLabelKey: primaryLabelFor(primaryAction, extension.exhausted),
    // Budget extension is CAS-bound to `{goalId, expectedRevision}`, so the strip
    // routes it to the inspector confirmation instead of firing a bare resume.
    primaryOpensInspector: primaryAction === 'resume' && extension.exhausted,
    inlineEditable: true,
  }
}

function primaryActionForStatus(status: GoalStatus): GoalControlStripAction {
  if (status === 'awaiting_approval' || status === 'awaiting_input') return 'attention'
  if (status === 'running' || status === 'verifying' || status === 'pausing') return 'pause'
  if (status === 'paused') return 'resume'
  return 'none'
}

function primaryLabelFor(action: GoalControlStripAction, budgetExhausted: boolean): AppTextKey {
  if (action === 'pause') return 'goalPause'
  if (action === 'attention') return 'goalAttentionAction'
  if (action === 'resume') return budgetExhausted ? 'goalExtendResume' : 'goalResume'
  return 'goalResume'
}

/**
 * Projects the authoritative goal into the strip. Returns null for a terminal
 * goal (方案 C 的完成卡负责收尾；本次只做 A，完成态仍不渲染条带)。
 */
export function buildGoalControlStripView(goal: GoalState): GoalControlStripView | null {
  if (isGoalV2(goal)) return buildGoalControlStripViewV2(goal)
  if (isGoalTerminal(goal.status)) return null
  const primaryAction = primaryActionForStatus(goal.status)
  return {
    ...baseView(goal),
    statusKey: STATUS_KEY[goal.status],
    tone: toneForStatus(goal.status),
    spinning: isGoalSpinning(goal.status),
    primaryAction,
    primaryLabelKey: primaryLabelFor(primaryAction, goalBudgetExtension(goal).exhausted),
    primaryOpensInspector: primaryAction === 'resume' && goalBudgetExtension(goal).exhausted,
    // Legacy goals must pause before the server accepts a revise.
    inlineEditable: false,
  }
}

// The imperative controller that used to live here was replaced by
// `src/components/chat/surface/GoalControlStrip.tsx`: React renders the row and
// owns the child order, edit mode, the expanded panel and the menu. Only the
// pure view projection above stays in the decoration layer.
