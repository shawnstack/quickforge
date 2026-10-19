/**
 * Goal v2 event-sourced store.
 *
 * The session log is the durable authority. Each accepted mutation appends one
 * `goal/change` event carrying the full post-change snapshot; `clear` writes a
 * tombstone. Loading folds the events with strict revision/phase/round checks,
 * so a corrupt log fails closed instead of silently repairing itself.
 */

import { GoalError, GOAL_ERROR_CODES } from './errors.mjs'
import {
  normalizeGoalV2,
  phaseFromLegacyStatus,
} from './state.mjs'

export const GOAL_EVENT_VERSION = 1

const ALLOWED_PHASE_TRANSITIONS = {
  active: new Set(['active', 'paused', 'blocked', 'complete']),
  paused: new Set(['paused', 'active', 'complete']),
  blocked: new Set(['blocked', 'active', 'complete']),
  complete: new Set(['complete']),
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function text(value, max = 200) {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

export function createGoalEvent({ operation, goal = null, roundsStarted, at = new Date().toISOString(), tombstone = null }) {
  if (!['create', 'restore', 'change', 'round', 'clear'].includes(operation)) {
    throw new GoalError(`Unsupported goal event operation: ${operation}`, GOAL_ERROR_CODES.INVALID_INPUT, 400)
  }
  return {
    v: GOAL_EVENT_VERSION,
    operation,
    at,
    goal,
    roundsStarted: Number.isSafeInteger(roundsStarted) ? roundsStarted : (goal?.roundsStarted ?? 0),
    ...(tombstone ? { tombstone } : {}),
  }
}

function assertBaseShape(event) {
  if (!isRecord(event)) throw new GoalError('Malformed goal event.', GOAL_ERROR_CODES.INVALID_INPUT, 400)
  if (event.v !== GOAL_EVENT_VERSION) {
    throw new GoalError(`Unsupported goal event version: ${event.v}`, GOAL_ERROR_CODES.INVALID_INPUT, 400)
  }
  if (!['create', 'restore', 'change', 'round', 'clear'].includes(event.operation)) {
    throw new GoalError(`Unsupported goal event operation: ${event.operation}`, GOAL_ERROR_CODES.INVALID_INPUT, 400)
  }
}

/**
 * Fold the persisted goal event log.
 *
 * @returns {{ goal: object|null, tombstone: object|null, lastError: string|null }}
 */
export function foldGoalEvents(events, { sessionId = null } = {}) {
  let goal = null
  let tombstone = null
  let lastError = null
  for (const [index, raw] of (Array.isArray(events) ? events : []).entries()) {
    try {
      assertBaseShape(raw)
      if (raw.operation === 'create' || raw.operation === 'restore') {
        if (goal) throw new GoalError('Goal log starts a second lifecycle without clearing the previous one.')
        const normalized = normalizeGoalV2(raw.goal, { sessionId })
        if (!normalized) throw new GoalError('Goal log contains an invalid goal snapshot.')
        if (raw.operation === 'create' && normalized.revision !== 1) {
          throw new GoalError('Goal create must start at revision 1.')
        }
        if (raw.operation === 'create' && normalized.phase !== 'active') {
          throw new GoalError('Goal create must start active.')
        }
        if (raw.operation === 'create' && normalized.roundsStarted !== 0) {
          throw new GoalError('Goal create must start with zero rounds.')
        }
        goal = normalized
        tombstone = null
        continue
      }
      if (raw.operation === 'clear') {
        const cleared = normalizeGoalV2(raw.goal, { sessionId }) || goal
        tombstone = raw.tombstone
          ? {
            outcome: ['completed', 'failed', 'cancelled', 'blocked'].includes(raw.tombstone.outcome)
              ? raw.tombstone.outcome
              : 'cancelled',
            reason: text(raw.tombstone.reason, 2000),
            at: text(raw.tombstone.at, 64) || text(raw.at, 64),
            goal: cleared,
          }
          : (goal ? { outcome: 'cancelled', reason: '', at: text(raw.at, 64), goal } : null)
        goal = null
        continue
      }
      const next = normalizeGoalV2(raw.goal, { sessionId })
      if (!goal) throw new GoalError('Goal change has no current goal.')
      if (!next) throw new GoalError('Goal change carries an invalid snapshot.')
      if (next.id !== goal.id) throw new GoalError('Goal change cannot replace the goal id.')
      if (next.revision !== goal.revision + 1) {
        throw new GoalError(`Goal revision gap: ${goal.revision} -> ${next.revision}.`)
      }
      if (!ALLOWED_PHASE_TRANSITIONS[goal.phase]?.has(next.phase)) {
        throw new GoalError(`Invalid goal phase transition: ${goal.phase} -> ${next.phase}.`)
      }
      if (raw.operation === 'round') {
        if (next.roundsStarted !== goal.roundsStarted + 1) {
          throw new GoalError('Goal round admission must advance roundsStarted by exactly one.')
        }
        if (next.phase !== 'active') throw new GoalError('Goal round admission requires an active goal.')
      } else if (next.roundsStarted !== goal.roundsStarted) {
        throw new GoalError('Goal change other than round admission cannot move roundsStarted.')
      }
      goal = next
    } catch (error) {
      lastError = `goal event ${index}: ${error?.message || String(error)}`
      break
    }
  }
  if (lastError) return { goal: null, tombstone: null, lastError }
  return { goal, tombstone, lastError: null }
}

/**
 * Convert one legacy persisted goal into v2 events.
 *
 * `failed`/`cancelled` become a tombstone with `lastRun`, preserving the
 * outcome the scheduled-task waiter needs without adding a fifth phase.
 */
export function migrateLegacyGoal(raw, { sessionId = null, at = new Date().toISOString() } = {}) {
  if (raw === null || raw === undefined) return { goal: null, tombstone: null, events: [] }
  const normalized = normalizeGoalV2(raw, { sessionId })
  if (!normalized) return { goal: null, tombstone: null, events: [] }
  const legacyStatus = typeof raw.status === 'string' ? raw.status : null
  if (legacyStatus === 'failed' || legacyStatus === 'cancelled') {
    const tombstone = {
      outcome: legacyStatus,
      reason: typeof raw.blocker === 'string' ? raw.blocker.slice(0, 2000) : '',
      at,
      goal: normalized,
    }
    return {
      goal: null,
      tombstone,
      events: [
        createGoalEvent({ operation: 'restore', goal: normalized, at }),
        createGoalEvent({ operation: 'clear', goal: normalized, at, tombstone }),
      ],
    }
  }
  if (legacyStatus === 'needs_review' && !normalized.blocker) {
    normalized.blocker = { code: 'verification_failed', message: 'The goal needs manual verification.' }
  }
  if (legacyStatus && phaseFromLegacyStatus(legacyStatus) === 'active' && normalized.phase === 'active') {
    // A restart keeps the durable phase but never resumes automatically.
    // Activation is process-local and is set to `disarmed` by the service.
  }
  return { goal: normalized, tombstone: null, events: [createGoalEvent({ operation: 'restore', goal: normalized, at })] }
}
