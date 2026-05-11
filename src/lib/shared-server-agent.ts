import type { AgentEvent, AgentMessage, ThinkingLevel } from '@mariozechner/pi-agent-core'
import type { Api, Model } from '@mariozechner/pi-ai'
import { streamSimple } from '@mariozechner/pi-ai'
import type { SharePermission } from '@/lib/share-client'

export type SharedSessionState = {
  sessionId?: string
  id?: string
  title?: string
  permission?: SharePermission
  systemPrompt?: string
  model?: Model<Api>
  thinkingLevel?: ThinkingLevel
  messages?: AgentMessage[]
  tools?: unknown[]
  yoloMode?: boolean
  isStreaming?: boolean
  errorMessage?: string
}

type SseEvent = Record<string, unknown> & { type?: string; message?: AgentMessage; messages?: AgentMessage[] }
type MessageMetadata = Record<string, unknown>
type MessageWithMetadata = AgentMessage & { metadata?: MessageMetadata }

const CLIENT_MESSAGE_ID_FIELD = 'quickforgeClientMessageId'

function metadataFromMessage(message?: AgentMessage): MessageMetadata | undefined {
  const metadata = (message as MessageWithMetadata | undefined)?.metadata
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : undefined
}

function clientMessageIdFromMessage(message?: AgentMessage): string | undefined {
  const metadata = metadataFromMessage(message)
  const id = metadata?.[CLIENT_MESSAGE_ID_FIELD]
  return typeof id === 'string' && id ? id : undefined
}

function generateClientMessageId() {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `qfcm_${randomId}`
}

function messageWithClientId(message: AgentMessage): { message: AgentMessage; clientMessageId: string } {
  const existingId = clientMessageIdFromMessage(message)
  if (existingId) return { message, clientMessageId: existingId }
  const clientMessageId = generateClientMessageId()
  return {
    message: {
      ...message,
      metadata: {
        ...metadataFromMessage(message),
        [CLIENT_MESSAGE_ID_FIELD]: clientMessageId,
      },
    } as unknown as AgentMessage,
    clientMessageId,
  }
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block && typeof block === 'object' && (block as { type?: unknown }).type === 'text')
    .map((block) => (block as { text?: unknown }).text)
    .filter((text): text is string => typeof text === 'string')
    .join('')
}

function equivalentUserMessages(a?: AgentMessage, b?: AgentMessage) {
  if (!a || !b) return false
  if (a.role !== b.role) return false
  const aId = clientMessageIdFromMessage(a)
  const bId = clientMessageIdFromMessage(b)
  if (aId && bId) return aId === bId
  return textFromContent((a as { content?: unknown }).content) === textFromContent((b as { content?: unknown }).content)
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : undefined),
      ...init?.headers,
    },
  })
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null
  if (!response.ok) throw new Error(payload?.error || `Request failed: ${response.status}`)
  return payload as T
}

export class SharedServerAgent {
  state: {
    systemPrompt: string
    model: Model<Api>
    thinkingLevel: ThinkingLevel
    messages: AgentMessage[]
    tools: unknown[]
    isStreaming: boolean
    streamingMessage?: AgentMessage
    pendingToolCalls: Set<string>
    errorMessage?: string
  }

  streamFn = streamSimple
  getApiKey?: (provider: string) => Promise<string | undefined>
  sessionId: string
  readonly shareId: string
  readonly permission: SharePermission

  private listeners = new Set<(event: AgentEvent) => void>()
  private eventSource: EventSource | null = null
  private disposed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private baseUrl = ''
  private syncingThinkingLevel = false

  constructor(shareId: string, initialState: SharedSessionState) {
    this.shareId = shareId
    this.sessionId = initialState.sessionId || initialState.id || shareId
    this.permission = initialState.permission ?? 'read'
    const rawState = {
      systemPrompt: initialState.systemPrompt ?? '',
      model: (initialState.model ?? { provider: 'shared', id: 'shared' }) as Model<Api>,
      thinkingLevel: initialState.thinkingLevel ?? 'off',
      messages: initialState.messages?.slice() ?? [],
      tools: initialState.tools ?? [],
      isStreaming: Boolean(initialState.isStreaming),
      streamingMessage: undefined,
      pendingToolCalls: new Set<string>(),
      errorMessage: initialState.errorMessage,
    }
    this.state = new Proxy(rawState, {
      set: (target, prop, value) => {
        const oldValue = target[prop as keyof typeof target]
        ;(target as Record<string | symbol, unknown>)[prop] = value
        if (prop === 'thinkingLevel' && !this.syncingThinkingLevel && value !== oldValue) {
          void this.updateThinkingLevel(value as ThinkingLevel).catch((err) => {
            console.error('Failed to update shared thinking level:', err)
          })
        }
        return true
      },
    })
    this.connectEvents()
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async prompt(input: string | AgentMessage | AgentMessage[]): Promise<void> {
    if (this.disposed || this.permission !== 'operate') return
    const { message, clientMessageId } = messageWithClientId(this.normalizeInput(input))
    this.state.messages = [...this.state.messages, message]
    this.emit({ type: 'message_start', message } as AgentEvent)
    if (!this.state.isStreaming) {
      this.state.isStreaming = true
      this.state.errorMessage = undefined
      this.emit({ type: 'agent_start' } as AgentEvent)
    }

    try {
      await readJson<{ sessionId: string; status: string }>(`/api/shared/${encodeURIComponent(this.shareId)}/message`, {
        method: 'POST',
        body: JSON.stringify({ message, clientMessageId }),
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      this.state.errorMessage = errorMessage
      this.state.isStreaming = false
      this.emit({ type: 'error', error: errorMessage } as unknown as AgentEvent)
      this.emit({ type: 'agent_end', messages: this.state.messages } as AgentEvent)
      throw err
    }
  }

  async updateModel(model: Model<Api>): Promise<void> {
    if (this.disposed || this.permission !== 'operate') return
    this.state.model = model
    try {
      const result = await readJson<{ sessionId: string; model: Model<Api> }>(`/api/shared/${encodeURIComponent(this.shareId)}/model`, {
        method: 'POST',
        body: JSON.stringify({ model }),
      })
      if (result.model) this.state.model = result.model
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      this.state.errorMessage = errorMessage
      this.emit({ type: 'error', error: errorMessage } as unknown as AgentEvent)
      throw err
    }
  }

  async updateThinkingLevel(level: ThinkingLevel): Promise<void> {
    if (this.disposed || this.permission !== 'operate') return
    if (!this.syncingThinkingLevel && this.state.thinkingLevel !== level) this.state.thinkingLevel = level
    try {
      const result = await readJson<{ sessionId: string; thinkingLevel: ThinkingLevel }>(`/api/shared/${encodeURIComponent(this.shareId)}/thinking-level`, {
        method: 'POST',
        body: JSON.stringify({ thinkingLevel: level }),
      })
      if (result.thinkingLevel) this.state.thinkingLevel = result.thinkingLevel
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      this.state.errorMessage = errorMessage
      this.emit({ type: 'error', error: errorMessage } as unknown as AgentEvent)
      throw err
    }
  }

  abort(): void {
    if (this.permission !== 'operate') return
    fetch(`/api/shared/${encodeURIComponent(this.shareId)}/abort`, { method: 'POST' }).catch((err) => {
      console.error('Failed to abort shared conversation:', err)
    })
  }

  steer(): void {
    // Shared conversations do not expose steering as a separate operation.
  }

  followUp(): void {
    // Shared conversations do not expose follow-up as a separate operation.
  }

  reset(): void {
    this.state.messages = []
    this.state.errorMessage = undefined
    this.state.isStreaming = false
    this.state.streamingMessage = undefined
    this.state.pendingToolCalls = new Set<string>()
  }

  async rollback(messageIndex: number): Promise<void> {
    if (this.permission !== 'operate') return
    const result = await readJson<{ ok: boolean; session: SharedSessionState }>(`/api/shared/${encodeURIComponent(this.shareId)}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ messageIndex }),
    })
    this.applyState(result.session)
    this.emit({ type: 'message_end', message: this.state.messages[this.state.messages.length - 1] } as AgentEvent)
  }

  dispose(): void {
    this.disposed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.eventSource?.close()
    this.eventSource = null
    this.listeners.clear()
  }

  static async loadState(shareId: string): Promise<SharedSessionState> {
    return readJson<SharedSessionState>(`/api/shared/${encodeURIComponent(shareId)}/session`)
  }

  static async create(shareId: string): Promise<SharedServerAgent> {
    const state = await SharedServerAgent.loadState(shareId)
    return new SharedServerAgent(shareId, state)
  }

  private normalizeInput(input: string | AgentMessage | AgentMessage[]): AgentMessage {
    if (typeof input === 'string') return { role: 'user', content: input, timestamp: Date.now() } as AgentMessage
    if (Array.isArray(input)) {
      const lastUser = [...input].reverse().find((message) => message.role === 'user' || message.role === 'user-with-attachments')
      return (lastUser ?? input[input.length - 1]) as AgentMessage
    }
    return input
  }

  private connectEvents() {
    if (this.disposed) return
    this.eventSource?.close()
    this.baseUrl = ''
    this.openEventSource()
  }

  private openEventSource() {
    if (this.disposed) return
    const url = `${this.baseUrl}/api/shared/${encodeURIComponent(this.shareId)}/events`
    this.eventSource = new EventSource(url, { withCredentials: true })
    this.eventSource.onopen = () => {
      this.reconnectDelay = 1000
    }

    const eventTypes = [
      'state', 'agent_start', 'agent_end', 'message_start', 'message_end',
      'turn_start', 'turn_end', 'message_update',
      'tool_execution_start', 'tool_execution_update', 'tool_execution_end',
      'error', 'title_updated',
    ]
    const handleMessage = (eventType?: string) => (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as SseEvent
        this.handleEvent(eventType ? { type: eventType, ...data } : data)
      } catch {
        // ignore malformed events
      }
    }

    this.eventSource.onmessage = handleMessage()
    for (const eventType of eventTypes) {
      this.eventSource.addEventListener(eventType, handleMessage(eventType))
    }

    this.eventSource.onerror = () => {
      this.eventSource?.close()
      this.eventSource = null
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
      this.openEventSource()
    }, this.reconnectDelay)
  }

  private handleEvent(event: SseEvent) {
    if (!event.type) return
    switch (event.type) {
      case 'state':
        this.applyState(event as SharedSessionState)
        break
      case 'agent_start':
        this.state.isStreaming = true
        this.state.errorMessage = undefined
        break
      case 'agent_end':
        // Do NOT replace messages from agent_end — the pi-agent-core agent
        // loop only includes messages generated during THIS run (newMessages),
        // not the complete session history.  Messages are already built up
        // incrementally via message_start / message_end handlers.
        this.state.isStreaming = false
        this.state.streamingMessage = undefined
        break
      case 'message_start':
        if (event.message) {
          const existingIndex = this.state.messages.findIndex((message) => equivalentUserMessages(message, event.message))
          if (existingIndex >= 0) {
            const next = this.state.messages.slice()
            next[existingIndex] = event.message
            this.state.messages = next
          } else {
            this.state.messages = [...this.state.messages, event.message]
          }
        }
        break
      case 'message_update':
        if (event.message) this.state.streamingMessage = event.message
        break
      case 'message_end':
        if (event.message) {
          const next = this.state.messages.slice()
          const lastIndex = next.length - 1
          if (lastIndex >= 0 && next[lastIndex]?.role === event.message.role) next[lastIndex] = event.message
          else next.push(event.message)
          this.state.messages = next
        }
        this.state.streamingMessage = undefined
        break
      case 'error':
        this.state.errorMessage = typeof event.error === 'string' ? event.error : 'Unknown error'
        this.state.isStreaming = false
        break
    }
    this.emit(event as unknown as AgentEvent)
  }

  private applyState(state: SharedSessionState) {
    this.sessionId = state.sessionId || state.id || this.sessionId
    if (state.messages) this.state.messages = state.messages
    if (state.systemPrompt !== undefined) this.state.systemPrompt = state.systemPrompt
    if (state.model) this.state.model = state.model
    if (state.thinkingLevel) {
      this.syncingThinkingLevel = true
      this.state.thinkingLevel = state.thinkingLevel
      this.syncingThinkingLevel = false
    }
    if (state.tools) this.state.tools = state.tools
    if (state.isStreaming !== undefined) this.state.isStreaming = Boolean(state.isStreaming)
    if (state.errorMessage !== undefined) this.state.errorMessage = state.errorMessage
  }

  private emit(event: AgentEvent) {
    for (const listener of this.listeners) {
      try { listener(event) } catch { /* ignore */ }
    }
  }
}
