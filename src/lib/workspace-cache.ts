/**
 * Workspace 文件树 / 文件内容只读快照缓存（IndexedDB 持久化）。
 *
 * 用途：刷新页面或重新打开 Inspector 时，先用本地快照立即渲染目录树与
 * 文件内容，再后台校准（目录 SWR；文件用 size+mtimeMs 元信息校验）。
 * 服务器永远是唯一权威，本缓存只是加速层：IndexedDB 不可用、条目损坏、
 * 版本回退时全部静默降级（风格对齐 session-message-cache.ts）。
 */
import type { WorkspaceTreeNode } from '@/components/workspace/workspace-types'
import { computeCacheKey, IndexedDbCache } from '@/lib/indexeddb-cache'
import { resolveServerCacheKey } from '@/lib/session-message-cache'

export const WORKSPACE_CACHE_SCHEMA_VERSION = 1
/** 目录快照新鲜阈值：TTL 内直接采用缓存（零网络），过期则先渲染再后台校准。 */
export const DIRECTORY_TTL_MS = 30_000
/** 内容超过该长度的文件不写入缓存，防止字节预算被超大文件耗尽。 */
export const WORKSPACE_FILE_MAX_CACHE_CONTENT_LENGTH = 1024 * 1024

const WORKSPACE_CACHE_MAX_ENTRIES = 240
const WORKSPACE_CACHE_MAX_BYTES = 32 * 1024 * 1024

export type WorkspaceDirectoryCacheEntry = {
  schemaVersion: number
  projectId: string
  path: string
  entries: WorkspaceTreeNode[]
  nextCursor: string | null
  truncated: boolean
  fetchedAt: number
}

export type WorkspaceExpandedCacheEntry = {
  schemaVersion: number
  projectId: string
  expandedPaths: string[]
}

export type WorkspaceFileCacheEntry = {
  schemaVersion: number
  projectId: string
  path: string
  content: string
  size: number
  mtimeMs: number
  language: string
  fetchedAt: number
}

/** 文件元信息（来自 GET /file 或 GET /file?meta=1），用于校验缓存快照。 */
export type WorkspaceFileMetaLike = {
  size?: number
  mtimeMs?: number
}

export type WorkspaceFileCacheInput = {
  path: string
  content: string
  size: number
  mtimeMs: number
  language: string
}

let workspaceCache: IndexedDbCache | null = null

/** 模块级惰性单例；IndexedDB 不可用时返回 null。 */
export function getWorkspaceCache(): IndexedDbCache | null {
  if (!workspaceCache) {
    const cache = new IndexedDbCache({ storeName: 'workspace-cache', maxEntries: WORKSPACE_CACHE_MAX_ENTRIES, maxBytes: WORKSPACE_CACHE_MAX_BYTES })
    if (!cache.available()) return null
    workspaceCache = cache
  }
  return workspaceCache
}

/** serverKey 缺省时按当前后端解析（复用 session-message-cache 的实现）。 */
function cacheServerKey(serverKey: string): string {
  return serverKey || resolveServerCacheKey()
}

function workspaceDirectoryCacheKey(serverKey: string, projectId: string, path: string): string {
  return computeCacheKey([cacheServerKey(serverKey), projectId, 'directory', path])
}

function workspaceExpandedCacheKey(serverKey: string, projectId: string): string {
  return computeCacheKey([cacheServerKey(serverKey), projectId, 'expanded'])
}

function workspaceFileCacheKey(serverKey: string, projectId: string, path: string): string {
  return computeCacheKey([cacheServerKey(serverKey), projectId, 'file', path])
}

function isValidWorkspaceTreeNode(value: unknown): value is WorkspaceTreeNode {
  if (!value || typeof value !== 'object') return false
  const node = value as Partial<WorkspaceTreeNode>
  return typeof node.name === 'string'
    && typeof node.path === 'string'
    && (node.type === 'file' || node.type === 'directory')
}

function isValidDirectoryEntry(entry: unknown): entry is WorkspaceDirectoryCacheEntry {
  if (!entry || typeof entry !== 'object') return false
  const candidate = entry as Partial<WorkspaceDirectoryCacheEntry>
  return candidate.schemaVersion === WORKSPACE_CACHE_SCHEMA_VERSION
    && typeof candidate.projectId === 'string'
    && typeof candidate.path === 'string'
    && Array.isArray(candidate.entries)
    && candidate.entries.every(isValidWorkspaceTreeNode)
    && (candidate.nextCursor === null || typeof candidate.nextCursor === 'string')
    && typeof candidate.truncated === 'boolean'
    && typeof candidate.fetchedAt === 'number' && Number.isFinite(candidate.fetchedAt)
}

function isValidExpandedEntry(entry: unknown): entry is WorkspaceExpandedCacheEntry {
  if (!entry || typeof entry !== 'object') return false
  const candidate = entry as Partial<WorkspaceExpandedCacheEntry>
  return candidate.schemaVersion === WORKSPACE_CACHE_SCHEMA_VERSION
    && typeof candidate.projectId === 'string'
    && Array.isArray(candidate.expandedPaths)
    && candidate.expandedPaths.every((path) => typeof path === 'string')
}

function isValidFileEntry(entry: unknown): entry is WorkspaceFileCacheEntry {
  if (!entry || typeof entry !== 'object') return false
  const candidate = entry as Partial<WorkspaceFileCacheEntry>
  return candidate.schemaVersion === WORKSPACE_CACHE_SCHEMA_VERSION
    && typeof candidate.projectId === 'string'
    && typeof candidate.path === 'string'
    && typeof candidate.content === 'string'
    && typeof candidate.size === 'number' && Number.isFinite(candidate.size)
    && typeof candidate.mtimeMs === 'number' && Number.isFinite(candidate.mtimeMs)
    && typeof candidate.language === 'string'
    && typeof candidate.fetchedAt === 'number' && Number.isFinite(candidate.fetchedAt)
}

/** 读取目录快照：miss / 失败 / 结构损坏 → null（坏条目顺带删除）。 */
export async function readWorkspaceDirectoryCache(serverKey: string, projectId: string, path: string): Promise<WorkspaceDirectoryCacheEntry | null> {
  const cache = getWorkspaceCache()
  if (!cache) return null
  const key = workspaceDirectoryCacheKey(serverKey, projectId, path)
  const entry = await cache.get<unknown>(key)
  if (entry === null) return null
  if (!isValidDirectoryEntry(entry)) {
    await cache.delete(key)
    return null
  }
  return entry
}

/** 纯函数：目录快照是否仍在新鲜阈值内（0 ≤ age ≤ ttl 视为新鲜）。 */
export function isWorkspaceDirectoryCacheFresh(entry: WorkspaceDirectoryCacheEntry, now = Date.now(), ttlMs = DIRECTORY_TTL_MS): boolean {
  const age = now - entry.fetchedAt
  return age >= 0 && age <= ttlMs
}

/** best-effort 写入完整目录快照（部分页 / append 页由调用方避免写入）。 */
export async function writeWorkspaceDirectoryCache(
  serverKey: string,
  projectId: string,
  path: string,
  entries: WorkspaceTreeNode[],
  nextCursor: string | null,
  truncated: boolean,
): Promise<boolean> {
  const cache = getWorkspaceCache()
  if (!cache) return false
  const entry: WorkspaceDirectoryCacheEntry = {
    schemaVersion: WORKSPACE_CACHE_SCHEMA_VERSION,
    projectId,
    path,
    entries,
    nextCursor,
    truncated,
    fetchedAt: Date.now(),
  }
  return cache.put(workspaceDirectoryCacheKey(serverKey, projectId, path), entry)
}

/** 读取展开路径快照：miss / 失败 / 结构损坏 → null（坏条目顺带删除）。 */
export async function readWorkspaceExpandedCache(serverKey: string, projectId: string): Promise<WorkspaceExpandedCacheEntry | null> {
  const cache = getWorkspaceCache()
  if (!cache) return null
  const key = workspaceExpandedCacheKey(serverKey, projectId)
  const entry = await cache.get<unknown>(key)
  if (entry === null) return null
  if (!isValidExpandedEntry(entry)) {
    await cache.delete(key)
    return null
  }
  return entry
}

/** best-effort 同步写入展开路径集合（无防抖：数据量小、写入频率低，取简单实现）。 */
export async function writeWorkspaceExpandedCache(serverKey: string, projectId: string, expandedPaths: string[]): Promise<boolean> {
  const cache = getWorkspaceCache()
  if (!cache) return false
  const entry: WorkspaceExpandedCacheEntry = {
    schemaVersion: WORKSPACE_CACHE_SCHEMA_VERSION,
    projectId,
    expandedPaths,
  }
  return cache.put(workspaceExpandedCacheKey(serverKey, projectId), entry)
}

/** 读取文件内容快照：miss / 失败 / 结构损坏 → null（坏条目顺带删除）。 */
export async function readWorkspaceFileCache(serverKey: string, projectId: string, path: string): Promise<WorkspaceFileCacheEntry | null> {
  const cache = getWorkspaceCache()
  if (!cache) return null
  const key = workspaceFileCacheKey(serverKey, projectId, path)
  const entry = await cache.get<unknown>(key)
  if (entry === null) return null
  if (!isValidFileEntry(entry)) {
    await cache.delete(key)
    return null
  }
  return entry
}

/**
 * best-effort 写入文件内容快照；内容超过 WORKSPACE_FILE_MAX_CACHE_CONTENT_LENGTH
 * 时跳过写入并返回 false，防止字节预算被超大文件耗尽。
 */
export async function writeWorkspaceFileCache(serverKey: string, projectId: string, file: WorkspaceFileCacheInput): Promise<boolean> {
  const cache = getWorkspaceCache()
  if (!cache) return false
  if (file.content.length > WORKSPACE_FILE_MAX_CACHE_CONTENT_LENGTH) return false
  const entry: WorkspaceFileCacheEntry = {
    schemaVersion: WORKSPACE_CACHE_SCHEMA_VERSION,
    projectId,
    path: file.path,
    content: file.content,
    size: file.size,
    mtimeMs: file.mtimeMs,
    language: file.language,
    fetchedAt: Date.now(),
  }
  return cache.put(workspaceFileCacheKey(serverKey, projectId, file.path), entry)
}

/**
 * 纯函数：缓存快照与服务器元信息是否一致。size 与 mtimeMs 必须同时存在且
 * 相等才视为匹配；任一缺失（如旧版本响应）即 false，触发全量重拉。
 */
export function workspaceFileMatchesMeta(entry: WorkspaceFileCacheEntry, meta: WorkspaceFileMetaLike): boolean {
  if (typeof meta.size !== 'number' || !Number.isFinite(meta.size)) return false
  if (typeof meta.mtimeMs !== 'number' || !Number.isFinite(meta.mtimeMs)) return false
  return entry.size === meta.size && entry.mtimeMs === meta.mtimeMs
}
