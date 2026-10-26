import { useCallback, useMemo, useState, type RefObject } from 'react'
import { List, X } from 'lucide-react'
import type { BackgroundCommandSummary, TodoWriteItem } from '@/components/chat/panel-decoration'
import type { SubagentRunPayload } from '@/lib/subagent-run-detail'
import { buildGoalCardViewModel } from '@/components/chat/panel-decoration/goal-card'
import type { GoalAction, GoalState } from '@/lib/goal'
import { todoWriteCounts } from '@/components/chat/panel-decoration'
import { PINNED_SUMMARY_PANEL_ID, usePinnedSummaryLayout } from '@/components/git/usePinnedSummaryLayout'
import { usePinnedSummaryCapsule } from '@/components/git/usePinnedSummaryCapsule'
import { PinnedSummaryDesktopWidget } from '@/components/git/PinnedSummaryDesktopWidget'
import { PinnedSummarySections } from '@/components/git/PinnedSummarySections'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import type { GitStatusResponse } from '@/components/workspace/workspace-types'

type GitToolsPinnedSummaryProps = {
  projectId?: string
  status?: GitStatusResponse
  todos: TodoWriteItem[]
  runningSubagentRuns: SubagentRunPayload[]
  finishedSubagentRuns: SubagentRunPayload[]
  backgroundCommands?: BackgroundCommandSummary[]
  onStopBackgroundCommand?: (command: BackgroundCommandSummary) => void
  /** Authoritative session goal; drives the first section and the goal capsule segment. */
  goal?: GoalState | null
  /** Session the goal belongs to (the shared pending/dirty key). */
  goalSessionId?: string
  /** Goal action executor (`updateGoal`); the section owns the shared lock. */
  onGoalAction?: (action: GoalAction, objective?: string) => Promise<unknown>
  expanded: boolean
  suspended?: boolean
  onExpandedChange: (expanded: boolean) => void
  onOpenSubagentRun: (payload: SubagentRunPayload) => void
  onOpenChanges: () => void
  onOpenCommitPush: () => void
  onCheckout: (branch: string) => Promise<void>
  onCreated: (status: GitStatusResponse) => void
  onOpenGraph: () => void
  mobileShell?: boolean
  initialAnchorRef: RefObject<HTMLElement | null>
}

function gitTotals(status?: GitStatusResponse) {
  return (status?.files ?? []).reduce((totals, file) => {
    totals.additions += file.additions ?? 0
    totals.deletions += file.deletions ?? 0
    return totals
  }, { additions: 0, deletions: 0 })
}

/**
 * Toolbar trigger + mobile panel orchestrator. The desktop layout state machine
 * lives in `usePinnedSummaryLayout`, the floating widget in
 * `PinnedSummaryDesktopWidget`, and the five summary groups in
 * `PinnedSummarySections`; the public props and DOM output stay unchanged.
 */
export function GitToolsPinnedSummary({
  projectId,
  status,
  todos,
  runningSubagentRuns,
  finishedSubagentRuns,
  backgroundCommands = [],
  onStopBackgroundCommand,
  goal,
  goalSessionId,
  onGoalAction,
  expanded,
  suspended = false,
  onExpandedChange,
  onOpenSubagentRun,
  onOpenChanges,
  onOpenCommitPush,
  onCheckout,
  onCreated,
  onOpenGraph,
  mobileShell = false,
  initialAnchorRef,
}: GitToolsPinnedSummaryProps) {
  const [expandedTasksSignature, setExpandedTasksSignature] = useState<string>()
  // 已结束小节默认折叠；仅在摘要弹层展开期间记忆，重开弹层恢复折叠，不持久化。
  const [finishedSubagentRunsCollapsed, setFinishedSubagentRunsCollapsed] = useState(true)
  const totals = useMemo(() => gitTotals(status), [status])
  const todoCounts = useMemo(() => todoWriteCounts(todos), [todos])
  const dirtyCount = status ? (status.counts?.total ?? status.files.length) : 0
  const hasGitSection = Boolean(status?.isGitRepository && projectId)
  // The goal section only needs a goal identity plus an action executor: it
  // shows even when there is no git repo, todo list or subagent run.
  const hasGoalSection = Boolean(goal && goalSessionId)
  const goalView = useMemo(() => (goal && hasGoalSection ? buildGoalCardViewModel(goal) : null), [goal, hasGoalSection])
  const goalPassedCriteria = goalView ? goalView.criteria.filter((criterion) => criterion.status === 'passed').length : 0
  const todoSignature = todos.map((todo) => `${todo.status}:${todo.content}`).join('\n')
  const showAllTasks = expanded && expandedTasksSignature === todoSignature
  const visibleTodos = showAllTasks ? todos : todos.slice(0, 3)
  const visibleSubagentRuns = finishedSubagentRuns
  const hasGitTotals = hasGitSection && (totals.additions > 0 || totals.deletions > 0)
  const agentRunningCount = runningSubagentRuns.length
  const agentFinishedCount = finishedSubagentRuns.length
  const { capsuleSegments, capsuleAria } = usePinnedSummaryCapsule({
    goalView,
    goalPassedCriteria,
    todos,
    todoCounts,
    totals,
    hasGitTotals,
    backgroundCommandCount: backgroundCommands.length,
    agentRunningCount,
    agentFinishedCount,
    hasGitSection,
  })
  const resetSummaryDetails = useCallback(() => {
    setExpandedTasksSignature(undefined)
    setFinishedSubagentRunsCollapsed(true)
  }, [])
  const toggleFinishedSubagentRuns = useCallback(() => {
    setFinishedSubagentRunsCollapsed((value) => !value)
  }, [])
  const layout = usePinnedSummaryLayout({
    expanded,
    suspended,
    mobileShell,
    onExpandedChange,
    initialAnchorRef,
    onResetDetails: resetSummaryDetails,
    finishedSubagentRunsCollapsed,
    showAllTasks,
  })
  const {
    rootRef,
    topTriggerRef,
    branchRowRef,
    desktopDraggable,
    floatingSummaryVisible,
    branchMenuOpen,
    setBranchMenuOpen,
    toggleBranchMenu,
    closeSummary,
    toggleSummaryFromToolbar,
  } = layout

  // Goal-only summaries are valid: the section shows as soon as the session has
  // a goal, even without a git repo, a todo list or a subagent run.
  if (
    !hasGoalSection
    && todos.length === 0
    && runningSubagentRuns.length === 0
    && finishedSubagentRuns.length === 0
    && !hasGitSection
  ) return null

  const summarySections = (
    <PinnedSummarySections
      goal={goal}
      goalSessionId={goalSessionId}
      onGoalAction={onGoalAction}
      hasGoalSection={hasGoalSection}
      status={status}
      projectId={projectId}
      hasGitSection={hasGitSection}
      totals={totals}
      dirtyCount={dirtyCount}
      mobileShell={mobileShell}
      desktopDraggable={desktopDraggable}
      branchMenuOpen={branchMenuOpen}
      branchRowRef={branchRowRef}
      toggleBranchMenu={toggleBranchMenu}
      setBranchMenuOpen={setBranchMenuOpen}
      onOpenChanges={onOpenChanges}
      onOpenCommitPush={onOpenCommitPush}
      onCheckout={onCheckout}
      onCreated={onCreated}
      onOpenGraph={onOpenGraph}
      todos={todos}
      todoCounts={todoCounts}
      visibleTodos={visibleTodos}
      todoSignature={todoSignature}
      showAllTasks={showAllTasks}
      setExpandedTasksSignature={setExpandedTasksSignature}
      backgroundCommands={backgroundCommands}
      onStopBackgroundCommand={onStopBackgroundCommand}
      runningSubagentRuns={runningSubagentRuns}
      finishedSubagentRuns={finishedSubagentRuns}
      visibleSubagentRuns={visibleSubagentRuns}
      finishedSubagentRunsCollapsed={finishedSubagentRunsCollapsed}
      onToggleFinishedSubagentRuns={toggleFinishedSubagentRuns}
      onOpenSubagentRun={onOpenSubagentRun}
    />
  )

  const desktopFloatingWidget = (
    <PinnedSummaryDesktopWidget
      layout={layout}
      suspended={suspended}
      capsuleSegments={capsuleSegments}
      capsuleAria={capsuleAria}
      projectId={projectId}
      currentBranch={status?.branch}
      dirtyCount={dirtyCount}
      onCheckout={onCheckout}
      onCreated={onCreated}
      onOpenGraph={onOpenGraph}
      onOpenChanges={onOpenChanges}
    >
      {summarySections}
    </PinnedSummaryDesktopWidget>
  )

  return (
    <>
      <div
        ref={rootRef}
        className={cn('relative', suspended && 'hidden')}
        hidden={suspended}
        aria-hidden={suspended || undefined}
        inert={suspended ? true : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={topTriggerRef}
          type="button"
          className={cn(
            'inline-flex size-9 items-center justify-center rounded-2xl bg-transparent transition-colors',
            floatingSummaryVisible && '',
          )}
          onClick={toggleSummaryFromToolbar}
          aria-label={t('togglePinnedSummary')}
          title={t('togglePinnedSummary')}
          aria-pressed={floatingSummaryVisible}
          aria-expanded={floatingSummaryVisible}
          aria-controls={PINNED_SUMMARY_PANEL_ID}
        >
          <List className="size-[18px]" />
        </button>

        {!desktopDraggable && expanded ? (
          <div
            id={PINNED_SUMMARY_PANEL_ID}
            className={cn(
              'fixed inset-x-2 top-14 z-40 max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain rounded-3xl border border-[color-mix(in_oklab,var(--border)_38%,transparent)] bg-background p-4 text-foreground shadow-quickforge',
              mobileShell && 'md:fixed md:inset-x-2 md:right-auto md:top-14 md:max-h-[calc(100dvh-4rem)] md:w-auto md:overflow-y-auto lg:inset-x-2 lg:right-auto lg:top-14',
            )}
          >
            <button type="button" className="absolute right-3 top-3 z-10 inline-flex size-8 items-center justify-center rounded-full transition-colors hover:bg-muted" onClick={() => closeSummary()} aria-label={t('pinnedSummaryClose')} title={t('pinnedSummaryClose')}>
              <X className="size-4" />
            </button>
            {summarySections}
          </div>
        ) : null}
      </div>
      {desktopFloatingWidget}
    </>
  )
}
