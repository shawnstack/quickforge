import {
  estimateContextTokens,
  estimateTokens,
  shouldCompact,
} from '@earendil-works/pi-agent-core'

function safeJson(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function normalizeMessageForTokenEstimate(message) {
  if (!message || typeof message !== 'object') return message
  if (message.role !== 'user-with-attachments') return message

  const content = typeof message.content === 'string'
    ? [{ type: 'text', text: message.content }]
    : Array.isArray(message.content)
      ? [...message.content]
      : []

  if (Array.isArray(message.attachments)) {
    for (const attachment of message.attachments) {
      if (attachment?.type === 'image' && attachment.content) {
        content.push({ type: 'image', data: attachment.content, mimeType: attachment.mimeType })
      } else if (attachment?.type === 'document' && attachment.extractedText) {
        content.push({ type: 'text', text: `\n\n[Document: ${attachment.fileName || 'Untitled'}]\n${attachment.extractedText}` })
      }
    }
  }

  return { ...message, role: 'user', content }
}

function normalizeMessagesForTokenEstimate(messages) {
  return (Array.isArray(messages) ? messages : []).map(normalizeMessageForTokenEstimate)
}

function textTokens(text) {
  if (!text) return 0
  return estimateTokens({ role: 'user', content: String(text), timestamp: 0 })
}

function localMessagesTokens(messages) {
  return normalizeMessagesForTokenEstimate(messages).reduce((total, message) => total + estimateTokens(message), 0)
}

export function estimateContextUsage({ systemPrompt, messages, tools, model }) {
  const contextWindow = Number(model?.contextWindow) || 0
  const reservedOutputTokens = Math.max(0, Number(model?.maxTokens) || 4096)
  const normalizedMessages = normalizeMessagesForTokenEstimate(messages)
  const coreEstimate = estimateContextTokens(normalizedMessages)
  const systemPromptTokens = textTokens(systemPrompt)
  const toolsTokens = textTokens(safeJson(tools))
  const messagesTokens = localMessagesTokens(normalizedMessages)
  const estimatedInputTokens = systemPromptTokens + messagesTokens + toolsTokens
  const providerBasedContextTokens = Math.max(0, Number(coreEstimate.usageTokens) || 0) > 0
    ? Math.max(0, Number(coreEstimate.tokens) || 0)
    : 0
  const inputTokens = providerBasedContextTokens > 0
    ? Math.max(estimatedInputTokens, providerBasedContextTokens)
    : estimatedInputTokens
  const totalTokens = inputTokens + reservedOutputTokens
  const percent = contextWindow > 0 ? Math.round((totalTokens / contextWindow) * 1000) / 10 : 0
  const inputTokenSource = providerBasedContextTokens > 0
    ? providerBasedContextTokens >= estimatedInputTokens ? 'provider' : 'mixed'
    : 'estimated'

  return {
    inputTokens,
    estimatedInputTokens,
    knownInputTokens: providerBasedContextTokens,
    providerContextTokens: providerBasedContextTokens,
    inputTokenSource,
    reservedOutputTokens,
    totalTokens,
    contextWindow,
    percent,
    breakdown: {
      systemPromptTokens,
      messagesTokens,
      toolsTokens,
      reservedOutputTokens,
      providerUsageTokens: Math.max(0, Number(coreEstimate.usageTokens) || 0),
      trailingTokens: Math.max(0, Number(coreEstimate.trailingTokens) || 0),
      lastUsageIndex: coreEstimate.lastUsageIndex,
      localEstimatedContextTokens: estimatedInputTokens,
    },
  }
}

export function shouldCompactContextByPercent(usage, thresholdPercent) {
  const contextWindow = Number(usage?.contextWindow) || 0
  const totalTokens = Math.max(0, Number(usage?.totalTokens) || 0)
  const threshold = Math.min(100, Math.max(0, Number(thresholdPercent) || 0))
  if (!contextWindow) return false

  const thresholdTokens = Math.ceil(contextWindow * threshold / 100)
  const reserveTokens = Math.min(contextWindow, Math.max(0, contextWindow - thresholdTokens + 1))
  return shouldCompact(totalTokens, contextWindow, {
    enabled: true,
    reserveTokens,
    keepRecentTokens: 0,
  })
}
