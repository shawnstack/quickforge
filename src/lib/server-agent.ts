import type { AgentEvent, AgentMessage, ThinkingLevel } from '@mariozechner/pi-agent-core'
import type { Api, Model } from '@mariozechner/pi-ai'
import { streamSimple } from '@mariozechner/pi-ai'

// ---------------------------------------------------------------------------
// SSE client for receiving events from the server
// ---------------------------------------------------------------------------

class AgentSseClient {
  private eventSource: EventSource | null = null
  private handlers = new Set<(event: Record<string, unknown>) => void>()
  private sessionId: string
  private baseUrl: string
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private disposed = false

  constructor(sessionId: string, baseUrl = '') {
    this.sessionId = sessionId
    this.baseUrl = baseUrl
    this.connect()
  }

  private connect() {
    if (this.disposed) return

    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/stream`
    this.eventSource = new EventSource(url)

    this.eventSource.onopen = () => {
      this.reconnectDelay = 1000
    }

    this.eventSource.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        if (data?.type) {
          this.emit(data)
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Also listen for named events
    const eventTypes = [
      'state', 'agent_start', 'agent_end', 'message_start', 'message_end',
      'turn_start', 'turn_end', 'message_update',
      'tool_execution_start', 'tool_execution_end',
      'error', 'title_updated',
    ]
    for (const eventType of eventTypes) {
      this.eventSource.addEventListener(eventType, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data)
          this.emit({ type: eventType, ...data })
        } catch {
          // ignore
        }
      })
    }

    this.eventSource.onerror = () => {
      this.eventSource?.close()
      this.eventSource = null
      if (!this.disposed) {
        this.scheduleReconnect()
      }
    }
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
      this.connect()
    }, this.reconnectDelay)
  }

  private emit(event: Record<string, unknown>) {
    for (const handler of this.handlers) {
      try { handler(event) } catch { /* ignore */ }
    }
  }

  subscribe(handler: (event: Record<string, unknown>) => void): () => void {
    this.handlers.add(handler)
    return () => { this.handlers.delete(handler) }
  }

  dispose() {
    this.disposed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.eventSource?.close()
    this.eventSource = null
    this.handlers.clear()
  }
}

// ---------------------------------------------------------------------------
// ServerAgent - Agent-compatible proxy that delegates to the server
// ---------------------------------------------------------------------------

export type ServerAgentConfig = {
  sessionId: string
  baseUrl?: string
  initialState?: {
    systemPrompt?: string
    model?: Model<Api>
    thinkingLevel?: ThinkingLevel
    messages?: AgentMessage[]
    tools?: unknown[]
  }
}

export class ServerAgent {
  // --- Public state (mutable, AgentInterface-compatible) ---
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

  // --- AgentInterface expects these properties ---
  streamFn = streamSimple
  getApiKey?: (provider: string) => Promise<string | undefined>
  sessionId: string

  private listeners = new Set<(event: AgentEvent) => void>()
  private sseClient: AgentSseClient
  private baseUrl: string
  private disposed = false

  constructor(config: ServerAgentConfig) {
    this.sessionId = config.sessionId
    this.baseUrl = config.baseUrl ?? ''

    const init = config.initialState ?? {}

    this.state = {
      systemPrompt: init.systemPrompt ?? '',
      model: init.model ?? null as unknown as Model<Api>,
      thinkingLevel: (init.thinkingLevel ?? 'off') as ThinkingLevel,
      messages: init.messages?.slice() ?? [],
      tools: init.tools ?? [],
      isStreaming: false,
      streamingMessage: undefined,
      pendingToolCalls: new Set(),
      errorMessage: undefined,
    }

    this.sseClient = new AgentSseClient(this.sessionId, this.baseUrl)
    this.sseClient.subscribe((event) => this.handleSseEvent(event))
  }

  // --- Agent-compatible interface ---

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async prompt(input: string | AgentMessage | AgentMessage[]): Promise<void> {
    if (this.disposed) return

    // Normalize input to a message
    let message: Record<string, unknown>
    if (typeof input === 'string') {
      message = { role: 'user', content: input, timestamp: Date.now() }
    } else if (Array.isArray(input)) {
      const lastUser = [...input].reverse().find(
        (m: AgentMessage) => m.role === 'user' || m.role === 'user-with-attachments',
      )
      message = (lastUser ?? input[input.length - 1]) as unknown as Record<string, unknown>
    } else {
      message = input as unknown as Record<string, unknown>
    }

    // Add to local state immediately for optimistic UI
    const agentMessage = message as unknown as AgentMessage
    this.state.messages = [...this.state.messages, agentMessage]

    // Send to server
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/prompt`
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: agentMessage }),
    }).catch((err) => {
      console.error('Failed to send prompt:', err)
    })
  }

  abort(): void {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/abort`
    fetch(url, { method: 'POST' }).catch((err) => {
      console.error('Failed to abort:', err)
    })
  }

  steer(message: AgentMessage): void {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/steer`
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    }).catch((err) => {
      console.error('Failed to send steer:', err)
    })
  }

  followUp(message: AgentMessage): void {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/follow-up`
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    }).catch((err) => {
      console.error('Failed to send follow-up:', err)
    })
  }

  reset(): void {
    this.state.messages = []
    this.state.errorMessage = undefined
    this.state.isStreaming = false
    this.state.streamingMessage = undefined
    this.state.pendingToolCalls = new Set()
  }

  dispose(): void {
    this.disposed = true
    this.sseClient.dispose()
    this.listeners.clear()
  }

  // --- SSE event handling ---

  private handleSseEvent(event: Record<string, unknown>) {
    const type = event.type as string

    switch (type) {
      case 'state': {
        // Initial state snapshot from server
        const s = event as { messages?: AgentMessage[]; model?: Model<Api>; thinkingLevel?: ThinkingLevel }
        if (s.messages) {
          this.state.messages = s.messages
        }
        if (s.model) {
          this.state.model = s.model
        }
        if (s.thinkingLevel) {
          this.state.thinkingLevel = s.thinkingLevel as ThinkingLevel
        }
        // Emit as a synthetic agent_end to refresh UI
        this.emitToListeners({ type: 'agent_end', messages: this.state.messages } as AgentEvent)
        return
      }

      case 'agent_start': {
        this.state.isStreaming = true
        this.state.errorMessage = undefined
        break
      }

      case 'agent_end': {
        this.state.isStreaming = false
        this.state.streamingMessage = undefined
        const errMsg = (event as { errorMessage?: string }).errorMessage
        if (errMsg) this.state.errorMessage = errMsg
        break
      }

      case 'message_end':
      case 'turn_end': {
        // Refresh messages from server
        this.refreshStateFromServer()
        break
      }

      case 'error': {
        const errMsg = (event as { error?: string }).error
        this.state.errorMessage = errMsg || 'Unknown error'
        this.state.isStreaming = false
        break
      }

      case 'title_updated': {
        // Title was updated by server AI generation — no state change needed
        break
      }

      case 'message_start':
      case 'message_update':
      case 'turn_start':
      case 'tool_execution_start':
      case 'tool_execution_end':
        // Forward as-is
        break
    }

    // Forward event to subscribers
    this.emitToListeners(event as unknown as AgentEvent)
  }

  private emitToListeners(event: AgentEvent) {
    for (const listener of this.listeners) {
      try { listener(event) } catch { /* ignore */ }
    }
  }

  private async refreshStateFromServer() {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/state`
    try {
      const res = await fetch(url)
      if (!res.ok) return
      const state = await res.json()
      if (state.messages) {
        this.state.messages = state.messages
      }
      if (state.model) {
        this.state.model = state.model
      }
      if (state.thinkingLevel) {
        this.state.thinkingLevel = state.thinkingLevel as ThinkingLevel
      }
    } catch {
      // ignore
    }
  }

  // --- Static factory ---

  static async create(
    sessionId: string,
    config: {
      scope?: 'global' | 'project'
      projectId?: string
      yoloMode?: boolean
      model?: Model<Api>
      thinkingLevel?: ThinkingLevel
      messages?: AgentMessage[]
      title?: string
      baseUrl?: string
    } = {},
  ): Promise<ServerAgent> {
    const baseUrl = config.baseUrl ?? ''

    // Create agent on server
    const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: config.scope ?? 'global',
        projectId: config.projectId,
        yoloMode: config.yoloMode ?? false,
        model: config.model,
        thinkingLevel: config.thinkingLevel ?? 'off',
        messages: config.messages ?? [],
        title: config.title ?? 'New chat',
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to create agent' }))
      throw new Error(err.error || 'Failed to create agent')
    }

    // Fetch initial state
    let serverState: Record<string, unknown> = {}
    try {
      const stateRes = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(sessionId)}/state`)
      if (stateRes.ok) serverState = await stateRes.json()
    } catch { /* ignore */ }

    return new ServerAgent({
      sessionId,
      baseUrl,
      initialState: {
        systemPrompt: '',
        model: (serverState.model ?? config.model ?? null) as Model<Api>,
        thinkingLevel: (serverState.thinkingLevel ?? config.thinkingLevel ?? 'off') as ThinkingLevel,
        messages: (serverState.messages ?? config.messages ?? []) as AgentMessage[],
        tools: [],
      },
    })
  }
}
