import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { BackgroundTaskStatus } from '@/lib/types'
import { DeferredSessionAgent } from '@/lib/deferred-session-agent'
import { createTaskLauncherVisibility } from '@/components/chat/task-launcher-visibility'
import {
  PanelRight,
  SquareTerminal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProjectDirectoryPicker } from '@/components/project-directory-picker'
import { ProjectOpenMenu } from '@/components/project/ProjectOpenMenu'
import { SkillsDialog } from '@/components/skills-dialog'
import { MigrationProgressView } from '@/components/migration-progress-view'
import { DesktopTitlebarMenu } from '@/components/app/DesktopTitlebarMenu'
import { ConversationHeader } from '@/components/app/ConversationHeader'
import { StartupSplash, ConversationLoadingScreen } from '@/components/app/StartupScreens'
import {
  buildConnectionModel,
  DEFAULT_CONNECTION,
  initializePiStorage,
} from '@/lib/pi-chat'
import { t } from '@/lib/i18n'
import { pickNewChatGreetingKey } from '@/lib/new-chat-greeting'
import { cn } from '@/lib/utils'
import {
  OPEN_SUBAGENT_RUN_EVENT,
  normalizeOpenSubagentRunRequest,
  type SubagentRunPayload,
} from '@/lib/subagent-run-detail'
import { OPEN_GOAL_SUMMARY_EVENT } from '@/lib/goal-ui'
import { OPEN_WORKFLOW_RUN_EVENT, normalizeOpenWorkflowRunRequest, workflowRunStore, type WorkflowRunPayload } from '@/lib/workflow-run-payload'
import type { GoalAction, GoalActionOptions } from '@/lib/goal'
import { saveGoalObjective } from '@/lib/goal-edit'
import type {
  AgentAccessMode,
  ProjectInfo,
  QuickForgeSessionMetadata,
  RestoredDraft,
  SkillsScope,
} from '@/lib/types'
import { sessionTitle } from '@/lib/types'
import { isSameContextUsageDisplayInfo, type ContextUsageDisplayInfo } from '@/components/chat/context-usage'
import { FirstUseGuideCard } from '@/components/chat/FirstUseGuideCard'
import { TurnRollbackDialog } from '@/components/chat/FileRollbackDialog'
import { ChatConversationSurface } from '@/components/chat/ChatConversationSurface'
import { ConversationTraceView, type TraceAgentLike } from '@/components/chat/trace/ConversationTraceView'
import { SessionViewPool } from '@/components/chat/SessionViewPool'
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
import { useAppTerminal, useAppTerminalState } from '@/hooks/useAppTerminal'
import { useAppGit, useAppGitMenu, useAppGitState } from '@/hooks/useAppGit'
import { useAppLoadingState, useAppStartupMinimum, useAppLoadingEffects, useAppLoadingTransitions, useAppStartupExit } from '@/hooks/useAppLoadingTransitions'
import { useUpdateCheck } from '@/hooks/useUpdateCheck'
import { useModelActions } from '@/hooks/useModelActions'
import { useChatActions } from '@/hooks/useChatActions'
import { useProjectActions } from '@/hooks/useProjectActions'
import { useSessionActions } from '@/hooks/useSessionActions'
import { useAgentAccessActions } from '@/hooks/useAgentAccessActions'
import { useUIState } from '@/hooks/useUIState'
import { useVisibleRuntimeStatuses } from '@/hooks/useVisibleRuntimeStatuses'
import { HttpStorageBackend } from '@/lib/http-storage-backend'
import { ServerAgent } from '@/lib/server-agent'
import { logger } from '@/lib/logger'
import { getDeletedProjectRecoveryDecision } from '@/lib/deleted-project-recovery'
import { isCurrentProjectRequest } from '@/lib/project-request-guard'
import { openSessionFromSettings } from '@/lib/open-session-from-settings'
import { showAlert } from '@/components/ui/confirm-dialog'
import { ToastContainer } from '@/components/ui/toast'
import { GitCommitPushDialog } from '@/components/git/GitCommitPushDialog'
import { GitToolsPinnedSummary } from '@/components/git/GitToolsPinnedSummary'
import { GitGraphDialog } from '@/components/git/GitGraphDialog'
import { ShareConversationDialog } from '@/components/share/ShareConversationDialog'
import { openWorkspaceExternal, resolveWorkspacePath } from '@/components/workspace/workspace-api'
import type { WorkspaceExternalOpenTarget } from '@/components/workspace/workspace-api'
import {
  shouldHandleWorkspaceInspectorRequest,
  workspaceInspectorRuntimeScopeMatches,
} from '@/components/workspace/workspace-inspector-request'
import type { WorkspaceInspectorOpenRequestInput, WorkspaceInspectorRuntimeScope } from '@/components/workspace/workspace-types'
import { SideChatAgent } from '@/components/workspace/side-chat-agent'
import { subscribeToAgentEvents } from '@/lib/server-agent'
import type { AiTurnArtifact } from '@/lib/tool-artifacts'
import { artifactPreviewMode, documentFormatFromPath, findBestPreviewableArtifact, workspaceArtifactDiskPath } from '@/components/workspace/artifact-preview-utils'
import { MobileServerConnectPage } from '@/components/mobile/MobileServerConnectPage'
import { isMobileShell, isNativeMobileEntry, isRemoteQuickForgeClient, openMobileServerPicker, readMobileServerAliasFromUrl } from '@/lib/mobile-server'
import { initializeSystemNotifications, showTaskSystemNotification } from '@/lib/system-notifications'
import {
  shouldClosePinnedSummaryBeforeInspectorOpen,
  shouldSuspendPinnedSummary,
} from '@/lib/pinned-summary-drag'
import { useSidebarOrdering } from '@/hooks/useSidebarOrdering'
import { usePinnedSummaryModel } from '@/hooks/usePinnedSummaryModel'
import { useProjectExternalOpen } from '@/hooks/useProjectExternalOpen'
import { useDesktopTitlebarMenu } from '@/hooks/useDesktopTitlebarMenu'
import { useAgentApprovalActions } from '@/hooks/useAgentApprovalActions'
import { useTurnFileRollback } from '@/hooks/useTurnFileRollback'
import { useMobileSidebar } from '@/hooks/useMobileSidebar'

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

function LazyPanelFallback() {
  return <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">{t('loading')}</div>
}

function LazyOverlayFallback() {
  return null
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
  const remoteClient = isRemoteQuickForgeClient()
  const mobileShell = isMobileShell()
  const mobileServerUrl = mobileShell ? window.location.origin : undefined
  const mobileServerAlias = mobileShell ? readMobileServerAliasFromUrl() : undefined
  // 移动壳“返回连接页”入口：直连回局域网/Tailscale 服务器列表。
  const openServerPicker = () => openMobileServerPicker('servers')
  // --- Top-level refs (owned by App) ---
  const storageRef = useRef<Awaited<ReturnType<typeof initializePiStorage>> | null>(null)
  const activeModelRef = useRef<Model<Api>>(buildConnectionModel(DEFAULT_CONNECTION))
  const agentAccessModeRef = useRef<AgentAccessMode>('default')
  const activeProjectRef = useRef<ProjectInfo | undefined>(undefined)
  const defaultWorkspaceRef = useRef<ProjectInfo | undefined>(undefined)
  const conversationHeaderRef = useRef<HTMLElement | null>(null)

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
    createProjectInWorkspace,
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
  const terminalState = useAppTerminalState()
  const { pendingTerminalCommand, setPendingTerminalCommand, terminalDockOpen, setTerminalDockOpen } = terminalState
  const [workspaceInspectorFullscreen, setWorkspaceInspectorFullscreen] = useState(false)
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
  // 侧栏区块顺序 + 视图/排序模式（带持久化，桌面/移动两处 ChatSidebar 共享）
  const {
    sidebarSectionOrder,
    handleSidebarSectionReorder,
    sidebarSessionViewMode,
    setSidebarSessionViewMode,
    sidebarSessionSortMode,
    setSidebarSessionSortMode,
  } = useSidebarOrdering()
  // 用户在新对话空状态主动清除项目预选后，本次空状态内不再默认预选上次激活的项目。
  const [emptyStateProjectDismissed, setEmptyStateProjectDismissed] = useState(false)
  const wasNewChatEmptyStateRef = useRef(false)
  const [currentSessionHoverInfo, setCurrentSessionHoverInfo] = useState<(ContextUsageDisplayInfo & { sessionId?: string }) | undefined>()
  const gitState = useAppGitState()
  const { titleGitStatus, setTitleGitStatus, titleGitRequestIdRef, titleGitAbortRef, branchMenuOpen, setBranchMenuOpen, gitToolsExpanded, setGitToolsExpanded, gitCommitDialogOpen, setGitCommitDialogOpen, gitGraphOpen, setGitGraphOpen } = gitState
  const currentToolProjectIdRef = useRef<string | undefined>(undefined)
  const workspaceInspectorScopeRef = useRef<WorkspaceInspectorRuntimeScope>({
    projectId: 'global-workspace',
    runtimeScopeId: '',
  })
  const workspaceInspectorRequestIdRef = useRef(0)
  const chatFileRequestIdRef = useRef(0)
  const loadingState = useAppLoadingState()
  const { startupSplashDone, startupSplashExited, visibleLoadingSessionId, renderedLoadingSessionId } = loadingState
  const recoveringDeletedToolProjectIdRef = useRef<string | undefined>(undefined)
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof initializePiStorage>> | null>(null)
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
    projectTimelineAppending,
    projectHasMore,
    globalAppending,
    projectLoading,
    projectAppending,
    projectLoaded,
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
    viewMode: sidebarSessionViewMode,
    sortMode: sidebarSessionSortMode,
    onBroadcastSessionsChanged: notifySessionsChanged,
  })

  const crossTab = useCrossTabSync({
    onSessionsChanged: () => { refreshSessions() },
    // 切回窗口/跨标签页通知只走 useProject 的 15s 缓存，避免 visibilitychange 时重复请求 /api/project。
    onProjectsChanged: () => { loadProject() },
    onSettingsChanged: () => {
      refreshSessions()
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

  useAppStartupMinimum(loadingState)

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
  // 面板开合改为页面生命周期内的用户选择，默认收起，切换 session 不再自动展开；
  // tab 列表仍按 (projectId, sessionId) 持久化恢复。
  //
  // 这里记的不是布尔值，而是「在哪个 runtimeScope 里打开的」：`workspaceInspectorOpen`
  // 由它和当前 scope 派生。`WorkspaceInspector` 的 key 是 `projectId:runtimeScopeId`，
  // 切 session 只会让子组件重挂载、不会重置 App 级开合状态，所以用布尔量时用户手动
  // 展开过的面板会跨会话残留（表现为「切过去自己弹出来」）。改成按 scope 记之后，
  // scope 一变派生值就是 false，不需要额外 effect 去同步。
  const [workspaceInspectorOpenScopeId, setWorkspaceInspectorOpenScopeId] = useState<string | null>(null)
  const workspaceInspectorOpen = workspaceInspectorOpenScopeId === workspaceInspectorRuntimeScopeId
  const [desktopInspectorViewport, setDesktopInspectorViewport] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(320)
  const handleSidebarWidthChange = useCallback((width: number) => setSidebarWidth(width), [])

  // 1024px 对应 Tailwind lg 断点，与 WorkspaceInspector 的窄视口判定保持一致。
  // 不用 lazy initializer 读取 window.matchMedia：渲染期调用全局/有副作用的 API 会让
  // React Compiler 跳过整个组件优化并触发 preserve-manual-memoization；初值由 effect 内
  // update() 立即校准。防御式写法兼容 vitest node 环境无 matchMedia。
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia('(min-width: 1024px)')
    const update = () => setDesktopInspectorViewport(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const canSuspendPinnedSummaryOnInspectorOpen = useMemo(
    () => shouldSuspendPinnedSummary({
      inspectorOpen: true,
      desktopInspectorViewport,
      mobileShell,
    }),
    [desktopInspectorViewport, mobileShell],
  )
  const pinnedSummarySuspended = workspaceInspectorOpen && canSuspendPinnedSummaryOnInspectorOpen

  const {
    todos: pinnedSummaryTodos,
    subagentRuns: pinnedSummarySubagentRuns,
    backgroundCommands: pinnedSummaryBackgroundCommands,
    runningSubagentRuns: pinnedSummaryRunningSubagentRuns,
    goal: pinnedSummaryGoal,
    goalSessionId: pinnedSummaryGoalSessionId,
    invalidate: invalidatePinnedSummary,
  } = usePinnedSummaryModel({
    agent: agentManager.agent,
    currentSessionId: agentManager.currentSessionId,
  })

  // 对话区视图：只有「打开视图的会话」仍是当前会话时才生效，切会话自动回对话。
  const conversationView: 'chat' | 'trace' =
    ui.conversationViewScope?.scopeId === agentManager.currentRuntimeScopeId
      ? ui.conversationViewScope.view
      : 'chat'
  const setConversationViewScope = ui.setConversationViewScope
  const setConversationView = useCallback((view: 'chat' | 'trace') => {
    setConversationViewScope({ scopeId: agentManager.currentRuntimeScopeId, view })
  }, [setConversationViewScope, agentManager.currentRuntimeScopeId])

  // Goal 分区与 ChatPanelHost 的 Goal 卡同源、同门禁；ACP 排除与共享 store
  // 的草稿/dirty 清理由 usePinnedSummaryModel 统一处理。
  useAppLoadingEffects({ ...loadingState, loadingSessionId: agentManager.loadingSessionId })

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

  useEffect(() => {
    currentToolProjectIdRef.current = agentManager.currentToolProject?.id
    titleGitRequestIdRef.current += 1
    titleGitAbortRef.current?.abort()
    titleGitAbortRef.current = null
    chatFileRequestIdRef.current += 1
  }, [agentManager.currentRuntimeScopeId, agentManager.currentToolProject?.id, titleGitAbortRef, titleGitRequestIdRef])

  const { handleSessionInitialRenderReady, handleSessionInitialRenderError, scheduleSessionLoad } = useAppLoadingTransitions({ ...loadingState, currentSessionIdRef, addToast })

  const handleToastClick = useCallback(
    (sessionId: string) => {
      if (!sessionId) return
      scheduleSessionLoad(sessionId, () => loadAgentSession(sessionId))
    },
    [loadAgentSession, scheduleSessionLoad],
  )

  const consumeRestoredDraft = useCallback((id: number) => {
    setRestoredDraft((current) => current?.id === id ? undefined : current)
  }, [])

  const requestWorkspaceInspector = useCallback((request: WorkspaceInspectorOpenRequestInput, scope = workspaceInspectorScope) => {
    if (!workspaceInspectorRuntimeScopeMatches(scope, workspaceInspectorScopeRef.current)) return false
    workspaceInspectorRequestIdRef.current += 1
    setWorkspaceInspectorRequest({ ...request, scope, id: workspaceInspectorRequestIdRef.current })
    setWorkspaceInspectorOpenScopeId(scope.runtimeScopeId)
    return true
  }, [setWorkspaceInspectorOpenScopeId, setWorkspaceInspectorRequest, workspaceInspectorScope])

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
    }, 0)
    return () => window.clearTimeout(timer)
  }, [clearSideChat, workspaceInspectorRuntimeScopeId])

  useEffect(() => {
    const model = agentManager.agent?.state.model ?? activeModelRef.current
    sideChatAgent.setContext({ sessionId: agentManager.currentSessionId, model })
  }, [agentManager.agent, agentManager.chatPanelRevision, agentManager.currentSessionId, sideChatAgent])

  const openWorkspaceGitChanges = useCallback(() => {
    const projectId = agentManager.currentToolProject?.id
    if (!projectId) return
    setArtifactPreviewOpen(false)
    requestWorkspaceInspector({ projectId, kind: 'review', view: 'changes' })
  }, [agentManager.currentToolProject?.id, requestWorkspaceInspector, setArtifactPreviewOpen])

  const { refreshTitleGitStatus, handleCheckoutTitleBranch, handleBranchCreated, handleGitOperationCompleted } = useAppGit({
    ...gitState,
    projectId: agentManager.currentToolProject?.id,
    currentSessionId: agentManager.currentSessionId,
    currentSessionIdRef,
    currentToolProjectIdRef,
    addToast,
  })

  const openLocalFilePathFromChat = useCallback(async (filePath: string) => {
    const sessionId = agentManager.currentSessionId ?? 'local'
    const normalizedPath = filePath.replace(/[\\\\/]+/g, '/').toLowerCase()
    const isQuickForgeTextAttachment = normalizedPath.includes('/cache/global/tmp/conversations/')
    if (isQuickForgeTextAttachment) {
      try {
        const response = await fetch(`/api/agents/${encodeURIComponent(sessionId)}/open-text-attachment`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: filePath }),
        })
        if (response.ok) return
        const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null
        throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : '打开临时附件失败'
        addToast({ sessionId: agentManager.currentSessionId ?? '', title: '无法打开文件', status: 'error', message })
        return
      }
    }
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
    if (mode === 'document') {
      const format = documentFormatFromPath(path)
      if (format) requestWorkspaceInspector({ projectId, kind: 'document', path, format })
      return
    }
    requestWorkspaceInspector({
      projectId,
      kind: 'browser',
      url: workspaceArtifactDiskPath(project.path, path),
    })
  }, [agentManager.currentToolProject, requestWorkspaceInspector, setArtifactPreviewOpen])

  // 助手回复文件卡片预览：复用产物预览统一入口，按类型分流 Reader/Document/Browser，
  // 与产物列表点开同一文件的行为完全同源。
  const openFilePreviewFromArtifactCard = useCallback((relativePath: string) => {
    const projectId = agentManager.currentToolProject?.id
    if (!projectId) return
    openArtifactPreview(projectId, relativePath)
  }, [agentManager.currentToolProject?.id, openArtifactPreview])

  // 助手回复文件卡片「审查」：打开工作区 Review 面板并直达该文件的 diff tab
  // （git 工作区 diff，与会话影子备份口径无关；文件卡上的 ±行数才是会话口径）。
  const reviewFileChangesFromArtifactCard = useCallback((relativePath: string) => {
    const projectId = agentManager.currentToolProject?.id
    if (!projectId) return
    requestWorkspaceInspector({ projectId, kind: 'review', view: 'changes', path: relativePath })
  }, [agentManager.currentToolProject?.id, requestWorkspaceInspector])

  // 助手回复文件卡片「打开 ▾」外部打开：走工作区 open-external 路由（服务端带
  // 工作区路径安全校验、仅限本机请求）。explorer 定位文件所在目录（默认），
  // vscode / idea 用对应编辑器打开文件；失败提示按目标区分。
  const revealFileFromArtifactCard = useCallback(async (relativePath: string, target: WorkspaceExternalOpenTarget = 'explorer') => {
    const projectId = agentManager.currentToolProject?.id
    if (!projectId) return
    try {
      await openWorkspaceExternal(projectId, relativePath, target)
    } catch (error) {
      const failureKey = target === 'vscode' ? 'openInVSCodeFailed' : target === 'idea' ? 'openInIDEAFailed' : 'assistantArtifactRevealFailed'
      addToast({
        sessionId: agentManager.currentSessionId ?? '',
        title: t(failureKey),
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }, [addToast, agentManager.currentSessionId, agentManager.currentToolProject?.id])

  // 每轮产物卡「撤销本轮」：目标收集 + 会话切换静默关闭 + 轮键记账（见 useTurnFileRollback）。
  const {
    rolledBackTurns,
    fileRollbackTarget,
    closeFileRollback,
    rollbackTurnFromArtifactCard,
    completeFileRollback,
  } = useTurnFileRollback({
    agent: agentManager.agent,
    sessionId: agentManager.currentSessionId,
    projectId: agentManager.currentToolProject?.id,
  })

  // 自动预览的唯一入口：`ChatPanelHost` 在 `tool_execution_end` 时上报「本次工具
  // 执行刚刚产出的文件」，且只由当前活跃视图上报。这是事件而不是状态差分，因此
  // 历史补齐、缓存校准、SSE 重连、回滚都不会误触发打开右侧面板。
  const openLivePresentedArtifacts = useCallback((sessionId: string, artifacts: AiTurnArtifact[]) => {
    const project = agentManager.currentToolProject
    const projectId = project?.id
    if (!projectId || !sessionId || sessionId !== agentManager.currentSessionId) return
    const artifact = findBestPreviewableArtifact(artifacts)
    if (!artifact?.path) return
    const mode = artifactPreviewMode(artifact.path, artifact.kind)
    if (!mode) return
    setArtifactPreviewOpen(false)
    if (mode === 'reader') {
      // Markdown、代码、配置和文本走 Reader；Markdown 使用富文本预览，其余使用 Monaco 只读查看。
      requestWorkspaceInspector({ projectId, kind: 'reader', path: artifact.path })
      return
    }
    if (mode === 'document') {
      const format = documentFormatFromPath(artifact.path)
      if (format) requestWorkspaceInspector({ projectId, kind: 'document', path: artifact.path, format })
      return
    }
    // HTML 和支持的图片走 Browser iframe。
    requestWorkspaceInspector({
      projectId,
      kind: 'browser',
      url: workspaceArtifactDiskPath(project.path, artifact.path),
    })
  }, [agentManager.currentSessionId, agentManager.currentToolProject, requestWorkspaceInspector, setArtifactPreviewOpen])

  useEffect(() => {
    setArtifactPreviewOpen(false)
    setWorkspaceInspectorRequest(undefined)
  }, [agentManager.currentToolProject?.id, setArtifactPreviewOpen, setWorkspaceInspectorRequest])

  // 监听工具卡片预览按钮的桥接事件（事件名与 tool-renderers/shared.tsx 的 PREVIEW_ARTIFACT_EVENT 对应），
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

  // 「查看完整日志」桥接（tool-renderers/shared.tsx 的 VIEW_COMMAND_LOG_EVENT）：
  // 命令日志在 <dataDir>/logs/commands 下（工作区外），走 command-log reader tab。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: unknown; path?: unknown; label?: unknown }>).detail
      const projectId = agentManager.currentToolProject?.id
      const logSessionId = typeof detail?.sessionId === 'string' ? detail.sessionId : ''
      const logPath = typeof detail?.path === 'string' ? detail.path : ''
      if (!projectId || !logSessionId || !logPath) return
      requestWorkspaceInspector({
        projectId,
        kind: 'command-log',
        sessionId: logSessionId,
        path: logPath,
        label: typeof detail?.label === 'string' && detail.label ? detail.label : undefined,
      })
    }
    window.addEventListener('quickforge:view-command-log', handler as EventListener)
    return () => window.removeEventListener('quickforge:view-command-log', handler as EventListener)
  }, [agentManager.currentToolProject?.id, requestWorkspaceInspector])

  // 其它 Goal surface（控制条/卡片）请求打开摘要：只认当前会话 + 当前 Goal，
  // 打开前复用现有收起 Inspector 入口解除 suspension，不新增全局模式。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: unknown; goalId?: unknown; view?: unknown }>).detail
      const sessionId = typeof detail?.sessionId === 'string' ? detail.sessionId : ''
      const goalId = typeof detail?.goalId === 'string' ? detail.goalId : ''
      if (!sessionId || !goalId) return
      if (!pinnedSummaryGoalSessionId || sessionId !== pinnedSummaryGoalSessionId) return
      if (!pinnedSummaryGoal || pinnedSummaryGoal.id !== goalId) return
      requestWorkspaceInspector({ projectId: workspaceInspectorScope.projectId, kind: 'goal', sessionId, goalId, view: detail.view === 'edit' ? 'edit' : 'progress' })
    }
    window.addEventListener(OPEN_GOAL_SUMMARY_EVENT, handler as EventListener)
    return () => window.removeEventListener(OPEN_GOAL_SUMMARY_EVENT, handler as EventListener)
  }, [pinnedSummaryGoal, pinnedSummaryGoalSessionId, requestWorkspaceInspector, workspaceInspectorScope])

  // Goal 动作只走 agent.updateGoal：共享锁由 Inspector / 控制条的
  // goal-ui wrapper 持有，这里不重复包一层。
  const handlePinnedGoalAction = useCallback(async (action: GoalAction, objective?: string, options?: GoalActionOptions) => {
    const agent = agentRef.current
    if (!agent || typeof agent.updateGoal !== 'function' || agent.sessionId !== pinnedSummaryGoalSessionId || agent.state.goal?.id !== pinnedSummaryGoal?.id || agent.state.goal?.sessionId !== pinnedSummaryGoalSessionId) throw new Error(t('goalUnavailable'))
    await agent.updateGoal(action, objective, options)
    invalidatePinnedSummary()
  }, [agentRef, invalidatePinnedSummary, pinnedSummaryGoal?.id, pinnedSummaryGoalSessionId])

  const handleGoalSave = useCallback(async (baselineObjective: string, objective: string, confirmPause: boolean, signal: AbortSignal) => {
    const sessionId = pinnedSummaryGoalSessionId
    const goalId = pinnedSummaryGoal?.id ?? ''
    await saveGoalObjective({
      sessionId, goalId, baselineObjective, objective, confirmPause, signal,
      getCurrent: () => {
        const agent = agentRef.current
        return agent ? { sessionId: agent.sessionId, goal: agent.state.goal ?? null, isStreaming: agent.state.isStreaming } : null
      },
      refresh: async (refreshSignal) => {
        const agent = agentRef.current
        if (!(agent instanceof ServerAgent) || agent.sessionId !== sessionId || agent.state.goal?.id !== goalId || agent.state.goal.sessionId !== sessionId || signal.aborted || refreshSignal.aborted) throw new Error(t('goalUnavailable'))
        const snapshot = await agent.refreshGoalForSave(goalId, refreshSignal)
        if (agentRef.current !== agent || agent.sessionId !== sessionId || agent.state.goal?.id !== goalId || agent.state.goal.sessionId !== sessionId || signal.aborted || refreshSignal.aborted) throw new Error(t('goalUnavailable'))
        invalidatePinnedSummary()
        return snapshot
      },
      update: handlePinnedGoalAction,
    })
  }, [agentRef, handlePinnedGoalAction, invalidatePinnedSummary, pinnedSummaryGoal?.id, pinnedSummaryGoalSessionId])

  const openSubagentRun = useCallback((payload: SubagentRunPayload) => {
    setArtifactPreviewOpen(false)
    requestWorkspaceInspector({ projectId: agentManager.currentToolProject?.id, kind: 'subagent', payload })
  }, [agentManager.currentToolProject?.id, requestWorkspaceInspector, setArtifactPreviewOpen])

  const openWorkflowRun = useCallback((payload: WorkflowRunPayload) => {
    setArtifactPreviewOpen(false)
    requestWorkspaceInspector({ projectId: agentManager.currentToolProject?.id, kind: 'workflow', payload })
  }, [agentManager.currentToolProject?.id, requestWorkspaceInspector, setArtifactPreviewOpen])

  // 点击 subagent 摘要时，在 Workspace Inspector 中打开或激活该次运行的独立 Tab。
  useEffect(() => {
    const handler = (event: Event) => {
      const request = normalizeOpenSubagentRunRequest((event as CustomEvent).detail)
      if (!request?.payload) return
      openSubagentRun(request.payload)
    }
    window.addEventListener(OPEN_SUBAGENT_RUN_EVENT, handler as EventListener)
    return () => window.removeEventListener(OPEN_SUBAGENT_RUN_EVENT, handler as EventListener)
  }, [openSubagentRun])

  // 点击工作流摘要卡时，在 Workspace Inspector 中打开或激活该次运行详情 Tab。
  useEffect(() => {
    const handler = (event: Event) => {
      const request = normalizeOpenWorkflowRunRequest((event as CustomEvent).detail)
      if (!request) return
      const payload = request.payload ?? workflowRunStore.get(request.runId)
      if (!payload) return
      openWorkflowRun(payload)
    }
    window.addEventListener(OPEN_WORKFLOW_RUN_EVENT, handler as EventListener)
    return () => window.removeEventListener(OPEN_WORKFLOW_RUN_EVENT, handler as EventListener)
  }, [openWorkflowRun])

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
    setNeedsModelSetup,
    onStorageReady: setStorage,
  })

  const updateCheck = useUpdateCheck(storageRef, ready)
  const startupReady = ready && startupSplashDone && Boolean(agentManager.agent || needsModelSetup)

  useAppStartupExit({ ...loadingState, startupReady })

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
    setNeedsModelSetup,
    switchActiveProject,
    closeWorkspacePage,
    setRestoredDraft,
  })

  const handleWorkspaceInspectorOpenChange = useCallback((open: boolean) => {
    // 打开时把当前会话记为「打开者」，关闭时清空；关闭不会影响别的会话。
    setWorkspaceInspectorOpenScopeId(open ? workspaceInspectorRuntimeScopeId : null)
  }, [setWorkspaceInspectorOpenScopeId, workspaceInspectorRuntimeScopeId])

  const [taskLauncherIntent] = useState(() => createTaskLauncherVisibility<typeof agentManager.agent>())
  const [taskLauncherAgent, setTaskLauncherAgent] = useState<typeof agentManager.agent>(null)
  const invalidateTaskLauncher = useCallback(() => {
    taskLauncherIntent.invalidate()
    setTaskLauncherAgent(null)
  }, [taskLauncherIntent])
  const runNewChatWithLauncher = useCallback(async (start: () => Promise<'cancelled' | 'reused' | 'created'>, explicit = true) => {
    const version = taskLauncherIntent.begin()
    const result = await start()
    const agent = agentRef.current
    if (taskLauncherIntent.complete(version, agent, explicit && result !== 'cancelled'
      && agent instanceof DeferredSessionAgent && !currentSessionIdRef.current
      && !agent.state.isStreaming && agent.state.messages.length === 0)) {
      setTaskLauncherAgent(agent)
    }
    return result
  }, [agentRef, currentSessionIdRef, taskLauncherIntent])

  const startNewGlobalChatWithInspectorReset = useCallback(async (...args: Parameters<typeof startNewGlobalChat>) => {
    return startNewGlobalChat(...args)
  }, [startNewGlobalChat])

  const startNewProjectChatWithInspectorReset = useCallback(async (...args: Parameters<typeof startNewProjectChat>) => {
    return runNewChatWithLauncher(() => startNewProjectChat(...args))
  }, [runNewChatWithLauncher, startNewProjectChat])

  useEffect(() => {
    if (agentManager.currentSessionId) taskLauncherIntent.invalidate()
    return agentManager.agent?.subscribe((event) => {
      if (event.type === 'message_start' || event.type === 'agent_start') invalidateTaskLauncher()
    })
  }, [agentManager.agent, agentManager.currentSessionId, invalidateTaskLauncher, taskLauncherIntent])

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
  }, [activeProject, agentManager.currentToolProject?.id, projects, ready, setArtifactPreviewOpen, setPendingTerminalCommand, setTerminalDockOpen, setWorkspaceInspectorRequest, startDeferredSession])

  const { setAccessMode } = useAgentAccessActions({
    storageRef,
    agentAccessModeRef,
    setAgentAccessMode,
    agentRef,
    setChatPanelRevision,
    notifySettingsChanged: crossTab.notifySettingsChanged,
  })

  // 工具审批 / ask_user 应答 / auto-compact 审批统一出口（见 useAgentApprovalActions）。
  const {
    handleApproveToolCall,
    handleRejectToolCall,
    handleAnswerAsk,
    handleApproveAutoCompact,
    handleRejectAutoCompact,
  } = useAgentApprovalActions(agentRef)

  const {
    loadSession,
    renameSession,
    togglePinSession,
    archiveSession,
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
    invalidateTaskLauncher()
    scheduleSessionLoad(sessionId, () => loadSession(sessionId))
  }, [invalidateTaskLauncher, loadSession, scheduleSessionLoad])

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

  // 定时任务历史「查看对话」与系统通知点击共用的跳转：预检会话存在性，
  // 不存在时留在当前页提示；存在时关闭设置页再加载会话（加载失败兜底提示）。
  const handleOpenSessionFromSettings = useCallback(
    (sessionId: string) => {
      void openSessionFromSettings({
        sessionId,
        closeSettingsPage,
        scheduleSessionLoad,
        loadSession: loadAgentSession,
        onMissingSession: () => {
          void showAlert(t('sessionNotFound'))
        },
      })
    },
    [closeSettingsPage, loadAgentSession, scheduleSessionLoad],
  )

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: unknown }>).detail
      if (typeof detail?.sessionId === 'string') handleOpenSessionFromSettings(detail.sessionId)
    }
    window.addEventListener('quickforge:open-session-from-settings', handler)
    return () => window.removeEventListener('quickforge:open-session-from-settings', handler)
  }, [handleOpenSessionFromSettings])

  // 桌面标题栏菜单（关于 / 检查更新 / 退出），开合状态与动作见 useDesktopTitlebarMenu。
  const { desktopTitlebarMenuOpen, setDesktopTitlebarMenuOpen, openDesktopAbout, openDesktopUpdatePage, exitDesktopApp } =
    useDesktopTitlebarMenu({ openAboutSettings })

  // --- Derived data ---
  const visibleSessions = useMemo(() => allLoadedSessions, [allLoadedSessions])
  const currentSessionMetadata = useMemo(() => {
    if (!agentManager.currentSessionId) return undefined
    return visibleSessions.find((session) => session.id === agentManager.currentSessionId)
  }, [agentManager.currentSessionId, visibleSessions])
  const currentSessionPinned = Boolean(currentSessionMetadata?.pinnedAt)
  const { statuses: visibleRuntimeStatuses, completedSessionIds, markSessionRead } = useVisibleRuntimeStatuses(visibleSessions)

  const sessionTaskStatus = useCallback((session: QuickForgeSessionMetadata) => {
    return agentManager.taskStatuses[session.id]
      ?? visibleRuntimeStatuses[session.id]
      ?? session.taskStatus
      ?? 'idle'
  }, [agentManager.taskStatuses, visibleRuntimeStatuses])

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

  useAppGitMenu(gitState)

  const { handlePendingTerminalCommandHandled } = useAppTerminal({ ...terminalState, remoteClient, setArtifactPreviewOpen })

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

  // 随机只在进入新对话空状态时锁定一次，避免重渲染导致文案抖动。
  const newChatGreeting = useMemo(
    () => (showNewChatEmptyState ? t(pickNewChatGreetingKey()) : ''),
    [showNewChatEmptyState],
  )

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
    if (taskLauncherAgent && taskLauncherAgent === agentManager.agent) {
      void runNewChatWithLauncher(() => startNewProjectChat(activeProject))
    } else {
      void startNewProjectChat(activeProject)
    }
  }, [activeProject, agentManager.agent, agentManager.chatScope, emptyStateProjectDismissed, runNewChatWithLauncher, showNewChatEmptyState, startNewProjectChat, taskLauncherAgent])

  const startNewDefaultSession = useCallback(() => {
    setEmptyStateProjectDismissed(false)
    if (activeProject) {
      void startNewProjectChatWithInspectorReset(activeProject)
      return
    }
    void runNewChatWithLauncher(startNewGlobalChat)
  }, [activeProject, runNewChatWithLauncher, startNewGlobalChat, startNewProjectChatWithInspectorReset])

  const startNewExplicitGlobalSession = useCallback(() => {
    setEmptyStateProjectDismissed(true)
    void runNewChatWithLauncher(startNewGlobalChat)
  }, [runNewChatWithLauncher, startNewGlobalChat])

  const handleSelectEmptyStateProject = useCallback((project: ProjectInfo) => {
    void runNewChatWithLauncher(() => startNewProjectChat(project), taskLauncherAgent === agentManager.agent)
  }, [agentManager.agent, runNewChatWithLauncher, startNewProjectChat, taskLauncherAgent])

  const handleClearEmptyStateProject = useCallback(() => {
    setEmptyStateProjectDismissed(true)
    void runNewChatWithLauncher(startNewGlobalChat, taskLauncherAgent === agentManager.agent)
  }, [agentManager.agent, runNewChatWithLauncher, startNewGlobalChat, taskLauncherAgent])

  const handleSelectEmptyStateNewProject = useCallback(() => {
    selectProjectDirectory()
  }, [selectProjectDirectory])

  const handleCreateEmptyStateProject = useCallback(
    (name: string) => createProjectInWorkspace(name),
    [createProjectInWorkspace],
  )

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

  const openMcp = useCallback(() => {
    openSettingsPage('mcp')
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

  // 「在资源管理器 / VS Code / IDEA 中打开项目」（见 useProjectExternalOpen）。
  const {
    openProjectInExplorer,
    openProjectInExplorerWithFeedback,
    openProjectInVSCodeWithFeedback,
    openProjectInIDEAWithFeedback,
  } = useProjectExternalOpen()

  const toggleSidebar = useCallback(() => setSidebarOpen((value) => !value), [setSidebarOpen])

  // 移动端侧栏抽屉（Escape/焦点管理 + 先收抽屉再转发桌面动作的 `*FromSidebar` 包装，
  // 见 useMobileSidebar）。
  const {
    closeMobileSidebar,
    mobileSidebarDrawerRef,
    loadSessionFromSidebar,
    startNewDefaultSessionFromSidebar,
    startNewExplicitGlobalSessionFromSidebar,
    startNewProjectChatFromSidebar,
    openGlobalSkillsFromSidebar,
    openMcpFromSidebar,
    openAgentsFromSidebar,
    openScheduledTasksFromSidebar,
    openProjectSkillsFromSidebar,
  } = useMobileSidebar({
    ui,
    loadSessionWithTransition,
    startNewDefaultSession,
    startNewExplicitGlobalSession,
    startNewProjectChatWithInspectorReset,
    openGlobalSkills,
    openMcp,
    openAgents,
    openScheduledTasks,
    openProjectSkills,
  })

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
    <DesktopTitlebarMenu
      menuOpen={desktopTitlebarMenuOpen}
      onToggleMenu={() => setDesktopTitlebarMenuOpen((open) => !open)}
      onOpenAbout={openDesktopAbout}
      onOpenUpdate={openDesktopUpdatePage}
      onExit={exitDesktopApp}
    />
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
      {(
        !workspaceInspectorOpen
        || pinnedSummarySuspended
      ) && (
        pinnedSummaryTodos.length > 0
        || pinnedSummarySubagentRuns.length > 0
        || pinnedSummaryRunningSubagentRuns.length > 0
        || pinnedSummaryBackgroundCommands.length > 0
        || titleGitStatus?.isGitRepository
        || Boolean(pinnedSummaryGoal)
      ) ? (
        <GitToolsPinnedSummary
          projectId={agentManager.currentToolProject?.id}
          status={titleGitStatus}
          todos={pinnedSummaryTodos}
          runningSubagentRuns={pinnedSummaryRunningSubagentRuns}
          finishedSubagentRuns={pinnedSummarySubagentRuns}
          backgroundCommands={pinnedSummaryBackgroundCommands}
          onStopBackgroundCommand={(command) => {
            const sessionId = command.sessionId || agentManager.agent?.sessionId
            if (!sessionId || !command.toolCallId) return
            void fetch(`/api/agents/${encodeURIComponent(sessionId)}/abort-tool`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ toolCallId: command.toolCallId }),
            })
          }}
          goal={pinnedSummaryGoal}
          goalSessionId={pinnedSummaryGoalSessionId}
          onGoalAction={handlePinnedGoalAction}
          expanded={gitToolsExpanded}
          suspended={pinnedSummarySuspended}
          onExpandedChange={setGitToolsExpanded}
          onOpenSubagentRun={(payload) => {
            if (shouldClosePinnedSummaryBeforeInspectorOpen(canSuspendPinnedSummaryOnInspectorOpen)) {
              setGitToolsExpanded(false)
            }
            openSubagentRun(payload)
          }}
          onOpenChanges={() => {
            if (shouldClosePinnedSummaryBeforeInspectorOpen(canSuspendPinnedSummaryOnInspectorOpen)) {
              setGitToolsExpanded(false)
            }
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
          initialAnchorRef={conversationHeaderRef}
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
            'rounded-[10px] hover:bg-[var(--quickforge-sidebar-hover-bg)] disabled:opacity-40',
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
            setWorkspaceInspectorOpenScopeId(null)
          } else {
            if (shouldClosePinnedSummaryBeforeInspectorOpen(canSuspendPinnedSummaryOnInspectorOpen)) {
              setGitToolsExpanded(false)
            }
            setWorkspaceInspectorOpenScopeId(workspaceInspectorRuntimeScopeId)
          }
        }}
        data-pinned-summary-inspector-toggle="true"
        disabled={needsModelSetup}
        aria-label={workspaceInspectorOpen ? t('workspaceCollapseRightPanel') : t('workspaceExpandRightPanel')}
        title={workspaceInspectorOpen ? t('workspaceCollapseRightPanel') : t('workspaceExpandRightPanel')}
        className={cn(
          'rounded-[10px] hover:bg-[var(--quickforge-sidebar-hover-bg)] disabled:opacity-40 inline-flex',
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
        projectTimelineAppending={projectTimelineAppending}
        globalHasMore={globalHasMore}
        globalAppending={globalAppending}
        onLoadMoreGlobal={loadMoreGlobal}
        onLoadMorePinned={loadMorePinned}
        projectHasMore={projectHasMore}
        projectLoading={projectLoading}
        projectAppending={projectAppending}
        projectLoaded={projectLoaded}
        onLoadMoreProject={loadMoreProject}
        onLoadMoreProjectTimeline={loadMoreProjectTimeline}
        sessionTaskStatus={sessionTaskStatus}
        completedSessionIds={completedSessionIds}
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
        onOpenMcp={openMcp}
        onOpenAgents={openAgents}
        onOpenScheduledTasks={openScheduledTasks}
        onOpenProjectSkills={openProjectSkills}
        onOpenProjectInExplorer={remoteClient ? undefined : openProjectInExplorerWithFeedback}
        onDeleteProject={deleteProjectInline}
        onLoadSession={(sessionId) => { markSessionRead(sessionId); loadSessionWithTransition(sessionId) }}
        onSessionViewModeChange={setSidebarSessionViewMode}
        onSessionSortModeChange={setSidebarSessionSortMode}
        onTogglePinSession={togglePinSession}
        onDeleteSession={archiveSession}
        onStartNewDefaultChat={startNewDefaultSession}
        onStartNewGlobalChat={startNewExplicitGlobalSession}
        onOpenSettings={openDefaultOptionsSettings}
        currentServerUrl={mobileServerUrl}
        currentServerAlias={mobileServerAlias}
        onOpenServer={mobileShell ? openServerPicker : undefined}
        updateAvailable={updateCheck.result.updateAvailable}
        latestVersion={updateCheck.result.latestVersion}
        currentVersion={updateCheck.result.currentVersion}
        onOpenUpdate={openAboutSettings}
        onDismissUpdate={updateCheck.dismissUpdate}
        onToggleSidebar={toggleSidebar}
        onWidthChange={handleSidebarWidthChange}
        currentSessionHoverInfo={currentSessionHoverInfo}
      />

      {ui.mobileSidebarOpen ? (
        <div
          ref={mobileSidebarDrawerRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 outline-none md:hidden"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            className="absolute inset-0 backdrop-blur-sm"
            onClick={closeMobileSidebar}
            aria-label={t('toggleSidebar')}
          />
          <div className="absolute inset-y-0 left-0 shadow-quickforge">
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
              projectTimelineAppending={projectTimelineAppending}
              globalHasMore={globalHasMore}
              globalAppending={globalAppending}
              onLoadMoreGlobal={loadMoreGlobal}
              onLoadMorePinned={loadMorePinned}
              projectHasMore={projectHasMore}
              projectLoading={projectLoading}
              projectAppending={projectAppending}
              projectLoaded={projectLoaded}
              onLoadMoreProject={loadMoreProject}
              onLoadMoreProjectTimeline={loadMoreProjectTimeline}
              sessionTaskStatus={sessionTaskStatus}
         completedSessionIds={completedSessionIds}
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
              onOpenMcp={openMcpFromSidebar}
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
              currentServerUrl={mobileServerUrl}
              currentServerAlias={mobileServerAlias}
              onOpenServer={mobileShell ? () => {
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
        'flex min-w-0 flex-1 flex-col bg-[var(--quickforge-main-bg)] md:overflow-hidden md:rounded-tl-2xl md:border-l md:border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)]',
      )}>
        <ConversationHeader
          headerRef={conversationHeaderRef}
          onOpenMobileSidebar={() => ui.setMobileSidebarOpen(true)}
          title={agentManager.currentTitle}
          projectName={agentManager.currentToolProject?.name}
          projectId={agentManager.currentToolProject?.id}
          gitRepository={Boolean(titleGitStatus?.isGitRepository)}
          gitBranch={titleGitStatus?.isGitRepository ? titleGitStatus.branch : undefined}
          gitDirtyCount={titleGitStatus?.counts?.total ?? 0}
          branchMenuOpen={branchMenuOpen}
          onBranchMenuToggle={() => setBranchMenuOpen((value) => !value)}
          onCheckout={handleCheckoutTitleBranch}
          onBranchCreated={handleBranchCreated}
          onOpenGraph={() => {
            setBranchMenuOpen(false)
            setGitGraphOpen(true)
          }}
          onOpenChanges={() => {
            setBranchMenuOpen(false)
            openWorkspaceGitChanges()
          }}
          showViewSwitch={Boolean(agentManager.currentSessionId)}
          conversationView={conversationView}
          onSetConversationView={setConversationView}
          conversationMenuOpen={ui.conversationMenuOpen}
          onConversationMenuToggle={() => ui.setConversationMenuOpen((value) => !value)}
          conversationMenuDisabled={!agentManager.currentSessionId || needsModelSetup}
          currentSessionPinned={currentSessionPinned}
          onTogglePinned={handleToggleCurrentSessionPinned}
          onRename={handleRenameCurrentSession}
          onShare={handleShareCurrentSession}
          onArchive={handleArchiveCurrentSession}
          mobileShell={mobileShell}
        />

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
                  {/*
                    轨迹视图：铺在对话区之上的同级视图（不是浮层、不是侧栏）。
                    刻意不卸载 SessionViewPool —— ChatSurface 的滚动位置、输入框草稿、
                    消息窗口都在它里面，卸载后切回会整树重建；用不透明背景覆盖即可
                    达到「对话区换成轨迹」的视觉效果，且切回零成本。
                  */}
                  {conversationView === 'trace' && agentManager.agent ? (
                    <div className="quickforge-trace-layer">
                      <ConversationTraceView
                        agent={agentManager.agent as unknown as TraceAgentLike}
                        onOpenChat={() => setConversationView('chat')}
                      />
                    </div>
                  ) : null}
                  {showNewChatEmptyState ? (
                    <div className="quickforge-empty-chat-hero" aria-hidden="true">
                      <h1 className="quickforge-empty-chat-title">{newChatGreeting}</h1>
                    </div>
                  ) : null}
                  <ErrorBoundary>
                    <Suspense fallback={<LazyPanelFallback />}>
                    {/*
                      会话视图保活池：非活跃会话的渲染子树保留在 DOM 中（hidden），
                      切回时按行 key 复用 fiber，而不是整树重建。
                      key 与 ChatPanelHost 内部 ChatSurface 的 key 完全一致
                      （runtimeScopeId），所以「同 key 不重挂载」的语义不变；
                      Deferred→Real 提升期间 scope id 不变，也不会因为池而多一次切换。
                    */}
                    <SessionViewPool
                      activeKey={agentManager.currentRuntimeScopeId}
                      activeWeight={agentManager.agent?.state.messages.length ?? 0}
                      activeView={(
                    <ChatPanelHost
                      agent={agentManager.agent}
                      // 稳定 key：Deferred→Real 提升不重挂载 ChatSurface，
                      // 会话切换（scope id 变化）时由外层 SessionViewPool 决定
                      // 是复用已保活的子树还是新建。
                      agentRuntimeScopeId={agentManager.currentRuntimeScopeId}
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
                      onOpenFilePreview={openFilePreviewFromArtifactCard}
                      onRollbackTurn={rollbackTurnFromArtifactCard}
                      rolledBackTurns={rolledBackTurns}
                      onReviewFileChanges={reviewFileChangesFromArtifactCard}
                      onRevealFile={revealFileFromArtifactCard}
                      onArtifactsChange={(artifacts) => {
                        setCurrentSessionArtifactsState({
                          projectId: agentManager.currentToolProject?.id,
                          sessionId: agentManager.currentSessionId,
                          artifacts,
                        })
                      }}
                      onLivePresentArtifacts={openLivePresentedArtifacts}
                      onContextUsageDisplayChange={handleContextUsageDisplayChange}
                      onInitialRenderReady={handleSessionInitialRenderReady}
                      onInitialRenderError={handleSessionInitialRenderError}
                      restoredDraft={restoredDraft}
                      onRestoredDraftConsumed={consumeRestoredDraft}
                      newChatEmptyState={showNewChatEmptyState}
                      taskLauncherEnabled
                      // 主聊天页专属：发送后把该条用户消息锚定到可视区顶部（侧聊/分享页不传）。
                      anchorSentUserMessage
                      taskLauncherVisible={taskLauncherAgent !== null && taskLauncherAgent === agentManager.agent
                        && agentManager.agent instanceof DeferredSessionAgent && !agentManager.currentSessionId && showNewChatEmptyState}
                      onTaskLauncherDismiss={invalidateTaskLauncher}
                      // 轨迹视图盖住对话时，对话区左侧的轮次导航条要一并隐藏——
                      // 它是 host 的绝对定位子节点（z-index 20 > 轨迹层 10），
                      // 不隐藏会浮在轨迹面板上面。
                      hideTurnNavigation={conversationView === 'trace'}
                    />
                      )}
                    />
                    </Suspense>
                  </ErrorBoundary>
                  {showNewChatEmptyState ? (
                    <NewChatProjectPicker
                      projects={projects}
                      selectedProject={agentManager.chatScope === 'project' ? agentManager.currentToolProject : undefined}
                      branch={agentManager.chatScope === 'project' && titleGitStatus?.isGitRepository ? titleGitStatus.branch : undefined}
                      branchMenu={agentManager.chatScope === 'project' && agentManager.currentToolProject?.id && titleGitStatus?.isGitRepository && titleGitStatus.branch ? {
                        projectId: agentManager.currentToolProject.id,
                        dirtyCount: titleGitStatus.counts?.total ?? 0,
                        onCheckout: handleCheckoutTitleBranch,
                        onCreated: handleBranchCreated,
                        onOpenGraph: () => setGitGraphOpen(true),
                        onOpenChanges: openWorkspaceGitChanges,
                      } : undefined}
                      onSelectProject={handleSelectEmptyStateProject}
                      onClearProject={handleClearEmptyStateProject}
                      onNewProject={handleSelectEmptyStateNewProject}
                      onCreateProject={remoteClient ? undefined : handleCreateEmptyStateProject}
                      workspacePath={defaultWorkspace?.path}
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
      {agentManager.currentToolProject?.id || agentManager.currentSessionId || workspaceInspectorOpen ? (
        <>
          {workspaceInspectorOpen ? <div aria-hidden="true" className="hidden w-px shrink-0 bg-[color-mix(in_oklab,var(--border)_30%,var(--quickforge-sidebar-bg))] lg:block" /> : null}
          <Suspense fallback={<LazyOverlayFallback />}>
            <WorkspaceInspector
              goalBinding={pinnedSummaryGoal ? { goal: pinnedSummaryGoal, sessionId: pinnedSummaryGoalSessionId, onAction: handlePinnedGoalAction, onSave: handleGoalSave } : undefined}
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
              onClearSideChat={clearSideChat}
              onFullscreenChange={setWorkspaceInspectorFullscreen}
            conversationMinWidth={440}
               leftSidebarWidth={sidebarWidth}
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
    {fileRollbackTarget && fileRollbackTarget.agent === agentManager.agent
      && fileRollbackTarget.sessionId === agentManager.currentSessionId
      && fileRollbackTarget.projectId === agentManager.currentToolProject?.id ? (
        <TurnRollbackDialog client={fileRollbackTarget.agent} turnIds={fileRollbackTarget.turnIds} onClose={closeFileRollback} onCompleted={completeFileRollback} />
      ) : null}
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
