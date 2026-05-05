import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Api, Model } from '@mariozechner/pi-ai'
import {
  Plus,
  Settings,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScheduledTasksPage } from '@/components/scheduled-tasks/ScheduledTasksPage'
import { ProjectDirectoryPicker } from '@/components/project-directory-picker'
import { SkillsDialog } from '@/components/skills-dialog'
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
import { ToastContainer } from '@/components/ui/toast'

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
  const [needsModelSetup, setNeedsModelSetup] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState<RestoredDraft>()
  const [scheduledTasksOpen, setScheduledTasksOpen] = useState(false)
  const [skillsProject, setSkillsProject] = useState<ProjectInfo>()
  const { toasts, handleTaskComplete, dismissToast } = useTaskToasts()

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

  const { ready, startupError } = useAppBootstrap({
    storageRef,
    backendRef,
    activeModelRef,
    yoloModeRef,
    activeProjectRef,
    taskMapRef,
    loadGlobalSessions,
    loadProject,
    initYoloMode,
    switchActiveProject,
    createAgent,
    setNeedsModelSetup,
  })

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

  const handleSkillsSaved = useCallback((project: ProjectInfo, nextProjects: ProjectInfo[]) => {
    setProjects(nextProjects)
    setSkillsProject(project)
    if (activeProjectRef.current?.id === project.id) {
      setActiveProject(project)
      activeProjectRef.current = project
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
        onOpenProjectSkills={setSkillsProject}
        onDeleteProject={deleteProjectInline}
        onLoadSession={loadSession}
        onRenameSession={renameSession}
        onDeleteSession={deleteSession}
        onStartNewGlobalChat={startNewGlobalSession}
        onOpenScheduledTasks={() => setScheduledTasksOpen(true)}
        onToggleSidebar={() => setSidebarOpen((value) => !value)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={startNewGlobalChat} aria-label={t('newChat')}>
            <Plus className="size-4" />
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
            onClick={openDefaultOptionsSettings}
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
    <SkillsDialog
      open={Boolean(skillsProject)}
      project={skillsProject}
      onOpenChange={(open) => {
        if (!open) setSkillsProject(undefined)
      }}
      onSaved={handleSkillsSaved}
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
