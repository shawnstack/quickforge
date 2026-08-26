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
  WorkspaceTreeResponse,
} from './workspace-types'

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed: ${response.status}`)
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
    throw new Error(payload?.error || `Request failed: ${response.status}`)
  }
  return payload as T
}

function projectQuery(projectId: string) {
  return `projectId=${encodeURIComponent(projectId)}`
}

export function getWorkspaceTree(projectId: string, signal?: AbortSignal) {
  return fetchJson<WorkspaceTreeResponse>(`/api/workspace/tree?${projectQuery(projectId)}`, signal)
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

export async function getGitStatus(projectId: string, signal?: AbortSignal) {
  const composed = composeGitStatusSignal(signal)
  try {
    return await fetchJson<GitStatusResponse>(`/api/git/status?${projectQuery(projectId)}`, composed.signal)
  } finally {
    composed.dispose()
  }
}

export function getGitFileDiff(projectId: string, path: string) {
  return fetchJson<GitFileDiffResponse>(`/api/git/file-diff?${projectQuery(projectId)}&path=${encodeURIComponent(path)}`)
}

export function stageGitFile(projectId: string, path: string) {
  return postJson<GitOperationResponse>('/api/git/stage', { projectId, path })
}

export function stageAllGitChanges(projectId: string) {
  return postJson<GitOperationResponse>('/api/git/stage-all', { projectId })
}

export function unstageGitFile(projectId: string, path: string) {
  return postJson<GitOperationResponse>('/api/git/unstage', { projectId, path })
}

export function unstageAllGitChanges(projectId: string) {
  return postJson<GitOperationResponse>('/api/git/unstage-all', { projectId })
}

export function restoreGitFile(projectId: string, path: string) {
  return postJson<GitOperationResponse>('/api/git/restore', { projectId, path })
}

export function restoreAllGitChanges(projectId: string) {
  return postJson<GitOperationResponse>('/api/git/restore-all', { projectId })
}

export function getGitBranches(projectId: string) {
  return fetchJson<GitBranchesResponse>(`/api/git/branches?${projectQuery(projectId)}`)
}

export function checkoutGitBranch(projectId: string, branch: string) {
  return postJson<GitCheckoutResponse>('/api/git/checkout', { projectId, branch })
}

export function createGitBranch(projectId: string, branch: string) {
  return postJson<GitCreateBranchResponse>('/api/git/create-branch', { projectId, branch })
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
  return postJson<GitOperationResponse>('/api/git/commit', { projectId, message, includeUnstaged })
}

export function pushGitBranch(projectId: string) {
  return postJson<GitOperationResponse>('/api/git/push', { projectId })
}

export function commitAndPushGitChanges(projectId: string, message: string, includeUnstaged: boolean) {
  return postJson<GitCommitPushResponse>('/api/git/commit-and-push', { projectId, message, includeUnstaged })
}
