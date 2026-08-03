import type { Api, Model } from '@earendil-works/pi-ai'

const STORAGE_KEY = 'quickforge:model-list-cache:v1'
const SCHEMA_VERSION = 1
export const MODEL_LIST_CACHE_TTL_MS = 10 * 60 * 1000

type ModelListCacheEntry = {
  v: number
  cachedAt: number
  models: Model<Api>[]
}

let memoryCache: ModelListCacheEntry | null = null

function readEntry(): ModelListCacheEntry | null {
  if (memoryCache) return memoryCache
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ModelListCacheEntry
    if (parsed.v !== SCHEMA_VERSION || !Array.isArray(parsed.models)) return null
    memoryCache = parsed
    return parsed
  } catch {
    return null
  }
}

/**
 * 读取未过期的模型列表缓存（缓存优先路径）。
 * TTL 内返回模型列表，无有效缓存返回 null。
 */
export function readCachedModelList(ttlMs = MODEL_LIST_CACHE_TTL_MS): Model<Api>[] | null {
  const entry = readEntry()
  if (!entry) return null
  if (Date.now() - entry.cachedAt > ttlMs) return null
  return entry.models
}

/**
 * 忽略 TTL 读取缓存，用于后端请求失败时的兜底。
 */
export function readCachedModelListStale(): Model<Api>[] | null {
  return readEntry()?.models ?? null
}

export function writeCachedModelList(models: Model<Api>[]) {
  const entry: ModelListCacheEntry = { v: SCHEMA_VERSION, cachedAt: Date.now(), models }
  memoryCache = entry
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(entry))
  } catch {
    // 存储不可用（隐私模式等）时仅保留内存副本
  }
}

/**
 * 模型 / Provider / 密钥变更成功后调用，使下次打开选择器重新拉取后端。
 */
export function clearModelListCache() {
  memoryCache = null
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    // 忽略
  }
}

// 跨标签页同步：其它标签页写入或清除缓存时，丢弃本页内存副本
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) memoryCache = null
  })
}
