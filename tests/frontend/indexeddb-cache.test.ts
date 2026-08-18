import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CACHE_SCHEMA_VERSION,
  computeCacheKey,
  IndexedDbCache,
  isIndexedDbCacheAvailable,
  selectEvictionKeys,
} from '../../src/lib/indexeddb-cache'

// --- Minimal fake IndexedDB (callback model: onsuccess/onerror fire async) ---

class FakeIDBRequest<T = unknown> {
  onsuccess: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onupgradeneeded: ((event: unknown) => void) | null = null
  onblocked: ((event: unknown) => void) | null = null
  result?: T
  error?: unknown

  succeed(result: T): void {
    this.result = result
    queueMicrotask(() => this.onsuccess?.({ target: this }))
  }

  fail(error: unknown): void {
    this.error = error
    queueMicrotask(() => this.onerror?.({ target: this }))
  }
}

class FakeObjectStore {
  entries = new Map<string, unknown>()

  get(key: string): FakeIDBRequest {
    const request = new FakeIDBRequest()
    queueMicrotask(() => request.succeed(this.entries.get(key)))
    return request
  }

  put(value: unknown, key?: string): FakeIDBRequest {
    const request = new FakeIDBRequest()
    queueMicrotask(() => {
      if (key === undefined) {
        request.fail(new Error('key required'))
        return
      }
      this.entries.set(key, value)
      request.succeed(key)
    })
    return request
  }

  delete(key: string): FakeIDBRequest {
    const request = new FakeIDBRequest()
    queueMicrotask(() => {
      this.entries.delete(key)
      request.succeed(undefined)
    })
    return request
  }

  getAllKeys(): FakeIDBRequest {
    const request = new FakeIDBRequest<string[]>()
    queueMicrotask(() => request.succeed([...this.entries.keys()]))
    return request as unknown as FakeIDBRequest
  }

  getAll(): FakeIDBRequest {
    const request = new FakeIDBRequest<unknown[]>()
    queueMicrotask(() => request.succeed([...this.entries.values()]))
    return request as unknown as FakeIDBRequest
  }

  clear(): FakeIDBRequest {
    const request = new FakeIDBRequest()
    queueMicrotask(() => {
      this.entries.clear()
      request.succeed(undefined)
    })
    return request
  }

  count(): FakeIDBRequest {
    const request = new FakeIDBRequest<number>()
    queueMicrotask(() => request.succeed(this.entries.size))
    return request as unknown as FakeIDBRequest
  }
}

class FakeDatabase {
  stores = new Map<string, FakeObjectStore>()
  onversionchange: ((event: unknown) => void) | null = null
  closed = false
  readonly objectStoreNames = { contains: (name: string) => this.stores.has(name) }

  createObjectStore(name: string): FakeObjectStore {
    const store = new FakeObjectStore()
    this.stores.set(name, store)
    return store
  }

  transaction(): { objectStore(name: string): FakeObjectStore } {
    return {
      objectStore: (name: string) => {
        const store = this.stores.get(name)
        if (!store) throw new Error(`no such store: ${name}`)
        return store
      },
    }
  }

  close(): void {
    this.closed = true
  }
}

class FakeFactory {
  dbs = new Map<string, FakeDatabase>()
  failOpen = false

  open(name: string): FakeIDBRequest<FakeDatabase> {
    const request = new FakeIDBRequest<FakeDatabase>()
    queueMicrotask(() => {
      if (this.failOpen) {
        request.fail(new Error('open failed'))
        return
      }
      let db = this.dbs.get(name)
      if (!db) {
        db = new FakeDatabase()
        this.dbs.set(name, db)
        // Real IndexedDB exposes request.result during onupgradeneeded.
        request.result = db
        request.onupgradeneeded?.({})
      }
      request.succeed(db)
    })
    return request
  }
}

function storedKeys(factory: FakeFactory, dbName = 'test-db'): string[] {
  const store = factory.dbs.get(dbName)?.stores.get('entries')
  return store ? [...store.entries.keys()] : []
}

function storedEntry(factory: FakeFactory, key: string, dbName = 'test-db'): unknown {
  return factory.dbs.get(dbName)?.stores.get('entries')?.entries.get(key)
}

describe('IndexedDbCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('round-trips values through put/get', async () => {
    const factory = new FakeFactory()
    const cache = new IndexedDbCache({ dbName: 'test-db', factory: () => factory })

    expect(cache.available()).toBe(true)
    expect(await cache.put('k1', { a: 1, list: ['x'] })).toBe(true)
    expect(await cache.get<{ a: number }>('k1')).toEqual({ a: 1, list: ['x'] })
    expect(await cache.get('missing')).toBeNull()

    const entry = storedEntry(factory, 'k1') as { schemaVersion: number }
    expect(entry.schemaVersion).toBe(CACHE_SCHEMA_VERSION)
    expect(await cache.keys()).toEqual(['k1'])
    expect(await cache.delete('k1')).toBe(true)
    expect(await cache.get('k1')).toBeNull()
  })

  it('returns null for entries with a mismatched schemaVersion', async () => {
    const factory = new FakeFactory()
    const cache = new IndexedDbCache({ dbName: 'test-db', factory: () => factory })

    await cache.put('k1', { a: 1 })
    const entry = storedEntry(factory, 'k1') as { schemaVersion: number }
    entry.schemaVersion = 999

    expect(await cache.get('k1')).toBeNull()
  })

  it('evicts least-recently-used entries beyond maxEntries', async () => {
    const factory = new FakeFactory()
    const cache = new IndexedDbCache({ dbName: 'test-db', maxEntries: 3, factory: () => factory })

    for (const key of ['k1', 'k2', 'k3']) {
      await cache.put(key, { key })
      vi.setSystemTime(Date.now() + 10)
    }
    expect(storedKeys(factory)).toEqual(['k1', 'k2', 'k3'])

    await cache.put('k4', { key: 'k4' })
    expect(storedKeys(factory)).toEqual(['k2', 'k3', 'k4'])
  })

  it('evicts oldest entries until the byte budget is met', async () => {
    const factory = new FakeFactory()
    const cache = new IndexedDbCache({ dbName: 'test-db', maxEntries: 10, maxBytes: 120, factory: () => factory })

    const bigValue = 'x'.repeat(80)
    await cache.put('a', bigValue)
    vi.setSystemTime(Date.now() + 10)
    await cache.put('b', bigValue)
    // 80 + 80 > 120 → oldest ('a') evicted.
    expect(storedKeys(factory)).toEqual(['b'])

    vi.setSystemTime(Date.now() + 10)
    await cache.put('c', bigValue)
    expect(storedKeys(factory)).toEqual(['c'])
  })

  it('refreshes lastUsed on get so recently read entries survive eviction', async () => {
    const factory = new FakeFactory()
    const cache = new IndexedDbCache({ dbName: 'test-db', maxEntries: 3, factory: () => factory })

    for (const key of ['k1', 'k2', 'k3']) {
      await cache.put(key, { key })
      vi.setSystemTime(Date.now() + 10)
    }
    await cache.get('k1')
    vi.setSystemTime(Date.now() + 10)
    await cache.put('k4', { key: 'k4' })

    // k1 was read most recently, so k2 becomes the LRU victim.
    expect(storedKeys(factory)).toEqual(['k1', 'k3', 'k4'])
  })

  it('degrades every API to null/false when open fails', async () => {
    const factory = new FakeFactory()
    factory.failOpen = true
    const cache = new IndexedDbCache({ dbName: 'test-db', factory: () => factory })

    expect(cache.available()).toBe(true) // factory exists; only open fails
    await expect(cache.put('k1', { a: 1 })).resolves.toBe(false)
    await expect(cache.get('k1')).resolves.toBeNull()
    await expect(cache.delete('k1')).resolves.toBe(false)
    await expect(cache.keys()).resolves.toEqual([])
    await expect(cache.clear()).resolves.toBe(false)
  })

  it('is a no-op when the factory reports no indexedDB', async () => {
    const cache = new IndexedDbCache({ dbName: 'test-db', factory: () => undefined })

    expect(cache.available()).toBe(false)
    await expect(cache.put('k1', { a: 1 })).resolves.toBe(false)
    await expect(cache.get('k1')).resolves.toBeNull()
    await expect(cache.keys()).resolves.toEqual([])
    await expect(cache.clear()).resolves.toBe(false)
  })

  it('probes globalThis.indexedDB through the module-level helper', () => {
    expect(isIndexedDbCacheAvailable()).toBe(false)

    vi.stubGlobal('indexedDB', new FakeFactory())
    expect(isIndexedDbCacheAvailable()).toBe(true)
  })

  it('clears stored entries', async () => {
    const factory = new FakeFactory()
    const cache = new IndexedDbCache({ dbName: 'test-db', factory: () => factory })

    await cache.put('k1', 1)
    await cache.put('k2', 2)
    expect(await cache.clear()).toBe(true)
    expect(await cache.keys()).toEqual([])
  })
})

describe('selectEvictionKeys', () => {
  it('evicts strictly oldest entries until both budgets hold', () => {
    const entries = [
      { key: 'a', bytes: 10, lastUsed: 3 },
      { key: 'b', bytes: 10, lastUsed: 1 },
      { key: 'c', bytes: 10, lastUsed: 2 },
    ]
    expect(selectEvictionKeys(entries, 2, 100)).toEqual(['b'])
    expect(selectEvictionKeys(entries, 1, 100)).toEqual(['b', 'c'])
    expect(selectEvictionKeys(entries, 3, 100)).toEqual([])
  })

  it('enforces the byte budget independently of entry count', () => {
    const entries = [
      { key: 'a', bytes: 60, lastUsed: 1 },
      { key: 'b', bytes: 60, lastUsed: 2 },
      { key: 'c', bytes: 60, lastUsed: 3 },
    ]
    expect(selectEvictionKeys(entries, 10, 120)).toEqual(['a'])
    expect(selectEvictionKeys(entries, 10, 60)).toEqual(['a', 'b'])
    expect(selectEvictionKeys(entries, 10, 180)).toEqual([])
  })

  it('never evicts the single newest entry even when over budget', () => {
    const entries = [{ key: 'only', bytes: 10_000, lastUsed: 1 }]
    expect(selectEvictionKeys(entries, 0, 1)).toEqual([])
    expect(selectEvictionKeys([], 0, 0)).toEqual([])
  })
})

describe('computeCacheKey', () => {
  it('joins parts with the :: separator', () => {
    expect(computeCacheKey(['a', 'b', 'c'])).toBe('a::b::c')
    expect(computeCacheKey([])).toBe('')
    expect(computeCacheKey(['server::1', 'session'])).toBe('server::1::session')
  })
})
