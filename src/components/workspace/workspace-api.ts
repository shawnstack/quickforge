import type {
  GitBranchesResponse,
  GitCheckoutResponse,
  GitCommitPushResponse,
  GitCreateBranchResponse,
  GitFileDiffResponse,
  GitLogResponse,
  GitOperationResponse,
  GitStatusResponse,
  WorkspaceChildrenResponse,
  WorkspaceFileMetaResponse,
  WorkspaceFileResponse,
  WorkspaceResolvedPathResponse,
  WorkspaceSearchResponse,
} from './workspace-types'

/** 带 HTTP 状态码的 API 错误：fetchJson/postJson 抛错时附加 response.status。 */
export type WorkspaceApiError = Error & { status?: number }

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed: ${response.status}`) as WorkspaceApiError
    error.status = response.status
    throw error
  }
  return payload as T
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed: ${response.status}`) as WorkspaceApiError
    error.status = response.status
    throw error
  }
  return payload as T
}

function projectQuery(projectId: string) {
  return `projectId=${encodeURIComponent(projectId)}`
}

export function getWorkspaceChildren(projectId: string, path = '.', options: { limit?: number; cursor?: string; signal?: AbortSignal } = {}) {
  const params = new URLSearchParams({ projectId, path })
  if (options.limit) params.set('limit', String(options.limit))
  if (options.cursor) params.set('cursor', options.cursor)
  return fetchJson<WorkspaceChildrenResponse>(`/api/workspace/children?${params}`, options.signal)
}

export function searchWorkspace(projectId: string, query: string, options: { limit?: number; signal?: AbortSignal } = {}) {
  const params = new URLSearchParams({ projectId, query })
  if (options.limit) params.set('limit', String(options.limit))
  return fetchJson<WorkspaceSearchResponse>(`/api/workspace/search?${params}`, options.signal)
}

export function getWorkspaceFile(projectId: string, path: string, signal?: AbortSignal) {
  return fetchJson<WorkspaceFileResponse>(`/api/workspace/file?${projectQuery(projectId)}&path=${encodeURIComponent(path)}`, signal)
}

/** 轻量元信息探测（不读文件内容），用于校验本地文件缓存快照。 */
export function getWorkspaceFileMeta(projectId: string, path: string, signal?: AbortSignal) {
  return fetchJson<WorkspaceFileMetaResponse>(`/api/workspace/file?${projectQuery(projectId)}&path=${encodeURIComponent(path)}&meta=1`, signal)
}

export function resolveWorkspacePath(projectId: string, path: string) {
  return postJson<WorkspaceResolvedPathResponse>('/api/workspace/resolve-path', { projectId, path })
}

export type WorkspaceExternalOpenTarget = 'explorer' | 'vscode' | 'idea'

export function openWorkspaceExternal(projectId: string, path: string, target: WorkspaceExternalOpenTarget) {
  return postJson<{ ok: true; opened: 'file' | 'directory'; target: WorkspaceExternalOpenTarget }>(
    '/api/workspace/open-external',
    { projectId, path, target },
  )
}

// 大仓库（海量未跟踪文件 + numstat）的 git status 可运行数分钟；HTTP/1.1 同源
// 连接池只有 6 条，无超时的挂起请求会连同两条常驻 SSE 把后续请求全部阻塞。
const GIT_STATUS_TIMEOUT_MS = 20_000

/** git status 结果短 TTL 缓存：命中即返回，避免同一项目在短时间内被多个面板重复请求。 */
export const GIT_STATUS_CACHE_TTL_MS = 1000

type GitStatusCacheEntry = { value: GitStatusResponse; expiresAt: number }

type GitStatusRequest = {
  controller: AbortController
  promise: Promise<GitStatusResponse>
  /** 仍在等待该共享请求的调用方数量：归零且请求仍在途时才中止它。 */
  waiters: number
}

/** 同 projectId 共享一条在途请求，保证同一项目同一模式同时最多 1 条 /api/git/status。 */
const gitStatusRequests = new Map<string, GitStatusRequest>()
const gitStatusCache = new Map<string, GitStatusCacheEntry>()
/** Git 写操作自增 epoch：写操作之前发出的 status 响应不再写回缓存。 */
const gitStatusEpoch = new Map<string, number>()

/**
 * 缓存/在途共享按「项目 + 模式」分键：light 结果没有 additions/deletions，
 * 不得写入 full 键，也不得被 full 调用方复用。
 */
function gitStatusCacheKey(projectId: string, light: boolean) {
  return light ? `${projectId}::light` : projectId
}

function composeGitStatusSignal(external?: AbortSignal) {
  const controller = new AbortController()
  const abortWith = (reason: unknown) => {
    if (!controller.signal.aborted) controller.abort(reason)
  }
  const timer = setTimeout(() => {
    abortWith(new DOMException('Git status request timed out', 'TimeoutError'))
  }, GIT_STATUS_TIMEOUT_MS)
  const onExternalAbort = () => abortWith(external?.reason)
  if (external) {
    if (external.aborted) abortWith(external.reason)
    else external.addEventListener('abort', onExternalAbort)
  }
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      external?.removeEventListener('abort', onExternalAbort)
    },
  }
}

function readGitStatusCache(cacheKey: string) {
  const entry = gitStatusCache.get(cacheKey)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    gitStatusCache.delete(cacheKey)
    return undefined
  }
  return entry.value
}

function writeGitStatusCache(cacheKey: string, value: GitStatusResponse) {
  gitStatusCache.set(cacheKey, { value, expiresAt: Date.now() + GIT_STATUS_CACHE_TTL_MS })
}

/** Git 写操作会改变仓库状态：立即失效缓存并自增 epoch，避免写操作之前的快照写回。 */
function invalidateGitStatusCache(projectId: string) {
  gitStatusCache.delete(gitStatusCacheKey(projectId, false))
  gitStatusCache.delete(gitStatusCacheKey(projectId, true))
  gitStatusEpoch.set(projectId, (gitStatusEpoch.get(projectId) ?? 0) + 1)
}

function acquireGitStatusRequest(projectId: string, cacheKey: string, url: string) {
  const existing = gitStatusRequests.get(cacheKey)
  if (existing) return existing

  const controller = new AbortController()
  const composed = composeGitStatusSignal(controller.signal)
  const epoch = gitStatusEpoch.get(projectId) ?? 0
  const promise = (async () => {
    try {
      const value = await fetchJson<GitStatusResponse>(url, composed.signal)
      if ((gitStatusEpoch.get(projectId) ?? 0) === epoch) writeGitStatusCache(cacheKey, value)
      return value
    } finally {
      composed.dispose()
      if (gitStatusRequests.get(cacheKey)?.controller === controller) gitStatusRequests.delete(cacheKey)
    }
  })()

  const request: GitStatusRequest = { controller, promise, waiters: 0 }
  gitStatusRequests.set(cacheKey, request)
  return request
}

/**
 * 登记一个调用方：调用方 signal 只决定「该调用方是否继续等待」，
 * 任一调用方 abort 不影响其他调用方仍在等待的共享请求。
 */
function joinGitStatusRequest(cacheKey: string, request: GitStatusRequest, signal?: AbortSignal) {
  request.waiters += 1
  let released = false
  let rejectWaiter: (reason: unknown) => void = () => undefined
  const waiterAborted = new Promise<never>((_, reject) => { rejectWaiter = reject })
  const release = () => {
    if (released) return
    released = true
    signal?.removeEventListener('abort', onWaiterAbort)
    request.waiters -= 1
    if (request.waiters > 0 || request.controller.signal.aborted) return
    if (gitStatusRequests.get(cacheKey) !== request) return
    request.controller.abort(new DOMException('All git status callers aborted', 'AbortError'))
  }
  const onWaiterAbort = () => {
    release()
    rejectWaiter(signal?.reason ?? new DOMException('Git status request aborted', 'AbortError'))
  }
  if (signal) {
    if (signal.aborted) onWaiterAbort()
    else signal.addEventListener('abort', onWaiterAbort)
  }
  return Promise.race([request.promise, waiterAborted]).finally(release)
}

/**
 * 读取 git status。
 *
 * - 同 projectId + 同模式复用共享在途请求（同项目最多 1 条连接），各调用方按引用计数独立退出。
 * - 可选 `{ force: true }` 绕过短 TTL 缓存，供手动刷新使用。
 * - 可选 `{ light: true }` 请求 `light=1`：只取 branch/counts，跳过服务端 numstat 与行数统计；
 *   light 结果独立缓存，不会污染也不会复用 full 结果。
 */
export function getGitStatus(
  projectId: string,
  signal?: AbortSignal,
  options: { force?: boolean; light?: boolean } = {},
) {
  const light = options.light === true
  const cacheKey = gitStatusCacheKey(projectId, light)
  if (options.force) {
    gitStatusCache.delete(cacheKey)
  } else {
    const cached = readGitStatusCache(cacheKey)
    if (cached) return Promise.resolve(cached)
  }
  const url = `/api/git/status?${projectQuery(projectId)}${light ? '&light=1' : ''}`
  return joinGitStatusRequest(cacheKey, acquireGitStatusRequest(projectId, cacheKey, url), signal)
}

/**
 * Git 写操作会改变仓库状态：请求发出时即失效 status 缓存，
 * 避免紧随其后的 status 读取拿到写操作之前的快照（不改变 postJson 本身行为）。
 */
function gitPostJson<T>(url: string, body: { projectId: string; [key: string]: unknown }) {
  invalidateGitStatusCache(body.projectId)
  return postJson<T>(url, body)
}

// file-diff 服务端每次都先跑全量 git status 再 git show 旧版本；与 git status 同受
// 同源 6 连接池约束，不能无限等待，超时即中止并释放连接。
const GIT_FILE_DIFF_TIMEOUT_MS = 10_000

export function getGitFileDiff(projectId: string, path: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new DOMException('Git file diff request timed out', 'TimeoutError'))
  }, GIT_FILE_DIFF_TIMEOUT_MS)
  return fetchJson<GitFileDiffResponse>(
    `/api/git/file-diff?${projectQuery(projectId)}&path=${encodeURIComponent(path)}`,
    controller.signal,
  ).finally(() => clearTimeout(timer))
}

export function stageGitFile(projectId: string, path: string) {
  return gitPostJson<GitOperationResponse>('/api/git/stage', { projectId, path })
}

export function stageAllGitChanges(projectId: string) {
  return gitPostJson<GitOperationResponse>('/api/git/stage-all', { projectId })
}

export function unstageGitFile(projectId: string, path: string) {
  return gitPostJson<GitOperationResponse>('/api/git/unstage', { projectId, path })
}

export function unstageAllGitChanges(projectId: string) {
  return gitPostJson<GitOperationResponse>('/api/git/unstage-all', { projectId })
}

export function restoreGitFile(projectId: string, path: string) {
  return gitPostJson<GitOperationResponse>('/api/git/restore', { projectId, path })
}

export function restoreAllGitChanges(projectId: string) {
  return gitPostJson<GitOperationResponse>('/api/git/restore-all', { projectId })
}

export function getGitBranches(projectId: string) {
  return fetchJson<GitBranchesResponse>(`/api/git/branches?${projectQuery(projectId)}`)
}

export function checkoutGitBranch(projectId: string, branch: string) {
  return gitPostJson<GitCheckoutResponse>('/api/git/checkout', { projectId, branch })
}

export function createGitBranch(projectId: string, branch: string) {
  return gitPostJson<GitCreateBranchResponse>('/api/git/create-branch', { projectId, branch })
}

export function getGitLog(projectId: string) {
  return fetchJson<GitLogResponse>(`/api/git/log?${projectQuery(projectId)}`)
}

import type { Api, Model } from '@earendil-works/pi-ai'
import { modelReferenceFromModel } from '@/lib/model-reference'

export function generateGitCommitMessage(projectId: string, model: unknown, thinkingLevel: unknown, includeUnstaged: boolean) {
  return postJson<{ message: string }>('/api/git/generate-commit-message', {
    projectId,
    modelRef: model && typeof model === 'object' ? modelReferenceFromModel(model as Model<Api>) : undefined,
    model,
    thinkingLevel,
    includeUnstaged,
  })
}

export function commitGitChanges(projectId: string, message: string, includeUnstaged: boolean) {
  return gitPostJson<GitOperationResponse>('/api/git/commit', { projectId, message, includeUnstaged })
}

export function pushGitBranch(projectId: string) {
  return gitPostJson<GitOperationResponse>('/api/git/push', { projectId })
}

export function commitAndPushGitChanges(projectId: string, message: string, includeUnstaged: boolean) {
  return gitPostJson<GitCommitPushResponse>('/api/git/commit-and-push', { projectId, message, includeUnstaged })
}
