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

  // Only the *last* assistant message in the payload can lose its reasoning
  // content (DeepSeek strips reasoning_content from trailing assistant messages
  // when a tool-call round follows).  Scan backward to find the first payload
  // assistant without reasoning, then look up its counterpart in agent state.
  const payloadMessages = payload.messages

  for (let i = payloadMessages.length - 1; i >= 0; i--) {
    const msg = payloadMessages[i]
    if (!msg || typeof msg !== 'object' || msg.role !== 'assistant') continue
    if (msg.reasoning_content || msg.reasoning || msg.reasoning_text) break // already has reasoning — stop

    // Find the *last* assistant message from agent state that matches positionally
    const assistantIndex = payloadMessages.slice(0, i + 1).filter((m) => m && typeof m === 'object' && m.role === 'assistant').length - 1
    const agentAssistants = messages.filter((m) => m.role === 'assistant')
    const cached = agentAssistants[assistantIndex]
    if (!cached) break

    for (const field of REASONING_FIELDS) {
      if (cached[field]) {
        msg[field] = cached[field]
        break
      }
    }
    break // Only patch the first (last-in-payload) assistant missing reasoning
  }
}
