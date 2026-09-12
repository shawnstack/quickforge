import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoalAction, GoalState } from '../../src/lib/goal'
import { buildGoalControlStripView, createGoalControlStripController } from '../../src/components/chat/panel-decoration/goal-control-strip'

// The strip only needs t() at render time. Appending the params keeps the
// tests assertable on the values the row actually renders (e.g. the recorded
// duration seconds) while still showing the i18n key.
vi.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}))

// ---------------------------------------------------------------------------
// Minimal fake DOM. The controller is a real DOM controller; these tests drive
// it through an in-memory element tree instead of asserting on source strings.
// ---------------------------------------------------------------------------

type FakeEvent = {
  key?: string
  preventDefault: () => void
  stopPropagation: () => void
}
type FakeListener = (event: FakeEvent) => void

class FakeElement {
  tagName: string
  className = ''
  dataset: Record<string, string> = {}
  innerHTML = ''
  type = ''
  disabled = false
  title = ''
  hidden = false
  parentElement: FakeElement | null = null
  children: FakeElement[] = []
  queryMap = new Map<string, FakeElement>()
  /** Repaint churn detector: how often `textContent` was assigned. */
  textContentSets = 0
  private textValue = ''
  private attributes = new Map<string, string>()
  private listeners = new Map<string, FakeListener[]>()

  constructor(tagName: string) {
    this.tagName = tagName
  }

  get textContent(): string {
    return this.textValue
  }

  set textContent(value: string) {
    this.textValue = value
    this.textContentSets++
  }

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null
  }

  get nextElementSibling(): FakeElement | null {
    if (!this.parentElement) return null
    return this.parentElement.children[this.parentElement.children.indexOf(this) + 1] ?? null
  }

  classList = {
    contains: (name: string) => this.className.split(/\s+/).includes(name),
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parentElement = this
      this.children.push(node)
    }
  }

  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.parentElement = null
    this.children = []
    this.append(...nodes)
  }

  insertBefore(node: FakeElement, reference: FakeElement | null): void {
    node.remove()
    node.parentElement = this
    if (!reference) {
      this.children.push(node)
      return
    }
    const index = this.children.indexOf(reference)
    if (index < 0) this.children.push(node)
    else this.children.splice(index, 0, node)
  }

  remove(): void {
    const parent = this.parentElement
    if (!parent) return
    const index = parent.children.indexOf(this)
    if (index >= 0) parent.children.splice(index, 1)
    this.parentElement = null
  }

  addEventListener(type: string, listener: FakeListener): void {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  dispatch(type: string, event: Partial<FakeEvent> = {}): void {
    const full: FakeEvent = { preventDefault: () => {}, stopPropagation: () => {}, ...event }
    for (const listener of this.listeners.get(type) ?? []) listener(full)
  }

  click(): void {
    this.dispatch('click')
  }

  focus(): void {
    setActiveElement(this)
  }

  querySelector(selector: string): FakeElement | null {
    return this.queryMap.get(selector) ?? null
  }
}

/** The stubbed `document.activeElement`; `FakeElement.focus()` points it here. */
function setActiveElement(element: FakeElement | null): void {
  const doc = globalThis.document as unknown as { activeElement: FakeElement | null }
  doc.activeElement = element
}

function activeElement(): FakeElement | null {
  return (globalThis.document as unknown as { activeElement: FakeElement | null }).activeElement
}

function collect(root: FakeElement, predicate: (element: FakeElement) => boolean, out: FakeElement[] = []): FakeElement[] {
  if (predicate(root)) out.push(root)
  for (const child of root.children) collect(child, predicate, out)
  return out
}

function byClass(root: FakeElement, className: string): FakeElement | undefined {
  return collect(root, (element) => element.className.split(/\s+/).includes(className))[0]
}

function actionButton(root: FakeElement, kind: 'pause' | 'resume' | 'open'): FakeElement | undefined {
  return collect(root, (element) => element.className.includes(`quickforge-goal-strip-action--${kind}`))[0]
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

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

type FakeUiState = { pending: boolean; dirty: boolean; error: string | null }

/**
 * Stand-in for the shared goal-ui module. It mirrors the contract the strip
 * consumes (lock + dirty + error + summary request) without re-implementing the
 * production lock, so the tests drive the strip through controllable state.
 */
function createFakeGoalUi() {
  const states = new Map<string, FakeUiState>()
  const listeners = new Map<string, Set<() => void>>()
  const key = (sessionId: string, goalId: string) => `${sessionId}::${goalId}`

  const stateFor = (sessionId: string, goalId: string): FakeUiState => {
    let entry = states.get(key(sessionId, goalId))
    if (!entry) {
      entry = { pending: false, dirty: false, error: null }
      states.set(key(sessionId, goalId), entry)
    }
    return entry
  }
  const notify = (sessionId: string, goalId: string) => {
    for (const listener of [...(listeners.get(key(sessionId, goalId)) ?? [])]) listener()
  }

  return {
    requestOpenGoalSummary: vi.fn(() => undefined),
    getGoalUiState: (sessionId: string, goalId: string): FakeUiState => ({ ...stateFor(sessionId, goalId) }),
    subscribeGoalUi: vi.fn((sessionId: string, goalId: string, listener: () => void) => {
      const id = key(sessionId, goalId)
      const set = listeners.get(id) ?? new Set<() => void>()
      set.add(listener)
      listeners.set(id, set)
      return () => { set.delete(listener) }
    }),
    runGoalUiAction: vi.fn(async (
      sessionId: string,
      goalId: string,
      _action: GoalAction,
      execute: () => Promise<unknown>,
    ) => {
      const entry = stateFor(sessionId, goalId)
      entry.pending = true
      notify(sessionId, goalId)
      try {
        await execute()
        entry.pending = false
        entry.error = null
      } catch (error) {
        entry.pending = false
        entry.error = error instanceof Error && error.message ? error.message : 'goalActionFailed'
      }
      notify(sessionId, goalId)
    }),
    // --- test controls -----------------------------------------------------
    setState: (sessionId: string, goalId: string, patch: Partial<FakeUiState>) => {
      Object.assign(stateFor(sessionId, goalId), patch)
      notify(sessionId, goalId)
    },
    listenerCount: (sessionId: string, goalId: string) => listeners.get(key(sessionId, goalId))?.size ?? 0,
  }
}

function setup(initial: Partial<GoalState> = {}) {
  const panel = new FakeElement('div')
  const editor = new FakeElement('message-editor')
  const textarea = new FakeElement('textarea')
  editor.append(textarea)
  editor.queryMap.set('textarea', textarea)
  const composerShell = new FakeElement('div')
  composerShell.append(editor)
  panel.queryMap.set('message-editor', editor)

  const state = { goal: goal(initial) as GoalState | null, sessionId: 'session-1' }
  const goalUi = createFakeGoalUi()

  let mode: 'auto' | 'deferred' | 'reject' = 'auto'
  let deferred: { resolve: () => void; reject: (error: unknown) => void } | null = null

  const onAction = vi.fn(async (action: GoalAction, objective?: string) => {
    void action
    void objective
    if (mode === 'deferred') {
      await new Promise<void>((resolve, reject) => { deferred = { resolve, reject } })
    }
    if (mode === 'reject') throw new Error('goalActionFailed')
  })

  const controller = createGoalControlStripController({
    panel: panel as unknown as HTMLElement,
    getGoal: () => state.goal,
    getSessionId: () => state.sessionId,
    goalUi,
    onAction,
  })

  return {
    panel,
    composerShell,
    editor,
    textarea,
    state,
    goalUi,
    onAction,
    controller,
    root: () => composerShell.children.find((child) => child.className.includes('quickforge-goal-strip')) ?? null,
    setMode: (next: 'auto' | 'deferred' | 'reject') => {
      mode = next
      deferred = null
    },
    getDeferred: () => deferred,
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
      // The checklist icon for planning stays still; only busy states spin.
      spinning: false,
    })
    // `pausing` keeps the pause affordance so it can render it disabled.
    expect(buildGoalControlStripView(goal({ status: 'pausing' }))).toMatchObject({
      statusKey: 'goalStatusPausing',
      primaryAction: 'pause',
      spinning: true,
    })
    expect(buildGoalControlStripView(goal({ status: 'paused' }))).toMatchObject({ primaryAction: 'resume' })

    // goalCanResume() is true for all three, but only a genuinely paused goal
    // gets a resume icon; the rest only open the summary.
    for (const status of ['blocked', 'needs_review', 'awaiting_confirmation', 'awaiting_input', 'awaiting_approval'] as const) {
      expect(buildGoalControlStripView(goal({ status }))).toMatchObject({ primaryAction: 'none' })
    }

    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      expect(buildGoalControlStripView(goal({ status }))).toBeNull()
    }
  })
})

describe('goal control strip DOM controller', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: (tagName: string) => new FakeElement(tagName),
      activeElement: null as FakeElement | null,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('contains Escape in cancel confirmation and restores trigger focus', () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    const root = s.root()!
    const cancel = collect(root, (element) => element.getAttribute('aria-label') === 'goalCancel')[0]
    cancel.click()
    const keep = collect(root, (element) => element.getAttribute('aria-label') === 'goalKeepWorking')[0]
    expect(document.activeElement).toBe(keep)
    const stopPropagation = vi.fn()
    const preventDefault = vi.fn()
    root.dispatch('keydown', { key: 'Escape', stopPropagation, preventDefault })
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(cancel)
    expect(s.onAction).not.toHaveBeenCalled()
    s.controller.cleanup()
  })

  it('mounts a compact single row directly above the composer editor', () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    const root = s.root()
    expect(root).toBeTruthy()
    expect(root!.tagName).toBe('section')
    expect(s.composerShell.children).toEqual([root, s.editor])
    expect(root!.nextElementSibling).toBe(s.editor)
    expect(root!.dataset.status).toBe('running')
    expect(root!.getAttribute('aria-label')).toBe('goalTitle')

    expect(byClass(root!, 'quickforge-goal-strip-label')!.textContent).toBe('goalStatusRunning')
    expect(byClass(root!, 'quickforge-goal-strip-icon')).toBeTruthy()
    // C-02: the objective text never returns to the strip; the summary owns it.
    expect(byClass(root!, 'quickforge-goal-strip-objective')).toBeUndefined()
    // Exactly the two allowed icon buttons: pause + open summary.
    const buttons = collect(root!, (element) => element.tagName === 'button')
    expect(buttons).toHaveLength(3)
    expect(actionButton(root!, 'pause')!.disabled).toBe(false)
    expect(actionButton(root!, 'open')).toBeTruthy()

    // A second update must not duplicate or move the row.
    s.controller.update()
    expect(s.composerShell.children.filter((child) => child.className.includes('quickforge-goal-strip'))).toHaveLength(1)
    expect(s.composerShell.children).toEqual([root, s.editor])
  })

  it('shows the checklist icon for planning and awaiting confirmation', () => {
    const s = setup({ status: 'planning' })
    s.controller.update()
    const icon = byClass(s.root()!, 'quickforge-goal-strip-icon')!
    // A plan in progress (or waiting for its confirmation) reads as a
    // checklist, not as the generic info circle.
    expect(icon.innerHTML).toContain('<rect x="3" y="5" width="6" height="6" rx="1"/>')
    expect(icon.innerHTML).toContain('<path d="m3 17 2 2 4-4"/>')
    expect(icon.innerHTML).not.toContain('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/>')

    s.state.goal = goal({ status: 'awaiting_confirmation' })
    s.controller.update()
    expect(byClass(s.root()!, 'quickforge-goal-strip-icon')!.innerHTML).toContain('<rect x="3" y="5" width="6" height="6" rx="1"/>')

    // Running keeps the clock-style active icon.
    s.state.goal = goal({ status: 'running' })
    s.controller.update()
    expect(byClass(s.root()!, 'quickforge-goal-strip-icon')!.innerHTML).not.toContain('<rect x="3" y="5" width="6" height="6" rx="1"/>')
  })

  it('keeps the row directly above the editor behind a queued-message anchor', () => {
    const s = setup({ status: 'running' })
    const queue = new FakeElement('section')
    queue.className = 'quickforge-msg-queue'
    s.composerShell.insertBefore(queue, s.editor)
    s.controller.update()
    expect(s.composerShell.children).toEqual([queue, s.root(), s.editor])
  })

  it('keeps the row above the suggestion menu that sits adjacent to the editor', () => {
    const s = setup({ status: 'running' })
    const menu = new FakeElement('div')
    menu.className = 'quickforge-command-suggestions'
    s.composerShell.insertBefore(menu, s.editor)
    s.controller.update()
    expect(s.composerShell.children).toEqual([s.root(), menu, s.editor])

    // Controller updates must not move the strip between the menu and editor.
    s.controller.update()
    expect(s.composerShell.children).toEqual([s.root(), menu, s.editor])
  })

  it('hides for a missing, terminal or gated goal', () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    expect(s.root()).toBeTruthy()

    s.state.goal = null
    s.controller.update()
    expect(s.root()).toBeNull()

    s.state.goal = goal({ status: 'completed' })
    s.controller.update()
    expect(s.root()).toBeNull()

    s.state.goal = goal({ status: 'running' })
    s.controller.update()
    expect(s.root()).toBeTruthy()
    s.controller.cleanup()
    expect(s.root()).toBeNull()

    // Capability gate (Side Chat / shared / read-only / ACP).
    const gated = setup({ status: 'running' })
    const strip = createGoalControlStripController({
      panel: gated.panel as unknown as HTMLElement,
      getGoal: () => gated.state.goal,
      getSessionId: () => gated.state.sessionId,
      enabled: () => false,
      goalUi: gated.goalUi,
      onAction: gated.onAction,
    })
    strip.update()
    expect(gated.root()).toBeNull()
    strip.cleanup()
  })

  it('shows pause only while running/verifying and disables it while pausing', () => {
    const verifying = setup({ status: 'verifying' })
    verifying.controller.update()
    expect(actionButton(verifying.root()!, 'pause')!.disabled).toBe(false)
    expect(byClass(verifying.root()!, 'quickforge-goal-strip-label')!.textContent).toBe('goalStatusVerifying')

    const pausing = setup({ status: 'pausing' })
    pausing.controller.update()
    const pause = actionButton(pausing.root()!, 'pause')!
    expect(pause.disabled).toBe(true)
    expect(pause.title).toBe('goalStatusPausing')
    expect(actionButton(pausing.root()!, 'resume')).toBeUndefined()
  })

  it('only navigates to budget confirmation when paused budget is exhausted', () => {
    const s = setup({ status: 'paused', usage: { iterations: 999, activeDurationMs: 0 } })
    s.controller.update()
    actionButton(s.root()!, 'resume')!.click()
    // The budget confirmation group only renders in the Inspector progress
    // view; the wiki contract keeps this entry pointing there, never at edit.
    expect(s.goalUi.requestOpenGoalSummary).toHaveBeenCalledWith('session-1', 'goal-1', 'progress')
    expect(s.goalUi.runGoalUiAction).not.toHaveBeenCalled()
    expect(s.onAction).not.toHaveBeenCalled()
    s.controller.cleanup()
  })

  it('formats the recorded duration in minutes past the first minute and in seconds below it', () => {
    const s = setup({ status: 'running', usage: { iterations: 4, activeDurationMs: 61 * 60_000 } })
    s.controller.update()
    expect(byClass(s.root()!, 'quickforge-goal-strip-duration')!.textContent).toBe('goalRecordedDurationMinutes {"minutes":61}')
    // Exactly one minute still reads as a minute, not "60 seconds".
    s.state.goal = goal({ status: 'running', usage: { iterations: 4, activeDurationMs: 60_000 } })
    s.controller.update()
    expect(byClass(s.root()!, 'quickforge-goal-strip-duration')!.textContent).toBe('goalRecordedDurationMinutes {"minutes":1}')
    s.state.goal = goal({ status: 'running', usage: { iterations: 4, activeDurationMs: 59_000 } })
    s.controller.update()
    expect(byClass(s.root()!, 'quickforge-goal-strip-duration')!.textContent).toBe('goalRecordedDuration {"seconds":59}')
  })

  it('advances the recorded duration every second while the goal is active', () => {
    vi.useFakeTimers()
    try {
      // The server settles usage.activeDurationMs only per run: a planning
      // round reports 0, so the strip must interpolate locally.
      const s = setup({ status: 'planning', usage: { iterations: 0, activeDurationMs: 0 } })
      s.controller.update()
      const duration = byClass(s.root()!, 'quickforge-goal-strip-duration')!
      expect(duration.textContent).toBe('goalRecordedDuration {"seconds":0}')
      expect(vi.getTimerCount()).toBe(1)

      vi.advanceTimersByTime(2_000)
      expect(duration.textContent).toBe('goalRecordedDuration {"seconds":2}')

      // A fresh snapshot re-anchors the interpolation; the ticker continues
      // from the new server value (59s + 1s crosses into the first minute).
      s.state.goal = goal({ status: 'running', revision: 4, usage: { iterations: 1, activeDurationMs: 59_000 } })
      s.controller.update()
      expect(duration.textContent).toBe('goalRecordedDuration {"seconds":59}')
      vi.advanceTimersByTime(1_000)
      expect(duration.textContent).toBe('goalRecordedDurationMinutes {"minutes":1}')

      // Removing the goal or ending it clears the ticker with the row.
      s.state.goal = null
      s.controller.update()
      expect(s.root()).toBeNull()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the duration ticker when the goal turns terminal or the strip is cleaned up', () => {
    vi.useFakeTimers()
    try {
      const s = setup({ status: 'running', usage: { iterations: 4, activeDurationMs: 300_000 } })
      s.controller.update()
      const duration = byClass(s.root()!, 'quickforge-goal-strip-duration')!
      expect(vi.getTimerCount()).toBe(1)

      s.state.goal = goal({ status: 'completed', usage: { iterations: 4, activeDurationMs: 300_000 } })
      s.controller.update()
      expect(s.root()).toBeNull()
      expect(vi.getTimerCount()).toBe(0)

      // A fresh active row starts exactly one new ticker; cleanup releases it.
      s.state.goal = goal({ status: 'running', usage: { iterations: 4, activeDurationMs: 300_000 } })
      s.controller.update()
      expect(vi.getTimerCount()).toBe(1)
      s.controller.cleanup()
      expect(vi.getTimerCount()).toBe(0)
      expect(duration.textContent).toBe('goalRecordedDurationMinutes {"minutes":5}')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the inline cancel confirmation to a single sentence', () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    const root = s.root()!
    collect(root, (element) => element.getAttribute('aria-label') === 'goalCancel')[0].click()
    const note = byClass(root, 'quickforge-goal-strip-cancel-note')!
    expect(note.textContent).toBe('goalCancelConfirmMessage')
    // The "Cancel this goal?" question stays on the button, not the note.
    expect(note.textContent).not.toContain('goalCancelConfirmTitle')
    s.controller.cleanup()
  })

  it('offers resume only for a paused goal and keeps the summary open everywhere', () => {
    const paused = setup({ status: 'paused' })
    paused.controller.update()
    expect(actionButton(paused.root()!, 'resume')!.disabled).toBe(false)
    expect(actionButton(paused.root()!, 'pause')).toBeUndefined()

    for (const status of ['blocked', 'needs_review', 'awaiting_input', 'awaiting_approval', 'awaiting_confirmation'] as const) {
      const s = setup({ status })
      s.controller.update()
      expect(actionButton(s.root()!, 'pause')).toBeUndefined()
      expect(actionButton(s.root()!, 'resume')).toBeUndefined()
      expect(actionButton(s.root()!, 'open')!.disabled).toBe(false)
    }
  })

  it('disables pause/resume while the shared state is pending or dirty but keeps the summary open', () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    const pause = actionButton(s.root()!, 'pause')!
    const open = actionButton(s.root()!, 'open')!
    expect(pause.disabled).toBe(false)

    // The dirty/pending repaint mutates the same nodes: nothing is rebuilt.
    s.goalUi.setState('session-1', 'goal-1', { dirty: true })
    expect(actionButton(s.root()!, 'pause')).toBe(pause)
    expect(pause.disabled).toBe(false)
    expect(pause.title).toBe('goalPause')
    expect(actionButton(s.root()!, 'open')).toBe(open)
    expect(open.disabled).toBe(false)

    s.goalUi.setState('session-1', 'goal-1', { dirty: false, pending: true })
    expect(actionButton(s.root()!, 'pause')).toBe(pause)
    expect(pause.disabled).toBe(true)
    expect(pause.title).toBe('goalActionInProgress')
    expect(actionButton(s.root()!, 'open')).toBe(open)
    expect(open.disabled).toBe(false)
  })

  it('keeps the focused pause button node across a pending → paused repaint', () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    const pause = actionButton(s.root()!, 'pause')!
    pause.focus()
    expect(activeElement()).toBe(pause)

    // Pending: the same node is disabled in place, so keyboard focus stays put.
    s.goalUi.setState('session-1', 'goal-1', { pending: true })
    expect(actionButton(s.root()!, 'pause')).toBe(pause)
    expect(pause.disabled).toBe(true)
    expect(pause.title).toBe('goalActionInProgress')
    expect(activeElement()).toBe(pause)

    // The pause settles: the node is reused as the resume affordance.
    s.goalUi.setState('session-1', 'goal-1', { pending: false })
    s.state.goal = goal({ status: 'paused' })
    s.controller.update()
    expect(actionButton(s.root()!, 'resume')).toBe(pause)
    expect(actionButton(s.root()!, 'pause')).toBeUndefined()
    expect(pause.disabled).toBe(false)
    expect(activeElement()).toBe(pause)
  })

  it('never rebuilds the summary entry or the short error alert', () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    const open = actionButton(s.root()!, 'open')!
    const label = byClass(s.root()!, 'quickforge-goal-strip-label')!

    s.goalUi.setState('session-1', 'goal-1', { dirty: true })
    expect(actionButton(s.root()!, 'open')).toBe(open)
    expect(byClass(s.root()!, 'quickforge-goal-strip-label')).toBe(label)

    s.goalUi.setState('session-1', 'goal-1', { dirty: false, error: 'Tool failed' })
    const alert = collect(s.root()!, (element) => element.getAttribute('role') === 'alert')[0]!
    expect(alert.textContent).toBe('Tool failed')
    expect(actionButton(s.root()!, 'open')).toBe(open)

    // A new error text updates the alert in place instead of remounting it.
    s.goalUi.setState('session-1', 'goal-1', { error: 'Tool failed twice' })
    expect(collect(s.root()!, (element) => element.getAttribute('role') === 'alert')).toEqual([alert])
    expect(alert.textContent).toBe('Tool failed twice')
    expect(actionButton(s.root()!, 'open')).toBe(open)

    // Clearing the error removes only the alert.
    s.goalUi.setState('session-1', 'goal-1', { error: null })
    expect(collect(s.root()!, (element) => element.getAttribute('role') === 'alert')).toHaveLength(0)
    expect(actionButton(s.root()!, 'open')).toBe(open)
    expect(byClass(s.root()!, 'quickforge-goal-strip-label')).toBe(label)
  })

  it('does not rewrite the status label when only the revision changes', () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    const label = byClass(s.root()!, 'quickforge-goal-strip-label')!
    expect(label.textContent).toBe('goalStatusRunning')
    const sets = label.textContentSets

    // A progress tick (new revision, same status) must not retrigger the
    // aria-live region with the same text.
    s.state.goal = goal({ status: 'running', revision: 4 })
    s.controller.update()
    expect(byClass(s.root()!, 'quickforge-goal-strip-label')).toBe(label)
    expect(label.textContentSets).toBe(sets)

    // A real status change still updates the text exactly once.
    s.state.goal = goal({ status: 'verifying', revision: 5 })
    s.controller.update()
    expect(label.textContent).toBe('goalStatusVerifying')
    expect(label.textContentSets).toBe(sets + 1)
  })

  it('hands focus to the summary entry when the primary action disappears', () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    const pause = actionButton(s.root()!, 'pause')!
    const open = actionButton(s.root()!, 'open')!
    pause.focus()

    // The goal blocked: no pause/resume is offered any more.
    s.state.goal = goal({ status: 'blocked' })
    s.controller.update()
    expect(actionButton(s.root()!, 'pause')).toBeUndefined()
    expect(actionButton(s.root()!, 'resume')).toBeUndefined()
    expect(actionButton(s.root()!, 'open')).toBe(open)
    expect(activeElement()).toBe(open)
  })

  it('returns focus to the composer instead of leaving it on a removed strip', () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    const root = s.root()!
    const pause = actionButton(root, 'pause')!
    pause.focus()

    // The goal reached a terminal state: the row is hidden entirely.
    s.state.goal = goal({ status: 'completed' })
    s.controller.update()
    expect(s.root()).toBeNull()
    expect(root.parentElement).toBeNull()
    expect(activeElement()).toBe(s.textarea)
  })

  it('leaves focus alone when the strip is removed but never held focus', () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    s.state.goal = goal({ status: 'cancelled' })
    s.controller.update()
    expect(s.root()).toBeNull()
    expect(activeElement()).toBeNull()
  })

  it('runs the primary action through the shared wrapper and never swallows the failure', async () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    actionButton(s.root()!, 'pause')!.click()
    await flushMicrotasks()

    expect(s.goalUi.runGoalUiAction).toHaveBeenCalledTimes(1)
    expect(s.goalUi.runGoalUiAction.mock.calls[0].slice(0, 3)).toEqual(['session-1', 'goal-1', 'pause'])
    expect(s.onAction).toHaveBeenCalledWith('pause')

    // A failing action must surface through the shared state, not vanish.
    const failing = setup({ status: 'running' })
    failing.setMode('reject')
    failing.controller.update()
    actionButton(failing.root()!, 'pause')!.click()
    await flushMicrotasks()
    await flushMicrotasks()

    const alert = collect(failing.root()!, (element) => element.getAttribute('role') === 'alert')[0]
    expect(alert).toBeTruthy()
    expect(alert!.textContent).toBe('goalActionFailed')
  })

  it('opens the summary from the icon and from the short error, even while pending', async () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    const open = actionButton(s.root()!, 'open')!
    // The icon navigates to the editor view, so its accessible name says edit,
    // not a generic summary label (the pinned summary owns that wording).
    expect(open.getAttribute('aria-label')).toBe('goalEditObjective')
    expect(open.title).toBe('goalEditObjective')
    open.click()
    expect(s.goalUi.requestOpenGoalSummary).toHaveBeenCalledWith('session-1', 'goal-1', 'edit')

    s.goalUi.setState('session-1', 'goal-1', { pending: true, error: 'Tool failed' })
    expect(actionButton(s.root()!, 'pause')!.disabled).toBe(true)
    actionButton(s.root()!, 'open')!.click()
    expect(s.goalUi.requestOpenGoalSummary).toHaveBeenCalledTimes(2)

    const alert = collect(s.root()!, (element) => element.getAttribute('role') === 'alert')[0]!
    expect(alert.textContent).toBe('Tool failed')
    alert.click()
    expect(s.goalUi.requestOpenGoalSummary).toHaveBeenCalledTimes(3)
  })

  it('re-subscribes across a session/goal switch and unsubscribes on cleanup', () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    expect(s.goalUi.subscribeGoalUi).toHaveBeenCalledWith('session-1', 'goal-1', expect.any(Function))
    expect(s.goalUi.listenerCount('session-1', 'goal-1')).toBe(1)

    // Same identity → no churn.
    s.controller.update()
    expect(s.goalUi.subscribeGoalUi).toHaveBeenCalledTimes(1)

    s.state.goal = goal({ id: 'goal-2', status: 'paused' })
    s.controller.update()
    expect(s.goalUi.listenerCount('session-1', 'goal-1')).toBe(0)
    expect(s.goalUi.listenerCount('session-1', 'goal-2')).toBe(1)
    expect(byClass(s.root()!, 'quickforge-goal-strip-label')!.textContent).toBe('goalStatusPaused')

    s.state.sessionId = 'session-2'
    s.controller.update()
    expect(s.goalUi.listenerCount('session-1', 'goal-2')).toBe(0)
    expect(s.goalUi.listenerCount('session-2', 'goal-2')).toBe(1)

    s.controller.cleanup()
    expect(s.goalUi.listenerCount('session-2', 'goal-2')).toBe(0)
    expect(s.root()).toBeNull()
  })

  it('reacts to shared goal-ui notifications without waiting for the next decorate pass', () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    expect(actionButton(s.root()!, 'pause')!.disabled).toBe(false)

    s.goalUi.setState('session-1', 'goal-1', { dirty: true })
    expect(actionButton(s.root()!, 'pause')!.disabled).toBe(false)

    s.goalUi.setState('session-1', 'goal-1', { dirty: false })
    expect(actionButton(s.root()!, 'pause')!.disabled).toBe(false)
  })

  it('ignores a stale action result that belongs to a previous identity', async () => {
    const s = setup({ status: 'running' })
    s.setMode('deferred')
    s.controller.update()
    actionButton(s.root()!, 'pause')!.click()
    await flushMicrotasks()
    expect(s.onAction).toHaveBeenCalledTimes(1)

    // The panel moved on to another session/goal while the pause was in flight.
    s.state.goal = goal({ id: 'goal-2', sessionId: 'session-2', status: 'paused' })
    s.state.sessionId = 'session-2'
    s.controller.update()
    expect(byClass(s.root()!, 'quickforge-goal-strip-label')!.textContent).toBe('goalStatusPaused')

    const deferred = s.getDeferred()
    expect(deferred).toBeTruthy()
    deferred!.resolve()
    await flushMicrotasks()
    await flushMicrotasks()

    // The settled pause never repainted the previous goal over the new one.
    expect(byClass(s.root()!, 'quickforge-goal-strip-label')!.textContent).toBe('goalStatusPaused')
    expect(actionButton(s.root()!, 'resume')).toBeTruthy()
    expect(actionButton(s.root()!, 'pause')).toBeUndefined()
  })

  it('wires the real shared goal-ui store (dirty guard, lock, settlement)', async () => {
    // Integration guard: the real module must satisfy the injected contract, so
    // the strip and the shared store cannot drift apart.
    const goalUi = await import('@/lib/goal-ui')
    const sessionId = 'it-session'
    const goalId = 'it-goal'

    const panel = new FakeElement('div')
    const editor = new FakeElement('message-editor')
    const composerShell = new FakeElement('div')
    composerShell.append(editor)
    panel.queryMap.set('message-editor', editor)

    const state = { goal: goal({ id: goalId, sessionId, status: 'running' }) as GoalState | null }
    const onAction = vi.fn(async () => undefined)
    const controller = createGoalControlStripController({
      panel: panel as unknown as HTMLElement,
      getGoal: () => state.goal,
      getSessionId: () => sessionId,
      goalUi,
      onAction,
    })
    const root = () => composerShell.children.find((child) => child.className.includes('quickforge-goal-strip')) ?? null

    controller.update()
    expect(actionButton(root()!, 'pause')!.disabled).toBe(false)

    // An unsaved draft in the summary blocks pause/resume but never the summary.
    goalUi.setGoalUiDirty(sessionId, goalId, true)
    expect(actionButton(root()!, 'pause')!.disabled).toBe(false)
    expect(actionButton(root()!, 'open')!.disabled).toBe(false)
    goalUi.setGoalUiDirty(sessionId, goalId, false)
    expect(actionButton(root()!, 'pause')!.disabled).toBe(false)

    actionButton(root()!, 'pause')!.click()
    await flushMicrotasks()
    expect(onAction).toHaveBeenCalledWith('pause')
    // The lock was released only by the matching settlement.
    expect(goalUi.getGoalUiState(sessionId, goalId).pending).toBe(false)

    controller.cleanup()
    goalUi.clearGoalUi(sessionId, goalId)
  })

  it('does not fire a second action while the shared lock is held', async () => {
    const s = setup({ status: 'running' })
    s.setMode('deferred')
    s.controller.update()
    const stalePause = actionButton(s.root()!, 'pause')!
    stalePause.click()
    await flushMicrotasks()

    // The shared wrapper published pending, so the repainted pause button is
    // genuinely disabled.
    expect(actionButton(s.root()!, 'pause')!.disabled).toBe(true)
    // Even a stale click on the detached node re-checks the shared lock and is a
    // no-op instead of firing a second action.
    stalePause.click()
    await flushMicrotasks()
    expect(s.onAction).toHaveBeenCalledTimes(1)
    s.getDeferred()?.resolve()
    await flushMicrotasks()
  })
})
