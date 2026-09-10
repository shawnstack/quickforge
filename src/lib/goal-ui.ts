/**
 * Shared Goal UI store — the single client-side owner of "a goal action is in
 * flight", "this goal has an unsaved draft" and the retained draft text for
 * every Goal surface (the pinned-summary section, the composer control bar, the
 * legacy goal card).
 *
 * Why a module-level store instead of component state: the Goal section lives
 * in the pinned summary and can be hidden/minimized while another surface (the
 * composer control bar) still needs to render the same pending/dirty truth. A
 * single store keyed by `sessionId` + `goalId` also guarantees that a late
 * response for an old goal can never unlock or overwrite the current one.
 *
 * The draft itself also lives here (see `GoalUiDraft`): the pinned summary is
 * remounted when it closes/reopens or when the responsive desktop/mobile tree
 * changes, and a component-local draft would be lost (and its dirty lock
 * stranded) across that unmount. A mounted surface pins its key with
 * `retainGoalUi`/`releaseGoalUi`; the store keeps the draft while the surface is
 * gone and reclaims the oldest ones with a small LRU so a long-lived page cannot
 * leak goal drafts.
 *
 * The store is deliberately DOM-free (no window/document access at module
 * scope) so it can be unit tested in the node vitest environment and imported
 * by any surface.
 */

import { t } from '@/lib/i18n'
import { type GoalAction, type GoalState } from '@/lib/goal'

/** Bridge event: a Goal surface asks the app shell to reveal the pinned summary. */
export const OPEN_GOAL_SUMMARY_EVENT = 'quickforge:open-goal-summary'

/** `OPEN_GOAL_SUMMARY_EVENT` detail; the shell only honours the current session/goal. */
export type GoalSummaryOpenDetail = {
  sessionId: string
  goalId: string
  view?: 'progress' | 'edit'
}

/**
 * Retained objective draft for one goal key. The server objective is the
 * baseline: `text` is what the user typed and `editing` whether the editor is
 * open. It lives in the store (not the component) so a full close or a
 * responsive remount re-opens the same editor with the same text and keeps the
 * shared dirty lock, instead of stranding the goal behind a draft nobody can
 * reach.
 */
export type GoalUiDraft = {
  /** Server baseline; a mismatch is a retained conflict, never safe to overwrite. */
  objective: string
  /** Live textarea text (equal to `objective` until the first edit). */
  text: string
  /** Whether the objective editor is open on a mounted surface. */
  editing: boolean
}

export type GoalUiState = {
  /** A real request is in flight: no surface may start another one. */
  pending: boolean
  /** An unsaved draft blocks confirm/resume/accept, never pause/cancel/revise. */
  dirty: boolean
  /** Last failure, the reason an action was refused, or null. */
  error: string | null
  /**
   * Retained objective draft, or null. The composer strip's
   * `GoalControlStripUiState` (pending/dirty/error) stays a structural subset of
   * this snapshot, so adding the field does not break existing consumers.
   */
  draft: GoalUiDraft | null
}

/** Stable idle snapshot: shared by every key so React state stays referentially stable. */
const IDLE_GOAL_UI_STATE: GoalUiState = { pending: false, dirty: false, error: null, draft: null }

/** Why the last error is on screen: a draft refusal is not a request failure. */
type GoalUiErrorKind = 'dirty' | 'failure'

type GoalUiEntry = {
  pending: boolean
  dirty: boolean
  error: string | null
  errorKind: GoalUiErrorKind | null
  draft: GoalUiDraft | null
  /** Mounted surfaces currently rendering this key; a pinned key is never reclaimed. */
  retains: number
  /** Monotonic token isolating async settlements of the same key. */
  token: number
  listeners: Set<() => void>
  /** Cached snapshot; recreated only when the observable state actually changes. */
  state: GoalUiState
}

/**
 * One entry per (session, goal). Entries are reclaimable: an idle entry without
 * subscribers, draft or error is dropped, so a long session that walks through
 * many goals does not accumulate state.
 */
const entries = new Map<string, GoalUiEntry>()

/**
 * Small LRU bound for drafts whose surface is gone. Mounted surfaces pin their
 * key, so only the current session's recent unsaved drafts are held; the oldest
 * are reclaimed (dropping the draft and its dirty lock) so a long-lived page
 * cannot leak goal drafts forever.
 */
export const MAX_RETAINED_GOAL_DRAFTS = 6
/** Keys with a retained draft and no mounted surface, oldest first. */
const retainedDraftOrder: string[] = []

/** Empty session/goal ids are invalid: callers degrade to a no-op. */
function goalUiKey(sessionId: string, goalId: string): string {
  const session = typeof sessionId === 'string' ? sessionId : ''
  const goal = typeof goalId === 'string' ? goalId : ''
  if (!session || !goal) return ''
  return `${session}\u0000${goal}`
}

function createEntry(): GoalUiEntry {
  return {
    pending: false,
    dirty: false,
    error: null,
    errorKind: null,
    draft: null,
    retains: 0,
    token: 0,
    listeners: new Set(),
    state: IDLE_GOAL_UI_STATE,
  }
}

function ensureEntry(key: string): GoalUiEntry {
  const existing = entries.get(key)
  if (existing) return existing
  const entry = createEntry()
  entries.set(key, entry)
  return entry
}

function normalizeDraft(draft: GoalUiDraft | null): GoalUiDraft | null {
  if (!draft) return null
  return {
    objective: typeof draft.objective === 'string' ? draft.objective : '',
    text: typeof draft.text === 'string' ? draft.text : '',
    editing: draft.editing === true,
  }
}

function sameDraft(a: GoalUiDraft | null, b: GoalUiDraft | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.objective === b.objective && a.text === b.text && a.editing === b.editing
}

/** A draft only counts as dirty once it differs from its server baseline. */
function draftIsDirty(draft: GoalUiDraft | null): boolean {
  return draft !== null && draft.text.trim() !== draft.objective.trim()
}

function forgetRetainedDraft(key: string): void {
  const index = retainedDraftOrder.indexOf(key)
  if (index >= 0) retainedDraftOrder.splice(index, 1)
}

function touchRetainedDraft(key: string): void {
  forgetRetainedDraft(key)
  retainedDraftOrder.push(key)
}

/** Reclaim the oldest unpinned drafts once the LRU grows past its bound. */
function trimRetainedDrafts(): void {
  while (retainedDraftOrder.length > MAX_RETAINED_GOAL_DRAFTS) {
    const oldest = retainedDraftOrder.shift()
    if (oldest === undefined) return
    const entry = entries.get(oldest)
    if (!entry || entry.retains > 0 || !entry.draft) continue
    entry.draft = null
    entry.dirty = false
    if (entry.errorKind === 'dirty') {
      entry.error = null
      entry.errorKind = null
    }
    publish(oldest, entry)
  }
}

/** Drop an idle entry nobody can observe any more (pending requests/drafts stay alive). */
function disposeIfIdle(key: string, entry: GoalUiEntry): void {
  if (entry.pending || entry.dirty || entry.error !== null) return
  if (entry.draft) return
  if (entry.retains > 0) return
  if (entry.listeners.size > 0) return
  entries.delete(key)
}

/** Refresh the cached snapshot, notify subscribers, then reclaim the entry when idle. */
function publish(key: string, entry: GoalUiEntry): void {
  const current = entry.state
  if (
    current.pending !== entry.pending
    || current.dirty !== entry.dirty
    || current.error !== entry.error
    || current.draft !== entry.draft
  ) {
    entry.state = { pending: entry.pending, dirty: entry.dirty, error: entry.error, draft: entry.draft }
  }
  for (const listener of [...entry.listeners]) {
    try {
      listener()
    } catch {
      // A broken subscriber must never break the store or its other subscribers.
    }
  }
  disposeIfIdle(key, entry)
}

/**
 * State of one key. Returns a referentially stable snapshot while nothing
 * changed, and the shared idle snapshot for unknown/invalid keys.
 */
export function getGoalUiState(sessionId: string, goalId: string): GoalUiState {
  const key = goalUiKey(sessionId, goalId)
  if (!key) return IDLE_GOAL_UI_STATE
  return entries.get(key)?.state ?? IDLE_GOAL_UI_STATE
}

/** Subscribe to one key's pending/dirty/error/draft changes. */
export function subscribeGoalUi(sessionId: string, goalId: string, listener: () => void): () => void {
  const key = goalUiKey(sessionId, goalId)
  if (!key || typeof listener !== 'function') return () => {}
  const entry = ensureEntry(key)
  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
    disposeIfIdle(key, entry)
  }
}

/**
 * Pin a key for the lifetime of a mounted surface. A pinned key is never
 * reclaimed and its draft is guaranteed to survive the responsive remount that
 * follows (the new surface re-pins the same key).
 */
export function retainGoalUi(sessionId: string, goalId: string): void {
  const key = goalUiKey(sessionId, goalId)
  if (!key) return
  const entry = ensureEntry(key)
  entry.retains += 1
  forgetRetainedDraft(key)
}

/**
 * Release a surface's pin. The draft (and its dirty lock) is deliberately kept
 * so a closed/reopened or responsive-remounted panel restores it; the LRU bound
 * reclaims only drafts whose surface has been gone the longest.
 */
export function releaseGoalUi(sessionId: string, goalId: string): void {
  const key = goalUiKey(sessionId, goalId)
  if (!key) return
  const entry = entries.get(key)
  if (!entry) return
  if (entry.retains > 0) entry.retains -= 1
  if (entry.retains > 0) return
  if (!entry.draft) {
    disposeIfIdle(key, entry)
    return
  }
  touchRetainedDraft(key)
  trimRetainedDrafts()
}

/**
 * Store (or clear) the retained objective draft. Dirty is derived from the
 * draft text vs. its server baseline, and a now-clean draft dismisses a previous
 * "blocked by draft" refusal without touching a real request failure.
 */
export function setGoalUiDraft(sessionId: string, goalId: string, draft: GoalUiDraft | null): void {
  const key = goalUiKey(sessionId, goalId)
  if (!key) return
  const entry = ensureEntry(key)
  const next = normalizeDraft(draft)
  const nextDirty = draftIsDirty(next)
  const clearsRefusal = !nextDirty && entry.errorKind === 'dirty' && entry.error !== null
  if (sameDraft(entry.draft, next) && entry.dirty === nextDirty && !clearsRefusal) return
  entry.draft = next
  entry.dirty = nextDirty
  if (!nextDirty && entry.errorKind === 'dirty') {
    entry.error = null
    entry.errorKind = null
  }
  if (next === null) {
    forgetRetainedDraft(key)
  } else if (entry.retains === 0) {
    touchRetainedDraft(key)
    trimRetainedDrafts()
  }
  publish(key, entry)
}

/**
 * Low-level dirty flag (kept for surfaces that only publish the fact, not the
 * text). Clearing it also dismisses a previous draft refusal, but never a real
 * request failure.
 */
export function setGoalUiDirty(sessionId: string, goalId: string, dirty: boolean): void {
  const key = goalUiKey(sessionId, goalId)
  if (!key) return
  const entry = ensureEntry(key)
  const next = dirty === true
  const clearsRefusal = !next && entry.errorKind === 'dirty' && entry.error !== null
  if (entry.dirty === next && !clearsRefusal) return
  entry.dirty = next
  if (!next && entry.errorKind === 'dirty') {
    entry.error = null
    entry.errorKind = null
  }
  publish(key, entry)
}

/**
 * Unmount/discard cleanup for one key: drops the draft, the draft flag and the
 * last error so a goal is not locked forever by a surface that is gone. An
 * in-flight request is a real request — it keeps `pending` locked and only the
 * matching settlement releases it. Surfaces that want the draft to survive a
 * close/remount must use `releaseGoalUi` instead.
 */
export function clearGoalUi(sessionId: string, goalId: string): void {
  const key = goalUiKey(sessionId, goalId)
  if (!key) return
  const entry = entries.get(key)
  if (!entry) return
  entry.dirty = false
  entry.error = null
  entry.errorKind = null
  entry.draft = null
  forgetRetainedDraft(key)
  publish(key, entry)
}

/**
 * Reconcile the shared store with the authoritative goal.
 *
 * Running goals retain drafts so the editor can pause safely before saving.
 * External objective changes retain the original baseline and text: the editor
 * and saveGoalObjective must refuse that conflict rather than overwrite it.
 * Terminal goals retain text for read-only recovery but release the dirty guard.
 * The app shell reconciles even while the editor is not mounted.
 */
export function syncGoalUiState(sessionId: string, goal: GoalState | null | undefined): void {
  if (!goal) return
  const key = goalUiKey(sessionId, goal.id)
  if (!key) return
  const entry = entries.get(key)
  if (!entry || (!entry.draft && !entry.dirty)) return
  if (goal.status === 'completed' || goal.status === 'failed' || goal.status === 'cancelled') {
    if (entry.draft?.editing) entry.draft = { ...entry.draft, editing: false }
    entry.dirty = false
    if (entry.errorKind === 'dirty') {
      entry.error = null
      entry.errorKind = null
    }
    publish(key, entry)
  }
}

/**
 * Run one goal action through the shared lock.
 *
 * Rules (the surfaces mirror them, the store enforces them):
 * - a pending request refuses repeats,
 * - a dirty draft blocks confirm/resume/accept, and reports why,
 * - failures are stored and broadcast instead of being thrown at the caller,
 * - the lock is always released, and a stale settlement never unlocks a key
 *   that was replaced while the request was in flight.
 */
export async function runGoalUiAction(
  sessionId: string,
  goalId: string,
  action: GoalAction,
  execute: () => Promise<unknown>,
): Promise<void> {
  const key = goalUiKey(sessionId, goalId)
  if (!key) {
    await execute()
    return
  }
  const entry = ensureEntry(key)
  // Synchronous lock: a second click in the same tick cannot start a request.
  if (entry.pending) return
  if (entry.dirty && action !== 'revise' && action !== 'pause' && action !== 'cancel') {
    entry.error = t('goalUnsavedChanges')
    entry.errorKind = 'dirty'
    publish(key, entry)
    return
  }

  const token = ++entry.token
  entry.pending = true
  entry.error = null
  entry.errorKind = null
  publish(key, entry)

  let failure: string | null = null
  try {
    await execute()
  } catch (error) {
    failure = error instanceof Error && error.message ? error.message : t('goalActionFailed')
  }

  // A newer request owns this key now: the late settlement must not unlock it.
  if (entry.token !== token) return

  entry.pending = false
  if (failure) {
    entry.error = failure
    entry.errorKind = 'failure'
  }
  publish(key, entry)
}

/**
 * Ask the app shell to reveal the pinned summary for this goal (e.g. from a
 * dismissed summary or the composer control bar). No-op outside the browser.
 */
export function requestOpenGoalSummary(
  sessionId: string,
  goalId: string,
  view: NonNullable<GoalSummaryOpenDetail['view']> = 'progress',
): void {
  const key = goalUiKey(sessionId, goalId)
  if (!key) return
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  const detail: GoalSummaryOpenDetail = { sessionId, goalId, view }
  window.dispatchEvent(new CustomEvent<GoalSummaryOpenDetail>(OPEN_GOAL_SUMMARY_EVENT, { detail }))
}
