import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { t } from '@/lib/i18n'
import {
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
import { GoalIcon } from '@/components/goal-icon'
import {
  buildGoalControlStripView,
  type GoalControlStripUiState,
  type GoalControlStripView,
} from '../panel-decoration/goal-control-strip'

/**
 * Goal control strip — one single row above the composer.
 *
 * `icon · state word · objective · 2/3 · [primary icon] · ⋯`
 *
 * The row used to be a three-tier card (identity line + two-line objective +
 * progress line, ≈76px). It is now 32px: the objective truncates to one line,
 * the acceptance progress moves onto the same row, and the expandable panel is
 * gone. Everything the panel used to hold is one click away in the inspector, so
 * the composer regains a tier of vertical space.
 *
 * Icon / text / color still have one job each (see goal-strip-icon-review.html):
 * the glyph answers "what is this" and is always the product's goal identity icon
 * (`GoalIcon`, neutral gray), the word answers "what is happening now", and color
 * answers "does it need me" through `view.stateTone`.
 *
 * What the single row does NOT show, and where it went:
 * - the objective's second line → `title` keeps the full text, and the objective
 *   itself is a button into the inspector;
 * - the phase line (round / paused-at / waiting-for-approval) → it became the
 *   read-only meta line in the 「⋯」 menu and part of the tooltips;
 * - the inline acceptance list → `2/3` already answers "how many are left"; the
 *   list itself is in the inspector;
 * - the expand chevron → removed; the label and the objective open the inspector.
 *
 * The primary action is icon-only (the label lives in `aria-label` + `title`), so
 * the row keeps its height and never re-wraps on a long localized verb.
 *
 * The strip owns no goal state: actions post to the server and the streamed goal
 * re-renders it. `src/lib/goal-ui.ts` keeps the pending lock and dirty guard, and
 * `actionTokenRef` keeps a settled request from painting over a newer goal.
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
  // Two bars, not one: a single `M9.5 6v12` at 12px on the filled blue button
  // reads as an I-beam ("edit / caret"), not as pause. Keep both paths — the
  // gap (5 units ≈ 2.5px, minus 1.2px of stroke per side) is what makes the pair
  // legible at this size, so a `rect`-based glyph (lucide `Pause`) or one that
  // adds an outline (`SquarePause`) collapses into a solid block here.
  pause: <><path d="M9.5 6v12" strokeWidth={2.4} strokeLinecap="round" /><path d="M14.5 6v12" strokeWidth={2.4} strokeLinecap="round" /></>,
  resume: <path d="M8 6.5 17 12l-9 5.5Z" strokeWidth={2.4} strokeLinejoin="round" />,
  // 「去处理」must not look like 「打开面板」: the open action is a chevron
  // (`m6 14 6-6 6 6`), so this one carries a trailing bar to read as "jump to the
  // card down there" and cannot be confused with it at 12px.
  attention: <><path d="M12 16V4" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /><path d="m6.5 10 5.5-6 5.5 6" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /><path d="M5 20h14" strokeWidth={2.2} strokeLinecap="round" /></>,
  open: <path d="m6 14 6-6 6 6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />,
  more: <><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
  edit: <><path d="M21.17 6.83a2.12 2.12 0 0 0-3-3L4 18v3h3z" strokeWidth={2} /><path d="m14 6 4 4" strokeWidth={2} /></>,
  save: <path d="M20 6 9 17l-5-5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />,
  close: <><path d="M18 6 6 18" strokeWidth={2} /><path d="m6 6 12 12" strokeWidth={2} /></>,
} as const

/** At most this many acceptance segments before the row drops the bar for a count. */
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [cancelConfirmation, setCancelConfirmation] = useState(false)
  const editInputRef = useRef<HTMLInputElement | null>(null)
  const editButtonRef = useRef<HTMLButtonElement | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const keepButtonRef = useRef<HTMLButtonElement | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  const menuId = useId()
  /** Action token: a settled request must not paint over a newer goal. */
  const actionTokenRef = useRef(0)
  // Session/goal the transient modes belong to. A mismatch means the user moved
  // on, so edit/confirm/menu mode drops during render (the controller reset them
  // whenever `renderedGoal` changed). The action token is bumped in an effect: a
  // render must not write refs.
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
  const progressText = view.criteriaTotal > 0 ? `${view.criteriaPassed}/${view.criteriaTotal}` : ''
  // The round / duration moved off the row; they stay reachable in the menu and
  // in the tooltips so nothing is lost, only demoted. `phaseDetail` already spells
  // the round for most states, so identical parts collapse instead of repeating.
  const roundText = view.roundText ? t('goalPhaseDetailRound', { round: view.roundText }) : ''
  const durationText = view.durationMinutes > 0
    ? t('goalRecordedDurationMinutes', { minutes: view.durationMinutes })
    : ''
  const detailLine = [...new Set([view.phaseDetail, roundText, durationText].filter(Boolean))].join(' · ')

  const runPrimary = () => {
    if (primaryAction === 'attention') {
      revealWaitingCard()
      return
    }
    if (primaryAction === 'none') return
    // Budget extension is CAS-bound to `{goalId, expectedRevision}`, so it is
    // confirmed in the inspector instead of being dispatched from the strip.
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
      data-tone={view.stateTone}
      data-card-tone={view.tone}
      data-pending={String(ui.pending)}
      data-dirty={String(ui.dirty)}
      data-editing={String(editing)}
      data-phase={view.phase}
      data-activation={view.activation}
    >
      {/* Identity glyph: always the product's goal icon (pinned summary,
          inspector tab and tool cards use the same one), always neutral, never
          re-encoding the state. The state word right next to it does that. */}
      <span className="quickforge-goal-strip-icon" aria-hidden="true">
        <GoalIcon />
      </span>
      {/* A rotating arc appears only while a step is actually being worked on;
          the dot beside the word carries the attention color. */}
      {view.spinning ? <span className="quickforge-goal-strip-spinner" aria-hidden="true" /> : null}
      <span className="quickforge-goal-strip-dot" aria-hidden="true" />
      <button
        type="button"
        className="quickforge-goal-strip-label"
        aria-live="polite"
        // The precise machine state stays reachable, but the visible word is one
        // of five (方案 A3). Clicking the word opens the inspector.
        title={`${t(view.statusKey)}${detailLine ? ` · ${detailLine}` : ''}`}
        onClick={() => openSummary('progress')}
      >
        {t(view.statusWordKey)}
      </button>

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
        <button
          type="button"
          className="quickforge-goal-strip-objective"
          // The row shows one line; the tooltip keeps the full objective plus the
          // phase line the strip no longer prints.
          title={detailLine ? `${view.objective ?? ''}\n${detailLine}` : (view.objective ?? '')}
          onClick={() => openSummary('progress')}
        >
          {view.objective}
        </button>
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

      {progressText ? (
        <span
          className="quickforge-goal-strip-progress"
          title={t('goalCriteriaProgress', { completed: view.criteriaPassed, total: view.criteriaTotal })}
        >
          {segments ? (
            <span className="quickforge-goal-strip-segs" aria-hidden="true" data-total={goal.criteria.length}>
              {goal.criteria.map((criterion) => (
                <i key={criterion.id} className="quickforge-goal-strip-seg" data-status={criterion.status} />
              ))}
            </span>
          ) : null}
          <span className="quickforge-goal-strip-progress-count">{progressText}</span>
          {view.budgetExhausted ? <span className="quickforge-goal-strip-chip">{t('goalBudgetExhausted')}</span> : null}
        </span>
      ) : null}

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

      {menuOpen ? (
        <div className="quickforge-goal-strip-menu" role="menu" id={menuId} aria-label={t('goalMoreActions')}>
          {/* The phase line the single row no longer prints: read-only, never a
              control, so the round and the recorded duration stay discoverable. */}
          {detailLine ? (
            <p className="quickforge-goal-strip-menu-meta">{detailLine}</p>
          ) : null}
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
