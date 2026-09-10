import { goalIsEditable, type GoalAction, type GoalState } from '@/lib/goal'
import { t } from '@/lib/i18n'

export type SaveGoalObjectiveOptions = {
  sessionId: string
  goalId: string
  baselineObjective: string
  objective: string
  getCurrent: () => { sessionId: string; goal: GoalState | null; isStreaming: boolean } | null
  refresh: (signal: AbortSignal) => Promise<{ isStreaming: boolean } | void>
  update: (action: GoalAction, objective?: string) => Promise<unknown>
  confirmPause: boolean
  signal?: AbortSignal
  /** Bounds read-only settling, not an already dispatched mutation's HTTP lifetime. */
  timeoutMs?: number
  pollIntervalMs?: number
}

/**
 * Save under the caller's runGoalUiAction('revise') lock. Never retries a POST,
 * resumes, or confirms. A paused snapshot is not proof of server quiescence:
 * a final revise conflict must reach the caller with its draft intact.
 */
export async function saveGoalObjective(options: SaveGoalObjectiveOptions): Promise<void> {
  const { sessionId, goalId, baselineObjective, getCurrent, refresh, update, signal } = options
  const objective = options.objective.trim()
  const timeoutMs = options.timeoutMs ?? 15_000
  const pollIntervalMs = options.pollIntervalMs ?? 250
  if (!sessionId || !goalId || !objective) throw new Error(t('goalSaveRequired'))
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error(t('goalSaveInvalidTiming'))
  }
  const deadline = Date.now() + timeoutMs
  const checkCancelled = () => {
    if (signal?.aborted) throw new Error(t('goalSaveCancelled'))
  }
  const check = () => {
    checkCancelled()
    if (Date.now() >= deadline) throw new Error(t('goalSaveTimeout'))
    const current = getCurrent()
    if (!current || current.sessionId !== sessionId || !current.goal
      || current.goal.id !== goalId || current.goal.sessionId !== sessionId) {
      throw new Error(t('goalSaveIdentityChanged'))
    }
    if (current.goal.objective !== baselineObjective) {
      throw new Error(t('goalSaveObjectiveChanged'))
    }
    return { ...current, goal: current.goal }
  }

  // Only read-only work races this deadline/abort. Mutation requests own their
  // HTTP timeout and must settle before the shared lock can be released.
  let refreshedStreaming: boolean | undefined
  const wait = async (read?: SaveGoalObjectiveOptions['refresh']) => {
    check()
    const readController = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        onAbort = () => reject(new Error(t('goalSaveCancelled')))
        signal?.addEventListener('abort', onAbort, { once: true })
        const remaining = deadline - Date.now()
        timer = setTimeout(
          read ? () => reject(new Error(t('goalSaveTimeout'))) : resolve,
          read ? remaining : Math.min(pollIntervalMs, remaining),
        )
        if (signal?.aborted) onAbort()
        else if (read) Promise.resolve().then(() => {
          check()
          return read(readController.signal)
        }).then((snapshot) => {
          if (!readController.signal.aborted) refreshedStreaming = snapshot?.isStreaming
          resolve()
        }, reject)
      })
    } finally {
      readController.abort()
      if (timer !== undefined) clearTimeout(timer)
      if (onAbort) signal?.removeEventListener('abort', onAbort)
    }
    check()
  }

  const initial = check()
  const needsPause = initial.goal.status === 'running' || initial.goal.status === 'verifying'
  if (needsPause) {
    if (!options.confirmPause) throw new Error(t('goalSaveConfirmPause'))
    await update('pause')
    check()
  } else if (!goalIsEditable(initial.goal.status)) {
    throw new Error(t('goalSaveNotEditable'))
  }

  // After pause, always refresh even if the POST/SSE already says paused.
  let mustRefresh = needsPause
  while (true) {
    if (mustRefresh) await wait(refresh)
    const current = check()
    const status = current.goal.status
    const ready = needsPause ? status === 'paused' : goalIsEditable(status)
    if (ready && !(refreshedStreaming ?? current.isStreaming)) {
      // No async gap between final identity/baseline check and dispatch.
      await update('revise', objective)
      checkCancelled()
      const settled = getCurrent()
      if (!settled || settled.sessionId !== sessionId || !settled.goal
        || settled.goal.id !== goalId || settled.goal.sessionId !== sessionId) {
        throw new Error(t('goalSaveIdentityChangedAfter'))
      }
      if (settled.goal.objective !== baselineObjective && settled.goal.objective !== objective) {
        throw new Error(t('goalSaveObjectiveChangedAfter'))
      }
      return
    }
    const settling = needsPause
      ? status === 'running' || status === 'verifying' || status === 'pausing' || status === 'paused'
      : goalIsEditable(status)
    if (!settling) throw new Error(t('goalSaveNotEditable'))
    await wait()
    mustRefresh = true
  }
}
