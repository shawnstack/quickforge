import { describe, expect, it } from 'vitest'

import { createScrollOwner } from '../../src/components/chat/scroll-owner'

/**
 * `scroll-owner` is the single writer for the chat container's `scrollTop`.
 *
 * The regression it exists for: when the reading anchor could not be resolved,
 * the old call sites wrote "old scrollTop + height delta". That delta is clamped
 * to 0 when the content SHRANK, so the write degenerated to "re-apply the stale
 * scrollTop", which the browser then clamped to the new maximum — the viewport
 * landed at the bottom of the freshly evicted window ("scroll up, get bounced to
 * the bottom"). The contract here is the opposite: no anchor row, no write.
 */
type Rect = { top: number; bottom: number }

class FakeRow {
  dataset: Record<string, string> = {}
  rect: Rect

  constructor(readonly label: string, top: number, height: number, messageIndex?: string) {
    this.rect = { top, bottom: top + height }
    if (messageIndex !== undefined) this.dataset.messageIndex = messageIndex
  }

  getBoundingClientRect(): Rect {
    return this.rect
  }
}

class FakeContainer {
  scrollTop = 0
  top = 0
  clientHeight = 400
  scrollHeight = 2000
  rows: FakeRow[] = []

  getBoundingClientRect(): Rect {
    return { top: this.top, bottom: this.top + this.clientHeight }
  }

  querySelector<T>(selector: string): T | null {
    if (selector === '.qf-message-list') {
      const list = {
        children: this.rows,
        querySelectorAll: (childSelector: string) => this.querySelectorAll(childSelector),
      }
      return list as unknown as T
    }
    const byIndex = /\[data-message-index="([^"]+)"\]/.exec(selector)
    if (byIndex) {
      const found = this.rows.find((row) => row.dataset.messageIndex === byIndex[1])
      return (found ?? null) as unknown as T
    }
    return null
  }

  querySelectorAll<T>(selector: string): T[] {
    if (selector.endsWith('[data-message-index]')) {
      return this.rows.filter((row) => row.dataset.messageIndex !== undefined) as unknown as T[]
    }
    return []
  }
}

function asContainer(fake: FakeContainer): HTMLElement {
  return fake as unknown as HTMLElement
}

function owner(container: FakeContainer, canFollowTail = true) {
  return createScrollOwner({ getContainer: () => asContainer(container), canFollowTail: () => canFollowTail })
}

describe('createScrollOwner', () => {
  it('pins to the bottom only when the window covers the conversation tail', () => {
    const container = new FakeContainer()
    container.scrollTop = 100
    container.scrollHeight = 2000
    container.clientHeight = 400

    expect(owner(container, true).apply({ kind: 'tail' })).toBe('applied')
    expect(container.scrollTop).toBe(1600)

    container.scrollTop = 100
    expect(owner(container, false).apply({ kind: 'tail' })).toBe('blocked')
    expect(container.scrollTop).toBe(100)
  })

  it('reports noop when already at the bottom', () => {
    const container = new FakeContainer()
    container.scrollHeight = 1000
    container.clientHeight = 400
    container.scrollTop = 600

    expect(owner(container).apply({ kind: 'tail' })).toBe('noop')
  })

  it('restores the captured row to the same viewport offset', () => {
    // The anchor sat at viewport -20 with scrollTop 500; 300px was prepended
    // above it, so the viewport has to move down by exactly 300.
    const container = new FakeContainer()
    container.scrollTop = 500
    container.rows = [new FakeRow('anchor', 280, 100, '5')]
    const anchor = { messageIndex: '5', ordinal: 0, offsetFromTop: -20, scrollTop: 500 }

    expect(owner(container).apply({ kind: 'anchor', anchor })).toBe('applied')
    expect(container.scrollTop).toBe(800)
  })

  it('writes nothing when the anchor row was evicted', () => {
    // This is the exact shape of the reported bug: the evicted window no longer
    // contains the row, the container shrank, and any stale write gets clamped
    // to the bottom. Nothing may be written instead.
    const container = new FakeContainer()
    container.scrollTop = 500
    container.scrollHeight = 700
    container.rows = [new FakeRow('other', 0, 100, '9')]
    const anchor = { messageIndex: '5', ordinal: 0, offsetFromTop: -20, scrollTop: 500 }

    expect(owner(container).apply({ kind: 'anchor', anchor })).toBe('blocked')
    expect(container.scrollTop).toBe(500)
  })

  it('reports a clamp instead of silently parking the viewport', () => {
    // The anchor is still mounted but the requested position is past the new
    // maximum (the eviction removed more height than the page added). The
    // surface uses `clamped` to undo the eviction.
    const container = new FakeContainer()
    container.scrollTop = 500
    container.scrollHeight = 600
    container.clientHeight = 400
    container.rows = [new FakeRow('anchor', 300, 100, '5')]
    const anchor = { messageIndex: '5', ordinal: 0, offsetFromTop: -20, scrollTop: 500 }

    expect(owner(container).apply({ kind: 'anchor', anchor })).toBe('clamped')
    expect(container.scrollTop).toBe(200)
  })

  it('does not write for a hold intent', () => {
    const container = new FakeContainer()
    container.scrollTop = 321

    expect(owner(container).apply({ kind: 'hold' })).toBe('noop')
    expect(container.scrollTop).toBe(321)
  })

  it('captures an absolute message index, never a decoration-owned row', () => {
    const container = new FakeContainer()
    container.rows = [
      new FakeRow('decoration', -20, 100),
      new FakeRow('message', 80, 100, '12'),
    ]

    const anchor = owner(container).capture()
    expect(anchor?.messageIndex).toBe('12')
    expect(anchor?.offsetFromTop).toBe(80)
  })
})
