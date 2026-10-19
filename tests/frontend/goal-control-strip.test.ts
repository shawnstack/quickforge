import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildGoalControlStripView,
  createGoalControlStripController,
} from '@/components/chat/panel-decoration/goal-control-strip'
import type { GoalAction, GoalState } from '@/lib/goal'

// ---------------------------------------------------------------------------
// Minimal DOM fake (no jsdom): just enough to mount the strip controller and
// drive clicks/keys. The fake keeps the same contract the real DOM gives us:
// appendChild/replaceChildren/insertBefore/remove, dataset, click, focus,
// hidden, and textContent.
// ---------------------------------------------------------------------------

class FakeElement {
  tagName: string
  className = ''
  id = ''
  hidden = false
  disabled = false
  textContent = ''
  title = ''
  innerHTML = ''
  children: FakeElement[] = []
  parentElement: FakeElement | null = null
  dataset: Record<string, string> = {}
  attributes = new Map<string, string>()
  textContentSets = 0
  __listeners = new Map<string, ((event: unknown) => void)[]>()
  __value = ''
  __selStart: number | null = null
  __selEnd: number | null = null

  constructor(tagName = 'div') { this.tagName = tagName.toUpperCase() }

  get value() { return this.__value }
  set value(v: string) { this.__value = v }

  get classList() {
    return {
      add: (...names: string[]) => {
        this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' ')
      },
      remove: (...names: string[]) => {
        this.className = this.className.split(/\s+/).filter(Boolean).filter((n) => !names.includes(n)).join(' ')
      },
      contains: (name: string) => this.className.split(/\s+/).includes(name),
      toggle: (name: string, force?: boolean) => {
        const has = this.className.split(/\s+/).includes(name)
        const next = force !== undefined ? force : !has
        if (next && !has) this.className = `${this.className} ${name}`.trim()
        else if (!next && has) this.className = this.className.split(/\s+/).filter((n) => n !== name).join(' ')
      },
    }
  }

  get firstChild() { return this.children[0] ?? null }
  get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] ?? null }

  append(...nodes: (FakeElement | null | undefined)[]) {
    for (const node of nodes) {
      if (!node) continue
      node.parentElement?.removeChild(node)
      node.parentElement = this
      this.children.push(node)
    }
  }

  replaceChildren(...nodes: (FakeElement | null | undefined)[]) {
    for (const child of this.children) child.parentElement = null
    this.children = []
    this.append(...nodes)
  }

  insertBefore(node: FakeElement, reference: FakeElement | null) {
    if (!node) return node
    const index = reference ? this.children.indexOf(reference) : -1
    if (index >= 0) {
      node.parentElement?.removeChild(node)
      node.parentElement = this
      this.children.splice(index, 0, node)
    } else {
      this.append(node)
    }
    return node
  }

  removeChild(node: FakeElement) {
    const index = this.children.indexOf(node)
    if (index >= 0) this.children.splice(index, 1)
    node.parentElement = null
  }

  remove() {
    if (!this.parentElement) return
    this.parentElement.removeChild(this)
  }

  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  getAttribute(name: string) { return this.attributes.get(name) ?? '' }
  removeAttribute(name: string) { this.attributes.delete(name) }

  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.__listeners.has(type)) this.__listeners.set(type, [])
    this.__listeners.get(type)!.push(listener)
  }

  removeEventListener(type: string, listener: (event: unknown) => void) {
    const list = this.__listeners.get(type)
    if (!list) return
    const index = list.indexOf(listener)
    if (index >= 0) list.splice(index, 1)
  }

  querySelector(selector: string): FakeElement | null {
    if (selector.startsWith('.')) {
      const className = selector.slice(1)
      const walk = (element: FakeElement): FakeElement | null => {
        if (element.classList.contains(className)) return element
        for (const child of element.children) {
          const found = walk(child)
          if (found) return found
        }
        return null
      }
      return walk(this)
    }
    // Tag selector (e.g. 'textarea')
    const walkTag = (element: FakeElement): FakeElement | null => {
      if (element.tagName === selector) return element
      for (const child of element.children) {
        const found = walkTag(child)
        if (found) return found
      }
      return null
    }
    return walkTag(this)
  }

  querySelectorAll(selector: string): FakeElement[] {
    if (selector.startsWith('.')) {
      const className = selector.slice(1)
      return collect(this, (element) => element.classList.contains(className))
    }
    return collect(this, (element) => element.tagName === selector)
  }

  dispatch(type: string, init: Record<string, unknown> = {}) {
    const event = {
      type,
      preventDefault: (init.preventDefault as (() => void)) ?? (() => {}),
      stopPropagation: (init.stopPropagation as (() => void)) ?? (() => {}),
      key: init.key as string,
      isComposing: false,
      ...init,
    }
    for (const listener of [...(this.__listeners.get(type) ?? [])]) listener(event)
  }

  click() {
    for (const listener of [...(this.__listeners.get('click') ?? [])]) {
      listener({ preventDefault: () => {}, stopPropagation: () => {} })
    }
  }

  focus() { (globalThis as unknown as { document: { activeElement: FakeElement | null } }).document.activeElement = this }
  get selectionStart() { return this.__selStart }
  set selectionStart(value: number | null) { this.__selStart = value }
  get selectionEnd() { return this.__selEnd }
  set selectionEnd(value: number | null) { this.__selEnd = value }
  setSelectionRange(start: number, end: number) {
    this.__selStart = start
    this.__selEnd = end
  }
}

function collect(root: FakeElement, predicate: (element: FakeElement) => boolean): FakeElement[] {
  const out: FakeElement[] = []
  const walk = (element: FakeElement) => {
    if (predicate(element)) out.push(element)
    for (const child of element.children) walk(child)
  }
  walk(root)
  return out
}

function byClass(root: FakeElement, className: string): FakeElement | undefined {
  return collect(root, (element) => element.classList.contains(className))[0]
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

function createFakeGoalUi() {
  const state = new Map<string, FakeUiState>()
  const listeners = new Map<string, Set<() => void>>()
  const key = (sessionId: string, goalId: string) => `${sessionId}:${goalId}`
  const stateFor = (sessionId: string, goalId: string) => {
    const id = key(sessionId, goalId)
    if (!state.has(id)) state.set(id, { pending: false, dirty: false, error: null })
    return state.get(id)!
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
      return () => set.delete(listener)
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
    setState: (sessionId: string, goalId: string, patch: Partial<FakeUiState>) => {
      Object.assign(stateFor(sessionId, goalId), patch)
      notify(sessionId, goalId)
    },
    listenerCount: (sessionId: string, goalId: string) => listeners.get(key(sessionId, goalId))?.size ?? 0,
  }
}

function setup(initial: Partial<GoalState> = {}) {
  const panel = new FakeElement('div')
  const composerShell = new FakeElement('div')
  const editor = new FakeElement('div')
  editor.className = 'qf-message-editor'
  composerShell.append(editor)
  panel.append(composerShell)
  const textarea = new FakeElement('textarea')
  editor.append(textarea)

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

describe('goal control strip DOM controller', () => {
  beforeEach(() => {
    const fakeDoc = { activeElement: null as FakeElement | null }
    vi.stubGlobal('document', {
      createElement: (tagName: string) => new FakeElement(tagName),
      activeElement: fakeDoc.activeElement,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('mounts a single row directly above the composer editor', () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    const root = s.root()
    expect(root).toBeTruthy()
    expect(root!.tagName).toBe('SECTION')
    expect(s.composerShell.children).toEqual([root, s.editor])
    expect(root!.nextElementSibling).toBe(s.editor)
    expect(root!.dataset.status).toBe('running')
    expect(root!.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(0)
    s.controller.cleanup()
  })

  it('shows the objective inline on a single row for v2 goals', () => {
    const s = setup({
      status: 'running',
      phase: 'active',
      activation: 'armed',
      runtime: 'executing',
      maxRounds: 12,
      roundsStarted: 4,
    })
    s.controller.update()
    const root = s.root()!
    expect(byClass(root, 'quickforge-goal-strip-objective')!.hidden).toBe(false)
    expect(byClass(root, 'quickforge-goal-strip-objective')!.textContent).toBe('Ship the goal UI')
    // Label shows the phase and round; don't assert the exact translated text.
    const labelText = byClass(root, 'quickforge-goal-strip-label')!.textContent ?? ''
    expect(labelText).toContain('4/12')
    // The objective is inline, not on a wrapped second line (no order style).
    expect(root.dataset.editing).toBe('false')
    s.controller.cleanup()
  })

  it('shows the edit button for v2 goals but not legacy', () => {
    const v2 = setup({ status: 'running', phase: 'active', activation: 'armed', runtime: 'executing' })
    v2.controller.update()
    const edit = byClass(v2.root()!, 'quickforge-goal-strip-action--edit')
    expect(edit).toBeTruthy()
    expect(edit!.hidden).toBe(false)
    v2.controller.cleanup()

    const legacy = setup({ status: 'paused' })
    legacy.controller.update()
    const legacyEdit = byClass(legacy.root()!, 'quickforge-goal-strip-action--edit')
    expect(legacyEdit!.hidden).toBe(true)
    legacy.controller.cleanup()
  })

  it('enters edit mode on edit click, replaces objective with input, focuses it', () => {
    const s = setup({
      status: 'running',
      phase: 'active',
      activation: 'armed',
      runtime: 'executing',
    })
    s.controller.update()
    const root = s.root()!
    const edit = byClass(root, 'quickforge-goal-strip-action--edit')!
    edit.click()
    expect(root.dataset.editing).toBe('true')
    const input = byClass(root, 'quickforge-goal-strip-edit-input')!
    expect(input.hidden).toBe(false)
    expect(input.value).toBe('Ship the goal UI')
    const save = byClass(root, 'quickforge-goal-strip-action--save')!
    const cancelEdit = byClass(root, 'quickforge-goal-strip-action--edit-cancel')!
    expect(save!.hidden).toBe(false)
    expect(cancelEdit!.hidden).toBe(false)
    // Objective text is hidden while editing.
    expect(byClass(root, 'quickforge-goal-strip-objective')!.hidden).toBe(true)
    s.controller.cleanup()
  })

  it('saves the edited objective through the shared revise action', () => {
    const s = setup({
      status: 'running',
      phase: 'active',
      activation: 'armed',
      runtime: 'executing',
    })
    s.controller.update()
    const root = s.root()!
    byClass(root, 'quickforge-goal-strip-action--edit')!.click()
    const input = byClass(root, 'quickforge-goal-strip-edit-input')! as unknown as HTMLInputElement
    input.value = 'Ship the improved goal UI'
    byClass(root, 'quickforge-goal-strip-action--save')!.click()
    expect(s.onAction).toHaveBeenCalledWith('revise', 'Ship the improved goal UI')
    s.controller.cleanup()
  })

  it('cancel editing restores the objective without dispatching an action', () => {
    const s = setup({
      status: 'running',
      phase: 'active',
      activation: 'armed',
      runtime: 'executing',
    })
    s.controller.update()
    const root = s.root()!
    byClass(root, 'quickforge-goal-strip-action--edit')!.click()
    const input = byClass(root, 'quickforge-goal-strip-edit-input')! as unknown as HTMLInputElement
    input.value = 'Changed'
    byClass(root, 'quickforge-goal-strip-action--edit-cancel')!.click()
    expect(root.dataset.editing).toBe('false')
    expect(byClass(root, 'quickforge-goal-strip-objective')!.hidden).toBe(false)
    expect(s.onAction).not.toHaveBeenCalled()
    s.controller.cleanup()
  })

  it('Escape in the edit input exits edit mode', () => {
    const s = setup({
      status: 'running',
      phase: 'active',
      activation: 'armed',
      runtime: 'executing',
    })
    s.controller.update()
    const root = s.root()!
    byClass(root, 'quickforge-goal-strip-action--edit')!.click()
    const input = byClass(root, 'quickforge-goal-strip-edit-input')!
    input.dispatch('keydown', { key: 'Escape', preventDefault: () => {}, stopPropagation: () => {} })
    expect(root.dataset.editing).toBe('false')
    s.controller.cleanup()
  })

  it('hides for a missing, terminal or gated goal', () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    expect(s.root()).toBeTruthy()
    s.state.goal = { ...s.state.goal!, status: 'completed' }
    s.controller.update()
    expect(s.root()).toBeNull()

    s.state.goal = goal({ status: 'running' })
    s.controller.update()
    expect(s.root()).toBeTruthy()
    s.state.goal = null
    s.controller.update()
    expect(s.root()).toBeNull()
    s.controller.cleanup()
  })

  it('shows pause only while running/verifying and disables it while pausing', () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    const root = s.root()!
    expect(byClass(root, 'quickforge-goal-strip-action--pause')).toBeTruthy()

    s.state.goal = { ...s.state.goal!, status: 'pausing' }
    s.controller.update()
    const pause = byClass(s.root()!, 'quickforge-goal-strip-action--pause')! as unknown as HTMLButtonElement
    expect(pause.disabled).toBe(true)

    for (const status of ['paused', 'blocked', 'planning', 'awaiting_input'] as const) {
      s.state.goal = { ...s.state.goal!, status }
      s.controller.update()
      expect(byClass(s.root()!, 'quickforge-goal-strip-action--pause')).toBeUndefined()
    }
    s.controller.cleanup()
  })

  it('runs the primary action through the shared wrapper and never swallows the failure', async () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    const pause = byClass(s.root()!, 'quickforge-goal-strip-action--pause')!
    pause.click()
    expect(s.goalUi.runGoalUiAction).toHaveBeenCalledTimes(1)
    expect(s.onAction).toHaveBeenCalledWith('pause')

    // Wait for the async wrapper to settle, then dispatch a rejecting second call.
    await Promise.resolve()
    s.goalUi.setState(s.state.sessionId, 'goal-1', { pending: false, error: null })
    s.setMode('reject')
    s.state.goal = goal({ ...s.state.goal!, status: 'running' })
    s.controller.update()
    byClass(s.root()!, 'quickforge-goal-strip-action--pause')!.click()
    expect(s.goalUi.runGoalUiAction).toHaveBeenCalledTimes(2)
    s.controller.cleanup()
  })

  it('clear button adds confirmation UI before dispatching cancel', () => {
    const s = setup({ status: 'running' })
    s.controller.update()
    const root = s.root()!
    const buttonCountBefore = collect(root, (el) => el.tagName === 'BUTTON').length
    const clearButton = collect(root, (el) => el.textContent === '×')[0]
    expect(clearButton).toBeTruthy()
    clearButton.click()
    // The confirmation group (cancel note + confirm + keep) adds nodes.
    const buttonCountAfter = collect(root, (el) => el.tagName === 'BUTTON').length
    expect(buttonCountAfter).toBeGreaterThan(buttonCountBefore)
    expect(s.onAction).not.toHaveBeenCalled()
    // Escape dismisses the confirmation.
    root.dispatch('keydown', { key: 'Escape', stopPropagation: () => {}, preventDefault: () => {} })
    expect(s.onAction).not.toHaveBeenCalled()
    s.controller.cleanup()
  })

  it('opens the summary from the open button', () => {
    const s = setup({ status: 'paused' })
    s.controller.update()
    byClass(s.root()!, 'quickforge-goal-strip-action--open')!.click()
    expect(s.goalUi.requestOpenGoalSummary).toHaveBeenCalledWith('session-1', 'goal-1', 'progress')
    s.controller.cleanup()
  })
})
