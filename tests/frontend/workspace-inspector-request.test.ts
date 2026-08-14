import { describe, expect, it } from 'vitest'
import { shouldHandleWorkspaceInspectorRequest } from '../../src/components/workspace/workspace-inspector-request'
import type { WorkspaceInspectorOpenRequest } from '../../src/components/workspace/workspace-types'
import type { SubagentRunPayload } from '../../src/lib/subagent-run-detail'

const request: WorkspaceInspectorOpenRequest = {
  id: 7,
  projectId: 'project-a',
  kind: 'files',
}

describe('shouldHandleWorkspaceInspectorRequest', () => {
  it('rejects a request for another project', () => {
    expect(shouldHandleWorkspaceInspectorRequest(request, 'project-b', undefined)).toBe(false)
  })

  it('rejects an already handled request id', () => {
    expect(shouldHandleWorkspaceInspectorRequest(request, 'project-a', request.id)).toBe(false)
  })

  it('accepts a projectless subagent request without a selected project', () => {
    const subagentRequest: WorkspaceInspectorOpenRequest = {
      id: 8,
      kind: 'subagent',
      payload: { runId: 'run-1' } as SubagentRunPayload,
    }
    expect(shouldHandleWorkspaceInspectorRequest(subagentRequest, undefined, undefined)).toBe(true)
  })

  it('accepts a new request for the current project', () => {
    expect(shouldHandleWorkspaceInspectorRequest(request, 'project-a', undefined)).toBe(true)
  })
})
