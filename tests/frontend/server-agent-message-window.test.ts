import { describe, expect, it } from 'vitest'

import { mergeIncrementalMessages, mergeWindowedMessages } from '../../src/lib/server-agent'

/**
 * 只读视图返回的是尾部窗口（`messagesSummary.count` > 本地条数），因此本地
 * 列表并不从服务端索引 0 开始。`mergeWindowedMessages` 负责把「服务端尾部
 * 索引」换算成「窗口内索引」。
 *
 * 这里锁定的是正确性前提：偏差一格就会把整段对话渲染错位。
 */
const msg = (text: string) => ({ role: 'user' as const, content: text, timestamp: 0 })

describe('mergeIncrementalMessages (window offset 0)', () => {
  it('appends a tail that starts at the local end', () => {
    const current = [msg('a'), msg('b')]
    const merged = mergeIncrementalMessages(current, 2, [msg('c')])

    expect(merged.map((m) => m.content)).toEqual(['a', 'b', 'c'])
  })

  it('replaces a differing message at an overlapping position', () => {
    const current = [msg('a'), msg('b')]
    const merged = mergeIncrementalMessages(current, 1, [msg('b-final')])

    expect(merged.map((m) => m.content)).toEqual(['a', 'b-final'])
  })
})

describe('mergeWindowedMessages', () => {
  it('behaves like the plain merge when there is no window offset', () => {
    const current = [msg('a')]
    expect(mergeWindowedMessages(current, 0, 1, [msg('b')]).map((m) => m.content)).toEqual(['a', 'b'])
  })

  it('appends messages that follow the window end', () => {
    // Server indices 8..9 are the window; the tail starts at server index 10.
    const current = [msg('h'), msg('i')]
    const merged = mergeWindowedMessages(current, 8, 10, [msg('j'), msg('k')])

    expect(merged.map((m) => m.content)).toEqual(['h', 'i', 'j', 'k'])
  })

  it('replaces an in-window message that the server changed in place', () => {
    // Window covers server indices 8..9; the server re-sends the final message.
    const current = [msg('h'), msg('i-streaming')]
    const merged = mergeWindowedMessages(current, 8, 9, [msg('i-final')])

    expect(merged.map((m) => m.content)).toEqual(['h', 'i-final'])
  })

  it('drops tail entries that belong to the omitted prefix', () => {
    // The window starts at server index 8, but the server sent from index 6.
    // Indices 6 and 7 belong to the omitted prefix and must not be written into
    // window slots (that would shift the whole visible conversation).
    const current = [msg('h'), msg('i')]
    const merged = mergeWindowedMessages(current, 8, 6, [msg('f'), msg('g'), msg('h2'), msg('i2')])

    expect(merged.map((m) => m.content)).toEqual(['h2', 'i2'])
  })

  it('returns the current list untouched when the whole tail predates the window', () => {
    const current = [msg('h'), msg('i')]
    const merged = mergeWindowedMessages(current, 8, 0, [msg('a'), msg('b')])

    // Same identity: nothing to do, so callers skip the state update entirely.
    expect(merged).toBe(current)
  })

  it('keeps the window contents when the tail duplicates them exactly', () => {
    const current = [msg('h'), msg('i')]
    const merged = mergeWindowedMessages(current, 8, 8, [msg('h'), msg('i')])

    expect(merged.map((m) => m.content)).toEqual(['h', 'i'])
  })
})
