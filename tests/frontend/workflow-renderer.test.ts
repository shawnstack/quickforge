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
  workflowPhaseSpan,
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
// 注册内置工具渲染器（import 副作用）：详情步骤行复用 ToolMessage，markup 断言
// 需要真实走 local-workspace 渲染器，而不是兜底的通用卡。
import { getLocalWorkspaceTools } from '../../src/lib/local-tools'
import { WorkflowRunDetailContent } from '../../src/components/workspace/WorkflowRunDetailContent'

void getLocalWorkspaceTools

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
    // 组成员数（含自身）随条目下发，供组标注「并行×N」。
    expect(timeline.entries.every((entry) => entry.parallelGroupSize === 2)).toBe(true)
    // 串行需要 3s，实际 2s → 节省 1s。
    expect(timeline.savedMs).toBe(1000)
  })

  it('reports per-phase spans for the sticky phase heads', () => {
    const view = buildWorkflowRunView({ details: serialDetails }, false)
    if (!view) throw new Error('expected a workflow view')
    const timeline = workflowTimeline(view)
    expect(workflowPhaseSpan(view.phases[0], timeline)).toEqual({ startOffsetMs: 0, endOffsetMs: 3000 })
    // 没有可定位条目的阶段返回 null：阶段头不画跨度条、不显示耗时。
    const sparse = buildWorkflowRunView({
      details: {
        workflow: true,
        runId: 'sparse',
        status: 'done',
        phases: [{ title: 'Empty' }, { title: 'Work' }],
        agents: [{ id: 'a1', seq: 1, label: 'only', phase: 'Work', status: 'done', startedAt: 5, durationMs: 10 }],
      },
    }, false)
    if (!sparse) throw new Error('expected a workflow view')
    expect(workflowPhaseSpan(sparse.phases[0], workflowTimeline(sparse))).toBeNull()
    expect(workflowPhaseSpan(sparse.phases[1], workflowTimeline(sparse))).toEqual({ startOffsetMs: 0, endOffsetMs: 10 })
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

  it('folds every workflow failure to an icon-only toggle', () => {
    const rejected = new WorkflowToolRenderer().render(undefined, {
      isError: true,
      content: [{ type: 'text', text: 'User rejected run_workflow' }],
    }, false)
    const rejectedMarkup = renderToStaticMarkup(rejected.content as ReactElement)
    // 折叠态只有错误图标：原文不进 DOM（点开才渲染），也不再有「Error」标签文字。
    expect(rejectedMarkup).toContain('quickforge-workflow-error')
    expect(rejectedMarkup).toContain('quickforge-workflow-error-toggle')
    expect(rejectedMarkup).toContain('aria-expanded="false"')
    expect(rejectedMarkup).toContain('Show error details')
    expect(rejectedMarkup).not.toContain('User rejected run_workflow')
    expect(rejectedMarkup).not.toContain('quickforge-workflow-error-label')
    expect(rejectedMarkup).not.toContain('data-open="true"')
    expect(rejectedMarkup).not.toContain('Preparing workflow')

    // 长错误同样折叠：不再按长度分叉，短错误也不会直接铺开。
    const long = new WorkflowToolRenderer().render(undefined, {
      isError: true,
      content: [{ type: 'text', text: `Workflow failed\n${'at step read_file '.repeat(12)}` }],
    }, false)
    const longMarkup = renderToStaticMarkup(long.content as ReactElement)
    expect(longMarkup).toContain('quickforge-workflow-error-toggle')
    expect(longMarkup).not.toContain('at step read_file')

    // 折叠是 JSX 门控（展开才渲染文本），展开态限高在样式表里。
    expect(source).toContain('quickforge-workflow-error-text')
    expect(source).toContain('workflowErrorExpand')
    expect(css).toContain('.quickforge-workflow-error-text')
    expect(css).toContain('.quickforge-workflow-error[data-open=\'true\']')
    expect(css).toContain('max-height: 40vh')

    const preparing = new WorkflowToolRenderer().render(undefined, undefined, true)
    const preparingMarkup = renderToStaticMarkup(preparing.content as ReactElement)
    expect(preparingMarkup).toContain('Preparing workflow')
    expect(preparingMarkup).not.toContain('quickforge-workflow-card')
  })

  it('carries the script into the opened payload only in detailed mode', () => {
    toolDisplay.mode = 'default'
    const compact = new WorkflowToolRenderer().render({ script: 'return 1' }, { details: runningDetails } as Parameters<WorkflowToolRenderer['render']>[1], true)
    expect(renderToStaticMarkup(compact.content as ReactElement)).not.toContain('Script')
    // 脚本门控在详情面板里完成，聊天卡始终只渲染一行摘要；步骤卡的详细模式
    // 不再由 payload.detailed 透传——聊天卡直接读全局工具显示设置（与聊天一致）。
    expect(detailSource).toContain('payload.script')
    expect(detailSource).not.toContain('payload.detailed')
  })
})

describe('workflow run detail content', () => {
  it('merges phases, steps and logs into one scrolling page', () => {
    // 三视图分段 tab 已移除：不再有 'timeline' | 'phase' | 'log' 的视图状态与分发。
    expect(detailSource).not.toContain("'timeline' | 'phase' | 'log'")
    expect(detailSource).not.toContain('quickforge-workflow-detail-seg')
    expect(detailSource).not.toContain('role="tablist"')
    // 一页里同时保留阶段、步骤与日志；时间轴与时间条已整体移除。
    expect(detailSource).not.toContain('quickforge-workflow-detail-axis')
    expect(detailSource).not.toContain('quickforge-workflow-detail-bar')
    expect(detailSource).toContain('quickforge-workflow-detail-phases')
    expect(detailSource).toContain('quickforge-workflow-detail-phase-logs')
    expect(detailSource).toContain('workflowTimeline')
    expect(detailSource).toContain('workflowPhaseSteps')
    // Agent 行是轻量入口，不再复用带当前工具跑马灯的完整摘要卡。
    expect(detailSource).toContain('quickforge-workflow-detail-agent')
    expect(detailSource).not.toContain('renderSubagentRunSummary')
  })

  it('drives concurrency stats from workflowTimeline without rendering a bar chart', () => {
    const view = buildWorkflowRunView({ details: runningDetails }, true)!
    const timeline = workflowTimeline(view)
    expect(timeline.entries.length).toBe(view.agents.length + view.tools.length)
    // 时间轴只用于并发/节省统计；不再生成百分比条形。
    expect(detailSource).not.toContain('TimelineAxis')
    expect(detailSource).not.toContain('StepTrack')
    expect(detailSource).not.toContain('toPercent')
    expect(detailSource).not.toContain('Math.max(0.6')
    expect(detailSource).not.toContain('workflowPhaseSpan')
    expect(detailSource).not.toContain('quickforge-workflow-detail-grid-layer')
    expect(detailSource).not.toContain('quickforge-workflow-detail-now-chip')
    expect(detailSource).not.toContain('quickforge-workflow-detail-phase-track')
    expect(css).not.toContain('--wf-tl-')
    expect(css).not.toContain('quickforge-workflow-detail-bar')
  })

  it('puts every step of a phase under that phase, next to its own logs', () => {
    const view = buildWorkflowRunView({ details: runningDetails }, true)!
    const markup = renderToStaticMarkup(
      createElement(WorkflowRunDetailContent, {
        payload: buildWorkflowRunPayload({ runId: view.runId, view, detailed: true }),
      }),
    )
    // 单页：阶段小节 + 每阶段行 + 每阶段日志同屏渲染（没有互斥分支）。
    expect(markup).toContain('quickforge-workflow-detail-scroll')
    expect(markup).toContain('quickforge-workflow-detail-phase-logs')
    expect(markup).not.toContain('quickforge-workflow-detail-axis')
    // 两个阶段（Scan / Fix）都渲染出来；日志一律默认收起，错误日志只留头部标记点。
    expect(markup.indexOf('Scan')).toBeLessThan(markup.indexOf('Fix'))
    expect(markup).not.toContain('scanning files')
    expect(markup).not.toContain('first attempt failed')
    expect(markup).toContain('quickforge-workflow-detail-logs-flag')
    expect(markup.indexOf('Write File')).toBeGreaterThan(markup.indexOf('Fix'))
    // 不再渲染三视图分段按钮。
    expect(markup).not.toContain('quickforge-workflow-detail-seg')
  })

  it('renders phase status dots and pending notes without a time axis', () => {
    const view = buildWorkflowRunView({ details: runningDetails }, true)!
    const markup = renderToStaticMarkup(
      createElement(WorkflowRunDetailContent, {
        payload: buildWorkflowRunPayload({ runId: view.runId, view, detailed: true }),
      }),
    )
    expect(markup).toContain('quickforge-workflow-detail-phase-dot" data-tone="done"')
    expect(markup).toContain('quickforge-workflow-detail-phase-dot" data-tone="running"')
    expect(markup).not.toContain('quickforge-workflow-detail-axis')
    expect(markup).not.toContain('quickforge-workflow-detail-now-chip')
    expect(markup).not.toContain('quickforge-workflow-detail-phase-track')
    expect(detailSource).toContain('workflowDetailPending')
    // 全 queued 阶段显示 Pending，而不是伪造 done 或 0ms 时长。
    const pending = buildWorkflowRunView({
      details: {
        workflow: true,
        runId: 'pending-1',
        status: 'running',
        phases: [{ title: 'Wait' }],
        agents: [{ id: 'a1', seq: 1, label: 'Wait', profile: 'general', phase: 'Wait', status: 'queued' }],
        tools: [],
        logs: [],
      },
    }, true)!
    const pendingMarkup = renderToStaticMarkup(
      createElement(WorkflowRunDetailContent, {
        payload: buildWorkflowRunPayload({ runId: pending.runId, view: pending, detailed: false }),
      }),
    )
    expect(pendingMarkup).toContain('quickforge-workflow-detail-phase-note')
    expect(pendingMarkup).toContain('Pending')
  })

  it('renders a single parallel ×N tag on the group start without brackets', () => {
    const view = buildWorkflowRunView({ details: parallelDetails }, false)!
    const markup = renderToStaticMarkup(
      createElement(WorkflowRunDetailContent, {
        payload: buildWorkflowRunPayload({ runId: view.runId, view, detailed: false }),
      }),
    )
    expect(markup).toContain('quickforge-workflow-detail-parallel-tag')
    // 组标注只出现一次（组首）；没有绘图区 bracket / 虚线条形。
    expect(markup.match(/parallel ×2/g)).toHaveLength(1)
    expect(markup).not.toContain('quickforge-workflow-detail-parallel-group')
    expect(markup).not.toContain('is-parallel')
    expect(detailSource).not.toContain("t('workflowDetailParallelBadge')")
  })

  it('leaves a tool-only group at the start of a phase flat', () => {
    const view = buildWorkflowRunView({
      details: {
        workflow: true,
        runId: 'tool-only',
        status: 'done',
        phases: [{ title: 'Setup' }],
        tools: [{ id: 't1', seq: 1, name: 'read_file', label: 'read a', phase: 'Setup', status: 'done', startedAt: 1, durationMs: 1, args: { path: 'a.ts' }, resultPreview: 'a' }],
        agents: [],
        logs: [],
      },
    }, false)!
    const markup = renderToStaticMarkup(
      createElement(WorkflowRunDetailContent, {
        payload: buildWorkflowRunPayload({ runId: view.runId, view, detailed: false }),
      }),
    )
    expect(markup).toContain('quickforge-workflow-detail-tools')
    // 没有前置 Agent：组不带 data-owned，因此不缩进、不画连接线。
    expect(markup).not.toContain('quickforge-workflow-detail-tools" data-owned="true"')
    expect(css).toContain(".quickforge-workflow-detail-tools[data-owned='true']")
  })

  it('collapses all phase logs by default, including error logs', () => {
    const view = buildWorkflowRunView({ details: runningDetails }, true)!
    const markup = renderToStaticMarkup(
      createElement(WorkflowRunDetailContent, {
        payload: buildWorkflowRunPayload({ runId: view.runId, view, detailed: true }),
      }),
    )
    // 日志一律默认收起：error 级日志只在头部留标记点，不自动铺开正文。
    expect(markup).not.toContain('scanning files')
    expect(markup).not.toContain('first attempt failed')
    expect(markup).toContain('quickforge-workflow-detail-logs-flag')
    expect(detailSource).toContain('const [open, setOpen] = useState(false)')
    expect(detailSource).toContain('const hasError = logs.some((log) => log.level === \'error\')')
    expect(detailSource).not.toContain('LOG_FOLD_LIMIT')
    // 长 info 日志也默认收起，不渲染具体行。
    const logs = Array.from({ length: 9 }, (_, index) => ({
      at: index + 1,
      phase: 'Only',
      message: `line ${index}`,
      level: 'info',
    }))
    const long = buildWorkflowRunView({ details: { ...serialDetails, status: 'done', logs } }, false)!
    const longMarkup = renderToStaticMarkup(
      createElement(WorkflowRunDetailContent, {
        payload: buildWorkflowRunPayload({ runId: long.runId, view: long, detailed: false }),
      }),
    )
    expect(longMarkup).toContain('Run log')
    expect(longMarkup).not.toContain('line 0')
    expect(longMarkup).not.toContain('Show all 9')
  })

  it('renders the locate-failure jump and moves the budget into the script sheet', () => {
    const view = buildWorkflowRunView({ isError: true, details: { ...runningDetails, status: 'error', error: 'boom' } }, false)!
    const markup = renderToStaticMarkup(
      createElement(WorkflowRunDetailContent, {
        payload: buildWorkflowRunPayload({ runId: view.runId, view, detailed: true }),
      }),
    )
    // 折叠态只留错误图标；「定位失败步骤」随展开态一起渲染（滚动 + 闪烁由 jumpToFailure 驱动）。
    expect(markup).toContain('quickforge-workflow-detail-error-toggle')
    expect(markup).not.toContain('Locate failed step')
    expect(detailSource).toContain('quickforge-workflow-detail-error-jump')
    expect(detailSource).toContain('jumpToFailure')
    // 展开受控的聊天工具卡（details 在卡内）仍走原生 summary 点击，不能直接改 open。
    expect(detailSource).toContain("details.querySelector('summary')")
    // 预算不再常驻概览条，改随「脚本」sheet 头部展示。
    expect(detailSource).not.toContain("t('workflowDetailBudget')")
    expect(detailSource).toContain('workflowDetailBudgetLine')
    expect(detailSource).toContain('quickforge-workflow-detail-sheet-meta')
    // 派生统计行只在真实存在时渲染（并发峰值/节省，无则整行隐藏）。
    expect(detailSource).toContain('timeline.peakConcurrency > 1 || timeline.savedMs > 0')
  })

  it('folds the run error to an icon and keeps error-level logs folded', () => {
    const longError = `Workflow failed\n${'at step read_file '.repeat(12)}`
    const view = buildWorkflowRunView({ isError: true, details: { ...runningDetails, status: 'error', error: longError } }, false)!
    const markup = renderToStaticMarkup(
      createElement(WorkflowRunDetailContent, {
        payload: buildWorkflowRunPayload({ runId: view.runId, view, detailed: true }),
      }),
    )
    // 折叠态只有图标（带展开/收起 aria 文案），错误原文不进 DOM，阶段列表不再被挤出可视区。
    expect(markup).toContain('quickforge-workflow-detail-error-toggle')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('Show error details')
    expect(markup).not.toContain('at step read_file')
    expect(markup).not.toContain('data-open="true"')
    expect(detailSource).toContain('workflowErrorExpand')
    expect(detailSource).toContain('AlertTriangle')
    expect(css).toContain(".quickforge-workflow-detail-error[data-open='true']")
    expect(css).toContain('max-height: 40vh')
    // 阶段里有 error 级日志也默认收起：头部仍显示「Run log」，正文不在首屏。
    expect(markup).toContain('Run log')
    expect(markup).not.toContain('first attempt failed')

    // 短错误同样折叠：不再按长度分叉。
    const shortView = buildWorkflowRunView({ isError: true, details: { ...runningDetails, status: 'error', error: 'boom' } }, false)!
    const shortMarkup = renderToStaticMarkup(
      createElement(WorkflowRunDetailContent, {
        payload: buildWorkflowRunPayload({ runId: shortView.runId, view: shortView, detailed: true }),
      }),
    )
    expect(shortMarkup).toContain('quickforge-workflow-detail-error-toggle')
    expect(shortMarkup).not.toContain('boom')
  })

  it('shows the overview failure entry when steps failed without a run error', () => {
    const view = buildWorkflowRunView({
      details: {
        ...runningDetails,
        status: 'running',
        agents: runningDetails.agents.map((agent) => (
          agent.id === 'agent-2' ? { ...agent, status: 'error', error: 'boom' } : agent
        )),
      },
    }, true)!
    expect(view.error).toBe('')
    expect(view.failedAgentCount).toBe(1)
    const markup = renderToStaticMarkup(
      createElement(WorkflowRunDetailContent, {
        payload: buildWorkflowRunPayload({ runId: view.runId, view, detailed: true }),
      }),
    )
    expect(markup).toContain('quickforge-workflow-detail-failure')
    expect(markup).toContain('1 failed step')
    expect(markup).toContain('Locate')
    expect(detailSource).toContain('showFailureJump')
  })

  it('opens the script sheet by default when the payload carries a script', () => {
    const view = buildWorkflowRunView({ details: runningDetails }, true)!
    const markup = renderToStaticMarkup(
      createElement(WorkflowRunDetailContent, {
        payload: buildWorkflowRunPayload({ runId: view.runId, view, script: 'return 1', detailed: true }),
      }),
    )
    expect(markup).toContain('id="quickforge-workflow-detail-script-sheet"')
    expect(markup).toContain('aria-controls="quickforge-workflow-detail-script-sheet"')
    expect(markup).toContain('language-javascript')
    expect(markup).toContain('aria-expanded="true"')
    // 无 script 时没有 sheet，也不渲染底部脚本按钮。
    const noScript = renderToStaticMarkup(
      createElement(WorkflowRunDetailContent, {
        payload: buildWorkflowRunPayload({ runId: view.runId, view, detailed: true }),
      }),
    )
    expect(noScript).not.toContain('quickforge-workflow-detail-sheet')
    expect(noScript).not.toContain('quickforge-workflow-detail-foot-btn')
  })

  it('reuses the chat tool cards but keeps the agent entry lightweight', () => {
    // 工具行直接渲染普通对话的 ToolMessage；Agent 行只保留摘要 + 跳转，
    // 不再复用带当前工具跑马灯的 run_subagent 摘要卡。
    expect(detailSource).toContain('ToolMessage')
    expect(detailSource).toContain('workflowToolCall')
    expect(detailSource).toContain('workflowToolResult')
    expect(detailSource).toContain('buildWorkflowSubagentRunPayload')
    expect(detailSource).toContain('shouldPublishSubagentRunPayload')
    expect(detailSource).toContain('OPEN_SUBAGENT_RUN_EVENT')
    expect(detailSource).toContain('resolveSubagentRunPayloadForOpen')
    expect(detailSource).not.toContain('renderSubagentRunSummary')
    expect(detailSource).not.toContain('quickforge-subagent-marquee')
    expect(detailSource).not.toContain('renderConsoleBlock')
    expect(detailSource).not.toContain('argsPreview')
    expect(detailSource).not.toContain('quickforge-workflow-detail-step-body')
    expect(detailSource).not.toContain('quickforge-workflow-detail-row-label')
    // 工具卡的耗时徽标由合成的 quickforgeTiming（startedAt/durationMs）驱动，
    // 与聊天侧同一推导路径。
    expect(detailSource).toContain('quickforgeTiming')
    const view = buildWorkflowRunView({ details: runningDetails }, true)!
    const markup = renderToStaticMarkup(
      createElement(WorkflowRunDetailContent, {
        payload: buildWorkflowRunPayload({ runId: view.runId, view, detailed: true }),
      }),
    )
    expect(markup).toContain('quickforge-local-tool-shell')
    expect(markup).toContain('src/a.ts')
    expect(markup).toContain('quickforge-workflow-detail-agent')
    expect(markup).toContain('Scan src')
    // Agent 行没有 chat 摘要卡，也没有当前工具跑马灯。
    expect(markup).not.toContain('quickforge-subagent-tool')
    expect(markup).not.toContain('quickforge-subagent-marquee')
    // 工具行保留 workflow 自己的内容列缩进；Agent 行没有时间轨道。
    expect(detailSource).toContain('quickforge-workflow-detail-tool-line')
    expect(css).toMatch(/\.quickforge-workflow-detail-tools\[data-owned='true'\] > \.quickforge-workflow-detail-step\[data-kind='tool'\]\s*\{[\s\S]*?padding-left:\s*calc\(var\(--qf-detail-pad\) \+ 1\.125rem\);/)
    expect(css).toMatch(/\.quickforge-workflow-detail-agent\s*\{[\s\S]*?min-height:\s*1\.375rem;/)
  })

  it('makes each agent row a lightweight entry that opens the subagent detail', () => {
    const view = buildWorkflowRunView({ details: runningDetails }, true)!
    const markup = renderToStaticMarkup(
      createElement(WorkflowRunDetailContent, {
        payload: buildWorkflowRunPayload({ runId: view.runId, view, detailed: true }),
      }),
    )
    // 点击仍解析 store 最新快照并派发 OPEN_SUBAGENT_RUN_EVENT，打开原来的
    // 子 Agent 运行详情；详情组件不再自己接线 onOpenAgentRun。
    expect(markup).toContain('quickforge-workflow-detail-agent')
    expect(markup).toContain('quickforge-workflow-detail-agent-link')
    expect(markup).toContain('Scan src')
    expect(markup).not.toContain('quickforge-subagent-tool')
    expect(detailSource).toContain('renderToolIcon(\'run_subagent\')')
    expect(detailSource).toContain('OPEN_SUBAGENT_RUN_EVENT')
    expect(detailSource).toContain('resolveSubagentRunPayloadForOpen')
    expect(detailSource).toContain('subagentRunStore.get')
    expect(detailSource).not.toContain('onOpenAgentRun')
    // 运行中的任务名不再走 chat 摘要卡的流光；queued Agent 仍禁用。
    expect(detailSource).not.toContain('quickforge-tool-running-sweep')
    expect(detailSource).toContain("agent.status === 'queued'")
    expect(markup).toContain('disabled')
    // 载荷与发布口径和聊天里的 Agent 卡一致（store 优先回填）。
    expect(detailSource).toContain('subagentRunStore.get(`${workflowRunId || \'workflow\'}:agent:${agent.id}`)')
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
      'workflowAgentDone',
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
      'workflowDetailParallelCount',
      'workflowDetailBudgetLine',
      'workflowDetailNow',
      'workflowDetailNowTitle',
      'workflowDetailLocateFailure',
      'workflowDetailFailedStepsOne',
      'workflowDetailFailedStepsMany',
      'workflowDetailLocate',
      'workflowDetailPending',
      'workflowDetailLogsExpand',
      'workflowDetailLogsCollapse',
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

  it('styles the no-timeline detail with list, agent entry and disclosure logs', () => {
    // 摘要卡是一整行 button，hover/focus 用浅背景而不是改文字色。
    expect(css).toMatch(/\.quickforge-workflow-card\s*\{[\s\S]*?min-height:\s*1\.625rem;[\s\S]*?border:\s*0;/)
    expect(css).toMatch(/\.quickforge-workflow-card:hover,\s*\.quickforge-workflow-card:focus-visible\s*\{\s*background-color:\s*color-mix\(in oklab, var\(--muted\) 55%, transparent\);/)
    // 阶段刻度与「查看详情」入口已移除：整行是 button，运行中靠标题流光表达。
    expect(css).not.toContain('.quickforge-workflow-tick')
    expect(css).not.toContain('.quickforge-workflow-affordance')
    // 标题吃掉剩余空间，把状态/耗时推到右侧。
    expect(css).toMatch(/\.quickforge-workflow-title\s*\{[\s\S]*?margin-right:\s*auto;/)
    // 入口卡运行中的跑马灯保持单行可滚动（详情里的 Agent 行不再用它）。
    expect(css).toMatch(/\.quickforge-workflow-marquee\s*\{[\s\S]*?overflow:\s*hidden;/)
    // 根节点与滚动容器必须自己吃满宽高。
    expect(css).toMatch(/\.quickforge-workflow-detail\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-width:\s*0;[\s\S]*?min-height:\s*0;/)
    expect(css).toMatch(/\.quickforge-workflow-detail-scroll\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/)
    // 阶段头直接吸顶，不再有刻度条偏移。
    expect(css).toMatch(/\.quickforge-workflow-detail-phase-head\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;[\s\S]*?background:\s*var\(--background\);/)
    expect(css).toMatch(/\.quickforge-workflow-detail-phase-dot\s*\{[\s\S]*?border-radius:\s*999px;/)
    // Agent 行 = 22px 轻量入口，外链箭头默认弱化、hover 增强。
    expect(css).toMatch(/\.quickforge-workflow-detail-agent\s*\{[\s\S]*?min-height:\s*1\.375rem;[\s\S]*?cursor:\s*pointer;/)
    expect(css).toMatch(/\.quickforge-workflow-detail-agent-link\s*\{[\s\S]*?opacity:\s*0\.35;/)
    // 只有前置 Agent 的工具组才缩进内容列；连接线固定在 Agent 图标中心轴。
    expect(css).toMatch(/\.quickforge-workflow-detail-tools\[data-owned='true'\] > \.quickforge-workflow-detail-step\[data-kind='tool'\]\s*\{[\s\S]*?padding-left:\s*calc\(var\(--qf-detail-pad\) \+ 1\.125rem\);/)
    expect(css).toMatch(/\.quickforge-workflow-detail-tools\[data-owned='true'\] > \.quickforge-workflow-detail-step\[data-kind='tool'\]::before\s*\{[\s\S]*?left:\s*calc\(var\(--qf-detail-pad\) \+ 7px\);/)
    expect(css).toMatch(/\.quickforge-workflow-detail\s+\.quickforge-tool-summary\s*\{[\s\S]*?min-height:\s*1\.375rem;/)
    expect(css).toMatch(/\.quickforge-workflow-detail-parallel-tag\s*\{[\s\S]*?border-radius:\s*999px;/)
    // 概览失败入口与底部低强调操作。
    expect(css).toMatch(/\.quickforge-workflow-detail-failure\s*\{[\s\S]*?color:\s*var\(--destructive\);/)
    expect(css).toMatch(/\.quickforge-workflow-detail-foot\s*\{[\s\S]*?border-top:/)
    expect(css).toMatch(/\.quickforge-workflow-detail-foot\s*\{[\s\S]*?background:\s*transparent;/)
    expect(css).toMatch(/\.quickforge-workflow-detail-foot-btn\[aria-expanded='true'\]\s*\{/)
    // 日志 = 折叠行 + 时间/消息两列，不再有描边控制台。
    expect(css).toMatch(/\.quickforge-workflow-detail-logs-head\s*\{[\s\S]*?cursor:\s*pointer;/)
    expect(css).toMatch(/\.quickforge-workflow-detail-logs-body\s*\{[\s\S]*?font-family:\s*var\(--font-mono\);/)
    expect(css).not.toMatch(/\.quickforge-workflow-detail-phase-logs\s*\{[^}]*outline:/)
    // 时间轴的所有几何/样式已清理。
    expect(css).not.toContain('--wf-tl-')
    expect(css).not.toContain('quickforge-workflow-detail-axis')
    expect(css).not.toContain('quickforge-workflow-detail-bar')
    expect(css).not.toContain('quickforge-workflow-detail-legend')
    expect(css).not.toContain('quickforge-workflow-detail-now')
    expect(css).not.toContain('quickforge-workflow-detail-phase-track')
    expect(css).not.toContain('quickforge-workflow-detail-parallel-group')
    expect(css).not.toContain('quickforge-workflow-detail-grid')
    expect(css).not.toContain('quickforge-workflow-detail-row-plot')
    expect(css).not.toContain('quickforge-workflow-detail-step-body')
    // done 语义色必须在主题变量里定义；动效 token 必须用已定义的名字。
    expect(css).toMatch(/:root\s*\{[\s\S]*?--workflow-done:\s*oklch\(0\.55 0\.13 158\);/)
    expect(css).toMatch(/\.dark\s*\{[\s\S]*?--workflow-done:\s*oklch\(0\.75 0\.15 160\);/)
    expect(css).not.toContain('var(--quickforge-ease,')
    // 旧的三视图 / 聊天内展开样式必须清理干净。
    expect(css).not.toContain('.quickforge-workflow-detail-seg')
    expect(css).not.toContain('.quickforge-workflow-detail-pane')
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

  it('keeps the tool connector and log disclosure aligned without timeline layers', () => {
    // 工具连接线固定在 Agent 图标中心，只对前置 Agent 的组缩进内容列，不再移动轨道。
    expect(css).toMatch(/\.quickforge-workflow-detail-tools\[data-owned='true'\] > \.quickforge-workflow-detail-step\[data-kind='tool'\]::before\s*\{[\s\S]*?left:\s*calc\(var\(--qf-detail-pad\) \+ 7px\);[\s\S]*?width:\s*1px;/)
    expect(css).toMatch(/\.quickforge-workflow-detail-tools\[data-owned='true'\] > \.quickforge-workflow-detail-step\[data-kind='tool'\]:first-child::before\s*\{\s*top:\s*-0\.6875rem;/)
    expect(css).toMatch(/\.quickforge-workflow-detail-tools\[data-owned='true'\] > \.quickforge-workflow-detail-step\[data-kind='tool'\]:last-child::before\s*\{\s*bottom:\s*calc\(100% - 0\.6875rem\);/)
    // 阶段开头的 tool-only 组没有可归属 Agent，不缩进、不画线。
    expect(css).not.toMatch(/(?:^|\n)\.quickforge-workflow-detail-step\[data-kind='tool'\]\s*\{/)
    // 日志默认折叠，展开箭头按 aria-expanded 旋转；没有 outline 控制台。
    expect(css).toMatch(/\.quickforge-workflow-detail-logs-head\[aria-expanded='true'\] \.quickforge-tool-chevron\s*\{\s*rotate:\s*90deg;/)
    expect(css).not.toMatch(/\.quickforge-workflow-detail-phase-logs\s*\{[^}]*outline:/)
    expect(css).not.toContain('quickforge-workflow-detail-parallel-group')
    expect(css).not.toContain('--wf-tl-')
    // 定位失败步骤的描边闪烁 + reduce-motion 降级。
    expect(css).toMatch(/\.quickforge-workflow-detail-step\.is-flash\s*\{[\s\S]*?animation:\s*quickforge-workflow-step-flash/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.quickforge-workflow-detail-step\.is-flash\s*\{[\s\S]*?animation:\s*none;/)
    // 阶段索引只定义一次。
    expect(css.match(/\.quickforge-workflow-detail-phase-index \{/g)).toHaveLength(1)
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
