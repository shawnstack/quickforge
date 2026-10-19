import { t, type AppTextKey } from '@/lib/i18n'
import {
  goalCanCancel,
  goalBudgetExtension,
  goalV2CanPause,
  goalV2CanResume,
  isGoalSpinning,
  isGoalTerminal,
  isGoalV2,
  type GoalAction,
  type GoalActivation,
  type GoalPhase,
  type GoalRuntime,
  type GoalState,
  type GoalStatus,
} from '@/lib/goal'
import type { GoalCardTone } from './goal-card'
import { goalStatusIcon } from './icons'

/**
 * Goal control strip — the DSH-style single-row goal affordance above the
 * composer.
 *
 * One row shows the goal glyph, the phase label, the truncated objective and
 * at most a few icon buttons (pause/resume · edit · clear · open). Clicking
 * edit swaps the objective text for an inline input with save/cancel actions,
 * mirroring the queued-message editor interaction.
 *
 * The strip owns no goal state and no request lock: `getGoal()` reads the
 * ServerAgent snapshot, every action runs through the shared goal-ui wrapper
 * (which owns the pending lock, the dirty guard and the error) and the detail
 * view is opened through the shared open-summary request.
 */

/** Shared lock/dirty/error state as published by `src/lib/goal-ui.ts`. */
export type GoalControlStripUiState = {
  pending: boolean
  dirty: boolean
  error: string | null
}

/**
 * The subset of the shared `src/lib/goal-ui.ts` contract the strip consumes.
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
  /** Goal v2 phase/activation/runtime, when the server uses the v2 engine. */
  phase?: GoalPhase
  activation?: GoalActivation
  runtime?: GoalRuntime
  roundText?: string
  objective?: string
  /** The single primary action the strip may offer. */
  primaryAction: 'pause' | 'resume' | 'none'
  budgetExhausted: boolean
  /** True when the goal is editable without pausing first (v2). */
  inlineEditable: boolean
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

const V2_STATUS_KEY: Record<GoalPhase, AppTextKey> = {
  active: 'goalPhaseActive',
  paused: 'goalPhasePaused',
  blocked: 'goalPhaseBlocked',
  complete: 'goalPhaseComplete',
}

function v2StatusKey(goal: GoalState): AppTextKey {
  if (goal.phase === 'active' && goal.activation === 'disarmed') return 'goalPhaseInterrupted'
  if (goal.phase === 'active') {
    if (goal.runtime === 'planning') return 'goalPhasePlanning'
    if (goal.runtime === 'verifying') return 'goalPhaseVerifying'
    if (goal.runtime === 'waiting_approval') return 'goalPhaseWaitingApproval'
    if (goal.runtime === 'waiting_input') return 'goalPhaseWaitingInput'
    if (goal.runtime === 'pausing') return 'goalPhasePausing'
  }
  return V2_STATUS_KEY[goal.phase ?? 'active']
}

function v2Tone(goal: GoalState): GoalCardTone {
  if (goal.phase === 'complete') return 'success'
  if (goal.phase === 'blocked') return 'warning'
  if (goal.phase === 'paused') return 'info'
  if (goal.phase === 'active' && goal.activation === 'disarmed') return 'warning'
  return 'active'
}

function v2PrimaryAction(goal: GoalState): GoalControlStripView['primaryAction'] {
  if (goal.phase === 'active' && goal.activation !== 'disarmed') return goalV2CanPause(goal) ? 'pause' : 'none'
  if (goalV2CanResume(goal)) return 'resume'
  return 'none'
}

function buildGoalControlStripViewV2(goal: GoalState): GoalControlStripView | null {
  if (goal.phase === 'complete') return null
  const maxRounds = goal.maxRounds ?? goal.budget.maxIterations
  const roundsStarted = goal.roundsStarted ?? goal.usage.iterations
  return {
    id: goal.id,
    revision: goal.revision,
    status: goal.status,
    statusKey: v2StatusKey(goal),
    tone: v2Tone(goal),
    spinning: goal.runtime === 'executing' || goal.runtime === 'verifying' || goal.runtime === 'waiting_approval' || goal.runtime === 'waiting_input' || goal.runtime === 'pausing',
    phase: goal.phase,
    activation: goal.activation,
    runtime: goal.runtime,
    roundText: maxRounds > 0 ? `${roundsStarted}/${maxRounds}` : undefined,
    objective: goal.objective,
    primaryAction: v2PrimaryAction(goal),
    budgetExhausted: goalBudgetExtension(goal).exhausted,
    // DSH parity: v2 edit works in any non-complete phase without pausing.
    // (complete goals never reach here — buildGoalControlStripViewV2 returns
    // null for them above.)
    inlineEditable: true,
  }
}

function primaryActionForStatus(status: GoalStatus): GoalControlStripView['primaryAction'] {
  if (status === 'running' || status === 'verifying' || status === 'pausing') return 'pause'
  if (status === 'paused') return 'resume'
  return 'none'
}

/**
 * Projects the authoritative goal into the strip row. Returns null for a
 * terminal goal.
 */
export function buildGoalControlStripView(goal: GoalState): GoalControlStripView | null {
  if (isGoalV2(goal)) return buildGoalControlStripViewV2(goal)
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
    // Legacy goals must pause before the server accepts a revise.
    inlineEditable: false,
  }
}

const ACTION_ICON = {
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6v12"/><path d="M14.5 6v12"/></svg>',
  resume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6.5 17 12l-9 5.5Z"/></svg>',
  open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.17 6.83a2.12 2.12 0 0 0-3-3L4 18v3h3z"/><path d="m14 6 4 4"/></svg>',
  save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
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

  type StripNodes = {
    icon: HTMLElement
    label: HTMLElement
    objective: HTMLElement
    editInput: HTMLInputElement
    error: HTMLElement
    spacer: HTMLElement
    open: HTMLButtonElement
    edit: HTMLButtonElement
    editSave: HTMLButtonElement
    editCancel: HTMLButtonElement
    cancel: HTMLButtonElement
    confirm: HTMLButtonElement
    keep: HTMLButtonElement
    cancelNote: HTMLElement
  }

  let root: HTMLElement | null = null
  let nodes: StripNodes | null = null
  let actionButton: HTMLButtonElement | null = null
  let renderedSession = ''
  let renderedGoal = ''
  let renderedAction: 'pause' | 'resume' | null = null
  let signature = ''
  let subscribedSession = ''
  let subscribedGoal = ''
  let unsubscribe: (() => void) | null = null
  let actionToken = 0
  let cancelConfirmation = false
  let editing = false

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

  const focusIsWithin = (container: HTMLElement): boolean => {
    if (typeof document === 'undefined') return false
    let node: Node | null = document.activeElement
    while (node) {
      if (node === container) return true
      node = node.parentElement
    }
    return false
  }

  const focusComposerEditor = () => {
    const editor = panel.querySelector<HTMLElement>('.qf-message-editor')
    if (!editor) return
    const target = editor.querySelector<HTMLElement>('textarea') ?? editor
    target.focus()
  }

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
    editing = false
    cancelConfirmation = false
    if (hadFocus) focusComposerEditor()
  }

  const reset = () => {
    clearSubscription()
    detachRoot()
    actionToken++
  }

  const openSummary = (view: 'progress' | 'edit' = 'progress') => {
    if (!renderedGoal) return
    if (getSessionId() !== renderedSession || getGoal()?.id !== renderedGoal) return
    goalUi.requestOpenGoalSummary(renderedSession, renderedGoal, view)
  }

  const runAction = async (action: 'pause' | 'resume', sessionId: string, goalId: string) => {
    const goal = getGoal()
    if (!goal || goal.id !== goalId || getSessionId() !== sessionId) return
    const ui = readUi(sessionId, goalId)
    if (ui.pending || (ui.dirty && action === 'resume')) return
    const token = ++actionToken
    try {
      await goalUi.runGoalUiAction(sessionId, goalId, action, () => onAction(action))
    } catch {
      // The shared wrapper records the failure.
    }
    if (token !== actionToken) return
    if (getSessionId() !== sessionId || getGoal()?.id !== goalId) return
    signature = ''
    renderCurrent()
  }

  const ensureRoot = (composerShell: HTMLElement, editor: HTMLElement) => {
    if (!root) {
      root = document.createElement('section')
      root.className = 'quickforge-goal-strip'
      root.setAttribute('aria-label', t('goalTitle'))
    }
    const suggestionMenu = Array.from(composerShell.children).find((element) => (
      element.classList.contains('quickforge-command-suggestions')
      || element.classList.contains('quickforge-file-reference-suggestions')
    ))
    const insertionTarget = suggestionMenu ?? editor
    if (root.parentElement !== composerShell || root.nextElementSibling !== insertionTarget) {
      composerShell.insertBefore(root, insertionTarget)
    }
  }

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

    const objective = document.createElement('span')
    objective.className = 'quickforge-goal-strip-objective'
    objective.title = ''

    const editInput = document.createElement('input')
    editInput.type = 'text'
    editInput.className = 'quickforge-goal-strip-edit-input'
    editInput.setAttribute('aria-label', t('goalEditObjective'))
    editInput.hidden = true

    const error = document.createElement('span')
    error.className = 'quickforge-goal-strip-error'
    error.setAttribute('role', 'alert')
    error.addEventListener('click', () => openSummary())

    const spacer = document.createElement('span')
    spacer.className = 'quickforge-goal-strip-spacer'
    spacer.setAttribute('aria-hidden', 'true')

    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'quickforge-goal-strip-action quickforge-goal-strip-action--open'
    open.setAttribute('aria-label', t('goalHintDetails'))
    open.title = t('goalHintDetails')
    open.innerHTML = ACTION_ICON.open
    open.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      openSummary()
    })

    const edit = document.createElement('button')
    edit.type = 'button'
    edit.className = 'quickforge-goal-strip-action quickforge-goal-strip-action--edit'
    edit.setAttribute('aria-label', t('goalEditObjective'))
    edit.title = t('goalEditObjective')
    edit.innerHTML = ACTION_ICON.edit
    edit.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const goal = getGoal()
      if (!goal || !goal.objective) return
      editing = true
      cancelConfirmation = false
      signature = ''
      renderCurrent()
    })

    const editSave = document.createElement('button')
    editSave.type = 'button'
    editSave.className = 'quickforge-goal-strip-action quickforge-goal-strip-action--save'
    editSave.setAttribute('aria-label', t('goalEditSave'))
    editSave.title = t('goalEditSave')
    editSave.innerHTML = ACTION_ICON.save
    editSave.hidden = true

    const editCancel = document.createElement('button')
    editCancel.type = 'button'
    editCancel.className = 'quickforge-goal-strip-action quickforge-goal-strip-action--edit-cancel'
    editCancel.setAttribute('aria-label', t('goalEditCancel'))
    editCancel.title = t('goalEditCancel')
    editCancel.innerHTML = ACTION_ICON.close
    editCancel.hidden = true

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
    cancel.setAttribute('aria-label', t('goalClear'))
    cancel.title = t('goalClear')
    confirm.textContent = t('goalCancel')
    confirm.setAttribute('aria-label', t('goalCancelConfirmTitle'))
    confirm.title = t('goalCancelConfirmMessage')
    keep.textContent = t('goalKeepWorking')
    keep.setAttribute('aria-label', t('goalKeepWorking'))
    cancel.addEventListener('click', () => { cancelConfirmation = true; signature = ''; renderCurrent(); keep.focus() })
    const dismiss = () => { cancelConfirmation = false; signature = ''; renderCurrent(); cancel.focus() }
    keep.addEventListener('click', dismiss)
    host.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && cancelConfirmation && !editing) {
        event.preventDefault()
        event.stopPropagation()
        dismiss()
      }
    })
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

    // Edit mode: Enter saves, Escape cancels (same contract as the queued
    // message editor).
    editInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault()
        event.stopPropagation()
        commitEdit()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        exitEditMode()
      }
    })
    editSave.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      commitEdit()
    })
    editCancel.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      exitEditMode()
    })

    const commitEdit = () => {
      const sessionId = renderedSession
      const goalId = renderedGoal
      const goal = getGoal()
      const text = nodes?.editInput.value.trim() ?? ''
      if (!goal || goal.id !== goalId || getSessionId() !== sessionId) return
      if (!text || text === goal.objective) {
        exitEditMode()
        return
      }
      const ui = readUi(sessionId, goalId)
      if (ui.pending) return
      const token = ++actionToken
      void goalUi.runGoalUiAction(sessionId, goalId, 'revise', () => onAction('revise', text)).then(() => {
        if (token !== actionToken) return
        if (getSessionId() !== sessionId || getGoal()?.id !== goalId) return
        editing = false
        signature = ''
        renderCurrent()
      }).catch(() => {
        // The shared wrapper records the failure; stay in edit mode so the
        // user's draft survives.
      })
    }

    const exitEditMode = () => {
      editing = false
      signature = ''
      renderCurrent()
      if (nodes) nodes.edit.focus()
    }

    nodes = { icon, label, objective, editInput, error, spacer, open, edit, editSave, editCancel, cancel, confirm, keep, cancelNote }
    host.append(icon, label, objective, editInput, spacer, edit, cancel, open)
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
      if (button.disabled || !renderedAction) return
      const goal = getGoal()
      if (renderedAction === 'resume' && goal && goalBudgetExtension(goal).exhausted) {
        openSummary('progress')
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
    const { icon, label, objective, editInput, error, spacer, open, edit, editSave, editCancel, cancel, confirm, keep, cancelNote } = strip
    if (renderedSession !== sessionId || renderedGoal !== view.id) {
      cancelConfirmation = false
      editing = false
    }

    // Capture the live edit input so a repaint (streaming delta / SSE) carries
    // the value, focus and caret across instead of resetting the draft.
    const liveEdit = editInput.hidden === false && document.activeElement === editInput
      ? {
          value: editInput.value,
          selectionStart: editInput.selectionStart,
          selectionEnd: editInput.selectionEnd,
        }
      : null

    cancel.disabled = ui.pending || !goalCanCancel(view.status)
    confirm.disabled = ui.pending
    keep.disabled = ui.pending

    renderedSession = sessionId
    renderedGoal = view.id

    host.dataset.status = view.status
    host.dataset.tone = view.tone
    host.dataset.pending = String(ui.pending)
    host.dataset.dirty = String(ui.dirty)
    host.dataset.editing = String(editing)
    if (view.phase) host.dataset.phase = view.phase
    else delete host.dataset.phase
    if (view.activation) host.dataset.activation = view.activation
    else delete host.dataset.activation

    const iconClass = view.spinning
      ? 'quickforge-goal-strip-icon quickforge-goal-strip-icon--spinning'
      : 'quickforge-goal-strip-icon'
    if (icon.className !== iconClass) icon.className = iconClass
    const statusIcon = goalStatusIcon[view.tone]
    if (icon.innerHTML !== statusIcon) icon.innerHTML = statusIcon

    const statusText = view.roundText ? `${t(view.statusKey)} · ${view.roundText}` : t(view.statusKey)
    if (label.textContent !== statusText) label.textContent = statusText

    // Inline objective (single row).
    if (view.objective && !editing) {
      objective.hidden = false
      if (objective.textContent !== view.objective) objective.textContent = view.objective
      objective.title = view.objective
    } else {
      objective.hidden = true
    }

    // Edit mode swaps the objective for the input + save/cancel pair.
    if (editing && view.objective !== undefined) {
      editInput.hidden = false
      if (liveEdit) {
        editInput.value = liveEdit.value
      } else if (editInput.value !== view.objective) {
        editInput.value = view.objective
      }
      editSave.hidden = false
      editCancel.hidden = false
      edit.hidden = true
      if (!liveEdit) {
        // Defer focus to the next microtask so the input is fully painted.
        Promise.resolve().then(() => editInput.focus())
      } else {
        if (liveEdit.selectionStart !== null) editInput.setSelectionRange(liveEdit.selectionStart, liveEdit.selectionEnd)
      }
    } else {
      editInput.hidden = true
      editSave.hidden = true
      editCancel.hidden = true
      edit.hidden = !view.inlineEditable || ui.pending
      edit.disabled = !view.inlineEditable || ui.pending
    }

    if (ui.error) {
      if (error.textContent !== ui.error) {
        error.textContent = ui.error
        error.title = ui.error
      }
    } else if (error.parentElement) {
      error.remove()
    }

    if (view.primaryAction === 'none' || editing) {
      if (actionButton) {
        const hadFocus = focusIsWithin(actionButton)
        actionButton.remove()
        actionButton = null
        if (hadFocus) edit.focus()
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

    // Single-row layout: icon · label · objective/input · error · spacer ·
    // action · edit(+save/cancel) · clear · open.
    const desired: HTMLElement[] = [icon, label, objective, editInput]
    if (ui.error) desired.push(error)
    desired.push(spacer)
    if (actionButton) desired.push(actionButton)
    if (editing) desired.push(editSave, editCancel)
    else desired.push(edit)
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
    const editor = panel.querySelector<HTMLElement>('.qf-message-editor')
    const composerShell = editor?.parentElement
    if (!composerShell) {
      detachRoot()
      return
    }
    ensureRoot(composerShell, editor)

    const sessionId = getSessionId()
    if (!unsubscribe || subscribedSession !== sessionId || subscribedGoal !== goal.id) {
      clearSubscription()
      subscribedSession = sessionId
      subscribedGoal = goal.id
      unsubscribe = goalUi.subscribeGoalUi(sessionId, goal.id, () => renderCurrent())
    }

    const ui = readUi(sessionId, goal.id)
    const nextSignature = JSON.stringify({
      goal: goal.id,
      sessionId,
      revision: goal.revision,
      status: goal.status,
      objective: goal.objective,
      pending: ui.pending,
      dirty: ui.dirty,
      error: ui.error,
      editing,
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
