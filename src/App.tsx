import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { BackgroundTaskStatus } from '@/lib/types'
import {
  Archive,
  ChevronDown,
  Copy,
  Ellipsis,
  Folder,
  GitBranch,
  Info,
  LogOut,
  Menu,
  MessageCircle,
  PanelRight,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Share2,
  SquareTerminal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProjectDirectoryPicker } from '@/components/project-directory-picker'
import { ProjectOpenMenu } from '@/components/project/ProjectOpenMenu'
import { SkillsDialog } from '@/components/skills-dialog'
import { MigrationProgressView } from '@/components/migration-progress-view'
import { StartupSplashIcon } from '@/components/startup-splash-icon'
import {
  buildConnectionModel,
  DEFAULT_CONNECTION,
  initializePiStorage,
} from '@/lib/pi-chat'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  OPEN_SUBAGENT_RUN_EVENT,
  normalizeOpenSubagentRunRequest,
} from '@/lib/subagent-run-detail'
import type {
  AgentAccessMode,
  AgentHarness,
  ProjectInfo,
  QuickForgeSessionMetadata,
  RestoredDraft,
  SidebarSessionSortMode,
  SidebarSessionViewMode,
  SkillsScope,
} from '@/lib/types'
import { sessionTitle } from '@/lib/types'
import { isSameContextUsageDisplayInfo, type ContextUsageDisplayInfo } from '@/components/chat/context-usage'
import { FirstUseGuideCard } from '@/components/chat/FirstUseGuideCard'
import { ChatConversationSurface } from '@/components/chat/ChatConversationSurface'
import { ModelSetupEmptyState } from '@/components/chat/ModelSetupEmptyState'
import { NewChatProjectPicker } from '@/components/chat/NewChatProjectPicker'
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
import { useCloudModels } from '@/hooks/useCloudModels'
import { useChatActions } from '@/hooks/useChatActions'
import { useProjectActions } from '@/hooks/useProjectActions'
import { useSessionActions } from '@/hooks/useSessionActions'
import { useAgentAccessActions } from '@/hooks/useAgentAccessActions'
import { useUIState } from '@/hooks/useUIState'
import { useWorkspaceInspectorOpenState } from '@/hooks/useWorkspaceInspectorOpenState'
import { useVisibleRuntimeStatuses } from '@/hooks/useVisibleRuntimeStatuses'
import { HttpStorageBackend } from '@/lib/http-storage-backend'
import { ServerAgent } from '@/lib/server-agent'
import { logger } from '@/lib/logger'
import { scheduleAfterPaint } from '@/lib/schedule-after-paint'
import { TUNNEL_RECOVERED_EVENT, type TunnelRecoveredEventDetail } from '@/lib/tunnel-recovery'
import {
  loadSidebarSectionOrder,
  reorderSidebarSections,
  saveSidebarSectionOrder,
  type SidebarSectionId,
  type SidebarSectionOrder,
} from '@/lib/sidebar-section-order'
import {
  loadSidebarSessionSortMode,
  loadSidebarSessionViewMode,
  saveSidebarSessionSortMode,
  saveSidebarSessionViewMode,
} from '@/lib/sidebar-session-sort-mode'
import { getDeletedProjectRecoveryDecision } from '@/lib/deleted-project-recovery'
import { isCurrentProjectRequest } from '@/lib/project-request-guard'
import { shouldRefreshTitleGitStatusOnToolEnd } from '@/lib/title-git-status-refresh'
import { showAlert, showConfirm } from '@/components/ui/confirm-dialog'
import { ToastContainer } from '@/components/ui/toast'
import { GitBranchMenu } from '@/components/git/GitBranchMenu'
import { GitCommitPushDialog } from '@/components/git/GitCommitPushDialog'
import { GitToolsPinnedSummary } from '@/components/git/GitToolsPinnedSummary'
import { GitGraphDialog } from '@/components/git/GitGraphDialog'
import { ShareConversationDialog } from '@/components/share/ShareConversationDialog'
import { checkoutGitBranch, getGitStatus, resolveWorkspacePath } from '@/components/workspace/workspace-api'
import {
  shouldHandleWorkspaceInspectorRequest,
  workspaceInspectorRuntimeScopeMatches,
} from '@/components/workspace/workspace-inspector-request'
import type { GitStatusResponse, WorkspaceInspectorOpenRequestInput, WorkspaceInspectorRuntimeScope } from '@/components/workspace/workspace-types'
import { SideChatAgent } from '@/components/workspace/side-chat-agent'
import type { PendingTerminalCommand } from '@/components/terminal/terminal-api'
import { subscribeToAgentEvents } from '@/lib/server-agent'
import type { AiTurnArtifact } from '@/lib/tool-artifacts'
import { artifactPreviewMode, findBestPreviewableArtifact, workspaceArtifactDiskPath } from '@/components/workspace/artifact-preview-utils'
import { MobileServerConnectPage } from '@/components/mobile/MobileServerConnectPage'
import { RemoteTunnelOverlay } from '@/components/mobile/RemoteTunnelOverlay'
import { isCloudTunnelClient, isMobileShell, isNativeMobileEntry, isRemoteQuickForgeClient, openMobileServerPicker, readMobileServerAliasFromUrl } from '@/lib/mobile-server'
import { initializeSystemNotifications, showTaskSystemNotification } from '@/lib/system-notifications'
import { resolveChatHarnessCapabilities } from '@/lib/chat-harness-capabilities'

// --- Code-split secondary views (only loaded when first opened) ---
// These are conditionally-mounted routes/panels; lazy loading keeps heavy
// dependencies out of the initial bundle. Props types are inferred.
const ChatPanelHost = lazy(() =>
  import('@/components/chat/ChatPanelHost').then((m) => ({ default: m.ChatPanelHost })),
)
const SharedConversationPage = lazy(() =>
  import('@/components/share/SharedConversationPage').then((m) => ({ default: m.SharedConversationPage })),
)
const WorkspaceInspector = lazy(() =>
  import('@/components/workspace/WorkspaceInspector').then((m) => ({ default: m.WorkspaceInspector })),
)
const TerminalDock = lazy(() =>
  import('@/components/terminal/TerminalDock').then((m) => ({ default: m.TerminalDock })),
)
const SettingsWorkspacePage = lazy(() =>
  import('@/components/settings/SettingsWorkspacePage').then((m) => ({ default: m.SettingsWorkspacePage })),
)

const AUTO_PREVIEW_SEEN_STORAGE_KEY = 'quickforge:auto-preview-seen-signatures'
const MAX_AUTO_PREVIEW_SEEN_SIGNATURES = 200
const QUICKFORGE_RELEASES_URL = 'https://github.com/shawnstack/quickforge/releases/latest'
const STARTUP_SPLASH_MIN_DURATION_MS = 1350
const STARTUP_SPLASH_EXIT_DURATION_MS = 280
const CONVERSATION_TRANSITION_DURATION_MS = 280

function readSeenAutoPreviewSignatures() {
  if (typeof window === 'undefined') return new Set<string>()
  try {
    const raw = window.sessionStorage.getItem(AUTO_PREVIEW_SEEN_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : undefined
    if (!Array.isArray(parsed)) return new Set<string>()
    return new Set(parsed.filter((value): value is string => typeof value === 'string' && value.length > 0))
  } catch {
    return new Set<string>()
  }
}

function hasSeenAutoPreviewSignature(signature: string) {
  return readSeenAutoPreviewSignatures().has(signature)
}

function rememberAutoPreviewSignature(signature: string) {
  if (typeof window === 'undefined') return
  try {
    const signatures = [...readSeenAutoPreviewSignatures(), signature].slice(-MAX_AUTO_PREVIEW_SEEN_SIGNATURES)
    window.sessionStorage.setItem(AUTO_PREVIEW_SEEN_STORAGE_KEY, JSON.stringify(signatures))
  } catch {
    // Ignore storage failures (private mode/quota/etc.); in-memory de-dupe still applies.
  }
}

function LazyPanelFallback() {
  return <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">{t('loading')}</div>
}

function LazyOverlayFallback() {
  return null
}

function StartupSplash({ exiting = false }: { exiting?: boolean }) {
  const label = t('loadingChatWorkspace')

  return (
    <div className={cn('quickforge-startup-splash', exiting && 'quickforge-startup-splash-exit')} role="status" aria-label={label}>
      <StartupSplashIcon />
      <span className="sr-only">{label}</span>
    </div>
  )
}

function ConversationLoadingScreen({ exiting = false }: { exiting?: boolean }) {
  const label = t('loadingConversation')

  return (
    <div className={cn('quickforge-conversation-loading', exiting && 'quickforge-conversation-loading-exit')} role="status" aria-live="polite" aria-label={label}>
      <div className="quickforge-conversation-loading-status" aria-hidden="true">
        <span>{label}</span>
        <span className="quickforge-conversation-loading-dots">
          <span>•</span>
          <span>•</span>
          <span>•</span>
        </span>
      </div>
      <div className="quickforge-conversation-loading-track" aria-hidden="true">
        <div className="quickforge-conversation-loading-runner" />
      </div>
      <span className="quickforge-conversation-loading-helper" aria-hidden="true">{t('loadingConversationPreparing')}</span>
    </div>
  )
}

type ScheduledTaskNotificationEvent = {
  type?: unknown
  runId?: unknown
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

type ChannelRefreshEvent = {
  type?: unknown
  sessionId?: unknown
  projectId?: unknown
  workspace?: ChannelWorkspace | null
  metadata?: QuickForgeSessionMetadata
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

function channelEventProjectId(event: ChannelRefreshEvent) {
  if (event.workspace?.kind === 'project' && typeof event.workspace.id === 'string' && event.workspace.id.length > 0) {
    return event.workspace.id
  }
  return typeof event.projectId === 'string' && event.projectId.length > 0 ? event.projectId : undefined
}

function MainApp() {
  const remoteClient = isRemoteQuickForgeClient()
  const cloudTunnelClient = isCloudTunnelClient()
  const mobileShell = isMobileShell()
  const cloudModels = useCloudModels(true)
  const mobileServerUrl = mobileShell ? window.location.origin : undefined
  const mobileServerAlias = mobileShell ? readMobileServerAliasFromUrl() : undefined
  // 远程客户端（云隧道 / 局域网直连）侧边栏“返回连接页”入口：云隧道回云账户设备，直连回局域网服务器。
  const openServerPicker = () => openMobileServerPicker(cloudTunnelClient ? 'cloud' : 'servers')
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
    setWorkspaceInspectorRequest,
  } = ui

  // --- UI state shared with other hooks ---
  const [needsModelSetup, setNeedsModelSetup] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState<RestoredDraft>()
  const [desktopTitlebarMenuOpen, setDesktopTitlebarMenuOpen] = useState(false)
  const [pendingTerminalCommand, setPendingTerminalCommand] = useState<PendingTerminalCommand | null>(null)
  const [terminalDockOpen, setTerminalDockOpen] = useState(false)
  const [workspaceInspectorFullscreen, setWorkspaceInspectorFullscreen] = useState(false)
  const [sideChatTabOpen, setSideChatTabOpen] = useState(false)
  const [sideChatAgent] = useState(() => new SideChatAgent({ model: buildConnectionModel(DEFAULT_CONNECTION) }))
  const [sideChatRevision, setSideChatRevision] = useState(0)
  const bumpSideChatRevision = useCallback(() => setSideChatRevision((value) => value + 1), [])
  const sideChatDraftRef = useRef('')
  const sideChatInputMemory = useMemo(() => ({
    get: () => sideChatDraftRef.current,
    set: (text: string) => {
      sideChatDraftRef.current = text
    },
  }), [])
  const [currentSessionArtifactsState, setCurrentSessionArtifactsState] = useState<{
    projectId?: string
    sessionId?: string
    artifacts: AiTurnArtifact[]
  }>({ artifacts: [] })
  const [sidebarSectionOrder, setSidebarSectionOrder] = useState<SidebarSectionOrder>(loadSidebarSectionOrder)
  const [sidebarSessionViewMode, setSidebarSessionViewMode] = useState<SidebarSessionViewMode>(
    loadSidebarSessionViewMode,
  )
  const [sidebarSessionSortMode, setSidebarSessionSortMode] = useState<SidebarSessionSortMode>(
    loadSidebarSessionSortMode,
  )
  // 用户在新对话空状态主动清除项目预选后，本次空状态内不再默认预选上次激活的项目。
  const [emptyStateProjectDismissed, setEmptyStateProjectDismissed] = useState(false)
  const wasNewChatEmptyStateRef = useRef(false)
  const autoPreviewSignatureRef = useRef('')
  const [currentSessionHoverInfo, setCurrentSessionHoverInfo] = useState<(ContextUsageDisplayInfo & { sessionId?: string }) | undefined>()
  const [titleGitStatus, setTitleGitStatus] = useState<GitStatusResponse | undefined>()
  const titleGitRequestIdRef = useRef(0)
  const currentToolProjectIdRef = useRef<string | undefined>(undefined)
  const workspaceInspectorScopeRef = useRef<WorkspaceInspectorRuntimeScope>({
    projectId: 'global-workspace',
    runtimeScopeId: '',
  })
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [gitToolsExpanded, setGitToolsExpanded] = useState(false)
  const [gitCommitDialogOpen, setGitCommitDialogOpen] = useState(false)
  const [gitGraphOpen, setGitGraphOpen] = useState(false)
  const [externalProjectIds, setExternalProjectIds] = useState<Set<string>>(() => new Set())
  const terminalCommandIdRef = useRef(0)
  const workspaceInspectorRequestIdRef = useRef(0)
  const chatFileRequestIdRef = useRef(0)
  const sessionTransitionTokenRef = useRef(0)
  const pendingSessionLoadCancelRef = useRef<(() => void) | undefined>(undefined)
  const recoveringDeletedToolProjectIdRef = useRef<string | undefined>(undefined)
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof initializePiStorage>> | null>(null)
  const [startupSplashDone, setStartupSplashDone] = useState(false)
  const [startupSplashExited, setStartupSplashExited] = useState(false)
  const [visibleLoadingSessionId, setVisibleLoadingSessionId] = useState<string>()
  const visibleLoadingSessionIdRef = useRef<string | undefined>(undefined)
  const [renderedLoadingSessionId, setRenderedLoadingSessionId] = useState<string>()
  const { toasts, handleTaskComplete: addTaskCompletionToast, addToast, dismissToast } = useTaskToasts()
  const handleTaskComplete = useCallback((sessionId: string, title: string, status: BackgroundTaskStatus) => {
    addTaskCompletionToast(sessionId, title, status)
    void showTaskSystemNotification({
      key: `agent:${sessionId}:${status}`,
      sessionId,
      title,
      status,
    })
  }, [addTaskCompletionToast])
  const closeWorkspacePage = useCallback(() => undefined, [])
  const closeDesktopTitlebarMenu = useCallback(() => setDesktopTitlebarMenuOpen(false), [])
  const openDesktopUpdatePage = useCallback(() => {
    setDesktopTitlebarMenuOpen(false)
    window.open(QUICKFORGE_RELEASES_URL, '_blank', 'noopener,noreferrer')
  }, [])
  const exitDesktopApp = useCallback(() => {
    setDesktopTitlebarMenuOpen(false)
    window.open('quickforge://exit', '_blank', 'noopener,noreferrer')
  }, [])

  const handleSidebarSectionReorder = useCallback((activeId: SidebarSectionId, overId: SidebarSectionId) => {
    setSidebarSectionOrder((current) => reorderSidebarSections(current, activeId, overId))
  }, [])

  useEffect(() => {
    saveSidebarSectionOrder(sidebarSectionOrder)
  }, [sidebarSectionOrder])

  useEffect(() => {
    saveSidebarSessionViewMode(sidebarSessionViewMode)
  }, [sidebarSessionViewMode])

  useEffect(() => {
    saveSidebarSessionSortMode(sidebarSessionSortMode)
  }, [sidebarSessionSortMode])

  // --- Session list + cross-tab sync ---
  const crossTabRef = useRef<ReturnType<typeof useCrossTabSync> | null>(null)
  const applyDefaultHarnessRef = useRef<((harness?: AgentHarness) => Promise<boolean>) | null>(null)

  const backendRef = useRef<HttpStorageBackend | null>(null)
  const notifySessionsChanged = useCallback(() => crossTabRef.current?.notifySessionsChanged(), [])

  const {
    allLoadedSessions,
    pinnedSessions,
    pinnedHasMore,
    pinnedLoading,
    globalSessions,
    sessionsForProject,
    globalHasMore,
    projectTimelineSessions,
    projectTimelineHasMore,
    projectTimelineLoading,
    projectHasMore,
    globalLoading,
    projectLoading,
    projectLoaded,
    loadGlobalSessions,
    loadProjectSessions,
    refreshSessions,
    upsertSessionMetadata,
    updateSessionTitle,
    removeSession,
    loadMorePinned,
    loadMoreGlobal,
    loadMoreProject,
    loadMoreProjectTimeline,
  } = useSessionPagination({
    backendRef,
    expandedProjectIds,
    externalProjectIds,
    viewMode: sidebarSessionViewMode,
    sortMode: sidebarSessionSortMode,
    onBroadcastSessionsChanged: notifySessionsChanged,
  })

  const crossTab = useCrossTabSync({
    onSessionsChanged: () => { refreshSessions() },
    onProjectsChanged: () => { loadProject(true) },
    onSettingsChanged: (settings) => {
      refreshSessions()
      if (!settings?.defaultHarness) return
      void applyDefaultHarnessRef.current?.(settings.defaultHarness).catch((error) => {
        logger.error('Failed to apply the cross-tab default Harness change:', error)
      })
    },
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

  useEffect(() => {
    void initializeSystemNotifications()
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setStartupSplashDone(true), STARTUP_SPLASH_MIN_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const handleContextUsageDisplayChange = useCallback((sessionId: string, info: ContextUsageDisplayInfo) => {
    setCurrentSessionHoverInfo((current) => {
      if (current?.sessionId === sessionId && isSameContextUsageDisplayInfo(current, info)) return current
      return { sessionId, ...info }
    })
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
    updateSessionTitle,
    loadCloudModels: cloudModels.loadCloudModels,
    onTaskComplete: handleTaskComplete,
  })
  const workspaceInspectorProjectId = agentManager.currentToolProject?.id ?? 'global-workspace'
  const workspaceInspectorRuntimeScopeId = agentManager.currentRuntimeScopeId
  const sideChatRuntimeScopeRef = useRef(workspaceInspectorRuntimeScopeId)
  const workspaceInspectorScope = useMemo<WorkspaceInspectorRuntimeScope>(() => ({
    projectId: workspaceInspectorProjectId,
    runtimeScopeId: workspaceInspectorRuntimeScopeId,
  }), [workspaceInspectorProjectId, workspaceInspectorRuntimeScopeId])
  useLayoutEffect(() => {
    workspaceInspectorScopeRef.current = workspaceInspectorScope
  }, [workspaceInspectorScope])
  const [workspaceInspectorOpen, setWorkspaceInspectorOpen] = useWorkspaceInspectorOpenState(
    workspaceInspectorProjectId,
    agentManager.currentSessionId,
    workspaceInspectorRuntimeScopeId,
  )

  useEffect(() => {
    const loadingSessionId = agentManager.loadingSessionId
    if (!loadingSessionId || visibleLoadingSessionIdRef.current === loadingSessionId) return undefined
    const timer = window.setTimeout(() => {
      if (visibleLoadingSessionIdRef.current === loadingSessionId) return
      pendingSessionLoadCancelRef.current?.()
      pendingSessionLoadCancelRef.current = undefined
      sessionTransitionTokenRef.current += 1
      setRenderedLoadingSessionId(undefined)
      visibleLoadingSessionIdRef.current = loadingSessionId
      setVisibleLoadingSessionId(loadingSessionId)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [agentManager.loadingSessionId])

  useEffect(() => {
    const visibleSessionId = visibleLoadingSessionIdRef.current
    if (!visibleSessionId || renderedLoadingSessionId !== visibleSessionId) return undefined

    const fadeTimer = window.setTimeout(() => {
      if (visibleLoadingSessionIdRef.current !== visibleSessionId) return
      visibleLoadingSessionIdRef.current = undefined
      setVisibleLoadingSessionId(undefined)
    }, CONVERSATION_TRANSITION_DURATION_MS)
    return () => window.clearTimeout(fadeTimer)
  }, [agentManager.loadingSessionId, renderedLoadingSessionId, visibleLoadingSessionId])

  // Destructure stable values for use in dependency arrays
  const {
    createAgent,
    startDeferredSession,
    applyDefaultHarnessToBlankSession,
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

  useEffect(() => {
    applyDefaultHarnessRef.current = applyDefaultHarnessToBlankSession
  }, [applyDefaultHarnessToBlankSession])

  useEffect(() => {
    currentToolProjectIdRef.current = agentManager.currentToolProject?.id
    titleGitRequestIdRef.current += 1
    chatFileRequestIdRef.current += 1
  }, [agentManager.currentRuntimeScopeId, agentManager.currentToolProject?.id])

  const beginSessionTransition = useCallback((sessionId: string) => {
    if (!sessionId || sessionId === currentSessionIdRef.current) return undefined
    pendingSessionLoadCancelRef.current?.()
    pendingSessionLoadCancelRef.current = undefined
    const token = sessionTransitionTokenRef.current + 1
    sessionTransitionTokenRef.current = token
    setRenderedLoadingSessionId(undefined)
    visibleLoadingSessionIdRef.current = sessionId
    setVisibleLoadingSessionId(sessionId)
    return token
  }, [currentSessionIdRef])

  const cancelSessionTransition = useCallback((sessionId: string, token?: number) => {
    if (token !== undefined && sessionTransitionTokenRef.current !== token) return
    if (visibleLoadingSessionIdRef.current !== sessionId) return
    pendingSessionLoadCancelRef.current?.()
    pendingSessionLoadCancelRef.current = undefined
    sessionTransitionTokenRef.current += 1
    visibleLoadingSessionIdRef.current = undefined
    setRenderedLoadingSessionId(undefined)
    setVisibleLoadingSessionId(undefined)
  }, [])

  const handleSessionInitialRenderReady = useCallback((sessionId: string) => {
    if (visibleLoadingSessionIdRef.current !== sessionId) return
    pendingSessionLoadCancelRef.current = undefined
    setRenderedLoadingSessionId(sessionId)
  }, [])

  const handleSessionInitialRenderError = useCallback((sessionId: string, error: unknown) => {
    logger.error('Failed to render conversation:', error)
    cancelSessionTransition(sessionId)
    addToast({
      sessionId,
      title: t('conversationLoadFailed'),
      status: 'error',
    })
  }, [addToast, cancelSessionTransition])

  const scheduleSessionLoad = useCallback((sessionId: string, load: () => Promise<boolean>) => {
    const token = beginSessionTransition(sessionId)
    if (token === undefined) {
      pendingSessionLoadCancelRef.current?.()
      pendingSessionLoadCancelRef.current = undefined
      sessionTransitionTokenRef.current += 1
      void load()
      return
    }
    pendingSessionLoadCancelRef.current = scheduleAfterPaint(() => {
      pendingSessionLoadCancelRef.current = undefined
      if (sessionTransitionTokenRef.current !== token || visibleLoadingSessionIdRef.current !== sessionId) return
      void load().then((loaded) => {
        if (!loaded) cancelSessionTransition(sessionId, token)
      })
    })
  }, [beginSessionTransition, cancelSessionTransition])

  useEffect(() => () => {
    pendingSessionLoadCancelRef.current?.()
  }, [])

  const handleToastClick = useCallback(
    (sessionId: string) => {
      if (!sessionId) return
      scheduleSessionLoad(sessionId, () => loadAgentSession(sessionId))
    },
    [loadAgentSession, scheduleSessionLoad],
  )

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: unknown }>).detail
      if (typeof detail?.sessionId === 'string') handleToastClick(detail.sessionId)
    }
    window.addEventListener('quickforge:open-session-from-settings', handler)
    return () => window.removeEventListener('quickforge:open-session-from-settings', handler)
  }, [handleToastClick])

  const consumeRestoredDraft = useCallback((id: number) => {
    setRestoredDraft((current) => current?.id === id ? undefined : current)
  }, [])

  const requestWorkspaceInspector = useCallback((request: WorkspaceInspectorOpenRequestInput, scope = workspaceInspectorScope) => {
    if (!workspaceInspectorRuntimeScopeMatches(scope, workspaceInspectorScopeRef.current)) return false
    workspaceInspectorRequestIdRef.current += 1
    setWorkspaceInspectorRequest({ ...request, scope, id: workspaceInspectorRequestIdRef.current })
    setWorkspaceInspectorOpen(true)
    return true
  }, [setWorkspaceInspectorOpen, setWorkspaceInspectorRequest, workspaceInspectorScope])

  const handleWorkspaceInspectorRequest = useCallback((id: number) => {
    setWorkspaceInspectorRequest((current) => {
      if (current?.id !== id) return current
      return shouldHandleWorkspaceInspectorRequest(current, workspaceInspectorScopeRef.current, undefined)
        ? undefined
        : current
    })
  }, [setWorkspaceInspectorRequest])

  const clearSideChat = useCallback(() => {
    sideChatAgent.reset()
    sideChatDraftRef.current = ''
    bumpSideChatRevision()
  }, [bumpSideChatRevision, sideChatAgent])

  useEffect(() => () => sideChatAgent.abort(), [sideChatAgent])

  useEffect(() => {
    if (sideChatRuntimeScopeRef.current === workspaceInspectorRuntimeScopeId) return undefined
    sideChatRuntimeScopeRef.current = workspaceInspectorRuntimeScopeId
    const timer = window.setTimeout(() => {
      clearSideChat()
      setSideChatTabOpen(false)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [clearSideChat, workspaceInspectorRuntimeScopeId])

  useEffect(() => {
    const model = agentManager.agent?.harness === 'opencode'
      ? activeModelRef.current
      : agentManager.agent?.state.model ?? activeModelRef.current
    sideChatAgent.setContext({ sessionId: agentManager.currentSessionId, model })
  }, [agentManager.agent, agentManager.chatPanelRevision, agentManager.currentSessionId, sideChatAgent])

  const openWorkspaceSideChat = useCallback(() => {
    if (!agentManager.currentSessionId || needsModelSetup) return
    const opened = requestWorkspaceInspector({
      projectId: agentManager.currentToolProject?.id ?? 'global-workspace',
      kind: 'side-chat',
    })
    if (opened) setSideChatTabOpen(true)
  }, [agentManager.currentSessionId, agentManager.currentToolProject?.id, needsModelSetup, requestWorkspaceInspector])

  const openWorkspaceGitChanges = useCallback(() => {
    const projectId = agentManager.currentToolProject?.id
    if (!projectId) return
    setArtifactPreviewOpen(false)
    requestWorkspaceInspector({ projectId, kind: 'review', view: 'changes' })
  }, [agentManager.currentToolProject?.id, requestWorkspaceInspector, setArtifactPreviewOpen])

  const refreshTitleGitStatus = useCallback(async () => {
    const projectId = agentManager.currentToolProject?.id
    const requestId = titleGitRequestIdRef.current + 1
    titleGitRequestIdRef.current = requestId
    if (!projectId) {
      setTitleGitStatus(undefined)
      return undefined
    }
    try {
      const status = await getGitStatus(projectId)
      if (!isCurrentProjectRequest({ projectId, requestId }, currentToolProjectIdRef.current, titleGitRequestIdRef.current)) return undefined
      setTitleGitStatus(status)
      return status
    } catch (error) {
      if (!isCurrentProjectRequest({ projectId, requestId }, currentToolProjectIdRef.current, titleGitRequestIdRef.current)) return undefined
      logger.warn('Failed to refresh title git status:', error)
      setTitleGitStatus(undefined)
      return undefined
    }
  }, [agentManager.currentToolProject?.id])

  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshTitleGitStatus() }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshTitleGitStatus])

  useEffect(() => {
    let refreshTimer: number | undefined
    const unsubscribe = subscribeToAgentEvents((event) => {
      if (!shouldRefreshTitleGitStatusOnToolEnd(
        event,
        currentSessionIdRef.current,
        currentToolProjectIdRef.current,
      )) return

      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined
        void refreshTitleGitStatus()
      }, 400)
    })

    return () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      unsubscribe()
    }
  }, [agentManager.currentSessionId, currentSessionIdRef, refreshTitleGitStatus])

  const handleCheckoutTitleBranch = useCallback(async (branch: string) => {
    const projectId = agentManager.currentToolProject?.id
    if (!projectId) return
    const requestId = titleGitRequestIdRef.current + 1
    titleGitRequestIdRef.current = requestId
    try {
      const status = await checkoutGitBranch(projectId, branch)
      if (!isCurrentProjectRequest({ projectId, requestId }, currentToolProjectIdRef.current, titleGitRequestIdRef.current)) return
      setTitleGitStatus(status)
      setBranchMenuOpen(false)
      addToast({
        sessionId: agentManager.currentSessionId ?? '',
        title: t('gitBranchSwitched'),
        status: 'idle',
        message: branch,
      })
    } catch (error) {
      if (!isCurrentProjectRequest({ projectId, requestId }, currentToolProjectIdRef.current, titleGitRequestIdRef.current)) return
      logger.error('Failed to checkout git branch:', error)
      void showAlert(error instanceof Error ? error.message : t('gitCheckoutFailed'))
      throw error
    }
  }, [addToast, agentManager.currentSessionId, agentManager.currentToolProject?.id])

  const handleBranchCreated = useCallback((status: GitStatusResponse) => {
    setTitleGitStatus(status)
    setBranchMenuOpen(false)
    addToast({
      sessionId: agentManager.currentSessionId ?? '',
      title: t('gitBranchCreated'),
      status: 'idle',
      message: status.branch ?? '',
    })
  }, [addToast, agentManager.currentSessionId])

  const handleGitOperationCompleted = useCallback((status: GitStatusResponse) => {
    setTitleGitStatus(status)
    addToast({
      sessionId: agentManager.currentSessionId ?? '',
      title: t('gitOperationCompleted'),
      status: 'idle',
      message: status.branch ?? '',
    })
  }, [addToast, agentManager.currentSessionId])

  const openLocalFilePathFromChat = useCallback(async (filePath: string) => {
    const projectId = agentManager.currentToolProject?.id
    const requestScope = workspaceInspectorScopeRef.current
    if (!projectId) {
      addToast({ sessionId: agentManager.currentSessionId ?? '', title: '无法打开文件', status: 'error', message: '当前对话没有关联项目。' })
      return
    }
    const requestId = chatFileRequestIdRef.current + 1
    chatFileRequestIdRef.current = requestId

    try {
      const resolved = await resolveWorkspacePath(projectId, filePath)
      if (!isCurrentProjectRequest({ projectId, requestId }, currentToolProjectIdRef.current, chatFileRequestIdRef.current)) return
      if (!workspaceInspectorRuntimeScopeMatches(requestScope, workspaceInspectorScopeRef.current)) return
      requestWorkspaceInspector({ projectId, kind: 'reader', path: resolved.relativePath }, requestScope)
    } catch (error) {
      if (!isCurrentProjectRequest({ projectId, requestId }, currentToolProjectIdRef.current, chatFileRequestIdRef.current)) return
      if (!workspaceInspectorRuntimeScopeMatches(requestScope, workspaceInspectorScopeRef.current)) return
      const message = error instanceof Error ? error.message : '打开文件失败'
      addToast({ sessionId: agentManager.currentSessionId ?? '', title: '无法打开文件', status: 'error', message })
    }
  }, [addToast, agentManager.currentSessionId, agentManager.currentToolProject?.id, requestWorkspaceInspector])

  const openArtifactPreview = useCallback((projectId: string, path: string, kind?: Parameters<typeof artifactPreviewMode>[1]) => {
    const project = agentManager.currentToolProject
    const mode = artifactPreviewMode(path, kind)
    if (!project || project.id !== projectId || !mode) return
    setArtifactPreviewOpen(false)
    if (mode === 'reader') {
      requestWorkspaceInspector({ projectId, kind: 'reader', path })
      return
    }
    requestWorkspaceInspector({
      projectId,
      kind: 'browser',
      url: workspaceArtifactDiskPath(project.path, path),
    })
  }, [agentManager.currentToolProject, requestWorkspaceInspector, setArtifactPreviewOpen])

  useEffect(() => {
    const project = agentManager.currentToolProject
    const projectId = project?.id
    if (!projectId || currentSessionArtifactsState.projectId !== projectId) return
    if (currentSessionArtifactsState.sessionId !== agentManager.currentSessionId) return
    const artifact = findBestPreviewableArtifact(currentSessionArtifactsState.artifacts)
    if (!artifact?.path) return
    // 签名纳入最新 toolCallId：同一次 present_files 的重复更新（同 toolCallId）被去重，
    // 并写入 sessionStorage，避免刷新浏览器后把历史 present_files 再自动弹一次。
    // 新的工具调用（新 toolCallId）能正常触发，避免「再次 present 同一文件」被永远拦截。
    const lastToolCallId = artifact.toolCallIds[artifact.toolCallIds.length - 1]
    const signature = `${projectId}:${artifact.path}:${artifact.defaultPreview ? 'default' : artifact.explicit ? 'explicit' : 'inferred'}:${lastToolCallId ?? ''}`
    if (signature === autoPreviewSignatureRef.current) return
    if (hasSeenAutoPreviewSignature(signature)) {
      autoPreviewSignatureRef.current = signature
      return
    }
    autoPreviewSignatureRef.current = signature
    rememberAutoPreviewSignature(signature)
    queueMicrotask(() => {
      const mode = artifactPreviewMode(artifact.path, artifact.kind)
      if (!mode) return
      setArtifactPreviewOpen(false)
      if (mode === 'reader') {
        // Markdown、代码、配置和文本走 Reader；Markdown 使用富文本预览，其余使用 Monaco 只读查看。
        requestWorkspaceInspector({ projectId, kind: 'reader', path: artifact.path })
      } else {
        // HTML 和支持的图片走 Browser iframe。
        requestWorkspaceInspector({
          projectId,
          kind: 'browser',
          url: workspaceArtifactDiskPath(project.path, artifact.path),
        })
      }
    })
  }, [agentManager.currentSessionId, agentManager.currentToolProject, currentSessionArtifactsState, requestWorkspaceInspector, setArtifactPreviewOpen])

  useEffect(() => {
    autoPreviewSignatureRef.current = ''
    setArtifactPreviewOpen(false)
    setWorkspaceInspectorRequest(undefined)
  }, [agentManager.currentToolProject?.id, setArtifactPreviewOpen, setWorkspaceInspectorRequest])

  // 监听工具卡片预览按钮的桥接事件（事件名与 local-tools.ts 的 PREVIEW_ARTIFACT_EVENT 对应），
  // 转调 openArtifactPreview，复用与自动预览完全一致的逻辑。
  useEffect(() => {
    if (!openArtifactPreview) return
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string; kind?: Parameters<typeof artifactPreviewMode>[1] }>).detail
      const projectId = agentManager.currentToolProject?.id
      if (projectId && detail && typeof detail.path === 'string') openArtifactPreview(projectId, detail.path, detail.kind)
    }
    window.addEventListener('quickforge:preview-artifact', handler as EventListener)
    return () => window.removeEventListener('quickforge:preview-artifact', handler as EventListener)
  }, [agentManager.currentToolProject?.id, openArtifactPreview])

  // 点击 subagent 摘要时，在 Workspace Inspector 中打开或激活该次运行的独立 Tab。
  useEffect(() => {
    const handler = (event: Event) => {
      const request = normalizeOpenSubagentRunRequest((event as CustomEvent).detail)
      if (!request?.payload) return
      setArtifactPreviewOpen(false)
      requestWorkspaceInspector({ projectId: agentManager.currentToolProject?.id, kind: 'subagent', payload: request.payload })
    }
    window.addEventListener(OPEN_SUBAGENT_RUN_EVENT, handler as EventListener)
    return () => window.removeEventListener(OPEN_SUBAGENT_RUN_EVENT, handler as EventListener)
  }, [agentManager.currentToolProject?.id, requestWorkspaceInspector, setArtifactPreviewOpen])

  // 隧道恢复免刷新对账：监听 quickforge:tunnel-recovered，同步当前会话与后台任务的
  // 真实服务端状态；全部成功才允许免刷新恢复，任一 syncState 失败会 reject waitUntil，
  // 由协调器整页刷新兜底。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<TunnelRecoveredEventDetail>).detail
      if (!detail || typeof detail.waitUntil !== 'function') return
      const reconcilePromise = (async () => {
        const agents = new Set<ServerAgent>()
        const currentAgent = agentRef.current
        if (currentAgent instanceof ServerAgent) agents.add(currentAgent)
        for (const task of taskMapRef.current.values()) {
          if (task.agent instanceof ServerAgent) agents.add(task.agent)
        }
        await Promise.all(
          [...agents].map(async (agent) => {
            try {
              // syncState 当前会把网络异常视为可恢复并在内部吞掉；先显式验证每个
              // 活动会话状态端点，确保真正无法对账时 waitUntil 能 reject 并触发 reload。
              const response = await fetch(`/api/agents/${encodeURIComponent(agent.sessionId)}/state`, { cache: 'no-store' })
              if (!response.ok) throw new Error(`HTTP ${response.status}`)
              await agent.syncState()
            } catch (error) {
              logger.error('Tunnel recovery failed to sync agent state:', error)
              throw error
            }
          }),
        )
        await refreshSessions({ broadcast: true })
      })()
      detail.waitUntil(reconcilePromise)
    }
    window.addEventListener(TUNNEL_RECOVERED_EVENT, handler as EventListener)
    return () => window.removeEventListener(TUNNEL_RECOVERED_EVENT, handler as EventListener)
  }, [agentRef, taskMapRef, refreshSessions])

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
      if (event.type === 'session_created') {
        const metadata = event.metadata as QuickForgeSessionMetadata | undefined
        if (metadata?.id) upsertSessionMetadata(metadata)
      } else if (event.type === 'title_updated') {
        const sessionId = typeof event.sessionId === 'string' ? event.sessionId : undefined
        const title = typeof event.title === 'string' ? event.title : undefined
        if (sessionId && title) updateSessionTitle(sessionId, title)
      } else if (event.type === 'agent_end' || event.type === 'session_forked') {
        void refreshSessions({ broadcast: true })
      }
      if (!isScheduledTaskNotification(event)) return
      const sessionId = typeof event.sessionId === 'string' ? event.sessionId : undefined
      const title = typeof event.title === 'string' ? event.title : t('scheduledTasks')
      const status = isBackgroundTaskStatus(event.status) ? event.status : 'idle'
      const message = typeof event.message === 'string' ? event.message : undefined
      addToast({ sessionId: sessionId ?? '', title, status, message })
      const runId = typeof event.runId === 'string' ? event.runId : undefined
      void showTaskSystemNotification({
        key: runId ? `scheduled:${runId}` : `scheduled:${sessionId ?? title}:${status}`,
        sessionId,
        title,
        status,
      })
    })
    return unsubscribe
  }, [addToast, loadProjectSessions, refreshSessions, setExpandedProjectIds, updateSessionTitle, upsertSessionMetadata])

  const { ready, startupError, migrationStatus, retryBootstrap } = useAppBootstrap({
    storageRef,
    backendRef,
    activeModelRef,
    agentAccessModeRef,
    taskMapRef,
    refreshSessions,
    loadProject,
    initAgentAccessMode,
    createAgent,
    loadSession: loadAgentSession,
    loadCloudModels: cloudModels.loadCloudModels,
    readCachedCloudModels: cloudModels.readCachedCloudModels,
    isCloudModelsLoaded: cloudModels.isCloudModelsLoaded,
    setNeedsModelSetup,
    onStorageReady: setStorage,
  })

  const updateCheck = useUpdateCheck(storageRef, ready)
  const startupReady = ready && startupSplashDone && Boolean(agentManager.agent || needsModelSetup)

  useEffect(() => {
    if (!startupReady) return undefined
    const timer = window.setTimeout(() => setStartupSplashExited(true), STARTUP_SPLASH_EXIT_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [startupReady])

  useEffect(() => {
    if (!ready) return undefined

    const source = new EventSource('/api/channels/events')
    const handleSessionsChanged = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as ChannelRefreshEvent
        if (payload.type !== 'sessions-changed' || typeof payload.sessionId !== 'string') return

        const projectId = channelEventProjectId(payload)
        if (projectId) {
          setExternalProjectIds((current) => current.has(projectId) ? current : new Set([...current, projectId]))
        }

        if (payload.metadata?.id === payload.sessionId) {
          upsertSessionMetadata(payload.metadata)
        } else if (projectId) {
          void loadProjectSessions(projectId, 0)
        } else {
          void loadGlobalSessions(0)
        }

        const currentAgent = agentRef.current
        if (payload.sessionId === currentSessionIdRef.current && currentAgent instanceof ServerAgent) {
          void currentAgent.syncState()
        }
      } catch {
        // Ignore malformed channel events.
      }
    }

    source.addEventListener('sessions-changed', handleSessionsChanged)
    return () => {
      source.removeEventListener('sessions-changed', handleSessionsChanged)
      source.close()
    }
  }, [agentRef, currentSessionIdRef, loadGlobalSessions, loadProjectSessions, ready, upsertSessionMetadata])

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
    forkCurrentSession,
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
    setNeedsModelSetup,
    switchActiveProject,
    closeWorkspacePage,
    setRestoredDraft,
  })

  const handleWorkspaceInspectorOpenChange = useCallback((open: boolean) => {
    setWorkspaceInspectorOpen(open)
  }, [setWorkspaceInspectorOpen])

  const startNewGlobalChatWithInspectorReset = useCallback(async (...args: Parameters<typeof startNewGlobalChat>) => {
    return startNewGlobalChat(...args)
  }, [startNewGlobalChat])

  const startNewProjectChatWithInspectorReset = useCallback(async (...args: Parameters<typeof startNewProjectChat>) => {
    return startNewProjectChat(...args)
  }, [startNewProjectChat])

  const { deleteProjectInline } = useProjectActions({
    activeProjectRef,
    refreshSessions,
    notifyProjectsChanged: crossTab.notifyProjectsChanged,
    setActiveProject,
    setProjects,
    setExpandedProjectIds,
    setChatPanelRevision,
  })

  useEffect(() => {
    const recovery = getDeletedProjectRecoveryDecision({
      ready,
      currentToolProjectId: agentManager.currentToolProject?.id,
      projects,
      activeProject,
      recoveringProjectId: recoveringDeletedToolProjectIdRef.current,
    })
    if (recovery.type === 'none') {
      const toolProjectId = agentManager.currentToolProject?.id
      if (recoveringDeletedToolProjectIdRef.current && recoveringDeletedToolProjectIdRef.current !== toolProjectId) {
        recoveringDeletedToolProjectIdRef.current = undefined
      }
      return
    }
    recoveringDeletedToolProjectIdRef.current = recovery.deletedProjectId

    setCurrentSessionArtifactsState({ artifacts: [] })
    setWorkspaceInspectorRequest(undefined)
    setArtifactPreviewOpen(false)
    setPendingTerminalCommand(null)
    setTerminalDockOpen(false)
    chatFileRequestIdRef.current += 1

    void startDeferredSession(recovery.type === 'project'
      ? { scope: 'project', project: recovery.project }
      : { scope: 'global' })
      .catch((error) => {
        recoveringDeletedToolProjectIdRef.current = undefined
        logger.error('Failed to recover after the current project was deleted:', error)
      })
  }, [activeProject, agentManager.currentToolProject?.id, projects, ready, setArtifactPreviewOpen, setWorkspaceInspectorRequest, startDeferredSession])

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

  const handleAnswerAsk = useCallback(async (askId: string, answers: Array<{ choices?: string[]; custom?: string }>, skipped: boolean) => {
    const currentAgent = agentRef.current as (typeof agentRef.current & { answerAsk?: (askId: string, payload: { answers?: Array<{ choices?: string[]; custom?: string }>; skipped?: boolean }) => Promise<void> })
    if (!currentAgent?.answerAsk) throw new Error(t('askUserFailed'))
    try {
      await currentAgent.answerAsk(askId, { answers, skipped })
    } catch (err) {
      logger.error('Failed to answer ask:', err)
      throw err instanceof Error ? err : new Error(t('askUserFailed'))
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
    archiveSession,
    startNewGlobalSession,
  } = useSessionActions({
    storageRef,
    taskMapRef,
    currentSessionIdRef,
    loadAgentSession,
    setCurrentTitleRef,
    refreshSessions,
    removeSession,
    notifySessionsChanged,
    updateSessionTitle,
    closeWorkspacePage,
    startNewGlobalChat: startNewGlobalChatWithInspectorReset,
  })

  const loadSessionWithTransition = useCallback((sessionId: string) => {
    scheduleSessionLoad(sessionId, () => loadSession(sessionId))
  }, [loadSession, scheduleSessionLoad])

  const openSettingsPage = useCallback((initialTab: typeof ui.settingsInitialTab, customProvider?: string) => {
    ui.setSettingsInitialTab(initialTab)
    ui.setSettingsCustomProvider(customProvider)
    ui.setSettingsDialogOpen(true)
    ui.setMobileSidebarOpen(false)
  }, [ui])

  const {
    activateConfiguredModel,
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
    setNeedsModelSetup,
    setRestoredDraft,
    notifySettingsChanged: crossTab.notifySettingsChanged,
    openSettingsPage,
    loadCloudModels: cloudModels.loadCloudModels,
    readCachedCloudModels: cloudModels.readCachedCloudModels,
    isCloudModelsLoaded: cloudModels.isCloudModelsLoaded,
  })

  const closeSettingsPage = useCallback(() => {
    ui.setSettingsDialogOpen(false)
    ui.setSettingsCustomProvider(undefined)
    if (needsModelSetup || !agentRef.current) {
      void activateConfiguredModel().catch((error) => logger.error('Failed to activate configured model:', error))
    }
  }, [activateConfiguredModel, agentRef, needsModelSetup, ui])

  const openDesktopAbout = useCallback(() => {
    setDesktopTitlebarMenuOpen(false)
    openAboutSettings()
  }, [openAboutSettings])

  // --- Derived data ---
  const visibleSessions = useMemo(() => allLoadedSessions, [allLoadedSessions])
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
    if (!desktopTitlebarMenuOpen) return
    window.addEventListener('click', closeDesktopTitlebarMenu)
    window.addEventListener('blur', closeDesktopTitlebarMenu)
    return () => {
      window.removeEventListener('click', closeDesktopTitlebarMenu)
      window.removeEventListener('blur', closeDesktopTitlebarMenu)
    }
  }, [closeDesktopTitlebarMenu, desktopTitlebarMenuOpen])

  useEffect(() => {
    if (!ui.conversationMenuOpen) return
    const closeMenu = () => ui.setConversationMenuOpen(false)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('orientationchange', closeMenu)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('orientationchange', closeMenu)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [ui, ui.conversationMenuOpen])

  useEffect(() => {
    if (!branchMenuOpen) return
    const closeMenu = () => setBranchMenuOpen(false)
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
    }
  }, [branchMenuOpen])

  useEffect(() => {
    const handleExecuteMarkdownCommand = (event: Event) => {
      if (remoteClient) {
        void showAlert('远程客户端不能使用服务端终端')
        return
      }
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

        setArtifactPreviewOpen(false)
        setTerminalDockOpen(true)
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
  }, [remoteClient, setArtifactPreviewOpen])

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

  const showNewChatEmptyState = !needsModelSetup
    && Boolean(agentManager.agent)
    && !agentManager.agent?.state.isStreaming
    && (agentManager.agent?.state.messages.length ?? 0) === 0

  // 清除标记只在离开当前新对话空状态后复位，显式 global 新建在本次空状态内保持生效。
  useEffect(() => {
    if (!showNewChatEmptyState && wasNewChatEmptyStateRef.current) {
      setEmptyStateProjectDismissed(false)
    }
    wasNewChatEmptyStateRef.current = showNewChatEmptyState
  }, [showNewChatEmptyState])

  // 默认项目必须进入真实会话状态，不能只在选择器中显示为已选。
  useEffect(() => {
    if (!showNewChatEmptyState || emptyStateProjectDismissed || !activeProject || agentManager.chatScope !== 'global') return
    void startNewProjectChat(activeProject)
  }, [activeProject, agentManager.chatScope, emptyStateProjectDismissed, showNewChatEmptyState, startNewProjectChat])

  const startNewDefaultSession = useCallback(() => {
    setEmptyStateProjectDismissed(false)
    if (activeProject) {
      void startNewProjectChatWithInspectorReset(activeProject)
      return
    }
    startNewGlobalSession()
  }, [activeProject, startNewGlobalSession, startNewProjectChatWithInspectorReset])

  const startNewExplicitGlobalSession = useCallback(() => {
    setEmptyStateProjectDismissed(true)
    startNewGlobalSession()
  }, [startNewGlobalSession])

  const handleSelectEmptyStateProject = useCallback((project: ProjectInfo) => {
    void startNewProjectChatWithInspectorReset(project)
  }, [startNewProjectChatWithInspectorReset])

  const handleClearEmptyStateProject = useCallback(() => {
    setEmptyStateProjectDismissed(true)
    startNewGlobalSession()
  }, [startNewGlobalSession])

  const handleSelectEmptyStateNewProject = useCallback(() => {
    selectProjectDirectory()
  }, [selectProjectDirectory])

  const showFirstUseGuide = Boolean(storage)
    && !ui.firstUseGuideDismissed
    && !showNewChatEmptyState
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

  const currentSessionAgent = agentManager.agent
  const canForkCurrentSession = currentSessionAgent?.harness === 'opencode'
    && !currentSessionAgent.state.isStreaming
    && currentSessionAgent instanceof ServerAgent
    && Boolean(currentSessionAgent.harnessSessionId)

  const handleArchiveCurrentSession = useCallback(() => {
    const sessionId = agentManager.currentSessionId
    if (!sessionId) return
    ui.setConversationMenuOpen(false)
    void archiveSession(sessionId)
  }, [agentManager.currentSessionId, archiveSession, ui])

  // Stable UI setters used by the desktop sidebar handlers below.  Destructuring
  // them keeps the callbacks referentially stable (a useState setter never changes)
  // without dragging the whole `ui` object into the dependency array.
  const { setSkillsDialog, setSidebarOpen } = ui

  const openGlobalSkills = useCallback(() => {
    openSettingsPage('skills')
  }, [openSettingsPage])

  const openAgents = useCallback(() => {
    openSettingsPage('agents')
  }, [openSettingsPage])

  const openScheduledTasks = useCallback(() => {
    openSettingsPage('scheduledTasks')
  }, [openSettingsPage])

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

  const openProjectInVSCode = useCallback(async (project: ProjectInfo) => {
    const response = await fetch(`/api/project/${encodeURIComponent(project.id)}/open-in-vscode`, {
      method: 'POST',
    })
    if (response.ok) return
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || t('openInVSCodeFailed'))
  }, [])

  const openProjectInIDEA = useCallback(async (project: ProjectInfo) => {
    const response = await fetch(`/api/project/${encodeURIComponent(project.id)}/open-in-idea`, {
      method: 'POST',
    })
    if (response.ok) return
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || t('openInIDEAFailed'))
  }, [])

  // --- Desktop sidebar handlers (stable; do not auto-close the sidebar) ---
  // Kept separate from the mobile `*FromSidebar` handlers so the memoized desktop
  // <ChatSidebar> does not re-render on unrelated App state changes.
  const openProjectInExplorerWithFeedback = useCallback((project: ProjectInfo) => {
    void openProjectInExplorer(project).catch((error) => {
      logger.error('Failed to open project in explorer:', error)
      void showAlert(error instanceof Error ? error.message : t('openInExplorerFailed'))
    })
  }, [openProjectInExplorer])

  const openProjectInVSCodeWithFeedback = useCallback((project: ProjectInfo) => {
    void openProjectInVSCode(project).catch((error) => {
      logger.error('Failed to open project in VS Code:', error)
      void showAlert(error instanceof Error ? error.message : t('openInVSCodeFailed'))
    })
  }, [openProjectInVSCode])

  const openProjectInIDEAWithFeedback = useCallback((project: ProjectInfo) => {
    void openProjectInIDEA(project).catch((error) => {
      logger.error('Failed to open project in IntelliJ IDEA:', error)
      void showAlert(error instanceof Error ? error.message : t('openInIDEAFailed'))
    })
  }, [openProjectInIDEA])

  const toggleSidebar = useCallback(() => setSidebarOpen((value) => !value), [setSidebarOpen])

  const closeMobileSidebar = useCallback(() => {
    ui.setMobileSidebarOpen(false)
  }, [ui])

  const loadSessionFromSidebar = useCallback((sessionId: string) => {
    closeMobileSidebar()
    loadSessionWithTransition(sessionId)
  }, [closeMobileSidebar, loadSessionWithTransition])

  const startNewDefaultSessionFromSidebar = useCallback(() => {
    closeMobileSidebar()
    startNewDefaultSession()
  }, [closeMobileSidebar, startNewDefaultSession])

  const startNewExplicitGlobalSessionFromSidebar = useCallback(() => {
    closeMobileSidebar()
    startNewExplicitGlobalSession()
  }, [closeMobileSidebar, startNewExplicitGlobalSession])

  const startNewProjectChatFromSidebar = useCallback((project: ProjectInfo) => {
    closeMobileSidebar()
    void startNewProjectChatWithInspectorReset(project)
  }, [closeMobileSidebar, startNewProjectChatWithInspectorReset])

  const openGlobalSkillsFromSidebar = useCallback(() => {
    closeMobileSidebar()
    openGlobalSkills()
  }, [closeMobileSidebar, openGlobalSkills])

  const openAgentsFromSidebar = useCallback(() => {
    closeMobileSidebar()
    openAgents()
  }, [closeMobileSidebar, openAgents])

  const openScheduledTasksFromSidebar = useCallback(() => {
    closeMobileSidebar()
    openScheduledTasks()
  }, [closeMobileSidebar, openScheduledTasks])

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

  // --- Loading state ---
  if (startupError) {
    const migrationFailed = startupError.kind === 'migration'
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="max-w-md rounded-lg border border-border bg-background p-5 text-center">
          <h1 className="text-base font-semibold">
            {migrationFailed ? t('migration.failedTitle') : t('localServiceUnavailableTitle')}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{startupError.message}</p>
          {migrationFailed && startupError.detail ? (
            <p className="mt-2 whitespace-pre-wrap break-all text-left text-xs text-muted-foreground">{startupError.detail}</p>
          ) : null}
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

  if (!startupReady) {
    return migrationStatus?.state === 'migrating' ? <MigrationProgressView status={migrationStatus} /> : <StartupSplash />
  }

  return (
    <>
    <div className="quickforge-desktop-titlebar fixed left-0 right-0 top-0 z-40 hidden h-8 items-center px-2">
      <button
        type="button"
        className="quickforge-desktop-titlebar-trigger inline-flex h-8 translate-y-1 items-center gap-2.5 rounded-none px-3 text-[13px] font-medium leading-none text-foreground/90 transition-colors hover:bg-accent hover:text-accent-foreground"
        onClick={(event) => {
          event.stopPropagation()
          setDesktopTitlebarMenuOpen((open) => !open)
        }}
        aria-haspopup="menu"
        aria-expanded={desktopTitlebarMenuOpen}
      >
        <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 64 64" aria-hidden="true">
          <defs>
            <linearGradient id="titlebarIconStroke" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#9ca3af" />
              <stop offset="1" stopColor="#4b5563" />
            </linearGradient>
            <linearGradient id="titlebarIconBolt" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#374151" />
              <stop offset="1" stopColor="#0f172a" />
            </linearGradient>
          </defs>
          <polygon points="32,6 52.78,18 52.78,42 32,54 11.22,42 11.22,18" fill="none" stroke="url(#titlebarIconStroke)" strokeWidth="4.5" strokeLinejoin="round" />
          <path d="M37.2 13 L22 34 L30.6 34 L26.8 50 L42.8 26 L33.8 26 Z" fill="url(#titlebarIconBolt)" />
          <path d="M37.2 13 L22 34 L30.6 34 L33.8 26 Z" fill="#e5e7eb" opacity="0.4" />
        </svg>
        <span>QuickForge</span>
      </button>
      {desktopTitlebarMenuOpen && (
        <div
          className="quickforge-desktop-titlebar-menu absolute left-2 top-8 min-w-40 overflow-hidden rounded-md border border-border bg-popover py-1 text-[13px] text-popover-foreground shadow-lg"
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" className="flex h-8 w-full items-center gap-2.5 px-3 text-left hover:bg-accent hover:text-accent-foreground" role="menuitem" onClick={openDesktopAbout}>
            <Info className="size-4" />
            <span>{t('about')}</span>
          </button>
          <button type="button" className="flex h-8 w-full items-center gap-2.5 px-3 text-left hover:bg-accent hover:text-accent-foreground" role="menuitem" onClick={openDesktopUpdatePage}>
            <RefreshCw className="size-4" />
            <span>{t('desktopUpdate')}</span>
          </button>
          <div className="my-1 border-t border-border" />
          <button type="button" className="flex h-8 w-full items-center gap-2.5 px-3 text-left text-destructive hover:bg-destructive/10" role="menuitem" onClick={exitDesktopApp}>
            <LogOut className="size-4" />
            <span>{t('desktopExit')}</span>
          </button>
        </div>
      )}
    </div>
    {!ui.settingsDialogOpen && (
    <div
      className={cn(
        'quickforge-window-toolbar fixed right-2 z-30 flex items-center gap-1',
        workspaceInspectorFullscreen && 'pointer-events-none invisible',
      )}
      aria-hidden={workspaceInspectorFullscreen || undefined}
      aria-label={t('workspacePanel')}
    >
      {!remoteClient && !workspaceInspectorOpen ? (
        <ProjectOpenMenu
          project={agentManager.currentToolProject}
          disabled={needsModelSetup}
          onOpenInExplorer={openProjectInExplorerWithFeedback}
          onOpenInVSCode={openProjectInVSCodeWithFeedback}
          onOpenInIDEA={openProjectInIDEAWithFeedback}
        />
      ) : null}
      {!workspaceInspectorOpen && agentManager.currentToolProject?.id && titleGitStatus?.isGitRepository ? (
        <GitToolsPinnedSummary
          projectId={agentManager.currentToolProject.id}
          status={titleGitStatus}
          expanded={gitToolsExpanded}
          onExpandedChange={setGitToolsExpanded}
          onOpenChanges={() => {
            setGitToolsExpanded(false)
            openWorkspaceGitChanges()
          }}
          onOpenCommitPush={() => {
            setGitToolsExpanded(false)
            setGitCommitDialogOpen(true)
          }}
          onCheckout={handleCheckoutTitleBranch}
          onCreated={handleBranchCreated}
          onOpenGraph={() => setGitGraphOpen(true)}
          mobileShell={mobileShell}
        />
      ) : null}
      {!remoteClient ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setArtifactPreviewOpen(false)
            setTerminalDockOpen((value) => !value)
          }}
          disabled={!agentManager.currentToolProject?.id || needsModelSetup}
          aria-label={terminalDockOpen ? t('terminalCollapse') : t('rightPanelTerminal')}
          title={terminalDockOpen ? t('terminalCollapse') : t('rightPanelTerminal')}
          className={cn(
            'rounded-[10px] text-muted-foreground/85 hover:bg-muted/45 hover:text-foreground/90 disabled:opacity-40',
            terminalDockOpen ? 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground' : undefined,
          )}
        >
          <SquareTerminal className="size-[18px] stroke-[1.85]" />
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          setArtifactPreviewOpen(false)
          if (workspaceInspectorOpen) {
            setWorkspaceInspectorOpen(false)
          } else {
            setWorkspaceInspectorOpen(true)
          }
        }}
        disabled={!agentManager.currentToolProject?.id || needsModelSetup}
        aria-label={workspaceInspectorOpen ? t('workspaceCollapseRightPanel') : t('workspaceExpandRightPanel')}
        title={workspaceInspectorOpen ? t('workspaceCollapseRightPanel') : t('workspaceExpandRightPanel')}
        className={cn(
          'hidden rounded-[10px] text-muted-foreground/85 hover:bg-muted/45 hover:text-foreground/90 disabled:opacity-40 lg:inline-flex',
          workspaceInspectorOpen ? 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground' : undefined,
        )}
      >
        <PanelRight className="size-[18px] stroke-[1.85]" />
      </Button>
    </div>
    )}
    {ui.settingsDialogOpen ? (
      <Suspense fallback={<LazyPanelFallback />}>
        <SettingsWorkspacePage
          initialTab={ui.settingsInitialTab}
          customProvider={ui.settingsCustomProvider}
          onBack={closeSettingsPage}
        />
      </Suspense>
    ) : null}
    <div
      className={cn(
        'flex h-screen min-h-0 supports-[height:100dvh]:h-dvh bg-[var(--quickforge-sidebar-bg)] text-foreground',
        ui.settingsDialogOpen && 'hidden',
      )}
      aria-hidden={ui.settingsDialogOpen || undefined}
    >
      <ChatSidebar
        sidebarOpen={ui.sidebarOpen}
        projectsCollapsed={ui.projectsCollapsed}
        pinnedCollapsed={ui.pinnedCollapsed}
        conversationsCollapsed={ui.conversationsCollapsed}
        sectionOrder={sidebarSectionOrder}
        projects={projects}
        expandedProjectIds={expandedProjectIds}
        activeProject={activeProject}
        currentSessionId={agentManager.currentSessionId}
        loadingSessionId={agentManager.loadingSessionId}
        sessionViewMode={sidebarSessionViewMode}
        sessionSortMode={sidebarSessionSortMode}
        globalSessions={globalSessions}
        pinnedSessions={pinnedSessions}
        pinnedHasMore={pinnedHasMore}
        pinnedLoading={pinnedLoading}
        sessionsForProject={sessionsForProject}
        projectTimelineSessions={projectTimelineSessions}
        projectTimelineHasMore={projectTimelineHasMore}
        projectTimelineLoading={projectTimelineLoading}
        globalHasMore={globalHasMore}
        globalLoading={globalLoading}
        onLoadMoreGlobal={loadMoreGlobal}
        onLoadMorePinned={loadMorePinned}
        projectHasMore={projectHasMore}
        projectLoading={projectLoading}
        projectLoaded={projectLoaded}
        onLoadMoreProject={loadMoreProject}
        onLoadMoreProjectTimeline={loadMoreProjectTimeline}
        sessionTaskStatus={sessionTaskStatus}
        selectingProject={selectingProject}
        onTogglePinnedCollapsed={ui.togglePinnedCollapsed}
        onToggleProjectsCollapsed={ui.toggleProjectsCollapsed}
        onToggleConversationsCollapsed={ui.toggleConversationsCollapsed}
        onReorderSections={handleSidebarSectionReorder}
        onToggleProjectExpanded={toggleProjectExpanded}
        onToggleAllProjectsExpanded={toggleAllProjectsExpanded}
        onReorderProjects={reorderProjects}
        onSelectProjectDirectory={remoteClient ? undefined : selectProjectDirectory}
        onStartNewProjectChat={startNewProjectChatWithInspectorReset}
        onOpenGlobalSkills={openGlobalSkills}
        onOpenAgents={openAgents}
        onOpenScheduledTasks={openScheduledTasks}
        onOpenProjectSkills={openProjectSkills}
        onOpenProjectInExplorer={remoteClient ? undefined : openProjectInExplorerWithFeedback}
        onDeleteProject={deleteProjectInline}
        onLoadSession={loadSessionWithTransition}
        onSessionViewModeChange={setSidebarSessionViewMode}
        onSessionSortModeChange={setSidebarSessionSortMode}
        onTogglePinSession={togglePinSession}
        onDeleteSession={archiveSession}
        onStartNewDefaultChat={startNewDefaultSession}
        onStartNewGlobalChat={startNewExplicitGlobalSession}
        onOpenSettings={openDefaultOptionsSettings}
        currentServerUrl={cloudTunnelClient ? '云账户远程访问' : mobileServerUrl}
        currentServerAlias={mobileServerAlias}
        onOpenServer={mobileShell || cloudTunnelClient ? openServerPicker : undefined}
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
              projectsCollapsed={ui.projectsCollapsed}
              pinnedCollapsed={ui.pinnedCollapsed}
              conversationsCollapsed={ui.conversationsCollapsed}
              sectionOrder={sidebarSectionOrder}
              projects={projects}
              expandedProjectIds={expandedProjectIds}
              activeProject={activeProject}
              currentSessionId={agentManager.currentSessionId}
              loadingSessionId={agentManager.loadingSessionId}
              sessionViewMode={sidebarSessionViewMode}
              sessionSortMode={sidebarSessionSortMode}
              globalSessions={globalSessions}
              pinnedSessions={pinnedSessions}
              pinnedHasMore={pinnedHasMore}
              pinnedLoading={pinnedLoading}
              sessionsForProject={sessionsForProject}
              projectTimelineSessions={projectTimelineSessions}
              projectTimelineHasMore={projectTimelineHasMore}
              projectTimelineLoading={projectTimelineLoading}
              globalHasMore={globalHasMore}
              globalLoading={globalLoading}
              onLoadMoreGlobal={loadMoreGlobal}
              onLoadMorePinned={loadMorePinned}
              projectHasMore={projectHasMore}
              projectLoading={projectLoading}
              projectLoaded={projectLoaded}
              onLoadMoreProject={loadMoreProject}
              onLoadMoreProjectTimeline={loadMoreProjectTimeline}
              sessionTaskStatus={sessionTaskStatus}
              selectingProject={selectingProject}
              onTogglePinnedCollapsed={ui.togglePinnedCollapsed}
              onToggleProjectsCollapsed={ui.toggleProjectsCollapsed}
              onToggleConversationsCollapsed={ui.toggleConversationsCollapsed}
              onReorderSections={handleSidebarSectionReorder}
              onToggleProjectExpanded={toggleProjectExpanded}
              onToggleAllProjectsExpanded={toggleAllProjectsExpanded}
              onReorderProjects={reorderProjects}
              onSelectProjectDirectory={remoteClient ? undefined : () => {
                closeMobileSidebar()
                selectProjectDirectory()
              }}
              onStartNewProjectChat={startNewProjectChatFromSidebar}
              onOpenGlobalSkills={openGlobalSkillsFromSidebar}
              onOpenAgents={openAgentsFromSidebar}
              onOpenScheduledTasks={openScheduledTasksFromSidebar}
              onOpenProjectSkills={openProjectSkillsFromSidebar}
              onOpenProjectInExplorer={remoteClient ? undefined : (project) => {
                closeMobileSidebar()
                void openProjectInExplorer(project).catch((error) => {
                  logger.error('Failed to open project in explorer:', error)
                  void showAlert(error instanceof Error ? error.message : t('openInExplorerFailed'))
                })
              }}
              onDeleteProject={deleteProjectInline}
              onLoadSession={loadSessionFromSidebar}
              onSessionViewModeChange={setSidebarSessionViewMode}
              onSessionSortModeChange={setSidebarSessionSortMode}
              onTogglePinSession={togglePinSession}
              onDeleteSession={archiveSession}
              onStartNewDefaultChat={startNewDefaultSessionFromSidebar}
              onStartNewGlobalChat={startNewExplicitGlobalSessionFromSidebar}
              onOpenSettings={() => {
                closeMobileSidebar()
                openDefaultOptionsSettings()
              }}
              currentServerUrl={cloudTunnelClient ? '云账户远程访问' : mobileServerUrl}
              currentServerAlias={mobileServerAlias}
              onOpenServer={mobileShell || cloudTunnelClient ? () => {
                closeMobileSidebar()
                openServerPicker()
              } : undefined}
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

      <main className={cn(
        'flex min-w-0 flex-1 flex-col bg-[var(--quickforge-main-bg)] md:overflow-hidden md:rounded-tl-2xl',
      )}>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[color-mix(in_oklab,var(--border)_34%,transparent)] px-3 pr-20">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => ui.setMobileSidebarOpen(true)} aria-label={t('toggleSidebar')}>
            <Menu className="size-[18px]" />
          </Button>

          <div className="min-w-0 flex-1">
            <div className="flex max-w-full min-w-0 items-center gap-2">
              <div className="min-w-0">
                <div className="min-w-0 truncate text-sm font-semibold text-foreground/92">{sessionTitle(agentManager.currentTitle, currentSessionMetadata?.channelName)}</div>
                {agentManager.currentToolProject?.name || (titleGitStatus?.isGitRepository && titleGitStatus.branch) ? (
                  <div className="mt-0.5 flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs leading-none text-muted-foreground sm:hidden">
                    {agentManager.currentToolProject?.name ? (
                      <div className="flex min-w-0 flex-1 basis-0 items-center gap-1" title={agentManager.currentToolProject.name}>
                        <Folder className="size-3 shrink-0" />
                        <span className="min-w-0 truncate">{agentManager.currentToolProject.name}</span>
                      </div>
                    ) : null}
                    {titleGitStatus?.isGitRepository && titleGitStatus.branch ? (
                      <div className="flex min-w-0 flex-1 basis-0 items-center gap-1" title={titleGitStatus.branch}>
                        <GitBranch className="size-3 shrink-0" />
                        <span className="min-w-0 truncate">{titleGitStatus.branch}</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {!mobileShell && agentManager.currentToolProject?.name ? (
                <div className="hidden h-9 max-w-[220px] shrink-0 items-center gap-2 rounded-full bg-muted/55 px-3 text-sm text-foreground/88 md:inline-flex" title={agentManager.currentToolProject.name}>
                  <Folder className="size-4 text-muted-foreground" />
                  <span className="min-w-0 truncate">{agentManager.currentToolProject.name}</span>
                </div>
              ) : null}
              {!mobileShell && agentManager.currentToolProject?.id && titleGitStatus?.isGitRepository && titleGitStatus.branch ? (
                <div className="relative hidden shrink-0 md:block" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    className="inline-flex h-9 max-w-[220px] items-center gap-2 rounded-full bg-muted/55 px-3 text-sm text-foreground/88 transition-colors hover:bg-muted"
                    onClick={() => setBranchMenuOpen((value) => !value)}
                    aria-label={t('gitBranchMenu')}
                    aria-expanded={branchMenuOpen}
                  >
                    <GitBranch className="size-4 text-muted-foreground" />
                    <span className="min-w-0 truncate">{titleGitStatus.branch}</span>
                    <ChevronDown className="size-4 text-muted-foreground" />
                  </button>
                  {branchMenuOpen ? (
                    <GitBranchMenu
                      projectId={agentManager.currentToolProject.id}
                      currentBranch={titleGitStatus.branch}
                      dirtyCount={titleGitStatus.counts?.total ?? 0}
                      onCheckout={handleCheckoutTitleBranch}
                      onCreated={handleBranchCreated}
                      onOpenGraph={() => {
                        setBranchMenuOpen(false)
                        setGitGraphOpen(true)
                      }}
                      onOpenChanges={() => {
                        setBranchMenuOpen(false)
                        openWorkspaceGitChanges()
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
              {!sideChatTabOpen ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground/85 hover:bg-muted/45 hover:text-foreground/90"
                  onClick={openWorkspaceSideChat}
                  disabled={!agentManager.currentSessionId || needsModelSetup}
                  aria-label={t('sideChatOpen')}
                  title={t('sideChatOpen')}
                >
                  <MessageCircle className="size-[18px]" />
                </Button>
              ) : null}
              <div className="relative shrink-0" onClick={(event) => event.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(ui.conversationMenuOpen && 'bg-muted/45 text-foreground/90')}
                  onClick={() => ui.setConversationMenuOpen((value) => !value)}
                  disabled={!agentManager.currentSessionId || needsModelSetup}
                  aria-label={t('moreOptions')}
                  aria-haspopup="menu"
                  aria-expanded={ui.conversationMenuOpen}
                >
                  <Ellipsis className="size-[18px]" />
                </Button>
                {ui.conversationMenuOpen ? (
                  <div
                    className={cn(
                      'fixed inset-x-2 top-14 z-40 max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 shadow-quickforge md:absolute md:inset-x-auto md:left-0 md:top-full md:z-30 md:mt-1 md:min-w-44 md:max-h-none md:overflow-visible',
                      mobileShell && 'md:fixed md:inset-x-2 md:left-auto md:top-14 md:z-40 md:mt-0 md:max-h-[calc(100dvh-4rem)] md:min-w-0 md:overflow-y-auto lg:inset-x-2 lg:left-auto lg:top-14',
                    )}
                    role="menu"
                    aria-label={t('moreOptions')}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="flex h-10 w-full items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm text-foreground/86 transition-colors hover:bg-muted"
                      onClick={handleToggleCurrentSessionPinned}
                    >
                      {currentSessionPinned ? <PinOff className="size-[18px]" /> : <Pin className="size-[18px]" />}
                      <span>{currentSessionPinned ? t('unpinSession') : t('pinSession')}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex h-10 w-full items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm text-foreground/86 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => {
                        ui.setConversationMenuOpen(false)
                        void forkCurrentSession()
                      }}
                      disabled={!canForkCurrentSession}
                      title={t('forkCurrentSessionTitle')}
                    >
                      <Copy className="size-[18px]" />
                      <span>{t('forkCurrentSession')}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex h-10 w-full items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm text-foreground/86 transition-colors hover:bg-muted"
                      onClick={handleRenameCurrentSession}
                    >
                      <Pencil className="size-[18px]" />
                      <span>{t('renameSession')}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex h-10 w-full items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm text-foreground/86 transition-colors hover:bg-muted"
                      onClick={handleShareCurrentSession}
                    >
                      <Share2 className="size-[18px]" />
                      <span>{t('shareSession')}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex h-10 w-full items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm text-foreground/86 transition-colors hover:bg-muted"
                      onClick={handleArchiveCurrentSession}
                    >
                      <Archive className="size-[18px]" />
                      <span>{t('archiveSession')}</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

        </header>

        <section className="relative flex min-h-0 flex-1 flex-col">
          {visibleLoadingSessionId ? (
            <ConversationLoadingScreen
              key={visibleLoadingSessionId}
              exiting={renderedLoadingSessionId === visibleLoadingSessionId}
            />
          ) : null}
          {needsModelSetup ? (
            <ModelSetupEmptyState
              onAddModel={openModelSettings}
              onUseExample={() => {
                void activateLiteLlmExampleModel().catch((error) => logger.error('Failed to use LiteLLM example:', error))
              }}
            />
          ) : (
              <>
                <ChatConversationSurface className={cn(
                  showNewChatEmptyState ? 'quickforge-empty-chat' : undefined,
                  renderedLoadingSessionId === visibleLoadingSessionId && 'quickforge-conversation-enter',
                )}>
                  {showNewChatEmptyState ? (
                    <div className="quickforge-empty-chat-hero" aria-hidden="true">
                      <h1 className="quickforge-empty-chat-title">{t('newChatEmptyTitle')}</h1>
                    </div>
                  ) : null}
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
                      onAccessModeChange={setAccessMode}
                      onRollbackFromMessage={rollbackFromMessage}
                      onRetryFromMessage={retryFromMessage}
                      onCopyAnswer={copyAnswer}
                      onForkFromMessage={forkFromMessage}
                      onApproveToolCall={handleApproveToolCall}
                      onRejectToolCall={handleRejectToolCall}
                      onAnswerAsk={handleAnswerAsk}
                      onApproveAutoCompact={handleApproveAutoCompact}
                      onRejectAutoCompact={handleRejectAutoCompact}
                      onOpenWorkspaceGitChanges={openWorkspaceGitChanges}
                      onOpenLocalFilePath={openLocalFilePathFromChat}
                      onArtifactsChange={(artifacts) => {
                        setCurrentSessionArtifactsState({
                          projectId: agentManager.currentToolProject?.id,
                          sessionId: agentManager.currentSessionId,
                          artifacts,
                        })
                      }}
                      onContextUsageDisplayChange={handleContextUsageDisplayChange}
                      onInitialRenderReady={handleSessionInitialRenderReady}
                      onInitialRenderError={handleSessionInitialRenderError}
                      capabilities={resolveChatHarnessCapabilities(agentManager.agent?.harness)}
                      disableFork={agentManager.agent?.harness === 'opencode'}
                      bypassClientApiKeyCheck={agentManager.agent?.harness === 'opencode'}
                      allowModelControls={agentManager.agent?.harness !== 'opencode'}
                      restoredDraft={restoredDraft}
                      onRestoredDraftConsumed={consumeRestoredDraft}
                      newChatEmptyState={showNewChatEmptyState}
                    />
                    </Suspense>
                  </ErrorBoundary>
                  {showNewChatEmptyState ? (
                    <NewChatProjectPicker
                      projects={projects}
                      selectedProject={agentManager.chatScope === 'project' ? agentManager.currentToolProject : undefined}
                      onSelectProject={handleSelectEmptyStateProject}
                      onClearProject={handleClearEmptyStateProject}
                      onNewProject={handleSelectEmptyStateNewProject}
                    />
                  ) : null}
                </ChatConversationSurface>
                {showFirstUseGuide ? (
                  <FirstUseGuideCard
                    hasProject={Boolean(agentManager.currentToolProject?.id)}
                    onConfigureModel={openModelSettings}
                    onAddProject={selectProjectDirectory}
                    onCopyExamplePrompt={handleCopyFirstGuidePrompt}
                    onDismiss={handleDismissFirstUseGuide}
                  />
                ) : null}

              </>
          )}
        </section>
        {terminalDockOpen && !remoteClient && agentManager.currentToolProject?.id ? (
          <Suspense fallback={<LazyPanelFallback />}>
            <TerminalDock
              project={agentManager.currentToolProject}
              pendingCommand={pendingTerminalCommand}
              onPendingCommandHandled={handlePendingTerminalCommandHandled}
              onCollapse={() => setTerminalDockOpen(false)}
            />
          </Suspense>
        ) : null}
      </main>
      {agentManager.currentToolProject?.id || workspaceInspectorOpen ? (
        <>
          {workspaceInspectorOpen ? <div aria-hidden="true" className="hidden w-px shrink-0 bg-[color-mix(in_oklab,var(--border)_30%,var(--quickforge-sidebar-bg))] lg:block" /> : null}
          <Suspense fallback={<LazyOverlayFallback />}>
            <WorkspaceInspector
              key={`${workspaceInspectorProjectId}:${workspaceInspectorRuntimeScopeId}`}
              project={agentManager.currentToolProject}
              sessionId={agentManager.currentSessionId}
              runtimeScopeId={workspaceInspectorRuntimeScopeId}
              open={workspaceInspectorOpen}
              onOpenChange={handleWorkspaceInspectorOpenChange}
              onOpenCommitPush={() => setGitCommitDialogOpen(true)}
              onOpenProjectInExplorer={remoteClient ? undefined : openProjectInExplorerWithFeedback}
              onOpenProjectInVSCode={remoteClient ? undefined : openProjectInVSCodeWithFeedback}
              onOpenProjectInIDEA={remoteClient ? undefined : openProjectInIDEAWithFeedback}
              onPreviewArtifact={openArtifactPreview}
              request={ui.workspaceInspectorRequest}
              onRequestHandled={handleWorkspaceInspectorRequest}
              artifacts={agentManager.currentToolProject && currentSessionArtifactsState.projectId === agentManager.currentToolProject.id && currentSessionArtifactsState.sessionId === agentManager.currentSessionId
                ? currentSessionArtifactsState.artifacts
                : []}
              globalTerminalOpen={remoteClient ? false : terminalDockOpen}
              onShowGlobalTerminal={remoteClient ? undefined : () => {
                setArtifactPreviewOpen(false)
                setTerminalDockOpen(true)
              }}
              sideChatAgent={sideChatAgent}
              sideChatInputMemory={sideChatInputMemory}
              sideChatRevision={sideChatRevision}
              sideChatEnabled={Boolean(agentManager.currentSessionId) && !needsModelSetup}
              onSideChatPresenceChange={setSideChatTabOpen}
              onClearSideChat={clearSideChat}
              onFullscreenChange={setWorkspaceInspectorFullscreen}
            />
          </Suspense>
        </>
      ) : null}
      {gitGraphOpen && agentManager.currentToolProject?.id ? (
        <GitGraphDialog
          projectId={agentManager.currentToolProject.id}
          projectName={agentManager.currentToolProject.name}
          onClose={() => setGitGraphOpen(false)}
        />
      ) : null}
      {gitCommitDialogOpen ? (
        <GitCommitPushDialog
          key={agentManager.currentToolProject?.id ?? 'git-commit'}
          open
          projectId={agentManager.currentToolProject?.id}
          status={titleGitStatus}
          onClose={() => setGitCommitDialogOpen(false)}
          onCheckout={handleCheckoutTitleBranch}
          onRefreshStatus={refreshTitleGitStatus}
          onStatusChange={setTitleGitStatus}
          onCompleted={handleGitOperationCompleted}
        />
      ) : null}
    </div>
    {!startupSplashExited ? <StartupSplash exiting /> : null}
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
    {/* 远程客户端断线覆盖层：组件内部自行判断远程模式，桌面端/壳页面不渲染。 */}
    <RemoteTunnelOverlay />
    </>
  )
}

function App() {
  if (isNativeMobileEntry()) return <MobileServerConnectPage />

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
