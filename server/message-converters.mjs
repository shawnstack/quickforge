/**
 * LLM message format converters.
 *
 * Pure functions that transform AgentMessage[] to LLM-compatible Message[]
 * and extract text content from messages. No module-level state.
 */

/**
 * Strip the `details` property from a message object.
 * Returns a shallow copy so the original message is not mutated.
 */
export function omitDetailsForLlm(message) {
  if (!message || typeof message !== 'object' || message.details === undefined) return message
  const copy = { ...message }
  delete copy.details
  return copy
}

/**
 * Convert AgentMessage[] to LLM-compatible Message[].
 * Handles "user-with-attachments" → "user" with multi-modal content blocks.
 * Without this the default pi-agent-core convertToLlm silently drops
 * user-with-attachments messages, so the LLM never sees attachments.
 *
 * Also guards against orphaned toolResult messages (a tool result without a
 * preceding assistant tool_call): OpenAI-compatible APIs reject such sequences
 * with 400 "Messages with role 'tool' must be a response to a preceding
 * message with 'tool_calls'". Assistant messages that pi-ai would skip
 * (stopReason error/aborted) are not counted as valid tool_call ancestors,
 * matching the upstream skip logic so their results are dropped too.
 */
export function serverConvertToLlm(messages) {
  const pendingToolCallIds = new Set()
  const converted = []
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue
    if (m.role === 'artifact') continue
    if (m.role === 'user-with-attachments') {
      const textContent = typeof m.content === 'string'
        ? [{ type: 'text', text: m.content }]
        : [...m.content]
      if (Array.isArray(m.attachments)) {
        for (const att of m.attachments) {
          if (att.type === 'image' && att.content) {
            textContent.push({ type: 'image', data: att.content, mimeType: att.mimeType })
          } else if (att.type === 'document' && att.extractedText) {
            textContent.push({ type: 'text', text: `\n\n[Document: ${att.fileName}]\n${att.extractedText}` })
          }
        }
      }
      converted.push(omitDetailsForLlm({ ...m, role: 'user', content: textContent }))
    } else if (m.role === 'user') {
      converted.push(omitDetailsForLlm(m))
    } else if (m.role === 'assistant') {
      if (m.stopReason !== 'error' && m.stopReason !== 'aborted' && Array.isArray(m.content)) {
        for (const block of m.content) {
          if (block?.type === 'toolCall' && block.id) pendingToolCallIds.add(block.id)
        }
      }
      converted.push(omitDetailsForLlm(m))
    } else if (m.role === 'toolResult') {
      // 孤儿 toolResult（无前导 assistant tool_calls）直接丢弃，避免上游 400
      if (!m.toolCallId || !pendingToolCallIds.has(m.toolCallId)) continue
      pendingToolCallIds.delete(m.toolCallId)
      converted.push(omitDetailsForLlm(m))
    }
  }
  return converted
}

/**
 * Extract plain text content from a message object.
 * Handles string content and ContentBlock[] arrays.
 */
export function messageText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((block) => block?.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n')
      .trim()
  }
  return ''
}

/**
 * Find the last assistant message with non-empty text content.
 * Returns the text string, or '' if no assistant text is found.
 */
export function lastAssistantText(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role !== 'assistant') continue
    const text = messageText(message)
    if (text) return text
  }
  return ''
}
