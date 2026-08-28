import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  FileDiff,
  GitBranch,
  List,
  SlidersHorizontal,
  X,
  XCircle,
} from 'lucide-react'
import { GitBranchMenu } from '@/components/git/GitBranchMenu'
import type { TodoWriteItem, TodoWriteStatus } from '@/components/chat/panel-decoration'
import type { SubagentRunPayload } from '@/lib/subagent-run-detail'
import { todoWriteCounts } from '@/components/chat/panel-decoration'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import type { GitStatusResponse } from '@/components/workspace/workspace-types'

type GitToolsPinnedSummaryProps = {
  projectId?: string
  status?: GitStatusResponse
  todos: TodoWriteItem[]
  finishedSubagentRuns: SubagentRunPayload[]
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  onOpenSubagentRun: (payload: SubagentRunPayload) => void
  onOpenChanges: () => void
  onOpenCommitPush: () => void
  onCheckout: (branch: string) => Promise<void>
  onCreated: (status: GitStatusResponse) => void
  onOpenGraph: () => void
  mobileShell?: boolean
}

function gitTotals(status?: GitStatusResponse) {
  return (status?.files ?? []).reduce((totals, file) => {
    totals.additions += file.additions ?? 0
    totals.deletions += file.deletions ?? 0
    return totals
  }, { additions: 0, deletions: 0 })
}

function todoStatusLabel(status: TodoWriteStatus) {
  if (status === 'completed') return t('todoWriteStatusCompleted')
  if (status === 'in_progress') return t('todoWriteStatusInProgress')
  return t('todoWriteStatusPending')
}

function TodoStatusIcon({ status }: { status: TodoWriteStatus }) {
  if (status === 'completed') return <CheckCircle2 className="size-4 text-emerald-600" />
  if (status === 'in_progress') return <Clock3 className="size-4 text-amber-600" />
  return <Circle className="size-4 text-muted-foreground/65" />
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

export function GitToolsPinnedSummary({
  projectId,
  status,
  todos,
  finishedSubagentRuns,
  expanded,
  onExpandedChange,
  onOpenSubagentRun,
  onOpenChanges,
  onOpenCommitPush,
  onCheckout,
  onCreated,
  onOpenGraph,
  mobileShell = false,
}: GitToolsPinnedSummaryProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [expandedTasksSignature, setExpandedTasksSignature] = useState<string>()
  const totals = useMemo(() => gitTotals(status), [status])
  const todoCounts = useMemo(() => todoWriteCounts(todos), [todos])
  const dirtyCount = status ? (status.counts?.total ?? status.files.length) : 0
  const hasGitSection = Boolean(status?.isGitRepository && projectId)
  const todoSignature = todos.map((todo) => `${todo.status}:${todo.content}`).join('\n')
  const showAllTasks = expanded && expandedTasksSignature === todoSignature
  const visibleTodos = showAllTasks ? todos : todos.slice(0, 3)
  const visibleSubagentRuns = finishedSubagentRuns.slice(0, 3)

  useEffect(() => {
    if (!expanded) return

    function closeSummary() {
      setBranchMenuOpen(false)
      setExpandedTasksSignature(undefined)
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

  if (todos.length === 0 && finishedSubagentRuns.length === 0 && !hasGitSection) return null

  return (
    <div ref={rootRef} className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className={cn(
          'inline-flex size-9 items-center justify-center rounded-2xl bg-transparent text-muted-foreground/85 transition-colors hover:bg-muted/45 hover:text-foreground/90',
          expanded && 'bg-muted/45 text-foreground/90',
        )}
        onClick={() => {
          if (expanded) {
            setBranchMenuOpen(false)
            setExpandedTasksSignature(undefined)
          }
          onExpandedChange(!expanded)
        }}
        aria-label={t('togglePinnedSummary')}
        title={t('togglePinnedSummary')}
        aria-expanded={expanded}
      >
        <List className="size-[18px]" />
      </button>

      {expanded ? (
        <div className={cn(
          'fixed inset-x-2 top-14 z-40 max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain rounded-3xl border border-[color-mix(in_oklab,var(--border)_38%,transparent)] bg-background p-4 text-foreground shadow-quickforge md:absolute md:inset-x-auto md:-right-10 md:top-11 md:max-h-none md:w-[min(20.5rem,calc(100vw-1rem))] md:overflow-visible lg:-right-20',
          mobileShell && 'md:fixed md:inset-x-2 md:right-auto md:top-14 md:max-h-[calc(100dvh-4rem)] md:w-auto md:overflow-y-auto lg:inset-x-2 lg:right-auto lg:top-14',
        )}>
          <button type="button" className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-foreground/85 transition-colors hover:bg-muted" onClick={() => {
            setBranchMenuOpen(false)
            setExpandedTasksSignature(undefined)
            onExpandedChange(false)
          }} aria-label={t('pinnedSummaryCollapse')} title={t('pinnedSummaryCollapse')}>
            <X className="size-4" />
          </button>

          {hasGitSection && status && projectId ? (
            <section aria-labelledby="pinned-environment-title">
              <div id="pinned-environment-title" className="mb-2 pr-8 text-xs font-medium text-muted-foreground">{t('gitToolsTitle')}</div>
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
                        'fixed inset-x-2 top-[9.25rem] max-h-[calc(100dvh-9.75rem)] w-auto overflow-y-auto md:absolute md:inset-x-auto md:left-auto md:right-0 md:top-full md:mt-2 md:max-h-none md:w-[min(340px,calc(100vw-1rem))] md:overflow-hidden lg:right-full lg:top-0 lg:mr-3 lg:mt-0',
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

                <button type="button" className="flex h-11 w-full items-center gap-3 rounded-2xl px-2.5 text-left text-foreground/88 transition-colors hover:bg-muted/45 hover:text-foreground" onClick={onOpenCommitPush}>
                  <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{t('gitToolsCommitOrPush')}</span>
                </button>
              </div>
            </section>
          ) : null}

          {todos.length > 0 ? (
            <section className={cn(hasGitSection && 'mt-3 border-t-[0.5px] border-[color-mix(in_oklab,var(--border)_28%,transparent)] pt-3')} aria-labelledby="pinned-tasks-title">
              <div id="pinned-tasks-title" className="mb-2 flex items-center justify-between gap-3 pr-8 text-xs font-medium text-muted-foreground">
                <span>{t('pinnedTasksTitle')}</span>
                <span>{todoCounts.completed}/{todoCounts.total}</span>
              </div>
              <div className="space-y-1">
                {visibleTodos.map((todo, index) => (
                  <div key={`${todo.content}:${index}`} className="flex min-h-9 items-center gap-2.5 px-1.5 text-sm text-foreground/88">
                    <span className="shrink-0" aria-hidden="true"><TodoStatusIcon status={todo.status} /></span>
                    <span className={cn('min-w-0 flex-1 truncate', todo.status === 'completed' && 'text-muted-foreground line-through')}>{todo.content}</span>
                    <span className="sr-only">{todoStatusLabel(todo.status)}</span>
                  </div>
                ))}
              </div>
              {todos.length > 3 ? (
                <button type="button" className="mt-1 rounded-lg px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground" onClick={() => setExpandedTasksSignature(showAllTasks ? undefined : todoSignature)} aria-expanded={showAllTasks}>
                  {showAllTasks ? t('pinnedCollapseTasks') : t('pinnedViewAllTasks', { count: todos.length })}
                </button>
              ) : null}
            </section>
          ) : null}

          {visibleSubagentRuns.length > 0 ? (
            <section className={cn((hasGitSection || todos.length > 0) && 'mt-3 border-t-[0.5px] border-[color-mix(in_oklab,var(--border)_28%,transparent)] pt-3')} aria-labelledby="pinned-subagents-title">
              <div id="pinned-subagents-title" className="mb-2 flex items-center justify-between gap-3 pr-8 text-xs font-medium text-muted-foreground">
                <span>{t('pinnedSubagentsTitle')}</span>
                <span>{t('pinnedRecentFirst')}</span>
              </div>
              <div className="space-y-1">
                {visibleSubagentRuns.map((payload) => {
                  const duration = formatDuration(payload)
                  const label = payload.label || payload.name || t('subagentGeneral')
                  return (
                    <button
                      key={payload.canonicalToolCallId || payload.runId}
                      type="button"
                      className="flex min-h-11 w-full items-center gap-2.5 rounded-2xl px-1.5 text-left transition-colors hover:bg-muted/45"
                      onClick={() => onOpenSubagentRun(payload)}
                      aria-label={t('pinnedSubagentOpenAria', { name: label, task: payload.task })}
                    >
                      {payload.status === 'error'
                        ? <XCircle className="size-4 shrink-0 text-destructive" />
                        : <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground/88">{label}</span>
                        <span className="block truncate text-xs text-muted-foreground">{payload.task}</span>
                      </span>
                      {duration ? <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{duration}</span> : <Bot className="size-3.5 shrink-0 text-muted-foreground/65" />}
                    </button>
                  )
                })}
              </div>
            </section>
          ) : null}

        </div>
      ) : null}
    </div>
  )
}
