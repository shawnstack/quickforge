// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  extractLatestTodoWriteSnapshot,
  readLatestTodoWriteSnapshot,
  isFinalTodoSnapshot,
  shouldRetireTodoSummary,
} from '../../src/components/chat/panel-decoration/todo-write-summary'
import { TodoWriteSummary } from '../../src/components/chat/surface/TodoWriteSummary'
import type { TodoWriteMessage } from '../../src/components/chat/panel-decoration/todo-write-summary'

vi.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) => {
    if (!params) return key
    return `${key}:${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')}`
  },
}))

const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({ content, status })
const quickForgeResult = (todos: unknown, options: Record<string, unknown> = {}): TodoWriteMessage => ({
  role: 'toolResult', toolName: 'todo_write', details: { todos }, isError: false, ...options,
})

describe('extractLatestTodoWriteSnapshot', () => {
  it('extracts QuickForge todo_write details.todos', () => {
    expect(extractLatestTodoWriteSnapshot([
      quickForgeResult([todo('Research', 'in_progress'), todo('Test', 'pending')]),
    ])).toEqual({ todos: [todo('Research', 'in_progress'), todo('Test', 'pending')] })
  })

  it('falls back to the previous valid snapshot when a newer candidate is invalid or errored', () => {
    expect(extractLatestTodoWriteSnapshot([
      quickForgeResult([todo('Keep me', 'in_progress')]),
      quickForgeResult([{ content: '', status: 'completed' }]),
      quickForgeResult([todo('Ignore error', 'completed')], { isError: true }),
    ])).toEqual({ todos: [todo('Keep me', 'in_progress')] })
  })

  it('keys each snapshot by its tool call so a new round is distinguishable', () => {
    const first = readLatestTodoWriteSnapshot([quickForgeResult([todo('One', 'pending')], { toolCallId: 'first' })])
    const second = readLatestTodoWriteSnapshot([
      quickForgeResult([todo('One', 'pending')], { toolCallId: 'first' }),
      quickForgeResult([todo('One', 'pending')], { toolCallId: 'second' }),
    ])

    expect(first?.key).toBe('quickforge:first')
    // Same content, different key: the renderer needs this to tell rounds apart.
    expect(second?.key).toBe('quickforge:second')
    expect(second?.snapshot).toEqual(first?.snapshot)
  })

  it('treats a fully completed list as final', () => {
    expect(isFinalTodoSnapshot([todo('One', 'completed'), todo('Two', 'completed')])).toBe(true)
    expect(isFinalTodoSnapshot([todo('One', 'completed'), todo('Two', 'pending')])).toBe(false)
    expect(isFinalTodoSnapshot([])).toBe(false)
  })
})

describe('shouldRetireTodoSummary', () => {
  const done = [todo('One', 'completed')]
  const unfinished = [todo('One', 'completed'), todo('Two', 'pending')]

  it('retires a fully completed list once the agent is idle', () => {
    expect(shouldRetireTodoSummary({ todos: done, idle: true })).toBe(true)
    // Still streaming: the round is not over, however many items are done.
    expect(shouldRetireTodoSummary({ todos: done, idle: false })).toBe(false)
    expect(shouldRetireTodoSummary({ todos: unfinished, idle: true })).toBe(false)
    // An empty list is "cleared", not "finished".
    expect(shouldRetireTodoSummary({ todos: [], idle: true })).toBe(false)
  })
})

describe('TodoWrite pill and hover popover', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(messages: TodoWriteMessage[], options: { idle?: boolean } = {}) {
    // The component receives the pre-resolved snapshot (the surface derives it
    // once per agent snapshot and caches it by message-array identity).
    const snapshot = readLatestTodoWriteSnapshot(messages)
    act(() => {
      root.render(createElement(TodoWriteSummary, { snapshot, idle: options.idle ?? false }))
    })
  }

  /** React reads `pointerType` off the native event, which jsdom does not set. */
  function pointer(type: 'pointerover' | 'pointerout' | 'pointerdown' | 'pointerup', target: Element, pointerType = 'mouse') {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'pointerType', { value: pointerType })
    Object.defineProperty(event, 'relatedTarget', { value: document.body })
    act(() => { target.dispatchEvent(event) })
  }

  const summary = () => container.querySelector<HTMLElement>('.quickforge-todo-summary')
  const trigger = () => container.querySelector<HTMLElement>('.quickforge-todo-summary-trigger')
  const pill = () => container.querySelector<HTMLButtonElement>('.quickforge-todo-summary-toggle')
  const ring = () => container.querySelector<HTMLElement>('.quickforge-todo-summary-ring')
  const popover = () => container.querySelector<HTMLElement>('.quickforge-todo-summary-popover')
  const card = () => container.querySelector<HTMLElement>('.quickforge-todo-summary-popover-card')
  const count = () => container.querySelector<HTMLElement>('.quickforge-todo-summary-count')
  const items = () => Array.from(container.querySelectorAll<HTMLElement>('.quickforge-todo-summary-item'))

  it('renders nothing without a snapshot', () => {
    render([])
    expect(summary()).toBeNull()
    render([quickForgeResult([])])
    expect(summary()).toBeNull()
  })

  it('collapses to a progress pill: ring plus count, and nothing else', () => {
    render([quickForgeResult([todo('One', 'in_progress'), todo('Two', 'pending')])])

    expect(Array.from(summary()!.children).map((child) => child.className)).toEqual([
      'quickforge-todo-summary-trigger',
    ])
    expect(Array.from(trigger()!.children).map((child) => child.className)).toEqual([
      'quickforge-todo-summary-toggle',
      'quickforge-todo-summary-popover',
    ])
    // The pill carries the ring and the tally; the heading, the stats sentence,
    // the "updated" marker and the chevron are gone for good.
    expect(Array.from(pill()!.children).map((child) => child.className)).toEqual([
      'quickforge-todo-summary-ring',
      'quickforge-todo-summary-count',
    ])
    expect(count()!.textContent).toBe('0/2')
    expect(ring()!.getAttribute('aria-hidden')).toBe('true')
  })

  it('starts collapsed: the pill is not expanded and the popover is closed', () => {
    render([quickForgeResult([todo('One', 'in_progress'), todo('Two', 'pending')])])

    expect(pill()!.getAttribute('aria-expanded')).toBe('false')
    expect(pill()!.getAttribute('aria-controls')).toBe(popover()!.id)
    expect(summary()!.dataset.expanded).toBe('false')
    // Closed, not unmounted: the collapse is a CSS transition.
    expect(popover()!.dataset.open).toBe('false')
    expect(items()).toHaveLength(2)
  })

  it('shows tasks only in the popover — no heading, no stats, no status words on screen', () => {
    render([quickForgeResult([todo('Done', 'completed'), todo('Running', 'in_progress'), todo('Queued', 'pending')])])

    expect(Array.from(card()!.children).map((child) => child.className)).toEqual([
      'quickforge-todo-summary-list',
    ])
    expect(container.querySelector('.quickforge-todo-summary-heading')).toBeNull()
    expect(container.querySelector('.quickforge-todo-summary-stats')).toBeNull()
    expect(container.querySelector('.quickforge-todo-summary-updated')).toBeNull()
    expect(container.querySelector('.quickforge-todo-summary-status-label')!.className).toBe('quickforge-todo-summary-status-label')

    // Every row is icon + (visually hidden) status + task text.
    expect(items().map((item) => Array.from(item.children).map((child) => child.className))).toEqual([
      ['quickforge-todo-summary-status-icon', 'quickforge-todo-summary-status-label', 'quickforge-todo-summary-content'],
      ['quickforge-todo-summary-status-icon', 'quickforge-todo-summary-status-label', 'quickforge-todo-summary-content'],
      ['quickforge-todo-summary-status-icon', 'quickforge-todo-summary-status-label', 'quickforge-todo-summary-content'],
    ])
    expect(items().map((item) => item.querySelector('.quickforge-todo-summary-content')!.textContent)).toEqual([
      'Done', 'Running', 'Queued',
    ])
    // The status word stays available to screen readers only: the glyph is the
    // single visual status signal.
    expect(items()[1].querySelector('.quickforge-todo-summary-status-label')!.textContent).toBe('todoWriteStatusInProgress')
  })

  it('renders a shared status glyph per item so the three states differ by geometry', () => {
    render([quickForgeResult([todo('Done', 'completed'), todo('Running', 'in_progress'), todo('Queued', 'pending')])])

    const glyphs = items().map((item) => item.querySelector('.quickforge-todo-summary-status-icon svg')!)
    expect(glyphs).toHaveLength(3)
    // completed uses a mask to knock the check out of the filled circle.
    expect(glyphs[0].querySelector('mask')).not.toBeNull()
    // in_progress is a dimmed track plus a spinning quarter arc: the arc lives in
    // its own group so only it rotates (a spinning whole glyph reads as a blank
    // circle at this size).
    expect(glyphs[1].querySelector('.quickforge-todo-spin-track')).not.toBeNull()
    expect(glyphs[1].querySelector('.quickforge-todo-spin-arc path')).not.toBeNull()
    expect(glyphs[2].querySelector('mask')).toBeNull()
    expect(glyphs[2].querySelectorAll('path')).toHaveLength(0)
  })

  it('drives the progress arc and the completion state from the snapshot', () => {
    render([quickForgeResult([todo('One', 'completed'), todo('Two', 'in_progress')])])

    expect(count()!.textContent).toBe('1/2')
    expect(ring()!.style.getPropertyValue('--quickforge-todo-ring-offset')).toBe('28.27')
    expect(summary()!.dataset.complete).toBe('false')
    expect(summary()!.dataset.running).toBe('true')

    render([quickForgeResult([todo('One', 'completed')])])
    expect(summary()!.dataset.complete).toBe('true')
    expect(summary()!.dataset.running).toBe('false')
    expect(ring()!.style.getPropertyValue('--quickforge-todo-ring-offset')).toBe('0.00')
  })

  it('opens the popover on hover and collapses it once the pointer leaves', () => {
    vi.useFakeTimers()
    try {
      render([quickForgeResult([todo('One', 'in_progress')])])

      pointer('pointerover', trigger()!)
      expect(summary()!.dataset.expanded).toBe('true')
      expect(popover()!.dataset.open).toBe('true')
      expect(pill()!.getAttribute('aria-expanded')).toBe('true')

      pointer('pointerout', trigger()!)
      // A short grace before the collapse, so a pointer clipping the edge for a
      // frame does not flicker the list.
      expect(popover()!.dataset.open).toBe('true')
      act(() => { vi.advanceTimersByTime(120) })
      expect(popover()!.dataset.open).toBe('false')
      expect(pill()!.getAttribute('aria-expanded')).toBe('false')
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores the hover-latched state for touch pointers', () => {
    render([quickForgeResult([todo('One', 'in_progress')])])

    // Touch taps also emit pointerover but never a matching pointerout, so they
    // must go through the click latch instead of pinning the popover open.
    pointer('pointerover', trigger()!, 'touch')
    expect(popover()!.dataset.open).toBe('false')
  })

  it('opens the popover on keyboard focus', () => {
    render([quickForgeResult([todo('One', 'in_progress')])])

    act(() => pill()!.focus())
    expect(popover()!.dataset.open).toBe('true')
    expect(pill()!.getAttribute('aria-expanded')).toBe('true')

    act(() => pill()!.blur())
    expect(popover()!.dataset.open).toBe('false')
  })

  it('collapses an open popover on Escape', () => {
    render([quickForgeResult([todo('One', 'in_progress')])])
    act(() => pill()!.focus())

    act(() => {
      pill()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(popover()!.dataset.open).toBe('false')
  })

  it('keeps the DOM nodes stable across snapshot updates so the arc animates', () => {
    render([quickForgeResult([todo('One', 'in_progress')], { toolCallId: 'first' })])
    const firstRing = ring()
    const firstPill = pill()
    expect(firstRing!.style.getPropertyValue('--quickforge-todo-ring-offset')).toBe('56.55')

    render([
      quickForgeResult([todo('One', 'in_progress')], { toolCallId: 'first' }),
      quickForgeResult([todo('One', 'completed')], { toolCallId: 'second' }),
    ])

    // Same nodes ⇒ the CSS transition sees the previous offset and animates.
    expect(ring()).toBe(firstRing)
    expect(pill()).toBe(firstPill)
    expect(firstRing!.style.getPropertyValue('--quickforge-todo-ring-offset')).toBe('0.00')
  })

  it('stays collapsed when a new snapshot round arrives', () => {
    render([quickForgeResult([todo('One', 'in_progress')], { toolCallId: 'first' })])

    render([
      quickForgeResult([todo('One', 'in_progress')], { toolCallId: 'first' }),
      quickForgeResult([todo('One', 'completed'), todo('Two', 'pending')], { toolCallId: 'second' }),
    ])
    // The list is no longer resident in the composer, so a new round must not
    // pop it open on its own.
    expect(pill()!.getAttribute('aria-expanded')).toBe('false')
    expect(popover()!.dataset.open).toBe('false')
  })

  it('keeps the completed pill visible until the turn ends, then fades it out and unmounts', () => {
    vi.useFakeTimers()
    try {
      render([quickForgeResult([todo('One', 'completed')], { toolCallId: 'first' })])
      // A finished list is still shown: the user gets to read the confirmation.
      expect(summary()).not.toBeNull()
      expect(summary()!.dataset.complete).toBe('true')

      render([quickForgeResult([todo('One', 'completed')], { toolCallId: 'first' })], { idle: true })
      // Turn ended: one exit fade first, so the composer dock does not jump…
      expect(summary()!.dataset.fading).toBe('true')

      act(() => { vi.advanceTimersByTime(140) })
      // …then the capsule is gone from the composer.
      expect(summary()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the capsule when the turn ends with work left over', () => {
    vi.useFakeTimers()
    try {
      render([quickForgeResult([todo('One', 'completed'), todo('Two', 'pending')], { toolCallId: 'first' })], { idle: true })
      act(() => { vi.advanceTimersByTime(500) })
      expect(summary()).not.toBeNull()
      expect(summary()!.dataset.fading).toBe('false')
    } finally {
      vi.useRealTimers()
    }
  })

  it('retires a finished list on an idle agent even when no agent_end was seen', () => {
    vi.useFakeTimers()
    try {
      // Reload / session switch / resume: `isStreaming` is false from the start
      // and no live `agent_end` ever arrives. A completed list must still leave
      // the composer instead of sitting there for the rest of the session.
      render([quickForgeResult([todo('One', 'completed'), todo('Two', 'completed')], { toolCallId: 'first' })], { idle: true })
      expect(summary()).not.toBeNull()
      expect(summary()!.dataset.fading).toBe('true')

      act(() => { vi.advanceTimersByTime(140) })
      expect(summary()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps an unfinished list visible while the agent is idle', () => {
    render([quickForgeResult([todo('One', 'completed'), todo('Two', 'in_progress')], { toolCallId: 'first' })], { idle: true })

    expect(summary()).not.toBeNull()
    expect(summary()!.dataset.fading).toBe('false')
    expect(items()).toHaveLength(2)
  })

  it('does not flash a retired list back when a new message starts streaming', () => {
    vi.useFakeTimers()
    try {
      const messages = [quickForgeResult([todo('One', 'completed'), todo('Two', 'completed')], { toolCallId: 'first' })]
      render(messages, { idle: true })
      act(() => { vi.advanceTimersByTime(140) })
      expect(summary()).toBeNull()

      // The user sends a new message: `idle` flips to false. The finished list
      // must stay gone rather than reappear for the duration of the round.
      render(messages, { idle: false })
      expect(summary()).toBeNull()

      // …and it stays gone when that round ends without new todos.
      render(messages, { idle: true })
      expect(summary()).toBeNull()

      act(() => { vi.advanceTimersByTime(500) })
      expect(summary()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('brings a retired capsule back for the next round', () => {
    vi.useFakeTimers()
    try {
      render([quickForgeResult([todo('One', 'completed')], { toolCallId: 'first' })], { idle: true })
      act(() => { vi.advanceTimersByTime(140) })
      expect(summary()).toBeNull()

      render([
        quickForgeResult([todo('One', 'completed')], { toolCallId: 'first' }),
        quickForgeResult([todo('Two', 'in_progress')], { toolCallId: 'second' }),
      ])
      expect(summary()).not.toBeNull()
      expect(summary()!.dataset.complete).toBe('false')
      expect(pill()!.getAttribute('aria-expanded')).toBe('false')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a retired list gone when the next round starts inside the exit window', () => {
    vi.useFakeTimers()
    try {
      const messages = [quickForgeResult([todo('One', 'completed'), todo('Two', 'completed')], { toolCallId: 'first' })]

      render(messages, { idle: true })
      // The exit is already running (140ms fade before unmount)…
      expect(summary()!.dataset.fading).toBe('true')

      // …and the next round starts inside that window: goal continuation, a
      // queued message or a background task notification flips `idle` back to
      // false immediately after `agent_end`. The exit must not be cancelled —
      // otherwise the completed list re-arms at full opacity and a session with
      // back-to-back rounds never gets rid of it.
      render(messages, { idle: false })
      expect(summary()).not.toBeNull()
      expect(summary()!.dataset.fading).toBe('true')

      act(() => { vi.advanceTimersByTime(140) })
      expect(summary()).toBeNull()

      // Later rounds without a new todo_write keep it gone.
      render(messages, { idle: true })
      expect(summary()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('resets after an explicit empty snapshot', () => {
    render([quickForgeResult([todo('One', 'in_progress')], { toolCallId: 'first' })])
    expect(pill()!.getAttribute('aria-expanded')).toBe('false')

    render([
      quickForgeResult([todo('One', 'in_progress')], { toolCallId: 'first' }),
      quickForgeResult([], { toolCallId: 'cleared' }),
    ])
    expect(summary()).toBeNull()

    render([quickForgeResult([todo('Fresh', 'pending')], { toolCallId: 'fresh' })])
    expect(summary()).not.toBeNull()
    expect(popover()!.dataset.open).toBe('false')
  })

  it('resets on rollback to no snapshot', () => {
    render([quickForgeResult([todo('One', 'in_progress')], { toolCallId: 'first' })])
    act(() => pill()!.focus())
    expect(popover()!.dataset.open).toBe('true')

    render([])
    expect(summary()).toBeNull()

    render([quickForgeResult([todo('Fresh', 'pending')], { toolCallId: 'fresh' })])
    // The open flags were dropped with the old snapshot: the new pill starts
    // collapsed instead of inheriting the previous focus-latched state.
    expect(popover()!.dataset.open).toBe('false')
  })
})
