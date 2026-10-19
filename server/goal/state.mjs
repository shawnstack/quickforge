/**
 * Goal v2 pure state model.
 *
 * Durable goal state has exactly four phases:
 *   active | paused | blocked | complete
 *
 * `activation` (armed/disarmed) is process-local and is intentionally NOT part
 * of this module's goal document. `runtime` (planning/executing/verifying/...)
 * is derived from the live agent loop and is also not persisted here.
 *
 * The QuickForge acceptance policy (plan + criteria + evidence) remains part of
 * the goal document; it is data, not a lifecycle phase.
 */

import {
  GOAL_MAX_BLOCKER_CHARS,
  GOAL_MAX_CRITERIA,
  GOAL_MAX_CRITERION_DESCRIPTION_CHARS,
  GOAL_MAX_EVIDENCE,
  GOAL_MAX_EVIDENCE_DESCRIPTION_CHARS,
  GOAL_MAX_OBJECTIVE_CHARS,
  GOAL_MAX_SCOPE,
  GOAL_MAX_SCOPE_ENTRY_CHARS,
  GOAL_MAX_SUMMARY_CHARS,
  applyGoalCriterionUpdates,
  goalCompletionCheck,
  mergeGoalEvidence,
  normalizeGoalState,
} from '../agent-goal-state.mjs'
import { GoalError, GOAL_ERROR_CODES } from './errors.mjs'

export const GOAL_PHASES = Object.freeze(['active', 'paused', 'blocked', 'complete'])
export const GOAL_ACTIVATIONS = Object.freeze(['armed', 'disarmed'])
export const GOAL_RUNTIMES = Object.freeze([
  'idle',
  'planning',
  'executing',
  'verifying',
  'waiting_approval',
  'waiting_input',
  'pausing',
])

const PHASE_SET = new Set(GOAL_PHASES)
const ACTIVATION_SET = new Set(GOAL_ACTIVATIONS)
const TERMINAL_PHASES = new Set(['complete'])
const IN_FLIGHT_LEGACY = new Set([
  'planning',
  'running',
  'verifying',
  'awaiting_input',
  'awaiting_approval',
  'pausing',
])

export function isGoalPhase(value) {
  return typeof value === 'string' && PHASE_SET.has(value)
}

export function isGoalActivation(value) {
  return typeof value === 'string' && ACTIVATION_SET.has(value)
}

export function isGoalRuntime(value) {
  return typeof value === 'string' && GOAL_RUNTIMES.includes(value)
}

export function isGoalActivePhase(value) {
  return isGoalPhase(value) && !TERMINAL_PHASES.has(value)
}

export function isGoalTerminalPhase(value) {
  return value === 'complete'
}

export function goalRoundsRemaining(goal) {
  if (!goal) return 0
  return Math.max(0, nonNegativeInt(goal.maxRounds, 20) - nonNegativeInt(goal.roundsStarted))
}

/**
 * Legacy status -> durable phase. `failed`/`cancelled` are kept as
 * `paused` here; the store turns them into a tombstone with `lastRun`.
 */
export function phaseFromLegacyStatus(status) {
  if (status === 'paused') return 'paused'
  if (status === 'blocked' || status === 'needs_review') return 'blocked'
  if (status === 'completed') return 'complete'
  if (status === 'failed' || status === 'cancelled') return 'paused'
  if (IN_FLIGHT_LEGACY.has(status)) return 'active'
  return 'active'
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function text(value, max, fallback = '') {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

function finiteNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nonNegativeInt(value, fallback = 0) {
  return Math.max(0, Math.trunc(finiteNumber(value, fallback)))
}

function positiveInt(value, fallback = 20) {
  const number = Math.trunc(finiteNumber(value, fallback))
  return number > 0 ? number : fallback
}

function normalizeAttachment(raw) {
  if (!isRecord(raw)) return null
  const fileName = text(raw.fileName, 512)
  const path = text(raw.path, 4096)
  if (!fileName && !path) return null
  return {
    ...(text(raw.id, 128) ? { id: text(raw.id, 128) } : {}),
    type: text(raw.type, 64) || 'document',
    ...(fileName ? { fileName } : {}),
    ...(text(raw.mimeType, 128) ? { mimeType: text(raw.mimeType, 128) } : {}),
    ...(typeof raw.size === 'number' && Number.isFinite(raw.size) && raw.size >= 0 ? { size: raw.size } : {}),
    ...(typeof raw.characterCount === 'number' && Number.isFinite(raw.characterCount) && raw.characterCount >= 0
      ? { characterCount: raw.characterCount }
      : {}),
    ...(path ? { path } : {}),
    ...(text(raw.source, 64) ? { source: text(raw.source, 64) } : {}),
  }
}

function normalizeEvidence(raw) {
  if (!isRecord(raw)) return null
  const id = text(raw.id, 64)
  if (!id) return null
  const toolCallId = text(raw.toolCallId, 128)
  const toolName = text(raw.toolName, 128)
  const acceptedAt = text(raw.acceptedAt, 64)
  return {
    id,
    description: text(raw.description, GOAL_MAX_EVIDENCE_DESCRIPTION_CHARS),
    ...(raw.source === 'human' ? { source: 'human' } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(toolName ? { toolName } : {}),
    ...(acceptedAt ? { acceptedAt } : {}),
  }
}

function normalizeCriterion(raw, index) {
  if (!isRecord(raw)) return null
  const description = text(raw.description, GOAL_MAX_CRITERION_DESCRIPTION_CHARS)
  if (!description) return null
  const id = text(raw.id, 64) || `c${index + 1}`
  const status = ['pending', 'passed', 'failed', 'needs_review'].includes(raw.status) ? raw.status : 'pending'
  return {
    id,
    description,
    required: raw.required !== false,
    status,
    evidenceIds: Array.isArray(raw.evidenceIds)
      ? [...new Set(raw.evidenceIds.filter((entry) => typeof entry === 'string' && entry))].slice(0, GOAL_MAX_EVIDENCE)
      : [],
  }
}

function normalizePlan(raw) {
  if (!isRecord(raw)) return null
  const criteria = Array.isArray(raw.criteria)
    ? raw.criteria.map(normalizeCriterion).filter(Boolean).slice(0, GOAL_MAX_CRITERIA)
    : []
  const scope = Array.isArray(raw.scope)
    ? raw.scope.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => text(entry, GOAL_MAX_SCOPE_ENTRY_CHARS)).slice(0, GOAL_MAX_SCOPE)
    : []
  const summary = text(raw.summary, GOAL_MAX_SUMMARY_CHARS)
  if (!criteria.length && !scope.length && !summary) return null
  return {
    criteria,
    scope,
    summary,
    submittedAt: text(raw.submittedAt, 64) || null,
  }
}

function normalizeBlocker(raw) {
  if (!raw) return null
  if (typeof raw === 'string') {
    const message = text(raw, GOAL_MAX_BLOCKER_CHARS)
    return message ? { code: 'legacy', message } : null
  }
  if (!isRecord(raw)) return null
  const message = text(raw.message, GOAL_MAX_BLOCKER_CHARS)
  if (!message) return null
  return {
    code: text(raw.code, 128) || 'unknown',
    message,
    ...(text(raw.hint, GOAL_MAX_BLOCKER_CHARS) ? { hint: text(raw.hint, GOAL_MAX_BLOCKER_CHARS) } : {}),
  }
}

function normalizeLastRun(raw) {
  if (!isRecord(raw)) return null
  const outcome = ['completed', 'failed', 'cancelled', 'blocked'].includes(raw.outcome) ? raw.outcome : null
  if (!outcome) return null
  return {
    outcome,
    ...(text(raw.reason, GOAL_MAX_BLOCKER_CHARS) ? { reason: text(raw.reason, GOAL_MAX_BLOCKER_CHARS) } : {}),
    ...(text(raw.at, 64) ? { at: text(raw.at, 64) } : {}),
  }
}

function legacyGoalToV2(raw, { sessionId = null } = {}) {
  const legacy = normalizeGoalState(raw, { sessionId })
  if (!legacy) return null
  const phase = phaseFromLegacyStatus(legacy.status)
  const plan = normalizePlan({
    criteria: legacy.criteria,
    scope: legacy.scope,
    summary: legacy.summary,
    submittedAt: legacy.updatedAt,
  })
  return {
    id: legacy.id,
    sessionId: legacy.sessionId,
    revision: legacy.revision,
    objective: legacy.objective,
    phase,
    maxRounds: positiveInt(legacy.budget?.maxIterations, 20),
    roundsStarted: nonNegativeInt(legacy.usage?.iterations),
    plan,
    evidence: legacy.evidence.map(normalizeEvidence).filter(Boolean).slice(0, GOAL_MAX_EVIDENCE),
    blocker: normalizeBlocker(legacy.blocker ? {
      code: legacy.status === 'needs_review' ? 'verification_failed' : 'legacy',
      message: legacy.blocker,
      ...(legacy.blockerHint ? { hint: legacy.blockerHint } : {}),
    } : null),
    attachments: Array.isArray(legacy.attachments)
      ? legacy.attachments.map(normalizeAttachment).filter(Boolean).slice(0, 32)
      : [],
    usage: { activeDurationMs: Math.max(0, finiteNumber(legacy.usage?.activeDurationMs)) },
    ...(legacy.humanAcceptedAt ? { humanAcceptedAt: legacy.humanAcceptedAt } : {}),
    ...(legacy.status === 'failed' || legacy.status === 'cancelled'
      ? { lastRun: { outcome: legacy.status, reason: legacy.blocker || null, at: legacy.updatedAt } }
      : {}),
    createdAt: text(raw.createdAt, 64) || legacy.updatedAt,
    updatedAt: legacy.updatedAt,
  }
}

/**
 * Defensive normalization for both v2 documents and legacy persisted goals.
 * A legacy `status` payload is converted through the same mapping used by the
 * store migration so old sessions keep working after a restart.
 */
export function normalizeGoalV2(raw, { sessionId = null } = {}) {
  if (raw === null || raw === undefined) return null
  if (!isRecord(raw)) return null
  if (typeof raw.phase !== 'string' && typeof raw.status === 'string') {
    return legacyGoalToV2(raw, { sessionId })
  }
  const id = text(raw.id, 64)
  const phase = isGoalPhase(raw.phase) ? raw.phase : null
  if (!id || !phase) return null
  const plan = normalizePlan(raw.plan)
  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence.map(normalizeEvidence).filter(Boolean).slice(0, GOAL_MAX_EVIDENCE)
    : []
  const blocker = normalizeBlocker(raw.blocker)
  return {
    id,
    sessionId: text(raw.sessionId, 128) || (typeof sessionId === 'string' ? sessionId : ''),
    revision: nonNegativeInt(raw.revision),
    objective: text(raw.objective, GOAL_MAX_OBJECTIVE_CHARS),
    phase,
    maxRounds: positiveInt(raw.maxRounds ?? raw.budget?.maxIterations, 20),
    roundsStarted: nonNegativeInt(raw.roundsStarted ?? raw.usage?.iterations),
    plan,
    evidence,
    blocker,
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments.map(normalizeAttachment).filter(Boolean).slice(0, 32)
      : [],
    usage: {
      activeDurationMs: Math.max(0, finiteNumber(raw.usage?.activeDurationMs)),
    },
    ...(text(raw.humanAcceptedAt, 64) ? { humanAcceptedAt: text(raw.humanAcceptedAt, 64) } : {}),
    ...(text(raw.completedAt, 64) ? { completedAt: text(raw.completedAt, 64) } : {}),
    ...(text(raw.completedBy, 32) ? { completedBy: text(raw.completedBy, 32) } : {}),
    ...(normalizeLastRun(raw.lastRun) ? { lastRun: normalizeLastRun(raw.lastRun) } : {}),
    createdAt: text(raw.createdAt, 64) || text(raw.updatedAt, 64) || new Date(0).toISOString(),
    updatedAt: text(raw.updatedAt, 64) || new Date(0).toISOString(),
  }
}

export function createGoalV2({ sessionId, objective, maxRounds = 20, attachments = [], now = Date.now() } = {}) {
  const createdAt = new Date(now).toISOString()
  const trimmed = text(objective, GOAL_MAX_OBJECTIVE_CHARS)
  if (!trimmed) throw new GoalError('A goal requires a non-empty objective.', GOAL_ERROR_CODES.INVALID_INPUT, 400)
  return {
    id: `goal_${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`,
    sessionId: typeof sessionId === 'string' ? sessionId : '',
    revision: 1,
    objective: trimmed,
    phase: 'active',
    maxRounds: positiveInt(maxRounds, 20),
    roundsStarted: 0,
    plan: null,
    evidence: [],
    blocker: null,
    attachments: Array.isArray(attachments)
      ? attachments.map(normalizeAttachment).filter(Boolean).slice(0, 32)
      : [],
    usage: { activeDurationMs: 0 },
    createdAt,
    updatedAt: createdAt,
  }
}

function withRevision(goal, patch, now = Date.now()) {
  return {
    ...goal,
    ...patch,
    revision: goal.revision + 1,
    updatedAt: new Date(now).toISOString(),
  }
}

export function editGoalV2(goal, { objective, maxRounds } = {}, now = Date.now()) {
  const patch = {}
  if (objective !== undefined) {
    const next = text(objective, GOAL_MAX_OBJECTIVE_CHARS)
    if (!next) throw new GoalError('A revised goal requires a non-empty objective.', GOAL_ERROR_CODES.INVALID_INPUT, 400)
    if (next !== goal.objective) {
      patch.objective = next
      // Changing what is being pursued invalidates the old plan and every pass.
      patch.plan = null
      patch.evidence = []
      patch.blocker = null
    }
  }
  if (maxRounds !== undefined) patch.maxRounds = positiveInt(maxRounds, goal.maxRounds)
  if (!Object.keys(patch).length) {
    throw new GoalError('Goal edit requires objective and/or maxRounds.', GOAL_ERROR_CODES.INVALID_INPUT, 400)
  }
  return withRevision(goal, patch, now)
}

export function pauseGoalV2(goal, now = Date.now()) {
  if (goal.phase !== 'active') {
    throw new GoalError(`Cannot pause a goal in phase ${goal.phase}.`, GOAL_ERROR_CODES.INVALID_TRANSITION)
  }
  return withRevision(goal, { phase: 'paused' }, now)
}

export function resumeGoalV2(goal, now = Date.now()) {
  if (goal.phase !== 'paused' && goal.phase !== 'blocked') {
    throw new GoalError(`Cannot resume a goal in phase ${goal.phase}.`, GOAL_ERROR_CODES.INVALID_TRANSITION)
  }
  if (nonNegativeInt(goal.roundsStarted) >= positiveInt(goal.maxRounds, 20)) {
    throw new GoalError('Goal has exhausted its round budget; edit maxRounds before resuming.', GOAL_ERROR_CODES.ROUND_LIMIT)
  }
  return withRevision(goal, { phase: 'active', blocker: null }, now)
}

export function completeGoalV2(goal, { by = 'verified', now = Date.now() } = {}) {
  if (goal.phase === 'complete') return goal
  if (goal.phase !== 'active' && goal.phase !== 'paused' && goal.phase !== 'blocked') {
    throw new GoalError(`Cannot complete a goal in phase ${goal.phase}.`, GOAL_ERROR_CODES.INVALID_TRANSITION)
  }
  const completedAt = new Date(now).toISOString()
  return withRevision(goal, {
    phase: 'complete',
    blocker: null,
    completedAt,
    completedBy: by === 'user' ? 'user' : 'verified',
    lastRun: { outcome: 'completed', at: completedAt },
  }, now)
}

export function blockGoalV2(goal, { code = 'unknown', message, hint } = {}, now = Date.now()) {
  if (goal.phase !== 'active') {
    throw new GoalError(`Cannot block a goal in phase ${goal.phase}.`, GOAL_ERROR_CODES.INVALID_TRANSITION)
  }
  const blocker = normalizeBlocker({ code, message, hint })
  if (!blocker) throw new GoalError('A blocker requires a non-empty message.', GOAL_ERROR_CODES.INVALID_INPUT, 400)
  return withRevision(goal, { phase: 'blocked', blocker, lastRun: { outcome: 'blocked', reason: blocker.message, at: new Date(now).toISOString() } }, now)
}

export function admitGoalRoundV2(goal, now = Date.now()) {
  if (goal.phase !== 'active') {
    throw new GoalError(`Cannot start a goal round in phase ${goal.phase}.`, GOAL_ERROR_CODES.NOT_ACTIVE)
  }
  const maxRounds = positiveInt(goal.maxRounds, 20)
  const roundsStarted = nonNegativeInt(goal.roundsStarted)
  if (roundsStarted >= maxRounds) {
    throw new GoalError(`Goal reached its configured limit of ${maxRounds} rounds.`, GOAL_ERROR_CODES.ROUND_LIMIT)
  }
  return withRevision(goal, { roundsStarted: roundsStarted + 1 }, now)
}

export function applyGoalPlanV2(goal, { criteria, scope, summary } = {}, now = Date.now()) {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    throw new GoalError('A plan requires at least one acceptance criterion.', GOAL_ERROR_CODES.INVALID_INPUT, 400)
  }
  if (criteria.length > GOAL_MAX_CRITERIA) {
    throw new GoalError(`A plan supports at most ${GOAL_MAX_CRITERIA} criteria.`, GOAL_ERROR_CODES.INVALID_INPUT, 400)
  }
  const nextCriteria = criteria
    .map((criterion, index) => {
      const description = text(criterion?.description, GOAL_MAX_CRITERION_DESCRIPTION_CHARS)
      if (!description) return null
      return {
        id: `c${index + 1}`,
        description,
        required: criterion?.required !== false,
        status: 'pending',
        evidenceIds: [],
      }
    })
    .filter(Boolean)
  if (!nextCriteria.length) {
    throw new GoalError('A plan requires criteria with a description.', GOAL_ERROR_CODES.INVALID_INPUT, 400)
  }
  const nextScope = Array.isArray(scope)
    ? scope.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => text(entry, GOAL_MAX_SCOPE_ENTRY_CHARS)).slice(0, GOAL_MAX_SCOPE)
    : []
  return withRevision(goal, {
    plan: {
      criteria: nextCriteria,
      scope: nextScope,
      summary: text(summary, GOAL_MAX_SUMMARY_CHARS),
      submittedAt: new Date(now).toISOString(),
    },
    evidence: [],
  }, now)
}

export function goalCompletionCandidate(goal) {
  return {
    criteria: goal?.plan?.criteria ?? [],
    evidence: goal?.evidence ?? [],
    ...(goal?.humanAcceptedAt ? { humanAcceptedAt: goal.humanAcceptedAt } : {}),
  }
}

export function checkGoalCompletionV2(goal) {
  return goalCompletionCheck(goalCompletionCandidate(goal))
}

/**
 * Merge model-reported evidence and criterion updates. Returns `{goal, errors,
 * addedEvidence}`; never throws for model input, so the tool can turn the
 * errors into a returned error result with a stable code.
 */
export function applyGoalProgressV2(goal, { summary, evidence, criterionUpdates, trustedToolNames = null } = {}, now = Date.now()) {
  const plan = goal.plan
  if (!plan) return { goal, errors: ['the goal has no submitted plan'] }
  const merged = mergeGoalEvidence({ ...goal, evidence: goal.evidence }, evidence, { trustedToolNames })
  if (merged.errors.length > 0) return { goal, errors: merged.errors }
  const updated = applyGoalCriterionUpdates({
    criteria: plan.criteria,
    evidence: merged.evidence,
  }, criterionUpdates)
  if (updated.errors.length > 0) return { goal, errors: updated.errors }
  const patch = {
    evidence: merged.evidence,
    plan: { ...plan, criteria: updated.criteria },
  }
  if (summary !== undefined) patch.plan = { ...patch.plan, summary: text(summary, GOAL_MAX_SUMMARY_CHARS) }
  return {
    goal: withRevision(goal, patch, now),
    errors: [],
    addedEvidence: merged.added,
  }
}

/** Progress signature excludes revision (pure status transitions are not progress). */
export function goalProgressSignatureV2(goal) {
  return JSON.stringify({
    plan: goal?.plan
      ? {
        criteria: goal.plan.criteria.map((criterion) => [criterion.id, criterion.status, criterion.evidenceIds]),
        summary: goal.plan.summary,
      }
      : null,
    evidence: (goal?.evidence ?? []).map((entry) => entry.id),
  })
}

export function goalMetadataSummaryV2(goal) {
  if (!goal) return undefined
  return { id: goal.id, phase: goal.phase, revision: goal.revision, updatedAt: goal.updatedAt }
}

/**
 * Compatibility projection consumed by the existing session snapshot/SSE/UI
 * until the new contract is fully adopted. New consumers read phase/plan.
 */
export function goalViewV2(goal, { activation = 'disarmed', runtime = 'idle' } = {}) {
  if (!goal) return null
  const status = legacyStatusFromV2(goal, { activation, runtime })
  return {
    ...goal,
    activation,
    runtime,
    status,
    budget: { maxIterations: goal.maxRounds, maxActiveDurationMs: null },
    usage: { iterations: goal.roundsStarted, activeDurationMs: goal.usage?.activeDurationMs || 0 },
    criteria: goal.plan?.criteria ?? [],
    scope: goal.plan?.scope ?? [],
    summary: goal.plan?.summary ?? '',
    plan: goal.plan,
    blocker: goal.blocker?.message,
    blockerHint: goal.blocker?.hint,
    blockerInfo: goal.blocker || null,
  }
}

/** Project a v2 goal into the legacy status string used by older clients. */
export function legacyStatusFromV2(goal, { runtime = 'idle', activation = 'disarmed' } = {}) {
  if (!goal) return null
  if (goal.phase === 'complete') return 'completed'
  if (goal.phase === 'blocked') return goal.blocker?.code === 'verification_failed' ? 'needs_review' : 'blocked'
  if (goal.phase === 'paused') return 'paused'
  if (goal.phase === 'active' && activation === 'disarmed') return 'paused'
  if (runtime === 'planning') return 'planning'
  if (runtime === 'verifying') return 'verifying'
  if (runtime === 'waiting_approval') return 'awaiting_approval'
  if (runtime === 'waiting_input') return 'awaiting_input'
  if (runtime === 'pausing') return 'pausing'
  return 'running'
}
