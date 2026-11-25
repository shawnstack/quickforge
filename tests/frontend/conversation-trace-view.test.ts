// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationTraceView, type TraceAgentLike } from '../../src/components/chat/trace/ConversationTraceView'
import type { AgentMessage } from '../../src/components/chat/surface/ChatTypes'

vi.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) => {
    if (!params) return key
    return Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), key)
  },
}))

/**
 * Rendering contract for the trace view: which rows exist, what the states look
 * like, and that the inspector stays hidden until a row is picked (the agreed
 * default — it must not steal width from the ledger on open).
 */

function user(text: string, timestamp: number): AgentMessage {
  return { role: 'user', content: text, timestamp } as AgentMessage
}

function assistant(
  timestamp: number,
  options: { text?: string; toolCalls?: { id: string; name: string; arguments?: Record<string, unknown> }[] } = {},
): AgentMessage {
  const content: unknown[] = []
  if (options.text) content.push({ type: 'text', text: options.text })
  for (const call of options.toolCalls ?? []) {
    content.push({ type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments ?? {} })
  }
  return {
    role: 'assistant',
    content,
    api: 'test',
    provider: 'test',
    model: 'gpt-test',
    usage: {
      input: 100,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 120,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp,
  } as unknown as AgentMessage
}

function toolResult(
  toolCallId: string,
  toolName: string,
  timestamp: number,
  options: { text?: string; isError?: boolean; timing?: { startedAt?: number; finishedAt?: number; durationMs?: number } } = {},
): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: options.text ? [{ type: 'text', text: options.text }] : [],
    details: options.timing ? { quickforgeTiming: options.timing } : undefined,
    isError: options.isError ?? false,
    timestamp,
  } as unknown as AgentMessage
}

function agent(messages: AgentMessage[], pending: string[] = []): TraceAgentLike {
  return { state: { messages, pendingToolCalls: new Set(pending) } }
}

describe('ConversationTraceView', () => {
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

  const render = (props: Parameters<typeof ConversationTraceView>[0]) => {
    act(() => root.render(createElement(ConversationTraceView, props)))
  }

  const q = <T extends Element>(selector: string) => container.querySelector<T>(selector)
  const qa = (selector: string) => Array.from(container.querySelectorAll<HTMLElement>(selector))

  it('renders the empty state only when no model request was recorded', () => {
    render({ agent: agent([]) })

    expect(q('.quickforge-trace')).not.toBeNull()
    expect(q('.quickforge-trace-empty')).not.toBeNull()
    expect(container.textContent).toContain('trace.emptyTitle')
    // The overview + ledger only exist when there is something to draw.
    expect(q('.quickforge-trace-overview')).toBeNull()
    expect(q('.quickforge-trace-ledger')).toBeNull()
  })

  it('still lists a text-only exchange (no tools) — the request and tokens are the point', () => {
    render({ agent: agent([user('hi', 1000), assistant(1100, { text: 'hello' })]) })

    expect(q('.quickforge-trace-empty')).toBeNull()
    expect(qa('.quickforge-trace-row[data-kind="user"]')).toHaveLength(1)
    expect(qa('.quickforge-trace-row[data-kind="step"]')).toHaveLength(1)
    // No tool call ⇒ the tool lane stays empty, but the lane itself exists.
    expect(qa('.quickforge-trace-row[data-kind="tool"]')).toHaveLength(0)
    expect(q('.quickforge-trace-lane[data-lane="tools"]')).not.toBeNull()
  })

  it('renders turn → step → tool rows', () => {
    render({
      agent: agent([
        user('run tests', 1000),
        assistant(1100, { text: 'on it', toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'npm test' } }] }),
        toolResult('c1', 'run_command', 3000, { text: 'ok', timing: { startedAt: 1200, finishedAt: 2900, durationMs: 1700 } }),
      ]),
    })

    expect(qa('.quickforge-trace-turn')).toHaveLength(1)
    expect(qa('.quickforge-trace-row[data-kind="user"]')).toHaveLength(1)
    expect(qa('.quickforge-trace-row[data-kind="step"]')).toHaveLength(1)
    expect(qa('.quickforge-trace-row[data-kind="tool"]')).toHaveLength(1)
    expect(q('[data-trace-row="c1"]')?.getAttribute('data-status')).toBe('done')
    // The duration column shows the recorded 1.7s, not a derived guess.
    expect(q('[data-trace-row="c1"] .quickforge-trace-row-duration')?.textContent).toBe('1.7s')
  })

  it('marks running, error and interrupted rows distinctly', () => {
    render({
      agent: agent(
        [
          user('go', 1000),
          assistant(1100, {
            toolCalls: [
              { id: 'ok', name: 'read_file' },
              { id: 'bad', name: 'edit_file' },
              { id: 'live', name: 'run_command' },
              { id: 'cut', name: 'grep_files' },
            ],
          }),
          toolResult('ok', 'read_file', 1200, { timing: { startedAt: 1150, finishedAt: 1200, durationMs: 50 } }),
          toolResult('bad', 'edit_file', 1300, { isError: true, text: 'boom' }),
        ],
        ['live'],
      ),
    })

    expect(q('[data-trace-row="ok"]')?.getAttribute('data-status')).toBe('done')
    expect(q('[data-trace-row="bad"]')?.getAttribute('data-status')).toBe('error')
    expect(q('[data-trace-row="live"]')?.getAttribute('data-status')).toBe('running')
    expect(q('[data-trace-row="cut"]')?.getAttribute('data-status')).toBe('interrupted')
  })

  it('keeps the inspector hidden until a row is selected, then shows its tabs', () => {
    render({
      agent: agent([
        user('run', 1000),
        assistant(1100, { toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'npm test' } }] }),
        toolResult('c1', 'run_command', 2000, { text: 'ok' }),
      ]),
    })

    expect(q('.quickforge-trace-inspector')).toBeNull()

    act(() => {
      q<HTMLElement>('[data-trace-row="c1"]')?.click()
    })

    const inspector = q('.quickforge-trace-inspector')
    expect(inspector).not.toBeNull()
    expect(inspector?.querySelector('.quickforge-trace-inspector-title')?.textContent).toBeTruthy()
    const tabs = Array.from(inspector?.querySelectorAll('[role="tab"]') ?? []).map((tab) => tab.textContent)
    expect(tabs).toEqual(['trace.tabSummary', 'trace.tabArgs', 'trace.tabResult', 'trace.tabTiming'])
  })

  it('closes the inspector again from its close button', () => {
    render({
      agent: agent([
        user('run', 1000),
        assistant(1100, { toolCalls: [{ id: 'c1', name: 'run_command' }] }),
      ]),
    })

    act(() => {
      q<HTMLElement>('[data-trace-row="c1"]')?.click()
    })
    expect(q('.quickforge-trace-inspector')).not.toBeNull()

    act(() => {
      q<HTMLElement>('.quickforge-trace-icon-button')?.click()
    })
    expect(q('.quickforge-trace-inspector')).toBeNull()
  })

  it('renders three overview lanes and switches layout mode', () => {
    render({
      agent: agent([
        user('a', 1000),
        assistant(2000, { toolCalls: [{ id: 'c1', name: 'read_file' }] }),
        toolResult('c1', 'read_file', 2600, { timing: { startedAt: 2100, finishedAt: 2500, durationMs: 400 } }),
      ]),
    })

    expect(qa('.quickforge-trace-lane')).toHaveLength(3)
    expect(q('.quickforge-trace-lane[data-lane="input"]')).not.toBeNull()
    expect(q('.quickforge-trace-lane[data-lane="model"]')).not.toBeNull()
    expect(q('.quickforge-trace-lane[data-lane="tools"]')).not.toBeNull()

    const durationButton = qa('.quickforge-trace-seg button').find((button) => button.textContent === 'trace.modeDuration')
    expect(durationButton?.getAttribute('aria-pressed')).toBe('true')

    const clockButton = qa('.quickforge-trace-seg button').find((button) => button.textContent === 'trace.modeTime')
    act(() => {
      clockButton?.click()
    })
    expect(clockButton?.getAttribute('aria-pressed')).toBe('true')
    // Clock mode is the only one that draws turn dividers.
    expect(qa('.quickforge-trace-marker').length).toBeGreaterThan(0)
  })

  it('filters rows by the search box without dropping the turns that match', () => {
    render({
      agent: agent([
        user('alpha', 1000),
        assistant(1100, { toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'npm test' } }] }),
        user('beta', 5000),
        assistant(5100, { toolCalls: [{ id: 'c2', name: 'grep_files', arguments: { query: 'needle' } }] }),
      ]),
    })

    const input = q<HTMLInputElement>('.quickforge-trace-search input')
    expect(input).not.toBeNull()

    act(() => {
      // React tracks the previous value on the DOM node; assigning `.value`
      // directly is swallowed, so go through the prototype setter.
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setValue?.call(input, 'needle')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(q('[data-trace-row="c2"]')?.hasAttribute('data-dimmed')).toBe(false)
    expect(q('[data-trace-row="c1"]')?.getAttribute('data-dimmed')).toBe('true')
    expect(container.textContent).toContain('trace.matchCount')
  })

  it('collapses and expands a whole turn from its header', () => {
    render({
      agent: agent([
        user('a', 1000),
        assistant(1100, { toolCalls: [{ id: 'c1', name: 'read_file' }] }),
      ]),
    })

    const head = q<HTMLElement>('.quickforge-trace-turn-head')
    expect(head?.getAttribute('aria-expanded')).toBe('true')

    act(() => {
      head?.click()
    })

    expect(q('.quickforge-trace-turn-head')?.getAttribute('aria-expanded')).toBe('false')
    expect(q('[data-trace-row="c1"]')).toBeNull()
  })

  it('renders a step without tools as a non-collapsible row', () => {
    render({
      agent: agent([
        user('a', 1000),
        assistant(1100, { text: 'plain answer' }),
        assistant(2000, { toolCalls: [{ id: 'c1', name: 'read_file' }] }),
      ]),
    })

    const toggles = qa('.quickforge-trace-step-toggle')
    expect(toggles).toHaveLength(2)
    expect(toggles[0].hasAttribute('disabled')).toBe(true)
    expect(toggles[1].hasAttribute('disabled')).toBe(false)
  })

  /*
   * Ledger window. Ordinary sessions (≤ TRACE_WINDOW_TURNS) must render exactly as
   * before; resident bot sessions reach 700+ turns, and the ledger used to build
   * every turn's DOM up front. Paging back widens the window — it never slides,
   * so nothing the reader is looking at unmounts.
   */
  const turnMessages = (count: number): AgentMessage[] => {
    const messages: AgentMessage[] = []
    for (let i = 1; i <= count; i++) {
      messages.push(user(`turn ${i}`, 1000 + i * 10))
      messages.push(assistant(1005 + i * 10, { text: `reply ${i}` }))
    }
    return messages
  }
  const turnSections = () => qa('.quickforge-trace-turn')
  /**
   * 1-based turn number, read from the view's own `data-trace-row="user-<n>"` — a
   * deterministic attribute that does not go through the (uninterpolating) t() mock.
   * A collapsed turn renders no user row, hence NaN for those.
   */
  const turnIndexes = () => turnSections().map((section) =>
    Number((section.querySelector('[data-trace-row^="user-"]')?.getAttribute('data-trace-row') ?? '').replace(/\D/g, '')),
  )
  const earlierButton = () => q<HTMLButtonElement>('.quickforge-trace-earlier')
  const oneTo = (count: number) => Array.from({ length: count }, (_, i) => i + 1)

  it('does not window a session that fits the initial window', () => {
    render({ agent: agent(turnMessages(30)) })

    expect(earlierButton()).toBeNull()
    // Every turn is mounted, first to last, with nothing hidden behind a button.
    expect(turnIndexes()).toEqual(oneTo(30))
  })

  it('renders only the most recent turns of a long session and offers the earlier ones', () => {
    render({ agent: agent(turnMessages(80)) })

    // Newest turns are what a trace is opened for: the window is anchored at the tail.
    expect(turnIndexes()).toEqual(Array.from({ length: 30 }, (_, i) => 51 + i))
    expect(container.textContent).not.toContain('reply 50')
    // The copy itself is the i18n catalogue's business; here it only has to exist.
    expect(earlierButton()).not.toBeNull()
    // The overview still spans the whole session — it is not windowed.
    expect(q('.quickforge-trace-overview')).not.toBeNull()
  })

  it('widens the window on demand without dropping the turns already shown', () => {
    render({ agent: agent(turnMessages(80)) })
    const mounted = turnSections()
    const indexes = turnIndexes()

    act(() => earlierButton()?.click())

    expect(turnIndexes()).toEqual(Array.from({ length: 60 }, (_, i) => 21 + i))
    // Start moved back, end stayed put: the turns that were mounted are the same DOM nodes.
    const after = turnSections()
    expect(indexes[0]).toBe(51)
    mounted.forEach((section, i) => expect(after[i + 30]).toBe(section))
  })

  it('can page all the way back to the first turn — there is no ceiling', () => {
    render({ agent: agent(turnMessages(80)) })

    act(() => earlierButton()?.click())
    act(() => earlierButton()?.click())
    expect(turnIndexes()).toEqual(oneTo(80))
    expect(earlierButton()).toBeNull()
  })

  it('keeps following the tail while the session grows', () => {
    render({ agent: agent(turnMessages(80)) })
    expect(turnIndexes()[0]).toBe(51)

    // A heartbeat turn arrives: the default window is re-derived — still 30 wide, still at the tail.
    act(() => root.render(createElement(ConversationTraceView, { agent: agent(turnMessages(81)) })))

    expect(turnIndexes()).toEqual(Array.from({ length: 30 }, (_, i) => 52 + i))
  })

  it('inspects a record outside the ledger window when it is picked from the timeline overview', () => {
    render({ agent: agent(turnMessages(80)) })
    expect(turnIndexes()[0]).toBe(51)

    // The overview covers the whole session, so most of its records sit outside the
    // ledger window. Picking one only selects it (the view has no scroll-to-row), and
    // the inspector reads from the full row list — it must still show that record.
    const spans = qa<HTMLButtonElement>('.quickforge-trace-span[data-lane="input"]')
    expect(spans.length).toBe(80)
    act(() => spans[9].click())

    const inspector = q('.quickforge-trace-inspector')
    expect(inspector).not.toBeNull()
    expect(inspector?.textContent).toContain('turn 10')
    // The ledger window is untouched: selecting is not paging.
    expect(turnIndexes()[0]).toBe(51)
  })

  /*
   * Overview coalescing. Spans narrower than the layout minimum necessarily
   * overlap, so past ~111 records per lane the later ones cover the earlier
   * ones — invisible and unclickable, yet each still a button. They are folded
   * into aggregate blocks (data-aggregate = member count).
   */
  const slowFastTurns = (count: number): AgentMessage[] => {
    const messages: AgentMessage[] = []
    let ts = 1_700_000_000_000
    for (let i = 1; i <= count; i++) {
      ts += 1000
      messages.push(user(`turn ${i}`, ts))
      ts += 100
      messages.push(assistant(ts, {
        toolCalls: [{ id: `slow-${i}`, name: 'run_command' }, { id: `fast-${i}`, name: 'read_file' }],
      }))
      ts += 5000
      messages.push(toolResult(`slow-${i}`, 'run_command', ts, { timing: { startedAt: ts - 4900, finishedAt: ts - 100, durationMs: 4800 } }))
      ts += 50
      messages.push(toolResult(`fast-${i}`, 'read_file', ts, { timing: { startedAt: ts - 40, finishedAt: ts - 5, durationMs: 35 } }))
    }
    return messages
  }
  const aggregateSpans = () => qa<HTMLElement>('.quickforge-trace-span[data-aggregate]')

  it('does not coalesce a lane that still fits', () => {
    render({ agent: agent(turnMessages(80)) })

    // 80 user + 80 model records spread over the plot without touching.
    expect(aggregateSpans()).toHaveLength(0)
    expect(qa('.quickforge-trace-span')).toHaveLength(160)
  })

  it('folds an overcrowded lane into aggregate blocks instead of hidden buttons', () => {
    render({ agent: agent(turnMessages(200)) })

    // One block per lane, each standing for its 200 records: 400 records → 2 nodes.
    const blocks = aggregateSpans()
    expect(blocks).toHaveLength(2)
    expect(blocks.map((block) => block.dataset.aggregate)).toEqual(['200', '200'])
    expect(qa('.quickforge-trace-span')).toHaveLength(2)
  })

  it('opens the slowest record of a block when the block is picked', () => {
    render({ agent: agent(slowFastTurns(80)) })

    // Tools-lane blocks: each holds the slow and the fast call of one step.
    const blocks = qa<HTMLElement>('.quickforge-trace-span[data-lane="tools"][data-aggregate]')
    expect(blocks.length).toBeGreaterThan(0)
    const block = blocks[0]
    act(() => (block as HTMLElement & { click: () => void }).click())

    // Whichever step this block stands for, the inspector opens the call that took
    // the time — never the fast sibling.
    const inspector = q('.quickforge-trace-inspector')
    expect(inspector).not.toBeNull()
    const text = inspector?.textContent ?? ''
    const picked = /slow-(\d+)/.exec(text)?.[1]
    expect(picked).toBeTruthy()
    expect(text).toContain('slow-' + picked)
    expect(text).not.toContain('fast-' + picked)
    expect(text).toContain('4.8s')
  })
})
