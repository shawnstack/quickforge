import type { AgentEvent, AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai'
import type { AgentAccessMode } from '@/lib/types'
import { agentAccessModeFromYoloMode, agentAccessModeToYoloMode, normalizeAgentAccessMode } from '@/lib/types'
import { logger } from '@/lib/logger'
import { toolStartEventWithPartialResult, upsertMessage, upsertToolResult, type ToolExecutionEvent } from '@/lib/tool-execution-events'

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

const SSE_WATCHDOG_INTERVAL_MS = 5000
const SSE_SILENCE_RECOVERY_MS = 15000

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
      'tool_execution_start', 'tool_execution_update', 'tool_execution_end',
      'error', 'title_updated', 'session_forked', 'scheduled_task_notification', 'scheduled_task_started',
      'tool_approval_required', 'auto_compact_threshold_reached', 'auto_compact_approval_required', 'auto_compact_completed', 'auto_compact_failed', 'messages_replaced',
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
      if (this.handlersBySession.size === 0 && this.globalHandlers.size === 0) return
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

export type ServerAgentContextCompaction = {
  summaryMessage?: AgentMessage
  compactedUpToIndex?: number
  keepRecentTurns?: number
  compactedAt?: string
  usageBefore?: unknown
  thresholdPercent?: number
}

export type ServerAgentContextUsageBreakdown = {
  systemPromptTokens?: number
  messagesTokens?: number
  toolsTokens?: number
  reservedOutputTokens?: number
  providerUsageTokens?: number
  trailingTokens?: number
  lastUsageIndex?: number | null
  localEstimatedContextTokens?: number
}

export type ServerAgentContextUsage = {
  contextWindow: number
  inputTokens: number
  estimatedInputTokens: number
  knownInputTokens?: number
  providerContextTokens?: number
  inputTokenSource?: 'provider' | 'estimated' | 'mixed'
  reservedOutputTokens: number
  totalTokens: number
  percent: number
  isCompacted?: boolean
  compactedUpToIndex?: number
  originalMessageCount?: number
  effectiveMessageCount?: number
  breakdown?: ServerAgentContextUsageBreakdown
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
    accessMode?: AgentAccessMode
    yoloMode?: boolean
    isStreaming?: boolean
    errorMessage?: string
    contextCompaction?: ServerAgentContextCompaction | null
    contextUsage?: ServerAgentContextUsage | null
    stateVersion?: number
  }
}

export type ServerRollbackResult = {
  ok: boolean
  rollbackIndex: number
  session: {
    messages?: AgentMessage[]
    systemPrompt?: string
    model?: Model<Api>
    thinkingLevel?: ThinkingLevel
    tools?: unknown[]
    accessMode?: AgentAccessMode
    yoloMode?: boolean
    isStreaming?: boolean
    errorMessage?: string
    contextCompaction?: ServerAgentContextCompaction | null
    contextUsage?: ServerAgentContextUsage | null
  }
}

export type PromptCapabilitySelection = {
  type: 'plugin' | 'skill' | 'tool' | 'command'
  pluginName: string
  name: string
  label: string
  description?: string
}

export class ServerAgent {
  // --- Public state (mutable, AgentInterface-compatible) ---
  state: {
    systemPrompt: string
    model: Model<Api>
    thinkingLevel: ThinkingLevel
    messages: AgentMessage[]
    tools: unknown[]
    accessMode: AgentAccessMode
    yoloMode: boolean
    isStreaming: boolean
    streamingMessage?: AgentMessage
    pendingToolCalls: Set<string>
    errorMessage?: string
    contextCompaction?: ServerAgentContextCompaction | null
    contextUsage?: ServerAgentContextUsage | null
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
  private refreshPromise: Promise<void> | null = null
  private statusPromise: Promise<void> | null = null
  private lastSseEventAt = Date.now()
  private lastServerStateVersion = 0
  private nextPromptCapabilities: PromptCapabilitySelection[] = []
  private planMode = false
  private onPlanModeConsumed?: () => void

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
    this.lastServerStateVersion = typeof init.stateVersion === 'number' ? init.stateVersion : 0

    const rawState = {
      systemPrompt: init.systemPrompt ?? '',
      model: init.model ?? null as unknown as Model<Api>,
      thinkingLevel: (init.thinkingLevel ?? 'off') as ThinkingLevel,
      messages: init.messages?.slice() ?? [],
      tools: init.tools ?? [],
      accessMode: normalizeAgentAccessMode(init.accessMode, agentAccessModeFromYoloMode(init.yoloMode)),
      yoloMode: agentAccessModeToYoloMode(normalizeAgentAccessMode(init.accessMode, agentAccessModeFromYoloMode(init.yoloMode))),
      isStreaming: init.isStreaming ?? false,
      streamingMessage: undefined as AgentMessage | undefined,
      pendingToolCalls: new Set<string>(),
      errorMessage: init.errorMessage as string | undefined,
      contextCompaction: init.contextCompaction ?? null,
      contextUsage: init.contextUsage ?? null,
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
    if (this.state.isStreaming) this.startStateWatchdog()
  }

  // --- Agent-compatible interface ---

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  setNextPromptCapabilities(capabilities: PromptCapabilitySelection[]): void {
    this.nextPromptCapabilities = Array.isArray(capabilities) ? capabilities.slice(0, 4) : []
  }

  setPlanMode(mode: boolean, onConsumed?: () => void): void {
    this.planMode = mode
    this.onPlanModeConsumed = mode ? onConsumed : undefined
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

    const selectedCapabilities = this.nextPromptCapabilities
    const selectedCommand = this.planMode ? { type: 'plan' as const } : undefined
    this.nextPromptCapabilities = []
    if (this.planMode) {
      this.planMode = false
      const onConsumed = this.onPlanModeConsumed
      this.onPlanModeConsumed = undefined
      onConsumed?.()
    }

    // Add to local state immediately for optimistic UI
    const agentMessage = message as unknown as AgentMessage
    this.state.messages = [...this.state.messages, agentMessage]
    this.state.contextUsage = null
    this.emitToListeners({ type: 'message_start', message: agentMessage } as unknown as AgentEvent)

    if (!this.state.isStreaming) {
      this.state.isStreaming = true
      this.state.errorMessage = undefined
      this.emitToListeners({ type: 'agent_start' } as AgentEvent)
    }

    // Send to server (with timeout to avoid hanging indefinitely)
    const PROMPT_TIMEOUT_MS = 30_000
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS)
    const msgCountBeforeOptimistic = this.state.messages.length
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/prompt`
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: agentMessage, selectedCapabilities, command: selectedCommand }),
      signal: controller.signal,
    }).then((response) => {
      clearTimeout(timeoutId)
      if (!response.ok) throw new Error(`Failed to send prompt: HTTP ${response.status}`)
    }).catch((err) => {
      clearTimeout(timeoutId)
      const message = err instanceof Error ? err.message : String(err)
      logger.error('Failed to send prompt:', err)
      // Roll back the optimistic message so the UI doesn't show a message
      // that was never received by the server.
      if (this.state.messages.length === msgCountBeforeOptimistic + 1) {
        this.state.messages = this.state.messages.slice(0, -1)
      }
      this.state.errorMessage = message
      this.state.isStreaming = false
      this.state.streamingMessage = undefined
      this.stopStateWatchdog()
      this.emitToListeners({ type: 'error', error: message } as unknown as AgentEvent)
      this.emitToListeners({ type: 'agent_end', messages: this.state.messages } as AgentEvent)
    })
    this.startStateWatchdog()
  }

  abort(): void {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/abort`
    fetch(url, { method: 'POST' }).catch((err) => {
      logger.error('Failed to abort:', err)
    })
  }

  steer(message: AgentMessage): void {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/steer`
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    }).catch((err) => {
      logger.error('Failed to send steer:', err)
    })
  }

  followUp(message: AgentMessage): void {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/follow-up`
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    }).catch((err) => {
      logger.error('Failed to send follow-up:', err)
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
   * Sync an Agent access mode change to the server so current session tools match the UI selector.
   */
  async updateAccessMode(accessMode: AgentAccessMode): Promise<void> {
    const normalized = normalizeAgentAccessMode(accessMode)
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/access-mode`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessMode: normalized }),
    })
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(payload?.error || `Failed to sync Agent access mode: HTTP ${res.status}`)
    }
    this.state.accessMode = normalized
    this.state.yoloMode = agentAccessModeToYoloMode(normalized)
  }

  /**
   * Legacy compatibility for callers that still use the old YOLO boolean.
   */
  async updateYoloMode(yoloMode: boolean): Promise<void> {
    await this.updateAccessMode(yoloMode ? 'full-access' : 'default')
  }

  /**
   * Sync a model change to the server so the session persists the correct model.
   */
  async updateModel(model: Model<Api>): Promise<void> {
    this.state.model = model
    this.state.contextUsage = null
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/model`
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
    }).catch((err) => {
      logger.error('Failed to sync model update to server:', err)
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
      logger.error('Failed to sync thinking level update to server:', err)
    })
  }

  /**
   * Roll back from a message index on the authoritative server state.
   */
  async rollback(messageIndex: number): Promise<ServerRollbackResult> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/rollback`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageIndex }),
    })
    const payload = await res.json().catch(() => null) as (ServerRollbackResult & { error?: string }) | null
    if (!res.ok) throw new Error(payload?.error || `Failed to roll back: HTTP ${res.status}`)
    return payload as ServerRollbackResult
  }

  /**
   * Continue generation from the current last message (retry / regenerate).
   * The last message must be a user or tool-result message.
   */
  async continue(): Promise<void> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/continue`
    const res = await fetch(url, { method: 'POST' })
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(payload?.error || `Failed to continue: HTTP ${res.status}`)
    }
    this.state.isStreaming = true
    this.state.errorMessage = undefined
    this.startStateWatchdog()
  }

  /**
   * Approve a pending tool call so it can execute.
   */
  async approveToolCall(toolCallId: string): Promise<void> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/approve-tool`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toolCallId }),
    })
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(payload?.error || `Failed to approve tool call: HTTP ${res.status}`)
    }
  }

  /**
   * Reject a pending tool call, skipping its execution.
   */
  async rejectToolCall(toolCallId: string): Promise<void> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/reject-tool`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toolCallId }),
    })
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(payload?.error || `Failed to reject tool call: HTTP ${res.status}`)
    }
  }

  async approveAutoCompact(approvalId: string): Promise<void> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/approve-auto-compact`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approvalId }),
    })
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(payload?.error || `Failed to approve auto compact: HTTP ${res.status}`)
    }
  }

  async rejectAutoCompact(approvalId: string): Promise<void> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/reject-auto-compact`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approvalId }),
    })
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(payload?.error || `Failed to reject auto compact: HTTP ${res.status}`)
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.statusPromise = null
    this.unsubscribeSse?.()
    this.unsubscribeSse = undefined
    this.listeners.clear()
  }

  // --- SSE event handling ---

  private handleSseEvent(event: Record<string, unknown>) {
    this.noteSseEvent(event)
    const type = event.type as string

    switch (type) {
      case 'state': {
        // Initial state snapshot from server (e.g. after page refresh / SSE reconnect).
        // Guard against SSE reconnect overwriting client messages with a stale
        // server snapshot: only accept server messages if the client has none
        // (initial load) or if the server has at least as many messages.
        const s = event as { systemPrompt?: string; messages?: AgentMessage[]; model?: Model<Api>; thinkingLevel?: ThinkingLevel; tools?: unknown[]; accessMode?: AgentAccessMode; yoloMode?: boolean; isStreaming?: boolean; status?: string; contextCompaction?: ServerAgentContextCompaction | null; contextUsage?: ServerAgentContextUsage | null }
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
        if (s.accessMode !== undefined || s.yoloMode !== undefined) {
          const nextAccessMode = normalizeAgentAccessMode(s.accessMode, agentAccessModeFromYoloMode(s.yoloMode))
          this.state.accessMode = nextAccessMode
          this.state.yoloMode = agentAccessModeToYoloMode(nextAccessMode)
        }
        if (s.tools) {
          this.state.tools = s.tools
        }
        if (s.contextCompaction !== undefined) {
          this.state.contextCompaction = s.contextCompaction
        }
        if (s.contextUsage !== undefined) {
          this.state.contextUsage = s.contextUsage
        } else if (s.messages) {
          this.state.contextUsage = null
        }
        let wasStreaming = this.state.isStreaming
        if (s.isStreaming !== undefined) {
          wasStreaming = this.state.isStreaming
          this.state.isStreaming = s.isStreaming
          if (s.isStreaming) {
            this.startStateWatchdog()
          } else {
            this.stopStateWatchdog()
          }
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
        this.startStateWatchdog()
        break
      }

      case 'agent_end': {
        this.stopStateWatchdog()
        const endEvent = event as { messages?: AgentMessage[]; errorMessage?: string; contextUsage?: ServerAgentContextUsage | null }

        // The server normalizes pi-agent-core's agent_end payload to include
        // the authoritative full session history. Prefer that SSE payload to
        // avoid an extra /state request that would transfer the same long
        // message list again. If the event is missing messages or looks older
        // than local state, fall back to the full state fetch for safety.
        if (endEvent.messages && endEvent.messages.length >= this.state.messages.length) {
          this.state.messages = endEvent.messages
          this.state.contextUsage = endEvent.contextUsage !== undefined ? endEvent.contextUsage : null
          this.state.isStreaming = false
          this.state.streamingMessage = undefined
          if (endEvent.errorMessage) this.state.errorMessage = endEvent.errorMessage
          this.stateVersion++
          this.emitToListeners(event as unknown as AgentEvent)
          return
        }

        // Fallback for stale/malformed events or legacy servers.
        void this.refreshStateFromServer({ forceMessages: true }).finally(() => {
          this.state.isStreaming = false
          this.state.streamingMessage = undefined
          if (endEvent.errorMessage) this.state.errorMessage = endEvent.errorMessage
          this.emitToListeners(event as unknown as AgentEvent)
        })
        return
      }

      case 'message_end': {
        // Trust the SSE event data when it carries a finalized message. Tool
        // calls are executed after the assistant message_end event, so keeping
        // this message in local state lets pending run_command cards render
        // immediately instead of waiting for a full state refresh.
        const msgEvent = event as { message?: AgentMessage; messages?: AgentMessage[]; contextUsage?: ServerAgentContextUsage | null }
        if (msgEvent.message) {
          this.state.messages = upsertMessage(this.state.messages, msgEvent.message)
          this.state.contextUsage = msgEvent.contextUsage !== undefined ? msgEvent.contextUsage : null
          this.stateVersion++
          this.emitToListeners(event as unknown as AgentEvent)
          return
        }
        if (msgEvent.messages && msgEvent.messages.length >= this.state.messages.length) {
          this.state.messages = msgEvent.messages
          this.state.contextUsage = msgEvent.contextUsage !== undefined ? msgEvent.contextUsage : null
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

      case 'turn_end': {
        // turn_end carries the assistant message for this turn, but by this
        // point it is already in state and tool results may have followed it.
        // Do not upsert event.message here, otherwise it can duplicate the
        // assistant message after tool results.
        const msgEvent = event as { messages?: AgentMessage[]; contextUsage?: ServerAgentContextUsage | null }
        if (msgEvent.messages && msgEvent.messages.length >= this.state.messages.length) {
          this.state.messages = msgEvent.messages
          this.state.contextUsage = msgEvent.contextUsage !== undefined ? msgEvent.contextUsage : null
          this.stateVersion++
          this.emitToListeners(event as unknown as AgentEvent)
          return
        }
        void this.refreshStateFromServer().finally(() => {
          this.emitToListeners(event as unknown as AgentEvent)
        })
        return
      }

      case 'messages_replaced': {
        const replacedEvent = event as { messages?: AgentMessage[]; contextCompaction?: ServerAgentContextCompaction | null; contextUsage?: ServerAgentContextUsage | null }
        if (replacedEvent.messages) {
          this.state.messages = replacedEvent.messages
          this.state.streamingMessage = undefined
          this.stateVersion++
        }
        if (replacedEvent.contextCompaction !== undefined) {
          this.state.contextCompaction = replacedEvent.contextCompaction
        }
        if (replacedEvent.contextUsage !== undefined) {
          this.state.contextUsage = replacedEvent.contextUsage
        } else if (replacedEvent.messages) {
          this.state.contextUsage = null
        }
        break
      }

      case 'error': {
        this.stopStateWatchdog()
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

      case 'tool_execution_start': {
        const toolEvent = event as ToolExecutionEvent
        if (toolEvent.toolCallId) {
          this.state.messages = upsertToolResult(this.state.messages, toolStartEventWithPartialResult(toolEvent, this.sessionId), true)
          this.state.pendingToolCalls = new Set([...this.state.pendingToolCalls, toolEvent.toolCallId])
          this.stateVersion++
        }
        break
      }

      case 'tool_execution_update': {
        const toolEvent = event as ToolExecutionEvent
        this.state.messages = upsertToolResult(this.state.messages, toolEvent, true)
        if (toolEvent.toolCallId) {
          this.state.pendingToolCalls = new Set([...this.state.pendingToolCalls, toolEvent.toolCallId])
        }
        this.stateVersion++
        break
      }

      case 'tool_execution_end': {
        const toolEvent = event as ToolExecutionEvent
        this.state.messages = upsertToolResult(this.state.messages, toolEvent, false)
        if (toolEvent.toolCallId) {
          const pending = new Set(this.state.pendingToolCalls)
          pending.delete(toolEvent.toolCallId)
          this.state.pendingToolCalls = pending
        }
        this.stateVersion++
        break
      }

      case 'auto_compact_completed': {
        const compactEvent = event as { contextCompaction?: ServerAgentContextCompaction | null; contextUsage?: ServerAgentContextUsage | null }
        if (compactEvent.contextCompaction !== undefined) {
          this.state.contextCompaction = compactEvent.contextCompaction
        }
        if (compactEvent.contextUsage !== undefined) {
          this.state.contextUsage = compactEvent.contextUsage
        }
        break
      }

      case 'auto_compact_failed':
      case 'message_start':
      case 'message_update':
      case 'turn_start':
      case 'tool_approval_required':
      case 'auto_compact_threshold_reached':
      case 'auto_compact_approval_required':
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

  private noteSseEvent(event: Record<string, unknown>) {
    this.lastSseEventAt = Date.now()
    const stateVersion = event.stateVersion
    if (typeof stateVersion === 'number' && Number.isFinite(stateVersion)) {
      this.lastServerStateVersion = Math.max(this.lastServerStateVersion, stateVersion)
    }
  }

  private startStateWatchdog() {
    if (this.pollTimer || this.disposed) return
    this.lastSseEventAt = Date.now()
    this.pollTimer = setInterval(() => {
      if (this.disposed || !this.state.isStreaming) {
        this.stopStateWatchdog()
        return
      }

      if (Date.now() - this.lastSseEventAt < SSE_SILENCE_RECOVERY_MS) return
      void this.refreshStatusFromServer()
    }, SSE_WATCHDOG_INTERVAL_MS)
  }

  private stopStateWatchdog() {
    if (!this.pollTimer) return
    clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private async refreshStatusFromServer() {
    if (this.statusPromise) return this.statusPromise
    this.statusPromise = this._doRefreshStatusFromServer().finally(() => {
      this.statusPromise = null
    })
    return this.statusPromise
  }

  private async _doRefreshStatusFromServer() {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/status`
    try {
      const res = await fetch(url)
      if (!res.ok) {
        if (res.status === 404 && this.state.isStreaming) {
          this.state.isStreaming = false
          this.stopStateWatchdog()
          this.emitToListeners({ type: 'agent_end', messages: this.state.messages } as AgentEvent)
        }
        return
      }

      const status = await res.json() as {
        stateVersion?: number
        isStreaming?: boolean
        status?: string
        errorMessage?: string
      }
      this.lastSseEventAt = Date.now()

      const serverStateVersion = typeof status.stateVersion === 'number' && Number.isFinite(status.stateVersion)
        ? status.stateVersion
        : this.lastServerStateVersion

      if (status.isStreaming === false) {
        this.stopStateWatchdog()
        await this.refreshStateFromServer({ notify: true, forceMessages: true })
        return
      }

      if (status.isStreaming === true) {
        this.state.isStreaming = true
        this.state.errorMessage = status.errorMessage
      }

      if (serverStateVersion > this.lastServerStateVersion) {
        await this.refreshStateFromServer({ notify: true, forceMessages: true })
      }
    } catch {
      // Keep the watchdog alive; EventSource may recover on its own.
    }
  }

  private async refreshStateFromServer(options?: { notify?: boolean; forceMessages?: boolean }) {
    // Deduplicate concurrent refresh requests
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this._doRefreshStateFromServer(options).finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  private async _doRefreshStateFromServer(options?: { notify?: boolean; forceMessages?: boolean }) {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/state`
    try {
      // Snapshot the version before the async gap
      const versionBeforeFetch = this.stateVersion
      const res = await fetch(url)
      if (!res.ok) {
        // If the session no longer exists (e.g. destroyed by idle timeout),
        // stop streaming so the UI doesn't get stuck showing a Stop button.
        if (res.status === 404 && this.state.isStreaming) {
          this.state.isStreaming = false
          this.stopStateWatchdog()
          this.emitToListeners({ type: 'agent_end', messages: this.state.messages } as AgentEvent)
        }
        return
      }
      const state = await res.json()
      if (typeof state.stateVersion === 'number' && Number.isFinite(state.stateVersion)) {
        this.lastServerStateVersion = Math.max(this.lastServerStateVersion, state.stateVersion)
      }

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
        this.state.contextUsage = state.contextUsage !== undefined ? state.contextUsage : null
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
      if (state.accessMode !== undefined || state.yoloMode !== undefined) {
        const nextAccessMode = normalizeAgentAccessMode(state.accessMode, agentAccessModeFromYoloMode(state.yoloMode))
        this.state.accessMode = nextAccessMode
        this.state.yoloMode = agentAccessModeToYoloMode(nextAccessMode)
      }
      if (state.tools) {
        this.state.tools = state.tools
      }
      if (state.contextCompaction !== undefined) {
        this.state.contextCompaction = state.contextCompaction
      }
      if (state.contextUsage !== undefined) {
        this.state.contextUsage = state.contextUsage
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
          this.stopStateWatchdog()
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
      accessMode?: AgentAccessMode
      yoloMode?: boolean
      model?: Model<Api>
      thinkingLevel?: ThinkingLevel
      messages?: AgentMessage[]
      title?: string
      contextCompaction?: ServerAgentContextCompaction | null
      contextUsage?: ServerAgentContextUsage | null
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
        accessMode: config.accessMode,
        yoloMode: config.yoloMode ?? agentAccessModeToYoloMode(normalizeAgentAccessMode(config.accessMode)),
        model: config.model,
        thinkingLevel: config.thinkingLevel ?? 'off',
        messages: config.messages ?? [],
        title: config.title ?? 'New chat',
        contextCompaction: config.contextCompaction,
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
        tools: (serverState.tools ?? []) as unknown[],
        accessMode: normalizeAgentAccessMode(serverState.accessMode, config.accessMode ?? serverState.yoloMode ?? config.yoloMode),
        yoloMode: Boolean(serverState.yoloMode ?? config.yoloMode),
        isStreaming: Boolean(serverState.isStreaming),
        errorMessage: serverState.errorMessage as string | undefined,
        contextCompaction: serverState.contextCompaction as ServerAgentContextCompaction | null | undefined,
        contextUsage: serverState.contextUsage as ServerAgentContextUsage | null | undefined,
        stateVersion: serverState.stateVersion as number | undefined,
      },
    })
  }
}
