import { describe, expect, it } from 'vitest'

import { anchoredScrollTop, readScrollAnchor, resolveAnchorRow } from '../../src/components/chat/scroll-anchor'

/**
 * `scroll-anchor` 是「在视口上方插入/移除内容后保持阅读位置」的唯一实现，
 * 由两处调用：后台补齐历史（`hydrateFullHistory`）与加载更早一页
 * （`loadMoreMessages`）。此前两者各写一遍同样的公式。
 *
 * 这里用一个最小化的假 DOM 验证接口契约：真实浏览器行为已由 Playwright
 * 实测覆盖（补齐时 topText 不变、scrollTop 精确补偿）。
 */
type Rect = { top: number; bottom: number }

class FakeRow {
  dataset: Record<string, string> = {}
  rect: Rect
  removed = false

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
  rows: FakeRow[] = []

  getBoundingClientRect(): Rect {
    return { top: this.top, bottom: this.top + 400 }
  }

  querySelector<T>(selector: string): T | null {
    if (selector === '.qf-message-list') {
      // Mirror the real DOM: the list element itself supports the child queries
      // used by candidateRows.
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

function makeContainer(rows: FakeRow[]): FakeContainer {
  const container = new FakeContainer()
  container.rows = rows
  return container
}

describe('readScrollAnchor', () => {
  it('picks the first row whose bottom is below the container top', () => {
    const rows = [
      new FakeRow('a', -120, 100, '0'),
      new FakeRow('b', -20, 100, '1'), // bottom = 80 > 0 → first visible
      new FakeRow('c', 80, 100, '2'),
    ]
    const anchor = readScrollAnchor(asContainer(makeContainer(rows)))

    expect(anchor?.messageIndex).toBe('1')
    expect(anchor?.ordinal).toBe(1)
    expect(anchor?.offsetFromTop).toBe(-20)
    expect(anchor?.scrollTop).toBe(0)
  })

  it('returns null when the list is empty or fully above the viewport', () => {
    expect(readScrollAnchor(asContainer(makeContainer([])))).toBeNull()
    const above = [new FakeRow('a', -300, 100, '0'), new FakeRow('b', -200, 100, '1')]
    expect(readScrollAnchor(asContainer(makeContainer(above)))).toBeNull()
  })

  it('honours requireMessageIndex by skipping rows without an index', () => {
    // Row 0 is a folded process group (no data-message-index); paging must not
    // anchor on it because the page rebuilds those groups.
    const rows = [
      new FakeRow('group', -20, 100),
      new FakeRow('msg', 80, 100, '7'),
    ]
    const container = makeContainer(rows)

    expect(readScrollAnchor(asContainer(container))?.ordinal).toBe(0)
    expect(readScrollAnchor(asContainer(container), { requireMessageIndex: true })?.messageIndex).toBe('7')
  })
})

describe('resolveAnchorRow', () => {
  it('prefers the absolute message index over the captured ordinal', () => {
    const rows = [
      new FakeRow('a', 0, 100, '0'),
      new FakeRow('b', 100, 100, '1'),
    ]
    const anchor = { messageIndex: '1', ordinal: 0, offsetFromTop: 0, scrollTop: 0 }

    expect(resolveAnchorRow(asContainer(makeContainer(rows)), anchor)?.label).toBe('b')
  })

  it('falls back to the ordinal when the indexed row is gone', () => {
    const rows = [new FakeRow('x', 0, 100), new FakeRow('y', 100, 100)]
    const anchor = { messageIndex: '9', ordinal: 1, offsetFromTop: 0, scrollTop: 0 }

    expect(resolveAnchorRow(asContainer(makeContainer(rows)), anchor)?.label).toBe('y')
  })

  it('returns null when neither handle resolves', () => {
    const container = makeContainer([new FakeRow('only', 0, 100)])
    const anchor = { messageIndex: '9', ordinal: 5, offsetFromTop: 0, scrollTop: 0 }

    expect(resolveAnchorRow(asContainer(container), anchor)).toBeNull()
  })
})

describe('anchoredScrollTop', () => {
  it('returns the compensated scrollTop after content is prepended above', () => {
    // Anchor row sat at viewport -20 with scrollTop 500. After 300px of history
    // is prepended it sits at +280, so the viewport must move down by 300.
    const rows = [new FakeRow('anchor', 280, 100, '5')]
    const anchor = { messageIndex: '5', ordinal: 0, offsetFromTop: -20, scrollTop: 500 }

    expect(anchoredScrollTop(asContainer(makeContainer(rows)), anchor)).toBe(800)
  })

  it('returns null when nothing moved, so callers skip the scroll write', () => {
    const rows = [new FakeRow('anchor', -20, 100, '5')]
    const anchor = { messageIndex: '5', ordinal: 0, offsetFromTop: -20, scrollTop: 500 }

    expect(anchoredScrollTop(asContainer(makeContainer(rows)), anchor)).toBeNull()
  })

  it('returns null when the anchor row disappeared', () => {
    const anchor = { messageIndex: 'gone', ordinal: 3, offsetFromTop: -20, scrollTop: 500 }
    expect(anchoredScrollTop(asContainer(makeContainer([new FakeRow('x', 0, 100)])), anchor)).toBeNull()
  })
})
