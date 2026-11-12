import type { AgentEvent, AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { agentAccessModeFromYoloMode, agentAccessModeToYoloMode, normalizeAgentAccessMode } from '@/lib/agent-access-mode'
import type { AgentAccessMode } from '@/lib/agent-access-mode'
import { normalizeGoalState, type GoalActionOptions, type GoalAction, type GoalState } from '@/lib/goal'
import { t } from '@/lib/i18n'
import { logger } from '@/lib/logger'
import { modelReferenceFromModel } from '../model-reference'
import { getCachedToolDisplaySettings } from '@/lib/tool-display-settings'
import { normalizeSelectedCapabilities } from '@/lib/selected-capabilities'
import { SubagentRunEventPublisher } from '../subagent-run-detail'
import { WorkflowAgentRunEventPublisher } from '../workflow-agent-run-events'
import { globalAgentSseClient } from '../global-agent-sse-client'
import { GoalStateController } from '../goal-state-controller'
import {
  applyMessageLogOp,
  createMessageLogWindow,
  type MessageLogApplyResult,
  type MessageLogOp,
} from '../message-log'
import type { SessionLeaseSnapshot } from '../session-lease-client'
import { SessionLeaseController } from '../session-lease-controller'
import type {
  ServerAgentContextCompaction,
  ServerAgentContextUsage,
  ServerAgentAskAnswer,
  ServerAgentConfig,
  ServerTurnRollbackPreview,
  ServerTurnRollbackResult,
  ServerRollbackResult,
  FileContextReference,
  PromptCapabilitySelection,
  GoalIterationMarkerSnapshot,
  ServerAgentStateSnapshot,
  ServerAgentEvent,
  ServerAgentLocalEvent,
  ServerAgentWireEvent,
} from '../server-agent-types'
import type { PromptCapabilitySelection as StashCapability } from '../server-agent-types'
import type { ServerAgentCore, ServerAgentState } from './core'
import { answerAsk as answerAskAction, approveToolCall as approveToolCallAction, rejectToolCall as rejectToolCallAction } from './approval-actions'
import { refreshGoalForSave as refreshGoalForSaveAction, updateGoal as updateGoalAction } from './goal-actions'
import {
  acceptFullGoalIterationMarkerSnapshot as acceptFullGoalIterationMarkers,
  acceptGoalIterationMarkerSnapshot as acceptGoalIterationMarkers,
  replayGoalIterationMarkers as replayGoalIterationMarkersAction,
} from './goal-iteration-markers'
import { ensureFullHistory as ensureFullHistoryAction, hydrateFullHistory as hydrateFullHistoryAction, reconcileMessagesFromSummary as reconcileMessagesAction } from './history-reconcile'
import {
  abortAgentRun,
  continueAgentRun,
  followUpAgentMessage,
  retryFailedPrompt,
  serverAgentPrompt,
  steerAgentMessage,
} from './prompt-actions'
import {
  executeTurnRollback,
  fetchTurnRollbackPreview,
  rollbackSession,
  trimTrailingMessages as trimTrailingMessagesAction,
  type AgentHttpTarget,
} from './rollback-actions'
import { handleServerAgentSseEvent } from './sse-dispatch'
import { doRefreshStateFromServer, doRefreshStatusFromServer } from './state-sync'
import { createSession, loadSessionView, restoreSession, type AgentFactoryHooks } from './factories'

// ---------------------------------------------------------------------------
// ServerAgent - Agent-compatible proxy that delegates to the server
// ---------------------------------------------------------------------------

const SSE_WATCHDOG_INTERVAL_MS = 5000
const SSE_SILENCE_RECOVERY_MS = 15000

export class ServerAgent {
  // --- Public state (mutable, AgentInterface-compatible) ---
  state: ServerAgentState
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
   * 本地 `state.messages` 里第一条消息对应的服务端**绝对 seq**。
   *
   * 这是本次重构后唯一的消息坐标。正常 restore/create 路径为 0（本地就是
   * 全量）。只读视图（`loadView`）返回尾部窗口时，它等于服务端给的
   * `messagesAfter`。任何「本地数组长度 == 服务端下标」的假设都必须换成
   * `messageBaseSeq + index`，否则窗口态会拉错位置或误判截断。
   *
   * 读写都只经过 `applyLog()`：它保证 `messages` 与 `baseSeq` 成对更新，
   * 不再有「只换了数组、忘了偏移」的半截状态。
   */
  private messageBaseSeq = 0
  /**
   * 服务端消息日志版本（见 `server/message-log.mjs`）：只在消息数组真的变化
   * 时递增，与 `stateVersion`（每个事件都 +1）分离。0 表示未知。
   */
  private messageLogVersion = 0
  /** `ensureFullHistory` 的可中断等待句柄；dispose 时立即放行并清定时器。 */
  private historyHydrateWaiter: { timer: ReturnType<typeof setTimeout>; resolve: () => void } | null = null
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
  /**
   * 本地已经发起、但服务端还没确认「本轮已开始」的回合。
   *
   * `isStreaming` 是**服务端会话的运行状态**，客户端只在「点发送到服务端确认」
   * 这几百毫秒里乐观地先置 true。问题在于另一条连接上可能还有上一个回合的
   * 收尾帧（回滚、停止都会广播 `agent_end`）在飞：它描述的是「上一轮结束了」，
   * 客户端此刻却已经开了新的一轮。没有这个标记时，那条迟到的结束帧会把刚点
   * 亮的按钮打回「发送」，而服务端的新一轮正在照常输出，表现为「按钮不转、
   * 对话却有回复」。
   *
   * 规则只有一条：任何「结束」在标记为 true 期间都不属于当前这一轮，忽略；
   * 收到任何权威的「正在运行」信号（或本地失败/重置）才清除标记。
   */
  private pendingPrompt = false
  // Retain accepted marker metadata for identity-checked replay as anchors arrive;
  // goal_updated deliberately does not advance either message guard.
  private latestGoalIterationMarkers?: GoalIterationMarkerSnapshot[]

  /**
   * 内部协作面：把私有状态以受控方式开放给 `server-agent/` 目录内的职责
   * 模块（事件分发、状态同步、历史补齐、HTTP 动作）。构建一次、终身复用，
   * 成员全部是本类字段/方法的引用，不复制任何状态。
   */
  private readonly core: ServerAgentCore

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

    this.core = ServerAgent.buildCore(this)

    this.unsubscribeSse = globalAgentSseClient.subscribe(this.sessionId, this.baseUrl, (event) => {
      this.handleSseEvent(event)
    })
    if (this.state.isStreaming) this.startStateWatchdog()
  }

  /** 以闭包把私有字段/方法接成 `ServerAgentCore`（见 `core.ts` 的职责约定）。 */
  private static buildCore(agent: ServerAgent): ServerAgentCore {
    return {
      get sessionId() { return agent.sessionId },
      get baseUrl() { return agent.baseUrl },
      get state() { return agent.state },
      get sessionSource() { return agent.sessionSource },
      set sessionSource(value) { agent.sessionSource = value },
      get disposed() { return agent.disposed },
      get pendingPrompt() { return agent.pendingPrompt },
      set pendingPrompt(value) { agent.pendingPrompt = value },
      get messageBaseSeq() { return agent.messageBaseSeq },
      set messageBaseSeq(value) { agent.messageBaseSeq = value },
      get stateVersion() { return agent.stateVersion },
      set stateVersion(value) { agent.stateVersion = value },
      get lastServerStateVersion() { return agent.lastServerStateVersion },
      set lastServerStateVersion(value) { agent.lastServerStateVersion = value },
      get lastSseEventAt() { return agent.lastSseEventAt },
      set lastSseEventAt(value) { agent.lastSseEventAt = value },
      get syncingThinkingLevel() { return agent._syncingThinkingLevel },
      set syncingThinkingLevel(value) { agent._syncingThinkingLevel = value },
      get messageReconcileRetryTimer() { return agent.messageReconcileRetryTimer },
      set messageReconcileRetryTimer(value) { agent.messageReconcileRetryTimer = value },
      get historyHydrateWaiter() { return agent.historyHydrateWaiter },
      set historyHydrateWaiter(value) { agent.historyHydrateWaiter = value },
      get latestGoalIterationMarkers() { return agent.latestGoalIterationMarkers },
      set latestGoalIterationMarkers(value) { agent.latestGoalIterationMarkers = value },
      get goalStateController() { return agent.goalStateController },
      get sessionLeaseController() { return agent.sessionLeaseController },
      get subagentRunPublisher() { return agent.subagentRunPublisher },
      get workflowAgentRunPublisher() { return agent.workflowAgentRunPublisher },
      canWrite: () => agent.canWrite(),
      writeHeaders: () => agent.writeHeaders(),
      applyServerStreaming: (next) => agent.applyServerStreaming(next),
      applyLog: (op) => agent.applyLog(op),
      localMessageEndSeq: () => agent.localMessageEndSeq(),
      emitToListeners: (event) => agent.emitToListeners(event),
      forwardWireEvent: (event) => agent.forwardWireEvent(event),
      notifyMessageMetadataChanged: () => agent.notifyMessageMetadataChanged(),
      notifyGoalChanged: () => agent.notifyGoalChanged(),
      noteSseEvent: (event) => agent.noteSseEvent(event),
      startStateWatchdog: () => agent.startStateWatchdog(),
      stopStateWatchdog: () => agent.stopStateWatchdog(),
      refreshStateFromServer: (options) => agent.refreshStateFromServer(options),
      reconcileMessagesFromSummary: (summary, markers, forceMessages, retryAttempt) => agent.reconcileMessagesFromSummary(summary, markers, forceMessages, retryAttempt),
      syncState: () => agent.syncState(),
      acceptGoalIterationMarkerSnapshot: (markers) => agent.acceptGoalIterationMarkerSnapshot(markers),
      acceptFullGoalIterationMarkerSnapshot: (messages) => agent.acceptFullGoalIterationMarkerSnapshot(messages),
      replayGoalIterationMarkers: () => agent.replayGoalIterationMarkers(),
      prompt: (input, options) => agent.prompt(input, options),
      setNextPromptCapabilities: (capabilities) => agent.setNextPromptCapabilities(capabilities),
      setNextPromptContextReferences: (references, onConsumed) => agent.setNextPromptContextReferences(references, onConsumed),
      consumePromptStash: () => agent.consumePromptStash(),
    }
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

  /** 原子取出并消费本轮 prompt 暂存（capabilities / contextReferences / plan 命令）。 */
  private consumePromptStash(): {
    selectedCapabilities: StashCapability[]
    contextReferences: FileContextReference[]
    selectedCommand: { type: 'plan' } | undefined
  } {
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
    return { selectedCapabilities, contextReferences, selectedCommand }
  }

  /**
   * `messageAlreadyInState`：Deferred 会话把用户已经看到的那条乐观消息交接给
   * 刚创建的真实 agent 后（见 `useAgentManager.createAgent` 的
   * `handoffMessages`）走这条路径。消息已经是 `state.messages` 的最后一项，
   * 再追加一次会让同一句话出现两遍，失败回滚也会删错一条，所以这里复用它。
   */
  /**
   * 应用服务端给出的一手运行状态（SSE `state` 帧、`/state`、`/status`）。
   *
   * - `true`：本轮已在服务端开跑，清掉未确认标记。
   * - `false`：只有在「没有未确认回合」时才成立。否则这条结束属于上一轮，
   *   它既不能写状态，也不该让调用方做收尾（返回 `false`）。
   *
   * 这是 `state.isStreaming` 唯一的服务端写入口：把「谁是权威」和「什么时候
   * 不该信」放在同一个判断里，调用点不需要各自记规则。
   */
  private applyServerStreaming(next: boolean): boolean {
    if (next) {
      this.pendingPrompt = false
      this.state.isStreaming = true
      return true
    }
    if (this.pendingPrompt) return false
    this.state.isStreaming = false
    return true
  }

  /**
   * 发送一条用户消息（实现见 `server-agent/prompt-actions.ts`）。
   * 返回值契约：`true` = 服务端已接受；`false` = 没有发出去，调用方必须保留。
   */
  async prompt(
    input: string | AgentMessage | AgentMessage[],
    options?: { messageAlreadyInState?: boolean },
  ): Promise<boolean> {
    return serverAgentPrompt(this.core, input, options)
  }

  /**
   * 重试一条「发送失败」的错误消息（实现见 `server-agent/prompt-actions.ts`）。
   */
  async retryFailedPrompt(errorEntry: AgentMessage): Promise<boolean> {
    return retryFailedPrompt(this.core, errorEntry)
  }

  abort(): void {
    abortAgentRun(this.core)
  }

  /**
   * Queue a steering message and show it in the conversation immediately
   * （实现见 `server-agent/prompt-actions.ts`，契约同 `prompt`）。
   */
  async steer(message: AgentMessage): Promise<boolean> {
    return steerAgentMessage(this.core, message)
  }

  followUp(message: AgentMessage): void {
    followUpAgentMessage(this.core, message)
  }

  reset(): void {
    // 清空会话必须同时清坐标：否则复用实例时 baseSeq 还停在旧窗口起点，
    // 下一次增量会把消息写进不存在的下标（旧实现的半截状态之一）。
    this.state.messages = []
    this.messageBaseSeq = 0
    this.messageLogVersion = 0
    this.state.errorMessage = undefined
    this.pendingPrompt = false
    this.state.isStreaming = false
    this.state.streamingMessage = undefined
    this.state.pendingToolCalls = new Set()
    this.state.pendingToolApproval = null
    this.state.compactionNotice = null
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
   * Roll back from a message index on the authoritative server state
   * （实现见 `server-agent/rollback-actions.ts`；坐标口径与广播收口在那里）。
   */
  async rollback(messageIndex: number): Promise<ServerRollbackResult> {
    return rollbackSession(this.core, messageIndex)
  }

  /**
   * 本地乐观截断尾部（重试的「先剪再续」半步，实现见
   * `server-agent/rollback-actions.ts`）。
   */
  trimTrailingMessages(keepCount: number): void {
    trimTrailingMessagesAction(this.core, keepCount)
  }

  /** 每轮产物卡「撤销本轮」预检：只读安全检查；执行必须使用预检返回的 revision。 */
  async getTurnRollbackPreview(turnIds: string[], signal?: AbortSignal): Promise<ServerTurnRollbackPreview> {
    return fetchTurnRollbackPreview(this.httpTarget(), turnIds, signal)
  }

  /**
   * 轮级撤销执行：200 = completed/partial；409 = revision 过期（预览已失效）；
   * 500 = 失败。网络/超时异常无法确认服务端是否已写入，同样按错误抛出（带 status）。
   */
  async rollbackTurn(turnIds: string[], revision: string, signal?: AbortSignal): Promise<ServerTurnRollbackResult> {
    return executeTurnRollback(this.httpTarget(), turnIds, revision, signal)
  }

  /**
   * Continue generation from the current last message (retry / regenerate)
   * （实现见 `server-agent/prompt-actions.ts`）。
   */
  async continue(appendMessage?: AgentMessage): Promise<void> {
    return continueAgentRun(this.core, appendMessage)
  }

  /**
   * Approve a pending tool call so it can execute
   * （实现见 `server-agent/approval-actions.ts`）。
   */
  async approveToolCall(toolCallId: string): Promise<void> {
    return approveToolCallAction(this.core, toolCallId)
  }

  /**
   * Reject a pending tool call, skipping its execution
   * （实现见 `server-agent/approval-actions.ts`）。
   */
  async rejectToolCall(toolCallId: string): Promise<void> {
    return rejectToolCallAction(this.core, toolCallId)
  }

  /**
   * Answer or skip a pending ask_user call
   * （实现见 `server-agent/approval-actions.ts`；`remark` 是评审步骤的自由备注）。
   */
  async answerAsk(askId: string, payload: { answers?: ServerAgentAskAnswer[]; skipped?: boolean; remark?: string } = {}): Promise<void> {
    return answerAskAction(this.core, askId, payload)
  }

  /**
   * Post a goal action (confirm/pause/resume/cancel/revise/accept)
   * （实现见 `server-agent/goal-actions.ts`；过时响应与跨 id 替换的守卫规则在那里）。
   */
  async updateGoal(action: GoalAction, objective?: string, options?: GoalActionOptions): Promise<GoalState | null> {
    return updateGoalAction(this.core, action, objective, options)
  }

  /** Save-only reconciliation: never changes message/stream ordering or swallows failures. */
  async refreshGoalForSave(goalId: string, signal: AbortSignal): Promise<{ isStreaming: boolean }> {
    return refreshGoalForSaveAction(this.core, goalId, signal)
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
    if (this.historyHydrateWaiter !== null) {
      // 放行挂起的 `ensureFullHistory`，让它在下一轮 `disposed` 检查里退出。
      clearTimeout(this.historyHydrateWaiter.timer)
      this.historyHydrateWaiter.resolve()
      this.historyHydrateWaiter = null
    }
    this.statusPromise = null
    this.subagentRunPublisher.dispose()
    this.workflowAgentRunPublisher.dispose()
    this.unsubscribeSse?.()
    this.unsubscribeSse = undefined
    this.listeners.clear()
  }

  private notifyMessageMetadataChanged(): void {
    this.emitToListeners({ type: 'message_metadata_updated' })
  }

  private acceptFullGoalIterationMarkerSnapshot(messages: AgentMessage[]): void {
    acceptFullGoalIterationMarkers(this.core, messages)
  }

  private acceptGoalIterationMarkerSnapshot(markers?: GoalIterationMarkerSnapshot[]): void {
    acceptGoalIterationMarkers(this.core, markers)
  }

  private replayGoalIterationMarkers(): void {
    replayGoalIterationMarkersAction(this.core)
  }

  /**
   * 把一条消息日志操作应用到本地窗口。**所有**消息写入都必须走这里。
   *
   * 职责边界：
   * - 只改 `state.messages` / `messageBaseSeq` / `messageLogVersion` 三者，并
   *   保证它们成对更新（旧实现有 8 处「只换数组、忘了偏移」的半截状态）；
   * - 不推进 `stateVersion`、不广播——由调用方按各自语义决定；
   * - `outcome === 'gap'` 时窗口保持不变并触发一次强制对账，绝不猜测拼接。
   */
  private applyLog(op: MessageLogOp<AgentMessage>): MessageLogApplyResult<AgentMessage> {
    const window = createMessageLogWindow(this.messageBaseSeq, this.state.messages, this.messageLogVersion)
    const result = applyMessageLogOp(window, op)
    if (result.outcome === 'gap') {
      logger.debug(`[message-log] gap at seq ${result.gapFrom ?? 0}; forcing reconcile`, { sessionId: this.sessionId })
      void this.refreshStateFromServer({ forceMessages: true }).catch(() => {})
      return result
    }
    this.messageLogVersion = result.window.logVersion
    if (result.outcome === 'applied') {
      this.messageBaseSeq = result.window.baseSeq
      this.state.messages = result.window.messages
    }
    return result
  }

  /** 本地窗口覆盖到的服务端绝对位置（不含），用于和 `messagesSummary.count` 比较。 */
  private localMessageEndSeq(): number {
    return this.messageBaseSeq + this.state.messages.length
  }

  /**
   * 本地消息窗口的**绝对起点**（本地 `state.messages[0]` 对应的会话 seq）。
   *
   * UI 需要把服务端下发的会话绝对坐标（压缩分割线位置、goal 标记等）换算成
   * 本地窗口坐标时读这个值；不要在组件里用「消息条数」反推。
   */
  get messageOffset(): number {
    return this.messageBaseSeq
  }

  // --- SSE event handling ---

  private handleSseEvent(event: Record<string, unknown>) {
    handleServerAgentSseEvent(this.core, event)
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
    this.statusPromise = doRefreshStatusFromServer(this.core).finally(() => {
      this.statusPromise = null
    })
    return this.statusPromise
  }

  async syncState(): Promise<void> {
    await this.refreshStateFromServer({ notify: true, forceMessages: true })
  }

  /**
   * 把尾部窗口补齐为全量消息（实现见 `server-agent/history-reconcile.ts`；
   * `beforeReplace` 在替换前一刻同步调用，供宿主捕获滚动锚点）。
   */
  async hydrateFullHistory(beforeReplace?: () => (() => void) | void): Promise<boolean> {
    return hydrateFullHistoryAction(this.core, beforeReplace)
  }

  /**
   * 收敛循环：反复尝试补齐，直到 `baseSeq === 0` 或退避表耗尽
   * （实现见 `server-agent/history-reconcile.ts`）。
   */
  async ensureFullHistory(beforeReplace?: () => (() => void) | void): Promise<boolean> {
    return ensureFullHistoryAction(this.core, beforeReplace)
  }

  private async refreshStateFromServer(options?: { notify?: boolean; forceMessages?: boolean }) {
    // Deduplicate concurrent refresh requests
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = doRefreshStateFromServer(this.core, options).finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  private reconcileMessagesFromSummary(summary: { count?: number }, markers?: GoalIterationMarkerSnapshot[], forceMessages = false, retryAttempt = 0): Promise<void> {
    return reconcileMessagesAction(this.core, summary, markers, forceMessages, retryAttempt)
  }

  // --- Static factories ---

  /**
   * 把服务端快照的坐标落到实例上：`baseSeq` 与 `logVersion`。
   *
   * 四条构造路径（`loadView` / `restore` 缓存命中 / `restore` 网络 / `create`）
   * 都必须调用。少一条就会出现「消息是尾部窗口、坐标还是 0」的错位状态——
   * 旧实现只有 `loadView` 与缓存命中设了偏移，`restore` 拿到窗口后仍按全量
   * 处理，后续增量必然写错位置。
   */
  private static applySnapshotCoordinates(agent: ServerAgent, snapshot: ServerAgentStateSnapshot): void {
    const messageCount = Array.isArray(snapshot.messages) ? snapshot.messages.length : 0
    const summaryCount = typeof snapshot.messagesSummary?.count === 'number' ? snapshot.messagesSummary.count : undefined
    agent.messageBaseSeq = typeof snapshot.messagesAfter === 'number'
      ? snapshot.messagesAfter
      : (summaryCount !== undefined && summaryCount > messageCount ? summaryCount - messageCount : 0)
    agent.messageLogVersion = typeof snapshot.logVersion === 'number' ? snapshot.logVersion : 0
  }

  /** 工厂钩子：实例化与坐标落地必须留在类上（坐标是私有字段）。 */
  private static readonly factoryHooks: AgentFactoryHooks<ServerAgent> = {
    create: (config) => new ServerAgent(config),
    applyCoordinates: (agent, snapshot) => ServerAgent.applySnapshotCoordinates(agent, snapshot),
  }

  /**
   * 只读视图加载：`GET /api/sessions/:id/view`
   * （实现见 `server-agent/factories.ts`）。
   */
  static async loadView(
    sessionId: string,
    config: { baseUrl?: string; signal?: AbortSignal } = {},
  ): Promise<{ agent: ServerAgent; snapshot: ServerAgentStateSnapshot }> {
    return loadSessionView(sessionId, config, ServerAgent.factoryHooks)
  }

  /**
   * 会话恢复：`POST /api/agents/:id/restore`
   * （实现见 `server-agent/factories.ts`）。
   */
  static async restore(
    sessionId: string,
    config: { baseUrl?: string; signal?: AbortSignal } = {},
  ): Promise<{ agent: ServerAgent; snapshot: ServerAgentStateSnapshot }> {
    return restoreSession(sessionId, config, ServerAgent.factoryHooks)
  }

  /**
   * 新建会话：`POST /api/agents/:id` + 首拉 `/state`
   * （实现见 `server-agent/factories.ts`）。
   */
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
    return createSession(sessionId, config, ServerAgent.factoryHooks)
  }

  /** 轮级回滚 HTTP 目标：只依赖这三项，兼容不经构造函数的原型实例（HTTP-only 测试）。 */
  private httpTarget(): AgentHttpTarget {
    return {
      baseUrl: this.baseUrl,
      sessionId: this.sessionId,
      writeHeaders: () => this.writeHeaders(),
    }
  }
}
