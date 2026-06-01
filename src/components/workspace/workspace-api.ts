import type {
  GitFileDiffResponse,
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
