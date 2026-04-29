import type { AgentMessage } from '@mariozechner/pi-agent-core'

type ChatPayload = {
  messages?: unknown
  [key: string]: unknown
}

type ChatMessage = {
  role?: unknown
  reasoning_content?: unknown
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getCachedReasoningContent(message: AgentMessage): string | undefined {
  if (!isRecord(message)) return undefined
  const record = message as Record<string, unknown>
  if (record.role !== 'assistant') return undefined

  const content = record.content
  if (!Array.isArray(content)) return undefined

  const parts = content
    .filter((block): block is { type: 'thinking'; thinking: string; thinkingSignature?: string } => {
      return (
        isRecord(block) &&
        block.type === 'thinking' &&
        block.thinkingSignature === 'reasoning_content' &&
        typeof block.thinking === 'string' &&
        block.thinking.length > 0
      )
    })
    .map((block) => block.thinking)

  return parts.length > 0 ? parts.join('\n') : undefined
}

function shouldSkipAssistantForReplay(message: AgentMessage) {
  if (!isRecord(message)) return false
  const record = message as Record<string, unknown>
  if (record.role !== 'assistant') return false
  return record.stopReason === 'error' || record.stopReason === 'aborted'
}

function collectAssistantReasoningContents(messages: AgentMessage[]) {
  return messages
    .filter((message) => {
      if (!isRecord(message)) return false
      const record = message as Record<string, unknown>
      return record.role === 'assistant' && !shouldSkipAssistantForReplay(message)
    })
    .map((message) => getCachedReasoningContent(message))
}

/**
 * Some OpenAI-compatible thinking models (notably Qwen-style endpoints) require
 * every assistant turn's returned `reasoning_content` to be replayed in the next
 * tool-call request. pi-ai stores that streamed field as a thinking block, but
 * older/custom conversion paths may drop the provider-specific top-level field.
 *
 * This payload hook is deliberately conservative: it only restores
 * `reasoning_content` when the previous response actually contained that exact
 * field, and it leaves providers that use other reasoning fields untouched.
 */
export function restoreReasoningContentInPayload(payload: unknown, sourceMessages: AgentMessage[]) {
  if (!isRecord(payload) || !Array.isArray((payload as ChatPayload).messages)) return payload

  const cachedReasoningContents = collectAssistantReasoningContents(sourceMessages)
  if (cachedReasoningContents.every((entry) => !entry)) return payload

  let assistantIndex = 0
  let changed = false
  const nextMessages = ((payload as ChatPayload).messages as unknown[]).map((message) => {
    if (!isRecord(message) || (message as ChatMessage).role !== 'assistant') return message

    const cachedReasoningContent = cachedReasoningContents[assistantIndex]
    assistantIndex += 1

    if (!cachedReasoningContent) return message

    const currentReasoningContent = (message as ChatMessage).reasoning_content
    if (typeof currentReasoningContent === 'string' && currentReasoningContent.length > 0) {
      return message
    }

    changed = true
    return {
      ...message,
      reasoning_content: cachedReasoningContent,
    }
  })

  if (!changed) return payload

  return {
    ...payload,
    messages: nextMessages,
  }
}
