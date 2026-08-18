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

type WorkspaceCacheModule = typeof import('../../src/lib/workspace-cache')

async function importWorkspaceCacheModule(): Promise<WorkspaceCacheModule> {
  vi.resetModules()
  return import('../../src/lib/workspace-cache')
}

function storeOf(factory: FakeFactory): FakeObjectStore | undefined {
  return factory.dbs.get('quickforge-cache')?.stores.get('workspace-cache')
}

const directoryEntries = [
  { name: 'src', path: 'src', type: 'directory' as const },
  { name: 'a.txt', path: 'a.txt', type: 'file' as const },
]

describe('workspace-cache', () => {
  beforeEach(() => {
    vi.resetModules()
    backendUrlState.direct = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('round-trips directory entries through write and read', async () => {
    const factory = new FakeFactory()
    vi.stubGlobal('indexedDB', factory)
    const mod = await importWorkspaceCacheModule()

    expect(await mod.writeWorkspaceDirectoryCache('server-a', 'project-1', 'src', directoryEntries, null, false)).toBe(true)
    const entry = await mod.readWorkspaceDirectoryCache('server-a', 'project-1', 'src')
    expect(entry).toMatchObject({
      schemaVersion: 1,
      projectId: 'project-1',
      path: 'src',
      entries: directoryEntries,
      nextCursor: null,
      truncated: false,
    })
    expect(typeof entry?.fetchedAt).toBe('number')

    expect(await mod.readWorkspaceDirectoryCache('server-a', 'project-1', 'missing')).toBeNull()
    expect(await mod.readWorkspaceDirectoryCache('server-a', 'other-project', 'src')).toBeNull()
  })

  it('deletes structurally invalid directory entries instead of returning them', async () => {
    const factory = new FakeFactory()
    vi.stubGlobal('indexedDB', factory)
    const mod = await importWorkspaceCacheModule()

    await mod.writeWorkspaceDirectoryCache('server-a', 'project-1', 'src', directoryEntries, null, false)
    const store = storeOf(factory)
    expect(store).toBeDefined()
    const key = [...store!.entries.keys()][0]
    const wrapper = store!.entries.get(key) as { value: unknown }
    // Corrupt the cached value: entries is not an array of tree nodes.
    wrapper.value = { schemaVersion: 1, projectId: 'project-1', path: 'src', entries: 'not-an-array', nextCursor: null, truncated: false, fetchedAt: Date.now() }

    expect(await mod.readWorkspaceDirectoryCache('server-a', 'project-1', 'src')).toBeNull()
    expect(store!.entries.has(key)).toBe(false)
  })

  it('treats directory entries fresh within the ttl and stale past it', async () => {
    const mod = await importWorkspaceCacheModule()
    const entry = {
      schemaVersion: 1,
      projectId: 'project-1',
      path: 'src',
      entries: [],
      nextCursor: null,
      truncated: false,
      fetchedAt: 1000,
    }

    expect(mod.isWorkspaceDirectoryCacheFresh(entry, 1000, 30_000)).toBe(true)
    expect(mod.isWorkspaceDirectoryCacheFresh(entry, 1000 + mod.DIRECTORY_TTL_MS)).toBe(true)
    expect(mod.isWorkspaceDirectoryCacheFresh(entry, 1000 + mod.DIRECTORY_TTL_MS + 1)).toBe(false)
    expect(mod.isWorkspaceDirectoryCacheFresh(entry, 1000 + 500, 400)).toBe(false)
    expect(mod.isWorkspaceDirectoryCacheFresh(entry, 999)).toBe(false)
  })

  it('round-trips expanded paths and deletes invalid entries', async () => {
    const factory = new FakeFactory()
    vi.stubGlobal('indexedDB', factory)
    const mod = await importWorkspaceCacheModule()

    expect(await mod.writeWorkspaceExpandedCache('server-a', 'project-1', ['src', 'src/lib'])).toBe(true)
    expect(await mod.readWorkspaceExpandedCache('server-a', 'project-1')).toMatchObject({
      schemaVersion: 1,
      projectId: 'project-1',
      expandedPaths: ['src', 'src/lib'],
    })
    expect(await mod.readWorkspaceExpandedCache('server-a', 'other-project')).toBeNull()

    const store = storeOf(factory)!
    const key = [...store.entries.keys()].find((candidate) => candidate.endsWith('expanded'))
    expect(key).toBeDefined()
    const wrapper = store.entries.get(key!) as { value: unknown }
    wrapper.value = { schemaVersion: 1, projectId: 'project-1', expandedPaths: 'nope' }
    expect(await mod.readWorkspaceExpandedCache('server-a', 'project-1')).toBeNull()
    expect(store.entries.has(key!)).toBe(false)
  })

  it('round-trips file entries and validates them against meta', async () => {
    const factory = new FakeFactory()
    vi.stubGlobal('indexedDB', factory)
    const mod = await importWorkspaceCacheModule()

    expect(await mod.writeWorkspaceFileCache('server-a', 'project-1', { path: 'a.txt', content: 'hello', size: 5, mtimeMs: 123.5, language: 'plaintext' })).toBe(true)
    const entry = await mod.readWorkspaceFileCache('server-a', 'project-1', 'a.txt')
    expect(entry).toMatchObject({
      schemaVersion: 1,
      projectId: 'project-1',
      path: 'a.txt',
      content: 'hello',
      size: 5,
      mtimeMs: 123.5,
      language: 'plaintext',
    })
    expect(typeof entry?.fetchedAt).toBe('number')

    expect(mod.workspaceFileMatchesMeta(entry!, { size: 5, mtimeMs: 123.5 })).toBe(true)
    expect(mod.workspaceFileMatchesMeta(entry!, { size: 6, mtimeMs: 123.5 })).toBe(false)
    expect(mod.workspaceFileMatchesMeta(entry!, { size: 5, mtimeMs: 124 })).toBe(false)
    expect(mod.workspaceFileMatchesMeta(entry!, { size: 5 })).toBe(false)
    expect(mod.workspaceFileMatchesMeta(entry!, {})).toBe(false)
    expect(await mod.readWorkspaceFileCache('server-a', 'project-1', 'missing.txt')).toBeNull()
  })

  it('skips writing file content above the max cache length', async () => {
    const factory = new FakeFactory()
    vi.stubGlobal('indexedDB', factory)
    const mod = await importWorkspaceCacheModule()

    const oversized = 'x'.repeat(mod.WORKSPACE_FILE_MAX_CACHE_CONTENT_LENGTH + 1)
    expect(await mod.writeWorkspaceFileCache('server-a', 'project-1', { path: 'big.txt', content: oversized, size: oversized.length, mtimeMs: 1, language: 'plaintext' })).toBe(false)
    expect(await mod.readWorkspaceFileCache('server-a', 'project-1', 'big.txt')).toBeNull()
    expect([...storeOf(factory)!.entries.keys()]).toHaveLength(0)
  })

  it('is a silent no-op when IndexedDB is unavailable', async () => {
    const mod = await importWorkspaceCacheModule()

    expect(mod.getWorkspaceCache()).toBeNull()
    expect(await mod.readWorkspaceDirectoryCache('server-a', 'project-1', 'src')).toBeNull()
    expect(await mod.readWorkspaceExpandedCache('server-a', 'project-1')).toBeNull()
    expect(await mod.readWorkspaceFileCache('server-a', 'project-1', 'a.txt')).toBeNull()
    expect(await mod.writeWorkspaceDirectoryCache('server-a', 'project-1', 'src', [], null, false)).toBe(false)
    expect(await mod.writeWorkspaceExpandedCache('server-a', 'project-1', [])).toBe(false)
    expect(await mod.writeWorkspaceFileCache('server-a', 'project-1', { path: 'a.txt', content: 'hi', size: 2, mtimeMs: 1, language: 'plaintext' })).toBe(false)
  })
})
