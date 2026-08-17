import type { AgentEvent, AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/compat'
import type { AgentAccessMode, AgentHarness } from '@/lib/types'
import { agentAccessModeFromYoloMode, agentAccessModeToYoloMode, normalizeAgentAccessMode } from '@/lib/types'
import { t, type AppTextKey } from '@/lib/i18n'
import { logger } from '@/lib/logger'
import { modelReferenceFromModel } from './model-reference'
import { isManagedQuickForgeCloudModel } from '@/lib/managed-cloud-model'
import { randomId } from '@/lib/random-id'
import { toolStartEventWithPartialResult, upsertMessage, upsertToolResult, type ToolExecutionEvent } from '@/lib/tool-execution-events'
import { getCachedToolDisplaySettings } from '@/lib/tool-display-settings'
import { SubagentRunEventPublisher } from '@/lib/subagent-run-detail'

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
const STATUS_REQUEST_TIMEOUT_MS = 10000
const STATE_REQUEST_TIMEOUT_MS = 30000

const SERVER_ERROR_TRANSLATIONS: Partial<Record<string, AppTextKey>> = {
  GENERATION_ALREADY_RUNNING: 'generationAlreadyRunning',
  GENERATION_STILL_RUNNING_BEFORE_ROLLBACK: 'generationStillRunning',
}

type ServerErrorPayload = {
  error?: string
  code?: string
}

function serverErrorMessage(payload: ServerErrorPayload | null, fallback: string): string {
  const translationKey = payload?.code ? SERVER_ERROR_TRANSLATIONS[payload.code] : undefined
  return translationKey ? t(translationKey) : payload?.error || fallback
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number, init: RequestInit = {}): Promise<{ response: Response; body?: T }> {
  const controller = new AbortController()
  const externalSignal = init.signal
  const abortFromExternal = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) abortFromExternal()
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const body = await response.json().catch(() => undefined) as T | undefined
    return { response, body }
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', abortFromExternal)
  }
}

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
      'error', 'session_created', 'title_updated', 'session_forked', 'scheduled_task_notification', 'scheduled_task_started',
      'tool_approval_required', 'auto_compact_threshold_reached', 'auto_compact_approval_required', 'auto_compact_completed', 'auto_compact_failed', 'messages_replaced',
      'acp_session_usage_update', 'acp_session_update',
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

// 合并同一 baseUrl 在短时间窗口内的并发轮询请求（in-flight 去抖）。
// 仅合并并发、不缓存结果数据：窗口外或请求完成后下次调用重新请求，
// 保证侧边栏状态始终尽量实时。
const ACTIVE_AGENT_STATUS_DEDUPE_MS = 200

let activeAgentStatusInflight: {
  baseUrl: string
  startedAt: number
  promise: Promise<ActiveAgentStatus[]>
} | null = null

export function fetchActiveAgentStatuses(baseUrl = ''): Promise<ActiveAgentStatus[]> {
  const now = Date.now()
  const inflight = activeAgentStatusInflight
  if (inflight && inflight.baseUrl === baseUrl && now - inflight.startedAt < ACTIVE_AGENT_STATUS_DEDUPE_MS) {
    return inflight.promise
  }

  const promise = (async (): Promise<ActiveAgentStatus[]> => {
    const res = await fetch(`${baseUrl}/api/agents`, { cache: 'no-store' })
    if (!res.ok) return []
    const payload = await res.json().catch(() => null) as { sessions?: ActiveAgentStatus[] } | null
    return Array.isArray(payload?.sessions) ? payload.sessions : []
  })()

  activeAgentStatusInflight = { baseUrl, startedAt: now, promise }
  void promise.finally(() => {
    if (activeAgentStatusInflight?.promise === promise) activeAgentStatusInflight = null
  })
  return promise
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

export type ServerAgentPendingToolApproval = {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  source?: {
    type?: string
    subagent?: string
    label?: string
    sessionId?: string
  }
  requestedAt?: number
  expiresAt?: number
}

export type ServerAgentPendingAutoCompactApproval = {
  approvalId: string
  usage?: { percent?: number }
  thresholdPercent?: number
  keepRecentTurns?: number
  requestedAt?: number
  expiresAt?: number
}

export type OpenCodeAcpConfigSelectOption = {
  value: string
  name: string
  description?: string
}

export type OpenCodeAcpConfigOption = {
  id: string
  name: string
  description?: string
  category?: string
  type: 'boolean' | 'select'
  currentValue: boolean | string
  /** Select values; grouped entries keep `options` and a `group` label. */
  options?: Array<OpenCodeAcpConfigSelectOption | { group: string; name: string; options: OpenCodeAcpConfigSelectOption[] }>
}

export type OpenCodeAcpMode = {
  id: string
  name: string
  description?: string
}

export type OpenCodeAcpUsage = {
  used: number
  size: number
  cost?: { amount: number; currency: string } | null
}

export type OpenCodeAcpSession = {
  configOptions: OpenCodeAcpConfigOption[]
  modes: { currentModeId: string; availableModes: OpenCodeAcpMode[] } | null
  availableCommands: Array<{ name: string; description: string; input?: { hint?: string } }>
  sessionInfo: Record<string, unknown>
  usage: OpenCodeAcpUsage | null
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
    harness?: AgentHarness
    harnessSessionId?: string
    yoloMode?: boolean
    isStreaming?: boolean
    pendingToolCalls?: string[]
    errorMessage?: string
    contextCompaction?: ServerAgentContextCompaction | null
    contextUsage?: ServerAgentContextUsage | null
    pendingToolApproval?: ServerAgentPendingToolApproval | null
    pendingAutoCompactApproval?: ServerAgentPendingAutoCompactApproval | null
    acpSession?: OpenCodeAcpSession | null
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

export type ServerAgentStateSnapshot = {
  sessionId?: string
  scope?: 'global' | 'project'
  projectId?: string | null
  source?: 'acp'
  channelId?: string
  channelName?: string
  title?: string
  createdAt?: string
  status?: string
  startedAt?: string | null
  finishedAt?: string | null
  stateVersion?: number
  messageStorage?: 'split'
  messages?: AgentMessage[]
  /** Lightweight summary replacing `messages` on split-session state frames. */
  messagesSummary?: { count?: number }
  systemPrompt?: string
  model?: Model<Api>
  thinkingLevel?: ThinkingLevel
  accessMode?: AgentAccessMode
  harness?: AgentHarness
  harnessSessionId?: string
  yoloMode?: boolean
  tools?: unknown[]
  contextCompaction?: ServerAgentContextCompaction | null
  contextUsage?: ServerAgentContextUsage | null
  pendingToolApproval?: ServerAgentPendingToolApproval | null
  pendingAutoCompactApproval?: ServerAgentPendingAutoCompactApproval | null
  pendingToolCalls?: string[]
  isStreaming?: boolean
  errorMessage?: string
  acpSession?: OpenCodeAcpSession | null
}

// ---------------------------------------------------------------------------
// Split-session message reconciliation
// ---------------------------------------------------------------------------

function sameMessageShape(left: AgentMessage | undefined, right: AgentMessage): boolean {
  if (!left) return false
  const leftId = (left as { id?: unknown }).id
  const rightId = (right as { id?: unknown }).id
  if (typeof leftId === 'string' && typeof rightId === 'string' && leftId === rightId) return true
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Merge an incremental tail (`messages` starting at index `after`) into the
 * local message list. Overlapping positions keep the server's version only
 * when the content actually differs (same-position edits); identical messages
 * (e.g. already applied via a message_end upsert) are skipped. This is the
 * split-session counterpart of the legacy whole-array replacement.
 */
export function mergeIncrementalMessages(current: AgentMessage[], after: number, tail: AgentMessage[]): AgentMessage[] {
  const result = current.slice()
  const start = Math.max(0, Math.min(after, result.length))
  for (let index = 0; index < tail.length; index += 1) {
    const position = start + index
    const message = tail[index]
    if (position < result.length) {
      if (sameMessageShape(result[position], message)) continue
      result[position] = message
    } else {
      result.push(message)
    }
  }
  return result
}

type SessionMessagesPage = { messages: AgentMessage[]; count: number; hasMore: boolean }

async function fetchSessionMessagesPage(baseUrl: string, sessionId: string, after: number): Promise<SessionMessagesPage | null> {
  const url = `${baseUrl}/api/agents/${encodeURIComponent(sessionId)}/messages?after=${after}`
  const { response, body } = await fetchJsonWithTimeout<{ messages?: AgentMessage[]; count?: number; hasMore?: boolean }>(url, STATE_REQUEST_TIMEOUT_MS)
  if (!response.ok) return null
  return { messages: body?.messages ?? [], count: body?.count ?? after, hasMore: Boolean(body?.hasMore) }
}

async function fetchAllSessionMessages(baseUrl: string, sessionId: string): Promise<AgentMessage[]> {
  const all: AgentMessage[] = []
  let after = 0
  for (let guard = 0; guard < 128; guard += 1) {
    const page = await fetchSessionMessagesPage(baseUrl, sessionId, after)
    if (!page) break
    all.push(...page.messages)
    if (!page.hasMore || page.messages.length === 0) break
    after += page.messages.length
  }
  return all
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
    harness: AgentHarness
    yoloMode: boolean
    isStreaming: boolean
    streamingMessage?: AgentMessage
    pendingToolCalls: Set<string>
    errorMessage?: string
    contextCompaction?: ServerAgentContextCompaction | null
    contextUsage?: ServerAgentContextUsage | null
    pendingToolApproval?: ServerAgentPendingToolApproval | null
    pendingAutoCompactApproval?: ServerAgentPendingAutoCompactApproval | null
    acpSession?: OpenCodeAcpSession | null
  }
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
  readonly harness: AgentHarness
  readonly harnessSessionId?: string
  private onPlanModeConsumed?: () => void

  /**
   * tool_execution_start/update/end SSE 事件 → subagentRunStore 的实时发布器：
   * 按 toolCallId 缓存 run_subagent 的 args/toolName，start/update/end 每次发布最新
   * 载荷到 subagentRunStore（与 local-tools 的聊天渲染回填解耦），end 后清理缓存。
   */
  private readonly subagentRunPublisher = new SubagentRunEventPublisher({
    t,
    getToolDisplayMode: () => getCachedToolDisplaySettings().toolDisplayMode,
  })

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
    this.harness = init.harness ?? 'quickforge'
    this.harnessSessionId = init.harnessSessionId
    this.lastServerStateVersion = typeof init.stateVersion === 'number' ? init.stateVersion : 0

    const rawState = {
      systemPrompt: init.systemPrompt ?? '',
      model: init.model ?? null as unknown as Model<Api>,
      thinkingLevel: (init.thinkingLevel ?? 'off') as ThinkingLevel,
      messages: init.messages?.slice() ?? [],
      tools: init.tools ?? [],
      accessMode: normalizeAgentAccessMode(init.accessMode, agentAccessModeFromYoloMode(init.yoloMode)),
      harness: init.harness ?? 'quickforge',
      yoloMode: agentAccessModeToYoloMode(normalizeAgentAccessMode(init.accessMode, agentAccessModeFromYoloMode(init.yoloMode))),
      isStreaming: init.isStreaming ?? false,
      streamingMessage: undefined as AgentMessage | undefined,
      pendingToolCalls: new Set(init.pendingToolCalls ?? []),
      errorMessage: init.errorMessage as string | undefined,
      contextCompaction: init.contextCompaction ?? null,
      contextUsage: init.contextUsage ?? null,
      pendingToolApproval: init.pendingToolApproval ?? null,
      pendingAutoCompactApproval: init.pendingAutoCompactApproval ?? null,
      acpSession: init.acpSession ?? null,
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

    if (this.state.isStreaming) {
      logger.warn('Ignored prompt while agent is already streaming')
      return
    }

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

    const metadata = message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
      ? message.metadata as Record<string, unknown>
      : {}
    if (isManagedQuickForgeCloudModel(this.state.model)
      && (typeof metadata.quickforgeClientMessageId !== 'string' || !metadata.quickforgeClientMessageId)) {
      message = {
        ...message,
        metadata: {
          ...metadata,
          quickforgeClientMessageId: `qfcm_${randomId()}`,
        },
      }
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

    const msgCountBeforeOptimistic = this.state.messages.length

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
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/prompt`
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: agentMessage, selectedCapabilities, command: selectedCommand }),
      signal: controller.signal,
    }).then(async (response) => {
      clearTimeout(timeoutId)
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as ServerErrorPayload | null
        throw new Error(serverErrorMessage(payload, `Failed to send prompt: HTTP ${response.status}`))
      }
    }).catch((err) => {
      clearTimeout(timeoutId)
      const message = err instanceof Error ? err.message : String(err)
      logger.error('Failed to send prompt:', err)
      // Roll back the optimistic message so the UI doesn't show a message
      // that was never received by the server.
      if (this.state.messages.length === msgCountBeforeOptimistic + 1 && this.state.messages[this.state.messages.length - 1] === agentMessage) {
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
    this.state.pendingToolApproval = null
    this.state.pendingAutoCompactApproval = null
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
    const previousModel = this.state.model
    this.state.model = model
    this.state.contextUsage = null
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/model`
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelRef: modelReferenceFromModel(model), model }),
      })
      const payload = await response.json().catch(() => null) as { model?: Model<Api>; error?: string } | null
      if (!response.ok) throw new Error(payload?.error || `Failed to sync model update: HTTP ${response.status}`)
      if (payload?.model) this.state.model = payload.model
    } catch (error) {
      this.state.model = previousModel
      logger.error('Failed to sync model update to server:', error)
      throw error
    }
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
    const payload = await res.json().catch(() => null) as (ServerRollbackResult & ServerErrorPayload) | null
    if (!res.ok) throw new Error(serverErrorMessage(payload, `Failed to roll back: HTTP ${res.status}`))
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
      const payload = await res.json().catch(() => null) as ServerErrorPayload | null
      throw new Error(serverErrorMessage(payload, `Failed to continue: HTTP ${res.status}`))
    }
    this.state.isStreaming = true
    this.state.errorMessage = undefined
    this.startStateWatchdog()
  }

  /**
   * Update an OpenCode harness config option (boolean toggle or select value).
   * The server is authoritative for the advertised options; on success the
   * response acpSession refreshes the local snapshot and listeners are notified
   * so the composer config menu re-renders.
   */
  async setConfigOption(configId: string, value: boolean | string): Promise<void> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/harness/config-option`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ configId, value }),
    })
    const payload = await res.json().catch(() => null) as { acpSession?: OpenCodeAcpSession; error?: string } | null
    if (!res.ok) throw new Error(payload?.error || `Failed to update OpenCode config option: HTTP ${res.status}`)
    if (payload?.acpSession) {
      this.state.acpSession = payload.acpSession
      this.emitToListeners({ type: 'acp_session_update', acpSession: payload.acpSession } as unknown as AgentEvent)
    }
  }

  /**
   * Switch the OpenCode harness mode (ACP `modes` radios).
   */
  async setMode(modeId: string): Promise<void> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/harness/mode`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modeId }),
    })
    const payload = await res.json().catch(() => null) as { acpSession?: OpenCodeAcpSession; error?: string } | null
    if (!res.ok) throw new Error(payload?.error || `Failed to update OpenCode mode: HTTP ${res.status}`)
    if (payload?.acpSession) {
      this.state.acpSession = payload.acpSession
      this.emitToListeners({ type: 'acp_session_update', acpSession: payload.acpSession } as unknown as AgentEvent)
    }
  }

  /**
   * Fork the entire current OpenCode session (ACP whole-session fork). The
   * server persists the new session and announces it through the existing
   * `session_forked` event, which the client uses to switch to the new session.
   */
  async forkSession(): Promise<{ sessionId: string; title?: string; createdAt?: string; scope?: string; projectId?: string | null }> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/fork`
    const res = await fetch(url, { method: 'POST' })
    const payload = await res.json().catch(() => null) as ({ sessionId?: string; error?: string } & ServerErrorPayload) | null
    if (!res.ok) throw new Error(payload?.error || `Failed to fork conversation: HTTP ${res.status}`)
    return payload as { sessionId: string; title?: string; createdAt?: string; scope?: string; projectId?: string | null }
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
    if (this.state.pendingToolApproval?.toolCallId === toolCallId) {
      this.state.pendingToolApproval = null
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
    if (this.state.pendingToolApproval?.toolCallId === toolCallId) {
      this.state.pendingToolApproval = null
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
    if (this.state.pendingAutoCompactApproval?.approvalId === approvalId) {
      this.state.pendingAutoCompactApproval = null
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
    if (this.state.pendingAutoCompactApproval?.approvalId === approvalId) {
      this.state.pendingAutoCompactApproval = null
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.statusPromise = null
    this.subagentRunPublisher.dispose()
    this.unsubscribeSse?.()
    this.unsubscribeSse = undefined
    this.listeners.clear()
  }

  // --- SSE event handling ---

  private handleSseEvent(event: Record<string, unknown>) {
    if (!this.noteSseEvent(event)) return
    const type = event.type as string

    switch (type) {
      case 'state': {
        // Initial state snapshot from server (e.g. after page refresh / SSE reconnect).
        // Guard against SSE reconnect overwriting client messages with a stale
        // server snapshot: only accept server messages if the client has none
        // (initial load) or if the server has at least as many messages.
        const s = event as { systemPrompt?: string; messages?: AgentMessage[]; messagesSummary?: { count?: number }; model?: Model<Api>; thinkingLevel?: ThinkingLevel; tools?: unknown[]; accessMode?: AgentAccessMode; yoloMode?: boolean; isStreaming?: boolean; status?: string; pendingToolCalls?: string[]; contextCompaction?: ServerAgentContextCompaction | null; contextUsage?: ServerAgentContextUsage | null; pendingToolApproval?: ServerAgentPendingToolApproval | null; pendingAutoCompactApproval?: ServerAgentPendingAutoCompactApproval | null; acpSession?: OpenCodeAcpSession | null }
        if (s.systemPrompt !== undefined) {
          this.state.systemPrompt = s.systemPrompt
        }
        if (s.messages && (s.messages.length > this.state.messages.length || (!this.state.isStreaming && s.messages.length === this.state.messages.length))) {
          this.state.messages = s.messages
          this.stateVersion++
        } else if (!s.messages && s.messagesSummary) {
          // Split session: state frames carry only a count summary; fetch and
          // merge the missing tail asynchronously.
          void this.reconcileMessagesFromSummary(s.messagesSummary)
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
        if (s.pendingToolApproval !== undefined) {
          this.state.pendingToolApproval = s.pendingToolApproval
        }
        if (s.pendingAutoCompactApproval !== undefined) {
          this.state.pendingAutoCompactApproval = s.pendingAutoCompactApproval
        }
        if (s.pendingToolCalls !== undefined) {
          this.state.pendingToolCalls = new Set(s.pendingToolCalls)
        }
        if (s.acpSession !== undefined) {
          this.state.acpSession = s.acpSession
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
        this.state.pendingToolApproval = null
        this.state.pendingAutoCompactApproval = null
        this.startStateWatchdog()
        break
      }

      case 'agent_end': {
        this.stopStateWatchdog()
        const endEvent = event as { messages?: AgentMessage[]; messagesAfter?: number; messagesIncremental?: boolean; messagesSummary?: { count?: number }; errorMessage?: string; contextUsage?: ServerAgentContextUsage | null }

        // The server normalizes pi-agent-core's agent_end payload to include
        // the authoritative full session history (non-split) or an incremental
        // tail + summary (split). Prefer that SSE payload to avoid an extra
        // /state request that would transfer the same long message list again.
        // If the event is missing messages or looks older than local state,
        // fall back to the full state fetch for safety.
        if (endEvent.messagesIncremental) {
          this.state.messages = mergeIncrementalMessages(
            this.state.messages,
            typeof endEvent.messagesAfter === 'number' ? endEvent.messagesAfter : this.state.messages.length,
            endEvent.messages ?? [],
          )
          this.state.contextUsage = endEvent.contextUsage !== undefined ? endEvent.contextUsage : null
          this.state.isStreaming = false
          this.state.streamingMessage = undefined
          this.state.pendingToolApproval = null
          this.state.pendingAutoCompactApproval = null
          if (endEvent.errorMessage) this.state.errorMessage = endEvent.errorMessage
          this.stateVersion++
          this.emitToListeners(event as unknown as AgentEvent)
          return
        }
        if (endEvent.messagesSummary && !Array.isArray(endEvent.messages)) {
          void this.reconcileMessagesFromSummary(endEvent.messagesSummary).finally(() => {
            this.state.isStreaming = false
            this.state.streamingMessage = undefined
            this.state.pendingToolApproval = null
            this.state.pendingAutoCompactApproval = null
            if (endEvent.errorMessage) this.state.errorMessage = endEvent.errorMessage
            this.emitToListeners(event as unknown as AgentEvent)
          })
          return
        }
        if (endEvent.messages && endEvent.messages.length >= this.state.messages.length) {
          this.state.messages = endEvent.messages
          this.state.contextUsage = endEvent.contextUsage !== undefined ? endEvent.contextUsage : null
          this.state.isStreaming = false
          this.state.streamingMessage = undefined
          this.state.pendingToolApproval = null
          this.state.pendingAutoCompactApproval = null
          if (endEvent.errorMessage) this.state.errorMessage = endEvent.errorMessage
          this.stateVersion++
          this.emitToListeners(event as unknown as AgentEvent)
          return
        }

        // Fallback for stale/malformed events or legacy servers.
        void this.refreshStateFromServer({ forceMessages: true }).finally(() => {
          this.state.isStreaming = false
          this.state.streamingMessage = undefined
          this.state.pendingToolApproval = null
          this.state.pendingAutoCompactApproval = null
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
        const msgEvent = event as { message?: AgentMessage; messages?: AgentMessage[]; messagesAfter?: number; messagesIncremental?: boolean; messagesSummary?: { count?: number }; contextUsage?: ServerAgentContextUsage | null }
        if (msgEvent.message) {
          this.state.messages = upsertMessage(this.state.messages, msgEvent.message)
          this.state.contextUsage = msgEvent.contextUsage !== undefined ? msgEvent.contextUsage : null
          this.stateVersion++
          this.emitToListeners(event as unknown as AgentEvent)
          return
        }
        if (msgEvent.messagesIncremental) {
          this.state.messages = mergeIncrementalMessages(
            this.state.messages,
            typeof msgEvent.messagesAfter === 'number' ? msgEvent.messagesAfter : this.state.messages.length,
            msgEvent.messages ?? [],
          )
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
        if (msgEvent.messagesSummary) {
          void this.reconcileMessagesFromSummary(msgEvent.messagesSummary).finally(() => {
            this.emitToListeners(event as unknown as AgentEvent)
          })
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
        const replacedEvent = event as { messages?: AgentMessage[]; messagesAfter?: number; messagesIncremental?: boolean; messagesSummary?: { count?: number }; contextCompaction?: ServerAgentContextCompaction | null; contextUsage?: ServerAgentContextUsage | null }
        if (replacedEvent.messagesIncremental) {
          // Split sessions normally emit a summary-only frame for replacements
          // (rollback/clear produce an empty tail); keep this branch for
          // forward compatibility with tail-carrying replacement frames.
          this.state.messages = mergeIncrementalMessages(
            this.state.messages,
            typeof replacedEvent.messagesAfter === 'number' ? replacedEvent.messagesAfter : this.state.messages.length,
            replacedEvent.messages ?? [],
          )
          this.state.streamingMessage = undefined
          this.stateVersion++
        } else if (replacedEvent.messagesSummary && !Array.isArray(replacedEvent.messages)) {
          // Split-session rollback/clear: the server truncated the history, so
          // refetch everything and replace the local list.
          void this.reconcileMessagesFromSummary(replacedEvent.messagesSummary)
        } else if (replacedEvent.messages) {
          this.state.messages = replacedEvent.messages
          this.state.streamingMessage = undefined
          this.stateVersion++
        }
        if (replacedEvent.contextCompaction !== undefined) {
          this.state.contextCompaction = replacedEvent.contextCompaction
        }
        if (replacedEvent.contextUsage !== undefined) {
          this.state.contextUsage = replacedEvent.contextUsage
        } else if (replacedEvent.messages || replacedEvent.messagesIncremental) {
          this.state.contextUsage = null
        }
        break
      }

      case 'error': {
        const errMsg = (event as { error?: string }).error
        this.state.errorMessage = errMsg || 'Unknown error'
        this.state.pendingToolApproval = null
        this.state.pendingAutoCompactApproval = null
        break
      }

      case 'title_updated': {
        // Title was updated by server AI generation — no state change needed
        break
      }

      case 'session_forked': {
        break
      }

      case 'acp_session_usage_update': {
        const usageEvent = event as { usage?: OpenCodeAcpUsage | null }
        if (usageEvent.usage !== undefined) {
          const next = this.state.acpSession
            ? { ...this.state.acpSession, usage: usageEvent.usage }
            : { configOptions: [], modes: null, availableCommands: [], sessionInfo: {}, usage: usageEvent.usage }
          this.state.acpSession = next
        }
        break
      }

      case 'acp_session_update': {
        const acpEvent = event as { acpSession?: OpenCodeAcpSession | null }
        if (acpEvent.acpSession) {
          this.state.acpSession = acpEvent.acpSession
        }
        break
      }

      case 'tool_execution_start': {
        const toolEvent = event as ToolExecutionEvent
        if (toolEvent.toolCallId) {
          this.state.messages = upsertToolResult(this.state.messages, toolStartEventWithPartialResult(toolEvent, this.sessionId), true)
          this.state.pendingToolCalls = new Set([...this.state.pendingToolCalls, toolEvent.toolCallId])
          this.stateVersion++
          this.subagentRunPublisher.handleToolStart(toolEvent)
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
        this.subagentRunPublisher.handleToolUpdate(toolEvent)
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
        this.subagentRunPublisher.handleToolEnd(toolEvent)
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
      case 'auto_compact_threshold_reached':
        // Forward as-is
        break

      case 'tool_approval_required': {
        const approvalEvent = event as unknown as ServerAgentPendingToolApproval
        if (typeof approvalEvent.toolCallId === 'string' && typeof approvalEvent.toolName === 'string') {
          this.state.pendingToolApproval = approvalEvent
          this.state.pendingAutoCompactApproval = null
        }
        break
      }

      case 'auto_compact_approval_required': {
        const approvalEvent = event as unknown as ServerAgentPendingAutoCompactApproval
        if (typeof approvalEvent.approvalId === 'string') {
          this.state.pendingAutoCompactApproval = approvalEvent
          this.state.pendingToolApproval = null
        }
        break
      }
    }

    // Forward event to subscribers
    this.emitToListeners(event as unknown as AgentEvent)
  }

  private emitToListeners(event: AgentEvent) {
    for (const listener of this.listeners) {
      try { listener(event) } catch { /* ignore */ }
    }
  }

  private noteSseEvent(event: Record<string, unknown>): boolean {
    this.lastSseEventAt = Date.now()
    const stateVersion = event.stateVersion
    if (typeof stateVersion === 'number' && Number.isFinite(stateVersion)) {
      if (stateVersion < this.lastServerStateVersion) return false
      this.lastServerStateVersion = stateVersion
    }
    return true
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
      const { response: res, body: status } = await fetchJsonWithTimeout<{
        stateVersion?: number
        isStreaming?: boolean
        status?: string
        errorMessage?: string
      }>(url, STATUS_REQUEST_TIMEOUT_MS)
      if (!res.ok) {
        if (res.status === 404 && this.state.isStreaming) {
          this.state.isStreaming = false
          this.stopStateWatchdog()
          this.emitToListeners({ type: 'agent_end', messages: this.state.messages } as AgentEvent)
        }
        return
      }

      const typedStatus = status ?? {}
      this.lastSseEventAt = Date.now()

      const serverStateVersion = typeof typedStatus.stateVersion === 'number' && Number.isFinite(typedStatus.stateVersion)
        ? typedStatus.stateVersion
        : this.lastServerStateVersion

      if (typedStatus.isStreaming === false) {
        const wasStreaming = this.state.isStreaming
        this.stopStateWatchdog()
        await this.refreshStateFromServer({ notify: true, forceMessages: true })
        // The lightweight status endpoint is authoritative for run completion.
        // If a stale/lower-version state snapshot was rejected, still clear the
        // optimistic streaming state so the UI cannot remain stuck loading.
        if (wasStreaming && this.state.isStreaming) {
          this.state.isStreaming = false
          this.state.streamingMessage = undefined
          this.state.pendingToolApproval = null
          this.state.pendingAutoCompactApproval = null
          this.emitToListeners({ type: 'agent_end', messages: this.state.messages } as AgentEvent)
        }
        return
      }

      if (typedStatus.isStreaming === true) {
        this.state.isStreaming = true
        this.state.errorMessage = typedStatus.errorMessage
      }

      if (serverStateVersion > this.lastServerStateVersion) {
        await this.refreshStateFromServer({ notify: true, forceMessages: true })
      }
    } catch {
      // Keep the watchdog alive; EventSource may recover on its own.
    }
  }

  async syncState(): Promise<void> {
    await this.refreshStateFromServer({ notify: true, forceMessages: true })
  }

  private async refreshStateFromServer(options?: { notify?: boolean; forceMessages?: boolean }) {
    // Deduplicate concurrent refresh requests
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this._doRefreshStateFromServer(options).finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  // --- Split-session message reconciliation ---

  private async fetchMessagesFromServer(after: number): Promise<SessionMessagesPage | null> {
    return fetchSessionMessagesPage(this.baseUrl, this.sessionId, after)
  }

  private async fetchAllMessagesFromServer(): Promise<AgentMessage[]> {
    return fetchAllSessionMessages(this.baseUrl, this.sessionId)
  }

  /**
   * Reconcile local messages against a `messagesSummary` (count) received in a
   * state frame for a split session. Snapshot-based staleness guard: any state
   * write that happens while the fetch is in flight (a concurrent SSE event
   * that already advanced this.stateVersion) discards the result — the newer
   * event is authoritative.
   */
  private async reconcileMessagesFromSummary(summary: { count?: number }): Promise<void> {
    const versionBefore = this.stateVersion
    const localCount = this.state.messages.length

    if (typeof summary.count === 'number' && summary.count < localCount) {
      // Server truncated below the local count (rollback/clear/compaction):
      // the incremental tail does not apply — refetch everything and replace.
      const all = await this.fetchAllMessagesFromServer()
      if (versionBefore !== this.stateVersion || all.length === 0) return
      this.state.messages = all
      this.state.contextUsage = null
      this.stateVersion++
      return
    }

    const after = localCount
    const page = await this.fetchMessagesFromServer(after)
    if (versionBefore !== this.stateVersion || !page) return
    if (page.count < after) {
      // Server has fewer messages than the client assumed (rollback without a
      // summary count update): full refetch replace.
      const all = await this.fetchAllMessagesFromServer()
      if (versionBefore !== this.stateVersion || all.length === 0) return
      this.state.messages = all
      this.state.contextUsage = null
      this.stateVersion++
      return
    }
    if (page.messages.length > 0) {
      this.state.messages = mergeIncrementalMessages(this.state.messages, after, page.messages)
      this.state.contextUsage = null
      this.stateVersion++
    }
  }

  private async _doRefreshStateFromServer(options?: { notify?: boolean; forceMessages?: boolean }) {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/state`
    try {
      // Snapshot the version before the async gap
      const versionBeforeFetch = this.stateVersion
      const { response: res, body } = await fetchJsonWithTimeout<ServerAgentStateSnapshot>(url, STATE_REQUEST_TIMEOUT_MS)
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
      const state = body ?? {}
      const serverStateVersion = typeof state.stateVersion === 'number' && Number.isFinite(state.stateVersion)
        ? state.stateVersion
        : undefined
      if (serverStateVersion !== undefined && serverStateVersion < this.lastServerStateVersion) {
        return
      }

      // Discard stale responses: if state was updated by an SSE event while
      // this fetch was in flight, the poll response is obsolete.
      if (versionBeforeFetch !== this.stateVersion) {
        return
      }
      if (serverStateVersion !== undefined) {
        this.lastServerStateVersion = serverStateVersion
      }

      const shouldReplaceMessages = Boolean(
        state.messages
        && (
          options?.forceMessages
          || state.messages.length > this.state.messages.length
          || (!this.state.isStreaming && state.messages.length === this.state.messages.length)
        ),
      )
      if (shouldReplaceMessages && state.messages) {
        this.state.messages = state.messages
        this.state.contextUsage = state.contextUsage !== undefined ? state.contextUsage : null
        this.stateVersion++
      } else if (!state.messages && state.messagesSummary) {
        // Split session: the state frame only carries a count summary. Fetch
        // and merge the missing tail (or refetch all when the server
        // truncated). The reconcile itself snapshots stateVersion before the
        // async gap, so concurrent SSE updates still win.
        await this.reconcileMessagesFromSummary(state.messagesSummary)
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
      if (state.pendingToolApproval !== undefined) {
        this.state.pendingToolApproval = state.pendingToolApproval
      }
      if (state.pendingAutoCompactApproval !== undefined) {
        this.state.pendingAutoCompactApproval = state.pendingAutoCompactApproval
      }
      if (state.pendingToolCalls !== undefined) {
        this.state.pendingToolCalls = new Set(state.pendingToolCalls)
      }
      if (state.acpSession !== undefined) {
        this.state.acpSession = state.acpSession
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
          this.state.pendingToolApproval = null
          this.state.pendingAutoCompactApproval = null
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

  // --- Static factories ---

  static async restore(
    sessionId: string,
    config: { baseUrl?: string; signal?: AbortSignal } = {},
  ): Promise<{ agent: ServerAgent; snapshot: ServerAgentStateSnapshot }> {
    const baseUrl = config.baseUrl ?? ''
    const startedAt = performance.now()
    const { response, body } = await fetchJsonWithTimeout<ServerAgentStateSnapshot & { error?: string }>(
      `${baseUrl}/api/agents/${encodeURIComponent(sessionId)}/restore`,
      STATE_REQUEST_TIMEOUT_MS,
      { method: 'POST', signal: config.signal },
    )
    if (!response.ok) {
      throw new Error(body?.error || `Failed to restore agent: HTTP ${response.status}`)
    }
    if (config.signal?.aborted) throw config.signal.reason ?? new DOMException('Aborted', 'AbortError')

    const snapshot = body ?? {}
    // Split sessions answer /restore with a lightweight summary instead of the
    // full message list; materialize the conversation through the paginated
    // messages channel so the restore frame itself stays small.
    if (!Array.isArray(snapshot.messages) && snapshot.messagesSummary) {
      snapshot.messages = await fetchAllSessionMessages(baseUrl, sessionId)
    }
    const agent = new ServerAgent({
      sessionId,
      baseUrl,
      initialState: {
        systemPrompt: snapshot.systemPrompt ?? '',
        model: snapshot.model ?? null as unknown as Model<Api>,
        thinkingLevel: snapshot.thinkingLevel ?? 'off',
        messages: snapshot.messages ?? [],
        tools: snapshot.tools ?? [],
        accessMode: normalizeAgentAccessMode(snapshot.accessMode, snapshot.yoloMode),
        harness: snapshot.harness ?? 'quickforge',
        harnessSessionId: snapshot.harnessSessionId,
        yoloMode: Boolean(snapshot.yoloMode),
        isStreaming: Boolean(snapshot.isStreaming),
        pendingToolCalls: snapshot.pendingToolCalls ?? [],
        errorMessage: snapshot.errorMessage,
        contextCompaction: snapshot.contextCompaction,
        contextUsage: snapshot.contextUsage,
        pendingToolApproval: snapshot.pendingToolApproval,
        pendingAutoCompactApproval: snapshot.pendingAutoCompactApproval,
        acpSession: snapshot.acpSession,
        stateVersion: snapshot.stateVersion,
      },
    })
    logger.debug('Restored ServerAgent', {
      sessionId,
      messageCount: snapshot.messages?.length ?? 0,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    })
    return { agent, snapshot }
  }

  static async create(
    sessionId: string,
    config: {
      scope?: 'global' | 'project'
      projectId?: string
      source?: 'acp'
      channelId?: string
      channelName?: string
      harness?: AgentHarness
      sourceHarnessSessionId?: string
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

    // Create agent on server. OpenCode owns its real model and credentials, so
    // the frontend-only placeholder must never cross this boundary.
    const usesOpenCode = config.harness === 'opencode'
    const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: config.scope ?? 'global',
        projectId: config.projectId,
        source: config.source,
        channelId: config.channelId,
        channelName: config.channelName,
        harness: config.harness,
        sourceHarnessSessionId: config.sourceHarnessSessionId,
        accessMode: config.accessMode,
        yoloMode: config.yoloMode ?? agentAccessModeToYoloMode(normalizeAgentAccessMode(config.accessMode)),
        modelRef: !usesOpenCode && config.model ? modelReferenceFromModel(config.model) : undefined,
        model: !usesOpenCode ? config.model : undefined,
        thinkingLevel: usesOpenCode ? undefined : config.thinkingLevel ?? 'off',
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
      const { response: stateRes, body } = await fetchJsonWithTimeout<Record<string, unknown>>(
        `${baseUrl}/api/agents/${encodeURIComponent(sessionId)}/state`,
        STATE_REQUEST_TIMEOUT_MS,
      )
      if (stateRes.ok) serverState = body ?? {}
    } catch { /* ignore */ }
    if (!Array.isArray(serverState.messages) && (serverState as { messagesSummary?: unknown }).messagesSummary) {
      serverState.messages = await fetchAllSessionMessages(baseUrl, sessionId)
    }

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
        harness: (serverState.harness ?? config.harness ?? 'quickforge') as AgentHarness,
        harnessSessionId: serverState.harnessSessionId as string | undefined,
        yoloMode: Boolean(serverState.yoloMode ?? config.yoloMode),
        isStreaming: Boolean(serverState.isStreaming),
        pendingToolCalls: (serverState.pendingToolCalls ?? []) as string[],
        errorMessage: serverState.errorMessage as string | undefined,
        contextCompaction: serverState.contextCompaction as ServerAgentContextCompaction | null | undefined,
        contextUsage: serverState.contextUsage as ServerAgentContextUsage | null | undefined,
        pendingToolApproval: serverState.pendingToolApproval as ServerAgentPendingToolApproval | null | undefined,
        pendingAutoCompactApproval: serverState.pendingAutoCompactApproval as ServerAgentPendingAutoCompactApproval | null | undefined,
        acpSession: serverState.acpSession as OpenCodeAcpSession | null | undefined,
        stateVersion: serverState.stateVersion as number | undefined,
      },
    })
  }
}
