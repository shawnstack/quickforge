import { CheckCircle2, Circle, Clock3, XCircle } from 'lucide-react'
import { GoalIcon } from '@/components/goal-icon'
import { buildGoalCardViewModel } from '@/components/chat/panel-decoration/goal-card'
import type { GoalAction, GoalCriterionStatus, GoalState } from '@/lib/goal'
import { requestOpenGoalSummary } from '@/lib/goal-ui'
import { t, type AppTextKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import './goal-summary.css'

export type GoalSummarySectionProps = {
  goal: GoalState
  sessionId: string
  onAction?: (action: GoalAction, objective?: string) => Promise<unknown>
}

/** Criteria rows mirror the pinned tasks rows: one status icon + one line. */
function CriterionStatusIcon({ status }: { status: GoalCriterionStatus }) {
  if (status === 'passed') return <CheckCircle2 className="size-4 text-emerald-600" />
  if (status === 'failed') return <XCircle className="size-4 text-destructive" />
  if (status === 'needs_review') return <Clock3 className="size-4 text-amber-600" />
  return <Circle className="size-4 text-muted-foreground/65" />
}

/**
 * A titled group matching the pinned git/tasks sections: title + passed/total
 * count, the planned criteria as read-only rows, and a two-line navigation
 * entry — never a second editor or action surface.
 */
export function GoalSummarySection({ goal, sessionId }: GoalSummarySectionProps) {
  const view = buildGoalCardViewModel(goal)
  const passed = view.criteria.filter((criterion) => criterion.status === 'passed').length
  return (
    <section aria-labelledby="pinned-goal-title">
      <div id="pinned-goal-title" className="mb-2 flex items-center justify-between gap-3 pr-8 text-xs font-medium text-muted-foreground">
        <span>{t('pinnedGoalTitle')}</span>
        <span>{passed}/{view.criteria.length}</span>
      </div>
      {view.criteria.length > 0 ? (
        <div className="mb-1 space-y-1">
          {view.criteria.map((criterion) => (
            <div key={criterion.id} className="flex min-h-9 items-center gap-2.5 px-1.5 text-sm text-foreground/88">
              <span className="shrink-0" aria-hidden="true"><CriterionStatusIcon status={criterion.status} /></span>
              <span className={cn('min-w-0 flex-1 truncate', criterion.status === 'passed' && 'text-muted-foreground line-through')}>{criterion.description}</span>
              <span className="sr-only">{t(criterion.statusKey as AppTextKey)}</span>
            </div>
          ))}
        </div>
      ) : null}
      <button type="button" className="quickforge-goal-summary-entry" onClick={() => requestOpenGoalSummary(sessionId, goal.id, 'progress')} aria-label={t('goalOpenSummary')}>
        <span className="flex min-w-0 items-center gap-2"><GoalIcon className="size-3.5 shrink-0" /><span className="shrink-0 text-muted-foreground">{t(view.statusKey as AppTextKey)}</span><span className="truncate">{goal.objective || t('goalObjectiveEmpty')}</span></span>
        <span className="flex min-w-0 gap-2 text-muted-foreground"><span className="truncate">{view.blockerHint || view.blocker || view.summary || t('goalTitle')}</span></span>
      </button>
    </section>
  )
}
