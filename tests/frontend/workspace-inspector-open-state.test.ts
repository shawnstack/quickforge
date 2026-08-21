import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_INSPECTOR_OPEN_STORAGE_PREFIX,
  readWorkspaceInspectorOpen,
  workspaceInspectorOpenStorageKey,
  writeWorkspaceInspectorOpen,
} from '../../src/hooks/useWorkspaceInspectorOpenState'
import type { WorkspaceInspectorOpenStorage } from '../../src/hooks/useWorkspaceInspectorOpenState'

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const storage: WorkspaceInspectorOpenStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
  return { storage, values }
}

describe('workspace inspector open persistence', () => {
  it('isolates open state by project and session', () => {
    const { storage, values } = createStorage()

    expect(workspaceInspectorOpenStorageKey('project/a', 'session:1')).toBe(
      `${WORKSPACE_INSPECTOR_OPEN_STORAGE_PREFIX}project%2Fa:session%3A1`,
    )
    expect(writeWorkspaceInspectorOpen('project-a', 'session-1', true, storage)).toBe(true)
    expect(writeWorkspaceInspectorOpen('project-a', 'session-2', false, storage)).toBe(true)
    expect(writeWorkspaceInspectorOpen('project-b', 'session-1', true, storage)).toBe(true)

    expect(values.size).toBe(3)
    expect(readWorkspaceInspectorOpen('project-a', 'session-1', storage)).toBe(true)
    expect(readWorkspaceInspectorOpen('project-a', 'session-2', storage)).toBe(false)
    expect(readWorkspaceInspectorOpen('project-b', 'session-1', storage)).toBe(true)
  })

  it('defaults closed and does not read legacy project-only keys', () => {
    const { storage } = createStorage({
      'quickforge:workspace-inspector-tabs:v1:project-a': JSON.stringify({ tabs: [{ id: 'files-1', kind: 'files' }] }),
      'quickforge_workspaceInspectorOpen': 'true',
    })

    expect(readWorkspaceInspectorOpen('project-a', 'session-new', storage)).toBe(false)
  })

  it('safely degrades when storage access fails', () => {
    const storage: WorkspaceInspectorOpenStorage = {
      getItem: vi.fn(() => { throw new Error('read denied') }),
      setItem: vi.fn(() => { throw new Error('write denied') }),
    }

    expect(readWorkspaceInspectorOpen('project-a', 'session-1', storage)).toBe(false)
    expect(writeWorkspaceInspectorOpen('project-a', 'session-1', true, storage)).toBe(false)
  })
})
