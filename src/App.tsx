import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { BackgroundTaskStatus } from '@/lib/types'
import {
  ChevronDown,
  Ellipsis,
  Folder,
  GitBranch,
  Info,
  LogOut,
  Menu,
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
  SidebarSessionSortMode,
  SidebarSessionViewMode,
  SkillsScope,
} from '@/lib/types'
import { sessionTitle } from '@/lib/types'
import type { ContextUsageDisplayInfo } from '@/components/chat/context-usage'
import { FirstUseGuideCard } from '@/components/chat/FirstUseGuideCard'
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
import { GitBranchMenu } from '@/components/git/GitBranchMenu'
import { GitCommitPushDialog } from '@/components/git/GitCommitPushDialog'
import { GitToolsPinnedSummary } from '@/components/git/GitToolsPinnedSummary'
import { GitGraphDialog } from '@/components/git/GitGraphDialog'
import { ShareConversationDialog } from '@/components/share/ShareConversationDialog'
import { checkoutGitBranch, getGitStatus, getWorkspaceFile, resolveWorkspacePath } from '@/components/workspace/workspace-api'
import type { GitStatusResponse } from '@/components/workspace/workspace-types'
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
const SharedConversationPage = lazy(() =>
  import('@/components/share/SharedConversationPage').then((m) => ({ default: m.SharedConversationPage })),
)
const WorkspaceInspector = lazy(() =>
  import('@/components/workspace/WorkspaceInspector').then((m) => ({ default: m.WorkspaceInspector })),
)
const TerminalDock = lazy(() =>
  import('@/components/terminal/TerminalDock').then((m) => ({ default: m.TerminalDock })),
)
const WorkspaceReaderDialog = lazy(() =>
  import('@/components/workspace/WorkspaceReaderDialog').then((m) => ({ default: m.WorkspaceReaderDialog })),
)
const SettingsWorkspacePage = lazy(() =>
  import('@/components/settings/SettingsWorkspacePage').then((m) => ({ default: m.SettingsWorkspacePage })),
)

const AUTO_PREVIEW_SEEN_STORAGE_KEY = 'quickforge:auto-preview-seen-signatures'
const MAX_AUTO_PREVIEW_SEEN_SIGNATURES = 200
const QUICKFORGE_RELEASES_URL = 'https://github.com/shawnstack/quickforge/releases/latest'
const STARTUP_SPLASH_MIN_DURATION_MS = 1350
const STARTUP_SPLASH_EXIT_DURATION_MS = 280

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
      <svg className="quickforge-startup-splash-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="startupIconStroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#9ca3af" />
            <stop offset="1" stopColor="#4b5563" />
          </linearGradient>
          <linearGradient id="startupIconBolt" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#374151" />
            <stop offset="1" stopColor="#0f172a" />
          </linearGradient>
        </defs>
        <polygon className="quickforge-startup-splash-outline" points="32,6 52.78,18 52.78,42 32,54 11.22,42 11.22,18" fill="none" stroke="url(#startupIconStroke)" strokeWidth="4.5" strokeLinejoin="round" />
        <polygon className="quickforge-startup-splash-outline-final" points="32,6 52.78,18 52.78,42 32,54 11.22,42 11.22,18" fill="none" stroke="url(#startupIconStroke)" strokeWidth="4.5" strokeLinejoin="round" />
        <path className="quickforge-startup-splash-bolt" d="M37.2 13 L22 34 L30.6 34 L26.8 50 L42.8 26 L33.8 26 Z" fill="url(#startupIconBolt)" />
        <path className="quickforge-startup-splash-bolt-trace" d="M37.2 13 L22 34 L30.6 34 L26.8 50 L42.8 26 L33.8 26 Z" fill="none" stroke="#f8fafc" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path className="quickforge-startup-splash-bolt-highlight" d="M37.2 13 L22 34 L30.6 34 L33.8 26 Z" fill="#e5e7eb" />
      </svg>
      <span className="sr-only">{label}</span>
    </div>
  )
}

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
    setWorkspacePanelView,
  } = ui

  // --- UI state shared with other hooks ---
  const [needsModelSetup, setNeedsModelSetup] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState<RestoredDraft>()
  const [desktopTitlebarMenuOpen, setDesktopTitlebarMenuOpen] = useState(false)
  const [pendingTerminalCommand, setPendingTerminalCommand] = useState<PendingTerminalCommand | null>(null)
  const [terminalDockOpen, setTerminalDockOpen] = useState(false)
  const [currentSessionArtifacts, setCurrentSessionArtifacts] = useState<AiTurnArtifact[]>([])
  const [sidebarSessionViewMode, setSidebarSessionViewMode] = useState<SidebarSessionViewMode>('project')
  const [sidebarSessionSortMode, setSidebarSessionSortMode] = useState<SidebarSessionSortMode>('updatedAt')
  const autoPreviewSignatureRef = useRef('')
  const [currentSessionHoverInfo, setCurrentSessionHoverInfo] = useState<(ContextUsageDisplayInfo & { sessionId?: string }) | undefined>()
  const [titleGitStatus, setTitleGitStatus] = useState<GitStatusResponse | undefined>()
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [gitToolsExpanded, setGitToolsExpanded] = useState(false)
  const [gitCommitDialogOpen, setGitCommitDialogOpen] = useState(false)
  const [gitGraphOpen, setGitGraphOpen] = useState(false)
  const [externalProjectIds, setExternalProjectIds] = useState<Set<string>>(() => new Set())
  const terminalCommandIdRef = useRef(0)
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof initializePiStorage>> | null>(null)
  const [startupSplashDone, setStartupSplashDone] = useState(false)
  const [startupSplashExited, setStartupSplashExited] = useState(false)
  const { toasts, handleTaskComplete, addToast, dismissToast } = useTaskToasts()
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

  // --- Session list + cross-tab sync ---
  const crossTabRef = useRef<ReturnType<typeof useCrossTabSync> | null>(null)

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

  useEffect(() => {
    const timer = window.setTimeout(() => setStartupSplashDone(true), STARTUP_SPLASH_MIN_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [])

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
      loadAgentSession(sessionId)
    },
    [loadAgentSession],
  )

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: unknown }>).detail
      if (typeof detail?.sessionId === 'string') handleToastClick(detail.sessionId)
    }
    window.addEventListener('quickforge:open-session-from-settings', handler)
    return () => window.removeEventListener('quickforge:open-session-from-settings', handler)
  }, [handleToastClick])

  const restoreWorkspaceDraft = useCallback((text: string) => {
    if (!text.trim()) return
    setRestoredDraft({
      id: Date.now(),
      sessionId: agentRef.current?.sessionId,
      text,
    })
  }, [agentRef])

  const openWorkspaceGitChanges = useCallback(() => {
    if (!agentManager.currentToolProject?.id) return
    setArtifactPreviewOpen(false)
    ui.setWorkspaceInspectorFocusTarget(undefined)
    setWorkspacePanelView('changes')
    ui.setWorkspaceInspectorOpen(true)
  }, [agentManager.currentToolProject?.id, setArtifactPreviewOpen, setWorkspacePanelView, ui])

  const refreshTitleGitStatus = useCallback(async () => {
    const projectId = agentManager.currentToolProject?.id
    if (!projectId) {
      setTitleGitStatus(undefined)
      return undefined
    }
    try {
      const status = await getGitStatus(projectId)
      setTitleGitStatus(status)
      return status
    } catch (error) {
      logger.warn('Failed to refresh title git status:', error)
      setTitleGitStatus(undefined)
      return undefined
    }
  }, [agentManager.currentToolProject?.id])

  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshTitleGitStatus() }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshTitleGitStatus])

  const handleCheckoutTitleBranch = useCallback(async (branch: string) => {
    const projectId = agentManager.currentToolProject?.id
    if (!projectId) return
    try {
      const status = await checkoutGitBranch(projectId, branch)
      setTitleGitStatus(status)
      setBranchMenuOpen(false)
      addToast({
        sessionId: agentManager.currentSessionId ?? '',
        title: t('gitBranchSwitched'),
        status: 'idle',
        message: branch,
      })
    } catch (error) {
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
    setArtifactPreviewOpen(false)
    ui.setWebPreviewUrl(workspaceArtifactDiskPath(project.path, path))
    setWorkspacePanelView('browser')
    setWorkspaceInspectorOpen(true)
  }, [agentManager.currentToolProject, setArtifactPreviewOpen, setWorkspaceInspectorOpen, setWorkspacePanelView, ui])

  useEffect(() => {
    const project = agentManager.currentToolProject
    const projectId = project?.id
    if (!projectId) return
    const artifact = findBestPreviewableArtifact(currentSessionArtifacts)
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
      setArtifactPreviewOpen(false)
      if (artifact.kind === 'markdown' || artifact.kind === 'code') {
        // markdown/code 走侧栏 reader 渲染（openFileTab）：
        // markdown → MarkdownReader 富文本；code → MonacoCodeViewer 语法高亮。
        // 不走 browser iframe：iframe 加载这些类型只会显示源码或触发下载。
        setWorkspacePanelView('files')
        ui.setWorkspaceInspectorFocusTarget({ tab: 'files', filePath: artifact.path, nonce: Date.now() })
      } else {
        // html/image 走 browser iframe：html 渲染交互页，image（含 svg/png/jpg…）直接显示。
        ui.setWebPreviewUrl(workspaceArtifactDiskPath(project.path, artifact.path))
        setWorkspacePanelView('browser')
      }
      setWorkspaceInspectorOpen(true)
    })
  }, [agentManager.currentToolProject, currentSessionArtifacts, setArtifactPreviewOpen, setWorkspaceInspectorOpen, setWorkspacePanelView, ui])

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
  const startupReady = ready && startupSplashDone && Boolean(agentManager.agent || needsModelSetup)

  useEffect(() => {
    if (!startupReady) return undefined
    const timer = window.setTimeout(() => setStartupSplashExited(true), STARTUP_SPLASH_EXIT_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [startupReady])

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
    archiveSession,
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
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
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
  }, [setArtifactPreviewOpen])

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

  const handleSelectEmptyStateProject = useCallback((project: ProjectInfo) => {
    void startNewProjectChat(project)
  }, [startNewProjectChat])

  const handleClearEmptyStateProject = useCallback(() => {
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

  // Stable UI setters used by the desktop sidebar handlers below.  Destructuring
  // them keeps the callbacks referentially stable (a useState setter never changes)
  // without dragging the whole `ui` object into the dependency array.
  const { setSkillsDialog, setSidebarOpen } = ui

  const openGlobalSkills = useCallback(() => {
    openSettingsPage('skills')
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

  const openGlobalSkillsFromSidebar = useCallback(() => {
    closeMobileSidebar()
    openGlobalSkills()
  }, [closeMobileSidebar, openGlobalSkills])

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

  if (!startupReady || !startupSplashExited) {
    return <StartupSplash exiting={startupReady} />
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
      className="quickforge-window-toolbar fixed right-2 top-2 z-30 flex items-center gap-1"
      aria-label={t('workspacePanel')}
    >
      {!ui.workspaceInspectorOpen ? (
        <ProjectOpenMenu
          project={agentManager.currentToolProject}
          disabled={needsModelSetup}
          onOpenInExplorer={openProjectInExplorerWithFeedback}
          onOpenInVSCode={openProjectInVSCodeWithFeedback}
          onOpenInIDEA={openProjectInIDEAWithFeedback}
        />
      ) : null}
      {!ui.workspaceInspectorOpen && agentManager.currentToolProject?.id && titleGitStatus?.isGitRepository ? (
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
        />
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          setArtifactPreviewOpen(false)
          setTerminalDockOpen(true)
        }}
        disabled={!agentManager.currentToolProject?.id || needsModelSetup}
        aria-label={t('rightPanelTerminal')}
        title={t('rightPanelTerminal')}
        className={terminalDockOpen ? 'bg-accent text-accent-foreground' : undefined}
      >
        <SquareTerminal className="size-[18px]" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          setArtifactPreviewOpen(false)
          ui.setWorkspaceInspectorOpen((value) => !value)
        }}
        disabled={!agentManager.currentToolProject?.id || needsModelSetup}
        aria-label={ui.workspaceInspectorOpen ? t('workspaceCollapseRightPanel') : t('workspaceExpandRightPanel')}
        title={ui.workspaceInspectorOpen ? t('workspaceCollapseRightPanel') : t('workspaceExpandRightPanel')}
        className={cn(
          'hidden lg:inline-flex',
          ui.workspaceInspectorOpen ? 'bg-accent text-accent-foreground' : undefined,
        )}
      >
        <PanelRight className="size-[18px]" />
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
    ) : (
    <div className="flex h-screen min-h-0 bg-[var(--quickforge-sidebar-bg)] text-foreground">
      <ChatSidebar
        sidebarOpen={ui.sidebarOpen}
        projectsCollapsed={ui.projectsCollapsed}
        pinnedCollapsed={ui.pinnedCollapsed}
        conversationsCollapsed={ui.conversationsCollapsed}
        projects={projects}
        expandedProjectIds={expandedProjectIds}
        activeProject={activeProject}
        currentSessionId={agentManager.currentSessionId}
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
        onToggleProjectExpanded={toggleProjectExpanded}
        onToggleAllProjectsExpanded={toggleAllProjectsExpanded}
        onReorderProjects={reorderProjects}
        onSelectProjectDirectory={selectProjectDirectory}
        onStartNewProjectChat={startNewProjectChat}
        onOpenGlobalSkills={openGlobalSkills}
        onOpenScheduledTasks={openScheduledTasks}
        onOpenProjectSkills={openProjectSkills}
        onOpenProjectInExplorer={openProjectInExplorerWithFeedback}
        onDeleteProject={deleteProjectInline}
        onLoadSession={loadSession}
        onSessionViewModeChange={setSidebarSessionViewMode}
        onSessionSortModeChange={setSidebarSessionSortMode}
        onTogglePinSession={togglePinSession}
        onDeleteSession={archiveSession}
        onStartNewGlobalChat={startNewGlobalSession}
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
              projectsCollapsed={ui.projectsCollapsed}
              pinnedCollapsed={ui.pinnedCollapsed}
              conversationsCollapsed={ui.conversationsCollapsed}
              projects={projects}
              expandedProjectIds={expandedProjectIds}
              activeProject={activeProject}
              currentSessionId={agentManager.currentSessionId}
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
              onToggleProjectExpanded={toggleProjectExpanded}
              onToggleAllProjectsExpanded={toggleAllProjectsExpanded}
              onReorderProjects={reorderProjects}
              onSelectProjectDirectory={() => {
                closeMobileSidebar()
                selectProjectDirectory()
              }}
              onStartNewProjectChat={startNewProjectChatFromSidebar}
              onOpenGlobalSkills={openGlobalSkillsFromSidebar}
              onOpenScheduledTasks={openScheduledTasksFromSidebar}
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
              onSessionViewModeChange={setSidebarSessionViewMode}
              onSessionSortModeChange={setSidebarSessionSortMode}
              onTogglePinSession={togglePinSession}
              onDeleteSession={archiveSession}
              onStartNewGlobalChat={startNewGlobalSessionFromSidebar}
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

      <main className={cn(
        'flex min-w-0 flex-1 flex-col bg-[var(--quickforge-main-bg)] md:overflow-hidden md:rounded-l-2xl',
        ui.workspaceInspectorOpen && agentManager.currentToolProject?.id ? 'lg:rounded-r-2xl' : undefined,
      )}>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] px-3 pr-20">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => ui.setMobileSidebarOpen(true)} aria-label={t('toggleSidebar')}>
            <Menu className="size-[18px]" />
          </Button>

          <div className="min-w-0 flex-1">
            <div className="flex max-w-full min-w-0 items-center gap-2">
              <div className="min-w-0 truncate text-sm font-semibold text-foreground/92">{sessionTitle(agentManager.currentTitle)}</div>
              {agentManager.currentToolProject?.name ? (
                <div className="inline-flex h-9 max-w-[220px] shrink-0 items-center gap-2 rounded-full bg-muted/55 px-3 text-sm text-foreground/88" title={agentManager.currentToolProject.name}>
                  <Folder className="size-4 text-muted-foreground" />
                  <span className="min-w-0 truncate">{agentManager.currentToolProject.name}</span>
                </div>
              ) : null}
              {agentManager.currentToolProject?.id && titleGitStatus?.isGitRepository && titleGitStatus.branch ? (
                <div className="relative shrink-0" onClick={(event) => event.stopPropagation()}>
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
              <div className="relative shrink-0" onClick={(event) => event.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => ui.setConversationMenuOpen((value) => !value)}
                  disabled={!agentManager.currentSessionId || needsModelSetup}
                  aria-label={t('moreOptions')}
                  aria-expanded={ui.conversationMenuOpen}
                >
                  <Ellipsis className="size-[18px]" />
                </Button>
                {ui.conversationMenuOpen ? (
                  <div className="absolute left-0 top-8 z-30 min-w-44 rounded-lg border border-border bg-popover p-1 shadow-quickforge">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm text-foreground/86 transition-colors hover:bg-muted"
                      onClick={handleToggleCurrentSessionPinned}
                    >
                      {currentSessionPinned ? <PinOff className="size-[18px]" /> : <Pin className="size-[18px]" />}
                      <span>{currentSessionPinned ? t('unpinSession') : t('pinSession')}</span>
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm text-foreground/86 transition-colors hover:bg-muted"
                      onClick={handleRenameCurrentSession}
                    >
                      <Pencil className="size-[18px]" />
                      <span>{t('renameSession')}</span>
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm text-foreground/86 transition-colors hover:bg-muted"
                      onClick={handleShareCurrentSession}
                    >
                      <Share2 className="size-[18px]" />
                      <span>{t('shareSession')}</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

        </header>

        <section className="relative flex min-h-0 flex-1 flex-col">
          {needsModelSetup ? (
            <ModelSetupEmptyState
              onAddModel={openModelSettings}
              onUseExample={() => {
                void activateLiteLlmExampleModel().catch((error) => logger.error('Failed to use LiteLLM example:', error))
              }}
            />
          ) : (
              <>
                <div className={cn(
                  'flex min-h-0 flex-1 flex-col',
                  showNewChatEmptyState ? 'quickforge-empty-chat' : undefined,
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
                      onApproveAutoCompact={handleApproveAutoCompact}
                      onRejectAutoCompact={handleRejectAutoCompact}
                      onOpenWorkspaceGitChanges={openWorkspaceGitChanges}
                      onOpenLocalFilePath={openLocalFilePathFromChat}
                      onArtifactsChange={setCurrentSessionArtifacts}
                      onContextUsageDisplayChange={handleContextUsageDisplayChange}
                      disableFork={false}
                      restoredDraft={restoredDraft}
                      newChatEmptyState={showNewChatEmptyState}
                    />
                    </Suspense>
                  </ErrorBoundary>
                  {showNewChatEmptyState ? (
                    <NewChatProjectPicker
                      projects={projects}
                      selectedProject={agentManager.currentToolProject}
                      chatScope={agentManager.chatScope}
                      onSelectProject={handleSelectEmptyStateProject}
                      onClearProject={handleClearEmptyStateProject}
                      onNewProject={handleSelectEmptyStateNewProject}
                    />
                  ) : null}
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

              </>
          )}
        </section>
        {terminalDockOpen && agentManager.currentToolProject?.id ? (
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
      {agentManager.currentToolProject?.id ? (
        <>
          {ui.workspaceInspectorOpen ? <div aria-hidden="true" className="hidden w-px shrink-0 bg-[color-mix(in_oklab,var(--border)_30%,var(--quickforge-sidebar-bg))] lg:block" /> : null}
          <Suspense fallback={<LazyOverlayFallback />}>
            <WorkspaceInspector
              project={agentManager.currentToolProject}
              open={ui.workspaceInspectorOpen}
              onOpenChange={ui.setWorkspaceInspectorOpen}
              view={ui.workspacePanelView}
              onViewChange={ui.setWorkspacePanelView}
              onPreviewArtifact={openArtifactPreview}
              onDraftRequest={restoreWorkspaceDraft}
              focusTarget={ui.workspaceInspectorFocusTarget}
              previewUrl={ui.webPreviewUrl}
              artifacts={currentSessionArtifacts}
            />
          </Suspense>
        </>
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
      {gitGraphOpen && agentManager.currentToolProject?.id ? (
        <GitGraphDialog
          projectId={agentManager.currentToolProject.id}
          projectName={agentManager.currentToolProject.name}
          onClose={() => setGitGraphOpen(false)}
        />
      ) : null}
      <GitCommitPushDialog
        open={gitCommitDialogOpen}
        projectId={agentManager.currentToolProject?.id}
        status={titleGitStatus}
        onClose={() => setGitCommitDialogOpen(false)}
        onCompleted={handleGitOperationCompleted}
      />
    </div>
    )}
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
