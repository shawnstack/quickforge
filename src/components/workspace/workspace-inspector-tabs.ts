import type { GitFileDiffResponse, WorkspaceFileResponse } from './workspace-types'

export type ReaderMode = 'file' | 'diff' | 'browser'

export type ReaderTab = {
  id: string
  mode: ReaderMode
  path: string
  file?: WorkspaceFileResponse
  diff?: GitFileDiffResponse
  loading: boolean
  error?: string
}

export type WorkspacePanelPrimaryTabKind = 'files' | 'review' | 'terminal' | 'browser'
export type WorkspacePanelTabKind = WorkspacePanelPrimaryTabKind | 'reader'

export type WorkspacePanelTab = {
  id: string
  kind: WorkspacePanelTabKind
  url?: string
  reviewView?: 'review' | 'changes'
  readerTabs?: ReaderTab[]
  activeReaderTabId?: string
  terminalSessionId?: string
}

export type PersistedWorkspacePanelTab = Pick<WorkspacePanelTab, 'id' | 'kind' | 'url' | 'reviewView' | 'terminalSessionId'> & {
  reader?: {
    mode: 'file'
    path: string
  }
}

export type PersistedWorkspaceInspectorTabs = {
  tabs: PersistedWorkspacePanelTab[]
  activePanelTabId?: string
}

export type WorkspaceInspectorTabsStorage = Pick<Storage, 'getItem' | 'setItem'>

export type WorkspaceInspectorProjectToken = Readonly<{
  projectId: string
  epoch: number
}>

export type WorkspaceInspectorProjectGuard = {
  token: (projectId: string) => WorkspaceInspectorProjectToken
  isCurrent: (token: WorkspaceInspectorProjectToken) => boolean
  invalidate: () => number
}

export const WORKSPACE_INSPECTOR_TABS_STORAGE_PREFIX = 'quickforge:workspace-inspector-tabs:v1:'

export function workspaceInspectorTabsStorageKey(projectId: string) {
  return `${WORKSPACE_INSPECTOR_TABS_STORAGE_PREFIX}${projectId}`
}

function readerTabId(mode: ReaderMode, path: string) {
  return mode === 'browser' ? 'browser' : `${mode}:${path}`
}

function isWorkspacePanelTabKind(value: unknown): value is WorkspacePanelTabKind {
  return value === 'files' || value === 'review' || value === 'terminal' || value === 'browser' || value === 'reader'
}

function defaultStorage(): WorkspaceInspectorTabsStorage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export function normalizePersistedPanelTabs(value: unknown): WorkspacePanelTab[] {
  if (!Array.isArray(value)) return []
  const seenReview = new Set<WorkspacePanelTabKind>()
  const tabs: WorkspacePanelTab[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as Partial<PersistedWorkspacePanelTab>
    if (typeof raw.id !== 'string' || !raw.id || !isWorkspacePanelTabKind(raw.kind)) continue
    if (raw.kind === 'review') {
      if (seenReview.has(raw.kind)) continue
      seenReview.add(raw.kind)
    }
    if (raw.kind === 'reader') {
      const reader = raw.reader
      if (!reader || reader.mode !== 'file' || typeof reader.path !== 'string' || !reader.path) continue
      const readerId = readerTabId(reader.mode, reader.path)
      tabs.push({
        id: raw.id,
        kind: raw.kind,
        readerTabs: [{ id: readerId, mode: reader.mode, path: reader.path, loading: true }],
        activeReaderTabId: readerId,
      })
      continue
    }
    tabs.push({
      id: raw.id,
      kind: raw.kind,
      ...(raw.kind === 'browser' && typeof raw.url === 'string' ? { url: raw.url } : {}),
      ...(raw.kind === 'review' ? { reviewView: raw.reviewView === 'review' ? 'review' as const : 'changes' as const } : {}),
      ...(raw.kind === 'terminal' && typeof raw.terminalSessionId === 'string' ? { terminalSessionId: raw.terminalSessionId } : {}),
      ...(raw.kind === 'files' || raw.kind === 'review' ? { readerTabs: [], activeReaderTabId: undefined } : {}),
    })
  }
  return tabs
}

export function readPersistedPanelTabs(
  projectId: string,
  storage: WorkspaceInspectorTabsStorage | undefined = defaultStorage(),
): PersistedWorkspaceInspectorTabs {
  if (!storage) return { tabs: [] }
  try {
    const raw = storage.getItem(workspaceInspectorTabsStorageKey(projectId))
    if (!raw) return { tabs: [] }
    const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceInspectorTabs> | null
    const tabs = normalizePersistedPanelTabs(parsed?.tabs)
    const activePanelTabId = typeof parsed?.activePanelTabId === 'string' && tabs.some((tab) => tab.id === parsed.activePanelTabId)
      ? parsed.activePanelTabId
      : tabs[0]?.id
    return activePanelTabId ? { tabs, activePanelTabId } : { tabs }
  } catch {
    return { tabs: [] }
  }
}

export function serializePanelTabs(
  tabs: WorkspacePanelTab[],
  activePanelTabId: string | undefined,
): PersistedWorkspaceInspectorTabs {
  const persistedTabs = tabs.flatMap((tab): PersistedWorkspacePanelTab[] => {
    if (tab.kind === 'reader') {
      const reader = tab.readerTabs?.find((item) => item.id === tab.activeReaderTabId) ?? tab.readerTabs?.[0]
      if (!reader || reader.mode !== 'file') return []
      return [{ id: tab.id, kind: tab.kind, reader: { mode: reader.mode, path: reader.path } }]
    }
    return [{
      id: tab.id,
      kind: tab.kind,
      ...(tab.kind === 'browser' ? { url: tab.url || '' } : {}),
      ...(tab.kind === 'review' ? { reviewView: tab.reviewView || 'changes' } : {}),
      ...(tab.kind === 'terminal' && tab.terminalSessionId ? { terminalSessionId: tab.terminalSessionId } : {}),
    }]
  })
  return {
    tabs: persistedTabs,
    activePanelTabId: activePanelTabId && persistedTabs.some((tab) => tab.id === activePanelTabId)
      ? activePanelTabId
      : persistedTabs[0]?.id,
  }
}

export function writePersistedPanelTabs(
  projectId: string,
  tabs: WorkspacePanelTab[],
  activePanelTabId: string | undefined,
  storage: WorkspaceInspectorTabsStorage | undefined = defaultStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(
      workspaceInspectorTabsStorageKey(projectId),
      JSON.stringify(serializePanelTabs(tabs, activePanelTabId)),
    )
    return true
  } catch {
    return false
  }
}

export function reorderPanelTabs(tabs: WorkspacePanelTab[], activeId: string, overId: string): WorkspacePanelTab[] {
  if (activeId === overId) return tabs
  const oldIndex = tabs.findIndex((tab) => tab.id === activeId)
  const newIndex = tabs.findIndex((tab) => tab.id === overId)
  if (oldIndex === -1 || newIndex === -1) return tabs
  const reordered = [...tabs]
  const [activeTab] = reordered.splice(oldIndex, 1)
  reordered.splice(newIndex, 0, activeTab)
  return reordered
}

export function nextPanelTabIndexFromTabs(tabs: WorkspacePanelTab[]) {
  const maxIndex = tabs.reduce((max, tab) => {
    const match = tab.id.match(/-(\d+)$/)
    if (!match) return max
    const value = Number(match[1])
    return Number.isFinite(value) ? Math.max(max, value) : max
  }, 0)
  return maxIndex + 1
}

export function createWorkspaceInspectorProjectGuard(): WorkspaceInspectorProjectGuard {
  let activeProjectId: string | undefined
  let epoch = 0
  return {
    token: (projectId) => {
      if (projectId !== activeProjectId) {
        activeProjectId = projectId
        epoch += 1
      }
      return { projectId, epoch }
    },
    isCurrent: (token) => token.projectId === activeProjectId && token.epoch === epoch,
    invalidate: () => {
      epoch += 1
      return epoch
    },
  }
}
