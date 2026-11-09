// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AssistantWaitingBubble,
  resolveAssistantWaitingRow,
} from '../../src/components/chat/surface/AssistantWaitingBubble'
import { MessageList } from '../../src/components/chat/surface/MessageList'
import { isRenderableMessage } from '../../src/components/chat/surface/content-parts'
import type { AgentMessage } from '../../src/components/chat/surface/ChatTypes'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

/**
 * These cases pin the two halves of the waiting bubble: the pure
 * row-resolution predicate (does the assistant have visible output yet?) and the
 * rendered position inside the message list.
 */
function userMessage(content = 'hi'): AgentMessage {
  return { role: 'user', content, timestamp: 1 }
}

function assistantMessage(parts: unknown[], timestamp = 2): AgentMessage {
  return { role: 'assistant', content: parts, timestamp } as AgentMessage
}

function compactionMessage(summary = 'summary'): AgentMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text: '<compact_summary>' + summary + '</compact_summary>' }],
    timestamp: 4,
    details: { quickforgeCompaction: { version: 1, kind: 'summary', compactedAt: '2026-01-01T00:00:00.000Z' } },
  } as unknown as AgentMessage
}

function toolResultMessage(): AgentMessage {
  return { role: 'toolResult', toolCallId: 'call-1', toolName: 'read', content: [], timestamp: 3 } as AgentMessage
}

function resolve(messages: AgentMessage[], waiting = true) {
  return resolveAssistantWaitingRow({ messages, waiting, isRenderable: isRenderableMessage })
}

describe('resolveAssistantWaitingRow', () => {
  it('shows the bubble after a lone user message', () => {
    // rowIndex 1 === messages.length → rendered after the only row.
    expect(resolve([userMessage()])).toBe(1)
  })

  it('stays hidden when the host is not waiting', () => {
    expect(resolve([userMessage()], false)).toBe(-1)
  })

  it('stays hidden when the turn is not streaming', () => {
    // The decoration required `isStreaming && isActive`; keeping that means the
    // bubble and the stop button's waiting ring stay in step.
    expect(resolveAssistantWaitingRow({
      messages: [userMessage()],
      waiting: true,
      streaming: false,
      isRenderable: isRenderableMessage,
    })).toBe(-1)
  })

  it('does not count an empty thinking chunk as output', () => {
    // `content-parts` drops empty thinking chunks, so they render nothing: the
    // bubble must not disappear before anything is visible.
    expect(resolve([userMessage(), assistantMessage([{ type: 'thinking', thinking: '   ' }])])).toBe(1)
  })

  it('stays hidden without a user message', () => {
    expect(resolve([])).toBe(-1)
    expect(resolve([assistantMessage([{ type: 'text', text: 'hello' }])])).toBe(-1)
  })

  it('hides once the assistant produced text', () => {
    expect(resolve([userMessage(), assistantMessage([{ type: 'text', text: 'answer' }])])).toBe(-1)
  })

  it('stays visible when the assistant row exists but is empty', () => {
    // "Output started" means content, not row presence.
    expect(resolve([userMessage(), assistantMessage([])])).toBe(1)
    expect(resolve([userMessage(), assistantMessage([{ type: 'text', text: '   ' }])])).toBe(1)
  })

  it('treats a thinking block or a tool call as output', () => {
    // The decoration reached this decision by finding `.qf-thinking-block` /
    // `.qf-tool-message` outside a process group.
    expect(resolve([userMessage(), assistantMessage([{ type: 'thinking', thinking: 'hmm' }])])).toBe(-1)
    expect(resolve([userMessage(), assistantMessage([{ type: 'toolCall', id: 'c1', name: 'read', arguments: {} }])])).toBe(-1)
  })

  it('ignores lookup-only toolResult rows when placing the bubble', () => {
    // toolResult bodies render inline, so they are not rows and must not shift
    // the index — the decoration's `displayEntries` filter did the same.
    expect(resolve([userMessage(), toolResultMessage()])).toBe(1)
  })

  it('places the bubble before the first row after the user message', () => {
    // A second turn started: the bubble belongs above that turn's user row.
    const messages = [userMessage('first'), assistantMessage([{ type: 'text', text: 'a' }]), userMessage('second')]
    expect(resolve(messages)).toBe(3)
  })

  it('looks only at messages after the last user message', () => {
    // An earlier turn with output must not hide the current turn's bubble.
    const messages = [
      userMessage('first'),
      assistantMessage([{ type: 'text', text: 'answer' }]),
      userMessage('second'),
    ]
    expect(resolve(messages)).toBe(3)
  })
})

describe('waiting bubble rendering', () => {
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

  const bubble = () => container.querySelector<HTMLElement>('.quickforge-assistant-waiting')

  it('renders the three-dot status bubble with the aria contract', () => {
    act(() => { root.render(createElement(AssistantWaitingBubble)) })

    expect(bubble()).not.toBeNull()
    expect(bubble()!.getAttribute('role')).toBe('status')
    expect(bubble()!.getAttribute('aria-live')).toBe('polite')
    expect(bubble()!.getAttribute('aria-label')).toBe('assistantWaitingAriaLabel')
    expect(bubble()!.querySelectorAll('.quickforge-assistant-waiting-dots span')).toHaveLength(3)
  })

  it('renders as a list child right after the last user row', () => {
    const messages = [userMessage('first'), assistantMessage([{ type: 'text', text: 'a' }]), userMessage('second')]
    act(() => {
      root.render(createElement(MessageList, {
        messages,
        assistantWaitingRow: resolve(messages),
      }))
    })

    const children = Array.from(container.querySelectorAll<HTMLElement>('.qf-message-list > *'))
    expect(children).toHaveLength(4)
    expect(children[3].className).toBe('quickforge-assistant-waiting')
    // The bubble follows the *last* user row, i.e. it is the final child here.
    expect(children[2].className).toContain('qf-user-message')
  })

  it('renders between rows when a later turn already exists', () => {
    // Rendered window: user A, assistant A, user B — but B has no rows after it
    // yet, so a bubble would trail. Use a window whose last user row is in the
    // middle to pin the splice index.
    const messages = [userMessage('first'), assistantMessage([]), userMessage('second'), assistantMessage([])]
    act(() => {
      root.render(createElement(MessageList, {
        messages,
        // Resolve says "hidden" once an assistant row has content; these are
        // empty, so it points past the last row.
        assistantWaitingRow: resolve(messages),
      }))
    })

    expect(container.querySelector('.quickforge-assistant-waiting')).not.toBeNull()
  })

  it('keeps the bubble right after the last user row when a compaction message precedes it', () => {
    // 压缩消息是列表里的一行（方案 B）：它计入行数，但不会被当成用户输入。
    const messages = [
      userMessage('old'), assistantMessage([{ type: 'text', text: 'a' }]),
      userMessage('mid'), assistantMessage([{ type: 'text', text: 'b' }]),
      compactionMessage(),
      userMessage('current'),
    ]
    const waitingRow = resolve(messages)
    act(() => {
      root.render(createElement(MessageList, { messages, assistantWaitingRow: waitingRow }))
    })

    const children = Array.from(container.querySelectorAll<HTMLElement>('.qf-message-list > *'))
    const classes = children.map((child) => child.className)
    const dividerIndex = classes.findIndex((name) => name.includes('quickforge-compaction-message'))
    const bubbleIndex = classes.findIndex((name) => name.includes('quickforge-assistant-waiting'))

    expect(dividerIndex).toBeGreaterThanOrEqual(0)
    expect(bubbleIndex).toBeGreaterThan(dividerIndex)
    expect(bubbleIndex).toBe(children.length - 1)
    expect(children[children.length - 2].className).toContain('qf-user-message')
  })

  it('keeps both the compaction row and the bubble at the tail', () => {
    const messages = [userMessage('only'), compactionMessage()]
    act(() => {
      root.render(createElement(MessageList, { messages, assistantWaitingRow: 2 }))
    })

    const classes = Array.from(container.querySelectorAll<HTMLElement>('.qf-message-list > *'))
      .map((child) => child.className)
    expect(classes).toHaveLength(3)
    expect(classes[1]).toContain('quickforge-compaction-message')
    expect(classes[2]).toContain('quickforge-assistant-waiting')
  })

  it('renders no bubble when the row index is -1', () => {
    act(() => {
      root.render(createElement(MessageList, { messages: [userMessage()], assistantWaitingRow: -1 }))
    })

    expect(bubble()).toBeNull()
  })

  it('renders no bubble without the prop (host does not pass it)', () => {
    act(() => {
      root.render(createElement(MessageList, { messages: [userMessage()] }))
    })

    expect(bubble()).toBeNull()
  })
})
