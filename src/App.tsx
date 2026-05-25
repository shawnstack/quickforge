import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Api, Model } from '@mariozechner/pi-ai'
import type { BackgroundTaskStatus } from '@/lib/types'
import {
  Menu,
  PanelRightOpen,
  Share2,
  SquareTerminal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScheduledTasksPage } from '@/components/scheduled-tasks/ScheduledTasksPage'
import { ProjectDirectoryPicker } from '@/components/project-directory-picker'
import { SkillsDialog } from '@/components/skills-dialog'
import { McpServersDialog } from '@/components/mcp-servers-dialog'
import {
  buildConnectionModel,
  DEFAULT_CONNECTION,
  initializePiStorage,
} from '@/lib/pi-chat'
import { t } from '@/lib/i18n'
import type {
  ProjectInfo,
  QuickForgeSessionMetadata,
  RestoredDraft,
  SkillsScope,
} from '@/lib/types'
import { sessionTitle } from '@/lib/types'
import { ChatPanelHost } from '@/components/chat/ChatPanelHost'
import { ModelSetupEmptyState } from '@/components/chat/ModelSetupEmptyState'
import { ChatSidebar } from '@/components/sidebar/ChatSidebar'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useProject } from '@/hooks/useProject'
import { useYoloMode } from '@/hooks/useYoloMode'
import { useCrossTabSync } from '@/hooks/useCrossTabSync'
import { useAgentManager } from '@/hooks/useAgentManager'
import { useSessionPagination } from '@/hooks/useSessionPagination'
import { useTaskToasts } from '@/hooks/useTaskToasts'
import { useAppBootstrap } from '@/hooks/useAppBootstrap'
import { useModelActions } from '@/hooks/useModelActions'
import { useChatActions } from '@/hooks/useChatActions'
import { useProjectActions } from '@/hooks/useProjectActions'
import { useSessionActions } from '@/hooks/useSessionActions'
import { useYoloActions } from '@/hooks/useYoloActions'
import { useVisibleRuntimeStatuses } from '@/hooks/useVisibleRuntimeStatuses'
import { HttpStorageBackend } from '@/lib/http-storage-backend'
import { logger } from '@/lib/logger'
import { ToastContainer } from '@/components/ui/toast'
import { ShareConversationDialog } from '@/components/share/ShareConversationDialog'
import { SharedConversationPage } from '@/components/share/SharedConversationPage'
import { WorkspaceInspector } from '@/components/workspace/WorkspaceInspector'
import { TerminalDock } from '@/components/terminal/TerminalDock'
import { subscribeToAgentEvents } from '@/lib/server-agent'

type ScheduledTaskNotificationEvent = {
  type?: unknown
  sessionId?: unknown
  title?: unknown
  status?: unknown
  message?: unknown
}

type ScheduledTaskStartedEvent = {
  type?: unknown
  sessionId?: unknown
  title?: unknown
  scope?: unknown
  projectId?: unknown
  createdAt?: unknown
}

function isBackgroundTaskStatus(value: unknown): value is BackgroundTaskStatus {
  return value === 'idle' || value === 'running' || value === 'error' || value === 'aborted'
}

function isScheduledTaskNotification(event: Record<string, unknown>): event is ScheduledTaskNotificationEvent {
  return event.type === 'scheduled_task_notification'
}

function isScheduledTaskStarted(event: Record<string, unknown>): event is ScheduledTaskStartedEvent {
  return event.type === 'scheduled_task_started'
}

function MainApp() {
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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const [conversationsCollapsed, setConversationsCollapsed] = useState(false)
  const [needsModelSetup, setNeedsModelSetup] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState<RestoredDraft>()
  const [scheduledTasksOpen, setScheduledTasksOpen] = useState(false)
  const [mcpServersDialogOpen, setMcpServersDialogOpen] = useState(false)
  const [skillsDialog, setSkillsDialog] = useState<{ scope: SkillsScope; project?: ProjectInfo }>()
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [workspaceInspectorOpen, setWorkspaceInspectorOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const { toasts, handleTaskComplete, addToast, dismissToast } = useTaskToasts()

  // --- Session list + cross-tab sync ---
  const crossTabRef = useRef<ReturnType<typeof useCrossTabSync> | null>(null)

  const backendRef = useRef<HttpStorageBackend | null>(null)
  const notifySessionsChanged = useCallback(() => crossTabRef.current?.notifySessionsChanged(), [])

  const {
    allLoadedSessions,
    globalSessions,
    sessionsForProject,
    globalHasMore,
    projectHasMore,
    globalLoading,
    projectLoading,
    projectLoaded,
    loadGlobalSessions,
    loadProjectSessions,
    refreshSessions,
    loadMoreGlobal,
    loadMoreProject,
  } = useSessionPagination({
    backendRef,
    expandedProjectIds,
    onBroadcastSessionsChanged: notifySessionsChanged,
  })

  const crossTab = useCrossTabSync({
    onSessionsChanged: () => { refreshSessions() },
    onProjectsChanged: () => { loadProject() },
    onSettingsChanged: () => { refreshSessions() },
  })

  // --- Sync refs ---
  useEffect(() => {
    yoloModeRef.current = yoloMode
  }, [yoloMode])

  useEffect(() => {
    activeProjectRef.current = activeProject
  }, [activeProject])

  useEffect(() => { crossTabRef.current = crossTab }, [crossTab])

  // --- Agent manager ---
  const agentManager = useAgentManager({
    storageRef,
    activeModelRef,
    yoloModeRef,
    activeProjectRef,
    setYoloMode,
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
      if (!sessionId) return
      setScheduledTasksOpen(false)
      loadAgentSession(sessionId)
    },
    [loadAgentSession],
  )

  const restoreWorkspaceDraft = useCallback((text: string) => {
    if (!text.trim()) return
    setScheduledTasksOpen(false)
    setRestoredDraft({
      id: Date.now(),
      sessionId: currentSessionIdRef.current,
      text,
    })
  }, [currentSessionIdRef])

  useEffect(() => {
    const unsubscribe = subscribeToAgentEvents((event) => {
      if (isScheduledTaskStarted(event)) {
        const projectId = typeof event.projectId === 'string' ? event.projectId : undefined
        if (projectId) {
          setExpandedProjectIds((current) => {
            const next = new Set(current)
            next.add(projectId)
            return next
          })
          void loadProjectSessions(projectId, 0)
        }
        void refreshSessions({ broadcast: true })
        return
      }
      if (!isScheduledTaskNotification(event)) return
      const sessionId = typeof event.sessionId === 'string' ? event.sessionId : undefined
      const title = typeof event.title === 'string' ? event.title : t('scheduledTasks')
      const status = isBackgroundTaskStatus(event.status) ? event.status : 'idle'
      const message = typeof event.message === 'string' ? event.message : undefined
      addToast({ sessionId: sessionId ?? '', title, status, message })
    })
    return unsubscribe
  }, [addToast, loadProjectSessions, refreshSessions, setExpandedProjectIds])

  const { ready, startupError } = useAppBootstrap({
    storageRef,
    backendRef,
    activeModelRef,
    yoloModeRef,
    activeProjectRef,
    setYoloMode,
    taskMapRef,
    loadGlobalSessions,
    loadProject,
    initYoloMode,
    switchActiveProject,
    createAgent,
    setNeedsModelSetup,
  })

  useEffect(() => {
    if (!ready) return

    for (const projectId of expandedProjectIds) {
      if (!projectLoaded(projectId) && !projectLoading(projectId)) {
        void loadProjectSessions(projectId, 0)
      }
    }
  }, [ready, expandedProjectIds, projectLoaded, projectLoading, loadProjectSessions])

  const {
    startNewGlobalChat,
    startNewProjectChat,
    rollbackFromMessage,
    copyAnswer,
    forkFromMessage,
  } = useChatActions({
    storageRef,
    activeModelRef,
    activeProjectRef,
    currentChatScopeRef,
    currentSessionIdRef,
    taskMapRef,
    agentRef,
    createAgent,
    syncSessionUI,
    setCurrentAgentMessages,
    setChatPanelRevision,
    refreshSessions,
    needsModelSetup,
    switchActiveProject,
    setScheduledTasksOpen,
    setRestoredDraft,
  })

  const { deleteProjectInline } = useProjectActions({
    projects,
    activeProjectRef,
    refreshSessions,
    notifyProjectsChanged: crossTab.notifyProjectsChanged,
    setActiveProject,
    setProjects,
    setExpandedProjectIds,
    setChatPanelRevision,
  })

  const { toggleYoloMode } = useYoloActions({
    storageRef,
    yoloModeRef,
    setYoloMode,
    agentRef,
    setChatPanelRevision,
    notifySettingsChanged: crossTab.notifySettingsChanged,
  })

  const handleApproveToolCall = useCallback(async (toolCallId: string) => {
    const currentAgent = agentRef.current
    if (!currentAgent) throw new Error(t('toolApprovalFailed'))
    try {
      await currentAgent.approveToolCall(toolCallId)
    } catch (err) {
      logger.error('Failed to approve tool call:', err)
      throw err instanceof Error ? err : new Error(t('toolApprovalFailed'))
    }
  }, [agentRef])

  const handleRejectToolCall = useCallback(async (toolCallId: string) => {
    const currentAgent = agentRef.current
    if (!currentAgent) throw new Error(t('toolApprovalFailed'))
    try {
      await currentAgent.rejectToolCall(toolCallId)
    } catch (err) {
      logger.error('Failed to reject tool call:', err)
      throw err instanceof Error ? err : new Error(t('toolApprovalFailed'))
    }
  }, [agentRef])

  const handleApproveAutoCompact = useCallback(async (approvalId: string) => {
    const currentAgent = agentRef.current as (typeof agentRef.current & { approveAutoCompact?: (approvalId: string) => Promise<void> })
    if (!currentAgent?.approveAutoCompact) throw new Error(t('toolApprovalFailed'))
    await currentAgent.approveAutoCompact(approvalId)
  }, [agentRef])

  const handleRejectAutoCompact = useCallback(async (approvalId: string) => {
    const currentAgent = agentRef.current as (typeof agentRef.current & { rejectAutoCompact?: (approvalId: string) => Promise<void> })
    if (!currentAgent?.rejectAutoCompact) throw new Error(t('toolApprovalFailed'))
    await currentAgent.rejectAutoCompact(approvalId)
  }, [agentRef])

  const {
    loadSession,
    renameSession,
    deleteSession,
    startNewGlobalSession,
  } = useSessionActions({
    storageRef,
    taskMapRef,
    currentSessionIdRef,
    loadAgentSession,
    setCurrentTitleRef,
    refreshSessions,
    setScheduledTasksOpen,
    startNewGlobalChat,
  })

  const {
    openModelSettings,
    openDefaultOptionsSettings,
    activateLiteLlmExampleModel,
    openCustomModelSelector,
  } = useModelActions({
    storageRef,
    activeModelRef,
    agentRef,
    createAgent,
    updateCurrentAgentModel,
    setChatPanelRevision,
    needsModelSetup,
    setNeedsModelSetup,
    setRestoredDraft,
    notifySettingsChanged: crossTab.notifySettingsChanged,
  })

  // --- Derived data ---
  const visibleSessions = useMemo(() => [
    ...globalSessions,
    ...projects.flatMap((project) => sessionsForProject(project.id)),
  ], [globalSessions, projects, sessionsForProject])
  const visibleRuntimeStatuses = useVisibleRuntimeStatuses(visibleSessions)

  const sessionTaskStatus = useCallback((session: QuickForgeSessionMetadata) => {
    return agentManager.taskStatuses[session.id]
      ?? visibleRuntimeStatuses[session.id]
      ?? session.taskStatus
      ?? 'idle'
  }, [agentManager.taskStatuses, visibleRuntimeStatuses])

  const toggleProjectsCollapsed = useCallback(() => {
    setProjectsCollapsed((value) => !value)
  }, [])

  const toggleConversationsCollapsed = useCallback(() => {
    setConversationsCollapsed((value) => !value)
  }, [])

  const openGlobalSkills = useCallback(() => {
    setSkillsDialog({ scope: 'global' })
  }, [])

  const openProjectSkills = useCallback((project: ProjectInfo) => {
    setSkillsDialog({ scope: 'project', project })
  }, [])

  const openProjectInExplorer = useCallback(async (project: ProjectInfo) => {
    const response = await fetch(`/api/project/${encodeURIComponent(project.id)}/open-in-explorer`, {
      method: 'POST',
    })
    if (response.ok) return
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || t('openInExplorerFailed'))
  }, [])

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false)
  }, [])

  const loadSessionFromSidebar = useCallback((sessionId: string) => {
    closeMobileSidebar()
    loadSession(sessionId)
  }, [closeMobileSidebar, loadSession])

  const startNewGlobalSessionFromSidebar = useCallback(() => {
    closeMobileSidebar()
    startNewGlobalSession()
  }, [closeMobileSidebar, startNewGlobalSession])

  const startNewProjectChatFromSidebar = useCallback((project: ProjectInfo) => {
    closeMobileSidebar()
    void startNewProjectChat(project)
  }, [closeMobileSidebar, startNewProjectChat])

  const openScheduledTasksFromSidebar = useCallback(() => {
    closeMobileSidebar()
    setScheduledTasksOpen(true)
  }, [closeMobileSidebar])

  const openGlobalSkillsFromSidebar = useCallback(() => {
    closeMobileSidebar()
    openGlobalSkills()
  }, [closeMobileSidebar, openGlobalSkills])

  const openMcpServersFromSidebar = useCallback(() => {
    closeMobileSidebar()
    setMcpServersDialogOpen(true)
  }, [closeMobileSidebar])

  const openProjectSkillsFromSidebar = useCallback((project: ProjectInfo) => {
    closeMobileSidebar()
    openProjectSkills(project)
  }, [closeMobileSidebar, openProjectSkills])

  const handleSkillsSaved = useCallback((payload: { scope: SkillsScope; project?: ProjectInfo; projects?: ProjectInfo[] }) => {
    if (payload.scope === 'project' && payload.project && payload.projects) {
      setProjects(payload.projects)
      setSkillsDialog({ scope: 'project', project: payload.project })
      if (activeProjectRef.current?.id === payload.project.id) {
        setActiveProject(payload.project)
        activeProjectRef.current = payload.project
      }
      crossTab.notifyProjectsChanged()
      return
    }

    crossTab.notifyProjectsChanged()
  }, [crossTab, setActiveProject, setProjects])

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
        onOpenGlobalSkills={openGlobalSkills}
        onOpenMcpServers={() => setMcpServersDialogOpen(true)}
        onOpenProjectSkills={openProjectSkills}
        onOpenProjectInExplorer={(project) => {
          void openProjectInExplorer(project).catch((error) => {
            logger.error('Failed to open project in explorer:', error)
            alert(error instanceof Error ? error.message : t('openInExplorerFailed'))
          })
        }}
        onDeleteProject={deleteProjectInline}
        onLoadSession={loadSession}
        onRenameSession={renameSession}
        onDeleteSession={deleteSession}
        onStartNewGlobalChat={startNewGlobalSession}
        onOpenScheduledTasks={() => setScheduledTasksOpen(true)}
        onOpenSettings={openDefaultOptionsSettings}
        onToggleSidebar={() => setSidebarOpen((value) => !value)}
      />

      {mobileSidebarOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-background/65 backdrop-blur-sm"
            onClick={closeMobileSidebar}
            aria-label={t('toggleSidebar')}
          />
          <div className="absolute inset-y-0 left-0 max-w-[85vw] shadow-2xl">
            <ChatSidebar
              variant="mobile"
              sidebarOpen
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
              onSelectProjectDirectory={() => {
                closeMobileSidebar()
                selectProjectDirectory()
              }}
              onStartNewProjectChat={startNewProjectChatFromSidebar}
              onOpenGlobalSkills={openGlobalSkillsFromSidebar}
              onOpenMcpServers={openMcpServersFromSidebar}
              onOpenProjectSkills={openProjectSkillsFromSidebar}
              onOpenProjectInExplorer={(project) => {
                closeMobileSidebar()
                void openProjectInExplorer(project).catch((error) => {
                  logger.error('Failed to open project in explorer:', error)
                  alert(error instanceof Error ? error.message : t('openInExplorerFailed'))
                })
              }}
              onDeleteProject={deleteProjectInline}
              onLoadSession={loadSessionFromSidebar}
              onRenameSession={renameSession}
              onDeleteSession={deleteSession}
              onStartNewGlobalChat={startNewGlobalSessionFromSidebar}
              onOpenScheduledTasks={openScheduledTasksFromSidebar}
              onOpenSettings={() => {
                closeMobileSidebar()
                openDefaultOptionsSettings()
              }}
              onToggleSidebar={closeMobileSidebar}
            />
          </div>
        </div>
      ) : null}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileSidebarOpen(true)} aria-label={t('toggleSidebar')}>
            <Menu className="size-4" />
          </Button>

          <div className="min-w-0 flex-1">
            {scheduledTasksOpen ? (
              <>
                <div className="truncate text-xs text-muted-foreground">AI Workspace</div>
                <div className="truncate text-sm font-semibold">{t('scheduledTasks')}</div>
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
            onClick={() => setWorkspaceInspectorOpen((value) => !value)}
            disabled={!agentManager.currentToolProject?.id || scheduledTasksOpen || needsModelSetup}
            aria-label="Workspace"
            title="Workspace"
            className="hidden lg:inline-flex"
          >
            <PanelRightOpen className="size-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTerminalOpen((value) => !value)}
            disabled={scheduledTasksOpen || needsModelSetup}
            aria-label="终端"
            title="终端"
            className={terminalOpen ? 'bg-accent text-accent-foreground' : undefined}
          >
            <SquareTerminal className="size-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShareDialogOpen(true)}
            disabled={!agentManager.currentSessionId || scheduledTasksOpen || needsModelSetup}
            aria-label="分享到局域网"
            title="分享到局域网"
          >
            <Share2 className="size-4" />
          </Button>

        </header>

        <section className="relative flex min-h-0 flex-1 flex-col">
          {scheduledTasksOpen ? (
              <ScheduledTasksPage onOpenSession={handleToastClick} />
            ) : needsModelSetup ? (
              <ModelSetupEmptyState
                onAddModel={openModelSettings}
                onUseExample={() => {
                  void activateLiteLlmExampleModel().catch((error) => logger.error('Failed to use LiteLLM example:', error))
                }}
              />
            ) : (
              <>
                <div className="flex min-h-0 flex-1 flex-col">
                  <ErrorBoundary>
                    <ChatPanelHost
                      agent={agentManager.agent}
                      onModelSelect={openCustomModelSelector}
                      revision={agentManager.chatPanelRevision}
                      yoloMode={yoloMode}
                      workspaceToolsEnabled={Boolean(agentManager.currentToolProject?.id)}
                      project={agentManager.currentToolProject}
                      projectId={agentManager.currentToolProject?.id}
                      onToggleYoloMode={toggleYoloMode}
                      onRollbackFromMessage={rollbackFromMessage}
                      onCopyAnswer={copyAnswer}
                      onForkFromMessage={forkFromMessage}
                      onApproveToolCall={handleApproveToolCall}
                      onRejectToolCall={handleRejectToolCall}
                      onApproveAutoCompact={handleApproveAutoCompact}
                      onRejectAutoCompact={handleRejectAutoCompact}
                      disableFork={false}
                      restoredDraft={restoredDraft}
                    />
                  </ErrorBoundary>
                </div>
                {terminalOpen ? (
                  <TerminalDock
                    project={agentManager.currentToolProject}
                    onCollapse={() => setTerminalOpen(false)}
                  />
                ) : null}
              </>
          )}
        </section>
      </main>
      <WorkspaceInspector
        project={agentManager.currentToolProject}
        open={workspaceInspectorOpen && Boolean(agentManager.currentToolProject?.id)}
        onOpenChange={setWorkspaceInspectorOpen}
        onDraftRequest={restoreWorkspaceDraft}
      />
    </div>
    <ProjectDirectoryPicker
      open={projectPickerOpen}
      initialPath={activeProject?.path}
      disabled={selectingProject}
      onOpenChange={setProjectPickerOpen}
      onSelect={handleSelectProjectPath}
    />
    <SkillsDialog
      open={Boolean(skillsDialog)}
      scope={skillsDialog?.scope ?? 'global'}
      project={skillsDialog?.project}
      onOpenChange={(open) => {
        if (!open) setSkillsDialog(undefined)
      }}
      onSaved={handleSkillsSaved}
    />
    <McpServersDialog
      open={mcpServersDialogOpen}
      onOpenChange={setMcpServersDialogOpen}
    />
    <ShareConversationDialog
      open={shareDialogOpen}
      sessionId={agentManager.currentSessionId}
      title={sessionTitle(agentManager.currentTitle)}
      onOpenChange={setShareDialogOpen}
    />
    <ToastContainer
      toasts={toasts}
      onDismiss={dismissToast}
      onClick={handleToastClick}
    />
    </>
  )
}

function App() {
  const shareRouteId = window.location.pathname.match(/^\/share\/([^/]+)\/?$/)?.[1]
  if (shareRouteId) return <SharedConversationPage shareId={decodeURIComponent(shareRouteId)} />
  return <MainApp />
}

export default App
