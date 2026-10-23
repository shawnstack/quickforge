import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { t, type AppTextKey } from '@/lib/i18n'
import {
  goalCanCancel,
  type GoalAction,
  type GoalCriterionStatus,
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
 * Goal control strip — the goal affordance above the composer (方案 A · 目标卡).
 *
 * The row is no longer one flat line of four equal-weight icons. It is a small
 * card with three tiers (see `panel-decoration/goal-control-strip.ts`):
 *
 * - identity: tone glyph + one of five state words + the secondary phase line,
 *   the single solid primary action, a 「⋯」 menu and the expand chevron;
 * - objective: two clamped lines (replaced by the inline editor while editing);
 * - progress: acceptance segments + `3/5` + round + recorded minutes.
 *
 * Expanding shows the acceptance list in place, so "which criteria are left"
 * never costs a jump into the inspector. Secondary and destructive actions
 * (edit / clear / open panel) live in one menu instead of sitting next to the
 * primary action, and "clear" confirms in an anchored popover rather than
 * reflowing the row into two lines.
 *
 * The strip owns no goal state: actions post to the server and the streamed
 * goal re-renders it. `src/lib/goal-ui.ts` keeps the pending lock and dirty
 * guard, and `actionTokenRef` keeps a settled request from painting over a
 * newer goal.
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
  attention: <><path d="M12 19V5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /><path d="m5 12 7-7 7 7" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></>,
  open: <path d="m6 14 6-6 6 6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />,
  more: <><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
  chevron: <path d="m6 9 6 6 6-6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />,
  edit: <><path d="M21.17 6.83a2.12 2.12 0 0 0-3-3L4 18v3h3z" strokeWidth={2} /><path d="m14 6 4 4" strokeWidth={2} /></>,
  save: <path d="M20 6 9 17l-5-5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />,
  close: <><path d="M18 6 6 18" strokeWidth={2} /><path d="m6 6 12 12" strokeWidth={2} /></>,
} as const

/** At most this many acceptance segments before the strip switches to a count. */
const MAX_CRITERIA_SEGMENTS = 8

function StripIcon({ path, className }: { path: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" className={className}>
      {path}
    </svg>
  )
}

/**
 * The five user-facing state words carry the tone; every other distinction is
 * secondary. Used for `data-state` so CSS never has to know 13 statuses.
 */
function stateKeyFor(view: GoalControlStripView): 'running' | 'needs_you' | 'paused' | 'blocked' | 'done' {
  switch (view.statusWordKey) {
    case 'goalStateNeedsYou': return 'needs_you'
    case 'goalStatePaused': return 'paused'
    case 'goalStateBlocked': return 'blocked'
    case 'goalStateDone': return 'done'
    default: return 'running'
  }
}

/** Why the primary action is disabled, used as the button title hint. */
function blockedTitle(view: GoalControlStripView, ui: GoalControlStripUiState): string {
  if (ui.pending) return t('goalActionInProgress')
  if (ui.dirty && view.primaryAction === 'resume') return t('goalUnsavedChanges')
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

/**
 * 「去处理」does not open a second surface: it reveals the approval/question card
 * that is already waiting in the chat, so the user never has to carry context
 * between the strip and a panel.
 */
function revealWaitingCard(): void {
  if (typeof document === 'undefined') return
  const container = document.querySelector('.qf-scroll-container')
  if (!container) return
  const cards = container.querySelectorAll<HTMLElement>('.quickforge-approval-card, .quickforge-ask-card')
  const card = cards[cards.length - 1]
  if (!card) return
  card.scrollIntoView({ block: 'center', behavior: 'smooth' })
  card.dataset.goalAttention = 'true'
  window.setTimeout(() => { delete card.dataset.goalAttention }, 1400)
}

const CRITERION_STATUS_KEY: Record<GoalCriterionStatus, AppTextKey> = {
  pending: 'goalCriterionPending',
  passed: 'goalCriterionPassed',
  failed: 'goalCriterionFailed',
  needs_review: 'goalCriterionNeedsReview',
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
  const [expanded, setExpanded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [cancelConfirmation, setCancelConfirmation] = useState(false)
  const editInputRef = useRef<HTMLInputElement | null>(null)
  const editButtonRef = useRef<HTMLButtonElement | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const chevronRef = useRef<HTMLButtonElement | null>(null)
  const keepButtonRef = useRef<HTMLButtonElement | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  const panelId = useId()
  const menuId = useId()
  /** Action token: a settled request must not paint over a newer goal. */
  const actionTokenRef = useRef(0)
  // Session/goal the transient modes belong to. A mismatch means the user moved
  // on, so edit/confirm/expanded/menu mode drops during render (the controller
  // reset them whenever `renderedGoal` changed). The action token is bumped in
  // an effect: a render must not write refs.
  const [modeKey, setModeKey] = useState(goalKey)
  if (modeKey !== goalKey) {
    setModeKey(goalKey)
    setEditing(false)
    setCancelConfirmation(false)
    setMenuOpen(false)
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
    menuButtonRef.current?.focus()
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

  // The 「⋯」 menu is a popover: outside pointerdown or Escape closes it, and the
  // trigger owns `aria-expanded`. Nothing here reflows the row.
  useEffect(() => {
    if (!menuOpen) return undefined
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (rootRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setMenuOpen(false)
      menuButtonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [menuOpen])

  if (!view || !goal) return null

  const stateKey = stateKeyFor(view)
  const primaryAction = view.primaryAction
  const primaryDisabled = view.status === 'pausing'
    || ui.pending
    || (ui.dirty && primaryAction === 'resume')
  const primaryLabel = t(view.primaryLabelKey)
  const editDisabled = !view.inlineEditable || ui.pending
  const cancellable = goalCanCancel(view.status)
  const segments = goal.criteria.length > 0 && goal.criteria.length <= MAX_CRITERIA_SEGMENTS
  const criteriaText = view.criteriaTotal > 0
    ? t('goalCriteriaProgress', { completed: view.criteriaPassed, total: view.criteriaTotal })
    : ''

  const runPrimary = () => {
    if (primaryAction === 'attention') {
      revealWaitingCard()
      return
    }
    if (primaryAction === 'none') return
    // Budget extension is CAS-bound to `{goalId, expectedRevision}`, so it is
    // confirmed in the inspector instead of being dispatched from the strip —
    // the label says so, which is what keeps the action predictable.
    if (view.primaryOpensInspector) {
      openSummary('progress')
      return
    }
    void runAction(primaryAction)
  }

  return (
    <section
      className="quickforge-goal-strip"
      aria-label={t('goalTitle')}
      ref={rootRef}
      data-status={view.status}
      data-state={stateKey}
      data-tone={view.tone}
      data-pending={String(ui.pending)}
      data-dirty={String(ui.dirty)}
      data-editing={String(editing)}
      data-expanded={String(expanded)}
      data-phase={view.phase}
      data-activation={view.activation}
    >
      <div className="quickforge-goal-strip-head">
        <span
          className={view.spinning ? 'quickforge-goal-strip-icon quickforge-goal-strip-icon--spinning' : 'quickforge-goal-strip-icon'}
          aria-hidden="true"
          // The tone glyph table is shared with the goal card (see icons.ts), so
          // the strip cannot drift from the card's status icon.
          dangerouslySetInnerHTML={{ __html: goalStatusIcon[view.tone] }}
        />
        <span className="quickforge-goal-strip-dot" aria-hidden="true" />
        <span
          className="quickforge-goal-strip-label"
          aria-live="polite"
          // The precise machine state stays reachable, but the visible word is
          // one of five (方案 A3).
          title={t(view.statusKey)}
        >
          {t(view.statusWordKey)}
        </span>
        {view.phaseDetail ? <span className="quickforge-goal-strip-phase">{view.phaseDetail}</span> : null}
        <span className="quickforge-goal-strip-spacer" aria-hidden="true" />
        {primaryAction !== 'none' && !editing ? (
          <button
            type="button"
            className={`quickforge-goal-strip-primary quickforge-goal-strip-action--${primaryAction}`}
            aria-label={primaryLabel}
            title={primaryDisabled ? blockedTitle(view, ui) : primaryLabel}
            disabled={primaryDisabled}
            onClick={runPrimary}
          >
            <StripIcon path={ACTION_ICON[primaryAction]} />
            <span>{primaryLabel}</span>
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
            ref={menuButtonRef}
            type="button"
            className="quickforge-goal-strip-action quickforge-goal-strip-action--more"
            aria-label={t('goalMoreActions')}
            title={t('goalMoreActions')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            disabled={ui.pending}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <StripIcon path={ACTION_ICON.more} />
          </button>
        )}
        <button
          ref={chevronRef}
          type="button"
          className="quickforge-goal-strip-action quickforge-goal-strip-action--expand"
          aria-label={t(expanded ? 'goalCollapseDetails' : 'goalExpandDetails')}
          title={t(expanded ? 'goalCollapseDetails' : 'goalExpandDetails')}
          aria-expanded={expanded}
          aria-controls={expanded ? panelId : undefined}
          data-open={String(expanded)}
          onClick={() => {
            setExpanded((open) => !open)
            setMenuOpen(false)
          }}
        >
          <StripIcon path={ACTION_ICON.chevron} className="quickforge-goal-strip-chevron" />
        </button>
      </div>

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
      ) : (
        <div className="quickforge-goal-strip-objective" title={view.objective}>{view.objective}</div>
      )}

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

      <div className="quickforge-goal-strip-meta">
        {segments ? (
          <span
            className="quickforge-goal-strip-segs"
            aria-hidden="true"
            data-total={goal.criteria.length}
          >
            {goal.criteria.map((criterion) => (
              <i key={criterion.id} className="quickforge-goal-strip-seg" data-status={criterion.status} />
            ))}
          </span>
        ) : null}
        {criteriaText ? <span className="quickforge-goal-strip-criteria-text">{criteriaText}</span> : null}
        {view.roundText ? (
          <>
            <span className="quickforge-goal-strip-sep" aria-hidden="true">·</span>
            <span>{t('goalPhaseDetailRound', { round: view.roundText })}</span>
          </>
        ) : null}
        {view.durationMinutes > 0 ? (
          <>
            <span className="quickforge-goal-strip-sep" aria-hidden="true">·</span>
            <span>{t('goalRecordedDurationMinutes', { minutes: view.durationMinutes })}</span>
          </>
        ) : null}
        {view.budgetExhausted ? (
          <span className="quickforge-goal-strip-chip">{t('goalBudgetExhausted')}</span>
        ) : null}
      </div>

      {expanded ? (
        <div className="quickforge-goal-strip-panel" id={panelId}>
          {goal.criteria.length > 0 ? (
            <ul className="quickforge-goal-strip-criteria">
              {goal.criteria.map((criterion) => (
                <li
                  key={criterion.id}
                  className="quickforge-goal-strip-criterion"
                  data-status={criterion.status}
                >
                  <span className="quickforge-goal-strip-criterion-dot" aria-hidden="true" />
                  <span className="quickforge-goal-strip-criterion-text">
                    {criterion.description}
                    {criterion.required ? null : <em>{t('goalOptionalCriterion')}</em>}
                  </span>
                  <span className="quickforge-goal-strip-criterion-status">
                    {t(CRITERION_STATUS_KEY[criterion.status])}
                    {criterion.evidenceIds.length > 0 ? (
                      <span className="quickforge-goal-strip-criterion-evidence">
                        {t('goalEvidenceCount', { count: criterion.evidenceIds.length })}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="quickforge-goal-strip-empty">{t('goalCriteriaLabel')} · {t('goalObjectiveEmpty')}</p>
          )}
          <div className="quickforge-goal-strip-budget">
            <span>{t('goalBudgetLabel')}</span>
            <span className="quickforge-goal-strip-budget-bar" aria-hidden="true">
              <b style={{ width: `${goal.budget.maxIterations > 0 ? Math.min(100, Math.round((goal.usage.iterations / goal.budget.maxIterations) * 100)) : 0}%` }} />
            </span>
            <span className="quickforge-goal-strip-budget-value">
              {goal.usage.iterations}<em>/{goal.budget.maxIterations}</em>
            </span>
            {view.durationMinutes > 0 ? (
              <span className="quickforge-goal-strip-budget-value">
                {view.durationMinutes}<em>{t('goalBudgetMinutesShort')}</em>
              </span>
            ) : null}
            <span className="quickforge-goal-strip-spacer" aria-hidden="true" />
            <button
              type="button"
              className="quickforge-goal-strip-link"
              onClick={() => openSummary('progress')}
            >
              {t('goalOpenInspector')}
            </button>
          </div>
        </div>
      ) : null}

      {menuOpen ? (
        <div className="quickforge-goal-strip-menu" role="menu" id={menuId} aria-label={t('goalMoreActions')}>
          <button
            ref={editButtonRef}
            type="button"
            role="menuitem"
            className="quickforge-goal-strip-menu-item quickforge-goal-strip-action--edit"
            aria-label={t('goalEditObjective')}
            disabled={editDisabled}
            title={editDisabled ? t('goalReadOnly') : t('goalEditObjective')}
            onClick={() => {
              if (!goal.objective) return
              setDraft(goal.objective)
              setCancelConfirmation(false)
              setMenuOpen(false)
              setEditing(true)
            }}
          >
            <StripIcon path={ACTION_ICON.edit} />
            <span>{t('goalEditObjective')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="quickforge-goal-strip-menu-item quickforge-goal-strip-action--open"
            aria-label={t('goalOpenInspector')}
            onClick={() => {
              setMenuOpen(false)
              openSummary('progress')
            }}
          >
            <StripIcon path={ACTION_ICON.open} />
            <span>{t('goalOpenInspector')}</span>
          </button>
          <button
            ref={cancelButtonRef}
            type="button"
            role="menuitem"
            className="quickforge-goal-strip-menu-item quickforge-goal-strip-menu-item--danger"
            aria-label={t('goalClear')}
            disabled={ui.pending || !cancellable}
            onClick={() => {
              setMenuOpen(false)
              setCancelConfirmation(true)
              setEditing(false)
            }}
          >
            <StripIcon path={ACTION_ICON.close} />
            <span>{t('goalClear')}</span>
          </button>
        </div>
      ) : null}

      {cancelConfirmation ? (
        <div className="quickforge-goal-strip-confirm-pop" role="group" aria-label={t('goalCancelConfirmTitle')}>
          <p className="quickforge-goal-strip-cancel-note">{t('goalCancelConfirmMessage')}</p>
          <div className="quickforge-goal-strip-confirm-actions">
            <button
              type="button"
              className="quickforge-goal-strip-action quickforge-goal-strip-confirm quickforge-goal-strip-confirm--danger"
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
          </div>
        </div>
      ) : null}
    </section>
  )
}
