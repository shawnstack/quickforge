import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { BackgroundTaskStatus } from '@/lib/types'
import { DeferredSessionAgent } from '@/lib/deferred-session-agent'
import { ProjectDirectoryPicker } from '@/components/project-directory-picker'
import { SkillsDialog } from '@/components/skills'
import { BotSettingsDialog, NewBotDialog } from '@/components/bots/BotDialogs'
import { BotMascot } from '@/components/bots/mascot/BotMascot'
import { DesktopTitlebarMenu } from '@/components/app/DesktopTitlebarMenu'
import { PluginUiToasts } from '@/components/plugins/PluginSlot'
import { ConversationHeader } from '@/components/app/ConversationHeader'
import { StartupSplash, ConversationLoadingScreen } from '@/components/app/StartupScreens'
import { StartupErrorScreen } from '@/components/app/StartupErrorScreen'
import { WindowToolbar } from '@/components/app/WindowToolbar'
import {
  buildConnectionModel,
  DEFAULT_CONNECTION,
  initializePiStorage,
} from '@/lib/pi-chat'
import { t } from '@/lib/i18n'
import { invalidateSlashCatalog } from '@/lib/slash-catalog'
import { isBotProject } from '@/lib/bot-project'
import { BOT_CHAT_CAPABILITIES, QUICKFORGE_CHAT_CAPABILITIES } from '@/lib/chat-capabilities'
import { cn } from '@/lib/utils'
import { buildBackgroundTasks } from '@/lib/background-tasks-model'
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
import { useWorkbenchScreensaver } from '@/hooks/useWorkbenchScreensaver'
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
import { useUIStore } from '@/stores/ui-store'
import { useVisibleRuntimeStatuses } from '@/hooks/useVisibleRuntimeStatuses'
import { HttpStorageBackend } from '@/lib/http-storage-backend'
import { ServerAgent } from '@/lib/server-agent'
import { logger } from '@/lib/logger'
import { useAgentSessionEvents } from '@/hooks/useAgentSessionEvents'
import { useAppEventBridges } from '@/hooks/useAppEventBridges'
import { useBotWorkspace } from '@/hooks/useBotWorkspace'
import { useSideChatPanel } from '@/hooks/useSideChatPanel'
import { useNewChatEmptyState } from '@/hooks/useNewChatEmptyState'
import { useChatFileOpener } from '@/hooks/useChatFileOpener'
import { useDeletedProjectRecovery } from '@/hooks/useDeletedProjectRecovery'
import { useArtifactPreviewActions } from '@/hooks/useArtifactPreviewActions'
import { openSessionFromSettings } from '@/lib/open-session-from-settings'
import { showAlert } from '@/components/ui/confirm-dialog'
import { ToastContainer } from '@/components/ui/toast'
import { GitCommitPushDialog } from '@/components/git/GitCommitPushDialog'
import { GitGraphDialog } from '@/components/git/GitGraphDialog'
import { ShareConversationDialog } from '@/components/share/ShareConversationDialog'
import {
  shouldHandleWorkspaceInspectorRequest,
  workspaceInspectorRuntimeScopeMatches,
} from '@/components/workspace/workspace-inspector-request'
import type { WorkspaceInspectorOpenRequestInput, WorkspaceInspectorRuntimeScope } from '@/components/workspace/workspace-types'
import type { AiTurnArtifact } from '@/lib/tool-artifacts'
import { MobileServerConnectPage } from '@/components/mobile/MobileServerConnectPage'
import { isMobileShell, isNativeMobileEntry, isRemoteQuickForgeClient, openMobileServerPicker, readMobileServerAliasFromUrl } from '@/lib/mobile-server'
import { initializeSystemNotifications, showTaskSystemNotification } from '@/lib/system-notifications'
import { shouldSuspendPinnedSummary } from '@/lib/pinned-summary-drag'
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
  const [currentSessionArtifactsState, setCurrentSessionArtifactsState] = useState<{
    projectId?: string
    sessionId?: string
    artifacts: AiTurnArtifact[]
  }>({ artifacts: [] })
  // 侧栏视图/排序模式（带持久化）；区块顺序与回调由 ChatSidebar 直连
  // sidebar-ordering-store 订阅（桌面/移动两处实例共享）。
  const { sidebarSessionViewMode, sidebarSessionSortMode } = useSidebarOrdering()
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
    onProjectsChanged: () => { loadProject(); invalidateSlashCatalog() },
    onSettingsChanged: () => {
      refreshSessions()
      invalidateSlashCatalog()
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
  const workspaceInspectorScope = useMemo<WorkspaceInspectorRuntimeScope>(() => ({
    projectId: workspaceInspectorProjectId,
    runtimeScopeId: workspaceInspectorRuntimeScopeId,
  }), [workspaceInspectorProjectId, workspaceInspectorRuntimeScopeId])
  useLayoutEffect(() => {
    workspaceInspectorScopeRef.current = workspaceInspectorScope
  }, [workspaceInspectorScope])
  // 面板开合是页面生命周期内的瞬时选择，默认收起，不做任何跨会话记忆；tab 列表仍按
  // (projectId, sessionId) 持久化恢复。
  //
  // 这里记的不是布尔值，而是「在哪个 runtimeScope 里打开的」：`workspaceInspectorOpen`
  // 由它和当前 scope 派生。`WorkspaceInspector` 的 key 是 `projectId:runtimeScopeId`，
  // 切 session 只会让子组件重挂载、不会重置 App 级开合状态，所以用布尔量时用户手动
  // 展开过的面板会跨会话残留（表现为「切过去自己弹出来」）。改成按 scope 记之后，
  // scope 一变派生值就是 false。但只按 scope 记仍会记住每个会话的开合——切走再切回
  // 曾展开的会话会重新弹开；因此下方在 scope 变化的渲染里同步清空记录，切换会话后
  // 一律默认收起，开合不做任何记忆。
  // 「打开者」scope 与左栏宽度均为 App 级 UI 状态，权威源在 ui-store（zustand
  // 迁移守则：selector 订阅、Dispatch 兼容 setter）；App 只读消费，不再本地
  // useState 重建第二份。
  const workspaceInspectorOpenScopeId = useUIStore((s) => s.workspaceInspectorOpenScopeId)
  const setWorkspaceInspectorOpenScopeId = useUIStore((s) => s.setWorkspaceInspectorOpenScopeId)
  // scope 变化时在渲染期同步清空「打开者」记录（React 官方的 render 期调态模式，
  // 避免 effect 级联渲染，也绕开 react-hooks/set-state-in-effect）。observed 记录
  // 只是「上次见到的 scope」派生辅助量（非权威状态），留在本地；清空写入 store。
  const [workspaceInspectorObservedScopeId, setWorkspaceInspectorObservedScopeId] = useState(workspaceInspectorRuntimeScopeId)
  if (workspaceInspectorObservedScopeId !== workspaceInspectorRuntimeScopeId) {
    setWorkspaceInspectorObservedScopeId(workspaceInspectorRuntimeScopeId)
    setWorkspaceInspectorOpenScopeId(null)
  }
  const workspaceInspectorOpen = workspaceInspectorOpenScopeId === workspaceInspectorRuntimeScopeId
  const [desktopInspectorViewport, setDesktopInspectorViewport] = useState(false)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const handleSidebarWidthChange = useCallback((width: number) => setSidebarWidth(width), [setSidebarWidth])

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
    messages: pinnedSummaryMessages,
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

  // 后台任务统一视图：运行中来自 backgroundCommands 快照，已完成/失败/超时/已停止
  // 派生自 toolResult 消息（settleBackgroundCommandToolResult 回灌的终态 details）。
  const backgroundTasks = useMemo(
    () => buildBackgroundTasks({
      running: pinnedSummaryBackgroundCommands,
      messages: pinnedSummaryMessages as unknown as readonly { role?: string; toolCallId?: string; details?: unknown }[],
      sessionId: agentManager.currentSessionId,
    }),
    [agentManager.currentSessionId, pinnedSummaryBackgroundCommands, pinnedSummaryMessages],
  )

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

  const {
    sideChatAgent,
    sideChatInputMemory,
    sideChatRevision,
    clearSideChat,
  } = useSideChatPanel({
    agent: agentManager.agent,
    chatPanelRevision: agentManager.chatPanelRevision,
    currentSessionId: agentManager.currentSessionId,
    runtimeScopeId: workspaceInspectorRuntimeScopeId,
    activeModelRef,
  })

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

  const { openLocalFilePathFromChat } = useChatFileOpener({
    currentSessionId: agentManager.currentSessionId,
    currentToolProjectId: agentManager.currentToolProject?.id,
    addToast,
    requestWorkspaceInspector,
    workspaceInspectorScopeRef,
    currentToolProjectIdRef,
    chatFileRequestIdRef,
  })

  const {
    openArtifactPreview,
    openFilePreviewFromArtifactCard,
    reviewFileChangesFromArtifactCard,
    revealFileFromArtifactCard,
    openLivePresentedArtifacts,
  } = useArtifactPreviewActions({
    currentToolProject: agentManager.currentToolProject,
    currentSessionId: agentManager.currentSessionId,
    addToast,
    requestWorkspaceInspector,
    setArtifactPreviewOpen,
    setWorkspaceInspectorRequest,
  })

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

  const { openSubagentRun } = useAppEventBridges({
    currentSessionId: agentManager.currentSessionId,
    currentToolProjectId: agentManager.currentToolProject?.id,
    pinnedSummaryGoal,
    pinnedSummaryGoalSessionId,
    requestWorkspaceInspector,
    setArtifactPreviewOpen,
  })

  useAgentSessionEvents({
    addToast,
    loadProjectSessions,
    refreshSessions,
    setExpandedProjectIds,
    updateSessionTitle,
    upsertSessionMetadata,
  })

  const { ready, startupError, retryBootstrap } = useAppBootstrap({
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

  // bot 的会话就是它的长期记忆：能力位里关掉 fork / 回滚 / 重试（文件回滚
  // `/rollback-turn` 不在此列，照常可用），服务端 `rollbackSessionMessages`
  // 另有无条件 403 兜底。判据用「侧栏在 bot 模式」或「当前会话落在 bot 项目」：
  // 后者是数据真相，前者覆盖刚切模式、项目还没切过来的那一瞬。
  const botMode = useUIStore((s) => s.botMode)
  useWorkbenchScreensaver()
  const chatCapabilities = botMode || isBotProject(agentManager.currentToolProject)
    ? BOT_CHAT_CAPABILITIES
    : QUICKFORGE_CHAT_CAPABILITIES

  const {
    startNewGlobalChat,
    startNewProjectChat,
    rollbackFromMessage,
    rollbackForResend,
    retryFromMessage,
    copyAnswer,
    forkFromMessage,
  } = useChatActions({
    activeModelRef,
    activeProjectRef,
    currentChatScopeRef,
    currentSessionIdRef,
    taskMapRef,
    agentRef,
    createAgent,
    startDeferredSession,
    syncSessionUI,
    setChatPanelRevision,
    refreshSessions,
    capabilities: chatCapabilities,
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

  const {
    showNewChatEmptyState,
    newChatGreeting,
    startNewDefaultSession,
    startNewExplicitGlobalSession,
    startNewGlobalChatWithInspectorReset,
    startNewProjectChatWithInspectorReset,
    handleSelectEmptyStateProject,
    handleClearEmptyStateProject,
    handleSelectEmptyStateNewProject,
    handleCreateEmptyStateProject,
    taskLauncherAgent,
    invalidateTaskLauncher,
  } = useNewChatEmptyState({
    needsModelSetup,
    agent: agentManager.agent,
    agentRef,
    currentSessionIdRef,
    currentSessionId: agentManager.currentSessionId,
    chatScope: agentManager.chatScope,
    activeProject,
    startNewGlobalChat,
    startNewProjectChat,
    selectProjectDirectory,
    createProjectInWorkspace,
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

  useDeletedProjectRecovery({
    ready,
    currentToolProject: agentManager.currentToolProject,
    projects,
    activeProject,
    startDeferredSession,
    setCurrentSessionArtifactsState,
    setWorkspaceInspectorRequest,
    setArtifactPreviewOpen,
    setPendingTerminalCommand,
    setTerminalDockOpen,
    chatFileRequestIdRef,
  })

  const { setAccessMode } = useAgentAccessActions({
    storageRef,
    agentAccessModeRef,
    setAgentAccessMode,
    agentRef,
    setChatPanelRevision,
    notifySettingsChanged: crossTab.notifySettingsChanged,
  })

  // 工具审批 / ask_user 应答统一出口（见 useAgentApprovalActions）。
  const {
    handleApproveToolCall,
    handleRejectToolCall,
    handleAnswerAsk,
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
    (sessionId: string, options?: { skipMetadataPrecheck?: boolean }) => {
      void openSessionFromSettings({
        sessionId,
        skipMetadataPrecheck: options?.skipMetadataPrecheck === true,
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

  // 设置页/OS 系统通知打开会话的桥接请求（react-settings-tabs、system-notifications
  // 经 useUIStore 发起，原 window CustomEvent 桥已由 ui-store 的请求信号替代）。
  const openSessionRequest = useUIStore((s) => s.openSessionRequest)
  useEffect(() => {
    const request = openSessionRequest
    if (!request) return
    handleOpenSessionFromSettings(request.sessionId, {
      skipMetadataPrecheck: request.skipMetadataPrecheck === true,
    })
    useUIStore.getState().clearOpenSessionRequest()
  }, [openSessionRequest, handleOpenSessionFromSettings])

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

  // ChatSidebar is memoized. An inline `onLoadSession` here would invalidate it
  // on every App render (structural agent events included) and re-render every
  // visible session row for nothing.
  const handleDesktopSidebarLoadSession = useCallback((sessionId: string) => {
    markSessionRead(sessionId)
    loadSessionWithTransition(sessionId)
  }, [loadSessionWithTransition, markSessionRead])

  const sessionTaskStatus = useCallback((session: QuickForgeSessionMetadata) => {
    return agentManager.taskStatuses[session.id]
      ?? visibleRuntimeStatuses[session.id]
      ?? session.taskStatus
      ?? 'idle'
  }, [agentManager.taskStatuses, visibleRuntimeStatuses])

  // Read through stable locals: depending on the whole `ui` object would
  // re-attach these window listeners on every App render.
  const { conversationMenuOpen, setConversationMenuOpen } = ui

  useEffect(() => {
    if (!conversationMenuOpen) return
    const closeMenu = () => setConversationMenuOpen(false)
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
  }, [conversationMenuOpen, setConversationMenuOpen])

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

  // 「新对话空态」= 真的没有会话：判定与新建路由见 useNewChatEmptyState；
  // 这里只保留 first-use 引导与既有 JSX 装配。

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
  // them keeps the callbacks referentially stable (a store action never changes)
  // without dragging the whole `ui` object into the dependency array.
  const { setSkillsDialog } = ui

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

  // ---------------------------------------------------------------- bot 模式
  // 一个 bot = 一条持久会话 + 一个独占目录。侧栏换成 bot 列表，主区仍然复用
  // 普通会话视图 —— 所以「bot 的对话界面和普通对话一样」是零成本的。
  // 列表加载 / 增删改 / 模式切换补偿 / 吉祥物派生见 useBotWorkspace；
  // botMode 本身仍在上方读（历史动作的能力表要用）。
  const {
    botShell,
    activeBot,
    mascotState,
    mascotStrolling,
    mascotAction,
    handleComposerSend,
    composerMascotVisible,
    newBotOpen,
    newBotPending,
    newBotError,
    closeNewBotDialog,
    handleCreateBot,
    botSettings,
    closeBotSettings,
    handleBotChanged,
    handleDeleteBot,
  } = useBotWorkspace({
    needsModelSetup,
    currentSessionId: agentManager.currentSessionId,
    agent: agentManager.agent,
    completedSessionIds,
    startNewDefaultSession,
  })

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
    return <StartupErrorScreen startupError={startupError} onRetry={retryBootstrap} />
  }

  if (!startupReady) {
    return <StartupSplash />
  }

  // Desktop and mobile drawers render the same sidebar; only the entry-point
  // callbacks differ (mobile closes the drawer first). Shared here so the two
  // prop lists cannot drift apart.
  const sidebarCommonProps = {
    botShell,
    projects,
    expandedProjectIds,
    activeProject,
    currentSessionId: agentManager.currentSessionId,
    loadingSessionId: agentManager.loadingSessionId,
    globalSessions,
    pinnedSessions,
    pinnedHasMore,
    pinnedLoading,
    sessionsForProject,
    projectTimelineSessions,
    projectTimelineHasMore,
    projectTimelineLoading,
    projectTimelineAppending,
    globalHasMore,
    globalAppending,
    onLoadMoreGlobal: loadMoreGlobal,
    onLoadMorePinned: loadMorePinned,
    projectHasMore,
    projectLoading,
    projectAppending,
    projectLoaded,
    onLoadMoreProject: loadMoreProject,
    onLoadMoreProjectTimeline: loadMoreProjectTimeline,
    sessionTaskStatus,
    completedSessionIds,
    selectingProject,
    onToggleProjectExpanded: toggleProjectExpanded,
    onToggleAllProjectsExpanded: toggleAllProjectsExpanded,
    onReorderProjects: reorderProjects,
    onDeleteProject: deleteProjectInline,
    onTogglePinSession: togglePinSession,
    onDeleteSession: archiveSession,
    currentServerUrl: mobileServerUrl,
    currentServerAlias: mobileServerAlias,
    updateAvailable: updateCheck.result.updateAvailable,
    latestVersion: updateCheck.result.latestVersion,
    currentVersion: updateCheck.result.currentVersion,
    onDismissUpdate: updateCheck.dismissUpdate,
    currentSessionHoverInfo,
  }

  // bot 目录是注册项目（工具要它的 path 当 workspaceRoot），但它不是「用户的
  // 项目」：顶栏项目胶囊、分支菜单和空态项目胶囊都不该把它当项目显示。
  // bot 模式下连普通项目也不显示——那时主区属于 bot，项目/分支是另一套语境的控件。
  const headerProject = botMode || isBotProject(agentManager.currentToolProject)
    ? undefined
    : agentManager.currentToolProject
  const headerGitRepository = !botMode && Boolean(titleGitStatus?.isGitRepository)
  const headerGitBranch = headerGitRepository ? titleGitStatus?.branch : undefined
  const headerGitDirtyCount = headerGitRepository ? (titleGitStatus?.counts?.total ?? 0) : 0
  // 空态胶囊同理：只在「普通项目会话」里成立。
  const emptyStateProject = agentManager.chatScope === 'project' && !botMode && !isBotProject(agentManager.currentToolProject)
    ? agentManager.currentToolProject
    : undefined
  const emptyStateBranch = emptyStateProject && titleGitStatus?.isGitRepository ? titleGitStatus.branch : undefined

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
    <WindowToolbar
      fullscreen={workspaceInspectorFullscreen}
      remoteClient={remoteClient}
      mobileShell={mobileShell}
      workspaceInspectorOpen={workspaceInspectorOpen}
      workspaceInspectorRuntimeScopeId={workspaceInspectorRuntimeScopeId}
      workspaceInspectorProjectId={workspaceInspectorProjectId}
      needsModelSetup={needsModelSetup}
      terminalDockOpen={terminalDockOpen}
      gitToolsExpanded={gitToolsExpanded}
      pinnedSummarySuspended={pinnedSummarySuspended}
      canSuspendPinnedSummaryOnInspectorOpen={canSuspendPinnedSummaryOnInspectorOpen}
      currentToolProject={agentManager.currentToolProject}
      currentAgentSessionId={agentManager.agent?.sessionId}
      titleGitStatus={titleGitStatus}
      conversationHeaderRef={conversationHeaderRef}
      pinnedSummaryTodos={pinnedSummaryTodos}
      pinnedSummarySubagentRuns={pinnedSummarySubagentRuns}
      pinnedSummaryRunningSubagentRuns={pinnedSummaryRunningSubagentRuns}
      pinnedSummaryBackgroundCommands={pinnedSummaryBackgroundCommands}
      pinnedSummaryGoal={pinnedSummaryGoal}
      pinnedSummaryGoalSessionId={pinnedSummaryGoalSessionId}
      onGoalAction={handlePinnedGoalAction}
      onCheckout={handleCheckoutTitleBranch}
      onBranchCreated={handleBranchCreated}
      onSetGitToolsExpanded={setGitToolsExpanded}
      onSetGitCommitDialogOpen={setGitCommitDialogOpen}
      onSetGitGraphOpen={setGitGraphOpen}
      onOpenSubagentRun={openSubagentRun}
      onOpenWorkspaceGitChanges={openWorkspaceGitChanges}
      onOpenProjectInExplorerWithFeedback={openProjectInExplorerWithFeedback}
      onOpenProjectInVSCodeWithFeedback={openProjectInVSCodeWithFeedback}
      onOpenProjectInIDEAWithFeedback={openProjectInIDEAWithFeedback}
      onSetTerminalDockOpen={setTerminalDockOpen}
      onSetArtifactPreviewOpen={setArtifactPreviewOpen}
      onSetWorkspaceInspectorOpenScopeId={setWorkspaceInspectorOpenScopeId}
      onRequestWorkspaceInspector={requestWorkspaceInspector}
    />
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
      <PluginUiToasts />
      <ChatSidebar
        {...sidebarCommonProps}
        onSelectProjectDirectory={remoteClient ? undefined : selectProjectDirectory}
        onStartNewProjectChat={startNewProjectChatWithInspectorReset}
        onOpenGlobalSkills={openGlobalSkills}
        onOpenMcp={openMcp}
        onOpenAgents={openAgents}
        onOpenScheduledTasks={openScheduledTasks}
        onOpenProjectSkills={openProjectSkills}
        onOpenProjectInExplorer={remoteClient ? undefined : openProjectInExplorerWithFeedback}
        onLoadSession={handleDesktopSidebarLoadSession}
        onStartNewDefaultChat={startNewDefaultSession}
        onStartNewGlobalChat={startNewExplicitGlobalSession}
        onOpenSettings={openDefaultOptionsSettings}
        onOpenServer={mobileShell ? openServerPicker : undefined}
        onOpenUpdate={openAboutSettings}
        onWidthChange={handleSidebarWidthChange}
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
              {...sidebarCommonProps}
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
              onLoadSession={loadSessionFromSidebar}
              onStartNewDefaultChat={startNewDefaultSessionFromSidebar}
              onStartNewGlobalChat={startNewExplicitGlobalSessionFromSidebar}
              onOpenSettings={() => {
                closeMobileSidebar()
                openDefaultOptionsSettings()
              }}
              onOpenServer={mobileShell ? () => {
                closeMobileSidebar()
                openServerPicker()
              } : undefined}
              onOpenUpdate={() => {
                closeMobileSidebar()
                openAboutSettings()
              }}
            />
          </div>
        </div>
      ) : null}

      <main className={cn(
        'flex min-w-0 flex-1 flex-col bg-[var(--quickforge-main-bg)] md:overflow-hidden md:rounded-tl-2xl md:border-l md:border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)]',
      )}>
        <ConversationHeader
          headerRef={conversationHeaderRef}
          title={agentManager.currentTitle}
          projectName={headerProject?.name}
          projectId={headerProject?.id}
          gitRepository={headerGitRepository}
          gitBranch={headerGitBranch}
          gitDirtyCount={headerGitDirtyCount}
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
                      capabilities={chatCapabilities}
                      // 稳定 key：Deferred→Real 提升不重挂载 ChatSurface，
                      // 会话切换（scope id 变化）时由外层 SessionViewPool 决定
                      // 是复用已保活的子树还是新建。
                      agentRuntimeScopeId={agentManager.currentRuntimeScopeId}
                      // bot 模式下把吉祥物贴在输入框顶上：闲着的时候偶尔走一小段，
                      // 其余时间安静站着；有状态就演思考/干活/提醒。
                      // bot 模式下默认渲染（拿不到 activeBot 时用默认外观，免得「看不见」
                      // 被误读成「坏了」）；bot 设置里关掉「在输入框上方显示」才不渲染。
                      composerMascot={botMode && composerMascotVisible
                        ? (
                          <BotMascot
                            // 小动作组（打招呼/伸懒腰/打哈欠/偷看打字/被夸）只在 idle 生效，
                            // 由 use-mascot-actions gate；散步优先级最高。
                            state={mascotStrolling ? 'walk' : mascotAction ?? mascotState}
                            // 画布 512 里球只占 300（余量留给跳跃），所以尺寸不等于球径：
                            // size=79 的实际球径约 46.3px。给过 64（球径 37px）被说「没在动」，
                            // 又给过 104（球径 61px）被说「太大了」—— 79 是球径下限 46px
                            // （bot-mascot.test.ts 锁的）之上能取到的最小整数；
                            // 球顶往上探约 46px，压不到最后一条消息。
                            size={79}
                            look={activeBot?.mascot}
                            stroll={mascotStrolling}
                            // 互动彩蛋（悬停抬眼 / 点一下被戳 / 连点转晕）只给这一只：
                            // 待机、犯困时才响应，走路和忙状态不理人；事件只挂在球本体，
                            // 空白处照常穿透到下面的输入框。侧栏和设置预览不加。
                            interactive
                          />
                        )
                        : undefined}
                      // 发送文本回调：bot 吉祥物的「被夸」检测（夸奖词 → 回答完演得意）
                      onComposerSend={handleComposerSend}
                      onModelSelect={openCustomModelSelector}
                      revision={agentManager.chatPanelRevision}
                      agentAccessMode={agentAccessMode}
                      workspaceToolsEnabled={Boolean(agentManager.currentToolProject?.id)}
                      project={agentManager.currentToolProject}
                      projectId={agentManager.currentToolProject?.id}
                      chatScope={agentManager.chatScope}
                      onAccessModeChange={setAccessMode}
                      onRollbackFromMessage={rollbackFromMessage}
                      onRollbackForResend={rollbackForResend}
                      onRetryFromMessage={retryFromMessage}
                      onCopyAnswer={copyAnswer}
                      onForkFromMessage={forkFromMessage}
                      onApproveToolCall={handleApproveToolCall}
                      onRejectToolCall={handleRejectToolCall}
                      onAnswerAsk={handleAnswerAsk}
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
                  {showNewChatEmptyState && !botMode ? (
                    <NewChatProjectPicker
                      projects={projects}
                      selectedProject={emptyStateProject}
                      branch={emptyStateBranch}
                      branchMenu={emptyStateProject?.id && emptyStateBranch ? {
                        projectId: emptyStateProject.id,
                        dirtyCount: titleGitStatus?.counts?.total ?? 0,
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
              backgroundTasks={backgroundTasks}
              onStopBackgroundTask={(task) => {
                const stopSessionId = task.sessionId || agentManager.agent?.sessionId
                if (!stopSessionId || !task.toolCallId) return
                void fetch(`/api/agents/${encodeURIComponent(stopSessionId)}/abort-tool`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ toolCallId: task.toolCallId }),
                })
              }}
              onOpenBackgroundTaskLog={(task) => {
                if (!task.outputFile) return
                const logSessionId = task.sessionId || agentManager.currentSessionId
                if (!logSessionId) return
                window.dispatchEvent(new CustomEvent('quickforge:view-command-log', {
                  detail: { sessionId: logSessionId, path: task.outputFile, label: task.description || task.command },
                }))
              }}
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
    <NewBotDialog
      key={newBotOpen ? 'new-bot-open' : 'new-bot-closed'}
      open={newBotOpen}
      pending={newBotPending}
      error={newBotError}
      onCancel={closeNewBotDialog}
      onCreate={(name) => { void handleCreateBot(name) }}
    />
    <BotSettingsDialog
      key={botSettings?.id ?? 'no-bot'}
      bot={botSettings}
      onClose={() => { closeBotSettings(null) }}
      onChanged={handleBotChanged}
      onDeleted={(botId) => { void handleDeleteBot(botId) }}
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
