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
  workflowStatusLabelKey,
  workflowSummaryKey,
} from '../../src/lib/workflow-run-detail'
import { WorkflowToolRenderer } from '../../src/lib/tool-renderers/workflow-tool-renderer'
import { buildWorkflowSubagentRunPayload } from '../../src/lib/workflow-subagent-detail'

const source = readFileSync(new URL('../../src/lib/tool-renderers/workflow-tool-renderer.tsx', import.meta.url), 'utf8')
const viewSource = readFileSync(new URL('../../src/lib/workflow-run-detail.ts', import.meta.url), 'utf8')
const localTools = readFileSync(new URL('../../src/lib/local-tools.ts', import.meta.url), 'utf8')
const shared = readFileSync(new URL('../../src/lib/tool-renderers/shared.tsx', import.meta.url), 'utf8')
const index = readFileSync(new URL('../../src/lib/tool-renderers/index.ts', import.meta.url), 'utf8')
const titleRefresh = readFileSync(new URL('../../src/lib/title-git-status-refresh.ts', import.meta.url), 'utf8')
const approvalCard = readFileSync(new URL('../../src/components/chat/panel-decoration/approval-card.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
const i18n = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')

applyAppLanguageFromSnapshot('en')

const runningDetails = {
  workflow: true,
  runId: 'tool-1',
  status: 'running',
  durationMs: 4200,
  maxAgents: 8,
  concurrency: 2,
  phases: [
    { title: 'Scan', startedAt: 1 },
    { title: 'Fix', startedAt: 2 },
  ],
  agents: [
    { id: 'agent-1', seq: 1, label: 'Scan src', profile: 'explore', phase: 'Scan', status: 'done', durationMs: 1200, toolCalls: 3, promptPreview: 'scan the source', resultPreview: 'found 2 files' },
    { id: 'agent-2', seq: 3, label: 'Fix bug', profile: 'general', phase: 'Fix', status: 'running', durationMs: 3000, toolCalls: 1, promptPreview: 'fix the bug' },
    { id: 'agent-3', seq: 5, label: 'Review', profile: 'explore', phase: 'Fix', status: 'queued', promptPreview: 'review the fix' },
  ],
  tools: [
    { id: 'tool-1', seq: 2, name: 'read_file', label: 'read src', phase: 'Scan', status: 'done', durationMs: 500, args: { path: 'src/a.ts' }, resultPreview: 'file content' },
    { id: 'tool-2', seq: 4, name: 'write_file', label: 'write fix', phase: 'Fix', status: 'running', durationMs: 2000, args: { path: 'src/b.ts' }, resultPreview: '' },
  ],
  logs: [
    { at: 1, phase: 'Scan', message: 'scanning files', level: 'info' },
    { at: 2, phase: 'Fix', message: 'first attempt failed', level: 'error' },
  ],
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
    if (!view) throw new Error('expected a workflow view')
    expect(workflowActiveStepLabels(view)).toEqual(['Fix bug', 'write fix', 'Review'])
    expect(workflowCurrentPhase(view)).toBe('Fix')
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

describe('workflow tool renderer', () => {
  it('renders collapsible agent/tool rows and keeps their bodies closed by default', () => {
    const { markup } = render({ script: 'return 1' }, runningDetails, true)
    expect(markup).toContain('Workflow running · 3 agents · 2 tools')
    expect(markup).toContain('quickforge-workflow-agent--running')
    expect(markup).toContain('Scan src')
    expect(markup).toContain('Fix bug')
    expect(markup).toContain('Review')
    expect(markup).toContain('read src')
    expect(markup).toContain('write fix')
    expect(markup).toContain('quickforge-subagent-tool')
    expect(markup).toContain('quickforge-local-tool')
    expect(markup).toContain('quickforge-tool-chevron')
    expect(markup).not.toContain('open=""')
    expect(markup).toContain('src/a.ts')
    expect(markup).toContain('file content')
    expect(markup).toContain('scanning files')
    expect(markup).toContain('quickforge-workflow-log--error')
    expect(markup).toContain('first attempt failed')
    expect(markup).not.toContain('found 2 files')
    expect(markup).not.toContain('scan the source')
  })

  it('renders the completed result, error and schema marker', () => {
    const { markup } = render(undefined, {
      ...runningDetails,
      status: 'done',
      resultPreview: '{"answer":42}',
      agents: [
        { id: 'agent-1', label: 'Structured', profile: 'general', phase: 'Fix', status: 'done', durationMs: 1000, toolCalls: 2, schemaValidated: true, resultPreview: '{"answer":42}' },
      ],
    }, false)
    expect(markup).toContain('Workflow completed · 1 agent · 2 tools')
    expect(markup).toContain('schema validated')
    expect(markup).toContain('quickforge-workflow-result-section')
    expect(markup).toContain('Result')
    expect(markup).toContain('&quot;answer&quot;:42')
    expect(markup).not.toMatch(/<details class="quickforge-workflow-result-section"[^>]*open/)
  })

  it('renders a failure alert and the preparing fallback', () => {
    const failed = render(undefined, { ...runningDetails, status: 'error', error: 'worker crashed' }, false)
    expect(failed.markup).toContain('worker crashed')
    expect(failed.markup).toContain('quickforge-workflow-error')
    const preparing = new WorkflowToolRenderer().render(undefined, undefined, true)
    const preparingMarkup = renderToStaticMarkup(preparing.content as ReactElement)
    expect(preparingMarkup).toContain('Preparing workflow')

    const rejected = new WorkflowToolRenderer().render(undefined, {
      isError: true,
      content: [{ type: 'text', text: 'User rejected run_workflow' }],
    }, false)
    const rejectedMarkup = renderToStaticMarkup(rejected.content as ReactElement)
    expect(rejectedMarkup).toContain('User rejected run_workflow')
    expect(rejectedMarkup).toContain('quickforge-workflow-error')
    expect(rejectedMarkup).not.toContain('Preparing workflow')
  })

  it('gates the script, tool params and raw details behind detailed mode', () => {
    const compact = render({ script: 'return 1' }, runningDetails, true, false)
    expect(compact.markup).not.toContain('Script')
    expect(compact.markup).not.toContain('>Input<')
    expect(compact.markup).not.toContain('Details')
    expect(compact.markup).not.toContain('scan the source')
    expect(compact.markup).not.toContain('found 2 files')
    expect(compact.markup).toContain('file content')

    const detailed = render({ script: 'return 1' }, runningDetails, true, true)
    expect(detailed.markup).toContain('Script')
    expect(detailed.markup).toContain('>Input<')
    expect(detailed.markup).toContain('Details')
    expect(detailed.markup).toContain('scan the source')
    expect(detailed.markup).toContain('found 2 files')
    expect(detailed.markup.match(/qf-code-block/g)?.length ?? 0)
      .toBeGreaterThan(compact.markup.match(/qf-code-block/g)?.length ?? 0)
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
      'workflowResultTruncated',
      'workflowScript',
      'workflowBadge',
      'toolApprovalRiskWorkflow',
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
    applyAppLanguageFromSnapshot('en')
  })

  it('styles phase, agent, log and result sections with bounded scrolling', () => {
    expect(css).toMatch(/\.quickforge-workflow-result\s*\{[\s\S]*?max-height:\s*16rem;[\s\S]*?overflow:\s*auto;/)
    expect(css).toMatch(/\.quickforge-workflow-log--error\s*\{\s*color:\s*var\(--destructive\);/)
    expect(css).toMatch(/\.quickforge-workflow-tool > div,[\s\S]*?calc\(var\(--quickforge-message-font-size, 14px\) \* 0\.8\)/)
    expect(css).not.toContain('quickforge-workflow-step-summary')
    expect(css).not.toContain('quickforge-workflow-agent-dot')
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
    expect(source).toContain('buildWorkflowRunView')
    expect(source).toContain('summarizeParams')
    expect(source).toContain('quickforge-local-tool')
    // Agent 行复用 run_subagent 的摘要卡函数，而不是再写一份 quickforge-subagent-tool 标记。
    expect(source).toContain('renderSubagentRunSummary')
    expect(source).toContain("renderToolIcon('run_workflow')")
    expect(source).toContain('quickforge-workflow-marquee')
  })
})
