/**
 * Agent-driven context eviction (feature-gated, off by default).
 *
 * 存储层的完整消息历史永不删除；本模块只维护一份「遗忘账本」
 * (session.contextEviction)，在 transformContext 投影阶段把账本命中的
 * toolResult / 旧 assistant 正文替换为一行占位符，从而缩小运行时发给
 * 模型的上下文。工具调用配对结构保持完整（toolUse 保留、toolResult 的
 * toolCallId/toolName 不变），因此不会触发 LLM API 的孤儿 tool 消息错误。
 *
 * 账本按稳定消息 id 记录：消息 id 在投影前由 ensureMessageIds 兜底补齐
 * （SQLite 层 message.id 为可空 string，旧消息升级后首次投影时获得 id）。
 * 回滚/重试会移动消息数组索引，但 id 引用天然失配即惰性失效，无需修正。
 */

import { randomUUID } from 'node:crypto'
import { estimateTokens } from '@earendil-works/pi-agent-core'
import { readStore } from './storage.mjs'
import { isCompactSummaryMessage } from './conversation-compaction.mjs'

export const CONTEXT_EVICTION_SETTINGS_KEY = 'context-eviction-settings'

export const DEFAULT_CONTEXT_EVICTION_SETTINGS = {
  enabled: false,
}

const ASSISTANT_PLACEHOLDER_PREVIEW_CHARS = 120

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function normalizeContextEvictionSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_CONTEXT_EVICTION_SETTINGS }
  return {
    enabled: value.enabled === true,
  }
}

export async function readContextEvictionSettings() {
  const settings = await readStore('settings')
  return normalizeContextEvictionSettings(settings?.[CONTEXT_EVICTION_SETTINGS_KEY])
}

export async function isContextEvictionEnabled() {
  return (await readContextEvictionSettings()).enabled
}

// ---------------------------------------------------------------------------
// Message ids
// ---------------------------------------------------------------------------

/**
 * 就地为缺少稳定 id 的消息补一个 UUID（可重入：已有 id 的消息不动）。
 * 在 transformContext 投影前调用，使账本引用的 id 与提醒列出的 id 稳定一致。
 */
export function ensureMessageIds(messages) {
  if (!Array.isArray(messages)) return messages
  for (const message of messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) continue
    if (typeof message.id === 'string' && message.id.trim()) continue
    message.id = randomUUID()
  }
  return messages
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

function normalizeKind(value, fallback = 'toolResult') {
  return value === 'assistantText' ? 'assistantText' : value === 'toolResult' ? 'toolResult' : fallback
}

export function normalizeContextEviction(value) {
  const forgotten = Array.isArray(value?.forgotten)
    ? value.forgotten
      .filter((entry) => entry && typeof entry === 'object' && typeof entry.messageId === 'string' && entry.messageId.trim())
      .map((entry) => ({
        messageId: entry.messageId,
        kind: normalizeKind(entry.kind),
        reason: typeof entry.reason === 'string' ? entry.reason.slice(0, 500) : '',
        forgottenAt: typeof entry.forgottenAt === 'string' && entry.forgottenAt ? entry.forgottenAt : new Date().toISOString(),
      }))
    : []
  return { forgotten }
}

export function forgottenMessageIds(eviction) {
  return new Set(normalizeContextEviction(eviction).forgotten.map((entry) => entry.messageId))
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

function isUserTurnMessage(message) {
  return message?.role === 'user' || message?.role === 'user-with-attachments'
}

/** index 之后（不含自身）出现的用户回合数，作为消息「轮龄」。 */
export function userTurnsAfter(messages, index) {
  let turns = 0
  for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
    if (isUserTurnMessage(messages[cursor])) turns += 1
  }
  return turns
}

export function countUserTurns(messages) {
  return (Array.isArray(messages) ? messages : []).filter(isUserTurnMessage).length
}

export function isForgetCandidateMessage(message) {
  if (!message || typeof message !== 'object') return false
  if (message.role !== 'toolResult' && message.role !== 'assistant') return false
  if (isCompactSummaryMessage(message)) return false
  return true
}

/**
 * 规则求值：kind 限定遗忘对象类型；olderThanTurns 是 agent 自主的纯过滤
 * 参数（0 = 不限轮龄，N = 消息之后至少 N 个用户回合），不再叠加任何
 * 服务端豁免窗口——遗忘范围完全由 agent 判断，仅保留结构性保护
 * （user 消息与 compact summary 永不可忘）。
 */
export function evaluateContextForgetRule(messages, rule = {}) {
  const source = Array.isArray(messages) ? messages : []
  const kind = normalizeKind(rule.kind)
  const ruleTurns = clampNumber(rule.olderThanTurns, 0, 0, 100)
  const exceptIds = new Set(Array.isArray(rule.exceptMessageIds) ? rule.exceptMessageIds.filter((id) => typeof id === 'string' && id.trim()) : [])
  const toolFilter = Array.isArray(rule.tools) && rule.tools.length
    ? new Set(rule.tools.map((tool) => String(tool)).filter(Boolean))
    : null

  const targets = []
  source.forEach((message, index) => {
    if (!isForgetCandidateMessage(message)) return
    if (!message.id || exceptIds.has(message.id)) return
    if (kind === 'toolResult' && message.role !== 'toolResult') return
    if (kind === 'assistantText' && message.role !== 'assistant') return
    if (toolFilter && kind === 'toolResult' && !toolFilter.has(String(message.toolName || ''))) return
    if (ruleTurns > 0 && userTurnsAfter(source, index) < ruleTurns) return
    targets.push(message.id)
  })
  return targets
}

// ---------------------------------------------------------------------------
// Projection (placeholder replacement, keeps tool_use/tool_result pairing)
// ---------------------------------------------------------------------------

export function toolResultPlaceholder(message) {
  const toolName = typeof message?.toolName === 'string' && message.toolName ? message.toolName : 'unknown tool'
  return `[QuickForge context eviction] The agent forgot this ${toolName} tool result to free context. The original content is preserved in session storage and can be restored with context_recall if needed again.`
}

function assistantTextPreview(message) {
  const content = message?.content
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((block) => block?.type === 'text').map((block) => block.text || '').join('\n')
      : ''
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return '[QuickForge context eviction] The agent forgot this earlier reply to free context. The original is preserved in session storage.'
  const preview = flat.length > ASSISTANT_PLACEHOLDER_PREVIEW_CHARS ? `${flat.slice(0, ASSISTANT_PLACEHOLDER_PREVIEW_CHARS)}…` : flat
  return `[QuickForge context eviction] The agent forgot this earlier reply to free context: "${preview}" The original is preserved in session storage and can be restored with context_recall.`
}

/**
 * 把账本命中的消息替换为占位符版本（浅拷贝，不改原始 state 消息）：
 * - toolResult：content 整体替换为一行占位文本；toolCallId/toolName/details
 *   保留，配对结构完整。
 * - assistant：text 块折叠为一条预览占位文本块（thinking 块直接丢弃，
 *   不进预览）；toolCall 块原样保留。
 * 返回 { messages, replacedIds }。
 */
export function applyContextEviction(loopMessages, eviction) {
  const ids = forgottenMessageIds(eviction)
  const source = Array.isArray(loopMessages) ? loopMessages : []
  if (ids.size === 0) return { messages: source, replacedIds: [] }

  const replacedIds = []
  const messages = source.map((message) => {
    if (!message || typeof message !== 'object' || !ids.has(message.id)) return message
    if (message.role === 'toolResult') {
      replacedIds.push(message.id)
      return {
        ...message,
        content: [{ type: 'text', text: toolResultPlaceholder(message) }],
      }
    }
    if (message.role === 'assistant') {
      const content = Array.isArray(message.content) ? message.content : []
      const toolCallBlocks = content.filter((block) => block?.type === 'toolCall')
      replacedIds.push(message.id)
      return {
        ...message,
        content: [
          { type: 'text', text: assistantTextPreview(message) },
          ...toolCallBlocks,
        ],
      }
    }
    return message
  })
  return { messages, replacedIds }
}

// ---------------------------------------------------------------------------
// Always-on transient context usage notice
// ---------------------------------------------------------------------------

function messageTokens(message) {
  try {
    return estimateTokens(message)
  } catch {
    return 0
  }
}

/**
 * 构造「每次请求都注入」的瞬态上下文占比通知（只存在于本次请求的投影，
 * 不落存储）：占比行 + 账本计数行（已裁条数 / 剩余可裁条数——仅计数、无
 * 清单、无触发阈值，查什么仍由 agent 自主，需要清单时自行调
 * context_report）。可裁候选 > 0 时附固定工具指引；候选 = 0 时改为明确
 * 「已全部裁剪，跳过 context_forget」——否则模型每轮被同一句指引催促，
 * 对已裁完的会话反复空转调用（每次都返回「均已裁剪过」）。
 * 返回 { message, percent } 或 null（特性关闭/usage 缺失）。
 */
export function buildContextUsageNotice({ session, loopMessages, settings, usage }) {
  if (!settings?.enabled) return null
  const contextWindow = Number(usage?.contextWindow) || 0
  const percent = Number(usage?.percent) || 0
  const inputTokens = Number(usage?.inputTokens) || 0
  if (!contextWindow || percent <= 0) return null

  const forgottenIds = forgottenMessageIds(session?.contextEviction)
  const messages = Array.isArray(loopMessages) ? loopMessages : []
  const liveIds = new Set(messages.map((message) => message?.id).filter(Boolean))
  const forgottenCount = [...forgottenIds].filter((id) => liveIds.has(id)).length
  const forgettableCandidates = messages
    .filter((message) => message?.id && !forgottenIds.has(message.id) && isForgetCandidateMessage(message))
    .length

  const lines = [
    '<system-reminder>',
    `Context usage: ${percent}% of the ${contextWindow}-token window (${inputTokens} tokens).`,
    `Forgotten ledger: ${forgottenCount} item(s) already replaced by placeholders; ${forgettableCandidates} forgettable item(s) remaining.`,
  ]
  if (forgettableCandidates > 0) {
    lines.push('Manage context as you see fit: context_report lists forgettable items, context_forget frees space, context_recall restores forgotten items.')
  } else {
    lines.push('All forgettable items are already trimmed — skip context_forget until new tool results or replies accumulate; use context_recall only if a task needs forgotten content again.')
  }
  lines.push('</system-reminder>')

  return {
    message: {
      role: 'user',
      content: [{ type: 'text', text: lines.join('\n') }],
      timestamp: Date.now(),
      details: { type: 'context_usage_notice', percent, inputTokens, contextWindow, forgottenCount, forgettableCandidates },
    },
    percent,
  }
}

/** 把瞬态提醒作为末尾 user 消息附加（投影副本上操作，不落 state）。 */
export function appendReminderMessage(messages, reminderMessage) {
  if (!reminderMessage) return messages
  return [...(Array.isArray(messages) ? messages : []), reminderMessage]
}

// ---------------------------------------------------------------------------
// context_forget tool handler
// ---------------------------------------------------------------------------

function describeForgetTarget(message) {
  return {
    id: message?.id,
    kind: message?.role === 'assistant' ? 'assistantText' : 'toolResult',
    toolName: message?.role === 'toolResult' ? String(message.toolName || '') : '',
    message,
  }
}

function resolveForgetTargets(messages, params, forgottenIds = new Set()) {
  const indexedById = new Map(messages.map((message, index) => [message?.id, { message, index }]))
  const explicitIds = Array.isArray(params?.messageIds)
    ? params.messageIds.filter((id) => typeof id === 'string' && id.trim())
    : []
  if (explicitIds.length > 0) {
    const targets = []
    const skipped = []
    const alreadyForgotten = []
    for (const id of explicitIds) {
      const entry = indexedById.get(id)
      // 无轮次豁免：显式 id 只挡结构性保护对象（user 消息与 compact summary）。
      if (!entry || !isForgetCandidateMessage(entry.message)) {
        skipped.push(id)
        continue
      }
      if (forgottenIds.has(id)) {
        alreadyForgotten.push(describeForgetTarget(entry.message))
        continue
      }
      targets.push(describeForgetTarget(entry.message))
    }
    return { targets, skipped, alreadyForgotten, rule: null }
  }

  const rule = params?.rule && typeof params.rule === 'object' ? params.rule : null
  if (!rule) return { targets: [], skipped: [], alreadyForgotten: [], rule: null }
  // 已入账 id 不进入 targets：重复规则/重复 id 以 alreadyForgotten 单独上报，
  // 避免 forgotten: 0 被误读为「规则没匹配到」。
  const targets = []
  const alreadyForgotten = []
  for (const id of evaluateContextForgetRule(messages, rule)) {
    const message = indexedById.get(id)?.message
    if (forgottenIds.has(id)) {
      alreadyForgotten.push(describeForgetTarget(message))
      continue
    }
    targets.push(describeForgetTarget(message))
  }
  return { targets, skipped: [], alreadyForgotten, rule }
}

/**
 * context_forget 工具执行体。依赖（persistSession/emitSessionEvent）由
 * agent-manager 注入，避免本模块反向依赖会话管理层。
 */
export async function handleContextForget({ session, params, settings, deps = {} }) {
  // settings 由包装层省略（读实时设置做双重校验）；测试/内部调用可直接注入。
  const normalizedSettings = settings && typeof settings === 'object' ? settings : await readContextEvictionSettings()
  if (!normalizedSettings.enabled) {
    throw new Error('Context eviction is disabled in Settings.')
  }
  const messages = Array.isArray(session?.agent?.state?.messages) ? session.agent.state.messages : []
  ensureMessageIds(messages)
  const ledger = normalizeContextEviction(session.contextEviction)
  const existing = new Map(ledger.forgotten.map((entry) => [entry.messageId, entry]))
  const { targets, skipped, alreadyForgotten, rule } = resolveForgetTargets(messages, params, new Set(existing.keys()))
  if (targets.length === 0 && skipped.length === 0 && alreadyForgotten.length === 0 && !rule) {
    return {
      content: 'Nothing to forget: provide messageIds or a rule ({ kind, olderThanTurns }).',
      details: { type: 'context_forget_result', forgotten: 0, tokensFreed: 0 },
    }
  }

  const reason = typeof params?.reason === 'string' ? params.reason.slice(0, 500) : ''
  const now = new Date().toISOString()
  let tokensFreed = 0
  const forgottenNow = []
  for (const target of targets) {
    existing.set(target.id, {
      messageId: target.id,
      kind: target.kind,
      reason,
      forgottenAt: now,
    })
    const tokens = messageTokens(target.message)
    tokensFreed += tokens
    forgottenNow.push({ id: target.id, kind: target.kind, toolName: target.toolName, tokens })
  }

  // 惰性清理：回滚/压缩后账本里可能残留已不存在的消息 id。
  const liveIds = new Set(messages.map((message) => message?.id).filter(Boolean))
  ledger.forgotten = [...existing.values()].filter((entry) => liveIds.has(entry.messageId))
  session.contextEviction = ledger

  await deps.persistSession?.(session)
  deps.emitSessionEvent?.(session, {
    type: 'context_eviction_updated',
    contextEviction: session.contextEviction,
    forgottenNow,
    tokensFreed,
  })

  const parts = []
  if (forgottenNow.length > 0) {
    parts.push(`Forgotten ${forgottenNow.length} message(s) (~${tokensFreed} tokens freed). They are replaced by placeholders in the model context; originals stay in storage.`)
  } else if (alreadyForgotten.length > 0) {
    parts.push(rule
      ? 'All messages matching the rule were already forgotten — nothing new to free; call again only after new tool results or replies accumulate.'
      : 'All targeted messages were already forgotten — nothing new to free.')
  } else if (rule) {
    parts.push('The rule matched nothing — try a smaller olderThanTurns or drop the tools filter.')
  } else {
    parts.push('No targeted messages were forgettable.')
  }
  if (alreadyForgotten.length > 0 && forgottenNow.length > 0) {
    parts.push(`${alreadyForgotten.length} matching message(s) were already forgotten (no change).`)
  }
  if (skipped.length > 0) parts.push(`Skipped ${skipped.length} id(s): not found or not forgettable (user messages and compact summaries cannot be forgotten).`)
  return {
    content: parts.join(' '),
    details: {
      type: 'context_forget_result',
      forgotten: forgottenNow.length,
      tokensFreed,
      forgottenNow,
      alreadyForgotten: alreadyForgotten.length,
      alreadyForgottenNow: alreadyForgotten.map(({ id, kind, toolName }) => ({ id, kind, toolName })),
      skipped,
    },
  }
}

/**
 * context_recall 工具执行体：把账本条目移出遗忘清单，被忘内容下一次
 * 模型请求即回到运行时上下文（存储里本来就有原文，无需复制）。
 */
export async function handleContextRecall({ session, params, settings, deps = {} }) {
  const normalizedSettings = settings && typeof settings === 'object' ? settings : await readContextEvictionSettings()
  if (!normalizedSettings.enabled) {
    throw new Error('Context eviction is disabled in Settings.')
  }
  const ledger = normalizeContextEviction(session?.contextEviction)
  const recallAll = params?.all === true
  const requestedIds = Array.isArray(params?.messageIds)
    ? params.messageIds.filter((id) => typeof id === 'string' && id.trim())
    : []

  if (!recallAll && requestedIds.length === 0) {
    if (ledger.forgotten.length === 0) {
      return {
        content: 'Nothing is currently forgotten in this session.',
        details: { type: 'context_recall_result', recalled: 0 },
      }
    }
    return {
      content: 'Provide messageIds or { "all": true } to recall forgotten items.',
      details: { type: 'context_recall_result', recalled: 0 },
    }
  }

  const requested = new Set(requestedIds)
  const recalledNow = []
  const remaining = []
  for (const entry of ledger.forgotten) {
    if (recallAll || requested.has(entry.messageId)) {
      recalledNow.push(entry)
    } else {
      remaining.push(entry)
    }
  }
  const notFound = recallAll ? [] : requestedIds.filter((id) => !recalledNow.some((entry) => entry.messageId === id))

  if (recalledNow.length === 0) {
    return {
      content: notFound.length > 0
        ? `None of the ${notFound.length} id(s) are in the forgotten ledger.`
        : 'Nothing to recall.',
      details: { type: 'context_recall_result', recalled: 0, notFound },
    }
  }

  session.contextEviction = { forgotten: remaining }
  await deps.persistSession?.(session)
  deps.emitSessionEvent?.(session, {
    type: 'context_eviction_updated',
    contextEviction: session.contextEviction,
    recalledNow: recalledNow.map((entry) => entry.messageId),
  })

  // 供前端工具卡下拉明细：召回条目附带 kind 与 toolName（消息已不在时回退账本 kind）。
  const messages = Array.isArray(session?.agent?.state?.messages) ? session.agent.state.messages : []
  const messageById = new Map(messages.map((message) => [message?.id, message]))
  const parts = [`Recalled ${recalledNow.length} message(s); their original content re-enters the model context on the next request.`]
  if (notFound.length > 0) parts.push(`${notFound.length} id(s) were not in the ledger.`)
  return {
    content: parts.join(' '),
    details: {
      type: 'context_recall_result',
      recalled: recalledNow.length,
      recalledNow: recalledNow.map((entry) => entry.messageId),
      recalledItems: recalledNow.map((entry) => ({
        id: entry.messageId,
        kind: entry.kind,
        toolName: messageById.get(entry.messageId)?.role === 'toolResult' ? String(messageById.get(entry.messageId).toolName || '') : '',
      })),
      notFound,
    },
  }
}

/**
 * context_report 工具执行体：完整可遗忘清单 + 当前账本状态，供 agent
 * 在裁剪前做精确决策（占比通知只报数字，不带清单）。usage 复用会话级缓存估算。
 */
export async function handleContextReport({ session, settings, deps: _deps = {} }) {
  const normalizedSettings = settings && typeof settings === 'object' ? settings : await readContextEvictionSettings()
  if (!normalizedSettings.enabled) {
    throw new Error('Context eviction is disabled in Settings.')
  }
  const messages = Array.isArray(session?.agent?.state?.messages) ? session.agent.state.messages : []
  ensureMessageIds(messages)
  const { estimateSessionContextUsage } = await import('./auto-compaction.mjs')
  const usage = estimateSessionContextUsage(session, messages) ?? {}
  const forgotten = normalizeContextEviction(session?.contextEviction)
  const forgottenIds = new Set(forgotten.forgotten.map((entry) => entry.messageId))

  const candidates = []
  let forgottenTokens = 0
  messages.forEach((message, index) => {
    const tokens = messageTokens(message)
    if (forgottenIds.has(message?.id)) {
      forgottenTokens += tokens
      return
    }
    if (!isForgetCandidateMessage(message) || !message.id) return
    candidates.push({
      id: message.id,
      kind: message.role === 'assistant' ? 'assistantText' : 'toolResult',
      toolName: message.role === 'toolResult' ? String(message.toolName || '') : '',
      turnsAgo: userTurnsAfter(messages, index),
      tokens,
    })
  })
  candidates.sort((a, b) => b.tokens - a.tokens)

  const lines = [
    `Context usage: ${usage.percent ?? 0}% of ${usage.contextWindow ?? 0} tokens (${usage.inputTokens ?? 0} tokens).`,
    `Forgotten so far: ${forgotten.forgotten.length} item(s) (~${forgottenTokens} tokens already replaced by placeholders).`,
  ]
  if (candidates.length > 0) {
    lines.push(`ForgetCandidates (${candidates.length}, sorted by size):`)
    for (const item of candidates) {
      const label = item.kind === 'toolResult' ? `${item.toolName || 'tool'} result` : 'earlier reply'
      lines.push(`- id ${item.id} · ${label} · ~${item.tokens} tokens · ${item.turnsAgo} user turn(s) later`)
    }
  } else {
    lines.push('ForgetCandidates: none (only user messages and compact summaries remain).')
  }

  return {
    content: lines.join('\n'),
    details: {
      type: 'context_report_result',
      percent: usage.percent ?? 0,
      contextWindow: usage.contextWindow ?? 0,
      inputTokens: usage.inputTokens ?? 0,
      forgottenCount: forgotten.forgotten.length,
      forgottenTokens,
      forgetCandidates: candidates,
    },
  }
}
