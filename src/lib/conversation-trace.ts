import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ToolResultMessage } from '@earendil-works/pi-ai'

import { summarizeToolArgs } from '@/components/chat/panel-decoration/approval-card'
import { extractQuickForgeTiming } from '@/lib/tool-execution-events'

/**
 * Conversation trace projection.
 *
 * A read-only fold of `agent.state.messages` into `Turn → Step → Tool`. It adds
 * no data: every timestamp and duration comes from what is already persisted
 * (`message.timestamp`, `usage`, `details.quickforgeTiming`). Anything the
 * session never recorded stays `undefined` — the UI renders `—` instead of
 * inventing a number (see docs/architecture/conversation-trace.zh-CN.md §5).
 *
 * Turn boundaries mirror `panel-decoration/process-folding.ts`: a `user` message
 * flushes the previous turn and opens a new one; every `assistant` message after
 * it belongs to that turn. A step is one assistant message (= one model
 * request). Tools are the `toolCall` parts of that message, joined with their
 * `toolResult` by `toolCallId`.
 */

export type TraceToolStatus = 'running' | 'done' | 'error' | 'interrupted'

export type TraceTool = {
  kind: 'tool'
  /** `toolCall.id` — stable across streaming updates and history reloads. */
  id: string
  name: string
  args: Record<string, unknown>
  argsSummary: string
  resultText: string
  isError: boolean
  status: TraceToolStatus
  /** Earliest position we can defend: the recorded `startedAt`, else the step's timestamp. */
  at: number
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  /** Index into `messages` of the assistant message carrying this call. */
  messageIndex: number
  /** Set when the assistant message issued several calls at once. */
  parallelGroupId?: string
}

export type TraceStep = {
  kind: 'step'
  /** `assistant-${messageIndex}`. */
  id: string
  messageIndex: number
  at: number
  /**
   * Wall-clock span of the step: up to the next step / turn boundary, or to the
   * last tool end when the step is the tail. Undefined when nothing follows yet
   * and no tool ever finished (in-flight request).
   */
  endAt?: number
  durationMs?: number
  model: string
  text: string
  thinking: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costTotal: number
  stopReason: string
  errorMessage?: string
  tools: TraceTool[]
}

export type TraceTurn = {
  kind: 'turn'
  index: number
  startAt: number
  endAt: number
  /** Empty when the turn opened with an assistant message (seeded / resumed session). */
  userText: string
  userMessageIndex?: number
  steps: TraceStep[]
}

export type TraceModel = {
  turns: TraceTurn[]
  toolCount: number
  errorCount: number
  runningCount: number
  startAt?: number
  endAt?: number
  inputTokens: number
  outputTokens: number
  costTotal: number
}

export type BuildTraceOptions = {
  /** Ids the agent is still executing; disambiguates "running" from "interrupted". */
  pendingToolCalls?: ReadonlySet<string> | readonly string[]
  /** Clock used for in-flight spans. Injected so tests stay deterministic. */
  now?: number
}

type ToolResultLookup = Map<string, ToolResultMessage>

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    if ((part as { type?: unknown }).type !== 'text') continue
    const text = (part as { text?: unknown }).text
    if (typeof text === 'string' && text) parts.push(text)
  }
  return parts.join('\n')
}

function thinkingText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    if ((part as { type?: unknown }).type !== 'thinking') continue
    const thinking = (part as { thinking?: unknown }).thinking
    if (typeof thinking === 'string' && thinking) parts.push(thinking)
  }
  return parts.join('\n')
}

function resultText(result: ToolResultMessage | undefined): string {
  if (!result) return ''
  const content = result.content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    if ((part as { type?: unknown }).type !== 'text') continue
    const text = (part as { text?: unknown }).text
    if (typeof text === 'string' && text) parts.push(text)
  }
  return parts.join('\n')
}

function toolStatusOf(
  result: ToolResultMessage | undefined,
  toolCallId: string,
  pending: ReadonlySet<string>,
): TraceToolStatus {
  if (result) return result.isError ? 'error' : 'done'
  // A call with no result that the agent is not working on any more was cut off
  // (abort, crash, or a step that closed before the tool reported).
  return pending.has(toolCallId) ? 'running' : 'interrupted'
}

function pendingSet(pending: BuildTraceOptions['pendingToolCalls']): ReadonlySet<string> {
  if (!pending) return new Set<string>()
  if (typeof (pending as ReadonlySet<string>).has === 'function') return pending as ReadonlySet<string>
  return new Set<string>(pending as readonly string[])
}

/** Collect every tool result once so the assistant walk stays O(n). */
function collectToolResults(messages: AgentMessage[]): ToolResultLookup {
  const lookup: ToolResultLookup = new Map()
  for (const message of messages) {
    if (message.role !== 'toolResult') continue
    const id = (message as { toolCallId?: unknown }).toolCallId
    if (typeof id === 'string' && id) lookup.set(id, message as ToolResultMessage)
  }
  return lookup
}

function buildStepTools(
  message: AgentMessage,
  messageIndex: number,
  stepAt: number,
  lookup: ToolResultLookup,
  pending: ReadonlySet<string>,
): TraceTool[] {
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return []

  const calls = content.filter(
    (part): part is { type: 'toolCall'; id: string; name: string; arguments?: unknown } => Boolean(
      part && typeof part === 'object' && (part as { type?: unknown }).type === 'toolCall',
    ),
  )
  const parallelGroupId = calls.length > 1 ? `assistant-${messageIndex}` : undefined

  return calls.map((call) => {
    const result = lookup.get(call.id)
    const timing = extractQuickForgeTiming((result as { details?: unknown } | undefined)?.details)
    const args = asRecord(call.arguments)
    const status = toolStatusOf(result, call.id, pending)
    const startedAt = timing?.startedAt
    return {
      kind: 'tool' as const,
      id: call.id,
      name: call.name,
      args,
      argsSummary: summarizeToolArgs(call.name, args),
      resultText: resultText(result),
      isError: Boolean(result?.isError),
      status,
      at: startedAt ?? stepAt,
      startedAt,
      finishedAt: timing?.finishedAt,
      durationMs: timing?.durationMs,
      messageIndex,
      parallelGroupId,
    }
  })
}

function isTurnStart(message: AgentMessage): boolean {
  return message.role === 'user' || message.role === 'user-with-attachments'
}

/**
 * Fold `messages` into turns. Pure and allocation-stable enough to run inside a
 * `useMemo` keyed on the messages array identity.
 */
export function buildConversationTrace(
  messages: AgentMessage[],
  options: BuildTraceOptions = {},
): TraceModel {
  const now = options.now ?? Date.now()
  const pending = pendingSet(options.pendingToolCalls)
  const lookup = collectToolResults(messages)

  const turns: TraceTurn[] = []
  let current: TraceTurn | null = null
  /**
   * Start times of the turns that survive `flush`, pushed when the turn is kept
   * (dropped empty turns do not count — a dropped turn's start must not end the
   * previous step, which is exactly what the old `turns`-based collection did).
   */
  const keptTurnStarts: number[] = []
  /**
   * True while every start was met in non-decreasing time order — turn starts and
   * step starts interleaved as the walk meets them (a dropped turn's start counts
   * here too: it still shows the timestamps are out of order). Restored or merged
   * history can break this; such sessions take the binary search in the second pass.
   */
  let startsMonotonic = true
  let lastStartAt: number | undefined = undefined
  const noteStart = (at: number) => {
    if (lastStartAt !== undefined && at < lastStartAt) startsMonotonic = false
    lastStartAt = at
  }
  /** Raw steps per turn, resolved into `endAt` once the walk knows what follows. */
  const rawSteps: { turn: TraceTurn; step: TraceStep; nextAt?: number }[] = []

  const flush = () => {
    if (!current) return
    if (!current.steps.length && !current.userText) {
      current = null
      return
    }
    keptTurnStarts.push(current.startAt)
    turns.push(current)
    current = null
  }

  messages.forEach((message, index) => {
    const timestamp = (message as { timestamp?: unknown }).timestamp
    const at = typeof timestamp === 'number' ? timestamp : now

    if (message.role === 'artifact') return

    if (isTurnStart(message)) {
      flush()
      noteStart(at)
      current = {
        kind: 'turn',
        index: turns.length + 1,
        startAt: at,
        endAt: at,
        userText: messageText((message as { content?: unknown }).content),
        userMessageIndex: index,
        steps: [],
      }
      return
    }

    if (message.role !== 'assistant') return

    if (!current) {
      // Resumed / seeded sessions can open with an assistant message.
      current = {
        kind: 'turn',
        index: turns.length + 1,
        startAt: at,
        endAt: at,
        userText: '',
        steps: [],
      }
    }

    const usage = asRecord((message as { usage?: unknown }).usage)
    const cost = asRecord(usage.cost)
    const step: TraceStep = {
      kind: 'step',
      id: `assistant-${index}`,
      messageIndex: index,
      at,
      model: typeof (message as { model?: unknown }).model === 'string' ? (message as { model: string }).model : '',
      text: messageText((message as { content?: unknown }).content),
      thinking: thinkingText((message as { content?: unknown }).content),
      inputTokens: typeof usage.input === 'number' ? usage.input : 0,
      outputTokens: typeof usage.output === 'number' ? usage.output : 0,
      cacheReadTokens: typeof usage.cacheRead === 'number' ? usage.cacheRead : 0,
      cacheWriteTokens: typeof usage.cacheWrite === 'number' ? usage.cacheWrite : 0,
      costTotal: typeof cost.total === 'number' ? cost.total : 0,
      stopReason: typeof (message as { stopReason?: unknown }).stopReason === 'string'
        ? (message as { stopReason: string }).stopReason
        : '',
      errorMessage: typeof (message as { errorMessage?: unknown }).errorMessage === 'string'
        ? (message as { errorMessage: string }).errorMessage
        : undefined,
      tools: buildStepTools(message, index, at, lookup, pending),
    }
    current.steps.push(step)
    noteStart(at)
    rawSteps.push({ turn: current, step })
  })
  flush()

  // Second pass: a step's span runs to whatever starts next (the following step,
  // or the next turn's user message). The tail step falls back to its last tool
  // end; if nothing finished there is no honest number, so it stays undefined.
  //
  // Cost note: this used to be a linear `allStarts.find(v => v > step.at)` per step —
  // O(S·N), ~170M comparisons on a 12k-step bot session, re-run on every message
  // event. The definition is unchanged; only the search is: sort the starts once,
  // then walk them with a cursor that only moves forward (amortised O(1) per step).
  // That is only valid while starts came in time order (see `startsMonotonic`,
  // tracked by the first pass); otherwise fall back to a binary search for the
  // strict upper bound.
  //
  const allStarts: number[] = keptTurnStarts.slice()
  for (const turn of turns) for (const step of turn.steps) allStarts.push(step.at)
  allStarts.sort((a, b) => a - b)
  /** Index of the first start strictly greater than `value` (upper bound). */
  const upperBound = (value: number): number => {
    let lo = 0
    let hi = allStarts.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (allStarts[mid] > value) hi = mid
      else lo = mid + 1
    }
    return lo
  }
  let cursor = 0

  let startAt: number | undefined
  let endAt: number | undefined
  let toolCount = 0
  let errorCount = 0
  let runningCount = 0
  let inputTokens = 0
  let outputTokens = 0
  let costTotal = 0

  for (const turn of turns) {
    for (const step of turn.steps) {
      let index: number
      if (startsMonotonic) {
        while (cursor < allStarts.length && allStarts[cursor] <= step.at) cursor++
        index = cursor
      } else {
        index = upperBound(step.at)
      }
      const nextStart = index < allStarts.length ? allStarts[index] : undefined
      let stepEnd: number | undefined
      if (nextStart !== undefined) {
        stepEnd = nextStart
      } else {
        let lastToolEnd: number | undefined
        for (const tool of step.tools) {
          if (tool.finishedAt !== undefined) lastToolEnd = Math.max(lastToolEnd ?? 0, tool.finishedAt)
          else if (tool.status === 'running') lastToolEnd = Math.max(lastToolEnd ?? 0, now)
        }
        stepEnd = lastToolEnd !== undefined && lastToolEnd > step.at ? lastToolEnd : undefined
      }
      step.endAt = stepEnd
      step.durationMs = stepEnd !== undefined ? Math.max(0, stepEnd - step.at) : undefined

      inputTokens += step.inputTokens
      outputTokens += step.outputTokens
      costTotal += step.costTotal

      for (const tool of step.tools) {
        toolCount += 1
        if (tool.status === 'error') errorCount += 1
        if (tool.status === 'running') runningCount += 1
      }
    }

    let turnEnd = turn.startAt
    if (turn.steps.length) {
      const last = turn.steps[turn.steps.length - 1]
      turnEnd = Math.max(turnEnd, last.endAt ?? last.at)
    }
    turn.endAt = turnEnd

    startAt = startAt === undefined ? turn.startAt : Math.min(startAt, turn.startAt)
    endAt = endAt === undefined ? turnEnd : Math.max(endAt, turnEnd)
  }

  return { turns, toolCount, errorCount, runningCount, startAt, endAt, inputTokens, outputTokens, costTotal }
}

/* -------------------------------------------------------------------------- */
/* Timeline layout                                                            */
/* -------------------------------------------------------------------------- */

export type TraceLayoutMode = 'sequence' | 'duration' | 'time'
export type TraceLane = 'input' | 'model' | 'tools'

export type TraceSpan = {
  /** Record id (`tool` id, `step` id, or `user-<turnIndex>`). */
  id: string
  lane: TraceLane
  /** Percentages of the plot width, 0–100. */
  left: number
  width: number
  /**
   * Only on a coalesced span: the ids of the records it stands for, in span order
   * (its own `id` is the first member's). Absent on an ordinary one-record span.
   */
  memberIds?: string[]
}

export type TraceBounds = { min: number; max: number; span: number }

export type TraceLayoutRecord = {
  id: string
  lane: TraceLane
  at: number
  endAt: number
}

const MIN_SPAN_PERCENT = 0.9

/** Flat, time-ordered list of everything the timeline draws. */
export function traceLayoutRecords(model: TraceModel): TraceLayoutRecord[] {
  const records: TraceLayoutRecord[] = []
  for (const turn of model.turns) {
    records.push({
      id: `user-${turn.index}`,
      lane: 'input',
      at: turn.startAt,
      endAt: Math.max(turn.startAt, turn.startAt),
    })
    for (const step of turn.steps) {
      records.push({ id: step.id, lane: 'model', at: step.at, endAt: step.endAt ?? step.at })
      for (const tool of step.tools) {
        records.push({ id: tool.id, lane: 'tools', at: tool.at, endAt: tool.finishedAt ?? tool.at })
      }
    }
  }
  return records.sort((a, b) => a.at - b.at)
}

export function traceBounds(model: TraceModel): TraceBounds | null {
  const records = traceLayoutRecords(model)
  if (!records.length) return null
  const min = Math.min(...records.map((record) => record.at))
  const max = Math.max(...records.map((record) => Math.max(record.endAt, record.at)))
  return { min, max, span: Math.max(max - min, 1) }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/**
 * Percent positions for the overview lanes.
 *
 * `time` is the only mode where the x axis means wall-clock; `duration` and
 * `sequence` are per-lane packs, so the same record sits at a different x per
 * mode and the UI says so (`traceHint*`).
 */
export function layoutTraceSpans(model: TraceModel, mode: TraceLayoutMode): TraceSpan[] {
  const records = traceLayoutRecords(model)
  if (!records.length) return []

  if (mode === 'sequence') {
    const width = 100 / records.length
    return records.map((record, index) => ({
      id: record.id,
      lane: record.lane,
      left: index * width,
      width: Math.max(width, MIN_SPAN_PERCENT),
    }))
  }

  if (mode === 'duration') {
    const lanes: Record<TraceLane, TraceLayoutRecord[]> = { input: [], model: [], tools: [] }
    for (const record of records) lanes[record.lane].push(record)
    const spans: TraceSpan[] = []
    for (const lane of ['input', 'model', 'tools'] as TraceLane[]) {
      const items = lanes[lane]
      const total = items.reduce((sum, record) => sum + Math.max(record.endAt - record.at, 1), 0) || 1
      let cursor = 0
      for (const record of items) {
        const width = (Math.max(record.endAt - record.at, 1) / total) * 100
        spans.push({ id: record.id, lane, left: cursor, width: Math.max(width, MIN_SPAN_PERCENT) })
        cursor += width
      }
    }
    return spans
  }

  const bounds = traceBounds(model)
  if (!bounds) return []
  return records.map((record) => {
    const left = ((record.at - bounds.min) / bounds.span) * 100
    const width = Math.max(((record.endAt - record.at) / bounds.span) * 100, MIN_SPAN_PERCENT)
    return {
      id: record.id,
      lane: record.lane,
      left: clamp(left, 0, 100 - MIN_SPAN_PERCENT),
      width: Math.min(width, 100 - clamp(left, 0, 100 - MIN_SPAN_PERCENT)),
    }
  })
}

/**
 * Merge the spans of one lane that overlap in plot space into aggregate spans.
 *
 * Why this loses nothing: every span is at least `MIN_SPAN_PERCENT` wide, so a
 * lane can show at most ~111 of them side by side. Past that the later ones
 * necessarily cover the earlier ones — a covered span is invisible and cannot be
 * clicked, yet still costs a button with its handlers. A resident bot session puts
 * 12k records in a lane, i.e. over 99% of them were covered.
 *
 * - Only neighbouring spans of the same lane are merged, in input order.
 * - A block's `left` is its first member's; its right edge is the furthest right
 *   edge among the members, so it never covers more time than they do.
 * - A lane whose spans do not touch is returned as the very same objects, so
 *   ordinary sessions render exactly as before.
 */
export function coalesceTraceSpans(spans: TraceSpan[]): TraceSpan[] {
  // Merge per lane (overlap only means something between spans that share one).
  // `blockOf` maps EVERY member of a block to that block; the block itself is
  // placed at its first member's position so the output order equals the input order.
  const blockOf = new Map<TraceSpan, TraceSpan>()
  const byLane: Partial<Record<TraceLane, TraceSpan[]>> = {}
  for (const span of spans) (byLane[span.lane] ??= []).push(span)
  for (const lane of Object.keys(byLane) as TraceLane[]) {
    const items = byLane[lane] ?? []
    let i = 0
    while (i < items.length) {
      const first = items[i]
      let right = first.left + first.width
      let j = i + 1
      while (j < items.length && items[j].left < right) {
        right = Math.max(right, items[j].left + items[j].width)
        j++
      }
      if (j > i + 1) {
        const members = items.slice(i, j)
        const block: TraceSpan = { id: first.id, lane, left: first.left, width: right - first.left, memberIds: members.map((span) => span.id) }
        for (const member of members) blockOf.set(member, block)
      }
      i = j
    }
  }
  if (!blockOf.size) return spans   // nothing overlapped anywhere: same array, same objects
  const out: TraceSpan[] = []
  for (const span of spans) {
    const block = blockOf.get(span)
    // Emit a block once, at its head; the other members are folded into it.
    if (block) {
      if (block.id === span.id && block.lane === span.lane) out.push(block)
    } else {
      out.push(span)
    }
  }
  return out
}

/** Turn dividers for the `time` overview, in plot percent. */
export function traceTurnMarkers(model: TraceModel): { index: number; left: number }[] {
  const bounds = traceBounds(model)
  if (!bounds) return []
  return model.turns.map((turn) => ({
    index: turn.index,
    left: clamp(((turn.startAt - bounds.min) / bounds.span) * 100, 0, 100),
  }))
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

/** `—` for unknown values: the trace never shows a number the session did not record. */
export function formatTraceDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

export function formatTraceClock(timestamp: number | undefined): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return '—'
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatTraceTokens(tokens: number | undefined): string {
  if (tokens === undefined || !Number.isFinite(tokens)) return '—'
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return String(tokens)
}

/** Rows the ledger renders, in order. Used by the search + selection filters. */
export type TraceRow =
  | { kind: 'user'; id: string; turnIndex: number; at: number; endAt: number; text: string; messageIndex?: number }
  | { kind: 'step'; id: string; turnIndex: number; at: number; endAt: number; step: TraceStep }
  | { kind: 'tool'; id: string; turnIndex: number; at: number; endAt: number; tool: TraceTool; stepId: string }

export function traceRows(model: TraceModel): TraceRow[] {
  const rows: TraceRow[] = []
  for (const turn of model.turns) {
    rows.push({
      kind: 'user',
      id: `user-${turn.index}`,
      turnIndex: turn.index,
      at: turn.startAt,
      endAt: turn.startAt,
      text: turn.userText,
      messageIndex: turn.userMessageIndex,
    })
    for (const step of turn.steps) {
      rows.push({
        kind: 'step',
        id: step.id,
        turnIndex: turn.index,
        at: step.at,
        endAt: step.endAt ?? step.at,
        step,
      })
      for (const tool of step.tools) {
        rows.push({
          kind: 'tool',
          id: tool.id,
          turnIndex: turn.index,
          at: tool.at,
          endAt: tool.finishedAt ?? tool.at,
          tool,
          stepId: step.id,
        })
      }
    }
  }
  return rows
}

export function traceRowMatches(row: TraceRow, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  if (row.kind === 'user') return row.text.toLowerCase().includes(needle)
  if (row.kind === 'step') {
    return `${row.step.text} ${row.step.thinking} ${row.step.model}`.toLowerCase().includes(needle)
  }
  return `${row.tool.name} ${row.tool.argsSummary} ${row.tool.resultText}`.toLowerCase().includes(needle)
}
