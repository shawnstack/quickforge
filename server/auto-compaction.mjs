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
}

/**
 * 压缩历史：每一次压缩一条记录，不设上限。
 *
 * 滚动压缩（rolling compaction）每次只把「上一版摘要 + 上次切点之后的增量」
 * 交给模型，但每次压缩都是一段独立的过程，所以每次压缩都往
 * `contextCompaction.history` 追加一条自带当次摘要与用量的记录，而不是覆盖，
 * 也不按条数丢弃——截断会让第 N 次之后的压缩记录凭空消失。
 *
 * 代价：`body_json` 随压缩次数线性增长（每条记录 ≈ 一份当次摘要）。摘要消息
 * 本身也在 `messages` 里，因此这里不再额外做去重或截断。
 */

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
  }
}

export async function readAutoCompactSettings() {
  const settings = await readStore('settings')
  return normalizeAutoCompactSettings(settings?.[AUTO_COMPACT_SETTINGS_KEY])
}

/**
 * Compaction UI state (single source of truth for the chat surface).
 *
 * Compaction is an internal detail: the full transcript stays in the session
 * and in the timeline, only the context sent to the model gets shorter. It is
 * therefore never gated on a user decision — the only thing the surface needs
 * to know is "summary generation is in flight, the run is waiting on it".
 *
 * Before this projection existed the server only emitted fire-and-forget events
 * and kept `autoCompacting` as a private boolean, so a run that stalled for tens
 * of seconds on the summarization round trip rendered nothing at all and looked
 * hung.
 *
 * The notice is therefore a complete projection of the pipeline: entering the
 * phase publishes it, every exit (success, skip, throw) publishes `null`, and
 * consumers never have to infer state from the absence of events.
 */
export const COMPACTION_NOTICE_PHASES = Object.freeze({
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

function isToolResultMessage(message) {
  return message?.role === 'toolResult'
}

function userTextMessage(text, details) {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
    ...(details ? { details } : {}),
  }
}

/**
 * 压缩后派生下标的坐标空间换算。
 *
 * pi-agent-core 的 run loop 用的是 run 启动时的消息快照副本，之后只往
 * `agent.state.messages` push；就地压缩插入的摘要消息因此只存在于 state，
 * 不在 run 内后续 `transformContext` 收到的数组里。此时 state 恰好比传入
 * 数组多一条、且摘要正好落在 `compactedUpToIndex - 1` —— 返回 1，调用方
 * 把派生下标平移回传入数组的坐标空间。其余情况（下一次 run 的快照已包含
 * 摘要、旧会话迁移前的 state、无压缩）返回 0。
 *
 * 返回 1 也意味着传入数组里即使有摘要，也只可能是更早的旧摘要（run 启动前
 * 就在快照里），见 `summaryIndexInMessages`。
 */
function compactionSnapshotShift(session, messages) {
  const compaction = session?.contextCompaction
  const stateMessages = session?.agent?.state?.messages
  if (!compaction?.summaryMessage || !Array.isArray(stateMessages)) return 0
  const messagesLength = Array.isArray(messages) ? messages.length : 0
  if (stateMessages.length !== messagesLength + 1) return 0
  if (messages?.includes(compaction.summaryMessage)) return 0
  const summaryIndex = Math.max(0, Number(compaction.compactedUpToIndex) || 0) - 1
  return stateMessages[summaryIndex] === compaction.summaryMessage ? 1 : 0
}

/** `compactedUpToIndex`（state 坐标空间）换算到传入数组空间并 clamp。 */
function compactedUpToIn(session, messages) {
  const source = Array.isArray(messages) ? messages : []
  const shift = compactionSnapshotShift(session, source)
  const stored = Math.max(0, Number(session?.contextCompaction?.compactedUpToIndex) || 0)
  return Math.min(source.length, Math.max(0, stored - shift))
}

/**
 * 本次要并入摘要的源消息：上一版摘要（滚动压缩）+ 上次切点之后的全部增量。
 * 压缩点固定是当前数组末尾，所以增量就是「自上次压缩以来的所有消息」。
 */
function buildCompactionSourceMessages(session, messages) {
  const source = Array.isArray(messages) ? messages : []
  const previousSummary = session.contextCompaction?.summaryMessage
  const sourceMessages = previousSummary
    ? [userTextMessage([
        'Existing rolling compact summary from earlier conversation history:',
        '',
        '<compact_summary>',
        extractCompactSummaryText(previousSummary),
        '</compact_summary>',
      ].join('\n'), compactionMessageDetails('summary'))]
    : []
  sourceMessages.push(...source.slice(compactedUpToIn(session, source)))
  return sourceMessages
}

/** 把 messages 换成新数组：与 agent-manager 的 updateSessionMessages 同一语义。 */
function replaceSessionMessages(session, messages) {
  if (session?.agent?.state) session.agent.state.messages = messages
}

/** 数组里最后一条压缩摘要消息的下标；没有则 -1。 */
export function lastCompactionMessageIndex(messages) {
  const source = Array.isArray(messages) ? messages : []
  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (isCompactSummaryMessage(source[index])) return index
  }
  return -1
}

/**
 * 当前压缩点在传入数组里的下标；当前摘要不在这个数组里时返回 -1。
 *
 * run 内再次压缩时，快照里还留着 run 启动前的旧摘要，新摘要只在 state 里。
 * 这时不能按「最后一条摘要」切片，否则模型收到的仍是旧摘要加全部后续消息，
 * 上下文不会变小，下一次请求前又会触发压缩。
 */
function summaryIndexInMessages(session, messages) {
  return compactionSnapshotShift(session, messages) ? -1 : lastCompactionMessageIndex(messages)
}

/**
 * 截断/重试之后把压缩下标对齐到当前数组（tail 起点 = 压缩消息下标 + 1）。
 * 位置语义由消息表达，这里只维护派生索引，供用量估算与诊断使用。
 *
 * 滚动压缩每压一次就往数组追加一条摘要，旧摘要仍留在原处。所以回撤/重试可能
 * 截掉「当前」那条摘要，而数组里还剩下更早的一条：下标跟着数组走的同时，
 * `summaryMessage` 也必须换成现存的那条。否则下一次压缩会把已被删除的摘要
 * 当成 `previousSummary` 再喂一遍，用户已经回撤掉的内容会重新出现在新摘要里。
 */
export function syncCompactionIndex(session, compactionIndex, messageCount, summaryMessage) {
  const compaction = session?.contextCompaction
  if (!compaction) return
  session.contextCompaction = {
    ...compaction,
    summaryMessage: summaryMessage ?? compaction.summaryMessage,
    compactedUpToIndex: Math.max(0, Number(compactionIndex) + 1),
    sourceMessageCount: Math.max(0, Number(messageCount) || 0),
  }
}

/**
 * 模型上下文：压缩摘要本身就是一条消息，从最后一条压缩消息开始读即可。
 *
 * 传入数组里找不到摘要消息时走只读兼容分支，把摘要拼回虚拟数组的开头：
 * run 内快照的摘要只在 state 里（见 `compactionSnapshotShift`，下标需平移）。
 * 只有 contextCompaction、消息数组里没有摘要的旧会话不做迁移，同样落到这里。
 */
export function buildAutoCompactLoopMessages(session, messages) {
  const source = Array.isArray(messages) ? messages : []
  const compactionIndex = summaryIndexInMessages(session, source)
  if (compactionIndex >= 0) return source.slice(compactionIndex)

  const summaryMessage = session?.contextCompaction?.summaryMessage
  if (!summaryMessage) return source
  // 防御旧持久化数据：compactedUpToIndex 可能指向 toolResult，跳过开头的孤儿。
  let tailStart = compactedUpToIn(session, source)
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

/**
 * 压缩发生时刻（毫秒）。
 *
 * 元数据里的 `compactedAt` 优先；只有消息里的摘要时（`/summary` 新会话、fork 出来的
 * 压缩会话）退回摘要消息自己的时间戳——摘要消息就是压缩发生那一刻创建的。
 */
function compactionCutoffMs(session, messages) {
  const stored = Date.parse(session?.contextCompaction?.compactedAt || '')
  if (Number.isFinite(stored) && stored > 0) return stored
  const source = Array.isArray(messages) ? messages : []
  const index = lastCompactionMessageIndex(source)
  const summaryMessage = index >= 0 ? source[index] : session?.contextCompaction?.summaryMessage
  return messageTimestampMs(summaryMessage)
}

/**
 * 遮掉压缩点之前产生、却被 tail 原样保留的 assistant usage。
 *
 * `/summary` 的 keepTurns 与 fork 出来的压缩会话会把压缩前的消息原样带在摘要后面，
 * 这些消息还带着压缩前那次请求的 provider usage。估算上下文时若沿用它，占用会停在
 * 压缩前的量级——界面显示“已压缩”，百分比却不下降。只有压缩之后产生的回复才继续
 * 参与 provider 口径。返回新数组是为了不修改会话里的消息本身。
 */
function withoutStaleProviderUsage(messages, compactedAt) {
  if (!(Number(compactedAt) > 0)) return messages
  let changed = false
  const next = (Array.isArray(messages) ? messages : []).map((message) => {
    if (message?.role !== 'assistant' || !message.usage) return message
    const timestamp = messageTimestampMs(message)
    // 时间戳未知时不猜：旧数据/构造出来的消息保持原有口径，避免误伤。
    if (!(timestamp > 0) || timestamp > compactedAt) return message
    changed = true
    const { usage: _usage, ...rest } = message
    return rest
  })
  return changed ? next : messages
}

function minimumProviderUsageIndex(session, messages) {
  const source = Array.isArray(messages) ? messages : []
  // 方案 B：压缩点本身可能就是数组里的一条消息（`/summary` 生成的新会话、fork
  // 出来的压缩会话、升级前的旧会话）。这些会话没有 `contextCompaction` 元数据，
  // 只认元数据会返回 0，让压缩前那次请求上报的 provider usage 被当成「当前
  // 上下文」——界面显示已压缩，占用却不下降。所以先按消息定界，与
  // `buildAutoCompactLoopMessages` 同源。
  const compactionIndex = summaryIndexInMessages(session, source)
  const summaryMessage = compactionIndex >= 0
    ? source[compactionIndex]
    : session?.contextCompaction?.summaryMessage
  if (!summaryMessage) return 0

  let tailStart = compactionIndex >= 0
    ? compactionIndex + 1
    : compactedUpToIn(session, source)
  while (tailStart < source.length && isToolResultMessage(source[tailStart])) tailStart += 1

  const compactedAt = compactionCutoffMs(session, source)
  if (compactedAt > 0) {
    const firstNewMessageIndex = source.findIndex((message) => messageTimestampMs(message) > compactedAt)
    if (firstNewMessageIndex >= 0) return Math.max(1, firstNewMessageIndex - tailStart + 1)
  }

  const sourceMessageCount = Number(session?.contextCompaction?.sourceMessageCount)
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
 * 压缩点 = 压缩发生的那一刻，即当时的消息数组末尾。
 *
 * 分割线是一条真实消息（方案 B），界面位置就是数组下标；摘要边界与线的
 * 位置共用同一个下标，因此「线落在压缩发生点」意味着：到那一刻为止的
 * 全部历史（含本轮已执行完的 tool 调用与当前用户请求）都并入摘要，之后
 * 产生的新消息天然排在线下方——与排队消息被消费时插入数组尾部的位置
 * 逻辑一致，只是渲染成时间线分割线而不是消息气泡。当前用户请求不在线
 * 下重复保留，由摘要承载（COMPACT_SYSTEM_PROMPT 要求保留 user's final
 * goal 与 current task state）。
 *
 * 代价：压缩刚完成时线在列表末尾、下方暂时为空，直到下一条流式消息
 * 出现。这是接受的过渡态。曾用 `AUTO_COMPACT_MIN_TAIL_USER_TURNS=1` 把
 * 切点前移到当前用户回合起点来避免它，代价是线被抬到用户消息上方、远离
 * 压缩实际发生的位置——那正是本次改回压缩点锚定的原因。
 */
export async function compactSessionInPlace({
  session,
  messages,
  usage,
  thresholdPercent,
  emitSessionEvent,
  persistSession,
  reason = 'manual_compact',
  summaryIntro = 'The previous conversation has been compacted. Treat the following summary as the authoritative replacement for earlier history. If information is missing, ask for clarification instead of guessing.',
  onBeforePersist,
}) {
  const source = Array.isArray(messages) ? messages : []
  const sourceMessages = buildCompactionSourceMessages(session, source)
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
  // 方案 B：摘要本身就是一条消息，插在压缩发生点（当时数组末尾），压缩点
  // 从此是数组里的一个下标 —— 位置不靠坐标推断，也不会随窗口滑动漂移。
  // 插入之后 tail 的起点是「压缩消息下标 + 1」。
  const tailStart = source.length
  const nextMessages = [...source, summaryMessage]
  replaceSessionMessages(session, nextMessages)
  const compactedUpToIndex = nextMessages.length
  // 诊断字段：位置语义已由消息本身表达，这里只留时间线与用量快照。
  const historyEntry = {
    compactedAt,
    occurredAtIndex: tailStart,
    boundaryIndex: tailStart,
    summaryMessage,
    sourceMessageCount: source.length,
    usageBefore: usage,
    thresholdPercent,
  }
  const previousHistory = Array.isArray(session.contextCompaction?.history) ? session.contextCompaction.history : []
  session.contextCompaction = {
    summaryMessage,
    compactedUpToIndex,
    compactedAt,
    sourceMessageCount: nextMessages.length,
    usageBefore: usage,
    thresholdPercent,
    history: [...previousHistory, historyEntry],
  }
  onBeforePersist?.({ result, sourceMessages, tailStart, summaryMessage, messages: nextMessages })
  // 摘要插在数组末尾，但 state 之前的内容可能被替换（滚动压缩重打包上一版
  // 摘要），仍整份重写消息行，避免存储层把重排当尾部追加。
  await persistSession?.(session, { forceMessagesReplace: true })
  const contextUsage = estimateSessionContextUsage(session, nextMessages)
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
    messages: nextMessages,
    contextCompaction: session.contextCompaction,
    contextUsage,
  })
  return { compacted: true, usage, result, sourceMessages, tailStart, messages: nextMessages }
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
      inputTokenSource: 'unavailable',
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
  const estimateMessages = withoutStaleProviderUsage(loopMessages, compactionCutoffMs(session, sourceMessages))
  const value = estimateContextUsage({
    systemPrompt: session.agent.state.systemPrompt,
    messages: estimateMessages,
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

export async function maybeAutoCompactSession({ session, messages, signal, emitSessionEvent, persistSession, logger }) {
  if (!session || session.autoCompacting) return { compacted: false }
  const settings = await readAutoCompactSettings()
  if (!settings.enabled) return { compacted: false, reason: 'disabled' }
  if (signal?.aborted) return { compacted: false, reason: 'aborted' }

  const loopMessages = buildAutoCompactLoopMessages(session, messages)
  const usage = estimateContextUsage({
    systemPrompt: session.agent.state.systemPrompt,
    messages: withoutStaleProviderUsage(loopMessages, compactionCutoffMs(session, messages)),
    tools: session.agent.state.tools,
    model: session.model,
    minimumProviderUsageIndex: minimumProviderUsageIndex(session, messages),
  })
  if (!usage.contextWindow) return { compacted: false, usage, reason: 'missing_context_window' }
  if (!shouldCompactContextByPercent(usage, settings.thresholdPercent)) return { compacted: false, usage, reason: 'below_threshold' }

  if (!hasNewMessagesSinceCompaction(session, messages)) {
    return { compacted: false, usage, reason: 'not_enough_new_messages' }
  }

  const sourceMessages = buildCompactionSourceMessages(session, messages)
  if (sourceMessages.length < 2) {
    return { compacted: false, usage, reason: 'not_enough_history' }
  }

  session.autoCompacting = true
  setCompactionNotice(session, {
    phase: COMPACTION_NOTICE_PHASES.SUMMARIZING,
    usage,
    thresholdPercent: settings.thresholdPercent,
    requestedAt: new Date().toISOString(),
  }, emitSessionEvent)

  try {
    const result = await compactSessionInPlace({
      session,
      messages,
      usage,
      thresholdPercent: settings.thresholdPercent,
      emitSessionEvent,
      persistSession,
      reason: 'auto_compact',
      summaryIntro: 'The previous conversation has been automatically compacted. Treat the following summary as the authoritative replacement for earlier history. If information is missing, ask for clarification instead of guessing.',
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
