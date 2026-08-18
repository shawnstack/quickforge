import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpStorageBackend } from '../../src/lib/http-storage-backend'
// Direct file import: the package exports map only exposes the full UI bundle
// (Lit/pdfjs), which is unnecessary for the store classes.
// @ts-expect-error package subpath is not in the exports map
import { SessionsStore } from '../../node_modules/@earendil-works/pi-web-ui/dist/storage/stores/sessions-store.js'

const settingsSnapshotMocks = vi.hoisted(() => ({
  updateAppSettingSnapshotFromStorageSet: vi.fn(async () => undefined),
}))

vi.mock('@/lib/app-settings-cache', () => settingsSnapshotMocks)

type FetchCall = { url: string; init?: RequestInit }

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

describe('HttpStorageBackend transaction batching', () => {
  const calls: FetchCall[] = []
  let backend: HttpStorageBackend

  afterEach(() => {
    vi.unstubAllGlobals()
    calls.length = 0
  })

  function installFetchMock() {
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return jsonResponse({ ok: true })
    }))
  }

  it('SessionsStore.save issues a single batch commit, not two independent PUTs', async () => {
    installFetchMock()
    backend = new HttpStorageBackend('http://127.0.0.1:3456')
    const store = new SessionsStore()
    store.setBackend(backend)

    const data = { id: 's1', title: 'T', model: { provider: 'mock', id: 'm' }, thinkingLevel: 'off', messages: [], createdAt: '2026-01-01T00:00:00.000Z', lastModified: '2026-01-01T00:00:00.000Z' }
    const metadata = { id: 's1', title: 'T', createdAt: '2026-01-01T00:00:00.000Z', lastModified: '2026-01-01T00:00:00.000Z', messageCount: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, thinkingLevel: 'off', preview: '' }
    await store.save(data, metadata)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://127.0.0.1:3456/api/storage/batch')
    expect(calls[0].init?.method).toBe('POST')
    const body = JSON.parse(String(calls[0].init?.body)) as { operations: Array<{ store: string; type: string; key: string }> }
    expect(body.operations).toHaveLength(2)
    expect(body.operations.map((op) => `${op.store}:${op.type}:${op.key}`).sort()).toEqual([
      'sessions-metadata:set:s1',
      'sessions:set:s1',
    ])
  })

  it('SessionsStore.delete issues a single batch commit with both deletes', async () => {
    installFetchMock()
    backend = new HttpStorageBackend('http://127.0.0.1:3456')
    const store = new SessionsStore()
    store.setBackend(backend)

    await store.delete('s1')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://127.0.0.1:3456/api/storage/batch')
    const body = JSON.parse(String(calls[0].init?.body)) as { operations: Array<{ store: string; type: string }> }
    expect(body.operations).toEqual([
      { store: 'sessions', type: 'delete', key: 's1' },
      { store: 'sessions-metadata', type: 'delete', key: 's1' },
    ])
  })

  it('keeps the legacy per-operation path for non-session stores', async () => {
    installFetchMock()
    backend = new HttpStorageBackend('http://127.0.0.1:3456')
    await backend.transaction(['settings'], 'readwrite', async (tx) => {
      await tx.set('settings', 'k', { value: 1 })
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://127.0.0.1:3456/api/storage/settings/key/k')
    expect(calls[0].init?.method).toBe('PUT')
  })

  it('does not batch when a session store is overridden locally', async () => {
    installFetchMock()
    backend = new HttpStorageBackend('http://127.0.0.1:3456', {
      storeOverrides: {
        'sessions-metadata': { get: async () => null, has: async () => false },
      },
    })
    await backend.transaction(['sessions', 'sessions-metadata'], 'readwrite', async (tx) => {
      await tx.set('sessions', 's1', { id: 's1' })
      await tx.set('sessions-metadata', 's1', { id: 's1' })
    })

    expect(calls).toHaveLength(2)
    expect(calls.every((call) => !call.url.endsWith('/batch'))).toBe(true)
  })

  it('readonly transactions with no writes make no batch request', async () => {
    installFetchMock()
    backend = new HttpStorageBackend('http://127.0.0.1:3456')
    await backend.transaction(['sessions'], 'readonly', async () => 42)
    expect(calls).toHaveLength(0)
  })
})

describe('HttpStorageBackend settings snapshot write-through', () => {
  const calls: FetchCall[] = []

  beforeEach(() => {
    settingsSnapshotMocks.updateAppSettingSnapshotFromStorageSet.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    calls.length = 0
    settingsSnapshotMocks.updateAppSettingSnapshotFromStorageSet.mockClear()
  })

  function installFetchMock() {
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return jsonResponse({ ok: true })
    }))
  }

  it('updates the startup snapshot after a successful settings PUT', async () => {
    installFetchMock()
    const backend = new HttpStorageBackend()
    await backend.set('settings', 'appearance-settings', { theme: 'dark' })

    expect(calls).toHaveLength(1)
    expect(calls[0].init?.method).toBe('PUT')
    expect(settingsSnapshotMocks.updateAppSettingSnapshotFromStorageSet).toHaveBeenCalledTimes(1)
    expect(settingsSnapshotMocks.updateAppSettingSnapshotFromStorageSet).toHaveBeenCalledWith(
      'settings',
      'appearance-settings',
      { theme: 'dark' },
    )
  })

  it('normalizes undefined values to null for parity with GET semantics', async () => {
    installFetchMock()
    const backend = new HttpStorageBackend()
    await backend.set('settings', 'language', undefined as never)

    expect(settingsSnapshotMocks.updateAppSettingSnapshotFromStorageSet).toHaveBeenCalledWith(
      'settings',
      'language',
      null,
    )
  })

  it('still delegates non-settings stores to the write-through (cache module filters them)', async () => {
    installFetchMock()
    const backend = new HttpStorageBackend()
    await backend.set('sessions', 's1', { id: 's1' })

    expect(calls).toHaveLength(1)
    // storeName / 白名单键过滤在 updateAppSettingSnapshotFromStorageSet
    // 内完成（由 app-settings-cache.test.ts 覆盖）。
    expect(settingsSnapshotMocks.updateAppSettingSnapshotFromStorageSet).toHaveBeenCalledTimes(1)
    expect(settingsSnapshotMocks.updateAppSettingSnapshotFromStorageSet).toHaveBeenCalledWith(
      'sessions',
      's1',
      { id: 's1' },
    )
  })

  it('keeps the PUT result when the snapshot write-through rejects', async () => {
    installFetchMock()
    settingsSnapshotMocks.updateAppSettingSnapshotFromStorageSet.mockRejectedValueOnce(
      new Error('IndexedDB unavailable'),
    )
    const backend = new HttpStorageBackend()
    await expect(backend.set('settings', 'language', 'zh')).resolves.toBeUndefined()
    expect(calls).toHaveLength(1)
  })
})
