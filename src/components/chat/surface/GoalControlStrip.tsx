import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t, type AppTextKey } from '@/lib/i18n'
import {
  goalBudgetExtension,
  goalCanCancel,
  type GoalAction,
  type GoalState,
} from '@/lib/goal'
import {
  getGoalUiState,
  requestOpenGoalSummary,
  runGoalUiAction,
  subscribeGoalUi,
} from '@/lib/goal-ui'
import {
  buildGoalControlStripView,
  type GoalControlStripUiState,
  type GoalControlStripView,
} from '../panel-decoration/goal-control-strip'
import { goalStatusIcon } from '../panel-decoration/icons'

/**
 * Goal control strip — the single-row goal affordance above the composer,
 * previously built by `panel-decoration/goal-control-strip.ts`.
 *
 * The controller owned the whole lifecycle: it created the row, mutated
 * `textContent`/`hidden`/`disabled`, hand-ordered the children on every paint
 * (the child list changes when edit mode or the cancel confirmation appears),
 * restored focus after removing the action button, and re-subscribed to the
 * shared goal-ui store per session/goal. React renders the same row, so:
 * - child order comes from JSX instead of a `desired[]` array diff;
 * - edit mode / cancel confirmation are component state;
 * - the goal-ui subscription is an effect keyed by session + goal;
 * - the action lock, dirty guard and error stay in `src/lib/goal-ui.ts`
 *   (unchanged — that module is not a decoration).
 *
 * The strip owns no goal state: actions post to the server and the streamed
 * goal re-renders it.
 */

type GoalControlStripProps = {
  sessionId: string
  goal: GoalState | null
  /** Capability gate; false renders nothing (Side Chat / read-only / shared / ACP). */
  enabled: boolean
  /** Runs the goal action; `runGoalUiAction` locks the row around it. */
  onAction: (action: GoalAction, objective?: string) => Promise<void>
}

const ACTION_ICON = {
  pause: <path d="M9.5 6v12" strokeWidth={2} strokeLinecap="round" />,
  resume: <path d="M8 6.5 17 12l-9 5.5Z" strokeWidth={2} strokeLinejoin="round" />,
  open: <path d="m6 14 6-6 6 6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />,
  edit: <><path d="M21.17 6.83a2.12 2.12 0 0 0-3-3L4 18v3h3z" strokeWidth={2} /><path d="m14 6 4 4" strokeWidth={2} /></>,
  save: <path d="M20 6 9 17l-5-5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />,
  close: <><path d="M18 6 6 18" strokeWidth={2} /><path d="m6 6 12 12" strokeWidth={2} /></>,
} as const

function StripIcon({ path, className }: { path: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" className={className}>
      {path}
    </svg>
  )
}

/** Why the primary action is disabled, used as the button title hint. */
function blockedTitle(view: GoalControlStripView, ui: GoalControlStripUiState): string {
  if (ui.pending) return t('goalActionInProgress')
  if (ui.dirty) return t('goalUnsavedChanges')
  if (view.status === 'pausing') return t('goalStatusPausing')
  return ''
}

function readUi(sessionId: string, goalId: string): GoalControlStripUiState {
  try {
    const state = getGoalUiState(sessionId, goalId)
    return {
      ...state,
      pending: state?.pending === true,
      dirty: state?.dirty === true,
      error: typeof state?.error === 'string' && state.error.length > 0 ? state.error : null,
    }
  } catch {
    return { pending: false, dirty: false, error: null } as GoalControlStripUiState
  }
}

export function GoalControlStrip({ sessionId, goal, enabled, onAction }: GoalControlStripProps) {
  const view = useMemo(() => (goal && enabled ? buildGoalControlStripView(goal) : null), [goal, enabled])
  const goalId = view?.id ?? ''
  const goalKey = `${sessionId}:${goalId}`

  // Subscribe to the shared goal-ui store (pending/dirty/error) for this
  // session+goal. The subscription is the only effect: it reports through
  // `setUi` from the store callback, never synchronously during the effect.
  const [ui, setUi] = useState<GoalControlStripUiState>(
    () => (goalId ? readUi(sessionId, goalId) : { pending: false, dirty: false, error: null }),
  )
  // Track which key the current `ui` belongs to; a changed key re-reads the
  // store during render so the row never paints another goal's lock state.
  const [uiKey, setUiKey] = useState(goalKey)
  if (uiKey !== goalKey) {
    setUiKey(goalKey)
    setUi(goalId ? readUi(sessionId, goalId) : { pending: false, dirty: false, error: null })
  }
  useEffect(() => {
    if (!goalId) return undefined
    return subscribeGoalUi(sessionId, goalId, () => setUi(readUi(sessionId, goalId)))
  }, [sessionId, goalId])

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [cancelConfirmation, setCancelConfirmation] = useState(false)
  const editInputRef = useRef<HTMLInputElement | null>(null)
  const editButtonRef = useRef<HTMLButtonElement | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const openButtonRef = useRef<HTMLButtonElement | null>(null)
  const keepButtonRef = useRef<HTMLButtonElement | null>(null)
  /** Action token: a settled request must not paint over a newer goal. */
  const actionTokenRef = useRef(0)
  // Session/goal the transient modes belong to. A mismatch means the user moved
  // on, so edit/confirm mode drops during render (the controller reset them
  // whenever `renderedGoal` changed). The action token is bumped in an effect:
  // a render must not write refs.
  const [modeKey, setModeKey] = useState(goalKey)
  if (modeKey !== goalKey) {
    setModeKey(goalKey)
    setEditing(false)
    setCancelConfirmation(false)
    setDraft('')
  }
  useEffect(() => {
    // Abandon in-flight settlements from the previous goal/session.
    actionTokenRef.current += 1
  }, [goalKey])

  // Focus the input once edit mode paints (the controller deferred exactly one
  // microtask for the same reason).
  useEffect(() => {
    if (!editing) return
    editInputRef.current?.focus()
    editInputRef.current?.select()
  }, [editing])

  const openSummary = useCallback((detailView: 'progress' | 'edit' = 'progress') => {
    if (!goalId) return
    requestOpenGoalSummary(sessionId, goalId, detailView)
  }, [sessionId, goalId])

  const runAction = useCallback(async (action: 'pause' | 'resume') => {
    if (!goalId) return
    const current = readUi(sessionId, goalId)
    if (current.pending || (current.dirty && action === 'resume')) return
    const token = ++actionTokenRef.current
    try {
      await runGoalUiAction(sessionId, goalId, action, () => onAction(action))
    } catch {
      // The shared wrapper records the failure and republishes it.
    }
    // A settled action for a goal the user has already left must not touch UI.
    if (token !== actionTokenRef.current) return
    setUi(readUi(sessionId, goalId))
  }, [goalId, sessionId, onAction])

  const commitEdit = useCallback(async () => {
    if (!goalId || !goal) return
    const text = draft.trim()
    if (!text || text === goal.objective) {
      setEditing(false)
      editButtonRef.current?.focus()
      return
    }
    const current = readUi(sessionId, goalId)
    if (current.pending) return
    const token = ++actionTokenRef.current
    try {
      await runGoalUiAction(sessionId, goalId, 'revise', () => onAction('revise', text))
    } catch {
      // Stay in edit mode so the user's draft survives a failed revise.
      return
    }
    if (token !== actionTokenRef.current) return
    setEditing(false)
  }, [draft, goal, goalId, onAction, sessionId])

  const exitEditMode = useCallback(() => {
    setEditing(false)
    editButtonRef.current?.focus()
  }, [])

  const confirmCancel = useCallback(async () => {
    if (!goalId || !goal || !goalCanCancel(goal.status) || readUi(sessionId, goalId).pending) return
    const token = ++actionTokenRef.current
    try {
      await runGoalUiAction(sessionId, goalId, 'cancel', () => onAction('cancel'))
    } catch {
      return
    }
    if (token !== actionTokenRef.current) return
    setCancelConfirmation(false)
    openButtonRef.current?.focus()
  }, [goal, goalId, onAction, sessionId])

  const dismissCancelConfirmation = useCallback(() => {
    setCancelConfirmation(false)
    cancelButtonRef.current?.focus()
  }, [])

  // Escape closes the cancel confirmation (the controller bound this on the
  // strip root). Edit-mode Escape is handled on the input itself so it does not
  // fight this handler.
  useEffect(() => {
    if (!cancelConfirmation || editing) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      dismissCancelConfirmation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [cancelConfirmation, dismissCancelConfirmation, editing])

  // Focus moves with the confirmation prompt, matching the controller.
  useEffect(() => {
    if (cancelConfirmation) keepButtonRef.current?.focus()
  }, [cancelConfirmation])

  if (!view) return null

  const statusText = view.roundText ? `${t(view.statusKey)} · ${view.roundText}` : t(view.statusKey)
  const primaryAction = view.primaryAction
  const primaryDisabled = view.status === 'pausing'
    || ui.pending
    || (ui.dirty && primaryAction === 'resume')
  const primaryLabelKey: AppTextKey = primaryAction === 'pause'
    ? 'goalPause'
    : view.budgetExhausted ? 'goalExtendOpen' : 'goalResume'
  const primaryLabel = t(primaryLabelKey)
  const editDisabled = !view.inlineEditable || ui.pending

  return (
    <section
      className="quickforge-goal-strip"
      aria-label={t('goalTitle')}
      data-status={view.status}
      data-tone={view.tone}
      data-pending={String(ui.pending)}
      data-dirty={String(ui.dirty)}
      data-editing={String(editing)}
      data-phase={view.phase}
      data-activation={view.activation}
    >
      <span
        className={view.spinning ? 'quickforge-goal-strip-icon quickforge-goal-strip-icon--spinning' : 'quickforge-goal-strip-icon'}
        aria-hidden="true"
        // The tone glyph table is shared with the goal card (see icons.ts), so
        // the strip cannot drift from the card's status icon.
        dangerouslySetInnerHTML={{ __html: goalStatusIcon[view.tone] }}
      />
      <span className="quickforge-goal-strip-label" aria-live="polite">{statusText}</span>
      {view.objective && !editing ? (
        <span className="quickforge-goal-strip-objective" title={view.objective}>{view.objective}</span>
      ) : null}
      {editing ? (
        <input
          ref={editInputRef}
          type="text"
          className="quickforge-goal-strip-edit-input"
          aria-label={t('goalEditObjective')}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              event.stopPropagation()
              void commitEdit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              exitEditMode()
            }
          }}
        />
      ) : null}
      {ui.error ? (
        <span
          className="quickforge-goal-strip-error"
          role="alert"
          title={ui.error}
          onClick={() => openSummary()}
        >
          {ui.error}
        </span>
      ) : null}
      <span className="quickforge-goal-strip-spacer" aria-hidden="true" />
      {primaryAction !== 'none' && !editing ? (
        <button
          type="button"
          className={`quickforge-goal-strip-action quickforge-goal-strip-action--${primaryAction}`}
          aria-label={primaryLabel}
          title={primaryDisabled ? blockedTitle(view, ui) : primaryLabel}
          disabled={primaryDisabled}
          onClick={() => {
            // An exhausted budget routes resume to the summary, where extending
            // is offered (same as the controller).
            if (primaryAction === 'resume' && goal && goalBudgetExtension(goal).exhausted) {
              openSummary('progress')
              return
            }
            void runAction(primaryAction)
          }}
        >
          <StripIcon path={primaryAction === 'pause' ? ACTION_ICON.pause : ACTION_ICON.resume} />
        </button>
      ) : null}
      {editing ? (
        <>
          <button
            type="button"
            className="quickforge-goal-strip-action quickforge-goal-strip-action--save"
            aria-label={t('goalEditSave')}
            title={t('goalEditSave')}
            onClick={() => void commitEdit()}
          >
            <StripIcon path={ACTION_ICON.save} />
          </button>
          <button
            type="button"
            className="quickforge-goal-strip-action quickforge-goal-strip-action--edit-cancel"
            aria-label={t('goalEditCancel')}
            title={t('goalEditCancel')}
            onClick={exitEditMode}
          >
            <StripIcon path={ACTION_ICON.close} />
          </button>
        </>
      ) : (
        <button
          ref={editButtonRef}
          type="button"
          className="quickforge-goal-strip-action quickforge-goal-strip-action--edit"
          aria-label={t('goalEditObjective')}
          title={t('goalEditObjective')}
          disabled={editDisabled}
          onClick={() => {
            if (!goal?.objective) return
            setDraft(goal.objective)
            setCancelConfirmation(false)
            setEditing(true)
          }}
        >
          <StripIcon path={ACTION_ICON.edit} />
        </button>
      )}
      <button
        ref={cancelButtonRef}
        type="button"
        className="quickforge-goal-strip-action"
        aria-label={t('goalClear')}
        title={t('goalClear')}
        disabled={ui.pending || !goalCanCancel(view.status)}
        onClick={() => {
          setCancelConfirmation(true)
          setEditing(false)
        }}
      >
        ×
      </button>
      {cancelConfirmation ? (
        <>
          <span className="quickforge-goal-strip-cancel-note">{t('goalCancelConfirmMessage')}</span>
          <button
            type="button"
            className="quickforge-goal-strip-action quickforge-goal-strip-confirm"
            aria-label={t('goalCancelConfirmTitle')}
            title={t('goalCancelConfirmMessage')}
            disabled={ui.pending}
            onClick={() => void confirmCancel()}
          >
            {t('goalCancel')}
          </button>
          <button
            ref={keepButtonRef}
            type="button"
            className="quickforge-goal-strip-action quickforge-goal-strip-confirm"
            aria-label={t('goalKeepWorking')}
            disabled={ui.pending}
            onClick={dismissCancelConfirmation}
          >
            {t('goalKeepWorking')}
          </button>
        </>
      ) : null}
      <button
        ref={openButtonRef}
        type="button"
        className="quickforge-goal-strip-action quickforge-goal-strip-action--open"
        aria-label={t('goalHintDetails')}
        title={t('goalHintDetails')}
        onClick={() => openSummary()}
      >
        <StripIcon path={ACTION_ICON.open} />
      </button>
    </section>
  )
}
