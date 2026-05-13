import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { ToolResultMessage } from '@mariozechner/pi-ai'

export type QuickForgeToolTiming = {
  startedAt?: number
  finishedAt?: number
  durationMs?: number
}

type ToolResultLike = {
  content?: ToolResultMessage['content']
  details?: unknown
}

export type ToolExecutionEvent = {
  toolCallId?: string
  toolName?: string
  args?: unknown
  result?: ToolResultLike
  partialResult?: ToolResultLike
  isError?: boolean
  quickforgeTiming?: QuickForgeToolTiming
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function extractQuickForgeTiming(details: unknown): QuickForgeToolTiming | undefined {
  if (!isRecord(details)) return undefined
  const timing = details.quickforgeTiming
  if (!isRecord(timing)) return undefined

  const startedAt = typeof timing.startedAt === 'number' ? timing.startedAt : undefined
  const finishedAt = typeof timing.finishedAt === 'number' ? timing.finishedAt : undefined
  const durationMs = typeof timing.durationMs === 'number' ? timing.durationMs : undefined
  if (startedAt === undefined && finishedAt === undefined && durationMs === undefined) return undefined
  return { startedAt, finishedAt, durationMs }
}

function mergeQuickForgeTiming(details: unknown, timing: QuickForgeToolTiming): unknown {
  if (!isRecord(details)) return { quickforgeTiming: timing }
  return { ...details, quickforgeTiming: timing }
}

export function toolStartEventWithPartialResult(event: ToolExecutionEvent): ToolExecutionEvent {
  const timing = event.quickforgeTiming
    ?? extractQuickForgeTiming(event.partialResult?.details)
    ?? { startedAt: Date.now() }

  return {
    ...event,
    partialResult: event.partialResult ?? {
      content: [],
      details: { quickforgeTiming: timing },
    },
  }
}

export function upsertToolResult(messages: AgentMessage[], event: ToolExecutionEvent, partial: boolean): AgentMessage[] {
  if (!event.toolCallId || !event.toolName) return messages
  const result = partial ? event.partialResult : event.result
  if (!result) return messages

  const timing = extractQuickForgeTiming(result.details) ?? event.quickforgeTiming
  const details = timing ? mergeQuickForgeTiming(result.details, timing) : result.details

  const toolResult = {
    role: 'toolResult',
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    content: result.content ?? [],
    details,
    isError: partial ? false : event.isError,
    timestamp: Date.now(),
  } as AgentMessage
  const index = messages.findIndex((message) => message.role === 'toolResult' && message.toolCallId === event.toolCallId)
  if (index < 0) return [...messages, toolResult]
  const next = messages.slice()
  next[index] = toolResult
  return next
}
