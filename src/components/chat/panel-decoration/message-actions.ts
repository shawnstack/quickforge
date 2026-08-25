import type { MessageWithUsage } from '../chat-utils'
import { formatMessageTime, messageTimestamp, replaceSvg } from '../chat-utils'
import { assistantText, draftTextFromUserMessage } from '@/lib/message-utils'
import { t } from '@/lib/i18n'
import {
  closeSvgCodeBlockMenus,
  decorateMarkdownCommandBlocks,
  decorateMarkdownMermaidCodeBlocks,
  decorateMarkdownSvgCodeBlocks,
} from './code-blocks'
import { decorateProcessBlocks } from './process-folding'
import {
  copiedIcon,
  copyIcon,
  forkIcon,
  retryIcon,
  rollbackIcon,
} from './icons'
import { decorateLocalFilePathLinks } from './local-file-path-links'
import { decorateUserMessageInputClamp, type InputClampLabels } from '@/lib/input-clamp'
import { createSlashChipElement, parseSlashInvocationPrefix, planSlashChipText } from '../slash-invocation-chip'
import { createFileReferenceChip } from '../file-reference-suggestions'
import { createCapabilityChip } from '../capability-suggestions'
import { selectedCapabilitiesFromDetails } from '@/lib/selected-capabilities'
import type { FileContextReference } from '../chat-utils'

const inputClampLabels: InputClampLabels = { collapsed: () => t('expand'), expanded: () => t('collapse') }
import { assistantActionDisplayIndexes } from './message-action-visibility'

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

function createMessageTime(timestamp: number): HTMLElement | null {
  if (!timestamp) return null
  const time = document.createElement('span')
  time.className = 'quickforge-message-time'
  time.textContent = formatMessageTime(timestamp)
  return time
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

export type MessageDecorationDeps = {
  panel: HTMLElement
  getMessages: () => MessageWithUsage[]
  /**
   * When the conversation is windowed (see windowed-messages.ts), `getMessages`
   * returns only the visible window. This offset (the full-array index of the
   * first windowed message) is added back so rollback / retry / fork still
   * receive full-array indices.
   */
  messageIndexOffset?: number
  isStreaming: () => boolean
  onCopyAnswer: (text: string) => Promise<void> | void
  onRollbackFromMessage: (messageIndex: number) => Promise<void> | void
  onRetryFromMessage: (messageIndex: number) => void
  onForkFromMessage: (messageIndex: number) => void
  onOpenLocalFilePath?: (path: string) => void
  disableFork: boolean
  allowRollback?: boolean
  allowRetry?: boolean
  historyActionsDisabled?: boolean
  readOnly?: boolean
  enableTerminalCommandActions?: boolean
  rollbackConfirmTitle?: string
  rollbackConfirmDescription?: string
}

function getPrimaryMessageList(panel: HTMLElement) {
  return panel.querySelector<HTMLElement>('message-list')
}

function getMessageElements(messageList: HTMLElement) {
  return Array.from(messageList.querySelectorAll<HTMLElement>('user-message, assistant-message'))
    .filter((element) => element.closest('message-list') === messageList)
}

function getPrimaryMessageElements(panel: HTMLElement) {
  const messageList = getPrimaryMessageList(panel)
  return messageList ? getMessageElements(messageList) : []
}

function getStreamingAssistantMessage(panel: HTMLElement) {
  const messageList = getPrimaryMessageList(panel)
  const streamingContainer = messageList?.parentElement?.querySelector<HTMLElement>(
    ':scope > streaming-message-container:not(.hidden)',
  )
  return streamingContainer?.querySelector<HTMLElement>(':scope > div > assistant-message') ?? null
}

/** 消息流 slash chip 标记（存在即说明此前装饰过；dataset 携带被剥掉的前缀文本）。 */
const SLASH_CHIP_ELEMENT_FLAG = 'data-quickforge-slash-chip-el'

/** 深度优先查找首个非空文本节点（markdown-block 首个 p 内的正文起点）。 */
function findFirstContentTextNode(root: Node): Text | null {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if ((child.textContent ?? '').trim()) return child as Text
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const nested = findFirstContentTextNode(child)
    if (nested) return nested
  }
  return null
}

/**
 * 用户消息 slash 前缀 chip 装饰（方案 A 消息流部分，幂等）：
 * `/skill <name> ` / `/agent <name> ` 前缀渲染为行内 chip，任务正文跟随其后。
 * 复制行为不受影响（copy 走 draftTextFromUserMessage 原文，前缀完整保留）。
 *
 * 还原以 chip 自身为单位：每个 chip 的 dataset 记录被剥掉的精确前缀字符，重装饰时
 * 先移除 chip 并把前缀写回首文本节点，再按当前文本重新应用或仅还原——Lit 重渲染
 * 整体替换 markdown 子树时 chip 已随之消失、文本节点本就是原文，天然幂等。
 */
function decorateUserSlashInvocationChip(element: HTMLElement, message: Parameters<typeof draftTextFromUserMessage>[0]) {
  const container = element.querySelector<HTMLElement>('.user-message-container')
  if (!container) return

  // 1) 还原上一次装饰（若存在）。
  for (const chip of Array.from(container.querySelectorAll<HTMLElement>(`[${SLASH_CHIP_ELEMENT_FLAG}]`))) {
    const prefix = chip.dataset.quickforgeSlashChipPrefix ?? ''
    const sibling = chip.nextSibling
    const parent = chip.parentElement
    chip.remove()
    if (sibling && sibling.nodeType === Node.TEXT_NODE) sibling.textContent = prefix + (sibling.textContent ?? '')
    else if (prefix && parent) parent.insertBefore(document.createTextNode(prefix), sibling ?? null)
  }

  // 2) 消息原文不匹配 slash 调用前缀 → 仅还原，不装饰。
  if (!parseSlashInvocationPrefix(draftTextFromUserMessage(message))) return

  // 3) 在首文本节点上应用（DOM 与原文不一致时放弃，保持原文显示）。
  const node = findFirstContentTextNode(container)
  if (!node?.parentElement) return
  const plan = planSlashChipText(node.textContent ?? '')
  if (!plan) return
  node.textContent = plan.rest
  const chip = createSlashChipElement(plan.invocation)
  chip.setAttribute(SLASH_CHIP_ELEMENT_FLAG, '')
  chip.dataset.quickforgeSlashChipPrefix = plan.prefix
  chip.classList.add('quickforge-slash-chip-in-message')
  node.parentElement.insertBefore(chip, node)
}

function contextReferencesFromMessage(message: MessageWithUsage): FileContextReference[] {
  const details = message.details
  if (!details || typeof details !== 'object' || Array.isArray(details)) return []
  const value = (details as Record<string, unknown>).contextReferences
  if (!Array.isArray(value)) return []
  return value.filter((reference): reference is FileContextReference => Boolean(
    reference
    && typeof reference === 'object'
    && !Array.isArray(reference)
    && (reference as Record<string, unknown>).type === 'file'
    && typeof (reference as Record<string, unknown>).projectId === 'string'
    && typeof (reference as Record<string, unknown>).path === 'string',
  )).slice(0, 8)
}

export function decorateUserContextChips(element: HTMLElement, message: MessageWithUsage) {
  const container = element.querySelector<HTMLElement>('.user-message-container')
  if (!container) return
  const capabilities = selectedCapabilitiesFromDetails(message.details)
  const references = contextReferencesFromMessage(message)
  const existing = container.querySelector<HTMLElement>('.quickforge-message-context-references')
  if (capabilities.length === 0 && references.length === 0) {
    existing?.remove()
    return
  }
  const chips = existing ?? document.createElement('div')
  chips.className = 'quickforge-message-context-references'
  chips.setAttribute('aria-label', capabilities.length > 0 && references.length > 0
    ? t('selectedPluginsAndFiles')
    : capabilities.length > 0 ? t('selectedCapabilities') : t('fileReferences'))
  chips.replaceChildren(
    ...capabilities.map((capability) => createCapabilityChip(capability)),
    ...references.map((reference) => createFileReferenceChip(reference)),
  )
  if (!existing) container.prepend(chips)
}

/**
 * 对 panel 内的 subagent 过程 message-list 应用与聊天主列表一致的
 * process folding 装饰。聊天主流程由 decorateMessages 调用；Workspace
 * Inspector 的 subagent 运行详情侧栏在每次渲染后复用本函数，保证两边
 * 的过程分组/折叠交互与视觉完全一致（重复调用是幂等的）。
 */
export function decorateSubagentProcessBlocks(panel: HTMLElement) {
  panel.querySelectorAll<HTMLElement>('message-list[data-quickforge-subagent-process="true"]').forEach((messageList) => {
    decorateProcessBlocks(
      messageList,
      getMessageElements(messageList),
      messageList.dataset.quickforgeSubagentStreaming === 'true',
    )
  })
}

export function decorateMessages(deps: MessageDecorationDeps) {
  const {
    panel,
    getMessages,
    messageIndexOffset = 0,
    isStreaming,
    onCopyAnswer,
    onRollbackFromMessage,
    onRetryFromMessage,
    onForkFromMessage,
    onOpenLocalFilePath,
    disableFork,
    allowRollback = true,
    allowRetry = true,
    historyActionsDisabled = false,
    readOnly = false,
    enableTerminalCommandActions = true,
    rollbackConfirmTitle = t('rollbackConfirmTitle'),
    rollbackConfirmDescription = t('rollbackConfirm'),
  } = deps

  const displayEntries = getMessages()
    .map((message, index) => ({ message, index: index + messageIndexOffset }))
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
  const streaming = isStreaming()
  const assistantActionIndexes = assistantActionDisplayIndexes(displayEntries.map(({ message }) => message), streaming)

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
    // 纯文本用户消息的长内容定高收起（user-with-attachments 的附件区不参与）。
    if (entry.message.role === 'user') {
      decorateUserMessageInputClamp(element, inputClampLabels)
      // 用户消息 slash 前缀 chip 装饰（/skill、/agent 调用；幂等，可重复调用）。
      decorateUserSlashInvocationChip(element, entry.message as Parameters<typeof draftTextFromUserMessage>[0])
    }
    if (entry.message.role === 'user' || entry.message.role === 'user-with-attachments') {
      decorateUserContextChips(element, entry.message)
    }

    const messageTimeValue = messageTimestamp(entry.message)
    const ensureMessageTime = (actionsContainer: HTMLElement) => {
      const existingTime = actionsContainer.querySelector<HTMLElement>('.quickforge-message-time')
      if (messageTimeValue > 0) {
        if (existingTime) {
          existingTime.textContent = formatMessageTime(messageTimeValue)
          return
        }
        const time = createMessageTime(messageTimeValue)
        if (!time) return
        if (entry.message.role === 'assistant') actionsContainer.append(time)
        else actionsContainer.prepend(time)
      } else {
        existingTime?.remove()
      }
    }

    if (entry.message.role === 'assistant' && onOpenLocalFilePath) {
      decorateLocalFilePathLinks(element, entry.message, onOpenLocalFilePath)
    }

    const actionsClass = `quickforge-message-actions pointer-events-none mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${entry.message.role === 'assistant' ? 'px-4 justify-start' : 'mx-4 justify-end'}`
    const existingActions = element.querySelector<HTMLElement>('.quickforge-message-actions')
    const showAssistantActions = entry.message.role !== 'assistant' || assistantActionIndexes.has(displayIndex)
    if (!showAssistantActions) {
      existingActions?.remove()
      return
    }

    if (existingActions?.dataset.quickforgeLayout === 'message-bottom') {
      existingActions.className = actionsClass
      if (existingActions.parentElement === element && existingActions !== element.lastElementChild) {
        element.append(existingActions)
      }
      if (readOnly) removeRollbackConfirmPopover(panel)
      existingActions.querySelectorAll<HTMLButtonElement>('button[data-quickforge-action="rollback"], button[data-quickforge-action="retry"], button[data-quickforge-action="fork"]').forEach((button) => {
        const action = button.dataset.quickforgeAction
        if (readOnly) {
          button.closest('.quickforge-rollback-action')?.remove()
          button.remove()
          return
        }
        if (historyActionsDisabled) {
          button.disabled = true
          return
        }
        if ((action === 'rollback' && !allowRollback) || (action === 'retry' && !allowRetry) || (action === 'fork' && disableFork)) {
          button.closest('.quickforge-rollback-action')?.remove()
          button.remove()
          return
        }
        button.disabled = isStreaming()
      })

      if (isStreaming()) removeRollbackConfirmPopover(panel)

      // Manage retry button visibility: only show on the last user message
      const existingRetry = existingActions.querySelector<HTMLButtonElement>('button[data-quickforge-action="retry"]')
      const isLastUser = !readOnly && (allowRetry || historyActionsDisabled) && lastUserEntry && entry.index === lastUserEntry.index && entry.message.role !== 'assistant'
      if (existingRetry && !isLastUser) {
        existingRetry.remove()
      } else if (!existingRetry && isLastUser) {
        const retryButton = createIconActionButton('retry', t('retry'), retryIcon, () => {
          onRetryFromMessage(entry.index)
        })
        retryButton.disabled = historyActionsDisabled || isStreaming()
        existingActions.append(retryButton)
      }

      ensureMessageTime(existingActions)

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

      if (!readOnly && (!disableFork || historyActionsDisabled)) {
        const forkButton = createIconActionButton('fork', t('forkConversation'), forkIcon, () => {
          onForkFromMessage(entry.index)
        })
        forkButton.disabled = historyActionsDisabled || isStreaming()
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

      if (!readOnly && (allowRollback || historyActionsDisabled)) {
        const rollbackAction = createRollbackAction({
          panel,
          messageIndex: entry.index,
          isDisabled: historyActionsDisabled || isStreaming(),
          title: rollbackConfirmTitle,
          description: rollbackConfirmDescription,
          onConfirm: onRollbackFromMessage,
        })
        actions.append(rollbackAction)
      }

      if (!readOnly && (allowRetry || historyActionsDisabled) && lastUserEntry && entry.index === lastUserEntry.index) {
        const retryButton = createIconActionButton('retry', t('retry'), retryIcon, () => {
          onRetryFromMessage(entry.index)
        })
        retryButton.disabled = historyActionsDisabled || isStreaming()
        actions.append(retryButton)
      }
    }

    ensureMessageTime(actions)

    element.append(actions)
  })

  closeSvgCodeBlockMenus(panel)
  const processMessageElements = [...messageElements]
  if (streaming) {
    const streamingAssistant = getStreamingAssistantMessage(panel)
    if (streamingAssistant) {
      streamingAssistant.classList.add('quickforge-assistant-message')
      processMessageElements.push(streamingAssistant)
    }
  }
  decorateProcessBlocks(panel, processMessageElements, streaming)
  decorateSubagentProcessBlocks(panel)
  decorateMarkdownSvgCodeBlocks(panel, isStreaming())
  decorateMarkdownMermaidCodeBlocks(panel, isStreaming())
  if (enableTerminalCommandActions) {
    decorateMarkdownCommandBlocks(panel, isStreaming())
  } else {
    panel.querySelectorAll('[data-quickforge-action="execute-markdown-command"]').forEach((button) => button.remove())
  }
}
