import { describe, expect, it } from 'vitest'
import type { SubagentRunI18n, SubagentRunPayload } from '../../src/lib/subagent-run-detail'
import {
  buildSubagentRunPayload,
  resolveSubagentRunPayloadForOpen,
  subagentRunPayloadFromToolEvent,
} from '../../src/lib/subagent-run-detail'

// 仅诊断当前行为，不把已知丢失条件当作期望修复；i18n stub 避免加载 UI 运行时。
const t: SubagentRunI18n = (key) => key
const toolCallId = 'parent-run-trace-recovery'
const args = { subagent: 'explore', task: 'Inspect completed tool traces' }
const failureText = 'Subagent request failed after completed tools'
const terminalTiming = { startedAt: 100, finishedAt: 200, durationMs: 100 }
const completedTools = [
  { id: 'read-1', name: 'read_file', arguments: { path: 'src/App.tsx' }, output: 'entry point' },
  { id: 'grep-1', name: 'grep_files', arguments: { query: 'run_subagent' }, output: 'matching call chain' },
  { id: 'read-2', name: 'read_file', arguments: { path: 'src/lib/subagent-run-detail.ts' }, output: 'payload helpers' },
]
const messages = completedTools.flatMap((tool) => [
  {
    role: 'assistant',
    content: [{ type: 'toolCall', id: tool.id, name: tool.name, arguments: tool.arguments }],
  },
  {
    role: 'toolResult',
    toolCallId: tool.id,
    toolName: tool.name,
    isError: false,
    content: [{ type: 'text', text: tool.output }],
  },
])
const fullDetails = {
  subagent: 'explore',
  messages,
  toolCalls: completedTools.length,
  pendingToolCalls: [],
  quickforgeTiming: { startedAt: 100 },
}

function requirePayload(payload: SubagentRunPayload | undefined): SubagentRunPayload {
  expect(payload).toBeDefined()
  if (!payload) throw new Error('Expected a subagent run payload')
  return payload
}

function runningPayload(): SubagentRunPayload {
  const payload = requirePayload(subagentRunPayloadFromToolEvent({
    toolCallId,
    toolName: 'run_subagent',
    args,
    partialResult: { content: [], details: fullDetails },
  }, true, undefined, 'concise', t))
  expect(payload.status).toBe('running')
  expect(payload.toolCalls).toBe(3)
  expect(payload.pendingToolCalls).toEqual([])
  expect(payload.traceMessages).toEqual(messages)
  expect(payload.traceMessages).toHaveLength(6)
  return payload
}

function failedPayload(details: Record<string, unknown>, previousPayload?: SubagentRunPayload): SubagentRunPayload {
  return requirePayload(subagentRunPayloadFromToolEvent({
    toolCallId,
    toolName: 'run_subagent',
    isError: true,
    result: { content: [{ type: 'text', text: failureText }], details },
  }, false, args, 'concise', t, previousPayload))
}

function historicalPayload(lightweight = false): SubagentRunPayload {
  // 与历史 renderer 相同的共享 builder；轻量选项复用置顶摘要的实际载荷生成路径。
  return buildSubagentRunPayload(args, {
    isError: true,
    content: [{ type: 'text', text: failureText }],
    details: { ...fullDetails, quickforgeTiming: terminalTiming },
  }, false, 'concise', t, toolCallId, { lightweight })
}

describe('subagent failure trace recovery diagnostics (current behavior)', () => {
  it('recovers every completed trace from previousPayload when terminal details is empty', () => {
    const previous = runningPayload()
    const terminal = failedPayload({}, previous)

    expect(terminal.status).toBe('error')
    expect(terminal.errorMessage).toBe(failureText)
    expect(terminal.traceMessages).toEqual(messages)
    expect(JSON.parse(terminal.details).messages).toEqual(messages)
    expect(terminal.toolCalls).toBe(3)
    expect(terminal.timing).toEqual(previous.timing)
  })

  it.each([
    { label: 'timing-only', details: { quickforgeTiming: terminalTiming } },
    { label: 'identity-only', details: { toolCallId } },
  ])('currently loses trace for nonempty $label terminal details without messages', ({ details }) => {
    const previous = runningPayload()
    const terminal = failedPayload(details, previous)

    expect(terminal.status).toBe('error')
    expect(terminal.traceMessages).toEqual([])
    expect(JSON.parse(terminal.details)).not.toHaveProperty('messages')
    expect(terminal.toolCalls).toBeUndefined()
    expect(terminal.errorMessage).toBe(failureText)
    expect(terminal.timing).toEqual('quickforgeTiming' in details ? terminalTiming : previous.timing)
    // 转换只替换终态载荷，没有就地删除 previousPayload 的历史。
    expect(previous.traceMessages).toEqual(messages)
  })

  it('has no trace to recover from an empty-details terminal event when the previous store snapshot is missing', () => {
    const terminal = failedPayload({})

    expect(terminal.status).toBe('error')
    expect(terminal.traceMessages).toEqual([])
    expect(resolveSubagentRunPayloadForOpen(terminal, undefined)).toBe(terminal)
  })

  it('opens a lightweight historical payload without trace on store miss, but uses a complete matching store snapshot', () => {
    const lightweight = historicalPayload(true)
    const complete = historicalPayload()

    expect(lightweight.status).toBe('error')
    expect(lightweight.traceMessages).toEqual([])
    expect(lightweight.input).toBe('')
    expect(lightweight.details).toBe('')
    expect(resolveSubagentRunPayloadForOpen(lightweight, undefined).traceMessages).toEqual([])
    expect(resolveSubagentRunPayloadForOpen(lightweight, complete)).toBe(complete)
    expect(complete.traceMessages).toEqual(messages)
  })

  it('currently prefers an incomplete terminal store snapshot even over a complete historical renderer payload', () => {
    const incompleteStore = failedPayload({ quickforgeTiming: terminalTiming }, runningPayload())
    const renderer = historicalPayload()

    expect(renderer.status).toBe('error')
    expect(renderer.traceMessages).toEqual(messages)
    expect(incompleteStore.status).toBe('error')
    expect(renderer.canonicalToolCallId).toBe(toolCallId)
    expect(incompleteStore.canonicalToolCallId).toBe(toolCallId)
    const opened = resolveSubagentRunPayloadForOpen(renderer, incompleteStore)
    expect(opened).toBe(incompleteStore)
    expect(opened.traceMessages).toEqual([])
  })

  it('keeps complete historical renderer trace on store miss (store miss alone does not erase trace)', () => {
    const renderer = historicalPayload()

    expect(resolveSubagentRunPayloadForOpen(renderer, undefined)).toBe(renderer)
    expect(renderer.traceMessages).toEqual(messages)
  })
})
