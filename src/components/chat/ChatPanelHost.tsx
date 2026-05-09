import { useEffect, useRef } from 'react'
import {
  ApiKeyPromptDialog,
  ChatPanel,
} from '@mariozechner/pi-web-ui'
import type { ServerAgent } from '@/lib/server-agent'
import type { SharedServerAgent } from '@/lib/shared-server-agent'
import { getLocalWorkspaceTools } from '@/lib/local-tools'
import { assistantText, draftTextFromUserMessage } from '@/lib/message-utils'
import { t } from '@/lib/i18n'
import type { ProjectInfo, RestoredDraft } from '@/lib/types'

type AgentLike = ServerAgent | SharedServerAgent

type ChatPanelHostProps = {
  agent: AgentLike | null
  onModelSelect?: () => void
  revision: number
  yoloMode: boolean
  workspaceToolsEnabled: boolean
  project?: ProjectInfo
  projectId?: string
  onToggleYoloMode: () => void
  onRollbackFromMessage: (messageIndex: number) => void
  onCopyAnswer: (text: string) => Promise<void> | void
  onForkFromMessage: (messageIndex: number) => void
  restoredDraft?: RestoredDraft
  disableFork?: boolean
  readOnly?: boolean
  bypassClientApiKeyCheck?: boolean
  allowModelControls?: boolean
}

type ComposerDraft = Pick<RestoredDraft, 'text' | 'attachments'>
type MessageEditorElement = HTMLElement & {
  value?: string
  attachments?: unknown[]
  onInput?: (value: string) => void
  onFilesChange?: (files: unknown[]) => void
}
type CommandSuggestionElement = HTMLDivElement & {
  __quickforgeDismissHandler?: (event: Event) => void
}
type CommandTextareaElement = HTMLTextAreaElement & {
  __quickforgeCommandCompleteHandler?: (event: KeyboardEvent) => void
}
type AgentInterfaceElement = HTMLElement & {
  setInput?: (text: string, attachments?: unknown[]) => void
  setAutoScroll?: (enabled: boolean) => void
  enableModelSelector?: boolean
  enableThinkingSelector?: boolean
}

type QuickForgeActionButton = HTMLButtonElement & {
  __quickforgeStopHandler?: (event: Event) => void
}

type CustomCommandSummary = {
  name: string
  description?: string
  argumentHint?: string
  allowEdit?: boolean
  allowCommands?: boolean
  relativePath?: string
}

type MessageUsage = {
  input?: number
  output?: number
  totalTokens?: number
}

type MessageWithUsage = {
  role?: string
  content?: unknown
  attachments?: unknown
  toolName?: string
  toolCallId?: string
  toolCall?: unknown
  result?: unknown
  usage?: MessageUsage
  timestamp?: number | string
}

const emptyDraft = (): ComposerDraft => ({ text: '', attachments: [] })
const hasDraft = (draft: ComposerDraft) => draft.text.length > 0 || (draft.attachments?.length ?? 0) > 0

export function ChatPanelHost({
  agent,
  onModelSelect,
  revision,
  yoloMode,
  workspaceToolsEnabled,
  project,
  projectId,
  onToggleYoloMode,
  onRollbackFromMessage,
  onCopyAnswer,
  onForkFromMessage,
  restoredDraft,
  disableFork = false,
  readOnly = false,
  bypassClientApiKeyCheck = false,
  allowModelControls = true,
}: ChatPanelHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const restoredDraftIdRef = useRef<number | undefined>(undefined)
  const composerDraftsRef = useRef<Map<string, ComposerDraft>>(new Map())
  const customCommandsRef = useRef<CustomCommandSummary[]>([])

  useEffect(() => {
    let disposed = false

    if (!project?.id) {
      customCommandsRef.current = []
      return () => { disposed = true }
    }

    fetch(`/api/project/commands?projectId=${encodeURIComponent(project.id)}`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : { commands: [] })
      .then((payload: { commands?: CustomCommandSummary[] }) => {
        if (disposed) return
        customCommandsRef.current = Array.isArray(payload.commands) ? payload.commands : []
      })
      .catch(() => {
        if (!disposed) customCommandsRef.current = []
      })

    return () => { disposed = true }
  }, [project?.id, revision])

  useEffect(() => {
    if (!hostRef.current || !agent) return

    const panel = new ChatPanel()
    const sessionId = agent.sessionId
    let disposed = false
    let observer: MutationObserver | undefined
    let scrollResizeObserver: ResizeObserver | undefined
    let autoScrollEnabled = true
    let autoScrollFrame: number | undefined
    let lastScrollTop = 0
    let lastTouchY: number | undefined
    let lastUserScrollUpAt = Number.NEGATIVE_INFINITY
    let lastPossibleUserScrollAt = Number.NEGATIVE_INFINITY

    const userScrollIntentMs = 500
    const findScrollContainer = () => panel.querySelector<HTMLElement>('agent-interface .overflow-y-auto')
    const isNearBottom = (element: HTMLElement) => element.scrollHeight - element.scrollTop - element.clientHeight <= 80
    const setPanelAutoScroll = (enabled: boolean) => {
      const agentInterface = panel.querySelector<AgentInterfaceElement>('agent-interface')
      agentInterface?.setAutoScroll?.(enabled)
    }
    const recentlyUserScrolled = () => {
      const lastUserScrollAt = Math.max(lastUserScrollUpAt, lastPossibleUserScrollAt)
      return window.performance.now() - lastUserScrollAt <= userScrollIntentMs
    }
    const disableAutoScroll = () => {
      if (autoScrollFrame !== undefined) {
        window.cancelAnimationFrame(autoScrollFrame)
        autoScrollFrame = undefined
      }
      autoScrollEnabled = false
      setPanelAutoScroll(false)
    }
    const markUserScrollUp = () => {
      lastUserScrollUpAt = window.performance.now()
      disableAutoScroll()
    }
    const markPossibleUserScroll = () => {
      lastPossibleUserScrollAt = window.performance.now()
    }
    const scrollToBottom = () => {
      const scrollContainer = findScrollContainer()
      if (!scrollContainer || !autoScrollEnabled) return
      scrollContainer.scrollTop = scrollContainer.scrollHeight
      lastScrollTop = scrollContainer.scrollTop
    }
    const scheduleScrollToBottom = () => {
      if (autoScrollFrame !== undefined) return
      autoScrollFrame = window.requestAnimationFrame(() => {
        autoScrollFrame = undefined
        scrollToBottom()
        window.requestAnimationFrame(scrollToBottom)
      })
    }
    const enableAutoScroll = () => {
      autoScrollEnabled = true
      setPanelAutoScroll(true)
      scheduleScrollToBottom()
    }
    const handleScroll = () => {
      const scrollContainer = findScrollContainer()
      if (!scrollContainer) return
      const currentScrollTop = scrollContainer.scrollTop
      const scrollingUp = currentScrollTop < lastScrollTop - 1
      const userInitiatedScrollUp = scrollingUp && recentlyUserScrolled()
      if (scrollingUp && autoScrollEnabled && !userInitiatedScrollUp && !isNearBottom(scrollContainer)) {
        lastScrollTop = currentScrollTop
        scheduleScrollToBottom()
        return
      }
      if (userInitiatedScrollUp) {
        disableAutoScroll()
      } else if (isNearBottom(scrollContainer)) {
        autoScrollEnabled = true
        setPanelAutoScroll(true)
      }
      lastScrollTop = currentScrollTop
    }
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) markUserScrollUp()
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target === event.currentTarget) markPossibleUserScroll()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home') markUserScrollUp()
    }
    const handleTouchStart = (event: TouchEvent) => {
      lastTouchY = event.touches[0]?.clientY
    }
    const handleTouchMove = (event: TouchEvent) => {
      const currentTouchY = event.touches[0]?.clientY
      if (currentTouchY === undefined || lastTouchY === undefined) return
      if (currentTouchY > lastTouchY + 1) markUserScrollUp()
      lastTouchY = currentTouchY
    }
    const setupScrollSync = () => {
      const scrollContainer = findScrollContainer()
      if (!scrollContainer || scrollResizeObserver) return
      lastScrollTop = scrollContainer.scrollTop
      scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
      scrollContainer.addEventListener('wheel', handleWheel, { passive: true })
      scrollContainer.addEventListener('pointerdown', handlePointerDown, { passive: true })
      scrollContainer.addEventListener('keydown', handleKeyDown)
      scrollContainer.addEventListener('touchstart', handleTouchStart, { passive: true })
      scrollContainer.addEventListener('touchmove', handleTouchMove, { passive: true })
      scrollResizeObserver = new ResizeObserver(() => {
        if (autoScrollEnabled) scheduleScrollToBottom()
      })
      scrollResizeObserver.observe(scrollContainer)
      const contentContainer = scrollContainer.querySelector<HTMLElement>('.max-w-3xl')
      if (contentContainer) scrollResizeObserver.observe(contentContainer)
      const composerDock = panel.querySelector<HTMLElement>('.quickforge-composer-dock')
      if (composerDock) scrollResizeObserver.observe(composerDock)
      enableAutoScroll()
    }

    const copyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
    const copiedIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
    const rollbackIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>'
    const forkIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"/><path d="M12 12v3"/></svg>'

    /**
     * Replace an element's inner SVG without touching sibling nodes (e.g. Lit
     * comment markers).  If the element already contains an <svg>, only that
     * child is replaced; otherwise the new SVG is appended.
     */
    const replaceSvg = (parent: HTMLElement, svgString: string) => {
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
     * Only <svg> and <span> elements from the string are grafted in; other
     * existing element children are cleared first.
     */
    const patchContent = (parent: HTMLElement, html: string) => {
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

    const readComposerDraft = (): ComposerDraft => {
      const editor = panel.querySelector<MessageEditorElement>('message-editor')
      const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
      const text = editor?.value ?? textarea?.value ?? ''
      const attachments = editor?.attachments ? [...editor.attachments] : []
      return { text, attachments }
    }

    const captureComposerDraft = () => {
      const draft = readComposerDraft()
      if (hasDraft(draft)) {
        composerDraftsRef.current.set(sessionId, draft)
      } else {
        composerDraftsRef.current.delete(sessionId)
      }
    }

    const restoreComposerDraft = (draft: ComposerDraft) => {
      if (!hasDraft(draft)) return
      const agentInterface = panel.querySelector<AgentInterfaceElement>('agent-interface')
      agentInterface?.setInput?.(draft.text, draft.attachments)
      composerDraftsRef.current.set(sessionId, {
        text: draft.text,
        attachments: draft.attachments ? [...draft.attachments] : [],
      })
    }

    const clearComposerDraft = () => {
      composerDraftsRef.current.delete(sessionId)
    }

    const commandUsage = (command: CustomCommandSummary) => `/${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ''}`

    const builtinCommands = (): CustomCommandSummary[] => [
      { name: 'compact', description: t('compactCommandDescription'), argumentHint: '' },
      { name: 'clear', description: t('clearCommandDescription'), argumentHint: '' },
    ]

    const selectedCommandFromSuggestions = () => {
      const suggestions = panel.querySelector<CommandSuggestionElement>('.quickforge-command-suggestions')
      const firstItem = suggestions?.querySelector<HTMLButtonElement>('.quickforge-command-suggestion-item')
      const commandName = firstItem?.dataset.quickforgeCommandName
      if (!commandName) return undefined
      return [...builtinCommands(), ...customCommandsRef.current].find((command) => command.name === commandName)
    }

    const removeCommandSuggestions = () => {
      const suggestions = panel.querySelector<CommandSuggestionElement>('.quickforge-command-suggestions')
      if (suggestions?.__quickforgeDismissHandler) {
        document.removeEventListener('pointerdown', suggestions.__quickforgeDismissHandler, true)
        suggestions.__quickforgeDismissHandler = undefined
      }
      suggestions?.remove()
    }

    const insertCommandIntoComposer = (command: CustomCommandSummary) => {
      const text = `/${command.name}${command.argumentHint ? ' ' : ''}`
      restoreComposerDraft({ text, attachments: readComposerDraft().attachments })
      const textarea = panel.querySelector<HTMLTextAreaElement>('message-editor textarea')
      textarea?.focus()
      if (textarea) {
        textarea.selectionStart = text.length
        textarea.selectionEnd = text.length
      }
      removeCommandSuggestions()
    }

    const updateCommandSuggestions = (value?: string) => {
      const editor = panel.querySelector<MessageEditorElement>('message-editor')
      const text = value ?? editor?.value ?? editor?.querySelector<HTMLTextAreaElement>('textarea')?.value ?? ''
      const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
      const existing = panel.querySelector<CommandSuggestionElement>('.quickforge-command-suggestions')

      if (!editor || !textarea || !text.startsWith('/')) {
        existing?.remove()
        return
      }

      const query = text.slice(1).trim().toLowerCase()
      const projectCommands = customCommandsRef.current
      const commands = [...builtinCommands(), ...projectCommands]
        .filter((command) => command.name.includes(query) || command.description?.toLowerCase().includes(query))
        .slice(0, 8)

      if (commands.length === 0) {
        existing?.remove()
        return
      }

      const suggestions = existing ?? document.createElement('div') as CommandSuggestionElement
      suggestions.className = 'quickforge-command-suggestions'
      suggestions.setAttribute('role', 'listbox')
      suggestions.innerHTML = ''

      const header = document.createElement('div')
      header.className = 'quickforge-command-suggestions-header'
      header.textContent = t(projectCommands.length ? 'customCommandsHint' : 'customCommandsEmptyHint')
      suggestions.append(header)

      for (const command of commands) {
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'quickforge-command-suggestion-item'
        item.dataset.quickforgeCommandName = command.name
        item.setAttribute('role', 'option')
        item.innerHTML = `
          <span class="quickforge-command-suggestion-name"></span>
          <span class="quickforge-command-suggestion-description"></span>
        `
        item.querySelector<HTMLElement>('.quickforge-command-suggestion-name')!.textContent = commandUsage(command)
        item.querySelector<HTMLElement>('.quickforge-command-suggestion-description')!.textContent = command.description ?? ''
        item.onpointerdown = (event) => {
          event.preventDefault()
          event.stopPropagation()
          insertCommandIntoComposer(command)
        }
        suggestions.append(item)
      }

      if (!existing) {
        editor.parentElement?.insertBefore(suggestions, editor)
      }

      if (!suggestions.__quickforgeDismissHandler) {
        suggestions.__quickforgeDismissHandler = (event: Event) => {
          if (suggestions.contains(event.target as Node)) return
          if (editor.contains(event.target as Node)) return
          removeCommandSuggestions()
        }
        document.addEventListener('pointerdown', suggestions.__quickforgeDismissHandler, true)
      }
    }

    const estimateTextTokens = (text: string) => {
      let ascii = 0
      let nonAscii = 0
      for (const char of text) {
        if (/\s/.test(char)) continue
        if (char.charCodeAt(0) <= 0x7f) ascii += 1
        else nonAscii += 1
      }
      return Math.ceil(ascii / 4 + nonAscii / 1.8)
    }

    const textFromUnknown = (value: unknown): string => {
      if (!value) return ''
      if (typeof value === 'string') return value
      if (Array.isArray(value)) return value.map(textFromUnknown).filter(Boolean).join('\n')
      if (typeof value === 'object') {
        const record = value as Record<string, unknown>
        if (typeof record.text === 'string') return record.text
        if (typeof record.content === 'string') return record.content
        try {
          return JSON.stringify(value)
        } catch {
          return ''
        }
      }
      return String(value)
    }

    const estimateMessageTokens = (message: MessageWithUsage) => {
      const parts = [message.role ?? '', textFromUnknown(message.content)]
      if (message.attachments) parts.push(textFromUnknown(message.attachments))
      if (message.toolName) parts.push(message.toolName)
      if (message.toolCallId) parts.push(message.toolCallId)
      if (message.toolCall) parts.push(textFromUnknown(message.toolCall))
      if (message.result) parts.push(textFromUnknown(message.result))
      return 4 + estimateTextTokens(parts.filter(Boolean).join('\n'))
    }

    const estimateHistoryTokens = () => {
      const systemPrompt = agent.state.systemPrompt
      const messages = agent.state.messages as MessageWithUsage[]
      return estimateTextTokens(systemPrompt) + messages.reduce((total, message) => total + estimateMessageTokens(message), 0)
    }

    const messageTimestamp = (message: MessageWithUsage) => {
      if (typeof message.timestamp === 'number') return message.timestamp
      if (typeof message.timestamp === 'string') {
        const parsed = Date.parse(message.timestamp)
        return Number.isNaN(parsed) ? 0 : parsed
      }
      return 0
    }

    const hasCompactSummary = (message: MessageWithUsage) => {
      return message.role === 'user' && textFromUnknown(message.content).includes('<compact_summary>')
    }

    const latestCompactTimestamp = (messages: MessageWithUsage[]) => {
      let timestamp = 0
      for (const message of messages) {
        if (hasCompactSummary(message)) timestamp = Math.max(timestamp, messageTimestamp(message))
      }
      return timestamp
    }

    const getContextUsage = () => {
      const contextWindow = agent.state.model?.contextWindow ?? 0
      const messages = agent.state.messages as MessageWithUsage[]
      const compactedAt = latestCompactTimestamp(messages)
      const usage = messages.reduce((latestUsage, message) => {
        const currentUsage = message.usage
        if (message.role !== 'assistant' || !currentUsage) return latestUsage
        if (compactedAt > 0 && messageTimestamp(message) <= compactedAt) return latestUsage
        return currentUsage
      }, undefined as MessageUsage | undefined)
      const inputTokens = usage?.input ?? usage?.totalTokens ?? 0
      const estimatedTokens = estimateHistoryTokens()
      const usedTokens = compactedAt > 0 ? estimatedTokens : Math.max(inputTokens, estimatedTokens)
      const percent = contextWindow > 0 ? Math.min(100, Math.max(0, Math.round((usedTokens / contextWindow) * 100))) : 0
      const hue = Math.round(142 - (142 * percent / 100))
      return { contextWindow, usedTokens, inputTokens, estimatedTokens, percent, color: `hsl(${hue} 72% 45%)` }
    }

    const formatTokens = (value: number) => {
      if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
      if (value >= 1000) return `${Math.round(value / 1000)}K`
      return String(value)
    }

    const updateContextUsageIcon = () => {
      const usage = getContextUsage()
      const existing = panel.querySelector<HTMLElement>('.quickforge-context-usage')
      const statsRight = panel.querySelector('message-editor')?.parentElement?.querySelector<HTMLElement>('.ml-auto.items-center')
      if (!usage.contextWindow || !statsRight) {
        existing?.remove()
        return
      }

      const title = `Context used: ${usage.percent}% (${formatTokens(usage.usedTokens)} / ${formatTokens(usage.contextWindow)} tokens, input ${formatTokens(usage.inputTokens)}, estimated history ${formatTokens(usage.estimatedTokens)})`
      const ring = `conic-gradient(${usage.color} ${usage.percent * 3.6}deg, rgb(229 231 235) 0deg)`
      const icon = existing ?? document.createElement('span')
      icon.className = 'quickforge-context-usage'
      icon.title = title
      icon.setAttribute('aria-label', title)
      icon.style.cssText = [
        'position: relative',
        'display: inline-flex',
        'width: 14px',
        'height: 14px',
        'flex: 0 0 auto',
        'border-radius: 9999px',
        `background: ${ring}`,
        'vertical-align: middle',
        'box-shadow: 0 0 0 1px rgb(0 0 0 / 0.06)',
      ].join(';')
      let hole = icon.firstElementChild as HTMLElement | null
      if (!hole) {
        hole = document.createElement('span')
        icon.append(hole)
      }
      hole.style.cssText = [
        'position: absolute',
        'inset: 3px',
        'border-radius: 9999px',
        'background: hsl(var(--background))',
      ].join(';')
      let label = icon.nextElementSibling as HTMLElement | null
      if (!label?.classList.contains('quickforge-context-usage-label')) {
        label = document.createElement('span')
        label.className = 'quickforge-context-usage-label'
        label.style.cssText = 'color: hsl(var(--muted-foreground)); font-size: 12px; line-height: 1;'
      }
      label.textContent = `${usage.percent}%`
      label.title = title
      label.setAttribute('aria-label', title)
      if (!existing) {
        statsRight.prepend(label)
        statsRight.prepend(icon)
      } else if (icon.nextElementSibling !== label) {
        icon.after(label)
      }
    }

    const showCopiedFeedback = (button: HTMLButtonElement, defaultTitle: string, defaultIcon: string) => {
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

    const createIconActionButton = (action: string, title: string, icon: string, onClick: (button: HTMLButtonElement) => Promise<void> | void) => {
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

    const decorateMessages = () => {
      const displayEntries = agent.state.messages
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => {
          return message.role === 'user' || message.role === 'user-with-attachments' || message.role === 'assistant'
        })

      const messageElements = Array.from(
        panel.querySelectorAll<HTMLElement>('message-list user-message, message-list assistant-message'),
      )

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
            button.disabled = agent.state.isStreaming
          })
          return
        }
        existingActions?.remove()

        const actions = document.createElement('div')
        actions.dataset.quickforgeLayout = 'message-bottom'
        actions.className = actionsClass

        if (entry.message.role === 'assistant') {
          const text = assistantText(entry.message)
          if (!text) return

          const copyButton = createCopyButton(() => {
            const currentMessage = agent.state.messages[entry.index]
            return currentMessage ? assistantText(currentMessage) : text
          })
          actions.append(copyButton)

          if (!disableFork) {
            const forkButton = createIconActionButton('fork', t('forkConversation'), forkIcon, () => {
              onForkFromMessage(entry.index)
            })
            forkButton.disabled = agent.state.isStreaming
            actions.append(forkButton)
          }
        } else {
          const text = draftTextFromUserMessage(entry.message)
          if (text) {
            const copyButton = createCopyButton(() => {
              const currentMessage = agent.state.messages[entry.index]
              return currentMessage ? draftTextFromUserMessage(currentMessage) : text
            })
            actions.append(copyButton)
          }

          const rollbackButton = createIconActionButton('rollback', t('rollback'), rollbackIcon, () => {
            onRollbackFromMessage(entry.index)
          })
          rollbackButton.disabled = agent.state.isStreaming
          actions.append(rollbackButton)
        }

        element.append(actions)
      })
    }

    const decorateEditor = () => {
      const editor = panel.querySelector<MessageEditorElement>('message-editor')
      editor?.classList.add('quickforge-composer')
      editor?.parentElement?.classList.add('quickforge-composer-shell')
      editor?.parentElement?.parentElement?.classList.add('quickforge-composer-dock')
      const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
      if (textarea) textarea.placeholder = t('composerPlaceholder')
      if (editor) {
        editor.onInput = (value) => {
          composerDraftsRef.current.set(sessionId, {
            text: value,
            attachments: editor.attachments ? [...editor.attachments] : [],
          })
          updateCommandSuggestions(value)
        }
        editor.onFilesChange = (attachments) => {
          composerDraftsRef.current.set(sessionId, {
            text: editor.value ?? textarea?.value ?? '',
            attachments: attachments ? [...attachments] : [],
          })
        }
        updateCommandSuggestions()
      }
      if (textarea) {
        const commandTextarea = textarea as CommandTextareaElement
        if (commandTextarea.__quickforgeCommandCompleteHandler) {
          commandTextarea.removeEventListener('keydown', commandTextarea.__quickforgeCommandCompleteHandler, true)
        }
        commandTextarea.__quickforgeCommandCompleteHandler = (event: KeyboardEvent) => {
          if (event.isComposing || event.key === 'Process') return
          if (event.key === 'Enter' && event.shiftKey) {
            event.stopImmediatePropagation()
            return
          }
          if (event.key !== 'Tab') return
          const currentText = editor?.value ?? commandTextarea.value ?? ''
          if (!currentText.startsWith('/')) return
          const command = selectedCommandFromSuggestions()
          if (!command) return
          event.preventDefault()
          event.stopPropagation()
          insertCommandIntoComposer(command)
        }
        commandTextarea.addEventListener('keydown', commandTextarea.__quickforgeCommandCompleteHandler, true)
      }

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

        if (agent.state.isStreaming) {
          actionButton.disabled = false
          actionButton.classList.remove('quickforge-send-button')
          actionButton.classList.add('quickforge-stop-button')
          actionButton.title = agent.state.isStreaming ? 'Stop' : ''
          actionButton.setAttribute('aria-label', agent.state.isStreaming ? 'Stop' : '')
          delete actionButton.dataset.quickforgeSendIcon
          replaceSvg(actionButton, '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>')
          if (!actionButton.__quickforgeStopHandler) {
            actionButton.__quickforgeStopHandler = (event: Event) => {
              event.preventDefault()
              event.stopPropagation()
              event.stopImmediatePropagation()
              removeCommandSuggestions()
              agent.abort()
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
        // Only touch the DOM when values actually changed — keep Lit markers
        // intact by patching only element children (svg + spans).
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

    const decorate = () => {
      if (disposed) return
      // Guard: if the panel is not connected to the DOM, Lit may be
      // mid-render and manipulating children is unsafe.
      if (!panel.isConnected) return
      decorateMessages()
      decorateEditor()
      updateContextUsageIcon()
      setupScrollSync()
      if (autoScrollEnabled) scheduleScrollToBottom()
    }

    let decorateScheduled = false
    const scheduleDecorate = () => {
      if (decorateScheduled) return
      decorateScheduled = true
      window.requestAnimationFrame(() => {
        decorateScheduled = false
        decorate()
      })
    }

    void panel.setAgent(agent as unknown as Parameters<typeof panel.setAgent>[0], {
      onApiKeyRequired: bypassClientApiKeyCheck ? async () => true : (provider) => ApiKeyPromptDialog.prompt(provider),
      onBeforeSend: () => {
        removeCommandSuggestions()
        clearComposerDraft()
        enableAutoScroll()
      },
      onModelSelect,
      toolsFactory: () => getLocalWorkspaceTools(agent.state.tools),
    }).then(() => {
      if (disposed) return
      if (restoredDraft && restoredDraftIdRef.current !== restoredDraft.id) {
        restoredDraftIdRef.current = restoredDraft.id
        restoreComposerDraft(restoredDraft)
      } else {
        restoreComposerDraft(composerDraftsRef.current.get(sessionId) ?? emptyDraft())
      }

      decorate()
      observer = new MutationObserver(scheduleDecorate)
      observer.observe(panel, { childList: true, subtree: true })
    })

    hostRef.current.replaceChildren(panel)

    const unsubscribeScrollEvents = agent.subscribe((event) => {
      if (event.type === 'agent_start') enableAutoScroll()
      if (event.type === 'message_start' || event.type === 'message_update' || event.type === 'message_end' || event.type === 'turn_end' || event.type === 'agent_end') {
        if (autoScrollEnabled) scheduleScrollToBottom()
      }
    })

    return () => {
      captureComposerDraft()
      removeCommandSuggestions()
      disposed = true
      if (autoScrollFrame !== undefined) window.cancelAnimationFrame(autoScrollFrame)
      unsubscribeScrollEvents()
      const scrollContainer = findScrollContainer()
      scrollContainer?.removeEventListener('scroll', handleScroll)
      scrollContainer?.removeEventListener('wheel', handleWheel)
      scrollContainer?.removeEventListener('pointerdown', handlePointerDown)
      scrollContainer?.removeEventListener('keydown', handleKeyDown)
      scrollContainer?.removeEventListener('touchstart', handleTouchStart)
      scrollContainer?.removeEventListener('touchmove', handleTouchMove)
      const completeTextarea = panel.querySelector<CommandTextareaElement>('message-editor textarea')
      if (completeTextarea?.__quickforgeCommandCompleteHandler) {
        completeTextarea.removeEventListener('keydown', completeTextarea.__quickforgeCommandCompleteHandler, true)
      }
      scrollResizeObserver?.disconnect()
      observer?.disconnect()
      panel.remove()
    }
  }, [agent, allowModelControls, bypassClientApiKeyCheck, disableFork, onCopyAnswer, onForkFromMessage, onModelSelect, onRollbackFromMessage, onToggleYoloMode, projectId, readOnly, restoredDraft, revision, workspaceToolsEnabled, yoloMode])

  return <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />
}
