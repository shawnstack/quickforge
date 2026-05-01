import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ProxyTab,
  SettingsDialog,
} from '@mariozechner/pi-web-ui'
import type { Api, Model } from '@mariozechner/pi-ai'
import {
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScheduledTasksPage } from '@/components/scheduled-tasks/ScheduledTasksPage'
import { ProjectDirectoryPicker } from '@/components/project-directory-picker'
import {
  buildConnectionModel,
  DEFAULT_CONNECTION,
  getConfiguredModels,
  initializePiStorage,
  loadInitialConfiguredModel,
  saveConnectionProfile,
} from '@/lib/pi-chat'
import { createCustomProvidersOnlyTab } from '@/lib/custom-providers-only-tab'
import { initializeAppLanguage, t } from '@/lib/i18n'
import { createLanguageSettingsTab } from '@/lib/language-settings-tab'
import { openCustomOnlyModelSelector } from '@/lib/custom-model-selector'
import {
  buildSystemPrompt,
  copyTextToClipboard,
  draftTextFromUserMessage,
  rollbackConversationFromMessage,
  rollbackStartIndexFromMessage,
  shouldSaveSession,
  generateTitle,
  hasUserMessage,
} from '@/lib/message-utils'
import type {
  ProjectInfo,
  QuickForgeSessionData,
  QuickForgeSessionMetadata,
  RestoredDraft,
} from '@/lib/types'
import { sessionScope, sessionTitle } from '@/lib/types'
import { ChatPanelHost } from '@/components/chat/ChatPanelHost'
import { ModelSetupEmptyState } from '@/components/chat/ModelSetupEmptyState'
import { ChatSidebar } from '@/components/sidebar/ChatSidebar'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useProject } from '@/hooks/useProject'
import { useYoloMode } from '@/hooks/useYoloMode'
import { useCrossTabSync } from '@/hooks/useCrossTabSync'
import { useAgentManager } from '@/hooks/useAgentManager'
import { saveActiveModel, saveYoloMode } from '@/lib/pi-chat'
import { HttpStorageBackend } from '@/lib/http-storage-backend'
import { ToastContainer, type ToastItem } from '@/components/ui/toast'
import type { BackgroundTaskStatus } from '@/lib/types'

const PAGE_SIZE = 20

type SessionPage = {
  items: QuickForgeSessionMetadata[]
  total: number
  loading: boolean
}

function App() {
  // --- Top-level refs (owned by App) ---
  const storageRef = useRef<Awaited<ReturnType<typeof initializePiStorage>> | null>(null)
  const activeModelRef = useRef<Model<Api>>(buildConnectionModel(DEFAULT_CONNECTION))
  const yoloModeRef = useRef(false)
  const activeProjectRef = useRef<ProjectInfo | undefined>(undefined)

  // --- Project hook ---
  const {
    activeProject,
    projects,
    expandedProjectIds,
    selectingProject,
    projectPickerOpen,
    loadProject,
    switchActiveProject,
    handleSelectProjectPath,
    selectProjectDirectory,
    setProjectPickerOpen,
    toggleProjectExpanded,
    setActiveProject,
    setProjects,
    setExpandedProjectIds,
  } = useProject()

  // --- YOLO hook ---
  const { yoloMode, setYoloMode, initialize: initYoloMode } = useYoloMode()

  // --- UI state ---
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const [conversationsCollapsed, setConversationsCollapsed] = useState(false)
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<string>()
  const [needsModelSetup, setNeedsModelSetup] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState<RestoredDraft>()
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [scheduledTasksOpen, setScheduledTasksOpen] = useState(false)

  // --- Paginated session state ---
  const [globalPage, setGlobalPage] = useState<SessionPage>({ items: [], total: 0, loading: false })
  const [projectPages, setProjectPages] = useState<Record<string, SessionPage>>({})
  const projectPagesRef = useRef(projectPages)
  const expandedProjectIdsRef = useRef(expandedProjectIds)

  useEffect(() => {
    projectPagesRef.current = projectPages
  }, [projectPages])

  useEffect(() => {
    expandedProjectIdsRef.current = expandedProjectIds
  }, [expandedProjectIds])

  // --- Combined flat list (for useAgentManager session lookup) ---
  const allLoadedSessions: QuickForgeSessionMetadata[] = [
    ...globalPage.items,
    ...Object.values(projectPages).flatMap((p) => p.items),
  ]

  // --- Sync refs ---
  useEffect(() => {
    yoloModeRef.current = yoloMode
  }, [yoloMode])

  useEffect(() => {
    activeProjectRef.current = activeProject
  }, [activeProject])

  // --- Session list + cross-tab sync ---
  const crossTabRef = useRef<ReturnType<typeof useCrossTabSync> | null>(null)

  const backendRef = useRef<HttpStorageBackend | null>(null)

  const loadGlobalSessions = useCallback(async (offset: number) => {
    const backend = backendRef.current
    if (!backend) return
    setGlobalPage((prev) => ({ ...prev, loading: true }))
    try {
      const result = await backend.fetchPaginatedFromIndex<QuickForgeSessionMetadata>(
        'sessions-metadata', 'lastModified',
        { direction: 'desc', limit: PAGE_SIZE, offset, scope: 'global' },
      )
      setGlobalPage((prev) => ({
        items: offset === 0 ? result.values : [...prev.items, ...result.values],
        total: result.total,
        loading: false,
      }))
    } catch {
      setGlobalPage((prev) => ({ ...prev, loading: false }))
    }
  }, [])

  const loadProjectSessions = useCallback(async (projectId: string, offset: number) => {
    const backend = backendRef.current
    if (!backend) return
    setProjectPages((prev) => {
      const page = prev[projectId]
      return { ...prev, [projectId]: { ...(page ?? { items: [], total: 0 }), loading: true } }
    })
    try {
      const result = await backend.fetchPaginatedFromIndex<QuickForgeSessionMetadata>(
        'sessions-metadata', 'lastModified',
        { direction: 'desc', limit: PAGE_SIZE, offset, scope: 'project', projectId },
      )
      setProjectPages((prev) => {
        const page = prev[projectId]
        const prevItems = page?.items ?? []
        return {
          ...prev,
          [projectId]: {
            items: offset === 0 ? result.values : [...prevItems, ...result.values],
            total: result.total,
            loading: false,
          },
        }
      })
    } catch {
      setProjectPages((prev) => {
        const page = prev[projectId]
        return { ...prev, [projectId]: { ...(page ?? { items: [], total: 0 }), loading: false } }
      })
    }
  }, [])

  const refreshSessions = useCallback(async (opts?: { broadcast?: boolean }) => {
    // Reset and reload the visible initial pages.
    await loadGlobalSessions(0)

    const loadedProjectIds = new Set([
      ...Object.keys(projectPagesRef.current),
      ...expandedProjectIdsRef.current,
    ])
    if (loadedProjectIds.size === 0) {
      setProjectPages({})
    } else {
      setProjectPages((prev) => {
        const next: Record<string, SessionPage> = {}
        for (const projectId of loadedProjectIds) {
          next[projectId] = { ...(prev[projectId] ?? { items: [], total: 0 }), loading: true }
        }
        return next
      })
      await Promise.all([...loadedProjectIds].map((projectId) => loadProjectSessions(projectId, 0)))
    }

    if (opts?.broadcast) crossTabRef.current?.notifySessionsChanged()
  }, [loadGlobalSessions, loadProjectSessions])

  const crossTab = useCrossTabSync({
    onSessionsChanged: () => { refreshSessions() },
    onProjectsChanged: () => { loadProject() },
    onSettingsChanged: () => { refreshSessions() },
  })

  useEffect(() => { crossTabRef.current = crossTab }, [crossTab])

  // --- Toast management ---
  const handleTaskComplete = useCallback(
    (sessionId: string, title: string, status: BackgroundTaskStatus) => {
      const toast: ToastItem = {
        id: crypto.randomUUID(),
        sessionId,
        title,
        status,
        createdAt: Date.now(),
      }
      setToasts((prev) => [...prev, toast])
    },
    [],
  )

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // --- Agent manager ---
  const agentManager = useAgentManager({
    storageRef,
    activeModelRef,
    yoloModeRef,
    activeProjectRef,
    switchActiveProject,
    sessions: allLoadedSessions,
    refreshSessions,
    onTaskComplete: handleTaskComplete,
  })

  // Destructure stable values for use in dependency arrays
  const {
    createAgent,
    loadSession: loadAgentSession,
    syncSessionUI,
    setCurrentAgentMessages,
    updateCurrentAgentModel,
    setChatPanelRevision,
    setCurrentTitleRef,
    // Refs (stable, lint-friendly when accessed directly)
    agentRef,
    taskMapRef,
    currentSessionIdRef,
    currentChatScopeRef,
  } = agentManager

  const handleToastClick = useCallback(
    (sessionId: string) => {
      setScheduledTasksOpen(false)
      loadAgentSession(sessionId)
    },
    [loadAgentSession],
  )

  // --- Chat actions ---
  const startNewGlobalChat = useCallback(async () => {
    if (needsModelSetup) {
      alert(t('modelSetupRequired'))
      return
    }

    setScheduledTasksOpen(false)

    const sessionId = crypto.randomUUID()
    const url = new URL(window.location.href)
    url.searchParams.delete('session')
    window.history.replaceState({}, '', url)

    await createAgent(
      { tools: [] },
      sessionId,
      { scope: 'global', attachToView: true },
    )
  }, [createAgent, needsModelSetup])

  const startNewProjectChat = useCallback(async (targetProject?: ProjectInfo) => {
    if (needsModelSetup) {
      alert(t('modelSetupRequired'))
      return
    }

    setScheduledTasksOpen(false)

    const nextProject = targetProject ?? activeProjectRef.current
    if (!nextProject) return

    if (activeProjectRef.current?.id !== nextProject.id) {
      await switchActiveProject(nextProject.id)
    }

    const sessionId = crypto.randomUUID()
    const url = new URL(window.location.href)
    url.searchParams.delete('session')
    window.history.replaceState({}, '', url)

    await createAgent(
      { tools: [] },
      sessionId,
      { scope: 'project', project: nextProject, attachToView: true },
    )
  }, [createAgent, needsModelSetup, switchActiveProject])

  const deleteProjectInline = useCallback(
    async (projectId: string) => {
      const project = projects.find((p) => p.id === projectId)
      const { showConfirm } = await import('@/components/ui/confirm-dialog')
      const confirmed = await showConfirm({
        title: t('deleteProject'),
        description: t('deleteProjectConfirm', { name: project?.name ?? projectId }),
        confirmLabel: t('confirmDelete'),
        cancelLabel: t('cancel'),
      })
      if (!confirmed) return

      const response = await fetch(`/api/project/${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Failed to delete project`)
      setActiveProject(payload.project)
      setProjects(payload.projects)
      setExpandedProjectIds((current) => {
        const next = new Set(current)
        next.delete(projectId)
        return next
      })
      await refreshSessions({ broadcast: true })
      crossTab.notifyProjectsChanged()
      if (activeProjectRef.current?.id === projectId) {
        activeProjectRef.current = payload.project
        setChatPanelRevision((value) => value + 1)
      }
    },
    [projects, refreshSessions, crossTab, setActiveProject, setProjects, setExpandedProjectIds, setChatPanelRevision],
  )

  // --- Bootstrap ---
  useEffect(() => {
    let cancelled = false

    async function boot() {
      try {
        const storage = await initializePiStorage()
        if (cancelled) return

        storageRef.current = storage
        backendRef.current = storage.backend as HttpStorageBackend
        await initializeAppLanguage(storage)
        await Promise.all([loadGlobalSessions(0), loadProject()])

        const savedYoloMode = await initYoloMode(storage)
        yoloModeRef.current = savedYoloMode

        const initialModel = await loadInitialConfiguredModel(storage)
        if (initialModel) activeModelRef.current = initialModel

        const sessionId = new URLSearchParams(window.location.search).get('session')
        if (sessionId) {
          const existing = await storage.sessions.get(sessionId)
          if (existing) {
            const metadata = (await storage.sessions.getMetadata(existing.id)) as QuickForgeSessionMetadata | null
            const scope = sessionScope(metadata ?? (existing as QuickForgeSessionData))
            let project: ProjectInfo | undefined
            if (scope === 'project' && (metadata?.projectId || (existing as QuickForgeSessionData).projectId)) {
              const projectId = (metadata?.projectId ?? (existing as QuickForgeSessionData).projectId)!
              if (activeProjectRef.current?.id !== projectId) {
                try {
                  project = await switchActiveProject(projectId)
                } catch (error) {
                  console.error('Failed to switch project for initial session:', error)
                  alert(t('projectSwitchFailed'))
                  if (initialModel) {
                    await createAgent(
                      { model: initialModel, tools: [] },
                      crypto.randomUUID(),
                      { scope: 'global', attachToView: true },
                    )
                  } else {
                    setNeedsModelSetup(true)
                  }
                  setReady(true)
                  return
                }
              } else {
                project = activeProjectRef.current
              }
            }
            activeModelRef.current = existing.model as Model<Api>
            await createAgent(
              {
                systemPrompt: await buildSystemPrompt(),
                model: existing.model,
                thinkingLevel: existing.thinkingLevel,
                messages: existing.messages,
                tools: [],
              },
              existing.id,
              {
                scope,
                project,
                attachToView: true,
                createdAt: existing.createdAt,
                title: existing.title,
              },
            )
          } else if (initialModel) {
            await createAgent(
              { model: initialModel, tools: [] },
              crypto.randomUUID(),
              { scope: 'global', attachToView: true },
            )
          } else {
            setNeedsModelSetup(true)
          }
        } else if (initialModel) {
          await createAgent(
            { model: initialModel, tools: [] },
            crypto.randomUUID(),
            { scope: 'global', attachToView: true },
          )
        } else {
          setNeedsModelSetup(true)
        }

        setReady(true)
      } catch (error) {
        console.error('Failed to bootstrap QuickForge:', error)
        if (!cancelled) setStartupError(t('localServiceUnavailableDescription'))
      }
    }

    boot()
    const taskMap = taskMapRef.current
    return () => {
      cancelled = true
      for (const task of taskMap.values()) task.unsubscribe()
      taskMap.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadProject, refreshSessions, switchActiveProject, initYoloMode])

  // --- YOLO ---
  const toggleYoloMode = useCallback(() => {
    const storage = storageRef.current
    setYoloMode((prev) => {
      const next = !prev
      yoloModeRef.current = next
      if (storage) {
        void saveYoloMode(storage, next).catch((error) => {
          console.error('Failed to save YOLO mode:', error)
        })
      }
      return next
    })
    if (agentRef.current) {
      setChatPanelRevision((value) => value + 1)
    }
    crossTab.notifySettingsChanged()
  }, [setYoloMode, crossTab, setChatPanelRevision, agentRef])

  // --- Message actions ---
  const rollbackFromMessage = useCallback(async (messageIndex: number) => {
    const currentAgent = agentRef.current
    if (!currentAgent) return

    if (currentAgent.state.isStreaming) {
      alert(t('generationStillRunning'))
      return
    }

    const rollbackIndex = rollbackStartIndexFromMessage(currentAgent.state.messages, messageIndex)
    const rollbackMessage = rollbackIndex >= 0 ? currentAgent.state.messages[rollbackIndex] : undefined
    const nextMessages = rollbackConversationFromMessage(currentAgent.state.messages, messageIndex)
    if (nextMessages.length === currentAgent.state.messages.length) {
      alert(t('noConversationTurnToRollback'))
      return
    }

    const restoredRollbackDraft = rollbackMessage
      ? {
          id: Date.now(),
          text: draftTextFromUserMessage(rollbackMessage),
          attachments: rollbackMessage.role === 'user-with-attachments' ? rollbackMessage.attachments : undefined,
        }
      : undefined

    setCurrentAgentMessages(nextMessages)

    const currentTask = currentSessionIdRef.current
      ? taskMapRef.current.get(currentSessionIdRef.current)
      : undefined

    if (shouldSaveSession(nextMessages) && currentTask) {
      if (restoredRollbackDraft) setRestoredDraft(restoredRollbackDraft)
      setChatPanelRevision((value) => value + 1)
      syncSessionUI(currentTask).catch((err) => console.error('Failed to sync session UI:', err))
      return
    }

    const storage = storageRef.current
    const previousSessionId = currentSessionIdRef.current
    const scope = currentChatScopeRef.current
    const project = scope === 'project' ? activeProjectRef.current : undefined
    const model = currentAgent.state.model ?? activeModelRef.current
    const thinkingLevel = currentAgent.state.thinkingLevel

    if (previousSessionId) {
      const task = taskMapRef.current.get(previousSessionId)
      task?.unsubscribe()
      taskMapRef.current.delete(previousSessionId)
    }

    if (storage && previousSessionId) {
      try {
        await storage.sessions.delete(previousSessionId)
        await refreshSessions({ broadcast: true })
      } catch (error) {
        console.error('Failed to delete rolled back empty session:', error)
      }
    }

    const newSessionId = crypto.randomUUID()
    await createAgent(
      {
        model,
        thinkingLevel,
        messages: [],
        tools: [],
      },
      newSessionId,
      {
        scope,
        project,
        attachToView: true,
        title: 'New chat',
      },
    )

    if (restoredRollbackDraft) setRestoredDraft(restoredRollbackDraft)
    setChatPanelRevision((value) => value + 1)
  }, [createAgent, syncSessionUI, setCurrentAgentMessages, setChatPanelRevision, refreshSessions, agentRef, currentChatScopeRef, currentSessionIdRef, taskMapRef])

  const copyAnswer = useCallback(async (text: string) => {
    try {
      await copyTextToClipboard(text)
    } catch (error) {
      console.error('Failed to copy answer:', error)
      alert(t('copyFailed'))
      throw error
    }
  }, [])

  const forkFromMessage = useCallback(async (messageIndex: number) => {
    const currentAgent = agentRef.current
    if (!currentAgent) return

    if (currentAgent.state.isStreaming) {
      alert(t('generationStillRunning'))
      return
    }

    const messages = currentAgent.state.messages.slice(0, messageIndex + 1)
    if (!hasUserMessage(messages)) return

    const scope = currentChatScopeRef.current
    const project = scope === 'project' ? activeProjectRef.current : undefined
    const newSessionId = crypto.randomUUID()
    const title = generateTitle(messages)

    const storage = storageRef.current

    await createAgent(
      {
        systemPrompt: await buildSystemPrompt(),
        model: currentAgent.state.model ?? activeModelRef.current,
        thinkingLevel: currentAgent.state.thinkingLevel,
        messages,
        tools: [],
      },
      newSessionId,
      {
        scope,
        project,
        attachToView: true,
        title,
      },
    )

    if (storage) {
      refreshSessions({ broadcast: true }).catch((error) => console.error('Failed to refresh sessions:', error))
    }
  }, [createAgent, refreshSessions, agentRef, currentChatScopeRef])

  // --- Model setup / selection ---
  const activateConfiguredModel = useCallback(async () => {
    const storage = storageRef.current
    if (!storage) return false

    const model = await loadInitialConfiguredModel(storage)
    if (!model) {
      setNeedsModelSetup(true)
      return false
    }

    activeModelRef.current = model
    setNeedsModelSetup(false)
    await saveActiveModel(storage, model)

    const currentAgent = agentRef.current
    if (currentAgent) {
      updateCurrentAgentModel(model)
      setChatPanelRevision((value) => value + 1)
    } else {
      await createAgent(
        { model, tools: [] },
        crypto.randomUUID(),
        { scope: 'global', attachToView: true },
      )
    }

    crossTab.notifySettingsChanged()
    return true
  }, [createAgent, updateCurrentAgentModel, setChatPanelRevision, crossTab, agentRef])

  const openModelSettings = useCallback(() => {
    SettingsDialog.open(
      [createLanguageSettingsTab(), createCustomProvidersOnlyTab(), new ProxyTab()],
      () => {
        if (needsModelSetup || !agentRef.current) {
          void activateConfiguredModel().catch((error) => console.error('Failed to activate configured model:', error))
        }
      },
    )
    window.setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dialog = document.querySelector('settings-dialog') as any
      if (dialog) {
        dialog.activeTabIndex = 1
        dialog.requestUpdate?.()
      }
    }, 0)
  }, [activateConfiguredModel, needsModelSetup, agentRef])

  const activateLiteLlmExampleModel = useCallback(async () => {
    const storage = storageRef.current
    if (!storage) return

    const model = buildConnectionModel(DEFAULT_CONNECTION)
    await saveConnectionProfile(storage, DEFAULT_CONNECTION, model)
    await saveActiveModel(storage, model)
    activeModelRef.current = model
    setNeedsModelSetup(false)

    if (agentRef.current) {
      updateCurrentAgentModel(model)
      setChatPanelRevision((value) => value + 1)
    } else {
      await createAgent(
        { model, tools: [] },
        crypto.randomUUID(),
        { scope: 'global', attachToView: true },
      )
    }
    crossTab.notifySettingsChanged()
  }, [createAgent, updateCurrentAgentModel, setChatPanelRevision, crossTab, agentRef])

  const openCustomModelSelector = useCallback(async () => {
    const storage = storageRef.current
    const currentAgent = agentRef.current
    if (!storage || !currentAgent) return

    const textarea = document.querySelector<HTMLTextAreaElement>(
      'agent-interface message-editor textarea',
    )
    const currentInput = textarea?.value ?? ''

    const customProviders = await storage.customProviders.getAll()

    for (const provider of customProviders) {
      if (provider.apiKey) {
        await storage.providerKeys.set(provider.name, provider.apiKey)
      }
    }

    const customModels = await getConfiguredModels(storage)

    if (customModels.length === 0) {
      if (confirm(t('addCustomModelFirst'))) {
        openModelSettings()
      }
      return
    }

    openCustomOnlyModelSelector(
      currentAgent.state.model ?? activeModelRef.current,
      customModels,
      (model) => {
        const nextModel = model as Model<Api>
        currentAgent.state.model = nextModel
        activeModelRef.current = nextModel

        void currentAgent.updateModel(nextModel).catch((error) => {
          console.error('Failed to sync model to server:', error)
        })

        if (currentInput) {
          setRestoredDraft({
            id: Date.now(),
            text: currentInput,
          })
        }

        setChatPanelRevision((value) => value + 1)
        void saveActiveModel(storage, nextModel).catch((error) => {
          console.error('Failed to save active model:', error)
        })
      },
      async (model) => {
        await SettingsDialog.open([createLanguageSettingsTab(), createCustomProvidersOnlyTab(model.provider), new ProxyTab()])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dialog = document.querySelector('settings-dialog') as any
        if (dialog) {
          dialog.activeTabIndex = 1
          dialog.requestUpdate?.()
        }
      },
    )
  }, [openModelSettings, setChatPanelRevision, agentRef])

  // --- Derived data ---
  const globalSessions = globalPage.items
  const sessionsForProject = useCallback((projectId: string) => {
    return projectPages[projectId]?.items ?? []
  }, [projectPages])
  const globalHasMore = globalPage.items.length < globalPage.total
  const projectHasMore = useCallback((projectId: string) => {
    const page = projectPages[projectId]
    if (!page) return true // not yet loaded
    return page.items.length < page.total
  }, [projectPages])
  const globalLoading = globalPage.loading
  const projectLoading = useCallback((projectId: string) => projectPages[projectId]?.loading ?? false, [projectPages])
  const projectLoaded = useCallback((projectId: string) => projectId in projectPages, [projectPages])
  const sessionTaskStatus = useCallback((session: QuickForgeSessionMetadata) => {
    return agentManager.taskStatuses[session.id] ?? session.taskStatus ?? 'idle'
  }, [agentManager.taskStatuses])

  const loadMoreGlobal = useCallback(() => {
    void loadGlobalSessions(globalPage.items.length)
  }, [globalPage.items.length, loadGlobalSessions])

  const loadMoreProject = useCallback((projectId: string) => {
    const page = projectPages[projectId]
    void loadProjectSessions(projectId, page?.items.length ?? 0)
  }, [loadProjectSessions, projectPages])

  const toggleProjectsCollapsed = useCallback(() => {
    setProjectsCollapsed((value) => !value)
  }, [])

  const toggleConversationsCollapsed = useCallback(() => {
    setConversationsCollapsed((value) => !value)
  }, [])

  // --- Loading state ---
  if (startupError) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="max-w-md rounded-lg border border-border bg-card p-5 shadow-sm">
          <h1 className="text-base font-semibold">{t('localServiceUnavailableTitle')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{startupError}</p>
        </div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="text-sm text-muted-foreground">{t('loadingChatWorkspace')}</div>
      </div>
    )
  }

  if (!agentManager.agent && !needsModelSetup) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="text-sm text-muted-foreground">{t('loadingChatWorkspace')}</div>
      </div>
    )
  }

  return (
    <>
    <div className="flex h-screen min-h-0 bg-background text-foreground">
      <ChatSidebar
        sidebarOpen={sidebarOpen}
        scheduledTasksActive={scheduledTasksOpen}
        projectsCollapsed={projectsCollapsed}
        conversationsCollapsed={conversationsCollapsed}
        projects={projects}
        expandedProjectIds={expandedProjectIds}
        activeProject={activeProject}
        currentSessionId={agentManager.currentSessionId}
        globalSessions={globalSessions}
        sessionsForProject={sessionsForProject}
        globalHasMore={globalHasMore}
        globalLoading={globalLoading}
        onLoadMoreGlobal={loadMoreGlobal}
        projectHasMore={projectHasMore}
        projectLoading={projectLoading}
        projectLoaded={projectLoaded}
        onLoadMoreProject={loadMoreProject}
        sessionTaskStatus={sessionTaskStatus}
        selectingProject={selectingProject}
        onToggleProjectsCollapsed={toggleProjectsCollapsed}
        onToggleConversationsCollapsed={toggleConversationsCollapsed}
        onToggleProjectExpanded={toggleProjectExpanded}
        onSelectProjectDirectory={selectProjectDirectory}
        onStartNewProjectChat={startNewProjectChat}
        onDeleteProject={deleteProjectInline}
        onLoadSession={(sessionId) => {
          setScheduledTasksOpen(false)
          void loadAgentSession(sessionId)
        }}
        onRenameSession={async (sessionId, currentTitle) => {
          const storage = storageRef.current
          if (!storage) return
          const { showPrompt } = await import('@/components/ui/prompt-dialog')
          const newTitle = await showPrompt({
            title: t('renameSession'),
            description: t('sessionName'),
            defaultValue: currentTitle,
            confirmLabel: t('save'),
            cancelLabel: t('cancel'),
          })
          if (!newTitle || newTitle === currentTitle) return
          const session = await storage.sessions.get(sessionId)
          if (!session) return
          const metadata = await storage.sessions.getMetadata(sessionId)
          if (!metadata) return
          await storage.sessions.save(session, { ...metadata, title: newTitle })
          await refreshSessions({ broadcast: true })
          if (currentSessionIdRef.current === sessionId) {
            setCurrentTitleRef(newTitle)
          }
        }}
        onDeleteSession={async (sessionId) => {
          const storage = storageRef.current
          if (!storage) return
          const { showConfirm } = await import('@/components/ui/confirm-dialog')
          const confirmed = await showConfirm({
            title: t('deleteSession'),
            description: t('deleteSessionConfirm'),
            confirmLabel: t('confirmDelete'),
            cancelLabel: t('cancel'),
          })
          if (!confirmed) return
          const task = taskMapRef.current.get(sessionId)
          task?.unsubscribe()
          taskMapRef.current.delete(sessionId)
          await storage.sessions.delete(sessionId)
          await refreshSessions({ broadcast: true })
          if (currentSessionIdRef.current === sessionId) {
            setScheduledTasksOpen(false)
            await startNewGlobalChat()
          }
        }}
        onStartNewGlobalChat={() => {
          setScheduledTasksOpen(false)
          void startNewGlobalChat()
        }}
        onOpenScheduledTasks={() => setScheduledTasksOpen(true)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            onClick={() => setSidebarOpen((value) => !value)}
            aria-label={t('toggleSidebar')}
          >
            {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="md:hidden" onClick={startNewGlobalChat} aria-label={t('newChat')}>
            <Plus className="size-4" />
          </Button>

          <div className="min-w-0 flex-1">
            {scheduledTasksOpen ? (
              <>
                <div className="truncate text-xs text-muted-foreground">AI Workspace</div>
                <div className="truncate text-sm font-semibold">定时任务</div>
              </>
            ) : (
              <>
                <div className="truncate text-xs text-muted-foreground">
                  {agentManager.chatScope === 'project' ? (agentManager.currentToolProject?.name ?? t('projectChat')) : t('normalChat')}
                </div>
                <div className="truncate text-sm font-semibold">{sessionTitle(agentManager.currentTitle)}</div>
              </>
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={openModelSettings}
            aria-label={t('settings')}
          >
            <Settings className="size-4" />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            {scheduledTasksOpen ? (
              <ScheduledTasksPage />
            ) : needsModelSetup ? (
              <ModelSetupEmptyState
                onAddModel={openModelSettings}
                onUseExample={() => {
                  void activateLiteLlmExampleModel().catch((error) => console.error('Failed to use LiteLLM example:', error))
                }}
              />
            ) : (
              <ErrorBoundary>
                <ChatPanelHost
                  agent={agentManager.agent}
                  onModelSelect={openCustomModelSelector}
                  revision={agentManager.chatPanelRevision}
                  yoloMode={yoloMode}
                  workspaceToolsEnabled={Boolean(agentManager.currentToolProject?.id)}
                  projectId={agentManager.currentToolProject?.id}
                  onToggleYoloMode={toggleYoloMode}
                  onRollbackFromMessage={rollbackFromMessage}
                  onCopyAnswer={copyAnswer}
                  onForkFromMessage={forkFromMessage}
                  restoredDraft={restoredDraft}
                />
              </ErrorBoundary>
            )}
          </section>
        </div>
      </main>
    </div>
    <ProjectDirectoryPicker
      open={projectPickerOpen}
      initialPath={activeProject?.path}
      disabled={selectingProject}
      onOpenChange={setProjectPickerOpen}
      onSelect={handleSelectProjectPath}
    />
    <ToastContainer
      toasts={toasts}
      onDismiss={dismissToast}
      onClick={handleToastClick}
    />
    </>
  )
}

export default App
