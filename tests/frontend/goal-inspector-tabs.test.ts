import { describe, expect, it } from 'vitest'
import { normalizePersistedPanelTabs, serializePanelTabs, upsertGoalTab } from '../../src/components/workspace/workspace-inspector-tabs'
import { workspaceInspectorGoalMatches, shouldHandleWorkspaceInspectorRequest } from '../../src/components/workspace/workspace-inspector-request'

describe('runtime Goal tabs', () => {
  const identity = { sessionId: 's1', goalId: 'g1', view: 'progress' as const }
  it('deduplicates by session and goal while updating the view', () => {
    const first = upsertGoalTab([], identity)
    const second = upsertGoalTab(first.tabs, { ...identity, view: 'edit' })
    expect(second.tabs).toHaveLength(1)
    expect(second.activePanelTabId).toBe(first.activePanelTabId)
    expect(second.tabs[0].goal?.view).toBe('edit')
    expect(upsertGoalTab(second.tabs, { ...identity, sessionId: 's2' }).tabs).toHaveLength(2)
  })
  it('never serializes or restores Goal tabs', () => {
    const result = upsertGoalTab([], identity)
    expect(serializePanelTabs(result.tabs, result.activePanelTabId).tabs).toEqual([])
    expect(normalizePersistedPanelTabs(result.tabs)).toEqual([])
  })
  it('rejects stale goals, sessions and malformed authoritative ownership', () => {
    const current = { sessionId: 's1', goal: { id: 'g1', sessionId: 's1' } }
    expect(workspaceInspectorGoalMatches(identity, current)).toBe(true)
    expect(workspaceInspectorGoalMatches({ ...identity, goalId: 'old' }, current)).toBe(false)
    expect(workspaceInspectorGoalMatches({ ...identity, sessionId: 'old' }, current)).toBe(false)
    expect(workspaceInspectorGoalMatches(identity, { ...current, goal: { ...current.goal, sessionId: 'other' } })).toBe(false)
    expect(workspaceInspectorGoalMatches(identity, undefined)).toBe(false)
  })
  it('accepts global Goal requests only within their runtime scope', () => {
    const scope = { projectId: 'global-workspace', runtimeScopeId: 's1' }
    const request = { ...identity, kind: 'goal' as const, id: 1, projectId: scope.projectId, scope }
    expect(shouldHandleWorkspaceInspectorRequest(request, scope, undefined)).toBe(true)
    expect(shouldHandleWorkspaceInspectorRequest(request, { ...scope, runtimeScopeId: 's2' }, undefined)).toBe(false)
  })
})
