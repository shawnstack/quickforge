// @vitest-environment jsdom
import { act, createElement } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OPEN_SUBAGENT_RUN_EVENT, subagentRunStore } from '../../src/lib/subagent-run-detail'
import { WorkflowAgentRunEventPublisher } from '../../src/lib/workflow-agent-run-events'
import {
  OPEN_WORKFLOW_RUN_EVENT,
  activeWorkflowRunStore,
  buildWorkflowRunPayload,
  workflowRunStore,
} from '../../src/lib/workflow-run-payload'
import { buildWorkflowRunView } from '../../src/lib/workflow-run-detail'
import { WorkflowToolRenderer } from '../../src/lib/tool-renderers/workflow-tool-renderer'
import { WorkflowRunDetailContent } from '../../src/components/workspace/WorkflowRunDetailContent'

/**
 * 工作流卡的交互契约：聊天区只有一行入口（button，不是 <details>），点击派发
 * `quickforge:open-workflow-run` 并携带已回填的载荷；详情面板状态通过
 * `activeWorkflowRunStore` 回显为「已打开」。
 */
const details = {
  workflow: true,
  runId: 'wf',
  status: 'done',
  startedAt: 1_000,
  durationMs: 1_000,
  agentCount: 1,
  toolCount: 1,
  phases: [{ title: 'Phase' }],
  agents: [{
    id: 'agent-1', seq: 1, label: 'Agent one', profile: 'explore', phase: 'Phase',
    status: 'done', startedAt: 1_000, durationMs: 500, toolCalls: 1,
    promptPreview: 'do work', resultPreview: 'agent result',
    subagentRun: {
      messages: [
        { role: 'assistant', timestamp: 1, content: [{ type: 'text', text: 'working' }, { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } }] },
        { role: 'toolResult', timestamp: 2, toolCallId: 'call-1', toolName: 'read_file', content: [{ type: 'text', text: 'file body' }] },
      ],
      tools: [{ name: 'read_file', label: 'Read file' }],
      allowedTools: ['read_file'],
      pendingToolCalls: [],
      toolCalls: 1,
      durationMs: 500,
    },
  }],
  tools: [{
    id: 'tool-1', seq: 2, name: 'read_file', label: 'read file', phase: 'Phase',
    status: 'done', startedAt: 1_200, durationMs: 100, args: { path: 'a.ts' }, resultPreview: 'file content',
  }],
  logs: [],
  resultPreview: '{"ok":true}',
}

describe('workflow card interaction', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    workflowRunStore.clear()
    activeWorkflowRunStore.set(undefined)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    workflowRunStore.clear()
    activeWorkflowRunStore.set(undefined)
    subagentRunStore.clear()
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  function renderWorkflow(workflowDetails: typeof details, streaming = false) {
    const rendered = new WorkflowToolRenderer().render({ script: 'return 1' }, { details: workflowDetails } as never, streaming)
    act(() => root.render(rendered.content as ReactNode))
  }

  it('renders a single-line entry with no inline expansion', () => {
    renderWorkflow(details)
    const card = container.querySelector<HTMLButtonElement>('.quickforge-workflow-card')
    expect(card).toBeTruthy()
    expect(card?.tagName).toBe('BUTTON')
    expect(card?.getAttribute('aria-expanded')).toBe('false')
    // 内联阶段 / Agent / 工具行 / 结果区都不再渲染。
    expect(container.querySelector('.quickforge-workflow-phase')).toBeNull()
    expect(container.querySelector('.quickforge-workflow-tool-zone')).toBeNull()
    expect(container.querySelector('.quickforge-workflow-agent')).toBeNull()
    expect(container.querySelector('.quickforge-workflow-result-section')).toBeNull()
    // 摘要卡整行可点，不再有阶段刻度与「查看详情」入口。
    expect(container.querySelectorAll('.quickforge-workflow-tick')).toHaveLength(0)
    expect(container.querySelector('.quickforge-workflow-affordance')).toBeNull()
  })

  it('publishes the run to the store and dispatches the open event on click', () => {
    renderWorkflow(details)
    const opened: CustomEvent[] = []
    const listener = (event: Event) => opened.push(event as CustomEvent)
    window.addEventListener(OPEN_WORKFLOW_RUN_EVENT, listener)

    const card = container.querySelector<HTMLButtonElement>('.quickforge-workflow-card')!
    act(() => card.click())

    expect(opened).toHaveLength(1)
    const detail = opened[0].detail as { runId: string; payload: { runId: string; view: { status: string }; script: string } }
    expect(detail.runId).toBe('wf')
    expect(detail.payload.runId).toBe('wf')
    expect(detail.payload.view.status).toBe('done')
    expect(detail.payload.script).toBe('return 1')
    // 点击时把渲染帧回填进 store，历史会话首帧也能打开完整详情。
    expect(workflowRunStore.get('wf')?.runId).toBe('wf')
    window.removeEventListener(OPEN_WORKFLOW_RUN_EVENT, listener)
  })

  it('renders without a script when the args omit it', () => {
    const rendered = new WorkflowToolRenderer().render(undefined, { details } as never, false)
    act(() => root.render(rendered.content as ReactNode))
    expect(workflowRunStore.get('wf')?.script).toBe('')
  })

  it('reflects the opened state from activeWorkflowRunStore', () => {
    renderWorkflow(details)
    const card = container.querySelector<HTMLButtonElement>('.quickforge-workflow-card')!
    expect(card.dataset.open).toBe('false')
    // 「查看详情 / 已打开」只进 aria-label（可访问名称），不再占视觉位。
    expect(card.textContent).not.toContain('View details')
    expect(card.getAttribute('aria-label')).toContain('View details')

    act(() => activeWorkflowRunStore.set('wf'))
    expect(card.dataset.open).toBe('true')
    expect(card.getAttribute('aria-expanded')).toBe('true')
    expect(card.getAttribute('aria-label')).toContain('Opened')

    act(() => activeWorkflowRunStore.set(undefined))
    expect(card.dataset.open).toBe('false')
  })

  it('re-publishes a newer live snapshot only when it is fresher', () => {
    renderWorkflow({ ...details, status: 'running', durationMs: 200 })
    const first = workflowRunStore.get('wf')
    expect(first?.view.status).toBe('running')

    // 终态帧覆盖运行中帧。
    renderWorkflow(details)
    expect(workflowRunStore.get('wf')?.view.status).toBe('done')

    // 迟到的运行中帧不得回退已终态的快照。
    renderWorkflow({ ...details, status: 'running', durationMs: 999 })
    expect(workflowRunStore.get('wf')?.view.status).toBe('done')
  })
})

describe('workflow agent details from the panel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    subagentRunStore.clear()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    subagentRunStore.clear()
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  it('keeps the newest live agent snapshot available for the panel drill-down', () => {
    const publisher = new WorkflowAgentRunEventPublisher({
      store: subagentRunStore,
      t: (key) => key,
      getToolDisplayMode: () => 'concise',
    })
    publisher.handleToolStart({ toolCallId: 'wf', toolName: 'run_workflow', partialResult: { content: [], details } })
    expect(subagentRunStore.get('wf:agent:agent-1')?.traceMessages).toHaveLength(2)

    publisher.handleToolUpdate({
      toolCallId: 'wf',
      partialResult: {
        content: [],
        details: {
          ...details,
          agents: [{
            ...details.agents[0],
            subagentRun: {
              ...details.agents[0].subagentRun,
              messages: [
                ...details.agents[0].subagentRun!.messages,
                { role: 'assistant', timestamp: 3, content: [{ type: 'text', text: 'still working' }] },
              ],
            },
          }],
        },
      },
    })
    // store 保留最新快照，面板里的「运行详情 ↗」直接复用，不再另建通道。
    expect(subagentRunStore.get('wf:agent:agent-1')?.traceMessages).toHaveLength(3)
    publisher.dispose()
  })

  it('publishes queued agents as pending agent runs', () => {
    const publisher = new WorkflowAgentRunEventPublisher({
      store: subagentRunStore,
      t: (key) => key,
      getToolDisplayMode: () => 'concise',
    })
    publisher.handleToolUpdate({
      toolCallId: 'wf',
      partialResult: {
        content: [],
        details: {
          ...details,
          agents: [{ ...details.agents[0], status: 'queued', subagentRun: undefined }],
        },
      },
    })
    // queued 与 running 同属「未完成」，载荷照常发布供卡片显示进度。
    expect(subagentRunStore.get('wf:agent:agent-1')?.status).toBe('running')
    publisher.dispose()
  })

  it('does not use the subagent open event for the workflow card', () => {
    const rendered = new WorkflowToolRenderer().render({ script: 'return 1' }, { details } as never, false)
    act(() => root.render(rendered.content as ReactNode))
    const opened: Event[] = []
    const listener = (event: Event) => opened.push(event)
    window.addEventListener(OPEN_SUBAGENT_RUN_EVENT, listener)
    act(() => container.querySelector<HTMLButtonElement>('.quickforge-workflow-card')!.click())
    expect(opened).toHaveLength(0)
    window.removeEventListener(OPEN_SUBAGENT_RUN_EVENT, listener)
  })
})

describe('workflow detail agent entry', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    subagentRunStore.clear()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    subagentRunStore.clear()
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  function renderDetail(agentStatus: 'done' | 'queued', script = '') {
    const detail = {
      ...details,
      agents: [{
        ...details.agents[0],
        status: agentStatus,
        subagentRun: agentStatus === 'queued' ? undefined : details.agents[0].subagentRun,
      }],
    }
    const view = buildWorkflowRunView({ details: detail }, false)
    if (!view) throw new Error('expected workflow view')
    const payload = buildWorkflowRunPayload({ runId: view.runId, view, script, detailed: true })
    act(() => {
      root.render(createElement(WorkflowRunDetailContent, { payload }))
    })
    return view
  }

  it('opens the corresponding subagent run without rendering its process inline', () => {
    renderDetail('done')
    const agent = container.querySelector<HTMLButtonElement>('.quickforge-workflow-detail-agent')
    expect(agent).toBeTruthy()
    expect(agent?.disabled).toBe(false)
    // 只做入口：没有 chat 摘要卡、当前工具跑马灯或内部 trace。
    expect(container.querySelector('.quickforge-subagent-tool')).toBeNull()
    expect(container.querySelector('.quickforge-subagent-marquee')).toBeNull()

    const opened: CustomEvent[] = []
    const listener = (event: Event) => opened.push(event as CustomEvent)
    window.addEventListener(OPEN_SUBAGENT_RUN_EVENT, listener)
    act(() => agent!.click())

    expect(opened).toHaveLength(1)
    const detail = opened[0].detail as { runId: string; payload?: { runId: string } }
    expect(detail.runId).toBe('wf:agent:agent-1')
    expect(detail.payload?.runId).toBe('wf:agent:agent-1')
    expect(subagentRunStore.get('wf:agent:agent-1')?.runId).toBe('wf:agent:agent-1')
    window.removeEventListener(OPEN_SUBAGENT_RUN_EVENT, listener)
  })

  it('keeps queued agents disabled and does not open the run', () => {
    renderDetail('queued')
    const agent = container.querySelector<HTMLButtonElement>('.quickforge-workflow-detail-agent')
    expect(agent).toBeTruthy()
    expect(agent?.disabled).toBe(true)

    const opened: Event[] = []
    const listener = (event: Event) => opened.push(event)
    window.addEventListener(OPEN_SUBAGENT_RUN_EVENT, listener)
    act(() => agent!.click())
    expect(opened).toHaveLength(0)
    window.removeEventListener(OPEN_SUBAGENT_RUN_EVENT, listener)
  })

  it('opens the script sheet by default and closes it from the footer', () => {
    renderDetail('done', 'return 1')
    const toggle = container.querySelector<HTMLButtonElement>('[aria-controls="quickforge-workflow-detail-script-sheet"]')
    expect(toggle).toBeTruthy()
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('#quickforge-workflow-detail-script-sheet')).toBeTruthy()
    expect(container.textContent).toContain('return 1')

    act(() => toggle!.click())
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('#quickforge-workflow-detail-script-sheet')).toBeNull()
  })
})

// 保持 vitest 的未使用导入告警安静：vi 在部分环境里用于 mock 前置准备。
void vi
