import type { AgentEvent, AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { AgentAccessMode } from '@/lib/types'
import type { GoalState } from '@/lib/goal'
import type { SelectedCapability } from '@/lib/selected-capabilities'

/** Events constructed locally, including the existing payload-free UI invalidations. */
export type ServerAgentLocalEvent =
  | AgentEvent
  | { type: 'error'; error: string }
  | { type: 'goal_updated'; goal: GoalState | null }
  | { type: 'message_metadata_updated' }
  | { type: 'message_start' | 'message_end'; message?: never }
  | { type: 'message_update'; message: AgentMessage; assistantMessageEvent?: never }
  | { type: 'agent_end'; messages: AgentMessage[]; errorMessage: string; status: 'error' }

/**
 * Opaque incoming SSE object, not a validated AgentEvent or JSON schema.
 * Even a familiar `type` does not validate its payload; consumers must guard
 * any fields they read. No index signature promises arbitrary field access.
 */
export type ServerAgentWireEvent = { readonly type?: unknown }

/** The honest subscription boundary: local notifications OR unvalidated wire objects. */
export type ServerAgentEvent = ServerAgentLocalEvent | ServerAgentWireEvent

// 连接状态广播：弱网断流期间 UI 据此显示「重新连接中… n/10」等提示。
// reconnecting.unreachableSince：健康探测确认后端不可达的起始时刻（ms），
// UI 据此计算断开时长与提示分层阈值；恢复/重试/断开时清除。
export type SseConnectionStatus =
  | { status: 'reconnecting'; attempt: number; maxAttempts: number; nextRetryAt: number; unreachable?: boolean; unreachableSince?: number }
  | { status: 'connected'; recovered: boolean; restarted?: boolean }
  | { status: 'failed'; maxAttempts: number }

export type ActiveAgentStatus = {
  sessionId: string
  status: string
  title?: string
  scope?: string
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
  skillsTokens?: number
  mcpTokens?: number
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

export type ServerAgentPendingAsk = {
  askId: string
  toolCallId?: string
  questions: Array<{
    question: string
    multiSelect?: boolean
    allowCustom?: boolean
    options?: Array<{ label: string; description?: string }>
  }>
  requestedAt?: number
  expiresAt?: number
}

export type ServerAgentAskAnswer = {
  choices?: string[]
  custom?: string
}

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
    pendingToolCalls?: string[]
    errorMessage?: string
    contextCompaction?: ServerAgentContextCompaction | null
    contextUsage?: ServerAgentContextUsage | null
    pendingToolApproval?: ServerAgentPendingToolApproval | null
    pendingAutoCompactApproval?: ServerAgentPendingAutoCompactApproval | null
    pendingAsk?: ServerAgentPendingAsk | null
    persistDegraded?: boolean
    goal?: GoalState | null
    stateVersion?: number
    /** Session source; `'acp'` marks OpenCode/ACP clients where goal mode is unavailable. */
    source?: string
  }
}

export type ServerFileRollbackPreview = {
  revision: string
  canRollback: boolean
  files: Array<{
    path: string
    relativePath: string
    /** Absent on older servers; individual rollback must stay disabled. */
    revision?: string
    action: 'restore' | 'delete'
    safe: boolean
    reason: string
  }>
  reason?: string
}

export type ServerFileRollbackResult = {
  status: 'partial' | 'completed' | 'blocked' | 'failed'
  restored: number
  removedCreated: number
  errors: Array<{ path: string; message: string }>
  preview: ServerFileRollbackPreview
}

/** 每轮产物卡「撤销本轮」的预检结果（GET rollback-turn/preview）。 */
export type ServerTurnRollbackPreview = {
  revision: string
  /** 回显请求的整轮 turnId 集合（一轮 = 原 run + 重试 run 的全部 turnId）。 */
  turnIds: string[]
  files: Array<{
    path: string
    safe: boolean
    reason: string | null
    action: 'restore' | 'delete'
    /** 该轮新建（true → 撤销即删除）；其余为轮内修改（撤销即恢复到轮前内容）。 */
    created?: boolean
    beforeBytes?: number | null
    afterBytes?: number | null
  }>
}

/** 轮级撤销执行结果（POST rollback-turn）：conflicts 为被跳过的冲突文件。 */
export type ServerTurnRollbackResult = {
  status: 'completed' | 'partial'
  rolledBack: Array<{ path: string; action: 'restore' | 'delete' }>
  conflicts: Array<{ path: string; reason: string | null }>
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

export type FileContextReference = {
  type: 'file'
  projectId: string
  path: string
}

export type PromptCapabilitySelection = SelectedCapability

export type GoalIterationMarkerSnapshot = {
  index: number
  role: string
  id?: string
  timestamp?: number
  quickforgeGoalIteration: Record<string, unknown>
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
  /** Sparse, identity-checked goal metadata retained on split state snapshots. */
  goalIterationMarkers?: GoalIterationMarkerSnapshot[]
  systemPrompt?: string
  model?: Model<Api>
  thinkingLevel?: ThinkingLevel
  accessMode?: AgentAccessMode
  yoloMode?: boolean
  tools?: unknown[]
  contextCompaction?: ServerAgentContextCompaction | null
  contextUsage?: ServerAgentContextUsage | null
  pendingToolApproval?: ServerAgentPendingToolApproval | null
  pendingAutoCompactApproval?: ServerAgentPendingAutoCompactApproval | null
  pendingAsk?: ServerAgentPendingAsk | null
  pendingToolCalls?: string[]
  isStreaming?: boolean
  errorMessage?: string
  /** Server failed to persist recent messages after CAS conflicts. */
  persistDegraded?: boolean
  /** Goal mode state; null/absent means the session has no active goal. */
  goal?: GoalState | null
}
