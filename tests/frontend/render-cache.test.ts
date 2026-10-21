import { describe, expect, it } from 'vitest'

import { ContentCache, memoizeContent, memoizeContentAsync } from '../../src/lib/render-cache'

describe('content-addressed render cache', () => {
  it('returns the cached value for an identical key', () => {
    const cache = new ContentCache<number>(4)
    let computed = 0
    const compute = () => {
      computed += 1
      return computed
    }

    expect(memoizeContent(cache, ['a', 'b'], compute)).toBe(1)
    expect(memoizeContent(cache, ['a', 'b'], compute)).toBe(1)
    expect(computed).toBe(1)
  })

  it('treats different key parts as different entries', () => {
    const cache = new ContentCache<number>(4)
    let computed = 0
    const compute = () => {
      computed += 1
      return computed
    }

    expect(memoizeContent(cache, ['a', 'b'], compute)).toBe(1)
    expect(memoizeContent(cache, ['a', 'c'], compute)).toBe(2)
    expect(memoizeContent(cache, ['b', 'a'], compute)).toBe(3)
    expect(computed).toBe(3)
  })

  it('evicts the least recently used entry beyond the entry budget', () => {
    const cache = new ContentCache<number>(2)
    cache.set(['a'], 1)
    cache.set(['b'], 2)
    // Touch 'a' so 'b' becomes the LRU entry.
    expect(cache.get(['a'])).toBe(1)
    cache.set(['c'], 3)

    expect(cache.get(['a'])).toBe(1)
    expect(cache.get(['b'])).toBeUndefined()
    expect(cache.get(['c'])).toBe(3)
    expect(cache.size).toBe(2)
  })

  it('does not cache a throwing computation', () => {
    const cache = new ContentCache<number>(2)
    expect(() => memoizeContent(cache, ['boom'], () => {
      throw new Error('compute failed')
    })).toThrow('compute failed')
    expect(cache.size).toBe(0)

    // The next call retries instead of replaying the failure.
    expect(memoizeContent(cache, ['boom'], () => 7)).toBe(7)
  })

  it('shares one in-flight promise between concurrent async lookups', async () => {
    const cache = new ContentCache<string>(2)
    const inflight = new Map<string, Promise<string>>()
    let computed = 0
    const compute = () => {
      computed += 1
      return Promise.resolve(`value-${computed}`)
    }

    const [first, second] = await Promise.all([
      memoizeContentAsync(cache, inflight, ['same'], compute),
      memoizeContentAsync(cache, inflight, ['same'], compute),
    ])

    expect(first).toBe('value-1')
    expect(second).toBe('value-1')
    expect(computed).toBe(1)
    expect(inflight.size).toBe(0)

    // A later identical lookup is served from the cache, not recomputed.
    expect(await memoizeContentAsync(cache, inflight, ['same'], compute)).toBe('value-1')
    expect(computed).toBe(1)
  })

  it('drops the in-flight entry when the async computation rejects', async () => {
    const cache = new ContentCache<string>(2)
    const inflight = new Map<string, Promise<string>>()

    await expect(memoizeContentAsync(cache, inflight, ['bad'], () => Promise.reject(new Error('nope'))))
      .rejects.toThrow('nope')
    expect(inflight.size).toBe(0)
    expect(cache.get(['bad'])).toBeUndefined()
  })
})

describe('content cache key safety', () => {
  it('never serves another entry when a digest collides', () => {
    const cache = new ContentCache<string>(8)
    // Two distinct keys are stored back to back; whichever digest they hash to,
    // the stored key parts are compared strictly on read.
    cache.set(['left'], 'L')
    cache.set(['right'], 'R')

    expect(cache.get(['left'])).toBe('L')
    expect(cache.get(['right'])).toBe('R')
    expect(cache.get(['missing'])).toBeUndefined()
  })

  it('distinguishes keys whose parts contain the separator-like content', () => {
    const cache = new ContentCache<string>(8)
    cache.set(['a', 'b'], 'first')
    cache.set(['ab'], 'second')

    expect(cache.get(['a', 'b'])).toBe('first')
    expect(cache.get(['ab'])).toBe('second')
  })
})
