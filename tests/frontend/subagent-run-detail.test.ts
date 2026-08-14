import { describe, expect, it } from 'vitest'
import type { SubagentRunI18n, SubagentRunStatus } from '../../src/lib/subagent-run-detail'
import {
  buildSubagentRunPayload,
  normalizeOpenSubagentRunRequest,
  subagentRunBodyBlocks,
  subagentRunFingerprint,
  subagentRunId,
} from '../../src/lib/subagent-run-detail'

// i18n 由调用方注入：这里用与真实 t 相同形状的 stub（避免测试环境加载 i18n→pdfjs 链路）。
const t: SubagentRunI18n = (key, params) => {
  if (key === 'subagentRunning') return `${params?.name ?? ''} running`
  if (key === 'subagentCompleted') return `${params?.name ?? ''} completed`
  if (key === 'subagentFailed') return `${params?.name ?? ''} failed`
  if (key === 'subagentGeneral') return 'General'
  if (key === 'subagentExplore') return 'Explore'
  return 'Run subagent'
}

describe('subagent run detail payload', () => {
  it('uses details.sessionId as the stable run id', () => {
    const payload = buildSubagentRunPayload(
      { subagent: 'explore', task: 'Find the entry point' },
      {
        details: {
          subagent: 'explore',
          label: 'Explore',
          sessionId: 'parent:subagent:explore:abc-123',
          toolCalls: 3,
          allowedTools: ['read_file', 'grep_files'],
          messages: [
            { role: 'assistant', content: [{ type: 'text', text: 'Plan' }] },
            { role: 'toolResult', toolCallId: 'missing', content: [] },
          ],
          tools: [],
          pendingToolCalls: ['tool-1'],
        },
        content: [{ type: 'text', text: 'Done exploring' }],
      },
      false,
      'detailed',
      t,
    )

    expect(payload.runId).toBe('parent:subagent:explore:abc-123')
    expect(payload.name).toBe('explore')
    expect(payload.label).toBe('Explore')
    expect(payload.status).toBe('done')
    expect(payload.statusLabel).toBe('Explore completed')
    expect(payload.toolCalls).toBe(3)
    expect(payload.allowedTools).toEqual(['read_file', 'grep_files'])
    expect(payload.output).toBe('Done exploring')
    expect(payload.detailed).toBe(true)
    // trace 过滤：无对应 toolCall 的 toolResult 被丢弃，只保留 assistant 消息
    expect(payload.traceMessages).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'Plan' }] },
    ])
    expect(payload.pendingToolCalls).toEqual(['tool-1'])
  })

  it('falls back to name:task when sessionId is missing (old messages)', () => {
    const payload = buildSubagentRunPayload(
      { subagent: 'general', task: 'Summarize' },
      { details: { label: 'General' }, content: [] },
      false,
      'concise',
      t,
    )
    expect(payload.runId).toBe('general:Summarize')
    expect(payload.detailed).toBe(false)
  })

  it('treats streaming runs as running', () => {
    const payload = buildSubagentRunPayload(
      { subagent: 'explore', task: 'T' },
      { details: { subagent: 'explore' } },
      true,
      'concise',
      t,
    )
    expect(payload.status).toBe('running')
  })

  it('marks aborted or errored runs as error', () => {
    const aborted = buildSubagentRunPayload(
      { subagent: 'explore', task: 'T' },
      { isError: true, details: { aborted: true } },
      false,
      'concise',
      t,
    )
    expect(aborted.status).toBe('error')
  })

  it('treats a tool call without a result as called', () => {
    const called = buildSubagentRunPayload(
      { subagent: 'explore', task: 'T' },
      undefined,
      false,
      'concise',
      t,
    )
    expect(called.status).toBe('called')
  })

  it('preserves the trace timeline order and keeps every mapped result in place', () => {
    const plan = { role: 'assistant', content: [{ type: 'text', text: 'Plan' }] }
    const firstTool = {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'tool-a', name: 'read_file', arguments: {} }],
    }
    const firstResult = { role: 'toolResult', toolCallId: 'tool-a', content: [] }
    const secondTool = {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'tool-b', name: 'edit_file', arguments: {} }],
    }
    const secondResult = { role: 'toolResult', toolCallId: 'tool-b', content: [] }
    const summary = { role: 'assistant', content: [{ type: 'text', text: 'Done' }] }

    const payload = buildSubagentRunPayload(
      { subagent: 'explore', task: 'Find' },
      {
        details: {
          subagent: 'explore',
          sessionId: 'run-with-tools',
          messages: [
            plan,
            firstTool,
            firstResult,
            { role: 'toolResult', toolCallId: 'orphan', content: [] },
            secondTool,
            secondResult,
            summary,
          ],
          tools: [],
          pendingToolCalls: [],
        },
        content: [],
      },
      false,
      'detailed',
      t,
    )
    // 无对应 toolCall 的孤儿结果被丢弃，其余严格保持时间线顺序。
    expect(payload.traceMessages).toEqual([plan, firstTool, firstResult, secondTool, secondResult, summary])
  })

  it('always computes input/details JSON for panel display', () => {
    const payload = buildSubagentRunPayload(
      { subagent: 'explore', task: 'Find' },
      { details: { subagent: 'explore', toolCalls: 1 }, content: [] },
      false,
      'concise',
      t,
    )
    expect(payload.input).toContain('"Find"')
    expect(payload.details).toContain('"toolCalls"')
  })
})

describe('subagentRunId', () => {
  it('prefers sessionId', () => {
    expect(subagentRunId({ sessionId: 'run-1' }, 'explore', 'T')).toBe('run-1')
  })

  it('falls back to name:task', () => {
    expect(subagentRunId({}, 'general', 'Do work')).toBe('general:Do work')
  })

  it('returns empty string when nothing is available', () => {
    expect(subagentRunId(undefined, '', '')).toBe('')
  })
})

describe('subagentRunFingerprint', () => {
  function basePayload() {
    return {
      runId: 'run-1',
      name: 'explore',
      label: 'Explore',
      task: 'T',
      context: '',
      expectedOutput: '',
      status: 'running' as SubagentRunStatus,
      statusLabel: 'Explore running',
      timing: { durationMs: 100 },
      toolCalls: 1,
      allowedTools: ['read_file'],
      traceMessages: [],
      tools: [],
      pendingToolCalls: [],
      input: '',
      details: '',
      output: '',
      detailed: false,
    }
  }

  it('changes when status/toolCalls/messages change', () => {
    const a = subagentRunFingerprint(basePayload())
    const b = subagentRunFingerprint({ ...basePayload(), toolCalls: 2 })
    const c = subagentRunFingerprint({
      ...basePayload(),
      traceMessages: [{ role: 'assistant', content: [{ type: 'text', text: 'New message' }] }],
    })
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })

  it('changes when same-length text content changes in trace/details/output', () => {
    const outputA = subagentRunFingerprint({ ...basePayload(), output: 'ab' })
    const outputB = subagentRunFingerprint({ ...basePayload(), output: 'cd' })
    expect(outputA).not.toBe(outputB)

    const detailsA = subagentRunFingerprint({ ...basePayload(), details: '{"a":1}' })
    const detailsB = subagentRunFingerprint({ ...basePayload(), details: '{"b":2}' })
    expect(detailsA).not.toBe(detailsB)

    const traceA = subagentRunFingerprint({
      ...basePayload(),
      traceMessages: [{ role: 'assistant', content: [{ type: 'text', text: 'aaaa' }] }],
    })
    const traceB = subagentRunFingerprint({
      ...basePayload(),
      traceMessages: [{ role: 'assistant', content: [{ type: 'text', text: 'bbbb' }] }],
    })
    expect(traceA).not.toBe(traceB)
  })

  it('changes when visible metadata changes', () => {
    const baseline = subagentRunFingerprint(basePayload())
    const variants = [
      { ...basePayload(), label: 'Updated Explore' },
      { ...basePayload(), task: 'Updated task' },
      { ...basePayload(), context: 'Updated context' },
      { ...basePayload(), expectedOutput: 'Updated output expectation' },
      { ...basePayload(), allowedTools: ['grep_files'] },
      { ...basePayload(), tools: [{ name: 'grep_files' }] },
      { ...basePayload(), pendingToolCalls: ['tool-1'] },
      { ...basePayload(), detailed: true },
    ]
    variants.forEach((variant) => expect(subagentRunFingerprint(variant)).not.toBe(baseline))
  })

  it('is stable for identical payloads', () => {
    expect(subagentRunFingerprint(basePayload())).toBe(subagentRunFingerprint(basePayload()))
  })
})

describe('subagent run event normalization', () => {
  it('accepts a valid open request', () => {
    const request = normalizeOpenSubagentRunRequest({ runId: 'run-1', payload: { runId: 'run-1' } })
    expect(request?.runId).toBe('run-1')
    expect(request?.payload?.runId).toBe('run-1')
  })

  it('rejects invalid or missing run ids', () => {
    expect(normalizeOpenSubagentRunRequest(undefined)).toBeUndefined()
    expect(normalizeOpenSubagentRunRequest('run-1')).toBeUndefined()
    expect(normalizeOpenSubagentRunRequest({ runId: '  ' })).toBeUndefined()
    expect(normalizeOpenSubagentRunRequest({})).toBeUndefined()
  })
})

describe('subagentRunBodyBlocks', () => {
  function payload(overrides: Partial<Parameters<typeof subagentRunBodyBlocks>[0]> = {}) {
    return {
      task: 'T',
      context: '',
      expectedOutput: '',
      detailed: false,
      traceMessages: [],
      output: '',
      input: '',
      details: '',
      ...overrides,
    }
  }

  it('renders the canonical block order: task → summary → trace → input → details', () => {
    expect(subagentRunBodyBlocks(payload({
      detailed: true,
      traceMessages: [{ role: 'assistant', content: [] }],
      input: '{}',
      details: '{}',
    }))).toEqual(['task', 'summary', 'trace', 'input', 'details'])
  })

  it('shows output instead of trace when there is no trace', () => {
    expect(subagentRunBodyBlocks(payload({ output: 'Done' }))).toEqual(['task', 'output'])
  })

  it('hides output when a trace is present', () => {
    expect(subagentRunBodyBlocks(payload({
      traceMessages: [{ role: 'assistant', content: [] }],
      output: 'Done',
    }))).toEqual(['task', 'trace'])
  })

  it('keeps input/details to detailed mode only', () => {
    expect(subagentRunBodyBlocks(payload({ input: '{}', details: '{}' }))).toEqual(['task'])
    expect(subagentRunBodyBlocks(payload({ detailed: true, input: '', details: '' }))).toEqual(['task', 'summary'])
  })

  it('omits the task block when nothing is present', () => {
    expect(subagentRunBodyBlocks(payload({ task: '', context: '', expectedOutput: '' }))).toEqual([])
  })
})
