import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Ellipsis, FileDiff, GitBranch, List, SlidersHorizontal, X } from 'lucide-react'
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
}: GitToolsPinnedSummaryProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const totals = useMemo(() => gitTotals(status), [status])
  const dirtyCount = status.counts?.total ?? status.files.length

  useEffect(() => {
    if (!branchMenuOpen) return
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return
      setBranchMenuOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [branchMenuOpen])

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
        <div className="absolute -right-20 top-11 z-40 w-[280px] rounded-3xl border border-[color-mix(in_oklab,var(--border)_38%,transparent)] bg-background p-4 text-foreground shadow-quickforge">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-medium text-muted-foreground">{t('environmentInfo')}</div>
          <div className="flex items-center gap-1 text-foreground/85">
            <button type="button" className="rounded-full p-1.5 transition-colors hover:bg-muted" aria-label={t('more')} title={t('more')}>
              <Ellipsis className="size-4" />
            </button>
            <button type="button" className="rounded-full p-1.5 transition-colors hover:bg-muted" onClick={() => {
              setBranchMenuOpen(false)
              onExpandedChange(false)
            }} aria-label={t('gitToolsCollapse')} title={t('gitToolsCollapse')}>
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="space-y-1 text-sm">
          <button type="button" className="flex h-11 w-full items-center gap-3 rounded-2xl px-2.5 text-left text-foreground/88 transition-colors hover:bg-muted/45 hover:text-foreground" onClick={onOpenChanges}>
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
                className="left-auto right-full top-0 mr-3"
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
