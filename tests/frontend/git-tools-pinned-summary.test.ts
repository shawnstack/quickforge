import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const summarySource = readFileSync(new URL('../../src/components/git/GitToolsPinnedSummary.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')

describe('GitToolsPinnedSummary source contract', () => {
  it('mounts for any of tasks, running or terminal subagents, or Git and keeps Inspector hiding', () => {
    expect(appSource).toContain('!workspaceInspectorOpen && (')
    expect(appSource).toContain('pinnedSummaryTodos.length > 0')
    expect(appSource).toContain('pinnedSummarySubagentRuns.length > 0')
    expect(appSource).toContain('pinnedSummaryRunningSubagentRuns.length > 0')
    expect(appSource).toContain('titleGitStatus?.isGitRepository')
    expect(summarySource).toContain('if (todos.length === 0 && runningSubagentRuns.length === 0 && finishedSubagentRuns.length === 0 && !hasGitSection) return null')
    expect(summarySource).toContain('status?.isGitRepository && projectId')
  })

  it('defaults tasks to three and supports view all/collapse', () => {
    expect(summarySource).toContain('todos.slice(0, 3)')
    expect(summarySource).toContain("t('pinnedViewAllTasks'")
    expect(summarySource).toContain("t('pinnedCollapseTasks')")
    expect(summarySource).toContain('setExpandedTasksSignature(showAllTasks ? undefined : todoSignature)')
  })

  it('opens terminal subagents only after closing the summary', () => {
    const callback = appSource.indexOf('onOpenSubagentRun={(payload) => {')
    const close = appSource.indexOf('setGitToolsExpanded(false)', callback)
    const open = appSource.indexOf('openSubagentRun(payload)', callback)
    expect(callback).toBeGreaterThan(-1)
    expect(close).toBeGreaterThan(callback)
    expect(open).toBeGreaterThan(close)
    expect(summarySource).toContain('onClick={() => onOpenSubagentRun(payload)}')
  })

  it('subscribes to only relevant current-agent events and recomputes snapshots', () => {
    expect(appSource).toContain('return agent.subscribe((event) => {')
    for (const event of ['tool_execution_start', 'tool_execution_update', 'tool_execution_end', 'message_end', 'messages_replaced', 'agent_end']) {
      expect(appSource).toContain(`'${event}'`)
    }
    expect(appSource).toContain('extractLatestTodoWriteSnapshot(pinnedSummaryMessages)')
    expect(appSource).toContain('extractLatestTerminalSubagentRuns(')
  })

  it('removes the overall heading and description while keeping an absolute close button', () => {
    expect(summarySource).not.toContain("t('pinnedSummaryTitle')")
    expect(summarySource).not.toContain("t('pinnedSummaryDescription')")
    expect(summarySource).toContain('className="absolute right-3 top-3 z-10')
    expect(summarySource).toContain("aria-label={t('pinnedSummaryCollapse')}")
    expect(summarySource).toContain('<X className="size-4" />')
  })

  it('renders actual groups in Git, Todo, then Subagent order with running before finished', () => {
    const git = summarySource.indexOf('aria-labelledby="pinned-environment-title"')
    const todo = summarySource.indexOf('aria-labelledby="pinned-tasks-title"')
    const subagent = summarySource.indexOf('aria-labelledby="pinned-subagents-title"')
    const running = summarySource.indexOf("t('pinnedSubagentsRunningSection')")
    const finished = summarySource.indexOf("t('pinnedSubagentsFinishedSection')")
    expect(git).toBeGreaterThan(-1)
    expect(todo).toBeGreaterThan(git)
    expect(subagent).toBeGreaterThan(todo)
    expect(running).toBeGreaterThan(subagent)
    expect(finished).toBeGreaterThan(running)
    expect(summarySource).toContain("{t('gitToolsTitle')}")
    expect(summarySource).toContain('gap-3 pr-8 text-xs')
  })

  it('collapses the finished section by default behind a full-row chevron toggle and resets on reopen', () => {
    expect(summarySource).toContain('useState(true)')
    expect(summarySource).toContain('setFinishedSubagentRunsCollapsed((value) => !value)')
    expect(summarySource).toContain('aria-expanded={!finishedSubagentRunsCollapsed}')
    expect(summarySource).toContain("<ChevronRight className=\"size-3.5 shrink-0 text-muted-foreground/85\"")
    expect(summarySource).toContain("<ChevronDown className=\"size-3.5 shrink-0 text-muted-foreground/85\"")
    expect(summarySource).toContain('!finishedSubagentRunsCollapsed ? (')
    expect(summarySource).toContain("t('pinnedSubagentsFinishedSection')} · {finishedSubagentRuns.length}")
    expect(summarySource).not.toContain("t('pinnedRecentFirst')")
    // 关闭弹层的三条路径（外部点击/Escape、toggle、X）都恢复默认折叠。
    expect(summarySource.match(/setFinishedSubagentRunsCollapsed\(true\)/g)).toHaveLength(3)
  })

  it('shows running rows with a muted spinner and feeds both lists from App', () => {
    expect(summarySource).toContain("<Loader2 className=\"size-4 shrink-0 animate-spin text-muted-foreground/65\"")
    expect(summarySource).toContain("t('pinnedSubagentsRunningSection')")
    expect(appSource).toContain('runningSubagentRuns={pinnedSummaryRunningSubagentRuns}')
    expect(appSource).toContain('extractRunningSubagentRuns(')
  })

  it('uses no divider on the first actual group and shallow compact dividers afterwards', () => {
    expect(summarySource).toContain('<section aria-labelledby="pinned-environment-title">')
    expect(summarySource).toContain("className={cn(hasGitSection && 'mt-3 border-t-[0.5px] border-[color-mix(in_oklab,var(--border)_28%,transparent)] pt-3')}")
    expect(summarySource).toContain("className={cn((hasGitSection || todos.length > 0) && 'mt-3 border-t-[0.5px] border-[color-mix(in_oklab,var(--border)_28%,transparent)] pt-3')}")
    expect(summarySource).not.toContain('border-border/55')
  })

  it('keeps responsive popover behavior and pairs the mobile branch menu top with max height', () => {
    expect(summarySource).toContain('fixed inset-x-2 top-14')
    expect(summarySource).toContain('md:absolute')
    expect(summarySource).toContain('md:max-h-none')
    expect(summarySource).toContain('md:overflow-visible')
    expect(summarySource).toContain('md:w-[min(20.5rem,calc(100vw-1rem))]')
    expect(summarySource).toContain('rounded-3xl')
    expect(summarySource).toContain('shadow-quickforge')
    expect(summarySource.match(/top-\[9\.25rem\]/g)).toHaveLength(3)
    expect(summarySource.match(/max-h-\[calc\(100dvh-9\.75rem\)\]/g)).toHaveLength(2)
  })

  it('defines matching remaining summary keys and uses Git in both languages', () => {
    for (const key of [
      'pinnedSummaryCollapse',
      'pinnedTasksTitle',
      'pinnedSubagentsTitle',
      'pinnedSubagentsRunningSection',
      'pinnedSubagentsFinishedSection',
      'pinnedViewAllTasks',
      'pinnedCollapseTasks',
      'pinnedSubagentOpenAria',
      'gitToolsTitle',
    ]) {
      expect(i18nSource.match(new RegExp(`${key}:`, 'g'))).toHaveLength(2)
    }
    for (const removedKey of ['pinnedSummaryTitle', 'pinnedSummaryDescription', 'environmentInfo', 'pinnedRecentFirst']) {
      expect(i18nSource).not.toContain(`${removedKey}:`)
    }
    expect(i18nSource.match(/gitToolsTitle: 'Git Tools'/g)).toHaveLength(1)
    expect(i18nSource.match(/gitToolsTitle: 'Git 工具'/g)).toHaveLength(1)
    expect(i18nSource.match(/pinnedSubagentsTitle: 'Agents'/g)).toHaveLength(1)
    expect(i18nSource.match(/pinnedSubagentsTitle: '智能体'/g)).toHaveLength(1)
  })
})
