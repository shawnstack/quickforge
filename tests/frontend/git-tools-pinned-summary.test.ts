import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const summarySource = readFileSync(new URL('../../src/components/git/GitToolsPinnedSummary.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')

describe('GitToolsPinnedSummary source contract', () => {
  it('mounts for any of tasks, terminal subagents, or Git and keeps Inspector hiding', () => {
    expect(appSource).toContain('!workspaceInspectorOpen && (')
    expect(appSource).toContain('pinnedSummaryTodos.length > 0')
    expect(appSource).toContain('pinnedSummarySubagentRuns.length > 0')
    expect(appSource).toContain('titleGitStatus?.isGitRepository')
    expect(summarySource).toContain('if (todos.length === 0 && finishedSubagentRuns.length === 0 && !hasGitSection) return null')
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

  it('renders actual groups in Git, Todo, then finished Subagent order', () => {
    const git = summarySource.indexOf('aria-labelledby="pinned-environment-title"')
    const todo = summarySource.indexOf('aria-labelledby="pinned-tasks-title"')
    const subagent = summarySource.indexOf('aria-labelledby="pinned-subagents-title"')
    expect(git).toBeGreaterThan(-1)
    expect(todo).toBeGreaterThan(git)
    expect(subagent).toBeGreaterThan(todo)
    expect(summarySource).toContain("{t('gitToolsTitle')}")
    expect(summarySource).toContain('gap-3 pr-8 text-xs')
    expect(summarySource).toContain("<span>{t('pinnedRecentFirst')}</span>")
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
      'pinnedRecentFirst',
      'pinnedViewAllTasks',
      'pinnedCollapseTasks',
      'pinnedSubagentOpenAria',
      'gitToolsTitle',
    ]) {
      expect(i18nSource.match(new RegExp(`${key}:`, 'g'))).toHaveLength(2)
    }
    for (const removedKey of ['pinnedSummaryTitle', 'pinnedSummaryDescription', 'environmentInfo']) {
      expect(i18nSource).not.toContain(`${removedKey}:`)
    }
    expect(i18nSource.match(/gitToolsTitle: 'Git'/g)).toHaveLength(2)
  })
})
