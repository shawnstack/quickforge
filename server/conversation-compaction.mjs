import { promises as fs } from 'node:fs'
import path from 'node:path'
import { streamSimpleWithAiHttpLogging } from './ai-http-logger.mjs'
import { cacheDir } from './storage.mjs'

export const DEFAULT_COMPACT_KEEP_TURNS = 0
const MAX_COMPACT_KEEP_TURNS = 20
const MIN_SUMMARY_SOURCE_CHARS = 1600

export const COMPACT_SYSTEM_PROMPT = `你是 QuickForge 的“历史对话压缩器”。你的任务是把一段较长的 AI 助手对话压缩成后续模型继续工作所需的最小充分上下文。

目标：
- 显著减少 token 占用。
- 保留后续继续完成任务必须知道的信息。
- 不添加历史中没有出现过的新事实。
- 不输出推理过程，不输出无关解释。
- 不保留闲聊、重复确认、已被否定的方案，除非它们解释了当前决策。
- 不泄露或复述密钥、Token、密码、个人隐私；如果历史中出现敏感信息，用 [REDACTED] 替代。
- 如果存在不确定信息，明确标注“待确认”。

必须保留的信息：
1. 用户最终目标和当前任务状态。
2. 已确认的需求、限制条件、偏好和不做范围。
3. 重要决策、方案取舍和原因。
4. 已检查过的仓库路径、文件、函数、配置项、命令和结果。
5. 已完成的代码/文件改动、验证结果、失败尝试和当前问题。
6. 尚未完成的 TODO、风险、阻塞点、待确认问题。
7. 最近上下文中对下一步行动有直接影响的细节。

输出要求：
- 使用与原对话主要语言一致的语言。
- 使用 Markdown。
- 尽量简洁，但不要牺牲关键事实。
- 不要说“这是摘要”之外的寒暄。
- 不要包含完整原文，除非原文是关键命令、路径、错误信息或验收标准。
- 如果没有足够历史可压缩，输出“无足够历史需要压缩”。

固定输出结构：

# Compact Conversation Summary

## Current Goal
- ...

## Confirmed Requirements
- ...

## Important Context
- ...

## Repository / Files / Commands
- ...

## Completed Work
- ...

## Validation Results
- ...

## Pending Work
- ...

## Risks / Open Questions
- ...

## User Preferences
- ...`

function normalizeKeepTurns(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_COMPACT_KEEP_TURNS
  return Math.min(MAX_COMPACT_KEEP_TURNS, Math.max(0, Math.floor(parsed)))
}

function isUserMessage(message) {
  return message?.role === 'user' || message?.role === 'user-with-attachments'
}

function truncateMiddle(value, maxLength) {
  const text = String(value ?? '')
  if (text.length <= maxLength) return text
  const headLength = Math.floor(maxLength * 0.45)
  const tailLength = Math.max(0, maxLength - headLength)
  return `${text.slice(0, headLength)}\n\n...[truncated ${text.length - maxLength} chars]...\n\n${text.slice(-tailLength)}`
}

function safeJson(value, maxLength = 3000) {
  try {
    return truncateMiddle(JSON.stringify(value, null, 2), maxLength)
  } catch {
    return ''
  }
}

export function redactSensitive(value) {
  return String(value ?? '')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, 'sk-[REDACTED]')
    .replace(/\bAKIA[0-9A-Z]{12,}\b/g, 'AKIA[REDACTED]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, 'AIza[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[_-]?key|token|password|passwd|secret)\b\s*[:=]\s*[^\s`'"<>]{8,}/gi, '$1=[REDACTED]')
}

function contentToText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const parts = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    } else if (block.type === 'image') {
      parts.push(`[image omitted: ${block.mimeType || 'unknown mime'}]`)
    } else if (block.type === 'toolCall') {
      parts.push(`[tool call: ${block.name || 'unknown'} ${safeJson(block.arguments, 2000)}]`)
    }
  }
  return parts.join('\n')
}

function attachmentsSummary(message) {
  if (!message?.attachments) return ''
  if (!Array.isArray(message.attachments)) return '[attachments omitted]'
  return `[attachments omitted: ${message.attachments.length}]`
}

function formatMessageForTranscript(message, index) {
  const role = message?.role || 'unknown'
  const bodyParts = []
  const text = contentToText(message?.content)
  if (text.trim()) bodyParts.push(truncateMiddle(text.trim(), 10000))

  const attachments = attachmentsSummary(message)
  if (attachments) bodyParts.push(attachments)

  const body = bodyParts.join('\n\n').trim() || '[empty]'
  return redactSensitive(`### Message ${index + 1}: ${role}\n${body}`)
}

function transcriptCharLimit(model) {
  const contextWindow = Number(model?.contextWindow) || 128000
  return Math.min(160000, Math.max(12000, Math.floor(contextWindow * 1.6)))
}

function buildTranscript(messages, model) {
  const text = messages.map(formatMessageForTranscript).join('\n\n')
  return truncateMiddle(text, transcriptCharLimit(model))
}

function approximateMessageChars(message) {
  let total = String(message?.role || '').length
  total += contentToText(message?.content).length
  if (message?.attachments) total += safeJson(message.attachments, 1000).length
  if (message?.toolName) total += String(message.toolName).length
  if (message?.toolCallId) total += String(message.toolCallId).length
  return total
}

function approximateMessagesChars(messages) {
  return messages.reduce((total, message) => total + approximateMessageChars(message), 0)
}

function assistantText(message) {
  const content = message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n\n')
    .trim()
}

export function parseCompactArgs(rawArgs = '') {
  const text = String(rawArgs || '').trim()
  if (!text) return { keepTurns: DEFAULT_COMPACT_KEEP_TURNS }

  const tokens = text.split(/\s+/)
  const options = { keepTurns: DEFAULT_COMPACT_KEEP_TURNS }
  const unsupported = []

  for (const token of tokens) {
    const keepMatch = token.match(/^keep=(\d+)$/i)
    if (keepMatch) {
      options.keepTurns = normalizeKeepTurns(keepMatch[1])
      continue
    }
    unsupported.push(token)
  }

  if (unsupported.length > 0) options.unsupported = unsupported
  return options
}

export function splitMessagesForCompaction(messages, options = {}) {
  const keepTurns = normalizeKeepTurns(options.keepTurns)
  const sourceMessages = Array.isArray(messages) ? messages : []

  if (keepTurns <= 0) {
    return {
      keepTurns,
      compactRange: sourceMessages.slice(),
      recentTail: [],
      tailStart: sourceMessages.length,
    }
  }

  let seenUserTurns = 0
  let tailStart = sourceMessages.length
  for (let index = sourceMessages.length - 1; index >= 0; index--) {
    if (!isUserMessage(sourceMessages[index])) continue
    seenUserTurns += 1
    if (seenUserTurns >= keepTurns) {
      tailStart = index
      break
    }
  }

  if (seenUserTurns < keepTurns) tailStart = 0

  return {
    keepTurns,
    compactRange: sourceMessages.slice(0, tailStart),
    recentTail: sourceMessages.slice(tailStart),
    tailStart,
  }
}

export async function compactConversation({ messages, model, thinkingLevel, getApiKey, keepTurns = DEFAULT_COMPACT_KEEP_TURNS }) {
  if (!model?.provider) throw new Error('No model configured for conversation compaction.')

  const split = splitMessagesForCompaction(messages, { keepTurns })
  const transcript = buildTranscript(split.compactRange, model)

  if (split.compactRange.length === 0 || (split.compactRange.length < 4 && transcript.length < MIN_SUMMARY_SOURCE_CHARS)) {
    return {
      skipped: true,
      reason: 'not_enough_history',
      keepTurns: split.keepTurns,
      compactedCount: split.compactRange.length,
      keptCount: split.recentTail.length,
      originalCount: Array.isArray(messages) ? messages.length : 0,
    }
  }

  const userPrompt = `下面是即将被压缩替代的对话历史。只基于这段历史生成摘要。\n\n<conversation_to_compact>\n${transcript}\n</conversation_to_compact>`
  const modelMaxTokens = Number(model.maxTokens) || 4096
  const maxTokens = Math.max(512, Math.min(modelMaxTokens, 4096))
  const apiKey = getApiKey ? await getApiKey(model.provider) : undefined
  const stream = streamSimpleWithAiHttpLogging(
    model,
    {
      systemPrompt: COMPACT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt, timestamp: Date.now() }],
      tools: [],
    },
    {
      apiKey,
      maxTokens,
      temperature: 0.2,
      reasoning: thinkingLevel === 'off' ? undefined : 'low',
      maxRetryDelayMs: 60000,
      metadata: { quickforgePurpose: 'compact' },
    },
  )

  const summaryMessage = await stream.result()
  const summary = redactSensitive(assistantText(summaryMessage))
  if (!summary) throw new Error('Conversation compaction returned an empty summary.')

  return {
    skipped: false,
    summary,
    keepTurns: split.keepTurns,
    compactedCount: split.compactRange.length,
    keptCount: split.recentTail.length,
    originalCount: messages.length,
    recentTail: split.recentTail,
    originalApproxChars: approximateMessagesChars(messages),
    finalApproxChars: summary.length + approximateMessagesChars(split.recentTail),
  }
}

function safePathSegment(value) {
  return String(value || 'session')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 120) || 'session'
}

export async function saveCompactBackup(sessionId, messages) {
  const backupDir = path.join(cacheDir, 'conversations', 'compact-backups', safePathSegment(sessionId))
  await fs.mkdir(backupDir, { recursive: true })
  const createdAt = new Date().toISOString()
  const backupFile = path.join(backupDir, `${createdAt.replace(/[:.]/g, '-')}.json`)
  await fs.writeFile(backupFile, `${JSON.stringify({ sessionId, createdAt, reason: 'compact', messages }, null, 2)}\n`, 'utf8')
  return backupFile
}
