import type { AgentMessage } from '@mariozechner/pi-agent-core'

type ChatPayload = {
  messages?: unknown
  [key: string]: unknown
}

type ChatMessage = {
  role?: unknown
  reasoning_content?: unknown
  reasoning?: unknown
  reasoning_text?: unknown
  [key: string]: unknown
}

/** Reasoning field names that providers may use in streaming deltas. */
const REASONING_FIELDS = ['reasoning_content', 'reasoning', 'reasoning_text'] as const
type ReasoningField = (typeof REASONING_FIELDS)[number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Extract reasoning content from an assistant AgentMessage's thinking blocks.
 * Supports all known reasoning field signatures.
 */
function getCachedReasoningContent(message: AgentMessage): { field: ReasoningField; content: string } | undefined {
  if (!isRecord(message)) return undefined
  const record = message as Record<string, unknown>
  if (record.role !== 'assistant') return undefined

  const content = record.content
  if (!Array.isArray(content)) return undefined

  // Try each known reasoning field, preferring reasoning_content (most common)
  for (const field of REASONING_FIELDS) {
    const parts = content
      .filter((block): block is { type: 'thinking'; thinking: string; thinkingSignature?: string } => {
        return (
          isRecord(block) &&
          block.type === 'thinking' &&
          block.thinkingSignature === field &&
          typeof block.thinking === 'string' &&
          block.thinking.length > 0
        )
      })
      .map((block) => block.thinking)

    if (parts.length > 0) {
      return { field, content: parts.join('\n') }
    }
  }

  return undefined
}

function shouldSkipAssistantForReplay(message: AgentMessage) {
  if (!isRecord(message)) return false
  const record = message as Record<string, unknown>
  if (record.role !== 'assistant') return false
  return record.stopReason === 'error' || record.stopReason === 'aborted'
}

type CachedReasoning = {
  field: ReasoningField
  content: string
}

function collectAssistantReasoningContents(messages: AgentMessage[]): CachedReasoning[] {
  return messages
    .filter((message) => {
      if (!isRecord(message)) return false
      const record = message as Record<string, unknown>
      return record.role === 'assistant' && !shouldSkipAssistantForReplay(message)
    })
    .map((message) => getCachedReasoningContent(message))
    .filter((entry): entry is CachedReasoning => !!entry)
}

/**
 * Reasoning models (DeepSeek V4, Qwen-style endpoints, etc.) require every
 * assistant turn's returned `reasoning_content` (or `reasoning` / `reasoning_text`)
 * to be replayed verbatim in all subsequent requests — especially in tool-call
 * rounds between two user messages.
 *
 * pi-ai's `convertMessages` already maps thinking blocks back to the correct
 * provider field for same-model replays, but custom/older conversion paths
 * or cross-model scenarios may drop the field. This payload hook acts as a
 * safety net: it restores the reasoning field from the agent's source messages
 * when the payload message is missing it.
 *
 * It uses a consumer-queue pattern (dequeue) so that inserted/filtered messages
 * don't cause index misalignment between source AgentMessage[] and the payload.
 */
export function restoreReasoningContentInPayload(payload: unknown, sourceMessages: AgentMessage[]) {
  if (!isRecord(payload) || !Array.isArray((payload as ChatPayload).messages)) return payload

  const cachedReasoningQueue = collectAssistantReasoningContents(sourceMessages)
  if (cachedReasoningQueue.length === 0) return payload

  let changed = false
  const nextMessages = ((payload as ChatPayload).messages as unknown[]).map((message) => {
    if (!isRecord(message) || (message as ChatMessage).role !== 'assistant') return message

    const msg = message as ChatMessage

    // Check if any reasoning field is already present (set by convertMessages)
    const existingField = REASONING_FIELDS.find(
      (field) => typeof msg[field] === 'string' && (msg[field] as string).length > 0,
    )
    if (existingField) {
      // Payload already has reasoning — consume the matching cached entry if the
      // field type matches, to keep queue alignment intact.
      if (cachedReasoningQueue.length > 0 && cachedReasoningQueue[0].field === existingField) {
        cachedReasoningQueue.shift()
      }
      return message
    }

    // No reasoning field set on this payload message — try to restore from cache
    if (cachedReasoningQueue.length === 0) return message

    const cached = cachedReasoningQueue.shift()!
    changed = true
    return {
      ...message,
      [cached.field]: cached.content,
    }
  })

  if (!changed) return payload

  return {
    ...payload,
    messages: nextMessages,
  }
}
