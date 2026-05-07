import type { StorageBackend, StorageTransaction } from '@mariozechner/pi-web-ui'

const DEFAULT_BLOCKED_STORES = new Set<string>()

type StoreReadOverride = {
  keys?: (prefix?: string) => Promise<string[]>
  get?: <T = unknown>(key: string) => Promise<T | null>
  has?: (key: string) => Promise<boolean>
}

type StoreOverrides = Record<string, StoreReadOverride>

type BackendOptions = Iterable<string> | {
  blockedStores?: Iterable<string>
  storeOverrides?: StoreOverrides
  fakeProviderKeys?: Iterable<string>
}

type JsonResponse<T> = T & { error?: string }

function isIterableOptions(options: BackendOptions): options is Iterable<string> {
  return typeof (options as Iterable<string>)[Symbol.iterator] === 'function'
}

export class HttpStorageBackend implements StorageBackend {
  private readonly baseUrl: string
  private readonly blockedStores: Set<string>
  private readonly storeOverrides: StoreOverrides
  private readonly fakeProviderKeys: Set<string>

  constructor(baseUrl = '', options: BackendOptions = DEFAULT_BLOCKED_STORES) {
    this.baseUrl = baseUrl
    if (isIterableOptions(options)) {
      this.blockedStores = new Set(options)
      this.storeOverrides = {}
      this.fakeProviderKeys = new Set()
    } else {
      this.blockedStores = new Set(options.blockedStores ?? DEFAULT_BLOCKED_STORES)
      this.storeOverrides = options.storeOverrides ?? {}
      this.fakeProviderKeys = new Set(options.fakeProviderKeys ?? [])
    }
  }

  private assertStoreAccess(storeName: string) {
    if (this.blockedStores.has(storeName)) {
      throw new Error('This storage area is not available in the current page.')
    }
  }

  static async isAvailable(baseUrl = ''): Promise<boolean> {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 1000)

    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) return false
      const payload = await response.json().catch(() => null)
      return payload?.ok === true
    } catch {
      return false
    } finally {
      window.clearTimeout(timeout)
    }
  }

  private path(...parts: string[]) {
    return `${this.baseUrl}/api/storage/${parts.map((part) => encodeURIComponent(part)).join('/')}`
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
      ...init,
      cache: 'no-store',
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : undefined),
        ...init?.headers,
      },
    })

    const payload = (await response.json().catch(() => null)) as JsonResponse<T> | null

    if (!response.ok) {
      throw new Error(payload?.error || `Local storage request failed: ${response.status}`)
    }

    return payload as T
  }

  async get<T = unknown>(storeName: string, key: string): Promise<T | null> {
    if (storeName === 'provider-keys' && this.fakeProviderKeys.has(key)) return 'shared-server-managed-key' as T
    const override = this.storeOverrides[storeName]
    if (override?.get) return override.get<T>(key)
    this.assertStoreAccess(storeName)
    const payload = await this.request<{ value: T | null }>(this.path(storeName, 'key', key))
    return payload.value ?? null
  }

  async set<T = unknown>(storeName: string, key: string, value: T): Promise<void> {
    this.assertStoreAccess(storeName)
    await this.request<{ ok: boolean }>(this.path(storeName, 'key', key), {
      method: 'PUT',
      body: JSON.stringify({ value }),
    })
  }

  async delete(storeName: string, key: string): Promise<void> {
    this.assertStoreAccess(storeName)
    await this.request<{ ok: boolean }>(this.path(storeName, 'key', key), { method: 'DELETE' })
  }

  async keys(storeName: string, prefix?: string): Promise<string[]> {
    if (storeName === 'provider-keys' && this.fakeProviderKeys.size > 0) return [...this.fakeProviderKeys]
    const override = this.storeOverrides[storeName]
    if (override?.keys) return override.keys(prefix)
    this.assertStoreAccess(storeName)
    const search = prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''
    const payload = await this.request<{ keys: string[] }>(`${this.path(storeName, 'keys')}${search}`)
    return payload.keys
  }

  async getAllFromIndex<T = unknown>(
    storeName: string,
    indexName: string,
    direction: 'asc' | 'desc' = 'asc',
  ): Promise<T[]> {
    this.assertStoreAccess(storeName)
    const payload = await this.request<{ values: T[] }>(
      `${this.path(storeName, 'index', indexName)}?direction=${encodeURIComponent(direction)}`,
    )
    return payload.values
  }

  async fetchPaginatedFromIndex<T = unknown>(
    storeName: string,
    indexName: string,
    options: {
      direction?: 'asc' | 'desc'
      limit: number
      offset: number
      scope?: string
      projectId?: string
    },
  ): Promise<{ values: T[]; total: number }> {
    this.assertStoreAccess(storeName)
    const params = new URLSearchParams()
    params.set('direction', options.direction || 'desc')
    params.set('limit', String(options.limit))
    params.set('offset', String(options.offset))
    if (options.scope) params.set('scope', options.scope)
    if (options.projectId) params.set('projectId', options.projectId)

    return this.request<{ values: T[]; total: number }>(
      `${this.path(storeName, 'index', indexName)}?${params.toString()}`,
    )
  }

  async clear(storeName: string): Promise<void> {
    this.assertStoreAccess(storeName)
    await this.request<{ ok: boolean }>(this.path(storeName), { method: 'DELETE' })
  }

  async has(storeName: string, key: string): Promise<boolean> {
    if (storeName === 'provider-keys' && this.fakeProviderKeys.has(key)) return true
    const override = this.storeOverrides[storeName]
    if (override?.has) return override.has(key)
    this.assertStoreAccess(storeName)
    const payload = await this.request<{ exists: boolean }>(this.path(storeName, 'has', key))
    return payload.exists
  }

  async transaction<T>(
    storeNames: string[],
    _mode: 'readonly' | 'readwrite',
    operation: (tx: StorageTransaction) => Promise<T>,
  ): Promise<T> {
    for (const storeName of storeNames) {
      if (storeName === 'provider-keys' && this.fakeProviderKeys.size > 0) continue
      if (!this.storeOverrides[storeName]) this.assertStoreAccess(storeName)
    }
    const tx: StorageTransaction = {
      get: <Value = unknown>(storeName: string, key: string) => this.get<Value>(storeName, key),
      set: <Value = unknown>(storeName: string, key: string, value: Value) => this.set(storeName, key, value),
      delete: (storeName: string, key: string) => this.delete(storeName, key),
    }

    return operation(tx)
  }

  async getQuotaInfo(): Promise<{ usage: number; quota: number; percent: number }> {
    return this.request<{ usage: number; quota: number; percent: number }>(`${this.baseUrl}/api/storage/quota`)
  }

  async requestPersistence(): Promise<boolean> {
    return true
  }
}
