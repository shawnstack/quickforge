import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { createElement } from 'react'
import { appCss } from '../helpers/app-css'

const toolDisplay = vi.hoisted(() => ({ mode: 'default' as 'default' | 'detailed' }))
vi.mock('@/lib/tool-display-settings', () => ({
  getCachedToolDisplaySettings: () => ({ toolDisplayMode: toolDisplay.mode }),
}))

import { applyAppLanguageFromSnapshot, t } from '../../src/lib/i18n'
import {
  buildWorkflowRunView,
  workflowActiveStepLabels,
  workflowCurrentPhase,
  workflowPhaseSteps,
  workflowStatusLabelKey,
  workflowSummaryText,
  workflowTimeline,
} from '../../src/lib/workflow-run-detail'
import {
  buildWorkflowRunPayload,
  normalizeOpenWorkflowRunRequest,
  shouldPublishWorkflowRunPayload,
  WorkflowRunStore,
} from '../../src/lib/workflow-run-payload'
import { WorkflowToolRenderer } from '../../src/lib/tool-renderers/workflow-tool-renderer'
import { buildWorkflowSubagentRunPayload } from '../../src/lib/workflow-subagent-detail'
import { WorkflowRunDetailContent } from '../../src/components/workspace/WorkflowRunDetailContent'

const source = readFileSync(new URL('../../src/lib/tool-renderers/workflow-tool-renderer.tsx', import.meta.url), 'utf8')
const viewSource = readFileSync(new URL('../../src/lib/workflow-run-detail.ts', import.meta.url), 'utf8')
const payloadSource = readFileSync(new URL('../../src/lib/workflow-run-payload.ts', import.meta.url), 'utf8')
const detailSource = readFileSync(new URL('../../src/components/workspace/WorkflowRunDetailContent.tsx', import.meta.url), 'utf8')
const tabSource = readFileSync(new URL('../../src/components/workspace/workspace-inspector-tabs.ts', import.meta.url), 'utf8')
const localTools = readFileSync(new URL('../../src/lib/local-tools.ts', import.meta.url), 'utf8')
const shared = readFileSync(new URL('../../src/lib/tool-renderers/shared.tsx', import.meta.url), 'utf8')
const index = readFileSync(new URL('../../src/lib/tool-renderers/index.ts', import.meta.url), 'utf8')
const titleRefresh = readFileSync(new URL('../../src/lib/title-git-status-refresh.ts', import.meta.url), 'utf8')
const approvalCard = readFileSync(new URL('../../src/components/chat/panel-decoration/approval-card.ts', import.meta.url), 'utf8')
const css = appCss
const i18n = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')

applyAppLanguageFromSnapshot('en')

const runningDetails = {
  workflow: true,
  runId: 'tool-1',
  status: 'running',
  startedAt: 1_000,
  durationMs: 4200,
  maxAgents: 8,
  maxTools: 64,
  concurrency: 2,
  maxRuntimeMs: 3_600_000,
  phases: [
    { title: 'Scan', startedAt: 1 },
    { title: 'Fix', startedAt: 2 },
  ],
  agents: [
    { id: 'agent-1', seq: 1, label: 'Scan src', profile: 'explore', phase: 'Scan', status: 'done', startedAt: 1_000, durationMs: 1200, toolCalls: 3, promptPreview: 'scan the source', resultPreview: 'found 2 files' },
    { id: 'agent-2', seq: 3, label: 'Fix bug', profile: 'general', phase: 'Fix', status: 'running', startedAt: 2_200, durationMs: 3000, toolCalls: 1, promptPreview: 'fix the bug' },
    { id: 'agent-3', seq: 5, label: 'Review', profile: 'explore', phase: 'Fix', status: 'queued', promptPreview: 'review the fix' },
  ],
  tools: [
    { id: 'tool-1', seq: 2, name: 'read_file', label: 'read src', phase: 'Scan', status: 'done', startedAt: 1_200, durationMs: 500, args: { path: 'src/a.ts' }, resultPreview: 'file content' },
    { id: 'tool-2', seq: 4, name: 'write_file', label: 'write fix', phase: 'Fix', status: 'running', startedAt: 2_600, durationMs: 2000, args: { path: 'src/b.ts' }, resultPreview: '' },
  ],
  logs: [
    { at: 1, phase: 'Scan', message: 'scanning files', level: 'info' },
    { at: 2, phase: 'Fix', message: 'first attempt failed', level: 'error' },
  ],
}

/** 纯串行样本：每步首尾相接，用于断言时间轴不虚构并行。 */
const serialDetails = {
  workflow: true,
  runId: 'serial-1',
  status: 'done',
  startedAt: 5_000,
  durationMs: 3_000,
  phases: [{ title: 'Only' }],
  agents: [
    { id: 'a1', seq: 1, label: 'first', profile: 'general', phase: 'Only', status: 'done', startedAt: 5_000, durationMs: 1_000 },
    { id: 'a2', seq: 2, label: 'second', profile: 'general', phase: 'Only', status: 'done', startedAt: 6_000, durationMs: 2_000 },
  ],
  tools: [],
  logs: [],
}

/** 并行样本：两个 Agent 起点相同，用于断言并发峰值与并行标注。 */
const parallelDetails = {
  workflow: true,
  runId: 'parallel-1',
  status: 'done',
  startedAt: 9_000,
  durationMs: 2_000,
  phases: [{ title: 'Fan' }],
  agents: [
    { id: 'p1', seq: 1, label: 'left', profile: 'general', phase: 'Fan', status: 'done', startedAt: 9_000, durationMs: 2_000 },
    { id: 'p2', seq: 2, label: 'right', profile: 'general', phase: 'Fan', status: 'done', startedAt: 9_000, durationMs: 1_000 },
  ],
  tools: [],
  logs: [],
}

function render(params: unknown, details: unknown, streaming = false, detailed = false) {
  toolDisplay.mode = detailed ? 'detailed' : 'default'
  const rendered = new WorkflowToolRenderer().render(
    params as Record<string, unknown> | undefined,
    { details } as Parameters<WorkflowToolRenderer['render']>[1],
    streaming,
  )
  return { rendered, markup: renderToStaticMarkup(rendered.content as ReactElement) }
}

describe('workflow run view model', () => {
  it('groups agents and logs by phase and counts statuses', () => {
    const view = buildWorkflowRunView({ details: runningDetails }, true)
    expect(view).not.toBeNull()
    expect(view).toMatchObject({
      runId: 'tool-1',
      status: 'running',
      runStartedAt: 1_000,
      maxAgents: 8,
      maxTools: 64,
      concurrency: 2,
      agentCount: 3,
      completedAgentCount: 1,
      failedAgentCount: 0,
      runningAgentCount: 2,
      toolCount: 2,
      failedToolCount: 0,
      timedOut: false,
      aborted: false,
    })
    expect(view?.phases.map((phase) => phase.title)).toEqual(['Scan', 'Fix'])
    expect(view?.phases[0].agents.map((agent) => agent.label)).toEqual(['Scan src'])
    expect(view?.phases[1].agents.map((agent) => agent.label)).toEqual(['Fix bug', 'Review'])
    expect(view?.phases[0].tools.map((tool) => tool.label)).toEqual(['read src'])
    expect(view?.phases[1].tools.map((tool) => tool.label)).toEqual(['write fix'])
    expect(view?.phases[0].logs.map((log) => log.message)).toEqual(['scanning files'])
    expect(view?.phases[1].logs.map((log) => log.message)).toEqual(['first attempt failed'])
    // startedAt 归一化：时间轴依赖它还原并发关系。
    expect(view?.agents[1].startedAt).toBe(2_200)
    expect(view?.tools[1].startedAt).toBe(2_600)
    if (!view) throw new Error('expected a workflow view')
    expect(workflowActiveStepLabels(view)).toEqual(['Fix bug', 'write fix', 'Review'])
    expect(workflowCurrentPhase(view)).toBe('Fix')
  })

  it('folds consecutive tool calls into a nested step under the preceding agent', () => {
    const view = buildWorkflowRunView({ details: runningDetails }, true)
    if (!view) throw new Error('expected a workflow view')
    expect(workflowPhaseSteps(view.phases[0])).toMatchObject([
      { kind: 'agent', seq: 1 },
      { kind: 'tools', seq: 2 },
    ])
    const fix = workflowPhaseSteps(view.phases[1])
    expect(fix.map((step) => step.kind)).toEqual(['agent', 'tools', 'agent'])
    expect(fix[1].kind === 'tools' && fix[1].tools.map((tool) => tool.label)).toEqual(['write fix'])
  })

  it('keeps ungrouped tool calls and tool-only phases addressable', () => {
    const view = buildWorkflowRunView({
      details: {
        workflow: true,
        runId: 'wf',
        status: 'done',
        phases: [{ title: 'Setup' }, { title: 'Work' }],
        tools: [
          { id: 'tool-1', seq: 1, name: 'read_file', label: 'read a', phase: 'Setup', status: 'done' },
          { id: 'tool-2', seq: 2, name: 'read_file', label: 'read b', phase: 'Setup', status: 'done' },
          { id: 'tool-3', seq: 3, name: 'read_file', label: 'read c', phase: 'Work', status: 'done' },
        ],
        agents: [{ id: 'agent-1', seq: 4, label: 'Work', profile: 'general', phase: 'Work', status: 'done' }],
      },
    }, false)
    if (!view) throw new Error('expected a workflow view')
    const setup = workflowPhaseSteps(view.phases[0])
    expect(setup).toHaveLength(1)
    expect(setup[0].kind === 'tools' && setup[0].tools).toHaveLength(2)
    const work = workflowPhaseSteps(view.phases[1])
    expect(work.map((step) => step.kind)).toEqual(['tools', 'agent'])
  })

  it('maps terminal details to done, error and aborted without inventing success', () => {
    expect(buildWorkflowRunView({ details: { ...runningDetails, status: 'done', resultPreview: '{"ok":true}' } }, false)?.status).toBe('done')
    expect(buildWorkflowRunView({ isError: true, details: { ...runningDetails, status: 'error', error: 'boom' } }, false)).toMatchObject({ status: 'error', error: 'boom' })
    expect(buildWorkflowRunView({ details: { ...runningDetails, status: 'error', timedOut: true } }, false)?.status).toBe('error')
    expect(buildWorkflowRunView({ isError: true, details: { ...runningDetails, status: 'aborted', aborted: true } }, false)?.status).toBe('aborted')
  })

  it('returns null for non-workflow results and keeps unknown details defensive', () => {
    expect(buildWorkflowRunView(undefined, true)).toBeNull()
    expect(buildWorkflowRunView({ details: { workflow: false } }, true)).toBeNull()
    const view = buildWorkflowRunView({ details: { workflow: true, status: 'done', agents: [null, 'bad', { label: 'Only' }] } }, false)
    expect(view?.agents).toHaveLength(1)
    expect(view?.agents[0]).toMatchObject({ label: 'Only', status: 'queued' })
  })

  it('builds a Subagent run payload with trace messages for the Inspector', () => {
    const agent = {
      ...runningDetails.agents[0],
      subagentRun: {
        messages: [
          { role: 'assistant', timestamp: 1, content: [{ type: 'text', text: 'checking' }, { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } }] },
          { role: 'toolResult', timestamp: 2, toolCallId: 'call-1', toolName: 'read_file', content: [{ type: 'text', text: 'file body' }] },
        ],
        tools: [{ name: 'read_file', label: 'Read file' }],
        allowedTools: ['read_file'],
        pendingToolCalls: [],
        toolCalls: 1,
        model: { provider: 'test', id: 'model' },
        thinkingLevel: 'medium',
        durationMs: 500,
      },
    } as unknown as Parameters<typeof buildWorkflowSubagentRunPayload>[1]
    const payload = buildWorkflowSubagentRunPayload('workflow-1', agent, t)
    expect(payload.runId).toBe('workflow-1:agent:agent-1')
    expect(payload.status).toBe('done')
    expect(payload.statusLabel).toBe('Scan src completed')
    expect(payload.task).toBe('scan the source')
    expect(payload.output).toBe('found 2 files')
    expect(payload.toolCalls).toBe(3)
    expect(payload.traceMessages).toHaveLength(2)
    expect(payload.tools).toHaveLength(1)
    expect(payload.allowedTools).toEqual(['read_file'])
    expect(payload.model).toMatchObject({ provider: 'test', id: 'model' })
    expect(payload.thinkingLevel).toBe('medium')
    expect(payload.details).toContain('"thinkingLevel": "medium"')
    expect(payload.details).not.toContain('"messages"')
    expect(payload.detailed).toBe(false)
    expect(payload.fingerprint).toBeTruthy()

    toolDisplay.mode = 'detailed'
    expect(buildWorkflowSubagentRunPayload('workflow-1', agent, t).detailed).toBe(true)
    toolDisplay.mode = 'default'
  })

  it('exposes status and summary translation keys and a compact duration', () => {
    expect(workflowStatusLabelKey('running')).toBe('workflowRunning')
    expect(workflowStatusLabelKey('done')).toBe('workflowCompleted')
    expect(workflowStatusLabelKey('error')).toBe('workflowFailed')
    expect(workflowStatusLabelKey('aborted')).toBe('workflowAborted')
    expect(workflowSummaryText(buildWorkflowRunView({ details: runningDetails }, true)!, t)).toBe('Workflow running · 3 agents · 2 tools')
  })

  it('omits zero agent and tool counts from the summary', () => {
    const view = (details: Record<string, unknown>) => buildWorkflowRunView({ details: { workflow: true, status: 'done', ...details } }, false)!
    // 只跑了工具、没调用 agent() 的工作流不再出现「0 个智能体」。
    expect(workflowSummaryText(view({ tools: [{ id: 't1', seq: 1, name: 'read_file', phase: 'Work', status: 'done' }] }), t))
      .toBe('Workflow completed · 1 tool')
    // 只有 agent()、没有工具时同理省略工具片段。
    expect(workflowSummaryText(view({ agents: [{ id: 'a1', seq: 1, label: 'Scan', phase: 'Work', status: 'done' }] }), t))
      .toBe('Workflow completed · 1 agent')
    // 两者都为 0 时只留状态，不留下孤立的「 · 」分隔符。
    expect(workflowSummaryText(view({}), t)).toBe('Workflow completed')
  })
})

describe('workflow timeline', () => {
  it('keeps serial runs strictly non-overlapping', () => {
    const view = buildWorkflowRunView({ details: serialDetails }, false)
    if (!view) throw new Error('expected a workflow view')
    const timeline = workflowTimeline(view)
    expect(timeline.entries.map((entry) => entry.startOffsetMs)).toEqual([0, 1000])
    expect(timeline.entries.every((entry) => entry.parallel === false)).toBe(true)
    expect(timeline.peakConcurrency).toBe(1)
    expect(timeline.savedMs).toBe(0)
    expect(timeline.totalMs).toBe(3000)
  })

  it('detects concurrency from overlapping start times', () => {
    const view = buildWorkflowRunView({ details: parallelDetails }, false)
    if (!view) throw new Error('expected a workflow view')
    const timeline = workflowTimeline(view)
    expect(timeline.peakConcurrency).toBe(2)
    expect(timeline.entries.every((entry) => entry.parallel === true)).toBe(true)
    expect(timeline.entries.filter((entry) => entry.parallelGroupStart)).toHaveLength(1)
    expect(timeline.entries.find((entry) => entry.parallelGroupStart)?.label).toBe('left')
    // 串行需要 3s，实际 2s → 节省 1s。
    expect(timeline.savedMs).toBe(1000)
  })

  it('falls back to sequential offsets when startedAt is missing', () => {
    const view = buildWorkflowRunView({
      details: {
        workflow: true,
        runId: 'legacy',
        status: 'done',
        phases: [{ title: 'P' }],
        agents: [
          { id: 'a1', seq: 1, label: 'one', phase: 'P', status: 'done', durationMs: 400 },
          { id: 'a2', seq: 2, label: 'two', phase: 'P', status: 'done', durationMs: 600 },
        ],
      },
    }, false)
    if (!view) throw new Error('expected a workflow view')
    const timeline = workflowTimeline(view)
    expect(timeline.entries.map((entry) => entry.startOffsetMs)).toEqual([0, 400])
    expect(timeline.peakConcurrency).toBe(1)
    expect(timeline.totalMs).toBe(1000)
  })

  it('always reports a positive total span so the axis can divide safely', () => {
    const view = buildWorkflowRunView({ details: { workflow: true, runId: 'empty', status: 'done', agents: [], tools: [], phases: [] } }, false)
    if (!view) throw new Error('expected a workflow view')
    expect(workflowTimeline(view)).toMatchObject({ entries: [], totalMs: 1, peakConcurrency: 0 })
  })
})

describe('workflow run payload store', () => {
  it('de-duplicates by fingerprint and evicts the oldest run', () => {
    const store = new WorkflowRunStore()
    const view = buildWorkflowRunView({ details: serialDetails }, false)!
    const payload = buildWorkflowRunPayload({ runId: view.runId, view })
    expect(store.publish(payload)).toBe(true)
    expect(store.publish(payload)).toBe(false)
    expect(store.size).toBe(1)
    expect(store.get(view.runId)).toBe(payload)

    // 指纹变化（状态推进）应发布成功。
    const advanced = buildWorkflowRunPayload({ runId: view.runId, view: { ...view, durationMs: 9999 } })
    expect(store.publish(advanced)).toBe(true)
    expect(store.get(view.runId)?.view.durationMs).toBe(9999)
  })

  it('never rolls a terminal snapshot back to a running frame', () => {
    const done = buildWorkflowRunPayload({
      runId: 'r1',
      view: buildWorkflowRunView({ details: { ...serialDetails, status: 'done' } }, false)!,
    })
    const running = buildWorkflowRunPayload({
      runId: 'r1',
      view: buildWorkflowRunView({ details: { ...serialDetails, status: 'running' } }, true)!,
    })
    expect(shouldPublishWorkflowRunPayload(done, undefined)).toBe(true)
    expect(shouldPublishWorkflowRunPayload(running, done)).toBe(false)
    expect(shouldPublishWorkflowRunPayload(running, undefined)).toBe(true)
  })

  it('normalizes open requests defensively', () => {
    expect(normalizeOpenWorkflowRunRequest(null)).toBeUndefined()
    expect(normalizeOpenWorkflowRunRequest({})).toBeUndefined()
    expect(normalizeOpenWorkflowRunRequest({ runId: '' })).toBeUndefined()
    expect(normalizeOpenWorkflowRunRequest({ runId: 'r1' })).toEqual({ runId: 'r1' })
    const payload = buildWorkflowRunPayload({ runId: 'r1', view: buildWorkflowRunView({ details: serialDetails }, false)! })
    expect(normalizeOpenWorkflowRunRequest({ runId: 'r1', payload })?.payload).toBe(payload)
  })
})

describe('workflow tool renderer', () => {
  it('renders a single-line entry instead of an inline expansion', () => {
    const { markup } = render({ script: 'return 1' }, runningDetails, true)
    expect(markup).toContain('Workflow running · 3 agents · 2 tools')
    expect(markup).toContain('quickforge-workflow-card')
    // 不再内联展开阶段 / Agent / 工具行 / 日志 / 结果。
    expect(markup).not.toContain('quickforge-workflow-phase')
    expect(markup).not.toContain('quickforge-workflow-tool-zone')
    expect(markup).not.toContain('quickforge-workflow-log')
    expect(markup).not.toContain('quickforge-subagent-tool')
    expect(markup).not.toContain('scanning files')
    expect(markup).not.toContain('found 2 files')
    // 整行可点，可访问语义仍在（aria-expanded + aria-label 里的动作提示，但不占视觉位）。
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('View details')
  })

  it('drops the visible detail affordance and phase ticks', () => {
    const { markup } = render(undefined, runningDetails, true)
    // 「查看详情」只是 aria-label 的一部分，不再有可见文案块与箭头图标。
    expect(markup).not.toContain('quickforge-workflow-affordance')
    expect(markup).not.toContain('<span class="quickforge-workflow-affordance">')
    // 阶段刻度已移除：折叠态靠标题流光 + 阶段跑马灯表达运行中。
    expect(markup).not.toContain('quickforge-workflow-ticks')
    expect(markup).not.toContain('quickforge-workflow-tick"')
  })

  it('gives the running card the same shimmer as thinking text', () => {
    const { markup } = render(undefined, runningDetails, true)
    expect(markup).toContain('quickforge-tool-running-sweep')
    expect(markup).toContain('quickforge-workflow-marquee')

    // 终态不再是流光，但仍保留状态图标/耗时。
    const done = render(undefined, { ...runningDetails, status: 'done' }, false)
    expect(done.markup).not.toContain('quickforge-tool-running-sweep')
    expect(done.markup).not.toContain('quickforge-workflow-marquee')
  })

  it('renders the failure alert and the preparing fallback', () => {
    const rejected = new WorkflowToolRenderer().render(undefined, {
      isError: true,
      content: [{ type: 'text', text: 'User rejected run_workflow' }],
    }, false)
    const rejectedMarkup = renderToStaticMarkup(rejected.content as ReactElement)
    expect(rejectedMarkup).toContain('User rejected run_workflow')
    expect(rejectedMarkup).toContain('quickforge-workflow-error')
    expect(rejectedMarkup).not.toContain('Preparing workflow')

    const preparing = new WorkflowToolRenderer().render(undefined, undefined, true)
    const preparingMarkup = renderToStaticMarkup(preparing.content as ReactElement)
    expect(preparingMarkup).toContain('Preparing workflow')
    expect(preparingMarkup).not.toContain('quickforge-workflow-card')
  })

  it('carries the script into the opened payload only in detailed mode', () => {
    toolDisplay.mode = 'default'
    const compact = new WorkflowToolRenderer().render({ script: 'return 1' }, { details: runningDetails } as Parameters<WorkflowToolRenderer['render']>[1], true)
    expect(renderToStaticMarkup(compact.content as ReactElement)).not.toContain('Script')
    // 脚本门控在详情面板里完成，聊天卡始终只渲染一行摘要。
    expect(detailSource).toContain('payload.script')
    expect(detailSource).toContain('payload.detailed')
  })
})

describe('workflow run detail content', () => {
  it('merges timeline, phases and logs into one scrolling page', () => {
    // 三视图分段 tab 已移除：不再有 'timeline' | 'phase' | 'log' 的视图状态与分发。
    expect(detailSource).not.toContain("'timeline' | 'phase' | 'log'")
    expect(detailSource).not.toContain('quickforge-workflow-detail-seg')
    expect(detailSource).not.toContain('role="tablist"')
    // 一页里同时保留时间轴、阶段与日志三份信息。
    expect(detailSource).toContain('quickforge-workflow-detail-axis')
    expect(detailSource).toContain('quickforge-workflow-detail-phases')
    expect(detailSource).toContain('quickforge-workflow-detail-phase-logs')
    expect(detailSource).toContain('workflowTimeline')
    expect(detailSource).toContain('workflowPhaseSteps')
    // 阶段内的 Agent 卡保留 run_subagent 二级跳转。
    expect(detailSource).toContain('onOpenAgentRun')
  })

  it('renders the timeline as a percentage-positioned bar chart driven by workflowTimeline', () => {
    const view = buildWorkflowRunView({ details: runningDetails }, true)!
    const timeline = workflowTimeline(view)
    expect(timeline.entries.length).toBe(view.agents.length + view.tools.length)
    // 条形用百分比定位（不再用固定 viewBox 的 SVG，避免字号被等比缩小）。
    expect(detailSource).toContain('toPercent')
    expect(detailSource).toContain('Math.max(0.6')
    expect(detailSource).toContain('is-parallel')
    expect(detailSource).not.toContain('viewBox={`0 0 1000')
  })

  it('puts every step of a phase under that phase, next to its own logs', () => {
    const view = buildWorkflowRunView({ details: runningDetails }, true)!
    const markup = renderToStaticMarkup(
      createElement(WorkflowRunDetailContent, {
        payload: buildWorkflowRunPayload({ runId: view.runId, view, detailed: true }),
      }),
    )
    // 单页：刻度条 + 阶段小节 + 每阶段行 + 每阶段日志同屏渲染（没有互斥分支）。
    expect(markup).toContain('quickforge-workflow-detail-axis')
    expect(markup).toContain('quickforge-workflow-detail-scroll')
    expect(markup).toContain('quickforge-workflow-detail-phase-logs')
    // 两个阶段（Scan / Fix）都渲染出来，日志分别落在各自阶段内（不跨阶段串位）。
    expect(markup.indexOf('Scan')).toBeLessThan(markup.indexOf('scanning files'))
    expect(markup.indexOf('fix the bug')).toBeLessThan(markup.indexOf('first attempt failed'))
    // 不再渲染三视图分段按钮。
    expect(markup).not.toContain('quickforge-workflow-detail-seg')
  })

  it('reuses the shared tool-card building blocks instead of its own copies', () => {
    // 基础显示复用：折叠容器 / 类型图标 / chevron / 代码块 / 控制台块都来自 shared.tsx，
    // 不再自己写 <details>、lucide ChevronRight 或状态圆点。
    expect(detailSource).toContain('ToolDetails')
    expect(detailSource).toContain('renderToolIcon')
    expect(detailSource).toContain('renderToolChevron')
    expect(detailSource).toContain('renderCodeBlock')
    expect(detailSource).toContain('renderConsoleBlock')
    // Agent 任务块复用 subagent 详情顶部那一套（input-clamp 定高收起）。
    expect(detailSource).toContain('quickforge-subagent-task quickforge-input-clamp')
    expect(detailSource).toContain('syncInputClampBoxes')
    expect(detailSource).not.toContain('ChevronRight')
    expect(detailSource).not.toContain('quickforge-workflow-detail-dot')
    // 开合记忆按 runId + 步骤 id 隔离，避免嵌套在同一个工具卡宿主里互相污染。
    expect(detailSource).toContain('stateKey={`workflow:${workflowRunId}:agent:${agent.id}`}')
    expect(detailSource).toContain('stateKey={`workflow:${workflowRunId}:tool:${tool.id}`}')
    // 运行详情在聊天面板之外，共享 summary 行的字号规则取不到，行本身必须自带字号。
    expect(css).toMatch(/\.quickforge-workflow-detail-row-label\s*\{[\s\S]*?font-size:/)
    // 行首图标复用 `.quickforge-tool-type-icon`，只按状态改外层颜色。
    expect(css).toMatch(/\.quickforge-workflow-detail-row-icon\s*\{[\s\S]*?display:\s*inline-flex;/)
    expect(css).toMatch(/\.quickforge-workflow-detail-row-icon \.quickforge-tool-type-icon\s*\{[\s\S]*?color:\s*inherit;/)
  })
})

describe('workflow renderer wiring and contracts', () => {
  it('registers the renderer, icon, refresh trigger and approval labels', () => {
    expect(localTools).toContain("registerToolRenderer('run_workflow', new WorkflowToolRenderer())")
    expect(index).toContain('WorkflowToolRenderer')
    expect(shared).toContain("toolName === 'run_workflow'")
    expect(titleRefresh).toContain("'run_workflow'")
    expect(approvalCard).toContain("run_workflow: 'runWorkflow'")
    expect(approvalCard).toContain("source?.type === 'workflow'")
    expect(approvalCard).toContain("source?.type === 'workflow-tool'")
    expect(approvalCard).toContain("translate('workflowBadge')")
    expect(approvalCard).toContain("translate('toolApprovalRiskWorkflow')")
  })

  it('wires the card to the Workspace Inspector through the shared event bridge', () => {
    expect(payloadSource).toContain("'quickforge:open-workflow-run'")
    expect(source).toContain('OPEN_WORKFLOW_RUN_EVENT')
    expect(source).toContain('workflowRunStore')
    expect(source).toContain('buildWorkflowRunPayload')
    expect(app).toContain('OPEN_WORKFLOW_RUN_EVENT')
    expect(app).toContain("kind: 'workflow'")
    // Tab 去重与按 runId 就地更新。
    expect(tabSource).toContain('upsertWorkflowRunTab')
    expect(tabSource).toContain('updateWorkflowRunTab')
    expect(tabSource).toContain("tab.kind === 'workflow' && tab.workflowRun?.runId === runId")
    // workflow tab 不持久化（运行快照无法在刷新后重建）。
    expect(tabSource).toContain("tab.kind === 'workflow'")
  })

  it('keeps i18n keys paired and localizes the summary', () => {
    const keys = [
      'runWorkflow',
      'workflowPreparing',
      'workflowRunning',
      'workflowCompleted',
      'workflowFailed',
      'workflowAborted',
      'workflowAgentCountOne',
      'workflowAgentCountMany',
      'workflowToolCountOne',
      'workflowToolCountMany',
      'workflowToolParams',
      'workflowToolResult',
      'workflowAgentTask',
      'workflowCurrentPhase',
      'workflowNoAgents',
      'workflowError',
      'workflowAgentQueued',
      'workflowAgentRunning',
      'workflowAgentDone',
      'workflowAgentFailed',
      'workflowAgentAborted',
      'workflowAgentToolCalls',
      'workflowAgentSchema',
      'workflowResult',
      'workflowScript',
      'workflowBadge',
      'toolApprovalRiskWorkflow',
      'workflowTabTitle',
      'workflowTabTitleNoPhases',
      'workflowDetailRunLogs',
      'workflowDetailPeakConcurrency',
      'workflowDetailSaved',
      'workflowDetailOpenRun',
      'workflowDetailOpened',
      'workflowDetailTimelineHint',
    ]
    for (const key of keys) {
      expect(i18n.match(new RegExp(`\\b${key}:`, 'g'))?.length ?? 0).toBeGreaterThanOrEqual(2)
    }
    expect(t('workflowAgentCountMany', { count: 2 })).toBe('2 agents')
    applyAppLanguageFromSnapshot('zh')
    expect(t('workflowAgentCountMany', { count: 3 })).toBe('3 个智能体')
    expect(t('workflowToolCountMany', { count: 2 })).toBe('2 个工具')
    expect(t('workflowAgentToolCalls', { count: 4 })).toBe('4 次工具调用')
    expect(t('workflowTabTitle', { count: 5 })).toBe('工作流 · 5 阶段')
    applyAppLanguageFromSnapshot('en')
  })

  it('styles the entry card and the detail panel with the shared tokens', () => {
    // 摘要卡是一整行 button，hover/focus 用浅背景而不是改文字色。
    expect(css).toMatch(/\.quickforge-workflow-card\s*\{[\s\S]*?min-height:\s*1\.625rem;[\s\S]*?border:\s*0;/)
    expect(css).toMatch(/\.quickforge-workflow-card:hover,\s*\.quickforge-workflow-card:focus-visible\s*\{\s*background-color:\s*color-mix\(in oklab, var\(--muted\) 55%, transparent\);/)
    // 阶段刻度与「查看详情」入口已移除：整行是 button，运行中靠标题流光表达。
    expect(css).not.toContain('.quickforge-workflow-tick')
    expect(css).not.toContain('.quickforge-workflow-affordance')
    // 标题吃掉剩余空间，把状态/耗时推到右侧（刻度移除后的对齐方式）。
    expect(css).toMatch(/\.quickforge-workflow-title\s*\{[\s\S]*?margin-right:\s*auto;/)
    // 运行中摘要复用 tool 流光与跑马灯，reduced-motion 由 .quickforge-tool-running-sweep 统一降级。
    expect(css).toMatch(/\.quickforge-workflow-marquee\s*\{[\s\S]*?overflow:\s*hidden;/)
    // 时间轴用 DOM 百分比布局（SVG 固定 viewBox 会把字号一起缩放，导致文字过小）。
    // 根节点必须自己吃满宽高：缺 flex:1 时宽度按内容收缩（轨道被压扁），
    // 缺 min-height:0/overflow 时内容被 Inspector 的 overflow:hidden 裁掉。
    expect(css).toMatch(/\.quickforge-workflow-detail\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-width:\s*0;[\s\S]*?min-height:\s*0;/)
    // 合并成单页后唯一滚动容器是 -scroll（原 -pane 已删除）。
    expect(css).toMatch(/\.quickforge-workflow-detail-scroll\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/)
    // 刻度条与阶段头都是吸顶元素：刻度贴顶，阶段头贴刻度下方，且各自有实底
    // （否则滚动中的行会从吸顶元素下面透出来）。
    expect(css).toMatch(/\.quickforge-workflow-detail-axis\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/)
    expect(css).toMatch(/\.quickforge-workflow-detail-axis\s*\{[\s\S]*?height:\s*var\(--wf-tl-axis-h\);/)
    expect(css).toMatch(/\.quickforge-workflow-detail-phase-head\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*var\(--wf-tl-axis-h\);[\s\S]*?background:\s*var\(--background\);/)
    // 图例改成整页常驻（概览条右侧），不再挂在时间轴底部。
    expect(css).toMatch(/\.quickforge-workflow-detail-legend\s*\{[\s\S]*?margin-left:\s*auto;/)
    // 标签列用 clamp 自适应，窄面板下不挤压轨道。
    expect(css).toMatch(/--wf-tl-label:\s*clamp\(/)
    expect(css).toMatch(/\.quickforge-workflow-detail-row\s*\{[\s\S]*?display:\s*flex;[\s\S]*?min-height:\s*1\.5rem;/)
    expect(css).toMatch(/\.quickforge-workflow-detail-bar\s*\{[\s\S]*?background:\s*color-mix\(in oklab, var\(--workflow-done\) 34%, transparent\);/)
    expect(css).toMatch(/\.quickforge-workflow-detail-bar\[data-kind='tool'\]\s*\{[\s\S]*?height:\s*0\.375rem;/)
    // 并行段用虚线边框做颜色之外的第二编码。
    expect(css).toMatch(/\.quickforge-workflow-detail-bar\.is-parallel\s*\{\s*border-style:\s*dashed;/)
    // 右侧不再被裁：条形 border-box（无全局 box-sizing，百分比宽度 + 边框会溢出 2px）；
    // 耗时与「并行」标签固定在绘图区两端的安全区外，不挂在条形上随位置溢出。
    expect(css).toMatch(/\.quickforge-workflow-detail-bar\s*\{[\s\S]*?box-sizing:\s*border-box;/)
    expect(css).toMatch(/--wf-tl-pad-start:\s*[\d.]+rem;/)
    expect(css).toMatch(/--wf-tl-pad-end:\s*[\d.]+rem;/)
    // 安全区由 plot 的 margin 承担（不能用 padding：绝对定位百分比基准是 padding box，
    // 加 padding 会让 left:0% 仍从 border 内侧算起，条形压到左侧标签上）。
    expect(css).toMatch(/\.quickforge-workflow-detail-row-plot,\s*\.quickforge-workflow-detail-axis-plot\s*\{[\s\S]*?margin-left:\s*var\(--wf-tl-pad-start\);[\s\S]*?margin-right:\s*var\(--wf-tl-pad-end\);/)
    expect(css).toMatch(/\.quickforge-workflow-detail-bar-value\s*\{[\s\S]*?right:\s*0;/)
    expect(css).toMatch(/\.quickforge-workflow-detail-parallel-tag\s*\{[\s\S]*?left:\s*0;/)
    // 字号不再依赖 SVG 缩放，走消息字号基准。
    expect(css).toMatch(/\.quickforge-workflow-detail-row-label\s*\{[\s\S]*?font-size:\s*calc\(var\(--quickforge-message-font-size, 14px\) \* 0\.75\);/)
    // done 语义色必须在主题变量里定义，否则深色模式会退回浅色的绿。
    expect(css).toMatch(/:root\s*\{[\s\S]*?--workflow-done:\s*oklch\(0\.55 0\.13 158\);/)
    expect(css).toMatch(/\.dark\s*\{[\s\S]*?--workflow-done:\s*oklch\(0\.75 0\.15 160\);/)
    // 动效 token 必须用已定义的名字（--quickforge-ease-out），不存在 --quickforge-ease。
    expect(css).not.toContain('var(--quickforge-ease,')
    // 详情面板单页结构与底部固定区；分段 tab 必须彻底移除。
    expect(css).not.toContain('.quickforge-workflow-detail-seg')
    expect(css).not.toContain('.quickforge-workflow-detail-pane')
    expect(css).toMatch(/\.quickforge-workflow-detail-foot\s*\{[\s\S]*?border-top:/)
    // 旧的聊天内展开样式必须清理干净，避免两套布局漂移。
    expect(css).not.toContain('.quickforge-workflow-phase {')
    expect(css).not.toContain('.quickforge-workflow-tool-zone')
    expect(css).not.toContain('.quickforge-workflow-result-section')
  })

  it('keeps the running summary marquee on one scrollable line', () => {
    expect(css).toMatch(/\.quickforge-workflow-marquee\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*hidden;[\s\S]*?white-space:\s*nowrap;[\s\S]*?height:\s*1\.125rem;/)
    expect(css).toMatch(/\.quickforge-workflow-marquee \.quickforge-marquee-view\s*\{\s*position:\s*absolute;[\s\S]*?inset:\s*0;/)
    expect(css).toMatch(/\.quickforge-workflow-marquee \.quickforge-marquee-static\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/)
    expect(css).toMatch(/\.quickforge-workflow-marquee \.quickforge-marquee-moving\s*\{[\s\S]*?display:\s*none;/)
  })

  it('documents the worker-backed orchestration in the view model and renderer sources', () => {
    expect(viewSource).toContain('buildWorkflowRunView')
    expect(viewSource).toContain('workflowActiveStepLabels')
    expect(viewSource).toContain('workflowTimeline')
    expect(source).toContain('buildWorkflowRunView')
    expect(source).toContain("renderToolIcon('run_workflow')")
    expect(source).toContain('quickforge-workflow-marquee')
    expect(payloadSource).toContain('workflowRunStore')
  })
})
