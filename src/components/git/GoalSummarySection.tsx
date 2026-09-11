import { GoalIcon } from '@/components/goal-icon'
import { buildGoalCardViewModel } from '@/components/chat/panel-decoration/goal-card'
import type { GoalAction, GoalState } from '@/lib/goal'
import { requestOpenGoalSummary } from '@/lib/goal-ui'
import { t, type AppTextKey } from '@/lib/i18n'
import './goal-summary.css'

export type GoalSummarySectionProps = {
  goal: GoalState
  sessionId: string
  onAction?: (action: GoalAction, objective?: string) => Promise<unknown>
}

/** A two-line navigation entry, never a second editor or action surface. */
export function GoalSummarySection({ goal, sessionId }: GoalSummarySectionProps) {
  const view = buildGoalCardViewModel(goal)
  const passed = view.criteria.filter((criterion) => criterion.status === 'passed').length
  return (
    <button type="button" className="quickforge-goal-summary-entry" onClick={() => requestOpenGoalSummary(sessionId, goal.id, 'progress')} aria-label={t('goalOpenSummary')}>
      <span className="flex min-w-0 items-center gap-2"><GoalIcon className="size-3.5 shrink-0" /><span className="shrink-0 text-muted-foreground">{t(view.statusKey as AppTextKey)}</span><span className="truncate">{goal.objective || t('goalObjectiveEmpty')}</span></span>
      <span className="flex min-w-0 gap-2 text-muted-foreground"><span className="truncate">{view.blockerHint || view.blocker || view.summary || t('goalTitle')}</span><span className="shrink-0">{t('goalCriteriaProgress', { completed: passed, total: view.criteria.length })}</span></span>
    </button>
  )
}
