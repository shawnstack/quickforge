import { ChevronDown } from 'lucide-react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { WorkspaceInlineDiffPreview } from './WorkspaceInlineDiffPreview'
import { FileIcon } from './file-icon'
import type { GitChangedFile, GitFileDiffResponse, GitFileStatus } from './workspace-types'

type WorkspaceChangesListProps = {
  files: GitChangedFile[]
  selectedPath?: string
  expandedDiff?: GitFileDiffResponse
  expandedLoading?: boolean
  expandedError?: string
  onSelectFile: (path: string) => void
  emptyMessage?: string
}

function statusMeta(status: GitFileStatus) {
  if (status === 'added') return { label: 'A', text: t('workspaceStatusAdded'), className: 'text-emerald-600 dark:text-emerald-500' }
  if (status === 'deleted') return { label: 'D', text: t('workspaceStatusDeleted'), className: 'text-red-600 dark:text-red-500' }
  if (status === 'renamed') return { label: 'R', text: t('workspaceStatusRenamed'), className: 'text-blue-600 dark:text-blue-500' }
  if (status === 'untracked') return { label: 'U', text: t('workspaceStatusUntracked'), className: 'text-amber-600 dark:text-amber-500' }
  if (status === 'conflicted') return { label: '!', text: t('workspaceStatusConflict'), className: 'text-red-600 dark:text-red-500' }
  return { label: 'M', text: t('workspaceStatusModified'), className: 'text-emerald-600 dark:text-emerald-500' }
}

function pathParts(path: string) {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  const fileName = parts.pop() || normalized || '—'
  return {
    fileName,
    directory: parts.join('/'),
  }
}

export function WorkspaceChangesList({ files, selectedPath, expandedDiff, expandedLoading, expandedError, onSelectFile, emptyMessage = t('workspaceNoWorkingTreeChanges') }: WorkspaceChangesListProps) {
  if (files.length === 0) {
    return <div className="px-2 py-3 text-xs text-muted-foreground/70">{emptyMessage}</div>
  }

  return (
    <div className="space-y-1">
      {files.map((file) => {
        const meta = statusMeta(file.status)
        const isSelected = selectedPath === file.path
        const { fileName, directory } = pathParts(file.path)
        return (
          <div
            key={`${file.status}:${file.oldPath ?? ''}:${file.path}`}
            className={cn('overflow-hidden rounded-xl', isSelected && 'border border-[color-mix(in_oklab,var(--border)_30%,transparent)] bg-background')}
          >
            <button
              type="button"
              className={cn(
                'flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
                isSelected
                  ? 'rounded-t-xl bg-muted/40 text-foreground/92'
                  : 'rounded-xl text-foreground/84 hover:bg-muted/24 hover:text-foreground/92',
              )}
              onClick={() => onSelectFile(file.path)}
              title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
              aria-expanded={isSelected}
            >
              <FileIcon path={file.path} className={cn('size-4 shrink-0', meta.className)} />
              <span className="min-w-0 flex-1 truncate leading-5">
                <span className="font-medium text-foreground/90">{fileName}</span>
                <span className="ml-2 text-xs text-muted-foreground/55">
                  {directory || (file.oldPath ? file.oldPath : t('workspaceRootPath'))}
                </span>
              </span>
              {typeof file.additions === 'number' && typeof file.deletions === 'number' ? (
                <span className="shrink-0 whitespace-nowrap text-right font-mono text-xs font-medium leading-5">
                  <span className="text-emerald-600 dark:text-emerald-500">+{file.additions}</span>
                  <span className="ml-1.5 text-red-600 dark:text-red-500">-{file.deletions}</span>
                </span>
              ) : null}
              <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground/45 transition-transform', isSelected && 'rotate-180')} />
            </button>
            {isSelected ? (
              <WorkspaceInlineDiffPreview diff={expandedDiff} loading={expandedLoading} error={expandedError} />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
