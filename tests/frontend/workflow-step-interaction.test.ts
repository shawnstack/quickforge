// @vitest-environment jsdom
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OPEN_SUBAGENT_RUN_EVENT, subagentRunStore } from '../../src/lib/subagent-run-detail'
import { WorkflowToolRenderer } from '../../src/lib/tool-renderers/workflow-tool-renderer'

/**
 * 工作流卡的两级展开契约：外层卡默认收起；展开后每个 Agent/工具行仍是独立
 * 的 <details>，默认收起，点击摘要只切换该行，不会把外层卡一起关掉。
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
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  it('expands the outer card and toggles each step independently', () => {
    const rendered = new WorkflowToolRenderer().render({ script: 'return 1' }, { details } as never, false)
    act(() => root.render(rendered.content as ReactNode))

    const outer = container.querySelector<HTMLDetailsElement>('details.quickforge-workflow-tool')!
    const steps = [...container.querySelectorAll<HTMLDetailsElement>('details.quickforge-workflow-step-details')]
    expect(outer).toBeTruthy()
    expect(steps).toHaveLength(2)
    expect(outer.open).toBe(false)
    expect(steps.every((step) => !step.open)).toBe(true)

    act(() => outer.querySelector('summary')!.click())
    expect(outer.open).toBe(true)

    act(() => steps[0].querySelector('summary')!.click())
    expect(steps[0].open).toBe(true)
    expect(outer.open).toBe(true)

    act(() => steps[1].querySelector('summary')!.click())
    expect(steps[1].open).toBe(true)
    expect(outer.open).toBe(true)

    act(() => steps[0].querySelector('summary')!.click())
    expect(steps[0].open).toBe(false)
    expect(steps[1].open).toBe(true)
    expect(outer.open).toBe(true)

    const opened: CustomEvent[] = []
    const listener = (event: Event) => opened.push(event as CustomEvent)
    window.addEventListener(OPEN_SUBAGENT_RUN_EVENT, listener)
    const action = steps[0].querySelector<HTMLElement>('.quickforge-workflow-step-action')!
    expect(action).toBeTruthy()
    const before = steps[0].open
    act(() => action.click())
    expect(steps[0].open).toBe(before)
    expect(opened).toHaveLength(1)
    const payload = opened[0].detail.payload
    expect(payload.runId).toBe('wf:agent:agent-1')
    expect(payload.traceMessages).toHaveLength(2)
    expect(payload.output).toBe('agent result')
    expect(subagentRunStore.get(payload.runId)?.fingerprint).toBe(payload.fingerprint)

    const bodyButton = steps[0].querySelector<HTMLButtonElement>('.quickforge-workflow-step-open')!
    expect(bodyButton.textContent).toContain('View run details')
    act(() => bodyButton.click())
    expect(opened).toHaveLength(2)
    expect(steps[0].open).toBe(before)
    window.removeEventListener(OPEN_SUBAGENT_RUN_EVENT, listener)
    subagentRunStore.clear()
  })
})
