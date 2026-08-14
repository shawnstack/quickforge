import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_INSPECTOR_TABS_STORAGE_PREFIX,
  createWorkspaceInspectorProjectGuard,
  nextPanelTabIndexFromTabs,
  normalizePersistedPanelTabs,
  readPersistedPanelTabs,
  reorderPanelTabs,
  serializePanelTabs,
  upsertSubagentRunTab,
  workspaceInspectorTabsStorageKey,
  writePersistedPanelTabs,
} from '../../src/components/workspace/workspace-inspector-tabs'
import type {
  WorkspaceInspectorTabsStorage,
  WorkspacePanelTab,
} from '../../src/components/workspace/workspace-inspector-tabs'

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const storage: WorkspaceInspectorTabsStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
  return { storage, values }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('workspace inspector tabs persistence', () => {
  it('isolates persisted tabs by project id', () => {
    const { storage, values } = createStorage()
    const projectATabs: WorkspacePanelTab[] = [{ id: 'files-1', kind: 'files' }]
    const projectBTabs: WorkspacePanelTab[] = [{ id: 'terminal-2', kind: 'terminal', terminalSessionId: 'session-b' }]

    expect(workspaceInspectorTabsStorageKey('project-a')).toBe(`${WORKSPACE_INSPECTOR_TABS_STORAGE_PREFIX}project-a`)
    expect(writePersistedPanelTabs('project-a', projectATabs, 'files-1', storage)).toBe(true)
    expect(writePersistedPanelTabs('project-b', projectBTabs, 'terminal-2', storage)).toBe(true)

    expect(values.size).toBe(2)
    expect(readPersistedPanelTabs('project-a', storage)).toEqual({ tabs: [{ id: 'files-1', kind: 'files', readerTabs: [], activeReaderTabId: undefined }], activePanelTabId: 'files-1' })
    expect(readPersistedPanelTabs('project-b', storage)).toEqual({ tabs: projectBTabs, activePanelTabId: 'terminal-2' })
  })

  it('persists the review subview with the project tabs', () => {
    const { storage } = createStorage()
    const reviewTabs: WorkspacePanelTab[] = [{ id: 'review-1', kind: 'review', reviewView: 'review' }]

    expect(writePersistedPanelTabs('project-a', reviewTabs, 'review-1', storage)).toBe(true)
    expect(readPersistedPanelTabs('project-a', storage)).toEqual({
      tabs: [{ id: 'review-1', kind: 'review', reviewView: 'review', readerTabs: [], activeReaderTabId: undefined }],
      activePanelTabId: 'review-1',
    })
  })

  it('safely handles invalid JSON and invalid persisted roots', () => {
    const key = workspaceInspectorTabsStorageKey('project-a')
    const { storage } = createStorage({ [key]: '{broken' })

    expect(readPersistedPanelTabs('project-a', storage)).toEqual({ tabs: [] })

    storage.setItem(key, 'null')
    expect(readPersistedPanelTabs('project-a', storage)).toEqual({ tabs: [] })
  })

  it('safely degrades when storage reads, writes, or browser storage access fail', () => {
    const readError = new Error('read denied')
    const writeError = new Error('quota exceeded')
    const throwingStorage: WorkspaceInspectorTabsStorage = {
      getItem: vi.fn(() => { throw readError }),
      setItem: vi.fn(() => { throw writeError }),
    }

    expect(readPersistedPanelTabs('project-a', throwingStorage)).toEqual({ tabs: [] })
    expect(writePersistedPanelTabs('project-a', [{ id: 'files-1', kind: 'files' }], 'files-1', throwingStorage)).toBe(false)

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => { throw new Error('unavailable') },
    })
    try {
      expect(readPersistedPanelTabs('project-a')).toEqual({ tabs: [] })
      expect(writePersistedPanelTabs('project-a', [], undefined)).toBe(false)
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })

  it('serializes only restorable tab state and restores file readers as loading', () => {
    const tabs: WorkspacePanelTab[] = [
      { id: 'browser-1', kind: 'browser', url: 'http://localhost:5173' },
      { id: 'subagent-9', kind: 'subagent', subagentRun: { runId: 'run-1' } as WorkspacePanelTab['subagentRun'] },
      { id: 'terminal-2', kind: 'terminal', terminalSessionId: 'terminal-session' },
      {
        id: 'reader-3',
        kind: 'reader',
        activeReaderTabId: 'file:src/active.ts',
        readerTabs: [
          { id: 'file:src/fallback.ts', mode: 'file', path: 'src/fallback.ts', loading: false },
          { id: 'file:src/active.ts', mode: 'file', path: 'src/active.ts', loading: false, error: 'old error' },
        ],
      },
      {
        id: 'reader-4',
        kind: 'reader',
        activeReaderTabId: 'diff:src/changed.ts',
        readerTabs: [{ id: 'diff:src/changed.ts', mode: 'diff', path: 'src/changed.ts', loading: false }],
      },
    ]

    const serialized = serializePanelTabs(tabs, 'reader-4')
    expect(serialized).toEqual({
      tabs: [
        { id: 'browser-1', kind: 'browser', url: 'http://localhost:5173' },
        { id: 'terminal-2', kind: 'terminal', terminalSessionId: 'terminal-session' },
        { id: 'reader-3', kind: 'reader', reader: { mode: 'file', path: 'src/active.ts' } },
      ],
      activePanelTabId: 'browser-1',
    })

    expect(normalizePersistedPanelTabs(serialized.tabs)).toEqual([
      { id: 'browser-1', kind: 'browser', url: 'http://localhost:5173' },
      { id: 'terminal-2', kind: 'terminal', terminalSessionId: 'terminal-session' },
      {
        id: 'reader-3',
        kind: 'reader',
        readerTabs: [{ id: 'file:src/active.ts', mode: 'file', path: 'src/active.ts', loading: true }],
        activeReaderTabId: 'file:src/active.ts',
      },
    ])
  })

  it('drops invalid entries and deduplicates review tabs', () => {
    expect(normalizePersistedPanelTabs([
      null,
      [],
      { id: '', kind: 'files' },
      { id: 'unknown-1', kind: 'unknown' },
      { id: 'review-1', kind: 'review' },
      { id: 'review-2', kind: 'review' },
      { id: 'reader-3', kind: 'reader', reader: { mode: 'diff', path: 'src/a.ts' } },
      { id: 'reader-4', kind: 'reader', reader: { mode: 'file', path: '' } },
      { id: 'files-5', kind: 'files' },
    ])).toEqual([
      { id: 'review-1', kind: 'review', reviewView: 'changes', readerTabs: [], activeReaderTabId: undefined },
      { id: 'files-5', kind: 'files', readerTabs: [], activeReaderTabId: undefined },
    ])
  })

  it('falls back active ids to the first restorable tab', () => {
    const key = workspaceInspectorTabsStorageKey('project-a')
    const { storage } = createStorage({
      [key]: JSON.stringify({
        tabs: [
          { id: 'files-2', kind: 'files' },
          { id: 'browser-4', kind: 'browser', url: '' },
        ],
        activePanelTabId: 'missing-99',
      }),
    })

    expect(readPersistedPanelTabs('project-a', storage).activePanelTabId).toBe('files-2')
    expect(serializePanelTabs([{ id: 'reader-1', kind: 'reader', readerTabs: [] }], 'reader-1')).toEqual({
      tabs: [],
      activePanelTabId: undefined,
    })
  })

  it('creates separate subagent run tabs and reuses the same run id', () => {
    const first = { runId: 'run-1', label: 'Explore', fingerprint: 'a' } as WorkspacePanelTab['subagentRun']
    const updated = { ...first, status: 'done', fingerprint: 'b' } as WorkspacePanelTab['subagentRun']
    const second = { runId: 'run-2', label: 'General', fingerprint: 'c' } as WorkspacePanelTab['subagentRun']

    const opened = upsertSubagentRunTab([], first!, 'subagent-1')
    expect(opened.created).toBe(true)
    expect(opened.tabId).toBe('subagent-1')

    const reused = upsertSubagentRunTab(opened.tabs, updated!, 'subagent-2')
    expect(reused.created).toBe(false)
    expect(reused.tabId).toBe('subagent-1')
    expect(reused.tabs).toHaveLength(1)
    expect(reused.tabs[0]?.subagentRun?.fingerprint).toBe('b')

    const separate = upsertSubagentRunTab(reused.tabs, second!, 'subagent-2')
    expect(separate.created).toBe(true)
    expect(separate.tabs.map((tab) => tab.id)).toEqual(['subagent-1', 'subagent-2'])
  })

  it('reorders tabs by id without changing their contents', () => {
    const tabs: WorkspacePanelTab[] = [
      { id: 'files-1', kind: 'files' },
      { id: 'review-2', kind: 'review' },
      { id: 'terminal-3', kind: 'terminal' },
    ]

    expect(reorderPanelTabs(tabs, 'files-1', 'terminal-3')).toEqual([
      tabs[1],
      tabs[2],
      tabs[0],
    ])
    expect(tabs.map((tab) => tab.id)).toEqual(['files-1', 'review-2', 'terminal-3'])
  })

  it('keeps the same tab array when reordering ids are unchanged or missing', () => {
    const tabs: WorkspacePanelTab[] = [
      { id: 'files-1', kind: 'files' },
      { id: 'review-2', kind: 'review' },
    ]

    expect(reorderPanelTabs(tabs, 'files-1', 'files-1')).toBe(tabs)
    expect(reorderPanelTabs(tabs, 'missing', 'review-2')).toBe(tabs)
    expect(reorderPanelTabs(tabs, 'files-1', 'missing')).toBe(tabs)
  })

  it('calculates the next numeric tab suffix across mixed ids', () => {
    expect(nextPanelTabIndexFromTabs([])).toBe(1)
    expect(nextPanelTabIndexFromTabs([
      { id: 'files-2', kind: 'files' },
      { id: 'custom', kind: 'browser' },
      { id: 'reader-17', kind: 'reader' },
      { id: 'terminal-not-a-number', kind: 'terminal' },
    ])).toBe(18)
  })
})

describe('workspace inspector project guard', () => {
  it('invalidates old A tokens across A to B to A and supports explicit invalidation', () => {
    const guard = createWorkspaceInspectorProjectGuard()
    const firstA = guard.token('project-a')
    const b = guard.token('project-b')
    const secondA = guard.token('project-a')

    expect(guard.isCurrent(firstA)).toBe(false)
    expect(guard.isCurrent(b)).toBe(false)
    expect(guard.isCurrent(secondA)).toBe(true)
    expect(secondA.epoch).toBeGreaterThan(firstA.epoch)

    guard.invalidate()
    expect(guard.isCurrent(secondA)).toBe(false)
    expect(guard.isCurrent(guard.token('project-a'))).toBe(true)
  })

  it('prevents out-of-order async results from a stale project from being applied', async () => {
    const guard = createWorkspaceInspectorProjectGuard()
    const requestA = deferred<string>()
    const requestB = deferred<string>()
    const applied: string[] = []

    const tokenA = guard.token('project-a')
    const completionA = requestA.promise.then((value) => {
      if (guard.isCurrent(tokenA)) applied.push(value)
    })
    const tokenB = guard.token('project-b')
    const completionB = requestB.promise.then((value) => {
      if (guard.isCurrent(tokenB)) applied.push(value)
    })

    requestB.resolve('project-b result')
    await completionB
    requestA.resolve('stale project-a result')
    await completionA

    expect(applied).toEqual(['project-b result'])
  })
})
