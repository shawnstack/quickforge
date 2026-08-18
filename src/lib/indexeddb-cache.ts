/**
 * 通用只读快照缓存（IndexedDB 持久化）。
 *
 * 设计约束：
 * - 缓存永远不是唯一数据源：任何失败（IndexedDB 不可用、open 失败、条目
 *   schemaVersion 不符）都静默降级为 null/false，绝不向调用方抛错。
 * - import 期零副作用：不在模块加载时读取 indexedDB / window / location，
 *   factory 仅在惰性 open 时求值。
 * - 条目级 SCHEMA_VERSION：结构升级后旧条目读取即 miss，无需迁移。
 */

export const CACHE_DB_NAME = 'quickforge-cache'
export const CACHE_STORE_NAME = 'entries'
export const CACHE_SCHEMA_VERSION = 1

/** 淘汰策略候选条目元数据。 */
export type CacheEvictionCandidate = {
  key: string
  bytes: number
  lastUsed: number
}

export type IndexedDbCacheEntry<T = unknown> = {
  key: string
  value: T
  schemaVersion: number
  bytes: number
  savedAt: number
  lastUsed: number
}

/** join('::')，纯函数，供组装复合缓存 key。 */
export function computeCacheKey(parts: string[]): string {
  return parts.join('::')
}

/**
 * 纯 LRU 淘汰策略：按 lastUsed 升序（最久未用优先）淘汰，直到条目数与
 * 字节预算同时满足上限；至少保留最新一条（避免超大条目写入即被自我淘汰）。
 */
export function selectEvictionKeys(entries: CacheEvictionCandidate[], maxEntries: number, maxBytes: number): string[] {
  const ordered = [...entries].sort((left, right) => left.lastUsed - right.lastUsed)
  let totalBytes = 0
  for (const entry of ordered) totalBytes += Math.max(0, entry.bytes)
  const evicted: string[] = []
  for (const entry of ordered) {
    const remainingCount = ordered.length - evicted.length
    if (remainingCount <= maxEntries && totalBytes <= maxBytes) break
    if (remainingCount <= 1) break
    evicted.push(entry.key)
    totalBytes -= Math.max(0, entry.bytes)
  }
  return evicted
}

// --- 最小结构化 IndexedDB 类型（仅覆盖本封装用到的面） ----------------------

type MinimalIdbRequestLike<T = unknown> = {
  onsuccess: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  result?: T
}

type MinimalIdbOpenRequestLike<T = unknown> = MinimalIdbRequestLike<T> & {
  onupgradeneeded: ((event: unknown) => void) | null
  onblocked: ((event: unknown) => void) | null
}

type MinimalIdbFactoryLike = {
  open(name: string, version?: number): MinimalIdbOpenRequestLike<unknown>
}

type MinimalIdbObjectStoreLike = {
  get(key: unknown): MinimalIdbRequestLike<unknown>
  put(value: unknown, key?: unknown): MinimalIdbRequestLike<unknown>
  delete(key: unknown): MinimalIdbRequestLike<unknown>
  getAllKeys(): MinimalIdbRequestLike<unknown[]>
  getAll(): MinimalIdbRequestLike<unknown[]>
  clear(): MinimalIdbRequestLike<unknown>
}

type MinimalIdbTransactionLike = {
  objectStore(name: string): MinimalIdbObjectStoreLike
}

type MinimalIdbDatabaseLike = {
  objectStoreNames: { contains(name: string): boolean }
  createObjectStore(name: string): unknown
  transaction(storeNames: string | string[], mode?: 'readonly' | 'readwrite'): MinimalIdbTransactionLike
  close(): void
  onversionchange: ((event: unknown) => void) | null
}

/** factory 返回宿主 indexedDB；返回 null/undefined 视为不可用。 */
export type IndexedDbCacheFactory = () => MinimalIdbFactoryLike | null | undefined

const defaultFactory: IndexedDbCacheFactory = () => {
  const indexedDB = (globalThis as { indexedDB?: unknown }).indexedDB
  return (indexedDB as MinimalIdbFactoryLike | undefined) ?? undefined
}

export type IndexedDbCacheOptions = {
  dbName?: string
  storeName?: string
  maxEntries?: number
  maxBytes?: number
  factory?: IndexedDbCacheFactory
}

function estimateBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? serialized.length : 0
  } catch {
    return 0
  }
}

function requestToPromise<T>(request: MinimalIdbRequestLike<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(new Error('IndexedDB request failed'))
  })
}

export class IndexedDbCache {
  private readonly dbName: string
  private readonly storeName: string
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly factory: IndexedDbCacheFactory
  private openPromise: Promise<MinimalIdbDatabaseLike | null> | null = null

  constructor(options: IndexedDbCacheOptions = {}) {
    this.dbName = options.dbName ?? CACHE_DB_NAME
    this.storeName = options.storeName ?? CACHE_STORE_NAME
    this.maxEntries = options.maxEntries ?? 40
    this.maxBytes = options.maxBytes ?? 64 * 1024 * 1024
    this.factory = options.factory ?? defaultFactory
  }

  /** indexedDB 存在且非 undefined（惰性求值，不抛错）。 */
  available(): boolean {
    try {
      return this.factory() != null
    } catch {
      return false
    }
  }

  /**
   * 读取缓存值：miss / 失败 / 条目 schemaVersion 不符 → null。
   * 命中时 best-effort 更新 lastUsed（更新失败不影响返回值）。
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const db = await this.open()
      if (!db) return null
      const entry = await requestToPromise(
        db.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(key),
      ) as IndexedDbCacheEntry<T> | undefined
      if (!entry || typeof entry !== 'object') return null
      if (entry.schemaVersion !== CACHE_SCHEMA_VERSION) return null
      try {
        entry.lastUsed = Date.now()
        await requestToPromise(db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).put(entry, key))
      } catch {
        // lastUsed 刷新是尽力而为
      }
      return entry.value ?? null
    } catch {
      return null
    }
  }

  /**
   * 写入缓存（best-effort）：成功后按 LRU 策略淘汰超额条目；任何异常 → false。
   */
  async put(key: string, value: unknown): Promise<boolean> {
    try {
      const db = await this.open()
      if (!db) return false
      const now = Date.now()
      const entry: IndexedDbCacheEntry = {
        key,
        value,
        schemaVersion: CACHE_SCHEMA_VERSION,
        bytes: estimateBytes(value),
        savedAt: now,
        lastUsed: now,
      }
      await requestToPromise(db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).put(entry, key))
      await this.evictIfNeeded(db)
      return true
    } catch {
      return false
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const db = await this.open()
      if (!db) return false
      await requestToPromise(db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).delete(key))
      return true
    } catch {
      return false
    }
  }

  async keys(): Promise<string[]> {
    try {
      const db = await this.open()
      if (!db) return []
      const keys = await requestToPromise(
        db.transaction(this.storeName, 'readonly').objectStore(this.storeName).getAllKeys(),
      )
      return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : []
    } catch {
      return []
    }
  }

  async clear(): Promise<boolean> {
    try {
      const db = await this.open()
      if (!db) return false
      await requestToPromise(db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).clear())
      return true
    } catch {
      return false
    }
  }

  // --- internals ---------------------------------------------------------

  /** DB open 惰性单例 promise；失败时清空缓存以便下次重试。 */
  private open(): Promise<MinimalIdbDatabaseLike | null> {
    if (!this.openPromise) {
      this.openPromise = this.doOpen().catch(() => {
        this.openPromise = null
        return null
      })
    }
    return this.openPromise
  }

  private doOpen(): Promise<MinimalIdbDatabaseLike> {
    return new Promise<MinimalIdbDatabaseLike>((resolve, reject) => {
      let factory: MinimalIdbFactoryLike | null | undefined
      try {
        factory = this.factory()
      } catch {
        factory = null
      }
      if (!factory) {
        reject(new Error('IndexedDB unavailable'))
        return
      }
      const request = factory.open(this.dbName, CACHE_SCHEMA_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result as unknown as MinimalIdbDatabaseLike
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName)
        }
      }
      request.onblocked = () => reject(new Error('IndexedDB open blocked'))
      request.onsuccess = () => {
        const db = request.result as unknown as MinimalIdbDatabaseLike
        db.onversionchange = () => {
          try {
            db.close()
          } catch {
            // ignore
          }
        }
        resolve(db)
      }
      request.onerror = () => reject(new Error('IndexedDB open failed'))
    })
  }

  private async evictIfNeeded(db: MinimalIdbDatabaseLike): Promise<void> {
    const entries = await requestToPromise(
      db.transaction(this.storeName, 'readonly').objectStore(this.storeName).getAll(),
    )
    if (!Array.isArray(entries)) return
    const candidates: CacheEvictionCandidate[] = []
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue
      const meta = entry as Partial<IndexedDbCacheEntry>
      if (typeof meta.key !== 'string') continue
      candidates.push({
        key: meta.key,
        bytes: typeof meta.bytes === 'number' && Number.isFinite(meta.bytes) ? meta.bytes : 0,
        lastUsed: typeof meta.lastUsed === 'number' && Number.isFinite(meta.lastUsed) ? meta.lastUsed : 0,
      })
    }
    const evicted = selectEvictionKeys(candidates, this.maxEntries, this.maxBytes)
    if (evicted.length === 0) return
    const store = db.transaction(this.storeName, 'readwrite').objectStore(this.storeName)
    await Promise.all(evicted.map((key) => requestToPromise(store.delete(key))))
  }
}

/** 模块级便捷探测：当前宿主是否暴露 indexedDB。 */
export function isIndexedDbCacheAvailable(): boolean {
  return new IndexedDbCache().available()
}
