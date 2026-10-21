// @vitest-environment jsdom
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OPEN_SUBAGENT_RUN_EVENT, subagentRunStore, type SubagentRunI18n } from '../../src/lib/subagent-run-detail'
import { WorkflowAgentRunEventPublisher } from '../../src/lib/workflow-agent-run-events'
import { toolDetailsOpenMemory } from '../../src/lib/tool-renderers/shared'
import { WorkflowToolRenderer } from '../../src/lib/tool-renderers/workflow-tool-renderer'

/**
 * 工作流卡的交互契约：外层卡默认收起；展开后工具行是独立 <details>，
 * 默认收起，点击摘要只切换该行；Agent 行与外部 subagent 一样整行打开详情。
 */
const details = {
  workflow: true,
  runId: 'wf',
  status: 'done',
  durationMs: 1000,
  agentCount: 1,
  toolCount: 1,
  phases: [{ title: 'Phase' }],
  agents: [{
    id: 'agent-1', seq: 1, label: 'Agent one', profile: 'explore', phase: 'Phase',
    status: 'done', durationMs: 500, toolCalls: 1, promptPreview: 'do work', resultPreview: 'agent result',
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
    status: 'done', durationMs: 100, args: { path: 'a.ts' }, resultPreview: 'file content',
  }],
  logs: [],
  resultPreview: '{"ok":true}',
}

describe('workflow step interaction', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    toolDetailsOpenMemory.clear()
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  function attachWorkflowToolHost() {
    const host = container as HTMLDivElement & { toolCall?: { id?: string } }
    host.classList.add('qf-tool-message')
    host.toolCall = { id: 'run-workflow-call' }
    return host
  }

  function renderWorkflow(workflowDetails: typeof details) {
    const rendered = new WorkflowToolRenderer().render({ script: 'return 1' }, { details: workflowDetails } as never, false)
    act(() => root.render(rendered.content as ReactNode))
  }

  async function toggleDetails(detailsElement: HTMLDetailsElement) {
    await act(async () => {
      detailsElement.querySelector('summary')!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('expands the outer card and toggles each step independently', () => {
    const rendered = new WorkflowToolRenderer().render({ script: 'return 1' }, { details } as never, false)
    act(() => root.render(rendered.content as ReactNode))

    const outer = container.querySelector<HTMLDetailsElement>('details.quickforge-workflow-tool')!
    const toolSteps = [...container.querySelectorAll<HTMLDetailsElement>('.quickforge-workflow-tool-call details.quickforge-local-tool')]
    const agentButton = container.querySelector<HTMLButtonElement>('.quickforge-workflow-agent .quickforge-tool-summary')!
    expect(outer).toBeTruthy()
    expect(toolSteps).toHaveLength(1)
    expect(agentButton).toBeTruthy()
    expect(outer.open).toBe(false)
    expect(toolSteps[0].open).toBe(false)

    act(() => outer.querySelector('summary')!.click())
    expect(outer.open).toBe(true)

    act(() => toolSteps[0].querySelector('summary')!.click())
    expect(toolSteps[0].open).toBe(true)
    expect(outer.open).toBe(true)

    act(() => toolSteps[0].querySelector('summary')!.click())
    expect(toolSteps[0].open).toBe(false)
    expect(outer.open).toBe(true)

    const opened: CustomEvent[] = []
    const listener = (event: Event) => opened.push(event as CustomEvent)
    window.addEventListener(OPEN_SUBAGENT_RUN_EVENT, listener)
    act(() => agentButton.click())
    expect(toolSteps[0].open).toBe(false)
    expect(outer.open).toBe(true)
    expect(opened).toHaveLength(1)
    const payload = opened[0].detail.payload
    expect(payload.runId).toBe('wf:agent:agent-1')
    expect(payload.traceMessages).toHaveLength(2)
    expect(payload.output).toBe('agent result')
    expect(subagentRunStore.get(payload.runId)?.fingerprint).toBe(payload.fingerprint)
    window.removeEventListener(OPEN_SUBAGENT_RUN_EVENT, listener)
    subagentRunStore.clear()
  })

  it('opens the newest live running snapshot instead of a stale render-time frame', () => {
    subagentRunStore.clear()
    const tStub: SubagentRunI18n = (key) => key
    const runningDetails = {
      ...details,
      status: 'running',
      agents: [{
        ...details.agents[0],
        status: 'running',
        durationMs: 0,
        resultPreview: '',
        subagentRun: {
          ...details.agents[0].subagentRun,
          pendingToolCalls: ['call-1'],
        },
      }],
    }
    const rendered = new WorkflowToolRenderer().render({ script: 'return 1' }, { details: runningDetails } as never, true)
    act(() => root.render(rendered.content as ReactNode))
    expect(subagentRunStore.get('wf:agent:agent-1')?.traceMessages).toHaveLength(2)

    // The live publisher is ahead of the last React commit: the rendered frame
    // still has 2 messages, the store already has the longer running trace.
    const publisher = new WorkflowAgentRunEventPublisher({
      store: subagentRunStore,
      t: tStub,
      getToolDisplayMode: () => 'concise',
    })
    publisher.handleToolUpdate({
      toolCallId: 'wf',
      partialResult: {
        content: [],
        details: {
          ...runningDetails,
          agents: [{
            ...runningDetails.agents[0],
            subagentRun: {
              ...runningDetails.agents[0].subagentRun,
              messages: [
                ...runningDetails.agents[0].subagentRun.messages,
                { role: 'assistant', timestamp: 3, content: [{ type: 'text', text: 'still working' }] },
              ],
              pendingToolCalls: ['call-2'],
            },
          }],
        },
      },
    })

    const opened: CustomEvent[] = []
    const listener = (event: Event) => opened.push(event as CustomEvent)
    window.addEventListener(OPEN_SUBAGENT_RUN_EVENT, listener)
    const agentButton = container.querySelector<HTMLButtonElement>('.quickforge-workflow-agent .quickforge-tool-summary')!
    act(() => agentButton.click())

    expect(opened).toHaveLength(1)
    const payload = opened[0].detail.payload
    expect(payload.status).toBe('running')
    expect(payload.traceMessages).toHaveLength(3)
    expect(payload.pendingToolCalls).toEqual(['call-2'])
    window.removeEventListener(OPEN_SUBAGENT_RUN_EVENT, listener)
    subagentRunStore.clear()
  })

  it('repairs a stale running store from the terminal rendered result', () => {
    subagentRunStore.clear()
    const tStub: SubagentRunI18n = (key) => key
    const publisher = new WorkflowAgentRunEventPublisher({
      store: subagentRunStore,
      t: tStub,
      getToolDisplayMode: () => 'concise',
    })
    // Simulate an SSE disconnect that swallowed the workflow end frame: the
    // store is stuck on running while the persisted tool result says done.
    publisher.handleToolUpdate({
      toolCallId: 'wf',
      partialResult: {
        content: [],
        details: {
          ...details,
          status: 'running',
          agents: [{
            ...details.agents[0],
            status: 'running',
            durationMs: 0,
            resultPreview: '',
            subagentRun: {
              ...details.agents[0].subagentRun,
              pendingToolCalls: ['call-1'],
            },
          }],
        },
      },
    })
    expect(subagentRunStore.get('wf:agent:agent-1')?.status).toBe('running')

    const rendered = new WorkflowToolRenderer().render({ script: 'return 1' }, { details } as never, false)
    act(() => root.render(rendered.content as ReactNode))
    const repaired = subagentRunStore.get('wf:agent:agent-1')
    expect(repaired?.status).toBe('done')
    expect(repaired?.output).toBe('agent result')

    const opened: CustomEvent[] = []
    const listener = (event: Event) => opened.push(event as CustomEvent)
    window.addEventListener(OPEN_SUBAGENT_RUN_EVENT, listener)
    const agentButton = container.querySelector<HTMLButtonElement>('.quickforge-workflow-agent .quickforge-tool-summary')!
    act(() => agentButton.click())

    expect(opened).toHaveLength(1)
    const payload = opened[0].detail.payload
    expect(payload.status).toBe('done')
    expect(payload.output).toBe('agent result')
    window.removeEventListener(OPEN_SUBAGENT_RUN_EVENT, listener)
    subagentRunStore.clear()
  })

  it('keeps inner tool rows collapsed after the outer card is opened', async () => {
    attachWorkflowToolHost()
    toolDetailsOpenMemory.clear()
    renderWorkflow(details)

    const outer = container.querySelector<HTMLDetailsElement>('details.quickforge-workflow-tool')!
    expect(outer.open).toBe(false)
    await toggleDetails(outer)
    expect(outer.open).toBe(true)
    expect(toolDetailsOpenMemory.get('run-workflow-call')).toBe(true)

    // The next snapshot adds a step; neither the existing row nor the new one
    // may inherit the outer card's remembered open state.
    renderWorkflow({
      ...details,
      toolCount: 2,
      tools: [
        ...details.tools,
        {
          id: 'tool-2', seq: 3, name: 'write_file', label: 'write file', phase: 'Phase',
          status: 'done', durationMs: 100, args: { path: 'b.ts' }, resultPreview: 'written',
        },
      ],
    })
    const rows = [...container.querySelectorAll<HTMLDetailsElement>('.quickforge-workflow-tool-call details.quickforge-local-tool')]
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.open)).toEqual([false, false])
  })

  it('keeps inner row memory isolated from the outer card across remounts', async () => {
    attachWorkflowToolHost()
    toolDetailsOpenMemory.clear()
    renderWorkflow(details)

    const row = container.querySelector<HTMLDetailsElement>('.quickforge-workflow-tool-call details.quickforge-local-tool')!
    await toggleDetails(row)
    expect(row.open).toBe(true)
    expect(toolDetailsOpenMemory.get('workflow:wf:tool:tool-1')).toBe(true)
    expect(toolDetailsOpenMemory.get('run-workflow-call')).not.toBe(true)

    act(() => root.render(null))
    renderWorkflow(details)
    const outer = container.querySelector<HTMLDetailsElement>('details.quickforge-workflow-tool')!
    const remountedRow = container.querySelector<HTMLDetailsElement>('.quickforge-workflow-tool-call details.quickforge-local-tool')!
    expect(outer.open).toBe(false)
    expect(remountedRow.open).toBe(true)
  })
})
