import { useEffect, useRef, useState } from 'react'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { DocumentFormat } from './artifact-preview-utils'
import type { WorkspacePanelView } from './workspace-types'
import { subagentRunStore, type SubagentRunPayload } from '@/lib/subagent-run-detail'
import { findBrowserTabToReuse } from './workspace-tab-file-path'
import { nextPanelTabIndexFromTabs, readPersistedPanelTabs, reorderPanelTabs, updateSubagentRunTab, upsertSubagentRunTab, writePersistedPanelTabs } from './workspace-inspector-tabs'
import type { PersistedWorkspaceInspectorTabs, ReaderTab, WorkspacePanelPrimaryTabKind, WorkspacePanelTab, WorkspacePanelTabKind } from './workspace-inspector-tabs'

export function viewFromPanelKind(kind: WorkspacePanelPrimaryTabKind): WorkspacePanelView {
  return kind === 'review' ? 'changes' : kind === 'side-chat' ? 'files' : kind
}

// Preserve the original mount-only storage snapshot and ref-based counter initialization.
/* eslint-disable react-hooks/refs */
export function useInspectorTabsState({ project, sessionId, canUseTerminal }: { project?: { id: string }; sessionId?: string; canUseTerminal: boolean }) {
  const initialPanelTabStateRef = useRef<PersistedWorkspaceInspectorTabs | undefined>(undefined)

  if (!initialPanelTabStateRef.current) {
    initialPanelTabStateRef.current = project?.id ? readPersistedPanelTabs(project.id, sessionId) : { tabs: [], readerNavigationVisible: true }
  }

  const [panelTabs, setPanelTabs] = useState<WorkspacePanelTab[]>(() => {
    const tabs = initialPanelTabStateRef.current?.tabs ?? []
    return canUseTerminal ? tabs : tabs.filter((tab) => tab.kind !== 'terminal')
  })

  const [activePanelTabId, setActivePanelTabId] = useState<string | undefined>(() => initialPanelTabStateRef.current?.activePanelTabId)

  const [draggingPanelTabId, setDraggingPanelTabId] = useState<string>()

  const [menuOpen, setMenuOpen] = useState(false)

  const [tabListOpen, setTabListOpen] = useState(false)

  const [readerNavigationVisible, setReaderNavigationVisible] = useState(() => initialPanelTabStateRef.current?.readerNavigationVisible !== false)

  const nextPanelTabIndexRef = useRef(nextPanelTabIndexFromTabs(initialPanelTabStateRef.current?.tabs ?? []))

  const openPanelTabRef = useRef<((kind: WorkspacePanelPrimaryTabKind, nextView?: WorkspacePanelView, options?: { url?: string; readerTab?: ReaderTab }) => WorkspacePanelTab) | undefined>(undefined)

  const openSubagentRunTabRef = useRef<((payload: SubagentRunPayload) => void) | undefined>(undefined)
  return { initialPanelTabStateRef, panelTabs, setPanelTabs, activePanelTabId, setActivePanelTabId, draggingPanelTabId, setDraggingPanelTabId, menuOpen, setMenuOpen, tabListOpen, setTabListOpen, readerNavigationVisible, setReaderNavigationVisible, nextPanelTabIndexRef, openPanelTabRef, openSubagentRunTabRef }
}

/* eslint-enable react-hooks/refs */

type TabState = ReturnType<typeof useInspectorTabsState>

export function useInspectorTabsEffects({ panelTabs, setPanelTabs, activePanelTabId, setActivePanelTabId, readerNavigationVisible, projectId, sessionId }: TabState & { projectId?: string; sessionId?: string }) {
  useEffect(() => {
    // 实时更新订阅：ServerAgent 的 tool_execution_* SSE 与 tool-renderers/subagent-tool-renderer
    // 的渲染回填都发布到 subagentRunStore。仅更新已打开且 runId 匹配、指纹不同的 Tab；
    // 无匹配 Tab 时返回原数组，避免无意义的 setState。
    return subagentRunStore.subscribe((payload) => {
      setPanelTabs((current) => updateSubagentRunTab(current, payload))
    })
  }, [setPanelTabs])

  useEffect(() => {
    if (!projectId) return
    writePersistedPanelTabs(projectId, sessionId, panelTabs, activePanelTabId, readerNavigationVisible)
  }, [activePanelTabId, panelTabs, projectId, readerNavigationVisible, sessionId])

  useEffect(() => {
    if (!activePanelTabId || panelTabs.some((tab) => tab.id === activePanelTabId)) return
    setActivePanelTabId(panelTabs[0]?.id)
  }, [activePanelTabId, panelTabs, setActivePanelTabId])
}

export function useInspectorTabsActions({ panelTabs, setPanelTabs, activePanelTabId, setActivePanelTabId, setDraggingPanelTabId, setMenuOpen, setTabListOpen, nextPanelTabIndexRef, openPanelTabRef, openSubagentRunTabRef, onClearSideChat, onOpenChange, updatePanelTab }: TabState & { onClearSideChat: () => void; onOpenChange: (open: boolean) => void; updatePanelTab: (id: string, updater: (tab: WorkspacePanelTab) => WorkspacePanelTab) => void }) {
  function createPanelTab(kind: WorkspacePanelTabKind, options?: { url?: string; readerTab?: ReaderTab; document?: { path: string; format: DocumentFormat }; reviewView?: 'review' | 'changes' }): WorkspacePanelTab {
    const id = `${kind}-${nextPanelTabIndexRef.current++}`
    if (kind === 'browser') return { id, kind, url: options?.url || '' }
    if (kind === 'document') return { id, kind, document: options?.document }
    if (kind === 'reader') return { id, kind, readerTabs: options?.readerTab ? [options.readerTab] : [], activeReaderTabId: options?.readerTab?.id }
    if (kind === 'files' || kind === 'review') {
      return { id, kind, ...(kind === 'review' ? { reviewView: options?.reviewView || 'changes' } : {}), readerTabs: options?.readerTab ? [options.readerTab] : [], activeReaderTabId: options?.readerTab?.id }
    }
    return { id, kind }
  }

  function createReaderPanelTab(readerTab: ReaderTab): WorkspacePanelTab {
    return createPanelTab('reader', { readerTab })
  }

  function openPanelTab(kind: WorkspacePanelPrimaryTabKind, nextView: WorkspacePanelView = viewFromPanelKind(kind), options?: { url?: string; readerTab?: ReaderTab }) {
    const existing = kind === 'review' || kind === 'side-chat'
      ? panelTabs.find((tab) => tab.kind === kind)
      : kind === 'browser' && options?.url
        ? findBrowserTabToReuse(panelTabs, options.url)
        : undefined
    const targetTab = existing || createPanelTab(kind, { ...options, ...(kind === 'review' ? { reviewView: nextView === 'review' ? 'review' : 'changes' } : {}) })
    if (!existing) setPanelTabs((prev) => [...prev, targetTab])
    if (existing?.kind === 'review') {
      updatePanelTab(existing.id, (tab) => ({ ...tab, reviewView: nextView === 'review' ? 'review' : 'changes' }))
    }
    if (existing?.kind === 'browser') {
      // 重复预览同一文件：复用已有 tab 并递增 reloadNonce，由 WebPreviewContent 触发 iframe 重载。
      updatePanelTab(existing.id, (tab) => ({ ...tab, reloadNonce: (tab.reloadNonce ?? 0) + 1 }))
    }
    setActivePanelTabId(targetTab.id)
    setMenuOpen(false)
    return targetTab
  }

  openPanelTabRef.current = openPanelTab

  function openSubagentRunTab(payload: SubagentRunPayload) {
    const nextId = `subagent-${nextPanelTabIndexRef.current}`
    const result = upsertSubagentRunTab(panelTabs, payload, nextId)
    if (result.created) nextPanelTabIndexRef.current += 1
    setPanelTabs(result.tabs)
    setActivePanelTabId(result.tabId)
    setMenuOpen(false)
  }

  openSubagentRunTabRef.current = openSubagentRunTab

  function activatePanelTab(tab: WorkspacePanelTab) {
    setActivePanelTabId(tab.id)
  }

  function handlePanelTabDragStart(event: DragStartEvent) {
    setDraggingPanelTabId(event.active.id as string)
    setMenuOpen(false)
    setTabListOpen(false)
  }

  function finishPanelTabDrag() {
    setDraggingPanelTabId(undefined)
  }

  function handlePanelTabDragEnd(event: DragEndEvent) {
    finishPanelTabDrag()
    const { active, over } = event
    if (!over) return
    setPanelTabs((prev) => reorderPanelTabs(prev, active.id as string, over.id as string))
  }

  function clearSideChat() {
    onClearSideChat()
  }

  function closePanelTab(id: string) {
    const closingTab = panelTabs.find((tab) => tab.id === id)
    if (closingTab?.kind === 'side-chat') clearSideChat()
    setPanelTabs((prev) => {
      const index = prev.findIndex((tab) => tab.id === id)
      const next = prev.filter((tab) => tab.id !== id)
      if (next.length === 0) {
        setActivePanelTabId(undefined)
        onOpenChange(false)
        return next
      }
      if (activePanelTabId === id) {
        const nextActive = next[index] ?? next[index - 1]
        setActivePanelTabId(nextActive?.id)
      }
      return next
    })
  }

  function closeOtherPanelTabs() {
    const activeTab = panelTabs.find((tab) => tab.id === activePanelTabId) ?? panelTabs[0]
    if (!activeTab) return
    if (activeTab.kind !== 'side-chat' && panelTabs.some((tab) => tab.kind === 'side-chat')) clearSideChat()
    setPanelTabs([activeTab])
    setActivePanelTabId(activeTab.id)
    setTabListOpen(false)
  }

  function closeAllPanelTabs() {
    if (panelTabs.some((tab) => tab.kind === 'side-chat')) clearSideChat()
    setPanelTabs([])
    setActivePanelTabId(undefined)
    setTabListOpen(false)
    onOpenChange(false)
  }
  return { createPanelTab, createReaderPanelTab, openPanelTab, openSubagentRunTab, activatePanelTab, handlePanelTabDragStart, finishPanelTabDrag, handlePanelTabDragEnd, clearSideChat, closePanelTab, closeOtherPanelTabs, closeAllPanelTabs }
}
