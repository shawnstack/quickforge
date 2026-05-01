import { useEffect, useRef } from 'react'
import {
  ApiKeyPromptDialog,
  ChatPanel,
} from '@mariozechner/pi-web-ui'
import type { ServerAgent } from '@/lib/server-agent'
import { getLocalWorkspaceTools } from '@/lib/local-tools'
import { assistantText, draftTextFromUserMessage } from '@/lib/message-utils'
import { t } from '@/lib/i18n'
import type { RestoredDraft } from '@/lib/types'

type ChatPanelHostProps = {
  agent: ServerAgent | null
  onModelSelect?: () => void
  revision: number
  yoloMode: boolean
  workspaceToolsEnabled: boolean
  projectId?: string
  onToggleYoloMode: () => void
  onRollbackFromMessage: (messageIndex: number) => void
  onCopyAnswer: (text: string) => Promise<void> | void
  onForkFromMessage: (messageIndex: number) => void
  restoredDraft?: RestoredDraft
}

type ComposerDraft = Pick<RestoredDraft, 'text' | 'attachments'>
type MessageEditorElement = HTMLElement & {
  value?: string
  attachments?: unknown[]
  onInput?: (value: string) => void
  onFilesChange?: (files: unknown[]) => void
}
type AgentInterfaceElement = HTMLElement & {
  setInput?: (text: string, attachments?: unknown[]) => void
}

const emptyDraft = (): ComposerDraft => ({ text: '', attachments: [] })
const hasDraft = (draft: ComposerDraft) => draft.text.length > 0 || (draft.attachments?.length ?? 0) > 0

export function ChatPanelHost({
  agent,
  onModelSelect,
  revision,
  yoloMode,
  workspaceToolsEnabled,
  projectId,
  onToggleYoloMode,
  onRollbackFromMessage,
  onCopyAnswer,
  onForkFromMessage,
  restoredDraft,
}: ChatPanelHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const restoredDraftIdRef = useRef<number | undefined>(undefined)
  const composerDraftRef = useRef<ComposerDraft>(emptyDraft())

  useEffect(() => {
    if (!hostRef.current || !agent) return

    const panel = new ChatPanel()
    let disposed = false
    let observer: MutationObserver | undefined

    const copyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
    const copiedIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
    const rollbackIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>'
    const forkIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"/><path d="M12 12v3"/></svg>'

    const readComposerDraft = (): ComposerDraft => {
      const editor = panel.querySelector<MessageEditorElement>('message-editor')
      const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
      const text = editor?.value ?? textarea?.value ?? ''
      const attachments = editor?.attachments ? [...editor.attachments] : []
      return { text, attachments }
    }

    const captureComposerDraft = () => {
      composerDraftRef.current = readComposerDraft()
    }

    const restoreComposerDraft = (draft: ComposerDraft) => {
      if (!hasDraft(draft)) return
      const agentInterface = panel.querySelector<AgentInterfaceElement>('agent-interface')
      agentInterface?.setInput?.(draft.text, draft.attachments)
      composerDraftRef.current = {
        text: draft.text,
        attachments: draft.attachments ? [...draft.attachments] : [],
      }
    }

    const clearComposerDraft = () => {
      composerDraftRef.current = emptyDraft()
    }

    const showCopiedFeedback = (button: HTMLButtonElement, defaultTitle: string, defaultIcon: string) => {
      const copiedTitle = t('copied')
      const previousTimer = Number(button.dataset.quickforgeCopyFeedbackTimer)
      if (previousTimer) window.clearTimeout(previousTimer)

      button.innerHTML = copiedIcon
      button.title = copiedTitle
      button.setAttribute('aria-label', copiedTitle)
      button.style.color = 'rgb(5 150 105)'

      const timer = window.setTimeout(() => {
        button.innerHTML = defaultIcon
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
      button.innerHTML = icon
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

          const forkButton = createIconActionButton('fork', t('forkConversation'), forkIcon, () => {
            onForkFromMessage(entry.index)
          })
          forkButton.disabled = agent.state.isStreaming
          actions.append(forkButton)
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
          composerDraftRef.current = {
            text: value,
            attachments: editor.attachments ? [...editor.attachments] : [],
          }
        }
        editor.onFilesChange = (attachments) => {
          composerDraftRef.current = {
            text: editor.value ?? textarea?.value ?? '',
            attachments: attachments ? [...attachments] : [],
          }
        }
      }

      const editorRows = editor?.querySelectorAll<HTMLElement>('.flex.gap-2.items-center')
      const rightControls = editorRows?.[editorRows.length - 1]
      if (!rightControls) return

      const actionButton = rightControls.querySelector<HTMLButtonElement>('button:last-child')
      if (actionButton) {
        if (agent.state.isStreaming) {
          actionButton.classList.remove('quickforge-send-button')
          actionButton.classList.add('quickforge-stop-button')
          delete actionButton.dataset.quickforgeSendIcon
        } else {
          actionButton.classList.remove('quickforge-stop-button')
          actionButton.classList.add('quickforge-send-button')
          if (actionButton.dataset.quickforgeSendIcon !== 'arrow-up') {
            actionButton.dataset.quickforgeSendIcon = 'arrow-up'
            actionButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>'
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
        // Only touch the DOM when values actually changed — setting innerHTML
        // unconditionally triggers MutationObserver → rAF → decorate() forever.
        const prevMode = existingButton.getAttribute('aria-pressed')
        const nextMode = String(yoloMode)
        if (prevMode !== nextMode) {
          existingButton.innerHTML = yoloLabel
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
      button.innerHTML = yoloLabel
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
      decorateMessages()
      decorateEditor()
    }

    void panel.setAgent(agent as unknown as Parameters<typeof panel.setAgent>[0], {
      onApiKeyRequired: (provider) => ApiKeyPromptDialog.prompt(provider),
      onBeforeSend: clearComposerDraft,
      onModelSelect,
      toolsFactory: () => getLocalWorkspaceTools(workspaceToolsEnabled && yoloMode, projectId),
    }).then(() => {
      if (disposed) return
      if (restoredDraft && restoredDraftIdRef.current !== restoredDraft.id) {
        restoredDraftIdRef.current = restoredDraft.id
        restoreComposerDraft(restoredDraft)
      } else {
        restoreComposerDraft(composerDraftRef.current)
      }

      decorate()
      observer = new MutationObserver(() => window.requestAnimationFrame(decorate))
      observer.observe(panel, { childList: true, subtree: true })
    })

    hostRef.current.replaceChildren(panel)
    return () => {
      captureComposerDraft()
      disposed = true
      observer?.disconnect()
      panel.remove()
    }
  }, [agent, onCopyAnswer, onForkFromMessage, onModelSelect, onRollbackFromMessage, onToggleYoloMode, projectId, restoredDraft, revision, workspaceToolsEnabled, yoloMode])

  return <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />
}
