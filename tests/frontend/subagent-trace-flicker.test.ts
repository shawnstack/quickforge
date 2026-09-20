import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubagentRunPayload } from '../../src/lib/subagent-run-detail'

// Deterministic i18n + tool display settings (same pattern as
// subagent-run-detail-react.test.ts).
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/lib/tool-display-settings', () => ({ getCachedToolDisplaySettings: () => ({ toolDisplayMode: 'concise' }) }))

// The folding layer is the thing under test: assert *when* it runs, without a DOM.
const folding = vi.hoisted(() => ({
  releaseProcessGroups: vi.fn(() => ({ groups: 0, restored: 0, dropped: 0 })),
  decorateProcessBlocks: vi.fn(),
}))
vi.mock('@/components/chat/panel-decoration/process-folding', () => folding)

// Probe the streaming context the trace provides (the real MessageList is not
// needed here; the other suites cover its rendering).
vi.mock('@/components/chat/surface/MessageList', async () => {
  const { createElement: create } = await import('react')
  const { useAssistantStreaming } = await import('@/components/chat/surface/surface-context')
  return {
    MessageList: () => create('div', { 'data-probe-streaming': String(useAssistantStreaming()) }),
  }
})

import { SubagentTrace } from '../../src/components/workspace/SubagentRunDetailContent'
import { subagentTraceStructureSignature } from '../../src/components/workspace/subagent-trace-structure'

function payload(overrides: Partial<SubagentRunPayload> = {}): SubagentRunPayload {
  return {
    runId: 'run-main', canonicalToolCallId: 'run-main', name: 'explore', label: 'Explore', task: 'Read project',
    context: 'Keep focus', expectedOutput: 'Report findings', status: 'running', statusLabel: 'Running',
    allowedTools: ['run_command'], pendingToolCalls: ['cmd'], tools: [], traceMessages: [],
    input: '{"task":"Read project"}', details: '{"toolCalls":1}', output: '', errorMessage: '',
    detailed: false, fingerprint: 'initial', ...overrides,
  }
}

/** One assistant message whose only rendered part is a text chunk. */
function textTrace(text: string) {
  return [{ role: 'assistant', content: [{ type: 'text', text }], timestamp: 1, stopReason: 'stop' }]
}

/** The same assistant message with an extra tool-call part appended. */
function textAndToolTrace(text: string) {
  return [{
    role: 'assistant',
    content: [
      { type: 'text', text },
      { type: 'toolCall', id: 'cmd', name: 'run_command', arguments: { command: 'npm test' } },
    ],
    timestamp: 1,
    stopReason: 'toolUse',
  }]
}

type TraceInstance = {
  props: { payload: SubagentRunPayload }
  root: { current: unknown }
  componentDidMount(): void
  componentDidUpdate(): void
  componentWillUnmount(): void
  shouldComponentUpdate(nextProps: { payload: SubagentRunPayload }): boolean
  /** React passes *prev* props; the commit's props are on `instance.props`. */
  getSnapshotBeforeUpdate(prevProps: { payload: SubagentRunPayload }): unknown
  render(): unknown
}

type RenderedElement = { props: { value?: boolean; children?: RenderedElement; pendingToolCalls?: ReadonlySet<string> } }

/** 从 render() 结果里取 MessageList 元素的 props（div > Provider > MessageList）。 */
function traceMessageListProps(rendered: unknown): RenderedElement['props'] {
  const outer = rendered as RenderedElement
  const provider = outer.props.children as RenderedElement
  const messageList = provider.props.children as RenderedElement
  return messageList.props
}

/**
 * A `SubagentTrace` with its DOM ref pointed at a stub message list, so the
 * lifecycle can be driven directly (the suite runs without a DOM).
 */
function mountedTrace(value: SubagentRunPayload): TraceInstance {
  const list = { isConnected: true, querySelectorAll: () => [] }
  const instance = new SubagentTrace({ payload: value }) as unknown as TraceInstance
  instance.root = { current: { querySelector: () => list } }
  instance.componentDidMount()
  return instance
}

beforeEach(() => {
  folding.releaseProcessGroups.mockClear()
  folding.decorateProcessBlocks.mockClear()
})

describe('subagent trace structure signature', () => {
  it('ignores content-only growth inside an already rendered part', () => {
    expect(subagentTraceStructureSignature(textTrace('Hello')))
      .toBe(subagentTraceStructureSignature(textTrace('Hello, longer answer')))
  })

  it('ignores chunks and rows the message list never renders', () => {
    const withBlankChunk = [{ role: 'assistant', content: [{ type: 'text', text: '   ' }, { type: 'text', text: 'Kept' }], timestamp: 1 }]
    // A whitespace-only chunk renders nothing, whatever its whitespace is.
    const withEmptyChunk = [{ role: 'assistant', content: [{ type: 'text', text: '' }, { type: 'text', text: 'Kept' }], timestamp: 1 }]
    expect(subagentTraceStructureSignature(withBlankChunk))
      .toBe(subagentTraceStructureSignature(withEmptyChunk))

    // Lookup-only rows (tool results, artifacts) never own DOM nodes.
    const withLookupRows = [
      ...withBlankChunk,
      { role: 'toolResult', toolCallId: 'cmd', content: [{ type: 'text', text: 'log' }], timestamp: 2 },
      { role: 'artifact', action: 'create', filename: 'a.md', timestamp: '3' },
    ]
    expect(subagentTraceStructureSignature(withLookupRows))
      .toBe(subagentTraceStructureSignature(withBlankChunk))
  })

  it('changes when a rendered part or a message row changes', () => {
    const base = subagentTraceStructureSignature(textTrace('Hello'))
    expect(subagentTraceStructureSignature(textAndToolTrace('Hello'))).not.toBe(base)
    expect(subagentTraceStructureSignature([...textTrace('Hello'), ...textTrace('Second turn')])).not.toBe(base)
  })

  it('changes when a sliding window swaps same-shaped rows for new identities', () => {
    const windowed = (timestamp: number) => [
      { role: 'user', content: 'Question', timestamp },
      { role: 'assistant', content: [{ type: 'text', text: 'Answer' }], timestamp: timestamp + 1 },
    ]

    // Identical roles and part shapes, different rows: a role-only signature
    // missed the swap and let React replace a row a folded group still owned.
    expect(subagentTraceStructureSignature(windowed(20)))
      .not.toBe(subagentTraceStructureSignature(windowed(10)))

    // Same rows, only text growth: still content-only, no release.
    const grown = windowed(20).map((message) => (message.role === 'assistant'
      ? { ...message, content: [{ type: 'text', text: 'Answer, longer' }] }
      : message))
    expect(subagentTraceStructureSignature(grown)).toBe(subagentTraceStructureSignature(windowed(20)))
  })

  it('ignores a tool result arriving for an already rendered tool call', () => {
    const base = [
      { role: 'assistant', content: [{ type: 'toolCall', id: 'cmd', name: 'run_command', arguments: { command: 'npm test' } }], timestamp: 1, stopReason: 'toolUse' },
    ]
    const withResult = [
      ...base,
      { role: 'toolResult', toolCallId: 'cmd', content: [{ type: 'text', text: 'passed' }], timestamp: 2 },
    ]

    expect(subagentTraceStructureSignature(withResult)).toBe(subagentTraceStructureSignature(base))
  })
})

describe('SubagentTrace folding ownership', () => {
  it('never releases while the rendered structure is unchanged', () => {
    const prev = payload({ traceMessages: textTrace('Tick 1') })
    const instance = mountedTrace(prev)
    folding.releaseProcessGroups.mockClear()
    folding.decorateProcessBlocks.mockClear()

    // A stream tick that only grows the text of an existing part. Drive the
    // React contract: the new props are already on the instance and the
    // lifecycle receives the *previous* props.
    instance.props = { payload: payload({ fingerprint: 'tick-2', traceMessages: textTrace('Tick 2 longer') }) }
    instance.getSnapshotBeforeUpdate({ payload: prev })
    instance.componentDidUpdate()

    expect(folding.releaseProcessGroups).not.toHaveBeenCalled()
    expect(folding.decorateProcessBlocks).toHaveBeenCalledTimes(1)
  })

  it('releases on the commit whose structure changed (no off-by-one)', () => {
    const prev = payload({ traceMessages: textTrace('Tick 1') })
    const instance = mountedTrace(prev)
    folding.releaseProcessGroups.mockClear()

    // The commit that changes the rendered structure must release *now*, keyed
    // off `this.props` (React hands `getSnapshotBeforeUpdate` the previous
    // props). Keying off the parameter released one commit late.
    instance.props = { payload: payload({ fingerprint: 'tick-2', traceMessages: textAndToolTrace('Tick 1') }) }
    instance.getSnapshotBeforeUpdate({ payload: prev })

    expect(folding.releaseProcessGroups).toHaveBeenCalledTimes(1)
  })

  it('releases on a window slide that swaps rows of the same shape', () => {
    const windowed = (timestamp: number) => [
      { role: 'user', content: 'Question', timestamp },
      { role: 'assistant', content: [{ type: 'text', text: 'Answer' }], timestamp: timestamp + 1 },
    ]
    const prev = payload({ traceMessages: windowed(10) })
    const instance = mountedTrace(prev)
    folding.releaseProcessGroups.mockClear()

    // Same roles and part shapes, different rows: the swap must release *now* so
    // React is not left removing rows a folded group owns.
    instance.props = { payload: payload({ fingerprint: 'window-2', traceMessages: windowed(20) }) }
    instance.getSnapshotBeforeUpdate({ payload: prev })

    expect(folding.releaseProcessGroups).toHaveBeenCalledTimes(1)
  })

  it('does not treat the running→done flip as a structural change', () => {
    const prev = payload({ status: 'running', traceMessages: textTrace('Tick 1') })
    const instance = mountedTrace(prev)
    folding.releaseProcessGroups.mockClear()

    // Finishing the run only turns on code-block previews inside already
    // rendered nodes; the streaming flag is not part of the structure gate.
    instance.props = { payload: payload({ status: 'done', traceMessages: textTrace('Tick 1') }) }
    instance.getSnapshotBeforeUpdate({ payload: prev })

    expect(folding.releaseProcessGroups).not.toHaveBeenCalled()
  })

  it('re-folds inside the commit, never through a timer or animation frame', () => {
    vi.useFakeTimers()
    try {
      const instance = mountedTrace(payload({ traceMessages: textTrace('Tick 1') }))
      folding.decorateProcessBlocks.mockClear()

      instance.componentDidUpdate()

      expect(folding.decorateProcessBlocks).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(100)
      expect(folding.decorateProcessBlocks).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bails out of Inspector re-renders that carry the same payload snapshot', () => {
    const value = payload({ traceMessages: textTrace('Tick 1') })
    const instance = mountedTrace(value)

    expect(instance.shouldComponentUpdate({ payload: value })).toBe(false)
    expect(instance.shouldComponentUpdate({ payload: payload({ fingerprint: 'tick-2' }) })).toBe(true)
  })

  it('provides the streaming flag to the trace subtree instead of relying on the DOM', () => {
    const running = renderToStaticMarkup(createElement(SubagentTrace, { payload: payload({ status: 'running' }) }))
    expect(running).toContain('data-quickforge-subagent-streaming="true"')
    expect(running).toContain('data-probe-streaming="true"')

    const done = renderToStaticMarkup(createElement(SubagentTrace, { payload: payload({ status: 'done' }) }))
    expect(done).toContain('data-probe-streaming="false"')
  })

  it('reuses the pendingToolCalls Set identity while the pending ids are unchanged', () => {
    const instance = mountedTrace(payload({ traceMessages: textTrace('Tick 1') }))
    const first = traceMessageListProps(instance.render())
    expect(first.pendingToolCalls).toBeInstanceOf(Set)

    // 内容型 tick（新 payload 对象、pending 集合不变）：Set 身份必须复用，
    // 否则 MessageList 下每个 memo 化的 AssistantMessage 行都会因 props 身份
    // 比较失败而整条 trace 重渲染。
    instance.props = { payload: payload({ fingerprint: 'tick-2', traceMessages: textTrace('Tick 2 longer') }) }
    const second = traceMessageListProps(instance.render())
    expect(second.pendingToolCalls).toBe(first.pendingToolCalls)

    // pending 真变了：换新 Set，内容正确。
    instance.props = { payload: payload({ fingerprint: 'tick-3', pendingToolCalls: ['cmd', 'probe'] }) }
    const third = traceMessageListProps(instance.render())
    expect(third.pendingToolCalls).not.toBe(first.pendingToolCalls)
    expect([...(third.pendingToolCalls ?? [])]).toEqual(['cmd', 'probe'])
  })
})
