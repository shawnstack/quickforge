import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { agentAccessModeToYoloMode, normalizeAgentAccessMode, type AgentAccessMode } from '@/lib/types'
import { logger } from '@/lib/logger'
import { modelReferenceFromModel } from '../model-reference'
import { fetchJsonWithTimeout } from '../server-agent-http'
import type {
  ServerAgentConfig,
  ServerAgentContextCompaction,
  ServerAgentContextUsage,
  ServerAgentPendingToolApproval,
  ServerAgentCompactionNotice,
  ServerAgentStateSnapshot,
} from '../server-agent-types'
import type { ServerAgent } from './agent'
import { STATE_REQUEST_TIMEOUT_MS } from './core'
import { mergeGoalIterationMarkers } from './goal-iteration-markers'
import { fetchAllSessionMessages } from './messages-channel'
import { initialStateFromSnapshot } from './snapshot'

/**
 * 构造钩子：实例化与快照坐标落地留在类上（`applySnapshotCoordinates` 读写
 * 类的私有消息坐标），工厂函数负责 HTTP、快照规范化与日志。
 */
export type AgentFactoryHooks = {
  create(config: ServerAgentConfig): ServerAgent
  applyCoordinates(agent: ServerAgent, snapshot: ServerAgentStateSnapshot): void
}

/**
 * 只读视图加载：`GET /api/sessions/:id/view`（原 `ServerAgent.loadView`，逐字迁出）。
 *
 * 与 `restore` 的区别是**不触发服务端 agent 运行时重建**（不跑
 * `buildSystemPrompt` / `createServerTools` / MCP 连接）。返回的快照足够
 * 渲染整段历史对话，供首屏直接使用；运行时能力由 `refreshStateFromServer`
 * 在后台补齐（`/state` 是只读 GET，冷会话会 restore，但那时用户已经看到内容）。
 *
 * 失败（404 / 网络）抛错，由调用方决定是否退回 `restore`。
 */
export async function loadSessionView(
  sessionId: string,
  config: { baseUrl?: string; signal?: AbortSignal } = {},
  hooks: AgentFactoryHooks,
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
  const agent = hooks.create({
    sessionId,
    baseUrl,
    initialState: initialStateFromSnapshot(snapshot),
  })
  // 尾部窗口：服务端直接给 `messagesAfter`（绝对 seq），比「总数 - 本地条数」
  // 更可靠 —— 后者在服务端窗口策略变化时会算错。
  hooks.applyCoordinates(agent, snapshot)
  logger.debug('Loaded session view', {
    sessionId,
    messageCount: snapshot.messages.length,
    totalMessageCount: snapshot.messagesSummary?.count,
    messageBaseSeq: agent.messageOffset,
  })
  return { agent, snapshot }
}

/**
 * 会话恢复：`POST /api/agents/:id/restore`（原 `ServerAgent.restore`，逐字迁出）。
 */
export async function restoreSession(
  sessionId: string,
  config: { baseUrl?: string; signal?: AbortSignal } = {},
  hooks: AgentFactoryHooks,
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
    snapshot.messages = mergeGoalIterationMarkers(await fetchAllSessionMessages(baseUrl, sessionId), snapshot.goalIterationMarkers)
  }
  const agent = hooks.create({
    sessionId,
    baseUrl,
    initialState: initialStateFromSnapshot(snapshot),
  })
  // 服务端可能只返回尾部窗口（`projectSessionSnapshot`），坐标必须一起落。
  hooks.applyCoordinates(agent, snapshot)
  logger.debug('Restored ServerAgent', {
    sessionId,
    messageCount: snapshot.messages?.length ?? 0,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
  })
  return { agent, snapshot }
}

/**
 * 新建会话：`POST /api/agents/:id` + 首拉 `/state`（原 `ServerAgent.create`，
 * 逐字迁出）。
 */
export async function createSession(
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
  hooks: AgentFactoryHooks,
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

  const agent = hooks.create({
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
      compactionNotice: serverState.compactionNotice as ServerAgentCompactionNotice | null | undefined,
      pendingToolApproval: serverState.pendingToolApproval as ServerAgentPendingToolApproval | null | undefined,
      persistDegraded: serverState.persistDegraded === true ? true : undefined,
      source: (serverState.source ?? config.source) as string | undefined,
      stateVersion: serverState.stateVersion as number | undefined,
    },
  })
  // 新建会话通常是空消息，但服务端仍按统一快照形状回复（可能带尾部窗口），
  // 坐标一并落地，避免复用实例时的半截状态。
  hooks.applyCoordinates(agent, serverState as ServerAgentStateSnapshot)
  return agent
}
