import { t, type AppTextKey } from '@/lib/i18n'
import {
  goalAcceptanceCheck,
  goalCanCancel,
  goalCanConfirm,
  goalCanPause,
  goalCanResume,
  goalDurationMinutes,
  goalIsEditable,
  isGoalSpinning,
  type GoalAction,
  type GoalCriterionStatus,
  type GoalEvidence,
  type GoalState,
  type GoalStatus,
} from '@/lib/goal'

/**
 * Goal card — a single persistent, in-flow sibling above the composer that
 * mirrors the session goal. It owns no server state: `getGoal()` reads the
 * authoritative ServerAgent state and `onAction()` posts a goal action.
 *
 * The card never invents progress: it shows the server-provided status,
 * objective, acceptance criteria, scope, budget/usage and evidence. It reuses
 * the approval/ask cards for tool approval and user questions — this card
 * never authorizes tools.
 */

export type GoalCardTone = 'info' | 'active' | 'warning' | 'success' | 'danger'

export type GoalCardCriteriaView = {
  id: string
  description: string
  required: boolean
  status: GoalCriterionStatus
  statusKey: string
  evidenceCount: number
}

export type GoalCardViewModel = {
  id: string
  revision: number
  status: GoalStatus
  statusKey: string
  tone: GoalCardTone
  spinning: boolean
  objective: string
  summary: string
  blocker: string
  /** Human-readable explanation of the blocker (e.g. budget exhaustion). */
  blockerHint: string
  editable: boolean
  confirmable: boolean
  pausable: boolean
  resumable: boolean
  cancellable: boolean
  /** `needs_review`: the explicit human-acceptance action is offered. */
  accepting: boolean
  /** The server would reject `accept` (a required criterion failed). */
  acceptBlocked: boolean
  /** `needs_review`: continuing hands the goal back to the model. */
  continuing: boolean
  noteKeys: string[]
  criteria: GoalCardCriteriaView[]
  scope: string[]
  budget: { iterations: number; minutes: number }
  usage: { iterations: number; minutes: number }
  evidence: GoalEvidence[]
}

const STATUS_KEY: Record<GoalStatus, string> = {
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

const CRITERION_STATUS_KEY: Record<GoalCriterionStatus, string> = {
  pending: 'goalCriterionPending',
  passed: 'goalCriterionPassed',
  failed: 'goalCriterionFailed',
  needs_review: 'goalCriterionNeedsReview',
}

// Machine blocker codes the server sets when it pauses a goal (e.g. an exhausted
// budget). The raw code is not user-facing, so map the ones we know and fall
// back to the server text for everything else.
const BLOCKER_KEY: Record<string, string> = {
  iteration_budget: 'goalBlockerIterationBudget',
  duration_budget: 'goalBlockerDurationBudget',
}

function blockerText(goal: GoalState): string {
  const blocker = goal.blocker ?? ''
  const key = BLOCKER_KEY[blocker]
  return key ? t(key as AppTextKey) : blocker
}

function toneForStatus(status: GoalStatus): GoalCardTone {
  if (status === 'completed') return 'success'
  if (status === 'failed' || status === 'cancelled') return 'danger'
  if (status === 'blocked' || status === 'needs_review') return 'warning'
  if (status === 'awaiting_confirmation' || status === 'planning') return 'info'
  return 'active'
}

function noteKeysForStatus(goal: GoalState): string[] {
  switch (goal.status) {
    case 'awaiting_confirmation':
      return ['goalConfirmNote']
    case 'running':
    case 'verifying':
      return ['goalPauseCancelNote', 'goalScopeChangeNote']
    case 'awaiting_input':
      return ['goalAwaitingInputNote']
    case 'awaiting_approval':
      return ['goalAwaitingApprovalNote']
    case 'pausing':
      return ['goalPausingNote']
    case 'paused':
    case 'blocked':
      return ['goalPauseCancelNote', 'goalResumeNote', 'goalScopeChangeNote']
    case 'needs_review':
      // Both actions are always offered; the note explains what each one means.
      // A failed required criterion disables acceptance and says why.
      return ['goalNeedsReviewContinueNote']
    case 'completed':
      return ['goalCompletedNote']
    case 'failed':
      return ['goalFailedNote']
    case 'cancelled':
      return ['goalCancelledNote']
    default:
      return []
  }
}

/** Pure projection of a GoalState into everything the card renders. */
export function buildGoalCardViewModel(goal: GoalState): GoalCardViewModel {
  const acceptance = goal.status === 'needs_review' ? goalAcceptanceCheck(goal) : null
  return {
    id: goal.id,
    revision: goal.revision,
    status: goal.status,
    statusKey: STATUS_KEY[goal.status],
    tone: toneForStatus(goal.status),
    spinning: isGoalSpinning(goal.status),
    objective: goal.objective,
    summary: goal.summary,
    blocker: blockerText(goal),
    blockerHint: goal.blockerHint ?? '',
    editable: goalIsEditable(goal.status),
    confirmable: goalCanConfirm(goal.status),
    pausable: goalCanPause(goal.status),
    resumable: goalCanResume(goal.status),
    cancellable: goalCanCancel(goal.status),
    accepting: false,
    acceptBlocked: acceptance !== null && !acceptance.ok,
    continuing: acceptance !== null,
    noteKeys: noteKeysForStatus(goal),
    criteria: goal.criteria.map((criterion) => ({
      id: criterion.id,
      description: criterion.description,
      required: criterion.required,
      status: criterion.status,
      statusKey: CRITERION_STATUS_KEY[criterion.status],
      evidenceCount: criterion.evidenceIds.length,
    })),
    scope: [...goal.scope],
    budget: {
      iterations: goal.budget.maxIterations,
      minutes: goalDurationMinutes(goal.budget.maxActiveDurationMs),
    },
    usage: {
      iterations: goal.usage.iterations,
      minutes: goalDurationMinutes(goal.usage.activeDurationMs),
    },
    evidence: goal.evidence.map((entry) => ({ ...entry })),
  }
}

// --- DOM controller --------------------------------------------------------

export type GoalCardController = {
  update: () => void
  cleanup: () => void
}

type GoalCardActionButton = {
  label: string
  kind: 'primary' | 'ghost' | 'danger'
  disabled: boolean
  title?: string
  /**
   * Dirty-dependent buttons are re-derived on every keystroke and again at click
   * time, so the card never leaves the user behind a stale disabled state and
   * never submits from a stale enabled one.
   */
  disabledForDraft?: (dirty: boolean) => boolean
  onClick: () => void
}

export type GoalCardDeps = {
  panel: HTMLElement
  getGoal: () => GoalState | null
  getSessionId: () => string
  /** Capability gate; false removes the card (Side Chat / read-only / shared). */
  enabled?: () => boolean
  onAction: (action: GoalAction, objective?: string) => Promise<void>
}

const STATUS_ICON: Record<GoalCardTone, string> = {
  // planning / awaiting_confirmation show a checklist: the plan (and its
  // pending confirmation) is the headline, not a generic info circle. Keep in
  // sync with the strip copy in goal-control-strip.ts.
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>',
  active: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  success: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>',
  danger: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/></svg>',
}

function goalSignature(goal: GoalState): string {
  return JSON.stringify(goal)
}

export function createGoalCardController(deps: GoalCardDeps): GoalCardController {
  const { panel, getGoal, getSessionId, onAction } = deps
  const isEnabled = () => deps.enabled?.() !== false

  let root: HTMLElement | null = null
  let signature = ''
  // Identity of the goal currently rendered. Expansion/editing intent and an
  // in-flight action belong to this id and survive same-goal updates.
  let goalId = ''
  let expanded = false
  let editing = false
  let draftObjective = ''
  // The objective the current edit started from: a server-side objective
  // replacement (revise) is distinguishable from the user typing a draft.
  let editBaseObjective = ''
  let pending = false
  let errorText = ''
  let focusObjective = false
  // Monotonic token isolating async action results: a stale response may only
  // mutate the card while it is still the latest action for the same goal.
  let actionToken = 0

  const reset = () => {
    root?.remove()
    root = null
    signature = ''
    goalId = ''
    expanded = false
    editing = false
    draftObjective = ''
    editBaseObjective = ''
    pending = false
    errorText = ''
    focusObjective = false
    actionToken++
  }

  const setError = (message: string) => {
    errorText = message
  }

  const runAction = async (goal: GoalState, action: GoalAction, objective?: string) => {
    if (pending) return
    const token = ++actionToken
    const sessionId = getSessionId()
    const targetGoalId = goal.id
    pending = true
    errorText = ''
    render(goal)
    try {
      await onAction(action, objective)
    } catch (error) {
      // A newer action or a different goal owns the card now.
      if (token !== actionToken) return
      const current = getGoal()
      // Ignore a stale failure whose session/goal is no longer displayed.
      if (getSessionId() !== sessionId || !current || current.id !== targetGoalId) return
      pending = false
      setError(error instanceof Error && error.message ? error.message : t('goalActionFailed'))
      render(current)
      return
    }
    if (token !== actionToken) return
    if (!pending) return
    const current = getGoal()
    if (getSessionId() !== sessionId || !current || current.id !== targetGoalId) {
      // A different goal owns the card now; update() already reset the pending
      // state when it repainted the new identity.
      return
    }
    // The matching action settled. Revision growth alone never unlocks the
    // card: only this completion (or a real identity switch) does, so a
    // concurrent same-goal update cannot re-enable the buttons mid-flight.
    pending = false
    if (action === 'revise' || action === 'confirm') {
      // The plan/status moved on; the edit session is finished.
      editing = false
      focusObjective = false
      draftObjective = current.objective
      editBaseObjective = current.objective
    }
    render(current)
  }

  const ensureRoot = (composerShell: HTMLElement) => {
    if (!root) {
      root = document.createElement('section')
      root.className = 'quickforge-goal-card'
      root.setAttribute('aria-label', t('goalTitle'))
    }
    // The goal card is always the first in-flow sibling of the composer shell so
    // the TodoWrite summary anchor logic (which tolerates only the msg queue)
    // keeps its own settled position.
    if (root.parentElement !== composerShell || composerShell.firstElementChild !== root) {
      composerShell.insertBefore(root, composerShell.firstElementChild)
    }
  }

  const render = (goal: GoalState) => {
    if (!root) return
    const view = buildGoalCardViewModel(goal)
    root.dataset.status = view.status
    root.dataset.tone = view.tone

    const children: Node[] = []

    // The draft is re-derived from `draftObjective` every time it is needed (a
    // keystroke, a click, Ctrl/Cmd+Enter) instead of trusting the value captured
    // when this render ran.
    const objectiveDirty = () => editing && draftObjective.trim() !== view.objective.trim()
    // Refreshed in place once the action buttons exist. It is deliberately
    // render-scoped: a stale editor from an earlier render can only touch the
    // detached buttons of that render, never the live ones.
    let syncDraftActions: () => void = () => {}

    // --- Header: status + revision + expand toggle -------------------------
    const head = document.createElement('div')
    head.className = 'quickforge-goal-head'

    const statusIcon = document.createElement('span')
    statusIcon.className = `quickforge-goal-status-icon${view.spinning ? ' quickforge-goal-status-icon--spinning' : ''}`
    statusIcon.setAttribute('aria-hidden', 'true')
    statusIcon.innerHTML = STATUS_ICON[view.tone]
    head.append(statusIcon)

    const statusLabel = document.createElement('span')
    statusLabel.className = 'quickforge-goal-status-label'
    statusLabel.setAttribute('aria-live', 'polite')
    statusLabel.textContent = t(view.statusKey as AppTextKey)
    head.append(statusLabel)

    const revision = document.createElement('span')
    revision.className = 'quickforge-goal-revision'
    revision.textContent = `r${view.revision}`
    head.append(revision)

    const spacer = document.createElement('span')
    spacer.className = 'quickforge-goal-spacer'
    spacer.setAttribute('aria-hidden', 'true')
    head.append(spacer)

    const expandButton = document.createElement('button')
    expandButton.type = 'button'
    expandButton.className = 'quickforge-goal-expand'
    expandButton.setAttribute('aria-expanded', String(expanded))
    expandButton.setAttribute('aria-label', expanded ? t('goalCollapse') : t('goalExpand'))
    expandButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'
    expandButton.addEventListener('click', () => {
      expanded = !expanded
      render(goal)
    })
    head.append(expandButton)
    children.push(head)

    // --- Objective line (static summary while collapsed) -------------------
    if (!expanded) {
      const objective = document.createElement('p')
      objective.className = 'quickforge-goal-objective-line'
      objective.textContent = view.objective || t('goalObjectiveEmpty')
      children.push(objective)
    }

    // --- Body --------------------------------------------------------------
    const body = document.createElement('div')
    body.className = 'quickforge-goal-body'
    body.hidden = !expanded

    if (expanded) {
      const objectiveLabel = document.createElement('label')
      objectiveLabel.className = 'quickforge-goal-field-label'
      objectiveLabel.textContent = t('goalObjectiveLabel')
      body.append(objectiveLabel)

      if (editing) {
        const textarea = document.createElement('textarea')
        textarea.className = 'quickforge-goal-objective-input'
        textarea.rows = 3
        textarea.value = draftObjective
        textarea.setAttribute('aria-label', t('goalObjectiveLabel'))
        textarea.addEventListener('input', () => {
          draftObjective = textarea.value
          // Update the action buttons in place: re-rendering here would replace
          // this textarea and drop focus, the caret and the selection.
          syncDraftActions()
        })
        textarea.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            editing = false
            draftObjective = view.objective
            focusObjective = false
            render(goal)
            return
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            if (pending || !objectiveDirty()) return
            void runAction(goal, 'revise', draftObjective.trim())
          }
        })
        body.append(textarea)
        if (focusObjective) {
          focusObjective = false
          const focus = () => {
            textarea.focus()
            textarea.selectionStart = textarea.selectionEnd = textarea.value.length
          }
          if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(focus)
          } else {
            focus()
          }
        }
      } else {
        const objective = document.createElement('p')
        objective.className = 'quickforge-goal-objective'
        objective.textContent = view.objective || t('goalObjectiveEmpty')
        body.append(objective)
      }

      if (view.blocker) {
        const blockerLabel = document.createElement('div')
        blockerLabel.className = 'quickforge-goal-field-label'
        blockerLabel.textContent = t('goalBlockerLabel')
        const blocker = document.createElement('p')
        blocker.className = 'quickforge-goal-blocker'
        blocker.textContent = view.blocker
        body.append(blockerLabel, blocker)
        if (view.blockerHint) {
          const hint = document.createElement('p')
          hint.className = 'quickforge-goal-blocker-hint'
          hint.textContent = view.blockerHint
          body.append(hint)
        }
      }

      // Acceptance criteria
      if (view.criteria.length > 0) {
        const criteriaLabel = document.createElement('div')
        criteriaLabel.className = 'quickforge-goal-field-label'
        criteriaLabel.textContent = t('goalCriteriaLabel')
        body.append(criteriaLabel)
        const list = document.createElement('ul')
        list.className = 'quickforge-goal-criteria'
        for (const criterion of view.criteria) {
          const item = document.createElement('li')
          item.className = `quickforge-goal-criterion quickforge-goal-criterion--${criterion.status}`

          const icon = document.createElement('span')
          icon.className = 'quickforge-goal-criterion-icon'
          icon.setAttribute('aria-hidden', 'true')
          icon.innerHTML = criterion.status === 'passed'
            ? '<svg viewBox="0 0 24 24"><path d="m8 12 2.5 2.5L16 9"/></svg>'
            : criterion.status === 'failed'
              ? '<svg viewBox="0 0 24 24"><path d="M15 9l-6 6"/><path d="M9 9l6 6"/></svg>'
              : criterion.status === 'needs_review'
                ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>'
                : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>'
          item.append(icon)

          const text = document.createElement('span')
          text.className = 'quickforge-goal-criterion-text'
          text.textContent = criterion.description || criterion.id
          item.append(text)

          if (criterion.required) {
            const required = document.createElement('span')
            required.className = 'quickforge-goal-criterion-required'
            required.textContent = t('goalCriterionRequired')
            item.append(required)
          }

          const status = document.createElement('span')
          status.className = 'quickforge-goal-criterion-status'
          status.textContent = t(criterion.statusKey as AppTextKey)
          item.append(status)

          if (criterion.evidenceCount > 0) {
            const evidence = document.createElement('span')
            evidence.className = 'quickforge-goal-criterion-evidence'
            evidence.textContent = t('goalEvidenceCount', { count: criterion.evidenceCount })
            item.append(evidence)
          }
          list.append(item)
        }
        body.append(list)
      }

      // Scope
      if (view.scope.length > 0) {
        const scopeLabel = document.createElement('div')
        scopeLabel.className = 'quickforge-goal-field-label'
        scopeLabel.textContent = t('goalScopeLabel')
        body.append(scopeLabel)
        const scope = document.createElement('div')
        scope.className = 'quickforge-goal-scope'
        for (const entry of view.scope) {
          const chip = document.createElement('span')
          chip.className = 'quickforge-goal-scope-chip'
          chip.textContent = entry
          scope.append(chip)
        }
        body.append(scope)
      }

      // Budget + usage (never a fabricated percentage)
      const stats = document.createElement('div')
      stats.className = 'quickforge-goal-stats'
      const budget = document.createElement('span')
      budget.className = 'quickforge-goal-stat'
      budget.textContent = `${t('goalBudgetLabel')}: ${t('goalBudgetValue', { iterations: view.budget.iterations, minutes: goal.budget.maxActiveDurationMs === null ? t('goalUnlimitedTime') : view.budget.minutes })}`
      const usage = document.createElement('span')
      usage.className = 'quickforge-goal-stat'
      usage.textContent = `${t('goalUsageLabel')}: ${t('goalUsageValue', { iterations: view.usage.iterations, minutes: view.usage.minutes })}`
      stats.append(budget, usage)
      body.append(stats)

      // Summary
      if (view.summary) {
        const summaryLabel = document.createElement('div')
        summaryLabel.className = 'quickforge-goal-field-label'
        summaryLabel.textContent = t('goalSummaryLabel')
        const summary = document.createElement('p')
        summary.className = 'quickforge-goal-summary'
        summary.textContent = view.summary
        body.append(summaryLabel, summary)
      }

      // Evidence
      if (view.evidence.length > 0) {
        const evidenceLabel = document.createElement('div')
        evidenceLabel.className = 'quickforge-goal-field-label'
        evidenceLabel.textContent = t('goalEvidenceLabel')
        body.append(evidenceLabel)
        const list = document.createElement('ul')
        list.className = 'quickforge-goal-evidence'
        for (const entry of view.evidence) {
          const item = document.createElement('li')
          item.className = 'quickforge-goal-evidence-item'
          const text = document.createElement('span')
          text.textContent = entry.description || entry.id
          item.append(text)
          if (entry.source === 'human' || entry.acceptedAt) {
            // Human-accepted evidence is labelled as such — never presented as a
            // machine verification.
            const human = document.createElement('span')
            human.className = 'quickforge-goal-evidence-human'
            human.textContent = t('goalEvidenceHumanAccepted')
            item.append(human)
          }
          // Prefer the trusted tool name the server attached over the raw call id.
          const origin = entry.source || entry.toolName || entry.toolCallId
          if (origin) {
            const tag = document.createElement('span')
            tag.className = 'quickforge-goal-evidence-tool'
            tag.textContent = origin
            item.append(tag)
          }
          list.append(item)
        }
        body.append(list)
      }

      // Notes (pause/cancel do not roll back; scope changes need re-confirmation)
      for (const key of view.noteKeys) {
        const note = document.createElement('p')
        note.className = 'quickforge-goal-note'
        note.textContent = t(key as AppTextKey)
        body.append(note)
      }
    }
    children.push(body)

    // --- Actions -----------------------------------------------------------
    const dirty = objectiveDirty()
    const actionButtons: GoalCardActionButton[] = []

    if (view.confirmable) {
      actionButtons.push({
        label: t('goalConfirm'),
        kind: 'primary',
        disabled: pending || dirty,
        disabledForDraft: (nextDirty) => pending || nextDirty,
        onClick: () => {
          // Confirm always confirms the server-side objective, so an unsubmitted
          // draft must never reach it — not even through a stale button node.
          if (objectiveDirty()) return
          void runAction(goal, 'confirm')
        },
      })
    }
    if (view.editable) {
      if (!editing) {
        actionButtons.push({
          label: goal.status === 'awaiting_confirmation' ? t('goalEditObjective') : t('goalRevise'),
          kind: 'ghost',
          disabled: pending,
          onClick: () => {
            editing = true
            draftObjective = view.objective
            editBaseObjective = view.objective
            focusObjective = true
            render(goal)
          },
        })
      } else {
        actionButtons.push({
          label: t('goalRevise'),
          kind: 'primary',
          disabled: pending || !dirty,
          disabledForDraft: (nextDirty) => pending || !nextDirty,
          onClick: () => runAction(goal, 'revise', draftObjective.trim()),
        })
        actionButtons.push({
          label: t('goalEditCancel'),
          kind: 'ghost',
          disabled: pending,
          onClick: () => {
            editing = false
            draftObjective = view.objective
            editBaseObjective = view.objective
            focusObjective = false
            render(goal)
          },
        })
      }
    }
    if (view.pausable) {
      actionButtons.push({
        label: t('goalPause'),
        kind: 'ghost',
        disabled: pending,
        onClick: () => runAction(goal, 'pause'),
      })
    }
    if (view.accepting) {
      // Explicit human acceptance: the user confirms the current result as-is.
      // The server records `human` evidence for criteria it did not verify
      // mechanically; this button never pretends the machine passed them.
      actionButtons.push({
        label: t('goalAccept'),
        kind: 'primary',
        disabled: pending || view.acceptBlocked,
        title: view.acceptBlocked ? t('goalNeedsReviewBlockedNote') : undefined,
        onClick: () => runAction(goal, 'accept'),
      })
    }
    if (view.continuing) {
      // `resume` from needs_review only continues execution — it never accepts.
      actionButtons.push({
        label: t('goalContinue'),
        kind: view.acceptBlocked ? 'primary' : 'ghost',
        disabled: pending,
        onClick: () => runAction(goal, 'resume'),
      })
    }
    if (view.resumable && !view.accepting && !view.continuing) {
      actionButtons.push({
        label: t('goalResume'),
        kind: 'primary',
        disabled: pending || dirty,
        disabledForDraft: (nextDirty) => pending || nextDirty,
        onClick: () => { if (!objectiveDirty()) void runAction(goal, 'resume') },
      })
    }
    if (view.cancellable) {
      actionButtons.push({
        label: t('goalCancel'),
        kind: 'danger',
        disabled: pending,
        onClick: () => runAction(goal, 'cancel'),
      })
    }

    const actionElements: HTMLButtonElement[] = []
    if (actionButtons.length > 0) {
      const actions = document.createElement('div')
      actions.className = 'quickforge-goal-actions'
      for (const action of actionButtons) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = `quickforge-goal-button quickforge-goal-button--${action.kind}`
        button.textContent = action.label
        button.disabled = action.disabled
        if (action.title) button.title = action.title
        button.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (button.disabled) return
          action.onClick()
        })
        actions.append(button)
        actionElements.push(button)
      }
      if (pending) {
        const busy = document.createElement('span')
        busy.className = 'quickforge-goal-busy'
        busy.textContent = t('goalActionSubmitting')
        busy.setAttribute('aria-live', 'polite')
        actions.append(busy)
      }
      children.push(actions)
    }

    // Keystrokes only refresh the dirty-dependent buttons: nothing here
    // re-renders the editor, so the textarea node, its value, focus and selection
    // all survive. The closure stays render-scoped, so it can never touch the
    // buttons of a previous (detached) render.
    syncDraftActions = () => {
      const nextDirty = objectiveDirty()
      actionButtons.forEach((action, index) => {
        if (!action.disabledForDraft) return
        actionElements[index].disabled = action.disabledForDraft(nextDirty)
      })
    }

    if (errorText) {
      const message = document.createElement('div')
      message.className = 'quickforge-goal-message'
      message.setAttribute('role', 'alert')
      message.textContent = errorText
      children.push(message)
    }

    root.replaceChildren(...children)
  }

  return {
    update() {
      if (!isEnabled()) {
        reset()
        return
      }
      const goal = getGoal()
      if (!goal) {
        reset()
        return
      }
      const editor = panel.querySelector<HTMLElement>('message-editor')
      const composerShell = editor?.parentElement
      if (!composerShell) {
        root?.remove()
        root = null
        signature = ''
        return
      }
      const wasMounted = root !== null
      ensureRoot(composerShell)

      const nextSignature = goalSignature(goal)
      const sameGoal = goalId === goal.id
      if (wasMounted && sameGoal && nextSignature === signature) return
      if (!sameGoal) {
        // A new goal owns the card: reset expansion, the edit draft, focus and
        // any in-flight action left over from the previous goal.
        goalId = goal.id
        expanded = goal.status === 'awaiting_confirmation'
        editing = false
        draftObjective = goal.objective
        editBaseObjective = goal.objective
        pending = false
        errorText = ''
        focusObjective = false
        actionToken++
      } else {
        // A same-goal update (any revision growth) must NOT unlock an in-flight
        // action: the pending state belongs to the matching request and is only
        // cleared by runAction when it settles, or by an identity switch above.
        if (!goalIsEditable(goal.status) || (editing && goal.objective !== editBaseObjective)) {
          // Same goal, but the edit is no longer valid: the status left the
          // editable set, or the server replaced the objective (revise). Drop
          // the draft instead of stranding the user on a stale edit.
          editing = false
          focusObjective = false
          draftObjective = goal.objective
          editBaseObjective = goal.objective
        }
      }
      signature = nextSignature
      render(goal)
    },
    cleanup() {
      reset()
    },
  }
}
