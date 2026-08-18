/**
 * 会话消息只读快照缓存（IndexedDB 持久化）。
 *
 * 用途：刷新页面 / 重新进入会话时，先用本地快照立即渲染会话消息，再由
 * ServerAgent 通过 GET /state + /messages 后台校准。服务器永远是唯一权威，
 * 本缓存只是加速层：IndexedDB 不可用、条目损坏、版本回退时全部静默降级。
 */
import { getDirectBackendBaseUrl } from '@/lib/backend-url'
import { computeCacheKey, IndexedDbCache } from '@/lib/indexeddb-cache'

export const SESSION_MESSAGE_SNAPSHOT_SCHEMA_VERSION = 1
const DEFAULT_WRITE_DEBOUNCE_MS = 1500

export type SessionMessageSnapshotEntry = {
  schemaVersion: number
  serverKey: string
  sessionId: string
  stateVersion: number
  messageCount: number
  messages: unknown[]
  snapshot: Record<string, unknown>
  savedAt: number
}

export type SessionMessageWritePayload = {
  stateVersion: number
  messages: unknown[]
  snapshot: Record<string, unknown>
}

/**
 * 解析缓存归属的服务器标识：显式 baseUrl 优先（去尾部斜杠归一化），
 * 其次直连后端地址，再次当前页面 origin，最后 'unknown'。
 */
export function resolveServerCacheKey(baseUrl = ''): string {
  const trimmed = baseUrl.trim()
  if (trimmed) return trimmed.replace(/\/+$/, '')
  const direct = getDirectBackendBaseUrl()
  if (direct) return direct
  if (typeof location !== 'undefined' && location.origin) return location.origin
  return 'unknown'
}

let sessionMessageCache: IndexedDbCache | null = null

/** 模块级惰性单例；IndexedDB 不可用时返回 null。 */
export function getSessionMessageCache(): IndexedDbCache | null {
  if (!sessionMessageCache) {
    const cache = new IndexedDbCache({ storeName: 'session-messages', maxEntries: 40 })
    if (!cache.available()) return null
    sessionMessageCache = cache
  }
  return sessionMessageCache
}

function isValidSnapshotEntry(entry: unknown): entry is SessionMessageSnapshotEntry {
  if (!entry || typeof entry !== 'object') return false
  const candidate = entry as Partial<SessionMessageSnapshotEntry>
  return candidate.schemaVersion === SESSION_MESSAGE_SNAPSHOT_SCHEMA_VERSION
    && typeof candidate.serverKey === 'string'
    && typeof candidate.sessionId === 'string'
    && typeof candidate.stateVersion === 'number' && Number.isFinite(candidate.stateVersion) && candidate.stateVersion >= 0
    && typeof candidate.messageCount === 'number' && Number.isFinite(candidate.messageCount) && candidate.messageCount >= 0
    && Array.isArray(candidate.messages)
    && candidate.snapshot !== null && typeof candidate.snapshot === 'object' && !Array.isArray(candidate.snapshot)
}

/**
 * 读取会话消息快照：miss / 失败 / 条目结构损坏 → null（坏条目顺带删除）。
 */
export async function readSessionMessageSnapshot(serverKey: string, sessionId: string): Promise<SessionMessageSnapshotEntry | null> {
  const cache = getSessionMessageCache()
  if (!cache) return null
  const key = computeCacheKey([serverKey, sessionId])
  const entry = await cache.get<unknown>(key)
  if (entry === null) return null
  if (!isValidSnapshotEntry(entry)) {
    await cache.delete(key)
    return null
  }
  return entry
}

type PendingSessionMessageWrite = {
  serverKey: string
  sessionId: string
  timer: ReturnType<typeof setTimeout> | null
  build: () => SessionMessageWritePayload | null
}

const pendingWrites = new Map<string, PendingSessionMessageWrite>()

/**
 * 调度一次防抖快照写入（trailing）：同 key 重复调度会重置计时并覆盖
 * pending builder，flush 时只取最新 builder。IndexedDB 不可用时 no-op。
 */
export function writeSessionMessageSnapshot(
  serverKey: string,
  sessionId: string,
  build: () => SessionMessageWritePayload | null,
  delayMs = DEFAULT_WRITE_DEBOUNCE_MS,
): void {
  const cache = getSessionMessageCache()
  if (!cache) return
  const key = computeCacheKey([serverKey, sessionId])
  const existing = pendingWrites.get(key)
  if (existing?.timer) clearTimeout(existing.timer)
  const pending: PendingSessionMessageWrite = { serverKey, sessionId, timer: null, build }
  pendingWrites.set(key, pending)
  pending.timer = setTimeout(() => {
    void flushSessionMessageWrite(key)
  }, Math.max(0, delayMs))
}

async function flushSessionMessageWrite(key: string): Promise<void> {
  const pending = pendingWrites.get(key)
  if (!pending) return
  if (pending.timer) clearTimeout(pending.timer)
  pendingWrites.delete(key)
  const cache = getSessionMessageCache()
  if (!cache) return
  try {
    const payload = pending.build()
    if (!payload) return
    // stateVersion 高水位守卫：服务器版本没有前进就不回写（防御旧帧/回滚）。
    const previous = await cache.get<unknown>(key)
    if (previous && typeof previous === 'object'
      && typeof (previous as SessionMessageSnapshotEntry).stateVersion === 'number'
      && payload.stateVersion <= (previous as SessionMessageSnapshotEntry).stateVersion) {
      return
    }
    const entry: SessionMessageSnapshotEntry = {
      schemaVersion: SESSION_MESSAGE_SNAPSHOT_SCHEMA_VERSION,
      serverKey: pending.serverKey,
      sessionId: pending.sessionId,
      stateVersion: payload.stateVersion,
      messageCount: payload.messages.length,
      messages: payload.messages,
      snapshot: payload.snapshot,
      savedAt: Date.now(),
    }
    await cache.put(key, entry)
  } catch {
    // best-effort 写入，失败静默
  }
}

/** 立即执行全部 pending 写入（测试 / 收尾用）。 */
export async function flushPendingSessionMessageWrites(): Promise<void> {
  const keys = [...pendingWrites.keys()]
  await Promise.all(keys.map((key) => flushSessionMessageWrite(key)))
}

/** 丢弃全部 pending 写入（取消计时器，不落盘）。 */
export function cancelPendingSessionMessageWrites(): void {
  for (const pending of pendingWrites.values()) {
    if (pending.timer) clearTimeout(pending.timer)
  }
  pendingWrites.clear()
}
