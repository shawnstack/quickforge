import {
  estimateContextTokens,
  estimateTokens,
  shouldCompact,
} from '@earendil-works/pi-agent-core'
import { isCanonicalMcpToolName } from './mcp/tool-name.mjs'

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

const SKILL_TOOL_NAMES = new Set(['activate_skill', 'read_skill_resource'])
const SKILLS_CATALOG_INTRO = 'The following Agent Skills provide specialized instructions for specific tasks. Use progressive disclosure: this catalog is available now, but full skill instructions are loaded only when needed.'

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isStructuredMcpMetadata(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && isNonEmptyString(value.serverName)
    && isNonEmptyString(value.toolName),
  )
}

function isStructuredMcpResultDetails(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.mcp === true
    && isNonEmptyString(value.server)
    && isNonEmptyString(value.tool),
  )
}

function enabledSkillNames(tools) {
  const definitions = Array.isArray(tools) ? tools : []
  const activateSkillNames = definitions
    .find((tool) => tool?.name === 'activate_skill')
    ?.parameters?.properties?.name?.enum
  const resourceSkillNames = definitions
    .find((tool) => tool?.name === 'read_skill_resource')
    ?.parameters?.properties?.skill?.enum
  const names = Array.isArray(activateSkillNames) ? activateSkillNames : resourceSkillNames
  return Array.isArray(names)
    ? names.filter(isNonEmptyString).map((name) => name.trim())
    : []
}

function xmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function systemSkillsCatalogTokens(systemPrompt, names) {
  if (names.length === 0 || !systemPrompt) return 0

  const catalogs = [...String(systemPrompt).matchAll(/<available_skills>[\s\S]*?<\/available_skills>/gi)]
  const catalog = catalogs.findLast((match) => (
    match[0].includes(SKILLS_CATALOG_INTRO)
    && names.every((name) => match[0].includes(`<name>${xmlText(name)}</name>`))
  ))
  return catalog ? textTokens(catalog[0]) : 0
}

function selectedToolsTokens(tools, predicate) {
  const selected = (Array.isArray(tools) ? tools : []).filter(predicate)
  return selected.length > 0 ? textTokens(safeJson(selected)) : 0
}

function sourceMessageTokens(messages, toolNames, nameFallback, resultPredicate) {
  const source = Array.isArray(messages) ? messages : []
  const toolCallIds = new Set()
  const toolCallNames = new Set()
  let total = 0

  for (const message of source) {
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue
    const toolCalls = message.content.filter((block) => {
      if (block?.type !== 'toolCall') return false
      const matches = toolNames.has(block.name) || nameFallback(block.name)
      if (matches) {
        if (isNonEmptyString(block.id)) toolCallIds.add(block.id)
        if (isNonEmptyString(block.name)) toolCallNames.add(block.name)
      }
      return matches
    })
    if (toolCalls.length > 0) total += estimateTokens({ ...message, content: toolCalls })
  }

  for (const message of source) {
    if (message?.role !== 'toolResult') continue
    if (isNonEmptyString(message.toolCallId)) {
      if (toolCallIds.has(message.toolCallId)) total += estimateTokens(message)
      continue
    }
    if (isNonEmptyString(message.toolName)) {
      if (toolCallNames.has(message.toolName)) total += estimateTokens(message)
      continue
    }
    if (resultPredicate(message)) total += estimateTokens(message)
  }

  return total
}

export function estimateContextUsage({ systemPrompt, messages, tools, model, minimumProviderUsageIndex = 0 }) {
  const contextWindow = Number(model?.contextWindow) || 0
  const normalizedMessages = normalizeMessagesForTokenEstimate(messages)
  const coreEstimate = estimateContextTokens(normalizedMessages)
  const systemPromptTokens = textTokens(systemPrompt)
  const toolsTokens = textTokens(safeJson(tools))
  const messagesTokens = localMessagesTokens(normalizedMessages)
  const skillNames = enabledSkillNames(tools)
  const skillsTokens = systemSkillsCatalogTokens(systemPrompt, skillNames)
    + selectedToolsTokens(tools, (tool) => skillNames.length > 0 && SKILL_TOOL_NAMES.has(tool?.name))
    + sourceMessageTokens(
      normalizedMessages,
      skillNames.length > 0 ? SKILL_TOOL_NAMES : new Set(),
      () => false,
      () => false,
    )
  const mcpToolNames = new Set((Array.isArray(tools) ? tools : [])
    .filter((tool) => isStructuredMcpMetadata(tool?.mcp) || isCanonicalMcpToolName(tool?.name))
    .map((tool) => tool.name)
    .filter(isNonEmptyString))
  const mcpTokens = selectedToolsTokens(tools, (tool) => mcpToolNames.has(tool?.name))
    + sourceMessageTokens(
      normalizedMessages,
      mcpToolNames,
      isCanonicalMcpToolName,
      (message) => isStructuredMcpResultDetails(message?.details),
    )
  const estimatedInputTokens = systemPromptTokens + messagesTokens + toolsTokens
  const normalizedMinimumProviderUsageIndex = Math.max(0, Number(minimumProviderUsageIndex) || 0)
  const providerUsageIndex = Number.isInteger(coreEstimate.lastUsageIndex) ? coreEstimate.lastUsageIndex : -1
  const providerUsageTokens = providerUsageIndex >= normalizedMinimumProviderUsageIndex
    ? Math.max(0, Number(coreEstimate.usageTokens) || 0)
    : 0
  const providerBasedContextTokens = providerUsageTokens > 0
    ? Math.max(0, Number(coreEstimate.tokens) || 0)
    : 0
  const inputTokens = providerBasedContextTokens > 0
    ? Math.max(estimatedInputTokens, providerBasedContextTokens)
    : estimatedInputTokens
  // 上下文占用按纯输入口径统计：percent = inputTokens / contextWindow。
  // 真实请求的 max_tokens 由 pi-ai `clampMaxTokensToContext` 按窗口收缩，
  // 统计侧不再预留输出 token；totalTokens 字段仅为兼容保留，恒等于 inputTokens。
  const totalTokens = inputTokens
  const percent = contextWindow > 0 ? Math.round((inputTokens / contextWindow) * 1000) / 10 : 0
  const inputTokenSource = providerBasedContextTokens > 0
    ? providerBasedContextTokens >= estimatedInputTokens ? 'provider' : 'mixed'
    : 'estimated'

  return {
    inputTokens,
    estimatedInputTokens,
    knownInputTokens: providerBasedContextTokens,
    providerContextTokens: providerBasedContextTokens,
    inputTokenSource,
    totalTokens,
    contextWindow,
    percent,
    breakdown: {
      systemPromptTokens,
      messagesTokens,
      toolsTokens,
      skillsTokens,
      mcpTokens,
      providerUsageTokens,
      trailingTokens: providerUsageTokens > 0
        ? Math.max(0, Number(coreEstimate.trailingTokens) || 0)
        : messagesTokens,
      lastUsageIndex: coreEstimate.lastUsageIndex,
      localEstimatedContextTokens: estimatedInputTokens,
    },
  }
}

export function shouldCompactContextByPercent(usage, thresholdPercent) {
  const contextWindow = Number(usage?.contextWindow) || 0
  // 阈值按纯输入占用判断：inputTokens / contextWindow ≥ thresholdPercent 即触发，
  // 不包含预留输出 token（真实请求的 max_tokens 由 pi-ai 按窗口收缩）。
  const inputTokens = Math.max(0, Number(usage?.inputTokens) || 0)
  const threshold = Math.min(100, Math.max(0, Number(thresholdPercent) || 0))
  if (!contextWindow) return false

  const thresholdTokens = Math.ceil(contextWindow * threshold / 100)
  const reserveTokens = Math.min(contextWindow, Math.max(0, contextWindow - thresholdTokens + 1))
  return shouldCompact(inputTokens, contextWindow, {
    enabled: true,
    reserveTokens,
    keepRecentTokens: 0,
  })
}
