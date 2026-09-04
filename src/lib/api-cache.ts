/**
 * 通用 API 响应缓存（内存优先 + localStorage 持久化兜底）。
 *
 * 用途：对"数据相对稳定、可接受短暂陈旧"的 GET 接口做应用层缓存，
 * 减少本地服务器往返与序列化开销。缓存永远不是唯一数据源：
 * 任何缓存读取失败或过期都会回源请求。
 *
 * 失效机制：
 * - 业务写操作成功后调用 invalidateApiCache(pattern)；
 * - 其它标签页写入 localStorage 时通过 storage 事件丢弃本页内存副本。
 */

const STORAGE_KEY_PREFIX = 'quickforge:api-cache:v1:'
const SCHEMA_VERSION = 1
/** 持久化单条上限，避免把大响应写入 localStorage。 */
const MAX_PERSISTED_BYTES = 256 * 1024

type ApiCacheEntry<T> = {
  v: number
  cachedAt: number
  value: T
}

const memoryCache = new Map<string, ApiCacheEntry<unknown>>()

function storageKeyFor(key: string) {
  return `${STORAGE_KEY_PREFIX}${key}`
}

function isFresh(entry: ApiCacheEntry<unknown> | null | undefined, ttlMs: number): entry is ApiCacheEntry<unknown> {
  return entry !== null && entry !== undefined && Date.now() - entry.cachedAt <= ttlMs
}

function readPersisted<T>(key: string): ApiCacheEntry<T> | null {
  try {
    const raw = globalThis.localStorage?.getItem(storageKeyFor(key))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ApiCacheEntry<T>
    if (parsed.v !== SCHEMA_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * 读取未过期的缓存条目；无有效缓存返回 null。
 */
export function readApiCache<T>(key: string, ttlMs: number): T | null {
  const memoryEntry = memoryCache.get(key) as ApiCacheEntry<T> | undefined
  if (isFresh(memoryEntry, ttlMs)) return memoryEntry.value
  if (memoryEntry) memoryCache.delete(key)

  const persisted = readPersisted<T>(key)
  if (!isFresh(persisted, ttlMs)) {
    if (persisted) {
      try {
        globalThis.localStorage?.removeItem(storageKeyFor(key))
      } catch {
        // 忽略
      }
    }
    return null
  }
  memoryCache.set(key, persisted as ApiCacheEntry<unknown>)
  return persisted.value
}

/**
 * 写入缓存（内存 + localStorage）。localStorage 仅在数据量可接受时写入。
 */
export function writeApiCache(key: string, value: unknown): void {
  const entry: ApiCacheEntry<unknown> = { v: SCHEMA_VERSION, cachedAt: Date.now(), value }
  memoryCache.set(key, entry)
  try {
    const serialized = JSON.stringify(entry)
    if (serialized.length <= MAX_PERSISTED_BYTES) {
      globalThis.localStorage?.setItem(storageKeyFor(key), serialized)
    }
  } catch {
    // 存储不可用（隐私模式等）时仅保留内存副本
  }
}

/**
 * 按精确 key 或正则匹配失效缓存（内存 + localStorage）。
 */
export function invalidateApiCache(pattern: string | RegExp): void {
  const matches = (key: string) => (typeof pattern === 'string' ? key === pattern : pattern.test(key))
  for (const key of [...memoryCache.keys()]) {
    if (!matches(key)) continue
    memoryCache.delete(key)
    try {
      globalThis.localStorage?.removeItem(storageKeyFor(key))
    } catch {
      // 忽略
    }
  }
}

// 跨标签页同步：其它标签页写入或失效缓存时，丢弃本页内存副本
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key && event.key.startsWith(STORAGE_KEY_PREFIX)) {
      memoryCache.delete(event.key.slice(STORAGE_KEY_PREFIX.length))
    }
  })
}
