import type {
  WorkspaceInspectorOpenRequest,
  WorkspaceInspectorRuntimeScope,
} from './workspace-types'

export function workspaceInspectorRuntimeScopeMatches(
  expected: WorkspaceInspectorRuntimeScope,
  actual: WorkspaceInspectorRuntimeScope,
) {
  return expected.projectId === actual.projectId && expected.runtimeScopeId === actual.runtimeScopeId
}

export function shouldHandleWorkspaceInspectorRequest(
  request: WorkspaceInspectorOpenRequest | null | undefined,
  currentScope: WorkspaceInspectorRuntimeScope,
  handledRequestId: number | undefined,
): request is WorkspaceInspectorOpenRequest {
  if (!request || request.id === handledRequestId) return false
  if (request.scope && !workspaceInspectorRuntimeScopeMatches(request.scope, currentScope)) return false
  if (request.kind === 'subagent') return !request.projectId || request.projectId === currentScope.projectId
  return request.projectId === currentScope.projectId
}
