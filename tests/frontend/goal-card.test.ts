import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { buildGoalCardViewModel } from '../../src/components/chat/panel-decoration/goal-card'
import { QUICKFORGE_CHAT_CAPABILITIES, SIDE_CHAT_UI_CAPABILITIES, applyChatPagePolicy } from '../../src/lib/chat-capabilities'

// goal-card only needs t() at render time; the view-model projection is pure.
vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}))

const cardSource = readFileSync(new URL('../../src/components/chat/panel-decoration/goal-card.ts', import.meta.url), 'utf8')
const hostSource = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')
const decorationSource = readFileSync(new URL('../../src/components/chat/panel-decoration.ts', import.meta.url), 'utf8')
const commandsSource = readFileSync(new URL('../../src/components/chat/command-suggestions.ts', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
const serverAgentSource = readFileSync(new URL('../../src/lib/server-agent.ts', import.meta.url), 'utf8')

type GoalState = import('../../src/lib/goal').GoalState

function goal(overrides: Partial<GoalState> = {}): GoalState {
  return {
    id: 'goal-1',
    sessionId: 'session-1',
    revision: 3,
    objective: 'Ship the goal UI',
    status: 'running',
    criteria: [],
    scope: [],
    summary: '',
    budget: { maxIterations: 12, maxActiveDurationMs: 1_200_000 },
    usage: { iterations: 4, activeDurationMs: 300_000 },
    evidence: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('buildGoalCardViewModel', () => {
  it('keeps the confirmation card editable and confirmable', () => {
    const view = buildGoalCardViewModel(goal({
      status: 'awaiting_confirmation',
      criteria: [{ id: 'c1', description: 'Builds', required: true, status: 'pending', evidenceIds: [] }],
      scope: ['src/**'],
    }))
    expect(view).toMatchObject({
      statusKey: 'goalStatusAwaitingConfirmation',
      tone: 'info',
      spinning: false,
      editable: true,
      confirmable: false,
      pausable: false,
      resumable: true,
      cancellable: true,
      noteKeys: ['goalConfirmNote'],
    })
    expect(view.criteria[0]).toEqual({
      id: 'c1',
      description: 'Builds',
      required: true,
      status: 'pending',
      statusKey: 'goalCriterionPending',
      evidenceCount: 0,
    })
  })

  it('exposes pause and cancel while running, plus the no-rollback and scope notes', () => {
    const view = buildGoalCardViewModel(goal({ status: 'running' }))
    expect(view).toMatchObject({
      tone: 'active',
      spinning: true,
      editable: false,
      confirmable: false,
      pausable: true,
      resumable: false,
      cancellable: true,
    })
    expect(view.noteKeys).toContain('goalPauseCancelNote')
    expect(view.noteKeys).toContain('goalScopeChangeNote')
  })

  it('shows pausing as in-progress instead of pretending it stopped', () => {
    const view = buildGoalCardViewModel(goal({ status: 'pausing' }))
    expect(view).toMatchObject({
      statusKey: 'goalStatusPausing',
      spinning: true,
      pausable: false,
      resumable: false,
    })
    expect(view.noteKeys).toEqual(['goalPausingNote'])
  })

  it('offers resume and objective revision when paused or blocked', () => {
    for (const status of ['paused', 'blocked'] as const) {
      const view = buildGoalCardViewModel(goal({ status, blocker: status === 'blocked' ? 'Missing access' : undefined }))
      expect(view.editable).toBe(true)
      expect(view.resumable).toBe(true)
      expect(view.cancellable).toBe(true)
      expect(view.noteKeys).toContain('goalResumeNote')
    }
    const blocked = buildGoalCardViewModel(goal({ status: 'blocked', blocker: 'Missing access' }))
    expect(blocked.tone).toBe('warning')
    expect(blocked.blocker).toBe('Missing access')
  })

  it('waits on the existing approval/ask cards for input and approval states', () => {
    expect(buildGoalCardViewModel(goal({ status: 'awaiting_input' })).noteKeys).toEqual(['goalAwaitingInputNote'])
    expect(buildGoalCardViewModel(goal({ status: 'awaiting_approval' })).noteKeys).toEqual(['goalAwaitingApprovalNote'])
  })

  it('shows completed and offers accept + continue in needs_review', () => {
    const completed = buildGoalCardViewModel(goal({ status: 'completed' }))
    expect(completed).toMatchObject({ tone: 'success', cancellable: false, resumable: false, accepting: false, acceptBlocked: false, continuing: false })
    expect(completed.noteKeys).toEqual(['goalCompletedNote'])

    // needs_review always offers both actions; acceptance is the human sign-off,
    // continuing hands the goal back to the model without accepting.
    const review = buildGoalCardViewModel(goal({ status: 'needs_review' }))
    expect(review).toMatchObject({ tone: 'warning', resumable: true, cancellable: true, accepting: false, acceptBlocked: false, continuing: true })
    expect(review.noteKeys).toEqual(['goalNeedsReviewContinueNote'])

    // A failed required criterion disables acceptance and explains why.
    const blocked = buildGoalCardViewModel(goal({
      status: 'needs_review',
      criteria: [{ id: 'c1', description: 'Builds', required: true, status: 'failed', evidenceIds: [] }],
    }))
    expect(blocked).toMatchObject({ accepting: false, acceptBlocked: true, continuing: true })
    expect(blocked.noteKeys).toEqual(['goalNeedsReviewContinueNote'])

    // Human-accepted evidence keeps the gate open; a toolCallId is not required.
    const accepted = buildGoalCardViewModel(goal({
      status: 'needs_review',
      criteria: [{ id: 'c1', description: 'Builds', required: true, status: 'needs_review', evidenceIds: ['e1'] }],
      evidence: [{ id: 'e1', description: 'reviewed by hand', source: 'human', acceptedAt: '2026-01-02T00:00:00.000Z' }],
    }))
    expect(accepted).toMatchObject({ accepting: false, acceptBlocked: false, continuing: true })
    expect(accepted.evidence[0].source).toBe('human')
  })

  it('presents budget and usage as counts and whole minutes only', () => {
    const view = buildGoalCardViewModel(goal({
      budget: { maxIterations: 8, maxActiveDurationMs: 90_000 },
      usage: { iterations: 2, activeDurationMs: 59_000 },
    }))
    expect(view.budget).toEqual({ iterations: 8, minutes: 2 })
    expect(view.usage).toEqual({ iterations: 2, minutes: 1 })
    expect(view).not.toHaveProperty('percent')
    expect(view).not.toHaveProperty('progress')
  })

  it('maps criterion status keys and evidence counts', () => {
    const view = buildGoalCardViewModel(goal({
      criteria: [
        { id: 'a', description: 'a', required: false, status: 'passed', evidenceIds: ['e1'] },
        { id: 'b', description: 'b', required: true, status: 'failed', evidenceIds: [] },
        { id: 'c', description: 'c', required: false, status: 'needs_review', evidenceIds: ['e1', 'e2'] },
      ],
    }))
    expect(view.criteria.map((entry) => entry.statusKey)).toEqual([
      'goalCriterionPassed',
      'goalCriterionFailed',
      'goalCriterionNeedsReview',
    ])
    expect(view.criteria.map((entry) => entry.evidenceCount)).toEqual([1, 0, 2])
  })

  it('localizes the budget blocker code and surfaces the server hint', () => {
    const view = buildGoalCardViewModel(goal({
      status: 'paused',
      blocker: 'duration_budget',
      blockerHint: 'Budget exhausted. Cancel this goal and start a new one.',
    }))
    expect(view.blocker).toBe('goalBlockerDurationBudget')
    expect(view.blockerHint).toBe('Budget exhausted. Cancel this goal and start a new one.')

    const iteration = buildGoalCardViewModel(goal({ status: 'paused', blocker: 'iteration_budget' }))
    expect(iteration.blocker).toBe('goalBlockerIterationBudget')
    expect(iteration.blockerHint).toBe('')

    // Unknown blockers keep the server text as-is.
    const custom = buildGoalCardViewModel(goal({ status: 'blocked', blocker: 'Missing access' }))
    expect(custom.blocker).toBe('Missing access')
  })

  it('labels real server human-acceptance evidence and prefers the trusted tool name', async () => {
    const {
      createGoalState,
      applyGoalPlan,
      applyGoalProgress,
      applyHumanAcceptance,
    } = await import('../../server/agent-goal-state.mjs')
    const { normalizeGoalState } = await import('../../src/lib/goal')

    const planned = applyGoalPlan(createGoalState({ sessionId: 'session-1', objective: 'Ship it' }), {
      criteria: [{ description: 'Builds' }, { description: 'Docs updated', required: false }],
      scope: [],
      summary: '',
    })
    const progressed = applyGoalProgress(planned, {
      evidence: [{ id: 'e1', description: 'npm run build', toolCallId: 'call-1' }],
      criterionUpdates: [{ id: 'c1', status: 'passed', evidenceIds: ['e1'] }],
      trustedToolNames: new Map([['call-1', 'run_command']]),
    }).goal
    const accepted = applyHumanAcceptance(progressed).goal

    const view = buildGoalCardViewModel(normalizeGoalState(accepted)!)
    expect(view.status).toBe('completed')
    expect(view.evidence.find((entry) => entry.toolCallId === 'call-1')?.toolName).toBe('run_command')
    const human = view.evidence.find((entry) => entry.source === 'human')
    expect(human?.acceptedAt).toBe(accepted.humanAcceptedAt)
  })
})

describe('goal card controller wiring', () => {
  it('is a DOM controller with update/cleanup and identity-bound async actions', () => {
    expect(cardSource).toContain('export function createGoalCardController')
    expect(cardSource).toContain('update() {')
    expect(cardSource).toContain('cleanup() {')
    expect(cardSource).toContain('const sessionId = getSessionId()')
    expect(cardSource).toContain('const targetGoalId = goal.id')
    // Async results are isolated by a monotonic token, not just session/goal id.
    expect(cardSource).toContain('const token = ++actionToken')
    expect(cardSource).toContain('if (token !== actionToken) return')
    // Same-goal updates keep expansion/editing intent; a new goal resets it.
    expect(cardSource).toContain('const sameGoal = goalId === goal.id')
    expect(cardSource).toContain('editBaseObjective')
    // Keyboard: Escape cancels the edit, Ctrl/Cmd+Enter submits the revision.
    expect(cardSource).toContain("event.key === 'Escape'")
    expect(cardSource).toContain("event.key === 'Enter' && (event.ctrlKey || event.metaKey)")
    // Repeated clicks are blocked while an action is in flight.
    expect(cardSource).toContain('if (pending) return')
    expect(cardSource).toContain('button.disabled = action.disabled')
    expect(cardSource).toContain('if (button.disabled) return')
    // needs_review exposes an explicit acceptance vs continue action, and the
    // disabled accept explains why a required failure blocks it.
    expect(cardSource).toContain("t('goalAccept')")
    expect(cardSource).toContain("t('goalContinue')")
    expect(cardSource).toContain('view.acceptBlocked')
    expect(cardSource).toContain("t('goalNeedsReviewBlockedNote')")
    expect(cardSource).toContain("runAction(goal, 'accept')")
    expect(cardSource).toContain("runAction(goal, 'resume')")
    // Human-accepted evidence is labelled, never rendered as a machine pass.
    expect(cardSource).toContain("entry.source === 'human'")
    expect(cardSource).toContain('entry.acceptedAt')
    expect(cardSource).toContain("t('goalEvidenceHumanAccepted')")
    // The trusted server tool name is preferred over the raw tool call id.
    expect(cardSource).toContain('entry.toolName || entry.toolCallId')
    // Failures keep the card and surface the error.
    expect(cardSource).toContain("message.setAttribute('role', 'alert')")
    expect(cardSource).toContain('goalActionFailed')
    // No fabricated percentage anywhere.
    expect(cardSource).not.toContain('%')
  })

  it('is accessible and reuses the composer flow without an absolute overlay', () => {
    expect(cardSource).toContain("root.setAttribute('aria-label', t('goalTitle'))")
    expect(cardSource).toContain("expandButton.setAttribute('aria-expanded', String(expanded))")
    expect(cardSource).toContain("expandButton.setAttribute('aria-label'")
    expect(cardSource).toContain("statusLabel.setAttribute('aria-live', 'polite')")
    expect(cardSource).toContain("document.createElement('button')")
    expect(cardSource).toContain('composerShell.insertBefore(root, composerShell.firstElementChild)')
    expect(cardSource).toContain('root?.remove()')
  })

  it('never authorizes tools — approval and ask cards stay the only gates', () => {
    expect(cardSource).not.toContain('onApprove')
    expect(cardSource).not.toContain('onReject')
    expect(cardSource).not.toContain('injectApprovalCard')
    expect(cardSource).not.toContain('injectAskUserCard')
  })

  it('is exported through the panel decoration facade', () => {
    expect(decorationSource).toContain('createGoalCardController')
    expect(decorationSource).toContain('buildGoalCardViewModel')
  })

  it('mounts the compact control strip in ChatPanelHost behind the goal capability with full cleanup', () => {
    expect(hostSource).toContain('createGoalControlStripController({')
    // The full DOM card is kept for its view-model / tests but is no longer
    // mounted in production.
    expect(hostSource).not.toContain('createGoalCardController')
    expect(hostSource).toContain('effectiveCapabilities.goal')
    expect(hostSource).toContain("!('shareId' in agent)")
    // OpenCode/ACP sessions cannot use goal mode (server rejects it); the gate
    // reads the authoritative session source, not just readOnly/capabilities.
    expect(hostSource).toContain("(agent as AgentWithGoal).sessionSource !== 'acp'")
    expect(hostSource).toContain('goalStrip?.update()')
    expect(hostSource).toContain('goalStrip?.cleanup()')
    // The shared goal-ui module owns the lock/dirty guard and the summary
    // request; the host injects it instead of re-implementing the lock.
    expect(hostSource).toContain('from \'@/lib/goal-ui\'')
    expect(hostSource).toContain('goalUi: { getGoalUiState, requestOpenGoalSummary, runGoalUiAction, subscribeGoalUi }')
    expect(hostSource).toContain("eventType === 'goal_updated'")
    expect(hostSource).toContain('target.updateGoal(action, objective)')
    expect(hostSource).toContain("if (typeof target.updateGoal !== 'function') throw new Error(t('goalUnavailable'))")
  })

  it('exposes the control strip through the panel decoration facade', () => {
    expect(decorationSource).toContain('createGoalControlStripController')
    expect(decorationSource).toContain('buildGoalControlStripView')
    // The full card stays exported for its view-model and A-side consumers.
    expect(decorationSource).toContain('createGoalCardController')
  })

  it('adds the /goal built-in command that only completes text until sent', () => {
    expect(commandsSource).toContain("{ name: 'goal', description: t('goalCommandDescription'), argumentHint: '[objective]' }")
    // Selecting a command row inserts text; it never sends a prompt itself.
    expect(commandsSource).toContain('insertEntryIntoComposer')
  })

  it('keeps goal capability on the QuickForge surface only', () => {
    expect(QUICKFORGE_CHAT_CAPABILITIES.goal).toBe(true)
    expect(SIDE_CHAT_UI_CAPABILITIES.goal).toBe(false)
    expect(applyChatPagePolicy(QUICKFORGE_CHAT_CAPABILITIES, { readOnly: true }).goal).toBe(false)
    expect(applyChatPagePolicy(QUICKFORGE_CHAT_CAPABILITIES, {}).goal).toBe(true)
  })

  it('keeps the goal contract on ServerAgent snapshots, SSE and the action endpoint', () => {
    expect(serverAgentSource).toContain('goal?: GoalState | null')
    expect(serverAgentSource).toContain("case 'goal_updated'")
    expect(serverAgentSource).toContain('normalizeGoalState(goalEvent.goal)')
    expect(serverAgentSource).toContain('async updateGoal(action: GoalAction, objective?: string, options?: GoalActionOptions)')
    expect(serverAgentSource).toContain('/goal`')
  })
})

describe('goal card i18n and styling', () => {
  const keys = [
    'goalCommandDescription', 'goalTitle', 'goalStatusPlanning', 'goalStatusAwaitingConfirmation',
    'goalStatusRunning', 'goalStatusVerifying', 'goalStatusAwaitingInput', 'goalStatusAwaitingApproval',
    'goalStatusPausing', 'goalStatusPaused', 'goalStatusBlocked', 'goalStatusNeedsReview',
    'goalStatusCompleted', 'goalStatusFailed', 'goalStatusCancelled', 'goalCriterionPending',
    'goalCriterionPassed', 'goalCriterionFailed', 'goalCriterionNeedsReview', 'goalCriterionRequired',
    'goalObjectiveLabel', 'goalObjectiveEmpty', 'goalCriteriaLabel', 'goalScopeLabel', 'goalBudgetLabel',
    'goalBudgetValue', 'goalUsageLabel', 'goalUsageValue', 'goalEvidenceLabel', 'goalEvidenceCount',
    'goalBlockerLabel', 'goalBlockerIterationBudget', 'goalBlockerDurationBudget', 'goalSummaryLabel', 'goalExpand', 'goalCollapse', 'goalConfirm', 'goalRevise',
    'goalEditObjective', 'goalEditCancel', 'goalPause', 'goalResume', 'goalCancel', 'goalActionSubmitting',
    'goalActionFailed', 'goalUnavailable', 'goalConfirmNote', 'goalPauseCancelNote', 'goalResumeNote',
    'goalScopeChangeNote', 'goalAwaitingInputNote', 'goalAwaitingApprovalNote', 'goalPausingNote',
    'goalNeedsReviewNote', 'goalNeedsReviewAcceptNote', 'goalNeedsReviewBlockedNote',
    'goalNeedsReviewContinueNote', 'goalAccept', 'goalContinue', 'goalEvidenceHumanAccepted',
    'goalCompletedNote', 'goalFailedNote', 'goalCancelledNote',
    'goalOpenSummary', 'goalMoreActions', 'goalCancelConfirmTitle', 'goalCancelConfirmMessage',
    'goalKeepWorking', 'goalSaveObjective', 'goalUnsavedChanges', 'goalActionInProgress',
    'goalCriteriaProgress', 'goalSummaryDetails',
  ]

  it('defines every goal string in both languages', () => {
    for (const key of keys) {
      expect(i18nSource.match(new RegExp(`${key}:`, 'g'))?.length).toBe(2)
    }
    expect(i18nSource).toContain("goalStatusPausing: 'Pausing…'")
    expect(i18nSource).toContain("goalStatusPausing: '正在暂停…'")
    expect(i18nSource).toContain("goalPauseCancelNote: 'Pausing or cancelling does not roll back changes already made.'")
    expect(i18nSource).toContain("goalPauseCancelNote: '暂停或取消不会回滚已完成的改动。'")
    expect(i18nSource).toContain("goalScopeChangeNote:")
  })

  it('styles an in-flow card with focus, responsive and reduced-motion handling', () => {
    const block = css.slice(css.indexOf('/* Goal mode card'), css.indexOf('/* TodoWrite task summary'))
    const rootRule = block.match(/\.quickforge-goal-card\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rootRule).toMatch(/width:\s*100%/)
    expect(rootRule).toMatch(/flex:\s*none/)
    expect(rootRule).not.toMatch(/position:\s*(?:fixed|absolute)/)
    expect(block).not.toMatch(/linear-gradient|radial-gradient/)
    expect(block).toContain('.quickforge-goal-expand:focus-visible')
    expect(block).toMatch(/@media \(max-width: 640px\)/)
    expect(block).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(block).toContain('quickforge-goal-spin')
  })

  it('styles the control strip as a minimal in-flow row reusing the goal tone tokens', () => {
    const block = css.slice(css.indexOf('/* Goal control strip'), css.indexOf('/* Goal mode card'))
    const rootRule = block.match(/\.quickforge-goal-strip\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rootRule).toMatch(/width:\s*100%/)
    expect(rootRule).toMatch(/flex:\s*none/)
    expect(rootRule).toContain('--quickforge-goal-tone')
    expect(rootRule).not.toMatch(/position:\s*(?:fixed|absolute)/)
    expect(block).not.toMatch(/linear-gradient|radial-gradient/)
    expect(block).toContain('.quickforge-goal-strip-action:focus-visible')
    expect(block).toMatch(/@media \(max-width: 640px\)/)
    expect(block).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(block).toContain('quickforge-goal-strip-icon--spinning')
  })
})
