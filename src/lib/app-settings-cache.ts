/**
 * 启动 Settings 快照缓存（stale-while-revalidate 加速层，F14）。
 *
 * 用途：启动时先用本地快照预应用语言/外观/字号/工具展示设置，再由
 * useAppBootstrap 的服务器校准序列覆盖。服务器永远是唯一权威；IndexedDB
 * 不可用、条目损坏、超限值全部静默降级（风格对齐 session-message-cache）。
 * import 期零副作用：不在模块加载时读取 indexedDB / window / location。
 */
import { computeCacheKey, IndexedDbCache } from '@/lib/indexeddb-cache'
import { resolveServerCacheKey } from '@/lib/session-message-cache'

export const APP_SETTINGS_SNAPSHOT_SCHEMA_VERSION = 1
/** 追踪的 settings 键白名单：只缓存启动预应用需要的四个键。 */
export const APP_SETTING_SNAPSHOT_KEYS = ['language', 'appearance-settings', 'font-size-settings', 'tool-display-settings'] as const
export type AppSettingSnapshotKey = (typeof APP_SETTING_SNAPSHOT_KEYS)[number]
/** 单值 JSON 序列化超过该长度则跳写，避免条目预算被超大值占满。 */
export const APP_SETTING_SNAPSHOT_MAX_VALUE_BYTES = 4 * 1024

export type AppSettingSnapshotEntry = {
  schemaVersion: number
  key: AppSettingSnapshotKey
  /** 允许任意 JSON 值（含 null），合法性由各消费方的 normalize 兜底。 */
  value: unknown
  savedAt: number
}

let appSettingsCache: IndexedDbCache | null = null

/** 模块级惰性单例；IndexedDB 不可用时返回 null。 */
function getAppSettingsCache(): IndexedDbCache | null {
  if (!appSettingsCache) {
    const cache = new IndexedDbCache({ storeName: 'app-settings', maxEntries: 8 })
    if (!cache.available()) return null
    appSettingsCache = cache
  }
  return appSettingsCache
}

function isTrackedSettingKey(key: string): key is AppSettingSnapshotKey {
  return (APP_SETTING_SNAPSHOT_KEYS as readonly string[]).includes(key)
}

function snapshotCacheKey(serverKey: string, key: string): string {
  return computeCacheKey([serverKey, key])
}

function isValidSnapshotEntry(entry: unknown): entry is AppSettingSnapshotEntry {
  if (!entry || typeof entry !== 'object') return false
  const candidate = entry as Partial<AppSettingSnapshotEntry>
  return candidate.schemaVersion === APP_SETTINGS_SNAPSHOT_SCHEMA_VERSION
    && typeof candidate.key === 'string'
    && isTrackedSettingKey(candidate.key)
    && typeof candidate.savedAt === 'number' && Number.isFinite(candidate.savedAt)
}

/**
 * 读取单个追踪键的快照值。统一以 null 作为“无可用快照”哨兵：
 * 键不在白名单、miss、条目结构损坏（顺带删除）或 IndexedDB 不可用均返回
 * null；存量为 null 的值（如后端写通的 null）同样按 miss 处理，交由服务器
 * 校准兜底（各消费方对 null 的 normalize 就是默认值，无正确性风险）。
 */
export async function readAppSettingSnapshotValue(serverKey: string, key: string): Promise<unknown> {
  if (!isTrackedSettingKey(key)) return null
  const cache = getAppSettingsCache()
  if (!cache) return null
  const cacheKey = snapshotCacheKey(serverKey, key)
  try {
    const entry = await cache.get<unknown>(cacheKey)
    if (entry === null) return null
    if (!isValidSnapshotEntry(entry)) {
      await cache.delete(cacheKey)
      return null
    }
    return entry.value
  } catch {
    return null
  }
}

/** 写入单个追踪键的快照值：白名单外 / 超 4KB / IndexedDB 不可用均静默跳过。 */
export async function writeAppSettingSnapshotValue(serverKey: string, key: string, value: unknown): Promise<void> {
  if (!isTrackedSettingKey(key)) return
  const cache = getAppSettingsCache()
  if (!cache) return
  try {
    const serialized = JSON.stringify(value)
    // 序列化抛错（循环引用）进 catch；undefined 序列化为 undefined 同样跳写。
    if (typeof serialized !== 'string' || serialized.length > APP_SETTING_SNAPSHOT_MAX_VALUE_BYTES) return
    const entry: AppSettingSnapshotEntry = {
      schemaVersion: APP_SETTINGS_SNAPSHOT_SCHEMA_VERSION,
      key,
      value,
      savedAt: Date.now(),
    }
    await cache.put(snapshotCacheKey(serverKey, key), entry)
  } catch {
    // best-effort：快照写失败绝不影响调用方
  }
}

/**
 * HttpStorageBackend.set 的写通入口：仅 settings store 的白名单键委托写
 * 快照；serverKey 在此解析一次（与启动读取侧一致，均按当前后端解析）。
 */
export async function updateAppSettingSnapshotFromStorageSet(storeName: string, key: string, value: unknown): Promise<void> {
  try {
    if (storeName !== 'settings' || !isTrackedSettingKey(key)) return
    await writeAppSettingSnapshotValue(resolveServerCacheKey(), key, value)
  } catch {
    // 写通 best-effort，任何异常静默
  }
}
