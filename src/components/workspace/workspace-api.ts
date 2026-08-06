import type {
  GitBranchesResponse,
  GitCheckoutResponse,
  GitCommitPushResponse,
  GitCreateBranchResponse,
  GitFileDiffResponse,
  GitLogResponse,
  GitOperationResponse,
  GitStatusResponse,
  WorkspaceFileResponse,
  WorkspaceResolvedPathResponse,
  WorkspaceTreeResponse,
} from './workspace-types'

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
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

export function getWorkspaceTree(projectId: string) {
  return fetchJson<WorkspaceTreeResponse>(`/api/workspace/tree?${projectQuery(projectId)}`)
}

export function getWorkspaceFile(projectId: string, path: string) {
  return fetchJson<WorkspaceFileResponse>(`/api/workspace/file?${projectQuery(projectId)}&path=${encodeURIComponent(path)}`)
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

export function getGitStatus(projectId: string) {
  return fetchJson<GitStatusResponse>(`/api/git/status?${projectQuery(projectId)}`)
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
