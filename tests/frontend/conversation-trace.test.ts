import { describe, expect, it } from 'vitest'

import {
  buildConversationTrace,
  countTraceTools,
  formatTraceDuration,
  formatTraceTokens,
  layoutTraceSpans,
  traceBounds,
  traceLayoutRecords,
  traceRowMatches,
  traceRows,
  traceTurnMarkers,
} from '../../src/lib/conversation-trace'

/**
 * The projection is the whole feature's correctness surface: the view only draws
 * what this fold returns. These tests pin the four contracts that matter —
 * turn boundaries, honest timing, error/interrupted status, and the timeline
 * layouts — instead of snapshotting markup.
 */

type AnyMessage = Parameters<typeof buildConversationTrace>[0][number]

function user(text: string, timestamp: number): AnyMessage {
  return { role: 'user', content: text, timestamp } as AnyMessage
}

function assistant(
  timestamp: number,
  options: {
    text?: string
    thinking?: string
    toolCalls?: { id: string; name: string; arguments?: Record<string, unknown> }[]
    usage?: { input: number; output: number; cost?: number }
    stopReason?: string
  } = {},
): AnyMessage {
  const content: unknown[] = []
  if (options.thinking) content.push({ type: 'thinking', thinking: options.thinking })
  if (options.text) content.push({ type: 'text', text: options.text })
  for (const call of options.toolCalls ?? []) {
    content.push({ type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments ?? {} })
  }
  return {
    role: 'assistant',
    content,
    api: 'test',
    provider: 'test',
    model: 'gpt-test',
    usage: {
      input: options.usage?.input ?? 0,
      output: options.usage?.output ?? 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: (options.usage?.input ?? 0) + (options.usage?.output ?? 0),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: options.usage?.cost ?? 0 },
    },
    stopReason: options.stopReason ?? 'stop',
    timestamp,
  } as AnyMessage
}

function toolResult(
  toolCallId: string,
  toolName: string,
  timestamp: number,
  options: { text?: string; isError?: boolean; timing?: { startedAt?: number; finishedAt?: number; durationMs?: number } } = {},
): AnyMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: options.text ? [{ type: 'text', text: options.text }] : [],
    details: options.timing ? { quickforgeTiming: options.timing } : undefined,
    isError: options.isError ?? false,
    timestamp,
  } as AnyMessage
}

describe('buildConversationTrace — turn boundaries', () => {
  it('opens a turn on every user message and folds the assistants after it', () => {
    const model = buildConversationTrace([
      user('first', 1000),
      assistant(1100, { text: 'a1' }),
      assistant(1200, { text: 'a2' }),
      user('second', 2000),
      assistant(2100, { text: 'b1' }),
    ])

    expect(model.turns).toHaveLength(2)
    expect(model.turns[0].index).toBe(1)
    expect(model.turns[0].userText).toBe('first')
    expect(model.turns[0].steps.map((step) => step.text)).toEqual(['a1', 'a2'])
    expect(model.turns[1].steps.map((step) => step.text)).toEqual(['b1'])
  })

  it('keeps an assistant-only head turn (seeded / resumed session)', () => {
    const model = buildConversationTrace([assistant(1000, { text: 'resumed' })])

    expect(model.turns).toHaveLength(1)
    expect(model.turns[0].userText).toBe('')
    expect(model.turns[0].steps).toHaveLength(1)
  })

  it('treats user-with-attachments as a turn start', () => {
    const model = buildConversationTrace([
      { role: 'user-with-attachments', content: 'with file', timestamp: 1000, attachments: [] } as AnyMessage,
      assistant(1100, { text: 'ok' }),
    ])

    expect(model.turns[0].userText).toBe('with file')
    expect(model.turns[0].steps).toHaveLength(1)
  })

  it('ignores artifact rows (session-persistence only)', () => {
    const model = buildConversationTrace([
      user('hi', 1000),
      { role: 'artifact', action: 'create', filename: 'a.ts', timestamp: '2020-01-01' } as AnyMessage,
      assistant(1100, { text: 'ok' }),
    ])

    expect(model.turns).toHaveLength(1)
    expect(model.turns[0].steps).toHaveLength(1)
  })
})

describe('buildConversationTrace — tools', () => {
  it('joins a tool call with its result and reads quickforgeTiming', () => {
    const model = buildConversationTrace([
      user('run it', 1000),
      assistant(1100, { toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'npm test' } }] }),
      toolResult('c1', 'run_command', 3000, {
        text: 'ok',
        timing: { startedAt: 1200, finishedAt: 2900, durationMs: 1700 },
      }),
    ])

    const tool = model.turns[0].steps[0].tools[0]
    expect(tool.id).toBe('c1')
    expect(tool.name).toBe('run_command')
    expect(tool.argsSummary).toBe('npm test')
    expect(tool.resultText).toBe('ok')
    expect(tool.status).toBe('done')
    expect(tool.startedAt).toBe(1200)
    expect(tool.finishedAt).toBe(2900)
    expect(tool.durationMs).toBe(1700)
    expect(tool.at).toBe(1200)
  })

  it('marks a result-less call as running only while the agent still owns it', () => {
    const messages = [
      user('go', 1000),
      assistant(1100, { toolCalls: [{ id: 'c1', name: 'read_file' }] }),
    ]

    const running = buildConversationTrace(messages, { pendingToolCalls: new Set(['c1']) })
    expect(running.turns[0].steps[0].tools[0].status).toBe('running')
    expect(running.runningCount).toBe(1)

    const interrupted = buildConversationTrace(messages, { pendingToolCalls: new Set<string>() })
    expect(interrupted.turns[0].steps[0].tools[0].status).toBe('interrupted')
    expect(interrupted.runningCount).toBe(0)
  })

  it('accepts a plain string[] for pendingToolCalls (wire shape)', () => {
    const model = buildConversationTrace(
      [user('go', 1000), assistant(1100, { toolCalls: [{ id: 'c1', name: 'read_file' }] })],
      { pendingToolCalls: ['c1'] },
    )

    expect(model.turns[0].steps[0].tools[0].status).toBe('running')
  })

  it('flags errors and counts them', () => {
    const model = buildConversationTrace([
      user('edit', 1000),
      assistant(1100, { toolCalls: [{ id: 'c1', name: 'edit_file' }] }),
      toolResult('c1', 'edit_file', 1200, { isError: true, text: 'oldText must match exactly once' }),
    ])

    const tool = model.turns[0].steps[0].tools[0]
    expect(tool.status).toBe('error')
    expect(tool.isError).toBe(true)
    expect(model.errorCount).toBe(1)
  })

  it('marks parallel groups when one assistant issues several calls', () => {
    const model = buildConversationTrace([
      user('read both', 1000),
      assistant(1100, {
        toolCalls: [
          { id: 'c1', name: 'read_file', arguments: { path: 'a.ts' } },
          { id: 'c2', name: 'read_file', arguments: { path: 'b.ts' } },
        ],
      }),
    ])

    const [first, second] = model.turns[0].steps[0].tools
    expect(first.parallelGroupId).toBe('assistant-1')
    expect(second.parallelGroupId).toBe('assistant-1')
  })

  it('does not mark a single call as a parallel group', () => {
    const model = buildConversationTrace([
      user('read one', 1000),
      assistant(1100, { toolCalls: [{ id: 'c1', name: 'read_file' }] }),
    ])

    expect(model.turns[0].steps[0].tools[0].parallelGroupId).toBeUndefined()
  })
})

describe('buildConversationTrace — honest timing', () => {
  it('ends a step at the next step start', () => {
    const model = buildConversationTrace([
      user('go', 1000),
      assistant(1100, { text: 'one' }),
      assistant(2000, { text: 'two' }),
    ])

    expect(model.turns[0].steps[0].endAt).toBe(2000)
    expect(model.turns[0].steps[0].durationMs).toBe(900)
  })

  it('leaves the tail step duration undefined when nothing was recorded', () => {
    const model = buildConversationTrace([user('go', 1000), assistant(1100, { text: 'tail' })], { now: 5000 })

    expect(model.turns[0].steps[0].endAt).toBeUndefined()
    expect(model.turns[0].steps[0].durationMs).toBeUndefined()
  })

  it('ends the tail step at its last finished tool instead of the clock', () => {
    const model = buildConversationTrace([
      user('go', 1000),
      assistant(1100, { toolCalls: [{ id: 'c1', name: 'run_command' }] }),
      toolResult('c1', 'run_command', 3000, { timing: { startedAt: 1200, finishedAt: 2800, durationMs: 1600 } }),
    ], { now: 9000 })

    expect(model.turns[0].steps[0].endAt).toBe(2800)
    expect(model.turns[0].steps[0].durationMs).toBe(1700)
  })

  it('never invents a duration for an in-flight step with no finished tool', () => {
    const model = buildConversationTrace(
      [user('go', 1000), assistant(1100, { toolCalls: [{ id: 'c1', name: 'run_command' }] })],
      { pendingToolCalls: new Set(['c1']), now: 9000 },
    )

    // The running tool stretches the step to "now", but the tool itself keeps
    // durationMs undefined — the inspector renders the in-flight wording.
    const tool = model.turns[0].steps[0].tools[0]
    expect(tool.durationMs).toBeUndefined()
    expect(tool.finishedAt).toBeUndefined()
  })

  it('sums usage and tool counts across the session', () => {
    const model = buildConversationTrace([
      user('a', 1000),
      assistant(1100, { toolCalls: [{ id: 'c1', name: 'read_file' }], usage: { input: 100, output: 20, cost: 0.5 } }),
      assistant(2000, { usage: { input: 300, output: 40, cost: 1.5 } }),
    ])

    expect(model.inputTokens).toBe(400)
    expect(model.outputTokens).toBe(60)
    expect(model.costTotal).toBeCloseTo(2)
    expect(model.toolCount).toBe(1)
  })

  it('returns an empty model for an empty session', () => {
    const model = buildConversationTrace([])

    expect(model.turns).toEqual([])
    expect(model.toolCount).toBe(0)
    expect(model.startAt).toBeUndefined()
    expect(traceBounds(model)).toBeNull()
  })
})

describe('countTraceTools', () => {
  it('counts toolCall parts without building the projection', () => {
    expect(countTraceTools([
      user('a', 1000),
      assistant(1100, { toolCalls: [{ id: 'c1', name: 'x' }, { id: 'c2', name: 'y' }] }),
      toolResult('c1', 'x', 1200),
    ])).toBe(2)
  })

  it('is 0 when the session never called a tool', () => {
    expect(countTraceTools([user('a', 1000), assistant(1100, { text: 'hi' })])).toBe(0)
  })
})

describe('timeline layouts', () => {
  const messages = [
    user('a', 1000),
    assistant(2000, { toolCalls: [{ id: 'c1', name: 'read_file' }] }),
    toolResult('c1', 'read_file', 2600, { timing: { startedAt: 2100, finishedAt: 2500, durationMs: 400 } }),
  ]

  it('lists user / model / tool records in time order', () => {
    const records = traceLayoutRecords(buildConversationTrace(messages))

    expect(records.map((record) => record.id)).toEqual(['user-1', 'assistant-1', 'c1'])
    expect(records.map((record) => record.lane)).toEqual(['input', 'model', 'tools'])
  })

  it('places clock mode spans on the real timeline', () => {
    const model = buildConversationTrace(messages)
    const bounds = traceBounds(model)
    expect(bounds).not.toBeNull()

    const spans = layoutTraceSpans(model, 'time')
    const userSpan = spans.find((span) => span.id === 'user-1')
    const toolSpan = spans.find((span) => span.id === 'c1')

    expect(userSpan?.left).toBe(0)
    // 2100ms into a 1600ms-wide window is past the end, so the bar is clamped.
    expect(toolSpan?.left).toBeGreaterThan(0)
    expect((toolSpan?.left ?? 0) + (toolSpan?.width ?? 0)).toBeLessThanOrEqual(100.0001)
  })

  it('packs each lane independently in duration mode', () => {
    const model = buildConversationTrace(messages)
    const spans = layoutTraceSpans(model, 'duration')

    for (const lane of ['input', 'model', 'tools'] as const) {
      const laneSpans = spans.filter((span) => span.lane === lane)
      expect(laneSpans[0]?.left).toBe(0)
    }
  })

  it('gives every record equal width in sequence mode', () => {
    const model = buildConversationTrace(messages)
    const spans = layoutTraceSpans(model, 'sequence')

    expect(spans).toHaveLength(3)
    expect(new Set(spans.map((span) => span.width)).size).toBe(1)
  })

  it('emits one turn marker per turn in clock mode', () => {
    const model = buildConversationTrace([...messages, user('b', 3000), assistant(3100, { text: 'x' })])
    const markers = traceTurnMarkers(model)

    expect(markers.map((marker) => marker.index)).toEqual([1, 2])
    expect(markers[0].left).toBe(0)
  })
})

describe('formatting never fabricates numbers', () => {
  it('renders an em dash for unknown durations', () => {
    expect(formatTraceDuration(undefined)).toBe('—')
    expect(formatTraceDuration(Number.NaN)).toBe('—')
  })

  it('scales units the way the chat surface does', () => {
    expect(formatTraceDuration(82)).toBe('82ms')
    expect(formatTraceDuration(1700)).toBe('1.7s')
    expect(formatTraceDuration(100_000)).toBe('1m 40s')
  })

  it('abbreviates token counts', () => {
    expect(formatTraceTokens(842)).toBe('842')
    expect(formatTraceTokens(8420)).toBe('8.4k')
    expect(formatTraceTokens(2_400_000)).toBe('2.40M')
    expect(formatTraceTokens(undefined)).toBe('—')
  })
})

describe('search + rows', () => {
  const model = buildConversationTrace([
    user('please run the tests', 1000),
    assistant(1100, { text: 'running', toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'npm test' } }] }),
    toolResult('c1', 'run_command', 2000, { text: 'All 4809 tests passed' }),
  ])

  it('emits user / step / tool rows per turn', () => {
    expect(traceRows(model).map((row) => row.kind)).toEqual(['user', 'step', 'tool'])
  })

  it('matches on the user text, the assistant text and the tool output', () => {
    const rows = traceRows(model)
    const [userRow, stepRow, toolRow] = rows

    expect(traceRowMatches(userRow, 'tests')).toBe(true)
    expect(traceRowMatches(stepRow, 'running')).toBe(true)
    expect(traceRowMatches(toolRow, '4809')).toBe(true)
    expect(traceRowMatches(toolRow, 'nonexistent')).toBe(false)
  })

  it('treats an empty query as a match', () => {
    expect(traceRowMatches(traceRows(model)[0], '   ')).toBe(true)
  })
})
