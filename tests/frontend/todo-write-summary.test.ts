// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  extractLatestTodoWriteSnapshot,
  readLatestTodoWriteSnapshot,
  isFinalTodoSnapshot,
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

  function render(messages: TodoWriteMessage[]) {
    // The component now receives the pre-resolved snapshot (the surface derives
    // it once per agent snapshot and caches it by message-array identity); these
    // cases feed it the same lookup the surface uses.
    const snapshot = readLatestTodoWriteSnapshot(messages)
    act(() => {
      root.render(createElement(TodoWriteSummary, { snapshot }))
    })
  }

  const summary = () => container.querySelector<HTMLElement>('.quickforge-todo-summary')
  const toggle = () => container.querySelector<HTMLButtonElement>('.quickforge-todo-summary-toggle')
  const ring = () => container.querySelector<HTMLElement>('.quickforge-todo-summary-ring')
  const body = () => container.querySelector<HTMLElement>('.quickforge-todo-summary-body')
  const compactStats = () => container.querySelector<HTMLElement>('.quickforge-todo-summary-stats-compact')
  const updated = () => container.querySelector<HTMLElement>('.quickforge-todo-summary-updated')

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
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false')
  })

  it('wraps the list in the collapsible body inner container', () => {
    render([quickForgeResult([todo('One', 'in_progress')])])

    expect(Array.from(body()!.children).map((child) => child.className)).toEqual(['quickforge-todo-summary-body-inner'])
    expect(container.querySelectorAll('.quickforge-todo-summary-item')).toHaveLength(1)
    expect(body()!.hidden).toBe(true)
  })

  it('expands and collapses through the toggle', () => {
    render([quickForgeResult([todo('One', 'in_progress')])])
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false')
    expect(body()!.hidden).toBe(true)

    act(() => toggle()!.click())
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true')
    expect(body()!.hidden).toBe(false)
    expect(summary()!.dataset.expanded).toBe('true')

    act(() => toggle()!.click())
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false')
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

  it('starts collapsed and stays collapsed when a fully completed snapshot arrives', () => {
    render([quickForgeResult([todo('One', 'completed')], { toolCallId: 'first' })])
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false')

    render([
      quickForgeResult([todo('One', 'completed')], { toolCallId: 'first' }),
      quickForgeResult([todo('One', 'completed'), todo('Two', 'completed')], { toolCallId: 'second' }),
    ])
    // A finished round never sits expanded above the composer.
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps the user collapsed after a new unfinished snapshot and briefly marks it updated', () => {
    vi.useFakeTimers()
    try {
      render([quickForgeResult([todo('One', 'in_progress')], { toolCallId: 'first' })])
      act(() => toggle()!.click())
      act(() => toggle()!.click())
      expect(toggle()!.getAttribute('aria-expanded')).toBe('false')

      render([
        quickForgeResult([todo('One', 'in_progress')], { toolCallId: 'first' }),
        quickForgeResult([todo('One', 'completed'), todo('Two', 'pending')], { toolCallId: 'second' }),
      ])
      expect(toggle()!.getAttribute('aria-expanded')).toBe('false')
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

  it('resets after an explicit empty snapshot', () => {
    render([quickForgeResult([todo('One', 'in_progress')], { toolCallId: 'first' })])
    act(() => toggle()!.click())
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true')

    render([
      quickForgeResult([todo('One', 'in_progress')], { toolCallId: 'first' }),
      quickForgeResult([], { toolCallId: 'cleared' }),
    ])
    expect(summary()).toBeNull()

    render([quickForgeResult([todo('Fresh', 'pending')], { toolCallId: 'fresh' })])
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false')
  })

  it('resets on rollback to no snapshot', () => {
    render([quickForgeResult([todo('One', 'in_progress')], { toolCallId: 'first' })])
    act(() => toggle()!.click())

    render([])
    expect(summary()).toBeNull()

    render([quickForgeResult([todo('Fresh', 'pending')], { toolCallId: 'fresh' })])
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false')
  })
})
