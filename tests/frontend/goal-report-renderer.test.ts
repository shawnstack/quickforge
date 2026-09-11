import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildGoalReportHistoryViewModel as build } from '../../src/lib/goal-report-history'

const source = readFileSync(new URL('../../src/lib/local-tools.ts', import.meta.url), 'utf8')
const block = source.slice(source.indexOf('class GoalReportToolRenderer'), source.indexOf('class TodoWriteToolRenderer'))
const i18n = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
const plan = { summary: 'Ship a focused fix', criteria: [{ description: 'Tests pass' }], scope: ['Renderer only'], status: 'awaiting_confirmation' }
const result = (goal: unknown = plan) => ({ details: { type: 'goal_report_result', goal }, content: [{ type: 'text', text: 'Plan recorded. Waiting for user confirmation.' }] })

// Execute the real renderer class with inert template captures (not a browser DOM).
function render(params: unknown, output: unknown, streaming = false, detailed = false) {
  const templates: string[] = []
  const values: unknown[] = []
  const codeBlocks: string[] = []
  const html = (strings: TemplateStringsArray, ...bindings: unknown[]) => {
    templates.push(strings.join(''))
    values.push(...bindings)
    if (strings.join('').includes('<code-block')) codeBlocks.push(String(bindings[1]))
    return { strings, bindings }
  }
  const Renderer = runInNewContext(ts.transpileModule(`${block}\nGoalReportToolRenderer`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    buildGoalReportHistoryViewModel: build, extractQuickForgeTiming: () => undefined,
    getCachedToolDisplaySettings: () => ({ toolDisplayMode: detailed ? 'detailed' : 'default' }),
    stringifyValue: (value: unknown) => value == null ? '' : JSON.stringify(value),
    toolDetailsStateKey: () => 'key', toolDetailsOpen: new Map(), rememberToolDetailsOpen: () => {},
    html, nothing: null, t: (key: string) => key, renderToolIcon: () => null,
    renderStatus: (status: string) => status,
  })
  const rendered = new Renderer().render(params, output, streaming)
  return { rendered, templates: templates.join('\n'), values, codeBlocks }
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
})

describe('goal_report registered renderer', () => {
  it('registers a custom renderer with shared shell, status, and default structured content', () => {
    expect(source).toContain("registerToolRenderer('goal_report', new GoalReportToolRenderer())")
    const view = render({ action: 'plan' }, result())
    expect(view.rendered.isCustom).toBe(true)
    expect(view.templates).toContain('quickforge-local-tool-shell')
    expect(view.templates).toContain('quickforge-tool-summary')
    expect(view.values).toContain(true) // default open, criteria visible
    expect(view.values).toContain('goalReportWasWaiting')
    expect(view.values).toContain('Tests pass')
    expect(view.values).toContain('Renderer only')
    expect(view.templates).toContain('quickforge-goal-report-tool')
    expect(view.templates).toContain('data-tone=')
    expect(view.values).toContain('info')
    expect(view.templates).toContain('<circle cx="10" cy="14" r="8"/>')
    expect(view.templates).toContain('<path d="M21 3 10 14"/>')
    expect(view.values).toContain('quickforge-goal-report-criterion-icon shrink-0')
    expect(view.templates).toContain('quickforge-goal-report-scope-chip')
    expect(view.codeBlocks).toEqual([])
    expect(view.templates).not.toContain('<button')
    expect(block).not.toMatch(/updateGoal|dispatchEvent|unsafeHTML|innerHTML|@click/)
  })

  it('renders tone card with status-aware criterion icons and blocker accent', () => {
    const view = render({ action: 'blocked' }, result({ ...plan, blocker: 'Dependency unavailable', criteria: [
      { description: 'Passed', status: 'passed' },
      { description: 'Failed', status: 'failed' },
      { description: 'Review', status: 'needs_review' },
      { description: 'Pending', status: 'bogus' },
    ]}))
    expect(view.values).toContain('warning')
    expect(view.templates).toContain('d="m8 12 2.5 2.5L16 9"')
    expect(view.templates).toContain('M15 9l-6 6')
    expect(view.templates).toContain('M12 8v4')
    expect(view.templates).toContain('<circle cx="12" cy="12" r="9"/>')
    expect(view.values).toContain('passed')
    expect(view.values).toContain('failed')
    expect(view.values).toContain('needs_review')
    expect(view.values).toContain('pending')
    expect(view.templates).toContain('quickforge-goal-report-blocker')
    expect(view.values).toContain('Dependency unavailable')
  })

  it.each([
    [undefined, false, 'called', 'goalReportTitle'],
    [result(), true, 'running', 'goalReportRunning'],
    [{ isError: true, content: [{ type: 'text', text: 'Plan rejected' }] }, false, 'error', 'goalReportFailed'],
  ])('renders pending/error status without a generated-plan title (%s)', (output, streaming, status, title) => {
    const view = render({ action: 'plan' }, output, streaming)
    expect(view.values).toContain(status)
    expect(view.values).toContain(title)
    expect(view.values).not.toContain('goalReportPlanRecorded')
    expect(view.values).not.toContain('goalReportWasWaiting')
    expect(view.values).not.toContain('Plan recorded. Waiting for user confirmation.')
  })

  it('reserves an empty action mount without wiring a global agent or historical handler', () => {
    const view = render({ action: 'plan' }, result())
    expect(view.templates).toContain('<div data-quickforge-goal-plan-action></div>')
    expect(view.templates).not.toContain('@click')
  })

  it('limits raw input/details/output JSON to detailed mode', () => {
    const view = render({ action: 'plan', raw: 'request' }, result(), false, true)
    expect(view.codeBlocks).toHaveLength(3)
    expect(view.codeBlocks.join('\n')).toContain('goal_report_result')
    expect(view.codeBlocks.join('\n')).toContain('request')
    expect(view.codeBlocks.join('\n')).toContain('Plan recorded.')
  })

  it('binds untrusted HTML as Lit text, with wrap-safe layout rather than HTML parsing', () => {
    const unsafe = '<img src=x onerror=alert(1)>' + 'x'.repeat(10000)
    const view = render({ action: 'plan' }, result({ ...plan, summary: unsafe, criteria: [{ description: unsafe }], scope: [unsafe] }))
    expect(view.values.filter((v) => v === unsafe)).toHaveLength(3)
    expect(view.templates).not.toContain('<img')
    expect(view.templates).toContain('[overflow-wrap:anywhere]')
    expect(view.templates).toContain('min-w-0 [overflow-wrap:anywhere]')
    expect(view.templates).toContain('class="whitespace-pre-wrap"')
  })

  it('provides paired translations for every report label', () => {
    const keys = [...i18n.matchAll(/\b(goalReport\w+):/g)].map((match) => match[1])
    expect(new Set(keys).size).toBe(13)
    for (const key of new Set(keys)) expect(keys.filter((item) => item === key)).toHaveLength(2)
  })
})
