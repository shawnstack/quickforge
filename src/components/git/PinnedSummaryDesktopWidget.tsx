import type { ReactNode } from 'react'
import { GripHorizontal, Maximize2, Minimize2, X } from 'lucide-react'
import { GitBranchMenu } from '@/components/git/GitBranchMenu'
import type { CapsuleSegment } from '@/components/git/usePinnedSummaryCapsule'
import {
  PINNED_SUMMARY_PANEL_ID,
  type PinnedSummaryLayout,
} from '@/components/git/usePinnedSummaryLayout'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import type { GitStatusResponse } from '@/components/workspace/workspace-types'

type PinnedSummaryDesktopWidgetProps = {
  layout: PinnedSummaryLayout
  suspended: boolean
  capsuleSegments: CapsuleSegment[]
  capsuleAria: string
  projectId?: string
  currentBranch?: string
  dirtyCount: number
  onCheckout: (branch: string) => Promise<void>
  onCreated: (status: GitStatusResponse) => void
  onOpenGraph: () => void
  onOpenChanges: () => void
  children: ReactNode
}

/**
 * The single fixed desktop widget: capsule, panel and the branch menu that is
 * anchored beside the panel. It is only mounted while the layout hook says the
 * desktop widget is mounted; crossfading stays CSS-driven via `data-mode`.
 */
export function PinnedSummaryDesktopWidget({
  layout,
  suspended,
  capsuleSegments,
  capsuleAria,
  projectId,
  currentBranch,
  dirtyCount,
  onCheckout,
  onCreated,
  onOpenGraph,
  onOpenChanges,
  children,
}: PinnedSummaryDesktopWidgetProps) {
  const {
    desktopWidgetRef,
    desktopPanelRef,
    desktopPanelHeaderRef,
    desktopPanelContentRef,
    desktopPanelMinimizeRef,
    capsuleRef,
    capsuleMainRef,
    suppressClickRef,
    desktopDraggable,
    desktopMode,
    desktopWidgetMounted,
    desktopWidgetClosing,
    desktopWidgetStyle,
    dragging,
    branchMenuOpen,
    branchMenuPlacement,
    setBranchMenuOpen,
    openDesktopPanel,
    minimizeDesktopPanel,
    closeSummary,
    beginDrag,
  } = layout

  if (!desktopDraggable || !desktopWidgetMounted) return null

  return (
    <div
      ref={desktopWidgetRef}
      data-mode={desktopMode === 'closed' ? 'capsule' : desktopMode}
      data-closing={desktopWidgetClosing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      className={cn('quickforge-pinned-summary-widget fixed z-40', suspended && 'hidden')}
      style={desktopWidgetStyle}
      hidden={suspended}
      aria-hidden={suspended || undefined}
      inert={suspended ? true : undefined}
    >
      <div
        ref={capsuleRef}
        className={cn(
          'quickforge-pinned-summary-capsule flex min-h-11 max-w-[calc(100vw-1.5rem)] cursor-grab items-center rounded-full border border-[color-mix(in_oklab,var(--border)_55%,transparent)] bg-background text-foreground shadow-quickforge',
          dragging && 'cursor-grabbing',
        )}
        onPointerDown={(event) => beginDrag(event, 'capsule')}
        aria-hidden={desktopMode !== 'capsule'}
        inert={desktopMode !== 'capsule' ? true : undefined}
      >
        <button
          ref={capsuleMainRef}
          type="button"
          className="quickforge-pinned-summary-capsule-main group flex min-w-0 flex-1 items-center gap-2 rounded-l-full py-1 pl-2.5 text-left transition-colors"
          onClick={() => {
            if (suppressClickRef.current) return
            openDesktopPanel()
          }}
          aria-label={capsuleAria}
          title={t('pinnedSummaryExpand')}
          aria-expanded={false}
          aria-controls={PINNED_SUMMARY_PANEL_ID}
          tabIndex={desktopMode === 'capsule' ? 0 : -1}
        >
          {capsuleSegments.map((segment, index) => (
            <span key={segment.key} className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-xs font-medium tabular-nums text-muted-foreground">
              {index > 0 ? <span className="h-3.5 w-px shrink-0" aria-hidden="true" /> : null}
              {segment.content}
            </span>
          ))}
          <span className="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors" aria-hidden="true">
            <Maximize2 className="size-3.5" />
          </span>
        </button>
        <button
          type="button"
          className="quickforge-pinned-summary-capsule-close mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation()
            closeSummary({ focusTrigger: true })
          }}
          onPointerDown={(event) => event.stopPropagation()}
          aria-label={t('pinnedSummaryClose')}
          title={t('pinnedSummaryClose')}
          tabIndex={desktopMode === 'capsule' ? 0 : -1}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div
        ref={desktopPanelRef}
        id={PINNED_SUMMARY_PANEL_ID}
        className="quickforge-pinned-summary-panel flex w-[min(20.5rem,calc(100vw-1rem))] flex-col overflow-visible rounded-3xl border border-[color-mix(in_oklab,var(--border)_38%,transparent)] bg-background text-foreground shadow-quickforge"
        aria-hidden={desktopMode !== 'panel'}
        inert={desktopMode !== 'panel' ? true : undefined}
      >
        <div
          ref={desktopPanelHeaderRef}
          className={cn(
            'flex min-h-10 shrink-0 cursor-grab items-center gap-2 rounded-t-3xl px-3 text-xs font-medium text-muted-foreground',
            dragging && 'cursor-grabbing',
          )}
          onPointerDown={(event) => beginDrag(event, 'header')}
        >
          <GripHorizontal className="size-4" aria-hidden="true" />
          <span className="flex-1">{t('pinnedSummaryDrag')}</span>
          <button ref={desktopPanelMinimizeRef} type="button" className="inline-flex size-8 items-center justify-center rounded-full transition-colors hover:bg-muted" onClick={() => minimizeDesktopPanel()} aria-label={t('pinnedSummaryMinimize')} title={t('pinnedSummaryMinimize')} tabIndex={desktopMode === 'panel' ? 0 : -1}>
            <Minimize2 className="size-4" aria-hidden="true" />
          </button>
          <button type="button" className="inline-flex size-8 items-center justify-center rounded-full transition-colors hover:bg-muted" onClick={() => closeSummary({ focusTrigger: true })} aria-label={t('pinnedSummaryClose')} title={t('pinnedSummaryClose')} tabIndex={desktopMode === 'panel' ? 0 : -1}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div ref={desktopPanelContentRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          {children}
        </div>
      </div>

      {branchMenuOpen && desktopDraggable && branchMenuPlacement && projectId ? (
        <GitBranchMenu
          projectId={projectId}
          currentBranch={currentBranch}
          dirtyCount={dirtyCount}
          className={cn(
            'absolute left-auto right-auto z-50 overflow-y-auto',
            branchMenuPlacement.side === 'left' ? 'right-full mr-1 origin-top-right' : 'left-full ml-1 origin-top-left',
          )}
          style={{ top: branchMenuPlacement.top, maxHeight: branchMenuPlacement.maxHeight }}
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
  )
}
