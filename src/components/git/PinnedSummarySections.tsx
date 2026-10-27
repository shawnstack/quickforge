import type { RefObject } from 'react'
import {
  Bot,
  SquareTerminal,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileDiff,
  GitBranch,
  Loader2,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react'
import { GitBranchMenu } from '@/components/git/GitBranchMenu'
import { GoalSummarySection } from '@/components/git/GoalSummarySection'
import type { BackgroundCommandSummary, TodoWriteItem, TodoWriteStatus } from '@/components/chat/panel-decoration'
import type { SubagentRunPayload } from '@/lib/subagent-run-detail'
import type { GoalAction, GoalState } from '@/lib/goal'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { TODO_STATUS_GLYPH_CLASS, todoStatusLabel as todoStatusLabelFromLib } from '@/lib/todo-status'
import { TodoStatusIcon as TodoStatusGlyph } from '@/lib/todo-status-icon'
import type { GitStatusResponse } from '@/components/workspace/workspace-types'

type PinnedSummaryTotals = {
  additions: number
  deletions: number
}

type PinnedSummarySectionsProps = {
  goal?: GoalState | null
  goalSessionId?: string
  onGoalAction?: (action: GoalAction, objective?: string) => Promise<unknown>
  hasGoalSection: boolean
  status?: GitStatusResponse
  projectId?: string
  hasGitSection: boolean
  totals: PinnedSummaryTotals
  dirtyCount: number
  mobileShell: boolean
  desktopDraggable: boolean
  branchMenuOpen: boolean
  branchRowRef: RefObject<HTMLButtonElement | null>
  toggleBranchMenu: () => void
  setBranchMenuOpen: (open: boolean) => void
  onOpenChanges: () => void
  onOpenCommitPush: () => void
  onCheckout: (branch: string) => Promise<void>
  onCreated: (status: GitStatusResponse) => void
  onOpenGraph: () => void
  todos: TodoWriteItem[]
  todoCounts: { completed: number; total: number }
  visibleTodos: TodoWriteItem[]
  todoSignature: string
  showAllTasks: boolean
  setExpandedTasksSignature: (signature: string | undefined) => void
  backgroundCommands: BackgroundCommandSummary[]
  onStopBackgroundCommand?: (command: BackgroundCommandSummary) => void
  /** 打开右侧后台任务面板（置顶摘要里点标题「查看全部」或某条命令都走这里）。 */
  onOpenBackgroundTasks?: () => void
  runningSubagentRuns: SubagentRunPayload[]
  finishedSubagentRuns: SubagentRunPayload[]
  visibleSubagentRuns: SubagentRunPayload[]
  finishedSubagentRunsCollapsed: boolean
  onToggleFinishedSubagentRuns: () => void
  onOpenSubagentRun: (payload: SubagentRunPayload) => void
}

function todoStatusLabel(status: TodoWriteStatus) {
  return todoStatusLabelFromLib(status)
}

/**
 * Three-state glyph shared with the composer capsule and the history card.
 * The old lucide pair (`CheckCircle2` emerald / `Clock3` amber) was a third
 * colour vocabulary — `amber-600` appears nowhere else in the todo surfaces —
 * so the pinned summary now renders the same geometry and colour recipes as the
 * capsule. Layout (`size-4`, the `shrink-0` wrapper) is unchanged.
 */
function TodoStatusIcon({ status }: { status: TodoWriteStatus }) {
  return (
    <TodoStatusGlyph
      status={status}
      className={cn('size-4', TODO_STATUS_GLYPH_CLASS[status])}
    />
  )
}

function formatDuration(payload: SubagentRunPayload) {
  const durationMs = payload.timing?.durationMs
    ?? (payload.timing?.startedAt !== undefined && payload.timing.finishedAt !== undefined
      ? Math.max(0, payload.timing.finishedAt - payload.timing.startedAt)
      : undefined)
  if (durationMs === undefined) return ''
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`
}

/** The goal, git, todo, background-command and subagent groups of the summary. */
export function PinnedSummarySections({
  goal,
  goalSessionId,
  onGoalAction,
  hasGoalSection,
  status,
  projectId,
  hasGitSection,
  totals,
  dirtyCount,
  mobileShell,
  desktopDraggable,
  branchMenuOpen,
  branchRowRef,
  toggleBranchMenu,
  setBranchMenuOpen,
  onOpenChanges,
  onOpenCommitPush,
  onCheckout,
  onCreated,
  onOpenGraph,
  todos,
  todoCounts,
  visibleTodos,
  todoSignature,
  showAllTasks,
  setExpandedTasksSignature,
  backgroundCommands,
  onStopBackgroundCommand,
  onOpenBackgroundTasks,
  runningSubagentRuns,
  finishedSubagentRuns,
  visibleSubagentRuns,
  finishedSubagentRunsCollapsed,
  onToggleFinishedSubagentRuns,
  onOpenSubagentRun,
}: PinnedSummarySectionsProps) {
  return (
    <>
      {hasGoalSection && goal && goalSessionId ? (
        <GoalSummarySection goal={goal} sessionId={goalSessionId} onAction={onGoalAction} />
      ) : null}

      {hasGitSection && status && projectId ? (
        <section aria-labelledby="pinned-environment-title">
          <div id="pinned-environment-title" className="mb-2 pr-8 text-xs font-medium text-muted-foreground">{t('gitToolsTitle')}</div>
          <div className="space-y-1 text-sm">
            <button type="button" className={cn('hidden h-11 w-full items-center gap-3 rounded-2xl px-2.5 text-left transition-colors hover:text-foreground md:flex', mobileShell && 'md:hidden')} onClick={onOpenChanges}>
              <FileDiff className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 font-medium">{t('gitToolsChanges')}</span>
              <span className="font-medium text-emerald-600">+{totals.additions}</span>
              <span className="font-medium text-red-600">-{totals.deletions}</span>
            </button>

            <div className="relative">
              <button ref={branchRowRef} type="button" className="flex h-11 w-full items-center gap-3 rounded-2xl px-2.5 text-left transition-colors hover:text-foreground" onClick={toggleBranchMenu} aria-expanded={branchMenuOpen}>
                <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">{status.branch || t('unknown')}</span>
                <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', branchMenuOpen && 'rotate-180')} />
              </button>
              {!desktopDraggable && branchMenuOpen ? (
                <GitBranchMenu
                  projectId={projectId}
                  currentBranch={status.branch}
                  dirtyCount={dirtyCount}
                  className={cn(
                    'fixed inset-x-2 top-[9.25rem] max-h-[calc(100dvh-9.75rem)] w-auto overflow-y-auto',
                    mobileShell && 'md:fixed md:inset-x-2 md:right-auto md:top-[9.25rem] md:mt-0 md:max-h-[calc(100dvh-9.75rem)] md:w-auto md:overflow-y-auto lg:inset-x-2 lg:right-auto lg:top-[9.25rem] lg:mr-0',
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

            <button type="button" className="flex h-11 w-full items-center gap-3 rounded-2xl px-2.5 text-left transition-colors hover:text-foreground" onClick={onOpenCommitPush}>
              <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
              <span className="font-medium">{t('gitToolsCommitOrPush')}</span>
            </button>
          </div>
        </section>
      ) : null}

      {todos.length > 0 ? (
        <section className={cn((hasGoalSection || hasGitSection) && 'mt-3 border-t-[0.5px] border-[color-mix(in_oklab,var(--border)_28%,transparent)] pt-3')} aria-labelledby="pinned-tasks-title">
          <div id="pinned-tasks-title" className="mb-2 flex items-center justify-between gap-3 pr-8 text-xs font-medium text-muted-foreground">
            <span>{t('pinnedTasksTitle')}</span>
            <span>{todoCounts.completed}/{todoCounts.total}</span>
          </div>
          <div className="space-y-1">
            {visibleTodos.map((todo, index) => (
              <div key={`${todo.content}:${index}`} className="flex min-h-9 items-center gap-2.5 px-1.5 text-sm">
                <span className="shrink-0" aria-hidden="true"><TodoStatusIcon status={todo.status} /></span>
                <span className={cn('min-w-0 flex-1 truncate', todo.status === 'completed' && 'text-muted-foreground line-through')}>{todo.content}</span>
                <span className="sr-only">{todoStatusLabel(todo.status)}</span>
              </div>
            ))}
          </div>
          {todos.length > 3 ? (
            <button type="button" className="mt-1 rounded-lg px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground" onClick={() => setExpandedTasksSignature(showAllTasks ? undefined : todoSignature)} aria-expanded={showAllTasks}>
              {showAllTasks ? t('pinnedCollapseTasks') : t('pinnedViewAllTasks', { count: todos.length })}
            </button>
          ) : null}
        </section>
      ) : null}

      {backgroundCommands.length > 0 ? (
        <section className={cn((hasGoalSection || hasGitSection || todos.length > 0) && 'mt-3 border-t-[0.5px] border-[color-mix(in_oklab,var(--border)_28%,transparent)] pt-3')} aria-labelledby="pinned-commands-title">
          <div id="pinned-commands-title" className="mb-2 flex items-center justify-between gap-3 pr-8 text-xs font-medium text-muted-foreground">
            <span>{t('backgroundCommandMenuTitle', { count: backgroundCommands.length })}</span>
            {onOpenBackgroundTasks ? (
              <button type="button" className="rounded-md px-1 text-xs font-medium transition-colors hover:text-foreground" onClick={onOpenBackgroundTasks} aria-label={t('backgroundTaskOpenPanelAria')}>
                {t('backgroundTaskOpenPanel')}
              </button>
            ) : null}
          </div>
          <div className="space-y-1">
            {backgroundCommands.map((command) => (
              <div key={command.taskId} className="flex min-h-11 items-center gap-2.5 px-1.5">
                {/* 行主体是按钮、停止是兄弟按钮：整行可点时不再单独渲染「查看」入口。 */}
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left transition-colors"
                  onClick={onOpenBackgroundTasks}
                  disabled={!onOpenBackgroundTasks}
                  aria-label={t('backgroundTaskOpenAria', { command: command.command })}
                >
                  <SquareTerminal className="size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{command.description || t('backgroundCommandLabel')}</span>
                    <span className="block truncate text-xs text-muted-foreground">{command.command}</span>
                  </span>
                </button>
                <button type="button" className="quickforge-background-command-stop" aria-label={t('backgroundCommandStopAria', { command: command.command })} onClick={() => onStopBackgroundCommand?.(command)}>{t('backgroundCommandStop')}</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {runningSubagentRuns.length > 0 || finishedSubagentRuns.length > 0 ? (
        <section className={cn((hasGoalSection || hasGitSection || todos.length > 0) && 'mt-3 border-t-[0.5px] border-[color-mix(in_oklab,var(--border)_28%,transparent)] pt-3')} aria-labelledby="pinned-subagents-title">
          <div id="pinned-subagents-title" className="mb-2 flex items-center justify-between gap-3 pr-8 text-xs font-medium text-muted-foreground">
            <span>{t('pinnedSubagentsTitle')}</span>
          </div>
          {runningSubagentRuns.length > 0 ? (
            <div className="mb-2">
              <div className="mb-1 px-1.5 text-[11px]">{t('pinnedSubagentsRunningSection')}</div>
              <div className="space-y-1">
                {runningSubagentRuns.map((payload) => {
                  const label = payload.label || payload.name || t('subagentGeneral')
                  return (
                    <button
                      key={payload.canonicalToolCallId || payload.runId}
                      type="button"
                      className="flex min-h-11 w-full items-center gap-2.5 rounded-2xl px-1.5 text-left transition-colors"
                      onClick={() => onOpenSubagentRun(payload)}
                      aria-label={t('pinnedSubagentOpenAria', { name: label, task: payload.task })}
                    >
                      <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{label}</span>
                        <span className="block truncate text-xs text-muted-foreground">{payload.task}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
          {finishedSubagentRuns.length > 0 ? (
            <div>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg px-1.5 py-1 text-[11px] transition-colors hover:text-foreground"
                onClick={onToggleFinishedSubagentRuns}
                aria-expanded={!finishedSubagentRunsCollapsed}
              >
                <span>{t('pinnedSubagentsFinishedSection')} · {finishedSubagentRuns.length}</span>
                {finishedSubagentRunsCollapsed
                  ? <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
                  : <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />}
              </button>
              {!finishedSubagentRunsCollapsed ? (
                <div className="mt-1 space-y-1">
                  {visibleSubagentRuns.map((payload) => {
                    const duration = formatDuration(payload)
                    const label = payload.label || payload.name || t('subagentGeneral')
                    return (
                      <button
                        key={payload.canonicalToolCallId || payload.runId}
                        type="button"
                        className="flex min-h-11 w-full items-center gap-2.5 rounded-2xl px-1.5 text-left transition-colors"
                        onClick={() => onOpenSubagentRun(payload)}
                        aria-label={t('pinnedSubagentOpenAria', { name: label, task: payload.task })}
                      >
                        {payload.status === 'error'
                          ? <XCircle className="size-4 shrink-0 text-destructive" />
                          : <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{label}</span>
                          <span className="block truncate text-xs text-muted-foreground">{payload.task}</span>
                        </span>
                        {duration ? <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{duration}</span> : <Bot className="size-3.5 shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  )
}
