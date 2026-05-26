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
import { assistantText, copyTextToClipboard, draftTextFromUserMessage } from '@/lib/message-utils'
import { t } from '@/lib/i18n'
import { getCachedToolDisplaySettings } from '@/lib/tool-display-settings'

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

type ContextCompactionNoticeDeps = {
  panel: HTMLElement
  getMessages: () => MessageWithUsage[]
  getContextCompaction: () => { summaryMessage?: unknown; compactedUpToIndex?: number } | null | undefined
}

function isDisplayMessage(message: MessageWithUsage) {
  return message.role === 'user' || message.role === 'user-with-attachments' || message.role === 'assistant'
}

function insertBeforeMessageElement(panel: HTMLElement, messages: MessageWithUsage[], messageIndex: number, notice: HTMLElement) {
  const messageElements = Array.from(
    panel.querySelectorAll<HTMLElement>('message-list user-message, message-list assistant-message'),
  )
  let displayIndex = 0
  for (let index = 0; index < messages.length; index++) {
    if (!isDisplayMessage(messages[index])) continue
    if (index === messageIndex) {
      const target = messageElements[displayIndex]
      if (target) {
        target.before(notice)
        return
      }
      break
    }
    displayIndex += 1
  }

  const messageList = panel.querySelector('message-list')
  if (messageList) messageList.prepend(notice)
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
  summary?.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!details) return
    details.open = !details.open
    syncToggleLabel()
  })
  details?.addEventListener('toggle', syncToggleLabel)
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
  notice.className = 'quickforge-context-compaction-notice'
  notice.dataset.tailStart = String(tailStart)
  notice.title = t('contextCompactedTooltip')
  notice.setAttribute('aria-label', t('contextCompactedTooltip'))
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
  if (summaryText) syncCompactionSummaryHandlers(notice, summaryText, initialOpen)

  insertBeforeMessageElement(panel, messages, tailStart, notice)
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

  decorateProcessBlocks(panel, isStreaming())
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
const PROCESS_NODE_SELECTOR = 'thinking-block, tool-message'
const PROCESS_DETAIL_NODE_SELECTOR = 'thinking-block, tool-message, markdown-block'

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

function updateProcessGroup(assistants: AssistantMessageElement[], group: ProcessGroupElement, isAgentStreaming: boolean) {
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
    summary.setAttribute('aria-expanded', String(nextExpanded))
    summary.setAttribute('aria-label', nextExpanded ? t('collapseProcess') : t('expandProcess'))
  }
}

function moveProcessNodesIntoTurnGroup(assistants: AssistantMessageElement[], target: AssistantMessageElement, group: ProcessGroupElement) {
  const body = group.querySelector<HTMLElement>(PROCESS_BODY_SELECTOR)
  if (!body) return false

  let moved = false
  for (const assistant of assistants) {
    const isTarget = assistant === target

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

    const selector = isTarget ? PROCESS_NODE_SELECTOR : PROCESS_DETAIL_NODE_SELECTOR
    assistant.querySelectorAll<HTMLElement>(selector).forEach((node) => {
      if (node.closest(PROCESS_BODY_SELECTOR)) return
      body.append(node)
      moved = true
    })
  }

  return moved || body.childElementCount > 0
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

function restoreProcessTurn(assistants: AssistantMessageElement[]) {
  for (const assistant of assistants) {
    assistant.classList.remove('quickforge-process-source-empty')
    assistant.querySelectorAll<ProcessGroupElement>(PROCESS_GROUP_SELECTOR).forEach((group) => {
      const body = group.querySelector<HTMLElement>(PROCESS_BODY_SELECTOR)
      if (body) {
        Array.from(body.children).forEach((node) => group.parentElement?.insertBefore(node, group))
      }
      group.remove()
    })
  }
}

function decorateProcessTurn(assistants: AssistantMessageElement[], isAgentStreaming: boolean) {
  if (assistants.length === 0) return
  if (isAgentStreaming) {
    restoreProcessTurn(assistants)
    return
  }

  const target = assistants[assistants.length - 1]
  const hasProcessContent = assistants.some((assistant, index) => {
    const selector = index === assistants.length - 1 ? PROCESS_NODE_SELECTOR : PROCESS_DETAIL_NODE_SELECTOR
    return Boolean(assistant.querySelector(selector))
  })
  if (!hasProcessContent) return

  const group = ensureTurnProcessGroup(target)
  if (!group) return

  const hasGroupedContent = moveProcessNodesIntoTurnGroup(assistants, target, group)
  if (!hasGroupedContent) {
    group.remove()
    return
  }

  updateProcessGroup(assistants, group, isAgentStreaming)
  updateEmptyProcessSources(assistants, target)
}

function decorateProcessBlocks(panel: HTMLElement, isAgentStreaming: boolean) {
  const orderedMessages = Array.from(
    panel.querySelectorAll<HTMLElement>('message-list user-message, message-list assistant-message'),
  )

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
    decorateProcessTurn(assistants, isAgentStreaming && index === turns.length - 1)
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
  const modelButton = Array.from(rightControls.querySelectorAll<HTMLButtonElement>('button:not(.quickforge-yolo-inline)'))
    .find((button) => Boolean(model?.id && button.textContent?.includes(model.id)))
  if (!modelButton) return

  modelButton.classList.add('quickforge-model-trigger')
  if (model?.reasoning) {
    modelButton.dataset.quickforgeThinkingLevel = `· ${thinkingLevelLabel(modelState?.thinkingLevel)}`
  } else {
    delete modelButton.dataset.quickforgeThinkingLevel
  }
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

  const agentInterface = panel.querySelector<AgentInterfaceElement>('agent-interface')
  if (agentInterface) {
    if (!allowModelControls) {
      agentInterface.enableModelSelector = false
    }
    agentInterface.enableThinkingSelector = false
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

  if (!workspaceToolsEnabled || !leftControls) {
    panel.querySelector<HTMLButtonElement>('.quickforge-yolo-inline')?.remove()
    return
  }

  const workspaceAccessIcon = yoloMode
    ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 19 6v5c0 4.5-2.8 8.4-7 10-4.2-1.6-7-5.5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 19 6v5c0 4.5-2.8 8.4-7 10-4.2-1.6-7-5.5-7-10V6l7-3Z"/><path d="M9 12h6"/></svg>'
  const workspaceAccessLabel = workspaceAccessIcon
  const workspaceAccessClass = `quickforge-yolo-inline inline-flex h-8 items-center justify-center rounded-md border border-transparent px-2 text-xs font-medium ${yoloMode ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`
  const workspaceAccessTitle = yoloMode ? t('yoloEnabledTitle') : t('yoloDisabledTitle')

  const handleYoloToggle = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    onToggleYoloMode()
  }

  const handleYoloKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    handleYoloToggle(event)
  }

  const existingButton = panel.querySelector<HTMLButtonElement>('.quickforge-yolo-inline')
  if (existingButton) {
    const prevMode = existingButton.getAttribute('aria-pressed')
    const nextMode = String(yoloMode)
    if (prevMode !== nextMode) {
      patchContent(existingButton, workspaceAccessLabel)
      existingButton.setAttribute('aria-pressed', nextMode)
      existingButton.className = workspaceAccessClass
    }
    if (existingButton.title !== workspaceAccessTitle) {
      existingButton.title = workspaceAccessTitle
      existingButton.setAttribute('aria-label', workspaceAccessTitle)
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
  patchContent(button, workspaceAccessLabel)
  button.title = workspaceAccessTitle
  button.setAttribute('aria-label', workspaceAccessTitle)
  button.setAttribute('aria-pressed', String(yoloMode))
  button.className = workspaceAccessClass
  button.onpointerdown = handleYoloToggle
  button.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
  }
  button.onkeydown = handleYoloKeyDown
  leftControls.append(button)
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

const APPROVAL_CARD_SELECTOR = '.quickforge-approval-card'

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

  const showToolDetails = getCachedToolDisplaySettings().showToolDetails

  if (toolName === 'write_file') {
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
