// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Assert against i18n keys so the copy can change without touching contracts.
vi.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}(${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')})` : key,
}))

import { MessageList } from '../../src/components/chat/surface/MessageList'
import { ContextCompactionStatusRow } from '../../src/components/chat/surface/ContextCompactionStatusRow'
import { ContextCompactionDecisionRow } from '../../src/components/chat/surface/ContextCompactionDecisionRow'
import type { AgentMessage } from '../../src/components/chat/surface/ChatTypes'
import type { ServerAgentCompactionNotice } from '../../src/lib/server-agent'

/**
 * The in-flight compaction row and the blocking decision row.
 *
 * Both are projections of `state.compactionNotice` rendered *inside* the message
 * list. The behaviours pinned here are exactly the ones the previous
 * decoration-layer approval card could not guarantee:
 * - the summarizing phase is visible at all (it used to be a silent stall);
 * - a settled/cleared notice removes the row in the same render (no dead card
 *   whose clicks return 404);
 * - the row is not scrolled into view by its own code;
 * - the decision row is not actionable in read-only views.
 */
function userMessage(content = ''): AgentMessage {
  return { role: 'user', content, timestamp: 1 }
}

function notice(overrides: Partial<ServerAgentCompactionNotice> = {}): ServerAgentCompactionNotice {
  return {
    phase: 'summarizing',
    usage: { percent: 82 },
    thresholdPercent: 80,
    keepRecentTurns: 0,
    requestedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('ContextCompactionStatusRow', () => {
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

  function render(props: Parameters<typeof ContextCompactionStatusRow>[0]) {
    act(() => {
      root.render(createElement(ContextCompactionStatusRow, props))
    })
    return container.querySelector<HTMLElement>('.quickforge-context-compaction-status')
  }

  it('renders nothing while the pipeline is idle', () => {
    expect(render({ notice: null })).toBeNull()
    expect(render({})).toBeNull()
  })

  it('shows a live summarizing row with the measured percentage', () => {
    const row = render({ notice: notice() })

    expect(row).not.toBeNull()
    expect(row?.getAttribute('data-compaction-phase')).toBe('summarizing')
    expect(row?.getAttribute('data-compaction-percent')).toBe('82')
    // `status`, not `alert`: in-progress work must not interrupt a screen reader.
    expect(row?.getAttribute('role')).toBe('status')
    expect(row?.querySelector('.quickforge-context-compaction-status-label')?.textContent)
      .toBe('compactionSummarizingLabel')
    expect(row?.querySelector('.quickforge-context-compaction-status-label')
      ?.getAttribute('data-quickforge-compaction-streaming')).toBe('true')
  })

  it('stays hidden during the decision phase, which the decision row owns', () => {
    // Two rows saying the same thing next to each other would be noise: while the
    // run waits on the user, only the row with the buttons is shown.
    expect(render({ notice: notice({ phase: 'awaiting_confirmation' }) })).toBeNull()
  })

  it('leaves the message list child sequence unchanged when idle', () => {
    act(() => {
      root.render(createElement(MessageList, {
        messages: [userMessage('q')],
        compactionNotice: null,
      }))
    })
    expect(container.querySelectorAll('.qf-message-list > *')).toHaveLength(1)

    act(() => {
      root.render(createElement(MessageList, {
        messages: [userMessage('q')],
        compactionNotice: notice(),
      }))
    })
    const children = Array.from(container.querySelectorAll<HTMLElement>('.qf-message-list > *'))
    expect(children).toHaveLength(2)
    // Trailing, not interleaved: the summarization happens at the end of the run.
    expect(children[1].className).toBe('quickforge-context-compaction-status')
  })
})

describe('ContextCompactionDecisionRow', () => {
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

  function render(props: Parameters<typeof ContextCompactionDecisionRow>[0]) {
    act(() => {
      root.render(createElement(ContextCompactionDecisionRow, props))
    })
    return container.querySelector<HTMLElement>('.quickforge-context-compaction-decision')
  }

  it('renders nothing outside the decision phase', () => {
    expect(render({ notice: null })).toBeNull()
    expect(render({ notice: notice({ phase: 'summarizing' }) })).toBeNull()
  })

  it('states the measured usage and the threshold, and exposes both actions', () => {
    const onApprove = vi.fn()
    const onReject = vi.fn()
    const row = render({ notice: notice({ phase: 'awaiting_confirmation', approvalId: 'approval-1' }), onApprove, onReject })

    expect(row?.getAttribute('data-compaction-percent')).toBe('82')
    expect(row?.getAttribute('data-compaction-threshold')).toBe('80')
    // The waiting line carries both numbers, so the user can see *why* the
    // question is being asked instead of a bare "compact now?".
    expect(row?.querySelector('.quickforge-context-compaction-decision-waiting')?.textContent)
      .toBe('autoCompactApprovalWaiting(percent=82,threshold=80)')

    const buttons = Array.from(row?.querySelectorAll<HTMLButtonElement>('.quickforge-context-compaction-decision-button') ?? [])
    expect(buttons).toHaveLength(2)
    buttons[0].click()
    buttons[1].click()
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onApprove).toHaveBeenCalledTimes(1)
  })

  it('explains instead of rendering dead buttons in a read-only view', () => {
    const row = render({
      notice: notice({ phase: 'awaiting_confirmation', approvalId: 'approval-1' }),
      readOnly: true,
      disabledReason: 'This view is read-only',
    })

    expect(row?.querySelectorAll('button')).toHaveLength(0)
    expect(row?.querySelector('.quickforge-context-compaction-decision-note')?.textContent)
      .toBe('This view is read-only')
  })

  it('never scrolls itself into view', () => {
    // The removed decoration card called `scrollIntoView`, which yanked users out
    // of history they were reading the moment the threshold was crossed. jsdom
    // has no implementation, so the stub doubles as the assertion target.
    const scrollSpy = vi.fn()
    Element.prototype.scrollIntoView = scrollSpy

    render({ notice: notice({ phase: 'awaiting_confirmation', approvalId: 'approval-1' }) })
    expect(scrollSpy).not.toHaveBeenCalled()
  })
})
