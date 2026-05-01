// ---------------------------------------------------------------------------
// Reasoning content cache — preserves DeepSeek V4 reasoning_content across
// tool-call rounds where the provider API strips it from trailing assistant
// messages.
// ---------------------------------------------------------------------------

export const REASONING_FIELDS = ['reasoning_content', 'reasoning', 'reasoning_text']

export function isDeepSeekThinkingModel(model) {
  if (!model) return false
  const provider = String(model.provider ?? '').toLowerCase()
  const baseUrl = String(model.baseUrl ?? '').toLowerCase()
  const modelId = String(model.id ?? '').toLowerCase()
  return (
    modelId.includes('deepseek-v4') &&
    (provider.includes('deepseek') ||
      baseUrl.includes('api.deepseek.com') ||
      baseUrl.includes('deepseek.com'))
  )
}

export function restoreReasoningContentInPayload(payload, messages, model) {
  if (!isDeepSeekThinkingModel(model)) return
  if (!payload?.messages || !Array.isArray(payload.messages)) return

  const assistantMessages = messages.filter((m) => m.role === 'assistant')
  const payloadMessages = payload.messages

  for (let i = payloadMessages.length - 1; i >= 0; i--) {
    const msg = payloadMessages[i]
    if (!msg || typeof msg !== 'object' || msg.role !== 'assistant') continue
    if (msg.reasoning_content || msg.reasoning || msg.reasoning_text) continue

    // Find corresponding message from agent state
    for (let j = assistantMessages.length - 1; j >= 0; j--) {
      const cached = assistantMessages[j]
      if (!cached) continue
      for (const field of REASONING_FIELDS) {
        if (cached[field]) {
          msg[field] = cached[field]
          break
        }
      }
      if (msg.reasoning_content || msg.reasoning || msg.reasoning_text) break
    }
  }
}
