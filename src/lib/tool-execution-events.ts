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

function isRoleWithTimestampDedupe(role: AgentMessage['role']): boolean {
  return role === 'assistant' || role === 'user' || role === 'user-with-attachments'
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
    return [...messages, message]
  }

  if (isRoleWithTimestampDedupe(message.role)) {
    const timestamp = (message as { timestamp?: unknown }).timestamp
    if (timestamp !== undefined) {
      const index = messages.findIndex((item) => item.role === message.role && (item as { timestamp?: unknown }).timestamp === timestamp)
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

/**
 * Tool-call ids an assistant `message_end` commits that still lack any
 * toolResult (partial or final) in `messages`.
 *
 * `tool_execution_start` can land after the assistant message carrying the
 * call is committed (the server finalizes the message before executing its
 * calls, and interleaved frames can also commit the call first). In that
 * window the tool row would otherwise flash: pending=false + no result
 * renders the idle `called` dot, then bounces back to the running spinner
 * once `tool_execution_start` adds the id to `pendingToolCalls`. Callers add
 * the returned ids to `pendingToolCalls` so the row keeps rendering running;
 * `tool_execution_end` removes them as usual. Ids that already have any
 * result — partial from start/update, final (success or error) — are
 * excluded so done/error rows are never pushed back to a running state.
 */
export function toolCallIdsWithoutToolResult(message: AgentMessage, messages: AgentMessage[]): string[] {
  if (message.role !== 'assistant') return []
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return []
  const ids: string[] = []
  for (const chunk of content) {
    if (!chunk || typeof chunk !== 'object') continue
    if ((chunk as { type?: unknown }).type !== 'toolCall') continue
    const id = (chunk as { id?: unknown }).id
    if (typeof id !== 'string' || !id) continue
    const hasResult = messages.some(
      (item) => item.role === 'toolResult' && (item as { toolCallId?: unknown }).toolCallId === id,
    )
    if (!hasResult) ids.push(id)
  }
  return ids
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
