/**
 * Goal mode state — the shared contract between the server session
 * snapshot/SSE frames and the frontend goal card.
 *
 * The server is authoritative. Every field is validated defensively because
 * the client must tolerate older servers that omit optional fields, and must
 * never crash the chat panel on a malformed goal payload.
 */

export type GoalStatus =
  | 'planning'
  | 'awaiting_confirmation'
  | 'running'
  | 'verifying'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'pausing'
  | 'paused'
  | 'blocked'
  | 'needs_review'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type GoalCriterionStatus = 'pending' | 'passed' | 'failed' | 'needs_review'

export type GoalCriterion = {
  id: string
  description: string
  required: boolean
  status: GoalCriterionStatus
  evidenceIds: string[]
}

export type GoalEvidence = {
  id: string
  description: string
  /** Tool-result evidence: the tool call that produced it. */
  toolCallId?: string
  /** Trusted tool name the server attached to tool-result evidence. */
  toolName?: string
  /** Evidence origin reported by the server (e.g. `tool` / `human`). */
  source?: string
  /** ISO timestamp of the explicit human acceptance this evidence records. */
  acceptedAt?: string
}

export type GoalBudget = {
  maxIterations: number
  maxActiveDurationMs: number
}

export type GoalUsage = {
  iterations: number
  activeDurationMs: number
}

export type GoalState = {
  id: string
  sessionId: string
  revision: number
  objective: string
  status: GoalStatus
  /** Server-owned plan consent; optional only for legacy callers/payloads. */
  planConfirmed?: boolean
  criteria: GoalCriterion[]
  scope: string[]
  summary: string
  budget: GoalBudget
  usage: GoalUsage
  evidence: GoalEvidence[]
  blocker?: string
  /** Human-readable explanation of the blocker (e.g. budget exhaustion). */
  blockerHint?: string
  /** ISO timestamp set once when the user explicitly accepts the result. */
  humanAcceptedAt?: string
  /** Criteria the user explicitly accepted, each backed by human evidence. */
  acceptedCriterionIds?: string[]
  updatedAt: string
}

/**
 * POST /api/agents/:id/goal actions.
 *
 * `accept` is the explicit human sign-off for a `needs_review` goal: the server
 * records `human` evidence for criteria the user confirms without machine
 * verification. `resume` from `needs_review` only continues execution.
 */
export type GoalAction = 'confirm' | 'pause' | 'resume' | 'extend_resume' | 'cancel' | 'revise' | 'accept'

/** Identity and revision captured by the explicit budget confirmation. */
export type GoalActionOptions = { goalId: string; expectedRevision: number; signal?: AbortSignal }

/** Only exhausted dimensions receive one default grant; usage is never reset. */
export function goalBudgetExtension(goal: GoalState) {
  const iterations = goal.usage.iterations >= goal.budget.maxIterations ? 8 : 0
  const activeDurationMs = goal.usage.activeDurationMs >= goal.budget.maxActiveDurationMs ? 120 * 60_000 : 0
  return {
    iterations,
    activeDurationMs,
    exhausted: iterations > 0 || activeDurationMs > 0,
    stillExhausted: goal.usage.iterations >= goal.budget.maxIterations + iterations
      || goal.usage.activeDurationMs >= goal.budget.maxActiveDurationMs + activeDurationMs,
  }
}

export const GOAL_STATUSES: readonly GoalStatus[] = [
  'planning',
  'awaiting_confirmation',
  'running',
  'verifying',
  'awaiting_input',
  'awaiting_approval',
  'pausing',
  'paused',
  'blocked',
  'needs_review',
  'completed',
  'failed',
  'cancelled',
]

export const GOAL_CRITERION_STATUSES: readonly GoalCriterionStatus[] = [
  'pending',
  'passed',
  'failed',
  'needs_review',
]

const GOAL_ACTIONS: readonly GoalAction[] = ['confirm', 'pause', 'resume', 'extend_resume', 'cancel', 'revise', 'accept']

export function isGoalAction(value: unknown): value is GoalAction {
  return typeof value === 'string' && (GOAL_ACTIONS as readonly string[]).includes(value)
}

export function isGoalStatus(value: unknown): value is GoalStatus {
  return typeof value === 'string' && (GOAL_STATUSES as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeCriterion(value: unknown): GoalCriterion | null {
  if (!isRecord(value)) return null
  const id = stringValue(value.id)
  if (!id) return null
  const status = isGoalCriterionStatus(value.status) ? value.status : 'pending'
  return {
    id,
    description: stringValue(value.description),
    required: value.required === true,
    status,
    evidenceIds: Array.isArray(value.evidenceIds)
      ? value.evidenceIds.filter((entry): entry is string => typeof entry === 'string')
      : [],
  }
}

export function isGoalCriterionStatus(value: unknown): value is GoalCriterionStatus {
  return typeof value === 'string' && (GOAL_CRITERION_STATUSES as readonly string[]).includes(value)
}

function normalizeEvidence(value: unknown): GoalEvidence | null {
  if (!isRecord(value)) return null
  const id = stringValue(value.id)
  if (!id) return null
  const toolCallId = stringValue(value.toolCallId)
  const toolName = stringValue(value.toolName)
  const source = stringValue(value.source)
  const acceptedAt = stringValue(value.acceptedAt)
  return {
    id,
    description: stringValue(value.description),
    ...(toolCallId ? { toolCallId } : {}),
    ...(toolName ? { toolName } : {}),
    ...(source ? { source } : {}),
    ...(acceptedAt ? { acceptedAt } : {}),
  }
}

/**
 * Defensive normalization for snapshot/SSE goal payloads. Returns null for a
 * missing or unrecognizable goal (the server uses null to clear it). Unknown
 * optional fields are ignored; a malformed list item is dropped rather than
 * failing the whole goal.
 */
export function normalizeGoalState(raw: unknown): (GoalState & { planConfirmed: boolean }) | null {
  if (raw === null || raw === undefined) return null
  if (!isRecord(raw)) return null
  const id = stringValue(raw.id)
  if (!id || !isGoalStatus(raw.status)) return null
  const budget = isRecord(raw.budget) ? raw.budget : {}
  const usage = isRecord(raw.usage) ? raw.usage : {}
  const blocker = stringValue(raw.blocker)
  const blockerHint = stringValue(raw.blockerHint)
  const humanAcceptedAt = stringValue(raw.humanAcceptedAt)
  return {
    id,
    sessionId: stringValue(raw.sessionId),
    revision: Math.max(0, Math.trunc(finiteNumber(raw.revision))),
    objective: stringValue(raw.objective),
    status: raw.status,
    // Match server legacy restoration, never infer consent from an action click.
    planConfirmed: raw.status === 'planning' || raw.status === 'awaiting_confirmation'
      ? false
      : typeof raw.planConfirmed === 'boolean' ? raw.planConfirmed : finiteNumber(usage.iterations) > 0,
    criteria: Array.isArray(raw.criteria)
      ? raw.criteria.map(normalizeCriterion).filter((entry): entry is GoalCriterion => entry !== null)
      : [],
    scope: Array.isArray(raw.scope)
      ? raw.scope.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [],
    summary: stringValue(raw.summary),
    budget: {
      maxIterations: Math.max(0, Math.trunc(finiteNumber(budget.maxIterations))),
      maxActiveDurationMs: Math.max(0, finiteNumber(budget.maxActiveDurationMs)),
    },
    usage: {
      iterations: Math.max(0, Math.trunc(finiteNumber(usage.iterations))),
      activeDurationMs: Math.max(0, finiteNumber(usage.activeDurationMs)),
    },
    evidence: Array.isArray(raw.evidence)
      ? raw.evidence.map(normalizeEvidence).filter((entry): entry is GoalEvidence => entry !== null)
      : [],
    ...(blocker ? { blocker } : {}),
    ...(blockerHint ? { blockerHint } : {}),
    ...(humanAcceptedAt ? { humanAcceptedAt } : {}),
    ...(Array.isArray(raw.acceptedCriterionIds)
      ? {
          acceptedCriterionIds: [
            ...new Set(raw.acceptedCriterionIds.filter(
              (entry): entry is string => typeof entry === 'string' && entry.length > 0,
            )),
          ],
        }
      : {}),
    updatedAt: stringValue(raw.updatedAt),
  }
}

// --- Status semantics shared by the card and its tests ---------------------

const TERMINAL_STATUSES = new Set<GoalStatus>(['completed', 'failed', 'cancelled'])
const SPINNING_STATUSES = new Set<GoalStatus>([
  'planning',
  'running',
  'verifying',
  'awaiting_input',
  'awaiting_approval',
  'pausing',
])

export function isGoalTerminal(status: GoalStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

/** A goal that still exists (not completed/failed/cancelled). */
export function isGoalActive(status: GoalStatus): boolean {
  return !TERMINAL_STATUSES.has(status)
}

export function isGoalSpinning(status: GoalStatus): boolean {
  return SPINNING_STATUSES.has(status)
}

/** Objective may be edited (revise) and re-confirmed from these states. */
export function goalIsEditable(status: GoalStatus): boolean {
  return status === 'awaiting_confirmation' || status === 'paused' || status === 'blocked'
}

export function goalCanConfirm(status: GoalStatus): boolean {
  return status === 'awaiting_confirmation'
}

export function goalCanPause(status: GoalStatus): boolean {
  return status === 'running' || status === 'verifying'
}

export function goalCanResume(status: GoalStatus): boolean {
  return status === 'paused' || status === 'blocked' || status === 'needs_review'
}

export function goalCanCancel(status: GoalStatus): boolean {
  return !isGoalTerminal(status)
}

/**
 * Client mirror of the server's explicit human-acceptance gate for the `accept`
 * action. The user confirms the current result as-is; the backend is
 * authoritative and records `human` evidence for the criteria it signs off on
 * without machine verification. The card only blocks the button when the server
 * would reject the acceptance outright:
 *
 * - the goal must be stable in `needs_review` (`accept` is a no-op elsewhere),
 * - no required criterion may be `failed`.
 *
 * Pending / `needs_review` required criteria are deliberately allowed — they are
 * exactly what the human is confirming, and no longer require a `toolCallId`.
 * `resume` from `needs_review` never completes the goal; it only continues
 * execution.
 */
export function goalAcceptanceCheck(goal: GoalState): { ok: boolean; reason: string } {
  if (goal.status !== 'needs_review') {
    return { ok: false, reason: `goal is ${goal.status}; only needs_review can be accepted` }
  }
  const failed = goal.criteria.filter((criterion) => criterion.required && criterion.status === 'failed')
  if (failed.length > 0) {
    return { ok: false, reason: `required acceptance criteria failed: ${failed.map((criterion) => criterion.id).join(', ')}` }
  }
  return { ok: true, reason: '' }
}

/** `accept` is offered (and accepted by the server) only for `needs_review`. */
export function goalCanAccept(goal: GoalState): boolean {
  return goalAcceptanceCheck(goal).ok
}

/** Duration is always presented as whole minutes; never as a fake percentage. */
export function goalDurationMinutes(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.max(1, Math.round(ms / 60_000))
}
