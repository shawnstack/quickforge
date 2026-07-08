import type {
  GitBranchesResponse,
  GitCheckoutResponse,
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

export function getGitStatus(projectId: string) {
  return fetchJson<GitStatusResponse>(`/api/git/status?${projectQuery(projectId)}`)
}

export function getGitFileDiff(projectId: string, path: string) {
  return fetchJson<GitFileDiffResponse>(`/api/git/file-diff?${projectQuery(projectId)}&path=${encodeURIComponent(path)}`)
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

export function generateGitCommitMessage(projectId: string, model: unknown, thinkingLevel: unknown) {
  return postJson<{ message: string }>('/api/git/generate-commit-message', { projectId, model, thinkingLevel })
}

export function commitGitChanges(projectId: string, message: string, includeUnstaged: boolean) {
  return postJson<GitOperationResponse>('/api/git/commit', { projectId, message, includeUnstaged })
}

export function pushGitBranch(projectId: string) {
  return postJson<GitOperationResponse>('/api/git/push', { projectId })
}

export function commitAndPushGitChanges(projectId: string, message: string, includeUnstaged: boolean) {
  return postJson<GitOperationResponse>('/api/git/commit-and-push', { projectId, message, includeUnstaged })
}
