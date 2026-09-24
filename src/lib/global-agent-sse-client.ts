import { fetchJsonWithTimeout } from './server-agent-http'
import type { SseConnectionStatus } from './server-agent-types'

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

// 重连期间对 /api/health 的后台探测超时：后端整体是否可达（unreachable）与 bootId（重启检测）。
const SSE_HEALTH_PROBE_TIMEOUT_MS = 5000

// 自动重连上限：超过后停止退避重试并通知 UI（用户仍可手动重试）。
// 例外：健康检查确认后端整体不可达（serverUnreachable）时不设上限，持续自动重试。
export const MAX_SSE_RECONNECT_ATTEMPTS = 10

class GlobalAgentSseClient {
  private eventSource: EventSource | null = null
  private handlersBySession = new Map<string, Set<SseHandler>>()
  private baseUrl = ''
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private reconnectAttempts = 0
  // 健康检查探测：后端整体不可达标志（true 时重连无上限）与最近一次已知 bootId 基线。
  private serverUnreachable = false
  private serverUnreachableSince: number | undefined
  private lastKnownBootId: string | undefined
  private healthProbeInFlight = false
  private connectionHandlers = new Set<(status: SseConnectionStatus) => void>()
  private lastConnectionStatus: SseConnectionStatus | null = null
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
      const recovered = this.reconnectAttempts > 0
      if (recovered) {
        this.reconnectAttempts = 0
        this.serverUnreachable = false
        this.serverUnreachableSince = undefined
        this.setConnectionStatus({ status: 'connected', recovered: true })
      }
      // 连上后取一次 bootId：与基线不同说明后端在断连期间重启过，补播 restarted 提示；
      // 首次连接（无基线）只记录基线。连上后到达的探测结果不影响 unreachable 语义。
      this.probeBootIdAfterConnect(recovered)
    }

    const eventTypes = [
      'state', 'agent_start', 'agent_end', 'message_start', 'message_end',
      'turn_start', 'turn_end', 'message_update',
      'tool_execution_start', 'tool_execution_update', 'tool_execution_end',
      'error', 'session_created', 'title_updated', 'session_forked', 'scheduled_task_notification', 'scheduled_task_started',
      'tool_approval_required', 'ask_user_required', 'ask_user_answered', 'auto_compact_threshold_reached', 'auto_compact_approval_required', 'auto_compact_completed', 'auto_compact_failed', 'messages_replaced',
      'persist_degraded', 'model_stream_retry', 'goal_updated', 'background_commands',
      'sessions-changed',
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
        // 直连后端失败切换到同源代理属于即时恢复，计一次尝试但不进入倒计时。
        this.noteReconnectAttempt(0)
        this.connect()
        return
      }

      this.scheduleReconnect()
    }
  }

  /** 记录一次重连尝试；超过上限时通知失败并停止自动重试。
   *  例外：健康检查确认后端整体不可达（serverUnreachable）时不设上限，
   *  持续退避重试（封顶 30s）直到后端恢复。 */
  private noteReconnectAttempt(waitMs: number): boolean {
    this.reconnectAttempts += 1
    if (this.reconnectAttempts > MAX_SSE_RECONNECT_ATTEMPTS && !this.serverUnreachable) {
      this.setConnectionStatus({ status: 'failed', maxAttempts: MAX_SSE_RECONNECT_ATTEMPTS })
      return false
    }
    this.setConnectionStatus({
      status: 'reconnecting',
      attempt: this.reconnectAttempts,
      maxAttempts: MAX_SSE_RECONNECT_ATTEMPTS,
      nextRetryAt: Date.now() + waitMs,
      ...this.unreachableStatusFields(),
    })
    return true
  }

  /** 不可达态在 reconnecting 广播上附加的增量字段（含不可达起始时刻）。 */
  private unreachableStatusFields(): { unreachable?: true; unreachableSince?: number } {
    if (!this.serverUnreachable) return {}
    return this.serverUnreachableSince === undefined
      ? { unreachable: true }
      : { unreachable: true, unreachableSince: this.serverUnreachableSince }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || (this.handlersBySession.size === 0 && this.globalHandlers.size === 0)) return
    if (!this.noteReconnectAttempt(this.reconnectDelay)) return
    // 进入重连流程后 fire-and-forget 探测一次 /api/health：后端不可达时 UI 切换提示并无上限重试。
    this.probeHealthInBackground()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.handlersBySession.size === 0 && this.globalHandlers.size === 0) return
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
      this.connect()
    }, this.reconnectDelay)
  }

  /** 探测 /api/health：后端整体是否可达（ok:true）及 bootId（重启检测）；异常/超时一律视为不可达。 */
  private async probeHealth(): Promise<{ reachable: boolean; bootId?: string }> {
    try {
      const { response, body } = await fetchJsonWithTimeout<{ ok?: boolean; bootId?: unknown }>(
        `${this.baseUrl}/api/health`,
        SSE_HEALTH_PROBE_TIMEOUT_MS,
        { cache: 'no-store' },
      )
      return {
        reachable: response.ok && body?.ok === true,
        bootId: typeof body?.bootId === 'string' ? body.bootId : undefined,
      }
    } catch {
      return { reachable: false }
    }
  }

  /** 重连期间的后台探测（single-flight：进行中就跳过）。 */
  private probeHealthInBackground(): void {
    if (this.healthProbeInFlight) return
    this.healthProbeInFlight = true
    void this.probeHealth().then(
      (result) => {
        this.healthProbeInFlight = false
        if (result.bootId) this.lastKnownBootId = result.bootId
        const current = this.lastConnectionStatus
        // 竞态防护：结果返回时已不在重连中（已连上/进入 failed/已断开）则只保留 bootId 更新。
        if (current?.status !== 'reconnecting') return
        const wasUnreachable = this.serverUnreachable
        this.serverUnreachable = !result.reachable
        if (this.serverUnreachable && !wasUnreachable) {
          this.serverUnreachableSince = Date.now()
        } else if (!this.serverUnreachable) {
          this.serverUnreachableSince = undefined
        }
        this.setConnectionStatus({
          status: 'reconnecting',
          attempt: current.attempt,
          maxAttempts: current.maxAttempts,
          nextRetryAt: current.nextRetryAt,
          ...this.unreachableStatusFields(),
        })
      },
      () => {
        // probeHealth 自带兜底 catch，这里仅防御性复位 single-flight 标志。
        this.healthProbeInFlight = false
      },
    )
  }

  /** 连上后的 bootId 探测：与已知基线不同则补播一次 restarted 提示（首次连接仅记录基线）。 */
  private probeBootIdAfterConnect(recovered: boolean): void {
    void this.probeHealth().then(
      (result) => {
        const bootId = result.bootId
        if (!bootId) return
        const previousBootId = this.lastKnownBootId
        this.lastKnownBootId = bootId
        if (recovered && previousBootId !== undefined && previousBootId !== bootId) {
          this.setConnectionStatus({ status: 'connected', recovered: true, restarted: true })
        }
      },
      () => {
        // 同上：probeHealth 不会 reject，仅防御。
      },
    )
  }

  private setConnectionStatus(status: SseConnectionStatus) {
    this.lastConnectionStatus = status
    for (const handler of this.connectionHandlers) {
      try { handler(status) } catch { /* ignore */ }
    }
  }

  subscribeConnectionState(handler: (status: SseConnectionStatus) => void): () => void {
    this.connectionHandlers.add(handler)
    return () => { this.connectionHandlers.delete(handler) }
  }

  getConnectionStatus(): SseConnectionStatus | null {
    return this.lastConnectionStatus
  }

  /** 手动重试：清掉退避状态立即重连（UI「立即重试」按钮）。 */
  retryNow(): void {
    this.disconnect()
    if (this.handlersBySession.size === 0 && this.globalHandlers.size === 0) return
    this.connect()
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
    this.reconnectAttempts = 0
    this.reconnectDelay = 1000
    this.serverUnreachable = false
    this.serverUnreachableSince = undefined
    this.lastConnectionStatus = null
  }
}

export const globalAgentSseClient = new GlobalAgentSseClient()

export function subscribeToAgentEvents(handler: SseHandler, baseUrl = ''): () => void {
  return globalAgentSseClient.subscribeAll(baseUrl, handler)
}

/** 订阅全局 Agent SSE 的连接状态（断连重试进度、成功恢复、重试上限）。 */
export function subscribeSseConnectionState(handler: (status: SseConnectionStatus) => void): () => void {
  return globalAgentSseClient.subscribeConnectionState(handler)
}

/** 当前连接状态快照；无连接活动时为 null。 */
export function getSseConnectionState(): SseConnectionStatus | null {
  return globalAgentSseClient.getConnectionStatus()
}

/** 用户手动触发立即重连（重置退避与计数）。 */
export function requestSseReconnectNow(): void {
  globalAgentSseClient.retryNow()
}
