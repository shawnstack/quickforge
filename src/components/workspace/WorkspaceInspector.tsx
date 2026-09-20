import { useInspectorGitState, useInspectorGit, useInspectorReviewSelection, useInspectorGitDemand, isNoWorkingTreeChangesError, type ReviewFilter } from './useInspectorGit'
import { useInspectorTabsState, useInspectorTabsEffects, useInspectorTabsActions, viewFromPanelKind } from './useInspectorTabs'
import { useInspectorLayoutState, useInspectorViewport, useInspectorVisibility, useInspectorWidth, useInspectorLayoutActions, WORKSPACE_INSPECTOR_MIN_WIDTH, getInspectorMaxWidth, NAV_PANEL_MIN_WIDTH, NAV_PANEL_MAX_WIDTH } from './useInspectorLayout'
import { Bot, Check, ChevronDown, ChevronRight, Code2, Copy, CornerDownLeft, Eye, Folder, GitBranch, GitCommitHorizontal, Globe, Maximize, MessageCircle, Minimize, MoreHorizontal, PanelRight, Plus, RefreshCw, Search, SquareTerminal, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Transform } from '@dnd-kit/utilities'
import type { ProjectInfo } from '@/lib/types'
import type { AiTurnArtifact } from '@/lib/tool-artifacts'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { ProjectOpenMenu } from '@/components/project/ProjectOpenMenu'
import { showAlert } from '@/components/ui/confirm-dialog'
import { WebPreviewContent } from '@/components/preview/WebPreviewContent'
import { MarkdownReader } from './MarkdownReader'
import { MonacoCodeViewer } from './MonacoCodeViewer'
import { MonacoDiffViewer } from './MonacoDiffViewer'
import { countDiffLines } from './diff-line-counts'
import { FileIcon } from './file-icon'
import { GoalIcon } from '@/components/goal-icon'
import { panelTabFilePath } from './workspace-tab-file-path'
import { getGitFileDiff, getWorkspaceChildren, getWorkspaceFile, getWorkspaceFileMeta, openWorkspaceExternal, searchWorkspace, } from './workspace-api'
import { WorkspaceChangesList } from './WorkspaceChangesList'
import { WorkspaceFileTree } from './WorkspaceFileTree'
import { WorkspaceDocumentContent } from './WorkspaceDocumentContent'
import { artifactFileName, artifactPreviewMode, documentFormatFromPath, isBrowserPreviewablePath, isDocumentPreviewablePath, presentArtifacts } from './artifact-preview-utils'
import { TerminalDock } from '@/components/terminal/TerminalDock'
import { SubagentRunDetailContent } from './SubagentRunDetailContent'
import { SideChatTabContent, type SideChatComposerDraftMemory } from './SideChatTabContent'
import type { SideChatAgent } from './side-chat-agent'
import { subagentRunStore } from '@/lib/subagent-run-detail'
import { resolveServerCacheKey } from '@/lib/session-message-cache'
import {
  isWorkspaceDirectoryCacheFresh,
  readWorkspaceDirectoryCache,
  readWorkspaceExpandedCache,
  readWorkspaceFileCache,
  writeWorkspaceDirectoryCache,
  writeWorkspaceExpandedCache,
  writeWorkspaceFileCache,
  workspaceFileMatchesMeta,
} from '@/lib/workspace-cache'
import type { PendingTerminalCommand } from '@/components/terminal/terminal-api'
import type { DocumentFormat } from './artifact-preview-utils'
import type { GitChangedFile, GitFileDiffResponse, WorkspaceFileResponse, WorkspaceInspectorOpenRequest, WorkspaceTreeNode } from './workspace-types'
import {
  missingWorkspaceTreePaths,
  normalizeWorkspaceTreePath,
  workspaceTreeDirectory,
  workspaceTreePathIsWithin,
  workspaceTreePathsForRemoval,
  workspaceTreeParentPath,
  workspaceTreeReducer,
  workspaceTreeRefreshCoverageSatisfied,
  workspaceTreeRefreshPaths,
} from './workspace-tree-state'
import {
  beginWorkspaceSearch,
  shouldLoadWorkspaceTreeRoot,
  shouldShowWorkspaceGitRetry,
  workspaceRefreshTarget,
  workspaceSearchEntriesForQuery,
  workspaceSearchResultCanOpen,
  type WorkspaceSearchState,
} from './workspace-inspector-on-demand-state'
import { shouldHandleWorkspaceInspectorRequest } from './workspace-inspector-request'
import {
  createWorkspaceInspectorProjectGuard,
} from './workspace-inspector-tabs'
import type {
  ReaderMode,
  ReaderTab,
  WorkspaceInspectorProjectToken,
  WorkspacePanelPrimaryTabKind,
  WorkspacePanelTab,
} from './workspace-inspector-tabs'

import { GoalInspectorContent, type GoalInspectorBinding } from './GoalInspectorContent'
import { upsertGoalTab } from './workspace-inspector-tabs'
import { workspaceInspectorGoalMatches } from './workspace-inspector-request'

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
  onClearSideChat: () => void
  onFullscreenChange?: (fullscreen: boolean) => void
  conversationMinWidth?: number
  leftSidebarWidth?: number
}

function readerTabId(mode: ReaderMode, path: string) {
  return mode === 'browser' ? 'browser' : `${mode}:${path}`
}

type WorkspacePanelTabMeta = {
  kind: WorkspacePanelPrimaryTabKind
  label: string
  description: string
  icon: typeof Folder
}

const PANEL_TAB_ITEMS: WorkspacePanelTabMeta[] = [
  { kind: 'files', label: t('rightPanelFiles'), description: t('rightPanelFilesDesc'), icon: Folder },
  { kind: 'review', label: t('rightPanelReview'), description: t('rightPanelReviewDesc'), icon: GitBranch },
  { kind: 'terminal', label: t('rightPanelTerminal'), description: t('rightPanelTerminalDesc'), icon: SquareTerminal },
  { kind: 'browser', label: t('rightPanelBrowser'), description: t('rightPanelBrowserDesc'), icon: Globe },
  { kind: 'side-chat', label: t('sideChatTitle'), description: t('sideChatDescription'), icon: MessageCircle },
]

const REVIEW_FILTER_ITEMS: { value: ReviewFilter; label: string }[] = [
  { value: 'unstaged', label: t('workspaceReviewFilterUnstaged') },
  { value: 'staged', label: t('workspaceReviewFilterStaged') },
  { value: 'all', label: t('workspaceReviewFilterAllBranches') },
  { value: 'last', label: t('workspaceReviewFilterLastRun') },
]

const PANEL_TAB_BY_KIND = Object.fromEntries(PANEL_TAB_ITEMS.map((item) => [item.kind, item])) as Record<WorkspacePanelPrimaryTabKind, WorkspacePanelTabMeta>

function browserTabLabel(previewUrl: string) {
  const value = previewUrl.trim()
  if (!value) return 'about:blank'
  if (/^[a-zA-Z]:[\\/]/.test(value)) return artifactFileName(value)
  try {
    const url = new URL(value)
    if (url.protocol === 'about:') return value
    if (url.protocol === 'file:') return artifactFileName(decodeURIComponent(url.pathname))
    return url.host || value
  } catch {
    return artifactFileName(value)
  }
}

function panelTabMeta(tab: WorkspacePanelTab) {
  if (tab.kind === 'reader' || tab.kind === 'document' || tab.kind === 'subagent' || tab.kind === 'goal') return undefined
  return PANEL_TAB_BY_KIND[tab.kind]
}

function panelTabLabel(tab: WorkspacePanelTab, projectName: string | undefined) {
  if (tab.kind === 'goal') return t('goalTitle')
  if (tab.kind === 'subagent') {
    const label = tab.subagentRun?.label || t('subagentRunDetails')
    return tab.subagentRun?.task ? `${label} · ${tab.subagentRun.task}` : label
  }
  if (tab.kind === 'terminal') return projectName || t('rightPanelTerminal')
  if (tab.kind === 'browser') return browserTabLabel(tab.url || '')
  if (tab.kind === 'document') return artifactFileName(tab.document?.path || '')
  if (tab.kind === 'reader') {
    const reader = tab.readerTabs?.find((item) => item.id === tab.activeReaderTabId) ?? tab.readerTabs?.[0]
    return reader ? artifactFileName(reader.path) : t('rightPanelFiles')
  }
  return PANEL_TAB_BY_KIND[tab.kind].label
}

function panelTabTitle(tab: WorkspacePanelTab, fallbackLabel: string) {
  if (tab.kind === 'subagent') return tab.subagentRun?.statusLabel || fallbackLabel
  if (tab.kind === 'browser') return tab.url || fallbackLabel
  if (tab.kind === 'document') return tab.document?.path || fallbackLabel
  if (tab.kind !== 'reader') return fallbackLabel
  const reader = tab.readerTabs?.find((item) => item.id === tab.activeReaderTabId) ?? tab.readerTabs?.[0]
  return reader?.path || fallbackLabel
}

function SortablePanelTab({ id, children }: {
  id: string
  children: (props: {
    listeners: ReturnType<typeof useSortable>['listeners']
    attributes: ReturnType<typeof useSortable>['attributes']
    isDragging: boolean
  }) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? undefined : transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('flex shrink-0 items-center gap-1', isDragging && 'relative z-30 opacity-55 drop-shadow-sm')}
    >
      {children({ listeners, attributes, isDragging })}
    </div>
  )
}

function normalizeWorkspacePath(path: string | undefined, projectRoot?: string) {
  const raw = path?.trim()
  if (!raw) return ''
  let normalized = raw.replace(/\\/g, '/').replace(/^\.\/+/g, '')
  const root = projectRoot?.trim().replace(/\\/g, '/').replace(/\/+$/g, '')
  if (root && normalized.startsWith(`${root}/`)) normalized = normalized.slice(root.length + 1)
  return normalized.replace(/^\/+/, '')
}

function lastRunChangePaths(artifacts: AiTurnArtifact[], projectRoot?: string) {
  const paths = new Set<string>()
  for (const artifact of artifacts) {
    const path = normalizeWorkspacePath(artifact.path, projectRoot)
    const outputFile = normalizeWorkspacePath(artifact.outputFile, projectRoot)
    if (path) paths.add(path)
    if (outputFile) paths.add(outputFile)
  }
  return paths
}

function reviewEmptyMessage(filter: ReviewFilter) {
  if (filter === 'staged') return t('workspaceNoStagedChanges')
  if (filter === 'last') return t('workspaceNoLastRunChanges')
  return t('workspaceNoWorkingTreeChanges')
}

function isMarkdownFile(file?: WorkspaceFileResponse) {
  if (!file) return false
  return file.language === 'markdown' || /\.(md|mdx|markdown)$/i.test(file.path)
}

function readerDiffText(diff: GitFileDiffResponse) {
  const header = diff.oldPath ? `${diff.oldPath} -> ${diff.path}` : diff.path
  return `Diff for ${header}\n\n--- OLD\n${diff.oldContent}\n\n--- NEW\n${diff.newContent}`
}

// 服务端 /api/git/file-diff 对无工作区变更的文件固定返回 404 'File has no working tree changes'
// （server/routes/workspace.mjs）。产物卡的「N 个文件已更改」是会话累计口径，文件被
// commit/revert/撤销后 Git 工作区已无变更；该 404 转为友好空态而不是红色错误。

function InlineReader({ project, path, mode, file, diff, loading, error, noChanges, navigationVisible, onNavigationVisibleChange, allowExternalOpen = true, onOpenCurrentFile }: {
  project?: ProjectInfo
  path?: string
  mode: ReaderMode
  file?: WorkspaceFileResponse
  diff?: GitFileDiffResponse
  loading?: boolean
  error?: string
  noChanges?: boolean
  navigationVisible: boolean
  onNavigationVisibleChange: (visible: boolean) => void
  allowExternalOpen?: boolean
  onOpenCurrentFile?: () => void
}) {
  const [copied, setCopied] = useState<'path' | 'content'>()
  const [markdownMode, setMarkdownMode] = useState<'preview' | 'source'>('preview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [wordWrap, setWordWrap] = useState(false)
  const actionsRef = useRef<HTMLDivElement | null>(null)

  async function copyToClipboard(kind: 'path' | 'content', value?: string) {
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopied(kind)
    setMenuOpen(false)
    window.setTimeout(() => setCopied(undefined), 1200)
  }

  async function openExternal(target: 'explorer' | 'vscode' | 'idea') {
    if (!project?.id || !title) return
    try {
      await openWorkspaceExternal(project.id, title, target)
    } catch (err) {
      const fallback = target === 'explorer'
        ? t('openInExplorerFailed')
        : target === 'idea'
          ? t('openInIDEAFailed')
          : t('openInVSCodeFailed')
      await showAlert(err instanceof Error ? err.message : fallback)
    }
  }

  const title = mode === 'file' ? file?.path || path : diff?.path || path
  const pathSegments = useMemo(
    () => normalizeWorkspacePath(title).split('/').filter(Boolean),
    [title],
  )
  const breadcrumbTitle = [project?.name, ...pathSegments].filter(Boolean).join(' > ')
  const isMarkdown = mode === 'file' && isMarkdownFile(file)
  const sourceVisible = mode === 'file' && (!isMarkdown || markdownMode === 'source')
  const copyableContent = mode === 'file' ? file?.content : diff ? readerDiffText(diff) : undefined
  const diffStats = useMemo(
    () => (mode === 'diff' && diff ? countDiffLines(diff.oldContent, diff.newContent) : undefined),
    [mode, diff],
  )

  useEffect(() => {
    if (!menuOpen) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        {diffStats ? (
          <span className="shrink-0 font-mono text-[11px] font-medium">
            <span className="text-emerald-600 dark:text-emerald-400">+{diffStats.added}</span>
            <span className="ml-1.5 text-red-600 dark:text-red-400">-{diffStats.removed}</span>
          </span>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-sm" title={breadcrumbTitle || title}>
          {project?.name ? (
            <span className="shrink-0 truncate">{project.name}</span>
          ) : null}
          {pathSegments.map((segment, index) => {
            const isCurrentFile = index === pathSegments.length - 1
            return (
              <div key={`${segment}-${index}`} className={cn('flex min-w-0 items-center gap-1.5', isCurrentFile ? 'min-w-0' : 'shrink-0')}>
                {(project?.name || index > 0) ? <ChevronRight className="size-4 shrink-0" /> : null}
                <span className={cn('truncate', isCurrentFile ? 'font-medium ' : '')}>
                  {segment}
                </span>
              </div>
            )
          })}
        </div>
        <div ref={actionsRef} className="flex shrink-0 items-center gap-1">
          {isMarkdown ? (
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-xl px-2.5 text-sm font-medium transition-colors hover:text-foreground"
              onClick={() => {
                setMarkdownMode((value) => value === 'preview' ? 'source' : 'preview')
                setMenuOpen(false)
              }}
            >
              {markdownMode === 'preview' ? t('viewMarkdownSource') : t('returnToMarkdownPreview')}
            </button>
          ) : null}
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              className={cn('size-8 rounded-xl', menuOpen && '')}
              onClick={() => setMenuOpen((value) => !value)}
              aria-label={t('readerMoreActions')}
              title={t('readerMoreActions')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <MoreHorizontal className="size-4" />
            </Button>
            {menuOpen ? (
              <div className="absolute right-0 top-10 z-50 w-56 rounded-2xl border border-[color-mix(in_oklab,var(--border)_38%,transparent)] bg-popover p-1.5 text-popover-foreground shadow-quickforge" role="menu" aria-label={t('readerMoreActions')}>
                <button
                  type="button"
                  className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={() => void copyToClipboard('path', title)}
                  disabled={!title}
                  role="menuitem"
                >
                  {copied === 'path' ? <Check className="size-4 shrink-0" /> : <Copy className="size-4 shrink-0" />}
                  <span>{t('copyPath')}</span>
                </button>
                <button
                  type="button"
                  className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={() => void copyToClipboard('content', copyableContent)}
                  disabled={!copyableContent}
                  role="menuitem"
                >
                  {copied === 'content' ? <Check className="size-4 shrink-0" /> : <Copy className="size-4 shrink-0" />}
                  <span>{mode === 'file' ? t('copyFileContent') : t('copyDiffContent')}</span>
                </button>
                <button
                  type="button"
                  className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={() => {
                    setWordWrap((value) => !value)
                    setMenuOpen(false)
                  }}
                  disabled={!sourceVisible}
                  role="menuitemcheckbox"
                  aria-checked={wordWrap}
                >
                  <CornerDownLeft className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">{t('enableWordWrap')}</span>
                  {wordWrap ? <Check className="size-4 shrink-0" /> : null}
                </button>
              </div>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className={cn('size-8 rounded-xl', navigationVisible && '')}
            onClick={() => onNavigationVisibleChange(!navigationVisible)}
            aria-label={navigationVisible ? t('hideFileNavigation') : t('showFileNavigation')}
            title={navigationVisible ? t('hideFileNavigation') : t('showFileNavigation')}
            aria-pressed={navigationVisible}
          >
            <Folder className="size-4" />
          </Button>
          {allowExternalOpen ? (
            <ProjectOpenMenu
              project={project}
              disabled={!title}
              onOpenInExplorer={() => { void openExternal('explorer') }}
              onOpenInVSCode={() => { void openExternal('vscode') }}
              onOpenInIDEA={() => { void openExternal('idea') }}
            />
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-background">
        {loading ? <div className="p-4 text-sm">{t('openingReader')}</div> : null}
        {!loading && noChanges ? (
          <div className="p-4">
            <div className="text-sm">{t('workspaceFileNoWorkingTreeChanges')}</div>
            {onOpenCurrentFile ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 rounded-xl"
                onClick={onOpenCurrentFile}
              >
                {t('workspaceOpenCurrentFile')}
              </Button>
            ) : null}
          </div>
        ) : null}
        {!loading && error ? <div className="p-4 text-sm text-destructive">{error}</div> : null}
        {!loading && !error && mode === 'file' && file ? (
          isMarkdown ? (
            <MarkdownReader key={file.path} projectId={project?.id} path={file.path} content={file.content} language={file.language} mode={markdownMode} wordWrap={wordWrap} />
          ) : (
            <MonacoCodeViewer path={file.path} content={file.content} language={file.language} wordWrap={wordWrap} />
          )
        ) : null}
        {!loading && !error && mode === 'diff' && diff ? (
          <MonacoDiffViewer
            path={diff.path}
            oldContent={diff.oldContent}
            newContent={diff.newContent}
            language={diff.language}
            status={diff.status}
          />
        ) : null}
      </div>
    </div>
  )
}

function WorkspaceOverview({ project, artifacts, changesCount, changedPaths, isGitRepository, gitBranch, onSelectFile, onSelectDiff, onPreviewFile }: {
  project?: ProjectInfo
  artifacts: AiTurnArtifact[]
  changesCount: number
  changedPaths: Set<string>
  isGitRepository: boolean
  gitBranch?: string
  onSelectFile: (path: string) => void
  onSelectDiff: (path: string) => void
  onPreviewFile: (path: string) => void
}) {
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [expandedCommandIds, setExpandedCommandIds] = useState<Set<string>>(() => new Set())
  const fileArtifacts = presentArtifacts(artifacts)
  const commandArtifacts = artifacts.filter((artifact) => artifact.command)

  function toggleCommand(id: string) {
    setExpandedCommandIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-3 p-2">
      <div className="rounded-lg border border-border bg-background px-3 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Code2 className="size-3.5 text-emerald-600 dark:text-emerald-500" />
          {t('workspaceCurrentArtifacts')}
        </div>
        {artifacts.length === 0 ? (
          <div className="mt-2 text-xs leading-5">{t('workspaceNoArtifacts')}</div>
        ) : (
          <div className="mt-3 space-y-3">
            {fileArtifacts.length ? (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium uppercase tracking-wide">{t('workspaceFiles')} {fileArtifacts.length}</div>
                {fileArtifacts.slice(0, 8).map((artifact) => {
                  const path = artifact.path
                  const canPreview = isBrowserPreviewablePath(path) || isDocumentPreviewablePath(path)
                  const canViewDiff = changedPaths.has(path)
                  const hasDiff = typeof artifact.addedLines === 'number' || typeof artifact.removedLines === 'number'
                  return (
                    <div key={artifact.id} className="group flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors">
                      <FileIcon path={path} className="size-3.5 shrink-0" />
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left font-medium"
                        onClick={() => canPreview ? onPreviewFile(path) : canViewDiff ? onSelectDiff(path) : onSelectFile(path)}
                        title={path}
                      >
                        {artifact.title || artifactFileName(path)}
                      </button>
                      {hasDiff ? (
                        <span className="shrink-0 font-mono text-[10px] font-medium">
                          <span className="text-emerald-600 dark:text-emerald-400">+{artifact.addedLines ?? 0}</span>
                          <span className="ml-1 text-red-600 dark:text-red-400">-{artifact.removedLines ?? 0}</span>
                        </span>
                      ) : null}
                      <span className="shrink-0 rounded-full bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium">{artifact.kind}</span>
                      {canPreview ? (
                        <button
                          type="button"
                          className="shrink-0 inline-flex size-5 items-center justify-center text-blue-600 opacity-0 transition-opacity hover:bg-blue-500/10 hover:text-blue-700 group-hover:opacity-100 dark:text-blue-400"
                          onClick={() => onPreviewFile(path)}
                          aria-label={t('previewArtifact')}
                          title={t('previewArtifact')}
                        >
                          <Eye className="size-3.5" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={() => canViewDiff ? onSelectDiff(path) : onSelectFile(path)}
                      >
                        {canViewDiff ? t('workspaceViewDiff') : t('artifactPreviewViewSource')}
                      </button>
                    </div>
                  )
                })}
                {fileArtifacts.length > 8 ? <div className="px-2 text-[11px]">+{fileArtifacts.length - 8}</div> : null}
              </div>
            ) : null}
            {commandArtifacts.length ? (
              <div className="space-y-1.5">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[11px] font-medium uppercase tracking-wide transition-colors"
                  onClick={() => setCommandsOpen((value) => !value)}
                  aria-expanded={commandsOpen}
                >
                  <ChevronDown className={cn('size-3.5 transition-transform', commandsOpen ? '' : '-rotate-90')} />
                  <span className="min-w-0 flex-1 truncate">{t('workspaceCommands')} {commandArtifacts.length}</span>
                </button>
                {commandsOpen ? (
                  <div className="space-y-1">
                    {commandArtifacts.map((artifact, index) => {
                      const expanded = expandedCommandIds.has(artifact.id)
                      return (
                        <div key={artifact.id} className="rounded-md text-[11px]">
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors"
                            onClick={() => toggleCommand(artifact.id)}
                            aria-expanded={expanded}
                          >
                            <ChevronDown className={cn('size-3 shrink-0 transition-transform', expanded ? '' : '-rotate-90')} />
                            <span className="shrink-0 font-medium">#{index + 1}</span>
                            <span className="min-w-0 flex-1 truncate font-mono">{artifact.command}</span>
                          </button>
                          {expanded ? (
                            <div className="space-y-1 px-2 pb-2 pt-1.5">
                              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5">{artifact.command}</pre>
                              {artifact.outputFile ? <div className="text-[10px]">{t('workspaceCommandOutput')}: <span className="font-mono">{artifact.outputFile}</span></div> : null}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border px-3 py-3">
        <div className="text-xs font-medium">{project?.name ?? t('noProjectSelected')}</div>
        <div className="mt-1 text-[11px]">
          {isGitRepository ? `${t('workspaceCurrentBranch')}: ${gitBranch || t('unknown')} · ${changesCount} ${t('workspaceChangeCount')}` : t('workspaceNotGitRepository')}
        </div>
      </div>
    </div>
  )
}

export function WorkspaceInspector({ goalBinding, project, sessionId, runtimeScopeId, open, onOpenChange, onOpenCommitPush, onOpenProjectInExplorer, onOpenProjectInVSCode, onOpenProjectInIDEA, onPreviewArtifact, request, onRequestHandled, artifacts = [], pendingTerminalCommand, onPendingTerminalCommandHandled, globalTerminalOpen = false, onShowGlobalTerminal, sideChatAgent, sideChatInputMemory, sideChatRevision, sideChatEnabled, onClearSideChat, onFullscreenChange, conversationMinWidth = 440, leftSidebarWidth = 0 }: WorkspaceInspectorProps) {
  const [treeState, dispatchTree] = useReducer(workspaceTreeReducer, {})
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const [treeRefreshing, setTreeRefreshing] = useState(false)
  const [searchState, setSearchState] = useState<WorkspaceSearchState>(() => beginWorkspaceSearch(''))
  const gitState = useInspectorGitState()
  const { changes, setChanges, gitBranch, setGitBranch, isGitRepository, setIsGitRepository, gitLoadStatus, setGitLoadStatus, gitError, setGitError, reviewFilter, setReviewFilter, expandedDiffPath, expandedDiff, expandedDiffLoading, expandedDiffError, expandedDiffNoChanges, pendingGitAction, gitControllerRef } = gitState

  const [filter, setFilter] = useState('')

  const canUseTerminal = Boolean(onShowGlobalTerminal)
  const availablePanelTabItems = useMemo(
    () => PANEL_TAB_ITEMS.filter((item) => (
      (canUseTerminal || item.kind !== 'terminal')
      && (sideChatEnabled || item.kind !== 'side-chat')
    )),
    [canUseTerminal, sideChatEnabled],
  )
  const tabState = useInspectorTabsState({ project, sessionId, canUseTerminal })
  const { panelTabs, setPanelTabs, activePanelTabId, setActivePanelTabId, draggingPanelTabId, menuOpen, setMenuOpen, tabListOpen, setTabListOpen, readerNavigationVisible, setReaderNavigationVisible, openPanelTabRef, openSubagentRunTabRef } = tabState

  const [reviewFilterOpen, setReviewFilterOpen] = useState(false)

  const layoutState = useInspectorLayoutState({ open, leftSidebarWidth, conversationMinWidth })
  const { leftWidth, isNavResizing, mounted, visible, mobileOverlay, width, isResizing, fullscreen, fullscreenAnimating, asideRef } = layoutState

  const menuRef = useRef<HTMLDivElement | null>(null)
  const tabListRef = useRef<HTMLDivElement | null>(null)
  const reviewFilterRef = useRef<HTMLDivElement | null>(null)

  const openFileTabRef = useRef<((path: string) => void) | undefined>(undefined)
  const openDocumentTabRef = useRef<((path: string, format: DocumentFormat) => void) | undefined>(undefined)
  const openDiffTabRef = useRef<((path: string, switchToChanges: boolean) => void) | undefined>(undefined)
  const handledRequestIdRef = useRef<number | undefined>(undefined)
  const projectGuardRef = useRef(createWorkspaceInspectorProjectGuard())
  const loadingReaderKeysRef = useRef<Set<string>>(new Set())
  // refreshWorkspace 强制置 loading 的 reader id：加载 effect 据此绕过缓存读（刷新=权威）。
  const refreshedReaderIdsRef = useRef<Set<string>>(new Set())
  // 本次挂载内已恢复 expandedPaths 的项目：防止重复恢复（项目切换后自然允许新项目恢复）。
  const restoredExpandedProjectRef = useRef<string | undefined>(undefined)

  const treeGenerationRef = useRef(0)
  const treeRequestsRef = useRef<Map<string, AbortController>>(new Map())
  const treeRemovedPathsRef = useRef<Set<string>>(new Set())
  const searchControllerRef = useRef<AbortController | null>(null)
  const searchTimerRef = useRef<number | null>(null)

  // 窄视口检测：1024px 对应 Tailwind lg 断点，<lg 时 Inspector 以全屏覆盖展示。
  // 防御式写法是为了兼容 vitest node 环境下无 matchMedia。
  useInspectorViewport({ ...layoutState, open, onFullscreenChange, leftSidebarWidth, conversationMinWidth, activePanelTab: undefined, activeReaderTabId: undefined })

  useEffect(() => {
    const guard = projectGuardRef.current
    const treeRequests = treeRequestsRef.current
    const treeRemovedPaths = treeRemovedPathsRef.current
    return () => {
      guard.invalidate()
      for (const controller of treeRequests.values()) controller.abort()
      treeRequests.clear()
      treeRemovedPaths.clear()
      searchControllerRef.current?.abort()
      if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current)
      // Abort the latest controller at cleanup, not a render-time snapshot.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      gitControllerRef.current?.abort()
    }
  }, [gitControllerRef])

  const projectId = project?.id
  if (projectId) projectGuardRef.current.token(projectId)
  const panelTabIds = useMemo(() => panelTabs.map((tab) => tab.id), [panelTabs])
  const panelTabSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )
  const restrictPanelTabToHorizontal = useCallback((args: { transform: Transform }) => ({
    ...args.transform,
    y: 0,
  }), [])
  const activePanelTab = useMemo(
    () => panelTabs.find((tab) => tab.id === activePanelTabId),
    [activePanelTabId, panelTabs],
  )
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

  const rootEntries = workspaceTreeDirectory(treeState, '.').entries
  const trimmedFilter = filter.trim()
  const displayedEntries = trimmedFilter.length >= 2 ? workspaceSearchEntriesForQuery(searchState, trimmedFilter) : rootEntries

  function handleOpenChangedFile(file: GitChangedFile) {
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
    } else if (request.kind !== 'side-chat' || sideChatEnabled) {
      openPanelTabRef.current?.(request.kind, viewFromPanelKind(request.kind))
    }
    onRequestHandled?.(request.id)
  }, [goalBinding, onRequestHandled, open, openPanelTabRef, openSubagentRunTabRef, projectId, request, runtimeScopeId, setActivePanelTabId, setPanelTabs, setReaderNavigationVisible, sideChatEnabled])
  // 持久化工作区宽度：拖拽或自动展开后都写入，刷新后保持上次宽度
  useInspectorWidth({ ...layoutState, open, onFullscreenChange, leftSidebarWidth, conversationMinWidth, activePanelTab: activePanelTab, activeReaderTabId: activeReaderTabId })

  // 窗口尺寸变化时把已存宽度重新夹到当前视口允许的上限内（全屏/窄视口覆盖模式下不动）。

  // 打开文件、文档、网页、终端或 subagent 运行详情时自动拉宽到固定宽度（手动拖动上限更高，见 getInspectorMaxWidth）。

  const loadTreeDirectory = useCallback(async (rawPath: string, options: { append?: boolean; force?: boolean; cursor?: string } = {}) => {
    if (!projectId) return false
    const directoryPath = normalizeWorkspaceTreePath(rawPath)
    const current = workspaceTreeDirectory(treeState, directoryPath)
    if (!options.force && !options.append && (current.status === 'loading' || current.status === 'loaded')) return true
    if (treeRequestsRef.current.has(directoryPath)) return false

    const appendCursor = options.cursor
      ?? (current.requestMode === 'append' ? current.requestCursor : current.nextCursor)
      ?? undefined
    if (options.append && !appendCursor) return false

    const controller = new AbortController()
    treeRequestsRef.current.set(directoryPath, controller)
    treeGenerationRef.current += 1
    const generation = treeGenerationRef.current
    const projectToken = projectGuardRef.current.token(projectId)
    dispatchTree({ type: 'request', path: directoryPath, generation, append: options.append, cursor: appendCursor })
    try {
      // 刷新后首次加载（idle）时读目录缓存 seed：TTL 内直接采用缓存（零网络）；
      // 已过期则先用缓存渲染再走原有网络刷新（SWR），后续 success 会自然覆盖 seed。
      if (!options.force && !options.append && current.status === 'idle') {
        const cached = await readWorkspaceDirectoryCache(resolveServerCacheKey(), projectId, directoryPath)
        if (cached && projectGuardRef.current.isCurrent(projectToken) && !controller.signal.aborted) {
          dispatchTree({ type: 'success', path: directoryPath, generation, entries: cached.entries, nextCursor: cached.nextCursor })
          if (isWorkspaceDirectoryCacheFresh(cached)) return true
        }
      }
      if (options.force && !options.append) {
        const refreshedEntries: WorkspaceTreeNode[] = []
        let cursor: string | undefined
        let nextCursor: string | null = null
        do {
          const response = await getWorkspaceChildren(projectId, directoryPath, { cursor, signal: controller.signal })
          if (!projectGuardRef.current.isCurrent(projectToken) || controller.signal.aborted) return false
          refreshedEntries.push(...response.entries)
          nextCursor = response.nextCursor
          cursor = response.nextCursor || undefined
        } while (cursor && !workspaceTreeRefreshCoverageSatisfied(current, refreshedEntries, nextCursor))

        dispatchTree({ type: 'success', path: directoryPath, generation, entries: refreshedEntries, nextCursor })
        // 仅聚合到完整目录（无下一页）才写缓存；部分页不写。
        if (nextCursor === null) {
          void writeWorkspaceDirectoryCache(resolveServerCacheKey(), projectId, directoryPath, refreshedEntries, nextCursor, false)
        }
        const missing = missingWorkspaceTreePaths(treeState, directoryPath, refreshedEntries)
        if (missing.length > 0) {
          for (const missingPath of missing) treeRemovedPathsRef.current.add(missingPath)
          const removedPaths = workspaceTreePathsForRemoval(treeState, missing)
          dispatchTree({ type: 'remove', paths: missing })
          setExpandedPaths((currentExpanded) => {
            const next = new Set(currentExpanded)
            for (const expandedPath of currentExpanded) {
              if (missing.some((missingPath) => workspaceTreePathIsWithin(expandedPath, missingPath))) next.delete(expandedPath)
            }
            return removedPaths.length > 0 || next.size !== currentExpanded.size ? next : currentExpanded
          })
        }
      } else {
        const response = await getWorkspaceChildren(projectId, directoryPath, { cursor: options.append ? appendCursor : undefined, signal: controller.signal })
        if (!projectGuardRef.current.isCurrent(projectToken) || controller.signal.aborted) return false
        dispatchTree({ type: 'success', path: directoryPath, generation, entries: response.entries, nextCursor: response.nextCursor, append: options.append })
        // 仅完整单页（非 append、无下一页、未截断）才写缓存。
        if (!options.append && response.nextCursor === null && !response.truncated) {
          void writeWorkspaceDirectoryCache(resolveServerCacheKey(), projectId, directoryPath, response.entries, response.nextCursor, response.truncated)
        }
        if (!options.append && !response.nextCursor) {
          const missing = missingWorkspaceTreePaths(treeState, directoryPath, response.entries)
          if (missing.length > 0) {
            for (const missingPath of missing) treeRemovedPathsRef.current.add(missingPath)
            dispatchTree({ type: 'remove', paths: missing })
            setExpandedPaths((currentExpanded) => {
              const next = new Set(currentExpanded)
              for (const expandedPath of currentExpanded) {
                if (missing.some((missingPath) => workspaceTreePathIsWithin(expandedPath, missingPath))) next.delete(expandedPath)
              }
              return next
            })
          }
        }
      }
      return true
    } catch (err) {
      if (controller.signal.aborted || !projectGuardRef.current.isCurrent(projectToken)) return false
      dispatchTree({ type: 'failure', path: directoryPath, generation, error: err instanceof Error ? err.message : t('workspaceLoadFailed') })
      return false
    } finally {
      if (treeRequestsRef.current.get(directoryPath) === controller) treeRequestsRef.current.delete(directoryPath)
    }
  }, [projectId, treeState])

  function toggleTreeDirectory(path: string) {
    const normalized = normalizeWorkspaceTreePath(path)
    const expanded = expandedPaths.has(normalized)
    const next = new Set(expandedPaths)
    if (expanded) next.delete(normalized)
    else next.add(normalized)
    setExpandedPaths(next)
    // 展开状态变更即时同步缓存（含收起删除），供下次打开 Inspector 时恢复目录树。
    if (projectId) void writeWorkspaceExpandedCache(resolveServerCacheKey(), projectId, [...next])
    if (!expanded) void loadTreeDirectory(normalized)
  }

  const runWorkspaceSearch = useCallback(async (rawQuery: string) => {
    const query = rawQuery.trim()
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current)
      searchTimerRef.current = null
    }
    searchControllerRef.current?.abort()
    if (!projectId || query.length < 2) {
      setSearchState(beginWorkspaceSearch(query))
      return false
    }

    const controller = new AbortController()
    searchControllerRef.current = controller
    const projectToken = projectGuardRef.current.token(projectId)
    setSearchState({ query, status: 'loading', entries: [], truncated: false })
    try {
      const response = await searchWorkspace(projectId, query, { limit: 100, signal: controller.signal })
      if (controller.signal.aborted || !projectGuardRef.current.isCurrent(projectToken)) return false
      setSearchState({ query, status: 'loaded', entries: response.entries, truncated: response.truncated })
      return true
    } catch (err) {
      if (controller.signal.aborted || !projectGuardRef.current.isCurrent(projectToken)) return false
      setSearchState({
        query,
        status: 'error',
        entries: [],
        truncated: false,
        error: err instanceof Error ? err.message : t('workspaceLoadFailed'),
      })
      return false
    } finally {
      if (searchControllerRef.current === controller) searchControllerRef.current = null
    }
  }, [projectId])

  async function refreshWorkspace() {
    treeRemovedPathsRef.current.clear()
    setTreeRefreshing(true)
    try {
      const paths = workspaceTreeRefreshPaths(treeState, expandedPaths)
      const failedPaths: string[] = []
      for (const path of paths) {
        if ([...treeRemovedPathsRef.current].some((removedPath) => workspaceTreePathIsWithin(path, removedPath))) continue
        const parent = workspaceTreeParentPath(path)
        if (parent && failedPaths.some((failedPath) => workspaceTreePathIsWithin(parent, failedPath))) continue
        const loaded = await loadTreeDirectory(path, { force: true })
        if (!loaded) failedPaths.push(path)
      }
      if (!activePanelTab || activeReaderTab?.mode !== 'file') return
      const readerId = activeReaderTab.id
      // 刷新=权威：标记该 reader 绕过缓存读，由加载 effect 直接全量重拉并覆写缓存。
      if (!activeReaderTab.loading) refreshedReaderIdsRef.current.add(readerId)
      updatePanelTab(activePanelTab.id, (tab) => ({
        ...tab,
        readerTabs: (tab.readerTabs || []).map((reader) => reader.id === readerId
          ? { ...reader, loading: true, error: undefined }
          : reader),
      }))
    } finally {
      setTreeRefreshing(false)
    }
  }

  useEffect(() => {
    if (!projectId || !shouldLoadWorkspaceTreeRoot(open, workspaceTreeDirectory(treeState, '.').status)) return
    void loadTreeDirectory('.')
  }, [loadTreeDirectory, open, projectId, treeState])

  useInspectorGitDemand({ ...gitState, projectId, activePanelTab, loadGitStatus })

  useEffect(() => {
    const query = filter.trim()
    searchControllerRef.current?.abort()
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current)
    setSearchState(beginWorkspaceSearch(query))
    if (!projectId || query.length < 2) {
      searchTimerRef.current = null
      return
    }

    searchTimerRef.current = window.setTimeout(() => {
      searchTimerRef.current = null
      void runWorkspaceSearch(query)
    }, 300)
    return () => {
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current)
        searchTimerRef.current = null
      }
    }
  }, [filter, projectId, runWorkspaceSearch])

  useEffect(() => {
    dispatchTree({ type: 'reset' })
    setExpandedPaths(new Set())
    setTreeRefreshing(false)
    setSearchState(beginWorkspaceSearch(''))
    setGitLoadStatus('idle')
    setGitError(undefined)
    setChanges([])
    setGitBranch(undefined)
    setIsGitRepository(false)
    for (const controller of treeRequestsRef.current.values()) controller.abort()
    treeRequestsRef.current.clear()
    treeRemovedPathsRef.current.clear()
    searchControllerRef.current?.abort()
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current)
      searchTimerRef.current = null
    }
    gitControllerRef.current?.abort()
  }, [gitControllerRef, projectId, setChanges, setGitBranch, setGitError, setGitLoadStatus, setIsGitRepository])

  // 恢复上次会话的目录树展开状态：打开且项目有效时仅做一次（ref 防重复）。
  // 已缓存的目录会命中 loadTreeDirectory 的缓存 seed；缓存 miss 的目录走网络（可接受）。
  useEffect(() => {
    if (!projectId || !open) return
    if (restoredExpandedProjectRef.current === projectId) return
    restoredExpandedProjectRef.current = projectId
    const projectToken = projectGuardRef.current.token(projectId)
    void (async () => {
      const entry = await readWorkspaceExpandedCache(resolveServerCacheKey(), projectId)
      if (!entry || !projectGuardRef.current.isCurrent(projectToken)) return
      const paths = [...new Set(entry.expandedPaths.map(normalizeWorkspaceTreePath))].filter((path) => path !== '.')
      if (paths.length === 0) return
      setExpandedPaths(new Set(paths))
      for (const path of paths) void loadTreeDirectory(path)
    })()
  }, [open, projectId, loadTreeDirectory])

  useInspectorTabsEffects({ ...tabState, projectId, sessionId })

  // 文件读取统一入口：先读缓存快照——命中则立即写回 tab 并后台用 meta 校准
  // （一致即结束；不一致再全量重拉并覆写缓存）；未命中则直接请求并写缓存。
  // bypassCacheRead 供“刷新=权威”路径跳过缓存读、成功后覆写缓存。
  const loadReaderFileFromCacheOrServer = useCallback(async (panelTabId: string, readerId: string, filePath: string, projectToken: WorkspaceInspectorProjectToken, options: { bypassCacheRead?: boolean } = {}) => {
    if (!projectId) return
    const serverKey = resolveServerCacheKey()
    const applyFile = (file: WorkspaceFileResponse) => {
      updatePanelTab(panelTabId, (tab) => ({
        ...tab,
        readerTabs: (tab.readerTabs || []).map((item) => item.id === readerId ? { ...item, file, loading: false, error: undefined } : item),
      }))
    }
    const applyError = (err: unknown) => {
      updatePanelTab(panelTabId, (tab) => ({
        ...tab,
        readerTabs: (tab.readerTabs || []).map((item) => item.id === readerId ? { ...item, loading: false, error: err instanceof Error ? err.message : t('workspaceOpenFileFailed') } : item),
      }))
    }

    if (!options.bypassCacheRead) {
      const cached = await readWorkspaceFileCache(serverKey, projectId, filePath)
      if (cached) {
        applyFile({ path: cached.path, content: cached.content, size: cached.size, mtimeMs: cached.mtimeMs, language: cached.language, readonly: true })
        try {
          const meta = await getWorkspaceFileMeta(projectId, filePath)
          if (!projectGuardRef.current.isCurrent(projectToken)) return
          if (workspaceFileMatchesMeta(cached, meta)) return
          const file = await getWorkspaceFile(projectId, filePath)
          if (!projectGuardRef.current.isCurrent(projectToken)) return
          applyFile(file)
          void writeWorkspaceFileCache(serverKey, projectId, file)
        } catch {
          // 后台校准失败：保留缓存渲染，下次打开/刷新仍会校准。
        }
        return
      }
    }
    try {
      const file = await getWorkspaceFile(projectId, filePath)
      if (!projectGuardRef.current.isCurrent(projectToken)) return
      applyFile(file)
      void writeWorkspaceFileCache(serverKey, projectId, file)
    } catch (err) {
      if (!projectGuardRef.current.isCurrent(projectToken)) return
      applyError(err)
    }
  // Preserve the original project-only cache callback identity; updatePanelTab only closes over the stable setter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    const loadingReaders = panelTabs.flatMap((tab) => {
      if (tab.kind !== 'reader') return []
      return (tab.readerTabs || [])
        .filter((reader) => reader.loading && reader.mode === 'file')
        .map((reader) => ({ panelTabId: tab.id, reader }))
    })
    for (const { panelTabId, reader } of loadingReaders) {
      const key = `${projectId}:${reader.id}`
      if (loadingReaderKeysRef.current.has(key)) continue
      loadingReaderKeysRef.current.add(key)
      const projectToken = projectGuardRef.current.token(projectId)
      // refreshWorkspace 强制置 loading 的 reader 绕过缓存读，直接全量重拉。
      const bypassCacheRead = refreshedReaderIdsRef.current.has(reader.id)
      refreshedReaderIdsRef.current.delete(reader.id)
      void loadReaderFileFromCacheOrServer(panelTabId, reader.id, reader.path, projectToken, { bypassCacheRead })
        .finally(() => {
          loadingReaderKeysRef.current.delete(key)
        })
    }
  }, [panelTabs, projectId, loadReaderFileFromCacheOrServer])

  const { createPanelTab, createReaderPanelTab, openPanelTab, activatePanelTab, handlePanelTabDragStart, finishPanelTabDrag, handlePanelTabDragEnd, closePanelTab, closeOtherPanelTabs, closeAllPanelTabs } = useInspectorTabsActions({ ...tabState, onClearSideChat, onOpenChange, updatePanelTab })

  function updatePanelTab(id: string, updater: (tab: WorkspacePanelTab) => WorkspacePanelTab) {
    setPanelTabs((prev) => prev.map((tab) => tab.id === id ? updater(tab) : tab))
  }

  function selectPreviewFile(path: string) {
    const mode = artifactPreviewMode(path)
    if (mode === 'document') {
      const format = documentFormatFromPath(path)
      if (format) openDocumentTab(path, format)
      return
    }
    if (onPreviewArtifact && projectId) {
      onPreviewArtifact(projectId, path)
      return
    }
    void openFileTab(path)
  }

  async function openFileTab(path: string) {
    if (!projectId) return
    const projectToken = projectGuardRef.current.token(projectId)
    const id = readerTabId('file', path)
    const existingReaderTab = panelTabs.find((tab) => tab.kind === 'reader' && tab.readerTabs?.some((item) => item.id === id))
    if (existingReaderTab) {
      // 重复预览同一文件：复用已有 tab，置为 loading 并清除 error，由下方加载 effect 重新读取。
      setActivePanelTabId(existingReaderTab.id)
      updatePanelTab(existingReaderTab.id, (tab) => ({
        ...tab,
        activeReaderTabId: id,
        readerTabs: (tab.readerTabs || []).map((item) => item.id === id ? { ...item, loading: true, error: undefined } : item),
      }))
      return
    }
    const newTab: ReaderTab = { id, mode: 'file', path, loading: true }
    const targetTab = createReaderPanelTab(newTab)
    setPanelTabs((prev) => [...prev, targetTab])
    setActivePanelTabId(targetTab.id)
    // 统一走缓存优先的文件读取；注册 loading key 避免加载 effect 重复发起。
    const loadingKey = `${projectId}:${id}`
    loadingReaderKeysRef.current.add(loadingKey)
    try {
      await loadReaderFileFromCacheOrServer(targetTab.id, id, path, projectToken)
    } finally {
      loadingReaderKeysRef.current.delete(loadingKey)
    }
  }
  openFileTabRef.current = openFileTab

  function openDocumentTab(path: string, format: DocumentFormat) {
    if (!projectId) return
    const existing = panelTabs.find((tab) => tab.kind === 'document' && tab.document?.path.replace(/\\/g, '/') === path.replace(/\\/g, '/'))
    if (existing) {
      setActivePanelTabId(existing.id)
      updatePanelTab(existing.id, (tab) => ({
        ...tab,
        document: { path, format },
        reloadNonce: (tab.reloadNonce ?? 0) + 1,
      }))
      return
    }
    const targetTab = createPanelTab('document', { document: { path, format } })
    setPanelTabs((prev) => [...prev, targetTab])
    setActivePanelTabId(targetTab.id)
  }
  openDocumentTabRef.current = openDocumentTab
  openDiffTabRef.current = openDiffTab

  // 拉取单文件 git diff 并写回对应 reader tab；guard 失效（项目已切换）时放弃写入。
  async function loadDiffIntoReaderTab(panelTabId: string, readerId: string, path: string, projectToken: WorkspaceInspectorProjectToken) {
    try {
      const diff = await getGitFileDiff(projectToken.projectId, path)
      if (!projectGuardRef.current.isCurrent(projectToken)) return
      updatePanelTab(panelTabId, (tab) => ({ ...tab, readerTabs: (tab.readerTabs || []).map((item) => item.id === readerId ? { ...item, diff, loading: false, error: undefined, noChanges: undefined } : item) }))
    } catch (err) {
      if (!projectGuardRef.current.isCurrent(projectToken)) return
      // 会话累计口径的文件被 commit/revert 后 Git 工作区已无变更：404 转为友好空态。
      const noChanges = isNoWorkingTreeChangesError(err)
      updatePanelTab(panelTabId, (tab) => ({ ...tab, readerTabs: (tab.readerTabs || []).map((item) => item.id === readerId ? (noChanges
        ? { ...item, loading: false, error: undefined, noChanges: true }
        : { ...item, loading: false, error: err instanceof Error ? err.message : t('workspaceOpenDiffFailed'), noChanges: undefined }) : item) }))
    }
  }

  async function openDiffTab(path: string, switchToChanges: boolean) {
    if (!projectId) return
    const projectToken = projectGuardRef.current.token(projectId)
    const reviewTab = panelTabs.find((tab) => tab.kind === 'review')
    const targetTab = reviewTab || openPanelTab('review', switchToChanges ? 'changes' : 'review')
    setActivePanelTabId(targetTab.id)
    if (switchToChanges && targetTab.kind === 'review') {
      updatePanelTab(targetTab.id, (tab) => ({ ...tab, reviewView: 'changes' }))
    }
    const id = readerTabId('diff', path)
    const existingReader = targetTab.readerTabs?.find((tab) => tab.id === id)
    if (existingReader) {
      // 在途请求只激活不重复发起；已是终态（diff/error/noChanges，含产物被删除后的
      // 空态）则重置为 loading 重新拉取，保证再次点「审查」能恢复而不是永远复用旧结果。
      if (existingReader.loading) {
        updatePanelTab(targetTab.id, (tab) => ({ ...tab, activeReaderTabId: id }))
        return
      }
      updatePanelTab(targetTab.id, (tab) => ({ ...tab, activeReaderTabId: id, readerTabs: (tab.readerTabs || []).map((item) => item.id === id ? { ...item, diff: undefined, loading: true, error: undefined, noChanges: undefined } : item) }))
      await loadDiffIntoReaderTab(targetTab.id, id, path, projectToken)
      return
    }
    const newTab: ReaderTab = { id, mode: 'diff', path, loading: true }
    updatePanelTab(targetTab.id, (tab) => ({
      ...tab,
      readerTabs: [...(tab.readerTabs || []), newTab],
      activeReaderTabId: id,
    }))
    await loadDiffIntoReaderTab(targetTab.id, id, path, projectToken)
  }

  async function selectDiffInPlace(path: string) {
    await openDiffTab(path, false)
  }

  const { startResizing, resize, stopResizing, startNavResizing, navResize, stopNavResizing, toggleFullscreen } = useInspectorLayoutActions({ ...layoutState, open, onFullscreenChange, leftSidebarWidth, conversationMinWidth, activePanelTab: activePanelTab, activeReaderTabId: activeReaderTabId })

  if (!mounted) return null

  return (
    <>
      <aside
        ref={asideRef}
        className={cn(
          'relative shrink-0 overflow-hidden flex-col bg-background transition-[width,min-width,max-width,opacity,transform] duration-200 ease-out will-change-[width,opacity,transform] lg:flex',
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
            className="absolute inset-y-0 -left-2 z-20 w-4 cursor-col-resize bg-transparent"
            onPointerDown={startResizing}
            onPointerMove={resize}
            onPointerUp={stopResizing}
            onPointerCancel={stopResizing}
          />
        ) : null}
        <div className={cn(
          'flex h-14 shrink-0 items-center gap-2 border-b border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-background pl-3 transition-opacity duration-150',
          fullscreen ? 'pr-2' : 'pr-[5.5rem]',
          fullscreenAnimating ? 'opacity-0' : 'opacity-100',
        )}>
          {panelTabs.length > 0 ? (
            <div ref={tabListRef} className="relative shrink-0">
              <button
                type="button"
                className="flex size-9 items-center justify-center rounded-xl bg-transparent transition-colors hover:bg-[var(--quickforge-sidebar-hover-bg)]"
                onClick={() => setTabListOpen((value) => !value)}
                aria-label={t('rightPanelOpenTabsTitle')}
                title={t('rightPanelOpenTabsTitle')}
                aria-haspopup="menu"
                aria-expanded={tabListOpen}
              >
                <ChevronDown className={cn('size-4 transition-transform', tabListOpen && 'rotate-180')} />
              </button>
              {tabListOpen ? (
                <div className="absolute left-0 top-12 z-40 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-popover p-2 shadow-quickforge" role="menu">
                  <div className="max-h-[min(25rem,calc(100dvh-10rem))] overflow-y-auto overscroll-contain">
                    {panelTabs.map((tab) => {
                      const item = panelTabMeta(tab)
                      const Icon = tab.kind === 'goal' ? GoalIcon : item?.icon
                      const filePath = panelTabFilePath(tab)
                      const active = tab.id === activePanelTabId
                      const label = panelTabLabel(tab, project?.name)
                      const title = panelTabTitle(tab, label)
                      return (
                        <div
                          key={tab.id}
                          className={cn(
                            'group flex h-10 w-full items-center gap-2 rounded-xl px-2 transition-colors',
                            active
                              ? 'bg-[var(--quickforge-sidebar-active-bg)] text-foreground'
                              : 'hover:bg-[var(--quickforge-sidebar-hover-bg)] hover:text-foreground',
                          )}
                          role="none"
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium"
                            onClick={() => {
                              activatePanelTab(tab)
                              setTabListOpen(false)
                            }}
                            role="menuitem"
                            title={title}
                          >
                            {filePath ? <FileIcon path={filePath} className="size-4 shrink-0" /> : tab.kind === 'subagent' ? <Bot className="size-4 shrink-0" /> : Icon ? <Icon className="size-4 shrink-0" /> : <Code2 className="size-4 shrink-0" />}
                            <span className="min-w-0 flex-1 truncate">{label}</span>
                          </button>
                          <button
                            type="button"
                            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full opacity-70 transition-colors hover:bg-destructive/10 group-hover:opacity-100"
                            onClick={(event) => {
                              event.stopPropagation()
                              closePanelTab(tab.id)
                            }}
                            aria-label={t('close')}
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-2 border-t border-[color-mix(in_oklab,var(--border)_34%,transparent)] pt-2">
                    <button
                      type="button"
                      className="flex h-9 w-full items-center rounded-xl px-3 text-left text-sm font-medium transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                      onClick={closeOtherPanelTabs}
                      disabled={panelTabs.length <= 1}
                      role="menuitem"
                    >
                      {t('rightPanelCloseOtherTabs')}
                    </button>
                    <button
                      type="button"
                      className="flex h-9 w-full items-center rounded-xl px-3 text-left text-sm font-medium transition-colors hover:bg-destructive/10"
                      onClick={closeAllPanelTabs}
                      role="menuitem"
                    >
                      {t('rightPanelCloseAllTabs')}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <DndContext
            sensors={panelTabSensors}
            collisionDetection={closestCenter}
            onDragStart={handlePanelTabDragStart}
            onDragEnd={handlePanelTabDragEnd}
            onDragCancel={finishPanelTabDrag}
            modifiers={[restrictPanelTabToHorizontal]}
          >
            <SortableContext items={panelTabIds} strategy={horizontalListSortingStrategy}>
              <div className={cn('quickforge-inspector-tab-strip flex h-8 min-w-0 flex-1 items-center gap-1 overflow-x-auto', draggingPanelTabId && 'cursor-grabbing')}>
                {panelTabs.map((tab, index) => {
                  const item = panelTabMeta(tab)
                  const Icon = tab.kind === 'goal' ? GoalIcon : item?.icon
                  const filePath = panelTabFilePath(tab)
                  const active = tab.id === activePanelTabId
                  const label = panelTabLabel(tab, project?.name)
                  const title = panelTabTitle(tab, label)
                  return (
                    <SortablePanelTab key={tab.id} id={tab.id}>
                      {({ listeners, attributes, isDragging }) => (
                        <>
                          {index > 0 ? <span aria-hidden="true" className="mx-0.5 h-3 w-px bg-[color-mix(in_oklab,var(--muted-foreground)_18%,transparent)]" /> : null}
                          <button
                            type="button"
                            className={cn(
                              'group flex h-8 max-w-40 cursor-grab items-center gap-2 rounded-xl px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] active:cursor-grabbing',
                              active
                                ? 'bg-[color-mix(in_oklab,var(--muted)_86%,transparent)] hover:bg-[color-mix(in_oklab,var(--muted)_86%,transparent)]'
                                : 'hover:bg-[color-mix(in_oklab,var(--muted)_72%,transparent)]',
                              isDragging && 'shadow-quickforge',
                            )}
                            onClick={() => {
                              if (!draggingPanelTabId) activatePanelTab(tab)
                            }}
                            title={title}
                            {...listeners}
                            {...attributes}
                          >
                            {filePath ? (
                              <FileIcon path={filePath} className={cn('size-4 shrink-0 transition-opacity', active ? 'opacity-100' : 'opacity-55 group-hover:opacity-85')} />
                            ) : tab.kind === 'subagent' ? (
                              <Bot className={cn('size-4 shrink-0', active ? '' : '')} />
                            ) : Icon ? (
                              <Icon className={cn('size-4 shrink-0', active ? '' : '')} />
                            ) : (
                              <Code2 className={cn('size-4 shrink-0', active ? '' : '')} />
                            )}
                            <span className="min-w-0 truncate">{label}</span>
                            <span
                              role="button"
                              tabIndex={0}
                              className={cn(
                                'ml-0.5 inline-flex size-5 shrink-0 cursor-default items-center justify-center rounded-full opacity-0 transition-all hover:bg-black hover:text-white group-hover:opacity-100',
                                active && 'opacity-100',
                              )}
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation()
                                closePanelTab(tab.id)
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  closePanelTab(tab.id)
                                }
                              }}
                              aria-label={t('close')}
                            >
                              <X className="size-3.5" />
                            </span>
                          </button>
                        </>
                      )}
                    </SortablePanelTab>
                  )
                })}
                {panelTabs.length === 0 ? <div className="min-w-0 flex-1" /> : null}
              </div>
            </SortableContext>
          </DndContext>
          <div className="flex shrink-0 items-center gap-1">
            {panelTabs.length > 0 || fullscreen ? (
              <div ref={menuRef} className="relative shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  className="rounded-[10px] hover:bg-[var(--quickforge-sidebar-hover-bg)] disabled:opacity-40"
                  onClick={() => setMenuOpen((value) => !value)}
                  aria-label={t('rightPanelAddTab')}
                  title={t('rightPanelAddTab')}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <Plus className="size-[18px] stroke-[1.85]" />
                </Button>
                {menuOpen ? (
                <div className="absolute right-0 top-12 z-40 w-64 rounded-2xl border border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-popover p-2 shadow-quickforge" role="menu">
                  {availablePanelTabItems.map((item) => {
                    const Icon = item.icon
                    const active = item.kind === activePanelTab?.kind
                    return (
                      <button
                        key={item.kind}
                        type="button"
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium transition-colors',
                          active ? 'text-foreground' : 'hover:text-foreground',
                        )}
                        onClick={() => openPanelTab(item.kind, viewFromPanelKind(item.kind))}
                        role="menuitem"
                      >
                        <Icon className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      </button>
                    )
                  })}
                </div>
              ) : null}
              </div>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 rounded-[10px] hover:bg-[var(--quickforge-sidebar-hover-bg)] disabled:opacity-40"
              disabled={fullscreenAnimating}
              onClick={() => toggleFullscreen()}
              aria-label={fullscreen ? t('workspaceExitFullscreen') : t('workspaceFullscreen')}
              title={fullscreen ? t('workspaceExitFullscreen') : t('workspaceFullscreen')}
            >
              {fullscreen ? <Minimize className="size-[18px] stroke-[1.85]" /> : <Maximize className="size-[18px] stroke-[1.85]" />}
            </Button>
            {fullscreen ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'shrink-0 rounded-[10px] hover:bg-[var(--quickforge-sidebar-hover-bg)] disabled:opacity-40',
                    globalTerminalOpen && 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                  disabled={fullscreenAnimating || !onShowGlobalTerminal}
                  onClick={() => toggleFullscreen(onShowGlobalTerminal)}
                  aria-label={t('rightPanelTerminal')}
                  title={t('rightPanelTerminal')}
                >
                  <SquareTerminal className="size-[18px] stroke-[1.85]" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 rounded-[10px] bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
                  disabled={fullscreenAnimating}
                  onClick={() => toggleFullscreen(() => onOpenChange(false))}
                  aria-label={t('workspaceCollapseRightPanel')}
                  title={t('workspaceCollapseRightPanel')}
                >
                  <PanelRight className="size-[18px] stroke-[1.85]" />
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <div className={cn('flex min-h-0 flex-1 transition-opacity duration-150', fullscreenAnimating ? 'opacity-0' : 'opacity-100')}>
          {!project?.id && activePanelTab?.kind !== 'goal' && activePanelTab?.kind !== 'subagent' && activePanelTab?.kind !== 'side-chat' ? (
            <div className="p-4 text-sm">{t('workspaceSelectProject')}</div>
          ) : !activePanelTab ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-5">
              <div className="w-full max-w-[26rem] space-y-4">
                <div className="text-center font-sans">
                  <div className="text-lg font-semibold leading-tight tracking-[-0.01em]">{t('rightPanelOpenTabsTitle')}</div>
                  <div className="mt-2 text-sm leading-5">{t('rightPanelOpenTabsDescription')}</div>
                </div>
                <div className="space-y-2">
                  {availablePanelTabItems.map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.kind}
                        type="button"
                        className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-muted/60 px-4 py-3 text-left transition-colors"
                        onClick={() => openPanelTab(item.kind, viewFromPanelKind(item.kind))}
                      >
                        <Icon className="size-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{item.label}</div>
                          <div className="mt-0.5 text-xs leading-4">{item.description}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : activePanelTab.kind === 'goal' ? (
            goalBinding && activePanelTab.goal && workspaceInspectorGoalMatches(activePanelTab.goal, goalBinding) ? (
              <GoalInspectorContent key={`${goalBinding.sessionId}:${goalBinding.goal.id}`} {...goalBinding} active={open} view={activePanelTab.goal.view} onViewChange={(view) => setPanelTabs((current) => current.map((tab) => tab.id === activePanelTab.id && tab.goal ? { ...tab, goal: { ...tab.goal, view } } : tab))} />
            ) : <div className="p-4 text-sm text-muted-foreground">{t('goalUnavailable')}</div>
          ) : activePanelTab.kind === 'subagent' ? (
            <SubagentRunDetailContent payload={activePanelTab.subagentRun} />
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
          ) : activePanelTab.kind === 'terminal' ? (
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
          ) : (
            <>
              {hasReaderPane ? (
                <div className="flex min-w-0 flex-1 flex-col bg-background">
                  {activeReaderTab ? (
                    <InlineReader
                      key={activeReaderTab.id}
                      project={project}
                      path={activeReaderTab.path}
                      mode={activeReaderTab.mode}
                      file={activeReaderTab.file}
                      diff={activeReaderTab.diff}
                      loading={activeReaderTab.loading}
                      error={activeReaderTab.error}
                      noChanges={activeReaderTab.noChanges}
                      onOpenCurrentFile={activeReaderTab.noChanges ? () => { void openFileTabRef.current?.(activeReaderTab.path) } : undefined}
                      navigationVisible={readerNavigationVisible}
                      onNavigationVisibleChange={setReaderNavigationVisible}
                      allowExternalOpen={Boolean(onOpenProjectInExplorer || onOpenProjectInVSCode || onOpenProjectInIDEA)}
                    />
                  ) : isFilesLanding ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
                      <div className="max-w-sm text-center">
                        <Folder className="mx-auto size-8 stroke-[1.6]" />
                        <div className="mt-3 text-sm font-medium">{t('workspaceOpenFileTitle')}</div>
                        <div className="mt-1 text-xs leading-5">{t('workspaceOpenFileDescription')}</div>
                      </div>
                    </div>
                  ) : null}
                </div>
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
                      <>
                        <div className="mb-2 flex items-center gap-1">
                          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-background px-2.5 py-2 text-sm">
                            <Search className="size-4 shrink-0" />
                            <input
                              value={filter}
                              onChange={(event) => setFilter(event.target.value)}
                              placeholder={t('workspaceFilterFiles')}
                              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                            />
                          </label>
                          <button
                            type="button"
                            className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => {
                              if (workspaceRefreshTarget(filter) === 'search') void runWorkspaceSearch(filter)
                              else void refreshWorkspace()
                            }}
                            disabled={treeRefreshing || searchState.status === 'loading'}
                            aria-label={t('refreshWorkspace')}
                            title={t('refreshWorkspace')}
                          >
                            <RefreshCw className={cn('size-3.5', (treeRefreshing || searchState.status === 'loading') && 'animate-spin')} />
                          </button>
                        </div>
                        {filter.trim().length === 1 ? <div className="px-2 py-2 text-xs">{t('workspaceSearchMinChars')}</div> : null}
                        {searchState.status === 'error' ? (
                          <div className="flex items-start gap-2 px-2 py-2 text-xs text-destructive">
                            <span className="min-w-0 flex-1">{searchState.error || t('workspaceLoadFailed')}</span>
                            <button
                              type="button"
                              className="shrink-0 rounded-md px-1.5 py-0.5 font-medium hover:text-foreground"
                              onClick={() => void runWorkspaceSearch(filter)}
                            >
                              {t('retry')}
                            </button>
                          </div>
                        ) : null}
                        {searchState.status === 'debouncing' || searchState.status === 'loading' ? <div className="px-2 py-2 text-xs">{t('workspaceSearching')}</div> : null}
                        {searchState.status === 'loaded' && displayedEntries.length === 0 ? <div className="px-2 py-3 text-sm">{t('workspaceNoSearchResults')}</div> : null}
                        {searchState.status === 'loaded' && searchState.truncated ? <div className="px-2 py-1 text-xs">{t('workspaceSearchTruncated')}</div> : null}
                        {trimmedFilter.length < 2 || (searchState.status === 'loaded' && displayedEntries.length > 0) ? (
                          <WorkspaceFileTree
                            treeState={trimmedFilter.length >= 2 ? { '.': { entries: displayedEntries, status: 'loaded', nextCursor: null, generation: 0 } } : treeState}
                            rootEntries={displayedEntries}
                            expandedPaths={trimmedFilter.length >= 2 ? new Set<string>() : expandedPaths}
                            directoriesExpandable={trimmedFilter.length < 2}
                            selectedPath={activeReaderTab?.mode === 'file' ? activeReaderTab.path : undefined}
                            gitStatuses={gitStatuses}
                            onToggleDirectory={(path) => {
                              if (trimmedFilter.length < 2) toggleTreeDirectory(path)
                            }}
                            onRetryDirectory={(path) => void loadTreeDirectory(path, { force: true })}
                            onLoadMore={(path) => void loadTreeDirectory(path, { append: true })}
                            onSelectFile={(path) => {
                              const node = displayedEntries.find((entry) => entry.path === path)
                              if (trimmedFilter.length < 2 || !node || workspaceSearchResultCanOpen(node)) void openFileTab(path)
                            }}
                            onPreviewFile={selectPreviewFile}
                            projectId={projectId}
                          />
                        ) : null}
                      </>
                    ) : null}
                    {navView === 'changes' ? (
                      shouldShowWorkspaceGitRetry(gitLoadStatus) ? (
                        <div className="p-2 text-sm text-destructive">
                          <div>{gitError || t('workspaceLoadFailed')}</div>
                          <button
                            type="button"
                            className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-xl border border-[color-mix(in_oklab,var(--border)_45%,transparent)] bg-background px-3 text-xs font-medium transition-colors"
                            onClick={() => void loadGitStatus(true)}
                          >
                            <RefreshCw className="size-3.5" />
                            {t('retry')}
                          </button>
                        </div>
                      ) : gitLoading ? <div className="px-2 py-3 text-xs">{t('workspaceLoading')}</div> : isGitRepository
                        ? (
                          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                            <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 pb-2">
                              <div ref={reviewFilterRef} className="relative min-w-24 flex-1">
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-full min-w-0 max-w-full items-center gap-2 rounded-xl border border-[color-mix(in_oklab,var(--border)_45%,transparent)] bg-background px-3 text-sm font-medium transition-colors hover:text-foreground"
                                  onClick={() => setReviewFilterOpen((value) => !value)}
                                  aria-haspopup="menu"
                                  aria-expanded={reviewFilterOpen}
                                  title={t('workspaceReviewFilter')}
                                >
                                  <span className="min-w-0 flex-1 truncate text-left">{REVIEW_FILTER_ITEMS.find((item) => item.value === reviewFilter)?.label}</span>
                                  <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', reviewFilterOpen && 'rotate-180')} />
                                </button>
                                {reviewFilterOpen ? (
                                  <div className="absolute left-0 top-10 z-40 w-48 rounded-2xl border border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-popover p-1.5 shadow-quickforge" role="menu" aria-label={t('workspaceReviewFilter')}>
                                    {REVIEW_FILTER_ITEMS.map((item) => {
                                      const active = item.value === reviewFilter
                                      return (
                                        <button
                                          key={item.value}
                                          type="button"
                                          className={cn(
                                            'flex h-9 w-full items-center gap-2 rounded-xl px-2.5 text-left text-sm font-medium transition-colors',
                                            active ? 'text-foreground' : 'hover:text-foreground',
                                          )}
                                          onClick={() => {
                                            setReviewFilter(item.value)
                                            setReviewFilterOpen(false)
                                          }}
                                          role="menuitemradio"
                                          aria-checked={active}
                                        >
                                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                          {active ? <Check className="size-3.5 shrink-0" /> : null}
                                        </button>
                                      )
                                    })}
                                  </div>
                                ) : null}
                              </div>
                              <div className="ml-auto flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                                  onClick={() => void loadGitStatus(true)}
                                  disabled={gitLoading}
                                  aria-label={t('refreshWorkspace')}
                                  title={t('refreshWorkspace')}
                                >
                                  <RefreshCw className={cn('size-3.5', gitLoading && 'animate-spin')} />
                                </button>
                                {(onOpenProjectInExplorer || onOpenProjectInVSCode || onOpenProjectInIDEA) ? (
                                  <ProjectOpenMenu
                                    project={project}
                                    disabledTargets={selectedReviewFile?.status === 'deleted' ? { vscode: true, idea: true } : undefined}
                                    targetDisabledLabel={t('workspaceCannotOpenDeletedFile')}
                                    onOpenInExplorer={() => { void handleOpenSelectedChangeExternally('explorer') }}
                                    onOpenInVSCode={() => { void handleOpenSelectedChangeExternally('vscode') }}
                                    onOpenInIDEA={() => { void handleOpenSelectedChangeExternally('idea') }}
                                  />
                                ) : null}
                                {onOpenCommitPush ? (
                                  <button
                                    type="button"
                                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors"
                                    onClick={onOpenCommitPush}
                                    aria-label={t('gitToolsCommitOrPush')}
                                    title={t('gitToolsCommitOrPush')}
                                  >
                                    <GitCommitHorizontal className="size-3.5" />
                                  </button>
                                ) : null}
                              </div>
                            </div>

                            <WorkspaceChangesList
                              files={reviewFiles}
                              selectedPath={expandedDiffPath}
                              expandedDiff={expandedDiff}
                              expandedLoading={expandedDiffLoading}
                              expandedError={expandedDiffError}
                              expandedNoChanges={expandedDiffNoChanges}
                              onSelectFile={toggleReviewDiff}
                              onRestoreFile={handleRestoreFile}
                              onStageFile={handleStageFile}
                              onUnstageFile={handleUnstageFile}
                              onOpenFile={handleOpenChangedFile}
                              onRestoreAll={handleRestoreAll}
                              onStageAll={handleStageAll}
                              onUnstageAll={handleUnstageAll}
                              showUnstageAll={reviewFilter === 'staged'}
                              pendingAction={pendingGitAction}
                              emptyMessage={reviewEmptyMessage(reviewFilter)}
                            />

                          </div>
                        )
                        : <div className="px-2 py-3 text-xs">{t('workspaceNotGitRepository')}</div>
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
