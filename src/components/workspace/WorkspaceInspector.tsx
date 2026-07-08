import { Check, ChevronDown, ChevronsLeftRight, Code2, Copy, Eye, Folder, GitBranch, Globe, Maximize2, MessageSquare, Minimize2, Plus, Search, SquareTerminal, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectInfo } from '@/lib/types'
import type { AiTurnArtifact } from '@/lib/tool-artifacts'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { WebPreviewContent } from '@/components/preview/WebPreviewContent'
import { MarkdownReader } from './MarkdownReader'
import { MonacoCodeViewer } from './MonacoCodeViewer'
import { MonacoDiffViewer } from './MonacoDiffViewer'
import { countDiffLines } from './diff-line-counts'
import { getGitFileDiff, getGitStatus, getWorkspaceFile, getWorkspaceTree } from './workspace-api'
import { WorkspaceChangesList } from './WorkspaceChangesList'
import { WorkspaceFileTree } from './WorkspaceFileTree'
import { artifactFileName, isBrowserPreviewablePath, presentArtifacts } from './artifact-preview-utils'
import { TerminalDock } from '@/components/terminal/TerminalDock'
import type { PendingTerminalCommand } from '@/components/terminal/terminal-api'
import type { GitChangedFile, GitFileDiffResponse, GitStatusResponse, WorkspaceFileResponse, WorkspaceInspectorFocusTarget, WorkspacePanelView, WorkspaceTreeNode } from './workspace-types'

type WorkspaceInspectorProps = {
  project?: ProjectInfo
  open: boolean
  onOpenChange: (open: boolean) => void
  view: WorkspacePanelView
  onViewChange: (view: WorkspacePanelView) => void
  onPreviewArtifact?: (path: string) => void
  onDraftRequest?: (text: string) => void
  focusTarget?: WorkspaceInspectorFocusTarget
  previewUrl: string
  artifacts?: AiTurnArtifact[]
  pendingTerminalCommand?: PendingTerminalCommand | null
  onPendingTerminalCommandHandled?: (id: number) => void
}

type ReaderMode = 'file' | 'diff' | 'browser'

type ReaderTab = {
  id: string
  mode: ReaderMode
  path: string
  file?: WorkspaceFileResponse
  diff?: GitFileDiffResponse
  loading: boolean
  error?: string
}

function getDesktopTitlebarHeight() {
  if (typeof window === 'undefined') return 0
  const raw = window.getComputedStyle(document.body).getPropertyValue('--quickforge-desktop-titlebar-height').trim()
  if (!raw) return 0
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : 0
}

function readerTabId(mode: ReaderMode, path: string) {
  return mode === 'browser' ? 'browser' : `${mode}:${path}`
}

type WorkspacePanelPrimaryTabKind = 'files' | 'review' | 'terminal' | 'browser'
type WorkspacePanelTabKind = WorkspacePanelPrimaryTabKind | 'reader'

type WorkspacePanelTab = {
  id: string
  kind: WorkspacePanelTabKind
  url?: string
  readerTabs?: ReaderTab[]
  activeReaderTabId?: string
  terminalSessionId?: string
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
]

const PANEL_TAB_BY_KIND = Object.fromEntries(PANEL_TAB_ITEMS.map((item) => [item.kind, item])) as Record<WorkspacePanelPrimaryTabKind, WorkspacePanelTabMeta>

function panelKindFromView(view: WorkspacePanelView): WorkspacePanelPrimaryTabKind {
  if (view === 'review' || view === 'changes') return 'review'
  return view
}

function viewFromPanelKind(kind: WorkspacePanelPrimaryTabKind): WorkspacePanelView {
  return kind === 'review' ? 'changes' : kind
}

function browserTabLabel(previewUrl: string) {
  const value = previewUrl.trim()
  if (!value) return 'about:blank'
  try {
    const url = new URL(value)
    if (url.protocol === 'about:') return value
    return url.host || value
  } catch {
    return value.split(/[\\/]/).pop() || value
  }
}

function panelTabLabel(tab: WorkspacePanelTab, projectName: string | undefined) {
  if (tab.kind === 'terminal') return projectName || t('rightPanelTerminal')
  if (tab.kind === 'browser') return browserTabLabel(tab.url || '')
  if (tab.kind === 'reader') {
    const reader = tab.readerTabs?.find((item) => item.id === tab.activeReaderTabId) ?? tab.readerTabs?.[0]
    return reader ? artifactFileName(reader.path) : t('rightPanelFiles')
  }
  return PANEL_TAB_BY_KIND[tab.kind].label
}

const WORKSPACE_INSPECTOR_MIN_WIDTH = 340
const WORKSPACE_INSPECTOR_DEFAULT_WIDTH = 380
const WORKSPACE_INSPECTOR_MAX_WIDTH = 640
const WORKSPACE_INSPECTOR_WIDTH_STORAGE_KEY = 'quickforge_workspaceInspectorWidth_v2'
const WORKSPACE_INSPECTOR_TABS_STORAGE_PREFIX = 'quickforge:workspace-inspector-tabs:v1:'
const NAV_PANEL_MIN_WIDTH = 140
const NAV_PANEL_DEFAULT_WIDTH = 200
const NAV_PANEL_MAX_WIDTH = 400

type PersistedWorkspacePanelTab = Pick<WorkspacePanelTab, 'id' | 'kind' | 'url' | 'terminalSessionId'> & {
  reader?: {
    mode: 'file'
    path: string
  }
}

type PersistedWorkspaceInspectorTabs = {
  tabs: PersistedWorkspacePanelTab[]
  activePanelTabId?: string
}

function workspaceInspectorTabsStorageKey(projectId: string) {
  return `${WORKSPACE_INSPECTOR_TABS_STORAGE_PREFIX}${projectId}`
}

function isWorkspacePanelTabKind(value: unknown): value is WorkspacePanelTabKind {
  return value === 'files' || value === 'review' || value === 'terminal' || value === 'browser' || value === 'reader'
}

function normalizePersistedPanelTabs(value: unknown): WorkspacePanelTab[] {
  if (!Array.isArray(value)) return []
  const seenReview = new Set<WorkspacePanelTabKind>()
  const tabs: WorkspacePanelTab[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Partial<PersistedWorkspacePanelTab>
    if (typeof raw.id !== 'string' || !raw.id || !isWorkspacePanelTabKind(raw.kind)) continue
    if (raw.kind === 'review') {
      if (seenReview.has(raw.kind)) continue
      seenReview.add(raw.kind)
    }
    if (raw.kind === 'reader') {
      const reader = raw.reader
      if (!reader || reader.mode !== 'file' || typeof reader.path !== 'string' || !reader.path) continue
      const readerId = readerTabId(reader.mode, reader.path)
      tabs.push({
        id: raw.id,
        kind: raw.kind,
        readerTabs: [{ id: readerId, mode: reader.mode, path: reader.path, loading: true }],
        activeReaderTabId: readerId,
      })
      continue
    }
    tabs.push({
      id: raw.id,
      kind: raw.kind,
      ...(raw.kind === 'browser' && typeof raw.url === 'string' ? { url: raw.url } : {}),
      ...(raw.kind === 'terminal' && typeof raw.terminalSessionId === 'string' ? { terminalSessionId: raw.terminalSessionId } : {}),
      ...(raw.kind === 'files' || raw.kind === 'review' ? { readerTabs: [], activeReaderTabId: undefined } : {}),
    })
  }
  return tabs
}

function readPersistedPanelTabs(projectId: string): PersistedWorkspaceInspectorTabs {
  if (typeof window === 'undefined') return { tabs: [] }
  try {
    const raw = window.localStorage.getItem(workspaceInspectorTabsStorageKey(projectId))
    if (!raw) return { tabs: [] }
    const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceInspectorTabs>
    const tabs = normalizePersistedPanelTabs(parsed.tabs)
    const activePanelTabId = typeof parsed.activePanelTabId === 'string' && tabs.some((tab) => tab.id === parsed.activePanelTabId)
      ? parsed.activePanelTabId
      : tabs[0]?.id
    return activePanelTabId ? { tabs, activePanelTabId } : { tabs }
  } catch {
    return { tabs: [] }
  }
}

function serializePanelTabs(tabs: WorkspacePanelTab[], activePanelTabId: string | undefined): PersistedWorkspaceInspectorTabs {
  const persistedTabs = tabs.flatMap((tab): PersistedWorkspacePanelTab[] => {
    if (tab.kind === 'reader') {
      const reader = tab.readerTabs?.find((item) => item.id === tab.activeReaderTabId) ?? tab.readerTabs?.[0]
      if (!reader || reader.mode !== 'file') return []
      return [{ id: tab.id, kind: tab.kind, reader: { mode: reader.mode, path: reader.path } }]
    }
    return [{
      id: tab.id,
      kind: tab.kind,
      ...(tab.kind === 'browser' ? { url: tab.url || '' } : {}),
      ...(tab.kind === 'terminal' && tab.terminalSessionId ? { terminalSessionId: tab.terminalSessionId } : {}),
    }]
  })
  return {
    tabs: persistedTabs,
    activePanelTabId: activePanelTabId && persistedTabs.some((tab) => tab.id === activePanelTabId) ? activePanelTabId : persistedTabs[0]?.id,
  }
}

function nextPanelTabIndexFromTabs(tabs: WorkspacePanelTab[]) {
  const maxIndex = tabs.reduce((max, tab) => {
    const match = tab.id.match(/-(\d+)$/)
    if (!match) return max
    const value = Number(match[1])
    return Number.isFinite(value) ? Math.max(max, value) : max
  }, 0)
  return maxIndex + 1
}

function readPersistedInspectorWidth(): number {
  if (typeof window === 'undefined') return WORKSPACE_INSPECTOR_DEFAULT_WIDTH
  try {
    const raw = window.localStorage.getItem(WORKSPACE_INSPECTOR_WIDTH_STORAGE_KEY)
    if (!raw) return WORKSPACE_INSPECTOR_DEFAULT_WIDTH
    const value = Number(raw)
    if (!Number.isFinite(value)) return WORKSPACE_INSPECTOR_DEFAULT_WIDTH
    return Math.min(WORKSPACE_INSPECTOR_MAX_WIDTH, Math.max(WORKSPACE_INSPECTOR_MIN_WIDTH, value))
  } catch {
    return WORKSPACE_INSPECTOR_DEFAULT_WIDTH
  }
}

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
  return t('workspaceReviewPrompt', { list })
}

function commitMessagePrompt(files: GitChangedFile[]) {
  const list = files.map((file) => `- ${file.status}: ${file.oldPath ? `${file.oldPath} -> ` : ''}${file.path}`).join('\n')
  return t('workspaceCommitMessagePrompt', { list })
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

function isMarkdownFile(file?: WorkspaceFileResponse) {
  if (!file) return false
  return file.language === 'markdown' || /\.(md|markdown)$/i.test(file.path)
}

function readerFilePrompt(path: string, markdown = false) {
  if (markdown) {
    return t('readerFileMarkdownPrompt', { path })
  }
  return t('readerFilePrompt', { path })
}

function readerDiffPrompt(path: string) {
  return t('readerDiffPrompt', { path })
}

function readerDiffText(diff: GitFileDiffResponse) {
  const header = diff.oldPath ? `${diff.oldPath} -> ${diff.path}` : diff.path
  return `Diff for ${header}\n\n--- OLD\n${diff.oldContent}\n\n--- NEW\n${diff.newContent}`
}

function InlineReader({ mode, file, diff, loading, error, onClose, onDraftRequest }: {
  mode: ReaderMode
  file?: WorkspaceFileResponse
  diff?: GitFileDiffResponse
  loading?: boolean
  error?: string
  onClose: () => void
  onDraftRequest?: (text: string) => void
}) {
  const [copied, setCopied] = useState<'path' | 'content'>()
  const [markdownMode, setMarkdownMode] = useState<'preview' | 'source'>('preview')

  async function copyToClipboard(kind: 'path' | 'content', value?: string) {
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopied(kind)
    window.setTimeout(() => setCopied(undefined), 1200)
  }

  const title = mode === 'file' ? file?.path : diff?.path
  const isMarkdown = mode === 'file' && isMarkdownFile(file)
  const copyableContent = mode === 'file' ? file?.content : diff ? readerDiffText(diff) : undefined
  const aiPrompt = mode === 'file' && file ? readerFilePrompt(file.path, isMarkdown) : mode === 'diff' && diff ? readerDiffPrompt(diff.path) : undefined
  const diffStats = useMemo(
    () => (mode === 'diff' && diff ? countDiffLines(diff.oldContent, diff.newContent) : undefined),
    [mode, diff],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        {isMarkdown ? (
          <div className="inline-flex rounded-full bg-muted/25 p-1 text-xs">
            {(['preview', 'source'] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={item === markdownMode
                  ? 'rounded-full bg-background px-3 py-1 font-medium text-foreground/90 shadow-[0_8px_20px_-16px_rgb(15_23_42_/_0.42)]'
                  : 'rounded-full px-3 py-1 text-muted-foreground/70 hover:text-foreground/85'}
                onClick={() => setMarkdownMode(item)}
              >
                {item === 'preview' ? t('markdownPreview') : t('markdownSource')}
              </button>
            ))}
          </div>
        ) : null}
        {diffStats ? (
          <span className="shrink-0 font-mono text-[11px] font-medium">
            <span className="text-emerald-600 dark:text-emerald-400">+{diffStats.added}</span>
            <span className="ml-1.5 text-red-600 dark:text-red-400">-{diffStats.removed}</span>
          </span>
        ) : null}
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="size-7" onClick={() => void copyToClipboard('path', title)} disabled={!title} aria-label={t('copyPath')} title={t('copyPath')}>
          {copied === 'path' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" className="size-7" onClick={() => void copyToClipboard('content', copyableContent)} disabled={!copyableContent} aria-label={t('copyContent')} title={mode === 'file' ? t('copyContent') : t('copyDiffContent')}>
          {copied === 'content' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" className="size-7" onClick={() => aiPrompt && onDraftRequest?.(aiPrompt)} disabled={!aiPrompt || !onDraftRequest} aria-label={t('askAiAboutThis')} title={t('askAiAboutThis')}>
          <MessageSquare className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label={t('close')} title={t('close')}>
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 bg-background">
        {loading ? <div className="p-4 text-sm text-muted-foreground/70">{t('openingReader')}</div> : null}
        {!loading && error ? <div className="p-4 text-sm text-destructive">{error}</div> : null}
        {!loading && !error && mode === 'file' && file ? (
          isMarkdown ? (
            <MarkdownReader key={file.path} path={file.path} content={file.content} language={file.language} mode={markdownMode} />
          ) : (
            <MonacoCodeViewer path={file.path} content={file.content} language={file.language} />
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
                  const canPreview = isBrowserPreviewablePath(path)
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
                            <div className="space-y-1 px-2 pb-2 pt-1.5">
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

      <div className="rounded-lg border border-border bg-muted/10 px-3 py-3">
        <div className="text-xs font-medium text-foreground/85">{project?.name ?? t('noProjectSelected')}</div>
        <div className="mt-1 text-[11px] text-muted-foreground/65">
          {isGitRepository ? `${t('workspaceCurrentBranch')}: ${gitBranch || t('unknown')} · ${changesCount} ${t('workspaceChangeCount')}` : t('workspaceNotGitRepository')}
        </div>
      </div>
    </div>
  )
}

export function WorkspaceInspector({ project, open, onOpenChange, view, onViewChange, onPreviewArtifact, onDraftRequest, focusTarget, previewUrl, artifacts = [], pendingTerminalCommand, onPendingTerminalCommandHandled }: WorkspaceInspectorProps) {
  const [tree, setTree] = useState<WorkspaceTreeNode[]>([])
  const [changes, setChanges] = useState<GitChangedFile[]>([])
  const [gitBranch, setGitBranch] = useState<string>()
  const [gitCounts, setGitCounts] = useState<GitStatusResponse['counts']>()
  const [isGitRepository, setIsGitRepository] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [filter, setFilter] = useState('')

  const initialPanelTabStateRef = useRef<PersistedWorkspaceInspectorTabs | undefined>(undefined)
  if (!initialPanelTabStateRef.current) {
    initialPanelTabStateRef.current = project?.id ? readPersistedPanelTabs(project.id) : { tabs: [] }
  }
  const [panelTabs, setPanelTabs] = useState<WorkspacePanelTab[]>(() => initialPanelTabStateRef.current?.tabs ?? [])
  const [activePanelTabId, setActivePanelTabId] = useState<string | undefined>(() => initialPanelTabStateRef.current?.activePanelTabId)
  const [menuOpen, setMenuOpen] = useState(false)
  const [leftWidth, setLeftWidth] = useState(NAV_PANEL_DEFAULT_WIDTH)
  const [isNavResizing, setIsNavResizing] = useState(false)
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)
  const [width, setWidth] = useState(readPersistedInspectorWidth)
  const [isResizing, setIsResizing] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [fullscreenAnimating, setFullscreenAnimating] = useState(false)
  const asideRef = useRef<HTMLElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const navResizeDragRef = useRef<{ startX: number; startWidth: number; currentWidth: number } | null>(null)
  const navResizeFrameRef = useRef<number | null>(null)
  const resizeDragRef = useRef<{ startX: number; startWidth: number; currentWidth: number } | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const fullscreenAnimationRef = useRef<Animation | null>(null)
  const previousBodyStyleRef = useRef<{ cursor: string; userSelect: string } | null>(null)
  const nextPanelTabIndexRef = useRef(nextPanelTabIndexFromTabs(initialPanelTabStateRef.current?.tabs ?? []))
  const lastPreviewUrlRef = useRef(previewUrl)
  // openFileTab 依赖 readerTabs 等渲染期状态，用 ref 持有最新引用，供 focusTarget 副作用安全调用。
  const openFileTabRef = useRef<((path: string) => void) | undefined>(undefined)
  // 记录上次的 projectId，让 tabs 清空副作用只在「项目真正切换」时清空，跳过首次 mount，
  // 避免 mount 时清空 microtask 与自动预览 openFileTab 的 microtask 竞态（后者创建的 tab 会被前者清掉）。
  const persistedTabsProjectIdRef = useRef(project?.id)
  const skipNextPanelTabsPersistRef = useRef(false)
  const loadingReaderKeysRef = useRef<Set<string>>(new Set())

  const projectId = project?.id
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
  const hasFileTab = Boolean(activeReaderTab && activeReaderTab.mode !== 'browser' && (activePanelTab?.kind === 'reader' || activePanelTab?.kind === 'files' || (activePanelTab?.kind === 'review' && activeReaderTab.mode === 'diff')))
  const navView: 'overview' | 'files' | 'changes' = activePanelTab?.kind === 'review' ? view === 'changes' ? 'changes' : 'overview' : 'files'
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
    if (!menuOpen) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
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

  useEffect(() => {
    let disposed = false
    if (!open || !focusTarget) return () => { disposed = true }
    queueMicrotask(() => {
      if (disposed) return
      if (focusTarget.tab === 'git') {
        openPanelTab('review', 'changes')
      } else {
        onViewChange('files')
      }
      // 自动预览 Markdown：触发 openFileTab → InlineReader → MarkdownReader 渲染。
      if (focusTarget.filePath) void openFileTabRef.current?.(focusTarget.filePath)
    })
    return () => { disposed = true }
  }, [focusTarget, onViewChange, open])

  useEffect(() => {
    if (!open) return
    const kind = panelKindFromView(view)
    if (kind === 'review') {
      if (view === 'changes') openPanelTab('review', 'changes')
      return
    }
    if (kind === 'browser') {
      if (previewUrl === lastPreviewUrlRef.current && activePanelTab?.kind === 'browser') return
      lastPreviewUrlRef.current = previewUrl
      openPanelTab('browser', 'browser', { url: previewUrl })
      return
    }
    if (kind === activePanelTab?.kind) return
    openPanelTab(kind, viewFromPanelKind(kind))
  }, [view, open, previewUrl])
  // 持久化工作区宽度：拖拽或自动展开后都写入，刷新后保持上次宽度
  useEffect(() => {
    try {
      window.localStorage.setItem(WORKSPACE_INSPECTOR_WIDTH_STORAGE_KEY, String(width))
    } catch {
      /* ignore quota / privacy mode */
    }
  }, [width])

  const expandInspectorToMax = useCallback(() => {
    setWidth((current) => (current < WORKSPACE_INSPECTOR_MAX_WIDTH ? WORKSPACE_INSPECTOR_MAX_WIDTH : current))
  }, [])

  // 打开文件 / 网页预览时自动拉到当前允许的最宽范围（全屏模式不处理；已是最宽则保持不变）
  useEffect(() => {
    if (!visible || fullscreen) return
    const viewingContent = activePanelTab?.kind === 'browser' || activePanelTab?.kind === 'terminal' || Boolean(activeReaderTabId)
    if (!viewingContent) return
    expandInspectorToMax()
  }, [activePanelTab?.kind, activeReaderTabId, visible, fullscreen, expandInspectorToMax])

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
  }, [open, projectId])

  useEffect(() => {
    if (!projectId) {
      skipNextPanelTabsPersistRef.current = true
      persistedTabsProjectIdRef.current = undefined
      setPanelTabs([])
      setActivePanelTabId(undefined)
      return
    }
    if (persistedTabsProjectIdRef.current === projectId) return
    const persisted = readPersistedPanelTabs(projectId)
    skipNextPanelTabsPersistRef.current = true
    persistedTabsProjectIdRef.current = projectId
    nextPanelTabIndexRef.current = nextPanelTabIndexFromTabs(persisted.tabs)
    setPanelTabs(persisted.tabs)
    setActivePanelTabId(persisted.activePanelTabId)
    const activeTab = persisted.tabs.find((tab) => tab.id === persisted.activePanelTabId) ?? persisted.tabs[0]
    if (activeTab && activeTab.kind !== 'reader') onViewChange(viewFromPanelKind(activeTab.kind))
  }, [onViewChange, projectId])

  useEffect(() => {
    if (!projectId) return
    if (skipNextPanelTabsPersistRef.current) {
      skipNextPanelTabsPersistRef.current = false
      return
    }
    try {
      window.localStorage.setItem(
        workspaceInspectorTabsStorageKey(projectId),
        JSON.stringify(serializePanelTabs(panelTabs, activePanelTabId)),
      )
    } catch {
      /* ignore quota / privacy mode */
    }
  }, [activePanelTabId, panelTabs, projectId])

  useEffect(() => {
    if (!activePanelTabId || panelTabs.some((tab) => tab.id === activePanelTabId)) return
    setActivePanelTabId(panelTabs[0]?.id)
  }, [activePanelTabId, panelTabs])

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
      const request = getWorkspaceFile(projectId, reader.path).then((file) => ({ file }))
      request
        .then((payload) => {
          updatePanelTab(panelTabId, (tab) => ({
            ...tab,
            readerTabs: (tab.readerTabs || []).map((item) => item.id === reader.id ? { ...item, ...payload, loading: false, error: undefined } : item),
          }))
        })
        .catch((err: unknown) => {
          updatePanelTab(panelTabId, (tab) => ({
            ...tab,
            readerTabs: (tab.readerTabs || []).map((item) => item.id === reader.id ? { ...item, loading: false, error: err instanceof Error ? err.message : t('workspaceOpenFileFailed') } : item),
          }))
        })
        .finally(() => {
          loadingReaderKeysRef.current.delete(key)
        })
    }
  }, [panelTabs, projectId])

  function createPanelTab(kind: WorkspacePanelTabKind, options?: { url?: string; readerTab?: ReaderTab }): WorkspacePanelTab {
    const id = `${kind}-${nextPanelTabIndexRef.current++}`
    if (kind === 'browser') return { id, kind, url: options?.url || previewUrl || '' }
    if (kind === 'reader') return { id, kind, readerTabs: options?.readerTab ? [options.readerTab] : [], activeReaderTabId: options?.readerTab?.id }
    if (kind === 'files' || kind === 'review') {
      return { id, kind, readerTabs: options?.readerTab ? [options.readerTab] : [], activeReaderTabId: options?.readerTab?.id }
    }
    return { id, kind }
  }

  function createReaderPanelTab(readerTab: ReaderTab): WorkspacePanelTab {
    return createPanelTab('reader', { readerTab })
  }

  function updatePanelTab(id: string, updater: (tab: WorkspacePanelTab) => WorkspacePanelTab) {
    setPanelTabs((prev) => prev.map((tab) => tab.id === id ? updater(tab) : tab))
  }

  function openPanelTab(kind: WorkspacePanelPrimaryTabKind, nextView: WorkspacePanelView = viewFromPanelKind(kind), options?: { url?: string; readerTab?: ReaderTab }) {
    const existing = kind === 'review' ? panelTabs.find((tab) => tab.kind === 'review') : undefined
    const targetTab = existing || createPanelTab(kind, options)
    if (!existing) setPanelTabs((prev) => [...prev, targetTab])
    setActivePanelTabId(targetTab.id)
    onViewChange(nextView)
    setMenuOpen(false)
    return targetTab
  }

  function activatePanelTab(tab: WorkspacePanelTab) {
    setActivePanelTabId(tab.id)
    if (tab.kind !== 'reader') onViewChange(viewFromPanelKind(tab.kind))
  }

  function closePanelTab(id: string) {
    setPanelTabs((prev) => {
      const index = prev.findIndex((tab) => tab.id === id)
      const next = prev.filter((tab) => tab.id !== id)
      if (next.length === 0) {
        setActivePanelTabId(undefined)
        onViewChange('review')
        onOpenChange(false)
        return next
      }
      if (activePanelTabId === id) {
        const nextActive = next[index] ?? next[index - 1]
        setActivePanelTabId(nextActive?.id)
        if (!nextActive) {
          onViewChange('review')
        } else if (nextActive.kind !== 'reader') {
          onViewChange(viewFromPanelKind(nextActive.kind))
        }
      }
      return next
    })
  }

  function selectPreviewFile(path: string) {
    if (onPreviewArtifact) {
      onPreviewArtifact(path)
      return
    }
    void openFileTab(path)
  }

  async function openFileTab(path: string) {
    if (!projectId) return
    const id = readerTabId('file', path)
    const existingReaderTab = panelTabs.find((tab) => tab.kind === 'reader' && tab.readerTabs?.some((item) => item.id === id))
    if (existingReaderTab) {
      setActivePanelTabId(existingReaderTab.id)
      updatePanelTab(existingReaderTab.id, (tab) => ({ ...tab, activeReaderTabId: id }))
      return
    }
    const newTab: ReaderTab = { id, mode: 'file', path, loading: true }
    const targetTab = createReaderPanelTab(newTab)
    setPanelTabs((prev) => [...prev, targetTab])
    setActivePanelTabId(targetTab.id)
    try {
      const file = await getWorkspaceFile(projectId, path)
      updatePanelTab(targetTab.id, (tab) => ({ ...tab, readerTabs: (tab.readerTabs || []).map((item) => item.id === id ? { ...item, file, loading: false, error: undefined } : item) }))
    } catch (err) {
      updatePanelTab(targetTab.id, (tab) => ({ ...tab, readerTabs: (tab.readerTabs || []).map((item) => item.id === id ? { ...item, loading: false, error: err instanceof Error ? err.message : t('workspaceOpenFileFailed') } : item) }))
    }
  }
  // 每次渲染刷新 ref，使 focusTarget 副作用总能调用到持有最新 tab 闭包的 openFileTab。
  openFileTabRef.current = openFileTab

  async function openDiffTab(path: string, switchToChanges: boolean) {
    if (!projectId) return
    const reviewTab = panelTabs.find((tab) => tab.kind === 'review')
    const targetTab = reviewTab || openPanelTab('review', switchToChanges ? 'changes' : 'review')
    setActivePanelTabId(targetTab.id)
    if (switchToChanges) onViewChange('changes')
    const id = readerTabId('diff', path)
    if (targetTab.readerTabs?.some((tab) => tab.id === id)) {
      updatePanelTab(targetTab.id, (tab) => ({ ...tab, activeReaderTabId: id }))
      return
    }
    const newTab: ReaderTab = { id, mode: 'diff', path, loading: true }
    updatePanelTab(targetTab.id, (tab) => ({
      ...tab,
      readerTabs: [...(tab.readerTabs || []), newTab],
      activeReaderTabId: id,
    }))
    try {
      const diff = await getGitFileDiff(projectId, path)
      updatePanelTab(targetTab.id, (tab) => ({ ...tab, readerTabs: (tab.readerTabs || []).map((item) => item.id === id ? { ...item, diff, loading: false, error: undefined } : item) }))
    } catch (err) {
      updatePanelTab(targetTab.id, (tab) => ({ ...tab, readerTabs: (tab.readerTabs || []).map((item) => item.id === id ? { ...item, loading: false, error: err instanceof Error ? err.message : t('workspaceOpenDiffFailed') } : item) }))
    }
  }

  function closeReaderTab(id: string) {
    if (!activePanelTab) return
    updatePanelTab(activePanelTab.id, (tab) => {
      const currentTabs = tab.readerTabs || []
      const idx = currentTabs.findIndex((item) => item.id === id)
      const next = currentTabs.filter((item) => item.id !== id)
      const nextActive = tab.activeReaderTabId === id ? (next[idx] ?? next[idx - 1])?.id : tab.activeReaderTabId
      return { ...tab, readerTabs: next, activeReaderTabId: nextActive }
    })
  }

  async function selectDiff(path: string) {
    await openDiffTab(path, true)
  }

  async function selectDiffInPlace(path: string) {
    await openDiffTab(path, false)
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

  function startNavResizing(event: React.PointerEvent<HTMLDivElement>) {
    navResizeDragRef.current = { startX: event.clientX, startWidth: leftWidth, currentWidth: leftWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    setIsNavResizing(true)
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* ignore */ }
  }

  function navResize(event: React.PointerEvent<HTMLDivElement>) {
    const start = navResizeDragRef.current
    if (!start) return
    start.currentWidth = Math.min(
      NAV_PANEL_MAX_WIDTH,
      Math.max(NAV_PANEL_MIN_WIDTH, start.startWidth + event.clientX - start.startX),
    )
    if (navResizeFrameRef.current !== null) return
    navResizeFrameRef.current = window.requestAnimationFrame(() => {
      navResizeFrameRef.current = null
      const current = navResizeDragRef.current
      if (current) setLeftWidth(current.currentWidth)
    })
  }

  function stopNavResizing(event: React.PointerEvent<HTMLDivElement>) {
    const finalWidth = navResizeDragRef.current?.currentWidth
    navResizeDragRef.current = null
    if (navResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(navResizeFrameRef.current)
      navResizeFrameRef.current = null
    }
    if (typeof finalWidth === 'number') setLeftWidth(finalWidth)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    setIsNavResizing(false)
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
    const titlebarHeight = getDesktopTitlebarHeight()
    const viewportHeight = window.innerHeight - titlebarHeight
    const fullscreenTop = `${titlebarHeight}px`
    const fullscreenHeight = `${viewportHeight}px`
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
            { left: '0px', top: fullscreenTop, width: `${viewportWidth}px`, height: fullscreenHeight },
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
        top: fullscreenTop,
        right: 'auto',
        bottom: 'auto',
        width: `${rect.width}px`,
        height: fullscreenHeight,
        zIndex: '40',
      })
      const targetLeft = viewportWidth - width
      const animation = currentAside.animate(
        [
          { left: '0px', top: fullscreenTop, width: `${rect.width}px`, height: fullscreenHeight },
          { left: `${targetLeft}px`, top: fullscreenTop, width: `${width}px`, height: fullscreenHeight },
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
    if (navResizeFrameRef.current !== null) window.cancelAnimationFrame(navResizeFrameRef.current)
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
          'relative hidden shrink-0 overflow-hidden flex-col bg-background transition-[width,min-width,max-width,opacity,transform] duration-200 ease-out will-change-[width,opacity,transform] lg:flex',
          visible ? 'translate-x-0 opacity-100' : 'w-0 min-w-0 max-w-0 translate-x-4 opacity-0',
          isResizing ? 'transition-none' : '',
          fullscreen ? 'quickforge-workspace-inspector-fullscreen z-40 rounded-none border-l-0' : 'lg:rounded-l-2xl',
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
        <div className={cn('flex h-14 shrink-0 items-center gap-2 border-b-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-background px-3 pr-20 transition-opacity duration-150', fullscreenAnimating ? 'opacity-0' : 'opacity-100')}>
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {panelTabs.map((tab, index) => {
              const item = tab.kind === 'reader' ? undefined : PANEL_TAB_BY_KIND[tab.kind]
              const Icon = item?.icon ?? Code2
              const active = tab.id === activePanelTabId
              const label = panelTabLabel(tab, project?.name)
              return (
                <div key={tab.id} className="flex shrink-0 items-center gap-1">
                  {index > 0 ? <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-[color-mix(in_oklab,var(--muted-foreground)_18%,transparent)]" /> : null}
                  <button
                    type="button"
                    className={cn(
                      'group flex h-10 max-w-40 items-center gap-2 rounded-2xl px-3 text-[13px] font-medium transition-colors',
                      active
                        ? 'bg-[color-mix(in_oklab,var(--muted)_86%,transparent)] text-foreground/82 hover:bg-[color-mix(in_oklab,var(--muted)_86%,transparent)]'
                        : 'text-muted-foreground/45 hover:bg-[color-mix(in_oklab,var(--muted)_72%,transparent)] hover:text-muted-foreground/72',
                    )}
                    onClick={() => activatePanelTab(tab)}
                    title={label}
                  >
                    <Icon className={cn('size-4 shrink-0', active ? 'text-foreground/74' : 'text-muted-foreground/45 group-hover:text-muted-foreground/72')} />
                    <span className="min-w-0 truncate">{label}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      className={cn(
                        'ml-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full opacity-0 transition-all hover:bg-black hover:text-white group-hover:opacity-100',
                        active && 'opacity-100',
                      )}
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
                </div>
              )
            })}
            {panelTabs.length === 0 ? <div className="min-w-0 flex-1" /> : null}
          </div>
          {panelTabs.length > 0 ? (
            <div ref={menuRef} className="relative shrink-0">
              <button
                type="button"
                className="flex size-9 items-center justify-center rounded-2xl bg-transparent text-muted-foreground/85 transition-colors hover:bg-muted/45 hover:text-foreground/90"
                onClick={() => setMenuOpen((value) => !value)}
                aria-label={t('rightPanelAddTab')}
                title={t('rightPanelAddTab')}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <Plus className="size-4 stroke-[1.9]" />
              </button>
              {menuOpen ? (
              <div className="absolute right-0 top-12 z-40 w-64 rounded-2xl border border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-popover p-2 shadow-quickforge" role="menu">
                {PANEL_TAB_ITEMS.map((item) => {
                  const Icon = item.icon
                  const active = item.kind === activePanelTab?.kind
                  return (
                    <button
                      key={item.kind}
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium transition-colors',
                        active ? 'bg-muted/55 text-foreground' : 'text-foreground/86 hover:bg-muted/34 hover:text-foreground',
                      )}
                      onClick={() => openPanelTab(item.kind, viewFromPanelKind(item.kind))}
                      role="menuitem"
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground/80" />
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
            className="shrink-0"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? t('workspaceExitFullscreen') : t('workspaceFullscreen')}
            title={fullscreen ? t('workspaceExitFullscreen') : t('workspaceFullscreen')}
          >
            {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
        </div>

        <div className={cn('flex min-h-0 flex-1 transition-opacity duration-150', fullscreenAnimating ? 'opacity-0' : 'opacity-100')}>
          {!project?.id ? (
            <div className="p-4 text-sm text-muted-foreground/70">{t('workspaceSelectProject')}</div>
          ) : !activePanelTab ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-5">
              <div className="w-full max-w-[26rem] space-y-4">
                <div className="text-center font-sans">
                  <div className="text-lg font-semibold leading-tight tracking-[-0.01em] text-foreground/90">{t('rightPanelOpenTabsTitle')}</div>
                  <div className="mt-2 text-sm leading-5 text-muted-foreground/70">{t('rightPanelOpenTabsDescription')}</div>
                </div>
                <div className="space-y-2">
                  {PANEL_TAB_ITEMS.map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.kind}
                        type="button"
                        className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-muted/60 px-4 py-3 text-left transition-colors hover:bg-muted/72 active:bg-muted/82"
                        onClick={() => openPanelTab(item.kind, viewFromPanelKind(item.kind))}
                      >
                        <Icon className="size-4 shrink-0 text-muted-foreground/78" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-foreground/90">{item.label}</div>
                          <div className="mt-0.5 text-xs leading-4 text-muted-foreground/60">{item.description}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : activePanelTab.kind === 'browser' ? (
            <WebPreviewContent
              url={activePanelTab.url || ''}
              onUrlChange={(url) => {
                updatePanelTab(activePanelTab.id, (tab) => ({ ...tab, url }))
              }}
              projectId={project.id}
            />
          ) : activePanelTab.kind === 'terminal' ? (
            <TerminalDock
              key={activePanelTab.id}
              project={project}
              pendingCommand={pendingTerminalCommand}
              onPendingCommandHandled={onPendingTerminalCommandHandled}
              onCollapse={() => closePanelTab(activePanelTab.id)}
              variant="panel"
              panelInstanceId={activePanelTab.id}
              panelSessionId={activePanelTab.terminalSessionId}
              onPanelSessionReady={(sessionId) => updatePanelTab(activePanelTab.id, (tab) => ({ ...tab, terminalSessionId: sessionId }))}
            />
          ) : (
            <>
              <div
                className={cn(
                  'flex min-h-0 flex-col bg-muted/20',
                  hasFileTab ? 'shrink-0 border-r-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)]' : 'flex-1',
                )}
                style={hasFileTab ? { width: leftWidth, minWidth: NAV_PANEL_MIN_WIDTH, maxWidth: NAV_PANEL_MAX_WIDTH } : undefined}
              >
                {error ? (
                  <div className="p-4 text-sm text-destructive">{error}</div>
                ) : (
                  <div className="min-h-0 flex-1 overflow-auto p-2">
                    {loading ? <div className="px-2 py-3 text-xs text-muted-foreground/70">{t('workspaceLoading')}</div> : null}
                    {!loading && navView === 'overview' ? (
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
                    {!loading && navView === 'files' ? (
                      <>
                        <label className="mb-2 flex items-center gap-2 rounded-md border-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-background px-2 py-1.5 text-xs text-muted-foreground/65 focus-within:text-foreground/85">
                          <Search className="size-3.5 shrink-0" />
                          <input
                            value={filter}
                            onChange={(event) => setFilter(event.target.value)}
                            placeholder={t('workspaceFilterFiles')}
                            className="min-w-0 flex-1 bg-transparent text-xs text-foreground/85 outline-none placeholder:text-muted-foreground/50"
                          />
                        </label>
                        <WorkspaceFileTree tree={filteredTree} selectedPath={activeReaderTab?.mode === 'file' ? activeReaderTab.path : undefined} gitStatuses={gitStatuses} onSelectFile={openFileTab} onPreviewFile={selectPreviewFile} projectId={projectId} />
                      </>
                    ) : null}
                    {!loading && navView === 'changes' ? (
                      isGitRepository
                        ? (
                          <div className="space-y-3">
                            {changes.length === 0 ? (
                              <div className="px-2 py-3 text-xs text-muted-foreground/70">{t('workspaceNoWorkingTreeChanges')}</div>
                            ) : (
                              <>
                                <GitGroup title={t('workspaceConflicts')} files={gitGroups.conflicts} selectedPath={undefined} onSelectFile={selectDiff} />
                                <GitGroup title={t('workspaceStagedChanges')} files={gitGroups.staged} selectedPath={undefined} onSelectFile={selectDiff} />
                                <GitGroup title={t('workspaceChanges')} files={gitGroups.unstaged} selectedPath={undefined} onSelectFile={selectDiff} />
                                <GitGroup title={t('workspaceUntracked')} files={gitGroups.untracked} selectedPath={undefined} onSelectFile={selectDiff} />
                              </>
                            )}

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
                          </div>
                        )
                        : <div className="px-2 py-3 text-xs text-muted-foreground/70">{t('workspaceNotGitRepository')}</div>
                    ) : null}
                  </div>
                )}
              </div>

              {hasFileTab ? (
                <>
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-valuemin={NAV_PANEL_MIN_WIDTH}
                    aria-valuemax={NAV_PANEL_MAX_WIDTH}
                    aria-valuenow={leftWidth}
                    className={cn(
                      'group relative z-10 w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors',
                      isNavResizing ? 'bg-primary/30' : 'hover:bg-[color-mix(in_oklab,var(--border)_52%,transparent)]',
                    )}
                    onPointerDown={startNavResizing}
                    onPointerMove={navResize}
                    onPointerUp={stopNavResizing}
                    onPointerCancel={stopNavResizing}
                  />

                  <div className="flex min-w-0 flex-1 flex-col bg-background">
                    {activeReaderTab ? (
                      <InlineReader
                        mode={activeReaderTab.mode}
                        file={activeReaderTab.file}
                        diff={activeReaderTab.diff}
                        loading={activeReaderTab.loading}
                        error={activeReaderTab.error}
                        onClose={() => activePanelTab.kind === 'reader' ? closePanelTab(activePanelTab.id) : closeReaderTab(activeReaderTab.id)}
                        onDraftRequest={onDraftRequest}
                      />
                    ) : null}
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      </aside>
    </>
  )
}
