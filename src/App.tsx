import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Agent, type AgentMessage, type AgentState } from '@mariozechner/pi-agent-core'
import {
  ApiKeyPromptDialog,
  ChatPanel,
  defaultConvertToLlm,
  ProxyTab,
  SettingsDialog,
  type SessionMetadata,
} from '@mariozechner/pi-web-ui'
import type { Model } from '@mariozechner/pi-ai'
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
} from '@/lib/pi-chat'
import { createCustomProvidersOnlyTab } from '@/lib/custom-providers-only-tab'
import { openCustomOnlyModelSelector } from '@/lib/custom-model-selector'

const SYSTEM_PROMPT =
  'You are a helpful AI assistant. Answer clearly and pragmatically. If the user asks for code, prefer concise working examples.'

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

function textFromContentBlocks(content: unknown) {
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
    .join(' ')
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

function ChatPanelHost({
  agent,
  onModelSelect,
  revision,
}: {
  agent: Agent | null
  onModelSelect?: () => void
  revision: number
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!hostRef.current || !agent) return

    const panel = new ChatPanel()
    panel.setAgent(agent, {
      onApiKeyRequired: (provider) => ApiKeyPromptDialog.prompt(provider),
      onModelSelect,
    })

    hostRef.current.replaceChildren(panel)
    return () => {
      panel.remove()
    }
  }, [agent, onModelSelect, revision])

  return <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />
}

function App() {
  const storageRef = useRef<Awaited<ReturnType<typeof initializePiStorage>> | null>(null)
  const agentRef = useRef<Agent | null>(null)
  const activeModelRef = useRef<Model<'openai-completions'>>(buildConnectionModel(DEFAULT_CONNECTION))
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const currentSessionIdRef = useRef<string | undefined>(undefined)
  const currentTitleRef = useRef('New chat')
  const currentCreatedAtRef = useRef<string | undefined>(undefined)

  const [agent, setAgent] = useState<Agent | null>(null)
  const [sessions, setSessions] = useState<SessionMetadata[]>([])
  const [activeModel, setActiveModel] = useState<Model<'openai-completions'>>(
    buildConnectionModel(DEFAULT_CONNECTION),
  )
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>()
  const [currentTitle, setCurrentTitle] = useState('New chat')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [ready, setReady] = useState(false)
  const [chatPanelRevision, setChatPanelRevision] = useState(0)

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
          tools: [],
          ...initialState,
        },
        convertToLlm: defaultConvertToLlm,
        sessionId,
        maxRetryDelayMs: 60000,
      })

      unsubscribeRef.current = nextAgent.subscribe(async (event) => {
        if (event.type === 'message_end') {
          // pi-agent mutates messages with Array.push(). Clone the array so Lit-based
          // message-list receives a new reference and renders the completed message
          // after the streaming placeholder is cleared.
          nextAgent.state.messages = [...nextAgent.state.messages]
        }

        if (
          event.type === 'message_end' ||
          event.type === 'agent_end' ||
          event.type === 'turn_end'
        ) {
          await persistSession(nextAgent)
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
      activeModelRef.current = session.model as Model<'openai-completions'>
      setActiveModel(session.model as Model<'openai-completions'>)

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

      const initialModel = buildConnectionModel(DEFAULT_CONNECTION)

      activeModelRef.current = initialModel
      setActiveModel(initialModel)

      const sessionId = new URLSearchParams(window.location.search).get('session')
      if (sessionId) {
        const existing = await storage.sessions.get(sessionId)
        if (existing) {
          currentSessionIdRef.current = existing.id
          currentCreatedAtRef.current = existing.createdAt
          currentTitleRef.current = existing.title
          setCurrentSessionId(existing.id)
          setCurrentTitle(existing.title)
          activeModelRef.current = existing.model as Model<'openai-completions'>
          setActiveModel(existing.model as Model<'openai-completions'>)
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

  const activeProfileLabel = useMemo(() => {
    return `${activeModel.provider} / ${activeModel.id}`
  }, [activeModel])

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
      const nextModel = model as Model<'openai-completions'>
      currentAgent.state.model = nextModel
      activeModelRef.current = nextModel
      setActiveModel(nextModel)
      setChatPanelRevision((value) => value + 1)
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
            <div className="truncate text-xs text-muted-foreground">{activeProfileLabel}</div>
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
            <ChatPanelHost agent={agent} onModelSelect={openCustomModelSelector} revision={chatPanelRevision} />
          </section>
        </div>
      </main>
    </div>
  )
}

export default App
