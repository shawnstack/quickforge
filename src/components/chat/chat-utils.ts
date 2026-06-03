/**
 * Shared types, DOM utilities, and token estimation for chat panel modules.
 *
 * Extracted from ChatPanelHost.tsx to reduce coupling and improve testability.
 * All functions are pure or operate on explicit inputs — no React or Lit dependencies.
 */

// ---------------------------------------------------------------------------
// Element types (narrowed HTMLElement subtypes for Web Component interop)
// ---------------------------------------------------------------------------

export type MessageEditorElement = HTMLElement & {
  value?: string
  attachments?: unknown[]
  onInput?: (value: string) => void
  onSend?: (input: string, attachments: unknown[]) => void
  onFilesChange?: (files: unknown[]) => void
  __quickforgePlanBaseOnSend?: (input: string, attachments: unknown[]) => void
  __quickforgePlanWrappedOnSend?: (input: string, attachments: unknown[]) => void
}

export type CommandSuggestionElement = HTMLDivElement & {
  __quickforgeDismissHandler?: (event: Event) => void
}

export type CommandTextareaElement = HTMLTextAreaElement & {
  __quickforgeCommandCompleteHandler?: (event: KeyboardEvent) => void
  __quickforgePlanModeHandler?: (event: KeyboardEvent) => void
}

export type AgentInterfaceElement = HTMLElement & {
  setInput?: (text: string, attachments?: unknown[]) => void
  setAutoScroll?: (enabled: boolean) => void
  enableModelSelector?: boolean
  enableThinkingSelector?: boolean
}

export type QuickForgeActionButton = HTMLButtonElement & {
  __quickforgeStopHandler?: (event: Event) => void
}

export type CustomCommandSummary = {
  name: string
  description?: string
  argumentHint?: string
  allowEdit?: boolean
  allowCommands?: boolean
  relativePath?: string
}

export type MessageUsage = {
  input?: number
  output?: number
  totalTokens?: number
}

export type MessageWithUsage = {
  role?: string
  content?: unknown
  attachments?: unknown
  toolName?: string
  toolCallId?: string
  toolCall?: unknown
  result?: unknown
  details?: unknown
  usage?: MessageUsage
  timestamp?: number | string
}

export type ComposerDraft = {
  text: string
  attachments?: unknown[]
}

export type DecorationContext = {
  panel: HTMLElement
  agent: {
    state: {
      messages: MessageWithUsage[]
      isStreaming: boolean
      model?: { contextWindow?: number }
      systemPrompt: string
      streamingMessage?: unknown
      tools: unknown[]
    }
    subscribe: (listener: (event: { type: string }) => void) => () => void
    abort: () => void
    sessionId: string
  }
  onCopyAnswer: (text: string) => Promise<void> | void
  onRollbackFromMessage: (messageIndex: number) => void
  onForkFromMessage: (messageIndex: number) => void
  onToggleYoloMode: () => void
  disableFork: boolean
  yoloMode: boolean
  workspaceToolsEnabled: boolean
  readOnly: boolean
  allowModelControls: boolean
  customCommands: CustomCommandSummary[]
  composerDrafts: Map<string, ComposerDraft>
  sessionId: string
}

// ---------------------------------------------------------------------------
// DOM utilities
// ---------------------------------------------------------------------------

/**
 * Replace an element's inner SVG without touching sibling nodes (e.g. Lit
 * comment markers).  If the element already contains an <svg>, only that
 * child is replaced; otherwise the new SVG is appended.
 */
export function replaceSvg(parent: HTMLElement, svgString: string) {
  const template = document.createElement('template')
  template.innerHTML = svgString
  const newSvg = template.content.firstElementChild
  if (!newSvg) return
  const oldSvg = parent.querySelector('svg')
  if (oldSvg) {
    oldSvg.replaceWith(newSvg)
  } else {
    parent.appendChild(newSvg)
  }
}

/**
 * Set an element's content from an HTML string, preserving any non-Element
 * children (comment markers, text nodes) that may be Lit internals.
 * Only element children from the string are grafted in; existing element
 * children are cleared first.
 */
export function patchContent(parent: HTMLElement, html: string) {
  const template = document.createElement('template')
  template.innerHTML = html
  const incoming = Array.from(template.content.children)
  // Remove existing element children but keep comment / text nodes (Lit markers).
  for (const child of Array.from(parent.children)) {
    child.remove()
  }
  for (const el of incoming) {
    parent.appendChild(el)
  }
}

// ---------------------------------------------------------------------------
// Draft helpers
// ---------------------------------------------------------------------------

export const emptyDraft = (): ComposerDraft => ({ text: '', attachments: [] })
export const hasDraft = (draft: ComposerDraft) => draft.text.length > 0 || (draft.attachments?.length ?? 0) > 0

// ---------------------------------------------------------------------------
// Token estimation (approximate)
// ---------------------------------------------------------------------------

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

export function estimateTextTokens(text: string) {
  const value = String(text || '')
  if (!value) return 0
  const cjkChars = value.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  const otherChars = Math.max(0, value.length - cjkChars)
  return Math.ceil(cjkChars + otherChars / 3.5)
}

export function textFromUnknown(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (!item || typeof item !== 'object') return textFromUnknown(item)
      const record = item as Record<string, unknown>
      if (record.type === 'text') return typeof record.text === 'string' ? record.text : ''
      if (record.type === 'thinking') return typeof record.thinking === 'string' ? record.thinking : ''
      if (record.type === 'image') return `[image:${typeof record.mimeType === 'string' ? record.mimeType : 'unknown'}]`
      if (record.type === 'toolCall') return `[toolCall:${typeof record.name === 'string' ? record.name : 'unknown'}] ${safeJson(record.arguments)}`
      return safeJson(record)
    }).filter(Boolean).join('\n')
  }
  if (typeof value === 'object') return safeJson(value)
  return String(value)
}

export function estimateAttachmentTokens(attachments: unknown): number {
  if (!Array.isArray(attachments)) return 0
  let total = 0
  for (const att of attachments) {
    const record = att as Record<string, unknown> | null | undefined
    if (!record) continue
    if (record.type === 'image') {
      total += 170
    } else if (typeof record.extractedText === 'string') {
      total += estimateTextTokens(record.extractedText)
    } else {
      total += 85
    }
  }
  return total
}

export function estimateMessageTokens(message: MessageWithUsage) {
  const parts = [message.role ?? '', textFromUnknown(message.content)]
  if (message.toolName) parts.push(message.toolName)
  if (message.toolCallId) parts.push(message.toolCallId)
  if (message.attachments !== undefined) parts.push(safeJson(message.attachments))
  return estimateTextTokens(parts.filter(Boolean).join('\n'))
}

export function estimateHistoryTokens(systemPrompt: string, messages: MessageWithUsage[], tools: unknown = []) {
  return estimateTextTokens(systemPrompt)
    + messages.reduce((total, message) => total + estimateMessageTokens(message), 0)
    + estimateTextTokens(safeJson(tools))
}

// ---------------------------------------------------------------------------
// Context usage calculation
// ---------------------------------------------------------------------------

export function messageTimestamp(message: MessageWithUsage) {
  if (typeof message.timestamp === 'number') return message.timestamp
  if (typeof message.timestamp === 'string') {
    const parsed = Date.parse(message.timestamp)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

export function hasCompactSummary(message: MessageWithUsage) {
  return message.role === 'user' && textFromUnknown(message.content).includes('<compact_summary>')
}

export function latestCompactTimestamp(messages: MessageWithUsage[]) {
  let timestamp = 0
  for (const message of messages) {
    if (hasCompactSummary(message)) timestamp = Math.max(timestamp, messageTimestamp(message))
  }
  return timestamp
}

export type ContextUsageInfo = {
  contextWindow: number
  usedTokens: number
  totalTokens: number
  inputTokens: number
  estimatedInputTokens: number
  inputTokenSource: 'provider' | 'estimated'
  reservedOutputTokens: number
  percent: number
  color: string
}

export function getContextUsage(
  systemPrompt: string,
  messages: MessageWithUsage[],
  contextWindow: number,
  tools: unknown = [],
  maxTokens?: number,
): ContextUsageInfo {
  const compactedAt = latestCompactTimestamp(messages)
  const usage = messages.reduce((latestUsage, message) => {
    const currentUsage = message.usage
    if (message.role !== 'assistant' || !currentUsage) return latestUsage
    if (compactedAt > 0 && messageTimestamp(message) <= compactedAt) return latestUsage
    return currentUsage
  }, undefined as MessageUsage | undefined)
  const providerInputTokens = usage?.input ?? usage?.totalTokens ?? 0
  const estimatedInputTokens = estimateHistoryTokens(systemPrompt, messages, tools)
  const hasProviderInputTokens = Number.isFinite(Number(providerInputTokens)) && Number(providerInputTokens) > 0
  const inputTokens = hasProviderInputTokens ? Number(providerInputTokens) : estimatedInputTokens
  const usedTokens = inputTokens
  const inputTokenSource = hasProviderInputTokens ? 'provider' : 'estimated'
  const reservedOutputTokens = Math.max(0, Number(maxTokens) || 4096)
  const totalTokens = usedTokens + reservedOutputTokens
  const percent = contextWindow > 0 ? Math.round((totalTokens / contextWindow) * 1000) / 10 : 0
  const colorPercent = Math.min(100, Math.max(0, percent))
  const hue = Math.round(142 - (142 * colorPercent / 100))
  return { contextWindow, usedTokens, totalTokens, inputTokens, estimatedInputTokens, inputTokenSource, reservedOutputTokens, percent, color: `hsl(${hue} 72% 45%)` }
}

export function formatTokens(value: number) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}
