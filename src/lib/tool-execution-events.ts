import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ToolResultMessage } from '@earendil-works/pi-ai'

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
  sessionId?: string
  toolCallId?: string
  toolName?: string
  args?: unknown
  result?: ToolResultLike
  partialResult?: ToolResultLike
  isError?: boolean
  quickforgeTiming?: QuickForgeToolTiming
}

export function upsertMessage(messages: AgentMessage[], message: AgentMessage): AgentMessage[] {
  const toolCallId = (message as { toolCallId?: unknown }).toolCallId
  if (message.role === 'toolResult' && typeof toolCallId === 'string') {
    const index = messages.findIndex((item) => item.role === 'toolResult' && (item as { toolCallId?: unknown }).toolCallId === toolCallId)
    if (index >= 0) {
      const next = messages.slice()
      next[index] = message
      return next
    }
  }

  if (message.role === 'assistant') {
    const timestamp = (message as { timestamp?: unknown }).timestamp
    if (timestamp !== undefined) {
      const index = messages.findIndex((item) => item.role === 'assistant' && (item as { timestamp?: unknown }).timestamp === timestamp)
      if (index >= 0) {
        const next = messages.slice()
        next[index] = message
        return next
      }
    }
  }

  const next = messages.slice()
  const lastIndex = next.length - 1
  if (lastIndex >= 0 && next[lastIndex]?.role === message.role) {
    next[lastIndex] = message
  } else {
    next.push(message)
  }
  return next
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

export function toolStartEventWithPartialResult(event: ToolExecutionEvent, sessionId?: string): ToolExecutionEvent {
  const timing = event.quickforgeTiming
    ?? extractQuickForgeTiming(event.partialResult?.details)
    ?? { startedAt: Date.now() }

  return {
    ...event,
    partialResult: event.partialResult ?? {
      content: [],
      details: { quickforgeTiming: timing, sessionId, toolCallId: event.toolCallId },
    },
  }
}

export function upsertToolResult(messages: AgentMessage[], event: ToolExecutionEvent, partial: boolean): AgentMessage[] {
  if (!event.toolCallId || !event.toolName) return messages
  const result = partial ? event.partialResult : event.result
  if (!result) return messages

  // Resolve timing: prefer the new result/event, then fall back to the existing
  // message so that incremental updates (tool_execution_update) never lose the
  // startedAt timestamp that was set by the initial tool_execution_start event.
  let timing = extractQuickForgeTiming(result.details) ?? event.quickforgeTiming
  if (!timing) {
    const existingIndex = messages.findIndex((message) => message.role === 'toolResult' && message.toolCallId === event.toolCallId)
    if (existingIndex >= 0) {
      timing = extractQuickForgeTiming((messages[existingIndex] as { details?: unknown }).details)
    }
  }
  const details = timing ? mergeQuickForgeTiming(result.details, timing) : result.details
  const detailsWithRuntimeIds = isRecord(details)
    ? { ...details, sessionId: details.sessionId ?? event.sessionId, toolCallId: details.toolCallId ?? event.toolCallId }
    : details

  const toolResult = {
    role: 'toolResult',
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    content: result.content ?? [],
    details: detailsWithRuntimeIds,
    isError: partial ? false : event.isError,
    timestamp: Date.now(),
  } as AgentMessage
  return upsertMessage(messages, toolResult)
}
