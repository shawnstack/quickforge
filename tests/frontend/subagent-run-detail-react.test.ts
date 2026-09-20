import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubagentRunPayload } from '../../src/lib/subagent-run-detail'

// The removed UI runtime is uninstalled, so its absence is enforced by the
// module graph itself (an import would no longer resolve). The structural
// assertions below keep the contract: only real React DOM, never custom elements.
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/lib/tool-display-settings', () => ({ getCachedToolDisplaySettings: () => ({ toolDisplayMode: 'concise' }) }))

import { SubagentRunDetailContent } from '../../src/components/workspace/SubagentRunDetailContent'
import { getLocalWorkspaceTools } from '../../src/lib/local-tools'
import { SubagentRunStore } from '../../src/lib/subagent-run-detail'
import { updateSubagentRunTab } from '../../src/components/workspace/workspace-inspector-tabs'
import type { WorkspacePanelTab } from '../../src/components/workspace/workspace-inspector-tabs'

function payload(overrides: Partial<SubagentRunPayload> = {}): SubagentRunPayload {
  return {
    runId: 'run-main', canonicalToolCallId: 'run-main', name: 'explore', label: 'Explore', task: 'Read project',
    context: 'Keep focus', expectedOutput: 'Report findings', status: 'running', statusLabel: 'Running',
    allowedTools: ['run_command'], pendingToolCalls: ['cmd'], tools: [], traceMessages: [],
    input: '{"task":"Read project"}', details: '{"toolCalls":1}', output: '', errorMessage: '',
    detailed: false, fingerprint: 'initial', ...overrides,
  }
}

function trace(text: string, log: string) {
  return [
    { role: 'assistant', content: [{ type: 'text', text }, { type: 'toolCall', id: 'cmd', name: 'run_command', arguments: { command: 'npm test' } }], timestamp: 1, stopReason: 'toolUse' },
    { role: 'toolResult', toolCallId: 'cmd', toolName: 'run_command', isError: false, timestamp: 2, content: [{ type: 'text', text: log }] },
  ]
}
const render = (value?: SubagentRunPayload) => renderToStaticMarkup(createElement(SubagentRunDetailContent, { payload: value }))

beforeEach(() => { getLocalWorkspaceTools() })

describe('React subagent detail', () => {
  it('renders the empty state without custom-element hosts', () => {
    expect(render()).toContain('subagentRunEmpty')
    expect(render()).not.toContain('subagent-run-detail-body')
  })

  it('renders task fields, metadata, markdown messages and command logs as real DOM', () => {
    const markup = render(payload({ model: { mode: 'fixed', name: 'Local model' }, thinkingLevel: 'high', traceMessages: trace('**Read complete**', 'STDOUT: all passed') }))
    expect(markup).toContain('Local model')
    expect(markup).toContain('thinkingHigh')
    expect(markup).toContain('Read project')
    expect(markup).toContain('Keep focus')
    expect(markup).toContain('Report findings')
    expect(markup).toContain('<strong>Read complete</strong>')
    expect(markup).toContain('STDOUT: all passed')
    expect(markup).toContain('qf-console-block')
    expect(markup).toContain('qf-message-list')
    expect(markup).toContain('data-quickforge-subagent-streaming="true"')
    expect(markup).toContain('quickforge-subagent-trace p-2.5')
    expect(markup).not.toMatch(/<(message-list|code-block|console-block|quickforge-react-tool-content)\b/)
  })

  it('keeps pending tools visible while running and exposes detailed inputs and timing', () => {
    const markup = render(payload({ detailed: true, toolCalls: 1, timing: { startedAt: 1, durationMs: 2000 }, traceMessages: trace('Working', 'partial log').slice(0, 1) }))
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('npm test')
    expect(markup).toContain('subagentToolCalls')
    expect(markup).toContain('duration-ms="2000"')
    expect(markup).toContain('qf-code-block')
    expect(markup).toContain('&quot;toolCalls&quot;')
  })

  it('renders escaped output and one translated error instead of duplicate trace errors', () => {
    const markup = render(payload({ status: 'error', errorSource: 'trace', errorMessage: 'fetch failed', output: '<script>raw log</script>', traceMessages: [{ role: 'assistant', content: [], stopReason: 'error', errorMessage: 'fetch failed', timestamp: 1 }] }))
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('errorFetchFailed')
    expect(markup).not.toContain('fetch failed')
    expect(markup).toContain('&lt;script&gt;raw log&lt;/script&gt;')
    expect(markup).not.toContain('<script>')
    expect(render(payload({ status: 'error' }))).toContain('subagentErrorUnavailable')
  })

  it('updates matching subscribed tabs and React messages without touching another run; unsubscribe stops updates', () => {
    const store = new SubagentRunStore()
    const main = payload({ traceMessages: trace('main before', 'main log') })
    const side = payload({ runId: 'run-side', canonicalToolCallId: 'run-side', traceMessages: trace('side before', 'side log') })
    let tabs: WorkspacePanelTab[] = [
      { id: 'main', kind: 'subagent', subagentRun: main },
      { id: 'side', kind: 'subagent', subagentRun: side },
    ]
    const unsubscribe = store.subscribe((value) => { tabs = updateSubagentRunTab(tabs, value) })
    const completed = { ...main, status: 'done' as const, fingerprint: 'completed', pendingToolCalls: [], traceMessages: trace('main after', 'finished log') }
    store.publish(completed)
    expect(render(tabs[0].subagentRun)).toContain('main after')
    expect(render(tabs[0].subagentRun)).not.toContain('main before')
    expect(render(tabs[0].subagentRun)).toContain('data-subagent-status="done"')
    expect(tabs[1].subagentRun).toBe(side)
    expect(render(tabs[1].subagentRun)).not.toContain('finished log')
    unsubscribe()
    const previous = tabs
    store.publish({ ...completed, fingerprint: 'ignored', traceMessages: trace('after unmount', '') })
    expect(tabs).toBe(previous)
  })
})
