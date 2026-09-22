import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'


// 显示模式按用例切换（渲染器经 tool-renderers/shared 的 toolDisplayDetailed 读取）；
// 工具卡细节固定默认收起、不读设置。
const toolDisplay = vi.hoisted(() => ({ mode: 'default' as 'default' | 'detailed' }))
vi.mock('@/lib/tool-display-settings', () => ({
  getCachedToolDisplaySettings: () => ({ toolDisplayMode: toolDisplay.mode }),
}))

import { buildGoalReportHistoryViewModel as build } from '../../src/lib/goal-report-history'
import { applyAppLanguageFromSnapshot, t } from '../../src/lib/i18n'
import { GoalReportToolRenderer } from '../../src/lib/tool-renderers/goal-report-tool-renderer'

// T4：渲染器已 React 化（tool-renderers/goal-report-tool-renderer.tsx），
// 注册仍在 local-tools.ts；block 是渲染器实现源码（交互面审查锚点）。
const localToolsSource = readFileSync(new URL('../../src/lib/local-tools.ts', import.meta.url), 'utf8')
const source = readFileSync(new URL('../../src/lib/tool-renderers/goal-report-tool-renderer.tsx', import.meta.url), 'utf8')
const i18n = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
const plan = { summary: 'Ship a focused fix', criteria: [{ description: 'Tests pass' }], scope: ['Renderer only'], status: 'awaiting_confirmation' }
const result = (goal: unknown = plan) => ({ details: { type: 'goal_report_result', goal }, content: [{ type: 'text', text: 'Plan recorded. Waiting for user confirmation.' }] })

applyAppLanguageFromSnapshot('en')

// Execute the real React renderer and serialize its output (server rendering,
// no browser DOM needed; handlers are inert under renderToStaticMarkup).
function render(params: unknown, output: unknown, streaming = false, detailed = false) {
  toolDisplay.mode = detailed ? 'detailed' : 'default'
  const rendered = new GoalReportToolRenderer().render(params as Record<string, unknown> | undefined, output as Parameters<GoalReportToolRenderer['render']>[1], streaming)
  const markup = renderToStaticMarkup(rendered.content as ReactElement)
  return { rendered, markup, codeBlocks: markup.match(/class="qf-code-block\b/g) ?? [] }
}

describe('goal_report history view model', () => {
  it('reads successful plan summary, criteria and scope from result, never request', () => {
    const view = build({ action: 'plan', summary: 'unapplied input' }, result())
    expect(view).toMatchObject({ status: 'done', summaryKey: 'goalReportPlanRecorded', resultKey: 'goalReportWasWaiting', summary: plan.summary, criteria: ['Tests pass'], criteriaDetails: [{ description: 'Tests pass', status: 'pending' }], scope: plan.scope, outputText: '' })
    expect(build({ action: 'plan' }, result({ ...plan, status: 'running' })).resultKey).toBe('goalReportHistoricalResult')
  })

  it('normalizes criterion status into criteriaDetails while keeping criteria text', () => {
    const view = build({ action: 'plan' }, result({ ...plan, criteria: [
      { description: 'Passed item', status: 'passed' },
      { description: 'Failed item', status: 'failed' },
      { description: 'Review item', status: 'needs_review' },
      { description: 'Pending item', status: 'pending' },
      { description: 'Unknown status', status: 'bogus' },
      { description: 'No status' },
    ]}))
    expect(view.criteria).toEqual(['Passed item', 'Failed item', 'Review item', 'Pending item', 'Unknown status', 'No status'])
    expect(view.criteriaDetails).toEqual([
      { description: 'Passed item', status: 'passed' },
      { description: 'Failed item', status: 'failed' },
      { description: 'Review item', status: 'needs_review' },
      { description: 'Pending item', status: 'pending' },
      { description: 'Unknown status', status: 'pending' },
      { description: 'No status', status: 'pending' },
    ])
  })

  it.each([
    [undefined, false, 'called'],
    [result(), true, 'running'],
    [{ ...result(), isError: true }, false, 'error'],
    [{ ...result(), isError: true }, true, 'error'],
    [{ details: { ...result().details, aborted: true } }, false, 'error'],
    [{ details: { ...result().details, timedOut: true } }, false, 'error'],
  ])('does not claim success for pending/failed calls (%s)', (output, streaming, status) => {
    const view = build({ action: 'plan', ...plan }, output, streaming)
    expect(view.status).toBe(status)
    expect(view.summaryKey).not.toBe('goalReportPlanRecorded')
    expect(view.summary).toBe('')
    expect(view.criteria).toEqual([])
    expect(view.resultKey).toBe('goalReportNoResult')
  })

  it.each([null, [], 'bad', {}, { details: null }, { details: { type: 'other', goal: plan } }, result({ summary: 3, criteria: [null, {}, 'bad'], scope: [5, null] }), { content: [null, {}, { type: 'text', text: 3 }] }])('handles malformed/legacy result without inventing a plan (%s)', (output) => {
    const view = build({ action: 'plan', ...plan }, output)
    expect(view.summaryKey).not.toBe('goalReportPlanRecorded')
    expect(view.criteria).toEqual([])
  })

  it.each(['progress', 'blocked', 'needs_review', 'complete', 'unknown', '__proto__', 'constructor', ''])('keeps %s a report, not Goal completion or current status', (action) => {
    const view = build({ action }, result({ ...plan, blocker: 'Dependency unavailable' }))
    expect(view.summaryKey).toBe('goalReportTitle')
    expect(view.resultKey).toBe('goalReportHistoricalResult')
    expect(view.blocker).toBe('Dependency unavailable')
    expect(typeof view.actionKey).toBe('string')
  })

  it('preserves legacy prose, omits raw JSON from the default view', () => {
    expect(build({ action: 'plan' }, { content: [{ type: 'text', text: 'Legacy report' }] }).outputText).toBe('Legacy report')
    expect(build({}, { content: [{ type: 'text', text: '{"raw":true}' }] }).outputText).toBe('')
  })

  it('localizes machine goal_report errors and passes unknown or missing codes through', () => {
    applyAppLanguageFromSnapshot('en')
    const rejected = {
      isError: true,
      details: { type: 'goal_report_error', code: 'GOAL_REPORT_NO_GOAL' },
      content: [{ type: 'text', text: 'There is no active goal in this session.' }],
    }
    // A known machine code replaces the server's English sentence.
    expect(build({ action: 'complete' }, rejected).outputText).toBe(t('goalReportErrorNoGoal'))
    expect(build({ action: 'complete' }, rejected).outputText)
      .toBe('There is no active goal in this session.')

    // Missing or unknown codes (legacy data, aborted/timed-out calls) pass through.
    const unknownCode = {
      isError: true,
      details: { type: 'goal_report_error', code: 'GOAL_REPORT_LEGACY' },
      content: [{ type: 'text', text: 'Legacy English reason' }],
    }
    expect(build({ action: 'complete' }, unknownCode).outputText).toBe('Legacy English reason')
    const aborted = {
      isError: true,
      details: { type: 'goal_report_error', aborted: true },
      content: [{ type: 'text', text: 'Call was aborted' }],
    }
    expect(build({ action: 'complete' }, aborted).outputText).toBe('Call was aborted')

    // The localized copy follows the app language, not the server text.
    applyAppLanguageFromSnapshot('zh')
    expect(build({ action: 'complete' }, rejected).outputText).toBe('本会话没有进行中的目标。')
    applyAppLanguageFromSnapshot('en')
  })
})

describe('goal_report registered renderer', () => {
  it('registers a custom renderer with shared shell, status, and collapsed-by-default structured content', () => {
    expect(localToolsSource).toContain("registerToolRenderer('goal_report', new GoalReportToolRenderer())")
    const view = render({ action: 'plan' }, result())
    expect(view.rendered.isCustom).toBe(true)
    expect(view.markup).toContain('quickforge-local-tool-shell')
    expect(view.markup).toContain('quickforge-tool-summary')
    // default collapsed, same as other tools: React omits the open attribute
    expect(view.markup).toContain('<details class="group/tool quickforge-local-tool quickforge-goal-report-tool"')
    expect(view.markup).not.toContain('open=')
    expect(view.markup).toContain(t('goalReportWasWaiting'))
    expect(view.markup).toContain('Tests pass')
    expect(view.markup).toContain('Renderer only')
    expect(view.markup).not.toContain('data-tone=')
    expect(view.markup).toContain('<circle cx="10" cy="14" r="8"></circle>')
    expect(view.markup).toContain('<path d="M21 3 10 14"></path>')
    expect(view.markup).toContain('quickforge-goal-report-criterion-icon shrink-0')
    expect(view.markup).toContain('quickforge-goal-report-scope-chip')
    expect(view.codeBlocks).toEqual([])
    expect(view.markup).not.toContain('<button')
    expect(source).not.toMatch(/updateGoal|dispatchEvent|unsafeHTML|innerHTML|onClick/)
  })

  it('renders status-aware criterion icons and blocker accent', () => {
    const view = render({ action: 'blocked' }, result({ ...plan, blocker: 'Dependency unavailable', criteria: [
      { description: 'Passed', status: 'passed' },
      { description: 'Failed', status: 'failed' },
      { description: 'Review', status: 'needs_review' },
      { description: 'Pending', status: 'bogus' },
    ]}))
    expect(view.markup).toContain('d="m8 12 2.5 2.5L16 9"')
    expect(view.markup).toContain('M15 9l-6 6')
    expect(view.markup).toContain('M12 8v4')
    expect(view.markup).toContain('<circle cx="12" cy="12" r="9"></circle>')
    expect(view.markup).toContain('data-status="passed"')
    expect(view.markup).toContain('data-status="failed"')
    expect(view.markup).toContain('data-status="needs_review"')
    expect(view.markup).toContain('data-status="pending"')
    expect(view.markup).toContain('quickforge-goal-report-blocker')
    expect(view.markup).toContain('Dependency unavailable')
  })

  it.each([
    [undefined, false, 'called', 'goalReportTitle'],
    [result(), true, 'running', 'goalReportRunning'],
    [{ isError: true, content: [{ type: 'text', text: 'Plan rejected' }] }, false, 'error', 'goalReportFailed'],
  ])('renders pending/error status without a generated-plan title (%s)', (output, streaming, status, title) => {
    const view = render({ action: 'plan' }, output, streaming)
    // 状态图标 aria-label 携带状态词条，标题使用中性 goal_report 文案
    expect(view.markup).toContain(`aria-label="${t(status as 'called' | 'running' | 'error')}"`)
    expect(view.markup).toContain(t(title as 'goalReportTitle'))
    expect(view.markup).not.toContain(t('goalReportPlanRecorded'))
    expect(view.markup).not.toContain(t('goalReportWasWaiting'))
    expect(view.markup).not.toContain('Plan recorded. Waiting for user confirmation.')
  })

  it('limits raw input/details/output JSON to detailed mode', () => {
    const view = render({ action: 'plan', raw: 'request' }, result(), false, true)
    expect(view.codeBlocks).toHaveLength(3)
    expect(view.markup).toContain('goal_report_result')
    expect(view.markup).toContain('request')
    expect(view.markup).toContain('Plan recorded.')
  })

  it('keeps its details collapsed by default even in detailed mode', () => {
    // 细节固定默认收起、不随设置变化；detailed 模式也只控制内容渲染，不默认展开。
    expect(render({ action: 'plan' }, result()).markup).not.toContain('open=')
    expect(render({ action: 'plan' }, result(), false, true).markup).not.toContain('open=')
  })

  it('binds untrusted HTML as text, with wrap-safe layout rather than HTML parsing', () => {
    const unsafe = '<img src=x onerror=alert(1)>' + 'x'.repeat(10000)
    const view = render({ action: 'plan' }, result({ ...plan, summary: unsafe, criteria: [{ description: unsafe }], scope: [unsafe] }))
    expect(view.markup).not.toContain('<img')
    expect(view.markup).toContain('&lt;img')
    expect(view.markup).toContain('[overflow-wrap:anywhere]')
    expect(view.markup).toContain('min-w-0 [overflow-wrap:anywhere]')
    expect(view.markup).toContain('whitespace-pre-wrap')
  })

  it('provides paired translations for every report label', () => {
    const keys = [...i18n.matchAll(/\b(goalReport\w+):/g)].map((match) => match[1])
    expect(new Set(keys).size).toBe(28)
    for (const key of new Set(keys)) expect(keys.filter((item) => item === key)).toHaveLength(2)
    expect(i18n).toContain("goalReportErrorNoGoal: 'There is no active goal in this session.'")
    expect(i18n).toContain("goalReportErrorNoGoal: '本会话没有进行中的目标。'")
  })
})

describe('goal_report tool card message font contract', () => {
  const indexCss = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
  const summaryBlock = indexCss.slice(
    indexCss.indexOf('.quickforge-local-tool > .quickforge-tool-summary,'),
    indexCss.indexOf('.quickforge-tool-title,'),
  )
  const bodyBlock = indexCss.slice(
    indexCss.indexOf('.quickforge-goal-report-tool-body'),
    indexCss.indexOf('.quickforge-goal-report-criteria'),
  )

  it('scales the tool summary line with the message font size (×0.875), not the interface rem base', () => {
    expect(summaryBlock).toContain('font-size: calc(var(--quickforge-message-font-size, 14px) * 0.875)')
    expect(summaryBlock).toContain('line-height: 1.5')
    expect(summaryBlock).not.toContain('font-size: 0.875rem')
  })

  it('aligns the card body text with the message font size and line height', () => {
    expect(bodyBlock).toContain('font-size: var(--quickforge-message-font-size, 14px)')
    expect(bodyBlock).toContain('line-height: var(--quickforge-message-line-height, 1.625)')
  })

  it('frames the expanded body content with the shared code-block border recipe', () => {
    expect(bodyBlock).toContain('border: 1px solid var(--border)')
    expect(bodyBlock).toContain('border-radius: var(--radius)')
    expect(bodyBlock).toContain('padding: 0.625rem 0.875rem')
    expect(bodyBlock).not.toContain('box-shadow')
    expect(bodyBlock).not.toContain('background:')
  })

  it('keeps section labels and scope chips on the message font scale (×0.8); chip stays mono', () => {
    expect(indexCss).toMatch(
      /\.quickforge-goal-report-tool-body \.text-xs,[\s\S]*?\.quickforge-todo-history-tool > div \.text-xs \{[\s\S]*?font-size: calc\(var\(--quickforge-message-font-size, 14px\) \* 0\.8\);/,
    )
    const chipBlock = indexCss.slice(
      indexCss.indexOf('.quickforge-goal-report-scope-chip'),
      indexCss.indexOf('.quickforge-goal-report-blocker'),
    )
    expect(chipBlock).toContain('font-family: var(--font-mono)')
    expect(chipBlock).toContain('font-size: calc(var(--quickforge-message-font-size, 14px) * 0.8)')
    expect(chipBlock).not.toContain('0.7rem')
  })
})
