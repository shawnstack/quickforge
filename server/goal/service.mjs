/**
 * Goal v2 service: the single mutation entry point.
 *
 * Every mutation is compare-and-set on `{ id, revision }` and serialized per
 * session. `activation` and `runtime` stay process-local; the durable value is
 * the event log owned by `store.mjs`.
 */

import { GoalError, GOAL_ERROR_CODES } from './errors.mjs'
import {
  admitGoalRoundV2,
  applyGoalPlanV2,
  applyGoalProgressV2,
  blockGoalV2,
  checkGoalCompletionV2,
  completeGoalV2,
  createGoalV2,
  editGoalV2,
  goalMetadataSummaryV2,
  goalViewV2,
  isGoalActivePhase,
  normalizeGoalV2,
  pauseGoalV2,
  resumeGoalV2,
} from './state.mjs'
import {
  createGoalEvent,
  foldGoalEvents,
  migrateLegacyGoal,
} from './store.mjs'

function emptySession() {
  return {
    events: [],
    goal: null,
    tombstone: null,
    activation: 'disarmed',
    runtime: 'idle',
    queue: Promise.resolve(),
    lastError: null,
    unavailable: false,
  }
}

function goalRef(goal) {
  return goal ? { id: goal.id, revision: goal.revision } : null
}

function assertRef(state, ref, { allowMissing = false } = {}) {
  if (!state.goal) {
    if (allowMissing) return
    throw new GoalError('This session has no goal.', GOAL_ERROR_CODES.NOT_FOUND, 404)
  }
  if (!ref || typeof ref.id !== 'string' || !ref.id || !Number.isSafeInteger(ref.revision)) {
    throw new GoalError('A goal action requires goalId and expectedRevision.', GOAL_ERROR_CODES.INVALID_INPUT, 400)
  }
  if (state.goal.id !== ref.id || state.goal.revision !== ref.revision) {
    throw new GoalError('The goal changed. Refresh before trying again.', GOAL_ERROR_CODES.REVISION_CONFLICT, 409)
  }
}

/**
 * @param {{ persist?: (sessionId: string, events: object[]) => Promise<void>, now?: () => number }} [options]
 */
export function createGoalService(options = {}) {
  const sessions = new Map()
  const now = options.now || (() => Date.now())
  const persist = options.persist || null

  function stateFor(sessionId) {
    if (!sessions.has(sessionId)) sessions.set(sessionId, emptySession())
    return sessions.get(sessionId)
  }

  function applyFold(state, events) {
    const folded = foldGoalEvents(events, { sessionId: state.sessionId })
    if (folded.lastError) {
      state.events = events
      state.goal = null
      state.tombstone = null
      state.lastError = folded.lastError
      state.unavailable = true
      throw new GoalError(`Goal log is unavailable: ${folded.lastError}`, GOAL_ERROR_CODES.INVALID_INPUT, 409)
    }
    state.events = events
    state.goal = folded.goal
    state.tombstone = folded.tombstone
    state.lastError = null
    state.unavailable = false
  }

  function view(state) {
    return goalViewV2(state.goal, { activation: state.activation, runtime: state.runtime })
  }

  async function commit(sessionId, nextEvents) {
    const state = stateFor(sessionId)
    const snapshot = { ...state, sessionId }
    if (persist) {
      try {
        await persist(sessionId, nextEvents)
      } catch (error) {
        throw new GoalError(`Could not persist the goal: ${error?.message || String(error)}`, GOAL_ERROR_CODES.PERSIST_FAILED, 500)
      }
    }
    applyFold(snapshot, nextEvents)
    sessions.set(sessionId, snapshot)
    return snapshot
  }

  async function withQueue(sessionId, operation) {
    const state = stateFor(sessionId)
    const run = state.queue.then(() => operation(state), () => operation(state))
    state.queue = run.then(() => undefined, () => undefined)
    return run
  }

  function ensureAvailable(state) {
    if (state.unavailable) {
      throw new GoalError(`Goal log is unavailable: ${state.lastError || 'unknown error'}`, GOAL_ERROR_CODES.INVALID_INPUT, 409)
    }
  }

  return {
    loadSession(sessionId, { events = null, legacyGoal = null } = {}) {
      const state = emptySession()
      state.sessionId = sessionId
      if (Array.isArray(events) && events.length) {
        applyFold(state, events)
      } else if (legacyGoal) {
        const migrated = migrateLegacyGoal(legacyGoal, {
          sessionId,
          at: new Date(now()).toISOString(),
        })
        state.events = migrated.events
        state.goal = migrated.goal
        state.tombstone = migrated.tombstone
      }
      // A restart/fork never re-arms an active goal.
      state.activation = 'disarmed'
      state.runtime = 'idle'
      sessions.set(sessionId, state)
      return view(state)
    },

    get(sessionId) {
      const state = stateFor(sessionId)
      ensureAvailable(state)
      return view(state)
    },

    getTombstone(sessionId) {
      return stateFor(sessionId).tombstone
    },

    getEvents(sessionId) {
      return stateFor(sessionId).events.slice()
    },

    getMetadata(sessionId) {
      return goalMetadataSummaryV2(stateFor(sessionId).goal)
    },

    getActivation(sessionId) {
      return stateFor(sessionId).activation
    },

    getRuntime(sessionId) {
      return stateFor(sessionId).runtime
    },

    setRuntime(sessionId, runtime) {
      stateFor(sessionId).runtime = runtime
    },

    arm(sessionId) {
      stateFor(sessionId).activation = 'armed'
    },

    disarm(sessionId) {
      stateFor(sessionId).activation = 'disarmed'
    },

    async create(sessionId, { objective, maxRounds = 20, attachments = [] } = {}) {
      return withQueue(sessionId, async (state) => {
        ensureAvailable(state)
        if (state.goal && state.goal.phase !== 'complete') {
          throw new GoalError(`A goal already exists in phase ${state.goal.phase}.`, GOAL_ERROR_CODES.ALREADY_EXISTS, 409)
        }
        const next = createGoalV2({ sessionId, objective, maxRounds, attachments, now: now() })
        const events = state.events.slice()
        if (state.goal?.phase === 'complete') {
          events.push(createGoalEvent({
            operation: 'clear',
            goal: state.goal,
            at: new Date(now()).toISOString(),
            tombstone: {
              outcome: 'completed',
              reason: 'Replaced by a new goal.',
              at: new Date(now()).toISOString(),
              goal: state.goal,
            },
          }))
        }
        events.push(createGoalEvent({
          operation: 'create',
          goal: next,
          at: new Date(now()).toISOString(),
        }))
        const committed = await commit(sessionId, events)
        committed.activation = 'armed'
        committed.runtime = 'planning'
        return view(committed)
      })
    },

    async edit(sessionId, ref, { objective, maxRounds } = {}) {
      return withQueue(sessionId, async (state) => {
        ensureAvailable(state)
        assertRef(state, ref)
        if (state.goal.phase === 'complete') {
          throw new GoalError('A completed goal cannot be edited.', GOAL_ERROR_CODES.INVALID_TRANSITION)
        }
        const next = editGoalV2(state.goal, { objective, maxRounds }, now())
        const committed = await commit(sessionId, [
          ...state.events,
          createGoalEvent({ operation: 'change', goal: next, at: new Date(now()).toISOString() }),
        ])
        if (committed.goal?.phase === 'active') {
          committed.runtime = committed.goal.plan ? 'executing' : 'planning'
        }
        return view(committed)
      })
    },

    async pause(sessionId, ref) {
      return withQueue(sessionId, async (state) => {
        ensureAvailable(state)
        assertRef(state, ref)
        const next = pauseGoalV2(state.goal, now())
        const committed = await commit(sessionId, [
          ...state.events,
          createGoalEvent({ operation: 'change', goal: next, at: new Date(now()).toISOString() }),
        ])
        committed.activation = 'disarmed'
        committed.runtime = 'idle'
        return view(committed)
      })
    },

    async resume(sessionId, ref) {
      return withQueue(sessionId, async (state) => {
        ensureAvailable(state)
        assertRef(state, ref)
        if (state.goal.phase === 'active') {
          if (state.activation === 'armed') {
            throw new GoalError('The goal is already active and armed.', GOAL_ERROR_CODES.INVALID_TRANSITION)
          }
          // Re-arm after a restart/fork without changing the durable phase.
          state.activation = 'armed'
          state.runtime = state.goal.plan ? 'executing' : 'planning'
          return view(state)
        }
        const next = resumeGoalV2(state.goal, now())
        const committed = await commit(sessionId, [
          ...state.events,
          createGoalEvent({ operation: 'change', goal: next, at: new Date(now()).toISOString() }),
        ])
        committed.activation = 'armed'
        committed.runtime = next.plan ? 'executing' : 'planning'
        return view(committed)
      })
    },

    async complete(sessionId, ref, { by = 'verified' } = {}) {
      return withQueue(sessionId, async (state) => {
        ensureAvailable(state)
        assertRef(state, ref)
        const next = completeGoalV2(state.goal, { by, now: now() })
        const committed = await commit(sessionId, [
          ...state.events,
          createGoalEvent({ operation: 'change', goal: next, at: new Date(now()).toISOString() }),
        ])
        committed.activation = 'disarmed'
        committed.runtime = 'idle'
        return view(committed)
      })
    },

    async block(sessionId, ref, { code = 'unknown', message, hint } = {}) {
      return withQueue(sessionId, async (state) => {
        ensureAvailable(state)
        assertRef(state, ref)
        const next = blockGoalV2(state.goal, { code, message, hint }, now())
        const committed = await commit(sessionId, [
          ...state.events,
          createGoalEvent({ operation: 'change', goal: next, at: new Date(now()).toISOString() }),
        ])
        committed.activation = 'disarmed'
        committed.runtime = 'idle'
        return view(committed)
      })
    },

    async clear(sessionId, ref, { outcome = 'cancelled', reason = '' } = {}) {
      return withQueue(sessionId, async (state) => {
        ensureAvailable(state)
        assertRef(state, ref)
        const at = new Date(now()).toISOString()
        const tombstone = {
          outcome: ['completed', 'failed', 'cancelled', 'blocked'].includes(outcome) ? outcome : 'cancelled',
          reason: typeof reason === 'string' ? reason.slice(0, 2000) : '',
          at,
          goal: state.goal,
        }
        const committed = await commit(sessionId, [
          ...state.events,
          createGoalEvent({ operation: 'clear', goal: state.goal, at, tombstone }),
        ])
        committed.activation = 'disarmed'
        committed.runtime = 'idle'
        return { goal: null, tombstone: committed.tombstone }
      })
    },

    async admitRound(sessionId, ref) {
      return withQueue(sessionId, async (state) => {
        ensureAvailable(state)
        assertRef(state, ref)
        if (state.activation !== 'armed') {
          throw new GoalError('Automatic goal continuation is disarmed; resume the goal first.', GOAL_ERROR_CODES.NOT_ACTIVE, 409)
        }
        const next = admitGoalRoundV2(state.goal, now())
        const committed = await commit(sessionId, [
          ...state.events,
          createGoalEvent({ operation: 'round', goal: next, at: new Date(now()).toISOString() }),
        ])
        committed.runtime = 'executing'
        return { goal: view(committed), round: next.roundsStarted }
      })
    },

    async reportPlan(sessionId, ref, { criteria, scope, summary } = {}) {
      return withQueue(sessionId, async (state) => {
        ensureAvailable(state)
        assertRef(state, ref)
        if (state.goal.phase !== 'active') {
          throw new GoalError(`Cannot record a plan in phase ${state.goal.phase}.`, GOAL_ERROR_CODES.NOT_ACTIVE)
        }
        const next = applyGoalPlanV2(state.goal, { criteria, scope, summary }, now())
        const committed = await commit(sessionId, [
          ...state.events,
          createGoalEvent({ operation: 'change', goal: next, at: new Date(now()).toISOString() }),
        ])
        committed.runtime = 'planning'
        return view(committed)
      })
    },

    async reportProgress(sessionId, ref, { summary, evidence, criterionUpdates, trustedToolNames = null } = {}) {
      return withQueue(sessionId, async (state) => {
        ensureAvailable(state)
        assertRef(state, ref)
        if (state.goal.phase !== 'active') {
          throw new GoalError(`Cannot record progress in phase ${state.goal.phase}.`, GOAL_ERROR_CODES.NOT_ACTIVE)
        }
        const progressed = applyGoalProgressV2(state.goal, { summary, evidence, criterionUpdates, trustedToolNames }, now())
        if (progressed.errors.length) {
          throw new GoalError(progressed.errors.join('; '), GOAL_ERROR_CODES.INVALID_INPUT, 400)
        }
        const committed = await commit(sessionId, [
          ...state.events,
          createGoalEvent({ operation: 'change', goal: progressed.goal, at: new Date(now()).toISOString() }),
        ])
        return view(committed)
      })
    },

    async requestComplete(sessionId, ref) {
      return withQueue(sessionId, async (state) => {
        ensureAvailable(state)
        assertRef(state, ref)
        if (state.goal.phase !== 'active') {
          throw new GoalError(`Cannot verify a goal in phase ${state.goal.phase}.`, GOAL_ERROR_CODES.NOT_ACTIVE)
        }
        const check = checkGoalCompletionV2(state.goal)
        if (!check.ok) {
          throw new GoalError(`Goal completion rejected: ${check.reason}`, GOAL_ERROR_CODES.INVALID_TRANSITION, 409)
        }
        state.runtime = 'verifying'
        return { goal: view(state), check }
      })
    },

    /** Merge one legacy/canonical snapshot into the event log. */
    async restore(sessionId, raw, { at = new Date(now()).toISOString() } = {}) {
      return withQueue(sessionId, async (state) => {
        const normalized = normalizeGoalV2(raw, { sessionId })
        if (!normalized) throw new GoalError('Cannot restore an invalid goal snapshot.', GOAL_ERROR_CODES.INVALID_INPUT, 400)
        const committed = await commit(sessionId, [
          ...state.events,
          createGoalEvent({ operation: 'restore', goal: normalized, at }),
        ])
        committed.activation = 'disarmed'
        committed.runtime = 'idle'
        return view(committed)
      })
    },

    ref(sessionId) {
      return goalRef(stateFor(sessionId).goal)
    },

    isActive(sessionId) {
      return isGoalActivePhase(stateFor(sessionId).goal?.phase)
    },
  }
}

export { goalRef }
