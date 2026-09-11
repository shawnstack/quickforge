/**
 * Goal mode state model (pure, no I/O).
 *
 * The wire contract is `GoalState` in `src/lib/goal.ts`; this module is the
 * server-side authority for every field. It owns:
 * - defensive normalization (snapshots may come from older persisted bodies),
 * - the immutable transition helpers every mutation goes through (revision +
 *   updatedAt are bumped in exactly one place),
 * - budget accounting and completion validation.
 *
 * No module here touches sessions, storage, SSE or the agent loop; the runner
 * (`agent-goal-runner.mjs`) composes these pure helpers with I/O and persistence
 * so the state machine stays testable in isolation.
 */

import { randomUUID } from 'node:crypto'

export const GOAL_STATUSES = [
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

export const GOAL_CRITERION_STATUSES = ['pending', 'passed', 'failed', 'needs_review']

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])
// Statuses that mean "work is (or should be) in flight right now". A restart
// maps all of them to `paused`: nothing is auto-replayed after boot.
const IN_FLIGHT_STATUSES = new Set([
  'planning',
  'running',
  'verifying',
  'awaiting_input',
  'awaiting_approval',
  'pausing',
])

export const GOAL_BUDGET_DEFAULTS = Object.freeze({
  maxIterations: 8,
  maxActiveDurationMs: null,
})

export const GOAL_MAX_OBJECTIVE_CHARS = 4000
export const GOAL_MAX_SUMMARY_CHARS = 4000
export const GOAL_MAX_BLOCKER_CHARS = 1000
export const GOAL_MAX_CRITERIA = 8
export const GOAL_MAX_EVIDENCE = 40
export const GOAL_MAX_SCOPE = 20
export const GOAL_MAX_CRITERION_DESCRIPTION_CHARS = 500
export const GOAL_MAX_EVIDENCE_DESCRIPTION_CHARS = 500
export const GOAL_MAX_SCOPE_ENTRY_CHARS = 200

const GOAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
// `accept` is the explicit human acceptance of a needs_review goal. It is the
// only action that may turn a criterion into a human-accepted pass.
const GOAL_ACTIONS = new Set(['confirm', 'pause', 'resume', 'extend_resume', 'cancel', 'revise', 'accept'])

export function isGoalAction(value) {
  return typeof value === 'string' && GOAL_ACTIONS.has(value)
}

export function isGoalStatus(value) {
  return typeof value === 'string' && GOAL_STATUSES.includes(value)
}

export function isGoalCriterionStatus(value) {
  return typeof value === 'string' && GOAL_CRITERION_STATUSES.includes(value)
}

export function isGoalTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status)
}

export function isGoalActiveStatus(status) {
  return isGoalStatus(status) && !TERMINAL_STATUSES.has(status)
}

export function isGoalInFlightStatus(status) {
  return IN_FLIGHT_STATUSES.has(status)
}

/** Objective may be replaced (revise) from these quiescent states only. */
export function isGoalEditableStatus(status) {
  return status === 'awaiting_confirmation' || status === 'paused' || status === 'blocked'
}

/** Persisted consent belongs to this plan, not to accumulated budget usage.
 * Legacy snapshots without a marker only infer consent from prior execution;
 * planning/confirmation states always require a fresh explicit confirmation.
 */
export function goalPlanConfirmed(goal) {
  if (goal.status === 'planning' || goal.status === 'awaiting_confirmation') return false
  if (typeof goal.planConfirmed === 'boolean') return goal.planConfirmed
  return (goal.usage?.iterations || 0) > 0
}

export function goalCanConfirm(status) {
  return status === 'awaiting_confirmation'
}

export function goalCanPause(status) {
  return status === 'running' || status === 'verifying'
}

export function goalCanResume(status) {
  return status === 'awaiting_confirmation' || status === 'paused' || status === 'blocked' || status === 'needs_review'
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
  const number = finiteNumber(value, fallback)
  return Math.max(0, Math.trunc(number))
}

function normalizeCriterion(raw) {
  if (!isRecord(raw)) return null
  const id = text(raw.id, 64)
  if (!id) return null
  return {
    id,
    description: text(raw.description, GOAL_MAX_CRITERION_DESCRIPTION_CHARS),
    // Defaults to required, matching the goal_report contract ("Defaults to
    // true") and applyGoalPlan; persisted snapshots use the same rule.
    required: raw.required !== false,
    status: isGoalCriterionStatus(raw.status) ? raw.status : 'pending',
    evidenceIds: Array.isArray(raw.evidenceIds)
      ? [...new Set(raw.evidenceIds.filter((entry) => typeof entry === 'string' && entry))]
        .slice(0, GOAL_MAX_EVIDENCE)
      : [],
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
    // Human acceptance evidence is written exclusively by the user API; the
    // model-facing goal_report path never produces this marker.
    ...(raw.source === 'human' ? { source: 'human' } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(toolName ? { toolName } : {}),
    ...(acceptedAt ? { acceptedAt } : {}),
  }
}

/**
 * Defensive normalization for persisted bodies and external input. Returns null
 * for a missing/unrecognizable goal (the server uses null to clear it); a
 * malformed list item is dropped rather than failing the whole goal.
 */
export function normalizeGoalState(raw, { sessionId = null } = {}) {
  if (raw === null || raw === undefined) return null
  if (!isRecord(raw)) return null
  const id = text(raw.id, 64)
  if (!id || !isGoalStatus(raw.status)) return null
  const budget = isRecord(raw.budget) ? raw.budget : {}
  const usage = isRecord(raw.usage) ? raw.usage : {}
  const blocker = text(raw.blocker, GOAL_MAX_BLOCKER_CHARS)
  const blockerHint = text(raw.blockerHint, GOAL_MAX_BLOCKER_CHARS)
  const humanAcceptedAt = text(raw.humanAcceptedAt, 64)
  const resolvedSessionId = text(raw.sessionId, 128) || (typeof sessionId === 'string' ? sessionId : '')
  return {
    id,
    sessionId: resolvedSessionId,
    revision: nonNegativeInt(raw.revision),
    objective: text(raw.objective, GOAL_MAX_OBJECTIVE_CHARS),
    status: raw.status,
    planConfirmed: goalPlanConfirmed(raw),
    criteria: Array.isArray(raw.criteria)
      ? raw.criteria.map(normalizeCriterion).filter(Boolean).slice(0, GOAL_MAX_CRITERIA)
      : [],
    scope: Array.isArray(raw.scope)
      ? raw.scope
        .filter((entry) => typeof entry === 'string' && entry.trim())
        .map((entry) => text(entry, GOAL_MAX_SCOPE_ENTRY_CHARS))
        .slice(0, GOAL_MAX_SCOPE)
      : [],
    summary: text(raw.summary, GOAL_MAX_SUMMARY_CHARS),
    budget: {
      maxIterations: nonNegativeInt(budget.maxIterations, GOAL_BUDGET_DEFAULTS.maxIterations),
      maxActiveDurationMs: typeof budget.maxActiveDurationMs === 'number' && Number.isFinite(budget.maxActiveDurationMs)
        ? Math.max(0, budget.maxActiveDurationMs) : null,
    },
    usage: {
      iterations: nonNegativeInt(usage.iterations),
      activeDurationMs: Math.max(0, finiteNumber(usage.activeDurationMs)),
    },
    evidence: Array.isArray(raw.evidence)
      ? raw.evidence.map(normalizeEvidence).filter(Boolean).slice(0, GOAL_MAX_EVIDENCE)
      : [],
    ...(blocker ? { blocker } : {}),
    ...(blockerHint ? { blockerHint } : {}),
    ...(humanAcceptedAt ? { humanAcceptedAt } : {}),
    ...(Array.isArray(raw.acceptedCriterionIds)
      ? {
          acceptedCriterionIds: [...new Set(raw.acceptedCriterionIds.filter((entry) => typeof entry === 'string' && entry))]
            .slice(0, GOAL_MAX_CRITERIA),
        }
      : {}),
    updatedAt: text(raw.updatedAt, 64) || new Date().toISOString(),
  }
}

/** One and only one place bumps revision/updatedAt. */
function withGoal(goal, patch, now = Date.now()) {
  return {
    ...goal,
    ...patch,
    revision: goal.revision + 1,
    updatedAt: new Date(now).toISOString(),
  }
}

export function createGoalState({ sessionId, objective, budget = null, now = Date.now() } = {}) {
  const createdAt = new Date(now).toISOString()
  return {
    id: `goal_${randomUUID()}`,
    sessionId: typeof sessionId === 'string' ? sessionId : '',
    revision: 1,
    planConfirmed: false,
    objective: text(objective, GOAL_MAX_OBJECTIVE_CHARS),
    status: 'planning',
    criteria: [],
    scope: [],
    summary: '',
    budget: {
      maxIterations: nonNegativeInt(budget?.maxIterations, GOAL_BUDGET_DEFAULTS.maxIterations) || GOAL_BUDGET_DEFAULTS.maxIterations,
      maxActiveDurationMs: null,
    },
    usage: { iterations: 0, activeDurationMs: 0 },
    evidence: [],
    updatedAt: createdAt,
  }
}

export function setGoalStatus(goal, status, patch = {}, now = Date.now()) {
  const next = withGoal(goal, { ...patch, status }, now)
  if (status !== 'blocked' && patch.blocker === undefined) delete next.blocker
  // A blocker hint is only meaningful together with the blocker it explains.
  if (patch.blockerHint === undefined) delete next.blockerHint
  return next
}

export function clearGoalBlocker(goal, patch = {}, now = Date.now()) {
  const next = withGoal(goal, patch, now)
  delete next.blocker
  delete next.blockerHint
  return next
}

/**
 * Replace the plan (read-only planning result) and move to awaiting_confirmation.
 * Criteria get stable server-assigned ids; the model never invents ids.
 */
export function applyGoalPlan(goal, { criteria, scope, summary }, now = Date.now()) {
  const nextCriteria = (Array.isArray(criteria) ? criteria : [])
    .filter((criterion) => isRecord(criterion) && typeof criterion.description === 'string' && criterion.description.trim())
    .slice(0, GOAL_MAX_CRITERIA)
    .map((criterion, index) => ({
      id: `c${index + 1}`,
      description: text(criterion.description, GOAL_MAX_CRITERION_DESCRIPTION_CHARS),
      required: criterion.required !== false,
      status: 'pending',
      evidenceIds: [],
    }))
  const nextScope = (Array.isArray(scope) ? scope : [])
    .filter((entry) => typeof entry === 'string' && entry.trim())
    .map((entry) => text(entry, GOAL_MAX_SCOPE_ENTRY_CHARS))
    .slice(0, GOAL_MAX_SCOPE)
  return withGoal(goal, {
    status: 'awaiting_confirmation',
    planConfirmed: false,
    criteria: nextCriteria,
    scope: nextScope,
    summary: text(summary, GOAL_MAX_SUMMARY_CHARS),
    evidence: [],
  }, now)
}

/** revise: drop the old plan and every old pass; re-enter read-only planning. */
export function resetGoalPlan(goal, objective, now = Date.now()) {
  const next = withGoal(goal, {
    planConfirmed: false,
    objective: text(objective, GOAL_MAX_OBJECTIVE_CHARS),
    status: 'planning',
    criteria: [],
    scope: [],
    summary: '',
    evidence: [],
  }, now)
  delete next.blocker
  return next
}

/**
 * Merge model-reported evidence. Ids are server-owned: an entry may carry a
 * client id (used by criterion updates in the same report) and it is kept only
 * when unique and well-formed, otherwise a fresh id is assigned.
 *
 * Evidence is always tool evidence. `source:"human"` is written exclusively by
 * the user acceptance API, so a model attempt to claim it is rejected outright;
 * the trusted tool name is attached by the runner from its own record, never
 * taken from model input.
 */
export function mergeGoalEvidence(goal, entries, { trustedToolNames = null } = {}) {
  const existing = new Map(goal.evidence.map((entry) => [entry.id, entry]))
  const added = []
  const errors = []
  for (const raw of Array.isArray(entries) ? entries : []) {
    if (!isRecord(raw)) continue
    if (goal.evidence.length + added.length >= GOAL_MAX_EVIDENCE) {
      errors.push(`evidence limit of ${GOAL_MAX_EVIDENCE} reached`)
      break
    }
    if (raw.source === 'human') {
      errors.push('human acceptance evidence can only be recorded by the user')
      continue
    }
    const toolCallId = text(raw.toolCallId, 128)
    if (!toolCallId) {
      errors.push('evidence requires the toolCallId of a successful tool result')
      continue
    }
    const description = text(raw.description, GOAL_MAX_EVIDENCE_DESCRIPTION_CHARS)
    if (!description) {
      errors.push('evidence requires a description')
      continue
    }
    const requestedId = text(raw.id, 64)
    const id = requestedId && !existing.has(requestedId) ? requestedId : `e${goal.evidence.length + added.length + 1}`
    if (existing.has(id)) continue
    const toolName = trustedToolNames instanceof Map ? text(trustedToolNames.get(toolCallId), 128) : ''
    const entry = { id, description, toolCallId, ...(toolName ? { toolName } : {}) }
    existing.set(id, entry)
    added.push(entry)
  }
  return { evidence: [...goal.evidence, ...added], added, errors }
}

/**
 * Apply criterion updates. A criterion may only become `passed` when every
 * referenced evidence id exists and is bound to a real tool call id; the runner
 * additionally verifies those tool calls are successful results of this session.
 */
export function applyGoalCriterionUpdates(goal, updates) {
  const byId = new Map(goal.criteria.map((criterion) => [criterion.id, criterion]))
  const errors = []
  const patch = new Map()
  for (const raw of Array.isArray(updates) ? updates : []) {
    if (!isRecord(raw)) continue
    const id = text(raw.id, 64)
    const criterion = byId.get(id)
    if (!criterion) {
      errors.push(`unknown criterion id: ${id || '(missing)'}`)
      continue
    }
    if (!isGoalCriterionStatus(raw.status)) {
      errors.push(`criterion ${id} requires a valid status`)
      continue
    }
    const evidenceIds = Array.isArray(raw.evidenceIds)
      ? [...new Set(raw.evidenceIds.filter((entry) => typeof entry === 'string' && entry))]
      : criterion.evidenceIds
    if (raw.status === 'passed') {
      const known = new Set(goal.evidence.map((entry) => entry.id))
      const missing = evidenceIds.filter((evidenceId) => !known.has(evidenceId))
      if (evidenceIds.length === 0) {
        errors.push(`criterion ${id} cannot be passed without evidence bound to a successful tool result`)
        continue
      }
      if (missing.length > 0) {
        errors.push(`criterion ${id} references unknown evidence: ${missing.join(', ')}`)
        continue
      }
    }
    patch.set(id, { status: raw.status, evidenceIds })
  }
  if (errors.length > 0) return { criteria: goal.criteria, errors }
  return {
    criteria: goal.criteria.map((criterion) => (patch.has(criterion.id)
      ? { ...criterion, ...patch.get(criterion.id) }
      : criterion)),
    errors: [],
  }
}

export function applyGoalProgress(goal, { summary, evidence, criterionUpdates, trustedToolNames = null } = {}, now = Date.now()) {
  const merged = mergeGoalEvidence(goal, evidence, { trustedToolNames })
  if (merged.errors.length > 0) return { goal, errors: merged.errors }
  const withEvidence = { ...goal, evidence: merged.evidence }
  const updated = applyGoalCriterionUpdates(withEvidence, criterionUpdates)
  if (updated.errors.length > 0) return { goal, errors: updated.errors }
  const patch = { criteria: updated.criteria }
  if (summary !== undefined) patch.summary = text(summary, GOAL_MAX_SUMMARY_CHARS)
  return { goal: withGoal(withEvidence, patch, now), errors: [], addedEvidence: merged.added }
}

/**
 * Explicit human acceptance of a `needs_review` goal (user API only).
 *
 * The user accepts the criteria that still need human judgement; each of them
 * becomes `passed` and is backed by a persisted human evidence entry (no
 * fabricated toolCallId). Failed required criteria can never be flipped by one
 * click — the caller must resume execution and fix them. Optional
 * `criterionIds` narrows the acceptance; by default every not-yet-passed
 * criterion is accepted.
 */
export function applyHumanAcceptance(goal, { criterionIds = null, now = Date.now() } = {}) {
  const requested = Array.isArray(criterionIds) && criterionIds.length
    ? new Set(criterionIds.filter((entry) => typeof entry === 'string' && entry))
    : null
  const failed = goal.criteria.filter((criterion) => (
    criterion.required
    && criterion.status === 'failed'
    && (!requested || requested.has(criterion.id))
  ))
  if (failed.length > 0) {
    return {
      goal,
      errors: [`required criteria failed and must be fixed before acceptance: ${failed.map((criterion) => criterion.id).join(', ')}`],
    }
  }
  const acceptedAt = new Date(now).toISOString()
  const additions = []
  const acceptedCriterionIds = []
  const criteria = goal.criteria.map((criterion) => {
    if (requested && !requested.has(criterion.id)) return criterion
    if (criterion.status === 'passed') return criterion
    const id = `h_${randomUUID()}`
    additions.push({
      id,
      description: text(`Human acceptance: ${criterion.description}`, GOAL_MAX_EVIDENCE_DESCRIPTION_CHARS),
      source: 'human',
      acceptedAt,
    })
    acceptedCriterionIds.push(criterion.id)
    return { ...criterion, status: 'passed', evidenceIds: [...new Set([...criterion.evidenceIds, id])] }
  })
  let evidence = [...goal.evidence, ...additions]
  if (evidence.length > GOAL_MAX_EVIDENCE) {
    const referenced = new Set(criteria.flatMap((criterion) => criterion.evidenceIds))
    const overflow = evidence.length - GOAL_MAX_EVIDENCE
    const kept = []
    let dropped = 0
    for (const entry of evidence) {
      if (dropped < overflow && !referenced.has(entry.id)) {
        dropped += 1
        continue
      }
      kept.push(entry)
    }
    evidence = kept.slice(-GOAL_MAX_EVIDENCE)
  }
  return {
    goal: setGoalStatus(goal, 'completed', {
      criteria,
      evidence,
      humanAcceptedAt: acceptedAt,
      acceptedCriterionIds,
    }, now),
    errors: [],
  }
}

/**
 * Human acceptance gate: the model can never complete a goal on its own. The
 * runner validates a `complete` report here and then hands the goal to the user
 * as `needs_review`; only the explicit user `accept` action completes it.
 *
 * A criterion may be satisfied either by tool evidence (a persisted entry bound
 * to a real successful tool result) or by trusted human acceptance evidence
 * written by the user API (never fabricated by goal_report).
 */
export function goalCompletionCheck(goal) {
  const required = goal.criteria.filter((criterion) => criterion.required)
  if (required.length === 0) {
    return { ok: false, reason: 'goal has no required acceptance criteria' }
  }
  const evidenceById = new Map(goal.evidence.map((entry) => [entry.id, entry]))
  const humanAccepted = Boolean(goal.humanAcceptedAt)
  const blocking = []
  for (const criterion of required) {
    if (criterion.status !== 'passed') {
      blocking.push(`${criterion.id} is ${criterion.status}`)
      continue
    }
    if (criterion.evidenceIds.length === 0) {
      blocking.push(`${criterion.id} has no evidence`)
      continue
    }
    for (const evidenceId of criterion.evidenceIds) {
      const entry = evidenceById.get(evidenceId)
      const trustedHuman = Boolean(entry && entry.source === 'human' && humanAccepted)
      if (!entry || (!entry.toolCallId && !trustedHuman)) {
        blocking.push(`${criterion.id} evidence ${evidenceId} is not bound to a tool result`)
      }
    }
  }
  return blocking.length === 0
    ? { ok: true, reason: null }
    : { ok: false, reason: `required acceptance criteria are not verified: ${blocking.join('; ')}` }
}

export function goalBudgetExhausted(goal) {
  if (goal.usage.iterations >= goal.budget.maxIterations) return { exhausted: true, reason: 'iteration_budget' }
  if (goal.budget.maxActiveDurationMs !== null && goal.usage.activeDurationMs >= goal.budget.maxActiveDurationMs) return { exhausted: true, reason: 'duration_budget' }
  return { exhausted: false, reason: null }
}

/**
 * Progress signature: any change means the run moved the goal forward. The
 * revision counter is deliberately excluded — it also advances for pure status
 * transitions (approval/ask wait states), which are not progress.
 */
export function goalProgressSignature(goal) {
  return JSON.stringify({
    evidence: goal.evidence.map((entry) => entry.id),
    criteria: goal.criteria.map((criterion) => [criterion.id, criterion.status, criterion.evidenceIds]),
    summary: goal.summary,
  })
}

/** Compact goal projection for session lists and summaries; the body stays authoritative. */
export function goalMetadataSummary(goal) {
  if (!goal) return undefined
  return { id: goal.id, status: goal.status, updatedAt: goal.updatedAt }
}

/**
 * Restore mapping: a goal that was in flight when the process stopped is
 * paused, never replayed. Waiting for user input/confirmation and terminal
 * states keep their meaning.
 */
export function goalStatusAfterRestore(status) {
  return IN_FLIGHT_STATUSES.has(status) ? 'paused' : status
}

export function goalAfterRestore(goal, now = Date.now()) {
  if (!goal) return null
  const status = goalStatusAfterRestore(goal.status)
  if (status === goal.status) return goal
  return withGoal(goal, {
    status,
    planConfirmed: goalPlanConfirmed(goal),
    blocker: 'Server restarted while the goal was in flight; resume to continue.',
  }, now)
}

export function goalUsageWithRun(goal, { iterations = 0, durationMs = 0 } = {}) {
  return {
    iterations: Math.max(0, goal.usage.iterations + Math.trunc(iterations)),
    activeDurationMs: Math.max(0, goal.usage.activeDurationMs + Math.max(0, durationMs)),
  }
}

export function isValidGoalId(value) {
  return typeof value === 'string' && GOAL_ID_PATTERN.test(value)
}
