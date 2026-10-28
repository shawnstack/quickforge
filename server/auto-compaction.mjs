import { randomUUID } from 'node:crypto'
import { readStore } from './storage.mjs'
import {
  compactConversation,
  compactionMessageDetails,
  extractCompactSummaryText,
  isCompactSummaryMessage,
  saveCompactBackup,
} from './conversation-compaction.mjs'
import { estimateContextUsage, shouldCompactContextByPercent } from './context-usage.mjs'

export const AUTO_COMPACT_SETTINGS_KEY = 'auto-compact-settings'

export const DEFAULT_AUTO_COMPACT_SETTINGS = {
  enabled: true,
  thresholdPercent: 80,
  keepRecentTurns: 0,
  requireConfirmation: true,
}

/**
 * 保留尾部（最近回合）的字符预算上限。当会话以工具消息为主、user 回合
 * 稀疏时，按 keepRecentTurns 从尾部回溯会跨越大量工具消息，导致压缩
 * 范围过小甚至为空（tailStart 与 compactedUpToIndex 重合）。达到该预算
 * 时按当前用户轮次起点截断，将更早的完整工具链历史并入压缩范围。
 */
export const DEFAULT_MAX_TAIL_CHARS = 40000

/**
 * 压缩历史条数上限。
 *
 * 滚动压缩（rolling compaction）每次只把「上一版摘要 + 上次切点之后的增量」
 * 交给模型，但界面需要每一次压缩都在真实发生的位置留一条分割线，所以每次
 * 压缩都往 `contextCompaction.history` 追加一条记录而不是覆盖。
 * 每条记录带一份当次摘要（几 KB），设上限避免 body_json 无限增长。
 */
export const MAX_CONTEXT_COMPACTION_HISTORY = 20

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

export function normalizeAutoCompactSettings(value) {
  if (!value || typeof value !== 'object') return { ...DEFAULT_AUTO_COMPACT_SETTINGS }
  return {
    enabled: value.enabled !== false,
    thresholdPercent: clampNumber(value.thresholdPercent, DEFAULT_AUTO_COMPACT_SETTINGS.thresholdPercent, 50, 95),
    keepRecentTurns: clampNumber(value.keepRecentTurns, DEFAULT_AUTO_COMPACT_SETTINGS.keepRecentTurns, 0, 20),
    requireConfirmation: value.requireConfirmation !== false,
  }
}

export async function readAutoCompactSettings() {
  const settings = await readStore('settings')
  return normalizeAutoCompactSettings(settings?.[AUTO_COMPACT_SETTINGS_KEY])
}

/**
 * Compaction UI state machine (single source of truth for the chat surface).
 *
 * Before this existed the server only emitted fire-and-forget events
 * (`auto_compact_threshold_reached`, `auto_compact_approval_required`,
 * `auto_compact_completed`, `auto_compact_failed`) and kept `autoCompacting` as
 * a private boolean. The three consequences were visible bugs:
 *
 * 1. Summarizing is an extra LLM round trip that can take tens of seconds. With
 *    no phase exposed, the panel showed nothing at all and the run looked hung.
 * 2. The approval promise resolved `false` both for "user declined" and for
 *    "timed out", and the timeout path emitted no event, so the approval card
 *    stayed on screen after the server had already dropped the approval — the
 *    next click could only fail with a 404.
 * 3. Every early return after the threshold was reached produced no UI state at
 *    all, so "nothing happened" and "it silently gave up" looked identical.
 *
 * The notice is therefore a complete projection of the pipeline: every entry
 * into a phase and every exit (including cancellation/timeout) publishes it, and
 * `null` means "nothing in flight". Consumers never have to infer state from the
 * absence of events.
 */
export const COMPACTION_NOTICE_PHASES = Object.freeze({
  /** Threshold reached, waiting for the user's decision (requireConfirmation). */
  AWAITING_CONFIRMATION: 'awaiting_confirmation',
  /** Summary generation is in flight; the run is blocked until it finishes. */
  SUMMARIZING: 'summarizing',
})

/**
 * Publish the in-flight notice. `null` clears it.
 *
 * Failure is deliberately NOT a server-owned phase: it is transient and is
 * already carried by `auto_compact_failed`, which the surface renders
 * ephemerally. Keeping it out of the projection means the notice can never go
 * stale on the server side.
 */
export function setCompactionNotice(session, notice, emitSessionEvent) {
  const next = notice ?? null
  const previous = session.compactionNotice ?? null
  if (previous === next) return
  session.compactionNotice = next
  emitSessionEvent?.(session, {
    type: 'auto_compact_state',
    compactionNotice: next,
  })
}

/** Clear the notice only when one is published (avoids empty events). */
export function clearCompactionNotice(session, emitSessionEvent) {
  setCompactionNotice(session, null, emitSessionEvent)
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

function messageChars(message) {
  if (!message || typeof message !== 'object') return 0
  return [message.role || '', contentToText(message.content), safeJson(message.attachments)].join('\n').length
}

function isUserMessage(message) {
  return (message?.role === 'user' || message?.role === 'user-with-attachments')
    && !isCompactSummaryMessage(message)
}

function isToolResultMessage(message) {
  return message?.role === 'toolResult'
}

export function tailStartForRecentTurns(messages, keepRecentTurns, maxTailChars = DEFAULT_MAX_TAIL_CHARS) {
  const source = Array.isArray(messages) ? messages : []
  const normalizedKeepRecentTurns = clampNumber(keepRecentTurns, DEFAULT_AUTO_COMPACT_SETTINGS.keepRecentTurns, 0, 20)
  if (normalizedKeepRecentTurns === 0) return source.length

  let seenUserTurns = 0
  let tailChars = 0
  for (let index = source.length - 1; index >= 0; index--) {
    if (isUserMessage(source[index])) seenUserTurns += 1
    tailChars += messageChars(source[index])
    if (seenUserTurns >= normalizedKeepRecentTurns) return index
    // 保留的尾部超过预算：仍按完整用户轮次切分，避免把当前运行中的
    // assistant/toolResult 链从中间截断，导致压缩线落在一轮对话内部。
    if (tailChars >= maxTailChars) {
      for (let turnStart = index; turnStart >= 0; turnStart--) {
        if (isUserMessage(source[turnStart])) return turnStart
      }
      return 0
    }
  }
  return 0
}

function userTextMessage(text, details) {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
    ...(details ? { details } : {}),
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
      extractCompactSummaryText(previousSummary),
      '</compact_summary>',
    ].join('\n'), compactionMessageDetails('summary')))
  }
  const compacted = messages.slice(session.contextCompaction?.compactedUpToIndex || 0, tailStart)
  source.push(...compacted)
  return source
}

export function buildAutoCompactLoopMessages(session, messages) {
  const summaryMessage = session?.contextCompaction?.summaryMessage
  if (!summaryMessage) return messages
  const source = Array.isArray(messages) ? messages : []
  const compactedUpToIndex = Math.min(source.length, Math.max(0, Number(session.contextCompaction?.compactedUpToIndex) || 0))
  // 防御旧持久化数据：compactedUpToIndex 可能指向 toolResult，跳过开头的孤儿，
  // 避免压缩后的消息序列以 tool 消息开头（LLM API 会拒绝孤立 tool 消息）
  let tailStart = compactedUpToIndex
  while (tailStart < source.length && isToolResultMessage(source[tailStart])) tailStart += 1
  return [summaryMessage, ...source.slice(tailStart)]
}

function messageTimestampMs(message) {
  const value = message?.timestamp
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function minimumProviderUsageIndex(session, messages) {
  if (!session?.contextCompaction?.summaryMessage) return 0
  const source = Array.isArray(messages) ? messages : []
  const compactedUpToIndex = Math.min(source.length, Math.max(0, Number(session.contextCompaction.compactedUpToIndex) || 0))
  let tailStart = compactedUpToIndex
  while (tailStart < source.length && isToolResultMessage(source[tailStart])) tailStart += 1

  const compactedAt = Date.parse(session.contextCompaction.compactedAt || '')
  if (Number.isFinite(compactedAt)) {
    const firstNewMessageIndex = source.findIndex((message) => messageTimestampMs(message) > compactedAt)
    if (firstNewMessageIndex >= 0) return Math.max(1, firstNewMessageIndex - tailStart + 1)
  }

  const sourceMessageCount = Number(session.contextCompaction.sourceMessageCount)
  if (Number.isFinite(sourceMessageCount) && sourceMessageCount > 0 && source.length >= sourceMessageCount) {
    return Math.max(1, sourceMessageCount - tailStart + 1)
  }
  return source.length - tailStart + 1
}

export function hasNewMessagesSinceCompaction(session, messages) {
  if (!session?.contextCompaction?.summaryMessage) return true
  const source = Array.isArray(messages) ? messages : []
  const sourceMessageCount = Number(session.contextCompaction.sourceMessageCount)
  if (Number.isFinite(sourceMessageCount) && sourceMessageCount > 0 && source.length > sourceMessageCount) return true

  const compactedAt = Date.parse(session.contextCompaction.compactedAt || '')
  return Number.isFinite(compactedAt) && source.some((message) => messageTimestampMs(message) > compactedAt)
}

/**
 * Minimum tail an automatic compaction must keep.
 *
 * `keepRecentTurns: 0` means "keep nothing", which is correct for the manual
 * `/compact` command (the user explicitly asked to summarize everything so far)
 * but wrong for the automatic path: it runs *inside* an active run, between two
 * model calls, so "compact everything" puts the timeline divider inside the turn
 * the user is currently watching. Two visible symptoms followed:
 *
 * - the divider was inserted between rows produced seconds earlier, directly
 *   contradicting its own label ("earlier context is summarized");
 * - right after compaction the boundary equalled the message count, so the
 *   divider was the list's last child with nothing under it — an orphan line
 *   above the composer until the next streamed row happened to appear.
 *
 * Keeping the current user turn gives the divider a real referent (history above,
 * this turn below) at any `keepRecentTurns` setting, and costs nothing when the
 * configured value is already ≥ 1.
 *
 * It is a preference, not a precondition: a single-user-turn agentic session has
 * no complete turn to keep once the tail would swallow the whole history, so
 * compaction then runs with an empty tail instead of being skipped entirely.
 */
export const AUTO_COMPACT_MIN_TAIL_USER_TURNS = 1

export function resolveAutoCompactTailStart(messages, keepRecentTurns) {
  const source = Array.isArray(messages) ? messages : []
  const configured = clampNumber(keepRecentTurns, DEFAULT_AUTO_COMPACT_SETTINGS.keepRecentTurns, 0, 20)
  const effective = Math.max(AUTO_COMPACT_MIN_TAIL_USER_TURNS, configured)
  const tailStart = tailStartForRecentTurns(source, effective)
  // A cut at index 0 keeps the whole history, i.e. compacts nothing —
  // `tailStartForRecentTurns` cannot tell "found at index 0" from "not found"
  // because both return 0. Do not give up on that: degrade the number of kept
  // turns (3 → 2 → 1) and, when even one kept turn would swallow everything,
  // compact the whole history. A session must never end up permanently
  // uncompacted just because it happens to contain fewer user turns than the
  // setting asks for.
  if (tailStart > 0) return tailStart
  for (let keep = effective - 1; keep >= 1; keep--) {
    const candidate = tailStartForRecentTurns(source, keep)
    if (candidate > 0) return candidate
  }
  return source.length
}

export async function compactSessionInPlace({
  session,
  messages,
  keepRecentTurns = DEFAULT_AUTO_COMPACT_SETTINGS.keepRecentTurns,
  usage,
  thresholdPercent,
  emitSessionEvent,
  persistSession,
  reason = 'manual_compact',
  summaryIntro = 'The previous conversation has been compacted. Treat the following summary as the authoritative replacement for earlier history. If information is missing, ask for clarification instead of guessing.',
  onBeforePersist,
}) {
  const source = Array.isArray(messages) ? messages : []
  const normalizedKeepRecentTurns = clampNumber(keepRecentTurns, DEFAULT_AUTO_COMPACT_SETTINGS.keepRecentTurns, 0, 20)
  // The manual command keeps its exact "summarize everything" semantics; the
  // automatic path aligns the cut to the current user turn (see
  // AUTO_COMPACT_MIN_TAIL_USER_TURNS).
  const tailStart = reason === 'manual_compact'
    ? tailStartForRecentTurns(source, normalizedKeepRecentTurns)
    : resolveAutoCompactTailStart(source, normalizedKeepRecentTurns)
  const sourceMessages = buildCompactionSourceMessages(session, source, tailStart)
  // 上下文超过阈值就压：唯一的前置是确实存在可压缩的消息序列（至少两条）。
  if (sourceMessages.length < 2) {
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
  const compactedAt = new Date().toISOString()
  const summaryMessage = userTextMessage([
    summaryIntro,
    '',
    '<compact_summary>',
    result.summary,
    '</compact_summary>',
  ].join('\n'), compactionMessageDetails('summary'))
  // Every compaction is appended to `history` instead of overwriting the single
  // record, so the timeline can keep one divider per compaction at the moment it
  // really happened.
  //
  // Two coordinates are recorded on purpose — they are different things and only
  // coincide when `keepRecentTurns` is 0 in a single-turn session:
  // - `occurredAtIndex`: the messages length at the instant compaction ran. This
  //   is the physical position ("this is where the timeline got summarized") and
  //   is what the divider is anchored to.
  // - `boundaryIndex`: the tail start, i.e. the right edge of the summarized
  //   range. A rolling compaction keeps N recent turns, so this can sit several
  //   messages *before* the moment it happened.
  const historyEntry = {
    compactedAt,
    occurredAtIndex: source.length,
    boundaryIndex: tailStart,
    summaryMessage,
    keepRecentTurns: normalizedKeepRecentTurns,
    sourceMessageCount: source.length,
    usageBefore: usage,
    thresholdPercent,
  }
  const previousHistory = Array.isArray(session.contextCompaction?.history) ? session.contextCompaction.history : []
  session.contextCompaction = {
    summaryMessage,
    compactedUpToIndex: tailStart,
    compactedAt,
    keepRecentTurns: normalizedKeepRecentTurns,
    sourceMessageCount: source.length,
    usageBefore: usage,
    thresholdPercent,
    history: [...previousHistory, historyEntry].slice(-MAX_CONTEXT_COMPACTION_HISTORY),
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
    minimumProviderUsageIndex: minimumProviderUsageIndex(session, sourceMessages),
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

/**
 * Outcome kinds for `confirmAutoCompact`.
 *
 * The old contract was `boolean`, which collapsed the three cases the UI must
 * tell apart: the user declined (suppress for 10 minutes, hide the card),
 * nobody answered in time (drop the card, do not punish the user), and no
 * approval channel exists (a server-side problem, not a user decision).
 */
export const AUTO_COMPACT_DECISION = Object.freeze({
  APPROVED: 'approved',
  DECLINED: 'declined',
  TIMED_OUT: 'timed_out',
  UNAVAILABLE: 'unavailable',
})

function normalizeDecision(value) {
  if (value === true) return AUTO_COMPACT_DECISION.APPROVED
  if (value === AUTO_COMPACT_DECISION.APPROVED) return AUTO_COMPACT_DECISION.APPROVED
  if (value === AUTO_COMPACT_DECISION.TIMED_OUT) return AUTO_COMPACT_DECISION.TIMED_OUT
  if (value === AUTO_COMPACT_DECISION.UNAVAILABLE) return AUTO_COMPACT_DECISION.UNAVAILABLE
  return AUTO_COMPACT_DECISION.DECLINED
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
    minimumProviderUsageIndex: minimumProviderUsageIndex(session, messages),
  })
  if (!usage.contextWindow) return { compacted: false, usage, reason: 'missing_context_window' }
  if (!shouldCompactContextByPercent(usage, settings.thresholdPercent)) return { compacted: false, usage, reason: 'below_threshold' }

  const now = Date.now()
  if (!hasNewMessagesSinceCompaction(session, messages)) {
    return { compacted: false, usage, reason: 'not_enough_new_messages' }
  }

  const tailStart = resolveAutoCompactTailStart(messages, settings.keepRecentTurns)
  const sourceMessages = buildCompactionSourceMessages(session, messages, tailStart)
  if (sourceMessages.length < 2) {
    return { compacted: false, usage, reason: 'not_enough_history' }
  }

  if (settings.requireConfirmation) {
    // The approval id is minted here (not inside the approval promise) so the
    // published notice is self-sufficient: the surface can render the decision
    // row and call the approve/reject route from the notice alone, without a
    // second source of truth racing the first one.
    const approvalId = randomUUID()
    setCompactionNotice(session, {
      phase: COMPACTION_NOTICE_PHASES.AWAITING_CONFIRMATION,
      approvalId,
      usage,
      thresholdPercent: settings.thresholdPercent,
      keepRecentTurns: settings.keepRecentTurns,
      requestedAt: new Date(now).toISOString(),
    }, emitSessionEvent)

    if (!confirmAutoCompact) {
      // No approval channel: drop the notice immediately instead of leaving the
      // user staring at a row whose buttons cannot resolve anything.
      setCompactionNotice(session, null, emitSessionEvent)
      return { compacted: false, usage, reason: 'confirmation_unavailable' }
    }

    let decision = AUTO_COMPACT_DECISION.UNAVAILABLE
    try {
      decision = normalizeDecision(await confirmAutoCompact(session, { usage, settings, approvalId }))
    } catch (error) {
      // Aborted runs reject the pending approval (see agent-manager's abort
      // path). Cancellation is not a compaction failure: keep the notice
      // cleared and let the outer run report its own abort status.
      logger?.debug?.(`Auto compact confirmation cancelled for session ${session.sessionId}:`, error?.message || error)
    }
    // Any decision settles the pending phase; the accepted path immediately
    // enters `summarizing` below, so the two publishes never both linger.
    setCompactionNotice(session, null, emitSessionEvent)

    if (decision !== AUTO_COMPACT_DECISION.APPROVED || signal?.aborted) {
      return {
        compacted: false,
        usage,
        reason: decision === AUTO_COMPACT_DECISION.DECLINED
          ? 'user_rejected'
          : decision === AUTO_COMPACT_DECISION.TIMED_OUT
            ? 'confirmation_timeout'
            : signal?.aborted
              ? 'aborted'
              : 'confirmation_unavailable',
      }
    }
  }

  session.autoCompacting = true
  setCompactionNotice(session, {
    phase: COMPACTION_NOTICE_PHASES.SUMMARIZING,
    usage,
    thresholdPercent: settings.thresholdPercent,
    keepRecentTurns: settings.keepRecentTurns,
    requestedAt: new Date(now).toISOString(),
  }, emitSessionEvent)

  try {
    const result = await compactSessionInPlace({
      session,
      messages,
      keepRecentTurns: settings.keepRecentTurns,
      usage,
      thresholdPercent: settings.thresholdPercent,
      emitSessionEvent,
      persistSession,
      reason: 'auto_compact',
      summaryIntro: 'The previous conversation has been automatically compacted. Treat the following summary as the authoritative replacement for earlier history. If information is missing, ask for clarification instead of guessing.',
      onBeforePersist: () => {
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
    // Terminal clear for every exit path (success, skip, throw). The surface
    // keeps showing nothing once compaction settled; leaving the notice behind
    // is what produced the "stuck on summarizing" state in the old design.
    setCompactionNotice(session, null, emitSessionEvent)
  }
}
