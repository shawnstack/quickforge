import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '../../src/lib/i18n'
import { saveGoalObjective, type SaveGoalObjectiveOptions } from '../../src/lib/goal-edit'
import { normalizeGoalState, type GoalStatus } from '../../src/lib/goal'

vi.mock('@earendil-works/pi-web-ui', () => ({ translations: { en: {}, zh: {} } }))
import { clearGoalUi, getGoalUiState, runGoalUiAction, setGoalUiDraft } from '../../src/lib/goal-ui'

function setup(status: GoalStatus = 'running', isStreaming = true) {
  const current = {
    sessionId: 's',
    goal: normalizeGoalState({ id: 'g', sessionId: 's', objective: 'before', status })!,
    isStreaming,
  }
  const update = vi.fn<(action: string, objective?: string) => Promise<void>>(async () => {})
  const refresh = vi.fn(async () => {
    current.goal.status = 'paused'
    current.isStreaming = false
  })
  const options: SaveGoalObjectiveOptions = {
    sessionId: 's', goalId: 'g', baselineObjective: 'before', objective: ' after ',
    getCurrent: () => current, update, refresh, confirmPause: true,
    timeoutMs: 100, pollIntervalMs: 10,
  }
  return { current, update, refresh, options }
}

afterEach(() => {
  vi.useRealTimers()
  clearGoalUi('s', 'g')
})

describe('saveGoalObjective', () => {
  it.each(['running', 'verifying'] as const)('pauses %s once, refreshes authority, then revises without resuming', async (status) => {
    const { options, update, refresh } = setup(status)
    await saveGoalObjective(options)
    expect(update.mock.calls).toEqual([['pause'], ['revise', 'after']])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0])
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[1])
  })

  it.each(['paused', 'blocked', 'awaiting_confirmation'] as const)('directly revises idle %s', async (status) => {
    const { options, update, refresh } = setup(status, false)
    await saveGoalObjective(options)
    expect(update.mock.calls).toEqual([['revise', 'after']])
    expect(refresh).not.toHaveBeenCalled()
  })

  it('requires explicit consent before pausing', async () => {
    const { options, update } = setup()
    await expect(saveGoalObjective({ ...options, confirmPause: false })).rejects.toThrow(t('goalSaveConfirmPause'))
    expect(update).not.toHaveBeenCalled()
  })

  it.each(['planning', 'pausing', 'needs_review', 'completed', 'failed', 'cancelled', 'awaiting_input', 'awaiting_approval'] as const)('refuses initial %s', async (status) => {
    const { options, update } = setup(status)
    await expect(saveGoalObjective(options)).rejects.toThrow(t('goalSaveNotEditable'))
    expect(update).not.toHaveBeenCalled()
  })

  it('does not mistake paused with an active stream for safe to revise', async () => {
    vi.useFakeTimers()
    const { options, current, update, refresh } = setup('paused')
    refresh.mockImplementation(async () => { current.isStreaming = false })
    const saving = saveGoalObjective(options)
    expect(update).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10)
    await saving
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(update.mock.calls).toEqual([['revise', 'after']])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('polls past paused streaming snapshots without repeating pause', async () => {
    vi.useFakeTimers()
    const { options, current, refresh, update } = setup()
    refresh.mockImplementationOnce(async () => { current.goal.status = 'paused' })
    const saving = saveGoalObjective(options)
    await vi.advanceTimersByTimeAsync(0)
    expect(update.mock.calls).toEqual([['pause']])
    await vi.advanceTimersByTimeAsync(10)
    await saving
    expect(update.mock.calls).toEqual([['pause'], ['revise', 'after']])
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['poll', 'hung refresh'] as const)('has a bounded timeout for %s with no leaked timer', async (mode) => {
    vi.useFakeTimers()
    const { options, refresh, update } = setup()
    refresh.mockImplementation(() => mode === 'poll' ? Promise.resolve() : new Promise(() => {}))
    const assertion = expect(saveGoalObjective(options)).rejects.toThrow(t('goalSaveTimeout'))
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    expect(update.mock.calls).toEqual([['pause']])
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['session', 'goal', 'objective', 'terminal', 'missing'] as const)('does not submit after %s changes during refresh', async (change) => {
    const { options, current, refresh, update } = setup()
    refresh.mockImplementation(async () => {
      current.goal.status = 'paused'
      current.isStreaming = false
      if (change === 'session') current.sessionId = 'other'
      if (change === 'goal') current.goal.id = 'other'
      if (change === 'objective') current.goal.objective = 'external'
      if (change === 'terminal') current.goal.status = 'completed'
    })
    // The callback is captured by the helper: keep a live indirection for missing.
    const getCurrent = options.getCurrent
    if (change === 'missing') options.getCurrent = () => current.goal.status === 'paused' ? null : getCurrent()
    await expect(saveGoalObjective(options)).rejects.toThrow()
    expect(update.mock.calls).toEqual([['pause']])
  })

  it('keeps the mutation lock until a dispatched pause settles even when aborted', async () => {
    const { options, update } = setup()
    const controller = new AbortController()
    let resolve!: () => void
    update.mockImplementation(() => new Promise<void>((done) => { resolve = done }))
    const saving = runGoalUiAction('s', 'g', 'revise', () => saveGoalObjective({ ...options, signal: controller.signal }))
    controller.abort()
    await Promise.resolve()
    expect(getGoalUiState('s', 'g').pending).toBe(true)
    resolve()
    await saving
    expect(update.mock.calls).toEqual([['pause']])
    expect(getGoalUiState('s', 'g')).toMatchObject({ pending: false, error: t('goalSaveCancelled') })
  })

  it.each(['goal', 'objective'] as const)('throws on %s replacement during final revise without retrying', async (change) => {
    const { options, current, update } = setup('paused', false)
    update.mockImplementation(async () => {
      if (change === 'goal') current.goal.id = 'new'
      else current.goal.objective = 'external'
    })
    await expect(saveGoalObjective(options)).rejects.toThrow(t(change === 'goal' ? 'goalSaveIdentityChangedAfter' : 'goalSaveObjectiveChangedAfter'))
    expect(update.mock.calls).toEqual([['revise', 'after']])
  })

  it('rejects an initial objective conflict without any request', async () => {
    const { options, current, update, refresh } = setup()
    current.goal.objective = 'external'
    await expect(saveGoalObjective(options)).rejects.toThrow(t('goalSaveObjectiveChanged'))
    expect(update).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('cancels hung read-only refresh promptly and never continues after its late completion', async () => {
    vi.useFakeTimers()
    const { options, refresh, update } = setup()
    const controller = new AbortController()
    let resolve!: () => void
    refresh.mockImplementation(() => new Promise<void>((done) => { resolve = done }))
    const assertion = expect(saveGoalObjective({ ...options, signal: controller.signal })).rejects.toThrow(t('goalSaveCancelled'))
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await assertion
    resolve()
    await vi.advanceTimersByTimeAsync(100)
    expect(update.mock.calls).toEqual([['pause']])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not dispatch after pre-abort or abort during pause', async () => {
    const { options, update } = setup()
    const controller = new AbortController()
    update.mockImplementation(async () => { controller.abort() })
    await expect(saveGoalObjective({ ...options, signal: controller.signal })).rejects.toThrow(t('goalSaveCancelled'))
    expect(update.mock.calls).toEqual([['pause']])
    update.mockClear()
    await expect(saveGoalObjective({ ...options, signal: controller.signal })).rejects.toThrow(t('goalSaveCancelled'))
    expect(update).not.toHaveBeenCalled()
  })

  it.each(['pause', 'refresh', 'revise'] as const)('propagates %s failure without retry and retains the locked draft', async (failure) => {
    const { options, update, refresh } = setup()
    update.mockImplementation(async (action) => { if (action === failure) throw new Error('HTTP 409') })
    if (failure === 'refresh') refresh.mockRejectedValue(new Error('HTTP 409'))
    setGoalUiDraft('s', 'g', { objective: 'before', text: 'after', editing: true })
    await runGoalUiAction('s', 'g', 'revise', () => saveGoalObjective(options))
    expect(update.mock.calls).toEqual(failure === 'revise' ? [['pause'], ['revise', 'after']] : [['pause']])
    expect(getGoalUiState('s', 'g')).toMatchObject({ pending: false, dirty: true, error: 'HTTP 409', draft: { text: 'after' } })
  })
})
