import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const backendUrlState = vi.hoisted(() => ({ direct: '' }))

vi.mock('@/lib/backend-url', () => ({
  getDirectBackendBaseUrl: () => backendUrlState.direct,
}))

// --- Minimal fake IndexedDB (shared shape with indexeddb-cache.test.ts) ----

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
}

class FakeDatabase {
  stores = new Map<string, FakeObjectStore>()
  onversionchange: ((event: unknown) => void) | null = null
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

  close(): void {}
}

class FakeFactory {
  dbs = new Map<string, FakeDatabase>()

  open(name: string): FakeIDBRequest<FakeDatabase> {
    const request = new FakeIDBRequest<FakeDatabase>()
    queueMicrotask(() => {
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

type SessionCacheModule = typeof import('../../src/lib/session-message-cache')

async function importSessionCacheModule(): Promise<SessionCacheModule> {
  vi.resetModules()
  return import('../../src/lib/session-message-cache')
}

function storeOf(factory: FakeFactory): FakeObjectStore | undefined {
  return factory.dbs.get('quickforge-cache')?.stores.get('session-messages')
}

describe('session-message-cache', () => {
  beforeEach(() => {
    vi.resetModules()
    backendUrlState.direct = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('round-trips a snapshot entry through write and read', async () => {
    const factory = new FakeFactory()
    vi.stubGlobal('indexedDB', factory)
    const mod = await importSessionCacheModule()

    mod.writeSessionMessageSnapshot('server-a', 'session-1', () => ({
      stateVersion: 3,
      messages: [{ role: 'user', content: 'hi' }],
      snapshot: { stateVersion: 3, title: 'Chat' },
    }), 0)
    await mod.flushPendingSessionMessageWrites()

    const entry = await mod.readSessionMessageSnapshot('server-a', 'session-1')
    expect(entry).toMatchObject({
      schemaVersion: 1,
      serverKey: 'server-a',
      sessionId: 'session-1',
      stateVersion: 3,
      messageCount: 1,
      messages: [{ role: 'user', content: 'hi' }],
      snapshot: { stateVersion: 3, title: 'Chat' },
    })
    expect(typeof entry?.savedAt).toBe('number')

    expect(await mod.readSessionMessageSnapshot('server-a', 'missing')).toBeNull()
  })

  it('deletes and returns null for structurally invalid entries', async () => {
    const factory = new FakeFactory()
    vi.stubGlobal('indexedDB', factory)
    const mod = await importSessionCacheModule()

    // Healthy write first so the DB and store exist.
    mod.writeSessionMessageSnapshot('server-a', 'session-1', () => ({ stateVersion: 1, messages: [], snapshot: {} }), 0)
    await mod.flushPendingSessionMessageWrites()

    const store = storeOf(factory)
    expect(store).toBeDefined()
    const key = 'server-a::session-1'
    // Corrupt the cached value (the wrapper's inner `value`): messages is not
    // an array.
    const wrapper = store!.entries.get(key) as { value: unknown }
    wrapper.value = {
      schemaVersion: 1,
      serverKey: 'server-a',
      sessionId: 'session-1',
      stateVersion: 2,
      messageCount: 2,
      messages: 'not-an-array',
      snapshot: {},
    }

    await expect(mod.readSessionMessageSnapshot('server-a', 'session-1')).resolves.toBeNull()
    expect(store!.entries.has(key)).toBe(false)
  })

  it('debounces repeated schedules and flushes only the latest builder', async () => {
    vi.useFakeTimers()
    const factory = new FakeFactory()
    vi.stubGlobal('indexedDB', factory)
    const mod = await importSessionCacheModule()

    const buildStale = vi.fn(() => ({
      stateVersion: 1,
      messages: [{ role: 'user', content: 'stale' }],
      snapshot: {},
    }))
    const buildLatest = vi.fn(() => ({
      stateVersion: 2,
      messages: [{ role: 'user', content: 'latest' }],
      snapshot: { title: 'Latest' },
    }))

    mod.writeSessionMessageSnapshot('server-a', 'session-1', buildStale, 100)
    mod.writeSessionMessageSnapshot('server-a', 'session-1', buildStale, 100)
    mod.writeSessionMessageSnapshot('server-a', 'session-1', buildLatest, 100)
    await vi.advanceTimersByTimeAsync(100)

    expect(buildStale).not.toHaveBeenCalled()
    expect(buildLatest).toHaveBeenCalledTimes(1)
    const entry = await mod.readSessionMessageSnapshot('server-a', 'session-1')
    expect(entry?.stateVersion).toBe(2)
    expect(entry?.messages).toEqual([{ role: 'user', content: 'latest' }])
  })

  it('skips the write when the builder returns null', async () => {
    const factory = new FakeFactory()
    vi.stubGlobal('indexedDB', factory)
    const mod = await importSessionCacheModule()

    mod.writeSessionMessageSnapshot('server-a', 'session-1', () => null, 0)
    await mod.flushPendingSessionMessageWrites()

    await expect(mod.readSessionMessageSnapshot('server-a', 'session-1')).resolves.toBeNull()
  })

  it('enforces the stateVersion high-water guard', async () => {
    const factory = new FakeFactory()
    vi.stubGlobal('indexedDB', factory)
    const mod = await importSessionCacheModule()

    mod.writeSessionMessageSnapshot('server-a', 'session-1', () => ({
      stateVersion: 5,
      messages: [{ role: 'user', content: 'v5' }],
      snapshot: {},
    }), 0)
    await mod.flushPendingSessionMessageWrites()

    const firstSavedAt = (await mod.readSessionMessageSnapshot('server-a', 'session-1'))?.savedAt

    // Equal version with different content must not overwrite.
    mod.writeSessionMessageSnapshot('server-a', 'session-1', () => ({
      stateVersion: 5,
      messages: [{ role: 'user', content: 'v5-edited' }],
      snapshot: {},
    }), 0)
    await mod.flushPendingSessionMessageWrites()
    expect((await mod.readSessionMessageSnapshot('server-a', 'session-1'))?.messages)
      .toEqual([{ role: 'user', content: 'v5' }])

    // Lower version must not overwrite either.
    mod.writeSessionMessageSnapshot('server-a', 'session-1', () => ({
      stateVersion: 4,
      messages: [{ role: 'user', content: 'v4' }],
      snapshot: {},
    }), 0)
    await mod.flushPendingSessionMessageWrites()
    expect((await mod.readSessionMessageSnapshot('server-a', 'session-1'))?.messages)
      .toEqual([{ role: 'user', content: 'v5' }])
    expect((await mod.readSessionMessageSnapshot('server-a', 'session-1'))?.savedAt).toBe(firstSavedAt)

    // A strictly higher version wins.
    mod.writeSessionMessageSnapshot('server-a', 'session-1', () => ({
      stateVersion: 6,
      messages: [{ role: 'user', content: 'v6' }],
      snapshot: {},
    }), 0)
    await mod.flushPendingSessionMessageWrites()
    expect((await mod.readSessionMessageSnapshot('server-a', 'session-1'))?.messages)
      .toEqual([{ role: 'user', content: 'v6' }])
  })

  it('flushes immediately on demand and cancels pending writes on request', async () => {
    vi.useFakeTimers()
    const factory = new FakeFactory()
    vi.stubGlobal('indexedDB', factory)
    const mod = await importSessionCacheModule()

    const build = vi.fn(() => ({ stateVersion: 1, messages: [], snapshot: {} }))
    mod.writeSessionMessageSnapshot('server-a', 'session-flush', build, 10_000)
    await mod.flushPendingSessionMessageWrites()
    await expect(mod.readSessionMessageSnapshot('server-a', 'session-flush')).resolves.toMatchObject({ stateVersion: 1 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(build).toHaveBeenCalledTimes(1)

    mod.writeSessionMessageSnapshot('server-a', 'session-cancel', build, 10_000)
    mod.cancelPendingSessionMessageWrites()
    await vi.advanceTimersByTimeAsync(20_000)
    await expect(mod.readSessionMessageSnapshot('server-a', 'session-cancel')).resolves.toBeNull()
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when indexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const mod = await importSessionCacheModule()

    expect(mod.getSessionMessageCache()).toBeNull()
    await expect(mod.readSessionMessageSnapshot('server-a', 'session-1')).resolves.toBeNull()
    expect(() => mod.writeSessionMessageSnapshot('server-a', 'session-1', () => ({ stateVersion: 1, messages: [], snapshot: {} }))).not.toThrow()
    await mod.flushPendingSessionMessageWrites()
    await expect(mod.readSessionMessageSnapshot('server-a', 'session-1')).resolves.toBeNull()
  })

  it('resolves the server cache key with baseUrl > direct backend > origin > unknown', async () => {
    const mod = await importSessionCacheModule()

    expect(mod.resolveServerCacheKey('http://backend.example/')).toBe('http://backend.example')
    expect(mod.resolveServerCacheKey(' http://backend.example ')).toBe('http://backend.example')

    backendUrlState.direct = 'http://127.0.0.1:32176'
    expect(mod.resolveServerCacheKey()).toBe('http://127.0.0.1:32176')
    expect(mod.resolveServerCacheKey('http://explicit.example')).toBe('http://explicit.example')

    backendUrlState.direct = ''
    vi.stubGlobal('location', { origin: 'https://app.example' })
    expect(mod.resolveServerCacheKey()).toBe('https://app.example')

    vi.stubGlobal('location', undefined)
    expect(mod.resolveServerCacheKey()).toBe('unknown')
  })
})
