import type { DocumentFormat } from './artifact-preview-utils'
import type { GitFileDiffResponse, WorkspaceFileResponse } from './workspace-types'
import type { SubagentRunPayload } from '@/lib/subagent-run-detail'

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

export type WorkspacePanelPrimaryTabKind = 'files' | 'review' | 'terminal' | 'browser' | 'side-chat'
export type WorkspacePanelTabKind = WorkspacePanelPrimaryTabKind | 'reader' | 'document' | 'subagent'

export type WorkspacePanelTab = {
  id: string
  kind: WorkspacePanelTabKind
  url?: string
  reviewView?: 'review' | 'changes'
  readerTabs?: ReaderTab[]
  activeReaderTabId?: string
  terminalSessionId?: string
  document?: {
    path: string
    format: DocumentFormat
  }
  subagentRun?: SubagentRunPayload
  // 仅运行时使用、不持久化的刷新序号：同一 Browser tab 被重复预览时递增，触发 iframe 重新加载。
  reloadNonce?: number
}

export type PersistedWorkspacePanelTab = Pick<WorkspacePanelTab, 'id' | 'kind' | 'url' | 'reviewView' | 'terminalSessionId' | 'document'> & {
  reader?: {
    mode: 'file'
    path: string
  }
}

export type PersistedWorkspaceInspectorTabs = {
  tabs: PersistedWorkspacePanelTab[]
  activePanelTabId?: string
  readerNavigationVisible?: boolean
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

export const WORKSPACE_INSPECTOR_TABS_STORAGE_PREFIX = 'quickforge:workspace-inspector-tabs:v2:'

function storagePart(value: string) {
  return encodeURIComponent(value)
}

export function workspaceInspectorTabsStorageKey(projectId: string, sessionId: string) {
  return `${WORKSPACE_INSPECTOR_TABS_STORAGE_PREFIX}${storagePart(projectId)}:${storagePart(sessionId)}`
}

function readerTabId(mode: ReaderMode, path: string) {
  return mode === 'browser' ? 'browser' : `${mode}:${path}`
}

function isWorkspacePanelTabKind(value: unknown): value is WorkspacePanelTabKind {
  return value === 'files' || value === 'review' || value === 'terminal' || value === 'browser' || value === 'reader' || value === 'document'
}

function isDocumentFormat(value: unknown): value is DocumentFormat {
  return value === 'pdf' || value === 'docx' || value === 'excel'
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
    if (raw.kind === 'document') {
      const document = raw.document
      if (!document || typeof document.path !== 'string' || !document.path || !isDocumentFormat(document.format)) continue
      tabs.push({ id: raw.id, kind: raw.kind, document: { path: document.path, format: document.format } })
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
  sessionId: string | undefined,
  storage: WorkspaceInspectorTabsStorage | undefined = defaultStorage(),
): PersistedWorkspaceInspectorTabs {
  if (!sessionId || !storage) return { tabs: [], readerNavigationVisible: true }
  try {
    const raw = storage.getItem(workspaceInspectorTabsStorageKey(projectId, sessionId))
    if (!raw) return { tabs: [], readerNavigationVisible: true }
    const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceInspectorTabs> | null
    const tabs = normalizePersistedPanelTabs(parsed?.tabs)
    const activePanelTabId = typeof parsed?.activePanelTabId === 'string' && tabs.some((tab) => tab.id === parsed.activePanelTabId)
      ? parsed.activePanelTabId
      : tabs[0]?.id
    const readerNavigationVisible = parsed?.readerNavigationVisible !== false
    return activePanelTabId ? { tabs, activePanelTabId, readerNavigationVisible } : { tabs, readerNavigationVisible }
  } catch {
    return { tabs: [], readerNavigationVisible: true }
  }
}

export function serializePanelTabs(
  tabs: WorkspacePanelTab[],
  activePanelTabId: string | undefined,
  readerNavigationVisible = true,
): PersistedWorkspaceInspectorTabs {
  const persistedTabs = tabs.flatMap((tab): PersistedWorkspacePanelTab[] => {
    if (tab.kind === 'subagent' || tab.kind === 'side-chat') return []
    if (tab.kind === 'reader') {
      const reader = tab.readerTabs?.find((item) => item.id === tab.activeReaderTabId) ?? tab.readerTabs?.[0]
      if (!reader || reader.mode !== 'file') return []
      return [{ id: tab.id, kind: tab.kind, reader: { mode: reader.mode, path: reader.path } }]
    }
    if (tab.kind === 'document') {
      if (!tab.document) return []
      return [{ id: tab.id, kind: tab.kind, document: { path: tab.document.path, format: tab.document.format } }]
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
    readerNavigationVisible,
  }
}

export function writePersistedPanelTabs(
  projectId: string,
  sessionId: string | undefined,
  tabs: WorkspacePanelTab[],
  activePanelTabId: string | undefined,
  readerNavigationVisible: boolean,
  storage: WorkspaceInspectorTabsStorage | undefined = defaultStorage(),
): boolean {
  if (!sessionId || !storage) return false
  try {
    storage.setItem(
      workspaceInspectorTabsStorageKey(projectId, sessionId),
      JSON.stringify(serializePanelTabs(tabs, activePanelTabId, readerNavigationVisible)),
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

export function findSubagentRunTab(tabs: readonly WorkspacePanelTab[], runId: string) {
  return tabs.find((tab) => tab.kind === 'subagent' && tab.subagentRun?.runId === runId)
}

export function updateSubagentRunTab(
  tabs: WorkspacePanelTab[],
  payload: SubagentRunPayload,
): WorkspacePanelTab[] {
  const existing = findSubagentRunTab(tabs, payload.runId)
  if (!existing || existing.subagentRun?.fingerprint === payload.fingerprint) return tabs
  return tabs.map((tab) => tab.id === existing.id ? { ...tab, subagentRun: payload } : tab)
}

export function upsertSubagentRunTab(
  tabs: readonly WorkspacePanelTab[],
  payload: SubagentRunPayload,
  newTabId: string,
): { tabs: WorkspacePanelTab[]; tabId: string; created: boolean } {
  const existing = findSubagentRunTab(tabs, payload.runId)
  if (existing) {
    return {
      tabs: tabs.map((tab) => tab.id === existing.id ? { ...tab, subagentRun: payload } : tab),
      tabId: existing.id,
      created: false,
    }
  }
  return {
    tabs: [...tabs, { id: newTabId, kind: 'subagent', subagentRun: payload }],
    tabId: newTabId,
    created: true,
  }
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
