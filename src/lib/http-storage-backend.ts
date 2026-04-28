import type { StorageBackend, StorageTransaction } from '@mariozechner/pi-web-ui'

type JsonResponse<T> = T & { error?: string }

export class HttpStorageBackend implements StorageBackend {
  private readonly baseUrl: string

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl
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
    const payload = await this.request<{ value: T | null }>(this.path(storeName, 'key', key))
    return payload.value ?? null
  }

  async set<T = unknown>(storeName: string, key: string, value: T): Promise<void> {
    await this.request<{ ok: boolean }>(this.path(storeName, 'key', key), {
      method: 'PUT',
      body: JSON.stringify({ value }),
    })
  }

  async delete(storeName: string, key: string): Promise<void> {
    await this.request<{ ok: boolean }>(this.path(storeName, 'key', key), { method: 'DELETE' })
  }

  async keys(storeName: string, prefix?: string): Promise<string[]> {
    const search = prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''
    const payload = await this.request<{ keys: string[] }>(`${this.path(storeName, 'keys')}${search}`)
    return payload.keys
  }

  async getAllFromIndex<T = unknown>(
    storeName: string,
    indexName: string,
    direction: 'asc' | 'desc' = 'asc',
  ): Promise<T[]> {
    const payload = await this.request<{ values: T[] }>(
      `${this.path(storeName, 'index', indexName)}?direction=${encodeURIComponent(direction)}`,
    )
    return payload.values
  }

  async clear(storeName: string): Promise<void> {
    await this.request<{ ok: boolean }>(this.path(storeName), { method: 'DELETE' })
  }

  async has(storeName: string, key: string): Promise<boolean> {
    const payload = await this.request<{ exists: boolean }>(this.path(storeName, 'has', key))
    return payload.exists
  }

  async transaction<T>(
    _storeNames: string[],
    _mode: 'readonly' | 'readwrite',
    operation: (tx: StorageTransaction) => Promise<T>,
  ): Promise<T> {
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
