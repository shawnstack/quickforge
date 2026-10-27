import { promises as fs } from 'node:fs'
import path from 'node:path'
import { streamSimpleWithAiHttpLogging } from './ai-http-logger.mjs'
import { cacheDir } from './storage.mjs'

export const DEFAULT_COMPACT_KEEP_TURNS = 0
const MAX_COMPACT_KEEP_TURNS = 20
const MIN_SUMMARY_SOURCE_CHARS = 1600
const COMPACT_SUMMARY_OPEN_TAG = '<compact_summary>'
const COMPACT_SUMMARY_CLOSE_TAG = '</compact_summary>'
const COMPACTION_DETAILS_KEY = 'quickforgeCompaction'
const LEGACY_COMPACT_SUMMARY_INTROS = [
  'The previous conversation has been compacted.',
  'The previous conversation has been automatically compacted.',
  'Existing rolling compact summary from earlier conversation history:',
]
const LEGACY_COMPACTION_NOTICE_PREFIX = '已基于当前对话创建压缩后的新对话：'
const LEGACY_COMPACTION_NOTICE_SUFFIX = '压缩前历史已保存到本地备份。'

export const COMPACT_SYSTEM_PROMPT = `You are QuickForge's "conversation compactor". Your job is to compress a long assistant conversation into the minimum sufficient context that a model needs to keep working afterwards.

Objectives:
- Reduce token usage significantly.
- Preserve every fact the continuation needs.
- Never introduce facts that did not appear in the history.
- Do not output reasoning or unrelated explanation.
- Drop small talk, repeated confirmations and rejected proposals, unless they explain a current decision.
- Never reveal, quote or paraphrase keys, tokens, passwords or personal data. Replace sensitive values found in the history with [REDACTED].
- Mark anything uncertain explicitly as "Unconfirmed".

Information that must be preserved:
1. The user's final goal and the current task state.
2. Confirmed requirements, constraints, preferences and explicit out-of-scope items.
3. Important decisions, trade-offs and the reasons behind them.
4. Repository paths, files, functions, configuration keys, commands and their results that were already inspected.
5. Completed code/file changes, verification results, failed attempts and the current problem.
6. Outstanding TODOs, risks, blockers and open questions.
7. Details from the most recent context that directly affect the next action.

Output requirements:
- Write in the same language as the majority of the original conversation.
- Use Markdown.
- Be as concise as possible without dropping key facts.
- No pleasantries beyond the summary itself.
- Do not paste full source text, except for critical commands, paths, error messages or acceptance criteria.
- If there is not enough history to compact, output "No sufficient history to compact".

Fixed output structure:

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

function messageContentText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

function compactionMessageKind(message) {
  const kind = message?.details?.[COMPACTION_DETAILS_KEY]?.kind
  if (kind === 'summary' || kind === 'notice') return kind

  const text = messageContentText(message).trim()
  if (
    message?.role === 'user'
    && LEGACY_COMPACT_SUMMARY_INTROS.some((intro) => text.startsWith(intro))
    && text.includes(COMPACT_SUMMARY_OPEN_TAG)
    && text.lastIndexOf(COMPACT_SUMMARY_CLOSE_TAG) > text.indexOf(COMPACT_SUMMARY_OPEN_TAG)
  ) return 'summary'

  if (
    message?.role === 'assistant'
    && text.startsWith(LEGACY_COMPACTION_NOTICE_PREFIX)
    && text.includes(LEGACY_COMPACTION_NOTICE_SUFFIX)
  ) return 'notice'

  return null
}

export function compactionMessageDetails(kind) {
  return { [COMPACTION_DETAILS_KEY]: { version: 1, kind } }
}

export function isCompactSummaryMessage(message) {
  return compactionMessageKind(message) === 'summary'
}

export function isCompactionNoticeMessage(message) {
  return compactionMessageKind(message) === 'notice'
}

export function extractCompactSummaryText(message) {
  const text = messageContentText(message).trim()
  const openIndex = text.indexOf(COMPACT_SUMMARY_OPEN_TAG)
  const closeIndex = text.lastIndexOf(COMPACT_SUMMARY_CLOSE_TAG)
  if (openIndex < 0 || closeIndex <= openIndex) return text
  return text.slice(openIndex + COMPACT_SUMMARY_OPEN_TAG.length, closeIndex).trim()
}

function isUserMessage(message) {
  return (message?.role === 'user' || message?.role === 'user-with-attachments')
    && !isCompactSummaryMessage(message)
}

/**
 * Stringify without any length cap.
 *
 * The old version truncated to a default 3000 chars (2000 for tool-call
 * arguments) with a head/tail cut, so a large argument object or attachment list
 * reached the summarizer as a fragment with a `...[truncated N chars]...`
 * marker. Nothing in the compaction transcript is truncated any more; the only
 * replacements left are structural ones (images, attachments) where the content
 * genuinely cannot be sent as text.
 */
function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2)
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
      parts.push(`[tool call: ${block.name || 'unknown'} ${safeJson(block.arguments)}]`)
    }
  }
  return parts.join('\n')
}

function attachmentsSummary(message) {
  if (!message?.attachments) return ''
  if (!Array.isArray(message.attachments)) return '[attachments omitted]'
  return `[attachments omitted: ${message.attachments.length}]`
}

/**
 * Render one message into the compaction transcript.
 *
 * No length cap: the summary request must see the whole history, otherwise the
 * summary silently loses whatever fell into the cut. The old
 * `truncateMiddle(text, 10000)` kept head + tail and dropped the middle, which
 * mattered most for the exact case compaction exists for — a conversation that
 * already had a large file or log pasted into it.
 *
 * Secrets are still redacted per message (`redactSensitive`), and non-text
 * blocks are replaced with placeholders: images cannot be re-sent as text and a
 * tool call's arguments are already represented by its result.
 */
function formatMessageForTranscript(message, index) {
  const role = message?.role || 'unknown'
  const bodyParts = []
  const text = contentToText(message?.content)
  if (text.trim()) bodyParts.push(text.trim())

  const attachments = attachmentsSummary(message)
  if (attachments) bodyParts.push(attachments)

  const body = bodyParts.join('\n\n').trim() || '[empty]'
  return redactSensitive(`### Message ${index + 1}: ${role}\n${body}`)
}

/**
 * Join the compaction source into one transcript.
 *
 * Deliberately unbounded: `transcriptCharLimit(model)` used to clamp this to
 * `min(160000, max(12000, contextWindow * 1.6))` chars with the same
 * head/tail cut. The summarizer is a separate request with its own budget, and
 * losing the middle of the history is worse than letting the provider reject an
 * oversized request — a rejection surfaces as a visible compaction failure
 * instead of a quietly incomplete summary.
 */
function buildTranscript(messages) {
  return messages.map(formatMessageForTranscript).join('\n\n')
}

function approximateMessageChars(message) {
  let total = String(message?.role || '').length
  total += contentToText(message?.content).length
  if (message?.attachments) total += safeJson(message.attachments).length
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
      compactRange: sourceMessages.filter((message) => !isCompactionNoticeMessage(message)),
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

  const compactRange = sourceMessages
    .slice(0, tailStart)
    .filter((message) => !isCompactionNoticeMessage(message))

  return {
    keepTurns,
    compactRange,
    recentTail: sourceMessages.slice(tailStart),
    tailStart,
  }
}

export async function compactConversation({
  messages,
  model,
  thinkingLevel,
  getApiKey,
  keepTurns = DEFAULT_COMPACT_KEEP_TURNS,
  minSourceChars = MIN_SUMMARY_SOURCE_CHARS,
}) {
  if (!model?.provider) throw new Error('No model configured for conversation compaction.')

  const split = splitMessagesForCompaction(messages, { keepTurns })
  const transcript = buildTranscript(split.compactRange)
  const normalizedMinSourceChars = Number.isFinite(Number(minSourceChars))
    ? Math.max(0, Number(minSourceChars))
    : MIN_SUMMARY_SOURCE_CHARS

  if (split.compactRange.length === 0 || (split.compactRange.length < 4 && transcript.length < normalizedMinSourceChars)) {
    return {
      skipped: true,
      reason: 'not_enough_history',
      keepTurns: split.keepTurns,
      compactedCount: split.compactRange.length,
      keptCount: split.recentTail.length,
      originalCount: Array.isArray(messages) ? messages.length : 0,
    }
  }

  const userPrompt = `Below is the conversation history that is about to be replaced by a summary. Generate the summary from this history only.\n\n<conversation_to_compact>\n${transcript}\n</conversation_to_compact>`
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
