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
    // Same content, different key: the renderer needs this to show the
    // "updated" marker for a newer round with unchanged todos.
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

describe('TodoWrite capsule rendering', () => {
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
    // The component now receives the pre-resolved snapshot (the surface derives
    // it once per agent snapshot and caches it by message-array identity); these
    // cases feed it the same lookup the surface uses.
    const snapshot = readLatestTodoWriteSnapshot(messages)
    act(() => {
      root.render(createElement(TodoWriteSummary, { snapshot, idle: options.idle ?? false }))
    })
  }

  const summary = () => container.querySelector<HTMLElement>('.quickforge-todo-summary')
  const toggle = () => container.querySelector<HTMLButtonElement>('.quickforge-todo-summary-toggle')
  const ring = () => container.querySelector<HTMLElement>('.quickforge-todo-summary-ring')
  const body = () => container.querySelector<HTMLElement>('.quickforge-todo-summary-body')
  const compactStats = () => container.querySelector<HTMLElement>('.quickforge-todo-summary-stats-compact')
  const updated = () => container.querySelector<HTMLElement>('.quickforge-todo-summary-updated')
  const items = () => Array.from(container.querySelectorAll<HTMLElement>('.quickforge-todo-summary-item'))

  it('renders nothing without a snapshot', () => {
    render([])
    expect(summary()).toBeNull()
    render([quickForgeResult([])])
    expect(summary()).toBeNull()
  })

  it('wraps the toggle in a row and renders ring, dual stats, spacer and chevron in order', () => {
    render([quickForgeResult([todo('One', 'in_progress'), todo('Two', 'pending')])])

    expect(Array.from(summary()!.children).map((child) => child.className)).toEqual([
      'quickforge-todo-summary-toggle-row',
      'quickforge-todo-summary-body',
    ])
    expect(Array.from(toggle()!.children).map((child) => child.className)).toEqual([
      'quickforge-todo-summary-ring',
      'quickforge-todo-summary-heading',
      'quickforge-todo-summary-stats',
      'quickforge-todo-summary-stats-compact',
      'quickforge-todo-summary-updated',
      'quickforge-todo-summary-spacer',
      'quickforge-todo-summary-chevron',
    ])
    expect(ring()!.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('.quickforge-todo-summary-spacer')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('shows the aria-hidden compact count and drives the progress arc from completion', () => {
    render([quickForgeResult([todo('One', 'completed'), todo('Two', 'in_progress')])])

    expect(compactStats()!.textContent).toBe('1/2')
    expect(compactStats()!.getAttribute('aria-hidden')).toBe('true')
    expect(ring()!.style.getPropertyValue('--quickforge-todo-ring-offset')).toBe('28.27')
    expect(summary()!.dataset.complete).toBe('false')
    expect(summary()!.dataset.running).toBe('true')
  })

  it('marks completion and zeroes the arc when every todo is completed', () => {
    render([quickForgeResult([todo('One', 'completed')])])

    expect(summary()!.dataset.complete).toBe('true')
    expect(summary()!.dataset.running).toBe('false')
    expect(ring()!.style.getPropertyValue('--quickforge-todo-ring-offset')).toBe('0.00')
  })

  it('starts expanded so the task list is visible without a click', () => {
    render([quickForgeResult([todo('One', 'in_progress'), todo('Two', 'pending')])])

    expect(toggle()!.getAttribute('aria-expanded')).toBe('true')
    expect(body()!.hidden).toBe(false)
    expect(summary()!.dataset.expanded).toBe('true')
  })

  it('wraps the list in the collapsible body inner container', () => {
    render([quickForgeResult([todo('One', 'in_progress')])])

    expect(Array.from(body()!.children).map((child) => child.className)).toEqual(['quickforge-todo-summary-body-inner'])
    // The body is the list and nothing else: no per-status tally, no "working
    // on" restatement — each row already carries its own status.
    expect(Array.from(body()!.firstElementChild!.children).map((child) => child.className)).toEqual([
      'quickforge-todo-summary-list',
    ])
    expect(items()).toHaveLength(1)
  })

  it('renders no summary line above the list', () => {
    render([quickForgeResult([todo('Done', 'completed'), todo('Running', 'in_progress')])])

    expect(container.querySelector('.quickforge-todo-summary-chips')).toBeNull()
    expect(container.querySelector('.quickforge-todo-summary-chip')).toBeNull()
    expect(container.querySelector('.quickforge-todo-summary-current')).toBeNull()
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
    // The status word stays available to screen readers even on mobile, where
    // the visible label is hidden by CSS.
    expect(items()[1].querySelector('.quickforge-todo-summary-status-label')!.textContent).toBe('todoWriteStatusInProgress')
  })

  it('expands and collapses through the toggle', () => {
    render([quickForgeResult([todo('One', 'in_progress')])])
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true')

    act(() => toggle()!.click())
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false')
    expect(body()!.hidden).toBe(true)
    expect(summary()!.dataset.expanded).toBe('false')

    act(() => toggle()!.click())
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true')
    expect(body()!.hidden).toBe(false)
  })

  it('keeps the DOM nodes stable across snapshot updates so the arc animates', () => {
    render([quickForgeResult([todo('One', 'in_progress')], { toolCallId: 'first' })])
    const firstRing = ring()
    const firstToggle = toggle()
    expect(firstRing!.style.getPropertyValue('--quickforge-todo-ring-offset')).toBe('56.55')

    render([
      quickForgeResult([todo('One', 'in_progress')], { toolCallId: 'first' }),
      quickForgeResult([todo('One', 'completed')], { toolCallId: 'second' }),
    ])

    // Same nodes ⇒ the CSS transition sees the previous offset and animates.
    expect(ring()).toBe(firstRing)
    expect(toggle()).toBe(firstToggle)
    expect(firstRing!.style.getPropertyValue('--quickforge-todo-ring-offset')).toBe('0.00')
  })

  it('re-expands on a new snapshot round even after the user collapsed', () => {
    vi.useFakeTimers()
    try {
      render([quickForgeResult([todo('One', 'in_progress')], { toolCallId: 'first' })])
      act(() => toggle()!.click())
      expect(toggle()!.getAttribute('aria-expanded')).toBe('false')

      render([
        quickForgeResult([todo('One', 'in_progress')], { toolCallId: 'first' }),
        quickForgeResult([todo('One', 'completed'), todo('Two', 'pending')], { toolCallId: 'second' }),
      ])
      expect(toggle()!.getAttribute('aria-expanded')).toBe('true')
      expect(updated()!.hidden).toBe(false)

      act(() => { vi.advanceTimersByTime(1800) })
      expect(updated()!.hidden).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks a newer tool snapshot updated even when its todo content is unchanged', () => {
    render([quickForgeResult([todo('Stable', 'in_progress')], { toolCallId: 'first' })])
    expect(updated()!.hidden).toBe(true)

    render([
      quickForgeResult([todo('Stable', 'in_progress')], { toolCallId: 'first' }),
      quickForgeResult([todo('Stable', 'in_progress')], { toolCallId: 'second' }),
    ])
    expect(updated()!.hidden).toBe(false)
  })

  it('keeps the completed list visible until the turn ends, then fades it out and unmounts', () => {
    vi.useFakeTimers()
    try {
      render([quickForgeResult([todo('One', 'completed')], { toolCallId: 'first' })])
      // A finished list is still shown: the user gets to read the confirmation.
      expect(summary()).not.toBeNull()
      expect(toggle()!.getAttribute('aria-expanded')).toBe('true')
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
      expect(toggle()!.getAttribute('aria-expanded')).toBe('true')
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
    act(() => toggle()!.click())
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false')

    render([
      quickForgeResult([todo('One', 'in_progress')], { toolCallId: 'first' }),
      quickForgeResult([], { toolCallId: 'cleared' }),
    ])
    expect(summary()).toBeNull()

    render([quickForgeResult([todo('Fresh', 'pending')], { toolCallId: 'fresh' })])
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true')
  })

  it('resets on rollback to no snapshot', () => {
    render([quickForgeResult([todo('One', 'in_progress')], { toolCallId: 'first' })])
    act(() => toggle()!.click())

    render([])
    expect(summary()).toBeNull()

    render([quickForgeResult([todo('Fresh', 'pending')], { toolCallId: 'fresh' })])
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true')
  })
})
