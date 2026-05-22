import { Code2, MessageSquare, PanelRightClose, RefreshCw, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ProjectInfo } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { getGitFileDiff, getGitStatus, getWorkspaceFile, getWorkspaceTree } from './workspace-api'
import { WorkspaceChangesList } from './WorkspaceChangesList'
import { WorkspaceFileTree } from './WorkspaceFileTree'
import { WorkspaceReaderDialog } from './WorkspaceReaderDialog'
import type { GitChangedFile, GitFileDiffResponse, WorkspaceFileResponse, WorkspaceTreeNode } from './workspace-types'

type WorkspaceInspectorProps = {
  project?: ProjectInfo
  open: boolean
  onOpenChange: (open: boolean) => void
  onDraftRequest?: (text: string) => void
}

type WorkspaceTab = 'files' | 'changes'
type ReaderMode = 'file' | 'diff'

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

export function WorkspaceInspector({ project, open, onOpenChange, onDraftRequest }: WorkspaceInspectorProps) {
  const [tab, setTab] = useState<WorkspaceTab>('files')
  const [tree, setTree] = useState<WorkspaceTreeNode[]>([])
  const [changes, setChanges] = useState<GitChangedFile[]>([])
  const [isGitRepository, setIsGitRepository] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [filter, setFilter] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)

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

  const projectId = project?.id

  const gitStatuses = useMemo(() => {
    const map: Record<string, GitChangedFile> = {}
    for (const file of changes) map[file.path] = file
    return map
  }, [changes])

  const filteredTree = useMemo(() => filterWorkspaceTree(tree, filter), [filter, tree])

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
          setIsGitRepository(statusResponse.isGitRepository)
        })
        .catch((err: unknown) => {
          if (!disposed) setError(err instanceof Error ? err.message : 'Failed to load workspace.')
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
    setTab('files')
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
      setFileError(err instanceof Error ? err.message : 'Failed to open file.')
    } finally {
      setFileLoading(false)
    }
  }

  async function selectDiff(path: string) {
    if (!projectId) return
    setTab('changes')
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
      setDiffError(err instanceof Error ? err.message : 'Failed to open diff.')
    } finally {
      setDiffLoading(false)
    }
  }

  function refresh() {
    setRefreshToken((value) => value + 1)
    if (readerMode === 'file' && selectedFilePath) void selectFile(selectedFilePath)
    if (readerMode === 'diff' && selectedDiffPath) void selectDiff(selectedDiffPath)
  }

  if (!open) return null

  return (
    <>
      <aside className="hidden w-[340px] min-w-[280px] max-w-[380px] shrink-0 flex-col border-l border-border bg-background lg:flex">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
          <Code2 className="size-4 text-emerald-600 dark:text-emerald-500" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground/90">Workspace</div>
            <div className="truncate text-xs text-muted-foreground/65">{project?.name ?? 'No project selected'}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={refresh} disabled={!project?.id || loading} aria-label="Refresh workspace" title="Refresh workspace">
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Close workspace" title="Close workspace">
            <PanelRightClose className="size-4" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 gap-1 border-b border-border px-3 py-2">
            {(['files', 'changes'] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === item ? 'bg-muted/28 text-foreground/90' : 'text-muted-foreground/72 hover:bg-muted/20 hover:text-foreground/85'
                }`}
                onClick={() => setTab(item)}
              >
                {item === 'files' ? 'Files' : `Changes${changes.length ? ` ${changes.length}` : ''}`}
              </button>
            ))}
          </div>

          {!project?.id ? (
            <div className="p-4 text-sm text-muted-foreground/70">Select a project to inspect its workspace.</div>
          ) : error ? (
            <div className="p-4 text-sm text-destructive">{error}</div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {loading ? <div className="px-2 py-3 text-xs text-muted-foreground/70">Loading workspace...</div> : null}
              {!loading && tab === 'files' ? (
                <>
                  <label className="mb-2 flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground/65 focus-within:text-foreground/85">
                    <Search className="size-3.5 shrink-0" />
                    <input
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                      placeholder="Filter files by name or path"
                      className="min-w-0 flex-1 bg-transparent text-xs text-foreground/85 outline-none placeholder:text-muted-foreground/50"
                    />
                  </label>
                  <div className="mb-2 px-2 text-xs text-muted-foreground/60">Click a file to open the Monaco reader.</div>
                  <WorkspaceFileTree tree={filteredTree} selectedPath={selectedFilePath} gitStatuses={gitStatuses} onSelectFile={selectFile} />
                </>
              ) : null}
              {!loading && tab === 'changes' ? (
                isGitRepository
                  ? (
                    <>
                      <div className="mb-2 flex items-center gap-2 px-2 text-xs text-muted-foreground/60">
                        <span className="min-w-0 flex-1">Click a changed file to review the diff.</span>
                        {changes.length > 0 && onDraftRequest ? (
                          <button
                            type="button"
                            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground/72 transition-colors hover:bg-muted/20 hover:text-foreground/85"
                            onClick={() => onDraftRequest(allChangesPrompt(changes))}
                          >
                            <MessageSquare className="size-3" />
                            Ask AI
                          </button>
                        ) : null}
                      </div>
                      <WorkspaceChangesList files={changes} selectedPath={selectedDiffPath} onSelectFile={selectDiff} />
                    </>
                  )
                  : <div className="px-2 py-3 text-xs text-muted-foreground/70">This project is not a Git repository.</div>
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
