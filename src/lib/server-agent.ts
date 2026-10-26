import type { AgentEvent, AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/compat'
import type { AgentAccessMode } from '@/lib/types'
import { agentAccessModeFromYoloMode, agentAccessModeToYoloMode, normalizeAgentAccessMode } from '@/lib/types'
import { normalizeGoalState, goalBudgetExtension, type GoalActionOptions, type GoalAction, type GoalState } from '@/lib/goal'
import { t, type AppTextKey } from '@/lib/i18n'
import { logger } from '@/lib/logger'
import { modelReferenceFromModel } from './model-reference'
import { toolStartEventWithPartialResult, toolCallIdsWithoutToolResult, upsertMessage, upsertToolResult, type ToolExecutionEvent } from '@/lib/tool-execution-events'
import { getCachedToolDisplaySettings } from '@/lib/tool-display-settings'
import {
  normalizeSelectedCapabilities,
  selectedCapabilitiesFromDetails,
  withSelectedCapabilitiesSnapshot,
} from '@/lib/selected-capabilities'
import { SubagentRunEventPublisher } from '@/lib/subagent-run-detail'
import { WorkflowAgentRunEventPublisher } from '@/lib/workflow-agent-run-events'
import {
  readSessionMessageSnapshot,
  resolveServerCacheKey,
  writeSessionMessageSnapshot,
  type SessionMessageSnapshotEntry,
} from '@/lib/session-message-cache'
import { fetchJsonWithTimeout } from './server-agent-http'
import { globalAgentSseClient } from './global-agent-sse-client'
import { GoalStateController } from './goal-state-controller'
import { leaseSnapshotFromWire, type SessionLeaseSnapshot } from './session-lease-client'
import { SessionLeaseController } from './session-lease-controller'
import type {
  ActiveAgentStatus,
  ServerAgentContextCompaction,
  ServerAgentContextUsage,
  ServerAgentPendingToolApproval,
  ServerAgentPendingAutoCompactApproval,
  ServerAgentPendingAsk,
  ServerAgentAskAnswer,
  ServerAgentConfig,
  ServerTurnRollbackPreview,
  ServerTurnRollbackResult,
  ServerRollbackResult,
  FileContextReference,
  PromptCapabilitySelection,
  BackgroundCommandSnapshot,
  GoalIterationMarkerSnapshot,
  ServerAgentStateSnapshot,
  ServerAgentEvent,
  ServerAgentLocalEvent,
  ServerAgentWireEvent,
} from './server-agent-types'

export {
  MAX_SSE_RECONNECT_ATTEMPTS,
  subscribeToAgentEvents,
  subscribeSseConnectionState,
  getSseConnectionState,
  requestSseReconnectNow,
} from './global-agent-sse-client'

export type {
  SseConnectionStatus,
  ActiveAgentStatus,
  ServerAgentContextCompaction,
  ServerAgentContextUsageBreakdown,
  ServerAgentContextUsage,
  ServerAgentPendingToolApproval,
  ServerAgentPendingAutoCompactApproval,
  ServerAgentPendingAsk,
  ServerAgentAskAnswer,
  ServerAgentConfig,
  ServerTurnRollbackPreview,
  ServerTurnRollbackResult,
  ServerRollbackResult,
  BackgroundCommandSnapshot,
  FileContextReference,
  PromptCapabilitySelection,
  ServerAgentStateSnapshot,
  ServerAgentEvent,
  ServerAgentLocalEvent,
  ServerAgentWireEvent,
} from './server-agent-types'

const SSE_WATCHDOG_INTERVAL_MS = 5000
const SSE_SILENCE_RECOVERY_MS = 15000
const STATUS_REQUEST_TIMEOUT_MS = 10000
const STATE_REQUEST_TIMEOUT_MS = 30000
/**
 * Split 会话拉尾恢复的退避重试表：SSE 断连窗口吞掉收尾帧（message_end /
 * agent_end）后，重连或 watchdog 触发的 /messages 拉尾若恰好瞬时失败
 * （网络仍抖动），不能让最终回答永久停留在服务端——按此表重试，耗尽即放弃
 * （后端不可达场景由 reconnect-notice 提示与 watchdog 后续轮询兜底）。
 */
const MESSAGE_RECONCILE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000]
// A goal action must never hang the card: bound it so a stuck request rejects
// (and the card's pending state is released) instead of waiting forever.
const GOAL_ACTION_TIMEOUT_MS = 30000

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

function assistantErrorMessage(errorMessage: string, model: Model<Api>): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: '' }],
    api: model?.api ?? 'openai-completions',
    provider: model?.provider ?? 'unknown',
    model: model?.id ?? 'unknown',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'error',
    errorMessage,
    timestamp: Date.now(),
  }
}

function appendAssistantErrorMessageOnce(
  messages: AgentMessage[],
  errorMessage: string,
  model: Model<Api>,
  failedPrompt?: AgentMessage,
): AgentMessage[] {
  const lastMessage = messages.at(-1)
  if (lastMessage?.role === 'assistant'
    && lastMessage.stopReason === 'error'
    && lastMessage.errorMessage === errorMessage) {
    return messages
  }
  const error = assistantErrorMessage(errorMessage, model)
  if (failedPrompt) {
    // 仅客户端可见：该错误由 prompt HTTP 失败合成，服务端从未收到这条消息，
    // retryFailedPrompt 依赖它原样重发（「继续」语义对它没有意义）。
    (error as unknown as Record<string, unknown>).quickforgeFailedPrompt = failedPrompt
  }
  return [...messages, error]
}

// ---------------------------------------------------------------------------
// Runtime status helpers for sidebar indicators
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ServerAgent - Agent-compatible proxy that delegates to the server
// ---------------------------------------------------------------------------

function isTurnRollbackPreview(value: unknown): value is ServerTurnRollbackPreview {
  if (!value || typeof value !== 'object') return false
  const preview = value as ServerTurnRollbackPreview
  return typeof preview.revision === 'string'
    && Array.isArray(preview.turnIds) && preview.turnIds.every((turnId) => typeof turnId === 'string')
    && Array.isArray(preview.files) && preview.files.every((file) => file
      && typeof file.path === 'string'
      && typeof file.safe === 'boolean'
      && (file.reason === null || typeof file.reason === 'string')
      && (file.action === 'restore' || file.action === 'delete'))
}

function isTurnRollbackResult(value: unknown): value is ServerTurnRollbackResult {
  if (!value || typeof value !== 'object') return false
  const result = value as ServerTurnRollbackResult
  return (result.status === 'completed' || result.status === 'partial')
    && Array.isArray(result.rolledBack) && result.rolledBack.every((file) => file
      && typeof file.path === 'string'
      && (file.action === 'restore' || file.action === 'delete'))
    && Array.isArray(result.conflicts) && result.conflicts.every((file) => file
      && typeof file.path === 'string'
      && (file.reason === null || typeof file.reason === 'string'))
}

/** 轮级回滚 API 错误：附 HTTP status（WorkspaceApiError 风格），供 UI 区分 409 等语义。 */
function turnRollbackApiError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number }
  error.status = status
  return error
}

/** Apply only to a verifiable identity at its original position, never clamp or append. */
function mergeGoalIterationMarkers(messages: AgentMessage[], markers: GoalIterationMarkerSnapshot[] | undefined, replay = false): AgentMessage[] {
  if (!Array.isArray(markers)) return messages
  let result = messages
  for (const entry of markers) {
    if (!entry || !Number.isInteger(entry.index) || entry.index < 0) continue
    const message = result[entry.index] as (AgentMessage & { id?: string; timestamp?: number; details?: Record<string, unknown> }) | undefined
    if (!message || message.role !== entry.role) continue
    const hasId = typeof entry.id === 'string' && entry.id.length > 0
    const hasTimestamp = typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)
    if ((!hasId && !hasTimestamp) || (hasId && message.id !== entry.id)
      || (hasTimestamp && message.timestamp !== entry.timestamp)) continue
    const marker = entry.quickforgeGoalIteration
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)
      || (marker.kind !== undefined && marker.kind !== 'planning' && marker.kind !== 'execution')) continue
    const currentMarker = message.details?.quickforgeGoalIteration as Record<string, unknown> | undefined
    // A later message may already carry newer metadata. During replay only
    // replace an existing marker when the snapshot proves it finished later.
    if (currentMarker && replay && !(typeof currentMarker.finishedAt === 'number' && typeof marker.finishedAt === 'number'
      && marker.finishedAt > currentMarker.finishedAt)) continue
    if (currentMarker && typeof currentMarker.finishedAt === 'number' && typeof marker.finishedAt === 'number'
      && currentMarker.finishedAt > marker.finishedAt) continue
    if (JSON.stringify(currentMarker) === JSON.stringify(marker)) continue
    if (result === messages) result = messages.slice()
    result[entry.index] = { ...message, details: { ...message.details, quickforgeGoalIteration: marker } } as AgentMessage
  }
  return result
}

// ---------------------------------------------------------------------------
// Session message cache helpers (read-only IndexedDB snapshot, F12)
// ---------------------------------------------------------------------------

/** SSE 事件类型：处理后需要调度一次会话消息快照缓存写入。 */
const MESSAGE_CACHE_EVENT_TYPES = new Set([
  // Full snapshots are needed only at message/turn/agent boundaries and when
  // the server replaces history. Streaming state/tool updates are deliberately
  // excluded: the live SSE state remains authoritative while a turn is active.
  // `goal_updated` is low-frequency (state transitions only, never a token
  // stream) and is included so a goal change is snapshotted for local recovery
  // as soon as it lands; the cache's stateVersion high-water guard still makes
  // the write a no-op when the server version has not advanced.
  'agent_end', 'message_end', 'turn_end', 'messages_replaced',
  'tool_execution_start', 'tool_execution_end', 'goal_updated',
])

type SessionMessageCacheSource = {
  stateVersion: number
  messages: AgentMessage[]
  /** 去掉 messages/messagesSummary 的快照（messages 由缓存条目单独承载）。 */
  snapshot: Record<string, unknown>
}

function snapshotForCache(source: Record<string, unknown>): SessionMessageCacheSource {
  const snapshot: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (key === 'messages' || key === 'messagesSummary') continue
    snapshot[key] = value
  }
  return {
    stateVersion: typeof snapshot.stateVersion === 'number' && Number.isFinite(snapshot.stateVersion)
      ? snapshot.stateVersion
      : 0,
    messages: Array.isArray(source.messages) ? source.messages as AgentMessage[] : [],
    snapshot,
  }
}

function initialStateFromSnapshot(snapshot: ServerAgentStateSnapshot): NonNullable<ServerAgentConfig['initialState']> {
  return {
    systemPrompt: snapshot.systemPrompt ?? '',
    model: snapshot.model ?? null as unknown as Model<Api>,
    thinkingLevel: snapshot.thinkingLevel ?? 'off',
    messages: snapshot.messages ?? [],
    tools: snapshot.tools ?? [],
    accessMode: normalizeAgentAccessMode(snapshot.accessMode, snapshot.yoloMode),
    yoloMode: Boolean(snapshot.yoloMode),
    isStreaming: Boolean(snapshot.isStreaming),
    pendingToolCalls: snapshot.pendingToolCalls ?? [],
    backgroundCommands: snapshot.backgroundCommands ?? [],
    errorMessage: snapshot.errorMessage,
    contextCompaction: snapshot.contextCompaction,
    contextUsage: snapshot.contextUsage,
    pendingToolApproval: snapshot.pendingToolApproval,
    pendingAutoCompactApproval: snapshot.pendingAutoCompactApproval,
    pendingAsk: snapshot.pendingAsk,
    persistDegraded: snapshot.persistDegraded === true ? true : undefined,
    sessionLease: snapshot.lease ? leaseSnapshotFromWire(snapshot.lease) : undefined,
    goal: normalizeGoalState(snapshot.goal),
    source: snapshot.source,
    stateVersion: snapshot.stateVersion,
  }
}

/** 缓存命中时优先用本地快照水合，再由 GET /state 后台校准。 */
function cachedSnapshotToStateSnapshot(cached: SessionMessageSnapshotEntry): ServerAgentStateSnapshot {
  return {
    ...cached.snapshot,
    messages: cached.messages as AgentMessage[],
    stateVersion: cached.stateVersion,
  } as ServerAgentStateSnapshot
}

// ---------------------------------------------------------------------------
// Split-session message reconciliation
// ---------------------------------------------------------------------------

function sameMessageShape(left: AgentMessage | undefined, right: AgentMessage): boolean {
  if (!left) return false
  // Identity alone is not enough: the final assistant can keep the streamed
  // message id while its text arrives later. Skipping that update hides the
  // summary until a full refresh replaces the list.
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

/**
 * Merge a server tail into a local list that starts at `windowOffset` in the
 * server's full message list (a read-only tail window, see `loadView`).
 *
 * `mergeIncrementalMessages` assumes the local list starts at server index 0.
 * A windowed list starts at `windowOffset`, so positions before that belong to
 * the omitted prefix and must be dropped — otherwise the tail is written into
 * the wrong slots and the visible conversation shifts.
 *
 * Deltas that start inside the window are applied at their window-relative
 * position; deltas that start before it are trimmed to the window start.
 */
export function mergeWindowedMessages(
  current: AgentMessage[],
  windowOffset: number,
  after: number,
  tail: AgentMessage[],
): AgentMessage[] {
  if (windowOffset <= 0) return mergeIncrementalMessages(current, after, tail)
  const skip = Math.max(0, windowOffset - after)
  if (skip >= tail.length) return current
  const relativeAfter = Math.max(0, after - windowOffset)
  return mergeIncrementalMessages(current, relativeAfter, skip > 0 ? tail.slice(skip) : tail)
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
    yoloMode: boolean
    isStreaming: boolean
    streamingMessage?: AgentMessage
    pendingToolCalls: Set<string>
    backgroundCommands: BackgroundCommandSnapshot[]
    errorMessage?: string
    contextCompaction?: ServerAgentContextCompaction | null
    contextUsage?: ServerAgentContextUsage | null
    pendingToolApproval?: ServerAgentPendingToolApproval | null
    pendingAutoCompactApproval?: ServerAgentPendingAutoCompactApproval | null
    pendingAsk?: ServerAgentPendingAsk | null
    persistDegraded?: boolean
    /**
     * 会话写入租约（见 `src/lib/session-lease-client.ts`）。`undefined` 表示
     * 本客户端未启用租约（只读视图/分享页/非浏览器调用方），此时沿用旧的
     * 单客户端行为；非 owner 时 composer 转为只读。
     */
    sessionLease?: SessionLeaseSnapshot
    goal?: GoalState | null
  }
  streamFn = streamSimple
  getApiKey?: (provider: string) => Promise<string | undefined>
  sessionId: string
  /**
   * Session source from the authoritative server snapshot. `'acp'` marks
   * OpenCode/ACP clients, where the server disables goal mode entirely
   * (`isGoalModeAvailable`); the card gate reads this instead of relying on
   * `readOnly`/capabilities alone.
   */
  sessionSource?: string

  // One identity-keyed collection preserves Set deduplication, insertion order,
  // live iteration and unsubscribe semantics across both subscription APIs.
  private listeners = new Map<
    ((event: AgentEvent) => void) | ((event: ServerAgentEvent) => void),
    (event: ServerAgentEvent) => void
  >()
  private unsubscribeSse: (() => void) | undefined
  private readonly sessionLeaseController: SessionLeaseController
  private baseUrl: string
  private disposed = false
  private _syncingThinkingLevel = false
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private refreshPromise: Promise<void> | null = null
  private statusPromise: Promise<void> | null = null
  /** 拉尾恢复的重试定时器：dispose 或任一次成功/版本接管后清理。 */
  private messageReconcileRetryTimer: ReturnType<typeof setTimeout> | null = null
  private lastSseEventAt = Date.now()
  private lastServerStateVersion = 0
  /**
   * 本地 `state.messages` 里第一条消息对应服务端全量列表的索引。
   *
   * 正常 restore/create 路径为 0（本地就是全量）。只读视图（`loadView`）返回的是
   * 尾部窗口，此时本地列表从 `summary.count - messages.length` 开始。增量对账
   * （`reconcileMessagesFromSummary`）里所有「本地条数 == 服务端索引」的假设都
   * 依赖这个偏移，必须显式记录，否则尾部窗口会话会拉错位置或判定为截断。
   */
  private messageWindowOffset = 0
  /**
   * Goal-specific change watermark, independent of the message `stateVersion`.
   * Every applied goal snapshot that actually changes the goal increments it, so
   * an async response (goal action / `/state`) captured before the request can
   * detect that a newer goal update superseded it — including cross-id
   * replacements and explicit `null` clears where revisions are meaningless.
   */
  private readonly goalStateController: GoalStateController
  private nextPromptCapabilities: PromptCapabilitySelection[] = []
  private nextPromptContextReferences: FileContextReference[] = []
  private onPromptContextReferencesConsumed?: () => void
  private planMode = false
  private onPlanModeConsumed?: () => void
  /** 最近一次已知会话元数据（title/scope/…），供缓存快照重建时保留。 */
  private sessionCacheMetadata: Record<string, unknown> = {}

  /**
   * tool_execution_start/update/end SSE 事件 → subagentRunStore 的实时发布器：
   * 按 toolCallId 缓存 run_subagent 的 args/toolName，start/update/end 每次发布最新
   * 载荷到 subagentRunStore（与 tool-renderers/subagent-tool-renderer 的聊天渲染回填解耦），end 后清理缓存。
   */
  private readonly subagentRunPublisher = new SubagentRunEventPublisher({
    t,
    getToolDisplayMode: () => getCachedToolDisplaySettings().toolDisplayMode,
  })

  /**
   * run_workflow SSE → subagentRunStore 的实时发布器：把 details.agents 中每个
   * agent 的 subagentRun 按 `${workflowRunId}:agent:${id}` 发布，使 Inspector 中
   * workflow agent 详情与 run_subagent 卡片拥有同一条实时通路（不依赖卡片渲染）。
   */
  private readonly workflowAgentRunPublisher = new WorkflowAgentRunEventPublisher({
    t,
    getToolDisplayMode: () => getCachedToolDisplaySettings().toolDisplayMode,
  })

  /**
   * Monotonically increasing version counter for state writes.
   * Poll responses that carry an older version are discarded, preventing
   * stale data from overwriting fresher SSE-driven updates.
   */
  private stateVersion = 0
  // Retain accepted marker metadata for identity-checked replay as anchors arrive;
  // goal_updated deliberately does not advance either message guard.
  private latestGoalIterationMarkers?: GoalIterationMarkerSnapshot[]

  constructor(config: ServerAgentConfig) {
    this.sessionId = config.sessionId
    this.baseUrl = config.baseUrl ?? ''

    const init = config.initialState ?? {}
    this.lastServerStateVersion = typeof init.stateVersion === 'number' ? init.stateVersion : 0
    this.sessionSource = typeof init.source === 'string' ? init.source : undefined

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
      pendingToolCalls: new Set(init.pendingToolCalls ?? []),
      backgroundCommands: init.backgroundCommands ?? [],
      errorMessage: init.errorMessage as string | undefined,
      contextCompaction: init.contextCompaction ?? null,
      contextUsage: init.contextUsage ?? null,
      pendingToolApproval: init.pendingToolApproval ?? null,
      pendingAutoCompactApproval: init.pendingAutoCompactApproval ?? null,
      pendingAsk: init.pendingAsk ?? null,
      persistDegraded: init.persistDegraded === true ? true : undefined,
      goal: normalizeGoalState(init.goal),
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

    this.sessionLeaseController = new SessionLeaseController({
      baseUrl: this.baseUrl,
      sessionId: this.sessionId,
      getSnapshot: () => this.state.sessionLease,
      applySnapshot: (next) => this.applySessionLease(next),
      isDisposed: () => this.disposed,
    })

    this.goalStateController = new GoalStateController({
      getGoal: () => this.state.goal,
      setGoal: (goal) => { this.state.goal = goal },
      notifyChanged: () => this.notifyGoalChanged(),
    })

    this.unsubscribeSse = globalAgentSseClient.subscribe(this.sessionId, this.baseUrl, (event) => {
      this.handleSseEvent(event)
      if (MESSAGE_CACHE_EVENT_TYPES.has(String(event.type))) {
        this.scheduleSessionMessageCacheWrite()
      }
    })
    if (this.state.isStreaming) this.startStateWatchdog()
  }

  // --- Session write lease ---

  /**
   * 启用会话写入租约：立即申领一次，然后按 TTL 的 1/3 续约。
   *
   * 只由「可写的主会话视图」调用（见 `ChatPanelHost` 的挂载点）：只读视图、
   * 分享页与 ACP 保持不启用，沿用旧的单客户端行为。申领失败不会抛错，
   * 而是把状态置为旁观/降级，让 composer 转只读 —— 多开时这是期望结果，
   * 不是异常。
   */
  enableSessionLease(): void {
    this.sessionLeaseController.enable()
  }

  /**
   * Subscribe to write-lease changes, calling the listener once immediately with
   * the current state. Implements the `useSyncExternalStore` contract so a host
   * can read `state.sessionLease` without mirroring it into its own state (which
   * would need a `setState` inside an effect) and without missing the result of
   * a lease claim that landed before the subscription was installed.
   */
  subscribeSessionLease(listener: () => void): () => void {
    listener()
    return this.subscribe((event) => {
      if ((event as { type?: string }).type === 'session_lease') listener()
    })
  }

  /** 主动接管租约（用户点「在此窗口接管」）。 */
  async takeOverSessionLease(): Promise<boolean> {
    return this.sessionLeaseController.takeOver()
  }

  /**
   * 手动重试一次租约请求（用户点「重试」）。降级后心跳仍每 20s 自动重试，
   * 这个入口只是不让用户被动等着 —— 网络恢复的那一刻可以立刻点一下。
   */
  async retrySessionLease(): Promise<boolean> {
    return this.sessionLeaseController.retry()
  }

  /** 当前标签页是否持有写租约（未启用租约时恒为 true）。 */
  canWrite(): boolean {
    return this.sessionLeaseController.canWrite()
  }

  private applySessionLease(next: SessionLeaseSnapshot): void {
    const previous = this.state.sessionLease
    if (
      previous
      && previous.status === next.status
      && previous.holder === next.holder
      && previous.isOwner === next.isOwner
      && previous.degraded === next.degraded
      && previous.expiresAt === next.expiresAt
      && previous.failure === next.failure
      && previous.failureStatus === next.failureStatus
    ) {
      return
    }
    this.state.sessionLease = next
    this.stateVersion++
    // `session_lease` is a local notification: the surface re-reads the whole
    // snapshot on it (the flag lives on `state`), and the host uses it to
    // re-render the composer gate without subscribing to a new event type.
    this.emitToListeners({ type: 'session_lease', lease: next })
  }

  /**
   * Headers identifying this tab as the lease owner on write requests.
   *
   * The lease is enforced per route from this header rather than from the body,
   * so every mutating call must carry it or the server treats the caller as an
   * anonymous (non-owning) client. Read requests never need it.
   */
  private writeHeaders(): Record<string, string> {
    // HTTP-only tests construct a prototype instance without the constructor;
    // an absent controller is equivalent to the pre-lease behavior (no header).
    return this.sessionLeaseController ? this.sessionLeaseController.writeHeaders() : {}
  }

  // --- Agent-compatible interface ---

  /**
   * Legacy upstream pi UI adapter. The signature is retained for compatibility,
   * but custom notifications and unvalidated SSE payloads are NOT all AgentEvents.
   * New consumers should use subscribeEvents and guard wire payload fields.
   */
  subscribe(listener: (event: AgentEvent) => void): () => void {
    if (!this.listeners.has(listener)) {
      // The sole unsafe legacy event boundary: preserve the old callback contract
      // and original object, without claiming the wire event has been validated.
      this.listeners.set(listener, (event) => { listener(event as AgentEvent) })
    }
    return () => { this.listeners.delete(listener) }
  }

  /** Subscribe to local notifications and opaque, unvalidated SSE objects. */
  subscribeEvents(listener: (event: ServerAgentEvent) => void): () => void {
    if (!this.listeners.has(listener)) this.listeners.set(listener, listener)
    return () => { this.listeners.delete(listener) }
  }

  setNextPromptCapabilities(capabilities: PromptCapabilitySelection[]): void {
    this.nextPromptCapabilities = normalizeSelectedCapabilities(capabilities)
  }

  setNextPromptContextReferences(references: FileContextReference[], onConsumed?: () => void): void {
    this.nextPromptContextReferences = Array.isArray(references) ? references.slice(0, 8) : []
    this.onPromptContextReferencesConsumed = this.nextPromptContextReferences.length > 0 ? onConsumed : undefined
  }

  setPromptMode(mode: 'plan' | 'ask' | null, onConsumed?: () => void): void {
    this.planMode = mode === 'plan'
    this.onPlanModeConsumed = mode ? onConsumed : undefined
  }

  setPlanMode(mode: boolean, onConsumed?: () => void): void {
    this.setPromptMode(mode ? 'plan' : null, onConsumed)
  }

  async prompt(input: string | AgentMessage | AgentMessage[]): Promise<void> {
    if (this.disposed) return

    if (!this.canWrite()) {
      // Another window holds the write lease. The server would reject the
      // request anyway (SESSION_LEASE_HELD); failing here keeps the optimistic
      // user message out of the transcript.
      logger.warn('Ignored prompt while another window holds the session lease')
      return
    }

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

    const selectedCapabilities = normalizeSelectedCapabilities(this.nextPromptCapabilities)
    const contextReferences = this.nextPromptContextReferences
    const selectedCommand = this.planMode ? { type: 'plan' as const } : undefined
    this.nextPromptCapabilities = []
    this.nextPromptContextReferences = []
    const onContextReferencesConsumed = this.onPromptContextReferencesConsumed
    this.onPromptContextReferencesConsumed = undefined
    onContextReferencesConsumed?.()
    if (this.planMode) {
      this.planMode = false
      const onConsumed = this.onPlanModeConsumed
      this.onPlanModeConsumed = undefined
      onConsumed?.()
    }

    const msgCountBeforeOptimistic = this.state.messages.length

    // Add to local state immediately for optimistic UI.
    const optimisticDetailsMessage = withSelectedCapabilitiesSnapshot(message, selectedCapabilities)
    const agentMessage = (contextReferences.length > 0
      ? {
          ...optimisticDetailsMessage,
          details: {
            ...(optimisticDetailsMessage.details && typeof optimisticDetailsMessage.details === 'object' && !Array.isArray(optimisticDetailsMessage.details) ? optimisticDetailsMessage.details : {}),
            contextReferences,
          },
        }
      : optimisticDetailsMessage) as unknown as AgentMessage
    this.state.messages = [...this.state.messages, agentMessage]
    this.state.contextUsage = null
    this.emitToListeners({ type: 'message_start', message: agentMessage })

    if (!this.state.isStreaming) {
      this.state.isStreaming = true
      this.state.errorMessage = undefined
      this.emitToListeners({ type: 'agent_start' })
    }

    // Send to server (with timeout to avoid hanging indefinitely)
    const PROMPT_TIMEOUT_MS = 30_000
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS)
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/prompt`
    fetch(url, {
      method: 'POST',
      headers: { ...this.writeHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ message: agentMessage, selectedCapabilities, contextReferences, command: selectedCommand }),
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
      this.state.messages = appendAssistantErrorMessageOnce(this.state.messages, message, this.state.model, agentMessage)
      this.state.errorMessage = message
      this.state.isStreaming = false
      this.state.streamingMessage = undefined
      this.stopStateWatchdog()
      this.emitToListeners({ type: 'error', error: message })
      this.emitToListeners({
        type: 'agent_end',
        messages: this.state.messages,
        errorMessage: message,
        status: 'error',
      })
    })
    this.startStateWatchdog()
  }

  /**
   * 重试一条「发送失败」的错误消息（prompt HTTP 失败时乐观 user 消息已回滚，
   * 错误消息上挂有原始 quickforgeFailedPrompt）。移除该错误消息后原样重发；
   * 重发前把 stash 里的 capabilities/contextReferences 预置回 nextPrompt*，
   * 否则 prompt 的空快照逻辑会把它们从消息 details 中剥掉。
   */
  async retryFailedPrompt(errorEntry: AgentMessage): Promise<boolean> {
    if (this.disposed || this.state.isStreaming) return false
    const failedPrompt = (errorEntry as unknown as Record<string, unknown>).quickforgeFailedPrompt as AgentMessage | undefined
    if (!failedPrompt) return false
    const details = (failedPrompt as unknown as { details?: unknown }).details
    if (details && typeof details === 'object' && !Array.isArray(details)) {
      const capabilities = selectedCapabilitiesFromDetails(details)
      if (capabilities.length > 0) this.setNextPromptCapabilities(capabilities)
      const references = (details as Record<string, unknown>).contextReferences
      if (Array.isArray(references) && references.length > 0) {
        this.setNextPromptContextReferences(references as FileContextReference[])
      }
    }
    const messages = this.state.messages
    const index = messages.lastIndexOf(errorEntry)
    if (index >= 0 && index === messages.length - 1) {
      this.state.messages = messages.slice(0, index)
    }
    await this.prompt(failedPrompt)
    return true
  }

  abort(): void {
    if (!this.canWrite()) return
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/abort`
    // The abort route is guarded by assertSessionWriteAccess, so it must carry
    // the lease owner header like every other write entry; without it the
    // server sees an anonymous client and answers 409 SESSION_LEASE_HELD,
    // silently leaving the run alive.
    fetch(url, { method: 'POST', headers: this.writeHeaders() })
      .then((response) => {
        if (!response.ok) {
          logger.warn('Abort request rejected:', { status: response.status })
        }
      })
      .catch((err) => {
        logger.error('Failed to abort:', err)
      })
  }

  /**
   * Queue a steering message and show it in the conversation immediately.
   * The server injects the message at the next tool-round boundary and echoes
   * the identical message (same role+timestamp) via message_end, which
   * upsertMessage reconciles with this optimistic copy in place.
   */
  async steer(message: AgentMessage): Promise<void> {
    if (this.disposed || !this.canWrite()) return
    this.state.messages = [...this.state.messages, message]
    this.emitToListeners({ type: 'message_start', message })
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/steer`
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { ...this.writeHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      if (!response.ok) {
        throw new Error(`Failed to steer: HTTP ${response.status}`)
      }
    } catch (err) {
      logger.error('Failed to send steer:', err)
      // Roll back the optimistic copy so the UI never shows a message the
      // server never accepted.
      const index = this.state.messages.indexOf(message)
      if (index >= 0) {
        this.state.messages = [...this.state.messages.slice(0, index), ...this.state.messages.slice(index + 1)]
        this.emitToListeners({ type: 'message_start' })
      }
      throw err
    }
  }

  followUp(message: AgentMessage): void {
    if (!this.canWrite()) return
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/follow-up`
    fetch(url, {
      method: 'POST',
      headers: { ...this.writeHeaders(), 'content-type': 'application/json' },
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
    this.state.goal = null
  }

  /**
   * Sync an Agent access mode change to the server so current session tools match the UI selector.
   */
  async updateAccessMode(accessMode: AgentAccessMode): Promise<void> {
    if (!this.canWrite()) return
    const normalized = normalizeAgentAccessMode(accessMode)
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/access-mode`
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.writeHeaders(), 'content-type': 'application/json' },
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
    if (!this.canWrite()) return
    const previousModel = this.state.model
    this.state.model = model
    this.state.contextUsage = null
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/model`
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { ...this.writeHeaders(), 'content-type': 'application/json' },
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
    if (!this.canWrite()) return
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/thinking-level`
    fetch(url, {
      method: 'POST',
      headers: { ...this.writeHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ thinkingLevel: level }),
    }).catch((err) => {
      logger.error('Failed to sync thinking level update to server:', err)
    })
  }

  /**
   * Roll back from a message index on the authoritative server state.
   */
  async rollback(messageIndex: number): Promise<ServerRollbackResult> {
    if (!this.canWrite()) throw new Error('Another window is writing to this session')
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/rollback`
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.writeHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ messageIndex }),
    })
    const payload = await res.json().catch(() => null) as (ServerRollbackResult & ServerErrorPayload) | null
    if (!res.ok) throw new Error(serverErrorMessage(payload, `Failed to roll back: HTTP ${res.status}`))
    return payload as ServerRollbackResult
  }

  /** 每轮产物卡「撤销本轮」预检：只读安全检查；执行必须使用预检返回的 revision。 */
  async getTurnRollbackPreview(turnIds: string[], signal?: AbortSignal): Promise<ServerTurnRollbackPreview> {
    // 空集合防御：无 turnId 的轮不该发起请求，直接按预检失败拒绝。
    if (turnIds.length === 0) return Promise.reject(new Error('Turn rollback requires at least one turn id'))
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/rollback-turn/preview?turnIds=${encodeURIComponent(turnIds.join(','))}`
    const { response, body } = await fetchJsonWithTimeout<ServerTurnRollbackPreview & ServerErrorPayload>(url, 30_000, { signal })
    if (!response.ok || !isTurnRollbackPreview(body)) {
      throw turnRollbackApiError(response.status, serverErrorMessage(body ?? null, `Failed to preview turn rollback: HTTP ${response.status}`))
    }
    return body
  }

  /**
   * 轮级撤销执行：200 = completed/partial；409 = revision 过期（预览已失效）；
   * 500 = 失败。网络/超时异常无法确认服务端是否已写入，同样按错误抛出（带 status）。
   */
  async rollbackTurn(turnIds: string[], revision: string, signal?: AbortSignal): Promise<ServerTurnRollbackResult> {
    // 空集合防御：与预检同口径，空轮不发起执行请求。
    if (turnIds.length === 0) return Promise.reject(new Error('Turn rollback requires at least one turn id'))
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/rollback-turn`
    const { response, body } = await fetchJsonWithTimeout<ServerTurnRollbackResult & ServerErrorPayload>(url, 60_000, {
      method: 'POST',
      headers: { ...this.writeHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ turnIds, revision }),
      signal,
    })
    if (response.ok && isTurnRollbackResult(body)) return body
    throw turnRollbackApiError(response.status, serverErrorMessage(body ?? null, `Turn rollback result unconfirmed: HTTP ${response.status}`))
  }

  /**
   * Continue generation from the current last message (retry / regenerate).
   * The last message must be a user or tool-result message.
   *
   * Passing `appendMessage` retries by appending that user message instead of
   * trimming the failed turn, so tool calls the failed turn already completed
   * stay in the model transcript. The optimistic copy is reconciled in place by
   * `upsertMessage` via role+timestamp, exactly like `steer()`.
   */
  async continue(appendMessage?: AgentMessage): Promise<void> {
    // Retry is a write entry like every other one: a non-owner tab must not
    // optimistically append the "continue" message only to have it rejected.
    if (!this.canWrite()) throw new Error('Another window is writing to this session')
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/continue`
    const optimistic: AgentMessage | undefined = appendMessage
    if (optimistic) {
      this.state.messages = [...this.state.messages, optimistic]
      this.emitToListeners({ type: 'message_start', message: optimistic })
    }
    try {
      // The continue route is guarded by assertSessionWriteAccess, so the lease
      // owner header must be sent on *both* retry shapes. Without it the server
      // sees an anonymous client and answers 409 SESSION_LEASE_HELD even though
      // this tab owns the lease — the "retry always fails, this session is open
      // for writing in another window" false alarm.
      const res = await fetch(url, {
        method: 'POST',
        headers: optimistic
          ? { ...this.writeHeaders(), 'content-type': 'application/json' }
          : this.writeHeaders(),
        ...(optimistic ? { body: JSON.stringify({ message: optimistic }) } : {}),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null) as ServerErrorPayload | null
        throw new Error(serverErrorMessage(payload, `Failed to continue: HTTP ${res.status}`))
      }
    } catch (error) {
      // Roll back the optimistic copy so the UI never shows a message the
      // server never accepted.
      if (optimistic) {
        const index = this.state.messages.indexOf(optimistic)
        if (index >= 0) {
          this.state.messages = [...this.state.messages.slice(0, index), ...this.state.messages.slice(index + 1)]
          this.emitToListeners({ type: 'message_start' })
        }
      }
      throw error
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
      headers: { ...this.writeHeaders(), 'content-type': 'application/json' },
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
      headers: { ...this.writeHeaders(), 'content-type': 'application/json' },
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

  /**
   * Answer or skip a pending ask_user call.
   *
   * `remark` is the review-step free-form note (not tied to any question); the
   * server appends it to the tool result after the per-question answers.
   */
  async answerAsk(askId: string, payload: { answers?: ServerAgentAskAnswer[]; skipped?: boolean; remark?: string } = {}): Promise<void> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/answer-ask`
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.writeHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ askId, answers: payload.answers, skipped: payload.skipped === true, remark: payload.remark }),
    })
    if (!res.ok) {
      const errorPayload = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(errorPayload?.error || `Failed to answer ask: HTTP ${res.status}`)
    }
    if (this.state.pendingAsk?.askId === askId) {
      this.state.pendingAsk = null
    }
  }

  async approveAutoCompact(approvalId: string): Promise<void> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/approve-auto-compact`
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.writeHeaders(), 'content-type': 'application/json' },
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
      headers: { ...this.writeHeaders(), 'content-type': 'application/json' },
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

  /**
   * Post a goal action (confirm/pause/resume/cancel/revise/accept). `revise`
   * requires the replacement objective; `accept` is the explicit human sign-off
   * for a `needs_review` goal. The server returns the authoritative goal and the
   * local state adopts it immediately (SSE `goal_updated` is the fallback).
   *
   * Staleness rules:
   * - A missing `goal` field (older server / empty body) preserves the current
   *   state instead of clearing it.
   * - A response that raced a newer goal update never overwrites it: same-id
   *   responses are guarded by `revision`, cross-id / `null` clears by the goal
   *   change watermark captured before the request.
   */
  async updateGoal(action: GoalAction, objective?: string, options?: GoalActionOptions): Promise<GoalState | null> {
    const extending = action === 'extend_resume'
    if (extending) {
      if (!options || !Number.isSafeInteger(options.expectedRevision) || options.expectedRevision <= 0
        || this.state.goal?.id !== options.goalId) throw new Error(t('goalBudgetReconfirm'))
      const signal = options.signal ?? new AbortController().signal
      const snapshot = await this.refreshGoalForSave(options.goalId, signal)
      const goal = this.state.goal
      // Cancellation only gates dispatch. Once POST starts it must settle (and
      // reconcile failures) before the shared UI lock can be released.
      if (signal.aborted || !goal || goal.id !== options.goalId || goal.revision !== options.expectedRevision
        || snapshot.isStreaming || !['paused', 'blocked', 'needs_review'].includes(goal.status)
        || !goalBudgetExtension(goal).exhausted) throw new Error(t('goalBudgetReconfirm'))
    }
    const reconcileExtension = async () => {
      if (extending && options) {
        try { await this.refreshGoalForSave(options.goalId, new AbortController().signal) }
        catch { throw new Error(t('goalBudgetReconcileFailed')) }
      }
    }
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/goal`
    const body: Record<string, unknown> = extending
      ? { action, goalId: options!.goalId, expectedRevision: options!.expectedRevision }
      : { action }
    if (!extending && typeof objective === 'string') body.objective = objective
    if (!this.canWrite()) throw new Error('Another window is writing to this session')
    // Capture the goal watermark before the async gap. The response is only
    // adopted while no newer goal update (SSE / state / another action) landed
    // in the meantime; otherwise the newer goal already owns the card.
    const capture = this.goalStateController.capture()
    let res: Response
    let payload: { goal?: unknown; error?: string; code?: string } | undefined
    try {
      ({ response: res, body: payload } = await fetchJsonWithTimeout<{ goal?: unknown; error?: string; code?: string }>(
        url,
        GOAL_ACTION_TIMEOUT_MS,
        {
          method: 'POST',
          headers: { ...this.writeHeaders(), 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      ))
    } catch (error) {
      await reconcileExtension()
      // A hung action aborts at the timeout. Surface a bounded error so the
      // caller can clear its pending state instead of waiting forever.
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Failed to update goal: timed out after ${GOAL_ACTION_TIMEOUT_MS}ms`, { cause: error })
      }
      throw error
    }
    if (!res.ok) {
      await reconcileExtension()
      const error = new Error(payload?.error || `Failed to update goal: HTTP ${res.status}`)
      // Machine error codes let the UI map the failure to localized copy.
      if (typeof payload?.code === 'string' && payload.code) (error as Error & { code?: string }).code = payload.code
      throw error
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'goal')) {
      const goalResult = this.goalStateController.adopt(normalizeGoalState(payload.goal), capture)
      // A goal action is applied through HTTP even when no SSE frame follows,
      // so a real change must be broadcast here too (a superseded response
      // reports `changed: false` and stays silent).
      if (goalResult.changed) this.notifyGoalChanged()
    }
    return this.state.goal ?? null
  }

  /**
   * Adopt an authoritative goal snapshot. Ordering has two layers:
   *
   * - Same goal id: `revision` is the authority — an older revision never
   *   regresses the current goal.
   * - Cross id / explicit `null` (clear): revisions are meaningless, so an
   *   async response must prove it was not superseded. Callers that span an
   *   async gap capture `{ seq }` and the snapshot is only adopted while the
   *   goal change watermark is unchanged.
   *
   * Returns whether the snapshot was applied and whether it changed the goal;
   * a rejected snapshot leaves the newer goal untouched.
   */
  /** Save-only reconciliation: never changes message/stream ordering or swallows failures. */
  async refreshGoalForSave(goalId: string, signal: AbortSignal): Promise<{ isStreaming: boolean }> {
    const capture = this.goalStateController.capture()
    const localVersion = this.stateVersion
    const isCurrent = () => !this.disposed && !signal.aborted
      && this.state.goal?.id === goalId && this.state.goal.sessionId === this.sessionId
    if (!isCurrent()) throw new Error(t('goalUnavailable'))
    const { response, body } = await fetchJsonWithTimeout<{
      goal?: unknown; isStreaming?: unknown; stateVersion?: number
    }>(`${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/state`, STATE_REQUEST_TIMEOUT_MS, { cache: 'no-store', signal })
    if (!response.ok) throw new Error(t('goalRefreshFailed', { status: response.status }))
    const next = normalizeGoalState(body?.goal)
    if (!isCurrent() || !next || next.id !== goalId || next.sessionId !== this.sessionId
      || typeof body?.isStreaming !== 'boolean' || localVersion !== this.stateVersion
      || (typeof body.stateVersion === 'number' && body.stateVersion < this.lastServerStateVersion)) {
      throw new Error(t('goalRefreshUnsafe'))
    }
    const result = this.goalStateController.adopt(next, capture)
    if (!result.applied) throw new Error(t('goalRefreshUnsafe'))
    if (result.changed) this.notifyGoalChanged()
    return { isStreaming: body.isStreaming }
  }

  /**
   * Broadcast an authoritative goal change to listeners. Only call this after
   * `GoalStateController.adopt` reported `changed`: a same-value echo or a
   * superseded async response must not cause a pointless re-render / cache churn.
   *
   * Deliberately does NOT bump the message `stateVersion`: a goal frame never
   * changes messages, so advancing the message watermark would discard an
   * in-flight message reconcile (lost messages). The SSE `goal_updated` case
   * does not use this helper — it forwards the raw frame exactly once.
   */
  private notifyGoalChanged(): void {
    this.emitToListeners({ type: 'goal_updated', goal: this.state.goal ?? null })
  }

  /**
   * A message-version guard can reject a `/state` snapshot as too old to touch
   * the message list, but the goal has an independent watermark: the very same
   * goal at a strictly newer revision is still authoritative and must not be
   * dropped just because a message frame won the race. Only that narrow case is
   * adopted on the early-return path; cross-id replacements, explicit nulls and
   * equal/lower revisions stay blocked and remain owned by the normal path.
   *
   * The controller's watermark capture is the final arbiter: if a goal frame
   * changed the goal while the fetch was in flight, the snapshot is superseded
   * and rejected even when its revision looks newer.
   */
  dispose(): void {
    this.disposed = true
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.sessionLeaseController.dispose()
    if (this.messageReconcileRetryTimer !== null) {
      clearTimeout(this.messageReconcileRetryTimer)
      this.messageReconcileRetryTimer = null
    }
    this.statusPromise = null
    this.subagentRunPublisher.dispose()
    this.workflowAgentRunPublisher.dispose()
    this.unsubscribeSse?.()
    this.unsubscribeSse = undefined
    this.listeners.clear()
  }

  // --- Session message snapshot cache (read-only acceleration layer) ---

  /**
   * 以当前实例状态重建缓存写入 payload。builder 在 flush 时读取 state，
   * dispose 后 state 对象仍可安全读取；缺失字段宁可不写，保证 hydration
   * 侧构造器安全。
   */
  private buildSessionMessageCachePayload(): SessionMessageCacheSource {
    const state = this.state
    return {
      stateVersion: this.lastServerStateVersion,
      messages: state.messages,
      snapshot: {
        ...this.sessionCacheMetadata,
        systemPrompt: state.systemPrompt,
        model: state.model,
        thinkingLevel: state.thinkingLevel,
        tools: state.tools,
        accessMode: state.accessMode,
        yoloMode: state.yoloMode,
        isStreaming: state.isStreaming,
        pendingToolCalls: [...state.pendingToolCalls],
        errorMessage: state.errorMessage,
        contextCompaction: state.contextCompaction,
        contextUsage: state.contextUsage,
        pendingToolApproval: state.pendingToolApproval,
        pendingAutoCompactApproval: state.pendingAutoCompactApproval,
        pendingAsk: state.pendingAsk,
        goal: state.goal,
        source: this.sessionSource,
        stateVersion: this.lastServerStateVersion,
      },
    }
  }

  private scheduleSessionMessageCacheWrite(): void {
    writeSessionMessageSnapshot(
      resolveServerCacheKey(this.baseUrl),
      this.sessionId,
      () => this.buildSessionMessageCachePayload(),
    )
  }

  private notifyMessageMetadataChanged(): void {
    this.emitToListeners({ type: 'message_metadata_updated' })
    this.scheduleSessionMessageCacheWrite()
  }

  private acceptFullGoalIterationMarkerSnapshot(messages: AgentMessage[]): void {
    const markers: GoalIterationMarkerSnapshot[] = []
    messages.forEach((value, index) => {
      const message = value as AgentMessage & { id?: string; timestamp?: number; details?: Record<string, unknown> }
      const marker = message.details?.quickforgeGoalIteration
      if (marker && typeof marker === 'object' && !Array.isArray(marker)) {
        markers.push({ index, role: message.role, id: message.id, timestamp: message.timestamp, quickforgeGoalIteration: marker as Record<string, unknown> })
      }
    })
    this.acceptGoalIterationMarkerSnapshot(markers)
  }

  private acceptGoalIterationMarkerSnapshot(markers?: GoalIterationMarkerSnapshot[]): void {
    if (Array.isArray(markers)) this.latestGoalIterationMarkers = markers
    this.applyGoalIterationMarkers(markers)
  }

  private replayGoalIterationMarkers(): void {
    this.applyGoalIterationMarkers(this.latestGoalIterationMarkers, true)
  }

  private applyGoalIterationMarkers(markers?: GoalIterationMarkerSnapshot[], replay = false): void {
    const messages = mergeGoalIterationMarkers(this.state.messages, markers, replay)
    if (messages === this.state.messages) return
    this.state.messages = messages
    this.stateVersion++
    this.notifyMessageMetadataChanged()
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
        const s = event as ServerAgentStateSnapshot
        if (s.source !== undefined) {
          this.sessionSource = s.source || undefined
        }
        if (s.systemPrompt !== undefined) {
          this.state.systemPrompt = s.systemPrompt
        }
        if (s.messages && (s.messages.length > this.state.messages.length || (!this.state.isStreaming && s.messages.length === this.state.messages.length))) {
          if (JSON.stringify(this.state.messages) !== JSON.stringify(s.messages)) {
            this.state.messages = s.messages
            this.stateVersion++
            this.notifyMessageMetadataChanged()
          }
        }
        // Streaming protects the body, not identity-checked final metadata.
        if (s.messages) this.acceptFullGoalIterationMarkerSnapshot(s.messages)
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
        if (s.pendingAsk !== undefined) {
          this.state.pendingAsk = s.pendingAsk
        }
        if (s.pendingToolCalls !== undefined) {
          this.state.pendingToolCalls = new Set(s.pendingToolCalls)
        }
        if (s.backgroundCommands !== undefined) {
          this.state.backgroundCommands = s.backgroundCommands
        }
        // State frames are full snapshots: absence of the flag means healthy.
        this.state.persistDegraded = s.persistDegraded === true ? true : undefined
        if (s.goal !== undefined) {
          // The state frame returns below without forwarding, so a real goal
          // change must be broadcast explicitly (a repeat snapshot / stale
          // revision reports `changed: false` and stays silent).
          const goalResult = this.goalStateController.adopt(normalizeGoalState(s.goal))
          if (goalResult.changed) this.notifyGoalChanged()
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
          this.emitToListeners({ type: 'agent_start' })
        } else if (wasStreaming) {
          // Mirror the agent_end case: the run is over, so the streaming
          // partial must not linger (a reconnect frame that reports the run
          // finished without the client ever seeing message_end).
          this.state.streamingMessage = undefined
          this.state.pendingToolApproval = null
          this.state.pendingAutoCompactApproval = null
          this.state.pendingAsk = null
          this.stateVersion++
          this.emitToListeners({ type: 'agent_end', messages: this.state.messages })
        }
        if (!s.messages && s.messagesSummary) {
          this.acceptGoalIterationMarkerSnapshot(s.goalIterationMarkers)
          // Reapply inside the reconcile's version guard after missing messages
          // arrive. Capture after this frame's own lifecycle writes.
          void this.reconcileMessagesFromSummary(s.messagesSummary, s.goalIterationMarkers)
        }
        return
      }

      case 'agent_start': {
        this.state.isStreaming = true
        this.state.errorMessage = undefined
        this.state.pendingToolApproval = null
        this.state.pendingAutoCompactApproval = null
        this.state.pendingAsk = null
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
          const summary = endEvent.messagesSummary
          const summaryCount = summary?.count
          if (summary && typeof summaryCount === 'number' && summaryCount > this.state.messages.length) {
            void this.reconcileMessagesFromSummary(summary, undefined, true).finally(() => {
              this.state.isStreaming = false
              this.state.streamingMessage = undefined
              this.state.pendingToolApproval = null
              this.state.pendingAutoCompactApproval = null
              this.state.pendingAsk = null
              if (endEvent.errorMessage) this.state.errorMessage = endEvent.errorMessage
              this.forwardWireEvent(event)
            })
            return
          }
          this.replayGoalIterationMarkers()
          this.state.contextUsage = endEvent.contextUsage !== undefined ? endEvent.contextUsage : null
          this.state.isStreaming = false
          this.state.streamingMessage = undefined
          this.state.pendingToolApproval = null
          this.state.pendingAutoCompactApproval = null
          this.state.pendingAsk = null
          if (endEvent.errorMessage) this.state.errorMessage = endEvent.errorMessage
          this.stateVersion++
          this.forwardWireEvent(event)
          return
        }
        if (endEvent.messagesSummary && (
          !Array.isArray(endEvent.messages)
          || (typeof endEvent.messagesSummary.count === 'number' && endEvent.messagesSummary.count > this.state.messages.length)
        )) {
          void this.reconcileMessagesFromSummary(endEvent.messagesSummary, undefined, true).finally(() => {
            this.state.isStreaming = false
            this.state.streamingMessage = undefined
            this.state.pendingToolApproval = null
            this.state.pendingAutoCompactApproval = null
            if (endEvent.errorMessage) this.state.errorMessage = endEvent.errorMessage
            this.forwardWireEvent(event)
          })
          return
        }
        if (endEvent.messages && endEvent.messages.length >= this.state.messages.length) {
          this.state.messages = endEvent.messages
          this.replayGoalIterationMarkers()
          this.state.contextUsage = endEvent.contextUsage !== undefined ? endEvent.contextUsage : null
          this.state.isStreaming = false
          this.state.streamingMessage = undefined
          this.state.pendingToolApproval = null
          this.state.pendingAutoCompactApproval = null
          this.state.pendingAsk = null
          if (endEvent.errorMessage) this.state.errorMessage = endEvent.errorMessage
          this.stateVersion++
          this.forwardWireEvent(event)
          return
        }

        // Fallback for stale/malformed events or legacy servers.
        void this.refreshStateFromServer({ forceMessages: true }).finally(() => {
          this.state.isStreaming = false
          this.state.streamingMessage = undefined
          this.state.pendingToolApproval = null
          this.state.pendingAutoCompactApproval = null
          this.state.pendingAsk = null
          if (endEvent.errorMessage) this.state.errorMessage = endEvent.errorMessage
          this.forwardWireEvent(event)
        })
        return
      }

      case 'message_end': {
        // Trust the SSE event data when it carries a finalized message. Tool
        // calls are executed after the assistant message_end event, so keeping
        // this message in local state lets pending run_command cards render
        // immediately instead of waiting for a full state refresh.
        const msgEvent = event as { message?: AgentMessage; messages?: AgentMessage[]; messagesAfter?: number; messagesIncremental?: boolean; messagesSummary?: { count?: number }; contextUsage?: ServerAgentContextUsage | null }
        // The partial body this stream was rendering is finalized by this
        // frame (carried by it or refetched below), so drop it to avoid
        // rendering the same message twice (list + streaming container).
        this.state.streamingMessage = undefined
        if (msgEvent.message) {
          this.state.messages = upsertMessage(this.state.messages, msgEvent.message)
          // Keep committed tool calls without any result pending so they keep
          // rendering running: tool_execution_start may arrive only after this
          // frame, and a missing pending entry would flash the idle 'called'
          // dot for one frame before the spinner returns.
          const pendingIds = toolCallIdsWithoutToolResult(msgEvent.message, this.state.messages)
          if (pendingIds.length) {
            this.state.pendingToolCalls = new Set([...this.state.pendingToolCalls, ...pendingIds])
          }
          this.replayGoalIterationMarkers()
          this.state.contextUsage = msgEvent.contextUsage !== undefined ? msgEvent.contextUsage : null
          this.stateVersion++
          this.forwardWireEvent(event)
          return
        }
        if (msgEvent.messagesIncremental) {
          this.state.messages = mergeIncrementalMessages(
            this.state.messages,
            typeof msgEvent.messagesAfter === 'number' ? msgEvent.messagesAfter : this.state.messages.length,
            msgEvent.messages ?? [],
          )
          if (typeof msgEvent.messagesSummary?.count === 'number' && msgEvent.messagesSummary.count > this.state.messages.length) {
            void this.reconcileMessagesFromSummary(msgEvent.messagesSummary, undefined, true).finally(() => {
              this.forwardWireEvent(event)
            })
            return
          }
          this.replayGoalIterationMarkers()
          this.state.contextUsage = msgEvent.contextUsage !== undefined ? msgEvent.contextUsage : null
          this.stateVersion++
          this.forwardWireEvent(event)
          return
        }
        if (msgEvent.messages && msgEvent.messages.length >= this.state.messages.length) {
          this.state.messages = msgEvent.messages
          this.replayGoalIterationMarkers()
          this.state.contextUsage = msgEvent.contextUsage !== undefined ? msgEvent.contextUsage : null
          this.stateVersion++
          this.forwardWireEvent(event)
          return
        }
        if (msgEvent.messagesSummary) {
          void this.reconcileMessagesFromSummary(msgEvent.messagesSummary).finally(() => {
            this.forwardWireEvent(event)
          })
          return
        }
        // No messages in event — refresh from server as last resort
        void this.refreshStateFromServer().finally(() => {
          this.forwardWireEvent(event)
        })
        return
      }

      case 'turn_end': {
        // turn_end carries the assistant message for this turn, but by this
        // point it is already in state and tool results may have followed it.
        // Do not upsert event.message here, otherwise it can duplicate the
        // assistant message after tool results.
        const msgEvent = event as { messages?: AgentMessage[]; contextUsage?: ServerAgentContextUsage | null }
        // Defensive: message_end normally cleared the partial body already,
        // but a turn_end without a preceding message_end must not leave the
        // last streamed message duplicated in the streaming container.
        this.state.streamingMessage = undefined
        if (msgEvent.messages && msgEvent.messages.length >= this.state.messages.length) {
          this.state.messages = msgEvent.messages
          this.replayGoalIterationMarkers()
          this.state.contextUsage = msgEvent.contextUsage !== undefined ? msgEvent.contextUsage : null
          this.stateVersion++
          this.forwardWireEvent(event)
          return
        }
        void this.refreshStateFromServer().finally(() => {
          this.forwardWireEvent(event)
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
        this.replayGoalIterationMarkers()
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

      case 'goal_updated': {
        const goalEvent = event as { goal?: unknown }
        // A goal frame never changes messages, so it must NOT bump the local
        // message stateVersion: doing so would discard an in-flight message
        // reconcile (lost messages). A missing `goal` field (older server)
        // preserves the current goal; an explicit null clears it; a stale
        // frame for the same goal id never regresses a newer revision.
        if (Object.prototype.hasOwnProperty.call(goalEvent, 'goal')) {
          // The raw frame is forwarded once below for a real change; a
          // same-value echo or a superseded revision returns early instead of
          // triggering a no-op re-render (never emit a second time here).
          if (!this.goalStateController.adopt(normalizeGoalState(goalEvent.goal)).changed) return
        }
        break
      }

      case 'background_commands': {
        const backgroundEvent = event as { backgroundCommands?: BackgroundCommandSnapshot[]; messages?: AgentMessage[] }
        if (Array.isArray(backgroundEvent.backgroundCommands)) {
          this.state.backgroundCommands = backgroundEvent.backgroundCommands
        }
        if (Array.isArray(backgroundEvent.messages)) {
          this.state.messages = backgroundEvent.messages
        }
        this.stateVersion++
        break
      }

      case 'tool_execution_start': {
        const toolEvent = event as ToolExecutionEvent
        if (toolEvent.toolCallId) {
          this.state.messages = upsertToolResult(this.state.messages, toolStartEventWithPartialResult(toolEvent, this.sessionId), true)
          this.state.pendingToolCalls = new Set([...this.state.pendingToolCalls, toolEvent.toolCallId])
          this.stateVersion++
          this.subagentRunPublisher.handleToolStart(toolEvent)
          this.workflowAgentRunPublisher.handleToolStart(toolEvent)
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
        this.workflowAgentRunPublisher.handleToolUpdate(toolEvent)
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
        this.workflowAgentRunPublisher.handleToolEnd(toolEvent)
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

      case 'message_update': {
        // Mirror SharedServerAgent (see shared-server-agent.ts): the live
        // partial body must be exposed on state.streamingMessage so the React
        // chat surface can render streaming text. A frame without `message`
        // (older server) is forwarded as-is without touching the stream.
        const updateEvent = event as { message?: AgentMessage }
        if (updateEvent.message) this.state.streamingMessage = updateEvent.message
        break
      }

      case 'auto_compact_failed':
      case 'message_start':
      case 'turn_start':
      case 'auto_compact_threshold_reached':
        // Forward as-is
        break

      case 'persist_degraded': {
        // Authoritative persist was skipped after CAS conflicts (or recovered).
        // Update the flag and forward so the panel can show/hide the warning.
        const degradedEvent = event as { persistDegraded?: unknown }
        this.state.persistDegraded = degradedEvent.persistDegraded === true ? true : undefined
        break
      }

      case 'session_lease': {
        // Another client acquired/released the write lease. Adopting this frame
        // is what flips a secondary tab into (or out of) read-only without
        // polling: the holder's heartbeat never broadcasts, only hand-overs do.
        const leaseEvent = event as { lease?: { clientId?: string; expiresAt?: string } | null }
        this.sessionLeaseController.applyWireLease(leaseEvent.lease ?? null)
        return
      }

      case 'tool_approval_required': {
        const approvalEvent = event as unknown as ServerAgentPendingToolApproval
        if (typeof approvalEvent.toolCallId === 'string' && typeof approvalEvent.toolName === 'string') {
          this.state.pendingToolApproval = approvalEvent
          this.state.pendingAutoCompactApproval = null
        }
        break
      }

      case 'ask_user_required': {
        const askEvent = event as unknown as ServerAgentPendingAsk
        if (typeof askEvent.askId === 'string' && Array.isArray(askEvent.questions)) {
          this.state.pendingAsk = askEvent
        }
        break
      }

      case 'ask_user_answered': {
        // The answered ask lives on as a normal ask_user tool message in the
        // history (auto-collapsed by the tool message UI), so the interactive
        // card is simply removed.
        this.state.pendingAsk = null
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
    this.forwardWireEvent(event)
  }

  private emitToListeners(event: ServerAgentLocalEvent): void {
    this.dispatchEvent(event)
  }

  private forwardWireEvent(event: ServerAgentWireEvent): void {
    this.dispatchEvent(event)
  }

  private dispatchEvent(event: ServerAgentEvent): void {
    for (const listener of this.listeners.values()) {
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
        persistDegraded?: boolean
      }>(url, STATUS_REQUEST_TIMEOUT_MS)
      if (!res.ok) {
        if (res.status === 404 && this.state.isStreaming) {
          this.state.isStreaming = false
          this.stopStateWatchdog()
          this.emitToListeners({ type: 'agent_end', messages: this.state.messages })
        }
        return
      }

      const typedStatus = status ?? {}
      this.lastSseEventAt = Date.now()
      if (typedStatus.persistDegraded !== undefined) {
        this.state.persistDegraded = typedStatus.persistDegraded === true ? true : undefined
      }

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
          this.state.pendingAsk = null
          this.emitToListeners({ type: 'agent_end', messages: this.state.messages })
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

  /**
   * 把尾部窗口补齐为全量消息。
   *
   * 只读视图（`loadView`）只带回尾部窗口以便首屏快速上屏，但界面必须能滚到
   * 更早的历史。增量对账按「服务端索引」工作，它只会往后拉新消息、不会补前缀，
   * 所以这里显式做一次全量替换，并把窗口偏移归零。
   *
   * `beforeReplace` 在**真正替换的前一刻**同步调用：调用方用它捕获滚动锚点。
   * 不能在发起请求时就捕获——补齐要走一次网络往返，用户可能在这期间滚动，
   * 用过期锚点会把视口恢复到他早已离开的位置。
   *
   * 幂等且可重复调用：已经是全量（偏移 0）时直接返回。失败保持窗口状态不变。
   */
  async hydrateFullHistory(beforeReplace?: () => (() => void) | void): Promise<void> {
    if (this.disposed || this.messageWindowOffset <= 0) return
    const versionBefore = this.stateVersion
    let all: AgentMessage[] | null
    try {
      all = await this.fetchAllMessagesFromServer()
    } catch {
      return
    }
    if (!all || this.disposed) return
    // A concurrent SSE frame already advanced the list; drop this snapshot and
    // leave the offset in place so a later attempt can still widen it.
    if (versionBefore !== this.stateVersion) return
    if (all.length <= this.state.messages.length) {
      // Nothing more on the server than we already show: clear the offset so we
      // stop treating the list as windowed.
      this.messageWindowOffset = 0
      return
    }
    // 一次性替换，不分批。
    //
    // 曾尝试「按 60 条逐帧向前扩展」以削平长任务，**实测更差**：累计阻塞从
    // ~1.1s 涨到 5.0s、长任务从 2 个变成 35 个。原因是每次提交都要重建整张列表
    // （React 协调 + 装饰重算），增量收益被重复成本吃掉。保持单次替换。
    const cancelAnchor = beforeReplace?.()
    this.state.messages = all
    this.messageWindowOffset = 0
    this.state.contextUsage = null
    this.stateVersion++
    this.notifyMessageMetadataChanged()
    // If no commit consumed the anchor (e.g. unmounted), release it so it cannot
    // shift scroll at some later, unrelated commit. Guarded: this module is also
    // used outside a DOM (tests, ACP), where `window` does not exist.
    if (typeof cancelAnchor === 'function') {
      const defer = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)
      defer(() => cancelAnchor())
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

  // --- Split-session message reconciliation ---

  private async fetchMessagesFromServer(after: number): Promise<SessionMessagesPage | null> {
    return fetchSessionMessagesPage(this.baseUrl, this.sessionId, after)
  }

  /**
   * 全量重拉会话消息（回滚/清理场景）。失败（异常或非 2xx 页）显式返回
   * null 与“服务端确实为空”（[]）区分：前者交给调用方重试，后者是合法
   * 终态。restore/create 走的模块级 fetchAllSessionMessages 保持静默
   * 降级语义，不受影响。
   */
  private async fetchAllMessagesFromServer(): Promise<AgentMessage[] | null> {
    const all: AgentMessage[] = []
    let after = 0
    for (let guard = 0; guard < 128; guard += 1) {
      let page: SessionMessagesPage | null
      try {
        page = await fetchSessionMessagesPage(this.baseUrl, this.sessionId, after)
      } catch {
        return null
      }
      if (!page) return null
      all.push(...page.messages)
      if (!page.hasMore || page.messages.length === 0) break
      after += page.messages.length
    }
    return all
  }

  /**
   * Reconcile local messages against a `messagesSummary` (count) received in a
   * state frame for a split session. Snapshot-based staleness guard: any state
   * write that happens while the fetch is in flight (a concurrent SSE event
   * that already advanced this.stateVersion) discards the result — the newer
   * event is authoritative.
   *
   * 消息实际合入（stateVersion 前进）即在 finish() 广播
   * message_metadata_updated：state 帧驱动的拉尾在 reconcile 之前已同步发出
   * agent_end（当时消息尚未补齐），没有任何后续转发事件兜底，不广播会让
   * 已合入的最终回答停留在内存里不渲染（“最终答案刷新才显示”）。
   * 拉尾跨页（服务端单页 500 条上限）时以整体重跑续拉下一页，每页重置
   * 重试预算；全量重拉（回滚/清理场景）的失败同样进退避重试。
   */
  /**
   * 拉尾恢复失败的退避重试：`attempt` 从 0 起，第 attempt 次失败后延迟
   * `MESSAGE_RECONCILE_RETRY_DELAYS_MS[attempt]` 再整体重跑 reconcile。
   * 重跑会重新快照 stateVersion（期间有更新的 SSE 事件补齐消息即自然放弃）、
   * 重新读本地 messages（count 已追平则空转返回），成功路径无需感知本方法。
   */
  private scheduleMessageReconcileRetry(
    summary: { count?: number },
    markers?: GoalIterationMarkerSnapshot[],
    forceMessages = false,
    attempt = 0,
  ) {
    if (this.disposed) return
    if (attempt >= MESSAGE_RECONCILE_RETRY_DELAYS_MS.length) {
      logger.warn('Message tail reconcile retries exhausted', {
        sessionId: this.sessionId,
        summaryCount: summary.count,
        localCount: this.state.messages.length,
      })
      return
    }
    const delay = MESSAGE_RECONCILE_RETRY_DELAYS_MS[attempt]
    if (this.messageReconcileRetryTimer !== null) return
    this.messageReconcileRetryTimer = setTimeout(() => {
      this.messageReconcileRetryTimer = null
      if (this.disposed) return
      void this.reconcileMessagesFromSummary(summary, markers, forceMessages, attempt + 1)
    }, delay)
  }

  private async reconcileMessagesFromSummary(summary: { count?: number }, markers?: GoalIterationMarkerSnapshot[], forceMessages = false, retryAttempt = 0): Promise<void> {
    const versionBefore = this.stateVersion
    const localCount = this.state.messages.length
    // Server-side index of the local list's first message. 0 for a full
    // restore/create; > 0 when the list came from a read-only tail window
    // (`loadView`). All count comparisons below are in server indices, so the
    // offset has to participate — otherwise a 200-message window over a
    // 1000-message session looks like a 800-message server-side truncation and
    // triggers a pointless full refetch.
    const windowOffset = this.messageWindowOffset
    const localEnd = windowOffset + localCount
    const isCurrent = () => versionBefore === this.stateVersion
      && (!markers || markers === this.latestGoalIterationMarkers)
    const finish = () => {
      const versionAfterMessages = this.stateVersion
      // An ordinary agent_end page can win the race against a marker page.
      // Replay the latest accepted snapshot, never the request's captured one.
      this.replayGoalIterationMarkers()
      // 合入即广播：state 帧驱动的拉尾没有任何后续转发事件（agent_end 已在
      // reconcile 之前同步发出），若只在 markers 存在时通知，无 goal 的普通
      // 会话会把已合入的最终回答留在内存里不渲染（“刷新才显示”）。
      // marker replay 若自行改写消息会先广播并推进版本，此时不再双发。
      if (versionAfterMessages !== versionBefore && this.stateVersion === versionAfterMessages) {
        this.notifyMessageMetadataChanged()
      }
    }
    if (!forceMessages && markers && summary.count === localEnd) {
      finish()
      return
    }

    if (typeof summary.count === 'number' && summary.count < localEnd) {
      // Server truncated below the visible end (rollback/clear/compaction):
      // the incremental tail does not apply — refetch everything and replace.
      const all = await this.fetchAllMessagesFromServer()
      if (!isCurrent()) return
      if (all === null) {
        // 全量重拉失败（异常或非 2xx 页）：与拉尾同口径退避重试。
        this.scheduleMessageReconcileRetry(summary, markers, forceMessages, retryAttempt)
        return
      }
      this.state.messages = all
      // The refetch restored the full list, so the window offset no longer applies.
      this.messageWindowOffset = 0
      this.state.contextUsage = null
      this.stateVersion++
      finish()
      return
    }

    // When the counts already match, the final text may have replaced the last
    // message in place. Only then re-read that message; a larger server count
    // still means the missing tail starts after the local list.
    // `localEnd` (not `localCount`) so a tail window asks the server from the
    // right index instead of restarting at the window length.
    const summaryCount = typeof summary.count === 'number' ? summary.count : undefined
    const after = forceMessages && summaryCount === localEnd
      ? Math.max(windowOffset, localEnd - 1)
      : localEnd
    let page: SessionMessagesPage | null
    try {
      page = await this.fetchMessagesFromServer(after)
    } catch (error) {
      logger.warn('Message tail reconcile fetch failed', {
        sessionId: this.sessionId,
        attempt: retryAttempt,
        error: error instanceof Error ? error.message : String(error),
      })
      this.scheduleMessageReconcileRetry(summary, markers, forceMessages, retryAttempt)
      return
    }
    if (!isCurrent()) return
    if (!page) {
      // 拉尾瞬时失败（网络仍抖动）：按退避表重试。静默放弃会让断连窗口
      // 丢失的收尾帧把最终回答永久留在服务端（“刷新才看到”的根因）。
      this.scheduleMessageReconcileRetry(summary, markers, forceMessages, retryAttempt)
      return
    }
    if (this.messageReconcileRetryTimer !== null) {
      clearTimeout(this.messageReconcileRetryTimer)
      this.messageReconcileRetryTimer = null
    }
    if (page.count < after) {
      // Server has fewer messages than the client assumed (rollback without a
      // summary count update): full refetch replace.
      const all = await this.fetchAllMessagesFromServer()
      if (!isCurrent()) return
      if (all === null) {
        this.scheduleMessageReconcileRetry(summary, markers, forceMessages, retryAttempt)
        return
      }
      this.state.messages = all
      this.messageWindowOffset = 0
      this.state.contextUsage = null
      this.stateVersion++
      finish()
      return
    }
    if (page.messages.length > 0) {
      const merged = mergeWindowedMessages(this.state.messages, windowOffset, after, page.messages)
      if (JSON.stringify(merged) !== JSON.stringify(this.state.messages)) {
        this.state.messages = merged
        this.state.contextUsage = null
        this.stateVersion++
      }
    }
    if (page.hasMore && page.messages.length > 0) {
      // 服务端 /messages 单页上限 500：断连窗口丢多条消息时尾部可能跨页。
      // 本地 count 已随本页前进，整体重跑拉下一页；预算重置（每页各持有
      // 完整重试表），后续页失败自然进 scheduleMessageReconcileRetry。
      return this.reconcileMessagesFromSummary(summary, markers, forceMessages, 0)
    }
    finish()
  }

  private async _doRefreshStateFromServer(options?: { notify?: boolean; forceMessages?: boolean }) {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(this.sessionId)}/state`
    try {
      // Snapshot the message version and the goal watermark before the async
      // gap. The message version guards the message list; the goal watermark
      // independently guards the goal, so a goal_updated SSE frame that lands
      // while this fetch is in flight is not overwritten by an older snapshot
      // (and, because goal frames never bump stateVersion, the fetched
      // messages are still applied).
      const versionBeforeFetch = this.stateVersion
      const goalSeqBeforeFetch = this.goalStateController.capture()
      const { response: res, body } = await fetchJsonWithTimeout<ServerAgentStateSnapshot>(url, STATE_REQUEST_TIMEOUT_MS)
      if (!res.ok) {
        // If the session no longer exists (e.g. destroyed by idle timeout),
        // stop streaming so the UI doesn't get stuck showing a Stop button.
        if (res.status === 404 && this.state.isStreaming) {
          this.state.isStreaming = false
          this.stopStateWatchdog()
          this.emitToListeners({ type: 'agent_end', messages: this.state.messages })
        }
        return
      }
      const state = body ?? {}
      const serverStateVersion = typeof state.stateVersion === 'number' && Number.isFinite(state.stateVersion)
        ? state.stateVersion
        : undefined
      if (serverStateVersion !== undefined && serverStateVersion < this.lastServerStateVersion) {
        // Version regression: the message list in this snapshot is stale, but a
        // same-goal strictly-newer revision still wins for the goal card.
        this.goalStateController.adoptNewerRevision(state.goal, goalSeqBeforeFetch)
        return
      }

      // Snapshot-based staleness guard: any state write that happens while
      // this fetch was in flight (a concurrent SSE event that already advanced
      // this.stateVersion) discards the result — the newer event wins.
      if (versionBeforeFetch !== this.stateVersion) {
        // A concurrent SSE frame already owns the message list; the snapshot is
        // discarded for messages, but a same-goal strictly-newer revision is
        // still adopted so a goal change is not lost to the race.
        this.goalStateController.adoptNewerRevision(state.goal, goalSeqBeforeFetch)
        return
      }
      // Capture whether the server reports the same version we already
      // applied (cache-hit calibration) before advancing the watermark.
      const versionMatchesLocal = serverStateVersion !== undefined && serverStateVersion === this.lastServerStateVersion
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
        if (JSON.stringify(this.state.messages) !== JSON.stringify(state.messages)) {
          this.state.messages = state.messages
          this.stateVersion++
          this.notifyMessageMetadataChanged()
        }
        this.state.contextUsage = state.contextUsage !== undefined ? state.contextUsage : null
      } else if (!state.messages && state.messagesSummary) {
        this.acceptGoalIterationMarkerSnapshot(state.goalIterationMarkers)
        // Split session: the state frame only carries a count summary. Fetch
        // and merge the missing tail (or refetch all when the server
        // truncated). The reconcile itself snapshots stateVersion before the
        // async gap, so concurrent SSE updates still win.
        const summaryCount = state.messagesSummary.count
        if (!options?.forceMessages && versionMatchesLocal
          && typeof summaryCount === 'number' && summaryCount === this.state.messages.length) {
          // Unchanged server version + matching summary count: the local
          // message list (e.g. hydrated from the snapshot cache) is already
          // in sync — skip the /messages fetch. forceMessages keeps the
          // explicit syncState behaviour unchanged.
        } else {
          await this.reconcileMessagesFromSummary(state.messagesSummary, state.goalIterationMarkers, options?.forceMessages)
        }
      }
      if (state.messages) this.acceptFullGoalIterationMarkerSnapshot(state.messages)
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
      // /state is a full snapshot: absence of the flag means healthy.
      this.state.persistDegraded = state.persistDegraded === true ? true : undefined
      if (state.source !== undefined) {
        this.sessionSource = state.source || undefined
      }
      if (state.goal !== undefined) {
        const goalResult = this.goalStateController.adopt(normalizeGoalState(state.goal), goalSeqBeforeFetch)
        // HTTP refresh (syncState / watchdog / agent_end fallback) must notify
        // goal subscribers even when no SSE frame follows; a snapshot that lost
        // the race against a newer goal update reports `changed: false`.
        if (goalResult.changed) this.notifyGoalChanged()
      }
      if (state.isStreaming !== undefined) {
        const wasStreaming = this.state.isStreaming
        this.state.isStreaming = Boolean(state.isStreaming)
        if (state.isStreaming) {
          this.state.errorMessage = undefined
          if (!wasStreaming) {
            this.emitToListeners({ type: 'agent_start' })
          }
        } else {
          this.stopStateWatchdog()
          this.state.pendingToolApproval = null
          this.state.pendingAutoCompactApproval = null
          this.state.pendingAsk = null
        }
        if (options?.notify && wasStreaming && !state.isStreaming) {
          this.stateVersion++
          this.emitToListeners({ type: 'agent_end', messages: this.state.messages })
          return
        }
      }
      if (options?.notify) {
        if (state.isStreaming && shouldReplaceMessages) {
          const message = this.state.messages[this.state.messages.length - 1]
          if (message) {
            this.emitToListeners({ type: 'message_update', message })
          }
        } else if (!state.isStreaming) {
          this.emitToListeners({ type: 'message_end' })
        }
      }
    } catch {
      // ignore
    }
  }

  // --- Static factories ---

  /**
   * 只读视图加载：`GET /api/sessions/:id/view`。
   *
   * 与 `restore` 的区别是**不触发服务端 agent 运行时重建**（不跑
   * `buildSystemPrompt` / `createServerTools` / MCP 连接）。返回的快照足够
   * 渲染整段历史对话，供首屏直接使用；运行时能力由 `refreshStateFromServer`
   * 在后台补齐（`/state` 是只读 GET，冷会话会 restore，但那时用户已经看到内容）。
   *
   * 失败（404 / 网络）抛错，由调用方决定是否退回 `restore`。
   */
  static async loadView(
    sessionId: string,
    config: { baseUrl?: string; signal?: AbortSignal } = {},
  ): Promise<{ agent: ServerAgent; snapshot: ServerAgentStateSnapshot }> {
    const baseUrl = config.baseUrl ?? ''
    const { response, body } = await fetchJsonWithTimeout<ServerAgentStateSnapshot & { error?: string }>(
      `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/view`,
      STATE_REQUEST_TIMEOUT_MS,
      { method: 'GET', signal: config.signal },
    )
    if (!response.ok) {
      throw new Error(body?.error || `Failed to load session view: HTTP ${response.status}`)
    }
    if (config.signal?.aborted) throw config.signal.reason ?? new DOMException('Aborted', 'AbortError')

    const snapshot = body ?? {}
    if (!Array.isArray(snapshot.messages)) snapshot.messages = []
    const agent = new ServerAgent({
      sessionId,
      baseUrl,
      initialState: initialStateFromSnapshot(snapshot),
    })
    // 尾部窗口：remember where the local list starts in the server's full list.
    // Every incremental reconcile assumes "local index == server index"; with a
    // window that only holds when the offset is recorded here.
    const summaryCount = typeof snapshot.messagesSummary?.count === 'number' ? snapshot.messagesSummary.count : undefined
    if (summaryCount !== undefined && summaryCount > snapshot.messages.length) {
      agent.messageWindowOffset = summaryCount - snapshot.messages.length
    }
    agent.sessionCacheMetadata = snapshotForCache(snapshot as Record<string, unknown>).snapshot
    agent.scheduleSessionMessageCacheWrite()
    logger.debug('Loaded session view', {
      sessionId,
      messageCount: snapshot.messages.length,
      totalMessageCount: summaryCount,
    })
    return { agent, snapshot }
  }

  static async restore(
    sessionId: string,
    config: { baseUrl?: string; signal?: AbortSignal } = {},
  ): Promise<{ agent: ServerAgent; snapshot: ServerAgentStateSnapshot }> {
    const baseUrl = config.baseUrl ?? ''
    const serverKey = resolveServerCacheKey(baseUrl)

    // Cache hit fast path: hydrate from the local IndexedDB snapshot and
    // calibrate in the background through a lightweight GET /state (never a
    // second POST /restore). The server remains authoritative — any cache
    // miss / empty snapshot falls through to the original restore flow.
    if (!config.signal?.aborted) {
      const cached = await readSessionMessageSnapshot(serverKey, sessionId)
      if (cached && cached.messages.length > 0) {
        const stateSnapshot = cachedSnapshotToStateSnapshot(cached)
        const agent = new ServerAgent({
          sessionId,
          baseUrl,
          initialState: initialStateFromSnapshot(stateSnapshot),
        })
        agent.sessionCacheMetadata = cached.snapshot
        void agent.refreshStateFromServer({ notify: true, forceMessages: false })
          .catch(() => {})
          .then(() => agent.scheduleSessionMessageCacheWrite())
        return { agent, snapshot: stateSnapshot }
      }
    }

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
      snapshot.messages = mergeGoalIterationMarkers(await fetchAllSessionMessages(baseUrl, sessionId), snapshot.goalIterationMarkers)
    }
    const agent = new ServerAgent({
      sessionId,
      baseUrl,
      initialState: initialStateFromSnapshot(snapshot),
    })
    agent.sessionCacheMetadata = snapshotForCache(snapshot as Record<string, unknown>).snapshot
    agent.scheduleSessionMessageCacheWrite()
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

    const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: config.scope ?? 'global',
        projectId: config.projectId,
        source: config.source,
        accessMode: config.accessMode,
        yoloMode: config.yoloMode ?? agentAccessModeToYoloMode(normalizeAgentAccessMode(config.accessMode)),
        modelRef: config.model ? modelReferenceFromModel(config.model) : undefined,
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
      const { response: stateRes, body } = await fetchJsonWithTimeout<Record<string, unknown>>(
        `${baseUrl}/api/agents/${encodeURIComponent(sessionId)}/state`,
        STATE_REQUEST_TIMEOUT_MS,
      )
      if (stateRes.ok) serverState = body ?? {}
    } catch { /* ignore */ }
    if (!Array.isArray(serverState.messages) && (serverState as { messagesSummary?: unknown }).messagesSummary) {
      serverState.messages = mergeGoalIterationMarkers(await fetchAllSessionMessages(baseUrl, sessionId), (serverState as ServerAgentStateSnapshot).goalIterationMarkers)
    }

    const agent = new ServerAgent({
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
        pendingToolCalls: (serverState.pendingToolCalls ?? []) as string[],
        errorMessage: serverState.errorMessage as string | undefined,
        contextCompaction: serverState.contextCompaction as ServerAgentContextCompaction | null | undefined,
        contextUsage: serverState.contextUsage as ServerAgentContextUsage | null | undefined,
        pendingToolApproval: serverState.pendingToolApproval as ServerAgentPendingToolApproval | null | undefined,
        pendingAutoCompactApproval: serverState.pendingAutoCompactApproval as ServerAgentPendingAutoCompactApproval | null | undefined,
        persistDegraded: serverState.persistDegraded === true ? true : undefined,
        source: (serverState.source ?? config.source) as string | undefined,
        stateVersion: serverState.stateVersion as number | undefined,
      },
    })
    agent.sessionCacheMetadata = snapshotForCache(serverState).snapshot
    agent.scheduleSessionMessageCacheWrite()
    return agent
  }
}
