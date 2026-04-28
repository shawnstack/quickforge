import { useCallback, useEffect, useRef, useState } from 'react'
import { Agent, type AgentMessage, type AgentState } from '@mariozechner/pi-agent-core'
import {
  ApiKeyPromptDialog,
  ChatPanel,
  defaultConvertToLlm,
  ProxyTab,
  SettingsDialog,
  type SessionMetadata,
} from '@mariozechner/pi-web-ui'
import type { Api, Model } from '@mariozechner/pi-ai'
import {
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  buildConnectionModel,
  DEFAULT_CONNECTION,
  initializePiStorage,
  loadActiveModel,
  loadYoloMode,
  saveActiveModel,
  saveYoloMode,
} from '@/lib/pi-chat'
import { createCustomProvidersOnlyTab } from '@/lib/custom-providers-only-tab'
import { openCustomOnlyModelSelector } from '@/lib/custom-model-selector'
import { getLocalWorkspaceTools } from '@/lib/local-tools'

// Main chat behavior prompt.
const SYSTEM_PROMPT =
  'You are a helpful AI assistant. Answer clearly and pragmatically. If the user asks for code, prefer concise working examples. When YOLO mode is enabled, you may use the local workspace tools to inspect files, edit files, and run commands in the current project.'

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
}

function textFromContentBlocks(content: unknown, separator = ' ') {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: 'text'; text: string } => {
      return (
        typeof block === 'object' &&
        block !== null &&
        'type' in block &&
        block.type === 'text' &&
        'text' in block &&
        typeof block.text === 'string'
      )
    })
    .map((block) => block.text)
    .join(separator)
}

function assistantText(message: AgentMessage) {
  if (message.role !== 'assistant') return ''
  return textFromContentBlocks(message.content, '\n\n').trim()
}

function rollbackStartIndexFromMessage(messages: AgentMessage[], messageIndex: number) {
  let rollbackIndex = messageIndex

  if (messages[messageIndex]?.role === 'assistant') {
    for (let index = messageIndex - 1; index >= 0; index--) {
      if (messages[index].role === 'user' || messages[index].role === 'user-with-attachments') {
        rollbackIndex = index
        break
      }
    }
  }

  const message = messages[rollbackIndex]
  if (!message || (message.role !== 'user' && message.role !== 'user-with-attachments')) return -1
  return rollbackIndex
}

function rollbackConversationFromMessage(messages: AgentMessage[], messageIndex: number) {
  const rollbackIndex = rollbackStartIndexFromMessage(messages, messageIndex)
  if (rollbackIndex < 0) return messages
  return messages.slice(0, rollbackIndex)
}

function draftTextFromUserMessage(message: AgentMessage) {
  if (message.role !== 'user' && message.role !== 'user-with-attachments') return ''
  return typeof message.content === 'string'
    ? message.content
    : textFromContentBlocks(message.content, '\n\n')
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.append(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function generateTitle(messages: AgentMessage[]) {
  const firstUser = messages.find(
    (message) => message.role === 'user' || message.role === 'user-with-attachments',
  )

  if (!firstUser || (firstUser.role !== 'user' && firstUser.role !== 'user-with-attachments')) {
    return 'New chat'
  }

  const content = firstUser.content
  const text = typeof content === 'string' ? content : textFromContentBlocks(content)

  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized) return 'New chat'
  return normalized.length > 46 ? `${normalized.slice(0, 43)}...` : normalized
}

function shouldSaveSession(messages: AgentMessage[]) {
  return (
    messages.some((message) => message.role === 'user' || message.role === 'user-with-attachments') &&
    messages.some((message) => message.role === 'assistant')
  )
}

function summarizePreview(messages: AgentMessage[]) {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => {
      if (message.role === 'user') return typeof message.content === 'string' ? message.content : ''
      return message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(' ')
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2048)
}

function calculateUsage(messages: AgentMessage[]): SessionMetadata['usage'] {
  return messages.reduce(
    (usage, message) => {
      if (message.role !== 'assistant') return usage
      usage.input += message.usage.input
      usage.output += message.usage.output
      usage.cacheRead += message.usage.cacheRead
      usage.cacheWrite += message.usage.cacheWrite
      usage.totalTokens += message.usage.totalTokens
      usage.cost.input += message.usage.cost.input
      usage.cost.output += message.usage.cost.output
      usage.cost.cacheRead += message.usage.cost.cacheRead
      usage.cost.cacheWrite += message.usage.cost.cacheWrite
      usage.cost.total += message.usage.cost.total
      return usage
    },
    structuredClone(EMPTY_USAGE),
  )
}

function formatSessionTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

type RestoredDraft = {
  id: number
  text: string
  attachments?: unknown[]
}

function ChatPanelHost({
  agent,
  onModelSelect,
  revision,
  yoloMode,
  onToggleYoloMode,
  onRollbackFromMessage,
  onCopyAnswer,
  restoredDraft,
}: {
  agent: Agent | null
  onModelSelect?: () => void
  revision: number
  yoloMode: boolean
  onToggleYoloMode: () => void
  onRollbackFromMessage: (messageIndex: number) => void
  onCopyAnswer: (text: string) => void
  restoredDraft?: RestoredDraft
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const restoredDraftIdRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!hostRef.current || !agent) return

    const panel = new ChatPanel()
    let disposed = false
    let observer: MutationObserver | undefined

    const copyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
    const rollbackIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>'

    const createIconActionButton = (action: string, title: string, icon: string, onClick: () => void) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.fastcodeAction = action
      button.title = title
      button.setAttribute('aria-label', title)
      button.innerHTML = icon
      button.className = 'pointer-events-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'
      button.onclick = (event) => {
        event.stopPropagation()
        onClick()
      }
      return button
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

        const actionsClass = `fastcode-message-actions pointer-events-none mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 ${entry.message.role === 'assistant' ? 'px-4 justify-start' : 'mx-4 justify-start'}`
        const existingActions = element.querySelector<HTMLElement>('.fastcode-message-actions')
        if (existingActions?.dataset.fastcodeLayout === 'message-bottom') {
          existingActions.className = actionsClass
          existingActions.querySelectorAll<HTMLButtonElement>('button[data-fastcode-action="rollback"]').forEach((button) => {
            button.disabled = agent.state.isStreaming
          })
          return
        }
        existingActions?.remove()

        const actions = document.createElement('div')
        actions.dataset.fastcodeLayout = 'message-bottom'
        actions.className = actionsClass

        if (entry.message.role === 'assistant') {
          const text = assistantText(entry.message)
          if (!text) return

          const copyButton = createIconActionButton('copy', 'Copy', copyIcon, () => {
            const currentMessage = agent.state.messages[entry.index]
            const currentText = currentMessage ? assistantText(currentMessage) : text
            if (currentText) onCopyAnswer(currentText)
          })
          actions.append(copyButton)
        } else {
          const rollbackButton = createIconActionButton('rollback', 'Rollback', rollbackIcon, () => {
            onRollbackFromMessage(entry.index)
          })
          rollbackButton.disabled = agent.state.isStreaming
          actions.append(rollbackButton)
        }

        element.append(actions)
      })
    }

    const decorateEditor = () => {
      const editor = panel.querySelector('message-editor')
      const editorRows = editor?.querySelectorAll<HTMLElement>('.flex.gap-2.items-center')
      const rightControls = editorRows?.[editorRows.length - 1]
      if (!rightControls) return

      const existingButton = rightControls.querySelector<HTMLButtonElement>('.fastcode-yolo-inline')
      if (existingButton) {
        existingButton.textContent = yoloMode ? 'YOLO on' : 'YOLO off'
        existingButton.title = yoloMode ? 'Local workspace tools enabled' : 'Local workspace tools disabled'
        existingButton.className = `fastcode-yolo-inline h-8 rounded-md px-2 text-xs ${yoloMode ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'hover:bg-accent hover:text-accent-foreground'}`
        return
      }

      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = yoloMode ? 'YOLO on' : 'YOLO off'
      button.title = yoloMode ? 'Local workspace tools enabled' : 'Local workspace tools disabled'
      button.className = `fastcode-yolo-inline h-8 rounded-md px-2 text-xs ${yoloMode ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'hover:bg-accent hover:text-accent-foreground'}`
      button.onclick = (event) => {
        event.stopPropagation()
        onToggleYoloMode()
      }
      rightControls.prepend(button)
    }

    const decorate = () => {
      if (disposed) return
      decorateMessages()
      decorateEditor()
    }

    void panel.setAgent(agent, {
      onApiKeyRequired: (provider) => ApiKeyPromptDialog.prompt(provider),
      onModelSelect,
      toolsFactory: () => getLocalWorkspaceTools(yoloMode),
    }).then(() => {
      if (restoredDraft && restoredDraftIdRef.current !== restoredDraft.id) {
        restoredDraftIdRef.current = restoredDraft.id
        const agentInterface = panel.querySelector<HTMLElement>('agent-interface') as HTMLElement & {
          setInput?: (text: string, attachments?: unknown[]) => void
        }
        agentInterface?.setInput?.(restoredDraft.text, restoredDraft.attachments)
      }

      decorate()
      observer = new MutationObserver(() => window.requestAnimationFrame(decorate))
      observer.observe(panel, { childList: true, subtree: true })
    })

    hostRef.current.replaceChildren(panel)
    return () => {
      disposed = true
      observer?.disconnect()
      panel.remove()
    }
  }, [agent, onCopyAnswer, onModelSelect, onRollbackFromMessage, onToggleYoloMode, restoredDraft, revision, yoloMode])

  return <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />
}

function App() {
  const storageRef = useRef<Awaited<ReturnType<typeof initializePiStorage>> | null>(null)
  const agentRef = useRef<Agent | null>(null)
  const activeModelRef = useRef<Model<Api>>(buildConnectionModel(DEFAULT_CONNECTION))
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const persistQueueRef = useRef(Promise.resolve())
  const yoloModeRef = useRef(false)
  const currentSessionIdRef = useRef<string | undefined>(undefined)
  const currentTitleRef = useRef('New chat')
  const currentCreatedAtRef = useRef<string | undefined>(undefined)

  const [agent, setAgent] = useState<Agent | null>(null)
  const [sessions, setSessions] = useState<SessionMetadata[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>()
  const [currentTitle, setCurrentTitle] = useState('New chat')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [ready, setReady] = useState(false)
  const [chatPanelRevision, setChatPanelRevision] = useState(0)
  const [yoloMode, setYoloMode] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState<RestoredDraft>()

  const refreshSessions = useCallback(async () => {
    const storage = storageRef.current
    if (!storage) return
    setSessions(await storage.sessions.getAllMetadata())
  }, [])

  const persistSession = useCallback(
    async (nextAgent: Agent) => {
      const storage = storageRef.current
      if (!storage || !shouldSaveSession(nextAgent.state.messages)) return

      const now = new Date().toISOString()
      const id = currentSessionIdRef.current ?? crypto.randomUUID()
      const createdAt = currentCreatedAtRef.current ?? now
      const title =
        currentTitleRef.current === 'New chat'
          ? generateTitle(nextAgent.state.messages)
          : currentTitleRef.current

      currentSessionIdRef.current = id
      currentCreatedAtRef.current = createdAt
      currentTitleRef.current = title
      setCurrentSessionId(id)
      setCurrentTitle(title)

      const sessionData = {
        id,
        title,
        model: nextAgent.state.model!,
        thinkingLevel: nextAgent.state.thinkingLevel,
        messages: nextAgent.state.messages,
        createdAt,
        lastModified: now,
      }

      const metadata: SessionMetadata = {
        id,
        title,
        createdAt,
        lastModified: now,
        messageCount: nextAgent.state.messages.length,
        usage: calculateUsage(nextAgent.state.messages),
        thinkingLevel: nextAgent.state.thinkingLevel,
        preview: summarizePreview(nextAgent.state.messages),
      }

      await storage.sessions.save(sessionData, metadata)
      const url = new URL(window.location.href)
      url.searchParams.set('session', id)
      window.history.replaceState({}, '', url)
      await refreshSessions()
    },
    [refreshSessions],
  )

  const createAgent = useCallback(
    async (initialState?: Partial<AgentState>, sessionId?: string) => {
      unsubscribeRef.current?.()

      const nextAgent = new Agent({
        initialState: {
          systemPrompt: SYSTEM_PROMPT,
          model: activeModelRef.current,
          thinkingLevel: 'off',
          messages: [],
          ...initialState,
          tools: getLocalWorkspaceTools(yoloModeRef.current),
        },
        convertToLlm: defaultConvertToLlm,
        sessionId,
        maxRetryDelayMs: 60000,
        beforeToolCall: async (context) => {
          if (!yoloModeRef.current) {
            return {
              block: true,
              reason: `Local tool ${context.toolCall.name} was blocked because YOLO mode is disabled. Enable YOLO mode inside the input box to grant local workspace access.`,
            }
          }
          return undefined
        },
      })

      unsubscribeRef.current = nextAgent.subscribe((event) => {
        if (event.type === 'message_end') {
          // pi-agent mutates messages with Array.push(). Clone the array so Lit-based
          // message-list receives a new reference and renders the completed message
          // after the streaming placeholder is cleared.
          nextAgent.state.messages = [...nextAgent.state.messages]
        }

        if (event.type === 'agent_end') {
          // Agent emits agent_end before it flips isStreaming to false, and does not
          // emit another UI event afterwards. Refresh the ChatPanel on the next task
          // so the send/stop button sees the final non-streaming state.
          window.setTimeout(() => setChatPanelRevision((value) => value + 1), 0)
        }

        if (
          event.type === 'message_end' ||
          event.type === 'agent_end' ||
          event.type === 'turn_end'
        ) {
          // Do not await persistence here. Agent waits for subscribers; blocking this
          // callback keeps state.isStreaming true and leaves the input button stuck
          // in the running/stop state until storage work completes.
          persistQueueRef.current = persistQueueRef.current
            .catch(() => undefined)
            .then(() => persistSession(nextAgent))
            .catch((error) => console.error('Failed to persist session:', error))
        }
      })

      agentRef.current = nextAgent
      setAgent(nextAgent)
      return nextAgent
    },
    [persistSession],
  )

  const startNewChat = useCallback(async () => {
    currentSessionIdRef.current = undefined
    currentCreatedAtRef.current = undefined
    currentTitleRef.current = 'New chat'
    setCurrentSessionId(undefined)
    setCurrentTitle('New chat')

    const url = new URL(window.location.href)
    url.searchParams.delete('session')
    window.history.replaceState({}, '', url)

    await createAgent()
  }, [createAgent])

  const loadSession = useCallback(
    async (sessionId: string) => {
      const storage = storageRef.current
      if (!storage) return

      const session = await storage.sessions.get(sessionId)
      if (!session) return

      currentSessionIdRef.current = session.id
      currentCreatedAtRef.current = session.createdAt
      currentTitleRef.current = session.title
      setCurrentSessionId(session.id)
      setCurrentTitle(session.title)
      activeModelRef.current = session.model as Model<Api>

      const url = new URL(window.location.href)
      url.searchParams.set('session', session.id)
      window.history.replaceState({}, '', url)

      await createAgent(
        {
          systemPrompt: SYSTEM_PROMPT,
          model: session.model,
          thinkingLevel: session.thinkingLevel,
          messages: session.messages,
          tools: [],
        },
        session.id,
      )
    },
    [createAgent],
  )

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const storage = storageRef.current
      if (!storage) return
      await storage.sessions.delete(sessionId)
      await refreshSessions()
      if (currentSessionIdRef.current === sessionId) {
        await startNewChat()
      }
    },
    [refreshSessions, startNewChat],
  )

  useEffect(() => {
    let cancelled = false

    async function boot() {
      const storage = await initializePiStorage()
      if (cancelled) return

      storageRef.current = storage
      await refreshSessions()

      const savedYoloMode = await loadYoloMode(storage)
      yoloModeRef.current = savedYoloMode
      setYoloMode(savedYoloMode)

      const initialModel = (await loadActiveModel(storage)) ?? buildConnectionModel(DEFAULT_CONNECTION)

      activeModelRef.current = initialModel

      const sessionId = new URLSearchParams(window.location.search).get('session')
      if (sessionId) {
        const existing = await storage.sessions.get(sessionId)
        if (existing) {
          currentSessionIdRef.current = existing.id
          currentCreatedAtRef.current = existing.createdAt
          currentTitleRef.current = existing.title
          setCurrentSessionId(existing.id)
          setCurrentTitle(existing.title)
          activeModelRef.current = existing.model as Model<Api>
          await createAgent(
            {
              systemPrompt: SYSTEM_PROMPT,
              model: existing.model,
              thinkingLevel: existing.thinkingLevel,
              messages: existing.messages,
              tools: [],
            },
            existing.id,
          )
        } else {
          await createAgent({ model: initialModel })
        }
      } else {
        await createAgent({ model: initialModel })
      }

      setReady(true)
    }

    boot()
    return () => {
      cancelled = true
      unsubscribeRef.current?.()
    }
  }, [createAgent, refreshSessions])

  const toggleYoloMode = useCallback(() => {
    const storage = storageRef.current
    const nextMode = !yoloModeRef.current

    yoloModeRef.current = nextMode
    setYoloMode(nextMode)

    if (agentRef.current) {
      setChatPanelRevision((value) => value + 1)
    }

    if (storage) {
      void saveYoloMode(storage, nextMode).catch((error) => {
        console.error('Failed to save YOLO mode:', error)
      })
    }
  }, [])

  const rollbackFromMessage = useCallback(async (messageIndex: number) => {
    const currentAgent = agentRef.current
    if (!currentAgent) return

    if (currentAgent.state.isStreaming) {
      alert('Generation is still running. Stop it or wait until it finishes before rolling back.')
      return
    }

    const rollbackIndex = rollbackStartIndexFromMessage(currentAgent.state.messages, messageIndex)
    const rollbackMessage = rollbackIndex >= 0 ? currentAgent.state.messages[rollbackIndex] : undefined
    const nextMessages = rollbackConversationFromMessage(currentAgent.state.messages, messageIndex)
    if (nextMessages.length === currentAgent.state.messages.length) {
      alert('There is no conversation turn to roll back.')
      return
    }

    currentAgent.state.messages = nextMessages

    if (rollbackMessage) {
      setRestoredDraft({
        id: Date.now(),
        text: draftTextFromUserMessage(rollbackMessage),
        attachments: rollbackMessage.role === 'user-with-attachments' ? rollbackMessage.attachments : undefined,
      })
    }

    setChatPanelRevision((value) => value + 1)

    if (shouldSaveSession(nextMessages)) {
      persistQueueRef.current = persistQueueRef.current
        .catch(() => undefined)
        .then(() => persistSession(currentAgent))
        .catch((error) => console.error('Failed to persist rolled back session:', error))
      return
    }

    const storage = storageRef.current
    const previousSessionId = currentSessionIdRef.current

    currentSessionIdRef.current = undefined
    currentCreatedAtRef.current = undefined
    currentTitleRef.current = 'New chat'
    setCurrentSessionId(undefined)
    setCurrentTitle('New chat')

    const url = new URL(window.location.href)
    url.searchParams.delete('session')
    window.history.replaceState({}, '', url)

    if (storage && previousSessionId) {
      try {
        await storage.sessions.delete(previousSessionId)
        await refreshSessions()
      } catch (error) {
        console.error('Failed to delete rolled back empty session:', error)
      }
    }
  }, [persistSession, refreshSessions])

  const copyAnswer = useCallback(async (text: string) => {
    try {
      await copyTextToClipboard(text)
    } catch (error) {
      console.error('Failed to copy answer:', error)
      alert('Copy failed. Please check clipboard permissions.')
    }
  }, [])

  const openCustomModelSelector = useCallback(async () => {
    const storage = storageRef.current
    const currentAgent = agentRef.current
    if (!storage || !currentAgent) return

    const customProviders = await storage.customProviders.getAll()

    for (const provider of customProviders) {
      if (provider.apiKey) {
        await storage.providerKeys.set(provider.name, provider.apiKey)
      }
    }

    const customModels = customProviders.flatMap((provider) => provider.models ?? [])

    if (customModels.length === 0) {
      alert('请先在设置里添加自定义模型，并确保填写了模型 ID 后保存。')
      return
    }

    openCustomOnlyModelSelector(currentAgent.state.model ?? activeModelRef.current, customModels, (model) => {
      const nextModel = model as Model<Api>
      currentAgent.state.model = nextModel
      activeModelRef.current = nextModel
      setChatPanelRevision((value) => value + 1)
      void saveActiveModel(storage, nextModel).catch((error) => {
        console.error('Failed to save active model:', error)
      })
    })
  }, [])

  if (!ready || !agent) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="text-sm text-muted-foreground">Loading chat workspace...</div>
      </div>
    )
  }

  return (
    <div className="flex h-screen min-h-0 bg-background text-foreground">
      <aside
        className={cn(
          'hidden min-h-0 shrink-0 border-r border-border bg-muted/30 md:flex md:flex-col',
          sidebarOpen ? 'w-72' : 'w-0 overflow-hidden border-r-0',
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-border px-3">
          <Button className="flex-1 justify-start" onClick={startNewChat}>
            <MessageSquarePlus className="size-4" />
            New chat
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {sessions.length === 0 ? (
            <div className="px-3 py-8 text-sm text-muted-foreground">No saved conversations yet.</div>
          ) : (
            <div className="space-y-1">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={cn(
                    'group flex items-start gap-2 rounded-md px-2 py-2 text-left',
                    currentSessionId === session.id ? 'bg-secondary' : 'hover:bg-secondary/70',
                  )}
                >
                  <button
                    className="min-w-0 flex-1 text-left"
                    type="button"
                    onClick={() => loadSession(session.id)}
                  >
                    <div className="truncate text-sm font-medium">{session.title}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {formatSessionTime(session.lastModified)}
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 opacity-0 group-hover:opacity-100"
                    onClick={() => deleteSession(session.id)}
                    aria-label="Delete session"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            onClick={() => setSidebarOpen((value) => !value)}
            aria-label="Toggle sidebar"
          >
            {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="md:hidden" onClick={startNewChat} aria-label="New chat">
            <Plus className="size-4" />
          </Button>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{currentTitle}</div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => SettingsDialog.open([createCustomProvidersOnlyTab(), new ProxyTab()])}
            aria-label="Settings"
          >
            <Settings className="size-4" />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            <ChatPanelHost
              agent={agent}
              onModelSelect={openCustomModelSelector}
              revision={chatPanelRevision}
              yoloMode={yoloMode}
              onToggleYoloMode={toggleYoloMode}
              onRollbackFromMessage={rollbackFromMessage}
              onCopyAnswer={copyAnswer}
              restoredDraft={restoredDraft}
            />
          </section>
        </div>
      </main>
    </div>
  )
}

export default App
