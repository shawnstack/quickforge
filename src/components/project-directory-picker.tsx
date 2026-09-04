import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Folder, FolderPlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'

type FilesystemRoot = {
  name: string
  path: string
}

type DirectoryEntry = {
  name: string
  path: string
}

type DirectoryPayload = {
  path: string
  parent: string | null
  directories: DirectoryEntry[]
}

type ProjectDirectoryPickerProps = {
  open: boolean
  initialPath?: string
  disabled?: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (path: string) => Promise<void>
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`)
  }
  return payload as T
}

export function ProjectDirectoryPicker({
  open,
  initialPath,
  disabled,
  onOpenChange,
  onSelect,
}: ProjectDirectoryPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const newFolderInputRef = useRef<HTMLInputElement>(null)
  const [roots, setRoots] = useState<FilesystemRoot[]>([])
  const [currentPath, setCurrentPath] = useState('')
  const [pathInput, setPathInput] = useState('')
  const [parentPath, setParentPath] = useState<string | null>(null)
  const [directories, setDirectories] = useState<DirectoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [error, setError] = useState('')

  const loadDirectory = async (path: string) => {
    if (!path.trim()) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/filesystem/directories?path=${encodeURIComponent(path.trim())}`)
      const payload = await readJsonResponse<DirectoryPayload>(response)
      setCurrentPath(payload.path)
      setPathInput(payload.path)
      setParentPath(payload.parent)
      setDirectories(Array.isArray(payload.directories) ? payload.directories : [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('directoryLoadFailed'))
    } finally {
      setLoading(false)
    }
  }

  const openNewFolderInput = () => {
    setShowNewFolder(true)
    setNewFolderName('')
    setError('')
    window.setTimeout(() => newFolderInputRef.current?.focus(), 0)
  }

  const submitNewFolder = async () => {
    const name = newFolderName.trim()
    if (!name || creatingFolder || submitting) return
    setCreatingFolder(true)
    setError('')
    try {
      const response = await fetch('/api/filesystem/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: currentPath, name }),
      })
      const payload = await readJsonResponse<{ ok: boolean; path: string }>(response)
      setShowNewFolder(false)
      setNewFolderName('')
      await loadDirectory(payload.path)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t('createDirectoryFailed'))
    } finally {
      setCreatingFolder(false)
    }
  }

  useEffect(() => {
    if (!open) return

    let disposed = false
    const loadRoots = async () => {
      setLoading(true)
      setError('')
      try {
        const response = await fetch('/api/filesystem/roots')
        const payload = await readJsonResponse<{ roots: FilesystemRoot[] }>(response)
        if (disposed) return
        const nextRoots = Array.isArray(payload.roots) ? payload.roots : []
        setRoots(nextRoots)
        const startPath = initialPath || nextRoots[0]?.path || ''
        if (startPath) await loadDirectory(startPath)
      } catch (loadError) {
        if (!disposed) setError(loadError instanceof Error ? loadError.message : t('filesystemRootsFailed'))
      } finally {
        if (!disposed) setLoading(false)
      }
    }

    void loadRoots()
    window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      disposed = true
    }
  }, [initialPath, open])

  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting && !creatingFolder) onOpenChange(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [creatingFolder, onOpenChange, open, submitting])

  if (!open) return null

  const selectCurrentPath = async () => {
    const selectedPath = pathInput.trim() || currentPath
    if (!selectedPath || submitting || disabled) return
    setSubmitting(true)
    setError('')
    try {
      await onSelect(selectedPath)
      onOpenChange(false)
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : t('failedToSelectProjectDirectory'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="quickforge-dialog-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting && !creatingFolder) onOpenChange(false)
      }}
    >
      <div className="quickforge-dialog-panel-in flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-background shadow-quickforge">
        <div className="border-b border-border p-4">
          <h2 className="text-base font-semibold text-foreground">{t('selectProjectDirectory')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('selectProjectDirectoryDescription')}</p>
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          {roots.length > 0 ? (
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('quickAccess')}</div>
              <div className="flex flex-wrap gap-2">
                {roots.map((root) => (
                  <Button
                    key={`${root.name}:${root.path}`}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => loadDirectory(root.path)}
                    disabled={loading || submitting}
                  >
                    {root.name}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              void loadDirectory(pathInput)
            }}
          >
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground" htmlFor="project-path-input">
              {t('path')}
            </label>
            <div className="flex gap-2">
              <input
                id="project-path-input"
                ref={inputRef}
                className={cn(
                  'min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                )}
                value={pathInput}
                onChange={(event) => setPathInput(event.target.value)}
                placeholder={t('folderPickerPathPlaceholder')}
                disabled={loading || submitting}
              />
              <Button type="submit" variant="outline" disabled={loading || submitting || !pathInput.trim()}>
                {t('go')}
              </Button>
            </div>
          </form>

          {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

          <div className="rounded-md border border-border">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div className="min-w-0 truncate text-sm font-medium" title={currentPath}>
                {currentPath || t('loading')}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading || submitting || creatingFolder || !currentPath}
                  onClick={openNewFolderInput}
                >
                  <FolderPlus className="size-4" />
                  <span className="hidden sm:inline">{t('createDirectory')}</span>
                </Button>
                {loading ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : null}
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto p-1">
              {showNewFolder ? (
                <form
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void submitNewFolder()
                  }}
                >
                  <FolderPlus className="size-4 shrink-0 text-muted-foreground" />
                  <input
                    ref={newFolderInputRef}
                    className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={newFolderName}
                    onChange={(event) => setNewFolderName(event.target.value)}
                    placeholder={t('newDirectoryNamePlaceholder')}
                    disabled={loading || submitting || creatingFolder}
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.stopPropagation()
                        setShowNewFolder(false)
                        setNewFolderName('')
                      }
                    }}
                  />
                  <Button type="submit" variant="outline" size="sm" disabled={creatingFolder || !newFolderName.trim()}>
                    {creatingFolder ? t('creatingDirectory') : t('createDirectory')}
                  </Button>
                </form>
              ) : null}

              {parentPath ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted/28 disabled:opacity-50"
                  onClick={() => loadDirectory(parentPath)}
                  disabled={loading || submitting || creatingFolder}
                >
                  <ChevronLeft className="size-4 text-muted-foreground" />
                  <span>{t('parentDirectory')}</span>
                </button>
              ) : null}

              {!loading && directories.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">{t('noFolders')}</div>
              ) : null}

              {directories.map((directory) => (
                <button
                  key={directory.path}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted/28 disabled:opacity-50"
                  onClick={() => loadDirectory(directory.path)}
                  disabled={loading || submitting || creatingFolder}
                  title={directory.path}
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{directory.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting || creatingFolder}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={selectCurrentPath} disabled={loading || submitting || creatingFolder || disabled || !(pathInput.trim() || currentPath)}>
            {submitting ? t('selecting') : t('selectThisFolder')}
          </Button>
        </div>
      </div>
    </div>
  )
}
