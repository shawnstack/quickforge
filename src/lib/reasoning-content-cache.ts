import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { Api, Model } from '@mariozechner/pi-ai'

type ChatPayload = {
  messages?: unknown
  thinking?: unknown
  reasoning_effort?: unknown
  temperature?: unknown
  top_p?: unknown
  presence_penalty?: unknown
  frequency_penalty?: unknown
  [key: string]: unknown
}

type ChatMessage = {
  role?: unknown
  content?: unknown
  reasoning_content?: unknown
  reasoning?: unknown
  reasoning_text?: unknown
  tool_calls?: unknown
  [key: string]: unknown
}

/** Reasoning field names that providers may use in streaming deltas. */
const REASONING_FIELDS = ['reasoning_content', 'reasoning', 'reasoning_text'] as const
type ReasoningField = (typeof REASONING_FIELDS)[number]

type CachedReasoning = {
  field: ReasoningField
  content: string
}

type AssistantReplaySlot = {
  reasoning?: CachedReasoning
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDeepSeekThinkingModel(model?: Model<Api>) {
  if (!model) return false
  const provider = String(model.provider ?? '').toLowerCase()
  const baseUrl = String(model.baseUrl ?? '').toLowerCase()
  const modelId = String(model.id ?? '').toLowerCase()
  const compat = (model as { compat?: { thinkingFormat?: string } }).compat
  const isDeepSeekEndpoint =
    provider.includes('deepseek') || baseUrl.includes('api.deepseek.com') || baseUrl.includes('deepseek.com')
  const isDeepSeekV4 = modelId.includes('deepseek-v4')

  // DeepSeek's strict replay contract applies to V4 thinking models. Older
  // saved profiles may have `reasoning: false`, so model id/endpoint detection
  // is intentionally enough for V4. For non-V4 DeepSeek-compatible profiles,
  // require an explicit reasoning/compat marker to avoid enabling thinking on
  // models that do not support it.
  return isDeepSeekV4 || (isDeepSeekEndpoint && (model.reasoning === true || compat?.thinkingFormat === 'deepseek'))
}

function sourceAssistantHasReplayableContent(message: AgentMessage) {
  if (!isRecord(message)) return false
  const record = message as Record<string, unknown>
  if (record.role !== 'assistant') return false
  const content = record.content
  if (!Array.isArray(content)) return false

  return content.some((block) => {
    if (!isRecord(block)) return false
    if (block.type === 'toolCall') return true
    if (block.type === 'text') return typeof block.text === 'string' && block.text.length > 0
    return false
  })
}

/**
 * Extract reasoning content from an assistant AgentMessage's thinking blocks.
 * Supports all known reasoning field signatures.
 */
function getCachedReasoningContent(message: AgentMessage): CachedReasoning | undefined {
  if (!isRecord(message)) return undefined
  const record = message as Record<string, unknown>
  if (record.role !== 'assistant') return undefined

  const content = record.content
  if (!Array.isArray(content)) return undefined

  // Try each known reasoning field, preferring reasoning_content (DeepSeek's
  // official field and the most common OpenAI-compatible streaming delta name).
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

/**
 * Build one slot per assistant message that `convertMessages()` is expected to
 * replay.  Keeping empty slots is important: otherwise a later assistant's
 * reasoning_content could be shifted onto an earlier tool-call assistant whose
 * thinking block was lost, which is worse than sending an empty placeholder.
 */
function collectAssistantReplaySlots(messages: AgentMessage[]): AssistantReplaySlot[] {
  return messages
    .filter((message) => {
      if (!isRecord(message)) return false
      const record = message as Record<string, unknown>
      return record.role === 'assistant' && !shouldSkipAssistantForReplay(message) && sourceAssistantHasReplayableContent(message)
    })
    .map((message) => ({ reasoning: getCachedReasoningContent(message) }))
}

function getExistingReasoning(message: ChatMessage): CachedReasoning | undefined {
  const field = REASONING_FIELDS.find((name) => typeof message[name] === 'string' && (message[name] as string).length > 0)
  if (!field) return undefined
  return { field, content: message[field] as string }
}

function withDeepSeekThinkingParams(payload: ChatPayload) {
  const thinking = isRecord(payload.thinking) ? payload.thinking : undefined
  const thinkingType = thinking && typeof thinking.type === 'string' ? thinking.type : undefined

  // Official DeepSeek docs: thinking mode defaults to enabled.  Be explicit so
  // app state and API state cannot diverge.  For V4/DeepSeek profiles we keep it
  // enabled; this is the safest behavior for long-running agent/tool sessions.
  if (thinkingType !== 'enabled') {
    payload.thinking = { type: 'enabled' }
  }

  // Official mapping: low/medium/high -> high, xhigh -> max.  pi-ai already
  // does this for correctly marked models; this covers old saved profiles where
  // `reasoning` was false and no reasoning_effort was generated.
  if (typeof payload.reasoning_effort !== 'string' || payload.reasoning_effort.length === 0) {
    payload.reasoning_effort = 'high'
  }

  // These are ignored by DeepSeek in thinking mode, but removing them avoids
  // confusing request logs and matches the documented contract more closely.
  delete payload.temperature
  delete payload.top_p
  delete payload.presence_penalty
  delete payload.frequency_penalty
}

function restoreAssistantReasoningMessage(
  message: Record<string, unknown>,
  slot: AssistantReplaySlot | undefined,
  forceDeepSeekReasoningContent: boolean,
) {
  const msg = message as ChatMessage
  const existing = getExistingReasoning(msg)
  const cached = slot?.reasoning
  const hasCachedContent = !!cached?.content

  // DeepSeek's official field is `reasoning_content`. If a compatible endpoint
  // produced `reasoning` / `reasoning_text`, mirror it into `reasoning_content`
  // for DeepSeek requests.
  if (forceDeepSeekReasoningContent && existing && msg.reasoning_content === undefined) {
    return {
      ...message,
      reasoning_content: existing.content,
    }
  }

  // If convertMessages already supplied non-empty reasoning_content, keep it.
  if (existing?.field === 'reasoning_content') return message

  // If convertMessages supplied an empty placeholder but we still have the real
  // reasoning text in the source AgentMessage, replace the placeholder.
  if (
    forceDeepSeekReasoningContent &&
    typeof msg.reasoning_content === 'string' &&
    msg.reasoning_content.length === 0 &&
    hasCachedContent
  ) {
    return {
      ...message,
      reasoning_content: cached.content,
    }
  }

  // No reasoning field set on this payload message — restore from the aligned
  // source assistant if available.
  if (!existing && hasCachedContent) {
    return {
      ...message,
      [forceDeepSeekReasoningContent ? 'reasoning_content' : cached.field]: cached.content,
    }
  }

  // DeepSeek thinking + tool-call history requires the field to exist.  For old
  // sessions where the true chain-of-thought was not saved, an empty string is
  // the only recoverable placeholder and matches pi-ai's compat fallback.
  if (forceDeepSeekReasoningContent && msg.reasoning_content === undefined) {
    return {
      ...message,
      reasoning_content: '',
    }
  }

  return message
}

/**
 * DeepSeek V4 thinking mode requires assistant `reasoning_content` to be
 * replayed verbatim when a turn contains tool calls, and then in all later user
 * turns.  Older saved QuickForge profiles may have `reasoning: false` even when
 * DeepSeek defaulted thinking to enabled, so we enforce the DeepSeek payload
 * contract here at the final request boundary.
 *
 * This hook also remains useful for other OpenAI-compatible reasoning endpoints:
 * it restores dropped `reasoning_content` / `reasoning` / `reasoning_text` fields
 * from the source AgentMessage thinking blocks when possible.
 */
export function restoreReasoningContentInPayload(
  payload: unknown,
  sourceMessages: AgentMessage[],
  model?: Model<Api>,
) {
  if (!isRecord(payload) || !Array.isArray((payload as ChatPayload).messages)) return payload

  const isDeepSeek = isDeepSeekThinkingModel(model)
  const replaySlots = collectAssistantReplaySlots(sourceMessages)
  const hasReasoningToRestore = replaySlots.some((slot) => !!slot.reasoning?.content)

  if (!isDeepSeek && !hasReasoningToRestore) return payload

  const nextPayload: ChatPayload = { ...(payload as ChatPayload) }
  if (isDeepSeek) withDeepSeekThinkingParams(nextPayload)

  let changed = isDeepSeek
  let assistantIndex = 0

  const nextMessages = ((payload as ChatPayload).messages as unknown[]).map((message) => {
    if (!isRecord(message) || (message as ChatMessage).role !== 'assistant') return message

    const slot = replaySlots[assistantIndex]
    assistantIndex += 1

    // In DeepSeek thinking mode, sending reasoning_content on non-tool
    // assistant messages is allowed/ignored, while omitting it on tool-call
    // history is fatal.  Force the official field for every replayed assistant
    // message to make mixed old/new sessions safe.
    const forceDeepSeekReasoningContent = isDeepSeek
    const nextMessage = restoreAssistantReasoningMessage(message, slot, forceDeepSeekReasoningContent)
    if (nextMessage !== message) changed = true
    return nextMessage
  })

  if (!changed) return payload

  return {
    ...nextPayload,
    messages: nextMessages,
  }
}
