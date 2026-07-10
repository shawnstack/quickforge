import { ExternalLink, Loader2, Minus, Plus, RotateCcw } from 'lucide-react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { WorkspaceInlineDiffPreview } from './WorkspaceInlineDiffPreview'
import { FileIcon } from './file-icon'
import type { GitChangedFile, GitFileDiffResponse, GitFileStatus } from './workspace-types'

type GitChangeAction = 'restore' | 'stage' | 'unstage'

type WorkspaceChangesListProps = {
  files: GitChangedFile[]
  selectedPath?: string
  expandedDiff?: GitFileDiffResponse
  expandedLoading?: boolean
  expandedError?: string
  onSelectFile: (path: string) => void
  onRestoreFile?: (file: GitChangedFile) => void
  onStageFile?: (file: GitChangedFile) => void
  onUnstageFile?: (file: GitChangedFile) => void
  onOpenFile?: (file: GitChangedFile) => void
  onRestoreAll?: () => void
  onStageAll?: () => void
  onUnstageAll?: () => void
  showUnstageAll?: boolean
  pendingAction?: { action: GitChangeAction; path?: string }
  emptyMessage?: string
}

function statusText(status: GitFileStatus) {
  if (status === 'added') return t('workspaceStatusAdded')
  if (status === 'deleted') return t('workspaceStatusDeleted')
  if (status === 'renamed') return t('workspaceStatusRenamed')
  if (status === 'untracked') return t('workspaceStatusUntracked')
  if (status === 'conflicted') return t('workspaceStatusConflict')
  return t('workspaceStatusModified')
}

function fileNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.pop() || normalized || '—'
}

function actionMatches(pendingAction: WorkspaceChangesListProps['pendingAction'], action: GitChangeAction, path?: string) {
  return pendingAction?.action === action && (path ? pendingAction.path === path : !pendingAction.path)
}

function canStageFile(file: GitChangedFile) {
  return Boolean(file.unstaged || file.status === 'untracked' || file.conflict || !file.staged)
}

export function WorkspaceChangesList({
  files,
  selectedPath,
  expandedDiff,
  expandedLoading,
  expandedError,
  onSelectFile,
  onRestoreFile,
  onStageFile,
  onUnstageFile,
  onOpenFile,
  onRestoreAll,
  onStageAll,
  onUnstageAll,
  showUnstageAll = false,
  pendingAction,
  emptyMessage = t('workspaceNoWorkingTreeChanges'),
}: WorkspaceChangesListProps) {
  const stageableFiles = files.filter(canStageFile)
  const stagedFiles = files.filter((file) => file.staged)
  const restoreAllPending = actionMatches(pendingAction, 'restore')
  const stageAllPending = actionMatches(pendingAction, 'stage')
  const unstageAllPending = actionMatches(pendingAction, 'unstage')
  const hasPendingAction = Boolean(pendingAction)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-20 pt-1">
        {files.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground/70">{emptyMessage}</div>
        ) : (
          <div className="divide-y divide-[color-mix(in_oklab,var(--border)_28%,transparent)]">
            {files.map((file) => {
              const isSelected = selectedPath === file.path
              const fileName = fileNameFromPath(file.path)
              const restorePending = actionMatches(pendingAction, 'restore', file.path)
              const stagePending = actionMatches(pendingAction, 'stage', file.path)
              const unstagePending = actionMatches(pendingAction, 'unstage', file.path)
              const isDeleted = file.status === 'deleted'
              const isUnstageAction = showUnstageAll
              const stageDisabled = hasPendingAction || (isUnstageAction ? !onUnstageFile || !file.staged : !onStageFile || !canStageFile(file))
              const restoreDisabled = hasPendingAction || !onRestoreFile
              const openDisabled = hasPendingAction || !onOpenFile || isDeleted
              const title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path

              return (
                <div
                  key={`${file.status}:${file.oldPath ?? ''}:${file.path}`}
                  className={cn('group overflow-hidden', isSelected && 'rounded-xl bg-muted/30')}
                >
                  <div
                    className={cn(
                      'grid min-h-[40px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl transition-colors',
                      isSelected ? 'bg-muted/40' : 'hover:bg-muted/24',
                    )}
                  >
                    <button
                      type="button"
                      className="grid min-w-0 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => onSelectFile(file.path)}
                      title={`${statusText(file.status)} · ${title}`}
                      aria-expanded={isSelected}
                    >
                      <FileIcon path={file.path} className="size-[15px] shrink-0" />
                      <span className="min-w-0 truncate font-medium leading-[18px] text-foreground/90">{fileName}</span>
                      {typeof file.additions === 'number' && typeof file.deletions === 'number' ? (
                        <span className="min-w-[64px] shrink-0 whitespace-nowrap text-right font-mono text-sm font-medium leading-[18px]">
                          <span className="text-emerald-600 dark:text-emerald-500">+{file.additions}</span>
                          <span className="ml-1.5 text-red-600 dark:text-red-500">-{file.deletions}</span>
                        </span>
                      ) : <span className="min-w-[64px]" />}
                    </button>

                    <div className="flex shrink-0 items-center gap-1 pr-2 text-muted-foreground/55 opacity-80 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        className="inline-flex size-[26px] items-center justify-center rounded-full transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => onRestoreFile?.(file)}
                        disabled={restoreDisabled}
                        aria-label={t('workspaceRestoreFile')}
                        title={t('workspaceRestoreFile')}
                      >
                        {restorePending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-4" />}
                      </button>
                      <button
                        type="button"
                        className={cn(
                          'inline-flex size-[26px] items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                          isUnstageAction
                            ? 'hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-500'
                            : 'hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-500',
                        )}
                        onClick={() => isUnstageAction ? onUnstageFile?.(file) : onStageFile?.(file)}
                        disabled={stageDisabled}
                        aria-label={isUnstageAction ? t('workspaceUnstageFile') : t('workspaceStageFile')}
                        title={isUnstageAction ? t('workspaceUnstageFile') : t('workspaceStageFile')}
                      >
                        {stagePending || unstagePending ? <Loader2 className="size-3.5 animate-spin" /> : isUnstageAction ? <Minus className="size-4" /> : <Plus className="size-4" />}
                      </button>
                      <button
                        type="button"
                        className="inline-flex size-[26px] items-center justify-center rounded-full transition-colors hover:bg-muted/35 hover:text-foreground/85 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => onOpenFile?.(file)}
                        disabled={openDisabled}
                        aria-label={t('workspaceOpenFileInNewTab')}
                        title={isDeleted ? t('workspaceCannotOpenDeletedFile') : t('workspaceOpenFileInNewTab')}
                      >
                        <ExternalLink className="size-4" />
                      </button>
                    </div>
                  </div>

                  {isSelected ? (
                    <WorkspaceInlineDiffPreview diff={expandedDiff} loading={expandedLoading} error={expandedError} />
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
        <div className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-background/95 p-1 shadow-quickforge">
          <button
            type="button"
            className="inline-flex h-8 items-center gap-2 rounded-full px-3 text-sm font-medium text-muted-foreground/78 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
            onClick={onRestoreAll}
            disabled={!onRestoreAll || files.length === 0 || hasPendingAction}
            aria-label={t('workspaceRestoreAll')}
            title={t('workspaceRestoreAll')}
          >
            {restoreAllPending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
            <span>{t('workspaceRestoreAll')}</span>
          </button>
          <button
            type="button"
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-full px-3 text-sm font-medium text-muted-foreground/78 transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              showUnstageAll
                ? 'hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-500'
                : 'hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-500',
            )}
            onClick={showUnstageAll ? onUnstageAll : onStageAll}
            disabled={showUnstageAll ? (!onUnstageAll || stagedFiles.length === 0 || hasPendingAction) : (!onStageAll || stageableFiles.length === 0 || hasPendingAction)}
            aria-label={showUnstageAll ? t('workspaceUnstageAll') : t('workspaceStageAll')}
            title={showUnstageAll ? t('workspaceUnstageAll') : t('workspaceStageAll')}
          >
            {stageAllPending || unstageAllPending ? <Loader2 className="size-3.5 animate-spin" /> : showUnstageAll ? <Minus className="size-3.5" /> : <Plus className="size-3.5" />}
            <span>{showUnstageAll ? t('workspaceUnstageAll') : t('workspaceStageAll')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
