import { Code2, PanelRightClose, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ProjectInfo } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { getGitFileDiff, getGitStatus, getWorkspaceFile, getWorkspaceTree } from './workspace-api'
import { MonacoCodeViewer } from './MonacoCodeViewer'
import { MonacoDiffViewer } from './MonacoDiffViewer'
import { WorkspaceChangesList } from './WorkspaceChangesList'
import { WorkspaceFileTree } from './WorkspaceFileTree'
import type { GitChangedFile, GitFileDiffResponse, WorkspaceFileResponse, WorkspaceTreeNode } from './workspace-types'

type WorkspaceInspectorProps = {
  project?: ProjectInfo
  open: boolean
  onOpenChange: (open: boolean) => void
}

type WorkspaceTab = 'files' | 'changes'

function formatBytes(value: number) {
  if (!Number.isFinite(value)) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function statusText(file?: GitChangedFile | GitFileDiffResponse) {
  if (!file) return ''
  if (file.status === 'added') return 'Added'
  if (file.status === 'deleted') return 'Deleted'
  if (file.status === 'renamed') return 'Renamed'
  if (file.status === 'untracked') return 'Untracked'
  return 'Modified'
}

export function WorkspaceInspector({ project, open, onOpenChange }: WorkspaceInspectorProps) {
  const [tab, setTab] = useState<WorkspaceTab>('files')
  const [tree, setTree] = useState<WorkspaceTreeNode[]>([])
  const [changes, setChanges] = useState<GitChangedFile[]>([])
  const [isGitRepository, setIsGitRepository] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [refreshToken, setRefreshToken] = useState(0)

  const [selectedFilePath, setSelectedFilePath] = useState<string>()
  const [selectedFile, setSelectedFile] = useState<WorkspaceFileResponse>()
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string>()

  const [selectedDiffPath, setSelectedDiffPath] = useState<string>()
  const [selectedDiff, setSelectedDiff] = useState<GitFileDiffResponse>()
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string>()

  const projectId = project?.id

  const gitStatuses = useMemo(() => {
    const map: Record<string, GitChangedFile> = {}
    for (const file of changes) map[file.path] = file
    return map
  }, [changes])

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
    })
  }, [projectId])

  async function selectFile(path: string) {
    if (!projectId) return
    setTab('files')
    setSelectedFilePath(path)
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
    setSelectedDiffPath(path)
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
    if (tab === 'files' && selectedFilePath) void selectFile(selectedFilePath)
    if (tab === 'changes' && selectedDiffPath) void selectDiff(selectedDiffPath)
  }

  if (!open) return null

  return (
    <aside className="hidden w-[480px] min-w-[360px] max-w-[44vw] shrink-0 flex-col border-l border-border bg-background lg:flex">
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
          <>
            <div className="max-h-[38%] min-h-[9rem] shrink-0 overflow-auto border-b border-border p-2">
              {loading ? <div className="px-2 py-3 text-xs text-muted-foreground/70">Loading workspace...</div> : null}
              {!loading && tab === 'files' ? (
                <WorkspaceFileTree tree={tree} selectedPath={selectedFilePath} gitStatuses={gitStatuses} onSelectFile={selectFile} />
              ) : null}
              {!loading && tab === 'changes' ? (
                isGitRepository
                  ? <WorkspaceChangesList files={changes} selectedPath={selectedDiffPath} onSelectFile={selectDiff} />
                  : <div className="px-2 py-3 text-xs text-muted-foreground/70">This project is not a Git repository.</div>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              {tab === 'files' ? (
                <>
                  <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground/90">{selectedFilePath ?? 'Select a file'}</span>
                    {selectedFile ? <span className="shrink-0 text-muted-foreground/60">{selectedFile.language}</span> : null}
                    {selectedFile ? <span className="shrink-0 text-muted-foreground/60">{formatBytes(selectedFile.size)}</span> : null}
                  </div>
                  <div className="min-h-0 flex-1">
                    {fileLoading ? <div className="p-4 text-sm text-muted-foreground/70">Opening file...</div> : null}
                    {!fileLoading && fileError ? <div className="p-4 text-sm text-destructive">{fileError}</div> : null}
                    {!fileLoading && !fileError && selectedFile ? (
                      <MonacoCodeViewer path={selectedFile.path} content={selectedFile.content} language={selectedFile.language} />
                    ) : null}
                    {!fileLoading && !fileError && !selectedFile ? (
                      <div className="p-4 text-sm text-muted-foreground/70">Choose a file from the tree to preview it with Monaco.</div>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground/90">{selectedDiffPath ?? 'Select a changed file'}</span>
                    {selectedDiff ? <span className="shrink-0 text-muted-foreground/60">{statusText(selectedDiff)}</span> : null}
                  </div>
                  <div className="min-h-0 flex-1">
                    {diffLoading ? <div className="p-4 text-sm text-muted-foreground/70">Opening diff...</div> : null}
                    {!diffLoading && diffError ? <div className="p-4 text-sm text-destructive">{diffError}</div> : null}
                    {!diffLoading && !diffError && selectedDiff ? (
                      <MonacoDiffViewer
                        path={selectedDiff.path}
                        oldContent={selectedDiff.oldContent}
                        newContent={selectedDiff.newContent}
                        language={selectedDiff.language}
                        status={selectedDiff.status}
                      />
                    ) : null}
                    {!diffLoading && !diffError && !selectedDiff ? (
                      <div className="p-4 text-sm text-muted-foreground/70">Choose a changed file to review it with Monaco DiffEditor.</div>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
