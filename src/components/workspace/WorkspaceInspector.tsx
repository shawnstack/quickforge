import { useInspectorGitState, useInspectorGit, useInspectorReviewSelection, useInspectorGitDemand } from './useInspectorGit'
import { useInspectorTabsState, useInspectorTabsEffects, useInspectorTabsActions, viewFromPanelKind } from './useInspectorTabs'
import { useInspectorLayoutState, useInspectorViewport, useInspectorVisibility, useInspectorWidth, useInspectorLayoutActions, WORKSPACE_INSPECTOR_MIN_WIDTH, INSPECTOR_KEYBOARD_RESIZE_STEP, getInspectorMaxWidth, NAV_PANEL_MIN_WIDTH, NAV_PANEL_MAX_WIDTH } from './useInspectorLayout'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectInfo } from '@/lib/types'
import type { AiTurnArtifact } from '@/lib/tool-artifacts'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { showAlert } from '@/components/ui/confirm-dialog'
import { WebPreviewContent } from '@/components/preview/WebPreviewContent'
import { openWorkspaceExternal } from './workspace-api'
import { WorkspaceDocumentContent } from './WorkspaceDocumentContent'
// The inspector is open by default but the terminal is not: a static import
// would pull xterm into first paint. Load it when the terminal tab first opens.
const TerminalDock = lazy(() =>
  import('@/components/terminal/TerminalDock').then((m) => ({ default: m.TerminalDock })),
)
import { SubagentRunDetailContent } from './SubagentRunDetailContent'
import { WorkflowRunDetailContent } from './WorkflowRunDetailContent'
import { SideChatTabContent, type SideChatComposerDraftMemory } from './SideChatTabContent'
import { BackgroundTasksTabContent } from './BackgroundTasksTabContent'
import type { BackgroundTaskView } from '@/lib/background-tasks-model'
import type { SideChatAgent } from './side-chat-agent'
import { subagentRunStore } from '@/lib/subagent-run-detail'
import { workflowRunStore, activeWorkflowRunStore } from '@/lib/workflow-run-payload'
import type { PendingTerminalCommand } from '@/components/terminal/terminal-api'
import type { WorkspaceInspectorOpenRequest } from './workspace-types'
import type { WorkspacePanelTab } from './workspace-inspector-tabs'
import type { DocumentFormat } from './artifact-preview-utils'
import { shouldHandleWorkspaceInspectorRequest, workspaceInspectorGoalMatches } from './workspace-inspector-request'
import { createWorkspaceInspectorProjectGuard, upsertGoalTab } from './workspace-inspector-tabs'
import { GoalInspectorContent, type GoalInspectorBinding } from './GoalInspectorContent'
import { PANEL_TAB_ITEMS } from './workspace-panel-tabs'
import { lastRunChangePaths } from './workspace-path-utils'
import { useWorkspaceTree } from './useWorkspaceTree'
import { useWorkspaceReader } from './useWorkspaceReader'
import { WorkspaceInspectorHeader } from './WorkspaceInspectorHeader'
import { WorkspacePanelLanding } from './WorkspacePanelLanding'
import { WorkspaceTreePanel } from './WorkspaceTreePanel'
import { WorkspaceReviewPanel } from './WorkspaceReviewPanel'
import { WorkspaceOverview, WorkspaceReaderPane } from './WorkspaceReaderPanel'

type WorkspaceInspectorProps = {
  goalBinding?: GoalInspectorBinding
  project?: ProjectInfo
  sessionId?: string
  runtimeScopeId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenCommitPush?: () => void
  onOpenProjectInExplorer?: (project: ProjectInfo) => void
  onOpenProjectInVSCode?: (project: ProjectInfo) => void
  onOpenProjectInIDEA?: (project: ProjectInfo) => void
  onPreviewArtifact?: (projectId: string, path: string) => void
  request?: WorkspaceInspectorOpenRequest
  onRequestHandled?: (id: number) => void
  artifacts?: AiTurnArtifact[]
  pendingTerminalCommand?: PendingTerminalCommand | null
  onPendingTerminalCommandHandled?: (id: number) => void
  globalTerminalOpen?: boolean
  onShowGlobalTerminal?: () => void
  sideChatAgent: SideChatAgent
  sideChatInputMemory: SideChatComposerDraftMemory
  sideChatRevision: number
  sideChatEnabled: boolean
  backgroundTasks?: BackgroundTaskView[]
  onStopBackgroundTask?: (task: BackgroundTaskView) => void
  onOpenBackgroundTaskLog?: (task: BackgroundTaskView) => void
  onClearSideChat: () => void
  onFullscreenChange?: (fullscreen: boolean) => void
  conversationMinWidth?: number
  leftSidebarWidth?: number
}

export function WorkspaceInspector({ goalBinding, project, sessionId, runtimeScopeId, open, onOpenChange, onOpenCommitPush, onOpenProjectInExplorer, onOpenProjectInVSCode, onOpenProjectInIDEA, onPreviewArtifact, request, onRequestHandled, artifacts = [], pendingTerminalCommand, onPendingTerminalCommandHandled, globalTerminalOpen = false, onShowGlobalTerminal, sideChatAgent, sideChatInputMemory, sideChatRevision, sideChatEnabled, backgroundTasks = [], onStopBackgroundTask, onOpenBackgroundTaskLog, onClearSideChat, onFullscreenChange, conversationMinWidth = 440, leftSidebarWidth = 0 }: WorkspaceInspectorProps) {
  const gitState = useInspectorGitState()
  const { changes, setChanges, gitBranch, setGitBranch, isGitRepository, setIsGitRepository, gitLoadStatus, setGitLoadStatus, gitError, setGitError, reviewFilter, setReviewFilter, expandedDiffPath, expandedDiff, expandedDiffLoading, expandedDiffError, expandedDiffNoChanges, pendingGitAction, gitControllerRef } = gitState

  const canUseTerminal = Boolean(onShowGlobalTerminal)
  const availablePanelTabItems = useMemo(
    () => PANEL_TAB_ITEMS.filter((item) => (
      (canUseTerminal || item.kind !== 'terminal')
      && (sideChatEnabled || item.kind !== 'side-chat')
    )),
    [canUseTerminal, sideChatEnabled],
  )
  const tabState = useInspectorTabsState({ project, sessionId, canUseTerminal })
  const { panelTabs, setPanelTabs, activePanelTabId, setActivePanelTabId, draggingPanelTabId, menuOpen, setMenuOpen, tabListOpen, setTabListOpen, readerNavigationVisible, setReaderNavigationVisible, openPanelTabRef, openSubagentRunTabRef, openWorkflowRunTabRef } = tabState

  const [reviewFilterOpen, setReviewFilterOpen] = useState(false)

  const layoutState = useInspectorLayoutState({ open, leftSidebarWidth, conversationMinWidth })
  const { leftWidth, isNavResizing, mounted, visible, mobileOverlay, width, isResizing, fullscreen, fullscreenAnimating, asideRef } = layoutState

  const menuRef = useRef<HTMLDivElement | null>(null)
  const tabListRef = useRef<HTMLDivElement | null>(null)
  const reviewFilterRef = useRef<HTMLDivElement | null>(null)

  const handledRequestIdRef = useRef<number | undefined>(undefined)
  const projectGuardRef = useRef(createWorkspaceInspectorProjectGuard())
  // reader 打开入口由 useWorkspaceReader 赋值；请求 effect 只读取 ref，先于 hook 调用声明。
  const openFileTabRef = useRef<((path: string) => void) | undefined>(undefined)
  const openCommandLogTabRef = useRef<((logPath: string, logSessionId: string, label?: string) => void) | undefined>(undefined)
  const openDocumentTabRef = useRef<((path: string, format: DocumentFormat) => void) | undefined>(undefined)
  const openDiffTabRef = useRef<((path: string, switchToChanges: boolean) => void) | undefined>(undefined)

  // 窄视口检测：1024px 对应 Tailwind lg 断点，<lg 时 Inspector 以全屏覆盖展示。
  // 防御式写法是为了兼容 vitest node 环境下无 matchMedia。
  useInspectorViewport({ ...layoutState, open, onFullscreenChange, leftSidebarWidth, conversationMinWidth, activePanelTab: undefined, activeReaderTabId: undefined })

  useEffect(() => {
    const guard = projectGuardRef.current
    return () => {
      guard.invalidate()
      // Abort the latest controller at cleanup, not a render-time snapshot.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      gitControllerRef.current?.abort()
    }
  }, [gitControllerRef])

  const projectId = project?.id
  // 项目守卫按 render 时的 projectId 轮换 epoch（沿用拆分前的写法）。
  // eslint-disable-next-line react-hooks/refs
  if (projectId) projectGuardRef.current.token(projectId)
  const activePanelTab = useMemo(
    () => panelTabs.find((tab) => tab.id === activePanelTabId),
    [activePanelTabId, panelTabs],
  )

  // 把「当前激活的工作流详情 Tab」广播回聊天区，让摘要卡显示「已打开」。
  useEffect(() => {
    const runId = open && activePanelTab?.kind === 'workflow' ? activePanelTab.workflowRun?.runId : undefined
    activeWorkflowRunStore.set(runId)
    return () => activeWorkflowRunStore.set(undefined)
  }, [activePanelTab, open])
  const activeReaderTabId = activePanelTab?.activeReaderTabId
  const activeReaderTabs = useMemo(() => activePanelTab?.readerTabs || [], [activePanelTab?.readerTabs])
  const activeReaderTab = useMemo(
    () => activeReaderTabs.find((tab) => tab.id === activeReaderTabId),
    [activeReaderTabId, activeReaderTabs],
  )
  const hasFileTab = Boolean(activeReaderTab && activeReaderTab.mode !== 'browser' && (activePanelTab?.kind === 'reader' || (activePanelTab?.kind === 'review' && activeReaderTab.mode === 'diff')))
  const isFilesLanding = activePanelTab?.kind === 'files'
  const hasReaderPane = hasFileTab || isFilesLanding
  const showNavigationPanel = isFilesLanding || !hasFileTab || readerNavigationVisible
  const navView: 'overview' | 'files' | 'changes' = activePanelTab?.kind === 'review'
    ? activePanelTab.reviewView === 'review' ? 'overview' : 'changes'
    : 'files'
  const lastRunPaths = useMemo(() => lastRunChangePaths(artifacts, project?.path), [artifacts, project?.path])

  const { gitStatuses, changedPaths, gitLoading, reviewFiles, selectedReviewFile, handleStageFile, handleStageAll, handleUnstageFile, handleUnstageAll, handleRestoreFile, handleRestoreAll, loadGitStatus, toggleReviewDiff } = useInspectorGit({ ...gitState, projectId, projectGuardRef, lastRunPaths })

  // 目录树/搜索状态，以及项目切换时项目作用域重置（含 Git 视图状态）。
  const {
    treeState,
    expandedPaths,
    treeRefreshing,
    searchState,
    filter,
    setFilter,
    trimmedFilter,
    displayedEntries,
    loadTreeDirectory,
    toggleTreeDirectory,
    runWorkspaceSearch,
    refreshTree,
  } = useWorkspaceTree({
    projectId,
    open,
    projectGuardRef,
    projectReset: { gitControllerRef, setChanges, setGitBranch, setGitError, setGitLoadStatus, setIsGitRepository },
  })

  function handleOpenChangedFile(file: { path: string; status: string }) {
    if (file.status === 'deleted') return
    void openFileTab(file.path)
  }

  async function handleOpenSelectedChangeExternally(target: 'explorer' | 'vscode' | 'idea') {
    if (!project) return
    if (!selectedReviewFile) {
      if (target === 'explorer') onOpenProjectInExplorer?.(project)
      else if (target === 'idea') onOpenProjectInIDEA?.(project)
      else onOpenProjectInVSCode?.(project)
      return
    }
    if (!projectId) return
    try {
      await openWorkspaceExternal(projectId, selectedReviewFile.path, target)
    } catch (err) {
      const fallback = target === 'explorer'
        ? t('openInExplorerFailed')
        : target === 'idea'
          ? t('openInIDEAFailed')
          : t('openInVSCodeFailed')
      await showAlert(err instanceof Error ? err.message : fallback)
    }
  }

  useInspectorReviewSelection({ ...gitState, reviewFiles })

  useInspectorVisibility({ ...layoutState, open, onFullscreenChange, leftSidebarWidth, conversationMinWidth, activePanelTab: activePanelTab, activeReaderTabId: activeReaderTabId })

  useEffect(() => {
    if (!menuOpen && !tabListOpen && !reviewFilterOpen) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuOpen && !menuRef.current?.contains(target)) setMenuOpen(false)
      if (tabListOpen && !tabListRef.current?.contains(target)) setTabListOpen(false)
      if (reviewFilterOpen && !reviewFilterRef.current?.contains(target)) setReviewFilterOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        setTabListOpen(false)
        setReviewFilterOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen, reviewFilterOpen, setMenuOpen, setTabListOpen, tabListOpen])

  useEffect(() => {
    if (!open || !shouldHandleWorkspaceInspectorRequest(
      request,
      { projectId: projectId ?? 'global-workspace', runtimeScopeId },
      handledRequestIdRef.current,
    )) return
    handledRequestIdRef.current = request.id
    if (request.kind === 'review') {
      openPanelTabRef.current?.('review', request.view)
      // 指定文件时（如聊天文件卡「审查」）直达该文件的 diff tab，并收起右侧
      // 文件列表导航，让审查视图只展示 diff 本身。
      if (request.path) {
        openDiffTabRef.current?.(request.path, false)
        setReaderNavigationVisible(false)
      }
    } else if (request.kind === 'reader') {
      openFileTabRef.current?.(request.path)
    } else if (request.kind === 'command-log') {
      openCommandLogTabRef.current?.(request.path, request.sessionId, request.label)
    } else if (request.kind === 'document') {
      openDocumentTabRef.current?.(request.path, request.format)
    } else if (request.kind === 'browser') {
      openPanelTabRef.current?.('browser', 'browser', { url: request.url })
    } else if (request.kind === 'goal') {
      if (workspaceInspectorGoalMatches(request, goalBinding)) {
        const identity = { sessionId: request.sessionId, goalId: request.goalId, view: request.view }
        setPanelTabs((current) => upsertGoalTab(current, identity).tabs)
        setActivePanelTabId(upsertGoalTab([], identity).activePanelTabId)
      }
    } else if (request.kind === 'subagent') {
      // 优先取 store 中最新快照（SSE 实时路径可能已比请求 payload 更新），无则用请求 payload。
      const latest = subagentRunStore.get(request.payload.runId) ?? request.payload
      openSubagentRunTabRef.current?.(latest)
    } else if (request.kind === 'workflow') {
      // 与 subagent 同构：store 快照是实时权威，请求载荷只作首帧兜底。
      const latest = workflowRunStore.get(request.payload.runId) ?? request.payload
      openWorkflowRunTabRef.current?.(latest)
    } else if (request.kind !== 'side-chat' || sideChatEnabled) {
      openPanelTabRef.current?.(request.kind, viewFromPanelKind(request.kind))
    }
    onRequestHandled?.(request.id)
  }, [goalBinding, onRequestHandled, open, openPanelTabRef, openSubagentRunTabRef, openWorkflowRunTabRef, projectId, request, runtimeScopeId, setActivePanelTabId, setPanelTabs, setReaderNavigationVisible, sideChatEnabled])
  // 持久化工作区宽度：拖拽或自动展开后都写入，刷新后保持上次宽度
  useInspectorWidth({ ...layoutState, open, onFullscreenChange, leftSidebarWidth, conversationMinWidth, activePanelTab: activePanelTab, activeReaderTabId: activeReaderTabId })

  // 窗口尺寸变化时把已存宽度重新夹到当前视口允许的上限内（全屏/窄视口覆盖模式下不动）。

  // 打开文件、文档、网页、终端或 subagent 运行详情时自动拉宽到固定宽度（手动拖动上限更高，见 getInspectorMaxWidth）。

  // tab 内容更新器：所有 reader/tab 写入都经过它，保持既有 setState 语义。
  function updatePanelTab(id: string, updater: (tab: WorkspacePanelTab) => WorkspacePanelTab) {
    setPanelTabs((prev) => prev.map((tab) => tab.id === id ? updater(tab) : tab))
  }

  const { createPanelTab, createReaderPanelTab, openPanelTab, activatePanelTab, handlePanelTabDragStart, finishPanelTabDrag, handlePanelTabDragEnd, closePanelTab, closeOtherPanelTabs, closeAllPanelTabs } = useInspectorTabsActions({ ...tabState, onClearSideChat, onOpenChange, updatePanelTab })

  useInspectorGitDemand({ ...gitState, projectId, activePanelTab, loadGitStatus })

  useInspectorTabsEffects({ ...tabState, projectId, sessionId })

  // reader 打开/加载 effect 保持在 tabs 持久化 effect 之后，与原组件顺序一致。
  const {
    openFileTab,
    selectDiffInPlace,
    selectPreviewFile,
    refreshActiveReader,
  } = useWorkspaceReader({
    projectId,
    projectGuardRef,
    panelTabs,
    setPanelTabs,
    setActivePanelTabId,
    activePanelTab,
    activeReaderTab,
    createPanelTab,
    createReaderPanelTab,
    openPanelTab,
    updatePanelTab,
    onPreviewArtifact,
    openFileTabRef,
    openCommandLogTabRef,
    openDocumentTabRef,
    openDiffTabRef,
  })

  // 刷新：先按展开状态重拉目录树，再在同一个 loading 窗口内重读当前 reader。
  async function refreshWorkspace() {
    await refreshTree(refreshActiveReader)
  }

  const { startResizing, resize, stopResizing, resizeByKeyboard, startNavResizing, navResize, stopNavResizing, toggleFullscreen } = useInspectorLayoutActions({ ...layoutState, open, onFullscreenChange, leftSidebarWidth, conversationMinWidth, activePanelTab: activePanelTab, activeReaderTabId: activeReaderTabId })

  if (!mounted) return null

  return (
    <>
      <aside
        ref={asideRef}
        className={cn(
          'relative shrink-0 overflow-hidden flex-col bg-background transition-[width,min-width,max-width,opacity,transform] duration-200 ease-out lg:flex',
          mobileOverlay ? 'quickforge-workspace-inspector-fullscreen z-20 flex rounded-none border-l-0' : 'hidden',
          visible ? 'translate-x-0 opacity-100' : 'w-0 min-w-0 max-w-0 translate-x-4 opacity-0',
          isResizing ? 'transition-none' : '',
          fullscreen ? 'quickforge-workspace-inspector-fullscreen z-40 rounded-none border-l-0' : undefined,
        )}
        style={visible && !fullscreen && !mobileOverlay ? { width, minWidth: WORKSPACE_INSPECTOR_MIN_WIDTH, maxWidth: getInspectorMaxWidth(leftSidebarWidth, conversationMinWidth) } : undefined}
      >
        {visible && !fullscreen && !mobileOverlay ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuemin={WORKSPACE_INSPECTOR_MIN_WIDTH}
            aria-valuemax={getInspectorMaxWidth(leftSidebarWidth, conversationMinWidth)}
            aria-valuenow={width}
            aria-label={t('workspaceResizePanel')}
            tabIndex={0}
            className="absolute inset-y-0 -left-2 z-20 w-4 cursor-col-resize bg-transparent focus-visible:bg-[color-mix(in_oklab,var(--ring)_20%,transparent)] focus-visible:outline-none"
            onPointerDown={startResizing}
            onPointerMove={resize}
            onPointerUp={stopResizing}
            onPointerCancel={stopResizing}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              resizeByKeyboard(event.key === 'ArrowLeft' ? INSPECTOR_KEYBOARD_RESIZE_STEP : -INSPECTOR_KEYBOARD_RESIZE_STEP)
            }}
          />
        ) : null}
        <WorkspaceInspectorHeader
          panelTabs={panelTabs}
          activePanelTab={activePanelTab}
          projectName={project?.name}
          tabListOpen={tabListOpen}
          setTabListOpen={setTabListOpen}
          tabListRef={tabListRef}
          menuRef={menuRef}
          menuOpen={menuOpen}
          setMenuOpen={setMenuOpen}
          draggingPanelTabId={draggingPanelTabId}
          activatePanelTab={activatePanelTab}
          closePanelTab={closePanelTab}
          closeOtherPanelTabs={closeOtherPanelTabs}
          closeAllPanelTabs={closeAllPanelTabs}
          handlePanelTabDragStart={handlePanelTabDragStart}
          finishPanelTabDrag={finishPanelTabDrag}
          handlePanelTabDragEnd={handlePanelTabDragEnd}
          openPanelTab={openPanelTab}
          availablePanelTabItems={availablePanelTabItems}
          fullscreen={fullscreen}
          fullscreenAnimating={fullscreenAnimating}
          globalTerminalOpen={globalTerminalOpen}
          onShowGlobalTerminal={onShowGlobalTerminal}
          onOpenChange={onOpenChange}
          toggleFullscreen={toggleFullscreen}
        />

        <div className={cn('flex min-h-0 flex-1 transition-opacity duration-150', fullscreenAnimating ? 'opacity-0' : 'opacity-100')}>
          {!project?.id && activePanelTab?.kind !== 'goal' && activePanelTab?.kind !== 'subagent' && activePanelTab?.kind !== 'workflow' && activePanelTab?.kind !== 'side-chat' && activePanelTab?.kind !== 'background-tasks' ? (
            <div className="p-4 text-sm">{t('workspaceSelectProject')}</div>
          ) : !activePanelTab ? (
            <WorkspacePanelLanding items={availablePanelTabItems} onOpenPanelTab={(kind) => openPanelTab(kind, viewFromPanelKind(kind))} />
          ) : activePanelTab.kind === 'goal' ? (
            goalBinding && activePanelTab.goal && workspaceInspectorGoalMatches(activePanelTab.goal, goalBinding) ? (
              <GoalInspectorContent key={`${goalBinding.sessionId}:${goalBinding.goal.id}`} {...goalBinding} active={open} view={activePanelTab.goal.view} onViewChange={(view) => setPanelTabs((current) => current.map((tab) => tab.id === activePanelTab.id && tab.goal ? { ...tab, goal: { ...tab.goal, view } } : tab))} />
            ) : <div className="p-4 text-sm text-muted-foreground">{t('goalUnavailable')}</div>
          ) : activePanelTab.kind === 'subagent' ? (
            <SubagentRunDetailContent payload={activePanelTab.subagentRun} />
          ) : activePanelTab.kind === 'workflow' ? (
            // Agent 行复用聊天 run_subagent 摘要卡，点击由卡片自身经
            // OPEN_SUBAGENT_RUN_EVENT 打开运行详情（store 实时快照优先），无需再接线。
            <WorkflowRunDetailContent payload={activePanelTab.workflowRun} />
          ) : activePanelTab.kind === 'side-chat' ? (
            <SideChatTabContent
              agent={sideChatAgent}
              inputMemory={sideChatInputMemory}
              revision={sideChatRevision}
            />
          ) : activePanelTab.kind === 'browser' ? (
            <WebPreviewContent
              url={activePanelTab.url || ''}
              onUrlChange={(url) => {
                updatePanelTab(activePanelTab.id, (tab) => ({ ...tab, url }))
              }}
              projectId={project?.id}
              externalReloadToken={activePanelTab.reloadNonce}
            />
          ) : activePanelTab.kind === 'document' && activePanelTab.document && projectId ? (
            <WorkspaceDocumentContent
              projectId={projectId}
              path={activePanelTab.document.path}
              format={activePanelTab.document.format}
              reloadNonce={activePanelTab.reloadNonce}
            />
          ) : activePanelTab.kind === 'background-tasks' ? (
            <BackgroundTasksTabContent
              tasks={backgroundTasks}
              sessionId={sessionId}
              onStopTask={onStopBackgroundTask}
              onOpenLog={onOpenBackgroundTaskLog}
            />
          ) : activePanelTab.kind === 'terminal' ? (
            <Suspense fallback={null}>
              <TerminalDock
                key={activePanelTab.id}
                project={project}
                pendingCommand={pendingTerminalCommand}
                onPendingCommandHandled={onPendingTerminalCommandHandled}
                onCollapse={() => closePanelTab(activePanelTab.id)}
                variant="panel"
                singleSession
                panelInstanceId={activePanelTab.id}
                panelSessionId={activePanelTab.terminalSessionId}
                onPanelSessionReady={(sessionId) => updatePanelTab(activePanelTab.id, (tab) => ({ ...tab, terminalSessionId: sessionId }))}
              />
            </Suspense>
          ) : (
            <>
              {hasReaderPane ? (
                <WorkspaceReaderPane
                  project={project}
                  activeReaderTab={activeReaderTab}
                  isFilesLanding={isFilesLanding}
                  navigationVisible={readerNavigationVisible}
                  onNavigationVisibleChange={setReaderNavigationVisible}
                  allowExternalOpen={Boolean(activeReaderTab && activeReaderTab.source !== 'command-log' && (onOpenProjectInExplorer || onOpenProjectInVSCode || onOpenProjectInIDEA))}
                  titleLabel={activeReaderTab?.source === 'command-log'
                    ? (activeReaderTab.label ? t('commandLogTabLabel', { command: activeReaderTab.label }) : t('commandLogTabFallback'))
                    : undefined}
                  openFileTabRef={openFileTabRef}
                />
              ) : null}

              {hasReaderPane && (isFilesLanding || readerNavigationVisible) ? (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-valuemin={NAV_PANEL_MIN_WIDTH}
                  aria-valuemax={NAV_PANEL_MAX_WIDTH}
                  aria-valuenow={leftWidth}
                  className={cn(
                    'group relative z-10 w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors',
                    isNavResizing ? '' : 'hover:bg-[color-mix(in_oklab,var(--border)_52%,transparent)]',
                  )}
                  onPointerDown={startNavResizing}
                  onPointerMove={navResize}
                  onPointerUp={stopNavResizing}
                  onPointerCancel={stopNavResizing}
                />
              ) : null}

              {showNavigationPanel ? (
                <div
                  className={cn(
                    'flex min-h-0 min-w-0 flex-col',
                    hasReaderPane ? 'shrink-0 border-l-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)]' : 'flex-1',
                  )}
                  style={hasReaderPane ? { width: leftWidth, minWidth: NAV_PANEL_MIN_WIDTH, maxWidth: NAV_PANEL_MAX_WIDTH } : undefined}
                >
                  <div className={cn('min-h-0 min-w-0 flex-1 p-2', navView === 'changes' ? 'flex flex-col overflow-hidden' : 'overflow-auto')}>
                    {navView === 'overview' ? (
                      <WorkspaceOverview
                        project={project}
                        artifacts={artifacts}
                        changesCount={changes.length}
                        changedPaths={changedPaths}
                        isGitRepository={isGitRepository}
                        gitBranch={gitBranch}
                        onSelectFile={openFileTab}
                        onSelectDiff={selectDiffInPlace}
                        onPreviewFile={selectPreviewFile}
                      />
                    ) : null}
                    {navView === 'files' ? (
                      <WorkspaceTreePanel
                        projectId={projectId}
                        filter={filter}
                        setFilter={setFilter}
                        trimmedFilter={trimmedFilter}
                        treeState={treeState}
                        expandedPaths={expandedPaths}
                        displayedEntries={displayedEntries}
                        searchState={searchState}
                        treeRefreshing={treeRefreshing}
                        selectedPath={activeReaderTab?.mode === 'file' ? activeReaderTab.path : undefined}
                        gitStatuses={gitStatuses}
                        runWorkspaceSearch={runWorkspaceSearch}
                        refreshWorkspace={refreshWorkspace}
                        toggleTreeDirectory={toggleTreeDirectory}
                        loadTreeDirectory={loadTreeDirectory}
                        onOpenFile={openFileTab}
                        onPreviewFile={selectPreviewFile}
                      />
                    ) : null}
                    {navView === 'changes' ? (
                      <WorkspaceReviewPanel
                        project={project}
                        gitLoadStatus={gitLoadStatus}
                        gitError={gitError}
                        gitLoading={gitLoading}
                        isGitRepository={isGitRepository}
                        loadGitStatus={loadGitStatus}
                        reviewFilter={reviewFilter}
                        setReviewFilter={setReviewFilter}
                        reviewFilterOpen={reviewFilterOpen}
                        setReviewFilterOpen={setReviewFilterOpen}
                        reviewFilterRef={reviewFilterRef}
                        selectedReviewFile={selectedReviewFile}
                        showExternalOpen={Boolean(onOpenProjectInExplorer || onOpenProjectInVSCode || onOpenProjectInIDEA)}
                        onOpenSelectedChangeExternally={(target) => { void handleOpenSelectedChangeExternally(target) }}
                        onOpenCommitPush={onOpenCommitPush}
                        reviewFiles={reviewFiles}
                        expandedDiffPath={expandedDiffPath}
                        expandedDiff={expandedDiff}
                        expandedDiffLoading={expandedDiffLoading}
                        expandedDiffError={expandedDiffError}
                        expandedDiffNoChanges={expandedDiffNoChanges}
                        toggleReviewDiff={toggleReviewDiff}
                        onOpenChangedFile={handleOpenChangedFile}
                        onRestoreFile={handleRestoreFile}
                        onStageFile={handleStageFile}
                        onUnstageFile={handleUnstageFile}
                        onRestoreAll={handleRestoreAll}
                        onStageAll={handleStageAll}
                        onUnstageAll={handleUnstageAll}
                        pendingGitAction={pendingGitAction}
                      />
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </aside>
    </>
  )
}
