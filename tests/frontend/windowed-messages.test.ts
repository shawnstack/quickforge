import { describe, expect, it } from 'vitest'
import {
  createMessageWindow,
  WINDOW_ENABLE_TURNS,
  WINDOW_ENABLE_MESSAGES,
  WINDOW_ENABLE_CONTENT_CHARS,
  WINDOW_TURNS,
  WINDOW_PAGE_TURNS,
  WINDOW_MAX_TURNS,
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
  it('passes every message through when windowing is disabled', () => {
    const window = createMessageWindow({ enabled: false })
    const full = turns(50, { withToolCalls: true })

    expect(window.setFullMessages(full)).toBe(full)
    expect(window.getWindowMessages()).toBe(full)
    expect(window.getWindowStart()).toBe(0)
    expect(window.isEnabled()).toBe(false)
    expect(window.hasMore()).toBe(false)
    expect(window.loadMore()).toBeNull()
    expect(window.showMessageIndex(0)).toBeNull()
  })

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
    // 50 turns → window shows the last 3 turns: 2 messages per turn × 10.
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

  it('widens the window on loadMore instead of sliding it forward', () => {
    // Regression: the window used to be [startOrdinal, startOrdinal + windowTurns),
    // so paging older turns replaced every rendered row. The row the user was
    // reading then left the DOM, the scroll anchor resolved to nothing, and the
    // viewport fell back to the bottom of the freshly swapped page — reported as
    // "scrolling up bounces me back to the bottom".
    const window = createMessageWindow()
    const full = turns(50)
    const first = window.setFullMessages(full)
    const lastRendered = first[first.length - 1]

    const next = window.loadMore()
    expect(next).not.toBeNull()
    // Everything that was already rendered is still rendered, in place...
    for (const message of first) expect(next).toContain(message)
    expect(next?.[next.length - 1]).toBe(lastRendered)
    // ...and the window grew by one page of turns.
    expect(next?.length).toBe(first.length + WINDOW_PAGE_TURNS * 2)
  })

  it('keeps following the tail on the right edge after paging, without unloading rows', () => {
    const window = createMessageWindow()
    let full = turns(50)
    window.setFullMessages(full)
    const paged = window.loadMore()
    expect(paged).not.toBeNull()

    // A new turn arrives while the reader is back at the tail.
    full = [...full, userMessage(50), assistantMessage(50)]
    const next = window.setFullMessages(full, true)

    // Nothing that was rendered got unloaded, and the new turn is visible.
    for (const message of paged!) expect(next).toContain(message)
    expect(next[next.length - 1]).toBe(full[full.length - 1])
  })

  it('keeps the window identity stable while the reader is up in history', () => {
    const window = createMessageWindow()
    let full = turns(50)
    window.setFullMessages(full)
    const paged = window.loadMore()

    // Streaming while the reader is reading history must not extend the window:
    // every token would otherwise re-render (and re-decorate) every row of a
    // large window, and could replace content under the viewport.
    full = [...full, userMessage(50), assistantMessage(50)]
    const next = window.setFullMessages(full, false)
    expect(next).toBe(paged)
  })

  it('pages the window forward when the reader scrolls down', () => {
    const window = createMessageWindow()
    const full = turns(50)
    window.setFullMessages(full)
    // Jump to the first turn: a fixed-width window that stops at its right edge.
    const jumped = window.showMessageIndex(0)
    expect(jumped).not.toBeNull()
    expect(window.hasMoreNewer()).toBe(true)

    const next = window.loadNewer()
    expect(next).not.toBeNull()
    expect(next!.length).toBeGreaterThan(jumped!.length)
    // Appended below: everything already rendered is still there, in place.
    for (const message of jumped!) expect(next).toContain(message)
  })

  it('stops paging forward once the right edge reaches the tail', () => {
    const window = createMessageWindow()
    const full = turns(50)
    window.setFullMessages(full)
    window.showMessageIndex(0)

    let guard = 0
    while (window.hasMoreNewer() && guard < 100) {
      window.loadNewer()
      guard += 1
    }
    expect(window.hasMoreNewer()).toBe(false)
    expect(window.loadNewer()).toBeNull()
    const rendered = window.getWindowMessages()
    // The right edge reaches the tail, but the window itself stays bounded:
    // older turns are evicted above the viewport instead of staying mounted.
    expect(rendered[rendered.length - 1]).toBe(full[full.length - 1])
    expect(rendered.length).toBeLessThanOrEqual(WINDOW_MAX_TURNS * 2)
  })

  it('caps the window when paging older history and drops rows below the viewport', () => {
    const window = createMessageWindow({ windowTurns: 2, pageTurns: 2, maxTurns: 4 })
    const full = turns(50)
    window.setFullMessages(full)

    const loaded = []
    let guard = 0
    while (window.hasMore() && guard < 100) {
      const next = window.loadMore()
      expect(next).not.toBeNull()
      loaded.push(next)
      expect(next!.length).toBeLessThanOrEqual(4 * 2)
      guard += 1
    }

    expect(window.hasMore()).toBe(false)
    expect(window.getWindowStart()).toBe(0)
    // The newest turns were evicted while paging up; scrolling down can bring
    // them back page by page.
    expect(window.hasMoreNewer()).toBe(true)
  })

  it('caps the paged window by content characters', () => {
    const window = createMessageWindow({ windowTurns: 1, pageTurns: 1, maxTurns: 10, maxChars: 1_000 })
    const full = turns(20)
    for (let index = 1; index < full.length; index += 2) {
      full[index] = { ...full[index], content: [{ type: 'text', text: 'x'.repeat(400) }] }
    }
    window.setFullMessages(full)
    window.loadMore()
    window.loadMore()
    window.loadMore()

    const rendered = window.getWindowMessages()
    const contentChars = rendered.reduce((sum, message) => {
      const content = (message as { content?: unknown }).content
      if (typeof content === 'string') return sum + content.length
      if (!Array.isArray(content)) return sum
      return sum + content.reduce((inner, part) => inner + (typeof (part as { text?: string })?.text === 'string' ? (part as { text: string }).text.length : 0), 0)
    }, 0)
    expect(contentChars).toBeLessThanOrEqual(1_000)
    expect(rendered.length).toBeGreaterThan(0)
  })

  it('drops older turns above the viewport when paging forward past the cap', () => {
    const window = createMessageWindow({ windowTurns: 2, pageTurns: 2, maxTurns: 4 })
    const full = turns(20)
    window.setFullMessages(full)
    window.showMessageIndex(0)
    window.loadNewer()
    window.loadNewer()

    expect(window.getWindowStart()).toBeGreaterThan(0)
    expect(window.hasMore()).toBe(true)
    expect(window.getWindowMessages().length).toBeLessThanOrEqual(4 * 2)
  })

  it('does not drag an early window to the tail on the next snapshot', () => {
    // Regression: the reader jumped to the first turn, and the next snapshot
    // moved the right edge straight to the tail — the whole conversation mounted
    // at once and the viewport was yanked to the newest message, so "scrolling
    // down from the first turn" skipped everything in between.
    const window = createMessageWindow()
    let full = turns(50)
    window.setFullMessages(full)
    const jumped = window.showMessageIndex(0)

    full = [...full, userMessage(50), assistantMessage(50)]
    const next = window.setFullMessages(full, true)

    expect(next).toBe(jumped)
    expect(window.hasMoreNewer()).toBe(true)
  })

  it('distinguishes the tail window from a window that merely contains the newest turn', () => {
    // Regression: callers used to decide "already at the tail" from the rendered
    // window containing the newest turn. That is true for every window while
    // following the tail AND for a paged-back window, so `resumeTail` never
    // re-sliced and the next snapshot collapsed the paged window silently.
    const window = createMessageWindow()
    const full = turns(50)
    window.setFullMessages(full)
    expect(window.isAtTail()).toBe(true)
    expect(window.hasMore()).toBe(true)

    window.loadMore()
    expect(window.isAtTail()).toBe(false)
    // The newest turn is still rendered — that is exactly the trap.
    expect(window.getWindowMessages()).toContain(full[full.length - 1])

    window.resetToTail()
    window.setFullMessages(full)
    expect(window.isAtTail()).toBe(true)
  })

  it('reports a disabled window as at tail so short chats never re-slice', () => {
    const window = createMessageWindow({ enabled: false })
    window.setFullMessages(turns(2))
    expect(window.isAtTail()).toBe(true)
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
    // 51 turns → window = last 3 turns.
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
    // 30 turns → tail start is turn 27; clamped pinned ordinal must not exceed it.
    expect(window.getWindowStart()).toBeLessThanOrEqual(60 - WINDOW_TURNS * 2)
  })

  it('keeps every toolResult paired with its assistant inside the window', () => {
    const window = createMessageWindow()
    // 30 tool-calling turns → 90 messages; window = last 3 turns.
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
    // The window covers exactly 3 turns (3 messages per tool-calling turn).
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

  it('never evicts a turn that is on screen', () => {
    // The cap used to be a hard limit applied from the far edge, so paging up
    // could drop the very rows the reader was looking at: the anchor row left
    // the DOM, resolution fell back to a wrong ordinal, and the viewport was
    // clamped to the bottom of the new window ("scroll up, get bounced down").
    const window = createMessageWindow({ windowTurns: 2, pageTurns: 2, maxTurns: 3 })
    const full = turns(50)
    window.setFullMessages(full)

    // The viewport covers the whole current window (the tail).
    window.setViewport({ startMessageIndex: full.length - 4, endMessageIndex: full.length - 1 })
    const paged = window.loadMore()

    expect(paged).not.toBeNull()
    // Nothing on screen was dropped, even though the window is over its target.
    expect(paged).toContain(full[full.length - 4])
    expect(paged).toContain(full[full.length - 1])
    expect(paged!.length).toBeGreaterThan(3 * 2)
  })

  it('evicts only below the reported viewport when paging history', () => {
    const window = createMessageWindow({ windowTurns: 2, pageTurns: 2, maxTurns: 4 })
    const full = turns(50)
    window.setFullMessages(full)
    window.loadMore()

    // Reader is looking at turns 44/45 (messages 88..91); paging up must not
    // touch them, so the eviction has to come from the newer edge.
    window.setViewport({ startMessageIndex: 88, endMessageIndex: 91 })
    const paged = window.loadMore()

    expect(paged).toContain(full[88])
    expect(paged).toContain(full[91])
    expect(paged!.length).toBeLessThanOrEqual(4 * 2)
    // The newest turns were evicted, and can be paged back in.
    expect(window.hasMoreNewer()).toBe(true)
  })

  it('undoes the last eviction on request', () => {
    // The surface calls this when restoring the reading position would clamp:
    // that means the eviction took away more height than the new page added.
    const window = createMessageWindow({ windowTurns: 2, pageTurns: 2, maxTurns: 4 })
    const full = turns(50)
    window.setFullMessages(full)
    window.loadMore()
    window.loadMore()

    const capped = window.getWindowMessages()
    expect(window.hasMoreNewer()).toBe(true)

    expect(window.restoreEviction()).toBe(true)
    const restored = window.getWindowMessages()
    expect(restored.length).toBeGreaterThan(capped.length)
    expect(restored[restored.length - 1]).toBe(full[full.length - 1])
    // The eviction is consumed once.
    expect(window.restoreEviction()).toBe(false)
  })

  it('covers the tail only when the right edge reaches the last turn', () => {
    // Bottom pinning must ask THIS, not `isAtTail()` ("did the reader page
    // back in?") and not "does the window contain the newest user turn" — both
    // are true for a window that still has unmounted turns below it.
    const window = createMessageWindow()
    const full = turns(50)
    window.setFullMessages(full)
    expect(window.coversTail()).toBe(true)

    window.showMessageIndex(0)
    expect(window.coversTail()).toBe(false)
    expect(window.isAtTail()).toBe(false)

    let guard = 0
    while (window.hasMoreNewer() && guard < 100) {
      window.loadNewer()
      guard += 1
    }
    expect(window.coversTail()).toBe(true)
  })

  it('reports a disabled window as covering the tail', () => {
    const window = createMessageWindow({ enabled: false })
    window.setFullMessages(turns(2))
    expect(window.coversTail()).toBe(true)
  })
})
