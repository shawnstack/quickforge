import type { Dispatch, RefObject, SetStateAction } from 'react'
import { Check, ChevronDown, GitCommitHorizontal, RefreshCw } from 'lucide-react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { ProjectInfo } from '@/lib/types'
import { ProjectOpenMenu } from '@/components/project/ProjectOpenMenu'
import { WorkspaceChangesList } from './WorkspaceChangesList'
import type { ReviewFilter, GitChangeAction } from './useInspectorGit'
import { shouldShowWorkspaceGitRetry, type WorkspaceGitLoadStatus } from './workspace-inspector-on-demand-state'
import type { GitChangedFile, GitFileDiffResponse } from './workspace-types'

const REVIEW_FILTER_ITEMS: { value: ReviewFilter; label: string }[] = [
  { value: 'unstaged', label: t('workspaceReviewFilterUnstaged') },
  { value: 'staged', label: t('workspaceReviewFilterStaged') },
  { value: 'all', label: t('workspaceReviewFilterAllBranches') },
  { value: 'last', label: t('workspaceReviewFilterLastRun') },
]

function reviewEmptyMessage(filter: ReviewFilter) {
  if (filter === 'staged') return t('workspaceNoStagedChanges')
  if (filter === 'last') return t('workspaceNoLastRunChanges')
  return t('workspaceNoWorkingTreeChanges')
}

type WorkspaceReviewPanelProps = {
  project?: ProjectInfo
  gitLoadStatus: WorkspaceGitLoadStatus
  gitError?: string
  gitLoading: boolean
  isGitRepository: boolean
  loadGitStatus: (force?: boolean) => Promise<void>
  reviewFilter: ReviewFilter
  setReviewFilter: Dispatch<SetStateAction<ReviewFilter>>
  reviewFilterOpen: boolean
  setReviewFilterOpen: Dispatch<SetStateAction<boolean>>
  reviewFilterRef: RefObject<HTMLDivElement | null>
  selectedReviewFile?: GitChangedFile
  showExternalOpen: boolean
  onOpenSelectedChangeExternally: (target: 'explorer' | 'vscode' | 'idea') => void
  onOpenCommitPush?: () => void
  reviewFiles: GitChangedFile[]
  expandedDiffPath?: string
  expandedDiff?: GitFileDiffResponse
  expandedDiffLoading: boolean
  expandedDiffError?: string
  expandedDiffNoChanges: boolean
  toggleReviewDiff: (path: string) => void
  onOpenChangedFile: (file: GitChangedFile) => void
  onRestoreFile: (file: GitChangedFile) => void
  onStageFile: (file: GitChangedFile) => void
  onUnstageFile: (file: GitChangedFile) => void
  onRestoreAll: () => void
  onStageAll: () => void
  onUnstageAll: () => void
  pendingGitAction?: { action: GitChangeAction; path?: string }
}

/** 「审查」视图：Git 重试/加载/非仓库态 + 过滤菜单 + 变更列表。 */
export function WorkspaceReviewPanel({ project, gitLoadStatus, gitError, gitLoading, isGitRepository, loadGitStatus, reviewFilter, setReviewFilter, reviewFilterOpen, setReviewFilterOpen, reviewFilterRef, selectedReviewFile, showExternalOpen, onOpenSelectedChangeExternally, onOpenCommitPush, reviewFiles, expandedDiffPath, expandedDiff, expandedDiffLoading, expandedDiffError, expandedDiffNoChanges, toggleReviewDiff, onOpenChangedFile, onRestoreFile, onStageFile, onUnstageFile, onRestoreAll, onStageAll, onUnstageAll, pendingGitAction }: WorkspaceReviewPanelProps) {
  if (shouldShowWorkspaceGitRetry(gitLoadStatus)) {
    return (
      <div className="p-2 text-sm text-destructive">
        <div>{gitError || t('workspaceLoadFailed')}</div>
        <button
          type="button"
          className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-xl border border-[color-mix(in_oklab,var(--border)_45%,transparent)] bg-background px-3 text-xs font-medium transition-colors"
          onClick={() => void loadGitStatus(true)}
        >
          <RefreshCw className="size-3.5" />
          {t('retry')}
        </button>
      </div>
    )
  }
  if (gitLoading) return <div className="px-2 py-3 text-xs">{t('workspaceLoading')}</div>
  if (!isGitRepository) return <div className="px-2 py-3 text-xs">{t('workspaceNotGitRepository')}</div>
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 pb-2">
        <div ref={reviewFilterRef} className="relative min-w-24 flex-1">
          <button
            type="button"
            className="inline-flex h-8 w-full min-w-0 max-w-full items-center gap-2 rounded-xl border border-[color-mix(in_oklab,var(--border)_45%,transparent)] bg-background px-3 text-sm font-medium transition-colors hover:text-foreground"
            onClick={() => setReviewFilterOpen((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={reviewFilterOpen}
            title={t('workspaceReviewFilter')}
          >
            <span className="min-w-0 flex-1 truncate text-left">{REVIEW_FILTER_ITEMS.find((item) => item.value === reviewFilter)?.label}</span>
            <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', reviewFilterOpen && 'rotate-180')} />
          </button>
          {reviewFilterOpen ? (
            <div className="absolute left-0 top-10 z-40 w-48 rounded-2xl border border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-popover p-1.5 shadow-quickforge" role="menu" aria-label={t('workspaceReviewFilter')}>
              {REVIEW_FILTER_ITEMS.map((item) => {
                const active = item.value === reviewFilter
                return (
                  <button
                    key={item.value}
                    type="button"
                    className={cn(
                      'flex h-9 w-full items-center gap-2 rounded-xl px-2.5 text-left text-sm font-medium transition-colors',
                      active ? 'text-foreground' : 'hover:text-foreground',
                    )}
                    onClick={() => {
                      setReviewFilter(item.value)
                      setReviewFilterOpen(false)
                    }}
                    role="menuitemradio"
                    aria-checked={active}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {active ? <Check className="size-3.5 shrink-0" /> : null}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void loadGitStatus(true)}
            disabled={gitLoading}
            aria-label={t('refreshWorkspace')}
            title={t('refreshWorkspace')}
          >
            <RefreshCw className={cn('size-3.5', gitLoading && 'animate-spin')} />
          </button>
          {showExternalOpen ? (
            <ProjectOpenMenu
              project={project}
              disabledTargets={selectedReviewFile?.status === 'deleted' ? { vscode: true, idea: true } : undefined}
              targetDisabledLabel={t('workspaceCannotOpenDeletedFile')}
              onOpenInExplorer={() => { onOpenSelectedChangeExternally('explorer') }}
              onOpenInVSCode={() => { onOpenSelectedChangeExternally('vscode') }}
              onOpenInIDEA={() => { onOpenSelectedChangeExternally('idea') }}
            />
          ) : null}
          {onOpenCommitPush ? (
            <button
              type="button"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors"
              onClick={onOpenCommitPush}
              aria-label={t('gitToolsCommitOrPush')}
              title={t('gitToolsCommitOrPush')}
            >
              <GitCommitHorizontal className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <WorkspaceChangesList
        files={reviewFiles}
        selectedPath={expandedDiffPath}
        expandedDiff={expandedDiff}
        expandedLoading={expandedDiffLoading}
        expandedError={expandedDiffError}
        expandedNoChanges={expandedDiffNoChanges}
        onSelectFile={toggleReviewDiff}
        onRestoreFile={onRestoreFile}
        onStageFile={onStageFile}
        onUnstageFile={onUnstageFile}
        onOpenFile={onOpenChangedFile}
        onRestoreAll={onRestoreAll}
        onStageAll={onStageAll}
        onUnstageAll={onUnstageAll}
        showUnstageAll={reviewFilter === 'staged'}
        pendingAction={pendingGitAction}
        emptyMessage={reviewEmptyMessage(reviewFilter)}
      />

    </div>
  )
}
