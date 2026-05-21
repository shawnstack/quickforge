import { X } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { MonacoCodeViewer } from './MonacoCodeViewer'
import { MonacoDiffViewer } from './MonacoDiffViewer'
import type { GitFileDiffResponse, WorkspaceFileResponse } from './workspace-types'

type WorkspaceReaderDialogProps = {
  open: boolean
  mode: 'file' | 'diff'
  file?: WorkspaceFileResponse
  diff?: GitFileDiffResponse
  loading?: boolean
  error?: string
  onOpenChange: (open: boolean) => void
}

function formatBytes(value: number) {
  if (!Number.isFinite(value)) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function statusText(diff?: GitFileDiffResponse) {
  if (!diff) return ''
  if (diff.status === 'added') return 'Added'
  if (diff.status === 'deleted') return 'Deleted'
  if (diff.status === 'renamed') return 'Renamed'
  if (diff.status === 'untracked') return 'Untracked'
  return 'Modified'
}

export function WorkspaceReaderDialog({ open, mode, file, diff, loading, error, onOpenChange }: WorkspaceReaderDialogProps) {
  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onOpenChange, open])

  if (!open) return null

  const title = mode === 'file' ? file?.path : diff?.path
  const subtitle = mode === 'file' && file
    ? `${file.language} · ${formatBytes(file.size)}`
    : mode === 'diff' && diff
      ? `${statusText(diff)} · ${diff.language}`
      : ''

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/65 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close workspace reader"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative flex h-[min(88vh,900px)] w-[min(92vw,1280px)] min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground/90">{title ?? (mode === 'file' ? 'Code reader' : 'Diff reader')}</div>
            {subtitle ? <div className="truncate text-xs text-muted-foreground/65">{subtitle}</div> : null}
          </div>
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Close workspace reader" title="Close">
            <X className="size-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 bg-background">
          {loading ? <div className="p-4 text-sm text-muted-foreground/70">Opening...</div> : null}
          {!loading && error ? <div className="p-4 text-sm text-destructive">{error}</div> : null}
          {!loading && !error && mode === 'file' && file ? (
            <MonacoCodeViewer path={file.path} content={file.content} language={file.language} />
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
    </div>,
    document.body,
  )
}
