import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { BackgroundTaskStatus } from '@/lib/types'
import {
  Ellipsis,
  Menu,
  PanelRight,
  Pencil,
  Pin,
  PinOff,
  Share2,
  SquareTerminal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProjectDirectoryPicker } from '@/components/project-directory-picker'
import { SkillsDialog } from '@/components/skills-dialog'
import { McpServersDialog } from '@/components/mcp-servers-dialog'
import {
  buildConnectionModel,
  DEFAULT_CONNECTION,
  initializePiStorage,
} from '@/lib/pi-chat'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type {
  AgentAccessMode,
  ProjectInfo,
  QuickForgeSessionMetadata,
  RestoredDraft,
  SkillsScope,
} from '@/lib/types'
import { sessionTitle } from '@/lib/types'
import type { ContextUsageDisplayInfo } from '@/components/chat/context-usage'
import { FirstUseGuideCard } from '@/components/chat/FirstUseGuideCard'
import { ModelSetupEmptyState } from '@/components/chat/ModelSetupEmptyState'
import { ChatSidebar } from '@/components/sidebar/ChatSidebar'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useProject } from '@/hooks/useProject'
import { useAgentAccessMode } from '@/hooks/useAgentAccessMode'
import { useCrossTabSync } from '@/hooks/useCrossTabSync'
import { useAgentManager } from '@/hooks/useAgentManager'
import { useSessionPagination } from '@/hooks/useSessionPagination'
import { useTaskToasts } from '@/hooks/useTaskToasts'
import { useAppBootstrap } from '@/hooks/useAppBootstrap'
import { useUpdateCheck } from '@/hooks/useUpdateCheck'
import { useModelActions } from '@/hooks/useModelActions'
import { useChatActions } from '@/hooks/useChatActions'
import { useProjectActions } from '@/hooks/useProjectActions'
import { useSessionActions } from '@/hooks/useSessionActions'
import { useAgentAccessActions } from '@/hooks/useAgentAccessActions'
import { useUIState } from '@/hooks/useUIState'
import { useVisibleRuntimeStatuses } from '@/hooks/useVisibleRuntimeStatuses'
import { HttpStorageBackend } from '@/lib/http-storage-backend'
import { logger } from '@/lib/logger'
import { showAlert, showConfirm } from '@/components/ui/confirm-dialog'
import { ToastContainer } from '@/components/ui/toast'
import { ShareConversationDialog } from '@/components/share/ShareConversationDialog'
import { getWorkspaceFile, resolveWorkspacePath } from '@/components/workspace/workspace-api'
import type { PendingTerminalCommand } from '@/components/terminal/terminal-api'
import { subscribeToAgentEvents } from '@/lib/server-agent'
import type { AiTurnArtifact } from '@/lib/tool-artifacts'
import { findBestPreviewableArtifact, isBrowserPreviewablePath, workspaceArtifactDiskPath } from '@/components/workspace/artifact-preview-utils'

// --- Code-split secondary views (only loaded when first opened) ---
// These are conditionally-mounted routes/panels; lazy loading keeps heavy
// dependencies out of the initial bundle. Props types are inferred.
const ChatPanelHost = lazy(() =>
  import('@/components/chat/ChatPanelHost').then((m) => ({ default: m.ChatPanelHost })),
)
const TerminalDock = lazy(() =>
  import('@/components/terminal/TerminalDock').then((m) => ({ default: m.TerminalDock })),
)
const ScheduledTasksPage = lazy(() =>
  import('@/components/scheduled-tasks/ScheduledTasksPage').then((m) => ({ default: m.ScheduledTasksPage })),
)
const AgentProfilesPage = lazy(() =>
  import('@/components/agent-profiles/AgentProfilesPage').then((m) => ({ default: m.AgentProfilesPage })),
)
const PluginsPage = lazy(() =>
  import('@/components/plugins/PluginsPage').then((m) => ({ default: m.PluginsPage })),
)
const SharedConversationPage = lazy(() =>
  import('@/components/share/SharedConversationPage').then((m) => ({ default: m.SharedConversationPage })),
)
const WorkspaceInspector = lazy(() =>
  import('@/components/workspace/WorkspaceInspector').then((m) => ({ default: m.WorkspaceInspector })),
)
const WorkspaceReaderDialog = lazy(() =>
  import('@/components/workspace/WorkspaceReaderDialog').then((m) => ({ default: m.WorkspaceReaderDialog })),
)

function LazyPanelFallback() {
  return <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">{t('loading')}</div>
}

function LazyOverlayFallback() {
  return null
}

type WorkspacePage = 'chat' | 'scheduledTasks' | 'agentProfiles' | 'plugins'

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

type ChannelWorkspace = {
  id?: unknown
  kind?: unknown
}

type ChannelStatusSnapshot = {
  status?: unknown
  launchWorkspace?: ChannelWorkspace | null
}

type ChannelRefreshEvent = {
  type?: unknown
  status?: unknown
  channels?: ChannelStatusSnapshot[]
  snapshot?: ChannelStatusSnapshot
}

type ExecuteMarkdownCommandEvent = CustomEvent<{
  command?: unknown
  confirm?: unknown
  dangerous?: unknown
}>

function isBackgroundTaskStatus(value: unknown): value is BackgroundTaskStatus {
  return value === 'idle' || value === 'running' || value === 'error' || value === 'aborted'
}

function isScheduledTaskNotification(event: Record<string, unknown>): event is ScheduledTaskNotificationEvent {
  return event.type === 'scheduled_task_notification'
}

function isScheduledTaskStarted(event: Record<string, unknown>): event is ScheduledTaskStartedEvent {
  return event.type === 'scheduled_task_started'
}

function isChannelActiveStatus(status: unknown) {
  return status === 'starting' || status === 'waiting_scan' || status === 'running' || status === 'stopping'
}

function channelEventHasActiveChannel(event: ChannelRefreshEvent) {
  if (Array.isArray(event.channels)) return event.channels.some((channel) => isChannelActiveStatus(channel.status))
  return isChannelActiveStatus(event.snapshot?.status) || isChannelActiveStatus(event.status)
}

function channelEventProjectIds(event: ChannelRefreshEvent) {
  const snapshots = [
    ...(Array.isArray(event.channels) ? event.channels : []),
    ...(event.snapshot ? [event.snapshot] : []),
  ]
  return snapshots
    .filter((snapshot) => isChannelActiveStatus(snapshot.status))
    .map((snapshot) => snapshot.launchWorkspace)
    .filter((workspace): workspace is ChannelWorkspace => workspace?.kind === 'project' && typeof workspace.id === 'string' && workspace.id.length > 0)
    .map((workspace) => workspace.id as string)
}

function MainApp() {
  // --- Top-level refs (owned by App) ---
  const storageRef = useRef<Awaited<ReturnType<typeof initializePiStorage>> | null>(null)
  const activeModelRef = useRef<Model<Api>>(buildConnectionModel(DEFAULT_CONNECTION))
  const agentAccessModeRef = useRef<AgentAccessMode>('default')
  const activeProjectRef = useRef<ProjectInfo | undefined>(undefined)
  const defaultWorkspaceRef = useRef<ProjectInfo | undefined>(undefined)

  // --- Project hook ---
  const {
    activeProject,
    projects,
    defaultWorkspace,
    expandedProjectIds,
    selectingProject,
    projectPickerOpen,
    loadProject,
    switchActiveProject,
    handleSelectProjectPath,
    selectProjectDirectory,
    setProjectPickerOpen,
    toggleProjectExpanded,
    toggleAllProjectsExpanded,
    reorderProjects,
    setActiveProject,
    setProjects,
    setExpandedProjectIds,
  } = useProject()

  // --- Agent access mode hook ---
  const { agentAccessMode, setAgentAccessMode, initialize: initAgentAccessMode } = useAgentAccessMode()

  // --- Pure UI state (sidebar, dialogs, overlays, inspector, reader) ---
  const ui = useUIState()
  const {
    setArtifactPreviewOpen,
    setWorkspaceInspectorOpen,
  } = ui

  // --- UI state shared with other hooks ---
  const [needsModelSetup, setNeedsModelSetup] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState<RestoredDraft>()
  const [workspacePage, setWorkspacePage] = useState<WorkspacePage>('chat')
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [pendingTerminalCommand, setPendingTerminalCommand] = useState<PendingTerminalCommand | null>(null)
  const [currentSessionArtifacts, setCurrentSessionArtifacts] = useState<AiTurnArtifact[]>([])
  const autoPreviewSignatureRef = useRef('')
  const [currentSessionHoverInfo, setCurrentSessionHoverInfo] = useState<(ContextUsageDisplayInfo & { sessionId?: string }) | undefined>()
  const [externalProjectIds, setExternalProjectIds] = useState<Set<string>>(() => new Set())
  const terminalCommandIdRef = useRef(0)
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof initializePiStorage>> | null>(null)
  const { toasts, handleTaskComplete, addToast, dismissToast } = useTaskToasts()
  const scheduledTasksOpen = workspacePage === 'scheduledTasks'
  const agentProfilesOpen = workspacePage === 'agentProfiles'
  const pluginsOpen = workspacePage === 'plugins'
  const workspacePageOpen = workspacePage !== 'chat'
  const closeWorkspacePage = useCallback(() => setWorkspacePage('chat'), [])

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
    externalProjectIds,
    onBroadcastSessionsChanged: notifySessionsChanged,
  })

  const crossTab = useCrossTabSync({
    onSessionsChanged: () => { refreshSessions() },
    onProjectsChanged: () => { loadProject() },
    onSettingsChanged: () => { refreshSessions() },
  })

  // --- Sync refs ---
  useEffect(() => {
    agentAccessModeRef.current = agentAccessMode
  }, [agentAccessMode])

  useEffect(() => {
    activeProjectRef.current = activeProject
  }, [activeProject])

  useEffect(() => {
    defaultWorkspaceRef.current = defaultWorkspace
  }, [defaultWorkspace])

  useEffect(() => { crossTabRef.current = crossTab }, [crossTab])

  const handleContextUsageDisplayChange = useCallback((sessionId: string, info: ContextUsageDisplayInfo) => {
    setCurrentSessionHoverInfo({ sessionId, ...info })
  }, [])

  // --- Agent manager ---
  const agentManager = useAgentManager({
    storageRef,
    activeModelRef,
    agentAccessModeRef,
    activeProjectRef,
    defaultWorkspaceRef,
    setAgentAccessMode,
    switchActiveProject,
    sessions: allLoadedSessions,
    refreshSessions,
    onTaskComplete: handleTaskComplete,
  })

  // Destructure stable values for use in dependency arrays
  const {
    createAgent,
    startDeferredSession,
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
      closeWorkspacePage()
      loadAgentSession(sessionId)
    },
    [closeWorkspacePage, loadAgentSession],
  )

  const restoreWorkspaceDraft = useCallback((text: string) => {
    if (!text.trim()) return
    closeWorkspacePage()
    setRestoredDraft({
      id: Date.now(),
      sessionId: agentRef.current?.sessionId,
      text,
    })
  }, [agentRef, closeWorkspacePage])

  const openWorkspaceGitChanges = useCallback(() => {
    if (!agentManager.currentToolProject?.id) return
    closeWorkspacePage()
    setArtifactPreviewOpen(false)
    ui.setWorkspacePanelView('changes')
    ui.setWorkspaceInspectorFocusTarget({ tab: 'git', nonce: Date.now() })
    ui.setWorkspaceInspectorOpen(true)
  }, [agentManager.currentToolProject?.id, closeWorkspacePage, setArtifactPreviewOpen, ui])

  const openLocalFilePathFromChat = useCallback(async (filePath: string) => {
    const projectId = agentManager.currentToolProject?.id
    if (!projectId) {
      addToast({ sessionId: agentManager.currentSessionId ?? '', title: '无法打开文件', status: 'error', message: '当前对话没有关联项目。' })
      return
    }

    ui.setInlineReaderOpen(true)
    ui.setInlineReaderLoading(true)
    ui.setInlineReaderError(undefined)
    ui.setInlineReaderFile(undefined)

    try {
      const resolved = await resolveWorkspacePath(projectId, filePath)
      const file = await getWorkspaceFile(projectId, resolved.relativePath)
      ui.setInlineReaderFile(file)
    } catch (error) {
      const message = error instanceof Error ? error.message : '打开文件失败'
      ui.setInlineReaderError(message)
      addToast({ sessionId: agentManager.currentSessionId ?? '', title: '无法打开文件', status: 'error', message })
    } finally {
      ui.setInlineReaderLoading(false)
    }
  }, [addToast, agentManager.currentSessionId, agentManager.currentToolProject?.id, ui])

  const openArtifactPreview = useCallback((path: string) => {
    const project = agentManager.currentToolProject
    const projectId = project?.id
    if (!projectId || !isBrowserPreviewablePath(path)) return
    closeWorkspacePage()
    setArtifactPreviewOpen(false)
    ui.setWebPreviewUrl(workspaceArtifactDiskPath(project.path, path))
    ui.setWorkspacePanelView('browser')
    setWorkspaceInspectorOpen(true)
  }, [agentManager.currentToolProject, closeWorkspacePage, setArtifactPreviewOpen, setWorkspaceInspectorOpen, ui])

  useEffect(() => {
    const project = agentManager.currentToolProject
    const projectId = project?.id
    if (!projectId) return
    const artifact = findBestPreviewableArtifact(currentSessionArtifacts)
    if (!artifact?.path) return
    // 签名纳入最新 toolCallId：同一次 present_files/write_file 的重复更新（同 toolCallId）被去重，
    // 但新的工具调用（新 toolCallId）能正常触发，避免「再次 present 同一文件」被永远拦截。
    const lastToolCallId = artifact.toolCallIds[artifact.toolCallIds.length - 1]
    const signature = `${projectId}:${artifact.path}:${artifact.defaultPreview ? 'default' : artifact.explicit ? 'explicit' : 'inferred'}:${lastToolCallId ?? ''}`
    if (signature === autoPreviewSignatureRef.current) return
    autoPreviewSignatureRef.current = signature
    queueMicrotask(() => {
      closeWorkspacePage()
      setArtifactPreviewOpen(false)
      if (artifact.kind === 'markdown' || artifact.kind === 'code') {
        // markdown/code 走侧栏 reader 渲染（openFileTab）：
        // markdown → MarkdownReader 富文本；code → MonacoCodeViewer 语法高亮。
        // 不走 browser iframe：iframe 加载这些类型只会显示源码或触发下载。
        ui.setWorkspacePanelView('files')
        ui.setWorkspaceInspectorFocusTarget({ tab: 'files', filePath: artifact.path, nonce: Date.now() })
      } else {
        // html/image 走 browser iframe：html 渲染交互页，image（含 svg/png/jpg…）直接显示。
        ui.setWebPreviewUrl(workspaceArtifactDiskPath(project.path, artifact.path))
        ui.setWorkspacePanelView('browser')
      }
      setWorkspaceInspectorOpen(true)
    })
  }, [agentManager.currentToolProject, closeWorkspacePage, currentSessionArtifacts, setArtifactPreviewOpen, setWorkspaceInspectorOpen, ui])

  useEffect(() => {
    autoPreviewSignatureRef.current = ''
    setArtifactPreviewOpen(false)
  }, [agentManager.currentToolProject?.id, setArtifactPreviewOpen])

  // 监听工具卡片预览按钮的桥接事件（事件名与 local-tools.ts 的 PREVIEW_ARTIFACT_EVENT 对应），
  // 转调 openArtifactPreview，复用与自动预览完全一致的逻辑。
  useEffect(() => {
    if (!openArtifactPreview) return
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string }>).detail
      if (detail && typeof detail.path === 'string') openArtifactPreview(detail.path)
    }
    window.addEventListener('quickforge:preview-artifact', handler as EventListener)
    return () => window.removeEventListener('quickforge:preview-artifact', handler as EventListener)
  }, [openArtifactPreview])

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
      if (event.type === 'agent_end' || event.type === 'title_updated' || event.type === 'session_forked') {
        void refreshSessions({ broadcast: true })
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

  const { ready, startupError, retryBootstrap } = useAppBootstrap({
    storageRef,
    backendRef,
    activeModelRef,
    agentAccessModeRef,
    activeProjectRef,
    setAgentAccessMode,
    taskMapRef,
    loadGlobalSessions,
    loadProject,
    initAgentAccessMode,
    switchActiveProject,
    createAgent,
    setNeedsModelSetup,
    onStorageReady: setStorage,
  })

  const updateCheck = useUpdateCheck(storageRef, ready)

  useEffect(() => {
    if (!ready) return undefined
    let lastRefreshAt = 0
    let pollTimer: number | undefined

    const refreshExternalSessions = (projectIds: string[] = []) => {
      const now = Date.now()
      if (projectIds.length > 0) {
        setExternalProjectIds((prev) => {
          const next = new Set(prev)
          for (const projectId of projectIds) next.add(projectId)
          return next
        })
      }
      if (now - lastRefreshAt < 5000) return
      lastRefreshAt = now
      void loadProject()
      void refreshSessions()
      for (const projectId of projectIds) void loadProjectSessions(projectId, 0)
    }

    const setPolling = (active: boolean) => {
      if (!active) {
        if (pollTimer) window.clearInterval(pollTimer)
        pollTimer = undefined
        return
      }
      if (pollTimer) return
      pollTimer = window.setInterval(refreshExternalSessions, 15000)
    }

    const source = new EventSource('/api/channels/events')
    const handleEvent = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as ChannelRefreshEvent
        const projectIds = channelEventProjectIds(payload)
        if (channelEventHasActiveChannel(payload)) {
          setPolling(true)
          refreshExternalSessions(projectIds)
        } else if (payload.type === 'snapshot' || payload.type === 'status') {
          setPolling(false)
        }
      } catch {
        // Ignore malformed channel events.
      }
    }

    source.addEventListener('snapshot', handleEvent)
    source.addEventListener('status', handleEvent)
    source.addEventListener('log', handleEvent)
    return () => {
      source.close()
      if (pollTimer) window.clearInterval(pollTimer)
    }
  }, [loadProject, loadProjectSessions, ready, refreshSessions])

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
    retryFromMessage,
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
    startDeferredSession,
    syncSessionUI,
    setCurrentAgentMessages,
    setChatPanelRevision,
    refreshSessions,
    needsModelSetup,
    switchActiveProject,
    closeWorkspacePage,
    setRestoredDraft,
  })

  const { deleteProjectInline } = useProjectActions({
    activeProjectRef,
    refreshSessions,
    notifyProjectsChanged: crossTab.notifyProjectsChanged,
    setActiveProject,
    setProjects,
    setExpandedProjectIds,
    setChatPanelRevision,
  })

  const { setAccessMode } = useAgentAccessActions({
    storageRef,
    agentAccessModeRef,
    setAgentAccessMode,
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
    togglePinSession,
    deleteSession,
    startNewGlobalSession,
  } = useSessionActions({
    storageRef,
    taskMapRef,
    currentSessionIdRef,
    loadAgentSession,
    setCurrentTitleRef,
    refreshSessions,
    closeWorkspacePage,
    startNewGlobalChat,
  })

  const {
    openModelSettings,
    openDefaultOptionsSettings,
    openAboutSettings,
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
    setSettingsDialogOpen: ui.setSettingsDialogOpen,
  })

  // --- Derived data ---
  const visibleSessions = useMemo(() => [
    ...globalSessions,
    ...projects.flatMap((project) => sessionsForProject(project.id)),
  ], [globalSessions, projects, sessionsForProject])
  const currentSessionMetadata = useMemo(() => {
    if (!agentManager.currentSessionId) return undefined
    return visibleSessions.find((session) => session.id === agentManager.currentSessionId)
  }, [agentManager.currentSessionId, visibleSessions])
  const currentSessionPinned = Boolean(currentSessionMetadata?.pinnedAt)
  const visibleRuntimeStatuses = useVisibleRuntimeStatuses(visibleSessions)

  const sessionTaskStatus = useCallback((session: QuickForgeSessionMetadata) => {
    return agentManager.taskStatuses[session.id]
      ?? visibleRuntimeStatuses[session.id]
      ?? session.taskStatus
      ?? 'idle'
  }, [agentManager.taskStatuses, visibleRuntimeStatuses])

  useEffect(() => {
    if (!ui.conversationMenuOpen) return
    const closeMenu = () => ui.setConversationMenuOpen(false)
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
    }
  }, [ui, ui.conversationMenuOpen])

  useEffect(() => {
    const handleExecuteMarkdownCommand = (event: Event) => {
      const detail = (event as ExecuteMarkdownCommandEvent).detail
      const command = typeof detail?.command === 'string' ? detail.command.trim() : ''
      if (!command) return

      const run = async () => {
        const requiresConfirm = Boolean(detail?.confirm || detail?.dangerous)
        if (requiresConfirm) {
          const confirmed = await showConfirm({
            title: t('confirmExecuteCommandTitle'),
            description: detail?.dangerous ? t('confirmExecuteDangerousCommand') : t('confirmExecuteMultipleCommands'),
            confirmLabel: t('executeInTerminal'),
            cancelLabel: t('cancel'),
            variant: detail?.dangerous ? 'destructive' : 'default',
          })
          if (!confirmed) return
        }

        setTerminalOpen(true)
        setPendingTerminalCommand({
          id: ++terminalCommandIdRef.current,
          command,
          execute: true,
        })
      }

      void run().catch((error) => {
        logger.error('Failed to execute markdown command:', error)
        void showAlert(error instanceof Error ? error.message : t('terminalCommandExecuteFailed'))
      })
    }

    window.addEventListener('quickforge:execute-markdown-command', handleExecuteMarkdownCommand)
    return () => window.removeEventListener('quickforge:execute-markdown-command', handleExecuteMarkdownCommand)
  }, [])

  const handlePendingTerminalCommandHandled = useCallback((id: number) => {
    setPendingTerminalCommand((current) => current?.id === id ? null : current)
  }, [])

  const handleDismissFirstUseGuide = useCallback(() => {
    ui.setFirstUseGuideDismissed(true)
  }, [ui])

  const handleCopyFirstGuidePrompt = useCallback(() => {
    const text = agentManager.currentToolProject?.id
      ? t('firstUseGuideProjectPrompt')
      : t('firstUseGuideGeneralPrompt')
    void navigator.clipboard.writeText(text)
      .then(() => addToast({
        sessionId: agentManager.currentSessionId ?? '',
        title: t('copied'),
        status: 'idle',
        message: text,
      }))
      .catch((error) => {
        logger.error('Failed to copy first-use guide prompt:', error)
        void showAlert(t('copyFailed'))
      })
  }, [addToast, agentManager.currentSessionId, agentManager.currentToolProject?.id])

  const showFirstUseGuide = Boolean(storage)
    && !ui.firstUseGuideDismissed
    && !terminalOpen
    && projects.length === 0
    && globalSessions.length === 0

  const handleToggleCurrentSessionPinned = useCallback(() => {
    const sessionId = agentManager.currentSessionId
    if (!sessionId) return
    ui.setConversationMenuOpen(false)
    void togglePinSession(sessionId)
  }, [agentManager.currentSessionId, togglePinSession, ui])

  const handleRenameCurrentSession = useCallback(() => {
    const sessionId = agentManager.currentSessionId
    if (!sessionId) return
    ui.setConversationMenuOpen(false)
    void renameSession(sessionId, agentManager.currentTitle)
  }, [agentManager.currentSessionId, agentManager.currentTitle, renameSession, ui])

  const handleShareCurrentSession = useCallback(() => {
    ui.setConversationMenuOpen(false)
    ui.setShareDialogOpen(true)
  }, [ui])

  // Stable UI setters used by the desktop sidebar handlers below.  Destructuring
  // them keeps the callbacks referentially stable (a useState setter never changes)
  // without dragging the whole `ui` object into the dependency array.
  const { setSkillsDialog, setMcpServersDialogOpen, setSidebarOpen } = ui

  const openGlobalSkills = useCallback(() => {
    setSkillsDialog({ scope: 'global' })
  }, [setSkillsDialog])

  const openProjectSkills = useCallback((project: ProjectInfo) => {
    setSkillsDialog({ scope: 'project', project })
  }, [setSkillsDialog])

  const openProjectInExplorer = useCallback(async (project: ProjectInfo) => {
    const response = await fetch(`/api/project/${encodeURIComponent(project.id)}/open-in-explorer`, {
      method: 'POST',
    })
    if (response.ok) return
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || t('openInExplorerFailed'))
  }, [])

  // --- Desktop sidebar handlers (stable; do not auto-close the sidebar) ---
  // Kept separate from the mobile `*FromSidebar` handlers so the memoized desktop
  // <ChatSidebar> does not re-render on unrelated App state changes.
  const openMcpServers = useCallback(() => {
    setMcpServersDialogOpen(true)
  }, [setMcpServersDialogOpen])

  const openProjectInExplorerWithFeedback = useCallback((project: ProjectInfo) => {
    void openProjectInExplorer(project).catch((error) => {
      logger.error('Failed to open project in explorer:', error)
      void showAlert(error instanceof Error ? error.message : t('openInExplorerFailed'))
    })
  }, [openProjectInExplorer])

  const openScheduledTasks = useCallback(() => setWorkspacePage('scheduledTasks'), [setWorkspacePage])
  const openAgentProfiles = useCallback(() => setWorkspacePage('agentProfiles'), [setWorkspacePage])
  const openPlugins = useCallback(() => setWorkspacePage('plugins'), [setWorkspacePage])
  const toggleSidebar = useCallback(() => setSidebarOpen((value) => !value), [setSidebarOpen])

  const closeMobileSidebar = useCallback(() => {
    ui.setMobileSidebarOpen(false)
  }, [ui])

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
    setWorkspacePage('scheduledTasks')
  }, [closeMobileSidebar])

  const openAgentProfilesFromSidebar = useCallback(() => {
    closeMobileSidebar()
    setWorkspacePage('agentProfiles')
  }, [closeMobileSidebar])

  const openGlobalSkillsFromSidebar = useCallback(() => {
    closeMobileSidebar()
    openGlobalSkills()
  }, [closeMobileSidebar, openGlobalSkills])

  const openMcpServersFromSidebar = useCallback(() => {
    closeMobileSidebar()
    ui.setMcpServersDialogOpen(true)
  }, [closeMobileSidebar, ui])

  const openProjectSkillsFromSidebar = useCallback((project: ProjectInfo) => {
    closeMobileSidebar()
    openProjectSkills(project)
  }, [closeMobileSidebar, openProjectSkills])

  const handleSkillsSaved = useCallback((payload: { scope: SkillsScope; project?: ProjectInfo; projects?: ProjectInfo[] }) => {
    if (payload.scope === 'project' && payload.project && payload.projects) {
      setProjects(payload.projects)
      ui.setSkillsDialog({ scope: 'project', project: payload.project })
      if (activeProjectRef.current?.id === payload.project.id) {
        setActiveProject(payload.project)
        activeProjectRef.current = payload.project
      }
      crossTab.notifyProjectsChanged()
      return
    }

    crossTab.notifyProjectsChanged()
  }, [crossTab, setActiveProject, setProjects, ui])

  // Shared Suspense fallback for code-split secondary pages.
  const pageSuspenseFallback = (
    <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
      {t('loadingChatWorkspace')}
    </div>
  )

  // --- Loading state ---
  if (startupError) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="max-w-md rounded-lg border border-border bg-background p-5 text-center">
          <h1 className="text-base font-semibold">{t('localServiceUnavailableTitle')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{startupError}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={retryBootstrap}>
              {t('retry')}
            </Button>
            <Button variant="default" size="sm" onClick={() => window.location.reload()}>
              {t('reloadPage')}
            </Button>
          </div>
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
    {!ui.settingsDialogOpen && (
    <div
      className="fixed right-2 top-2 z-[60] flex items-center gap-1"
      aria-label={t('workspacePanel')}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setTerminalOpen((value) => !value)}
        disabled={workspacePageOpen || needsModelSetup}
        aria-label="终端"
        title="终端"
        className={terminalOpen ? 'bg-accent text-accent-foreground' : undefined}
      >
        <SquareTerminal className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          setArtifactPreviewOpen(false)
          ui.setWorkspaceInspectorOpen((value) => !value)
        }}
        disabled={!agentManager.currentToolProject?.id || workspacePageOpen || needsModelSetup}
        aria-label={ui.workspaceInspectorOpen ? t('workspaceCollapseRightPanel') : t('workspaceExpandRightPanel')}
        title={ui.workspaceInspectorOpen ? t('workspaceCollapseRightPanel') : t('workspaceExpandRightPanel')}
        className={cn(
          'hidden lg:inline-flex',
          ui.workspaceInspectorOpen ? 'bg-accent text-accent-foreground' : undefined,
        )}
      >
        <PanelRight className="size-4" />
      </Button>
    </div>
    )}
    <div className="flex h-screen min-h-0 bg-background text-foreground">
      <ChatSidebar
        sidebarOpen={ui.sidebarOpen}
        scheduledTasksActive={scheduledTasksOpen}
        agentProfilesActive={agentProfilesOpen}
        pluginsActive={pluginsOpen}
        projectsCollapsed={ui.projectsCollapsed}
        conversationsCollapsed={ui.conversationsCollapsed}
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
        onToggleProjectsCollapsed={ui.toggleProjectsCollapsed}
        onToggleConversationsCollapsed={ui.toggleConversationsCollapsed}
        onToggleProjectExpanded={toggleProjectExpanded}
        onToggleAllProjectsExpanded={toggleAllProjectsExpanded}
        onReorderProjects={reorderProjects}
        onSelectProjectDirectory={selectProjectDirectory}
        onStartNewProjectChat={startNewProjectChat}
        onOpenGlobalSkills={openGlobalSkills}
        onOpenMcpServers={openMcpServers}
        onOpenProjectSkills={openProjectSkills}
        onOpenProjectInExplorer={openProjectInExplorerWithFeedback}
        onDeleteProject={deleteProjectInline}
        onLoadSession={loadSession}
        onTogglePinSession={togglePinSession}
        onRenameSession={renameSession}
        onDeleteSession={deleteSession}
        onStartNewGlobalChat={startNewGlobalSession}
        onOpenScheduledTasks={openScheduledTasks}
        onOpenAgentProfiles={openAgentProfiles}
        onOpenPlugins={openPlugins}
        onOpenSettings={openDefaultOptionsSettings}
        updateAvailable={updateCheck.result.updateAvailable}
        latestVersion={updateCheck.result.latestVersion}
        currentVersion={updateCheck.result.currentVersion}
        onOpenUpdate={openAboutSettings}
        onDismissUpdate={updateCheck.dismissUpdate}
        onToggleSidebar={toggleSidebar}
        currentSessionHoverInfo={currentSessionHoverInfo}
      />

      {ui.mobileSidebarOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-background/65 backdrop-blur-sm"
            onClick={closeMobileSidebar}
            aria-label={t('toggleSidebar')}
          />
          <div className="absolute inset-y-0 left-0 max-w-[85vw] shadow-quickforge">
            <ChatSidebar
              variant="mobile"
              sidebarOpen
              scheduledTasksActive={scheduledTasksOpen}
              agentProfilesActive={agentProfilesOpen}
              pluginsActive={pluginsOpen}
              projectsCollapsed={ui.projectsCollapsed}
              conversationsCollapsed={ui.conversationsCollapsed}
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
              onToggleProjectsCollapsed={ui.toggleProjectsCollapsed}
              onToggleConversationsCollapsed={ui.toggleConversationsCollapsed}
              onToggleProjectExpanded={toggleProjectExpanded}
              onToggleAllProjectsExpanded={toggleAllProjectsExpanded}
              onReorderProjects={reorderProjects}
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
                  void showAlert(error instanceof Error ? error.message : t('openInExplorerFailed'))
                })
              }}
              onDeleteProject={deleteProjectInline}
              onLoadSession={loadSessionFromSidebar}
              onTogglePinSession={togglePinSession}
              onRenameSession={renameSession}
              onDeleteSession={deleteSession}
              onStartNewGlobalChat={startNewGlobalSessionFromSidebar}
              onOpenScheduledTasks={openScheduledTasksFromSidebar}
              onOpenAgentProfiles={openAgentProfilesFromSidebar}
              onOpenPlugins={() => {
                closeMobileSidebar()
                setWorkspacePage('plugins')
              }}
              onOpenSettings={() => {
                closeMobileSidebar()
                openDefaultOptionsSettings()
              }}
              updateAvailable={updateCheck.result.updateAvailable}
              latestVersion={updateCheck.result.latestVersion}
              currentVersion={updateCheck.result.currentVersion}
              onOpenUpdate={() => {
                closeMobileSidebar()
                openAboutSettings()
              }}
              onDismissUpdate={updateCheck.dismissUpdate}
              onToggleSidebar={closeMobileSidebar}
              currentSessionHoverInfo={currentSessionHoverInfo}
            />
          </div>
        </div>
      ) : null}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 pr-20">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => ui.setMobileSidebarOpen(true)} aria-label={t('toggleSidebar')}>
            <Menu className="size-4" />
          </Button>

          <div className="min-w-0 flex-1">
            {scheduledTasksOpen ? (
              <>
                <div className="truncate text-xs text-muted-foreground">AI Workspace</div>
                <div className="truncate text-sm font-medium">{t('scheduledTasks')}</div>
              </>
            ) : agentProfilesOpen ? (
              <>
                <div className="truncate text-xs text-muted-foreground">AI Workspace</div>
                <div className="truncate text-sm font-medium">{t('agentsTab')}</div>
              </>
            ) : pluginsOpen ? (
              <>
                <div className="truncate text-xs text-muted-foreground">AI Workspace</div>
                <div className="truncate text-sm font-medium">{t('plugins')}</div>
              </>
            ) : (
              <div className="flex max-w-full min-w-0 items-center">
                {agentManager.currentToolProject?.name ? (
                  <>
                    <div className="min-w-0 truncate text-sm text-muted-foreground/60">{agentManager.currentToolProject.name}</div>
                    <div className="mx-1 shrink-0 text-sm text-muted-foreground/45">/</div>
                  </>
                ) : null}
                <div className="min-w-0 truncate text-sm font-medium text-foreground/90">{sessionTitle(agentManager.currentTitle)}</div>
                <div className="relative ml-0.5 shrink-0" onClick={(event) => event.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={() => ui.setConversationMenuOpen((value) => !value)}
                    disabled={!agentManager.currentSessionId || needsModelSetup}
                    aria-label={t('moreOptions')}
                    aria-expanded={ui.conversationMenuOpen}
                  >
                    <Ellipsis className="size-4" />
                  </Button>
                  {ui.conversationMenuOpen ? (
                    <div className="absolute left-0 top-8 z-30 min-w-44 rounded-lg border border-border bg-popover p-1 shadow-quickforge">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm text-foreground/86 transition-colors hover:bg-muted"
                        onClick={handleToggleCurrentSessionPinned}
                      >
                        {currentSessionPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                        <span>{currentSessionPinned ? t('unpinSession') : t('pinSession')}</span>
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm text-foreground/86 transition-colors hover:bg-muted"
                        onClick={handleRenameCurrentSession}
                      >
                        <Pencil className="size-4" />
                        <span>{t('renameSession')}</span>
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm text-foreground/86 transition-colors hover:bg-muted"
                        onClick={handleShareCurrentSession}
                      >
                        <Share2 className="size-4" />
                        <span>{t('shareSession')}</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>

        </header>

        <section className="relative flex min-h-0 flex-1 flex-col">
          {scheduledTasksOpen ? (
              <Suspense fallback={pageSuspenseFallback}>
                <ScheduledTasksPage onOpenSession={handleToastClick} />
              </Suspense>
            ) : agentProfilesOpen ? (
              <Suspense fallback={pageSuspenseFallback}>
                <AgentProfilesPage />
              </Suspense>
            ) : pluginsOpen ? (
              <Suspense fallback={pageSuspenseFallback}>
                <PluginsPage />
              </Suspense>
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
                    <Suspense fallback={<LazyPanelFallback />}>
                    <ChatPanelHost
                      agent={agentManager.agent}
                      onModelSelect={openCustomModelSelector}
                      revision={agentManager.chatPanelRevision}
                      agentAccessMode={agentAccessMode}
                      workspaceToolsEnabled={Boolean(agentManager.currentToolProject?.id)}
                      project={agentManager.currentToolProject}
                      projectId={agentManager.currentToolProject?.id}
                      chatScope={agentManager.chatScope}
                      storage={storage}
                      onAccessModeChange={setAccessMode}
                      onRollbackFromMessage={rollbackFromMessage}
                      onRetryFromMessage={retryFromMessage}
                      onCopyAnswer={copyAnswer}
                      onForkFromMessage={forkFromMessage}
                      onApproveToolCall={handleApproveToolCall}
                      onRejectToolCall={handleRejectToolCall}
                      onApproveAutoCompact={handleApproveAutoCompact}
                      onRejectAutoCompact={handleRejectAutoCompact}
                      onOpenWorkspaceGitChanges={openWorkspaceGitChanges}
                      onOpenLocalFilePath={openLocalFilePathFromChat}
                      onArtifactsChange={setCurrentSessionArtifacts}
                      onContextUsageDisplayChange={handleContextUsageDisplayChange}
                      disableFork={false}
                      restoredDraft={restoredDraft}
                    />
                    </Suspense>
                  </ErrorBoundary>
                </div>
                {showFirstUseGuide ? (
                  <FirstUseGuideCard
                    hasProject={Boolean(agentManager.currentToolProject?.id)}
                    onConfigureModel={openModelSettings}
                    onAddProject={selectProjectDirectory}
                    onCopyExamplePrompt={handleCopyFirstGuidePrompt}
                    onDismiss={handleDismissFirstUseGuide}
                  />
                ) : null}
                {terminalOpen ? (
                  <Suspense fallback={null}>
                    <TerminalDock
                      project={agentManager.currentToolProject}
                      pendingCommand={pendingTerminalCommand}
                      onPendingCommandHandled={handlePendingTerminalCommandHandled}
                      onCollapse={() => setTerminalOpen(false)}
                    />
                  </Suspense>
                ) : null}
              </>
          )}
        </section>
      </main>
      {ui.workspaceInspectorOpen && agentManager.currentToolProject?.id ? (
        <Suspense fallback={<LazyOverlayFallback />}>
          <WorkspaceInspector
            project={agentManager.currentToolProject}
            open
            view={ui.workspacePanelView}
            onViewChange={ui.setWorkspacePanelView}
            onPreviewArtifact={openArtifactPreview}
            onDraftRequest={restoreWorkspaceDraft}
            focusTarget={ui.workspaceInspectorFocusTarget}
            previewUrl={ui.webPreviewUrl}
            onPreviewUrlChange={ui.setWebPreviewUrl}
            artifacts={currentSessionArtifacts}
          />
        </Suspense>
      ) : null}
      {ui.inlineReaderOpen ? (
        <Suspense fallback={<LazyOverlayFallback />}>
          <WorkspaceReaderDialog
            open
            mode="file"
            file={ui.inlineReaderFile}
            loading={ui.inlineReaderLoading}
            error={ui.inlineReaderError}
            onOpenChange={ui.setInlineReaderOpen}
            onDraftRequest={restoreWorkspaceDraft}
          />
        </Suspense>
      ) : null}
    </div>
    <ProjectDirectoryPicker
      open={projectPickerOpen}
      initialPath={activeProject?.path}
      disabled={selectingProject}
      onOpenChange={setProjectPickerOpen}
      onSelect={handleSelectProjectPath}
    />
    <SkillsDialog
      open={Boolean(ui.skillsDialog)}
      scope={ui.skillsDialog?.scope ?? 'global'}
      project={ui.skillsDialog?.project}
      onOpenChange={(open) => {
        if (!open) ui.setSkillsDialog(undefined)
      }}
      onSaved={handleSkillsSaved}
    />
    <McpServersDialog
      open={ui.mcpServersDialogOpen}
      onOpenChange={ui.setMcpServersDialogOpen}
    />
    <ShareConversationDialog
      open={ui.shareDialogOpen}
      sessionId={agentManager.currentSessionId}
      title={sessionTitle(agentManager.currentTitle)}
      onOpenChange={ui.setShareDialogOpen}
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
  if (shareRouteId) {
    return (
      <Suspense fallback={<div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">{t('loadingChatWorkspace')}</div>}>
        <SharedConversationPage shareId={decodeURIComponent(shareRouteId)} />
      </Suspense>
    )
  }
  return <MainApp />
}

export default App
