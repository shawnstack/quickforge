import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

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
  workflowSummaryKey,
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
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
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
    expect(workflowSummaryKey(buildWorkflowRunView({ details: runningDetails }, true)!)).toBe('workflowSummaryRunning')
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
    expect(markup).toContain('quickforge-workflow-ticks')
    // 不再内联展开阶段 / Agent / 工具行 / 日志 / 结果。
    expect(markup).not.toContain('quickforge-workflow-phase')
    expect(markup).not.toContain('quickforge-workflow-tool-zone')
    expect(markup).not.toContain('quickforge-workflow-log')
    expect(markup).not.toContain('quickforge-subagent-tool')
    expect(markup).not.toContain('scanning files')
    expect(markup).not.toContain('found 2 files')
    // 入口按钮具备完整可访问语义。
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('View details')
  })

  it('draws one phase tick per phase with a status attribute', () => {
    const { markup } = render(undefined, runningDetails, true)
    expect(markup.match(/quickforge-workflow-tick"/g)?.length).toBe(2)
    expect(markup).toContain('data-status="done"')
    expect(markup).toContain('data-status="running"')
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
  it('exposes timeline, phases and logs views', () => {
    expect(detailSource).toContain("'timeline' | 'phase' | 'log'")
    expect(detailSource).toContain('workflowTimeline')
    expect(detailSource).toContain('workflowPhaseSteps')
    expect(detailSource).toContain('quickforge-workflow-detail-timeline')
    expect(detailSource).toContain('quickforge-workflow-detail-phases')
    expect(detailSource).toContain('quickforge-workflow-detail-log-list')
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
      'workflowSummaryRunning',
      'workflowSummaryDone',
      'workflowSummaryFailed',
      'workflowSummaryAborted',
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
      'workflowDetailViewTimeline',
      'workflowDetailViewPhases',
      'workflowDetailViewLogs',
      'workflowDetailPeakConcurrency',
      'workflowDetailSaved',
      'workflowDetailOpenRun',
      'workflowDetailOpened',
      'workflowDetailTimelineHint',
    ]
    for (const key of keys) {
      expect(i18n.match(new RegExp(`\\b${key}:`, 'g'))?.length ?? 0).toBeGreaterThanOrEqual(2)
    }
    expect(t('workflowSummaryDone', {
      agents: t('workflowAgentCountMany', { count: 2 }),
      tools: t('workflowToolCountOne'),
    })).toBe('Workflow completed · 2 agents · 1 tool')
    applyAppLanguageFromSnapshot('zh')
    expect(t('workflowSummaryRunning', {
      agents: t('workflowAgentCountMany', { count: 3 }),
      tools: t('workflowToolCountMany', { count: 2 }),
    })).toBe('工作流运行中 · 3 个智能体 · 2 个工具')
    expect(t('workflowAgentToolCalls', { count: 4 })).toBe('4 次工具调用')
    expect(t('workflowTabTitle', { count: 5 })).toBe('工作流 · 5 阶段')
    applyAppLanguageFromSnapshot('en')
  })

  it('styles the entry card and the detail panel with the shared tokens', () => {
    // 摘要卡是一整行 button，hover/focus 用浅背景而不是改文字色。
    expect(css).toMatch(/\.quickforge-workflow-card\s*\{[\s\S]*?min-height:\s*1\.625rem;[\s\S]*?border:\s*0;/)
    expect(css).toMatch(/\.quickforge-workflow-card:hover,\s*\.quickforge-workflow-card:focus-visible\s*\{\s*background-color:\s*color-mix\(in oklab, var\(--muted\) 55%, transparent\);/)
    // 阶段刻度是折叠态唯一的进度指示，running 用脉冲动画并有 reduced-motion 降级。
    expect(css).toMatch(/\.quickforge-workflow-tick\[data-status='running'\]\s*\{[\s\S]*?animation:/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.quickforge-workflow-tick\[data-status='running'\]\s*\{\s*animation:\s*none;/)
    // 时间轴用 DOM 百分比布局（SVG 固定 viewBox 会把字号一起缩放，导致文字过小）。
    // 根节点必须自己吃满宽高：缺 flex:1 时宽度按内容收缩（轨道被压扁），
    // 缺 min-height:0/overflow 时内容被 Inspector 的 overflow:hidden 裁掉。
    expect(css).toMatch(/\.quickforge-workflow-detail\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-width:\s*0;[\s\S]*?min-height:\s*0;/)
    expect(css).toMatch(/\.quickforge-workflow-detail-pane\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/)
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
    // 详情面板三视图与底部固定区。
    expect(css).toMatch(/\.quickforge-workflow-detail-seg button\[aria-selected='true'\]/)
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
