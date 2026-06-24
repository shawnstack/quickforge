import { readStore } from './storage.mjs'
import { compactConversation, saveCompactBackup } from './conversation-compaction.mjs'
import { estimateContextUsage, shouldCompactContextByPercent } from './context-usage.mjs'

export const AUTO_COMPACT_SETTINGS_KEY = 'auto-compact-settings'

export const DEFAULT_AUTO_COMPACT_SETTINGS = {
  enabled: false,
  thresholdPercent: 80,
  keepRecentTurns: 2,
  minSourceChars: 1600,
  requireConfirmation: true,
}

const AUTO_COMPACT_MIN_INTERVAL_MS = 30_000
const AUTO_COMPACT_REJECTION_SUPPRESS_MS = 10 * 60_000

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

export function normalizeAutoCompactSettings(value) {
  if (!value || typeof value !== 'object') return { ...DEFAULT_AUTO_COMPACT_SETTINGS }
  return {
    enabled: value.enabled === true,
    thresholdPercent: clampNumber(value.thresholdPercent, DEFAULT_AUTO_COMPACT_SETTINGS.thresholdPercent, 50, 95),
    keepRecentTurns: clampNumber(value.keepRecentTurns, DEFAULT_AUTO_COMPACT_SETTINGS.keepRecentTurns, 1, 20),
    minSourceChars: clampNumber(value.minSourceChars, DEFAULT_AUTO_COMPACT_SETTINGS.minSourceChars, 0, 200000),
    requireConfirmation: value.requireConfirmation !== false,
  }
}

export async function readAutoCompactSettings() {
  const settings = await readStore('settings')
  return normalizeAutoCompactSettings(settings?.[AUTO_COMPACT_SETTINGS_KEY])
}

function safeJson(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function contentToText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((block) => {
    if (!block || typeof block !== 'object') return ''
    if (block.type === 'text') return block.text || ''
    if (block.type === 'thinking') return block.thinking || ''
    if (block.type === 'image') return `[image:${block.mimeType || 'unknown'}]`
    if (block.type === 'toolCall') return `[toolCall:${block.name || 'unknown'}] ${safeJson(block.arguments)}`
    return safeJson(block)
  }).filter(Boolean).join('\n')
}

function estimateMessagesChars(messages) {
  return (Array.isArray(messages) ? messages : []).reduce((total, message) => {
    if (!message || typeof message !== 'object') return total
    return total + [message.role || '', contentToText(message.content), safeJson(message.attachments)].join('\n').length
  }, 0)
}

function isUserMessage(message) {
  return message?.role === 'user' || message?.role === 'user-with-attachments'
}

function tailStartForRecentTurns(messages, keepRecentTurns) {
  const source = Array.isArray(messages) ? messages : []
  let seenUserTurns = 0
  for (let index = source.length - 1; index >= 0; index--) {
    if (!isUserMessage(source[index])) continue
    seenUserTurns += 1
    if (seenUserTurns >= keepRecentTurns) return index
  }
  return 0
}

function shouldSuppressAfterRejection(session, messages, usage) {
  const rejection = session?.lastAutoCompactRejected
  if (!rejection) return false
  const now = Date.now()
  const rejectedAt = Number(rejection.rejectedAt) || 0
  if (rejectedAt <= 0 || now - rejectedAt > AUTO_COMPACT_REJECTION_SUPPRESS_MS) return false

  const rejectedMessageCount = Number(rejection.messageCount) || 0
  const currentMessageCount = Array.isArray(messages) ? messages.length : 0
  if (currentMessageCount >= rejectedMessageCount + 3) return false

  const rejectedPercent = Number(rejection.percent) || 0
  const currentPercent = Number(usage?.percent) || 0
  return currentPercent <= rejectedPercent + 5
}

function markAutoCompactRejected(session, messages, usage) {
  session.lastAutoCompactRejected = {
    rejectedAt: Date.now(),
    messageCount: Array.isArray(messages) ? messages.length : 0,
    percent: Number(usage?.percent) || 0,
  }
}

function clearAutoCompactRejected(session) {
  session.lastAutoCompactRejected = null
}

function compactSummaryText(message) {
  const content = message?.content
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((block) => block?.type === 'text').map((block) => block.text || '').join('\n')
      : ''
  const match = text.match(/<compact_summary>\s*([\s\S]*?)\s*<\/compact_summary>/)
  return match?.[1]?.trim() || text.trim()
}

function userTextMessage(text) {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  }
}

function buildCompactionSourceMessages(session, messages, tailStart) {
  const source = []
  const previousSummary = session.contextCompaction?.summaryMessage
  if (previousSummary) {
    source.push(userTextMessage([
      'Existing rolling compact summary from earlier conversation history:',
      '',
      '<compact_summary>',
      compactSummaryText(previousSummary),
      '</compact_summary>',
    ].join('\n')))
  }
  source.push(...messages.slice(session.contextCompaction?.compactedUpToIndex || 0, tailStart))
  return source
}

export function buildAutoCompactLoopMessages(session, messages) {
  const summaryMessage = session?.contextCompaction?.summaryMessage
  if (!summaryMessage) return messages
  const source = Array.isArray(messages) ? messages : []
  const compactedUpToIndex = Math.min(source.length, Math.max(0, Number(session.contextCompaction?.compactedUpToIndex) || 0))
  return [summaryMessage, ...source.slice(compactedUpToIndex)]
}

export async function compactSessionInPlace({
  session,
  messages,
  keepRecentTurns = DEFAULT_AUTO_COMPACT_SETTINGS.keepRecentTurns,
  minSourceChars = DEFAULT_AUTO_COMPACT_SETTINGS.minSourceChars,
  usage,
  thresholdPercent,
  emitSessionEvent,
  persistSession,
  reason = 'manual_compact',
  summaryIntro = 'The previous conversation has been compacted. Treat the following summary as the authoritative replacement for earlier history. If information is missing, ask for clarification instead of guessing.',
  onBeforePersist,
}) {
  const source = Array.isArray(messages) ? messages : []
  const normalizedKeepRecentTurns = clampNumber(keepRecentTurns, DEFAULT_AUTO_COMPACT_SETTINGS.keepRecentTurns, 1, 20)
  const normalizedMinSourceChars = clampNumber(minSourceChars, DEFAULT_AUTO_COMPACT_SETTINGS.minSourceChars, 0, 200000)
  const tailStart = tailStartForRecentTurns(source, normalizedKeepRecentTurns)
  const sourceMessages = buildCompactionSourceMessages(session, source, tailStart)
  if (sourceMessages.length < 2 || estimateMessagesChars(sourceMessages) < normalizedMinSourceChars) {
    return { compacted: false, usage, reason: 'not_enough_history' }
  }

  const result = await compactConversation({
    messages: sourceMessages,
    model: session.model,
    thinkingLevel: session.thinkingLevel,
    getApiKey: session.getApiKey,
    keepTurns: 0,
  })

  if (result.skipped) return { compacted: false, usage, reason: result.reason || 'skipped' }

  await saveCompactBackup(session.sessionId, sourceMessages)
  const summaryMessage = userTextMessage([
    summaryIntro,
    '',
    '<compact_summary>',
    result.summary,
    '</compact_summary>',
  ].join('\n'))
  session.contextCompaction = {
    summaryMessage,
    compactedUpToIndex: tailStart,
    compactedAt: new Date().toISOString(),
    keepRecentTurns: normalizedKeepRecentTurns,
    sourceMessageCount: source.length,
    usageBefore: usage,
    thresholdPercent,
  }
  onBeforePersist?.({ result, sourceMessages, tailStart, summaryMessage })
  await persistSession?.(session)
  const contextUsage = estimateSessionContextUsage(session, source)
  emitSessionEvent?.(session, {
    type: 'auto_compact_completed',
    reason,
    usage,
    thresholdPercent,
    contextCompaction: session.contextCompaction,
    contextUsage,
  })
  emitSessionEvent?.(session, {
    type: 'messages_replaced',
    reason,
    messages: source,
    contextCompaction: session.contextCompaction,
    contextUsage,
  })
  return { compacted: true, usage, result, sourceMessages, tailStart }
}

export function estimateSessionContextUsage(session, messages = session?.agent?.state?.messages ?? []) {
  if (!session?.agent?.state) return null
  const sourceMessages = Array.isArray(messages) ? messages : []
  const contextWindow = Number(session.model?.contextWindow) || 0
  if (sourceMessages.length === 0) {
    return {
      inputTokens: 0,
      estimatedInputTokens: 0,
      knownInputTokens: 0,
      inputTokenSource: 'estimated',
      reservedOutputTokens: 0,
      totalTokens: 0,
      contextWindow,
      percent: 0,
      isCompacted: false,
      originalMessageCount: 0,
      effectiveMessageCount: 0,
      breakdown: {
        systemPromptTokens: 0,
        messagesTokens: 0,
        toolsTokens: 0,
        reservedOutputTokens: 0,
      },
    }
  }

  // Cache by input identity. Context usage delegates message token estimation
  // to pi-agent-core and JSON-stringifies the full tools array, but its
  // inputs (messages, model, systemPrompt, tools, contextCompaction) are stable
  // within a run and only change on discrete events (message_end, tool result,
  // compaction). Reference equality makes the cache check essentially free, so
  // the repeated calls from emitSessionEvent() on message_end/agent_end/etc.
  // only recompute when something actually changed.
  const lastMessage = sourceMessages[sourceMessages.length - 1]
  const cacheKey = {
    messages,
    messagesLength: sourceMessages.length,
    lastMessage,
    model: session.model,
    systemPrompt: session.agent.state.systemPrompt,
    tools: session.agent.state.tools,
    contextCompaction: session.contextCompaction,
  }
  const cached = session._contextUsageCache
  if (
    cached &&
    cached.key.messages === cacheKey.messages &&
    cached.key.messagesLength === cacheKey.messagesLength &&
    cached.key.lastMessage === cacheKey.lastMessage &&
    cached.key.model === cacheKey.model &&
    cached.key.systemPrompt === cacheKey.systemPrompt &&
    cached.key.tools === cacheKey.tools &&
    cached.key.contextCompaction === cacheKey.contextCompaction
  ) {
    return cached.value
  }

  const loopMessages = buildAutoCompactLoopMessages(session, sourceMessages)
  const value = estimateContextUsage({
    systemPrompt: session.agent.state.systemPrompt,
    messages: loopMessages,
    tools: session.agent.state.tools,
    model: session.model,
  })
  value.isCompacted = loopMessages !== sourceMessages
  value.originalMessageCount = sourceMessages.length
  value.effectiveMessageCount = loopMessages.length
  if (session.contextCompaction?.summaryMessage) {
    value.compactedUpToIndex = Math.min(sourceMessages.length, Math.max(0, Number(session.contextCompaction.compactedUpToIndex) || 0))
  }

  session._contextUsageCache = { key: cacheKey, value }
  return value
}

export async function maybeAutoCompactSession({ session, messages, signal, emitSessionEvent, persistSession, logger, confirmAutoCompact }) {
  if (!session || session.autoCompacting) return { compacted: false }
  const settings = await readAutoCompactSettings()
  if (!settings.enabled) return { compacted: false, reason: 'disabled' }
  if (signal?.aborted) return { compacted: false, reason: 'aborted' }

  const loopMessages = buildAutoCompactLoopMessages(session, messages)
  const usage = estimateContextUsage({
    systemPrompt: session.agent.state.systemPrompt,
    messages: loopMessages,
    tools: session.agent.state.tools,
    model: session.model,
  })
  if (!usage.contextWindow) return { compacted: false, usage, reason: 'missing_context_window' }
  if (!shouldCompactContextByPercent(usage, settings.thresholdPercent)) return { compacted: false, usage, reason: 'below_threshold' }
  if (shouldSuppressAfterRejection(session, messages, usage)) return { compacted: false, usage, reason: 'user_rejected_recently' }

  const now = Date.now()
  if (session.lastAutoCompactAt && now - session.lastAutoCompactAt < AUTO_COMPACT_MIN_INTERVAL_MS) {
    return { compacted: false, usage, reason: 'recently_compacted' }
  }
  if (session.contextCompaction?.sourceMessageCount && messages.length <= session.contextCompaction.sourceMessageCount + 2) {
    return { compacted: false, usage, reason: 'not_enough_new_messages' }
  }

  const tailStart = tailStartForRecentTurns(messages, settings.keepRecentTurns)
  const sourceMessages = buildCompactionSourceMessages(session, messages, tailStart)
  if (sourceMessages.length < 2 || estimateMessagesChars(sourceMessages) < settings.minSourceChars) {
    return { compacted: false, usage, reason: 'not_enough_history' }
  }

  emitSessionEvent?.(session, {
    type: 'auto_compact_threshold_reached',
    usage,
    thresholdPercent: settings.thresholdPercent,
    requireConfirmation: settings.requireConfirmation,
  })

  if (settings.requireConfirmation) {
    const approved = await confirmAutoCompact?.(session, { usage, settings })
    if (!approved || signal?.aborted) {
      if (approved === false) markAutoCompactRejected(session, messages, usage)
      return { compacted: false, usage, reason: approved === false ? 'user_rejected' : 'confirmation_unavailable' }
    }
  }

  session.autoCompacting = true
  try {
    const result = await compactSessionInPlace({
      session,
      messages,
      keepRecentTurns: settings.keepRecentTurns,
      minSourceChars: settings.minSourceChars,
      usage,
      thresholdPercent: settings.thresholdPercent,
      emitSessionEvent,
      persistSession,
      reason: 'auto_compact',
      summaryIntro: 'The previous conversation has been automatically compacted. Treat the following summary as the authoritative replacement for earlier history. If information is missing, ask for clarification instead of guessing.',
      onBeforePersist: () => {
        clearAutoCompactRejected(session)
        session.lastAutoCompactAt = now
      },
    })
    if (!result.compacted) return result
    return { compacted: true, usage }
  } catch (error) {
    logger?.warn?.(`Auto compact failed for session ${session.sessionId}:`, error?.message || error, { sessionId: session.sessionId })
    emitSessionEvent?.(session, {
      type: 'auto_compact_failed',
      usage,
      thresholdPercent: settings.thresholdPercent,
      error: error?.message || String(error),
    })
    return { compacted: false, usage, reason: 'error', error }
  } finally {
    session.autoCompacting = false
  }
}
