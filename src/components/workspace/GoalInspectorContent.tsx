import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { buildGoalCardViewModel } from '@/components/chat/panel-decoration/goal-card'
import { Button } from '@/components/ui/button'
import { goalBudgetExtension, goalDurationMinutes, goalIsEditable, isGoalTerminal, type GoalAction, type GoalActionOptions, type GoalState, type GoalStatus } from '@/lib/goal'
import { getGoalUiState, releaseGoalUi, retainGoalUi, runGoalUiAction, setGoalUiDraft, subscribeGoalUi } from '@/lib/goal-ui'
import { t, type AppTextKey } from '@/lib/i18n'
import './goal-inspector.css'

export type GoalInspectorBinding = {
  goal: GoalState
  sessionId: string
  onAction: (action: GoalAction, objective?: string, options?: GoalActionOptions) => Promise<unknown>
  onSave: (baselineObjective: string, objective: string, confirmPause: boolean, signal: AbortSignal) => Promise<void>
}

/** One actionable hint line per status (T-A); the long notes live in the ? popover. */
const STATUS_HINT_KEY: Record<GoalStatus, AppTextKey> = {
  planning: 'goalHintAwaitingConfirmation',
  awaiting_confirmation: 'goalHintAwaitingConfirmation',
  running: 'goalHintRunning',
  verifying: 'goalHintRunning',
  awaiting_input: 'goalHintAwaitingInput',
  awaiting_approval: 'goalHintAwaitingApproval',
  pausing: 'goalHintPausing',
  paused: 'goalHintPaused',
  blocked: 'goalHintBlocked',
  needs_review: 'goalHintNeedsReview',
  completed: 'goalHintCompleted',
  failed: 'goalHintFailed',
  cancelled: 'goalHintCancelled',
}

/** Renders the wire timestamp in the user's locale instead of the raw ISO value (G-09). */
function formatGoalTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** Static meter fill: whole-percent width, capped at 100% (no animation, no fake precision). */
function meterPercent(used: number, limit: number): number {
  return limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
}

/**
 * The ? affordance that collects the long mechanism notes behind one click
 * (DESIGN_LANGUAGE L187-191). Click toggles, Escape and outside clicks close.
 */
function GoalHintPopover({ notes, label }: { notes: string[]; label: string }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])
  return (
    <span className="quickforge-goal-inspector-pop" ref={rootRef}>
      <button type="button" className="quickforge-goal-inspector-qbtn" aria-label={label} aria-expanded={open} onClick={() => setOpen((value) => !value)}>?</button>
      {open && <span className="quickforge-goal-inspector-pop-body">{notes.map((note) => <span key={note}>{note}</span>)}</span>}
    </span>
  )
}

export function GoalInspectorContent({ goal, sessionId, onAction, onSave, active, view, onViewChange }: GoalInspectorBinding & {
  active: boolean
  view: 'progress' | 'edit'
  onViewChange: (view: 'progress' | 'edit') => void
}) {
  const [ui, setUi] = useState(() => getGoalUiState(sessionId, goal.id))
  const [confirmPause, setConfirmPause] = useState(false)
  const [budgetConfirmation, setBudgetConfirmation] = useState<GoalActionOptions | null>(null)
  const extension = goalBudgetExtension(goal)
  const confirmationCurrent = budgetConfirmation?.goalId === goal.id && budgetConfirmation.expectedRevision === goal.revision
  const confirmationScope = JSON.stringify([active, sessionId, goal.id, view])
  const [previousScope, setPreviousScope] = useState(confirmationScope)
  if (previousScope !== confirmationScope) {
    setPreviousScope(confirmationScope)
    setBudgetConfirmation(null)
  }
  const saveController = useRef<AbortController | null>(null)
  const extendController = useRef<AbortController | null>(null)
  const extendButtonRef = useRef<HTMLButtonElement>(null)
  const keepBudgetRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (budgetConfirmation) keepBudgetRef.current?.focus()
  }, [budgetConfirmation])
  const dismissBudget = () => {
    setBudgetConfirmation(null)
    extendButtonRef.current?.focus()
  }
  useLayoutEffect(() => {
    if (!active) extendController.current?.abort()
    return () => { extendController.current?.abort() }
  }, [active, sessionId, goal.id, view])
  // Closing retains this component during the exit animation. Cancel at commit,
  // not delayed unmount; switching progress/edit intentionally keeps the draft.
  useLayoutEffect(() => {
    if (!active) {
      saveController.current?.abort()
      saveController.current = null
    }
    return () => {
      saveController.current?.abort()
      saveController.current = null
    }
  }, [active, sessionId, goal.id])
  const sectionRef = useRef<HTMLElement>(null)
  const saveButtonRef = useRef<HTMLButtonElement>(null)
  const keepWorkingRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (confirmPause) keepWorkingRef.current?.focus()
  }, [confirmPause])
  const dismissPause = () => {
    setConfirmPause(false)
    saveButtonRef.current?.focus()
  }
  useEffect(() => {
    retainGoalUi(sessionId, goal.id)
    const sync = () => setUi(getGoalUiState(sessionId, goal.id))
    sync()
    const unsubscribe = subscribeGoalUi(sessionId, goal.id, sync)
    return () => {
      saveController.current?.abort()
      unsubscribe()
      releaseGoalUi(sessionId, goal.id)
    }
  }, [sessionId, goal.id])
  const model = buildGoalCardViewModel(goal)
  const notes = model.noteKeys.map((key) => t(key as AppTextKey))
  const draft = ui.draft
  const text = draft?.text ?? goal.objective
  const baseline = draft?.objective ?? goal.objective
  const dirty = text.trim() !== baseline.trim()
  const conflict = !!draft && baseline !== goal.objective
  const running = goal.status === 'running' || goal.status === 'verifying'
  const editable = !isGoalTerminal(goal.status) && (goalIsEditable(goal.status) || running)
  const iterationExhausted = goal.usage.iterations >= goal.budget.maxIterations
  const durationExhausted = goal.budget.maxActiveDurationMs !== null && goal.usage.activeDurationMs >= goal.budget.maxActiveDurationMs
  const save = async (pauseConfirmed = false) => {
    if (!active || !editable || !dirty || conflict || !text.trim() || ui.pending || saveController.current) return
    if (running && !pauseConfirmed) { setConfirmPause(true); return }
    const controller = new AbortController()
    saveController.current = controller
    await runGoalUiAction(sessionId, goal.id, 'revise', async () => {
      await onSave(baseline, text, pauseConfirmed, controller.signal)
      if (!controller.signal.aborted) setGoalUiDraft(sessionId, goal.id, null)
    })
    if (saveController.current === controller) saveController.current = null
    if (!controller.signal.aborted) {
      setConfirmPause(false)
      sectionRef.current?.focus()
    }
  }
  const run = async (action: GoalAction, options?: GoalActionOptions) => {
    if (!active) return
    if (action === 'extend_resume') {
      if (extendController.current || !confirmationCurrent || !extension.exhausted || !model.resumable) return
      const controller = new AbortController()
      extendController.current = controller
      setBudgetConfirmation(null)
      await runGoalUiAction(sessionId, goal.id, action, () => onAction(action, undefined, { ...options!, signal: controller.signal }))
      if (extendController.current === controller) extendController.current = null
      if (!controller.signal.aborted) (extendButtonRef.current ?? sectionRef.current)?.focus()
      return
    }
    await runGoalUiAction(sessionId, goal.id, action, () => onAction(action, undefined, options))
    sectionRef.current?.focus()
  }
  return (
    <section className="quickforge-goal-inspector" data-tone={model.tone} ref={sectionRef} tabIndex={-1} aria-label={t('goalTitle')}>
      <div className="quickforge-goal-inspector-scroll">
        <nav className="quickforge-goal-inspector-seg" aria-label={t('goalTitle')}>
          <button type="button" aria-pressed={view === 'progress'} onClick={() => onViewChange('progress')}>{t('goalProgressView')}</button>
          <button type="button" aria-pressed={view === 'edit'} onClick={() => onViewChange('edit')}>{t('goalEditObjective')}</button>
        </nav>
        <div className="quickforge-goal-inspector-status" role="status">
          <span className="quickforge-goal-inspector-status-dot" aria-hidden="true" />
          <span className="quickforge-goal-inspector-status-word">{t(model.statusKey as AppTextKey)}</span>
          {notes.length > 0 && <GoalHintPopover notes={notes} label={t('goalHintDetails')} />}
          <time dateTime={goal.updatedAt}>{formatGoalTime(goal.updatedAt)}</time>
        </div>
        {ui.error && <p role="alert">{ui.error}</p>}
        {view === 'edit' ? <>
          <label className="flex min-h-0 flex-1 flex-col gap-2">{t('goalEditObjective')}
            <textarea aria-label={t('goalEditObjective')} value={text} readOnly={!editable || ui.pending} onChange={(event) => setGoalUiDraft(sessionId, goal.id, { objective: baseline, text: event.target.value, editing: true })} onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void save() }
            }} />
          </label>
          {conflict && <p role="alert">{t('goalDraftConflict')}</p>}
          {!editable && <p className="text-muted-foreground">{t('goalReadOnly')}</p>}
        </> : <>
          <h2>{goal.objective}</h2>
          {(model.blocker || model.blockerHint) && <div className="quickforge-goal-inspector-blocker" role="status">{model.blockerHint || model.blocker}</div>}
          {model.summary && <p className="quickforge-goal-inspector-summary">{model.summary}</p>}
          <div className="quickforge-goal-inspector-sectiontitle">{t('goalCriteriaLabel')}</div>
          <div className="quickforge-goal-inspector-criteria">
            {goal.criteria.map((criterion, index) => <div key={criterion.id} className="quickforge-goal-inspector-criterion">
              <span className="quickforge-goal-inspector-badge" data-status={criterion.status}>{t(model.criteria[index].statusKey as AppTextKey)}</span>
              <div className="quickforge-goal-inspector-criterion-main">
                <div className="quickforge-goal-inspector-criterion-desc">{criterion.description}</div>
                {criterion.evidenceIds.map((id) => {
                  const evidence = goal.evidence.find((entry) => entry.id === id)
                  return evidence ? <details key={id}><summary>{t('goalEvidenceLabel')} · {evidence.toolName || evidence.source || evidence.id}</summary><div className="whitespace-pre-wrap">{evidence.description}{evidence.toolCallId && <code>{evidence.toolCallId}</code>}{evidence.acceptedAt && <time dateTime={evidence.acceptedAt}>{formatGoalTime(evidence.acceptedAt)}</time>}</div></details> : null
                })}
              </div>
            </div>)}
            {goal.evidence.filter((entry) => !goal.criteria.some((criterion) => criterion.evidenceIds.includes(entry.id))).map((entry) => <details key={entry.id}><summary>{t('goalEvidenceLabel')} · {entry.toolName || entry.source || entry.id}</summary><div className="whitespace-pre-wrap">{entry.description}</div></details>)}
          </div>
          <div className="quickforge-goal-inspector-sectiontitle">{t('goalBudgetLabel')}</div>
          <div className="quickforge-goal-inspector-budget">
            <div className="quickforge-goal-inspector-budget-row" data-exhausted={iterationExhausted}>
              <span className="quickforge-goal-inspector-budget-label">{t('goalBudgetIterationsLabel')}</span>
              <div className="quickforge-goal-inspector-meter"><div className="quickforge-goal-inspector-meter-fill" style={{ width: `${meterPercent(goal.usage.iterations, goal.budget.maxIterations)}%` }} /></div>
              <span className="quickforge-goal-inspector-budget-value">{goal.usage.iterations}<em>/{goal.budget.maxIterations}</em></span>
              {iterationExhausted && <span className="quickforge-goal-inspector-chip">{t('goalBudgetExhausted')}</span>}
            </div>
            <div className="quickforge-goal-inspector-budget-row" data-exhausted={durationExhausted}>
              <span className="quickforge-goal-inspector-budget-label">{t('goalBudgetDurationLabel')}</span>
              {goal.budget.maxActiveDurationMs !== null && <div className="quickforge-goal-inspector-meter"><div className="quickforge-goal-inspector-meter-fill" style={{ width: `${meterPercent(goal.usage.activeDurationMs, goal.budget.maxActiveDurationMs)}%` }} /></div>}
              <span className="quickforge-goal-inspector-budget-value">{goalDurationMinutes(goal.usage.activeDurationMs)}<em>/{goal.budget.maxActiveDurationMs === null ? t('goalUnlimitedTime') : goalDurationMinutes(goal.budget.maxActiveDurationMs)}</em></span>
              {durationExhausted && <span className="quickforge-goal-inspector-chip">{t('goalBudgetExhausted')}</span>}
            </div>
          </div>
          <details className="quickforge-goal-inspector-scope"><summary>{t('goalScopeLabel')}</summary><ul>{model.scope.map((scope, index) => <li key={index}>{scope}</li>)}</ul></details>
          {budgetConfirmation && <div role="group" aria-label={t('goalExtendResume')} className="quickforge-goal-inspector-confirm" onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissBudget() }
          }}>
            <p>{t('goalBudgetGrant', { minutes: extension.activeDurationMs / 60_000, iterations: extension.iterations })}</p>
            {extension.stillExhausted && <p role="status">{t('goalBudgetStillExhausted')}</p>}
            {!confirmationCurrent && <p role="alert">{t('goalBudgetReconfirm')}</p>}
            <div className="quickforge-goal-inspector-actions">
              <Button type="button" disabled={ui.pending || ui.dirty || !confirmationCurrent || !model.resumable || !extension.exhausted} onClick={() => void run('extend_resume', budgetConfirmation)}>{t('goalConfirm')}</Button>
              <Button ref={keepBudgetRef} type="button" variant="ghost" disabled={ui.pending} onClick={dismissBudget}>{t('goalKeepWorking')}</Button>
            </div>
          </div>}
          <div className="quickforge-goal-inspector-hint"><span>{t(STATUS_HINT_KEY[goal.status])}</span></div>
        </>}
      </div>
      <div className="quickforge-goal-inspector-footer">
        {view === 'edit' ? <>
          {confirmPause && <div role="group" aria-label={t('goalPauseAndSave')} className="quickforge-goal-inspector-actions" onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissPause() }
          }}><span>{t('goalPauseSaveNote')}</span><Button type="button" disabled={ui.pending} onClick={() => void save(true)}>{t('goalPauseAndSave')}</Button><Button ref={keepWorkingRef} type="button" variant="ghost" disabled={ui.pending} onClick={dismissPause}>{t('goalKeepWorking')}</Button></div>}
          <footer className="quickforge-goal-inspector-actions"><time className="mr-auto text-xs text-muted-foreground" dateTime={goal.updatedAt}>{t('goalUpdatedAt', { time: formatGoalTime(goal.updatedAt) })}</time><Button type="button" variant="secondary" disabled={!draft || ui.pending} onClick={() => { setGoalUiDraft(sessionId, goal.id, null); setConfirmPause(false) }}>{t('goalDiscardDraft')}</Button><Button ref={saveButtonRef} type="button" disabled={!editable || !dirty || conflict || !text.trim() || ui.pending} onClick={() => void save()}>{t('goalSaveObjective')}</Button></footer>
        </> : <div className="quickforge-goal-inspector-actions">{model.confirmable && <Button type="button" disabled={ui.pending || ui.dirty} onClick={() => void run('confirm')}>{t('goalConfirm')}</Button>}{model.accepting && <Button type="button" disabled={ui.pending || ui.dirty || model.acceptBlocked} onClick={() => void run('accept')}>{t('goalAccept')}</Button>}{model.resumable && <Button ref={extendButtonRef} type="button" variant={model.accepting ? 'secondary' : 'default'} disabled={ui.pending || ui.dirty} onClick={() => extension.exhausted ? setBudgetConfirmation({ goalId: goal.id, expectedRevision: goal.revision }) : void run('resume')}>{t(extension.exhausted ? 'goalExtendResume' : 'goalResume')}</Button>}</div>}
      </div>
    </section>
  )
}
