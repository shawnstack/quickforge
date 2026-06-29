import type { MessageWithUsage } from '../chat-utils'
import { replaceSvg } from '../chat-utils'
import { assistantText, draftTextFromUserMessage } from '@/lib/message-utils'
import { t } from '@/lib/i18n'
import {
  closeSvgCodeBlockMenus,
  decorateMarkdownCommandBlocks,
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

function getPrimaryMessageList(panel: HTMLElement) {
  return panel.querySelector<HTMLElement>('message-list')
}

function getPrimaryMessageElements(panel: HTMLElement) {
  const messageList = getPrimaryMessageList(panel)
  if (!messageList) return []

  return Array.from(messageList.querySelectorAll<HTMLElement>('user-message, assistant-message'))
    .filter((element) => element.closest('message-list') === messageList)
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
  decorateProcessBlocks(panel, messageElements, isStreaming())
  decorateMarkdownSvgCodeBlocks(panel, isStreaming())
  if (enableTerminalCommandActions) {
    decorateMarkdownCommandBlocks(panel, isStreaming())
  } else {
    panel.querySelectorAll('[data-quickforge-action="execute-markdown-command"]').forEach((button) => button.remove())
  }
}
