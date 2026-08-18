import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const backendUrlState = vi.hoisted(() => ({ direct: '' }))

vi.mock('@/lib/backend-url', () => ({
  getDirectBackendBaseUrl: () => backendUrlState.direct,
}))

// --- Minimal fake IndexedDB (shared shape with session-message-cache.test.ts) ---

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

type AppSettingsCacheModule = typeof import('../../src/lib/app-settings-cache')

async function importAppSettingsCacheModule(): Promise<AppSettingsCacheModule> {
  vi.resetModules()
  return import('../../src/lib/app-settings-cache')
}

function storeOf(factory: FakeFactory): FakeObjectStore | undefined {
  return factory.dbs.get('quickforge-cache')?.stores.get('app-settings')
}

describe('app-settings-cache', () => {
  beforeEach(() => {
    vi.resetModules()
    backendUrlState.direct = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('round-trips a tracked settings value through write and read', async () => {
    const factory = new FakeFactory()
    vi.stubGlobal('indexedDB', factory)
    const mod = await importAppSettingsCacheModule()

    await mod.writeAppSettingSnapshotValue('server-a', 'language', 'zh')
    const store = storeOf(factory)
    expect(store).toBeDefined()
    const wrapper = store!.entries.get('server-a::language') as { value: Record<string, unknown> }
    expect(wrapper.value).toMatchObject({
      schemaVersion: 1,
      key: 'language',
      value: 'zh',
    })
    expect(typeof wrapper.value.savedAt).toBe('number')

    await expect(mod.readAppSettingSnapshotValue('server-a', 'language')).resolves.toBe('zh')
    // 快照按 serverKey 隔离：其他服务器视为 miss。
    await expect(mod.readAppSettingSnapshotValue('server-b', 'language')).resolves.toBeNull()
  })

  it('rejects reads and writes for keys outside the whitelist', async () => {
    const factory = new FakeFactory()
    vi.stubGlobal('indexedDB', factory)
    const mod = await importAppSettingsCacheModule()

    // Healthy write first so the DB and store exist.
    await mod.writeAppSettingSnapshotValue('server-a', 'language', 'zh')
    await mod.writeAppSettingSnapshotValue('server-a', 'agent-access-mode', { mode: 'yolo' })
    await expect(mod.readAppSettingSnapshotValue('server-a', 'agent-access-mode')).resolves.toBeNull()
    const store = storeOf(factory)!
    expect([...store.entries.keys()]).toEqual(['server-a::language'])
  })

  it('deletes and returns null for structurally invalid entries', async () => {
    const factory = new FakeFactory()
    vi.stubGlobal('indexedDB', factory)
    const mod = await importAppSettingsCacheModule()

    // Healthy write first so the DB and store exist.
    await mod.writeAppSettingSnapshotValue('server-a', 'appearance-settings', { theme: 'dark' })
    const store = storeOf(factory)!

    const key = 'server-a::appearance-settings'
    const wrapper = store.entries.get(key) as { value: unknown }
    wrapper.value = { schemaVersion: 1, key: 'appearance-settings', value: { theme: 'dark' }, savedAt: 'not-a-number' }

    await expect(mod.readAppSettingSnapshotValue('server-a', 'appearance-settings')).resolves.toBeNull()
    expect(store.entries.has(key)).toBe(false)
  })

  it('skips writing values whose JSON payload exceeds the size budget', async () => {
    const factory = new FakeFactory()
    vi.stubGlobal('indexedDB', factory)
    const mod = await importAppSettingsCacheModule()

    // Healthy write first so the DB and store exist.
    await mod.writeAppSettingSnapshotValue('server-a', 'appearance-settings', { theme: 'dark' })
    const oversized = { theme: 'dark', pad: 'x'.repeat(mod.APP_SETTING_SNAPSHOT_MAX_VALUE_BYTES) }
    await mod.writeAppSettingSnapshotValue('server-a', 'appearance-settings', oversized)
    const store = storeOf(factory)!
    expect(store.entries.size).toBe(1)
    const wrapper = store.entries.get('server-a::appearance-settings') as { value: { value: unknown } }
    expect(wrapper.value.value).toEqual({ theme: 'dark' })
  })

  it('is a silent no-op when IndexedDB is unavailable', async () => {
    // node 环境默认无 indexedDB 全局。
    const mod = await importAppSettingsCacheModule()

    await expect(mod.readAppSettingSnapshotValue('server-a', 'language')).resolves.toBeNull()
    await expect(mod.writeAppSettingSnapshotValue('server-a', 'language', 'zh')).resolves.toBeUndefined()
    await expect(
      mod.updateAppSettingSnapshotFromStorageSet('settings', 'language', 'zh'),
    ).resolves.toBeUndefined()
  })

  it('updateAppSettingSnapshotFromStorageSet filters by settings store, whitelist key, and resolves serverKey once', async () => {
    const factory = new FakeFactory()
    vi.stubGlobal('indexedDB', factory)
    backendUrlState.direct = 'http://127.0.0.1:3456'
    const mod = await importAppSettingsCacheModule()

    await mod.updateAppSettingSnapshotFromStorageSet('settings', 'font-size-settings', { interfaceFontSizePx: 14 })
    await mod.updateAppSettingSnapshotFromStorageSet('projects', 'font-size-settings', { interfaceFontSizePx: 14 })
    await mod.updateAppSettingSnapshotFromStorageSet('settings', 'memory-settings', { enabled: true })

    const store = storeOf(factory)!
    expect([...store.entries.keys()]).toEqual(['http://127.0.0.1:3456::font-size-settings'])
    await expect(mod.readAppSettingSnapshotValue('http://127.0.0.1:3456', 'font-size-settings')).resolves.toEqual({
      interfaceFontSizePx: 14,
    })
  })
})
