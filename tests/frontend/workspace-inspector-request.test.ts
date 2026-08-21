import { describe, expect, it } from 'vitest'
import {
  shouldHandleWorkspaceInspectorRequest,
  workspaceInspectorRuntimeScopeMatches,
} from '../../src/components/workspace/workspace-inspector-request'
import type {
  WorkspaceInspectorOpenRequest,
  WorkspaceInspectorRuntimeScope,
} from '../../src/components/workspace/workspace-types'
import type { SubagentRunPayload } from '../../src/lib/subagent-run-detail'

const scopeA: WorkspaceInspectorRuntimeScope = {
  projectId: 'project-a',
  runtimeScopeId: 'session-a',
}

const request: WorkspaceInspectorOpenRequest = {
  id: 7,
  projectId: 'project-a',
  scope: scopeA,
  kind: 'files',
}

describe('workspaceInspectorRuntimeScopeMatches', () => {
  it('requires both project and runtime session identity to match', () => {
    expect(workspaceInspectorRuntimeScopeMatches(scopeA, { ...scopeA })).toBe(true)
    expect(workspaceInspectorRuntimeScopeMatches(scopeA, { projectId: 'project-a', runtimeScopeId: 'session-b' })).toBe(false)
    expect(workspaceInspectorRuntimeScopeMatches(scopeA, { projectId: 'project-b', runtimeScopeId: 'session-a' })).toBe(false)
  })
})

describe('shouldHandleWorkspaceInspectorRequest', () => {
  it('rejects a request for another project', () => {
    expect(shouldHandleWorkspaceInspectorRequest(request, { projectId: 'project-b', runtimeScopeId: 'session-a' }, undefined)).toBe(false)
  })

  it('rejects a stale request from another session in the same project', () => {
    expect(shouldHandleWorkspaceInspectorRequest(request, { projectId: 'project-a', runtimeScopeId: 'session-b' }, undefined)).toBe(false)
  })

  it('rejects an already handled request id', () => {
    expect(shouldHandleWorkspaceInspectorRequest(request, scopeA, request.id)).toBe(false)
  })

  it('keeps the legacy projectless subagent request semantics without a selected project', () => {
    const subagentRequest: WorkspaceInspectorOpenRequest = {
      id: 8,
      kind: 'subagent',
      payload: { runId: 'run-1' } as SubagentRunPayload,
    }
    expect(shouldHandleWorkspaceInspectorRequest(
      subagentRequest,
      { projectId: 'global-workspace', runtimeScopeId: 'pending-a' },
      undefined,
    )).toBe(true)
  })

  it('scopes new subagent requests when a runtime identity is present', () => {
    const subagentRequest: WorkspaceInspectorOpenRequest = {
      id: 9,
      kind: 'subagent',
      payload: { runId: 'run-2' } as SubagentRunPayload,
      scope: scopeA,
    }
    expect(shouldHandleWorkspaceInspectorRequest(subagentRequest, scopeA, undefined)).toBe(true)
    expect(shouldHandleWorkspaceInspectorRequest(
      subagentRequest,
      { projectId: 'project-a', runtimeScopeId: 'session-b' },
      undefined,
    )).toBe(false)
  })

  it('accepts a new request for the current runtime scope', () => {
    expect(shouldHandleWorkspaceInspectorRequest(request, scopeA, undefined)).toBe(true)
  })
})
