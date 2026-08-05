import { describe, expect, it } from 'vitest'
import {
  createMessageWindow,
  WINDOW_ENABLE_TURNS,
  WINDOW_ENABLE_MESSAGES,
  WINDOW_ENABLE_CONTENT_CHARS,
  WINDOW_TURNS,
  WINDOW_PAGE_TURNS,
} from '../../src/components/chat/windowed-messages'

// One turn = user message + assistant reply (optionally with a tool call + result).
function userMessage(index: number) {
  return { role: 'user', content: `user ${index}`, timestamp: index }
}

function assistantMessage(index: number, toolCallId?: string) {
  return {
    role: 'assistant',
    content: toolCallId
      ? [
          { type: 'text', text: `assistant ${index}` },
          { type: 'toolCall', id: toolCallId, name: 'test_tool', arguments: '{}' },
        ]
      : [{ type: 'text', text: `assistant ${index}` }],
    timestamp: index,
  }
}

function toolResultMessage(callId: string) {
  return { role: 'toolResult', toolCallId: callId, toolName: 'test_tool', content: 'result', timestamp: 0 }
}

function turns(count: number, opts: { withToolCalls?: boolean } = {}) {
  const messages = []
  for (let i = 0; i < count; i++) {
    messages.push(userMessage(i))
    if (opts.withToolCalls) {
      const callId = `call-${i}`
      messages.push(assistantMessage(i, callId))
      messages.push(toolResultMessage(callId))
    } else {
      messages.push(assistantMessage(i))
    }
  }
  return messages
}

describe('message windowing (by turns)', () => {
  it('passes short conversations through untouched', () => {
    const window = createMessageWindow()
    // Exactly at the threshold → not more than it, so no windowing.
    const full = turns(WINDOW_ENABLE_TURNS)

    expect(window.isEnabled()).toBe(false)
    expect(window.setFullMessages(full)).toBe(full)
    expect(window.isEnabled()).toBe(false)
    expect(window.getWindowMessages()).toBe(full)
    expect(window.hasMore()).toBe(false)
  })

  it('windows message-heavy conversations with only a few user turns', () => {
    const window = createMessageWindow()
    const full = turns(4, { withToolCalls: true })
    while (full.length <= WINDOW_ENABLE_MESSAGES) {
      full.splice(full.length - 1, 0, toolResultMessage(`extra-${full.length}`))
    }

    const rendered = window.setFullMessages(full)

    expect(window.isEnabled()).toBe(true)
    expect(rendered.length).toBeLessThan(full.length)
    expect(window.getWindowStart()).toBeGreaterThan(0)
  })

  it('windows content-heavy conversations below the turn and message thresholds', () => {
    const window = createMessageWindow()
    const full = turns(4)
    full[1] = {
      ...full[1],
      content: [{ type: 'text', text: 'x'.repeat(WINDOW_ENABLE_CONTENT_CHARS) }],
    }

    const rendered = window.setFullMessages(full)

    expect(full.length).toBeLessThanOrEqual(WINDOW_ENABLE_MESSAGES)
    expect(window.isEnabled()).toBe(true)
    expect(rendered.length).toBeLessThan(full.length)
  })

  it('renders only the most recent turns for long conversations', () => {
    const window = createMessageWindow()
    const full = turns(50)
    const rendered = window.setFullMessages(full)

    expect(window.isEnabled()).toBe(true)
    // 50 turns → window shows the last 10 turns: 2 messages per turn × 10.
    expect(rendered).toHaveLength(WINDOW_TURNS * 2)
    expect(rendered[0]).toBe(full[full.length - WINDOW_TURNS * 2])
    expect(rendered[rendered.length - 1]).toBe(full[full.length - 1])
    expect(window.getWindowStart()).toBe(full.length - WINDOW_TURNS * 2)
  })

  it('loads earlier turns one page at a time', () => {
    const window = createMessageWindow()
    const full = turns(50)
    window.setFullMessages(full)
    expect(window.hasMore()).toBe(true)

    const next = window.loadMore()
    expect(next).not.toBeNull()
    const expectedStart = full.length - WINDOW_TURNS * 2 - WINDOW_PAGE_TURNS * 2
    expect(window.getWindowStart()).toBe(expectedStart)
    expect(next?.[0]).toBe(full[expectedStart])
  })

  it('stops loading once the first turn is reached', () => {
    const window = createMessageWindow()
    const full = turns(WINDOW_ENABLE_TURNS + WINDOW_TURNS)
    window.setFullMessages(full)

    let guard = 0
    while (window.hasMore() && guard < 100) {
      window.loadMore()
      guard += 1
    }
    expect(window.getWindowStart()).toBe(0)
    expect(window.hasMore()).toBe(false)
    expect(window.loadMore()).toBeNull()
  })

  it('keeps the pinned window position while streaming new turns', () => {
    const window = createMessageWindow()
    let full = turns(50)
    window.setFullMessages(full)
    const pinnedStart = window.getWindowStart()

    // User scrolled up and loaded one page → pinned.
    window.loadMore()
    expect(window.getWindowStart()).toBeLessThan(pinnedStart)

    // A new turn arrives at the tail; the pinned window must not jump.
    full = [...full, userMessage(50), assistantMessage(50)]
    window.setFullMessages(full)
    expect(window.getWindowStart()).toBe(pinnedStart - WINDOW_PAGE_TURNS * 2)
  })

  it('follows the tail again after resetToTail', () => {
    const window = createMessageWindow()
    const full = turns(50)
    window.setFullMessages(full)

    window.loadMore()
    window.resetToTail()

    const grown = [...full, userMessage(50), assistantMessage(50)]
    window.setFullMessages(grown)
    // 51 turns → window = last 10 turns.
    expect(window.getWindowStart()).toBe(grown.length - WINDOW_TURNS * 2)
  })

  it('clamps the window when history shrinks (rollback)', () => {
    const window = createMessageWindow()
    const full = turns(50)
    window.setFullMessages(full)
    window.loadMore()

    // History rolled back to 30 turns.
    const rolledBack = full.slice(0, 60)
    const rendered = window.setFullMessages(rolledBack)
    expect(rendered).toHaveLength(WINDOW_TURNS * 2)
    // 30 turns → tail start is turn 20; clamped pinned ordinal must not exceed it.
    expect(window.getWindowStart()).toBeLessThanOrEqual(60 - WINDOW_TURNS * 2)
  })

  it('keeps every toolResult paired with its assistant inside the window', () => {
    const window = createMessageWindow()
    // 30 tool-calling turns → 90 messages; window = last 10 turns.
    const full = turns(30, { withToolCalls: true })
    const rendered = window.setFullMessages(full)

    expect(window.isEnabled()).toBe(true)
    const resultByCallId = new Map(
      rendered.filter((message) => message.role === 'toolResult').map((message) => [message.toolCallId, message]),
    )
    const missing = rendered
      .filter((message) => message.role === 'assistant')
      .flatMap((message) => message.content)
      .filter((chunk) => chunk?.type === 'toolCall')
      .filter((chunk) => !resultByCallId.has(chunk.id))
    expect(missing).toEqual([])
    // The window covers exactly 10 turns (3 messages per tool-calling turn).
    expect(rendered).toHaveLength(WINDOW_TURNS * 3)
  })

  it('moves the window to any turn containing a full-array message index', () => {
    const window = createMessageWindow()
    const full = turns(20)
    window.setFullMessages(full)

    const historical = window.showMessageIndex(4)
    expect(historical).not.toBeNull()
    expect(window.getWindowStart()).toBe(4)
    expect(historical?.[0]).toBe(full[4])

    const latest = window.showMessageIndex(full.length - 2)
    expect(latest).not.toBeNull()
    expect(window.getWindowStart()).toBe(full.length - WINDOW_TURNS * 2)
    expect(latest?.at(-1)).toBe(full.at(-1))
  })

  it('keeps the existing array when the target turn is already rendered', () => {
    const window = createMessageWindow()
    const full = turns(20)
    const rendered = window.setFullMessages(full)

    expect(window.showMessageIndex(full.length - 1)).toBe(rendered)
    expect(window.getWindowMessages()).toBe(rendered)
  })

  it('identifies its own assigned window arrays by reference', () => {
    const window = createMessageWindow()
    const full = turns(50)
    const rendered = window.setFullMessages(full)
    expect(window.isAssignedWindow(rendered)).toBe(true)

    const page = window.loadMore()
    expect(page).not.toBeNull()
    expect(window.isAssignedWindow(page as ReturnType<typeof window.getWindowMessages>)).toBe(true)
    expect(window.isAssignedWindow(full)).toBe(false)
  })
})
