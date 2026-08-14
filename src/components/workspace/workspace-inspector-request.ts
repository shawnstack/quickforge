import type { WorkspaceInspectorOpenRequest } from './workspace-types'

export function shouldHandleWorkspaceInspectorRequest(
  request: WorkspaceInspectorOpenRequest | null | undefined,
  projectId: string | null | undefined,
  handledRequestId: number | undefined,
): request is WorkspaceInspectorOpenRequest {
  if (!request || request.id === handledRequestId) return false
  if (request.kind === 'subagent') return !request.projectId || request.projectId === projectId
  return Boolean(projectId && request.projectId === projectId)
}
