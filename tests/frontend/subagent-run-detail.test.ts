import { describe, expect, it } from 'vitest'
import type { SubagentRunI18n, SubagentRunPayload, SubagentRunStatus, SubagentToolDisplayMode } from '../../src/lib/subagent-run-detail'
import {
  MAX_SUBAGENT_RUN_SNAPSHOTS,
  MAX_SUBAGENT_TOOL_SUMMARY_RUNS,
  SUBAGENT_TOOL_SUMMARY_MAX_LENGTH,
  SubagentRunEventPublisher,
  SubagentRunStore,
  SubagentToolSummaryMemory,
  buildSubagentRunPayload,
  canOpenSubagentRunPayload,
  canPublishSubagentRunPayload,
  currentSubagentToolSummaries,
  currentSubagentToolSummariesWithMemory,
  normalizeOpenSubagentRunRequest,
  resolveSubagentRunPayloadForOpen,
  shouldPublishSubagentRunPayload,
  subagentRunBodyBlocks,
  subagentRunFingerprint,
  subagentRunId,
  subagentRunPayloadFromToolEvent,
  subagentRunTraceMessagesForDisplay,
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

function testPayload(
  runId: string,
  status: SubagentRunStatus,
  overrides: Partial<SubagentRunPayload> = {},
): SubagentRunPayload {
  const payload: Omit<SubagentRunPayload, 'fingerprint'> = {
    runId,
    name: 'explore',
    label: 'Explore',
    task: 'Find',
    context: '',
    expectedOutput: '',
    status,
    statusLabel: `Explore ${status}`,
    allowedTools: [],
    traceMessages: [],
    tools: [],
    pendingToolCalls: [],
    input: '',
    details: '',
    output: '',
    errorMessage: '',
    detailed: false,
    ...overrides,
  }
  return { ...payload, fingerprint: subagentRunFingerprint(payload) }
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

  it('uses the final assistant stopReason as the current terminal state', () => {
    const terminalError = buildSubagentRunPayload(
      { subagent: 'explore', task: 'T' },
      {
        isError: false,
        content: [],
        details: {
          messages: [
            { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Earlier response' }] },
            { role: 'assistant', stopReason: 'error', content: [] },
          ],
        },
      },
      false,
      'concise',
      t,
    )
    expect(terminalError.status).toBe('error')
    expect(terminalError.statusLabel).toBe('Explore failed')
    expect(terminalError.errorMessage).toBe('')
    expect(terminalError.errorSource).toBe('fallback')
    expect(subagentRunBodyBlocks(terminalError)).toContain('error')

    const recovered = buildSubagentRunPayload(
      { subagent: 'explore', task: 'T' },
      {
        isError: false,
        content: [],
        details: {
          messages: [
            { role: 'assistant', stopReason: 'error', errorMessage: 'Old failure', content: [] },
            { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Recovered' }] },
          ],
        },
      },
      false,
      'concise',
      t,
    )
    expect(recovered.status).toBe('done')
    expect(recovered.errorMessage).toBe('')
    expect(recovered.errorSource).toBeUndefined()
  })

  it('extracts the final assistant error when the outer result reports success', () => {
    const payload = buildSubagentRunPayload(
      { subagent: 'explore', task: 'T' },
      {
        isError: false,
        content: [],
        details: {
          messages: [
            { role: 'assistant', stopReason: 'error', errorMessage: '  Provider failed  ', content: [] },
          ],
        },
      },
      false,
      'concise',
      t,
    )
    expect(payload.status).toBe('error')
    expect(payload.errorMessage).toBe('Provider failed')
    expect(payload.errorSource).toBe('trace')
  })

  it('lets a final aborted assistant override an inaccurate streaming outer state', () => {
    const payload = buildSubagentRunPayload(
      { subagent: 'explore', task: 'T' },
      {
        isError: false,
        content: [],
        details: {
          messages: [{ role: 'assistant', stopReason: 'aborted', errorMessage: 'Request aborted', content: [] }],
        },
      },
      true,
      'concise',
      t,
    )
    expect(payload.status).toBe('error')
    expect(payload.errorMessage).toBe('Request aborted')
    expect(payload.errorSource).toBe('trace')
  })

  it('extracts the last concrete assistant error from the trace', () => {
    const payload = buildSubagentRunPayload(
      { subagent: 'explore', task: 'T' },
      {
        isError: true,
        content: [],
        details: {
          messages: [
            { role: 'assistant', stopReason: 'error', errorMessage: 'First failure', content: [] },
            { role: 'assistant', stopReason: 'error', errorMessage: '  Final failure  ', content: [] },
          ],
        },
      },
      false,
      'concise',
      t,
    )
    expect(payload.errorMessage).toBe('Final failure')
    expect(payload.errorSource).toBe('trace')
  })

  it('falls back from empty trace errors to error output, then to a localized fallback state', () => {
    const withOutput = buildSubagentRunPayload(
      { subagent: 'explore', task: 'T' },
      {
        isError: true,
        content: [{ type: 'text', text: 'Tool execution failed' }],
        details: { messages: [{ role: 'assistant', stopReason: 'error', errorMessage: '   ', content: [] }] },
      },
      false,
      'concise',
      t,
    )
    expect(withOutput.errorMessage).toBe('Tool execution failed')
    expect(withOutput.errorSource).toBe('output')

    const withoutDetails = buildSubagentRunPayload(
      { subagent: 'explore', task: 'T' },
      { isError: true, content: [], details: { messages: [] } },
      false,
      'concise',
      t,
    )
    expect(withoutDetails.errorMessage).toBe('')
    expect(withoutDetails.errorSource).toBe('fallback')
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

  it('prefers a top-level toolResult toolCallId over details.sessionId', () => {
    const payload = buildSubagentRunPayload(
      { subagent: 'explore', task: 'Find' },
      {
        toolCallId: 'call-top-level',
        details: { subagent: 'explore', sessionId: 'child-session' },
        content: [],
      },
      true,
      'concise',
      t,
    )
    expect(payload.runId).toBe('call-top-level')
    expect(payload.canonicalToolCallId).toBe('call-top-level')
  })

  it('keeps the same top-level toolCallId when the final toolResult is rebuilt without details.toolCallId', () => {
    const running = buildSubagentRunPayload(
      { subagent: 'general', task: 'Implement' },
      { toolCallId: 'call-stable', details: { sessionId: 'parent-session' }, content: [] },
      true,
      'concise',
      t,
    )
    const completed = buildSubagentRunPayload(
      { subagent: 'general', task: 'Implement' },
      { toolCallId: 'call-stable', details: { sessionId: 'child-session' }, content: [{ type: 'text', text: 'done' }] },
      false,
      'concise',
      t,
    )
    expect(running.runId).toBe('call-stable')
    expect(completed.runId).toBe(running.runId)
    expect(completed.status).toBe('done')
  })

  it.each([
    ['canonical called', 'called', 'call-1', true, true],
    ['canonical running', 'running', 'call-1', true, true],
    ['canonical done', 'done', 'call-1', true, true],
    ['canonical error', 'error', 'call-1', true, true],
    ['name:task called', 'called', undefined, false, false],
    ['name:task running', 'running', undefined, false, false],
    ['name:task done', 'done', undefined, false, true],
    ['name:task error', 'error', undefined, false, true],
  ] as const)('applies publish/open policy for %s', (_label, status, canonicalToolCallId, publish, open) => {
    const payload = buildSubagentRunPayload(
      { subagent: 'explore', task: 'Find' },
      status === 'called'
        ? undefined
        : { ...(canonicalToolCallId ? { toolCallId: canonicalToolCallId } : {}), isError: status === 'error', details: {}, content: [] },
      status === 'running',
      'concise',
      t,
      canonicalToolCallId,
    )
    expect(canPublishSubagentRunPayload(payload)).toBe(publish)
    expect(canOpenSubagentRunPayload(payload)).toBe(open)
  })

  it.each([
    ['called', false, false],
    ['running', false, false],
    ['done', false, true],
    ['error', false, true],
  ] as const)('applies publish/open policy to sessionId history in %s', (status, publish, open) => {
    const payload = testPayload('historical-session', status)
    expect(canPublishSubagentRunPayload(payload)).toBe(publish)
    expect(canOpenSubagentRunPayload(payload)).toBe(open)
  })

  it('prefers an explicit toolCallId as the run id over details.sessionId', () => {
    const payload = buildSubagentRunPayload(
      { subagent: 'explore', task: 'Find' },
      { details: { subagent: 'explore', sessionId: 'run-legacy' }, content: [] },
      false,
      'concise',
      t,
      'call-9',
    )
    expect(payload.runId).toBe('call-9')
  })
})

describe('subagentRunId', () => {
  it('prefers an explicit toolCallId over sessionId', () => {
    expect(subagentRunId({ sessionId: 'run-1' }, 'explore', 'T', 'call-9')).toBe('call-9')
  })

  it('prefers details.toolCallId and stays stable across sessionId changes', () => {
    expect(subagentRunId({ sessionId: 'parent:sub', toolCallId: 'call-9' }, 'explore', 'T')).toBe('call-9')
    expect(subagentRunId({ sessionId: 'sub-agent-child', toolCallId: 'call-9' }, 'explore', 'T')).toBe('call-9')
  })

  it('uses sessionId only as the legacy fallback when no toolCallId exists', () => {
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
      { ...basePayload(), canonicalToolCallId: 'call-2' },
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

describe('subagent run open/publish resolution', () => {
  it('uses the latest matching canonical store snapshot when opening', () => {
    const renderer = testPayload('call-1', 'running', { canonicalToolCallId: 'call-1', output: 'renderer' })
    const latest = testPayload('call-1', 'done', { canonicalToolCallId: 'call-1', output: 'latest' })
    expect(resolveSubagentRunPayloadForOpen(renderer, latest)).toBe(latest)
  })

  it('keeps each same-name/task historical payload independent from the store', () => {
    const first = testPayload('explore:Find', 'done', { output: 'first' })
    const second = testPayload('explore:Find', 'done', { output: 'second' })
    expect(resolveSubagentRunPayloadForOpen(first, second)).toBe(first)
    expect(resolveSubagentRunPayloadForOpen(second, first)).toBe(second)
  })

  it('publishes canonical recovery terminal states over existing non-terminal snapshots', () => {
    const done = testPayload('call-1', 'done', { canonicalToolCallId: 'call-1' })
    const error = testPayload('call-1', 'error', { canonicalToolCallId: 'call-1' })
    expect(shouldPublishSubagentRunPayload(done, testPayload('call-1', 'called', { canonicalToolCallId: 'call-1' }))).toBe(true)
    expect(shouldPublishSubagentRunPayload(error, testPayload('call-1', 'running', { canonicalToolCallId: 'call-1' }))).toBe(true)
  })

  it('does not let renderer overwrite a terminal snapshot with older running data', () => {
    const running = testPayload('call-1', 'running', { canonicalToolCallId: 'call-1' })
    expect(shouldPublishSubagentRunPayload(running, testPayload('call-1', 'done', { canonicalToolCallId: 'call-1' }))).toBe(false)
    expect(shouldPublishSubagentRunPayload(running, testPayload('call-1', 'error', { canonicalToolCallId: 'call-1' }))).toBe(false)
  })

  it('only publishes a first snapshot when it is canonical and otherwise leaves existing SSE snapshots authoritative', () => {
    const running = testPayload('call-1', 'running', { canonicalToolCallId: 'call-1' })
    const done = testPayload('call-1', 'done', { canonicalToolCallId: 'call-1' })
    expect(shouldPublishSubagentRunPayload(running)).toBe(true)
    expect(shouldPublishSubagentRunPayload(testPayload('explore:Find', 'done'))).toBe(false)
    expect(shouldPublishSubagentRunPayload(running, running)).toBe(false)
    expect(shouldPublishSubagentRunPayload(done, done)).toBe(false)
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

  it('removes the duplicated native assistant error from the trace display only', () => {
    const traceMessages = [
      { role: 'assistant', content: [{ type: 'text', text: 'Before' }] },
      { role: 'assistant', stopReason: 'error', errorMessage: 'Provider failed', content: [] },
    ]
    const display = subagentRunTraceMessagesForDisplay({
      status: 'error',
      errorSource: 'trace',
      errorMessage: 'Provider failed',
      traceMessages,
    })
    expect(display).toEqual([
      traceMessages[0],
      { role: 'assistant', stopReason: undefined, errorMessage: undefined, content: [] },
    ])
    expect(traceMessages[1]).toMatchObject({ stopReason: 'error', errorMessage: 'Provider failed' })
  })

  it('keeps trace messages unchanged when the error comes from output', () => {
    const traceMessages = [{ role: 'assistant', stopReason: 'error', errorMessage: 'Trace failure', content: [] }]
    expect(subagentRunTraceMessagesForDisplay({
      status: 'error',
      errorSource: 'output',
      errorMessage: 'Output failure',
      traceMessages,
    })).toBe(traceMessages)
  })

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

  it('renders trace, a separate error block, and non-duplicate output for failed runs', () => {
    expect(subagentRunBodyBlocks(payload({
      status: 'error',
      traceMessages: [{ role: 'assistant', content: [] }],
      errorMessage: 'Trace failure',
      errorSource: 'trace',
      output: 'Additional output',
    }))).toEqual(['task', 'trace', 'error', 'output'])
  })

  it('does not repeat output that is already used as the error reason', () => {
    expect(subagentRunBodyBlocks(payload({
      status: 'error',
      traceMessages: [{ role: 'assistant', content: [] }],
      errorMessage: 'Failed',
      errorSource: 'output',
      output: 'Failed',
    }))).toEqual(['task', 'trace', 'error'])
  })

  it('hides successful output when a trace is present', () => {
    expect(subagentRunBodyBlocks(payload({
      status: 'done',
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

describe('SubagentRunStore', () => {
  function storePayload(runId: string, status: SubagentRunStatus = 'running', overrides: Partial<SubagentRunPayload> = {}): SubagentRunPayload {
    const merged = {
      runId,
      name: 'explore',
      label: 'Explore',
      task: 'T',
      context: '',
      expectedOutput: '',
      status,
      statusLabel: 'Explore running',
      timing: { durationMs: 1 },
      toolCalls: 1,
      allowedTools: [] as string[],
      traceMessages: [] as unknown[],
      tools: [] as unknown[],
      pendingToolCalls: [] as string[],
      input: '',
      details: '',
      output: '',
      detailed: false,
      ...overrides,
    }
    return { ...merged, fingerprint: subagentRunFingerprint(merged) }
  }

  it('deduplicates identical fingerprints and notifies listeners only on change', () => {
    const store = new SubagentRunStore()
    const seen: string[] = []
    store.subscribe((next) => seen.push(next.fingerprint))
    expect(store.publish(storePayload('run-1'))).toBe(true)
    expect(store.publish(storePayload('run-1'))).toBe(false)
    expect(seen.length).toBe(1)
    expect(store.publish(storePayload('run-1', 'done'))).toBe(true)
    expect(seen.length).toBe(2)
    expect(store.get('run-1')?.status).toBe('done')
  })

  it('rejects payloads without a run id', () => {
    const store = new SubagentRunStore()
    expect(store.publish({ ...storePayload('run-1'), runId: '' })).toBe(false)
    expect(store.size).toBe(0)
  })

  it('unsubscribes without affecting other listeners', () => {
    const store = new SubagentRunStore()
    const a: string[] = []
    const b: string[] = []
    const unsubscribeA = store.subscribe((next) => a.push(next.runId))
    store.subscribe((next) => b.push(next.runId))
    unsubscribeA()
    store.publish(storePayload('run-1'))
    expect(a).toEqual([])
    expect(b).toEqual(['run-1'])
  })

  it('isolates listener exceptions from the publish chain', () => {
    const store = new SubagentRunStore()
    const after: string[] = []
    store.subscribe(() => { throw new Error('boom') })
    store.subscribe((next) => after.push(next.runId))
    expect(() => store.publish(storePayload('run-1'))).not.toThrow()
    expect(after).toEqual(['run-1'])
    store.publish(storePayload('run-2'))
    expect(after).toEqual(['run-1', 'run-2'])
  })

  it('evicts the oldest snapshot beyond the capacity cap', () => {
    const store = new SubagentRunStore()
    for (let i = 0; i < MAX_SUBAGENT_RUN_SNAPSHOTS; i++) {
      store.publish(storePayload(`run-${i}`))
    }
    expect(store.get('run-0')).toBeDefined()
    store.publish(storePayload('overflow'))
    expect(store.get('run-0')).toBeUndefined()
    expect(store.get('run-1')).toBeDefined()
    expect(store.get('overflow')).toBeDefined()
    expect(store.size).toBe(MAX_SUBAGENT_RUN_SNAPSHOTS)
  })

  it('does not refresh insertion order when re-publishing an existing key', () => {
    const store = new SubagentRunStore()
    store.publish(storePayload('run-1'))
    store.publish(storePayload('run-2'))
    store.publish(storePayload('run-1', 'done'))
    store.publish(storePayload('run-3'))
    for (let i = 4; i <= MAX_SUBAGENT_RUN_SNAPSHOTS + 1; i++) {
      store.publish(storePayload(`run-${i}`))
    }
    // run-1 首次插入最早，重复发布不刷新其淘汰顺序，超上限时应先被淘汰
    expect(store.get('run-1')).toBeUndefined()
    expect(store.get('run-2')).toBeDefined()
  })

  it('clear() drops snapshots but keeps subscriptions', () => {
    const store = new SubagentRunStore()
    const seen: string[] = []
    store.subscribe((next) => seen.push(next.runId))
    store.publish(storePayload('run-1'))
    store.clear()
    expect(store.get('run-1')).toBeUndefined()
    expect(store.size).toBe(0)
    store.publish(storePayload('run-2'))
    expect(seen).toEqual(['run-1', 'run-2'])
  })
})

describe('subagentRunPayloadFromToolEvent', () => {
  const startEvent = {
    toolCallId: 'call-9',
    toolName: 'run_subagent',
    sessionId: 'parent-session',
    args: { subagent: 'explore', task: 'Find the entry' },
    partialResult: {
      content: [],
      details: { subagent: 'explore', quickforgeTiming: { startedAt: 100 }, messages: [] },
    },
  }

  it('builds a running payload from a start event with args and partialResult', () => {
    const payload = subagentRunPayloadFromToolEvent(startEvent, true, undefined, 'detailed', t)
    expect(payload?.runId).toBe('call-9')
    expect(payload?.status).toBe('running')
    expect(payload?.task).toBe('Find the entry')
    expect(payload?.timing?.startedAt).toBe(100)
  })

  it('ignores non-run_subagent events', () => {
    const payload = subagentRunPayloadFromToolEvent(
      { toolCallId: 'c', toolName: 'run_command', args: { command: 'ls' } },
      true,
      undefined,
      'concise',
      t,
    )
    expect(payload).toBeUndefined()
  })

  it('backs up missing args with cachedArgs on update', () => {
    const update = {
      toolCallId: 'call-9',
      toolName: 'run_subagent',
      partialResult: { content: [], details: { messages: [] } },
    }
    const payload = subagentRunPayloadFromToolEvent(update, true, { subagent: 'explore', task: 'Find the entry' }, 'concise', t)
    expect(payload?.status).toBe('running')
    expect(payload?.task).toBe('Find the entry')
  })

  it('backs up timing from previousTiming when the event has none', () => {
    const update = {
      toolCallId: 'call-9',
      toolName: 'run_subagent',
      partialResult: { content: [], details: { messages: [] } },
    }
    const previous = testPayload('call-9', 'running', { timing: { startedAt: 100, durationMs: 5 } })
    const payload = subagentRunPayloadFromToolEvent(
      update,
      true,
      { subagent: 'explore', task: 'T' },
      'concise',
      t,
      previous,
    )
    expect(payload?.timing?.startedAt).toBe(100)
    expect(payload?.timing?.durationMs).toBe(5)
  })

  it('marks an end event with isError as error and without as done', () => {
    const endEvent = {
      toolCallId: 'call-9',
      toolName: 'run_subagent',
      result: {
        content: [{ type: 'text', text: 'done' }],
        details: { quickforgeTiming: { startedAt: 100, finishedAt: 200, durationMs: 100 } },
      },
    }
    const done = subagentRunPayloadFromToolEvent(endEvent, false, { subagent: 'explore', task: 'T' }, 'concise', t)
    expect(done?.status).toBe('done')
    expect(done?.output).toBe('done')
    const failed = subagentRunPayloadFromToolEvent({ ...endEvent, isError: true }, false, { subagent: 'explore', task: 'T' }, 'concise', t)
    expect(failed?.status).toBe('error')
  })
})

describe('SubagentRunEventPublisher', () => {
  const tStub: SubagentRunI18n = (key, params) => {
    if (key === 'subagentRunning') return `${params?.name ?? ''} running`
    if (key === 'subagentCompleted') return `${params?.name ?? ''} completed`
    if (key === 'subagentFailed') return `${params?.name ?? ''} failed`
    return key
  }

  function createPublisher(store: SubagentRunStore, mode: SubagentToolDisplayMode = 'concise') {
    return new SubagentRunEventPublisher({ store, t: tStub, getToolDisplayMode: () => mode })
  }

  const startEvent = {
    toolCallId: 'call-9',
    toolName: 'run_subagent',
    args: { subagent: 'explore', task: 'Find' },
  }

  it('publishes start and follows with updates/ends that lack args and toolName', () => {
    const store = new SubagentRunStore()
    const publisher = createPublisher(store)
    publisher.handleToolStart(startEvent)
    expect(store.get('call-9')?.status).toBe('running')
    expect(store.get('call-9')?.task).toBe('Find')

    publisher.handleToolUpdate({ toolCallId: 'call-9', partialResult: { content: [], details: { messages: [] } } })
    expect(store.get('call-9')?.status).toBe('running')
    expect(store.get('call-9')?.task).toBe('Find')

    publisher.handleToolEnd({
      toolCallId: 'call-9',
      result: {
        content: [{ type: 'text', text: 'ok' }],
        details: { quickforgeTiming: { startedAt: 100, finishedAt: 200, durationMs: 100 } },
      },
    })
    expect(store.get('call-9')?.status).toBe('done')
    expect(store.get('call-9')?.output).toBe('ok')
  })

  it('uses the canonical start event so the published payload is running with timing', () => {
    const store = new SubagentRunStore()
    const publisher = createPublisher(store)
    publisher.handleToolStart(startEvent)
    const start = store.get('call-9')
    expect(start?.status).toBe('running')
    expect(start?.details).toContain('quickforgeTiming')
  })

  it('backs up timing from the previous payload when updates carry none', () => {
    const store = new SubagentRunStore()
    const publisher = createPublisher(store)
    publisher.handleToolStart(startEvent)
    publisher.handleToolUpdate({ toolCallId: 'call-9', partialResult: { content: [], details: { messages: [] } } })
    const update = store.get('call-9')
    expect(update?.timing?.startedAt).toBeTypeOf('number')
  })

  it('preserves the previous trace and metadata when terminal details are empty', () => {
    const store = new SubagentRunStore()
    const publisher = createPublisher(store)
    publisher.handleToolStart(startEvent)
    publisher.handleToolUpdate({
      toolCallId: 'call-9',
      partialResult: {
        content: [],
        details: {
          label: 'Explore',
          toolCalls: 2,
          messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Investigating' }] }],
          allowedTools: ['read_file'],
        },
      },
    })

    publisher.handleToolEnd({
      toolCallId: 'call-9',
      result: { content: [{ type: 'text', text: 'done' }], details: {} },
    })

    const completed = store.get('call-9')
    expect(completed?.status).toBe('done')
    expect(completed?.traceMessages).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'Investigating' }] },
    ])
    expect(completed?.toolCalls).toBe(2)
    expect(completed?.allowedTools).toEqual(['read_file'])
  })

  it('preserves previous error output when an error end event omits its final result body', () => {
    const store = new SubagentRunStore()
    const publisher = createPublisher(store)
    publisher.handleToolStart(startEvent)
    publisher.handleToolUpdate({
      toolCallId: 'call-9',
      partialResult: {
        isError: true,
        content: [{ type: 'text', text: 'Provider failed' }],
        details: { messages: [] },
      },
    })

    publisher.handleToolEnd({ toolCallId: 'call-9', isError: true })
    const failed = store.get('call-9')
    expect(failed?.status).toBe('error')
    expect(failed?.errorMessage).toBe('Provider failed')
    expect(failed?.errorSource).toBe('output')
  })

  it('clears the cache after end so later updates are ignored', () => {
    const store = new SubagentRunStore()
    const publisher = createPublisher(store)
    publisher.handleToolStart(startEvent)
    publisher.handleToolEnd({ toolCallId: 'call-9', result: { content: [], details: {} } })
    const sizeAfterEnd = store.size
    publisher.handleToolUpdate({ toolCallId: 'call-9', partialResult: { content: [], details: { messages: [] } } })
    expect(store.size).toBe(sizeAfterEnd)
  })

  it('ignores non-run_subagent tools and never caches them', () => {
    const store = new SubagentRunStore()
    const publisher = createPublisher(store)
    expect(publisher.handleToolStart({ toolCallId: 'c1', toolName: 'run_command', args: { command: 'ls' } })).toBeUndefined()
    expect(publisher.handleToolUpdate({ toolCallId: 'c1', partialResult: { content: [], details: {} } })).toBeUndefined()
    expect(publisher.handleToolEnd({ toolCallId: 'c1', result: { content: [], details: {} } })).toBeUndefined()
    expect(store.size).toBe(0)
  })

  it('does not publish when the start event has no args', () => {
    const store = new SubagentRunStore()
    const publisher = createPublisher(store)
    expect(publisher.handleToolStart({ toolCallId: 'call-9', toolName: 'run_subagent' })).toBeUndefined()
    expect(store.size).toBe(0)
  })

  it('recovers when start lacks args but a later update provides them', () => {
    const store = new SubagentRunStore()
    const publisher = createPublisher(store)
    expect(publisher.handleToolStart({ toolCallId: 'call-9', toolName: 'run_subagent' })).toBeUndefined()
    const update = publisher.handleToolUpdate({
      toolCallId: 'call-9',
      toolName: 'run_subagent',
      args: { subagent: 'explore', task: 'Recovered' },
      partialResult: { content: [], details: { messages: [] } },
    })
    expect(update?.task).toBe('Recovered')
    expect(store.get('call-9')?.status).toBe('running')
  })

  it('dispose clears cached args/toolName so later events are ignored', () => {
    const store = new SubagentRunStore()
    const publisher = createPublisher(store)
    publisher.handleToolStart(startEvent)
    publisher.dispose()
    publisher.handleToolUpdate({ toolCallId: 'call-9', partialResult: { content: [], details: {} } })
    publisher.handleToolEnd({ toolCallId: 'call-9', result: { content: [], details: {} } })
    expect(store.size).toBe(1)
  })
})

describe('currentSubagentToolSummaries', () => {
  const traceWithToolCall = (id: string, name: string, args: unknown) => ({
    role: 'assistant',
    content: [
      { type: 'text', text: 'thinking' },
      { type: 'toolCall', id, name, arguments: args },
    ],
  })

  it('derives running tool summaries from pending ids in trace order', () => {
    const payload = testPayload('run-1', 'running', {
      pendingToolCalls: ['t-2', 't-1'],
      traceMessages: [
        traceWithToolCall('t-1', 'read_file', { path: 'src/lib/a.ts' }),
        { role: 'toolResult', toolCallId: 't-1', content: [] },
        traceWithToolCall('t-2', 'run_command', { command: 'npm run test' }),
      ],
    })
    expect(currentSubagentToolSummaries(payload)).toEqual([
      'read_file · src/lib/a.ts',
      'run_command · npm run test',
    ])
  })

  it('normalizes JSON string arguments', () => {
    const payload = testPayload('run-1', 'running', {
      pendingToolCalls: ['t-1'],
      traceMessages: [traceWithToolCall('t-1', 'run_command', '{"command":"npm test"}')],
    })
    expect(currentSubagentToolSummaries(payload)).toEqual(['run_command · npm test'])
  })

  it('falls back to the bare tool name when no summary is derivable', () => {
    const payload = testPayload('run-1', 'running', {
      pendingToolCalls: ['t-1'],
      traceMessages: [traceWithToolCall('t-1', 'custom_tool', { mystery: true })],
    })
    expect(currentSubagentToolSummaries(payload)).toEqual(['custom_tool'])
  })

  it('truncates long summaries to the configured maximum', () => {
    const payload = testPayload('run-1', 'running', {
      pendingToolCalls: ['t-1'],
      traceMessages: [traceWithToolCall('t-1', 'run_command', { command: 'a'.repeat(200) })],
    })
    const [summary] = currentSubagentToolSummaries(payload)
    expect(summary).toBe(`run_command · ${'a'.repeat(SUBAGENT_TOOL_SUMMARY_MAX_LENGTH)}…`)
  })

  it('returns an empty list without pending calls or matching chunks', () => {
    expect(currentSubagentToolSummaries(testPayload('run-1', 'running'))).toEqual([])
    expect(currentSubagentToolSummaries(testPayload('run-1', 'running', {
      pendingToolCalls: ['missing'],
      traceMessages: [traceWithToolCall('t-1', 'read_file', { path: 'a.ts' })],
    }))).toEqual([])
    expect(currentSubagentToolSummaries(testPayload('run-1', 'running', {
      pendingToolCalls: ['t-1'],
      traceMessages: [{ role: 'assistant', content: [{ type: 'toolCall', id: 't-1' }] }],
    }))).toEqual([])
  })
})

describe('currentSubagentToolSummariesWithMemory', () => {
  const traceWithToolCall = (id: string, name: string, args: unknown) => ({
    role: 'assistant',
    content: [{ type: 'toolCall', id, name, arguments: args }],
  })

  it('recalls the last non-empty summaries during running gaps until the next tool appears', () => {
    const memory = new SubagentToolSummaryMemory()
    // 第一个工具运行中：fresh 非空，正常返回并被记忆。
    const runningTool = testPayload('run-1', 'running', {
      pendingToolCalls: ['t-1'],
      traceMessages: [traceWithToolCall('t-1', 'read_file', { path: 'src/a.ts' })],
    })
    expect(currentSubagentToolSummariesWithMemory(runningTool, memory)).toEqual(['read_file · src/a.ts'])
    // 工具间隙：上一个已结束、下一个未开始（pending 为空、fresh 为空），回放最近非空摘要。
    const gap = testPayload('run-1', 'running')
    expect(currentSubagentToolSummariesWithMemory(gap, memory)).toEqual(['read_file · src/a.ts'])
    // 下一个工具出现：切换为新 fresh 并更新记忆。
    const nextTool = testPayload('run-1', 'running', {
      pendingToolCalls: ['t-2'],
      traceMessages: [
        traceWithToolCall('t-1', 'read_file', { path: 'src/a.ts' }),
        traceWithToolCall('t-2', 'run_command', { command: 'npm test' }),
      ],
    })
    expect(currentSubagentToolSummariesWithMemory(nextTool, memory)).toEqual(['run_command · npm test'])
    expect(currentSubagentToolSummariesWithMemory(gap, memory)).toEqual(['run_command · npm test'])
  })

  it('returns an empty list for terminal payloads regardless of memory', () => {
    const memory = new SubagentToolSummaryMemory()
    memory.remember('run-1', ['read_file · a.ts'])
    expect(currentSubagentToolSummariesWithMemory(testPayload('run-1', 'done'), memory)).toEqual([])
    expect(currentSubagentToolSummariesWithMemory(testPayload('run-1', 'error'), memory)).toEqual([])
    // 终态不消费也不污染记忆：同 run 恢复 running 间隙仍可回放。
    expect(currentSubagentToolSummariesWithMemory(testPayload('run-1', 'running'), memory)).toEqual(['read_file · a.ts'])
  })

  it('isolates memories per run id', () => {
    const memory = new SubagentToolSummaryMemory()
    memory.remember('run-1', ['read_file · a.ts'])
    expect(currentSubagentToolSummariesWithMemory(testPayload('run-2', 'running'), memory)).toEqual([])
    expect(currentSubagentToolSummariesWithMemory(testPayload('run-1', 'running'), memory)).toEqual(['read_file · a.ts'])
  })

  it('remember ignores empty run ids or summaries and clear empties the memory', () => {
    const memory = new SubagentToolSummaryMemory()
    memory.remember('', ['read_file · a.ts'])
    memory.remember('run-1', [])
    expect(memory.recall('')).toEqual([])
    expect(memory.recall('run-1')).toEqual([])
    memory.remember('run-1', ['read_file · a.ts'])
    memory.clear()
    expect(memory.recall('run-1')).toEqual([])
  })

  it('evicts the oldest run when exceeding the bounded size', () => {
    const memory = new SubagentToolSummaryMemory()
    for (let index = 0; index < MAX_SUBAGENT_TOOL_SUMMARY_RUNS; index += 1) {
      memory.remember(`run-${index}`, [`tool-${index}`])
    }
    memory.remember('run-new', ['tool-new'])
    expect(memory.recall('run-0')).toEqual([])
    expect(memory.recall('run-1')).toEqual(['tool-1'])
    expect(memory.recall('run-new')).toEqual(['tool-new'])
    // 已存在 key 的重复 remember 不改变淘汰顺序（与 SubagentRunStore 语义一致）：
    // run-1 仍是最旧条目，下一次插入淘汰它，而非淘汰 run-2。
    memory.remember('run-1', ['tool-1-updated'])
    memory.remember('run-extra', ['tool-extra'])
    expect(memory.recall('run-1')).toEqual([])
    expect(memory.recall('run-2')).toEqual(['tool-2'])
  })
})
