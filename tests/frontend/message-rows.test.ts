import { describe, expect, it, vi } from 'vitest'

import { readMessageRows } from '../../src/components/chat/panel-decoration/message-rows'

/**
 * `readMessageRows` 是装饰层唯一的消息行枚举实现。此前 4 个装饰器各写一份
 * `querySelectorAll('.qf-user-message, .qf-assistant-message')` + `closest` 过滤，
 * 于是一次装饰 pass 会对同一张列表重复做多遍全表扫描。
 *
 * 这些用例锁定两件事：枚举语义（只保留本列表的行、跳过流式尾行）与
 * 「一次调用只扫一次」。
 */
type FakeRow = {
  isStreaming?: boolean
  owner: 'list' | 'other' | null
  closest(...args: unknown[]): unknown
}

/** Shared identity tokens: `closest()` must return the SAME object the panel's
 * `querySelector('.qf-message-list')` hands out, or the ownership check fails. */
let messageList: unknown
let otherList: unknown

function makeRow(options: { streaming?: boolean; owner?: 'list' | 'other' | null } = {}): FakeRow {
  const row: FakeRow = {
    isStreaming: options.streaming,
    owner: options.owner === undefined ? 'list' : options.owner,
    closest() {
      if (row.owner === 'list') return messageList
      if (row.owner === 'other') return otherList
      return null
    },
  }
  return row
}

function makePanel(rows: FakeRow[]) {
  const querySelectorAll = vi.fn(() => rows)
  const list = { querySelectorAll }
  messageList = list
  otherList = { querySelectorAll: () => [] }
  return {
    panel: {
      querySelector: (selector: string) => (selector === '.qf-message-list' ? list : null),
    } as unknown as HTMLElement,
    querySelectorAll,
  }
}

describe('readMessageRows', () => {
  it('returns rows owned by the list, skipping the streaming tail row', () => {
    const owned = makeRow()
    const streaming = makeRow({ streaming: true })
    const foreign = makeRow({ owner: 'other' })
    const orphan = makeRow({ owner: null })
    const { panel } = makePanel([owned, streaming, foreign, orphan])

    const rows = readMessageRows(panel)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toBe(owned)
  })

  it('returns an empty list when the panel has no message list', () => {
    const panel = { querySelector: () => null } as unknown as HTMLElement
    expect(readMessageRows(panel)).toEqual([])
  })

  it('performs exactly one full-table scan per call', () => {
    // The whole point of the shared helper: callers inside one decoration pass
    // share a single enumeration instead of each re-scanning.
    const { panel, querySelectorAll } = makePanel([makeRow()])

    readMessageRows(panel)

    expect(querySelectorAll).toHaveBeenCalledTimes(1)
  })
})
