// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageList } from '../../src/components/chat/surface/MessageList'
import type { AgentMessage, AssistantMessage as AssistantMessageType } from '../../src/components/chat/surface/ChatTypes'

/**
 * Real-React reconciliation contract for the `message_end` hand-off (the
 * structural flicker fix): the streaming partial and the committed row it
 * becomes must be ONE fiber updated in place — the same keyed child of the
 * same sibling array, with the same element type (the streaming-gate provider
 * lives *inside* `AssistantMessage`, not around the row).
 *
 * This suite renders through `react-dom/client` (jsdom) and asserts DOM-node
 * identity across the hand-off: a remount always replaces the row's root node,
 * which is ground truth that static markup and source assertions cannot give —
 * the earlier "same key ⇒ in place" contract silently regressed twice (wrapper
 * element / sibling slot) while passing those suites.
 */

function assistantMessage(text: string, timestamp: number): AssistantMessageType {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-test',
    usage: {
      input: 10,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 30,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
    },
    stopReason: 'stop',
    timestamp,
  }
}

const user: AgentMessage = { role: 'user', content: 'go', timestamp: 1 }

describe('streaming row hand-off at message_end', () => {
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

  function renderList(messages: AgentMessage[], streamingAssistant?: AssistantMessageType): HTMLDivElement {
    act(() => {
      root.render(createElement(MessageList, { messages, streamingAssistant }))
    })
    return container.querySelector<HTMLDivElement>('.qf-message-list')!
  }

  it('commits the streaming row in place: the row root and its subtree are reused', () => {
    const list = renderList([user], assistantMessage('hel', 100))

    const streamingRow = list.lastElementChild as HTMLElement
    expect(streamingRow.classList.contains('qf-assistant-message')).toBe(true)
    // The streaming row is a direct row of the message list (one sibling
    // array), not a separate subtree.
    expect(streamingRow.parentElement).toBe(list)
    const markdownNode = streamingRow.querySelector('.qf-markdown-block')
    expect(markdownNode).not.toBeNull()

    // `message_end`: the partial commits into `messages` under the same render
    // identity and the streaming prop clears — the same commit.
    const nextList = renderList([user, assistantMessage('hello', 100)])

    const committedRow = nextList.lastElementChild as HTMLElement
    expect(nextList.querySelectorAll('.qf-assistant-message')).toHaveLength(1)
    // Same DOM node ⇒ the row never unmounted: thinking-block disclosure state,
    // code highlights and CSS animations all survive the hand-off.
    expect(committedRow).toBe(streamingRow)
    expect(committedRow.querySelector('.qf-markdown-block')).toBe(markdownNode)
    expect(committedRow.textContent).toContain('hello')
  })

  it('remounts when the row identity really changes (control for the assertion above)', () => {
    const list = renderList([user], assistantMessage('x', 100))
    const streamingRow = list.lastElementChild as HTMLElement

    const nextList = renderList([user, assistantMessage('x', 200)])

    // Different identity ⇒ a genuinely different row: the node replacement the
    // previous test rules out must remain observable here.
    expect(nextList.lastElementChild).not.toBe(streamingRow)
  })

  it('keeps same-identity rows unique and still commits the tail in place', () => {
    // Same-timestamp duplicate (not produced by the agent loop): the streaming
    // row must receive the occurrence-suffix key of its position, so React
    // never sees duplicate keys and the hand-off still reuses the tail fiber.
    const duplicate = assistantMessage('old body', 100)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const list = renderList([user, duplicate], assistantMessage('hel', 100))
      const rows = list.querySelectorAll<HTMLElement>(':scope > .qf-assistant-message')
      expect(rows).toHaveLength(2)
      const streamingRow = rows[1]

      const nextList = renderList([user, duplicate, assistantMessage('hello', 100)])
      const nextRows = nextList.querySelectorAll<HTMLElement>(':scope > .qf-assistant-message')
      expect(nextRows).toHaveLength(2)
      expect(nextRows[1]).toBe(streamingRow)
      // React must not complain about duplicate keys in either pass.
      const keyComplaints = errorSpy.mock.calls.flat().filter((arg) => /key/i.test(String(arg)))
      expect(keyComplaints).toEqual([])
    } finally {
      errorSpy.mockRestore()
    }
  })
})
