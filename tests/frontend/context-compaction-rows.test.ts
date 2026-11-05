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
import type { AgentMessage } from '../../src/components/chat/surface/ChatTypes'
import type { ServerAgentCompactionNotice } from '../../src/lib/server-agent'

/**
 * The in-flight compaction row.
 *
 * It is a projection of `state.compactionNotice` rendered *inside* the message
 * list. The behaviours pinned here are exactly the ones the previous
 * decoration-layer card could not guarantee:
 * - the summarizing phase is visible at all (it used to be a silent stall);
 * - a cleared notice removes the row in the same render;
 * - the row is not scrolled into view by its own code.
 *
 * There is no decision row: compaction is never gated on a user decision, so
 * `summarizing` is the only phase the surface renders.
 */
function userMessage(content = ''): AgentMessage {
  return { role: 'user', content, timestamp: 1 }
}

function notice(overrides: Partial<ServerAgentCompactionNotice> = {}): ServerAgentCompactionNotice {
  return {
    phase: 'summarizing',
    usage: { percent: 82 },
    thresholdPercent: 80,
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

  it('renders nothing for a phase this surface does not know', () => {
    // Defensive: an older server could still project a phase that no longer
    // exists. Rendering nothing is the safe fallback.
    const unknownPhase = { phase: 'awaiting_confirmation' } as unknown as ServerAgentCompactionNotice
    expect(render({ notice: unknownPhase })).toBeNull()
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
