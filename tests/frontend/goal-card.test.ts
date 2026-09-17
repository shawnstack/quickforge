import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { buildGoalCardViewModel } from '../../src/components/chat/panel-decoration/goal-card'
import { QUICKFORGE_CHAT_CAPABILITIES, SIDE_CHAT_UI_CAPABILITIES, applyChatPagePolicy } from '../../src/lib/chat-capabilities'

// goal-card only needs t() at render time; the view-model projection is pure.
vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}))

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
  it('keeps the confirmation card editable', () => {
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

  it('shows completed and offers continue in needs_review', () => {
    const completed = buildGoalCardViewModel(goal({ status: 'completed' }))
    expect(completed).toMatchObject({ tone: 'success', cancellable: false, resumable: false, acceptBlocked: false, continuing: false })
    expect(completed.noteKeys).toEqual(['goalCompletedNote'])

    // needs_review offers only continue — there is no accept action; continuing
    // hands the goal back to the model without accepting.
    const review = buildGoalCardViewModel(goal({ status: 'needs_review' }))
    expect(review).toMatchObject({ tone: 'warning', resumable: true, cancellable: true, acceptBlocked: false, continuing: true })
    expect(review.noteKeys).toEqual(['goalNeedsReviewContinueNote'])

    // A failed required criterion still blocks acceptance; continue is offered.
    const blocked = buildGoalCardViewModel(goal({
      status: 'needs_review',
      criteria: [{ id: 'c1', description: 'Builds', required: true, status: 'failed', evidenceIds: [] }],
    }))
    expect(blocked).toMatchObject({ acceptBlocked: true, continuing: true })
    expect(blocked.noteKeys).toEqual(['goalNeedsReviewContinueNote'])

    // Human-accepted evidence keeps the gate open; a toolCallId is not required.
    const accepted = buildGoalCardViewModel(goal({
      status: 'needs_review',
      criteria: [{ id: 'c1', description: 'Builds', required: true, status: 'needs_review', evidenceIds: ['e1'] }],
      evidence: [{ id: 'e1', description: 'reviewed by hand', source: 'human', acceptedAt: '2026-01-02T00:00:00.000Z' }],
    }))
    expect(accepted).toMatchObject({ acceptBlocked: false, continuing: true })
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

  it('localizes the machine blocker codes and the recovery restart sentence', () => {
    const codes: Array<[string, string]> = [
      ['persist_failed', 'goalBlockerPersistFailed'],
      ['user_aborted', 'goalBlockerUserAborted'],
      ['planning_failed', 'goalBlockerPlanningFailed'],
      ['repeated_failures', 'goalBlockerRepeatedFailures'],
      ['verification_failed', 'goalBlockerVerificationFailed'],
      ['planning_incomplete', 'goalBlockerPlanningIncomplete'],
      ['no_progress', 'goalBlockerNoProgress'],
      ['run_did_not_finish', 'goalBlockerRunDidNotFinish'],
      ['continuation_failed', 'goalBlockerContinuationFailed'],
      ['approval_timeout', 'goalBlockerApprovalTimeout'],
      ['approval_rejected', 'goalBlockerApprovalRejected'],
      ['ask_skipped', 'goalBlockerAskSkipped'],
    ]
    for (const [code, key] of codes) {
      expect(buildGoalCardViewModel(goal({ status: 'blocked', blocker: code })).blocker).toBe(key)
    }
    // The server's state-recovery path persists this fixed English sentence, not
    // a machine code, so the sentence itself is matched.
    expect(buildGoalCardViewModel(goal({
      status: 'blocked',
      blocker: 'Server restarted while the goal was in flight; resume to continue.',
    })).blocker).toBe('goalBlockerRestarted')

    // Unknown codes and free text keep the server string as-is.
    expect(buildGoalCardViewModel(goal({ status: 'blocked', blocker: 'missing_token' })).blocker).toBe('missing_token')
  })

  it('localizes the fixed budget-exhaustion hint and passes every other hint through', () => {
    const budgetHint = 'Budget exhausted. Use extend_resume to add the default budget to exhausted limits and continue this goal; accumulated usage and progress are preserved.'
    const view = buildGoalCardViewModel(goal({ status: 'paused', blocker: 'duration_budget', blockerHint: budgetHint }))
    expect(view.blocker).toBe('goalBlockerDurationBudget')
    expect(view.blockerHint).toBe('goalBlockerBudgetHint')

    // Any other server hint (legacy copy included) is shown verbatim.
    expect(buildGoalCardViewModel(goal({ status: 'paused', blockerHint: 'Budget exhausted. Cancel this goal and start a new one.' })).blockerHint)
      .toBe('Budget exhausted. Cancel this goal and start a new one.')
    expect(buildGoalCardViewModel(goal({ status: 'paused' })).blockerHint).toBe('')
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

describe('goal wiring in the chat host', () => {
  it('mounts the compact control strip in ChatPanelHost behind the goal capability with full cleanup', () => {
    expect(hostSource).toContain('createGoalControlStripController({')
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
    'goalCriterionPassed', 'goalCriterionFailed', 'goalCriterionNeedsReview',
    'goalObjectiveEmpty', 'goalCriteriaLabel', 'goalScopeLabel', 'goalBudgetLabel',
    'goalEvidenceLabel',
    'goalBlockerLabel', 'goalBlockerIterationBudget', 'goalBlockerDurationBudget',
    'goalBlockerPersistFailed', 'goalBlockerUserAborted', 'goalBlockerPlanningFailed',
    'goalBlockerRepeatedFailures', 'goalBlockerVerificationFailed', 'goalBlockerPlanningIncomplete',
    'goalBlockerNoProgress', 'goalBlockerRunDidNotFinish', 'goalBlockerContinuationFailed',
    'goalBlockerApprovalTimeout', 'goalBlockerApprovalRejected', 'goalBlockerAskSkipped',
    'goalBlockerRestarted', 'goalBlockerBudgetHint',
    'goalErrorActive', 'goalErrorSessionBusy', 'goalErrorBudgetExhausted', 'goalErrorRevisionConflict',
    'goalErrorBudgetNotExhausted', 'goalErrorObjectiveRequired', 'goalErrorActionInvalid',
    'goalErrorNotFound', 'goalErrorUnavailable', 'goalErrorSessionNotFound', 'goalErrorPersistFailed',
    'goalSummaryLabel', 'goalConfirm',
    'goalEditObjective', 'goalPause', 'goalResume', 'goalCancel',
    'goalActionFailed', 'goalUnavailable', 'goalConfirmNote', 'goalPauseCancelNote', 'goalResumeNote',
    'goalScopeChangeNote', 'goalAwaitingInputNote', 'goalAwaitingApprovalNote', 'goalPausingNote',
    'goalNeedsReviewContinueNote',
    'goalCompletedNote', 'goalFailedNote', 'goalCancelledNote',
    'goalOpenSummary', 'goalCancelConfirmTitle', 'goalCancelConfirmMessage',
    'goalKeepWorking', 'goalSaveObjective', 'goalUnsavedChanges', 'goalActionInProgress',
    'goalCriteriaProgress',
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

  it('styles the control strip as a minimal in-flow row reusing the goal tone tokens', () => {
    const block = css.slice(css.indexOf('/* Goal control strip'), css.indexOf('/* Goal 报告工具卡'))
    const rootRule = block.match(/\.quickforge-goal-strip\s*\{[^}]*\}/)?.[0] ?? ''
    // The strip hugs its content (capped at the composer width) instead of
    // stretching across the whole composer shell.
    expect(rootRule).toMatch(/width:\s*fit-content/)
    expect(rootRule).toMatch(/max-width:\s*100%/)
    // Auto side margins center the fit-content row under the composer.
    expect(rootRule).toMatch(/margin:\s*0\s+auto\s+0\.375rem/)
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
