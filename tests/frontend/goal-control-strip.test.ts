// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildGoalControlStripView } from '@/components/chat/panel-decoration/goal-control-strip'
import { GoalControlStrip } from '@/components/chat/surface/GoalControlStrip'
import type { GoalAction, GoalState } from '@/lib/goal'

/**
 * The goal control strip used to be a controller that built the row by hand,
 * hand-ordered its children on every paint (`desired[]` diff), restored focus
 * after removing the action button and re-subscribed to the goal-ui store per
 * session/goal. React renders it now:
 * - `buildGoalControlStripView` (still pure) decides what to show;
 * - edit mode / cancel confirmation are component state;
 * - the goal-ui subscription is an effect keyed by session + goal.
 *
 * These cases keep the view-projection coverage and replace the DOM-controller
 * assertions with render-level ones.
 */

vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}))

const goalUi = vi.hoisted(() => ({
  state: { pending: false, dirty: false, error: null as string | null },
  listeners: new Set<() => void>(),
  openSummary: [] as Array<{ sessionId: string; goalId: string; view: string }>,
  actions: [] as Array<{ action: GoalAction; execute: () => Promise<unknown> }>,
  setState(patch: Partial<{ pending: boolean; dirty: boolean; error: string | null }>) {
    Object.assign(this.state, patch)
    for (const listener of [...this.listeners]) listener()
  },
  reset() {
    this.state = { pending: false, dirty: false, error: null }
    this.listeners.clear()
    this.openSummary.length = 0
    this.actions.length = 0
  },
}))

vi.mock('@/lib/goal-ui', () => ({
  getGoalUiState: () => ({ ...goalUi.state, draft: null }),
  subscribeGoalUi: (_sessionId: string, _goalId: string, listener: () => void) => {
    goalUi.listeners.add(listener)
    return () => goalUi.listeners.delete(listener)
  },
  requestOpenGoalSummary: (sessionId: string, goalId: string, view: string) => {
    goalUi.openSummary.push({ sessionId, goalId, view })
  },
  runGoalUiAction: async (_sessionId: string, _goalId: string, action: GoalAction, execute: () => Promise<unknown>) => {
    goalUi.actions.push({ action, execute })
    goalUi.setState({ pending: true })
    try {
      await execute()
      goalUi.setState({ pending: false, error: null })
    } catch (error) {
      goalUi.setState({ pending: false, error: error instanceof Error && error.message ? error.message : 'goalActionFailed' })
    }
  },
}))

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

describe('buildGoalControlStripView', () => {
  it('maps only pause/resume onto icons and hides terminal goals', () => {
    expect(buildGoalControlStripView(goal({ status: 'running' }))).toMatchObject({
      statusKey: 'goalStatusRunning',
      primaryAction: 'pause',
      spinning: true,
    })
    expect(buildGoalControlStripView(goal({ status: 'verifying' }))).toMatchObject({
      statusKey: 'goalStatusVerifying',
      primaryAction: 'pause',
    })
    expect(buildGoalControlStripView(goal({ status: 'planning' }))).toMatchObject({
      statusKey: 'goalStatusPlanning',
      primaryAction: 'none',
      spinning: false,
    })
    expect(buildGoalControlStripView(goal({ status: 'pausing' }))).toMatchObject({
      statusKey: 'goalStatusPausing',
      primaryAction: 'pause',
      spinning: true,
    })
    expect(buildGoalControlStripView(goal({ status: 'paused' }))).toMatchObject({ primaryAction: 'resume' })
    for (const status of ['blocked', 'needs_review', 'awaiting_confirmation', 'awaiting_input', 'awaiting_approval'] as const) {
      expect(buildGoalControlStripView(goal({ status }))).toMatchObject({ primaryAction: 'none' })
    }
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      expect(buildGoalControlStripView(goal({ status }))).toBeNull()
    }
  })

  it('projects Goal v2 phase, activation, runtime, round text and inline editable', () => {
    const active = buildGoalControlStripView(goal({
      status: 'running',
      phase: 'active',
      activation: 'armed',
      runtime: 'executing',
      maxRounds: 20,
      roundsStarted: 3,
    }))
    expect(active).toMatchObject({
      statusKey: 'goalPhaseActive',
      roundText: '3/20',
      objective: 'Ship the goal UI',
      primaryAction: 'pause',
      phase: 'active',
      activation: 'armed',
      inlineEditable: true,
    })

    const interrupted = buildGoalControlStripView(goal({
      status: 'paused',
      phase: 'active',
      activation: 'disarmed',
      runtime: 'idle',
    }))
    expect(interrupted).toMatchObject({ statusKey: 'goalPhaseInterrupted', primaryAction: 'resume', inlineEditable: true })

    expect(buildGoalControlStripView(goal({
      status: 'planning',
      phase: 'active',
      activation: 'armed',
      runtime: 'planning',
    }))).toMatchObject({ statusKey: 'goalPhasePlanning' })

    expect(buildGoalControlStripView(goal({
      status: 'blocked',
      phase: 'blocked',
      activation: 'disarmed',
      runtime: 'idle',
    }))).toMatchObject({ statusKey: 'goalPhaseBlocked', primaryAction: 'resume' })

    expect(buildGoalControlStripView(goal({ status: 'completed', phase: 'complete' }))).toBeNull()
  })

  it('legacy goals are not inline editable (must pause first)', () => {
    expect(buildGoalControlStripView(goal({ status: 'paused' }))).toMatchObject({ inlineEditable: false })
  })
})

describe('goal control strip rendering', () => {
  let container: HTMLDivElement
  let root: Root
  let onAction: ReturnType<typeof vi.fn>

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    goalUi.reset()
    onAction = vi.fn(async () => undefined)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(current: GoalState | null, enabled = true) {
    act(() => {
      root.render(createElement(GoalControlStrip, {
        sessionId: 'session-1',
        goal: current,
        enabled,
        onAction: onAction as never,
      }))
    })
  }

  const strip = () => container.querySelector<HTMLElement>('.quickforge-goal-strip')
  const q = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector)

  it('renders a single row with status, objective and the primary action', () => {
    render(goal({ status: 'running' }))

    expect(strip()).not.toBeNull()
    expect(strip()!.tagName).toBe('SECTION')
    expect(strip()!.dataset.status).toBe('running')
    expect(strip()!.getAttribute('aria-label')).toBe('goalTitle')
    expect(q('.quickforge-goal-strip-action--pause')).not.toBeNull()
  })

  it('shows the objective inline for v2 goals', () => {
    render(goal({ status: 'running', phase: 'active', activation: 'armed', runtime: 'executing', maxRounds: 12, roundsStarted: 4 }))

    const objective = q('.quickforge-goal-strip-objective')!
    expect(objective.textContent).toBe('Ship the goal UI')
    expect(objective.title).toBe('Ship the goal UI')
    expect(q('.quickforge-goal-strip-label')!.textContent).toContain('4/12')
    expect(strip()!.dataset.editing).toBe('false')
  })

  it('shows the edit button for v2 goals but not legacy', () => {
    render(goal({ status: 'running', phase: 'active', activation: 'armed', runtime: 'executing' }))
    expect(q<HTMLButtonElement>('.quickforge-goal-strip-action--edit')!.disabled).toBe(false)

    render(goal({ status: 'paused' }))
    // Legacy goals must pause first, so the edit action is disabled.
    expect(q<HTMLButtonElement>('.quickforge-goal-strip-action--edit')!.disabled).toBe(true)
  })

  it('enters edit mode on edit click, swapping the objective for a focused input', () => {
    render(goal({ status: 'running', phase: 'active', activation: 'armed', runtime: 'executing' }))

    act(() => { q<HTMLButtonElement>('.quickforge-goal-strip-action--edit')!.click() })

    expect(strip()!.dataset.editing).toBe('true')
    const input = q<HTMLInputElement>('.quickforge-goal-strip-edit-input')!
    expect(input.value).toBe('Ship the goal UI')
    expect(document.activeElement).toBe(input)
    expect(q('.quickforge-goal-strip-objective')).toBeNull()
    expect(q('.quickforge-goal-strip-action--save')).not.toBeNull()
    expect(q('.quickforge-goal-strip-action--edit-cancel')).not.toBeNull()
  })

  it('saves the edited objective through the shared revise action', async () => {
    render(goal({ status: 'running', phase: 'active', activation: 'armed', runtime: 'executing' }))
    act(() => { q<HTMLButtonElement>('.quickforge-goal-strip-action--edit')!.click() })

    const input = q<HTMLInputElement>('.quickforge-goal-strip-edit-input')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'Ship the improved goal UI')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      q<HTMLButtonElement>('.quickforge-goal-strip-action--save')!.click()
      await Promise.resolve()
    })

    expect(goalUi.actions.at(-1)?.action).toBe('revise')
    expect(onAction).toHaveBeenCalledWith('revise', 'Ship the improved goal UI')
    // A successful revise leaves edit mode.
    expect(strip()!.dataset.editing).toBe('false')
  })

  it('cancel editing exits without dispatching an action', () => {
    render(goal({ status: 'running', phase: 'active', activation: 'armed', runtime: 'executing' }))
    act(() => { q<HTMLButtonElement>('.quickforge-goal-strip-action--edit')!.click() })

    act(() => { q<HTMLButtonElement>('.quickforge-goal-strip-action--edit-cancel')!.click() })

    expect(strip()!.dataset.editing).toBe('false')
    expect(q('.quickforge-goal-strip-objective')).not.toBeNull()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('Escape in the edit input exits edit mode', () => {
    render(goal({ status: 'running', phase: 'active', activation: 'armed', runtime: 'executing' }))
    act(() => { q<HTMLButtonElement>('.quickforge-goal-strip-action--edit')!.click() })

    const input = q<HTMLInputElement>('.quickforge-goal-strip-edit-input')!
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(strip()!.dataset.editing).toBe('false')
  })

  it('renders nothing for a missing, terminal, or gated goal', () => {
    render(goal({ status: 'running' }))
    expect(strip()).not.toBeNull()

    render(goal({ status: 'completed' }))
    expect(strip()).toBeNull()

    render(goal({ status: 'running' }), false)
    expect(strip()).toBeNull()

    render(null)
    expect(strip()).toBeNull()
  })

  it('shows pause only while running/verifying and disables it while pausing', () => {
    render(goal({ status: 'running' }))
    expect(q('.quickforge-goal-strip-action--pause')).not.toBeNull()

    render(goal({ status: 'pausing' }))
    expect(q<HTMLButtonElement>('.quickforge-goal-strip-action--pause')!.disabled).toBe(true)

    for (const status of ['paused', 'blocked', 'planning', 'awaiting_input'] as const) {
      render(goal({ status }))
      expect(q('.quickforge-goal-strip-action--pause')).toBeNull()
    }
  })

  it('runs the primary action through the shared wrapper and surfaces the failure', async () => {
    render(goal({ status: 'running' }))
    await act(async () => {
      q<HTMLButtonElement>('.quickforge-goal-strip-action--pause')!.click()
      await Promise.resolve()
    })
    expect(goalUi.actions).toHaveLength(1)
    expect(onAction).toHaveBeenCalledWith('pause')

    // A rejecting action is recorded by the shared wrapper and rendered inline.
    onAction.mockRejectedValueOnce(new Error('goalActionFailed'))
    await act(async () => {
      q<HTMLButtonElement>('.quickforge-goal-strip-action--pause')!.click()
      await Promise.resolve()
    })
    expect(goalUi.actions).toHaveLength(2)
    expect(q('.quickforge-goal-strip-error')!.textContent).toBe('goalActionFailed')
  })

  it('asks for confirmation before dispatching cancel', async () => {
    render(goal({ status: 'running' }))
    const buttons = () => container.querySelectorAll('.quickforge-goal-strip button').length
    const before = buttons()

    act(() => { q<HTMLButtonElement>('.quickforge-goal-strip-action:not([class*="--"])')!.click() })

    // The confirmation group (note + confirm + keep) adds nodes and nothing is
    // dispatched yet.
    expect(buttons()).toBeGreaterThan(before)
    expect(q('.quickforge-goal-strip-cancel-note')).not.toBeNull()
    expect(onAction).not.toHaveBeenCalled()

    await act(async () => {
      q<HTMLButtonElement>('.quickforge-goal-strip-confirm')!.click()
      await Promise.resolve()
    })
    expect(onAction).toHaveBeenCalledWith('cancel')
  })

  it('dismisses the confirmation with Escape without dispatching', () => {
    render(goal({ status: 'running' }))
    act(() => { q<HTMLButtonElement>('.quickforge-goal-strip-action:not([class*="--"])')!.click() })
    expect(q('.quickforge-goal-strip-cancel-note')).not.toBeNull()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(q('.quickforge-goal-strip-cancel-note')).toBeNull()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('opens the summary from the open button', () => {
    render(goal({ status: 'paused' }))
    act(() => { q<HTMLButtonElement>('.quickforge-goal-strip-action--open')!.click() })

    expect(goalUi.openSummary).toEqual([{ sessionId: 'session-1', goalId: 'goal-1', view: 'progress' }])
  })

  it('blocks resume while a draft is dirty and explains why', () => {
    render(goal({ status: 'paused' }))
    act(() => { goalUi.setState({ dirty: true }) })

    const resume = q<HTMLButtonElement>('.quickforge-goal-strip-action--resume')!
    expect(resume.disabled).toBe(true)
    expect(resume.title).toBe('goalUnsavedChanges')
  })

  it('drops the transient edit/confirm modes when the goal changes', () => {
    render(goal({ status: 'running', phase: 'active', activation: 'armed', runtime: 'executing' }))
    act(() => { q<HTMLButtonElement>('.quickforge-goal-strip-action--edit')!.click() })
    expect(strip()!.dataset.editing).toBe('true')

    render(goal({ id: 'goal-2', status: 'running', phase: 'active', activation: 'armed', runtime: 'executing' }))

    // A different goal must not inherit the previous draft/confirmation.
    expect(strip()!.dataset.editing).toBe('false')
  })
})
