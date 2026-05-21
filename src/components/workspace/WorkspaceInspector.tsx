import { Code2, PanelRightClose, RefreshCw } from 'lucide-react'
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
}

type WorkspaceTab = 'files' | 'changes'
type ReaderMode = 'file' | 'diff'

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
  const [readerOpen, setReaderOpen] = useState(false)
  const [readerMode, setReaderMode] = useState<ReaderMode>('file')

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
                  <div className="mb-2 px-2 text-xs text-muted-foreground/60">Click a file to open the Monaco reader.</div>
                  <WorkspaceFileTree tree={tree} selectedPath={selectedFilePath} gitStatuses={gitStatuses} onSelectFile={selectFile} />
                </>
              ) : null}
              {!loading && tab === 'changes' ? (
                isGitRepository
                  ? (
                    <>
                      <div className="mb-2 px-2 text-xs text-muted-foreground/60">Click a changed file to review the diff.</div>
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
      />
    </>
  )
}
