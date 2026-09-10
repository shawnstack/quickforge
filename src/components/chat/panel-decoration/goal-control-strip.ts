import { t, type AppTextKey } from '@/lib/i18n'
import {
  goalCanCancel,
  goalBudgetExtension,
  isGoalSpinning,
  isGoalTerminal,
  type GoalAction,
  type GoalState,
  type GoalStatus,
} from '@/lib/goal'
import type { GoalCardTone } from './goal-card'

/**
 * Goal control strip — the compact goal affordance above the composer.
 *
 * It mirrors the authoritative ServerAgent goal but renders only a single
 * compact row: a status icon, a short status label, the server-recorded
 * cumulative duration and at most two icon buttons (pause/resume + open
 * summary). The full card / summary view owns the objective, criteria, scope,
 * budget, evidence and notes.
 *
 * The strip owns no goal state and no request lock: `getGoal()` reads the
 * ServerAgent snapshot, every action runs through the shared goal-ui wrapper
 * (which owns the pending lock, the dirty guard and the error) and the detail
 * view is opened through the shared open-summary request. The strip re-renders
 * whenever the shared goal-ui state changes.
 */

/** Shared lock/dirty/error state as published by `src/lib/goal-ui.ts`. */
export type GoalControlStripUiState = {
  pending: boolean
  dirty: boolean
  error: string | null
}

/**
 * The subset of the shared `src/lib/goal-ui.ts` contract the strip consumes.
 *
 * It is injected (rather than imported) so the shared module stays the single
 * owner of the request lock and so this controller is directly testable with a
 * fake. The shape is structurally identical to the module's named exports, so
 * the host can pass the module (or a namespace object) as-is.
 */
export type GoalControlStripGoalUi = {
  requestOpenGoalSummary: (sessionId: string, goalId: string, view?: 'progress' | 'edit') => void
  getGoalUiState: (sessionId: string, goalId: string) => GoalControlStripUiState
  subscribeGoalUi: (sessionId: string, goalId: string, listener: () => void) => () => void
  runGoalUiAction: (
    sessionId: string,
    goalId: string,
    action: GoalAction,
    execute: () => Promise<unknown>,
  ) => Promise<void>
}

export type GoalControlStripController = {
  update: () => void
  cleanup: () => void
}

export type GoalControlStripDeps = {
  panel: HTMLElement
  getGoal: () => GoalState | null
  getSessionId: () => string
  /** Capability gate; false removes the strip (Side Chat / read-only / shared). */
  enabled?: () => boolean
  /** Runs the goal action; the shared wrapper locks the strip around it. */
  onAction: (action: GoalAction, objective?: string) => Promise<void>
  goalUi: GoalControlStripGoalUi
}

export type GoalControlStripView = {
  id: string
  revision: number
  status: GoalStatus
  statusKey: AppTextKey
  tone: GoalCardTone
  spinning: boolean
  /**
   * The single primary action the strip may offer:
   * - `pause` while running/verifying (and the already-`pausing` state, shown
   *   disabled so it never pretends the goal stopped),
   * - `resume` only for a genuinely paused goal,
   * - `none` for every other state. `blocked`, `needs_review` and the
   *   `awaiting_*` states only open the summary — `goalCanResume` must not be
   *   mapped wholesale onto a resume icon.
   */
  primaryAction: 'pause' | 'resume' | 'none'
  budgetExhausted: boolean
}

const STATUS_KEY: Record<GoalStatus, AppTextKey> = {
  planning: 'goalStatusPlanning',
  awaiting_confirmation: 'goalStatusAwaitingConfirmation',
  running: 'goalStatusRunning',
  verifying: 'goalStatusVerifying',
  awaiting_input: 'goalStatusAwaitingInput',
  awaiting_approval: 'goalStatusAwaitingApproval',
  pausing: 'goalStatusPausing',
  paused: 'goalStatusPaused',
  blocked: 'goalStatusBlocked',
  needs_review: 'goalStatusNeedsReview',
  completed: 'goalStatusCompleted',
  failed: 'goalStatusFailed',
  cancelled: 'goalStatusCancelled',
}

function toneForStatus(status: GoalStatus): GoalCardTone {
  if (status === 'completed') return 'success'
  if (status === 'failed' || status === 'cancelled') return 'danger'
  if (status === 'blocked' || status === 'needs_review') return 'warning'
  if (status === 'awaiting_confirmation' || status === 'planning') return 'info'
  return 'active'
}

function primaryActionForStatus(status: GoalStatus): GoalControlStripView['primaryAction'] {
  if (status === 'running' || status === 'verifying' || status === 'pausing') return 'pause'
  if (status === 'paused') return 'resume'
  return 'none'
}

/**
 * Projects the authoritative goal into the strip row. Returns null for a
 * terminal goal: completed/cancelled/failed goals are not actionable above the
 * composer (a failure is already visible in the chat, and the summary keeps the
 * full record).
 */
export function buildGoalControlStripView(goal: GoalState): GoalControlStripView | null {
  if (isGoalTerminal(goal.status)) return null
  return {
    id: goal.id,
    revision: goal.revision,
    status: goal.status,
    statusKey: STATUS_KEY[goal.status],
    tone: toneForStatus(goal.status),
    spinning: isGoalSpinning(goal.status),
    primaryAction: primaryActionForStatus(goal.status),
    budgetExhausted: goalBudgetExtension(goal).exhausted,
  }
}

const STATUS_ICON: Record<GoalCardTone, string> = {
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>',
  active: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  success: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>',
  danger: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/></svg>',
}

const ACTION_ICON = {
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6v12"/><path d="M14.5 6v12"/></svg>',
  resume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6.5 17 12l-9 5.5Z"/></svg>',
  open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg>',
}

/** Why the primary action is disabled, used as the button title hint. */
function blockedTitle(view: GoalControlStripView, ui: GoalControlStripUiState): string {
  if (ui.pending) return t('goalActionInProgress')
  if (ui.dirty) return t('goalUnsavedChanges')
  if (view.status === 'pausing') return t('goalStatusPausing')
  return ''
}

export function createGoalControlStripController(deps: GoalControlStripDeps): GoalControlStripController {
  const { panel, getGoal, getSessionId, onAction, goalUi } = deps
  const isEnabled = () => deps.enabled?.() !== false

  /**
   * The stable row nodes. `paint` mutates these in place instead of rebuilding
   * the row: replacing every node on each repaint dropped keyboard focus off a
   * focused pause button and remounted the `aria-live` label, which makes a
   * screen reader announce the same status again.
   */
  type StripNodes = {
    icon: HTMLElement
    label: HTMLElement
    error: HTMLElement
    spacer: HTMLElement
    open: HTMLButtonElement
    duration: HTMLElement
    cancel: HTMLButtonElement
    confirm: HTMLButtonElement
    keep: HTMLButtonElement
    cancelNote: HTMLElement
  }

  let root: HTMLElement | null = null
  let nodes: StripNodes | null = null
  let actionButton: HTMLButtonElement | null = null
  // The identity the visible row belongs to. The stable buttons read it at
  // click time so a node from an earlier render can never drive a different
  // session/goal.
  let renderedSession = ''
  let renderedGoal = ''
  let renderedAction: 'pause' | 'resume' | null = null
  let signature = ''
  let subscribedSession = ''
  let subscribedGoal = ''
  let unsubscribe: (() => void) | null = null
  // Monotonic token isolating async action results: a stale response may only
  // repaint the strip while it still belongs to the same session/goal.
  let actionToken = 0
  let cancelConfirmation = false

  const readUi = (sessionId: string, goalId: string): GoalControlStripUiState => {
    try {
      const state = goalUi.getGoalUiState(sessionId, goalId)
      return {
        pending: state?.pending === true,
        dirty: state?.dirty === true,
        error: typeof state?.error === 'string' && state.error.length > 0 ? state.error : null,
      }
    } catch {
      return { pending: false, dirty: false, error: null }
    }
  }

  const clearSubscription = () => {
    unsubscribe?.()
    unsubscribe = null
    subscribedSession = ''
    subscribedGoal = ''
  }

  /**
   * True while keyboard focus sits on (or inside) a node that is about to be
   * removed. Removing a focused node silently drops focus onto `<body>`,
   * stranding keyboard users.
   */
  const focusIsWithin = (container: HTMLElement): boolean => {
    if (typeof document === 'undefined') return false
    let node: Node | null = document.activeElement
    while (node) {
      if (node === container) return true
      node = node.parentElement
    }
    return false
  }

  /** The nearest sensible landing spot when the strip itself disappears. */
  const focusComposerEditor = () => {
    const editor = panel.querySelector<HTMLElement>('message-editor')
    if (!editor) return
    const target = editor.querySelector<HTMLElement>('textarea') ?? editor
    target.focus()
  }

  /** Detaches the row (and its nodes) without touching the subscription. */
  const detachRoot = () => {
    const hadFocus = root !== null && focusIsWithin(root)
    root?.remove()
    root = null
    nodes = null
    actionButton = null
    renderedSession = ''
    renderedGoal = ''
    renderedAction = null
    signature = ''
    // The row is gone (terminal/gated goal, missing composer): never leave
    // keyboard focus on a detached node.
    if (hadFocus) focusComposerEditor()
  }

  const reset = () => {
    clearSubscription()
    detachRoot()
    // Anything still in flight no longer owns this strip.
    actionToken++
  }

  /** Opens the summary of the row currently on screen — never a stale goal. */
  const openSummary = () => {
    if (!renderedGoal) return
    if (getSessionId() !== renderedSession || getGoal()?.id !== renderedGoal) return
    goalUi.requestOpenGoalSummary(renderedSession, renderedGoal, 'edit')
  }

  const runAction = async (action: 'pause' | 'resume', sessionId: string, goalId: string) => {
    const goal = getGoal()
    // A button node from an earlier render may still fire: re-check the identity
    // and the shared lock at click time instead of trusting the rendered state.
    if (!goal || goal.id !== goalId || getSessionId() !== sessionId) return
    const ui = readUi(sessionId, goalId)
    if (ui.pending || (ui.dirty && action === 'resume')) return
    const token = ++actionToken
    try {
      await goalUi.runGoalUiAction(sessionId, goalId, action, () => onAction(action))
    } catch {
      // The shared wrapper records the failure; it reaches the strip through
      // getGoalUiState/subscribeGoalUi instead of being swallowed here.
    }
    if (token !== actionToken) return
    if (getSessionId() !== sessionId || getGoal()?.id !== goalId) return
    renderCurrent()
  }

  const ensureRoot = (composerShell: HTMLElement) => {
    if (!root) {
      root = document.createElement('section')
      root.className = 'quickforge-goal-strip'
      root.setAttribute('aria-label', t('goalTitle'))
    }
    // The strip stays the first in-flow sibling of the composer shell: the
    // TodoWrite summary / queued-message anchors only tolerate each other, so a
    // new sibling must never land between them.
    if (root.parentElement !== composerShell || composerShell.firstElementChild !== root) {
      composerShell.insertBefore(root, composerShell.firstElementChild)
    }
  }

  /**
   * Creates the row skeleton exactly once and mounts it. The nodes (and the
   * `aria-live` label) then survive every repaint so focus and announcements
   * are stable.
   */
  const ensureNodes = (): StripNodes | null => {
    const host = root
    if (!host) return null
    if (nodes) return nodes

    const icon = document.createElement('span')
    icon.className = 'quickforge-goal-strip-icon'
    icon.setAttribute('aria-hidden', 'true')

    const label = document.createElement('span')
    label.className = 'quickforge-goal-strip-label'
    label.setAttribute('aria-live', 'polite')

    const error = document.createElement('span')
    error.className = 'quickforge-goal-strip-error'
    // Short, announced, and clickable through to the summary that keeps the
    // full tool/action detail — never swallowed.
    error.setAttribute('role', 'alert')
    error.addEventListener('click', () => openSummary())

    const spacer = document.createElement('span')
    spacer.className = 'quickforge-goal-strip-spacer'
    spacer.setAttribute('aria-hidden', 'true')

    // Opening the summary is always available — pending and unsaved edits
    // included.
    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'quickforge-goal-strip-action quickforge-goal-strip-action--open'
    open.setAttribute('aria-label', t('goalOpenSummary'))
    open.title = t('goalOpenSummary')
    open.innerHTML = ACTION_ICON.open
    open.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      openSummary()
    })

    const duration = document.createElement('span')
    duration.className = 'quickforge-goal-strip-duration'
    const cancel = document.createElement('button')
    const confirm = document.createElement('button')
    const keep = document.createElement('button')
    for (const button of [cancel, confirm, keep]) { button.type = 'button'; button.className = 'quickforge-goal-strip-action' }
    confirm.className += ' quickforge-goal-strip-confirm'
    keep.className += ' quickforge-goal-strip-confirm'
    const cancelNote = document.createElement('span')
    cancelNote.className = 'quickforge-goal-strip-cancel-note'
    cancelNote.textContent = t('goalCancelConfirmMessage')
    cancel.textContent = '×'
    cancel.setAttribute('aria-label', t('goalCancel'))
    cancel.title = t('goalCancel')
    confirm.textContent = t('goalCancel')
    confirm.setAttribute('aria-label', t('goalCancelConfirmTitle'))
    confirm.title = t('goalCancelConfirmMessage')
    keep.textContent = t('goalKeepWorking')
    keep.setAttribute('aria-label', t('goalKeepWorking'))
    cancel.addEventListener('click', () => { cancelConfirmation = true; signature = ''; renderCurrent(); keep.focus() })
    const dismiss = () => { cancelConfirmation = false; signature = ''; renderCurrent(); cancel.focus() }
    keep.addEventListener('click', dismiss)
    host.addEventListener('keydown', (event) => { if (event.key === 'Escape' && cancelConfirmation) { event.preventDefault(); event.stopPropagation(); dismiss() } })
    confirm.addEventListener('click', () => {
      const sessionId = renderedSession
      const goalId = renderedGoal
      const goal = getGoal()
      if (!goal || goal.id !== goalId || getSessionId() !== sessionId || !goalCanCancel(goal.status) || readUi(sessionId, goalId).pending) return
      void goalUi.runGoalUiAction(sessionId, goalId, 'cancel', () => onAction('cancel')).then(() => {
        if (getSessionId() !== sessionId || getGoal()?.id !== goalId) return
        cancelConfirmation = false; signature = ''; renderCurrent()
        if (nodes) nodes.open.focus()
      })
    })
    nodes = { icon, label, error, spacer, open, duration, cancel, confirm, keep, cancelNote }
    host.append(icon, label, duration, spacer, cancel, open)
    return nodes
  }

  /** The primary action button is kept across pause/resume so focus survives. */
  const ensureActionButton = (): HTMLButtonElement => {
    if (actionButton) return actionButton
    const button = document.createElement('button')
    button.type = 'button'
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      // The node may outlive a repaint: re-check the lock and identity now.
      if (button.disabled || !renderedAction) return
      const goal = getGoal()
      if (renderedAction === 'resume' && goal && goalBudgetExtension(goal).exhausted) {
        openSummary()
        return
      }
      void runAction(renderedAction, renderedSession, renderedGoal)
    })
    actionButton = button
    return button
  }

  const paint = (view: GoalControlStripView, sessionId: string, ui: GoalControlStripUiState) => {
    const strip = ensureNodes()
    const host = root
    if (!host || !strip) return
    const { icon, label, error, spacer, open, duration, cancel, confirm, keep, cancelNote } = strip
    if (renderedSession !== sessionId || renderedGoal !== view.id) cancelConfirmation = false
    // Minutes read better than raw seconds; sub-minute activity keeps seconds.
    const activeDurationMs = getGoal()?.usage.activeDurationMs ?? 0
    duration.textContent = activeDurationMs >= 60_000
      ? t('goalRecordedDurationMinutes', { minutes: Math.floor(activeDurationMs / 60_000) })
      : t('goalRecordedDuration', { seconds: Math.floor(activeDurationMs / 1_000) })
    cancel.disabled = ui.pending || !goalCanCancel(view.status)
    confirm.disabled = ui.pending
    keep.disabled = ui.pending

    renderedSession = sessionId
    renderedGoal = view.id

    host.dataset.status = view.status
    host.dataset.tone = view.tone
    host.dataset.pending = String(ui.pending)
    host.dataset.dirty = String(ui.dirty)

    const iconClass = view.spinning
      ? 'quickforge-goal-strip-icon quickforge-goal-strip-icon--spinning'
      : 'quickforge-goal-strip-icon'
    if (icon.className !== iconClass) icon.className = iconClass
    const statusIcon = STATUS_ICON[view.tone]
    if (icon.innerHTML !== statusIcon) icon.innerHTML = statusIcon

    // Assign only on an actual change: rewriting the same string still makes
    // some screen readers re-announce the live region.
    const statusText = t(view.statusKey)
    if (label.textContent !== statusText) label.textContent = statusText

    if (ui.error) {
      if (error.textContent !== ui.error) {
        error.textContent = ui.error
        error.title = ui.error
      }
    } else if (error.parentElement) {
      error.remove()
    }

    if (view.primaryAction === 'none') {
      if (actionButton) {
        // No primary action is offered any more (blocked / awaiting_*): hand
        // focus to the summary entry that stays instead of dropping it.
        const hadFocus = focusIsWithin(actionButton)
        actionButton.remove()
        actionButton = null
        if (hadFocus) open.focus()
      }
      renderedAction = null
    } else {
      const action = view.primaryAction
      const button = ensureActionButton()
      renderedAction = action
      const buttonClass = `quickforge-goal-strip-action quickforge-goal-strip-action--${action}`
      if (button.className !== buttonClass) button.className = buttonClass
      const labelKey: AppTextKey = action === 'pause' ? 'goalPause' : view.budgetExhausted ? 'goalExtendOpen' : 'goalResume'
      const ariaLabel = t(labelKey)
      if (button.getAttribute('aria-label') !== ariaLabel) button.setAttribute('aria-label', ariaLabel)
      const disabled = view.status === 'pausing' || ui.pending || (ui.dirty && action === 'resume')
      if (button.disabled !== disabled) button.disabled = disabled
      const hint = disabled ? blockedTitle(view, ui) : ariaLabel
      if (button.title !== hint) button.title = hint
      const actionIcon = action === 'pause' ? ACTION_ICON.pause : ACTION_ICON.resume
      if (button.innerHTML !== actionIcon) button.innerHTML = actionIcon
    }

    // Keep the allowed order (icon · label · duration · error? · spacer ·
    // action? · open) by moving only the nodes that moved.
    const desired: HTMLElement[] = [icon, label, duration]
    if (ui.error) desired.push(error)
    desired.push(spacer)
    if (actionButton) desired.push(actionButton)
    desired.push(cancel)
    if (cancelConfirmation) desired.push(cancelNote, confirm, keep)
    else {
      if (focusIsWithin(confirm) || focusIsWithin(keep)) cancel.focus()
      confirm.remove(); keep.remove(); cancelNote.remove()
    }
    desired.push(open)
    for (let index = 0; index < desired.length; index++) {
      const current = host.children[index] ?? null
      if (current !== desired[index]) host.insertBefore(desired[index], current)
    }
  }

  const renderCurrent = () => {
    if (!isEnabled()) {
      reset()
      return
    }
    const goal = getGoal()
    if (!goal) {
      reset()
      return
    }
    const view = buildGoalControlStripView(goal)
    if (!view) {
      reset()
      return
    }
    const editor = panel.querySelector<HTMLElement>('message-editor')
    const composerShell = editor?.parentElement
    if (!composerShell) {
      detachRoot()
      return
    }
    ensureRoot(composerShell)

    const sessionId = getSessionId()
    // Identity-bound subscription: a session/goal switch must never leak the
    // previous goal's lock state into the new row.
    if (!unsubscribe || subscribedSession !== sessionId || subscribedGoal !== goal.id) {
      clearSubscription()
      subscribedSession = sessionId
      subscribedGoal = goal.id
      // The shared goal-ui state changed (summary editing / pending / error) or
      // an action settled: repaint against the current identity.
      unsubscribe = goalUi.subscribeGoalUi(sessionId, goal.id, () => renderCurrent())
    }

    const ui = readUi(sessionId, goal.id)
    const nextSignature = JSON.stringify({
      goal: goal.id,
      duration: goal.usage.activeDurationMs,
      sessionId,
      revision: goal.revision,
      status: goal.status,
      pending: ui.pending,
      dirty: ui.dirty,
      error: ui.error,
    })
    if (nextSignature === signature) return
    signature = nextSignature
    paint(view, sessionId, ui)
  }

  return {
    update() {
      renderCurrent()
    },
    cleanup() {
      reset()
    },
  }
}
