import { lazy, Suspense } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { ConversationHeader } from '@/components/app/ConversationHeader'
import { ConversationLoadingScreen } from '@/components/app/StartupScreens'
import { BotMascot } from '@/components/bots/mascot/BotMascot'
import { ChatConversationSurface } from '@/components/chat/ChatConversationSurface'
import { ConversationTraceView, type TraceAgentLike } from '@/components/chat/trace/ConversationTraceView'
import { SessionViewPool } from '@/components/chat/SessionViewPool'
import { ModelSetupEmptyState } from '@/components/chat/ModelSetupEmptyState'
import { NewChatProjectPicker } from '@/components/chat/NewChatProjectPicker'
import { FirstUseGuideCard } from '@/components/chat/FirstUseGuideCard'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import type { AgentManager } from '@/hooks/useAgentManager'
import type { useAppGitState } from '@/hooks/useAppGit'
import type { useAppLoadingState } from '@/hooks/useAppLoadingTransitions'
import type { useBotWorkspace } from '@/hooks/useBotWorkspace'
import type { useNewChatEmptyState } from '@/hooks/useNewChatEmptyState'
import { DeferredSessionAgent } from '@/lib/deferred-session-agent'
import { t } from '@/lib/i18n'
import { logger } from '@/lib/logger'
import type { AiTurnArtifact } from '@/lib/tool-artifacts'
import type { ProjectInfo, RestoredDraft } from '@/lib/types'
import { cn } from '@/lib/utils'

// App.tsx 的「主区」：`<main>`（会话顶栏 + 对话区 + 全局终端坞）原 JSX 整体搬到这里。
// 搬的时候只把原来闭包里直接引用的值改成同名 props 解构，DOM 结构与文案逐字未动。
// 所有状态、effect、回调和渲染顺序仍归 App.tsx；这里是纯展示层，不新增任何状态。
//
// 注意：LazyPanelFallback 也住在这一层并对外导出——App.tsx 在设置页/详情面板的
// Suspense 里还要用它，两边共用一个定义，避免同一个 class 串出现两份。

// --- Code-split secondary views (only loaded when first opened) ---
// These are conditionally-mounted routes/panels; lazy loading keeps heavy
// dependencies out of the initial bundle. Props types are inferred.
const ChatPanelHost = lazy(() =>
  import('@/components/chat/ChatPanelHost').then((m) => ({ default: m.ChatPanelHost })),
)
const TerminalDock = lazy(() =>
  import('@/components/terminal/TerminalDock').then((m) => ({ default: m.TerminalDock })),
)

export function LazyPanelFallback() {
  return <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">{t('loading')}</div>
}

// 生命周期回调/句柄一律按「目标组件自己的 props 类型」取，不在这一层重新声明一遍签名：
// 签名漂移会先在使用处报错，而不是被两份手写类型互相掩盖。
type ChatPanelProps = ComponentProps<typeof ChatPanelHost>
type HeaderProps = ComponentProps<typeof ConversationHeader>
type ModelSetupProps = ComponentProps<typeof ModelSetupEmptyState>
type PickerProps = ComponentProps<typeof NewChatProjectPicker>
type GuideProps = ComponentProps<typeof FirstUseGuideCard>
type DockProps = ComponentProps<typeof TerminalDock>
type BotWorkspace = ReturnType<typeof useBotWorkspace>
type EmptyState = ReturnType<typeof useNewChatEmptyState>
type LoadingState = ReturnType<typeof useAppLoadingState>
type GitState = ReturnType<typeof useAppGitState>

type SessionArtifactsState = {
  projectId?: string
  sessionId?: string
  artifacts: AiTurnArtifact[]
}

type AppMainProps = {
  conversationHeaderRef: HeaderProps['headerRef']
  agentManager: AgentManager
  headerProject: ProjectInfo | undefined
  headerGitRepository: boolean
  headerGitBranch: string | undefined
  headerGitDirtyCount: number
  branchMenuOpen: boolean
  setBranchMenuOpen: GitState['setBranchMenuOpen']
  handleCheckoutTitleBranch: HeaderProps['onCheckout']
  handleBranchCreated: HeaderProps['onBranchCreated']
  setGitGraphOpen: (open: boolean) => void
  openWorkspaceGitChanges: HeaderProps['onOpenChanges']
  conversationView: HeaderProps['conversationView']
  setConversationView: HeaderProps['onSetConversationView']
  needsModelSetup: boolean
  currentSessionPinned: HeaderProps['currentSessionPinned']
  handleToggleCurrentSessionPinned: HeaderProps['onTogglePinned']
  handleRenameCurrentSession: HeaderProps['onRename']
  handleShareCurrentSession: HeaderProps['onShare']
  handleArchiveCurrentSession: HeaderProps['onArchive']
  mobileShell: boolean
  visibleLoadingSessionId: LoadingState['visibleLoadingSessionId']
  renderedLoadingSessionId: LoadingState['renderedLoadingSessionId']
  openModelSettings: ModelSetupProps['onAddModel']
  activateLiteLlmExampleModel: () => Promise<unknown>
  chatCapabilities: ChatPanelProps['capabilities']
  botMode: boolean
  composerMascotVisible: BotWorkspace['composerMascotVisible']
  mascotStrolling: BotWorkspace['mascotStrolling']
  mascotAction: BotWorkspace['mascotAction']
  mascotState: BotWorkspace['mascotState']
  activeBot: BotWorkspace['activeBot']
  handleComposerSend: ChatPanelProps['onComposerSend']
  openCustomModelSelector: ChatPanelProps['onModelSelect']
  agentAccessMode: ChatPanelProps['agentAccessMode']
  setAccessMode: ChatPanelProps['onAccessModeChange']
  rollbackFromMessage: ChatPanelProps['onRollbackFromMessage']
  rollbackForResend: ChatPanelProps['onRollbackForResend']
  retryFromMessage: ChatPanelProps['onRetryFromMessage']
  copyAnswer: ChatPanelProps['onCopyAnswer']
  forkFromMessage: ChatPanelProps['onForkFromMessage']
  handleApproveToolCall: ChatPanelProps['onApproveToolCall']
  handleRejectToolCall: ChatPanelProps['onRejectToolCall']
  handleAnswerAsk: ChatPanelProps['onAnswerAsk']
  openLocalFilePathFromChat: ChatPanelProps['onOpenLocalFilePath']
  openFilePreviewFromArtifactCard: ChatPanelProps['onOpenFilePreview']
  rollbackTurnFromArtifactCard: ChatPanelProps['onRollbackTurn']
  rolledBackTurns: ChatPanelProps['rolledBackTurns']
  reviewFileChangesFromArtifactCard: ChatPanelProps['onReviewFileChanges']
  revealFileFromArtifactCard: ChatPanelProps['onRevealFile']
  setCurrentSessionArtifactsState: (state: SessionArtifactsState) => void
  openLivePresentedArtifacts: ChatPanelProps['onLivePresentArtifacts']
  handleContextUsageDisplayChange: ChatPanelProps['onContextUsageDisplayChange']
  handleSessionInitialRenderReady: ChatPanelProps['onInitialRenderReady']
  handleSessionInitialRenderError: ChatPanelProps['onInitialRenderError']
  restoredDraft: RestoredDraft | undefined
  consumeRestoredDraft: ChatPanelProps['onRestoredDraftConsumed']
  showNewChatEmptyState: EmptyState['showNewChatEmptyState']
  newChatGreeting: ReactNode
  taskLauncherAgent: EmptyState['taskLauncherAgent']
  invalidateTaskLauncher: ChatPanelProps['onTaskLauncherDismiss']
  projects: PickerProps['projects']
  emptyStateProject: ProjectInfo | undefined
  emptyStateBranch: string | undefined
  titleGitStatus: GitState['titleGitStatus']
  handleSelectEmptyStateProject: PickerProps['onSelectProject']
  handleClearEmptyStateProject: PickerProps['onClearProject']
  handleSelectEmptyStateNewProject: PickerProps['onNewProject']
  handleCreateEmptyStateProject: PickerProps['onCreateProject']
  remoteClient: boolean
  defaultWorkspace: ProjectInfo | undefined
  showFirstUseGuide: boolean
  selectProjectDirectory: GuideProps['onAddProject']
  handleCopyFirstGuidePrompt: GuideProps['onCopyExamplePrompt']
  handleDismissFirstUseGuide: GuideProps['onDismiss']
  terminalDockOpen: boolean
  pendingTerminalCommand: DockProps['pendingCommand']
  handlePendingTerminalCommandHandled: DockProps['onPendingCommandHandled']
  setTerminalDockOpen: (open: boolean) => void
}

export function AppMain(props: AppMainProps) {
  const {
    conversationHeaderRef,
    agentManager,
    headerProject,
    headerGitRepository,
    headerGitBranch,
    headerGitDirtyCount,
    branchMenuOpen,
    setBranchMenuOpen,
    handleCheckoutTitleBranch,
    handleBranchCreated,
    setGitGraphOpen,
    openWorkspaceGitChanges,
    conversationView,
    setConversationView,
    needsModelSetup,
    currentSessionPinned,
    handleToggleCurrentSessionPinned,
    handleRenameCurrentSession,
    handleShareCurrentSession,
    handleArchiveCurrentSession,
    mobileShell,
    visibleLoadingSessionId,
    renderedLoadingSessionId,
    openModelSettings,
    activateLiteLlmExampleModel,
    chatCapabilities,
    botMode,
    composerMascotVisible,
    mascotStrolling,
    mascotAction,
    mascotState,
    activeBot,
    handleComposerSend,
    openCustomModelSelector,
    agentAccessMode,
    setAccessMode,
    rollbackFromMessage,
    rollbackForResend,
    retryFromMessage,
    copyAnswer,
    forkFromMessage,
    handleApproveToolCall,
    handleRejectToolCall,
    handleAnswerAsk,
    openLocalFilePathFromChat,
    openFilePreviewFromArtifactCard,
    rollbackTurnFromArtifactCard,
    rolledBackTurns,
    reviewFileChangesFromArtifactCard,
    revealFileFromArtifactCard,
    setCurrentSessionArtifactsState,
    openLivePresentedArtifacts,
    handleContextUsageDisplayChange,
    handleSessionInitialRenderReady,
    handleSessionInitialRenderError,
    restoredDraft,
    consumeRestoredDraft,
    showNewChatEmptyState,
    newChatGreeting,
    taskLauncherAgent,
    invalidateTaskLauncher,
    projects,
    emptyStateProject,
    emptyStateBranch,
    titleGitStatus,
    handleSelectEmptyStateProject,
    handleClearEmptyStateProject,
    handleSelectEmptyStateNewProject,
    handleCreateEmptyStateProject,
    remoteClient,
    defaultWorkspace,
    showFirstUseGuide,
    selectProjectDirectory,
    handleCopyFirstGuidePrompt,
    handleDismissFirstUseGuide,
    terminalDockOpen,
    pendingTerminalCommand,
    handlePendingTerminalCommandHandled,
    setTerminalDockOpen,
  } = props

  return (
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
  )
}
