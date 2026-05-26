import type { GitChangedFile, GitFileStatus } from './workspace-types'

type WorkspaceChangesListProps = {
  files: GitChangedFile[]
  selectedPath?: string
  onSelectFile: (path: string) => void
  emptyMessage?: string
}

function statusMeta(status: GitFileStatus) {
  if (status === 'added') return { label: 'A', text: 'Added', className: 'text-emerald-600 dark:text-emerald-500' }
  if (status === 'deleted') return { label: 'D', text: 'Deleted', className: 'text-red-600 dark:text-red-500' }
  if (status === 'renamed') return { label: 'R', text: 'Renamed', className: 'text-blue-600 dark:text-blue-500' }
  if (status === 'untracked') return { label: 'U', text: 'Untracked', className: 'text-amber-600 dark:text-amber-500' }
  if (status === 'conflicted') return { label: '!', text: 'Conflict', className: 'text-red-600 dark:text-red-500' }
  return { label: 'M', text: 'Modified', className: 'text-emerald-600 dark:text-emerald-500' }
}

export function WorkspaceChangesList({ files, selectedPath, onSelectFile, emptyMessage = 'No working tree changes.' }: WorkspaceChangesListProps) {
  if (files.length === 0) {
    return <div className="px-2 py-3 text-xs text-muted-foreground/70">{emptyMessage}</div>
  }

  return (
    <div className="space-y-0.5">
      {files.map((file) => {
        const meta = statusMeta(file.status)
        const isSelected = selectedPath === file.path
        return (
          <button
            key={`${file.status}:${file.oldPath ?? ''}:${file.path}`}
            type="button"
            className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors ${
              isSelected ? 'bg-muted/28 text-foreground/90' : 'text-muted-foreground/72 hover:bg-muted/20 hover:text-foreground/85'
            }`}
            onClick={() => onSelectFile(file.path)}
            title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
          >
            <span className={`w-4 shrink-0 font-mono text-[0.68rem] font-semibold ${meta.className}`}>{meta.label}</span>
            <span className="min-w-0 flex-1 truncate">{file.path}</span>
            <span className="shrink-0 text-[0.68rem] text-muted-foreground/55">{meta.text}</span>
          </button>
        )
      })}
    </div>
  )
}
