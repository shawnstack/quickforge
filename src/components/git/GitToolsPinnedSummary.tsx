import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, FileDiff, GitBranch, List, SlidersHorizontal, X } from 'lucide-react'
import { GitBranchMenu } from '@/components/git/GitBranchMenu'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import type { GitStatusResponse } from '@/components/workspace/workspace-types'

type GitToolsPinnedSummaryProps = {
  projectId: string
  status: GitStatusResponse
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  onOpenChanges: () => void
  onOpenCommitPush: () => void
  onCheckout: (branch: string) => Promise<void>
  onCreated: (status: GitStatusResponse) => void
  onOpenGraph: () => void
  mobileShell?: boolean
}

function gitTotals(status: GitStatusResponse) {
  return status.files.reduce((totals, file) => {
    totals.additions += file.additions ?? 0
    totals.deletions += file.deletions ?? 0
    return totals
  }, { additions: 0, deletions: 0 })
}

export function GitToolsPinnedSummary({
  projectId,
  status,
  expanded,
  onExpandedChange,
  onOpenChanges,
  onOpenCommitPush,
  onCheckout,
  onCreated,
  onOpenGraph,
  mobileShell = false,
}: GitToolsPinnedSummaryProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const totals = useMemo(() => gitTotals(status), [status])
  const dirtyCount = status.counts?.total ?? status.files.length

  useEffect(() => {
    if (!expanded) return

    function closeSummary() {
      setBranchMenuOpen(false)
      onExpandedChange(false)
    }

    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return
      closeSummary()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeSummary()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [expanded, onExpandedChange])

  if (!status.isGitRepository) return null

  return (
    <div ref={rootRef} className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className={cn(
          'inline-flex size-9 items-center justify-center rounded-2xl bg-transparent text-muted-foreground/85 transition-colors hover:bg-muted/45 hover:text-foreground/90',
          expanded && 'bg-muted/45 text-foreground/90',
        )}
        onClick={() => onExpandedChange(!expanded)}
        aria-label={t('togglePinnedSummary')}
        title={t('togglePinnedSummary')}
        aria-expanded={expanded}
      >
        <List className="size-[18px]" />
      </button>

      {expanded ? (
        <div className={cn(
          'fixed inset-x-2 top-14 z-40 max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain rounded-3xl border border-[color-mix(in_oklab,var(--border)_38%,transparent)] bg-background p-4 text-foreground shadow-quickforge md:absolute md:inset-x-auto md:-right-10 md:top-11 md:max-h-none md:w-[min(15rem,calc(100vw-1rem))] md:overflow-visible lg:-right-20',
          mobileShell && 'md:fixed md:inset-x-2 md:right-auto md:top-14 md:max-h-[calc(100dvh-4rem)] md:w-auto md:overflow-y-auto lg:inset-x-2 lg:right-auto lg:top-14',
        )}>
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-medium text-muted-foreground">{t('environmentInfo')}</div>
            <button type="button" className="rounded-full p-1.5 text-foreground/85 transition-colors hover:bg-muted" onClick={() => {
              setBranchMenuOpen(false)
              onExpandedChange(false)
            }} aria-label={t('gitToolsCollapse')} title={t('gitToolsCollapse')}>
              <X className="size-4" />
            </button>
          </div>

          <div className="space-y-1 text-sm">
            <button type="button" className={cn('hidden h-11 w-full items-center gap-3 rounded-2xl px-2.5 text-left text-foreground/88 transition-colors hover:bg-muted/45 hover:text-foreground md:flex', mobileShell && 'md:hidden')} onClick={onOpenChanges}>
            <FileDiff className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 font-medium">{t('gitToolsChanges')}</span>
            <span className="font-medium text-emerald-600">+{totals.additions}</span>
            <span className="font-medium text-red-600">-{totals.deletions}</span>
          </button>

          <div className="relative">
            <button type="button" className="flex h-11 w-full items-center gap-3 rounded-2xl px-2.5 text-left text-foreground/88 transition-colors hover:bg-muted/45 hover:text-foreground" onClick={() => setBranchMenuOpen((value) => !value)} aria-expanded={branchMenuOpen}>
              <GitBranch className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{status.branch || t('unknown')}</span>
              <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', branchMenuOpen && 'rotate-180')} />
            </button>
            {branchMenuOpen ? (
              <GitBranchMenu
                projectId={projectId}
                currentBranch={status.branch}
                dirtyCount={dirtyCount}
                className={cn(
                  'fixed inset-x-2 top-[7.75rem] max-h-[calc(100dvh-8.25rem)] w-auto overflow-y-auto md:absolute md:inset-x-auto md:left-auto md:right-0 md:top-full md:mt-2 md:max-h-none md:w-[min(340px,calc(100vw-1rem))] md:overflow-hidden lg:right-full lg:top-0 lg:mr-3 lg:mt-0',
                  mobileShell && 'md:fixed md:inset-x-2 md:right-auto md:top-[7.75rem] md:mt-0 md:max-h-[calc(100dvh-8.25rem)] md:w-auto md:overflow-y-auto lg:inset-x-2 lg:right-auto lg:top-[7.75rem] lg:mr-0',
                )}
                openChangesClassName={cn('hidden md:flex', mobileShell && 'md:hidden')}
                onCheckout={async (branch) => {
                  await onCheckout(branch)
                  setBranchMenuOpen(false)
                }}
                onCreated={(nextStatus) => {
                  onCreated(nextStatus)
                  setBranchMenuOpen(false)
                }}
                onOpenGraph={() => {
                  setBranchMenuOpen(false)
                  onOpenGraph()
                }}
                onOpenChanges={() => {
                  setBranchMenuOpen(false)
                  onOpenChanges()
                }}
              />
            ) : null}
          </div>

          <button type="button" className="flex h-11 w-full items-center gap-3 rounded-2xl px-2.5 text-left text-foreground/88 transition-colors hover:bg-muted/45 hover:text-foreground" onClick={onOpenCommitPush}>
            <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-medium">{t('gitToolsCommitOrPush')}</span>
          </button>
        </div>
        </div>
      ) : null}
    </div>
  )
}
