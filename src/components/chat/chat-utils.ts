/**
 * Shared types, DOM utilities, and token estimation for chat panel modules.
 *
 * Extracted from ChatPanelHost.tsx to reduce coupling and improve testability.
 * All functions are pure or operate on explicit inputs — no React or framework runtime dependencies.
 */

// ---------------------------------------------------------------------------
// Element types (narrowed HTMLElement subtypes for the chat surface bridge)
// ---------------------------------------------------------------------------
// The React ChatSurface (surface/ChatSurface.tsx) installs the
// MessageEditorElement property surface on the `.qf-message-editor` root
// node; the panel-decoration layer keeps consuming it like the old
// `<message-editor>` element.

export type FileContextReference = {
  type: 'file'
  projectId: string
  path: string
}

type ComposerCapabilitySelection = {
  type: 'plugin' | 'skill' | 'tool' | 'command'
  pluginName: string
  name: string
  label: string
  description?: string
}

export type MessageEditorElement = HTMLElement & {
  value?: string
  attachments?: unknown[]
  contextReferences?: FileContextReference[]
  selectedCapabilities?: ComposerCapabilitySelection[]
  currentModel?: { id?: string; provider?: string; reasoning?: boolean }
  thinkingLevel?: string
  onInput?: (value: string) => void
  onSend?: (input: string, attachments: unknown[]) => void
  onFilesChange?: (files: unknown[]) => void
  onThinkingChange?: (level: string) => void
  requestUpdate?: () => void
  __quickforgePlanBaseOnSend?: (input: string, attachments: unknown[]) => void
  __quickforgePlanWrappedOnSend?: (input: string, attachments: unknown[]) => void
  __quickforgeAttachmentPasteGuard?: (event: ClipboardEvent) => void
  __quickforgeAttachmentDropGuard?: (event: DragEvent) => void
  __quickforgeLargePasteHandler?: (event: ClipboardEvent) => void}

export type CommandSuggestionElement = HTMLDivElement & {
  __quickforgeDismissHandler?: (event: Event) => void
}

export type CommandTextareaElement = HTMLTextAreaElement & {
  __quickforgeCommandCompleteHandler?: (event: KeyboardEvent) => void
  __quickforgePlanModeHandler?: (event: KeyboardEvent) => void
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
  source?: string
  pluginName?: string
}

type MessageUsage = {
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
  contextReferences?: FileContextReference[]
  selectedCapabilities?: ComposerCapabilitySelection[]
}

// ---------------------------------------------------------------------------
// DOM utilities
// ---------------------------------------------------------------------------

/**
 * Replace an element's inner SVG without touching sibling nodes (e.g. framework
 * markers).  If the element already contains an <svg>, only that
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
 * children (comment markers, text nodes) that mark decoration boundaries.
 * Only element children from the string are grafted in; existing element
 * children are cleared first.
 */
export function patchContent(parent: HTMLElement, html: string) {
  const template = document.createElement('template')
  template.innerHTML = html
  const incoming = Array.from(template.content.children)
  // Remove existing element children but keep comment / text nodes (markup markers).
  for (const child of Array.from(parent.children)) {
    child.remove()
  }
  for (const el of incoming) {
    parent.appendChild(el)
  }
}

/**
 * Keep the shared file/plugin chip row inside the message editor's actual input
 * card and before its textarea. Returns null when the editor has not rendered
 * enough DOM yet (or when a minimal test environment has no DOM).
 */
export function ensureComposerContextChips(editor: MessageEditorElement) {
  const textarea = editor.querySelector<HTMLTextAreaElement>('textarea')
  const inputCard = textarea?.parentElement
  if (!textarea || !inputCard || typeof inputCard.insertBefore !== 'function') return null

  let container = editor.querySelector<HTMLElement>('.quickforge-context-chips')
  if (!container) {
    const documentRef = editor.ownerDocument ?? (typeof document !== 'undefined' ? document : undefined)
    if (!documentRef?.createElement) return null
    container = documentRef.createElement('div')
    container.className = 'quickforge-context-chips'
  }
  const siblings = Array.from(inputCard.children)
  if (container.parentElement !== inputCard || siblings.indexOf(container) >= siblings.indexOf(textarea)) {
    inputCard.insertBefore(container, textarea)
  }
  return container
}

export function syncComposerContextChipsAriaLabel(container: HTMLElement, labels: {
  plugins: string
  files: string
  mixed: string
}) {
  const hasPlugins = Boolean(container.querySelector('.quickforge-capability-chip'))
  const hasFiles = Boolean(container.querySelector('.quickforge-file-reference-chip'))
  if (!hasPlugins && !hasFiles) {
    container.remove()
    return
  }
  container.setAttribute('aria-label', hasPlugins && hasFiles
    ? labels.mixed
    : hasPlugins ? labels.plugins : labels.files)
}

// ---------------------------------------------------------------------------
// Draft helpers
// ---------------------------------------------------------------------------

export const emptyDraft = (): ComposerDraft => ({ text: '', attachments: [], contextReferences: [], selectedCapabilities: [] })
export const hasDraft = (draft: ComposerDraft) => draft.text.length > 0
  || (draft.attachments?.length ?? 0) > 0
  || (draft.contextReferences?.length ?? 0) > 0
  || (draft.selectedCapabilities?.length ?? 0) > 0

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

export function messageTimestamp(message: MessageWithUsage) {
  if (typeof message.timestamp === 'number') return message.timestamp
  if (typeof message.timestamp === 'string') {
    const parsed = Date.parse(message.timestamp)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

export function formatMessageTime(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export type ContextUsageInfo = {
  contextWindow: number
  inputTokens: number
  inputTokenSource: 'provider' | 'unavailable'
  percent: number
  color: string
  isCompacted?: boolean
  compactedUpToIndex?: number
  originalMessageCount?: number
  effectiveMessageCount?: number
  breakdown?: {
    systemPromptTokens?: number
    messagesTokens?: number
    toolsTokens?: number
    skillsTokens?: number
    mcpTokens?: number
    providerUsageTokens?: number
    trailingTokens?: number
  }
}

export function formatTokens(value: number) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}
