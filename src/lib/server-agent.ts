import type { AgentEvent, AgentMessage, ThinkingLevel } from '@mariozechner/pi-agent-core'
import type { Api, Model } from '@mariozechner/pi-ai'
import { streamSimple } from '@mariozechner/pi-ai'

// ---------------------------------------------------------------------------
// SSE client for receiving events from the server
// ---------------------------------------------------------------------------

// Resolve the direct backend URL for SSE connections.
// In dev mode the API server runs on a different port than Vite. By connecting
// SSE directly to the backend we avoid exhausting the browser's HTTP/1.1
// per-origin connection limit (6 in Chrome) through the Vite proxy.
declare const __QUICKFORGE_SERVER_PORT__: string | undefined

function getDirectBackendUrl(): string {
  // Vite replaces __QUICKFORGE_SERVER_PORT__ at build time via define in vite.config.ts
  const serverPort = typeof __QUICKFORGE_SERVER_PORT__ !== 'undefined' ? __QUICKFORGE_SERVER_PORT__ : ''
  if (serverPort && serverPort !== location.port) {
    return `${location.protocol}//127.0.0.1:${serverPort}`
  }
  return ''
}

type SseHandler = (event: Record<string, unknown>) => void

class GlobalAgentSseClient {
  private eventSource: EventSource | null = null
  private handlersBySession = new Map<string, Set<SseHandler>>()
  private baseUrl = ''
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private directBaseUrl = getDirectBackendUrl()
  private fallbackBaseUrl = ''

  subscribe(sessionId: string, baseUrl: string, handler: SseHandler): () => void {
    this.fallbackBaseUrl = baseUrl
    const nextBaseUrl = this.directBaseUrl || this.fallbackBaseUrl
    if (!this.eventSource || this.baseUrl !== nextBaseUrl) {
      this.disconnect()
      this.baseUrl = nextBaseUrl
      this.connect()
    }

    let handlers = this.handlersBySession.get(sessionId)
    if (!handlers) {
      handlers = new Set()
      this.handlersBySession.set(sessionId, handlers)
    }
    handlers.add(handler)

    return () => {
      const currentHandlers = this.handlersBySession.get(sessionId)
      currentHandlers?.delete(handler)
      if (currentHandlers?.size === 0) {
        this.handlersBySession.delete(sessionId)
      }
      if (this.handlersBySession.size === 0 && this.globalHandlers.size === 0) {
        this.disconnect()
      }
    }
  }

  private globalHandlers = new Set<SseHandler>()

  subscribeAll(baseUrl: string, handler: SseHandler): () => void {
    this.fallbackBaseUrl = baseUrl
    const nextBaseUrl = this.directBaseUrl || this.fallbackBaseUrl
    if (!this.eventSource || this.baseUrl !== nextBaseUrl) {
      this.disconnect()
      this.baseUrl = nextBaseUrl
      this.connect()
    }

    this.globalHandlers.add(handler)

    return () => {
      this.globalHandlers.delete(handler)
      if (this.handlersBySession.size === 0 && this.globalHandlers.size === 0) {
        this.disconnect()
      }
    }
  }

  private connect() {
    const url = `${this.baseUrl}/api/agents/events`
    this.eventSource = new EventSource(url)

    this.eventSource.onopen = () => {
      this.reconnectDelay = 1000
    }

    const eventTypes = [
      'state', 'agent_start', 'agent_end', 'message_start', 'message_end',
      'turn_start', 'turn_end', 'message_update',
      'tool_execution_start', 'tool_execution_end',
      'error', 'title_updated', 'session_forked', 'scheduled_task_notification', 'scheduled_task_started',
    ]

    const handleMessage = (eventType?: string) => (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as Record<string, unknown>
        const sessionId = data.sessionId as string | undefined
        if (!sessionId && eventType !== 'scheduled_task_notification') return
        const event = eventType ? { type: eventType, ...data } : data
        if (sessionId) this.emit(sessionId, event)
        else this.emitGlobal(event)
      } catch {
        // ignore
      }
    }

    this.eventSource.onmessage = handleMessage()
    for (const eventType of eventTypes) {
      this.eventSource.addEventListener(eventType, handleMessage(eventType))
    }

    this.eventSource.onerror = () => {
      this.eventSource?.close()
      this.eventSource = null

      if (this.baseUrl === this.directBaseUrl && this.fallbackBaseUrl !== this.directBaseUrl) {
        this.baseUrl = this.fallbackBaseUrl
        this.connect()
        return
      }

      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || (this.handlersBySession.size === 0 && this.globalHandlers.size === 0)) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
      this.connect()
    }, this.reconnectDelay)
  }

  private emitGlobal(event: Record<string, unknown>) {
    for (const handler of this.globalHandlers) {
      try { handler(event) } catch { /* ignore */ }
    }
  }

  private emit(sessionId: string, event: Record<string, unknown>) {
    this.emitGlobal(event)
    const handlers = this.handlersBySession.get(sessionId)
    if (!handlers) return
    for (const handler of handlers) {
      try { handler(event) } catch { /* ignore */ }
    }
  }

  private disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.eventSource?.close()
    this.eventSource = null
  }
}

const globalAgentSseClient = new GlobalAgentSseClient()

// ---------------------------------------------------------------------------
// Runtime status helpers for sidebar indicators
// ---------------------------------------------------------------------------

export type ActiveAgentStatus = {
  sessionId: string
  status: string
  title?: string
  scope?: string
}

export async function fetchActiveAgentStatuses(baseUrl = ''): Promise<ActiveAgentStatus[]> {
  const res = await fetch(`${baseUrl}/api/agents`, { cache: 'no-store' })
  if (!res.ok) return []
  const payload = await res.json().catch(() => null) as { sessions?: ActiveAgentStatus[] } | null
  return Array.isArray(payload?.sessions) ? payload.sessions : []
}

export function subscribeToAgentEvents(handler: SseHandler, baseUrl = ''): () => void {
  return globalAgentSseClient.subscribeAll(baseUrl, handler)
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
    isStreaming?: boolean
    errorMessage?: string
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
  private unsubscribeSse: (() => void) | undefined
  private baseUrl: string
  private disposed = false
  private _syncingThinkingLevel = false
  private pollTimer: ReturnType<typeof setInterval> | null = null

  /**
   * Monotonically increasing version counter for state writes.
   * Poll responses that carry an older version are discarded, preventing
   * stale data from overwriting fresher SSE-driven updates.
   */
  private stateVersion = 0

  constructor(config: ServerAgentConfig) {
    this.sessionId = config.sessionId
    this.baseUrl = config.baseUrl ?? ''

    const init = config.initialState ?? {}

    const rawState = {
      systemPrompt: init.systemPrompt ?? '',
      model: init.model ?? null as unknown as Model<Api>,
      thinkingLevel: (init.thinkingLevel ?? 'off') as ThinkingLevel,
      messages: init.messages?.slice() ?? [],
      tools: init.tools ?? [],
      isStreaming: init.isStreaming ?? false,
      streamingMessage: undefined as AgentMessage | undefined,
      pendingToolCalls: new Set<string>(),
      errorMessage: init.errorMessage as string | undefined,
    }

    // Proxy that auto-syncs thinkingLevel changes to the server
    this.state = new Proxy(rawState, {
      set: (target, prop, value) => {
        const oldValue = target[prop as keyof typeof target]
        ;(target as Record<string | symbol, unknown>)[prop] = value
        if (prop === 'thinkingLevel' && !this._syncingThinkingLevel && value !== oldValue) {
          this.updateThinkingLevel(value as ThinkingLevel)
        }
        return true
      },
    })

    this.unsubscribeSse = globalAgentSseClient.subscribe(this.sessionId, this.baseUrl, (event) => this.handleSseEvent(event))
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
    this.emitToListeners({ type: 'message_start', message: agentMessage } as unknown as AgentEvent)

    if (!this.state.isStreaming) {
      this.state.isStreaming = true
      this.state.errorMessage = undefined
      this.emitToListeners({ type: 'agent_start' } as AgentEvent)
    }

    // Send to server
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/prompt`
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: agentMessage }),
    }).then((response) => {
      if (!response.ok) throw new Error(`Failed to send prompt: HTTP ${response.status}`)
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to send prompt:', err)
      this.state.errorMessage = message
      this.state.isStreaming = false
      this.state.streamingMessage = undefined
      this.stopPollingState()
      this.emitToListeners({ type: 'error', error: message } as unknown as AgentEvent)
      this.emitToListeners({ type: 'agent_end', messages: this.state.messages } as AgentEvent)
    })
    this.startPollingState()
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

  /**
   * Sync a YOLO mode change to the server so current session tools match the UI toggle.
   */
  async updateYoloMode(yoloMode: boolean): Promise<void> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/yolo-mode`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ yoloMode }),
    })
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(payload?.error || `Failed to sync YOLO mode: HTTP ${res.status}`)
    }
  }

  /**
   * Sync a model change to the server so the session persists the correct model.
   */
  async updateModel(model: Model<Api>): Promise<void> {
    this.state.model = model
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/model`
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
    }).catch((err) => {
      console.error('Failed to sync model update to server:', err)
    })
  }

  /**
   * Sync a thinking level change to the server so the session persists the correct level.
   */
  async updateThinkingLevel(level: ThinkingLevel): Promise<void> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/thinking-level`
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ thinkingLevel: level }),
    }).catch((err) => {
      console.error('Failed to sync thinking level update to server:', err)
    })
  }

  dispose(): void {
    this.disposed = true
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.unsubscribeSse?.()
    this.unsubscribeSse = undefined
    this.listeners.clear()
  }

  // --- SSE event handling ---

  private handleSseEvent(event: Record<string, unknown>) {
    const type = event.type as string

    switch (type) {
      case 'state': {
        // Initial state snapshot from server (e.g. after page refresh / SSE reconnect).
        // Guard against SSE reconnect overwriting client messages with a stale
        // server snapshot: only accept server messages if the client has none
        // (initial load) or if the server has at least as many messages.
        const s = event as { systemPrompt?: string; messages?: AgentMessage[]; model?: Model<Api>; thinkingLevel?: ThinkingLevel; tools?: unknown[]; isStreaming?: boolean; status?: string }
        if (s.systemPrompt !== undefined) {
          this.state.systemPrompt = s.systemPrompt
        }
        if (s.messages && (s.messages.length > this.state.messages.length || (!this.state.isStreaming && s.messages.length === this.state.messages.length))) {
          this.state.messages = s.messages
          this.stateVersion++
        }
        if (s.model) {
          this.state.model = s.model
        }
        if (s.thinkingLevel) {
          this._syncingThinkingLevel = true
          this.state.thinkingLevel = s.thinkingLevel as ThinkingLevel
          this._syncingThinkingLevel = false
        }
        if (s.tools) {
          this.state.tools = s.tools
        }
        let wasStreaming = this.state.isStreaming
        if (s.isStreaming !== undefined) {
          wasStreaming = this.state.isStreaming
          this.state.isStreaming = s.isStreaming
          // SSE is alive — disable polling fallback if it was running
          this.stopPollingState()
        }
        // Emit the correct lifecycle event so the sidebar green dot stays in sync
        if (s.isStreaming) {
          this.state.errorMessage = undefined
          this.emitToListeners({ type: 'agent_start' } as AgentEvent)
        } else if (wasStreaming) {
          this.stateVersion++
          this.emitToListeners({ type: 'agent_end', messages: this.state.messages } as AgentEvent)
        }
        return
      }

      case 'agent_start': {
        this.state.isStreaming = true
        this.state.errorMessage = undefined
        break
      }

      case 'agent_end': {
        this.stopPollingState()
        const endEvent = event as { messages?: AgentMessage[]; errorMessage?: string }

        // The pi-agent-core agent loop emits agent_end with `messages` that
        // only contains messages generated during THIS run (newMessages), not
        // the complete session history.  Always fetch the authoritative full
        // state from the server to avoid overwriting and losing earlier messages.
        //
        // We clear streaming state only AFTER the fetch completes, so there is
        // no visual gap between the transient streaming message disappearing
        // and the finalized message appearing in the stable list.
        void this.refreshStateFromServer({ forceMessages: true }).finally(() => {
          this.state.isStreaming = false
          this.state.streamingMessage = undefined
          if (endEvent.errorMessage) this.state.errorMessage = endEvent.errorMessage
          this.emitToListeners(event as unknown as AgentEvent)
        })
        return
      }

      case 'message_end':
      case 'turn_end': {
        // Trust the SSE event data when it carries messages.  Only fall back
        // to a server refresh when no messages are present in the event — this
        // avoids the race where an in-flight poll response overwrites fresher
        // SSE-driven state.
        const msgEvent = event as { messages?: AgentMessage[] }
        if (msgEvent.messages && msgEvent.messages.length >= this.state.messages.length) {
          this.state.messages = msgEvent.messages
          this.stateVersion++
          this.emitToListeners(event as unknown as AgentEvent)
          return
        }
        // No messages in event — refresh from server as last resort
        void this.refreshStateFromServer().finally(() => {
          this.emitToListeners(event as unknown as AgentEvent)
        })
        return
      }

      case 'error': {
        this.stopPollingState()
        const errMsg = (event as { error?: string }).error
        this.state.errorMessage = errMsg || 'Unknown error'
        this.state.isStreaming = false
        break
      }

      case 'title_updated': {
        // Title was updated by server AI generation — no state change needed
        break
      }

      case 'session_forked': {
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

  private startPollingState() {
    if (this.pollTimer || this.disposed) return
    this.pollTimer = setInterval(() => {
      void this.refreshStateFromServer({ notify: true })
    }, 2000)
  }

  private stopPollingState() {
    if (!this.pollTimer) return
    clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private async refreshStateFromServer(options?: { notify?: boolean; forceMessages?: boolean }) {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/state`
    try {
      // Snapshot the version before the async gap
      const versionBeforeFetch = this.stateVersion
      const res = await fetch(url)
      if (!res.ok) return
      const state = await res.json()

      // Discard stale responses: if state was updated by an SSE event while
      // this fetch was in flight, the poll response is obsolete.
      if (!options?.forceMessages && versionBeforeFetch !== this.stateVersion) {
        return
      }

      const shouldReplaceMessages = Boolean(
        state.messages
        && (
          options?.forceMessages
          || state.messages.length > this.state.messages.length
          || (!this.state.isStreaming && state.messages.length === this.state.messages.length)
        ),
      )
      if (shouldReplaceMessages) {
        this.state.messages = state.messages
        this.stateVersion++
      }
      if (state.systemPrompt !== undefined) {
        this.state.systemPrompt = state.systemPrompt
      }
      if (state.model) {
        this.state.model = state.model
      }
      if (state.thinkingLevel) {
        this._syncingThinkingLevel = true
        this.state.thinkingLevel = state.thinkingLevel as ThinkingLevel
        this._syncingThinkingLevel = false
      }
      if (state.tools) {
        this.state.tools = state.tools
      }
      if (state.isStreaming !== undefined) {
        const wasStreaming = this.state.isStreaming
        this.state.isStreaming = Boolean(state.isStreaming)
        if (state.isStreaming) {
          this.state.errorMessage = undefined
          if (!wasStreaming) {
            this.emitToListeners({ type: 'agent_start' } as AgentEvent)
          }
        } else {
          this.stopPollingState()
        }
        if (options?.notify && wasStreaming && !state.isStreaming) {
          this.stateVersion++
          this.emitToListeners({ type: 'agent_end', messages: this.state.messages } as AgentEvent)
          return
        }
      }
      if (options?.notify) {
        if (state.isStreaming && shouldReplaceMessages) {
          const message = this.state.messages[this.state.messages.length - 1]
          if (message) {
            this.emitToListeners({ type: 'message_update', message } as unknown as AgentEvent)
          }
        } else if (!state.isStreaming) {
          this.emitToListeners({ type: 'message_end' } as unknown as AgentEvent)
        }
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
        systemPrompt: (serverState.systemPrompt ?? '') as string,
        model: (serverState.model ?? config.model ?? null) as Model<Api>,
        thinkingLevel: (serverState.thinkingLevel ?? config.thinkingLevel ?? 'off') as ThinkingLevel,
        messages: (serverState.messages ?? config.messages ?? []) as AgentMessage[],
        tools: [],
        isStreaming: Boolean(serverState.isStreaming),
        errorMessage: serverState.errorMessage as string | undefined,
      },
    })
  }
}
