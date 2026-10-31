import { describe, expect, it } from 'vitest'
import { ContentCache } from '../../src/lib/render-cache'

describe('ContentCache bounds', () => {
  it('evicts by estimated key bytes, not only by entry count', () => {
    // 每个 key 约 2000 字节（1000 字符 × 2），预算 2500 字节 → 只能留一条。
    const cache = new ContentCache<string>(10, 2500)
    cache.set(['a'.repeat(1000)], 'first')
    cache.set(['b'.repeat(1000)], 'second')
    expect(cache.size).toBe(1)
    expect(cache.get(['a'.repeat(1000)])).toBeUndefined()
    expect(cache.get(['b'.repeat(1000)])).toBe('second')
  })

  it('still honours the entry-count bound', () => {
    const cache = new ContentCache<number>(2, Number.POSITIVE_INFINITY)
    cache.set(['a'], 1)
    cache.set(['b'], 2)
    cache.set(['c'], 3)
    expect(cache.size).toBe(2)
    expect(cache.get(['a'])).toBeUndefined()
    expect(cache.get(['c'])).toBe(3)
  })

  it('does not serve evicted entries from the single-slot fast path', () => {
    const cache = new ContentCache<string>(1, Number.POSITIVE_INFINITY)
    cache.set(['a'], 'first')
    expect(cache.get(['a'])).toBe('first')
    cache.set(['b'], 'second')
    // 'a' 已被淘汰：单槽缓存不能把它「复活」。
    expect(cache.get(['a'])).toBeUndefined()
    expect(cache.get(['b'])).toBe('second')
  })

  it('reports the same value for repeated reads of one content string', () => {
    const cache = new ContentCache<{ body: string }>(4, Number.POSITIVE_INFINITY)
    const parts = ['same content']
    const value = { body: 'rendered' }
    cache.set(parts, value)
    expect(cache.get(parts)).toBe(value)
    // 同一引用重复读取走单槽快路径，返回值身份不变（调用方依赖只读复用）。
    expect(cache.get(parts)).toBe(value)
  })
})
