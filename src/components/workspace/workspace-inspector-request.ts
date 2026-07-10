import type { WorkspaceInspectorOpenRequest } from './workspace-types'

export function shouldHandleWorkspaceInspectorRequest(
  request: WorkspaceInspectorOpenRequest | null | undefined,
  projectId: string | null | undefined,
  handledRequestId: number | undefined,
): request is WorkspaceInspectorOpenRequest {
  return Boolean(
    request
    && projectId
    && request.projectId === projectId
    && request.id !== handledRequestId,
  )
}
