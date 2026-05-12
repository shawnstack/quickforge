/**
 * Message and editor decoration for the ChatPanel.
 *
 * Handles injecting action buttons (copy, rollback, fork) below messages,
 * and decorating the composer area (Send/Stop toggle, YOLO button, placeholder,
 * command bindings).
 */

import type {
  AgentInterfaceElement,
  MessageEditorElement,
  MessageWithUsage,
  QuickForgeActionButton,
  ComposerDraft,
} from './chat-utils'
import {
  replaceSvg,
  patchContent,
  hasDraft,
} from './chat-utils'
import { assistantText, draftTextFromUserMessage } from '@/lib/message-utils'
import { t } from '@/lib/i18n'

// --- Icon SVGs ---

const copyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
const copiedIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
const rollbackIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>'
const forkIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"/><path d="M12 12v3"/></svg>'

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

// --- Message decoration ---

export type MessageDecorationDeps = {
  panel: HTMLElement
  getMessages: () => MessageWithUsage[]
  isStreaming: () => boolean
  onCopyAnswer: (text: string) => Promise<void> | void
  onRollbackFromMessage: (messageIndex: number) => void
  onForkFromMessage: (messageIndex: number) => void
  disableFork: boolean
}

export function decorateMessages(deps: MessageDecorationDeps) {
  const { panel, getMessages, isStreaming, onCopyAnswer, onRollbackFromMessage, onForkFromMessage, disableFork } = deps

  const displayEntries = getMessages()
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => {
      return message.role === 'user' || message.role === 'user-with-attachments' || message.role === 'assistant'
    })

  const messageElements = Array.from(
    panel.querySelectorAll<HTMLElement>('message-list user-message, message-list assistant-message'),
  )

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

    const actionsClass = `quickforge-message-actions pointer-events-none mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 ${entry.message.role === 'assistant' ? 'px-4 justify-start' : 'mx-4 justify-end'}`
    const existingActions = element.querySelector<HTMLElement>('.quickforge-message-actions')
    if (existingActions?.dataset.quickforgeLayout === 'message-bottom') {
      existingActions.className = actionsClass
      existingActions.querySelectorAll<HTMLButtonElement>('button[data-quickforge-action="rollback"], button[data-quickforge-action="fork"]').forEach((button) => {
        button.disabled = isStreaming()
      })
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

      if (!disableFork) {
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

      const rollbackButton = createIconActionButton('rollback', t('rollback'), rollbackIcon, () => {
        onRollbackFromMessage(entry.index)
      })
      rollbackButton.disabled = isStreaming()
      actions.append(rollbackButton)
    }

    element.append(actions)
  })
}

// --- Editor decoration ---

export type EditorDecorationDeps = {
  panel: HTMLElement
  isStreaming: () => boolean
  abort: () => void
  yoloMode: boolean
  workspaceToolsEnabled: boolean
  readOnly: boolean
  allowModelControls: boolean
  onToggleYoloMode: () => void
  onInput: (value: string) => void
  onFilesChange: (files: unknown[]) => void
  removeCommandSuggestions: () => void
  updateCommandSuggestions: (value?: string) => void
  setupCommandTextareaHandler: (editor: MessageEditorElement | null) => void
}

export function decorateEditor(deps: EditorDecorationDeps) {
  const {
    panel,
    isStreaming,
    abort,
    yoloMode,
    workspaceToolsEnabled,
    readOnly,
    allowModelControls,
    onToggleYoloMode,
    onInput,
    onFilesChange,
    removeCommandSuggestions,
    updateCommandSuggestions,
    setupCommandTextareaHandler,
  } = deps

  const editor = panel.querySelector<MessageEditorElement>('message-editor')
  editor?.classList.add('quickforge-composer')
  editor?.parentElement?.classList.add('quickforge-composer-shell')
  editor?.parentElement?.parentElement?.classList.add('quickforge-composer-dock')
  const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
  if (textarea) textarea.placeholder = t('composerPlaceholder')
  if (editor) {
    editor.onInput = (value) => {
      onInput(value)
      updateCommandSuggestions(value)
    }
    editor.onFilesChange = (attachments) => {
      onFilesChange(attachments ? [...attachments] : [])
    }
    updateCommandSuggestions()
  }
  setupCommandTextareaHandler(editor)

  if (readOnly) {
    panel.querySelector<HTMLElement>('.quickforge-composer-dock')?.remove()
    return
  }

  if (!allowModelControls) {
    const agentInterface = panel.querySelector<AgentInterfaceElement>('agent-interface')
    if (agentInterface) {
      agentInterface.enableModelSelector = false
      agentInterface.enableThinkingSelector = false
    }
  }

  const editorRows = editor?.querySelectorAll<HTMLElement>('.flex.gap-2.items-center')
  const rightControls = editorRows?.[editorRows.length - 1]
  if (!rightControls) return

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

  if (!workspaceToolsEnabled) {
    rightControls.querySelector<HTMLButtonElement>('.quickforge-yolo-inline')?.remove()
    return
  }

  const yoloIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 8 4 4-4 4"/><path d="M13 16h4"/><rect width="18" height="14" x="3" y="5" rx="2"/></svg>'
  const yoloLabel = `${yoloIcon}<span>YOLO</span><span class="ml-0.5 size-1.5 rounded-full ${yoloMode ? 'bg-emerald-500' : 'bg-muted-foreground/45'}"></span>`
  const yoloClass = `quickforge-yolo-inline inline-flex h-8 items-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium ${yoloMode ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`
  const yoloTitle = yoloMode ? t('yoloEnabledTitle') : t('yoloDisabledTitle')

  const handleYoloToggle = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    onToggleYoloMode()
  }

  const handleYoloKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    handleYoloToggle(event)
  }

  const existingButton = rightControls.querySelector<HTMLButtonElement>('.quickforge-yolo-inline')
  if (existingButton) {
    const prevMode = existingButton.getAttribute('aria-pressed')
    const nextMode = String(yoloMode)
    if (prevMode !== nextMode) {
      patchContent(existingButton, yoloLabel)
      existingButton.setAttribute('aria-pressed', nextMode)
      existingButton.className = yoloClass
    }
    if (existingButton.title !== yoloTitle) {
      existingButton.title = yoloTitle
      existingButton.setAttribute('aria-label', yoloTitle)
    }
    existingButton.onpointerdown = handleYoloToggle
    existingButton.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    existingButton.onkeydown = handleYoloKeyDown
    return
  }

  const button = document.createElement('button')
  button.type = 'button'
  patchContent(button, yoloLabel)
  button.title = yoloTitle
  button.setAttribute('aria-label', yoloTitle)
  button.setAttribute('aria-pressed', String(yoloMode))
  button.className = yoloClass
  button.onpointerdown = handleYoloToggle
  button.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
  }
  button.onkeydown = handleYoloKeyDown
  rightControls.prepend(button)
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
  onApprove: () => void
  onReject: () => void
}

const APPROVAL_CARD_SELECTOR = '.quickforge-approval-card'

export function injectApprovalCard(
  deps: ApprovalCardDeps,
  toolName: string,
  toolCallId: string,
  args: Record<string, unknown>,
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

  // Header
  const header = document.createElement('div')
  header.className = 'flex items-center gap-2 mb-3 text-sm font-medium text-amber-800 dark:text-amber-300'
  header.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
  header.append(` ${t('toolApprovalWaiting', { toolName })}`)
  card.append(header)

  // Preview
  const preview = document.createElement('div')
  preview.className = 'quickforge-approval-preview mb-3'

  if (toolName === 'write_file') {
    const filePath = String(args.path ?? '')
    const content = String(args.content ?? '')
    const truncated = content.length > 800
    preview.innerHTML = `
      <div class="text-xs text-muted-foreground mb-1">📁 ${escapeHtml(filePath)}</div>
      <pre class="text-xs bg-background border rounded p-2 max-h-40 overflow-auto font-mono whitespace-pre-wrap">${escapeHtml(content.slice(0, 800))}${truncated ? `\n${t('toolApprovalTruncated')}` : ''}</pre>
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
    const timeout = args.timeoutSeconds ? `${args.timeoutSeconds}s` : '60s'
    preview.innerHTML = `
      <div class="text-xs text-muted-foreground mb-1">⏱️ ${t('toolApprovalTimeout')}: ${escapeHtml(timeout)}</div>
      <pre class="text-xs bg-background border rounded p-2 max-h-40 overflow-auto font-mono whitespace-pre-wrap">$ ${escapeHtml(command)}</pre>
    `
  } else {
    preview.innerHTML = `<pre class="text-xs bg-background border rounded p-2 max-h-40 overflow-auto font-mono whitespace-pre-wrap">${escapeHtml(JSON.stringify(args, null, 2))}</pre>`
  }
  card.append(preview)

  // Buttons
  const actions = document.createElement('div')
  actions.className = 'flex items-center gap-2'

  const acceptBtn = document.createElement('button')
  acceptBtn.type = 'button'
  acceptBtn.className = 'inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition-colors cursor-pointer'
  acceptBtn.textContent = t('toolApprovalAccept')
  acceptBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); onApprove() })

  const rejectBtn = document.createElement('button')
  rejectBtn.type = 'button'
  rejectBtn.className = 'inline-flex items-center gap-1.5 rounded-md border border-red-300 dark:border-red-700 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer'
  rejectBtn.textContent = t('toolApprovalReject')
  rejectBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); onReject() })

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

function buildInlineDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const result: string[] = []
  for (const line of oldLines) {
    result.push(`<span class="text-red-600 dark:text-red-400">- ${escapeHtml(line)}</span>`)
  }
  for (const line of newLines) {
    result.push(`<span class="text-emerald-600 dark:text-emerald-400">+ ${escapeHtml(line)}</span>`)
  }
  return result.join('\n')
}
