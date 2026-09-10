import { afterEach, describe, expect, it, vi } from 'vitest'

// The store needs t() for its refusal/failure copy; the real i18n module pulls
// in pi-web-ui, which requires a browser DOM. Stubbing the translation bundle
// keeps the real keys/params contract testable in the node environment.
vi.mock('@earendil-works/pi-web-ui', () => ({ translations: { en: {}, zh: {} } }))

import {
  MAX_RETAINED_GOAL_DRAFTS,
  OPEN_GOAL_SUMMARY_EVENT,
  clearGoalUi,
  getGoalUiState,
  releaseGoalUi,
  requestOpenGoalSummary,
  retainGoalUi,
  runGoalUiAction,
  setGoalUiDirty,
  setGoalUiDraft,
  subscribeGoalUi,
  syncGoalUiState,
  type GoalSummaryOpenDetail,
} from '../../src/lib/goal-ui'
import { applyAppLanguageFromSnapshot, t } from '../../src/lib/i18n'
import type { GoalState } from '../../src/lib/goal'

const SESSION = 'session-1'
const GOAL = 'goal-1'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res()
    reject = (error) => rej(error)
  })
  return { promise, resolve, reject }
}

function goalState(overrides: Partial<GoalState> = {}): GoalState {
  return {
    id: GOAL,
    sessionId: SESSION,
    revision: 1,
    objective: 'Ship the UI',
    status: 'paused',
    criteria: [],
    scope: [],
    summary: '',
    budget: { maxIterations: 0, maxActiveDurationMs: 0 },
    usage: { iterations: 0, activeDurationMs: 0 },
    evidence: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  clearGoalUi(SESSION, GOAL)
  clearGoalUi(SESSION, 'goal-2')
  clearGoalUi('session-2', GOAL)
})

describe('goal-ui pending lock', () => {
  it('blocks extend_resume for shared dirty drafts and duplicate pending actions', async () => {
    const gate = deferred()
    const execute = vi.fn(() => gate.promise)
    setGoalUiDraft(SESSION, GOAL, { objective: 'old', text: 'new', editing: true })
    await runGoalUiAction(SESSION, GOAL, 'extend_resume', execute)
    expect(execute).not.toHaveBeenCalled()
    expect(getGoalUiState(SESSION, GOAL).dirty).toBe(true)
    setGoalUiDraft(SESSION, GOAL, null)
    const running = runGoalUiAction(SESSION, GOAL, 'extend_resume', execute)
    await runGoalUiAction(SESSION, GOAL, 'extend_resume', execute)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(getGoalUiState(SESSION, GOAL).pending).toBe(true)
    gate.resolve()
    await running
    expect(getGoalUiState(SESSION, GOAL).pending).toBe(false)
  })
  it('takes a synchronous lock before awaiting and releases it when the action settles', async () => {
    const gate = deferred()
    const execute = vi.fn(() => gate.promise)
    const running = runGoalUiAction(SESSION, GOAL, 'pause', execute)

    // Lock is already held in the same tick: no second request can start.
    expect(getGoalUiState(SESSION, GOAL).pending).toBe(true)
    await runGoalUiAction(SESSION, GOAL, 'pause', execute)
    expect(execute).toHaveBeenCalledTimes(1)

    gate.resolve()
    await running
    expect(getGoalUiState(SESSION, GOAL)).toEqual({ pending: false, dirty: false, error: null, draft: null })
  })

  it('notifies subscribers on start and on settlement', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeGoalUi(SESSION, GOAL, listener)
    const gate = deferred()
    const running = runGoalUiAction(SESSION, GOAL, 'confirm', () => gate.promise)
    expect(listener).toHaveBeenCalledTimes(1)

    gate.resolve()
    await running
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    setGoalUiDirty(SESSION, GOAL, true)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('goal-ui dirty guard', () => {
  it('blocks confirm/resume/accept but permits safe pause/cancel and revise with a draft', async () => {
    setGoalUiDirty(SESSION, GOAL, true)
    const execute = vi.fn(async () => {})

    for (const action of ['confirm', 'resume', 'accept'] as const) {
      await runGoalUiAction(SESSION, GOAL, action, execute)
      expect(execute).not.toHaveBeenCalled()
      expect(getGoalUiState(SESSION, GOAL).error).toBe(t('goalUnsavedChanges'))
      expect(getGoalUiState(SESSION, GOAL).pending).toBe(false)
    }
    for (const action of ['pause', 'cancel', 'revise'] as const) {
      await runGoalUiAction(SESSION, GOAL, action, execute)
      expect(getGoalUiState(SESSION, GOAL).error).toBeNull()
      expect(getGoalUiState(SESSION, GOAL).dirty).toBe(true)
    }
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('keeps the idle snapshot referentially stable and only rebuilds it on change', () => {
    const first = getGoalUiState(SESSION, GOAL)
    expect(getGoalUiState(SESSION, GOAL)).toBe(first)
    expect(first).toBe(getGoalUiState('missing-session', 'missing-goal'))

    setGoalUiDirty(SESSION, GOAL, true)
    const dirty = getGoalUiState(SESSION, GOAL)
    expect(dirty).not.toBe(first)
    expect(dirty).toEqual({ pending: false, dirty: true, error: null, draft: null })

    // Idempotent writes do not churn the snapshot identity.
    setGoalUiDirty(SESSION, GOAL, true)
    expect(getGoalUiState(SESSION, GOAL)).toBe(dirty)
  })
})

describe('goal-ui draft retention', () => {
  it('stores the draft and derives dirty from the server-objective baseline', () => {
    setGoalUiDraft(SESSION, GOAL, { objective: 'Ship the UI', text: 'Ship the UI', editing: true })
    expect(getGoalUiState(SESSION, GOAL)).toEqual({
      pending: false,
      dirty: false,
      error: null,
      draft: { objective: 'Ship the UI', text: 'Ship the UI', editing: true },
    })

    setGoalUiDraft(SESSION, GOAL, { objective: 'Ship the UI', text: 'Ship the UI better', editing: true })
    expect(getGoalUiState(SESSION, GOAL).dirty).toBe(true)
    expect(getGoalUiState(SESSION, GOAL).draft?.text).toBe('Ship the UI better')

    // Reverting the text to the baseline clears dirty without dropping the draft.
    setGoalUiDraft(SESSION, GOAL, { objective: 'Ship the UI', text: '  Ship the UI  ', editing: true })
    expect(getGoalUiState(SESSION, GOAL).dirty).toBe(false)
    expect(getGoalUiState(SESSION, GOAL).draft).not.toBeNull()
  })

  it('keeps the draft and its dirty lock across an unmount/remount of its surface', () => {
    retainGoalUi(SESSION, GOAL)
    setGoalUiDraft(SESSION, GOAL, { objective: 'A', text: 'A edited', editing: true })
    expect(getGoalUiState(SESSION, GOAL).dirty).toBe(true)

    // Closing the panel releases the pin but must not unlock the goal or drop
    // the text a remount needs to backfill.
    releaseGoalUi(SESSION, GOAL)
    const released = getGoalUiState(SESSION, GOAL)
    expect(released.draft).toEqual({ objective: 'A', text: 'A edited', editing: true })
    expect(released.dirty).toBe(true)
    expect(released.pending).toBe(false)

    // The responsive remount re-pins the same key and still sees the draft.
    retainGoalUi(SESSION, GOAL)
    expect(getGoalUiState(SESSION, GOAL).draft?.text).toBe('A edited')
    releaseGoalUi(SESSION, GOAL)
  })

  it('reclaims only the oldest unpinned drafts once the LRU exceeds its bound', () => {
    const keys = Array.from({ length: MAX_RETAINED_GOAL_DRAFTS + 1 }, (_, index) => `goal-lru-${index}`)
    for (const goalId of keys) {
      retainGoalUi(SESSION, goalId)
      setGoalUiDraft(SESSION, goalId, { objective: 'A', text: `${goalId} draft`, editing: true })
      releaseGoalUi(SESSION, goalId)
    }

    // The oldest released draft is dropped (and its lock released); the newest
    // is still there for its own remount.
    expect(getGoalUiState(SESSION, keys[0]).draft).toBeNull()
    expect(getGoalUiState(SESSION, keys[0]).dirty).toBe(false)
    expect(getGoalUiState(SESSION, keys[keys.length - 1]).draft?.text).toBe(`${keys[keys.length - 1]} draft`)

    for (const goalId of keys) clearGoalUi(SESSION, goalId)
  })

  it('never reclaims a draft while its surface is still mounted', () => {
    const pinned = 'goal-pinned'
    retainGoalUi(SESSION, pinned)
    setGoalUiDraft(SESSION, pinned, { objective: 'A', text: 'pinned draft', editing: true })

    const others = Array.from({ length: MAX_RETAINED_GOAL_DRAFTS + 2 }, (_, index) => `goal-other-${index}`)
    for (const goalId of others) {
      retainGoalUi(SESSION, goalId)
      setGoalUiDraft(SESSION, goalId, { objective: 'A', text: `${goalId} draft`, editing: true })
      releaseGoalUi(SESSION, goalId)
    }

    expect(getGoalUiState(SESSION, pinned).draft?.text).toBe('pinned draft')

    releaseGoalUi(SESSION, pinned)
    for (const goalId of [pinned, ...others]) clearGoalUi(SESSION, goalId)
  })

  it('discards the draft on an explicit cleanup (surface discarded, not just hidden)', () => {
    retainGoalUi(SESSION, GOAL)
    setGoalUiDraft(SESSION, GOAL, { objective: 'A', text: 'A edited', editing: true })
    clearGoalUi(SESSION, GOAL)
    expect(getGoalUiState(SESSION, GOAL)).toEqual({ pending: false, dirty: false, error: null, draft: null })
    releaseGoalUi(SESSION, GOAL)
  })
})

describe('goal-ui goal reconciliation', () => {
  it.each(['completed', 'failed', 'cancelled'] as const)('keeps %s text read-only without a dirty guard', (status) => {
    setGoalUiDraft(SESSION, GOAL, { objective: 'A', text: 'draft', editing: true })
    syncGoalUiState(SESSION, goalState({ status }))
    expect(getGoalUiState(SESSION, GOAL)).toMatchObject({ dirty: false, draft: { text: 'draft', editing: false } })
  })

  it('retains a running draft and keeps pending untouched', async () => {
    const gate = deferred()
    const running = runGoalUiAction(SESSION, GOAL, 'pause', () => gate.promise)
    setGoalUiDraft(SESSION, GOAL, { objective: 'Ship the UI', text: 'Ship the UI better', editing: true })
    expect(getGoalUiState(SESSION, GOAL).dirty).toBe(true)

    syncGoalUiState(SESSION, goalState({ status: 'running' }))
    expect(getGoalUiState(SESSION, GOAL)).toMatchObject({ pending: true, dirty: true, draft: { text: 'Ship the UI better' } })
    syncGoalUiState(SESSION, goalState({ status: 'verifying' }))
    expect(getGoalUiState(SESSION, GOAL).draft?.text).toBe('Ship the UI better')

    gate.resolve()
    await running
    expect(getGoalUiState(SESSION, GOAL).pending).toBe(false)
  })

  it('keeps the draft while the goal stays editable with the same objective (revision growth)', () => {
    setGoalUiDraft(SESSION, GOAL, { objective: 'Ship the UI', text: 'Ship the UI better', editing: true })

    syncGoalUiState(SESSION, goalState({ status: 'paused', revision: 9 }))
    expect(getGoalUiState(SESSION, GOAL).dirty).toBe(true)
    expect(getGoalUiState(SESSION, GOAL).draft?.text).toBe('Ship the UI better')
  })

  it('retains a conflict baseline and text and ignores a missing goal', () => {
    setGoalUiDraft(SESSION, GOAL, { objective: 'Old objective', text: 'Old objective edited', editing: true })

    syncGoalUiState(SESSION, goalState({ status: 'paused', objective: 'New objective' }))
    expect(getGoalUiState(SESSION, GOAL).draft).toEqual({ objective: 'Old objective', text: 'Old objective edited', editing: true })
    expect(getGoalUiState(SESSION, GOAL).dirty).toBe(true)

    // A missing goal (session not loaded / goal cleared) is never a cleanup.
    setGoalUiDraft(SESSION, GOAL, { objective: 'New objective', text: 'changed', editing: true })
    syncGoalUiState(SESSION, null)
    syncGoalUiState('', goalState())
    expect(getGoalUiState(SESSION, GOAL).draft?.text).toBe('changed')
  })
})

describe('goal-ui failure and cleanup', () => {
  it('stores the failure message instead of rejecting the caller, and recovers on the next action', async () => {
    await runGoalUiAction(SESSION, GOAL, 'confirm', async () => { throw new Error('server offline') })
    expect(getGoalUiState(SESSION, GOAL)).toEqual({ pending: false, dirty: false, error: 'server offline', draft: null })

    await runGoalUiAction(SESSION, GOAL, 'confirm', async () => { throw 'not-an-error' })
    expect(getGoalUiState(SESSION, GOAL).error).toBe(t('goalActionFailed'))

    await runGoalUiAction(SESSION, GOAL, 'confirm', async () => {})
    expect(getGoalUiState(SESSION, GOAL).error).toBeNull()
  })

  it('never unlocks a real in-flight request on unmount, but clears draft and error', async () => {
    const gate = deferred()
    const running = runGoalUiAction(SESSION, GOAL, 'resume', () => gate.promise)
    // A surface may flag a draft (or a refusal may be on screen) while a real
    // request is still in flight; cleanup must not release the request lock.
    setGoalUiDirty(SESSION, GOAL, true)

    clearGoalUi(SESSION, GOAL)
    expect(getGoalUiState(SESSION, GOAL)).toEqual({ pending: true, dirty: false, error: null, draft: null })

    gate.resolve()
    await running
    // The store is idle again, so a later surface starts from a clean slate.
    expect(getGoalUiState(SESSION, GOAL)).toEqual({ pending: false, dirty: false, error: null, draft: null })
  })

  it('keeps keys isolated so an old goal never overwrites the current one', async () => {
    const gate = deferred()
    const running = runGoalUiAction(SESSION, 'goal-1', 'pause', () => gate.promise)
    setGoalUiDirty(SESSION, 'goal-2', true)

    expect(getGoalUiState(SESSION, 'goal-2')).toEqual({ pending: false, dirty: true, error: null, draft: null })

    gate.resolve()
    await running
    expect(getGoalUiState(SESSION, 'goal-1').pending).toBe(false)
    expect(getGoalUiState(SESSION, 'goal-2')).toEqual({ pending: false, dirty: true, error: null, draft: null })
  })

  it('ignores invalid keys and still runs the action when there is nothing to lock', async () => {
    const execute = vi.fn(async () => {})
    await runGoalUiAction('', GOAL, 'confirm', execute)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(getGoalUiState('', GOAL)).toEqual({ pending: false, dirty: false, error: null, draft: null })
    expect(() => setGoalUiDraft('', GOAL, null)).not.toThrow()
    expect(() => retainGoalUi('', GOAL)).not.toThrow()
    expect(() => releaseGoalUi('', GOAL)).not.toThrow()

    const listener = vi.fn()
    const unsubscribe = subscribeGoalUi('', '', listener)
    unsubscribe()
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('goal-ui error kinds', () => {
  it('dismisses a draft refusal once the draft is clean, but never a real failure', async () => {
    const execute = vi.fn(async () => {})

    setGoalUiDirty(SESSION, GOAL, true)
    await runGoalUiAction(SESSION, GOAL, 'resume', execute)
    expect(getGoalUiState(SESSION, GOAL).error).toBe(t('goalUnsavedChanges'))

    // A clean draft (editing, text equal to baseline) dismisses the refusal...
    setGoalUiDraft(SESSION, GOAL, { objective: 'A', text: 'A', editing: true })
    expect(getGoalUiState(SESSION, GOAL).error).toBeNull()

    // ...and so does a low-level clean flag.
    setGoalUiDirty(SESSION, GOAL, true)
    await runGoalUiAction(SESSION, GOAL, 'resume', execute)
    expect(getGoalUiState(SESSION, GOAL).error).toBe(t('goalUnsavedChanges'))
    setGoalUiDirty(SESSION, GOAL, false)
    expect(getGoalUiState(SESSION, GOAL).error).toBeNull()

    // A real HTTP/server error is not a refusal and must survive a clean draft.
    await runGoalUiAction(SESSION, GOAL, 'confirm', async () => { throw new Error('server offline') })
    expect(getGoalUiState(SESSION, GOAL).error).toBe('server offline')
    setGoalUiDirty(SESSION, GOAL, false)
    expect(getGoalUiState(SESSION, GOAL).error).toBe('server offline')
    setGoalUiDraft(SESSION, GOAL, { objective: 'A', text: 'A', editing: true })
    expect(getGoalUiState(SESSION, GOAL).error).toBe('server offline')
  })
})

describe('requestOpenGoalSummary', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('dispatches the shared open event with the session/goal identity', () => {
    const dispatched: CustomEvent<GoalSummaryOpenDetail>[] = []
    ;(globalThis as { window?: unknown }).window = {
      dispatchEvent: (event: CustomEvent<GoalSummaryOpenDetail>) => {
        dispatched.push(event)
        return true
      },
    }

    requestOpenGoalSummary(SESSION, GOAL)
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].type).toBe(OPEN_GOAL_SUMMARY_EVENT)
    expect(dispatched[0].type).toBe('quickforge:open-goal-summary')
    expect(dispatched[0].detail).toEqual({ sessionId: SESSION, goalId: GOAL, view: 'progress' })
    requestOpenGoalSummary(SESSION, GOAL, 'edit')
    expect(dispatched.pop()?.detail).toEqual({ sessionId: SESSION, goalId: GOAL, view: 'edit' })

    // Invalid identities are never turned into an event the shell would ignore.
    requestOpenGoalSummary('', GOAL)
    requestOpenGoalSummary(SESSION, '')
    expect(dispatched).toHaveLength(1)
  })

  it('is a no-op without a browser window', () => {
    expect(() => requestOpenGoalSummary(SESSION, GOAL)).not.toThrow()
  })
})

describe('goal-ui copy contract', () => {
  it('uses the shared Goal keys for the refusal and failure messages', () => {
    applyAppLanguageFromSnapshot('zh')
    expect(t('goalUnsavedChanges')).toBe('有未保存的修改')
    expect(t('goalActionInProgress')).toBe('更新中…')
    applyAppLanguageFromSnapshot('en')
    expect(t('goalUnsavedChanges')).toBe('Unsaved changes')
  })
})
