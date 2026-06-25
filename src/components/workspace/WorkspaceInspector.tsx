import { Check, ChevronDown, ChevronsLeftRight, Code2, Folder, GitBranch, Globe2, LayoutGrid, Maximize2, MessageSquare, Minimize2, PanelRightClose, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectInfo } from '@/lib/types'
import type { AiTurnArtifact } from '@/lib/tool-artifacts'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { WebPreviewContent } from '@/components/preview/WebPreviewContent'
import { getGitFileDiff, getGitStatus, getWorkspaceFile, getWorkspaceTree } from './workspace-api'
import { WorkspaceChangesList } from './WorkspaceChangesList'
import { WorkspaceFileTree } from './WorkspaceFileTree'
import { WorkspaceReaderDialog } from './WorkspaceReaderDialog'
import { artifactFileName, presentArtifacts } from './artifact-preview-utils'
import type { GitChangedFile, GitFileDiffResponse, GitStatusResponse, WorkspaceFileResponse, WorkspaceInspectorFocusTarget, WorkspacePanelView, WorkspaceTreeNode } from './workspace-types'

type WorkspaceInspectorProps = {
  project?: ProjectInfo
  open: boolean
  view: WorkspacePanelView
  onViewChange: (view: WorkspacePanelView) => void
  onOpenChange: (open: boolean) => void
  onPreviewArtifact?: (path: string) => void
  onDraftRequest?: (text: string) => void
  focusTarget?: WorkspaceInspectorFocusTarget
  previewUrl: string
  onPreviewUrlChange: (url: string) => void
  artifacts?: AiTurnArtifact[]
}

type ReaderMode = 'file' | 'diff'

type WorkspaceMenuItem = {
  view: WorkspacePanelView
  label: string
  icon: typeof LayoutGrid
}

const WORKSPACE_MENU_ITEMS: WorkspaceMenuItem[] = [
  { view: 'overview', label: t('workspaceOverview'), icon: LayoutGrid },
  { view: 'files', label: t('workspaceFiles'), icon: Folder },
  { view: 'browser', label: t('workspaceBrowser'), icon: Globe2 },
  { view: 'changes', label: t('workspaceChanges'), icon: GitBranch },
]

const WORKSPACE_INSPECTOR_MIN_WIDTH = 300
const WORKSPACE_INSPECTOR_DEFAULT_WIDTH = 380
const WORKSPACE_INSPECTOR_MAX_WIDTH = 640

function filterWorkspaceTree(tree: WorkspaceTreeNode[], rawQuery: string): WorkspaceTreeNode[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return tree

  return tree.flatMap((node) => {
    const children = node.children ? filterWorkspaceTree(node.children, query) : undefined
    const matches = node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query)
    if (!matches && (!children || children.length === 0)) return []
    return [{ ...node, ...(children ? { children } : {}) }]
  })
}

function allChangesPrompt(files: GitChangedFile[]) {
  const list = files.map((file) => `- ${file.status}: ${file.oldPath ? `${file.oldPath} -> ` : ''}${file.path}`).join('\n')
  return `Please review the current workspace changes and generate a concise summary, risk assessment, verification plan, and a suggested commit message.\n\nChanged files:\n${list}`
}

function commitMessagePrompt(files: GitChangedFile[]) {
  const list = files.map((file) => `- ${file.status}: ${file.oldPath ? `${file.oldPath} -> ` : ''}${file.path}`).join('\n')
  return `Please generate a concise Conventional Commit message for the current Git changes. Include a one-line subject and an optional short body if useful.\n\nChanged files:\n${list}`
}

function gitSummary(branch?: string, counts?: GitStatusResponse['counts']) {
  const parts = [`${t('workspaceCurrentBranch')}: ${branch || t('unknown')}`]
  if (counts?.total) parts.push(`${counts.total} ${t('workspaceChangeCount')}`)
  return parts.join(' · ')
}

function GitGroup({ title, files, selectedPath, onSelectFile }: {
  title: string
  files: GitChangedFile[]
  selectedPath?: string
  onSelectFile: (path: string) => void
}) {
  if (files.length === 0) return null
  return (
    <div className="space-y-1">
      <div className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">{title} {files.length}</div>
      <WorkspaceChangesList files={files} selectedPath={selectedPath} onSelectFile={onSelectFile} />
    </div>
  )
}

function WorkspaceMenu({ view, changesCount, open, onOpenChange, onViewChange }: {
  view: WorkspacePanelView
  changesCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onViewChange: (view: WorkspacePanelView) => void
}) {
  const selected = WORKSPACE_MENU_ITEMS.find((item) => item.view === view) ?? WORKSPACE_MENU_ITEMS[0]
  const SelectedIcon = selected.icon

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        className="flex max-w-full items-center gap-2 rounded-xl bg-muted/20 px-2.5 py-1.5 text-left text-sm font-semibold text-foreground/90 transition-colors hover:bg-muted/28"
        onClick={() => onOpenChange(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <SelectedIcon className="size-4 shrink-0 text-foreground/75" />
        <span className="min-w-0 truncate">{selected.label}</span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground/65 transition-transform', open ? 'rotate-180' : '')} />
      </button>
      {open ? (
        <div className="absolute left-0 top-11 z-40 w-64 rounded-2xl border border-border bg-card p-2 shadow-xl">
          {WORKSPACE_MENU_ITEMS.map((item) => {
            const Icon = item.icon
            const active = item.view === view
            return (
              <button
                key={item.view}
                type="button"
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors',
                  active ? 'bg-muted/28 text-foreground/90' : 'text-foreground/80 hover:bg-muted/20 hover:text-foreground/90',
                )}
                onClick={() => {
                  onViewChange(item.view)
                  onOpenChange(false)
                }}
              >
                <Icon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}{item.view === 'changes' && changesCount ? ` ${changesCount}` : ''}</span>
                {active ? <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-500" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function WorkspaceOverview({ project, artifacts, changesCount, changedPaths, isGitRepository, gitBranch, onViewChange, onSelectFile, onSelectDiff, onPreviewFile }: {
  project?: ProjectInfo
  artifacts: AiTurnArtifact[]
  changesCount: number
  changedPaths: Set<string>
  isGitRepository: boolean
  gitBranch?: string
  onViewChange: (view: WorkspacePanelView) => void
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
      <div className="rounded-lg border border-border bg-muted/10 px-3 py-3">
        <div className="text-xs font-medium text-foreground/85">{project?.name ?? t('noProjectSelected')}</div>
        <div className="mt-1 text-[11px] text-muted-foreground/65">
          {isGitRepository ? `${t('workspaceCurrentBranch')}: ${gitBranch || t('unknown')} · ${changesCount} ${t('workspaceChangeCount')}` : t('workspaceNotGitRepository')}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background px-3 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground/90">
          <Code2 className="size-3.5 text-emerald-600 dark:text-emerald-500" />
          {t('workspaceCurrentArtifacts')}
        </div>
        {artifacts.length === 0 ? (
          <div className="mt-2 text-xs leading-5 text-muted-foreground/70">{t('workspaceNoArtifacts')}</div>
        ) : (
          <div className="mt-3 space-y-3">
            {fileArtifacts.length ? (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">{t('workspaceFiles')} {fileArtifacts.length}</div>
                {fileArtifacts.slice(0, 8).map((artifact) => {
                  const path = artifact.path
                  const canPreview = artifact.kind === 'html'
                  const canViewDiff = changedPaths.has(path)
                  const hasDiff = typeof artifact.addedLines === 'number' || typeof artifact.removedLines === 'number'
                  return (
                    <div key={artifact.id} className="group flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground/85 transition-colors hover:bg-muted/20">
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
                      <span className="shrink-0 rounded-full bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/70">{artifact.kind}</span>
                      {canPreview ? (
                        <button
                          type="button"
                          className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-blue-600 opacity-0 transition-opacity hover:bg-blue-500/10 group-hover:opacity-100 dark:text-blue-400"
                          onClick={() => onPreviewFile(path)}
                        >
                          {t('openPreview')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/70 opacity-0 transition-opacity hover:bg-muted/25 group-hover:opacity-100"
                        onClick={() => canViewDiff ? onSelectDiff(path) : onSelectFile(path)}
                      >
                        {canViewDiff ? t('workspaceViewDiff') : t('artifactPreviewViewSource')}
                      </button>
                    </div>
                  )
                })}
                {fileArtifacts.length > 8 ? <div className="px-2 text-[11px] text-muted-foreground/60">+{fileArtifacts.length - 8}</div> : null}
              </div>
            ) : null}
            {commandArtifacts.length ? (
              <div className="space-y-1.5">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60 transition-colors hover:bg-muted/15 hover:text-foreground/75"
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
                        <div key={artifact.id} className="rounded-md bg-muted/15 text-[11px] text-muted-foreground/80">
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-muted/20"
                            onClick={() => toggleCommand(artifact.id)}
                            aria-expanded={expanded}
                          >
                            <ChevronDown className={cn('size-3 shrink-0 transition-transform', expanded ? '' : '-rotate-90')} />
                            <span className="shrink-0 font-medium text-muted-foreground/65">#{index + 1}</span>
                            <span className="min-w-0 flex-1 truncate font-mono">{artifact.command}</span>
                          </button>
                          {expanded ? (
                            <div className="space-y-1 border-t border-border/30 px-2 py-2">
                              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground/80">{artifact.command}</pre>
                              {artifact.outputFile ? <div className="text-[10px] text-muted-foreground/65">{t('workspaceCommandOutput')}: <span className="font-mono">{artifact.outputFile}</span></div> : null}
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

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="rounded-lg border border-border bg-background px-3 py-2 text-left text-xs font-medium text-foreground/85 transition-colors hover:bg-muted/20" onClick={() => onViewChange('files')}>
          <Folder className="mb-1 size-4" />
          {t('workspaceFiles')}
        </button>
        <button type="button" className="rounded-lg border border-border bg-background px-3 py-2 text-left text-xs font-medium text-foreground/85 transition-colors hover:bg-muted/20" onClick={() => onViewChange('browser')}>
          <Globe2 className="mb-1 size-4" />
          {t('workspaceBrowser')}
        </button>
        <button type="button" className="rounded-lg border border-border bg-background px-3 py-2 text-left text-xs font-medium text-foreground/85 transition-colors hover:bg-muted/20" onClick={() => onViewChange('changes')}>
          <GitBranch className="mb-1 size-4" />
          {t('workspaceChanges')} {changesCount ? changesCount : ''}
        </button>
      </div>
    </div>
  )
}

export function WorkspaceInspector({ project, open, view, onViewChange, onOpenChange, onPreviewArtifact, onDraftRequest, focusTarget, previewUrl, onPreviewUrlChange, artifacts = [] }: WorkspaceInspectorProps) {
  const [tree, setTree] = useState<WorkspaceTreeNode[]>([])
  const [changes, setChanges] = useState<GitChangedFile[]>([])
  const [gitBranch, setGitBranch] = useState<string>()
  const [gitCounts, setGitCounts] = useState<GitStatusResponse['counts']>()
  const [isGitRepository, setIsGitRepository] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [filter, setFilter] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)

  const [selectedFilePath, setSelectedFilePath] = useState<string>()
  const [selectedFile, setSelectedFile] = useState<WorkspaceFileResponse>()
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string>()

  const [selectedDiffPath, setSelectedDiffPath] = useState<string>()
  const [selectedDiff, setSelectedDiff] = useState<GitFileDiffResponse>()
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string>()
  const [readerOpen, setReaderOpen] = useState(false)
  const [readerMode, setReaderMode] = useState<ReaderMode>('file')
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)
  const [width, setWidth] = useState(WORKSPACE_INSPECTOR_DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [fullscreenAnimating, setFullscreenAnimating] = useState(false)
  const asideRef = useRef<HTMLElement | null>(null)
  const resizeDragRef = useRef<{ startX: number; startWidth: number; currentWidth: number } | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const fullscreenAnimationRef = useRef<Animation | null>(null)
  const previousBodyStyleRef = useRef<{ cursor: string; userSelect: string } | null>(null)

  const projectId = project?.id

  const gitStatuses = useMemo(() => {
    const map: Record<string, GitChangedFile> = {}
    for (const file of changes) map[file.path] = file
    return map
  }, [changes])

  const changedPaths = useMemo(() => {
    const paths = new Set<string>()
    for (const file of changes) {
      paths.add(file.path)
      if (file.oldPath) paths.add(file.oldPath)
    }
    return paths
  }, [changes])

  const filteredTree = useMemo(() => filterWorkspaceTree(tree, filter), [filter, tree])

  const gitGroups = useMemo(() => ({
    conflicts: changes.filter((file) => file.conflict || file.status === 'conflicted'),
    staged: changes.filter((file) => !file.conflict && file.status !== 'untracked' && file.staged),
    unstaged: changes.filter((file) => !file.conflict && file.status !== 'untracked' && file.unstaged),
    untracked: changes.filter((file) => !file.conflict && file.status === 'untracked'),
  }), [changes])

  useEffect(() => {
    if (open) {
      let disposed = false
      queueMicrotask(() => {
        if (disposed) return
        setMounted(true)
        window.requestAnimationFrame(() => {
          if (!disposed) setVisible(true)
        })
      })
      return () => { disposed = true }
    }

    let disposed = false
    queueMicrotask(() => {
      if (!disposed) setVisible(false)
    })
    const timer = window.setTimeout(() => setMounted(false), 180)
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [open])

  useEffect(() => {
    let disposed = false
    if (!open || !focusTarget) return () => { disposed = true }
    queueMicrotask(() => {
      if (disposed) return
      onViewChange(focusTarget.tab === 'git' ? 'changes' : 'files')
    })
    return () => { disposed = true }
  }, [focusTarget, onViewChange, open])

  useEffect(() => {
    let disposed = false
    if (!projectId || !open) return
    queueMicrotask(() => {
      if (disposed) return
      setLoading(true)
      setError(undefined)
      Promise.all([
        getWorkspaceTree(projectId),
        getGitStatus(projectId),
      ])
        .then(([treeResponse, statusResponse]) => {
          if (disposed) return
          setTree(treeResponse.tree)
          setChanges(statusResponse.files)
          setGitBranch(statusResponse.branch)
          setGitCounts(statusResponse.counts)
          setIsGitRepository(statusResponse.isGitRepository)
        })
        .catch((err: unknown) => {
          if (!disposed) setError(err instanceof Error ? err.message : t('workspaceLoadFailed'))
        })
        .finally(() => {
          if (!disposed) setLoading(false)
        })
    })
    return () => { disposed = true }
  }, [open, projectId, refreshToken])

  useEffect(() => {
    queueMicrotask(() => {
      setSelectedFilePath(undefined)
      setSelectedFile(undefined)
      setFileError(undefined)
      setSelectedDiffPath(undefined)
      setSelectedDiff(undefined)
      setDiffError(undefined)
      setReaderOpen(false)
    })
  }, [projectId])

  function selectPreviewFile(path: string) {
    if (onPreviewArtifact) {
      onPreviewArtifact(path)
      return
    }
    selectFile(path)
  }

  async function selectFile(path: string) {
    if (!projectId) return
    onViewChange('files')
    setReaderMode('file')
    setReaderOpen(true)
    setSelectedFilePath(path)
    setSelectedFile(undefined)
    setFileLoading(true)
    setFileError(undefined)
    try {
      setSelectedFile(await getWorkspaceFile(projectId, path))
    } catch (err) {
      setSelectedFile(undefined)
      setFileError(err instanceof Error ? err.message : t('workspaceOpenFileFailed'))
    } finally {
      setFileLoading(false)
    }
  }

  async function openDiff(path: string, switchToChanges: boolean) {
    if (!projectId) return
    if (switchToChanges) onViewChange('changes')
    setReaderMode('diff')
    setReaderOpen(true)
    setSelectedDiffPath(path)
    setSelectedDiff(undefined)
    setDiffLoading(true)
    setDiffError(undefined)
    try {
      setSelectedDiff(await getGitFileDiff(projectId, path))
    } catch (err) {
      setSelectedDiff(undefined)
      setDiffError(err instanceof Error ? err.message : t('workspaceOpenDiffFailed'))
    } finally {
      setDiffLoading(false)
    }
  }

  async function selectDiff(path: string) {
    await openDiff(path, true)
  }

  async function selectDiffInPlace(path: string) {
    await openDiff(path, false)
  }

  function refresh() {
    setRefreshToken((value) => value + 1)
  }

  function startResizing(event: React.PointerEvent<HTMLDivElement>) {
    resizeDragRef.current = { startX: event.clientX, startWidth: width, currentWidth: width }
    previousBodyStyleRef.current = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    setIsResizing(true)
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* ignore */ }
  }

  function resize(event: React.PointerEvent<HTMLDivElement>) {
    const start = resizeDragRef.current
    const aside = asideRef.current
    if (!start || !aside) return
    start.currentWidth = Math.min(
      WORKSPACE_INSPECTOR_MAX_WIDTH,
      Math.max(WORKSPACE_INSPECTOR_MIN_WIDTH, start.startWidth + start.startX - event.clientX),
    )
    if (resizeFrameRef.current !== null) return
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null
      const current = resizeDragRef.current
      if (!current || !asideRef.current) return
      asideRef.current.style.width = `${current.currentWidth}px`
    })
  }

  function stopResizing(event: React.PointerEvent<HTMLDivElement>) {
    const finalWidth = resizeDragRef.current?.currentWidth
    resizeDragRef.current = null
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current)
      resizeFrameRef.current = null
    }
    if (typeof finalWidth === 'number') {
      if (asideRef.current) asideRef.current.style.width = `${finalWidth}px`
      setWidth(finalWidth)
    }
    const previousBodyStyle = previousBodyStyleRef.current
    if (previousBodyStyle) {
      document.body.style.cursor = previousBodyStyle.cursor
      document.body.style.userSelect = previousBodyStyle.userSelect
      previousBodyStyleRef.current = null
    }
    setIsResizing(false)
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
  }

  const toggleFullscreen = useCallback(() => {
    const aside = asideRef.current
    if (!aside) {
      setFullscreen((value) => !value)
      return
    }

    fullscreenAnimationRef.current?.cancel()
    const rect = aside.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const easing = 'cubic-bezier(0.22, 1, 0.36, 1)'
    setFullscreenAnimating(true)

    if (!fullscreen) {
      window.requestAnimationFrame(() => {
        const currentAside = asideRef.current
        if (!currentAside) return
        Object.assign(currentAside.style, {
          position: 'fixed',
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          right: 'auto',
          bottom: 'auto',
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          minWidth: '0px',
          maxWidth: 'none',
          zIndex: '40',
        })
        const animation = currentAside.animate(
          [
            { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` },
            { left: '0px', top: '0px', width: `${viewportWidth}px`, height: `${viewportHeight}px` },
          ],
          { duration: 240, easing, fill: 'forwards' },
        )
        fullscreenAnimationRef.current = animation
        animation.onfinish = () => {
          fullscreenAnimationRef.current = null
          setFullscreen(true)
          window.requestAnimationFrame(() => {
            animation.cancel()
            currentAside.removeAttribute('style')
            window.requestAnimationFrame(() => setFullscreenAnimating(false))
          })
        }
        animation.oncancel = () => {
          fullscreenAnimationRef.current = null
          setFullscreenAnimating(false)
        }
      })
      return
    }

    window.requestAnimationFrame(() => {
      const currentAside = asideRef.current
      if (!currentAside) return
      Object.assign(currentAside.style, {
        position: 'fixed',
        left: '0px',
        top: '0px',
        right: 'auto',
        bottom: 'auto',
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        zIndex: '40',
      })
      const targetLeft = viewportWidth - width
      const animation = currentAside.animate(
        [
          { left: '0px', top: '0px', width: `${rect.width}px`, height: `${rect.height}px` },
          { left: `${targetLeft}px`, top: '0px', width: `${width}px`, height: `${viewportHeight}px` },
        ],
        { duration: 240, easing, fill: 'forwards' },
      )
      fullscreenAnimationRef.current = animation
      animation.onfinish = () => {
        fullscreenAnimationRef.current = null
        setFullscreen(false)
        window.requestAnimationFrame(() => {
          animation.cancel()
          currentAside.style.position = ''
          currentAside.style.left = ''
          currentAside.style.top = ''
          currentAside.style.right = ''
          currentAside.style.bottom = ''
          currentAside.style.height = ''
          currentAside.style.zIndex = ''
          currentAside.style.width = `${width}px`
          currentAside.style.minWidth = `${WORKSPACE_INSPECTOR_MIN_WIDTH}px`
          currentAside.style.maxWidth = `${WORKSPACE_INSPECTOR_MAX_WIDTH}px`
          window.requestAnimationFrame(() => setFullscreenAnimating(false))
        })
      }
      animation.oncancel = () => {
        fullscreenAnimationRef.current = null
        setFullscreenAnimating(false)
      }
    })
  }, [fullscreen, width])

  useEffect(() => {
    if (!fullscreen) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [fullscreen])

  useEffect(() => () => {
    if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current)
    fullscreenAnimationRef.current?.cancel()
    if (asideRef.current) asideRef.current.removeAttribute('style')
    const previousBodyStyle = previousBodyStyleRef.current
    if (previousBodyStyle) {
      document.body.style.cursor = previousBodyStyle.cursor
      document.body.style.userSelect = previousBodyStyle.userSelect
    }
  }, [])

  if (!mounted) return null

  return (
    <>
      <aside
        ref={asideRef}
        className={cn(
          'relative hidden shrink-0 overflow-hidden flex-col border-l border-border bg-background transition-[width,min-width,max-width,opacity,transform] duration-200 ease-out will-change-[width,opacity,transform] lg:flex',
          visible ? 'translate-x-0 opacity-100' : 'w-0 min-w-0 max-w-0 translate-x-4 opacity-0',
          isResizing ? 'transition-none' : '',
          fullscreen ? 'fixed inset-0 z-40 border-l-0' : '',
        )}
        style={visible ? fullscreen ? undefined : { width, minWidth: WORKSPACE_INSPECTOR_MIN_WIDTH, maxWidth: WORKSPACE_INSPECTOR_MAX_WIDTH } : undefined}
      >
        {visible && !fullscreen ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuemin={WORKSPACE_INSPECTOR_MIN_WIDTH}
            aria-valuemax={WORKSPACE_INSPECTOR_MAX_WIDTH}
            aria-valuenow={width}
            className={cn(
              'group absolute inset-y-0 -left-2 z-20 flex w-4 cursor-col-resize items-center justify-center bg-transparent transition-colors hover:bg-border/40',
              isResizing ? 'bg-border/45' : '',
            )}
            onPointerDown={startResizing}
            onPointerMove={resize}
            onPointerUp={stopResizing}
            onPointerCancel={stopResizing}
          >
            <div className={cn(
              'flex h-10 w-3 items-center justify-center rounded-full border border-border bg-background text-muted-foreground/60 opacity-0 shadow-sm transition-opacity',
              isResizing ? 'opacity-100' : 'group-hover:opacity-100',
            )}>
              <ChevronsLeftRight className="size-3" />
            </div>
          </div>
        ) : null}
        <div className={cn('flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 transition-opacity duration-150', fullscreenAnimating ? 'opacity-0' : 'opacity-100')}>
          <WorkspaceMenu
            view={view}
            changesCount={changes.length}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onViewChange={onViewChange}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs text-muted-foreground/65">{project?.name ?? t('noProjectSelected')}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={refresh} disabled={!project?.id || loading} aria-label={t('refreshWorkspace')} title={t('refreshWorkspace')}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? t('workspaceExitFullscreen') : t('workspaceFullscreen')}
            title={fullscreen ? t('workspaceExitFullscreen') : t('workspaceFullscreen')}
          >
            {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label={t('closeWorkspace')} title={t('closeWorkspace')}>
            <PanelRightClose className="size-4" />
          </Button>
        </div>

        <div className={cn('flex min-h-0 flex-1 flex-col transition-opacity duration-150', fullscreenAnimating ? 'opacity-0' : 'opacity-100')}>
          {!project?.id ? (
            <div className="p-4 text-sm text-muted-foreground/70">{t('workspaceSelectProject')}</div>
          ) : view === 'browser' ? (
            <WebPreviewContent url={previewUrl} onUrlChange={onPreviewUrlChange} projectId={project.id} />
          ) : error ? (
            <div className="p-4 text-sm text-destructive">{error}</div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {loading ? <div className="px-2 py-3 text-xs text-muted-foreground/70">{t('workspaceLoading')}</div> : null}
              {!loading && view === 'overview' ? (
                <WorkspaceOverview
                  project={project}
                  artifacts={artifacts}
                  changesCount={changes.length}
                  changedPaths={changedPaths}
                  isGitRepository={isGitRepository}
                  gitBranch={gitBranch}
                  onViewChange={onViewChange}
                  onSelectFile={selectFile}
                  onSelectDiff={selectDiffInPlace}
                  onPreviewFile={selectPreviewFile}
                />
              ) : null}
              {!loading && view === 'files' ? (
                <>
                  <label className="mb-2 flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground/65 focus-within:text-foreground/85">
                    <Search className="size-3.5 shrink-0" />
                    <input
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                      placeholder={t('workspaceFilterFiles')}
                      className="min-w-0 flex-1 bg-transparent text-xs text-foreground/85 outline-none placeholder:text-muted-foreground/50"
                    />
                  </label>
                  <div className="mb-2 px-2 text-xs text-muted-foreground/60">{t('workspaceOpenFileHint')}</div>
                  <WorkspaceFileTree tree={filteredTree} selectedPath={selectedFilePath} gitStatuses={gitStatuses} onSelectFile={selectFile} />
                </>
              ) : null}
              {!loading && view === 'changes' ? (
                isGitRepository
                  ? (
                    <div className="space-y-3">
                      <div className="rounded-lg border border-border bg-muted/10 px-3 py-2">
                        <div className="truncate text-xs font-medium text-foreground/85">{gitSummary(gitBranch, gitCounts)}</div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground/60">
                          <span>{t('workspaceStaged')} {gitCounts?.staged ?? 0}</span>
                          <span>{t('workspaceChanges')} {gitCounts?.unstaged ?? 0}</span>
                          <span>{t('workspaceUntracked')} {gitCounts?.untracked ?? 0}</span>
                          {gitCounts?.conflicts ? <span className="text-red-600 dark:text-red-500">{t('workspaceConflicts')} {gitCounts.conflicts}</span> : null}
                        </div>
                        {changes.length > 0 && onDraftRequest ? (
                          <div className="mt-2 flex gap-1.5">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground/72 transition-colors hover:bg-muted/20 hover:text-foreground/85"
                              onClick={() => onDraftRequest(allChangesPrompt(changes))}
                            >
                              <MessageSquare className="size-3" />
                              {t('workspaceReview')}
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground/72 transition-colors hover:bg-muted/20 hover:text-foreground/85"
                              onClick={() => onDraftRequest(commitMessagePrompt(changes))}
                            >
                              <MessageSquare className="size-3" />
                              {t('workspaceCommitMessage')}
                            </button>
                          </div>
                        ) : null}
                      </div>

                      {changes.length === 0 ? (
                        <div className="px-2 py-3 text-xs text-muted-foreground/70">{t('workspaceNoWorkingTreeChanges')}</div>
                      ) : (
                        <>
                          <GitGroup title={t('workspaceConflicts')} files={gitGroups.conflicts} selectedPath={selectedDiffPath} onSelectFile={selectDiff} />
                          <GitGroup title={t('workspaceStagedChanges')} files={gitGroups.staged} selectedPath={selectedDiffPath} onSelectFile={selectDiff} />
                          <GitGroup title={t('workspaceChanges')} files={gitGroups.unstaged} selectedPath={selectedDiffPath} onSelectFile={selectDiff} />
                          <GitGroup title={t('workspaceUntracked')} files={gitGroups.untracked} selectedPath={selectedDiffPath} onSelectFile={selectDiff} />
                        </>
                      )}
                    </div>
                  )
                  : <div className="px-2 py-3 text-xs text-muted-foreground/70">{t('workspaceNotGitRepository')}</div>
              ) : null}
            </div>
          )}
        </div>
      </aside>
      <WorkspaceReaderDialog
        open={readerOpen}
        mode={readerMode}
        file={selectedFile}
        diff={selectedDiff}
        loading={readerMode === 'file' ? fileLoading : diffLoading}
        error={readerMode === 'file' ? fileError : diffError}
        onOpenChange={setReaderOpen}
        onDraftRequest={onDraftRequest}
      />
    </>
  )
}
