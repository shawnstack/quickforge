import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoalAction, GoalState } from '../../src/lib/goal'
import { createGoalCardController } from '../../src/components/chat/panel-decoration/goal-card'

// goal-card only needs t() at render time. Keeping the identity mapping lets the
// tests assert on the i18n keys the card actually renders.
vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}))

// ---------------------------------------------------------------------------
// Minimal fake DOM. The controller is a real DOM controller; these tests drive
// it through an in-memory element tree instead of asserting on source strings.
// ---------------------------------------------------------------------------

type FakeEvent = {
  key?: string
  ctrlKey?: boolean
  metaKey?: boolean
  preventDefault: () => void
  stopPropagation: () => void
}
type FakeListener = (event: FakeEvent) => void

class FakeElement {
  tagName: string
  className = ''
  dataset: Record<string, string> = {}
  textContent = ''
  innerHTML = ''
  type = ''
  disabled = false
  title = ''
  rows = 0
  value = ''
  hidden = false
  selectionStart = 0
  selectionEnd = 0
  parentElement: FakeElement | null = null
  children: FakeElement[] = []
  queryMap = new Map<string, FakeElement>()
  private attributes = new Map<string, string>()
  private listeners = new Map<string, FakeListener[]>()

  constructor(tagName: string) {
    this.tagName = tagName
  }

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null
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
    this.children = []
    this.append(...nodes)
  }

  insertBefore(node: FakeElement, reference: FakeElement | null): void {
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

  querySelector(selector: string): FakeElement | null {
    return this.queryMap.get(selector) ?? null
  }

  focus(): void {}
}

function collect(root: FakeElement, predicate: (element: FakeElement) => boolean, out: FakeElement[] = []): FakeElement[] {
  if (predicate(root)) out.push(root)
  for (const child of root.children) collect(child, predicate, out)
  return out
}

function byClass(root: FakeElement, className: string): FakeElement | undefined {
  return collect(root, (element) => element.className.split(/\s+/).includes(className))[0]
}

function buttonByText(root: FakeElement, text: string): FakeElement | undefined {
  return collect(root, (element) => element.tagName === 'button' && element.textContent === text)[0]
}

function textarea(root: FakeElement): FakeElement | undefined {
  return collect(root, (element) => element.tagName === 'textarea')[0]
}

/** The card only starts collapsed for statuses other than awaiting_confirmation. */
function expand(s: ReturnType<typeof setup>): void {
  const root = s.root()!
  if (byClass(root, 'quickforge-goal-body')!.hidden) byClass(root, 'quickforge-goal-expand')!.click()
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

function setup(initial: Partial<GoalState> = {}) {
  const panel = new FakeElement('div')
  const editor = new FakeElement('message-editor')
  const composerShell = new FakeElement('div')
  composerShell.append(editor)
  panel.queryMap.set('message-editor', editor)

  const state = { goal: goal(initial) as GoalState | null }
  let deferred: { resolve: () => void; reject: (error: unknown) => void } | null = null
  let mode: 'auto' | 'deferred' = 'auto'

  const onAction = vi.fn(async (action: GoalAction, objective?: string) => {
    // Reference the args so the linter sees them used; assertions inspect the
    // recorded call arguments instead.
    void action
    void objective
    if (mode === 'deferred') {
      await new Promise<void>((resolve, reject) => {
        deferred = { resolve, reject }
      })
    }
  })

  const controller = createGoalCardController({
    panel: panel as unknown as HTMLElement,
    getGoal: () => state.goal,
    getSessionId: () => 'session-1',
    onAction,
  })

  return {
    panel,
    composerShell,
    state,
    onAction,
    controller,
    root: () => composerShell.children.find((child) => child.className.includes('quickforge-goal-card')) ?? null,
    setMode: (next: 'auto' | 'deferred') => {
      mode = next
      deferred = null
    },
    getDeferred: () => deferred,
  }
}

// Import after the i18n mock is registered.
const { createGoalCardController } = await import('../../src/components/chat/panel-decoration/goal-card')

describe('goal card DOM controller', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: (tagName: string) => new FakeElement(tagName),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('mounts an in-flow card and toggles the expanded body', () => {
    const s = setup({ status: 'paused' })
    s.controller.update()
    const root = s.root()
    expect(root).toBeTruthy()
    expect(root!.dataset.status).toBe('paused')
    // Collapsed by default for a paused goal.
    expect(byClass(root!, 'quickforge-goal-body')!.hidden).toBe(true)

    byClass(root!, 'quickforge-goal-expand')!.click()
    expect(byClass(root!, 'quickforge-goal-body')!.hidden).toBe(false)
    expect(byClass(root!, 'quickforge-goal-expand')!.getAttribute('aria-expanded')).toBe('true')

    s.controller.cleanup()
    expect(s.root()).toBeNull()
  })

  it('preserves expansion and the edit draft across same-goal updates', () => {
    const s = setup({ status: 'paused' })
    s.controller.update()
    byClass(s.root()!, 'quickforge-goal-expand')!.click()
    buttonByText(s.root()!, 'goalRevise')!.click()

    const input = textarea(s.root()!)!
    input.value = 'Half-typed draft'
    input.dispatch('input')

    // A same-goal SSE update (revision bump) must not blow away the user's
    // expansion or the in-progress draft.
    s.state.goal = goal({ status: 'paused', revision: 4 })
    s.controller.update()

    const stillEditing = textarea(s.root()!)
    expect(stillEditing).toBeTruthy()
    expect(stillEditing!.value).toBe('Half-typed draft')
    expect(byClass(s.root()!, 'quickforge-goal-body')!.hidden).toBe(false)
  })

  it('resets expansion and the draft when a different goal owns the card', () => {
    const s = setup({ status: 'paused' })
    s.controller.update()
    byClass(s.root()!, 'quickforge-goal-expand')!.click()
    buttonByText(s.root()!, 'goalRevise')!.click()
    expect(textarea(s.root()!)).toBeTruthy()

    s.state.goal = goal({ id: 'goal-2', status: 'paused' })
    s.controller.update()
    expect(textarea(s.root()!)).toBeUndefined()
    expect(byClass(s.root()!, 'quickforge-goal-body')!.hidden).toBe(true)
  })

  it('cancels the objective edit on Escape without submitting', () => {
    const s = setup({ status: 'paused' })
    s.controller.update()
    byClass(s.root()!, 'quickforge-goal-expand')!.click()
    buttonByText(s.root()!, 'goalRevise')!.click()

    const input = textarea(s.root()!)!
    input.value = 'discard me'
    input.dispatch('input')
    input.dispatch('keydown', { key: 'Escape' })

    expect(textarea(s.root()!)).toBeUndefined()
    expect(s.onAction).not.toHaveBeenCalled()
    expect(byClass(s.root()!, 'quickforge-goal-objective')!.textContent).toBe('Ship the goal UI')
  })

  it('submits the revision on Ctrl+Enter', async () => {
    const s = setup({ status: 'paused' })
    s.controller.update()
    byClass(s.root()!, 'quickforge-goal-expand')!.click()
    buttonByText(s.root()!, 'goalRevise')!.click()

    const input = textarea(s.root()!)!
    input.value = 'New objective'
    input.dispatch('input')
    input.dispatch('keydown', { key: 'Enter', ctrlKey: true })
    await flushMicrotasks()

    expect(s.onAction).toHaveBeenCalledWith('revise', 'New objective')
  })

  it('does not submit an unchanged draft on Ctrl+Enter', () => {
    const s = setup({ status: 'paused' })
    s.controller.update()
    byClass(s.root()!, 'quickforge-goal-expand')!.click()
    buttonByText(s.root()!, 'goalRevise')!.click()

    textarea(s.root()!)!.dispatch('keydown', { key: 'Enter', ctrlKey: true })
    expect(s.onAction).not.toHaveBeenCalled()
  })

  it('enables the revise action in place while typing, in every editable state', async () => {
    for (const status of ['awaiting_confirmation', 'paused', 'blocked'] as const) {
      const s = setup({ status })
      s.controller.update()
      expand(s)

      // awaiting_confirmation offers "edit objective" next to confirm; the other
      // editable states offer a plain revise.
      const edit = buttonByText(s.root()!, 'goalRevise') ?? buttonByText(s.root()!, 'goalEditObjective')
      edit!.click()

      const input = textarea(s.root()!)!
      input.value = `${status} objective`
      input.selectionStart = input.selectionEnd = 4
      input.dispatch('input')

      // Typing enables the mouse path without re-rendering: the editor node, the
      // draft value and the caret selection all survive the keystroke.
      expect(textarea(s.root()!)).toBe(input)
      expect(input.value).toBe(`${status} objective`)
      expect(input.selectionStart).toBe(4)
      expect(input.selectionEnd).toBe(4)

      const revise = buttonByText(s.root()!, 'goalRevise')!
      expect(revise.disabled).toBe(false)
      revise.click()
      await flushMicrotasks()

      expect(s.onAction).toHaveBeenCalledTimes(1)
      expect(s.onAction).toHaveBeenCalledWith('revise', `${status} objective`)
      s.controller.cleanup()
    }
  })

  it('blocks confirm over a dirty draft and re-arms it when the draft is reverted', () => {
    const s = setup({ status: 'awaiting_confirmation' })
    s.controller.update()
    buttonByText(s.root()!, 'goalEditObjective')!.click()

    const input = textarea(s.root()!)!
    input.value = 'Changed objective'
    input.dispatch('input')

    const confirm = buttonByText(s.root()!, 'goalResume')!
    expect(confirm.disabled).toBe(true)
    confirm.click()
    expect(s.onAction).not.toHaveBeenCalled()

    // Restoring the original text re-arms confirm and parks revise again.
    input.value = 'Ship the goal UI'
    input.dispatch('input')
    expect(buttonByText(s.root()!, 'goalResume')!.disabled).toBe(false)
    expect(buttonByText(s.root()!, 'goalRevise')!.disabled).toBe(true)

    buttonByText(s.root()!, 'goalResume')!.click()
    expect(s.onAction).toHaveBeenCalledWith('resume', undefined)
  })

  it('refuses a stale confirm click while the draft has unsubmitted edits', () => {
    const s = setup({ status: 'awaiting_confirmation' })
    s.controller.update()
    buttonByText(s.root()!, 'goalEditObjective')!.click()

    // A reference captured before typing must not be able to confirm the old
    // objective: the click itself re-checks the live draft.
    const staleConfirm = buttonByText(s.root()!, 'goalResume')!
    const input = textarea(s.root()!)!
    input.value = 'Unsubmitted revision'
    input.dispatch('input')

    staleConfirm.disabled = false
    staleConfirm.click()
    expect(s.onAction).not.toHaveBeenCalled()
  })

  it('discards the draft through cancel without submitting', () => {
    const s = setup({ status: 'awaiting_confirmation' })
    s.controller.update()
    buttonByText(s.root()!, 'goalEditObjective')!.click()

    const input = textarea(s.root()!)!
    input.value = 'Discard me'
    input.dispatch('input')

    buttonByText(s.root()!, 'goalEditCancel')!.click()
    expect(s.onAction).not.toHaveBeenCalled()
    expect(textarea(s.root()!)).toBeUndefined()
    expect(byClass(s.root()!, 'quickforge-goal-objective')!.textContent).toBe('Ship the goal UI')
    expect(buttonByText(s.root()!, 'goalResume')!.disabled).toBe(false)
  })

  it('blocks a duplicate mouse submit and Ctrl+Enter while a revision is in flight', async () => {
    const s = setup({ status: 'paused' })
    s.setMode('deferred')
    s.controller.update()
    expand(s)
    buttonByText(s.root()!, 'goalRevise')!.click()

    const input = textarea(s.root()!)!
    input.value = 'New objective'
    input.dispatch('input')

    const revise = buttonByText(s.root()!, 'goalRevise')!
    revise.click()
    expect(s.onAction).toHaveBeenCalledTimes(1)

    // The pending re-render disabled the fresh button...
    expect(buttonByText(s.root()!, 'goalRevise')!.disabled).toBe(true)
    buttonByText(s.root()!, 'goalRevise')!.click()
    // ...and the stale node is guarded at click time.
    revise.disabled = false
    revise.click()
    expect(s.onAction).toHaveBeenCalledTimes(1)

    // Ctrl+Enter is guarded by the same in-flight check.
    textarea(s.root()!)!.dispatch('keydown', { key: 'Enter', ctrlKey: true })
    expect(s.onAction).toHaveBeenCalledTimes(1)

    s.getDeferred()!.resolve()
    await flushMicrotasks()
  })

  it('submits the revision on Cmd+Enter', async () => {
    const s = setup({ status: 'paused' })
    s.controller.update()
    expand(s)
    buttonByText(s.root()!, 'goalRevise')!.click()

    const input = textarea(s.root()!)!
    input.value = 'Cmd objective'
    input.dispatch('input')
    input.dispatch('keydown', { key: 'Enter', metaKey: true })
    await flushMicrotasks()

    expect(s.onAction).toHaveBeenCalledWith('revise', 'Cmd objective')
  })

  it('offers both explicit acceptance and continue in needs_review', () => {
    const ready = setup({
      status: 'needs_review',
      criteria: [{ id: 'c1', description: 'Builds', required: true, status: 'passed', evidenceIds: ['e1'] }],
      evidence: [{ id: 'e1', description: 'npm run build', toolCallId: 'call-1' }],
    })
    ready.controller.update()
    expect(buttonByText(ready.root()!, 'goalAccept')).toBeUndefined()
    expect(buttonByText(ready.root()!, 'goalContinue')).toBeTruthy()
    expect(ready.onAction).not.toHaveBeenCalled()

    // Continue never accepts: it posts resume so the goal goes back to work.
    const continuing = setup({ status: 'needs_review' })
    continuing.controller.update()
    buttonByText(continuing.root()!, 'goalContinue')!.click()
    expect(continuing.onAction).toHaveBeenCalledWith('resume', undefined)
    expect(continuing.onAction).not.toHaveBeenCalledWith('accept', undefined)
  })

  it('disables accept and explains why when a required criterion failed', () => {
    const blocked = setup({
      status: 'needs_review',
      criteria: [{ id: 'c1', description: 'Builds', required: true, status: 'failed', evidenceIds: [] }],
    })
    blocked.controller.update()

    expect(buttonByText(blocked.root()!, 'goalAccept')).toBeUndefined()
    expect(blocked.onAction).not.toHaveBeenCalled()

    // Continue stays available: the goal can still go back to the model.
    const continueButton = buttonByText(blocked.root()!, 'goalContinue')!
    expect(continueButton.disabled).toBe(false)
    continueButton.click()
    expect(blocked.onAction).toHaveBeenCalledWith('resume', undefined)
  })

  it('surfaces an action failure on the card without dropping the goal', async () => {
    const s = setup({ status: 'paused' })
    s.onAction.mockRejectedValueOnce(new Error('server exploded'))
    s.controller.update()
    buttonByText(s.root()!, 'goalResume')!.click()
    await flushMicrotasks()

    const message = byClass(s.root()!, 'quickforge-goal-message')!
    expect(message.textContent).toBe('server exploded')
    expect(message.getAttribute('role')).toBe('alert')
    expect(s.root()!.dataset.status).toBe('paused')
  })

  it('ignores a stale action failure once a different goal owns the card', async () => {
    const s = setup({ status: 'paused' })
    s.setMode('deferred')
    s.controller.update()
    buttonByText(s.root()!, 'goalResume')!.click()
    expect(s.onAction).toHaveBeenCalledTimes(1)

    // A new goal replaces the card while the first action is still in flight.
    s.state.goal = goal({ id: 'goal-2', status: 'running' })
    s.controller.update()
    expect(s.root()!.dataset.status).toBe('running')

    s.getDeferred()!.reject(new Error('stale failure'))
    await flushMicrotasks()

    expect(byClass(s.root()!, 'quickforge-goal-message')).toBeUndefined()
    expect(s.root()!.dataset.status).toBe('running')
  })

  it('blocks a second action while one is in flight', async () => {
    const s = setup({ status: 'paused' })
    s.setMode('deferred')
    s.controller.update()

    const resume = buttonByText(s.root()!, 'goalResume')!
    resume.click()
    // The card re-rendered the button disabled; a second click is a no-op.
    const disabledResume = buttonByText(s.root()!, 'goalResume')!
    expect(disabledResume.disabled).toBe(true)
    disabledResume.click()
    expect(s.onAction).toHaveBeenCalledTimes(1)

    s.getDeferred()!.resolve()
    await flushMicrotasks()
  })

  it('keeps an in-flight action pending across same-goal revision growth until it settles', async () => {
    const s = setup({ status: 'paused' })
    s.setMode('deferred')
    s.controller.update()
    buttonByText(s.root()!, 'goalResume')!.click()
    expect(byClass(s.root()!, 'quickforge-goal-busy')).toBeTruthy()

    // An unrelated same-goal update (any revision growth) must NOT unlock the
    // card: unlocking here would allow a concurrent user action while the
    // request is still in flight.
    s.state.goal = goal({ status: 'running', revision: 4 })
    s.controller.update()
    expect(s.root()!.dataset.status).toBe('running')
    expect(byClass(s.root()!, 'quickforge-goal-busy')).toBeTruthy()
    expect(buttonByText(s.root()!, 'goalPause')!.disabled).toBe(true)
    expect(buttonByText(s.root()!, 'goalCancel')!.disabled).toBe(true)

    // Only the matching action settling unlocks it.
    s.getDeferred()!.resolve()
    await flushMicrotasks()
    expect(byClass(s.root()!, 'quickforge-goal-busy')).toBeUndefined()
    expect(buttonByText(s.root()!, 'goalPause')!.disabled).toBe(false)
    expect(byClass(s.root()!, 'quickforge-goal-message')).toBeUndefined()
    expect(s.root()!.dataset.status).toBe('running')
  })

  it('unlocks a pending action only when a different goal owns the card', async () => {
    const s = setup({ status: 'paused' })
    s.setMode('deferred')
    s.controller.update()
    buttonByText(s.root()!, 'goalResume')!.click()
    expect(byClass(s.root()!, 'quickforge-goal-busy')).toBeTruthy()

    // Real identity switch: the card resets and the leftover request is retired.
    s.state.goal = goal({ id: 'goal-2', status: 'paused' })
    s.controller.update()
    expect(byClass(s.root()!, 'quickforge-goal-busy')).toBeUndefined()
    expect(buttonByText(s.root()!, 'goalResume')!.disabled).toBe(false)

    s.getDeferred()!.resolve()
    await flushMicrotasks()
    expect(byClass(s.root()!, 'quickforge-goal-busy')).toBeUndefined()
    expect(byClass(s.root()!, 'quickforge-goal-message')).toBeUndefined()
  })
})
