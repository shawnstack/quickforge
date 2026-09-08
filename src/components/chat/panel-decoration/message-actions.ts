import type { MessageWithUsage } from '../chat-utils'
import { formatMessageTime, messageTimestamp, replaceSvg } from '../chat-utils'
import { assistantText, draftTextFromUserMessage } from '@/lib/message-utils'
import { t } from '@/lib/i18n'
import { translateErrorMessage } from '@/lib/error-messages'
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
  runIcon,
} from './icons'
import { decorateLocalFilePathLinks } from './local-file-path-links'
import { decorateUserMessageInputClamp, type InputClampLabels } from '@/lib/input-clamp'
import { createSlashChipElement, parseSlashInvocationPrefix, planSlashChipText } from '../slash-invocation-chip'
import { createFileReferenceChip } from '../file-reference-suggestions'
import { createCapabilityChip } from '../capability-suggestions'
import { selectedCapabilitiesFromDetails } from '@/lib/selected-capabilities'
import { syncAssistantArtifactCard } from './assistant-artifact-card'
import { removeRollbackConfirmPopover, showRollbackConfirmPopover } from './rollback-confirm-popover'
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

/** 失败回合合成的错误 assistant 消息（stopReason=error 且带 errorMessage）。 */
function isErrorMessage(message: MessageWithUsage): boolean {
  if (message.role !== 'assistant') return false
  const { stopReason, errorMessage } = message as { stopReason?: unknown; errorMessage?: unknown }
  return stopReason === 'error' && typeof errorMessage === 'string' && errorMessage.length > 0
}

/**
 * pi-web-ui 的错误红块按原始英文 errorMessage 渲染（<strong>Error:</strong> +
 * 动态文本节点）。已知异常串在展示层翻译为本地化文案（数据保持原文）；保留原
 * strong 节点（前缀本地化与加粗），dataset 记录当前译文使重复 decorate 幂等，
 * 未匹配到映射规则（译文与原文相同）时不改写 Lit 渲染的节点。
 */
function decorateAssistantErrorText(element: HTMLElement, message: MessageWithUsage) {
  if (!isErrorMessage(message)) return
  const { errorMessage } = message as { errorMessage?: unknown }
  if (typeof errorMessage !== 'string') return
  const block = element.querySelector<HTMLElement>('div.bg-destructive\\/10')
  if (!block) return
  const strong = block.querySelector('strong')
  if (!strong) return
  const translated = translateErrorMessage(errorMessage)
  if (!translated || translated === errorMessage) return
  if (block.dataset.quickforgeErrorText === translated) return
  block.dataset.quickforgeErrorText = translated
  block.replaceChildren(strong, document.createTextNode(` ${translated}`))
}

type RollbackPopoverDeps = {
  panel: HTMLElement
  messageIndex: number
  isDisabled: boolean
  title: string
  description: string
  onConfirm: (messageIndex: number) => Promise<void> | void
}

function createRollbackAction(options: RollbackPopoverDeps) {
  const wrapper = document.createElement('span')
  wrapper.className = 'quickforge-rollback-action'

  const rollbackButton = createIconActionButton('rollback', t('rollback'), rollbackIcon, (button) => {
    showRollbackConfirmPopover({
      panel: options.panel,
      button,
      title: options.title,
      description: options.description,
      onConfirm: () => options.onConfirm(options.messageIndex),
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
  /** 终态错误旁「继续生成」：发送一条继续消息或重发未送达的原始消息。 */
  onContinueAfterError?: (errorMessage: MessageWithUsage) => void
  onOpenLocalFilePath?: (path: string) => void
  onOpenFilePreview?: (relativePath: string) => void
  /** 会话文件撤销（artifact 卡片头部按钮）；readOnly 场景由调用方不传以隐藏。 */
  onRollbackFiles?: () => Promise<void> | void
  /** 当前会话文件改动是否已撤销（撤销后按钮置灰为「已撤销」）。 */
  fileChangesRolledBack?: boolean
  /** 审查单文件改动：打开工作区 Review 面板并直达该文件的 diff。 */
  onReviewFileChanges?: (relativePath: string) => void
  /** 在系统文件管理器中显示文件所在目录。 */
  onRevealFile?: (relativePath: string) => void
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

// attachment-tile 宿主标记：path = 当前附件完整路径（点击时读取，路径变化无需重绑），
// bound = 点击监听已安装（每 tile 只绑一次）。
const TEXT_ATTACHMENT_TILE_PATH_FLAG = 'quickforgeTextAttachmentPath'
const TEXT_ATTACHMENT_TILE_BOUND_FLAG = 'quickforgeTextAttachmentBound'

/**
 * 用户消息内 qf 临时文本附件装饰：按附件顺序对齐 attachment-tile，绑定
 * 「系统文件管理器打开」点击；完整路径只放 tile 的 hover 提示，消息内
 * 不展示路径文字行（清理旧版本装饰遗留的行）。装饰周期高频重复执行
 * （流式期每 rAF 全量扫描、DOM 元素被 Lit 按 index 复用），必须幂等：
 * 每 tile 只安装一个读取当前路径的监听。
 */
export function decorateTextAttachmentTiles(
  element: HTMLElement,
  attachments: Array<{ path?: string }>,
  onOpenLocalFilePath?: (path: string) => void,
) {
  element.querySelectorAll<HTMLElement>('.quickforge-text-attachment-path').forEach((row) => row.remove())
  const tiles = Array.from(element.querySelectorAll<HTMLElement>('attachment-tile'))
  attachments.forEach((attachment, attachmentIndex) => {
    const attachmentPath = attachment?.path
    if (!attachmentPath) return
    const tile = tiles[attachmentIndex]
    if (!tile) return
    tile.setAttribute('title', `点击在系统文件管理器中打开：${attachmentPath}`)
    tile.dataset[TEXT_ATTACHMENT_TILE_PATH_FLAG] = attachmentPath
    if (tile.dataset[TEXT_ATTACHMENT_TILE_BOUND_FLAG] === '1') return
    tile.dataset[TEXT_ATTACHMENT_TILE_BOUND_FLAG] = '1'
    tile.addEventListener('click', (clickEvent) => {
      clickEvent.stopPropagation()
      const currentPath = tile.dataset[TEXT_ATTACHMENT_TILE_PATH_FLAG]
      if (currentPath) onOpenLocalFilePath?.(currentPath)
    }, true)
  })
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
    onContinueAfterError,
    onOpenLocalFilePath,
    onOpenFilePreview,
    onRollbackFiles,
    fileChangesRolledBack,
    onReviewFileChanges,
    onRevealFile,
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
      if (Array.isArray(entry.message.attachments)) {
        decorateTextAttachmentTiles(element, entry.message.attachments as Array<{ path?: string }>, onOpenLocalFilePath)
      }
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

    if (entry.message.role === 'assistant') {
      decorateAssistantErrorText(element, entry.message)
    }

    // 终态错误（会话最后一条消息是错误）挂「继续生成」操作行；历史错误不显示按钮。
    const isTerminalErrorEntry = displayIndex === displayEntries.length - 1 && isErrorMessage(entry.message)
    const showContinueAction = isTerminalErrorEntry
      && Boolean(onContinueAfterError)
      && !readOnly
      && (allowRetry || historyActionsDisabled)
    // 错误操作行常显弱化：错误是终态，恢复入口不依赖 hover（触屏无 hover）。
    const actionsClass = isTerminalErrorEntry
      ? 'quickforge-message-actions pointer-events-none mt-1 flex gap-1 px-4 justify-start'
      : `quickforge-message-actions pointer-events-none mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${entry.message.role === 'assistant' ? 'px-4 justify-start' : 'mx-4 justify-end'}`
    const existingActions = element.querySelector<HTMLElement>('.quickforge-message-actions')
    const showAssistantActions = entry.message.role !== 'assistant' || assistantActionIndexes.has(displayIndex)
    if (!showAssistantActions) {
      existingActions?.remove()
      return
    }
    // 错误消息的操作行只在按钮应显示时存在：不再是终态错误或门控关闭时整行移除，
    // 让其回落到常规路径（空文本 assistant 消息不建行，历史错误保持无操作行）。
    const staleErrorRow = Boolean(existingActions) && isErrorMessage(entry.message) && !showContinueAction
    if (staleErrorRow) existingActions?.remove()

    if (!staleErrorRow && existingActions?.dataset.quickforgeLayout === 'message-bottom') {
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

      // Manage continue-after-error button: only show on the terminal error message
      const existingContinue = existingActions.querySelector<HTMLButtonElement>('button[data-quickforge-action="continue"]')
      if (existingContinue && !showContinueAction) {
        existingContinue.remove()
      } else if (showContinueAction) {
        const continueButton = existingContinue ?? createIconActionButton('continue', t('errorContinueAction'), runIcon, () => {
          onContinueAfterError?.(entry.message)
        })
        continueButton.disabled = historyActionsDisabled || isStreaming()
        if (!existingContinue) existingActions.append(continueButton)
      }

      ensureMessageTime(existingActions)

      return
    }
    existingActions?.remove()

    const actions = document.createElement('div')
    actions.dataset.quickforgeLayout = 'message-bottom'
    actions.className = actionsClass

    if (showContinueAction) {
      const continueButton = createIconActionButton('continue', t('errorContinueAction'), runIcon, () => {
        onContinueAfterError?.(entry.message)
      })
      continueButton.disabled = historyActionsDisabled || isStreaming()
      actions.append(continueButton)
      ensureMessageTime(actions)
      element.append(actions)
      return
    }

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

  syncAssistantArtifactCard({
    panel,
    displayEntries,
    messageElements: getPrimaryMessageElements(panel),
    messages: getMessages(),
    streaming,
    onOpenFilePreview,
    onRollbackFiles,
    fileChangesRolledBack,
    onReviewFileChanges,
    onRevealFile,
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
