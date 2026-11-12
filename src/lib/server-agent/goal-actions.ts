import { normalizeGoalState, goalBudgetExtension, type GoalActionOptions, type GoalAction, type GoalState } from '@/lib/goal'
import { t } from '@/lib/i18n'
import { fetchJsonWithTimeout } from '../server-agent-http'
import type { ServerAgentCore } from './core'
import { STATE_REQUEST_TIMEOUT_MS } from './core'

// A goal action must never hang the card: bound it so a stuck request rejects
// (and the card's pending state is released) instead of waiting forever.
const GOAL_ACTION_TIMEOUT_MS = 30000

/**
 * Post a goal action (confirm/pause/resume/cancel/revise/accept). `revise`
 * requires the replacement objective; `accept` is the explicit human sign-off
 * for a `needs_review` goal. The server returns the authoritative goal and the
 * local state adopts it immediately (SSE `goal_updated` is the fallback).
 *
 * Staleness rules:
 * - A missing `goal` field (older server / empty body) preserves the current
 *   state instead of clearing it.
 * - A response that raced a newer goal update never overwrites it: same-id
 *   responses are guarded by `revision`, cross-id / `null` clears by the goal
 *   change watermark captured before the request.
 */
export async function updateGoal(core: ServerAgentCore, action: GoalAction, objective?: string, options?: GoalActionOptions): Promise<GoalState | null> {
  const extending = action === 'extend_resume'
  if (extending) {
    if (!options || !Number.isSafeInteger(options.expectedRevision) || options.expectedRevision <= 0
      || core.state.goal?.id !== options.goalId) throw new Error(t('goalBudgetReconfirm'))
    const signal = options.signal ?? new AbortController().signal
    const snapshot = await refreshGoalForSave(core, options.goalId, signal)
    const goal = core.state.goal
    // Cancellation only gates dispatch. Once POST starts it must settle (and
    // reconcile failures) before the shared UI lock can be released.
    if (signal.aborted || !goal || goal.id !== options.goalId || goal.revision !== options.expectedRevision
      || snapshot.isStreaming || !['paused', 'blocked', 'needs_review'].includes(goal.status)
      || !goalBudgetExtension(goal).exhausted) throw new Error(t('goalBudgetReconfirm'))
  }
  const reconcileExtension = async () => {
    if (extending && options) {
      try { await refreshGoalForSave(core, options.goalId, new AbortController().signal) }
      catch { throw new Error(t('goalBudgetReconcileFailed')) }
    }
  }
  const url = `${core.baseUrl}/api/agents/${encodeURIComponent(core.sessionId)}/goal`
  const body: Record<string, unknown> = extending
    ? { action, goalId: options!.goalId, expectedRevision: options!.expectedRevision }
    : { action }
  if (!extending && typeof objective === 'string') body.objective = objective
  if (!core.canWrite()) throw new Error('Another window is writing to this session')
  // Capture the goal watermark before the async gap. The response is only
  // adopted while no newer goal update (SSE / state / another action) landed
  // in the meantime; otherwise the newer goal already owns the card.
  const capture = core.goalStateController.capture()
  let res: Response
  let payload: { goal?: unknown; error?: string; code?: string } | undefined
  try {
    ({ response: res, body: payload } = await fetchJsonWithTimeout<{ goal?: unknown; error?: string; code?: string }>(
      url,
      GOAL_ACTION_TIMEOUT_MS,
      {
        method: 'POST',
        headers: { ...core.writeHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    ))
  } catch (error) {
    await reconcileExtension()
    // A hung action aborts at the timeout. Surface a bounded error so the
    // caller can clear its pending state instead of waiting forever.
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Failed to update goal: timed out after ${GOAL_ACTION_TIMEOUT_MS}ms`, { cause: error })
    }
    throw error
  }
  if (!res.ok) {
    await reconcileExtension()
    const error = new Error(payload?.error || `Failed to update goal: HTTP ${res.status}`)
    // Machine error codes let the UI map the failure to localized copy.
    if (typeof payload?.code === 'string' && payload.code) (error as Error & { code?: string }).code = payload.code
    throw error
  }
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'goal')) {
    const goalResult = core.goalStateController.adopt(normalizeGoalState(payload.goal), capture)
    // A goal action is applied through HTTP even when no SSE frame follows,
    // so a real change must be broadcast here too (a superseded response
    // reports `changed: false` and stays silent).
    if (goalResult.changed) core.notifyGoalChanged()
  }
  return core.state.goal ?? null
}

/** Save-only reconciliation: never changes message/stream ordering or swallows failures. */
export async function refreshGoalForSave(core: ServerAgentCore, goalId: string, signal: AbortSignal): Promise<{ isStreaming: boolean }> {
  const capture = core.goalStateController.capture()
  const localVersion = core.stateVersion
  const isCurrent = () => !core.disposed && !signal.aborted
    && core.state.goal?.id === goalId && core.state.goal.sessionId === core.sessionId
  if (!isCurrent()) throw new Error(t('goalUnavailable'))
  const { response, body } = await fetchJsonWithTimeout<{
    goal?: unknown; isStreaming?: unknown; stateVersion?: number
  }>(`${core.baseUrl}/api/agents/${encodeURIComponent(core.sessionId)}/state`, STATE_REQUEST_TIMEOUT_MS, { cache: 'no-store', signal })
  if (!response.ok) throw new Error(t('goalRefreshFailed', { status: response.status }))
  const next = normalizeGoalState(body?.goal)
  if (!isCurrent() || !next || next.id !== goalId || next.sessionId !== core.sessionId
    || typeof body?.isStreaming !== 'boolean' || localVersion !== core.stateVersion
    || (typeof body.stateVersion === 'number' && body.stateVersion < core.lastServerStateVersion)) {
    throw new Error(t('goalRefreshUnsafe'))
  }
  const result = core.goalStateController.adopt(next, capture)
  if (!result.applied) throw new Error(t('goalRefreshUnsafe'))
  if (result.changed) core.notifyGoalChanged()
  return { isStreaming: body.isStreaming }
}
