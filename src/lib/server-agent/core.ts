import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { AgentAccessMode } from '@/lib/types'
import type { GoalState } from '@/lib/goal'
import type { GoalStateController } from '../goal-state-controller'
import type { MessageLogApplyResult, MessageLogOp } from '../message-log'
import type { SessionLeaseController } from '../session-lease-controller'
import type { SessionLeaseSnapshot } from '../session-lease-client'
import type { SubagentRunEventPublisher } from '../subagent-run-detail'
import type { WorkflowAgentRunEventPublisher } from '../workflow-agent-run-events'
import type {
  BackgroundCommandSnapshot,
  FileContextReference,
  GoalIterationMarkerSnapshot,
  PromptCapabilitySelection,
  ServerAgentCompactionNotice,
  ServerAgentContextCompaction,
  ServerAgentContextUsage,
  ServerAgentLocalEvent,
  ServerAgentPendingAsk,
  ServerAgentPendingToolApproval,
  ServerAgentWireEvent,
} from '../server-agent-types'

/** 全量状态请求（`/state`、`/restore`、`/view`、`create` 后首拉）的统一超时。 */
export const STATE_REQUEST_TIMEOUT_MS = 30000

/**
 * `ServerAgent.state` 的形状（原为类内联声明，结构逐字保留）。
 *
 * Public state (mutable, AgentInterface-compatible)
 */
export interface ServerAgentState {
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
  /**
   * In-flight compaction notice (summarizing / awaiting user decision).
   * `null` means the pipeline is idle. Always rendered, never inferred from
   * the absence of events.
   */
  compactionNotice?: ServerAgentCompactionNotice | null
  pendingToolApproval?: ServerAgentPendingToolApproval | null
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

/**
 * `ServerAgent` 的内部协作面：门面类在构造时以闭包构建一次，供
 * `src/lib/server-agent/` 目录内的职责模块（事件分发、状态同步、历史补齐、
 * HTTP 动作）访问实例内部状态。**不是**公共 API——`server-agent.ts` 门面
 * 不 re-export 本类型；外部消费方继续只使用 `ServerAgent` 类。
 *
 * 约定：类是这些成员的唯一实现来源；模块只经 `core` 读写，不再各自复制。
 */
export interface ServerAgentCore {
  // --- 只读标识与可变标量（getter/setter 由类提供） ---
  readonly sessionId: string
  readonly baseUrl: string
  readonly state: ServerAgentState
  sessionSource: string | undefined
  readonly disposed: boolean
  /** 本地乐观「本轮已发出、服务端尚未确认」标记（见 ServerAgent.pendingPrompt 注释）。 */
  pendingPrompt: boolean
  /** 本地消息窗口的绝对起点（唯一消息坐标，见 applyLog）。 */
  messageBaseSeq: number
  /** 本地状态写版本：任何状态写入递增，快照式陈旧守卫的依据。 */
  stateVersion: number
  /** 最近一条已采纳 SSE / 状态帧携带的服务端 stateVersion（门闸用）。 */
  lastServerStateVersion: number
  /** 最近一次收到 SSE 帧的时刻（watchdog 静默判定用）。 */
  lastSseEventAt: number
  /** thinkingLevel 服务器回写抑制标记（Proxy set 钩子读）。 */
  syncingThinkingLevel: boolean
  /** 拉尾恢复重试定时器（dispose 或成功后清理）。 */
  messageReconcileRetryTimer: ReturnType<typeof setTimeout> | null
  /** `ensureFullHistory` 的可中断等待句柄；dispose 时立即放行。 */
  historyHydrateWaiter: { timer: ReturnType<typeof setTimeout>; resolve: () => void } | null
  /** 最新已接受的 goal marker 快照（identity 供 reconcile 竞态比对）。 */
  latestGoalIterationMarkers: GoalIterationMarkerSnapshot[] | undefined

  // --- 协作者 ---
  readonly goalStateController: GoalStateController
  readonly sessionLeaseController: SessionLeaseController
  readonly subagentRunPublisher: SubagentRunEventPublisher
  readonly workflowAgentRunPublisher: WorkflowAgentRunEventPublisher

  // --- 类提供的单一实现（模块经此调用，不复制逻辑） ---
  canWrite(): boolean
  writeHeaders(): Record<string, string>
  /** `state.isStreaming` 唯一的服务端写入口（含未确认回合规则）。 */
  applyServerStreaming(next: boolean): boolean
  applyLog(op: MessageLogOp<AgentMessage>): MessageLogApplyResult<AgentMessage>
  localMessageEndSeq(): number
  emitToListeners(event: ServerAgentLocalEvent): void
  forwardWireEvent(event: ServerAgentWireEvent): void
  notifyMessageMetadataChanged(): void
  notifyGoalChanged(): void
  noteSseEvent(event: Record<string, unknown>): boolean
  startStateWatchdog(): void
  stopStateWatchdog(): void
  refreshStateFromServer(options?: { notify?: boolean; forceMessages?: boolean }): Promise<void>
  reconcileMessagesFromSummary(summary: { count?: number }, markers?: GoalIterationMarkerSnapshot[], forceMessages?: boolean, retryAttempt?: number): Promise<void>
  syncState(): Promise<void>
  acceptGoalIterationMarkerSnapshot(markers?: GoalIterationMarkerSnapshot[]): void
  acceptFullGoalIterationMarkerSnapshot(messages: AgentMessage[]): void
  replayGoalIterationMarkers(): void
  prompt(input: string | AgentMessage | AgentMessage[], options?: { messageAlreadyInState?: boolean }): Promise<boolean>
  setNextPromptCapabilities(capabilities: PromptCapabilitySelection[]): void
  setNextPromptContextReferences(references: FileContextReference[], onConsumed?: () => void): void
  /** 原子取出并消费 nextPrompt* / planMode 暂存（含 consumed 回调触发）。 */
  consumePromptStash(): {
    selectedCapabilities: PromptCapabilitySelection[]
    contextReferences: FileContextReference[]
    selectedCommand: { type: 'plan' } | undefined
  }
}
