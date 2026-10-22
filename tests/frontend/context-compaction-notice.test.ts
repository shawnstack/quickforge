// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Assert against i18n keys so the copy can change without touching contracts.
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

import { MessageList } from '../../src/components/chat/surface/MessageList'
import {
  resolveCompactionBoundary,
  ContextCompactionNotice,
} from '../../src/components/chat/surface/ContextCompactionNotice'
import { isRenderableMessage } from '../../src/components/chat/surface/content-parts'
import type { AgentMessage } from '../../src/components/chat/surface/ChatTypes'

/**
 * The context-compaction divider used to be injected by
 * `syncContextCompactionNotice`, which found-or-created its node, rebuilt the
 * `innerHTML` when the summary text changed, bound `<details>` handlers by hand
 * and then re-positioned itself among the message rows by walking the DOM.
 *
 * React renders it now, so these cases pin two contracts:
 * - `resolveCompactionBoundary` (pure): which rendered row index the divider
 *   belongs before, including the toolResult, window-offset and stale-state
 *   edges the decoration used to encode in DOM traversal;
 * - the rendered result: the notice is a keyed sibling at that index, and the
 *   disclosure state is component state.
 */
function userMessage(content = ''): AgentMessage {
  return { role: 'user', content, timestamp: 1 }
}

function assistantMessage(content = ''): AgentMessage {
  return { role: 'assistant', content: [{ type: 'text', text: content }], timestamp: 2 } as AgentMessage
}

function toolResultMessage(): AgentMessage {
  return { role: 'toolResult', toolCallId: 'call-1', toolName: 'read', content: [], timestamp: 3 } as AgentMessage
}

function boundary(messages: AgentMessage[], compactedUpToIndex: number, messageIndexOffset = 0, hasSummary = false) {
  return resolveCompactionBoundary({
    compaction: { compactedUpToIndex, summaryMessage: hasSummary ? assistantMessage('summary body') : undefined },
    messages,
    messageIndexOffset,
    isRenderable: isRenderableMessage,
  })
}

describe('context compaction boundary', () => {
  it('places the divider before the row right after the compacted range', () => {
    // Boundary 12 with a 10-message window offset means "the first two rendered
    // messages were compacted", so the divider belongs before rendered row 2.
    expect(boundary([userMessage(), assistantMessage(), userMessage(), assistantMessage()], 12, 10))
      .toEqual({ kind: 'at', rowIndex: 2, boundaryIndex: 2, summaryText: '' })
  })

  it('places the divider at the window top when the boundary is at or before the window start', () => {
    expect(boundary([userMessage(), assistantMessage()], 8, 10))
      .toEqual({ kind: 'at', rowIndex: 0, boundaryIndex: 0, summaryText: '' })
  })

  it('does not snap the boundary back to the containing user turn', () => {
    // Boundary 4 lands on the toolResult: the divider follows it and therefore
    // sits before the next standalone row (the 4th renderable message).
    const messages = [
      userMessage('first question'),
      assistantMessage('first answer'),
      userMessage('kept question'),
      assistantMessage('tool call'),
      toolResultMessage(),
      assistantMessage('continued answer'),
    ]

    expect(boundary(messages, 4)).toEqual({ kind: 'at', rowIndex: 4, boundaryIndex: 4, summaryText: '' })
  })

  it('hides the divider when the boundary is after the rendered window', () => {
    // Only a stale state (messages shrank on rollback) can put the boundary past
    // the window end; the decoration kept it hidden and so does this.
    expect(boundary([userMessage(), userMessage()], 15, 10)).toEqual({ kind: 'hidden' })
  })

  it('trails the window end when the boundary lands on it (latest turn compacted)', () => {
    const messages = [userMessage('first'), assistantMessage('answer'), userMessage('latest')]

    // rowIndex === 3 === renderable count → rendered after the last row.
    expect(boundary(messages, 3)).toEqual({ kind: 'at', rowIndex: 3, boundaryIndex: 3, summaryText: '' })
  })

  it('keeps the divider after the compacted latest question once the reply is appended', () => {
    const messages = [userMessage('first'), assistantMessage('answer'), userMessage('latest'), assistantMessage('reply')]

    expect(boundary(messages, 3)).toEqual({ kind: 'at', rowIndex: 3, boundaryIndex: 3, summaryText: '' })
  })

  it('trails the window end inside a scrolled window', () => {
    const messages = [assistantMessage('earlier'), userMessage('latest'), assistantMessage('reply')]

    expect(boundary(messages, 13, 10)).toEqual({ kind: 'at', rowIndex: 3, boundaryIndex: 3, summaryText: '' })
  })

  it('hides the divider without compaction or without messages', () => {
    expect(resolveCompactionBoundary({ compaction: null, messages: [userMessage()], messageIndexOffset: 0, isRenderable: isRenderableMessage }))
      .toEqual({ kind: 'hidden' })
    expect(boundary([], 3)).toEqual({ kind: 'hidden' })
    expect(boundary([userMessage()], 0)).toEqual({ kind: 'hidden' })
  })
})

describe('context compaction notice rendering', () => {
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

  function renderList(messages: AgentMessage[], compactedUpToIndex: number, messageIndexOffset = 0, withCompaction = true) {
    const resolved = withCompaction
      ? boundary(messages, compactedUpToIndex, messageIndexOffset, true)
      : ({ kind: 'hidden' } as const)
    act(() => {
      root.render(createElement(MessageList, {
        messages,
        messageIndexOffset,
        compactionBoundary: resolved,
      }))
    })
    return Array.from(container.querySelectorAll<HTMLElement>('.qf-message-list > *'))
  }

  it('renders the divider as a keyed child at the resolved row index', () => {
    const children = renderList([userMessage('a'), assistantMessage('b'), userMessage('c')], 2)

    expect(children).toHaveLength(4)
    expect(children[2].className).toBe('quickforge-context-compaction-notice')
    // The rows keep the order and identity React owns; the divider is inserted
    // between the second and third row, exactly where the decoration put it.
    expect(children[0].className).toContain('qf-user-message')
    expect(children[1].className).toContain('qf-assistant-message')
    expect(children[3].className).toContain('qf-user-message')
  })

  it('renders the divider after the last row when the latest turn was compacted', () => {
    const children = renderList([userMessage('a'), assistantMessage('b')], 2)

    expect(children).toHaveLength(3)
    expect(children[2].className).toBe('quickforge-context-compaction-notice')
  })

  it('renders no divider without compaction', () => {
    const children = renderList([userMessage('a')], 2, 0, false)

    expect(children).toHaveLength(1)
    expect(container.querySelector('.quickforge-context-compaction-notice')).toBeNull()
  })

  it('exposes the summary through the disclosure and toggles it as component state', () => {
    renderList([userMessage('a'), userMessage('b')], 1)

    const notice = container.querySelector<HTMLElement>('.quickforge-context-compaction-notice')!
    expect(notice.dataset.summaryText).toBe('summary body')
    expect(notice.dataset.hasSummary).toBe('true')
    expect(notice.getAttribute('aria-label')).toBe(notice.title)

    const details = notice.querySelector<HTMLDetailsElement>('.quickforge-context-compaction-details')!
    expect(details.open).toBe(false)
    expect(notice.querySelector('.quickforge-context-compaction-toggle-label')!.textContent)
      .toBe('contextCompactedViewSummary')

    // The decoration flipped `details.open` and rewrote the label by hand; the
    // render must now follow the native toggle event.
    act(() => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(notice.querySelector('.quickforge-context-compaction-toggle-label')!.textContent)
      .toBe('contextCompactedHideSummary')
  })

  it('renders a bare separator line when the compaction has no summary', () => {
    act(() => {
      root.render(createElement(ContextCompactionNotice, { summaryText: '', boundaryIndex: 0 }))
    })

    const notice = container.querySelector<HTMLElement>('.quickforge-context-compaction-notice')!
    expect(notice.dataset.hasSummary).toBe('false')
    expect(notice.querySelector('.quickforge-context-compaction-details')).toBeNull()
    expect(notice.querySelector('.quickforge-context-compaction-summary')!.getAttribute('role')).toBe('separator')
  })
})
