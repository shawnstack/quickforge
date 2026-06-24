/**
 * Message and editor decoration for the ChatPanel.
 *
 * Handles injecting action buttons (copy, rollback, fork) below messages,
 * and decorating the composer area (Send/Stop toggle, Agent access selector, placeholder,
 * command bindings).
 */

import type { BuiltinPluginMention } from './capability-suggestions'
import type {
  AgentInterfaceElement,
  MessageEditorElement,
  CommandTextareaElement,
  MessageWithUsage,
  QuickForgeActionButton,
  ComposerDraft,
} from './chat-utils'
import {
  replaceSvg,
  patchContent,
  hasDraft,
} from './chat-utils'
import { assistantText, copyTextToClipboard, draftTextFromUserMessage } from '@/lib/message-utils'
import { t } from '@/lib/i18n'
import type { AgentAccessMode } from '@/lib/types'
import { getCachedToolDisplaySettings } from '@/lib/tool-display-settings'

// --- Icon SVGs ---

const copyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
const copiedIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
const rollbackIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>'
const forkIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"/><path d="M12 12v3"/></svg>'
const runIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>'
const retryIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15.36-5.64L21 9"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15.36 5.64L3 15"/></svg>'
const planIcon = '<svg class="quickforge-plan-mode-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h1"/><path d="M4 12h1"/><path d="M4 18h1"/><path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/></svg>'
const removePlanIcon = '<svg class="quickforge-plan-remove-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
const plusIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>'
const attachmentIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>'
const pluginsIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 4.5h5a1.5 1.5 0 0 1 1.5 1.5v2h1a2.5 2.5 0 0 1 0 5h-1v2a1.5 1.5 0 0 1-1.5 1.5h-2v1a2.5 2.5 0 0 1-5 0v-1h-2A1.5 1.5 0 0 1 2 15.5v-3h1a2 2 0 1 0 0-4H2v-2A1.5 1.5 0 0 1 3.5 5h2v-1a2.5 2.5 0 0 1 5 0v.5Z"/></svg>'
const documentPluginIcon = '<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M5.4 2.8h6.1L15.8 7v10.2H5.4z"/><path d="M11.4 2.9V7h4.1"/><path d="M7.6 10.2h5"/><path d="M7.6 13h4.3"/></svg>'
const spreadsheetPluginIcon = '<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><rect x="3.4" y="4" width="13.2" height="12.2" rx="1.5"/><path d="M3.4 8h13.2"/><path d="M7.8 4v12.2"/><path d="M12.2 4v12.2"/><path d="M3.4 12h13.2"/></svg>'
const presentationPluginIcon = '<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.2h14"/><rect x="4.2" y="4.2" width="11.6" height="8.4" rx="1.2"/><path d="M10 12.6v3.2"/><path d="m7.2 17 2.8-1.2 2.8 1.2"/><path d="M7.1 9.5 9 7.7l1.5 1.3 2.4-2.5"/></svg>'

// --- Shared helpers ---

function showCopiedFeedback(button: HTMLButtonElement, defaultTitle: string, defaultIcon: string) {
  const copiedTitle = t('copied')
  const previousTimer = Number(button.dataset.quickforgeCopyFeedbackTimer)
  if (previousTimer) window.clearTimeout(previousTimer)

  replaceSvg(button, copiedIcon)
  button.title = copiedTitle
  button.setAttribute('aria-label', copiedTitle)
  button.style.color = 'rgb(5 150 105)'

  const timer = window.setTimeout(() => {
    replaceSvg(button, defaultIcon)
    button.title = defaultTitle
    button.setAttribute('aria-label', defaultTitle)
    button.style.color = ''
    delete button.dataset.quickforgeCopyFeedbackTimer
  }, 1200)
  button.dataset.quickforgeCopyFeedbackTimer = String(timer)
}

function createIconActionButton(
  action: string,
  title: string,
  icon: string,
  onClick: (button: HTMLButtonElement) => Promise<void> | void,
) {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.quickforgeAction = action
  button.title = title
  button.setAttribute('aria-label', title)
  replaceSvg(button, icon)
  button.className = 'pointer-events-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'
  button.onclick = (event) => {
    event.stopPropagation()
    void onClick(button)
  }
  return button
}

type RollbackPopoverElement = HTMLElement & {
  quickforgeCleanup?: () => void
}

function removeRollbackConfirmPopover(panel: HTMLElement) {
  panel.querySelectorAll<RollbackPopoverElement>('.quickforge-rollback-popover').forEach((popover) => {
    popover.quickforgeCleanup?.()
    const wrapper = popover.closest<HTMLElement>('.quickforge-rollback-action')
    const trigger = wrapper?.querySelector<HTMLButtonElement>('button[data-quickforge-action="rollback"]')
    trigger?.setAttribute('aria-expanded', 'false')
    popover.remove()
  })
}

function showRollbackConfirmPopover(options: {
  panel: HTMLElement
  button: HTMLButtonElement
  messageIndex: number
  title: string
  description: string
  onConfirm: (messageIndex: number) => Promise<void> | void
}) {
  const { panel, button, messageIndex, title, description, onConfirm } = options
  const wrapper = button.closest<HTMLElement>('.quickforge-rollback-action')
  if (!wrapper || button.disabled) return

  const existing = wrapper.querySelector<RollbackPopoverElement>('.quickforge-rollback-popover')
  if (existing) {
    removeRollbackConfirmPopover(panel)
    return
  }

  removeRollbackConfirmPopover(panel)

  const popover = document.createElement('div') as RollbackPopoverElement
  popover.className = 'quickforge-rollback-popover'
  popover.setAttribute('role', 'dialog')
  popover.setAttribute('aria-label', title)
  popover.tabIndex = -1

  const arrow = document.createElement('div')
  arrow.className = 'quickforge-rollback-popover-arrow'

  const titleElement = document.createElement('div')
  titleElement.className = 'quickforge-rollback-popover-title'
  titleElement.textContent = title

  const descriptionElement = document.createElement('div')
  descriptionElement.className = 'quickforge-rollback-popover-description'
  descriptionElement.textContent = description

  const footer = document.createElement('div')
  footer.className = 'quickforge-rollback-popover-footer'

  const cancelButton = document.createElement('button')
  cancelButton.type = 'button'
  cancelButton.className = 'quickforge-rollback-popover-cancel'
  cancelButton.textContent = t('cancel')

  const confirmButton = document.createElement('button')
  confirmButton.type = 'button'
  confirmButton.className = 'quickforge-rollback-popover-confirm'
  confirmButton.textContent = t('confirmRollback')

  footer.append(cancelButton, confirmButton)
  popover.append(arrow, titleElement, descriptionElement, footer)

  const close = () => removeRollbackConfirmPopover(panel)
  const handleOutsidePointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null
    if (!target || popover.contains(target) || button.contains(target)) return
    close()
  }
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    close()
  }

  popover.quickforgeCleanup = () => {
    document.removeEventListener('pointerdown', handleOutsidePointerDown, true)
    document.removeEventListener('keydown', handleKeyDown)
  }
  popover.addEventListener('pointerdown', (event) => event.stopPropagation())
  popover.addEventListener('click', (event) => event.stopPropagation())
  cancelButton.addEventListener('click', close)
  confirmButton.addEventListener('click', async () => {
    confirmButton.disabled = true
    cancelButton.disabled = true
    confirmButton.textContent = t('rollingBack')
    try {
      await onConfirm(messageIndex)
    } finally {
      close()
    }
  })

  wrapper.append(popover)
  button.setAttribute('aria-expanded', 'true')
  document.addEventListener('pointerdown', handleOutsidePointerDown, true)
  document.addEventListener('keydown', handleKeyDown)
  window.requestAnimationFrame(() => confirmButton.focus())
}

function createRollbackAction(options: {
  panel: HTMLElement
  messageIndex: number
  isDisabled: boolean
  title: string
  description: string
  onConfirm: (messageIndex: number) => Promise<void> | void
}) {
  const wrapper = document.createElement('span')
  wrapper.className = 'quickforge-rollback-action'

  const rollbackButton = createIconActionButton('rollback', t('rollback'), rollbackIcon, (button) => {
    showRollbackConfirmPopover({
      panel: options.panel,
      button,
      messageIndex: options.messageIndex,
      title: options.title,
      description: options.description,
      onConfirm: options.onConfirm,
    })
  })
  rollbackButton.disabled = options.isDisabled
  rollbackButton.setAttribute('aria-haspopup', 'dialog')
  rollbackButton.setAttribute('aria-expanded', 'false')

  wrapper.append(rollbackButton)
  return wrapper
}

// --- Message decoration ---

export type MessageDecorationDeps = {
  panel: HTMLElement
  getMessages: () => MessageWithUsage[]
  isStreaming: () => boolean
  onCopyAnswer: (text: string) => Promise<void> | void
  onRollbackFromMessage: (messageIndex: number) => Promise<void> | void
  onRetryFromMessage: (messageIndex: number) => void
  onForkFromMessage: (messageIndex: number) => void
  onOpenLocalFilePath?: (path: string) => void
  disableFork: boolean
  readOnly?: boolean
  enableTerminalCommandActions?: boolean
  rollbackConfirmTitle?: string
  rollbackConfirmDescription?: string
}

type ContextCompactionNoticeDeps = {
  panel: HTMLElement
  getMessages: () => MessageWithUsage[]
  getContextCompaction: () => { summaryMessage?: unknown; compactedUpToIndex?: number } | null | undefined
}

type AssistantWaitingBubbleDeps = {
  panel: HTMLElement
  getMessages: () => MessageWithUsage[]
  isStreaming: () => boolean
  isActive: boolean
}

type CodeBlockElement = HTMLElement & {
  code?: string
  language?: string
  getDecodedCode?: () => string
}

const SHELL_CODE_LANGUAGES = new Set(['bash', 'sh', 'shell', 'zsh', 'fish', 'cmd', 'bat', 'batch', 'powershell', 'ps1', 'terminal', 'console'])
const DANGEROUS_COMMAND_PATTERN = /\b(rm\s+-rf|sudo|chmod\b|chown\b|npm\s+publish|pnpm\s+publish|yarn\s+publish|git\s+push|curl\b[^\n|;]*\|\s*(sh|bash)|wget\b[^\n|;]*\|\s*(sh|bash))\b/i
const SVG_PREVIEW_UNSAFE_PATTERN = /<\s*(script|foreignObject)\b|\son[a-z]+\s*=|javascript\s*:/i

function isDisplayMessage(message: MessageWithUsage) {
  return message.role === 'user' || message.role === 'user-with-attachments' || message.role === 'assistant'
}

function isUserMessage(message: MessageWithUsage) {
  return message.role === 'user' || message.role === 'user-with-attachments'
}

function hasAssistantContent(message: MessageWithUsage) {
  if (message.role !== 'assistant') return false
  return assistantText(message as Parameters<typeof assistantText>[0]).trim().length > 0
}

function getPrimaryMessageList(panel: HTMLElement) {
  return panel.querySelector<HTMLElement>('message-list')
}

function getPrimaryMessageElements(panel: HTMLElement) {
  const messageList = getPrimaryMessageList(panel)
  if (!messageList) return []

  return Array.from(messageList.querySelectorAll<HTMLElement>('user-message, assistant-message'))
    .filter((element) => element.closest('message-list') === messageList)
}

function decodeCodeBlockText(block: CodeBlockElement) {
  if (typeof block.getDecodedCode === 'function') {
    try { return block.getDecodedCode() } catch { /* fallback below */ }
  }
  const raw = typeof block.code === 'string' ? block.code : block.getAttribute('code') ?? ''
  if (!raw) return ''
  try {
    return decodeURIComponent(escape(window.atob(raw)))
  } catch {
    return raw
  }
}

function normalizeShellCommand(command: string) {
  return command
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line
      .replace(/^\s*\$\s+/, '')
      .replace(/^\s*>\s+/, '')
      .replace(/^\s*PS\s+[^>\n]+>\s+/i, ''))
    .join('\n')
    .trim()
}

function commandLineCount(command: string) {
  return command.split('\n').map((line) => line.trim()).filter(Boolean).length
}

function isShellCodeBlock(block: CodeBlockElement) {
  const language = String(block.language ?? block.getAttribute('language') ?? '').trim().toLowerCase()
  return SHELL_CODE_LANGUAGES.has(language)
}

function isSvgCodeBlock(block: CodeBlockElement) {
  const language = String(block.language ?? block.getAttribute('language') ?? '').trim().toLowerCase()
  return language === 'svg'
}

function isPreviewableSvg(svg: string) {
  const trimmed = svg.trim()
  return /^<svg[\s>]/i.test(trimmed) && /<\/svg>\s*$/i.test(trimmed) && !SVG_PREVIEW_UNSAFE_PATTERN.test(trimmed)
}

function createSvgPreviewUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

type SvgPreviewLightboxElement = HTMLDivElement & {
  quickforgeCleanup?: () => void
}

function closeSvgPreviewLightbox() {
  const existing = document.querySelector<SvgPreviewLightboxElement>('.quickforge-svg-code-lightbox')
  existing?.quickforgeCleanup?.()
  existing?.remove()
}

function showSvgPreviewLightbox(src: string) {
  closeSvgPreviewLightbox()

  const lightbox = document.createElement('div') as SvgPreviewLightboxElement
  lightbox.className = 'quickforge-svg-code-lightbox'
  lightbox.setAttribute('role', 'dialog')
  lightbox.setAttribute('aria-modal', 'true')
  lightbox.setAttribute('aria-label', 'SVG preview')

  const image = document.createElement('img')
  image.alt = 'SVG preview'
  image.src = src
  image.addEventListener('click', (event) => event.stopPropagation())
  lightbox.append(image)

  const close = () => closeSvgPreviewLightbox()
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close()
  }
  lightbox.quickforgeCleanup = () => document.removeEventListener('keydown', handleKeyDown)
  lightbox.addEventListener('click', close)
  document.addEventListener('keydown', handleKeyDown)
  document.body.append(lightbox)
}

function downloadTextFile(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function fingerprintText(text: string) {
  let hash = 0
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(31, hash) + text.charCodeAt(index) | 0
  }
  return `${text.length}:${hash}`
}

function cleanupMarkdownSvgCodeBlock(block: CodeBlockElement) {
  if (block.nextElementSibling instanceof HTMLElement && block.nextElementSibling.dataset.quickforgeSvgPreview === 'true') {
    block.nextElementSibling.remove()
  }
  block.querySelector<HTMLElement>('[data-quickforge-svg-preview="true"]')?.remove()
  block.classList.remove('quickforge-svg-code-block')
  block.querySelector<HTMLElement>('copy-button[data-quickforge-svg-original-copy="true"]')?.removeAttribute('hidden')
  block.querySelector<HTMLElement>('copy-button[data-quickforge-svg-original-copy="true"]')?.removeAttribute('data-quickforge-svg-original-copy')
  block.querySelector<HTMLElement>('[data-quickforge-svg-toolbar="true"]')?.remove()
  const codeContent = block.querySelector('pre')?.parentElement
  if (codeContent instanceof HTMLElement) codeContent.hidden = false
  delete block.dataset.quickforgeSvgPreviewSource
  delete block.dataset.quickforgeSvgMode
}

function setSvgCodeBlockMode(block: CodeBlockElement, mode: 'preview' | 'source') {
  const preview = block.querySelector<HTMLElement>('[data-quickforge-svg-preview="true"]')
  const titleBar = block.querySelector<HTMLElement>(':scope > div > div:first-child')
  const codeContent = block.querySelector('pre')?.parentElement

  block.dataset.quickforgeSvgMode = mode
  if (preview) preview.hidden = mode !== 'preview'
  if (titleBar) titleBar.classList.toggle('quickforge-svg-code-toolbar-floating', mode === 'preview')
  if (codeContent instanceof HTMLElement) codeContent.hidden = mode === 'preview'
}

function createSvgMenuItem(action: string, title: string, icon: string) {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.quickforgeAction = action
  button.className = 'quickforge-svg-code-menu-item'
  button.title = title
  button.setAttribute('aria-label', title)
  button.setAttribute('role', 'menuitem')
  replaceSvg(button, icon)
  return button
}

function closeSvgCodeBlockMenus(panel: ParentNode = document, except?: HTMLDetailsElement) {
  panel.querySelectorAll<HTMLDetailsElement>('.quickforge-svg-code-menu[open]').forEach((menu) => {
    if (menu !== except) menu.open = false
  })
}

let svgCodeMenuOutsideHandlerBound = false

function ensureSvgCodeMenuOutsideHandler() {
  if (svgCodeMenuOutsideHandlerBound) return
  svgCodeMenuOutsideHandlerBound = true
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as Element | null
    if (target?.closest('.quickforge-svg-code-menu')) return
    closeSvgCodeBlockMenus(document)
  }, true)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSvgCodeBlockMenus(document)
  })
}

function ensureSvgCodeBlockToolbar(block: CodeBlockElement, svg: string) {
  ensureSvgCodeMenuOutsideHandler()

  const titleBar = block.querySelector<HTMLElement>(':scope > div > div:first-child')
  const copyButton = titleBar?.querySelector<HTMLElement>('copy-button')
  if (!titleBar || !copyButton) return

  let toolbar = titleBar.querySelector<HTMLElement>('[data-quickforge-svg-toolbar="true"]')
  if (!toolbar) {
    toolbar = document.createElement('div')
    toolbar.dataset.quickforgeSvgToolbar = 'true'
    toolbar.className = 'quickforge-svg-code-toolbar'

    const menu = document.createElement('details')
    menu.className = 'quickforge-svg-code-menu'

    const trigger = document.createElement('summary')
    trigger.className = 'quickforge-svg-code-menu-trigger'
    trigger.title = t('moreActions')
    trigger.setAttribute('aria-label', t('moreActions'))
    trigger.textContent = '⋯'

    const content = document.createElement('div')
    content.className = 'quickforge-svg-code-menu-content'
    content.setAttribute('role', 'menu')

    const previewButton = createSvgMenuItem('svg-preview-mode', t('svgPreviewMode'), '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>')
    const sourceButton = createSvgMenuItem('svg-source-mode', t('svgSourceMode'), '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></svg>')
    const copySourceButton = createSvgMenuItem('copy-svg-code', t('copySvgSource'), copyIcon)
    const downloadButton = createSvgMenuItem('download-svg-code', t('downloadSvg'), '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>')
    content.append(previewButton, sourceButton, copySourceButton, downloadButton)

    copyButton.before(toolbar)
    copyButton.dataset.quickforgeSvgOriginalCopy = 'true'
    copyButton.setAttribute('hidden', '')
    menu.append(trigger, content)
    toolbar.append(menu)
  }

  const menu = toolbar.querySelector<HTMLDetailsElement>('.quickforge-svg-code-menu')
  const previewButton = toolbar.querySelector<HTMLButtonElement>('[data-quickforge-action="svg-preview-mode"]')
  const sourceButton = toolbar.querySelector<HTMLButtonElement>('[data-quickforge-action="svg-source-mode"]')
  const copySourceButton = toolbar.querySelector<HTMLButtonElement>('[data-quickforge-action="copy-svg-code"]')
  const downloadButton = toolbar.querySelector<HTMLButtonElement>('[data-quickforge-action="download-svg-code"]')
  const closeMenu = () => { if (menu) menu.open = false }

  if (menu && !menu.dataset.quickforgeSvgMenuBound) {
    menu.dataset.quickforgeSvgMenuBound = 'true'
    menu.addEventListener('toggle', () => {
      if (!menu.open) return
      closeSvgCodeBlockMenus(block.closest('markdown-block') ?? document, menu)
    })
  }

  if (previewButton) previewButton.onclick = () => {
    setSvgCodeBlockMode(block, 'preview')
    closeMenu()
  }
  if (sourceButton) sourceButton.onclick = () => {
    setSvgCodeBlockMode(block, 'source')
    closeMenu()
  }
  if (copySourceButton) copySourceButton.onclick = async () => {
    await copyTextToClipboard(svg)
    showCopiedFeedback(copySourceButton, t('copySvgSource'), copyIcon)
  }
  if (downloadButton) downloadButton.onclick = () => {
    downloadTextFile(`quickforge-svg-${Date.now()}.svg`, svg, 'image/svg+xml;charset=utf-8')
    closeMenu()
  }
}

function decorateMarkdownSvgCodeBlocks(panel: HTMLElement, isStreaming: boolean) {
  panel.querySelectorAll<CodeBlockElement>('assistant-message markdown-block code-block').forEach((block) => {
    if (!isSvgCodeBlock(block)) {
      cleanupMarkdownSvgCodeBlock(block)
      return
    }
    if (isStreaming) return

    const svg = decodeCodeBlockText(block).trim()
    if (!svg || !isPreviewableSvg(svg)) {
      cleanupMarkdownSvgCodeBlock(block)
      return
    }

    const fingerprint = fingerprintText(svg)
    const existing = block.querySelector<HTMLElement>('[data-quickforge-svg-preview="true"]')
    if (existing && block.dataset.quickforgeSvgPreviewSource === fingerprint) {
      ensureSvgCodeBlockToolbar(block, svg)
      setSvgCodeBlockMode(block, block.dataset.quickforgeSvgMode === 'source' ? 'source' : 'preview')
      return
    }

    const titleBar = block.querySelector<HTMLElement>(':scope > div > div:first-child')
    if (!titleBar) return

    cleanupMarkdownSvgCodeBlock(block)

    const preview = document.createElement('div')
    block.classList.add('quickforge-svg-code-block')
    preview.dataset.quickforgeSvgPreview = 'true'
    preview.className = 'quickforge-svg-code-preview'
    preview.setAttribute('aria-label', 'SVG preview')

    const image = document.createElement('img')
    image.alt = 'SVG preview'
    image.src = createSvgPreviewUrl(svg)
    image.title = t('svgEnlargePreview')
    image.addEventListener('click', () => showSvgPreviewLightbox(image.src))
    preview.replaceChildren(image)

    titleBar.after(preview)
    ensureSvgCodeBlockToolbar(block, svg)
    block.dataset.quickforgeSvgPreviewSource = fingerprint
    setSvgCodeBlockMode(block, block.dataset.quickforgeSvgMode === 'source' ? 'source' : 'preview')
  })
}

function decorateMarkdownCommandBlocks(panel: HTMLElement, isStreaming: boolean) {
  panel.querySelectorAll<CodeBlockElement>('assistant-message markdown-block code-block').forEach((block) => {
    const existing = block.querySelector<HTMLButtonElement>('[data-quickforge-action="execute-markdown-command"]')
    if (!isShellCodeBlock(block)) {
      existing?.remove()
      delete block.dataset.quickforgeCommand
      return
    }

    // For blocks we have already decorated, skip the base64 decode + regex
    // normalization when the decoded command has not changed (cheaply tracked
    // via a dataset fingerprint). During streaming this avoid re-decoding every
    // shell code-block in the panel on each rAF-batched decorate pass; the click
    // handler below always re-reads the latest command, so correctness is kept.
    let command: string | null
    if (existing && block.dataset.quickforgeCommand !== undefined) {
      if (existing.disabled === isStreaming) {
        // Content unchanged AND streaming state unchanged → nothing to do.
        return
      }
      command = block.dataset.quickforgeCommand
    } else {
      command = normalizeShellCommand(decodeCodeBlockText(block))
    }
    if (!command) {
      existing?.remove()
      delete block.dataset.quickforgeCommand
      return
    }
    block.dataset.quickforgeCommand = command

    const title = t('executeInTerminal')
    const button = existing ?? createIconActionButton('execute-markdown-command', title, runIcon, () => {
      const latestCommand = normalizeShellCommand(decodeCodeBlockText(block))
      if (!latestCommand) return
      window.dispatchEvent(new CustomEvent('quickforge:execute-markdown-command', {
        detail: {
          command: latestCommand,
          confirm: commandLineCount(latestCommand) > 1,
          dangerous: DANGEROUS_COMMAND_PATTERN.test(latestCommand),
        },
      }))
    })
    button.title = title
    button.setAttribute('aria-label', title)
    button.disabled = isStreaming
    button.className = 'pointer-events-auto inline-flex size-8 items-center justify-center rounded-md text-emerald-600 transition-colors hover:bg-emerald-500/10 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400 dark:hover:text-emerald-300'

    if (!existing) {
      const titleBar = block.querySelector<HTMLElement>(':scope > div > div:first-child')
      const copyButton = titleBar?.querySelector('copy-button')
      if (titleBar && copyButton) {
        const wrapper = document.createElement('div')
        wrapper.className = 'flex items-center gap-1'
        copyButton.before(wrapper)
        wrapper.appendChild(copyButton)
        wrapper.appendChild(button)
      }
    }
  })
}

function insertBeforeMessageElement(panel: HTMLElement, messages: MessageWithUsage[], messageIndex: number, notice: HTMLElement) {
  const messageElements = getPrimaryMessageElements(panel)
  let displayIndex = 0
  for (let index = 0; index < messages.length; index++) {
    if (!isDisplayMessage(messages[index])) continue
    if (index === messageIndex) {
      const target = messageElements[displayIndex]
      if (target) {
        if (notice.nextElementSibling !== target) target.before(notice)
        return
      }
      break
    }
    displayIndex += 1
  }

  const messageList = panel.querySelector('message-list')
  if (messageList && messageList.firstElementChild !== notice) messageList.prepend(notice)
}

function compactSummaryText(summaryMessage: unknown) {
  const message = summaryMessage as MessageWithUsage | undefined
  const rawText = message?.role === 'assistant'
    ? assistantText(message as Parameters<typeof assistantText>[0])
    : draftTextFromUserMessage(message as Parameters<typeof draftTextFromUserMessage>[0])
  const match = rawText.match(/<compact_summary>\s*([\s\S]*?)\s*<\/compact_summary>/i)
  return (match?.[1] ?? rawText).trim()
}

function syncCompactionSummaryHandlers(notice: HTMLElement, summaryText: string, initialOpen = false) {
  const details = notice.querySelector<HTMLDetailsElement>('.quickforge-context-compaction-details')
  const summary = notice.querySelector<HTMLElement>('.quickforge-context-compaction-summary')
  const toggleLabel = notice.querySelector<HTMLElement>('.quickforge-context-compaction-toggle-label')
  const copyButton = notice.querySelector<HTMLButtonElement>('[data-quickforge-action="copy-compact-summary"]')
  if (details) details.open = initialOpen
  const syncToggleLabel = () => {
    if (toggleLabel && details) toggleLabel.textContent = details.open ? t('contextCompactedHideSummary') : t('contextCompactedViewSummary')
  }
  if (summary && !summary.dataset.quickforgeCompactionBound) {
    summary.dataset.quickforgeCompactionBound = 'true'
    summary.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (!details) return
      details.open = !details.open
      syncToggleLabel()
    })
  }
  if (details && !details.dataset.quickforgeCompactionBound) {
    details.dataset.quickforgeCompactionBound = 'true'
    details.addEventListener('toggle', syncToggleLabel)
  }
  syncToggleLabel()
  if (copyButton) {
    copyButton.onclick = async (event) => {
      event.preventDefault()
      event.stopPropagation()
      await copyTextToClipboard(summaryText)
      showCopiedFeedback(copyButton, t('contextCompactedCopySummary'), copyIcon)
    }
  }
}

export function syncContextCompactionNotice(deps: ContextCompactionNoticeDeps) {
  const { panel, getMessages, getContextCompaction } = deps
  const compaction = getContextCompaction()
  const messages = getMessages()
  const existing = panel.querySelector<HTMLElement>('.quickforge-context-compaction-notice')

  if (!compaction || messages.length === 0) {
    existing?.remove()
    return
  }

  const tailStart = Math.min(messages.length, Math.max(0, Number(compaction.compactedUpToIndex) || 0))
  if (tailStart <= 0) {
    existing?.remove()
    return
  }

  const summaryText = compaction.summaryMessage ? compactSummaryText(compaction.summaryMessage) : ''
  const initialOpen = existing?.querySelector<HTMLDetailsElement>('.quickforge-context-compaction-details')?.open ?? false
  const notice = existing ?? document.createElement('div')
  const previousSummaryText = notice.dataset.summaryText ?? ''
  const previousHasSummary = notice.dataset.hasSummary === 'true'
  const shouldRender = !existing || previousSummaryText !== summaryText || previousHasSummary !== Boolean(summaryText)
  notice.className = 'quickforge-context-compaction-notice'
  notice.dataset.tailStart = String(tailStart)
  notice.dataset.summaryText = summaryText
  notice.dataset.hasSummary = String(Boolean(summaryText))
  notice.title = t('contextCompactedTooltip')
  notice.setAttribute('aria-label', t('contextCompactedTooltip'))
  if (shouldRender) {
    notice.innerHTML = summaryText ? `
      <details class="quickforge-context-compaction-details">
        <summary class="quickforge-context-compaction-summary">
          <div class="quickforge-context-compaction-line"></div>
          <div class="quickforge-context-compaction-pill">
            <span class="quickforge-context-compaction-dot" aria-hidden="true"></span>
            <span><strong>${escapeHtml(t('contextCompactedLabel'))}</strong> · ${escapeHtml(t('contextCompactedTimelineLabel'))} · <span class="quickforge-context-compaction-toggle-label"></span></span>
          </div>
          <div class="quickforge-context-compaction-line"></div>
        </summary>
        <div class="quickforge-context-compaction-card">
          <div class="quickforge-context-compaction-card-header">
            <span>${escapeHtml(t('contextCompactedSummaryTitle'))}</span>
            <button type="button" class="quickforge-context-compaction-copy" data-quickforge-action="copy-compact-summary">${copyIcon}<span>${escapeHtml(t('contextCompactedCopySummary'))}</span></button>
          </div>
          <pre class="quickforge-context-compaction-text">${escapeHtml(summaryText)}</pre>
        </div>
      </details>
    ` : `
      <div class="quickforge-context-compaction-summary" role="separator">
        <div class="quickforge-context-compaction-line"></div>
        <div class="quickforge-context-compaction-pill">
          <span class="quickforge-context-compaction-dot" aria-hidden="true"></span>
          <span><strong>${escapeHtml(t('contextCompactedLabel'))}</strong> · ${escapeHtml(t('contextCompactedTimelineLabel'))}</span>
        </div>
        <div class="quickforge-context-compaction-line"></div>
      </div>
    `
  }
  if (summaryText) syncCompactionSummaryHandlers(notice, summaryText, initialOpen)

  insertBeforeMessageElement(panel, messages, tailStart, notice)
}

const ASSISTANT_WAITING_SELECTOR = '.quickforge-assistant-waiting'

function removeAssistantWaitingBubble(panel: HTMLElement) {
  panel.querySelectorAll(ASSISTANT_WAITING_SELECTOR).forEach((element) => element.remove())
}

function assistantElementHasVisibleContent(element: HTMLElement) {
  // Check for thinking-block or tool-message that is NOT already inside a process-body
  const processElements = element.querySelectorAll('thinking-block, tool-message')
  for (const el of processElements) {
    if (!el.closest('.quickforge-process-body')) return true
  }
  // Check for markdown-block or code-block that is NOT inside a process-body
  const mdBlocks = element.querySelectorAll<HTMLElement>('markdown-block, code-block')
  for (const block of mdBlocks) {
    if (block.closest('.quickforge-process-body')) continue
    if ((block.textContent ?? '').trim().length > 0) return true
  }

  const clone = element.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.quickforge-message-actions').forEach((node) => node.remove())
  clone.querySelectorAll('.quickforge-process-body').forEach((node) => node.remove())
  return (clone.textContent ?? '').trim().length > 0
}

export function syncAssistantWaitingBubble(deps: AssistantWaitingBubbleDeps) {
  const { panel, getMessages, isStreaming, isActive } = deps
  const existing = panel.querySelector<HTMLElement>(ASSISTANT_WAITING_SELECTOR)

  if (!isStreaming() || !isActive) {
    removeAssistantWaitingBubble(panel)
    return false
  }

  const messageList = getPrimaryMessageList(panel)
  const messages = getMessages()
  const displayEntries = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => isDisplayMessage(message))
  const lastUserDisplayIndex = (() => {
    for (let i = displayEntries.length - 1; i >= 0; i--) {
      if (isUserMessage(displayEntries[i].message)) return i
    }
    return -1
  })()

  if (!messageList || lastUserDisplayIndex < 0) {
    existing?.remove()
    return false
  }

  const lastUserEntry = displayEntries[lastUserDisplayIndex]
  const hasAssistantAfterLastUser = messages.slice(lastUserEntry.index + 1).some(hasAssistantContent)
  const messageElements = getPrimaryMessageElements(panel)
  const lastUserElement = messageElements[lastUserDisplayIndex]
  const hasVisibleAssistantAfterLastUser = messageElements
    .slice(lastUserDisplayIndex + 1)
    .some((element) => element.matches('assistant-message') && assistantElementHasVisibleContent(element))

  if (!lastUserElement || hasAssistantAfterLastUser || hasVisibleAssistantAfterLastUser) {
    existing?.remove()
    return false
  }

  const bubble = existing ?? document.createElement('div')
  bubble.className = 'quickforge-assistant-waiting'
  bubble.setAttribute('role', 'status')
  bubble.setAttribute('aria-live', 'polite')
  bubble.setAttribute('aria-label', t('assistantWaitingAriaLabel'))
  if (!existing) {
    bubble.innerHTML = `
      <div class="quickforge-assistant-waiting-dots" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
    `
  }

  if (bubble.previousElementSibling !== lastUserElement) lastUserElement.after(bubble)
  return true
}

export function decorateMessages(deps: MessageDecorationDeps) {
  const {
    panel,
    getMessages,
    isStreaming,
    onCopyAnswer,
    onRollbackFromMessage,
    onRetryFromMessage,
    onForkFromMessage,
    onOpenLocalFilePath,
    disableFork,
    readOnly = false,
    enableTerminalCommandActions = true,
    rollbackConfirmTitle = t('rollbackConfirmTitle'),
    rollbackConfirmDescription = t('rollbackConfirm'),
  } = deps

  const displayEntries = getMessages()
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => {
      return message.role === 'user' || message.role === 'user-with-attachments' || message.role === 'assistant'
    })

  const lastUserEntry = (() => {
    for (let i = displayEntries.length - 1; i >= 0; i--) {
      if (displayEntries[i].message.role !== 'assistant') return displayEntries[i]
    }
    return undefined
  })()

  const messageElements = getPrimaryMessageElements(panel)

  const createCopyButton = (getText: () => string) => {
    const title = t('copy')
    return createIconActionButton('copy', title, copyIcon, async (button) => {
      const text = getText()
      if (!text) return
      try {
        await onCopyAnswer(text)
        showCopiedFeedback(button, title, copyIcon)
      } catch {
        // onCopyAnswer already shows the failure message.
      }
    })
  }

  messageElements.forEach((element, displayIndex) => {
    const entry = displayEntries[displayIndex]
    if (!entry) return

    element.classList.add('group', 'relative')
    element.classList.toggle('quickforge-assistant-message', entry.message.role === 'assistant')
    element.classList.toggle('quickforge-user-message', entry.message.role !== 'assistant')

    if (entry.message.role === 'assistant' && onOpenLocalFilePath) {
      decorateLocalFilePathLinks(element, entry.message, onOpenLocalFilePath)
    }

    const actionsClass = `quickforge-message-actions pointer-events-none mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${entry.message.role === 'assistant' ? 'px-4 justify-start' : 'mx-4 justify-end'}`
    const existingActions = element.querySelector<HTMLElement>('.quickforge-message-actions')
    if (existingActions?.dataset.quickforgeLayout === 'message-bottom') {
      existingActions.className = actionsClass
      if (existingActions.parentElement === element && existingActions !== element.lastElementChild) {
        element.append(existingActions)
      }
      if (readOnly) removeRollbackConfirmPopover(panel)
      existingActions.querySelectorAll<HTMLButtonElement>('button[data-quickforge-action="rollback"], button[data-quickforge-action="retry"], button[data-quickforge-action="fork"]').forEach((button) => {
        if (readOnly) {
          button.closest('.quickforge-rollback-action')?.remove()
          button.remove()
          return
        }
        button.disabled = isStreaming()
      })

      if (isStreaming()) removeRollbackConfirmPopover(panel)

      // Manage retry button visibility: only show on the last user message
      const existingRetry = existingActions.querySelector<HTMLButtonElement>('button[data-quickforge-action="retry"]')
      const isLastUser = !readOnly && lastUserEntry && entry.index === lastUserEntry.index && entry.message.role !== 'assistant'
      if (existingRetry && !isLastUser) {
        existingRetry.remove()
      } else if (!existingRetry && isLastUser) {
        const retryButton = createIconActionButton('retry', t('retry'), retryIcon, () => {
          onRetryFromMessage(entry.index)
        })
        retryButton.disabled = isStreaming()
        existingActions.append(retryButton)
      }

      return
    }
    existingActions?.remove()

    const actions = document.createElement('div')
    actions.dataset.quickforgeLayout = 'message-bottom'
    actions.className = actionsClass

    if (entry.message.role === 'assistant') {
      const text = assistantText(entry.message as Parameters<typeof assistantText>[0])
      if (!text) return

      const copyBtn = createCopyButton(() => {
        const currentMessage = getMessages()[entry.index]
        return currentMessage ? assistantText(currentMessage as Parameters<typeof assistantText>[0]) : text
      })
      actions.append(copyBtn)

      if (!readOnly && !disableFork) {
        const forkButton = createIconActionButton('fork', t('forkConversation'), forkIcon, () => {
          onForkFromMessage(entry.index)
        })
        forkButton.disabled = isStreaming()
        actions.append(forkButton)
      }
    } else {
      const text = draftTextFromUserMessage(entry.message as Parameters<typeof draftTextFromUserMessage>[0])
      if (text) {
        const copyBtn = createCopyButton(() => {
          const currentMessage = getMessages()[entry.index]
          return currentMessage ? draftTextFromUserMessage(currentMessage as Parameters<typeof draftTextFromUserMessage>[0]) : text
        })
        actions.append(copyBtn)
      }

      if (!readOnly) {
        const rollbackAction = createRollbackAction({
          panel,
          messageIndex: entry.index,
          isDisabled: isStreaming(),
          title: rollbackConfirmTitle,
          description: rollbackConfirmDescription,
          onConfirm: onRollbackFromMessage,
        })
        actions.append(rollbackAction)
      }

      if (!readOnly && lastUserEntry && entry.index === lastUserEntry.index) {
        const retryButton = createIconActionButton('retry', t('retry'), retryIcon, () => {
          onRetryFromMessage(entry.index)
        })
        retryButton.disabled = isStreaming()
        actions.append(retryButton)
      }
    }

    element.append(actions)
  })

  closeSvgCodeBlockMenus(panel)
  decorateProcessBlocks(panel, isStreaming())
  decorateMarkdownSvgCodeBlocks(panel, isStreaming())
  if (enableTerminalCommandActions) {
    decorateMarkdownCommandBlocks(panel, isStreaming())
  } else {
    panel.querySelectorAll('[data-quickforge-action="execute-markdown-command"]').forEach((button) => button.remove())
  }
}

// --- Inline local file path links ---

const LOCAL_FILE_PATH_REGEX = /[A-Za-z]:[\\/][^\s"'<>`]+|(?:\/Users|\/home|\/workspace|\/mnt|\/Volumes)\/[^\s"'<>`]+/g
const TRAILING_PATH_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', '>', '。', '，', '；', '：', '！', '？', '）', '】', '》'])
const SKIP_LOCAL_PATH_SELECTOR = [
  'pre',
  'code',
  'a',
  'button',
  'textarea',
  'input',
  'select',
  'thinking-block',
  'tool-message',
  '.quickforge-file-path-link',
  '.quickforge-message-actions',
  '.quickforge-process-group',
  '.quickforge-approval-card',
].join(',')

function trimTrailingPathPunctuation(value: string) {
  let end = value.length
  while (end > 0 && TRAILING_PATH_PUNCTUATION.has(value[end - 1])) end -= 1
  return { path: value.slice(0, end), suffix: value.slice(end) }
}

function createLocalFilePathLink(pathValue: string, onOpenLocalFilePath: (path: string) => void) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'quickforge-file-path-link'
  button.dataset.quickforgeFilePath = pathValue
  button.textContent = pathValue
  button.title = 'Open file'
  button.setAttribute('aria-label', `Open file ${pathValue}`)
  button.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    onOpenLocalFilePath(pathValue)
  }
  return button
}

function collectLocalFilePathTextNodes(root: HTMLElement) {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent ?? ''
      if (!LOCAL_FILE_PATH_REGEX.test(text)) return NodeFilter.FILTER_REJECT
      LOCAL_FILE_PATH_REGEX.lastIndex = 0
      const parent = node.parentElement
      if (!parent || parent.closest(SKIP_LOCAL_PATH_SELECTOR)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let current = walker.nextNode()
  while (current) {
    nodes.push(current as Text)
    current = walker.nextNode()
  }
  return nodes
}

function linkLocalFilePathTextNode(node: Text, onOpenLocalFilePath: (path: string) => void) {
  const text = node.textContent ?? ''
  LOCAL_FILE_PATH_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  let lastIndex = 0
  const fragment = document.createDocumentFragment()
  let changed = false

  while ((match = LOCAL_FILE_PATH_REGEX.exec(text))) {
    const rawMatch = match[0]
    const { path: pathValue, suffix } = trimTrailingPathPunctuation(rawMatch)
    if (!pathValue) continue

    const start = match.index
    const end = start + rawMatch.length
    if (start > lastIndex) fragment.append(document.createTextNode(text.slice(lastIndex, start)))
    fragment.append(createLocalFilePathLink(pathValue, onOpenLocalFilePath))
    if (suffix) fragment.append(document.createTextNode(suffix))
    lastIndex = end
    changed = true
  }

  if (!changed) return
  if (lastIndex < text.length) fragment.append(document.createTextNode(text.slice(lastIndex)))
  node.replaceWith(fragment)
}

function decorateLocalFilePathLinks(element: HTMLElement, message: MessageWithUsage, onOpenLocalFilePath: (path: string) => void) {
  const markdownBlocks = Array.from(element.querySelectorAll<HTMLElement>('markdown-block'))
  const markdownTextLength = markdownBlocks.reduce((total, block) => total + (block.textContent?.length ?? 0), 0)
  const messageTextLength = assistantText(message as Parameters<typeof assistantText>[0]).length
  const signature = `${String(message.timestamp ?? '')}:${messageTextLength}:${markdownBlocks.length}:${markdownTextLength}`
  if (element.dataset.quickforgeLocalPathSignature === signature) return

  markdownBlocks.forEach((block) => {
    collectLocalFilePathTextNodes(block).forEach((node) => linkLocalFilePathTextNode(node, onOpenLocalFilePath))
  })
  element.dataset.quickforgeLocalPathSignature = signature
}

// --- AI process folding (thinking + tool calls) ---

type ProcessGroupElement = HTMLDivElement

type ToolMessageElement = HTMLElement & {
  result?: unknown
}

type AssistantMessageElement = HTMLElement & {
  message?: MessageWithUsage & { stopReason?: string; errorMessage?: string }
  isStreaming?: boolean
}

const PROCESS_GROUP_SELECTOR = '.quickforge-process-group'
const PROCESS_BODY_SELECTOR = '.quickforge-process-body'
const PROCESS_NODE_SELECTOR = 'thinking-block, tool-message, streaming-message-container'
const PROCESS_DETAIL_NODE_SELECTOR = 'thinking-block, tool-message, markdown-block, streaming-message-container'
const PROCESS_FINAL_SUMMARY_ATTR = 'data-quickforge-process-final-summary'
const PROCESS_FOLDED_ATTR = 'data-quickforge-process-folded'
const PROCESS_EXPANDED_STATE_LIMIT = 500
const processExpandedStates = new WeakMap<HTMLElement, Map<string, boolean>>()

function getProcessExpandedStates(panel: HTMLElement) {
  let states = processExpandedStates.get(panel)
  if (!states) {
    states = new Map()
    processExpandedStates.set(panel, states)
  }
  return states
}

function rememberProcessExpandedState(panel: HTMLElement, key: string, expanded: boolean) {
  const states = getProcessExpandedStates(panel)
  states.set(key, expanded)
  if (states.size <= PROCESS_EXPANDED_STATE_LIMIT) return

  const oldestKey = states.keys().next().value
  if (oldestKey) states.delete(oldestKey)
}

function processTurnStateKey(assistants: AssistantMessageElement[], turnIndex: number) {
  const firstTimestamp = timestampFromUnknown(assistants[0]?.message?.timestamp)
  return `turn:${turnIndex}:started:${firstTimestamp ?? 'unknown'}`
}

function syncProcessGroupExpandedState(panel: HTMLElement, group: ProcessGroupElement, key: string) {
  const previousKey = group.dataset.quickforgeProcessKey
  group.dataset.quickforgeProcessKey = key

  const savedExpanded = getProcessExpandedStates(panel).get(key)
  if (savedExpanded !== undefined) {
    group.dataset.expanded = String(savedExpanded)
    return
  }

  group.dataset.expanded = previousKey === key && group.dataset.expanded === 'true' ? 'true' : 'false'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function timestampFromUnknown(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined

    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) return numeric

    const parsed = Date.parse(trimmed)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

function toolTimingFromResult(result: unknown) {
  if (!isRecord(result)) return undefined
  const details = result.details
  if (!isRecord(details)) return undefined
  const timing = details.quickforgeTiming
  if (!isRecord(timing)) return undefined

  const startedAt = numberFromUnknown(timing.startedAt)
  const finishedAt = numberFromUnknown(timing.finishedAt)
  const durationMs = numberFromUnknown(timing.durationMs)
  return { startedAt, finishedAt, durationMs }
}

function toolMessageFinishedAt(toolMessage: ToolMessageElement): number | undefined {
  const resultTiming = toolTimingFromResult(toolMessage.result)
  if (resultTiming?.finishedAt !== undefined) return resultTiming.finishedAt
  if (resultTiming?.startedAt !== undefined && resultTiming.durationMs !== undefined) {
    return resultTiming.startedAt + resultTiming.durationMs
  }
  return undefined
}

function toolMessageStartedAt(toolMessage: ToolMessageElement): number | undefined {
  return toolTimingFromResult(toolMessage.result)?.startedAt
}

function formatProcessDuration(durationMs?: number) {
  if (durationMs === undefined || durationMs < 1000) return ''
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function processLabel(assistants: AssistantMessageElement[], body: HTMLElement, group: ProcessGroupElement, isAgentStreaming: boolean) {
  const streaming = isAgentStreaming
  const stopReason = [...assistants].reverse().find((assistant) => assistant.message?.stopReason)?.message?.stopReason
  const toolMessages = Array.from(body.querySelectorAll<ToolMessageElement>('tool-message'))
  const starts = [
    ...assistants.map((assistant) => timestampFromUnknown(assistant.message?.timestamp)),
    ...toolMessages.map(toolMessageStartedAt),
  ].filter((value): value is number => value !== undefined)
  const finishedTimes = toolMessages.map(toolMessageFinishedAt).filter((value): value is number => value !== undefined)
  const startedAt = starts.length > 0 ? Math.min(...starts) : undefined
  let finishedAt = finishedTimes.length > 0 ? Math.max(...finishedTimes) : undefined

  if (streaming) {
    finishedAt = Date.now()
  } else {
    const cachedFinishedAt = timestampFromUnknown(group.dataset.quickforgeFinishedAt)
    if (cachedFinishedAt !== undefined && cachedFinishedAt > 0) {
      finishedAt = cachedFinishedAt
    } else {
      // Once the run is complete, freeze the label timestamp so repeated
      // decoration does not keep increasing thinking-only durations.
      finishedAt = finishedAt ?? Date.now()
      group.dataset.quickforgeFinishedAt = String(finishedAt)
    }
  }

  const duration = startedAt !== undefined && finishedAt !== undefined
    ? formatProcessDuration(Math.max(0, finishedAt - startedAt))
    : ''

  const base = stopReason === 'error'
    ? t('processFailed')
    : stopReason === 'aborted'
      ? t('processAborted')
      : streaming
        ? t('processing')
        : t('processed')

  return duration ? `${base} ${duration}` : base
}

function assistantContentContainer(assistant: AssistantMessageElement) {
  const contentNode = assistant.querySelector<HTMLElement>(`${PROCESS_DETAIL_NODE_SELECTOR}, ${PROCESS_GROUP_SELECTOR}`)
  return contentNode?.closest<HTMLElement>('.px-4.flex.flex-col') ?? contentNode?.parentElement ?? null
}

function createProcessGroup() {
  const group = document.createElement('div') as ProcessGroupElement
  group.className = 'quickforge-process-group'
  group.dataset.expanded = 'false'

  const summary = document.createElement('button')
  summary.type = 'button'
  summary.className = 'quickforge-process-summary'
  summary.innerHTML = `
    <span class="quickforge-process-label"></span>
    <span class="quickforge-process-chevron" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
    </span>
  `

  const body = document.createElement('div')
  body.className = 'quickforge-process-body'

  group.append(summary, body)
  return group
}

function ensureTurnProcessGroup(target: AssistantMessageElement) {
  const existing = target.querySelector<ProcessGroupElement>(PROCESS_GROUP_SELECTOR)
  if (existing) return existing

  const container = assistantContentContainer(target)
  if (!container) return null

  const group = createProcessGroup()
  container.insertBefore(group, container.firstElementChild)
  return group
}

function updateProcessGroup(panel: HTMLElement, processKey: string, assistants: AssistantMessageElement[], group: ProcessGroupElement, isAgentStreaming: boolean) {
  syncProcessGroupExpandedState(panel, group, processKey)
  const body = group.querySelector<HTMLElement>(PROCESS_BODY_SELECTOR)
  const summary = group.querySelector<HTMLButtonElement>('.quickforge-process-summary')
  const label = group.querySelector<HTMLElement>('.quickforge-process-label')
  if (!body || !summary || !label) return

  const nextLabel = processLabel(assistants, body, group, isAgentStreaming)
  if (label.textContent !== nextLabel) label.textContent = nextLabel

  const expanded = group.dataset.expanded === 'true'
  summary.setAttribute('aria-expanded', String(expanded))
  summary.setAttribute('aria-label', expanded ? t('collapseProcess') : t('expandProcess'))
  summary.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const nextExpanded = group.dataset.expanded !== 'true'
    group.dataset.expanded = String(nextExpanded)
    rememberProcessExpandedState(panel, processKey, nextExpanded)
    summary.setAttribute('aria-expanded', String(nextExpanded))
    summary.setAttribute('aria-label', nextExpanded ? t('collapseProcess') : t('expandProcess'))
  }
}

function markdownCandidates(target: AssistantMessageElement) {
  return Array.from(target.querySelectorAll<HTMLElement>('markdown-block'))
    .filter((node) => !node.closest(PROCESS_NODE_SELECTOR))
}

function lastNonEmptyOrLast(candidates: HTMLElement[]) {
  const nonEmptyCandidates = candidates.filter((node) => (node.textContent ?? '').trim().length > 0)
  return nonEmptyCandidates[nonEmptyCandidates.length - 1] ?? candidates[candidates.length - 1] ?? null
}

function setProcessFlag(node: HTMLElement, attr: string, enabled: boolean) {
  if (enabled) {
    if (!node.hasAttribute(attr)) node.setAttribute(attr, 'true')
    return
  }
  if (node.hasAttribute(attr)) node.removeAttribute(attr)
}

function findFinalSummaryMarkdown(target: AssistantMessageElement, isAgentStreaming: boolean) {
  if (isAgentStreaming) return null

  const candidates = markdownCandidates(target)
  const markedFinalSummary = lastNonEmptyOrLast(candidates.filter((node) => node.hasAttribute(PROCESS_FINAL_SUMMARY_ATTR)))
  if (markedFinalSummary) return markedFinalSummary

  const visibleCandidates = candidates.filter((node) => !node.closest(PROCESS_BODY_SELECTOR))
  const visibleFinalSummary = lastNonEmptyOrLast(visibleCandidates)
  if (visibleFinalSummary) return visibleFinalSummary

  return lastNonEmptyOrLast(candidates)
}

function markFinalSummaryMarkdown(target: AssistantMessageElement, finalSummaryMarkdown: HTMLElement | null) {
  markdownCandidates(target).forEach((node) => {
    if (node === finalSummaryMarkdown) {
      setProcessFlag(node, PROCESS_FINAL_SUMMARY_ATTR, true)
      setProcessFlag(node, PROCESS_FOLDED_ATTR, false)
    } else {
      setProcessFlag(node, PROCESS_FINAL_SUMMARY_ATTR, false)
    }
  })
}

function hasTurnProcessSignals(assistants: AssistantMessageElement[]) {
  return assistants.length > 1 || assistants.some((assistant) => Boolean(assistant.querySelector(PROCESS_NODE_SELECTOR)))
}

function isFoldableProcessDetail(node: HTMLElement, finalSummaryMarkdown: HTMLElement | null, canFoldMarkdown: boolean) {
  if (node === finalSummaryMarkdown) return false
  if (node.tagName.toLowerCase() === 'markdown-block') return canFoldMarkdown
  return true
}

function hasFoldableProcessContent(assistants: AssistantMessageElement[], finalSummaryMarkdown: HTMLElement | null, canFoldMarkdown: boolean) {
  return assistants.some((assistant) => {
    return Array.from(assistant.querySelectorAll<HTMLElement>(PROCESS_DETAIL_NODE_SELECTOR))
      .some((node) => isFoldableProcessDetail(node, finalSummaryMarkdown, canFoldMarkdown))
  })
}

function restoreFinalSummaryMarkdown(group: ProcessGroupElement, finalSummaryMarkdown: HTMLElement | null) {
  if (!finalSummaryMarkdown?.closest(PROCESS_BODY_SELECTOR)) return false
  group.after(finalSummaryMarkdown)
  setProcessFlag(finalSummaryMarkdown, PROCESS_FOLDED_ATTR, false)
  setProcessFlag(finalSummaryMarkdown, PROCESS_FINAL_SUMMARY_ATTR, true)
  return true
}

function processBodyHasContent(group: ProcessGroupElement) {
  return (group.querySelector<HTMLElement>(PROCESS_BODY_SELECTOR)?.childElementCount ?? 0) > 0
}

function restoreProcessTurn(assistants: AssistantMessageElement[]) {
  for (const assistant of assistants) {
    assistant.classList.remove('quickforge-process-source-empty')
    assistant.querySelectorAll<ProcessGroupElement>(PROCESS_GROUP_SELECTOR).forEach((group) => {
      const body = group.querySelector<HTMLElement>(PROCESS_BODY_SELECTOR)
      if (body) {
        Array.from(body.children).forEach((node) => {
          if (node instanceof HTMLElement) {
            setProcessFlag(node, PROCESS_FOLDED_ATTR, false)
            setProcessFlag(node, PROCESS_FINAL_SUMMARY_ATTR, false)
          }
          group.parentElement?.insertBefore(node, group)
        })
      }
      group.remove()
    })
    markdownCandidates(assistant).forEach((node) => {
      setProcessFlag(node, PROCESS_FOLDED_ATTR, false)
      setProcessFlag(node, PROCESS_FINAL_SUMMARY_ATTR, false)
    })
  }
}

function moveProcessNodesIntoTurnGroup(assistants: AssistantMessageElement[], group: ProcessGroupElement, finalSummaryMarkdown: HTMLElement | null, canFoldMarkdown: boolean) {
  const body = group.querySelector<HTMLElement>(PROCESS_BODY_SELECTOR)
  if (!body) return false

  let moved = false
  for (const assistant of assistants) {
    assistant.querySelectorAll<ProcessGroupElement>(PROCESS_GROUP_SELECTOR).forEach((existingGroup) => {
      const existingBody = existingGroup.querySelector<HTMLElement>(PROCESS_BODY_SELECTOR)
      if (existingBody && existingBody !== body) {
        Array.from(existingBody.children).forEach((node) => {
          body.append(node)
          moved = true
        })
      }
      if (existingGroup !== group) existingGroup.remove()
    })

    assistant.querySelectorAll<HTMLElement>(PROCESS_DETAIL_NODE_SELECTOR).forEach((node) => {
      if (!isFoldableProcessDetail(node, finalSummaryMarkdown, canFoldMarkdown)) return
      if (node.closest(PROCESS_BODY_SELECTOR)) return
      setProcessFlag(node, PROCESS_FOLDED_ATTR, true)
      body.append(node)
      moved = true
    })
  }

  restoreFinalSummaryMarkdown(group, finalSummaryMarkdown)
  return moved || processBodyHasContent(group)
}

function updateEmptyProcessSources(assistants: AssistantMessageElement[], target: AssistantMessageElement) {
  for (const assistant of assistants) {
    if (assistant === target) {
      assistant.classList.remove('quickforge-process-source-empty')
      continue
    }

    const hasVisibleContent = Boolean(
      assistant.querySelector('markdown-block, thinking-block, tool-message, .quickforge-process-group, .quickforge-approval-card'),
    )
    assistant.classList.toggle('quickforge-process-source-empty', !hasVisibleContent)
  }
}

function decorateProcessTurn(panel: HTMLElement, assistants: AssistantMessageElement[], isAgentStreaming: boolean, turnIndex: number) {
  if (assistants.length === 0) return

  const target = assistants[assistants.length - 1]
  const processKey = processTurnStateKey(assistants, turnIndex)
  const existingGroup = target.querySelector<ProcessGroupElement>(PROCESS_GROUP_SELECTOR)
  if (isAgentStreaming) {
    if (existingGroup) restoreProcessTurn(assistants)
    return
  }
  const canFoldMarkdown = hasTurnProcessSignals(assistants)
  const finalSummaryMarkdown = canFoldMarkdown ? findFinalSummaryMarkdown(target, isAgentStreaming) : null
  if (canFoldMarkdown) markFinalSummaryMarkdown(target, finalSummaryMarkdown)
  const hasProcessContent = hasFoldableProcessContent(assistants, finalSummaryMarkdown, canFoldMarkdown)
  if (!hasProcessContent) {
    if (existingGroup) {
      restoreFinalSummaryMarkdown(existingGroup, finalSummaryMarkdown)
      restoreProcessTurn(assistants)
    }
    return
  }

  const group = ensureTurnProcessGroup(target)
  if (!group) return

  const hasGroupedContent = moveProcessNodesIntoTurnGroup(assistants, group, finalSummaryMarkdown, canFoldMarkdown)
  if (!hasGroupedContent || !processBodyHasContent(group)) {
    group.remove()
    return
  }

  updateProcessGroup(panel, processKey, assistants, group, isAgentStreaming)
  updateEmptyProcessSources(assistants, target)
}

function decorateProcessBlocks(panel: HTMLElement, isAgentStreaming: boolean) {
  const orderedMessages = getPrimaryMessageElements(panel)
  const lastMessage = orderedMessages[orderedMessages.length - 1]
  const isLastMessageAssistant = lastMessage?.tagName.toLowerCase() === 'assistant-message'

  const turns: AssistantMessageElement[][] = []
  let currentAssistants: AssistantMessageElement[] = []
  for (const message of orderedMessages) {
    if (message.tagName.toLowerCase() === 'user-message') {
      if (currentAssistants.length > 0) turns.push(currentAssistants)
      currentAssistants = []
      continue
    }
    currentAssistants.push(message as AssistantMessageElement)
  }
  if (currentAssistants.length > 0) turns.push(currentAssistants)

  turns.forEach((assistants, index) => {
    decorateProcessTurn(panel, assistants, isAgentStreaming && isLastMessageAssistant && index === turns.length - 1, index)
  })
}

// --- Editor decoration ---

export type EditorDecorationDeps = {
  panel: HTMLElement
  isStreaming: () => boolean
  abort: () => void
  agentAccessMode: AgentAccessMode
  planMode: boolean
  workspaceToolsEnabled: boolean
  readOnly: boolean
  allowModelControls: boolean
  onAccessModeChange: (mode: AgentAccessMode) => void
  onTogglePlanMode: () => void
  onInput: (value: string) => void
  onFilesChange: (files: unknown[]) => void
  removeCommandSuggestions: () => void
  updateCommandSuggestions: (value?: string) => void
  setupCommandTextareaHandler: (editor: MessageEditorElement | null) => void
  removeCapabilitySuggestions: () => void
  updateCapabilitySuggestions: (value?: string) => void
  setupCapabilityTextareaHandler: (editor: MessageEditorElement | null) => void
  insertBuiltinPluginMention: (mention: BuiltinPluginMention) => void
  onBeforeSend?: (input: string) => void
}

type EditorModelState = {
  currentModel?: { id?: string; reasoning?: boolean }
  thinkingLevel?: string
}

function thinkingLevelLabel(level: string | undefined) {
  switch (level) {
    case 'low': return t('thinkingLow')
    case 'medium': return t('thinkingMedium')
    case 'high': return t('thinkingHigh')
    case 'xhigh': return t('thinkingXHigh')
    default: return t('thinkingOff')
  }
}

function decorateModelButtonLabel(editor: MessageEditorElement | null, rightControls: HTMLElement) {
  const modelState = editor as (MessageEditorElement & EditorModelState) | null
  const model = modelState?.currentModel
  rightControls.querySelector<HTMLElement>('[data-quickforge-thinking-badge]')?.remove()
  const modelButton = Array.from(rightControls.querySelectorAll<HTMLButtonElement>('button:not(.quickforge-agent-access-inline):not(.quickforge-yolo-inline):not(.quickforge-plan-inline)'))
    .find((button) => Boolean(model?.id && button.textContent?.includes(model.id)))
  if (!modelButton) return

  modelButton.classList.add('quickforge-model-trigger')
  modelButton.setAttribute('aria-haspopup', 'menu')
  modelButton.setAttribute('aria-expanded', document.querySelector('.quickforge-model-menu') ? 'true' : 'false')
  if (model?.reasoning) {
    modelButton.dataset.quickforgeThinkingLevel = `· ${thinkingLevelLabel(modelState?.thinkingLevel)}`
  } else {
    delete modelButton.dataset.quickforgeThinkingLevel
  }
}

function setupPlanModeControls(
  editor: MessageEditorElement | null,
  planMode: boolean,
  onTogglePlanMode: () => void,
) {
  const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
  if (!textarea) return

  const planTextarea = textarea as CommandTextareaElement
  if (planTextarea.__quickforgePlanModeHandler) {
    planTextarea.removeEventListener('keydown', planTextarea.__quickforgePlanModeHandler, true)
  }

  planTextarea.__quickforgePlanModeHandler = (event: KeyboardEvent) => {
    if (event.isComposing || event.key === 'Process') return
    if (event.key !== 'Tab' || !event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    onTogglePlanMode()
  }
  planTextarea.addEventListener('keydown', planTextarea.__quickforgePlanModeHandler, true)
  if (editor) editor.dataset.quickforgePlanMode = String(planMode)
}

type ComposerPlusPopoverElement = HTMLDivElement & {
  __quickforgeDismissHandler?: (event: Event) => void
}

type ComposerPlusMenuDeps = {
  panel: HTMLElement
  editor: MessageEditorElement
  leftControls: HTMLElement
  insertBuiltinPluginMention: (mention: BuiltinPluginMention) => void
  removeCommandSuggestions: () => void
  removeCapabilitySuggestions: () => void
}

const builtinPluginChoices: Array<{
  mention: BuiltinPluginMention
  nameKey: 'pluginOpenaiDocumentsName' | 'pluginOpenaiSpreadsheetsName' | 'pluginOpenaiPresentationsName'
  descriptionKey: 'pluginOpenaiDocumentsDescription' | 'pluginOpenaiSpreadsheetsDescription' | 'pluginOpenaiPresentationsDescription'
  pluginName: string
  icon: string
}> = [
  { mention: 'Documents', nameKey: 'pluginOpenaiDocumentsName', descriptionKey: 'pluginOpenaiDocumentsDescription', pluginName: 'openai-documents', icon: documentPluginIcon },
  { mention: 'Spreadsheets', nameKey: 'pluginOpenaiSpreadsheetsName', descriptionKey: 'pluginOpenaiSpreadsheetsDescription', pluginName: 'openai-spreadsheets', icon: spreadsheetPluginIcon },
  { mention: 'Presentations', nameKey: 'pluginOpenaiPresentationsName', descriptionKey: 'pluginOpenaiPresentationsDescription', pluginName: 'openai-presentations', icon: presentationPluginIcon },
]

function removeComposerPlusPopover(panel: HTMLElement) {
  const popover = panel.querySelector<ComposerPlusPopoverElement>('.quickforge-plus-popover')
  if (popover?.__quickforgeDismissHandler) {
    document.removeEventListener('pointerdown', popover.__quickforgeDismissHandler, true)
    popover.__quickforgeDismissHandler = undefined
  }
  popover?.remove()
  panel.querySelector<HTMLButtonElement>('.quickforge-plus-inline')?.setAttribute('aria-expanded', 'false')
}

function clearMisplacedNativeAttachmentButtonMarks(editor: MessageEditorElement, leftControls: HTMLElement) {
  editor.querySelectorAll<HTMLButtonElement>('.quickforge-native-attachment-hidden').forEach((button) => {
    if (!leftControls.contains(button)) button.classList.remove('quickforge-native-attachment-hidden')
  })
}

function findNativeAttachmentButton(leftControls: HTMLElement) {
  const marked = leftControls.querySelector<HTMLButtonElement>('.quickforge-native-attachment-hidden')
  if (marked) return marked
  return Array.from(leftControls.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => !button.classList.contains('quickforge-plus-inline') && !button.classList.contains('quickforge-agent-access-inline') && !button.classList.contains('quickforge-yolo-inline') && !button.classList.contains('quickforge-plan-inline'))
}

function triggerAttachmentPicker(editor: MessageEditorElement, leftControls: HTMLElement) {
  const fileInput = editor.querySelector<HTMLInputElement>('input[type="file"]')
  if (fileInput) {
    fileInput.click()
    return
  }
  const nativeAttachmentButton = findNativeAttachmentButton(leftControls)
  nativeAttachmentButton?.click()
}

function createPlusMenuItem({
  className,
  icon,
  label,
  description,
  pluginName,
  onSelect,
}: {
  className?: string
  icon: string
  label: string
  description?: string
  pluginName?: string
  onSelect: () => void
}) {
  const item = document.createElement('button')
  item.type = 'button'
  item.className = `quickforge-plus-popover-item${className ? ` ${className}` : ''}`
  if (pluginName) item.dataset.quickforgePluginName = pluginName
  item.innerHTML = `
    <span class="quickforge-plus-popover-item-icon">${icon}</span>
    <span class="quickforge-plus-popover-item-main">
      <span class="quickforge-plus-popover-item-label"></span>
      ${description ? '<span class="quickforge-plus-popover-item-description"></span>' : ''}
    </span>
  `
  item.querySelector<HTMLElement>('.quickforge-plus-popover-item-label')!.textContent = label
  const descriptionEl = item.querySelector<HTMLElement>('.quickforge-plus-popover-item-description')
  if (descriptionEl && description) descriptionEl.textContent = description
  item.onpointerdown = (event) => {
    event.preventDefault()
    event.stopPropagation()
    onSelect()
  }
  return item
}

function renderComposerPlusPopover(deps: ComposerPlusMenuDeps, view: 'main' | 'plugins') {
  const { panel, editor, leftControls, insertBuiltinPluginMention, removeCommandSuggestions, removeCapabilitySuggestions } = deps
  removeCommandSuggestions()
  removeCapabilitySuggestions()

  const popover = (panel.querySelector<ComposerPlusPopoverElement>('.quickforge-plus-popover') ?? document.createElement('div')) as ComposerPlusPopoverElement
  popover.className = 'quickforge-plus-popover'
  popover.setAttribute('role', 'menu')
  popover.innerHTML = ''

  const header = document.createElement('div')
  header.className = 'quickforge-plus-popover-header'
  header.textContent = view === 'plugins' ? t('composerAddPlugins') : t('composerAddMenu')
  popover.append(header)

  if (view === 'main') {
    popover.append(
      createPlusMenuItem({
        icon: attachmentIcon,
        label: t('composerAddAttachment'),
        onSelect: () => {
          removeComposerPlusPopover(panel)
          triggerAttachmentPicker(editor, leftControls)
        },
      }),
      createPlusMenuItem({
        icon: pluginsIcon,
        label: t('composerAddPlugins'),
        onSelect: () => renderComposerPlusPopover(deps, 'plugins'),
      }),
    )
  } else {
    const backButton = createPlusMenuItem({
      className: 'quickforge-plus-popover-back',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
      label: t('composerAddBack'),
      onSelect: () => renderComposerPlusPopover(deps, 'main'),
    })
    popover.append(backButton)
    for (const choice of builtinPluginChoices) {
      popover.append(createPlusMenuItem({
        icon: choice.icon,
        label: t(choice.nameKey),
        description: t(choice.descriptionKey),
        pluginName: choice.pluginName,
        onSelect: () => {
          insertBuiltinPluginMention(choice.mention)
          removeComposerPlusPopover(panel)
        },
      }))
    }
  }

  if (!popover.isConnected) {
    editor.parentElement?.insertBefore(popover, editor)
  }
  if (popover.__quickforgeDismissHandler) {
    document.removeEventListener('pointerdown', popover.__quickforgeDismissHandler, true)
  }
  popover.__quickforgeDismissHandler = (event: Event) => {
    const target = event.target as Node
    if (popover.contains(target)) return
    if (panel.querySelector<HTMLButtonElement>('.quickforge-plus-inline')?.contains(target)) return
    removeComposerPlusPopover(panel)
  }
  document.addEventListener('pointerdown', popover.__quickforgeDismissHandler, true)
  panel.querySelector<HTMLButtonElement>('.quickforge-plus-inline')?.setAttribute('aria-expanded', 'true')
}

function setupComposerPlusMenu(deps: ComposerPlusMenuDeps) {
  const { panel, editor, leftControls } = deps
  clearMisplacedNativeAttachmentButtonMarks(editor, leftControls)
  const nativeAttachmentButton = findNativeAttachmentButton(leftControls)
  nativeAttachmentButton?.classList.add('quickforge-native-attachment-hidden')

  const existingButton = leftControls.querySelector<HTMLButtonElement>('.quickforge-plus-inline')
  const syncButton = (button: HTMLButtonElement) => {
    button.type = 'button'
    patchContent(button, plusIcon)
    button.title = t('composerAddMenu')
    button.setAttribute('aria-label', t('composerAddMenu'))
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', panel.querySelector('.quickforge-plus-popover') ? 'true' : 'false')
    button.className = 'quickforge-plus-inline inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-muted-foreground'
    button.onpointerdown = (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (panel.querySelector('.quickforge-plus-popover')) {
        removeComposerPlusPopover(panel)
      } else {
        renderComposerPlusPopover(deps, 'main')
      }
    }
    button.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  if (existingButton) {
    syncButton(existingButton)
    return
  }

  const button = document.createElement('button')
  syncButton(button)
  leftControls.prepend(button)
}

type AgentAccessMenuElement = HTMLDivElement & {
  __quickforgeDismissHandler?: (event: Event) => void
}

const agentAccessShieldIcon = '<svg class="quickforge-agent-access-trigger-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 19 6v5c0 4.5-2.8 8.4-7 10-4.2-1.6-7-5.5-7-10V6l7-3Z"/><path d="M9 12h6"/></svg>'
const agentAccessWarningIcon = '<svg class="quickforge-agent-access-option-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'
const agentAccessCheckIcon = '<svg class="quickforge-agent-access-check" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
const agentAccessChevronIcon = '<svg class="quickforge-agent-access-chevron" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'

function agentAccessLabel(mode: AgentAccessMode) {
  return mode === 'full-access' ? t('agentAccessFullLabel') : t('agentAccessDefaultLabel')
}

function removeAgentAccessMenu(panel: HTMLElement) {
  const menu = document.querySelector<AgentAccessMenuElement>('.quickforge-agent-access-menu')
  if (menu?.__quickforgeDismissHandler) {
    document.removeEventListener('pointerdown', menu.__quickforgeDismissHandler, true)
    document.removeEventListener('keydown', menu.__quickforgeDismissHandler, true)
    window.removeEventListener('resize', menu.__quickforgeDismissHandler, true)
    window.removeEventListener('scroll', menu.__quickforgeDismissHandler, true)
    menu.__quickforgeDismissHandler = undefined
  }
  menu?.remove()
  panel.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline')?.setAttribute('aria-expanded', 'false')
}

function createAgentAccessItem(mode: AgentAccessMode, currentMode: AgentAccessMode, onSelect: (mode: AgentAccessMode) => void) {
  const selected = mode === currentMode
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'quickforge-agent-access-item'
  item.setAttribute('role', 'menuitemradio')
  item.setAttribute('aria-checked', String(selected))
  item.dataset.quickforgeAgentAccessMode = mode
  item.innerHTML = `
    <span class="quickforge-agent-access-check-slot">${selected ? agentAccessCheckIcon : ''}</span>
    <span class="quickforge-agent-access-option-icon-wrap">${mode === 'full-access' ? agentAccessWarningIcon : agentAccessShieldIcon}</span>
    <span class="quickforge-agent-access-item-label"></span>
  `
  item.querySelector<HTMLElement>('.quickforge-agent-access-item-label')!.textContent = agentAccessLabel(mode)
  item.onpointerdown = (event) => {
    event.preventDefault()
    event.stopPropagation()
    onSelect(mode)
  }
  return item
}

function renderAgentAccessMenu(options: {
  panel: HTMLElement
  trigger: HTMLButtonElement
  agentAccessMode: AgentAccessMode
  onAccessModeChange: (mode: AgentAccessMode) => void
}) {
  const { panel, trigger, agentAccessMode, onAccessModeChange } = options
  const existing = document.querySelector<AgentAccessMenuElement>('.quickforge-agent-access-menu')
  if (existing) {
    removeAgentAccessMenu(panel)
    return
  }

  removeComposerPlusPopover(panel)
  removeAgentAccessMenu(panel)

  const menu = document.createElement('div') as AgentAccessMenuElement
  menu.className = 'quickforge-agent-access-menu'
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', t('agentAccessMenuLabel'))

  const select = (mode: AgentAccessMode) => {
    removeAgentAccessMenu(panel)
    if (mode !== agentAccessMode) onAccessModeChange(mode)
  }

  menu.append(
    createAgentAccessItem('default', agentAccessMode, select),
    createAgentAccessItem('full-access', agentAccessMode, select),
  )

  const positionMenu = () => {
    const rect = trigger.getBoundingClientRect()
    const gap = 8
    const width = Math.min(196, window.innerWidth - 24)
    menu.style.width = `${width}px`
    const measuredHeight = menu.offsetHeight || 96
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
    const top = Math.max(12, rect.top - measuredHeight - gap)
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
  }

  const dismiss = (event: Event) => {
    if (event.type === 'resize' || event.type === 'scroll') {
      positionMenu()
      return
    }
    if (event instanceof KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
    } else {
      const target = event.target as Node
      if (menu.contains(target) || trigger.contains(target)) return
    }
    removeAgentAccessMenu(panel)
  }
  menu.__quickforgeDismissHandler = dismiss
  menu.addEventListener('pointerdown', (event) => event.stopPropagation())
  document.addEventListener('pointerdown', dismiss, true)
  document.addEventListener('keydown', dismiss, true)
  window.addEventListener('resize', dismiss, true)
  window.addEventListener('scroll', dismiss, true)
  document.body.append(menu)
  positionMenu()
  trigger.setAttribute('aria-expanded', 'true')
}

function setupAgentAccessMenu(options: {
  panel: HTMLElement
  leftControls: HTMLElement
  agentAccessMode: AgentAccessMode
  onAccessModeChange: (mode: AgentAccessMode) => void
}) {
  const { panel, leftControls, agentAccessMode, onAccessModeChange } = options
  leftControls.classList.add('quickforge-composer-left-controls')
  panel.querySelector<HTMLButtonElement>('.quickforge-yolo-inline')?.remove()
  const label = agentAccessLabel(agentAccessMode)
  const title = agentAccessMode === 'full-access' ? t('agentAccessFullTitle') : t('agentAccessDefaultTitle')
  const content = `${agentAccessMode === 'full-access' ? agentAccessWarningIcon : agentAccessShieldIcon}<span class="quickforge-agent-access-label"></span>${agentAccessChevronIcon}`
  const buttonClass = `quickforge-agent-access-inline inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium text-muted-foreground${agentAccessMode === 'full-access' ? ' quickforge-agent-access-inline-full' : ''}`
  const existingButton = leftControls.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline')
  const syncButton = (button: HTMLButtonElement) => {
    patchContent(button, content)
    button.querySelector<HTMLElement>('.quickforge-agent-access-label')!.textContent = label
    button.title = title
    button.setAttribute('aria-label', title)
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', document.querySelector('.quickforge-agent-access-menu') ? 'true' : 'false')
    button.dataset.quickforgeAgentAccessMode = agentAccessMode
    button.className = buttonClass
    button.onpointerdown = (event) => {
      event.preventDefault()
      event.stopPropagation()
      renderAgentAccessMenu({ panel, trigger: button, agentAccessMode, onAccessModeChange })
    }
    button.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    button.onkeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return
      event.preventDefault()
      renderAgentAccessMenu({ panel, trigger: button, agentAccessMode, onAccessModeChange })
    }
  }

  if (existingButton) {
    syncButton(existingButton)
  } else {
    const button = document.createElement('button')
    button.type = 'button'
    syncButton(button)
    leftControls.append(button)
  }

  const accessButton = leftControls.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline')
  const planButton = leftControls.querySelector<HTMLButtonElement>('.quickforge-plan-inline')
  if (accessButton && planButton && accessButton.nextSibling !== planButton) {
    leftControls.insertBefore(planButton, accessButton.nextSibling)
  }
}

export function decorateEditor(deps: EditorDecorationDeps) {
  const {
    panel,
    isStreaming,
    abort,
    agentAccessMode,
    planMode,
    workspaceToolsEnabled,
    readOnly,
    allowModelControls,
    onAccessModeChange,
    onTogglePlanMode,
    onInput,
    onFilesChange,
    removeCommandSuggestions,
    updateCommandSuggestions,
    setupCommandTextareaHandler,
    removeCapabilitySuggestions,
    updateCapabilitySuggestions,
    setupCapabilityTextareaHandler,
    insertBuiltinPluginMention,
    onBeforeSend,
  } = deps

  const editor = panel.querySelector<MessageEditorElement>('message-editor')
  editor?.classList.add('quickforge-composer')
  editor?.parentElement?.classList.add('quickforge-composer-shell')
  editor?.parentElement?.parentElement?.classList.add('quickforge-composer-dock')
  const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
  if (textarea) textarea.placeholder = t('composerPlaceholder')

  if (readOnly) {
    panel.querySelector<HTMLElement>('.quickforge-composer-dock')?.remove()
    return
  }

  if (editor) {
    editor.onInput = (value) => {
      onInput(value)
      updateCommandSuggestions(value)
      updateCapabilitySuggestions(value)
    }
    editor.onFilesChange = (attachments) => {
      onFilesChange(attachments ? [...attachments] : [])
    }
    const currentOnSend = editor.onSend
    if (currentOnSend && currentOnSend !== editor.__quickforgePlanWrappedOnSend) {
      editor.__quickforgePlanBaseOnSend = currentOnSend
    }
    const baseOnSend = editor.__quickforgePlanBaseOnSend
    if (baseOnSend) {
      const wrappedOnSend = (input: string, attachments: unknown[]) => {
        const rawText = String(input ?? '')
        const text = rawText.trim()
        if (text.length > 0) onBeforeSend?.(rawText)
        removeCommandSuggestions()
        removeCapabilitySuggestions()
        baseOnSend(rawText, attachments)
      }
      editor.__quickforgePlanWrappedOnSend = wrappedOnSend
      editor.onSend = wrappedOnSend
    }
    updateCommandSuggestions()
    updateCapabilitySuggestions()
  }
  setupCommandTextareaHandler(editor)
  setupCapabilityTextareaHandler(editor)
  setupPlanModeControls(editor, planMode, onTogglePlanMode)

  const agentInterface = panel.querySelector<AgentInterfaceElement>('agent-interface')
  if (agentInterface) {
    const shouldRequestUpdate = agentInterface.enableModelSelector !== allowModelControls
    agentInterface.enableModelSelector = allowModelControls
    agentInterface.enableThinkingSelector = false
    if (shouldRequestUpdate) agentInterface.requestUpdate?.()
  }

  const editorRows = editor?.querySelectorAll<HTMLElement>('.flex.gap-2.items-center')
  const leftControls = editorRows?.[0]
  const rightControls = editorRows?.[editorRows.length - 1]
  if (!rightControls) return
  decorateModelButtonLabel(editor, rightControls)

  const actionButton = rightControls.querySelector<QuickForgeActionButton>('button:last-child')
  if (actionButton) {
    const removeStopHandler = () => {
      if (!actionButton.__quickforgeStopHandler) return
      actionButton.removeEventListener('pointerdown', actionButton.__quickforgeStopHandler, true)
      actionButton.removeEventListener('click', actionButton.__quickforgeStopHandler, true)
      actionButton.__quickforgeStopHandler = undefined
    }

    if (isStreaming()) {
      actionButton.disabled = false
      actionButton.classList.remove('quickforge-send-button')
      actionButton.classList.add('quickforge-stop-button')
      actionButton.title = 'Stop'
      actionButton.setAttribute('aria-label', 'Stop')
      delete actionButton.dataset.quickforgeSendIcon
      replaceSvg(actionButton, '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>')
      if (!actionButton.__quickforgeStopHandler) {
        actionButton.__quickforgeStopHandler = (event: Event) => {
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
          removeCommandSuggestions()
          abort()
        }
        actionButton.addEventListener('pointerdown', actionButton.__quickforgeStopHandler, true)
        actionButton.addEventListener('click', actionButton.__quickforgeStopHandler, true)
      }
    } else {
      removeStopHandler()
      actionButton.classList.remove('quickforge-stop-button')
      actionButton.classList.add('quickforge-send-button')
      if (actionButton.dataset.quickforgeSendIcon !== 'arrow-up') {
        actionButton.dataset.quickforgeSendIcon = 'arrow-up'
        replaceSvg(actionButton, '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>')
        // Remove the Lit element's rotate(-45deg) wrapper so our upward arrow stays pointing up
        const svg = actionButton.querySelector('svg')
        const wrapper = svg?.parentElement
        if (wrapper && wrapper !== actionButton && wrapper.style.transform) {
          wrapper.style.transform = ''
        }
      }
    }
  }

  if (!leftControls) {
    panel.querySelector<HTMLButtonElement>('.quickforge-plus-inline')?.remove()
    removeComposerPlusPopover(panel)
    panel.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline')?.remove()
    removeAgentAccessMenu(panel)
    panel.querySelector<HTMLButtonElement>('.quickforge-yolo-inline')?.remove()
    panel.querySelector<HTMLButtonElement>('.quickforge-plan-inline')?.remove()
    return
  }

  if (editor) {
    setupComposerPlusMenu({
      panel,
      editor,
      leftControls,
      insertBuiltinPluginMention,
      removeCommandSuggestions,
      removeCapabilitySuggestions,
    })
  }

  const planModeTitle = t('planModeEnabledTitle')
  const planModeLabel = `${planIcon}${removePlanIcon}<span>${t('planModeLabel')}</span>`
  const planModeClass = 'quickforge-plan-inline inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium text-muted-foreground'
  const handlePlanToggle = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    onTogglePlanMode()
  }
  const handlePlanKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    handlePlanToggle(event)
  }
  const existingPlanButton = panel.querySelector<HTMLButtonElement>('.quickforge-plan-inline')
  const syncPlanButton = (planButton: HTMLButtonElement) => {
    patchContent(planButton, planModeLabel)
    planButton.title = planModeTitle
    planButton.setAttribute('aria-label', planModeTitle)
    planButton.setAttribute('aria-pressed', String(planMode))
    planButton.className = planModeClass
    planButton.onpointerdown = handlePlanToggle
    planButton.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    planButton.onkeydown = handlePlanKeyDown
  }
  if (!planMode) {
    existingPlanButton?.remove()
  } else if (existingPlanButton) {
    syncPlanButton(existingPlanButton)
  } else {
    const planButton = document.createElement('button')
    planButton.type = 'button'
    syncPlanButton(planButton)
    const accessButton = leftControls.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline')
    if (accessButton) {
      leftControls.insertBefore(planButton, accessButton.nextSibling)
    } else {
      leftControls.append(planButton)
    }
  }

  if (!workspaceToolsEnabled) {
    panel.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline')?.remove()
    removeAgentAccessMenu(panel)
    panel.querySelector<HTMLButtonElement>('.quickforge-yolo-inline')?.remove()
    return
  }

  setupAgentAccessMenu({
    panel,
    leftControls,
    agentAccessMode,
    onAccessModeChange,
  })
}

// --- Draft helpers (operate on a draft Map) ---

export function readComposerDraft(panel: HTMLElement): ComposerDraft {
  const editor = panel.querySelector<MessageEditorElement>('message-editor')
  const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
  const text = editor?.value ?? textarea?.value ?? ''
  const attachments = editor?.attachments ? [...editor.attachments] : []
  return { text, attachments }
}

export function captureComposerDraft(panel: HTMLElement, drafts: Map<string, ComposerDraft>, sessionId: string) {
  const draft = readComposerDraft(panel)
  if (hasDraft(draft)) {
    drafts.set(sessionId, draft)
  } else {
    drafts.delete(sessionId)
  }
}

export function restoreComposerDraft(
  panel: HTMLElement,
  draft: ComposerDraft,
  drafts: Map<string, ComposerDraft>,
  sessionId: string,
) {
  if (!hasDraft(draft)) return
  const normalizedDraft = {
    text: draft.text,
    attachments: draft.attachments ? [...draft.attachments] : [],
  }

  const applyToEditor = () => {
    const editor = panel.querySelector<MessageEditorElement>('message-editor')
    const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
    if (editor) {
      editor.value = normalizedDraft.text
      editor.attachments = normalizedDraft.attachments
      ;(editor as MessageEditorElement & { requestUpdate?: () => void }).requestUpdate?.()
      editor.onInput?.(normalizedDraft.text)
      editor.onFilesChange?.(normalizedDraft.attachments)
    }
    if (textarea) {
      textarea.value = normalizedDraft.text
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.focus()
    }
  }

  const agentInterface = panel.querySelector<AgentInterfaceElement>('agent-interface')
  agentInterface?.setInput?.(normalizedDraft.text, normalizedDraft.attachments)
  applyToEditor()
  requestAnimationFrame(applyToEditor)
  window.setTimeout(applyToEditor, 0)
  drafts.set(sessionId, normalizedDraft)
}

// --- Tool approval card ---

export type ApprovalCardDeps = {
  panel: HTMLElement
  onApprove: () => Promise<void> | void
  onReject: () => Promise<void> | void
}

export type ToolApprovalSource = {
  type?: string
  subagent?: string
  label?: string
  sessionId?: string
}

const APPROVAL_CARD_SELECTOR = '.quickforge-approval-card'

function parseMcpToolName(toolName: string) {
  if (!toolName.startsWith('mcp__')) return null
  const rest = toolName.slice('mcp__'.length)
  const separatorIndex = rest.indexOf('__')
  if (separatorIndex <= 0 || separatorIndex >= rest.length - 2) return null
  return {
    serverName: rest.slice(0, separatorIndex),
    toolName: rest.slice(separatorIndex + 2),
  }
}

function summarizeToolArgs(toolName: string, args: Record<string, unknown>) {
  if (typeof args.summary === 'string') return args.summary
  if (toolName === 'run_command' && typeof args.command === 'string') return args.command
  if (toolName === 'activate_skill' && typeof args.name === 'string') return args.name
  if (toolName === 'read_skill_resource' && typeof args.path === 'string') return args.path
  if (typeof args.path === 'string') return args.path
  if (typeof args.query === 'string') return args.query
  if (typeof args.name === 'string') return args.name
  return ''
}

function hiddenToolArgsPreview(toolName: string, args: Record<string, unknown>) {
  const summary = summarizeToolArgs(toolName, args)
  return `
    ${summary ? `<div class="text-xs text-muted-foreground mb-1">${escapeHtml(t('toolArgsSummary'))}: ${escapeHtml(summary)}</div>` : ''}
    <div class="text-xs bg-background border rounded p-2 text-muted-foreground">${escapeHtml(t('toolDetailsHidden'))}</div>
  `
}

export function injectApprovalCard(
  deps: ApprovalCardDeps,
  toolName: string,
  toolCallId: string,
  args: Record<string, unknown>,
  source?: ToolApprovalSource,
) {
  const { panel, onApprove, onReject } = deps

  // If a card for the same tool call already exists, skip recreation.
  // This prevents the MutationObserver → decorate() → injectApprovalCard
  // loop from destroying and recreating the card every animation frame,
  // which would make the Accept/Reject buttons unclickable.
  const existingCard = panel.querySelector(`.quickforge-approval-card[data-tool-call-id="${CSS.escape(toolCallId)}"]`)
  if (existingCard) return

  // Remove any card for a different tool call (shouldn't normally happen)
  removeApprovalCard(panel)

  const card = document.createElement('div')
  card.className = 'quickforge-approval-card pointer-events-auto mb-4 mx-4 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4'
  card.dataset.toolCallId = toolCallId

  const mcpTool = parseMcpToolName(toolName)
  const displayToolName = mcpTool ? `MCP · ${mcpTool.serverName} · ${mcpTool.toolName}` : toolName

  const sourceLabel = source?.type === 'subagent'
    ? (source.label || source.subagent || 'Subagent')
    : ''

  // Header
  const header = document.createElement('div')
  header.className = 'flex items-center gap-2 mb-3 text-sm font-medium text-amber-800 dark:text-amber-300'
  header.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
  header.append(` ${sourceLabel ? t('subagentToolApprovalWaiting', { source: sourceLabel, toolName: displayToolName }) : t('toolApprovalWaiting', { toolName: displayToolName })}`)
  card.append(header)

  if (sourceLabel) {
    const sourceNote = document.createElement('div')
    sourceNote.className = 'mb-3 rounded-md border border-amber-200/80 bg-background/65 px-2.5 py-1.5 text-xs text-amber-800/85 dark:border-amber-800/70 dark:text-amber-200/85'
    sourceNote.textContent = t('toolApprovalSourceSubagent', { source: sourceLabel })
    card.append(sourceNote)
  }

  // Preview
  const preview = document.createElement('div')
  preview.className = 'quickforge-approval-preview mb-3'

  const showToolDetails = getCachedToolDisplaySettings().showToolDetails

  if (mcpTool) {
    preview.innerHTML = `
      <div class="rounded-md border bg-background/70 p-2 text-xs text-muted-foreground">
        <div><span class="font-medium text-foreground">Source:</span> MCP</div>
        <div><span class="font-medium text-foreground">Server:</span> ${escapeHtml(mcpTool.serverName)}</div>
        <div><span class="font-medium text-foreground">Tool:</span> ${escapeHtml(mcpTool.toolName)}</div>
      </div>
      ${showToolDetails
        ? `<pre class="mt-2 text-xs bg-background border rounded p-2 max-h-40 overflow-auto font-mono whitespace-pre-wrap">${escapeHtml(JSON.stringify(args, null, 2))}</pre>`
        : hiddenToolArgsPreview(toolName, args)}
    `
  } else if (toolName === 'write_file') {
    const filePath = String(args.path ?? '')
    const content = String(args.content ?? '')
    const truncated = content.length > 800
    preview.innerHTML = `
      <div class="text-xs text-muted-foreground mb-1">📁 ${escapeHtml(filePath)}</div>
      <pre class="text-xs bg-background border rounded p-2 max-h-40 overflow-auto font-mono whitespace-pre-wrap">${buildInlinePreview(content.slice(0, 800))}${truncated ? `\n${escapeHtml(t('toolApprovalTruncated'))}` : ''}</pre>
    `
  } else if (toolName === 'edit_file') {
    const filePath = String(args.path ?? '')
    const oldText = String(args.oldText ?? '')
    const newText = String(args.newText ?? '')
    const diffLines = buildInlineDiff(oldText, newText)
    preview.innerHTML = `
      <div class="text-xs text-muted-foreground mb-1">📁 ${escapeHtml(filePath)}</div>
      <pre class="text-xs bg-background border rounded p-2 max-h-40 overflow-auto font-mono whitespace-pre-wrap">${diffLines}</pre>
    `
  } else if (toolName === 'run_command') {
    const command = String(args.command ?? '')
    const timeout = '30m'
    preview.innerHTML = `
      <div class="text-xs text-muted-foreground mb-1">⏱️ ${t('toolApprovalTimeout')}: ${escapeHtml(timeout)}</div>
      <pre class="text-xs bg-background border rounded p-2 max-h-40 overflow-auto font-mono whitespace-pre-wrap">$ ${escapeHtml(command)}</pre>
    `
  } else if (typeof args.description === 'string') {
    preview.innerHTML = `<div class="text-xs bg-background border rounded p-2 text-muted-foreground">${escapeHtml(args.description)}</div>`
  } else {
    preview.innerHTML = showToolDetails
      ? `<pre class="text-xs bg-background border rounded p-2 max-h-40 overflow-auto font-mono whitespace-pre-wrap">${escapeHtml(JSON.stringify(args, null, 2))}</pre>`
      : hiddenToolArgsPreview(toolName, args)
  }
  card.append(preview)

  // Buttons
  const errorMessage = document.createElement('div')
  errorMessage.className = 'mb-2 hidden text-xs text-red-700 dark:text-red-400'
  card.append(errorMessage)

  const actions = document.createElement('div')
  actions.className = 'flex items-center gap-2'

  const setSubmitting = (submitting: boolean) => {
    acceptBtn.disabled = submitting
    rejectBtn.disabled = submitting
    acceptBtn.classList.toggle('opacity-60', submitting)
    rejectBtn.classList.toggle('opacity-60', submitting)
    acceptBtn.textContent = submitting ? t('toolApprovalSubmitting') : t('toolApprovalAccept')
  }

  const submitDecision = async (action: () => Promise<void> | void) => {
    errorMessage.classList.add('hidden')
    errorMessage.textContent = ''
    setSubmitting(true)
    try {
      await action()
    } catch (error) {
      errorMessage.textContent = error instanceof Error ? error.message : t('toolApprovalFailed')
      errorMessage.classList.remove('hidden')
      setSubmitting(false)
    }
  }

  const acceptBtn = document.createElement('button')
  acceptBtn.type = 'button'
  acceptBtn.className = 'inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition-colors cursor-pointer disabled:cursor-not-allowed'
  acceptBtn.textContent = t('toolApprovalAccept')
  acceptBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); void submitDecision(onApprove) })

  const rejectBtn = document.createElement('button')
  rejectBtn.type = 'button'
  rejectBtn.className = 'inline-flex items-center gap-1.5 rounded-md border border-red-300 dark:border-red-700 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer disabled:cursor-not-allowed'
  rejectBtn.textContent = t('toolApprovalReject')
  rejectBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); void submitDecision(onReject) })

  actions.append(acceptBtn, rejectBtn)
  card.append(actions)

  // Insert at the bottom of the message list
  const messageList = panel.querySelector('message-list')
  if (messageList) {
    messageList.append(card)
  } else {
    // Fallback: append to agent-interface
    const agentInterface = panel.querySelector('agent-interface')
    agentInterface?.append(card)
  }

  // Scroll into view
  card.scrollIntoView({ behavior: 'smooth', block: 'end' })
}

export function removeApprovalCard(panel: HTMLElement) {
  panel.querySelectorAll(APPROVAL_CARD_SELECTOR).forEach((el) => el.remove())
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildInlinePreview(text: string): string {
  return text.split('\n').map((line) => {
    const safeLine = escapeHtml(line)
    if (line.startsWith('+')) return `<span style="color:rgb(22 101 52);background:rgba(34,197,94,.14);display:block;">${safeLine}</span>`
    if (line.startsWith('-')) return `<span style="color:rgb(153 27 27);background:rgba(239,68,68,.12);display:block;">${safeLine}</span>`
    if (line.startsWith('@@')) return `<span style="color:rgb(37 99 235);background:rgba(37,99,235,.10);display:block;">${safeLine}</span>`
    return `<span style="display:block;">${safeLine || ' '}</span>`
  }).join('\n')
}

function buildInlineDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const result: string[] = []
  for (const line of oldLines) {
    result.push(`<span style="color:rgb(153 27 27);background:rgba(239,68,68,.12);display:block;">- ${escapeHtml(line)}</span>`)
  }
  for (const line of newLines) {
    result.push(`<span style="color:rgb(22 101 52);background:rgba(34,197,94,.14);display:block;">+ ${escapeHtml(line)}</span>`)
  }
  return result.join('\n')
}
