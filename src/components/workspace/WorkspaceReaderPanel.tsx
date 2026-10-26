import { Check, ChevronDown, ChevronRight, Code2, Copy, CornerDownLeft, Eye, Folder, MoreHorizontal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { ProjectInfo } from '@/lib/types'
import type { AiTurnArtifact } from '@/lib/tool-artifacts'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { ProjectOpenMenu } from '@/components/project/ProjectOpenMenu'
import { showAlert } from '@/components/ui/confirm-dialog'
import { MarkdownReader } from './MarkdownReader'
import { MonacoCodeViewer } from './MonacoCodeViewer'
import { MonacoDiffViewer } from './MonacoDiffViewer'
import { countDiffLines } from './diff-line-counts'
import { FileIcon } from './file-icon'
import { openWorkspaceExternal } from './workspace-api'
import { artifactFileName, isBrowserPreviewablePath, isDocumentPreviewablePath, presentArtifacts } from './artifact-preview-utils'
import { normalizeWorkspacePath } from './workspace-path-utils'
import type { ReaderMode, ReaderTab } from './workspace-inspector-tabs'
import type { GitFileDiffResponse, WorkspaceFileResponse } from './workspace-types'

function isMarkdownFile(file?: WorkspaceFileResponse) {
  if (!file) return false
  return file.language === 'markdown' || /\.(md|mdx|markdown)$/i.test(file.path)
}

function readerDiffText(diff: GitFileDiffResponse) {
  const header = diff.oldPath ? `${diff.oldPath} -> ${diff.path}` : diff.path
  return `Diff for ${header}\n\n--- OLD\n${diff.oldContent}\n\n--- NEW\n${diff.newContent}`
}

export function InlineReader({ project, path, mode, file, diff, loading, error, noChanges, navigationVisible, onNavigationVisibleChange, allowExternalOpen = true, onOpenCurrentFile, titleLabel }: {
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
  /** 命令日志等非工作区文件的替代标题（面包屑不再按 `/` 拆绝对路径）。 */
  titleLabel?: string
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
    () => (titleLabel ? [titleLabel] : normalizeWorkspacePath(title).split('/').filter(Boolean)),
    [title, titleLabel],
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

/** 文件 Tab 落地页：WorkspaceOverview/当前产物 + 项目与分支摘要。 */
export function WorkspaceOverview({ project, artifacts, changesCount, changedPaths, isGitRepository, gitBranch, onSelectFile, onSelectDiff, onPreviewFile }: {
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

type WorkspaceReaderPaneProps = {
  project?: ProjectInfo
  activeReaderTab?: ReaderTab
  isFilesLanding: boolean
  navigationVisible: boolean
  onNavigationVisibleChange: (visible: boolean) => void
  allowExternalOpen: boolean
  titleLabel?: string
  openFileTabRef: RefObject<((path: string) => void) | undefined>
}

/** 右侧 reader 列：内联 reader，或在文件落地页显示空态提示。 */
export function WorkspaceReaderPane({ project, activeReaderTab, isFilesLanding, navigationVisible, onNavigationVisibleChange, allowExternalOpen, titleLabel, openFileTabRef }: WorkspaceReaderPaneProps) {
  return (
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
          navigationVisible={navigationVisible}
          onNavigationVisibleChange={onNavigationVisibleChange}
          // 命令日志在工作区外，「在资源管理器中显示 / 用编辑器打开」这类
          // 入口走 /api/workspace/open-external（工作区外 403），直接隐藏。
          allowExternalOpen={allowExternalOpen}
          titleLabel={titleLabel}
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
  )
}
