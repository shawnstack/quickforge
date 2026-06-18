import { Check, ChevronDown, Code2, Folder, GitBranch, Globe2, LayoutGrid, MessageSquare, PanelRightClose, RefreshCw, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
import type { GitChangedFile, GitFileDiffResponse, GitStatusResponse, WorkspaceFileResponse, WorkspaceInspectorFocusTarget, WorkspacePanelView, WorkspaceTreeNode } from './workspace-types'

type WorkspaceInspectorProps = {
  project?: ProjectInfo
  open: boolean
  view: WorkspacePanelView
  onViewChange: (view: WorkspacePanelView) => void
  onOpenChange: (open: boolean) => void
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

function WorkspaceOverview({ project, artifacts, changesCount, isGitRepository, gitBranch, onViewChange, onSelectFile }: {
  project?: ProjectInfo
  artifacts: AiTurnArtifact[]
  changesCount: number
  isGitRepository: boolean
  gitBranch?: string
  onViewChange: (view: WorkspacePanelView) => void
  onSelectFile: (path: string) => void
}) {
  const fileArtifacts = artifacts.filter((artifact) => artifact.path)
  const commandArtifacts = artifacts.filter((artifact) => artifact.command)

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
                {fileArtifacts.slice(0, 8).map((artifact) => (
                  <button
                    key={artifact.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/85 transition-colors hover:bg-muted/20"
                    onClick={() => artifact.path && onSelectFile(artifact.path)}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono">{artifact.path}</span>
                    <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">{artifact.source}</span>
                  </button>
                ))}
                {fileArtifacts.length > 8 ? <div className="px-2 text-[11px] text-muted-foreground/60">+{fileArtifacts.length - 8}</div> : null}
              </div>
            ) : null}
            {commandArtifacts.length ? (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">{t('workspaceCommands')} {commandArtifacts.length}</div>
                {commandArtifacts.slice(0, 5).map((artifact) => (
                  <div key={artifact.id} className="rounded-md bg-muted/15 px-2 py-1.5 font-mono text-[11px] leading-5 text-muted-foreground/80">
                    {artifact.command}
                  </div>
                ))}
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

export function WorkspaceInspector({ project, open, view, onViewChange, onOpenChange, onDraftRequest, focusTarget, previewUrl, onPreviewUrlChange, artifacts = [] }: WorkspaceInspectorProps) {
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

  const projectId = project?.id

  const gitStatuses = useMemo(() => {
    const map: Record<string, GitChangedFile> = {}
    for (const file of changes) map[file.path] = file
    return map
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

  async function selectDiff(path: string) {
    if (!projectId) return
    onViewChange('changes')
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

  function refresh() {
    setRefreshToken((value) => value + 1)
  }

  if (!mounted) return null

  return (
    <>
      <aside
        className={cn(
          'hidden shrink-0 overflow-hidden flex-col border-l border-border bg-background transition-[width,min-width,max-width,opacity,transform] duration-200 ease-out will-change-[width,opacity,transform] lg:flex',
          visible ? 'w-[380px] min-w-[300px] max-w-[560px] translate-x-0 opacity-100' : 'w-0 min-w-0 max-w-0 translate-x-4 opacity-0',
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
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
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label={t('closeWorkspace')} title={t('closeWorkspace')}>
            <PanelRightClose className="size-4" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {!project?.id ? (
            <div className="p-4 text-sm text-muted-foreground/70">{t('workspaceSelectProject')}</div>
          ) : view === 'browser' ? (
            <WebPreviewContent url={previewUrl} onUrlChange={onPreviewUrlChange} />
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
                  isGitRepository={isGitRepository}
                  gitBranch={gitBranch}
                  onViewChange={onViewChange}
                  onSelectFile={selectFile}
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
