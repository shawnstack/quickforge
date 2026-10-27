import { useMemo, type ReactNode } from 'react'
import { Bot, FileDiff, List, ListTodo, SquareTerminal } from 'lucide-react'
import { GoalIcon } from '@/components/goal-icon'
import type { TodoWriteItem } from '@/components/chat/panel-decoration'
import type { GoalCardViewModel } from '@/components/chat/panel-decoration/goal-card'
import { t, type AppTextKey } from '@/lib/i18n'

export type CapsuleSegment = {
  key: 'goal' | 'tasks' | 'git' | 'agents' | 'commands' | 'fallback'
  aria: string
  content: ReactNode
}

export type PinnedSummaryCapsuleOptions = {
  goalView: GoalCardViewModel | null
  goalPassedCriteria: number
  todos: readonly TodoWriteItem[]
  todoCounts: { completed: number; total: number }
  totals: { additions: number; deletions: number }
  hasGitTotals: boolean
  backgroundCommandCount: number
  agentRunningCount: number
  agentFinishedCount: number
  hasGitSection: boolean
}

/**
 * Builds the capsule's compact counters (goal, tasks, git, commands, agents)
 * and its combined aria label. Goal-first with capped density; the fallback
 * segment keeps a bare git summary from collapsing into an iconless capsule.
 */
export function usePinnedSummaryCapsule({
  goalView,
  goalPassedCriteria,
  todos,
  todoCounts,
  totals,
  hasGitTotals,
  backgroundCommandCount,
  agentRunningCount,
  agentFinishedCount,
  hasGitSection,
}: PinnedSummaryCapsuleOptions) {
  const capsuleSegments = useMemo<CapsuleSegment[]>(() => {
    const segments: CapsuleSegment[] = []
    // Goal first: its short title + real status + accepted-criteria count are
    // the primary answer; the other segments stay as compact counters.
    if (goalView) {
      segments.push({
        key: 'goal',
        aria: `${t('goalTitle')} ${t(goalView.statusKey as AppTextKey)} ${t('goalCriteriaProgress', { completed: goalPassedCriteria, total: goalView.criteria.length })}`,
        content: (
          <>
            <GoalIcon className="size-3.5" aria-hidden="true" />
            <span className="max-w-[8.5rem] truncate">{goalView.objective || t('goalObjectiveEmpty')}</span>
            <span>{t(goalView.statusKey as AppTextKey)}</span>
            <span>{goalPassedCriteria}/{goalView.criteria.length}</span>
          </>
        ),
      })
    }
    if (todos.length > 0) {
      segments.push({
        key: 'tasks',
        aria: t('pinnedSummaryCapsuleTasksAria', { completed: todoCounts.completed, total: todoCounts.total }),
        content: (
          <>
            <ListTodo className="size-3.5" aria-hidden="true" />
            <span>{todoCounts.completed}/{todoCounts.total}</span>
          </>
        ),
      })
    }
    if (hasGitTotals) {
      segments.push({
        key: 'git',
        aria: t('pinnedSummaryCapsuleGitAria', { additions: totals.additions, deletions: totals.deletions }),
        content: (
          <>
            <FileDiff className="size-3.5" aria-hidden="true" />
            <span className="text-emerald-600">+{totals.additions}</span>
            <span className="text-red-600">−{totals.deletions}</span>
          </>
        ),
      })
    }
    if (backgroundCommandCount > 0) {
      segments.push({
        key: 'commands',
        aria: t('backgroundCommandIndicatorAria', { count: backgroundCommandCount }),
        content: (
          <>
            <SquareTerminal className="size-3.5" aria-hidden="true" />
            <span>{backgroundCommandCount}</span>
          </>
        ),
      })
    }
    if (agentRunningCount > 0 || agentFinishedCount > 0) {
      segments.push({
        key: 'agents',
        aria: t('pinnedSummaryCapsuleAgentsAria', { running: agentRunningCount, finished: agentFinishedCount }),
        content: (
          <>
            <Bot className="size-3.5" aria-hidden="true" />
            <span>{agentRunningCount}/{agentFinishedCount}</span>
          </>
        ),
      })
    }
    if (segments.length === 0 && hasGitSection) {
      segments.push({
        key: 'fallback',
        aria: t('pinnedSummaryCapsuleFallbackAria'),
        content: <List className="size-[18px]" aria-hidden="true" />,
      })
    }
    // 有 Goal 时限制胶囊密度：Goal 段固定第一，其余最多再保留两段。
    return goalView ? segments.slice(0, 3) : segments
  }, [agentFinishedCount, agentRunningCount, backgroundCommandCount, goalPassedCriteria, goalView, hasGitSection, hasGitTotals, todos.length, todoCounts.completed, todoCounts.total, totals.additions, totals.deletions])

  const capsuleAriaParts = capsuleSegments.map((segment) => segment.aria)
  const capsuleAria = capsuleAriaParts.length > 0
    ? t('pinnedSummaryCapsuleAria', { summary: capsuleAriaParts.join(t('pinnedSummaryCapsuleSeparator')) })
    : t('pinnedSummaryExpand')

  return { capsuleSegments, capsuleAria }
}
