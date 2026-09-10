import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { Agent } from '@earendil-works/pi-agent-core'
import { streamSimpleWithAiHttpLogging } from './ai-http-logger.mjs'
import { loadSkillToolContext, abortRunningCommand } from './tools/index.mjs'
import { createSkillTools, globalMemoryTool, workspaceTools } from './tools/definitions.mjs'
import { createMcpToolDefinitions, isMcpToolName, subscribeMcpToolsetChanged } from './mcp/registry.mjs'
import { createPluginToolDefinitions, isPluginToolName } from './plugins/registry.mjs'
import { agentProfileSnapshot } from './agent-profiles.mjs'
import { modelBindingFromModel, resolveImplicitModelPreference, resolveModelBinding } from './model-catalog.mjs'
import {
  modelReferenceSnapshot,
  normalizeCapabilityPolicy,
  resolveAgentProfileModel,
  resolveAgentProfileThinkingLevel,
} from './agent-profile-schema.mjs'
import { projectContextFromId, defaultGlobalWorkspaceContext, readProjectConfig } from './project-config.mjs'
import { readStore, atomicUpdate, readSessionValue } from './storage.mjs'
import { readSessionStateRecord, storedMessagesState, sessionMessagesTailDigest } from './session-state-service.mjs'
import { logger } from './utils/logger.mjs'
import { getGlobalMemoryRevision, isGlobalMemoryEnabled } from './global-memory.mjs'
import { buildSystemPrompt, generateAiTitle, generateTitle } from './session-utils.mjs'
import {
  isCompactSummaryMessage,
} from './conversation-compaction.mjs'
import {
  buildAutoCompactLoopMessages,
  maybeAutoCompactSession,
} from './auto-compaction.mjs'
import {
  contextReferencesFromMessage,
  contextReferencesPrompt,
  validatePromptContextReferences,
  validateContextReferences,
  withCanonicalContextReferences,
} from './context-references.mjs'
import { serverConvertToLlm } from './message-converters.mjs'
import { restoreReasoningContentInPayload } from './reasoning-cache.mjs'
import {
  normalizeSelectedCapabilities,
  selectedCapabilitiesFromMessage,
  selectedCapabilityPrompt,
  withCanonicalSelectedCapabilities,
} from './selected-capabilities.mjs'
import { wrapToolDefinition, wrapMcpToolDefinition, wrapPluginToolDefinition, sessionSkillsContext } from './tool-wiring.mjs'
import {
  safeReadTools,
  pendingApprovals,
  pendingAutoCompactApprovals,
  getPendingApprovalForSession,
  getPendingAutoCompactApprovalForSession,
  commandToolPermissionError,
  createCommandToolPermissions,
} from './approval-store.mjs'
import {
  pendingAsks,
  getPendingAskForSession,
} from './ask-store.mjs'

export { getPendingAskForSession, normalizeAskQuestions } from './ask-store.mjs'
import {
  agentSessions,
  pendingRestores,
  stashSubagentErrorDetails,
  takeStashedSubagentErrorDetails,
} from './agent-session-store.mjs'

import { runSubagent } from './agent-subagent-runner.mjs'
import {
  persistSession,
  scheduleSessionPersist,
  flushSessionPersist,
  stripStorageOwnedStateFields,
  canonicalStateJson,
} from './agent-persistence.mjs'

export { persistSessionState } from './agent-persistence.mjs'
import {
  createApprovalPromise,
  createAskUserPromise,
  createAutoCompactApprovalPromise,
} from './agent-approval-orchestrator.mjs'
import { resolveCommandState } from './agent-prompt-commands.mjs'
import { resetSessionCompaction, summarySession, compactSession, clearSession } from './agent-compaction.mjs'
import {
  beginGoalRun,
  clearTerminalGoal,
  configureGoalRunner,
  createGoalReportTool,
  failGoalRunOnPersist,
  finishGoalRun,
  goalPlanningToolBlockReason,
  goalRunSettlementToolBlockReason,
  notifyGoalAbort,
  recordGoalToolExecution,
  sessionGoal,
  stopGoalForSession,
} from './agent-goal-runner.mjs'
import { isGoalActiveStatus, isGoalTerminalStatus, goalAfterRestore, normalizeGoalState } from './agent-goal-state.mjs'

// 访问模式常量与归一化 helper（原独立常量模块随外部运行时接入的删除一并收回至此）。
const AGENT_ACCESS_MODE_DEFAULT = 'default'
const AGENT_ACCESS_MODE_FULL_ACCESS = 'full-access'

function normalizeAccessMode(value, fallback = AGENT_ACCESS_MODE_DEFAULT) {
  if (value === AGENT_ACCESS_MODE_DEFAULT || value === AGENT_ACCESS_MODE_FULL_ACCESS) return value
  if (value === true || value === 'true') return AGENT_ACCESS_MODE_FULL_ACCESS
  if (value === false || value === 'false') return AGENT_ACCESS_MODE_DEFAULT
  if (fallback !== value) return normalizeAccessMode(fallback, AGENT_ACCESS_MODE_DEFAULT)
  return AGENT_ACCESS_MODE_DEFAULT
}

function yoloModeFromAccessMode(accessMode) {
  return normalizeAccessMode(accessMode) === AGENT_ACCESS_MODE_FULL_ACCESS
}

// 内部共享导出（agent-subagent-runner 临时 subagent 能力策略检查使用）
export function hasFullAccess(session) {
  return normalizeAccessMode(session?.accessMode, session?.yoloMode) === AGENT_ACCESS_MODE_FULL_ACCESS
}

import {
  agentEvents,
  emitSessionEvent,
  addToolTimingToEvent,
  updateRuntimeToolExecution,
  messagesWithRuntimeToolExecutions,
  runtimePendingToolCalls,
  updateSessionMessages,
  getSessionContextUsage,
  appendAssistantErrorMessageOnce,
  markLatestAssistantProcessFinished,
  assistantTextMessage,
} from './agent-session-events.mjs'

export {
  agentEvents,
  appendAssistantErrorMessageOnce,
  markLatestAssistantProcessFinished,
  stripSplitSessionState,
} from './agent-session-events.mjs'


// ---------------------------------------------------------------------------
// Tool definitions (server-side, no REST roundtrip)
// ---------------------------------------------------------------------------

// One user-triggered main run (runPrompt) or retry run (continueSession)
// defines one rollback turn. Every journaled write during the run (including
// subagent writes attributed to the parent session) carries the id via the
// tool context; it is cleared when the run ends. A retry generates its own
// id: the frontend rolls a turn back by the group of ids that share one user
// message. Runtime-only on purpose: it must never leak into the persisted
// session state.
const sessionTurnIds = new Map()
export function currentSessionTurnId(sessionId) {
  return sessionTurnIds.get(sessionId) || null
}

// Goal continuations keep the full history and start a fresh turn id; the goal
// runner gets the turn helpers injected so it never imports this module.
configureGoalRunner({
  beginTurn: (sessionId) => {
    const turnId = randomUUID()
    sessionTurnIds.set(sessionId, turnId)
    return turnId
  },
  endTurn: (sessionId, turnId) => {
    if (turnId === undefined || sessionTurnIds.get(sessionId) === turnId) sessionTurnIds.delete(sessionId)
  },
  // The goal_report tool only exists while the session has an active goal, so
  // the tool set is rebuilt whenever that flips (created/confirmed/finished).
  refreshTools: (session) => rebuildSessionTools(session),
  // Workspace exclusivity keys on the normalized workspace path (two projectIds
  // can point at the same directory). Persisted metadata only carries
  // scope/projectId, so the runner asks the manager to resolve the path.
  resolveWorkspaceRoot: async ({ scope, projectId } = {}) => {
    if (scope === 'project' && projectId) {
      try {
        return (await projectContextFromId(projectId))?.workspaceRoot || null
      } catch {
        return null
      }
    }
    return defaultGlobalWorkspaceContext()?.workspaceRoot || null
  },
})

function wrapSubagentToolDefinition(definition, parentSessionId) {
  return {
    ...definition,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const parentSession = agentSessions.get(parentSessionId)
      if (!parentSession) throw new Error('Parent session is no longer active.')
      try {
        const result = await runSubagent(parentSession, toolCallId, params || {}, signal, onUpdate)
        return {
          content: [{ type: 'text', text: result.content }],
          details: result.details,
        }
      } catch (error) {
        // 超时等错误附带的 quickforgeSubagentDetails 由 afterToolCall 取回注入
        // toolResult（pi-agent-core 对抛错 execute 只保留错误文本）。
        if (error && typeof error === 'object' && error.quickforgeSubagentDetails) {
          stashSubagentErrorDetails(toolCallId, error.quickforgeSubagentDetails)
        }
        throw error
      }
    },
  }
}

function wrapAskUserToolDefinition(definition, parentSessionId) {
  return {
    ...definition,
    execute: async (toolCallId, params) => {
      const session = agentSessions.get(parentSessionId)
      if (!session) {
        return {
          content: [{ type: 'text', text: 'No active session for ask_user.' }],
          details: { askId: null, skipped: true },
        }
      }
      return createAskUserPromise(session, toolCallId, params || {})
    },
  }
}

function wrapWorkspaceToolDefinition(definition, context, toolPermissions, options = {}) {
  if (definition.name === 'run_subagent') return wrapSubagentToolDefinition(definition, options.parentSessionId)
  if (definition.name === 'ask_user') return wrapAskUserToolDefinition(definition, options.parentSessionId)
  return wrapToolDefinition(definition, context, toolPermissions)
}

// 内部共享导出：给 toolContext 装「活」的 turnId 访问器，供测试做行为断言。
// 注意不能用对象展开 `...{ get turnId() {...} }`——展开会立即求值 getter
// 并把结果固化成普通属性，使每会话构建一次的 toolContext 永久停在构建时的
// turnId（主 Agent 路径恒为 null，轮级撤销因此不可见）。
export function attachTurnIdGetter(context, getTurnId) {
  if (!getTurnId) return context
  Object.defineProperty(context, 'turnId', {
    get: () => getTurnId() || null,
    enumerable: true,
    configurable: true,
  })
  return context
}

// 内部共享导出（模块拆分临时暴露给 agent-subagent-runner，工具构建块迁移后收回）
export async function createServerTools(projectId, projectContext, skillsContext, includeWorkspaceTools, toolPermissions, options = {}) {
  const {
    allowedToolNames = null,
    includeSubagentTool = true,
    includeMcpTools = true,
    includePluginTools = true,
    includeSkillTools = true,
    includeGoalTool = false,
    goalSession = null,
    mcpWaitForConnections = true,
    parentSessionId = null,
    sessionId = null,
    scope = 'global',
    getTurnId = null,
  } = options
  const allowedTools = allowedToolNames ? new Set(allowedToolNames) : null
  const isAllowed = (definition) => !allowedTools || allowedTools.has(definition.name)

  const skillTools = includeSkillTools
    ? await createSkillTools({
        globalSkillNames: skillsContext.globalSkillNames,
        projectSkillNames: skillsContext.projectSkillNames,
        workspaceRoot: projectContext?.workspaceRoot,
      })
    : []
  const skillToolContext = await loadSkillToolContext({
    globalSkillNames: skillsContext.globalSkillNames,
    projectSkillNames: skillsContext.projectSkillNames,
    workspaceRoot: projectContext?.workspaceRoot,
  })
  const toolContext = {
    ...projectContext,
    ...skillToolContext,
    ...(sessionId ? { sessionId, scope, projectId } : {}),
  }
  // Live view of the session's current turn: the context object is built
  // once per session, while the turn changes on every runPrompt run.
  attachTurnIdGetter(toolContext, getTurnId)
  const tools = skillTools
    .filter(isAllowed)
    .map((definition) => wrapToolDefinition(definition, toolContext, toolPermissions))

  if (!allowedTools && await isGlobalMemoryEnabled()) {
    tools.push(wrapToolDefinition(globalMemoryTool, toolContext, toolPermissions))
  }

  if (includeWorkspaceTools && projectContext) {
    const definitions = workspaceTools.filter((definition) => includeSubagentTool || definition.name !== 'run_subagent')
    tools.push(...definitions
      .filter(isAllowed)
      .map((definition) => wrapWorkspaceToolDefinition(definition, toolContext, toolPermissions, { parentSessionId })))
  }

  // Goal mode: only while the session has an active goal, and never for
  // subagents (goalSession is the parent main-chat session or a resolver).
  if (includeGoalTool && goalSession) {
    const goalTool = createGoalReportTool(goalSession)
    if (isAllowed(goalTool)) tools.push(goalTool)
  }

  if (includeMcpTools) {
    const mcpTools = await createMcpToolDefinitions({ waitForConnections: mcpWaitForConnections })
    tools.push(...mcpTools.filter(isAllowed).map((definition) => wrapMcpToolDefinition(definition, toolPermissions)))
  }

  if (includePluginTools) {
    const pluginTools = await createPluginToolDefinitions(projectContext)
    tools.push(...pluginTools.filter(isAllowed).map((definition) => wrapPluginToolDefinition(definition, toolContext, toolPermissions)))
  }

  return tools
}

async function rebuildSessionTools(session) {
  const profileToolNames = Array.isArray(session.agentProfile?.allowedTools) ? session.agentProfile.allowedTools : null
  const goalActive = Boolean(activeGoalStatus(session))
  session.agent.state.tools = await createServerTools(
    session.projectId,
    session.projectContext,
    sessionSkillsContext(session),
    !!session.projectContext,
    createCommandToolPermissions(session),
    session.agentProfile
      ? {
          allowedToolNames: profileToolNames,
          includeSubagentTool: false,
          includeMcpTools: false,
          parentSessionId: session.sessionId,
          sessionId: session.sessionId,
          scope: session.scope,
          getTurnId: () => currentSessionTurnId(session.sessionId),
        }
      : {
          includeGoalTool: goalActive,
          goalSession: goalActive ? session : null,
          parentSessionId: session.sessionId,
          sessionId: session.sessionId,
          scope: session.scope,
          getTurnId: () => currentSessionTurnId(session.sessionId),
        },
  )
}

/** Active (non-terminal) goal of a session, or null. */
function activeGoalStatus(session) {
  const goal = sessionGoal(session)
  return goal && isGoalActiveStatus(goal.status) ? goal : null
}

// ---------------------------------------------------------------------------
// Agent Manager
// ---------------------------------------------------------------------------

// 访问模式常量与归一化 helper 见文件顶部
// 斜杠命令状态解析与内置命令 prompt 模板已迁至 agent-prompt-commands.mjs
// 审批 / ask_user / 自动压缩审批 Promise 编排已迁至 agent-approval-orchestrator.mjs
// /summary、/compact、/clear 会话压缩业务已迁至 agent-compaction.mjs
// run_subagent 生命周期与 SUBAGENT_* 常量已迁至 agent-subagent-runner.mjs
// 会话持久化已迁至 agent-persistence.mjs（persistSessionState 为公共 API 经 facade re-export）

/** @typedef {{ agent: Agent, projectContext: object|null, projectId: string|null, accessMode: string, yoloMode: boolean, model: object, thinkingLevel: string, scope: string, title: string, createdAt: string, status: string, startedAt: string|null, finishedAt: string|null, listeners: Set<function>, idleTimer: NodeJS.Timeout|null, eventBus: EventEmitter }} AgentSession */

const IDLE_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
const ABORT_IDLE_WAIT_TIMEOUT_MS = 3000
// run_subagent 错误 details 暂存条目的兜底 TTL；正常路径 afterToolCall 即取走删除。
// （暂存状态与 stash/take 访问器已收口至 agent-session-store.mjs）


const CLIENT_MESSAGE_ID_FIELD = 'quickforgeClientMessageId'

function isManagedCloudModel(model) {
  return model?.provider === 'quickforge-cloud' && model?.quickforgeModelSource === 'cloud'
}

function objectMetadata(message) {
  const metadata = message?.metadata
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}
}

function logicalMessageId(message) {
  const value = objectMetadata(message)[CLIENT_MESSAGE_ID_FIELD]
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined
}

function messageWithLogicalId(message) {
  if (!message || typeof message !== 'object' || logicalMessageId(message)) return message
  return {
    ...message,
    metadata: {
      ...objectMetadata(message),
      [CLIENT_MESSAGE_ID_FIELD]: `qfcm_${randomUUID()}`,
    },
  }
}

function prepareCloudUserMessage(session, message) {
  return isManagedCloudModel(session?.model) ? messageWithLogicalId(message) : message
}

function applyActiveCommandPrompt(messages, commandPrompt) {
  if (!commandPrompt) return messages

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role !== 'user' && message?.role !== 'user-with-attachments') continue

    const transformed = messages.slice()
    transformed[index] = {
      ...message,
      content: commandPrompt,
    }
    return transformed
  }

  return messages
}

function textFromMessageContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.filter((block) => block?.type === 'text').map((block) => block.text ?? '').join('\n')
  }
  return ''
}

function applyActiveCapabilityPrompt(messages, capabilityPrompt) {
  if (!capabilityPrompt) return messages

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role !== 'user' && message?.role !== 'user-with-attachments') continue

    const visibleText = textFromMessageContent(message.content)
    const transformed = messages.slice()
    transformed[index] = {
      ...message,
      content: `${capabilityPrompt}\n\nUser request:\n${visibleText}`,
    }
    return transformed
  }

  return messages
}

function activeTurnContextPrompt(session) {
  return [session?.activeTransientContextPrompt, session?.activeCapabilityPrompt]
    .filter((prompt) => typeof prompt === 'string' && prompt.trim())
    .join('\n\n') || null
}

function compactSummaryIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (isCompactSummaryMessage(messages[index])) return index
  }
  return -1
}

function compactedContextMessages(messages) {
  const index = compactSummaryIndex(messages)
  return index >= 0 ? messages.slice(index) : messages
}

async function transformSessionContext(session, messages, signal) {
  const autoCompactResult = await maybeAutoCompactSession({
    session,
    messages,
    signal,
    emitSessionEvent,
    persistSession,
    logger,
    confirmAutoCompact: createAutoCompactApprovalPromise,
  })
  if (!autoCompactResult.compacted && autoCompactResult.usage && autoCompactResult.reason && autoCompactResult.reason !== 'below_threshold') {
    logger.info(`Auto compact skipped for session ${session.sessionId}: ${autoCompactResult.reason}`, {
      sessionId: session.sessionId,
      reason: autoCompactResult.reason,
      usage: autoCompactResult.usage,
    })
  }
  const transformedMessages = buildAutoCompactLoopMessages(session, messages)
  session.lastTransformedContextMessages = transformedMessages
  return applyActiveCapabilityPrompt(
    applyActiveCommandPrompt(compactedContextMessages(transformedMessages), session?.activeCommandPrompt),
    activeTurnContextPrompt(session),
  )
}

// Goal continuations are scheduled only from here: after the run's final state
// was persisted successfully. persistSession/flushSessionPersist return null on
// CAS conflict or write failure, which must never lead to another round.
async function afterGoalRunPersisted(session, persisted, endStatus) {
  if (!session.goalRun) return
  // Explicit prompt-settle barrier: settlement must not race the run's own
  // `.finally` cleanup (which clears the active command state and turn id).
  // Waiting for the prompt promise makes the ordering deterministic instead of
  // depending on when the async persist flush happens to resolve.
  const promptSettled = session.activePromptPromise
  if (promptSettled) {
    try {
      await promptSettled
    } catch {
      // The run's failure is settled below; the barrier only orders cleanup.
    }
  }
  if (!persisted) {
    await failGoalRunOnPersist(session)
    return
  }
  try {
    await finishGoalRun(session, { status: endStatus })
  } catch (error) {
    logger.error(`Failed to settle goal run for session ${session.sessionId}:`, error, { sessionId: session.sessionId })
  }
}

// agentEvents 已迁至 agent-session-events.mjs（下方 re-export）
agentEvents.setMaxListeners(100)

function isIdleRetainedSession(session) {
  return session?.idleRetention === 'always'
}

export function resetIdleTimer(session) {
  if (session.idleTimer) clearTimeout(session.idleTimer)
  session.idleTimer = null
  if (isIdleRetainedSession(session)) return

  session.idleTimer = setTimeout(() => {
    if (session.status === 'running') {
      logger.info(`Session ${session.sessionId} idle timer fired but still running, resetting...`, { sessionId: session.sessionId, status: session.status })
      resetIdleTimer(session)
      return
    }
    logger.info(`Session ${session.sessionId} idle timeout (${IDLE_TIMEOUT_MS / 1000}s), destroying...`, { sessionId: session.sessionId })
    destroyAgent(session.sessionId).catch((err) =>
      logger.error(`Failed to destroy idle agent ${session.sessionId}:`, err, { sessionId: session.sessionId }),
    )
  }, IDLE_TIMEOUT_MS)
}

/**
 * Reset the idle timer for a session (e.g. on SSE activity).
 * Returns true if the session was found.
 */
export function touchSession(sessionId) {
  const session = agentSessions.get(sessionId)
  if (session) {
    resetIdleTimer(session)
    return true
  }
  return false
}

function agentProfileSystemPrompt(agentProfile) {
  return agentProfile?.systemPrompt
    ? `\n\n<agent_profile_instructions>\nAgent Profile: ${agentProfile.label || agentProfile.name}\n${agentProfile.systemPrompt}\n</agent_profile_instructions>`
    : ''
}

async function resolvedSessionSystemPrompt(projectId, agentProfile) {
  return `${await buildSystemPrompt(projectId)}${agentProfileSystemPrompt(agentProfile)}`
}

async function refreshMemoryState(session) {
  const memoryEnabled = await isGlobalMemoryEnabled()
  const memoryRevision = memoryEnabled ? await getGlobalMemoryRevision() : null
  if (session.memoryEnabled === memoryEnabled && session.memoryRevision === memoryRevision) return
  session.memoryEnabled = memoryEnabled
  session.memoryRevision = memoryRevision
  if (session.managedSystemPrompt !== false) {
    session.agent.state.systemPrompt = await resolvedSessionSystemPrompt(session.projectId, session.agentProfile)
  }
  await rebuildSessionTools(session)
}

/**
 * Create or retrieve an Agent for a session.
 * If the session already has a running agent, return it.
 * Otherwise, create a new Agent and optionally restore from storage.
 */
export async function createAgent(sessionId, config = {}) {
  const existing = agentSessions.get(sessionId)
  if (existing) {
    if (config.idleRetention !== undefined) existing.idleRetention = config.idleRetention
    resetIdleTimer(existing)
    return existing
  }

  const {
    scope = 'global',
    projectId = null,
    source = null,
    channelId = null,
    channelName = null,
    accessMode: rawAccessMode,
    yoloMode = false,
    model = null,
    modelRef = null,
    modelAccessContext = null,
    resolvePersistedModel = false,
    thinkingLevel = 'off',
    messages = [],
    systemPrompt = null,
    title = 'New chat',
    titleSource = title === 'New chat' ? 'default' : 'manual',
    createdAt = new Date().toISOString(),
    lastModified = null,
    contextCompaction = null,
    agentProfile = null,
    idleRetention = null,
    stateVersion = 0,
    mcpToolsMode = 'await',
    // Restored goal body (restore path only; never taken from client input).
    restoredGoal = null,
  } = config
  // A goal that was in flight when the process stopped is paused, never
  // replayed. The restored body is normalized defensively so a malformed or
  // tampered persisted goal can never become an authoritative in-memory goal.
  const initialGoal = goalAfterRestore(normalizeGoalState(restoredGoal, { sessionId }), Date.now())
  const accessMode = normalizeAccessMode(rawAccessMode, yoloMode)
  const resolvedYoloMode = yoloModeFromAccessMode(accessMode)
  // 'cached' (restore path) builds MCP tools from the current connection
  // snapshot without waiting for (re)connects; the background refresh and
  // toolset-change subscription converge active sessions afterwards.
  const mcpWaitForConnections = mcpToolsMode !== 'cached'

  // Resolve project context for tool calls. Project conversations resolve to
  // their directory; global conversations (no projectId) and any fallback fall
  // back to a synthetic default workspace context so file tools stay available.
  let projectContext = null
  if (projectId) {
    try {
      projectContext = await projectContextFromId(projectId)
    } catch {
      // project not found — fall back to the default workspace below
    }
  }
  projectContext ??= defaultGlobalWorkspaceContext()

  // Build system prompt and tools for the native QuickForge runtime.
  const projectConfig = await readProjectConfig()
  const configuredProject = projectId
    ? projectConfig.projects.find((project) => project.id === projectId)
    : null
  const skillsContext = {
    globalSkillNames: projectConfig.globalSkills,
    projectSkillNames: configuredProject?.skills,
  }
  const profileSystemPrompt = agentProfileSystemPrompt(agentProfile)
  const resolvedSystemPrompt = systemPrompt ?? `${await buildSystemPrompt(projectId)}${profileSystemPrompt}`

  let resolvedAgentProfile = agentProfile

  let resolvedModel = model
  let resolvedModelRef = modelRef
  if (!resolvedModel) {
    // Try to load the active preference from storage. A stale/hidden implicit
    // preference may fall back, while an explicit session binding never does.
    try {
      const settings = await readStore('settings')
      const raw = settings?.['active-model']
      resolvedModel = await resolveImplicitModelPreference(raw, modelAccessContext || {})
    } catch {
      // ignore
    }
  }
  if (agentProfile?.model?.mode === 'fixed') {
    const profileBinding = await resolveAgentProfileModel(agentProfile, resolvedModel, readStore, modelAccessContext || {})
    resolvedModel = profileBinding.model
    resolvedModelRef = profileBinding.modelRef || null
    resolvedAgentProfile = {
      ...agentProfile,
      model: modelReferenceSnapshot(agentProfile.model),
    }
  }
  if (resolvedAgentProfile && !resolvedModel) throw new Error('No active model is configured for the agent session.')
  const resolvedBinding = resolvedModel
    ? (resolvedModelRef
        ? { model: resolvedModel, modelRef: resolvedModelRef }
        : model
          ? { model: resolvedModel, modelRef: null }
          : await modelBindingFromModel(resolvedModel))
    : { model: resolvedModel, modelRef: null }
  resolvedModel = resolvedBinding.model
  const resolvedThinkingLevel = agentProfile
    ? resolveAgentProfileThinkingLevel(agentProfile, thinkingLevel, resolvedModel)
    : thinkingLevel

  // Build the native QuickForge tool set (MCP, Skills, Memory, workspace).
  const profileToolNames = Array.isArray(agentProfile?.allowedTools) ? agentProfile.allowedTools : null
  const tools = await createServerTools(
    projectId,
    projectContext,
    skillsContext,
    !!projectContext,
    (toolName) => {
      if (profileToolNames && !profileToolNames.includes(toolName)) return `Agent profile ${agentProfile.name} is not allowed to use ${toolName}.`
      const session = agentSessions.get(sessionId)
      return session ? createCommandToolPermissions(session)(toolName) : null
    },
    agentProfile
      ? {
          allowedToolNames: profileToolNames,
          includeSubagentTool: false,
          includeMcpTools: false,
          mcpWaitForConnections,
          parentSessionId: sessionId,
          sessionId,
          scope,
          // Same live turn view as rebuildSessionTools: without this the
          // session-created tool context has no turnId getter and every
          // journaled write stays unattributed (turnId null).
          getTurnId: () => currentSessionTurnId(sessionId),
        }
      : {
          mcpWaitForConnections,
          includeGoalTool: Boolean(initialGoal && isGoalActiveStatus(initialGoal.status)),
          goalSession: initialGoal && isGoalActiveStatus(initialGoal.status) ? () => agentSessions.get(sessionId) : null,
          parentSessionId: sessionId,
          sessionId,
          scope,
          getTurnId: () => currentSessionTurnId(sessionId),
        },
  )

  // Resolve API key
  const getApiKey = async (provider) => {
    try {
      const keys = await readStore('provider-keys')
      return keys?.[provider] || undefined
    } catch {
      return undefined
    }
  }

  const initialMemoryEnabled = await isGlobalMemoryEnabled()
  const initialMemoryRevision = initialMemoryEnabled ? await getGlobalMemoryRevision() : null
  let session
  const agent = new Agent({
    initialState: {
      systemPrompt: resolvedSystemPrompt,
      model: resolvedModel,
      thinkingLevel: resolvedThinkingLevel,
      messages,
      tools,
    },
    streamFn: (streamModel, streamContext, streamOptions) => streamSimpleWithAiHttpLogging(streamModel, streamContext, {
      ...streamOptions,
      onStreamRetry: (info) => emitSessionEvent(session, { type: 'model_stream_retry', ...info }),
    }),
    getApiKey,
    sessionId,
    convertToLlm: serverConvertToLlm,
    onPayload: (payload) => {
      restoreReasoningContentInPayload(payload, session?.lastTransformedContextMessages || agent.state.messages, agent.state.model)
    },
    transformContext: (messages, signal) => transformSessionContext(session, messages, signal),
    afterToolCall: async ({ toolCall, isError }) => {
      if (!isError || toolCall?.name !== 'run_subagent') return undefined
      const details = takeStashedSubagentErrorDetails(toolCall?.id)
      return details ? { details } : undefined
    },
    beforeToolCall: async (context) => {
      const toolName = context.toolCall?.name
      const toolCallId = context.toolCall?.id
      const currentSession = agentSessions.get(sessionId)
      const commandPermissionError = commandToolPermissionError(currentSession, toolName)
      if (commandPermissionError) return { block: true, reason: commandPermissionError }
      // Goal planning is read-only regardless of the session access mode: no
      // commands, MCP/plugins, writes or writable subagents.
      const goalPlanningError = goalPlanningToolBlockReason(currentSession, toolName, context.args)
      if (goalPlanningError) return { block: true, reason: goalPlanningError }
      // After the model reported the goal result, the rest of the turn is
      // read-only so the verified state cannot change before user review.
      const goalSettlementError = goalRunSettlementToolBlockReason(currentSession, toolName)
      if (goalSettlementError) return { block: true, reason: goalSettlementError }
      const isSkillTool = toolName === 'activate_skill' || toolName === 'read_skill_resource'
      if (isSkillTool) return undefined
      // ask_user only waits for the user's answer, todo_write only records the
      // latest plan snapshot, and goal_report only records goal state; none
      // needs approval.
      if (toolName === 'ask_user' || toolName === 'todo_write' || toolName === 'goal_report') return undefined
      if (profileToolNames && !profileToolNames.includes(toolName)) return { block: true, reason: `Agent profile ${agentProfile.name} is not allowed to use ${toolName}.` }
      if (toolName === 'manage_global_memory') return undefined
      if (toolName === 'run_subagent') {
        const requested = context.args?.subagent
        const policy = requested && typeof requested === 'object' ? normalizeCapabilityPolicy(requested.capabilityPolicy || 'readonly-research', Array.isArray(requested.tools) ? requested.tools : []) : null
        if (policy && ['code-edit', 'docs-edit'].includes(policy) && !hasFullAccess(currentSession)) {
          return { block: true, reason: `Temporary subagent capability policy ${policy} requires full access or approval.` }
        }
        return undefined
      }
      if (isMcpToolName(toolName) || isPluginToolName(toolName)) {
        if (!hasFullAccess(currentSession)) return createApprovalPromise(currentSession, toolCallId, toolName, context.args)
        return undefined
      }
      if (!projectContext?.workspaceRoot) {
        return { block: true, reason: 'No active project. Select a project to use tools.' }
      }
      if (!hasFullAccess(currentSession)) {
        // Default access: safe reads auto-pass, state-changing or external tools require approval
        if (safeReadTools.has(toolName)) return undefined
        return createApprovalPromise(currentSession, toolCallId, toolName, context.args)
      }
      return undefined
    },
  })

  const eventBus = new EventEmitter()
  eventBus.setMaxListeners(100)

  session = {
    sessionId,
    agent,
    projectContext,
    projectId,
    source: typeof source === 'string' && source.trim() ? source.trim() : null,
    channelId: typeof channelId === 'string' && channelId.trim() ? channelId.trim() : null,
    channelName: typeof channelName === 'string' && channelName.trim() ? channelName.trim() : null,
    accessMode,
    yoloMode: resolvedYoloMode,
    model: resolvedModel,
    modelRef: resolvedBinding.modelRef,
    modelAccessContext: modelAccessContext || null,
    resolvePersistedModel: resolvePersistedModel === true || Boolean(resolvedBinding.modelRef),
    thinkingLevel: resolvedThinkingLevel,
    scope,
    title,
    titleSource,
    createdAt,
    lastModified,
    globalSkillNames: skillsContext.globalSkillNames,
    projectSkillNames: skillsContext.projectSkillNames,
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    activeCommandName: null,
    activeCommandPermissions: null,
    activeCommandPrompt: null,
    activeCapabilityPrompt: null,
    activeTransientContextPrompt: null,
    eventBus,
    idleTimer: null,
    persistTimer: null,
    titleGenerationId: 0,
    titleGenerationPromise: null,
    titleGenerationPromiseId: null,
    sessionCreatedEmitted: messages.length > 0,
    toolTimings: new Map(),
    runtimeToolExecutions: new Map(),
    getApiKey,
    contextCompaction,
    agentProfile: resolvedAgentProfile ? agentProfileSnapshot(resolvedAgentProfile) : null,
    idleRetention,
    lastTransformedContextMessages: null,
    autoCompacting: false,
    stateVersion: Number.isFinite(stateVersion) ? Math.max(0, stateVersion) : 0,
    persistedStateVersion: Number.isFinite(config.persistedStateVersion) ? Math.max(0, config.persistedStateVersion) : null,
    persistedStorageRevision: Number.isFinite(config.persistedStorageRevision) ? Math.max(0, config.persistedStorageRevision) : null,
    persistedStateJson: typeof config.persistedStateJson === 'string' ? config.persistedStateJson : null,
    // F9 split-message bookkeeping: the count and tail-message digest of the
    // last authoritative persist, plus the storage representation marker. Used
    // for split-representation conflict detection and lightweight SSE frames.
    persistedMessageStorage: config.persistedMessageStorage === 'split' ? 'split' : null,
    persistedMessageCount: Number.isInteger(config.persistedMessageCount) && config.persistedMessageCount >= 0 ? config.persistedMessageCount : null,
    persistedTailDigest: typeof config.persistedTailDigest === 'string' ? config.persistedTailDigest : null,
    persistConflictCount: 0,
    // Set when an authoritative persist is skipped after CAS conflicts; cleared
    // on the next successful persist. Surfaced via getSessionState/getSessionStatus
    // so the UI can warn the user instead of silently losing messages.
    persistDegraded: null,
    lastAutoCompactAt: null,
    lastAutoCompactRejected: null,
    memoryEnabled: initialMemoryEnabled,
    memoryRevision: initialMemoryRevision,
    managedSystemPrompt: systemPrompt == null,
    // Goal mode: authoritative goal body (persisted with the session) plus
    // runtime-only bookkeeping for the active run and progress accounting.
    goal: initialGoal,
    goalRun: null,
    goalStats: null,
    goalContinuationPending: false,
    // Settlement bookkeeping: a run whose final state is being persisted has
    // already cleared goalRun, so an abort must be recorded as a generation
    // bump for the in-flight settlement to observe.
    goalRunSettling: false,
    goalAbortGeneration: 0,
    // Runtime record of successful verification tool calls for the current
    // goal version (goal_report evidence is validated against it).
    goalTrustedToolCalls: new Map(),
    /** Track active SSE connections. Only one SSE stream allowed per session to prevent
     *  connection-pool exhaustion when two browser tabs load the same session. */
    sseConnected: false,
    abortPending: false,
    abortEndEmitted: false,
  }

  // Subscribe to agent lifecycle events and forward to eventBus
  agent.subscribe(async (event) => {
    // The pi-agent-core agent loop emits agent_end with `messages` that only
    // contains messages generated during THIS run (newMessages), not the
    // complete session history.  Replace with the authoritative full state
    // before forwarding to clients.
    const timedEvent = addToolTimingToEvent(session, event)
    updateRuntimeToolExecution(session, timedEvent)
    // Goal evidence trust: record successful verification tool executions for
    // the current goal version (control-plane/delegation/skill/memory tools are
    // ignored inside the runner).
    if (timedEvent.type === 'tool_execution_end') recordGoalToolExecution(session, timedEvent)
    const eventEndStatus = event.type === 'agent_end'
      ? session.agent.signal?.aborted
        ? 'aborted'
        : session.agent.state.errorMessage
          ? 'error'
          : 'idle'
      : undefined
    if (timedEvent.type === 'agent_end') {
      markLatestAssistantProcessFinished(agent.state.messages)
      // Ensure a failed run is visible in the conversation. Most failures emit
      // an assistant error message through the agent loop (handleRunFailure),
      // but a few paths (e.g. concurrent-run rejection) only set
      // `state.errorMessage`. Append an error message so the user sees the
      // reason at the end of the transcript instead of only a toast.
      // 用户主动停止（signal 已 abort）不算失败：pi-agent-core 已落一条
      // stopReason='aborted' 的终态消息（前端显示灰色「已停止」），不再追加
      // "Request was aborted" 错误消息与重试/继续入口；同时清掉
      // state.errorMessage，避免状态面板把用户停止报成错误。
      if (session.agent.signal?.aborted) session.agent.state.errorMessage = undefined
      const runError = session.agent.state.errorMessage
      if (runError) {
        agent.state.messages = appendAssistantErrorMessageOnce(agent.state.messages, runError, session.model)
      }
    }
    const forwardEvent = timedEvent.type === 'agent_end'
      ? {
          ...timedEvent,
          ...(timedEvent.messages ? { messages: agent.state.messages } : {}),
          status: eventEndStatus,
          ...(session.agent.state.errorMessage && timedEvent.errorMessage === undefined ? { errorMessage: session.agent.state.errorMessage } : {}),
        }
      : timedEvent

    const shouldForwardEvent = !(timedEvent.type === 'agent_end' && session.abortEndEmitted)
    if (shouldForwardEvent) {
      emitSessionEvent(session, forwardEvent)
    }

    // Track status
    if (event.type === 'agent_start') {
      session.abortEndEmitted = false
      session.status = 'running'
      session.startedAt = session.startedAt ?? new Date().toISOString()
      session.finishedAt = null
      // Persist running state immediately so a browser refresh still shows the green dot.
      // Brand-new runs have no messages until the first user message_end; persisting
      // here would only trigger the empty-session cleanup path.
      if (session.agent.state.messages.length > 0) {
        persistSession(session).catch((err) =>
          logger.error(`Failed to persist session on start ${sessionId}:`, err, { sessionId }),
        )
      }
    }

    if (event.type === 'agent_end') {
      sessionTurnIds.delete(sessionId)
      session.abortPending = false
      session.abortEndEmitted = false
      session.status = eventEndStatus || (session.agent.state.errorMessage ? 'error' : 'idle')
      session.finishedAt = new Date().toISOString()
      session.toolTimings?.clear()
      resetIdleTimer(session)

      // Persist after run ends. Flush any debounced write so the final state is durable.
      flushSessionPersist(session)
        .then((metadata) => {
          // Goal continuations start only after the run truly finished AND the
          // final state was persisted. A null result (CAS conflict / failure)
          // pauses the goal instead of continuing on an unpersisted state.
          void afterGoalRunPersisted(session, metadata, eventEndStatus)
        })
        .catch((err) => {
          logger.error(`Failed to persist session ${sessionId}:`, err, { sessionId })
          void afterGoalRunPersisted(session, null, eventEndStatus)
        })
    }

    if (event.type === 'message_end') {
      const isUserMessage = event.message?.role === 'user' || event.message?.role === 'user-with-attachments'
      const isInitialUserMessage = isUserMessage && (event.isInitialUserMessage === true || session.agent.state.messages.length === 1)
      const requiresDurableCloudMessage = isUserMessage && isManagedCloudModel(session.model) && Boolean(logicalMessageId(event.message))
      if (isInitialUserMessage || requiresDurableCloudMessage) {
        // Persist every managed Cloud user message before the provider stream starts,
        // so its logical ID survives a process restart and resolves to the same private key.
        try {
          const metadata = await flushSessionPersist(session)
          if (metadata && isInitialUserMessage) {
            if (!session.sessionCreatedEmitted) {
              session.sessionCreatedEmitted = true
              emitSessionEvent(session, { type: 'session_created', metadata })
            }
            scheduleSessionTitleGeneration(session, event.message)
          }
        } catch (err) {
          logger.error(`Failed to persist user message for session ${sessionId}:`, err, { sessionId })
        }
      } else {
        // Debounced persist for crash recovery; coalesces the many message_end
        // events within a single run into infrequent full-session writes.
        scheduleSessionPersist(session)
      }
    }
  })

  agentSessions.set(sessionId, session)
  resetIdleTimer(session)
  logger.info(`Created session ${sessionId} (scope: ${scope}, project: ${projectId || 'none'}, access: ${accessMode})`, { sessionId, scope, projectId: projectId || undefined, accessMode, yoloMode: resolvedYoloMode, idleRetention: idleRetention || undefined })
  return session
}

export function rollbackStartIndexFromMessage(messages, messageIndex) {
  let rollbackIndex = Number(messageIndex)
  if (!Number.isInteger(rollbackIndex) || rollbackIndex < 0 || rollbackIndex >= messages.length) return -1

  if (messages[rollbackIndex]?.role === 'assistant') {
    for (let index = rollbackIndex - 1; index >= 0; index--) {
      if (messages[index].role === 'user' || messages[index].role === 'user-with-attachments') {
        rollbackIndex = index
        break
      }
    }
  }

  const message = messages[rollbackIndex]
  if (!message || (message.role !== 'user' && message.role !== 'user-with-attachments')) return -1
  return rollbackIndex
}

export async function rollbackSessionMessages(sessionId, rollbackMessageIndex) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  if (session.agent.state.isStreaming) {
    throw Object.assign(new Error('Generation is still running. Stop it or wait until it finishes before rolling back.'), {
      statusCode: 409,
      errorCode: 'GENERATION_STILL_RUNNING_BEFORE_ROLLBACK',
    })
  }
  // Rolling back the transcript of a goal would desync the goal's evidence and
  // criteria from the conversation; require pause/cancel first.
  if (activeGoalStatus(session)) {
    throw Object.assign(new Error('This chat has an active goal. Pause or cancel it before rolling back messages.'), {
      statusCode: 409,
      errorCode: 'GOAL_ACTIVE',
    })
  }

  const messages = Array.isArray(session.agent.state.messages) ? session.agent.state.messages : []
  const rollbackIndex = rollbackStartIndexFromMessage(messages, rollbackMessageIndex)
  if (rollbackIndex < 0) {
    throw Object.assign(new Error('There is no conversation turn to roll back.'), { statusCode: 400 })
  }

  const nextMessages = messages.slice(0, rollbackIndex)
  updateSessionMessages(session, nextMessages)
  const compactedUpToIndex = Number(session.contextCompaction?.compactedUpToIndex) || 0
  if (rollbackIndex < compactedUpToIndex) {
    // 撤回越过压缩点，摘要覆盖的历史被截断，压缩失效
    resetSessionCompaction(session)
  } else {
    // 撤回发生在压缩点之后，摘要仍然有效，保留压缩上下文
    session.lastTransformedContextMessages = null
  }
  session.status = 'idle'
  session.finishedAt = new Date().toISOString()
  await persistSession(session)

  const replacedEvent = {
    type: 'messages_replaced',
    reason: 'rollback',
    rollbackIndex,
    messages: session.agent.state.messages,
    contextCompaction: session.contextCompaction,
    contextUsage: getSessionContextUsage(session),
  }
  emitSessionEvent(session, replacedEvent)
  emitSessionEvent(session, { type: 'message_end', messages: session.agent.state.messages })
  emitSessionEvent(session, { type: 'agent_end', messages: session.agent.state.messages })

  return { session: getSessionState(sessionId), rollbackIndex }
}

export function canApplyGeneratedTitle(session, generationId, expectedTitle) {
  return session.titleGenerationId === generationId
    && session.titleSource === 'fallback'
    && session.title === expectedTitle
}

function scheduleSessionTitleGeneration(session, userMessage) {
  if (session.titleSource !== 'fallback') return
  if (session.titleGenerationPromise && session.titleGenerationPromiseId === session.titleGenerationId) return
  const generationId = ++session.titleGenerationId
  const expectedTitle = session.title
  const promise = generateAiTitle([userMessage], session.model, session.thinkingLevel, session.getApiKey)
    .then(async (aiTitle) => {
      if (!aiTitle || aiTitle === 'New chat') return
      if (!canApplyGeneratedTitle(session, generationId, expectedTitle)) return
      session.title = aiTitle
      session.titleSource = 'ai'
      await persistSession(session)
      emitSessionEvent(session, { type: 'title_updated', title: aiTitle, titleSource: 'ai' })
    })
    .catch((err) => {
      logger.warn(`Title generation failed for session ${session.sessionId}:`, err.message || err, { sessionId: session.sessionId })
    })
    .finally(() => {
      if (session.titleGenerationPromise === promise) {
        session.titleGenerationPromise = null
        session.titleGenerationPromiseId = null
      }
    })
  session.titleGenerationPromise = promise
  session.titleGenerationPromiseId = generationId
}

async function refreshSessionModelBinding(session) {
  if (!session?.model || (!session.modelRef && session.resolvePersistedModel !== true)) return session
  const binding = await resolveModelBinding(
    session.modelRef ? { modelRef: session.modelRef } : { model: session.model },
    {
      context: session.modelAccessContext || {},
      currentModel: session.model,
      allowCurrentHidden: true,
      forExecution: true,
      legacySnapshot: session.model,
    },
  )
  session.model = binding.model
  session.modelRef = binding.modelRef
  session.resolvePersistedModel = true
  session.agent.state.model = binding.model
  return session
}

/**
 * Send a user message to the agent and start the agent loop.
 * Returns immediately; events are streamed via the event bus.
 */
export async function runPrompt(sessionId, message, selectedCapabilities = [], promptCommand = null, transientContextPrompt = null, modelAccessContext = null, contextReferences = undefined) {
  let session = await syncSessionFromStorage(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  if (session.agent.state.isStreaming || session.abortPending) {
    throw Object.assign(new Error('Generation is still running. Stop it or wait until it finishes.'), {
      statusCode: 409,
      errorCode: 'GENERATION_ALREADY_RUNNING',
    })
  }

  // Validate references before model refresh, memory refresh, idle timers, title,
  // message persistence, or agent_start side effects.
  const initialUserMessage = typeof message === 'string'
    ? { role: 'user', content: message, timestamp: new Date().toISOString() }
    : message
  const canonicalContextReferences = await validatePromptContextReferences(contextReferences, session)
  const canonicalSelectedCapabilities = normalizeSelectedCapabilities(selectedCapabilities)
  const canonicalInitialUserMessage = withCanonicalSelectedCapabilities(
    withCanonicalContextReferences(initialUserMessage, canonicalContextReferences),
    canonicalSelectedCapabilities,
  )

  if (modelAccessContext) session.modelAccessContext = modelAccessContext
  // Request-scoped source (e.g. 'shared') must gate goal mode for THIS request
  // only; it is threaded explicitly instead of being read back from the session,
  // which would permanently disable the owner after a shared visitor prompted.
  const requestSource = modelAccessContext && typeof modelAccessContext === 'object'
    ? modelAccessContext.source ?? null
    : null
  await refreshSessionModelBinding(session)
  await refreshMemoryState(session)
  resetIdleTimer(session)

  const commandState = await resolveCommandState(session, canonicalInitialUserMessage, promptCommand, requestSource)
  const resolvedUserMessage = commandState.userMessage ?? canonicalInitialUserMessage

  if (commandState.textResponse) {
    session.agent.state.messages = [
      ...session.agent.state.messages,
      canonicalInitialUserMessage,
      assistantTextMessage(commandState.textResponse, session.model),
    ]
    await persistSession(session)
    const messages = session.agent.state.messages
    emitSessionEvent(session, { type: 'message_end', messages })
    emitSessionEvent(session, { type: 'agent_end', messages })
    return { sessionId, status: session.status }
  }

  if (commandState.clear) {
    return clearSession(session)
  }

  if (commandState.summary) {
    return summarySession(session, canonicalInitialUserMessage, commandState.summary)
  }

  if (commandState.compact) {
    return compactSession(session, canonicalInitialUserMessage, commandState.compact)
  }

  // Goal mode is mutually exclusive with ordinary prompts and retries: an
  // active goal owns the session until it is paused, cancelled or accepted.
  if (!commandState.goalRun && activeGoalStatus(session)) {
    throw Object.assign(new Error('This chat has an active goal. Use the goal card to pause, cancel or revise it before sending another message.'), {
      statusCode: 409,
      errorCode: 'GOAL_ACTIVE',
    })
  }
  // A finished goal no longer occupies the card once the user moves on.
  if (!commandState.goalRun && sessionGoal(session) && isGoalTerminalStatus(session.goal.status)) {
    await clearTerminalGoal(session)
  }
  if (commandState.goalRun) beginGoalRun(session, commandState.goalRun.kind)

  const userMessage = prepareCloudUserMessage(session, resolvedUserMessage)

  // Set a meaningful fallback immediately. The AI title request starts only
  // after the first user message has been persisted by the message_end handler.
  if (session.titleSource === 'default' && session.title === 'New chat') {
    const simpleTitle = generateTitle([userMessage])
    session.titleSource = 'fallback'
    if (simpleTitle !== 'New chat') {
      session.title = simpleTitle
    }
  }

  session.activeCommandName = commandState.commandName ?? null
  session.activeCommandPermissions = commandState.permissions ?? null
  session.activeCommandPrompt = commandState.commandPrompt ?? null
  session.activeCapabilityPrompt = selectedCapabilityPrompt(canonicalSelectedCapabilities)
  const referencePrompt = contextReferencesPrompt(canonicalContextReferences)
  session.activeTransientContextPrompt = [
    typeof transientContextPrompt === 'string' && transientContextPrompt.trim() ? transientContextPrompt : null,
    referencePrompt,
  ].filter(Boolean).join('\n\n') || null

  // A user-triggered main run defines exactly one rollback turn: journaled
  // writes during this run (including subagent writes attributed here) share
  // its id. Synthetic paths above (command text responses, /clear, summary,
  // compaction) return earlier and stay unattributed.
  const turnId = randomUUID()
  sessionTurnIds.set(sessionId, turnId)
  // Ownership token: the run's cleanup must only clear command state it
  // installed, so a goal continuation that starts before this run's `.finally`
  // runs (immediate persist flush) keeps its own prompt/permissions.
  const commandToken = {}
  session.activeCommandToken = commandToken

  // Fire and forget — events come through eventBus
  const promptPromise = session.agent.prompt(userMessage)
  // Explicit settle barrier consumed by afterGoalRunPersisted: goal settlement
  // waits for the prompt to settle instead of assuming the async persist flush
  // ordered the cleanup below.
  session.activePromptPromise = promptPromise
  promptPromise.catch((err) => {
    logger.error(`Agent prompt error for session ${sessionId}:`, err, { sessionId })
    const errorMessage = err.message || 'Unknown error'
    // Surface the failure at the end of the conversation itself so the user
    // sees the reason in the transcript, not only via toast/notification.
    session.agent.state.messages = appendAssistantErrorMessageOnce(
      session.agent.state.messages,
      errorMessage,
      session.model,
    )
    session.agent.state.errorMessage = errorMessage
    session.agent.state.isStreaming = false
    session.status = 'error'
    session.finishedAt = new Date().toISOString()
    const messages = session.agent.state.messages
    emitSessionEvent(session, { type: 'message_end', messages })
    emitSessionEvent(session, { type: 'error', error: errorMessage })
    emitSessionEvent(session, { type: 'agent_end', messages, errorMessage, status: 'error' })
    // This synthetic agent_end bypasses the agent's own subscribe hook, so a
    // goal run must be settled explicitly here — and only after the final state
    // is persisted, exactly like the real agent_end path.
    flushSessionPersist(session)
      .then((metadata) => {
        void afterGoalRunPersisted(session, metadata, 'error')
      })
      .catch((persistErr) => {
        logger.error(`Failed to persist session ${sessionId} after prompt error:`, persistErr, { sessionId })
        void afterGoalRunPersisted(session, null, 'error')
      })
  }).finally(() => {
    if (session.activePromptPromise === promptPromise) session.activePromptPromise = null
    if (sessionTurnIds.get(sessionId) === turnId) sessionTurnIds.delete(sessionId)
    if (session.activeCommandToken !== commandToken) return
    session.activeCommandToken = null
    session.activeCommandName = null
    session.activeCommandPermissions = null
    session.activeCommandPrompt = null
    session.activeCapabilityPrompt = null
    session.activeTransientContextPrompt = null
  })

  return { sessionId, status: session.status }
}

/**
 * Continue generation from the current last message (must be a user or
 * tool-result message).  Used by the retry button to regenerate a response
 * in-place without appending a new user message.
 *
 * Trims messages to keep up to and including the last user message,
 * removing the assistant response that follows it.
 */
export async function continueSession(sessionId, modelAccessContext = null) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  if (session.agent.state.isStreaming) {
    throw Object.assign(new Error('Generation is still running. Stop it or wait until it finishes.'), {
      statusCode: 409,
      errorCode: 'GENERATION_ALREADY_RUNNING',
    })
  }
  // Retrying is an ordinary run: it cannot interleave with an active goal.
  if (activeGoalStatus(session)) {
    throw Object.assign(new Error('This chat has an active goal. Use the goal card to pause, cancel or revise it before retrying.'), {
      statusCode: 409,
      errorCode: 'GOAL_ACTIVE',
    })
  }
  if (sessionGoal(session) && isGoalTerminalStatus(session.goal.status)) {
    await clearTerminalGoal(session)
  }
  if (modelAccessContext) session.modelAccessContext = modelAccessContext
  const requestSource = modelAccessContext && typeof modelAccessContext === 'object'
    ? modelAccessContext.source ?? null
    : null
  await refreshSessionModelBinding(session)

  const messages = Array.isArray(session.agent.state.messages) ? session.agent.state.messages : []

  // Find the last user message and trim everything after it (the assistant response)
  let lastUserIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' || messages[i].role === 'user-with-attachments') {
      lastUserIndex = i
      break
    }
  }
  if (lastUserIndex < 0) {
    throw Object.assign(new Error('Cannot continue: no user message found.'), { statusCode: 400 })
  }

  const lastUserMessage = messages[lastUserIndex]
  const canonicalContextReferences = await validateContextReferences(contextReferencesFromMessage(lastUserMessage), session)
  const canonicalSelectedCapabilities = normalizeSelectedCapabilities(selectedCapabilitiesFromMessage(lastUserMessage))
  const canonicalLastUserMessage = withCanonicalSelectedCapabilities(
    withCanonicalContextReferences(lastUserMessage, canonicalContextReferences),
    canonicalSelectedCapabilities,
  )
  const commandState = await resolveCommandState(session, canonicalLastUserMessage, null, requestSource)
  const continuedUserMessage = prepareCloudUserMessage(session, commandState.userMessage ?? canonicalLastUserMessage)
  const trimmedMessages = messages.slice(0, lastUserIndex).concat(continuedUserMessage)
  updateSessionMessages(session, trimmedMessages)
  const compactedUpToIndex = Number(session.contextCompaction?.compactedUpToIndex) || 0
  if (lastUserIndex < compactedUpToIndex) {
    // 重试点越过压缩点，摘要覆盖的历史被截断，压缩失效
    resetSessionCompaction(session)
  } else {
    // 重试点位于压缩点之后，摘要仍然有效，保留压缩上下文
    session.lastTransformedContextMessages = null
  }
  if (isManagedCloudModel(session.model) && logicalMessageId(continuedUserMessage)) {
    await flushSessionPersist(session)
  }

  resetIdleTimer(session)
  session.activeCommandName = commandState.commandName ?? null
  session.activeCommandPermissions = commandState.permissions ?? null
  session.activeCommandPrompt = commandState.commandPrompt ?? null
  session.activeCapabilityPrompt = selectedCapabilityPrompt(canonicalSelectedCapabilities)
  session.activeTransientContextPrompt = contextReferencesPrompt(canonicalContextReferences)

  // Same attribution rule as runPrompt: a retry run is one rollback turn of
  // its own (the frontend groups it with the original run's turn id).
  sessionTurnIds.set(sessionId, randomUUID())

  session.agent.continue().catch((err) => {
    logger.error(`Agent continue error for session ${sessionId}:`, err, { sessionId })
    emitSessionEvent(session, { type: 'error', error: err.message || 'Unknown error' })
  }).finally(() => {
    sessionTurnIds.delete(sessionId)
    session.activeCommandName = null
    session.activeCommandPermissions = null
    session.activeCommandPrompt = null
    session.activeCapabilityPrompt = null
    session.activeTransientContextPrompt = null
  })

  return { sessionId, status: 'running' }
}

/**
 * Abort the current agent run.
 */
export async function abortRun(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }

  // Clean up any pending tool approvals for this session
  for (const [_toolCallId, approval] of pendingApprovals) {
    if (approval.sessionId === sessionId) {
      approval.reject(new Error('Run aborted'))
    }
  }
  for (const [approvalId, approval] of pendingAutoCompactApprovals) {
    if (approval.sessionId === sessionId) {
      approval.reject(new Error('Run aborted'))
      pendingAutoCompactApprovals.delete(approvalId)
    }
  }

  // A user stop also stops the goal: no continuation is scheduled, and the
  // card shows pausing until the run really settles.
  await notifyGoalAbort(session)

  session.agent.abort()
  let idleWaitTimer
  const becameIdle = await Promise.race([
    session.agent.waitForIdle().then(() => true),
    new Promise((resolve) => {
      idleWaitTimer = setTimeout(() => resolve(false), ABORT_IDLE_WAIT_TIMEOUT_MS)
      idleWaitTimer.unref?.()
    }),
  ])
  clearTimeout(idleWaitTimer)
  if (!becameIdle) {
    session.abortPending = true
    logger.warn(`Agent ${sessionId} did not become idle within ${ABORT_IDLE_WAIT_TIMEOUT_MS}ms after abort`, { sessionId })
  }

  if (session.status === 'running') {
    session.status = 'aborted'
    session.finishedAt = new Date().toISOString()
    persistSession(session).catch((err) =>
      logger.error(`Failed to persist aborted session ${sessionId}:`, err, { sessionId }),
    )
    session.abortEndEmitted = true
    const event = {
      type: 'agent_end',
      status: 'aborted',
      messages: session.agent.state.messages,
    }
    emitSessionEvent(session, event)
  }

  return { sessionId, aborted: true }
}

/**
 * Steering/follow-up bypass runPrompt's goal exclusivity check, so they must
 * reject an active goal themselves: a goal run owns the turn structure and a
 * queued user message would interleave with it (or silently derail the goal).
 */
function assertNoActiveGoal(session, verb) {
  const goal = activeGoalStatus(session)
  if (!goal) return
  throw Object.assign(new Error(`This chat has an active goal (${goal.status}). Use the goal card to pause, cancel or revise it before you ${verb}.`), {
    statusCode: 409,
    errorCode: 'GOAL_ACTIVE',
  })
}

/**
 * Queue a steering message to inject after the current assistant turn.
 */
export function steerAgent(sessionId, message) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  assertNoActiveGoal(session, 'steer the run')

  const agentMessage = prepareCloudUserMessage(session, typeof message === 'string'
    ? { role: 'user', content: message, timestamp: Date.now() }
    : message)

  session.agent.steer(agentMessage)
  return { sessionId, steered: true }
}

/**
 * Queue a follow-up message to process after the agent would otherwise stop.
 */
export function followUpAgent(sessionId, message) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  assertNoActiveGoal(session, 'queue a follow-up')

  const agentMessage = prepareCloudUserMessage(session, typeof message === 'string'
    ? { role: 'user', content: message, timestamp: Date.now() }
    : message)

  session.agent.followUp(agentMessage)
  return { sessionId, followUp: true }
}

function storedMessagesExtendLocalHistory(localMessages, storedMessages) {
  if (!Array.isArray(localMessages) || !Array.isArray(storedMessages) || storedMessages.length <= localMessages.length) return false
  return localMessages.every((message, index) => {
    const local = { ...message }
    const stored = { ...storedMessages[index] }
    delete local.processFinishedAt
    delete stored.processFinishedAt
    return JSON.stringify(local) === JSON.stringify(stored)
  })
}

export async function syncSessionFromStorage(sessionId) {
  let session = agentSessions.get(sessionId)
  if (!session) return restoreAgent(sessionId)
  if (session.agent.state.isStreaming) return session

  try {
    const stored = await readSessionValue(sessionId)
    if (!stored || !Array.isArray(stored.messages)) return session

    const localMessages = Array.isArray(session.agent.state.messages) ? session.agent.state.messages : []
    const storedStateVersion = Number.isFinite(stored.stateVersion) ? stored.stateVersion : 0
    const localStateVersion = Number.isFinite(session.stateVersion) ? session.stateVersion : 0
    const storedLastModified = Date.parse(stored.lastModified || '')
    const localLastModified = Date.parse(session.lastModified || '')
    const hasNewerVersion = storedStateVersion > localStateVersion
    const storedExtendsLocalHistory = storedMessagesExtendLocalHistory(localMessages, stored.messages)
    const hasMoreMessages = storedExtendsLocalHistory
    const hasNewerActivityAtSameVersion = storedStateVersion === localStateVersion
      && stored.messages.length === localMessages.length
      && Number.isFinite(storedLastModified)
      && (!Number.isFinite(localLastModified) || storedLastModified > localLastModified)

    if (!hasNewerVersion && !hasMoreMessages && !hasNewerActivityAtSameVersion) return session

    session.agent.state.messages = stored.messages
    session.title = stored.title || session.title
    session.titleSource = stored.titleSource || session.titleSource
    session.source = stored.source || session.source
    session.channelId = stored.channelId || session.channelId
    session.channelName = stored.channelName || session.channelName
    session.lastModified = stored.lastModified || session.lastModified
    session.status = stored.taskStatus || 'idle'
    session.startedAt = stored.taskStartedAt || null
    session.finishedAt = stored.taskFinishedAt || null
    session.contextCompaction = stored.contextCompaction || null
    // Storage is authoritative for the goal too, but only when it is actually
    // newer: an in-memory mutation that has not been persisted yet must win.
    const storedGoal = normalizeGoalState(stored.goal, { sessionId })
    if (storedGoal && (!session.goal || storedGoal.revision > session.goal.revision)) {
      session.goal = storedGoal
    }
    session.stateVersion = Math.max(localStateVersion, storedStateVersion)
    session.runtimeToolExecutions?.clear()
    resetIdleTimer(session)
    return session
  } catch (error) {
    logger.warn(`Failed to sync session ${sessionId} from storage:`, error?.message || error, { sessionId })
    return session
  }
}

/**
 * Get the current state of a session (for page refresh recovery).
 */
export function getSessionState(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session) return null

  const messages = messagesWithRuntimeToolExecutions(session)
  return {
    sessionId: session.sessionId,
    scope: session.scope,
    projectId: session.projectId,
    source: session.source || undefined,
    channelId: session.channelId || undefined,
    channelName: session.channelName || undefined,
    accessMode: session.accessMode,
    yoloMode: session.yoloMode,
    systemPrompt: session.agent.state.systemPrompt,
    model: session.model,
    modelRef: session.modelRef || undefined,
    thinkingLevel: session.thinkingLevel,
    title: session.title,
    titleSource: session.titleSource,
    createdAt: session.createdAt,
    lastModified: session.lastModified,
    stateVersion: session.stateVersion || 0,
    messageStorage: session.persistedMessageStorage === 'split' ? 'split' : undefined,
    status: session.status,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    tools: session.agent.state.tools,
    messages,
    pendingToolCalls: runtimePendingToolCalls(session),
    contextCompaction: session.contextCompaction,
    contextUsage: getSessionContextUsage(session),
    pendingToolApproval: getPendingApprovalForSession(session.sessionId),
    pendingAutoCompactApproval: getPendingAutoCompactApprovalForSession(session.sessionId),
    pendingAsk: getPendingAskForSession(session.sessionId),
    isStreaming: session.abortPending ? false : session.agent.state.isStreaming,
    errorMessage: session.agent.state.errorMessage,
    persistDegraded: session.persistDegraded ? true : undefined,
    goal: sessionGoal(session),
  }
}

/**
 * Get a lightweight status snapshot for SSE-first state recovery.
 */
// Unlike the UI status snapshot, abortPending must remain busy until the
// underlying stream/tools actually stop. Used by file rollback under its lock.
export function isSessionFileRollbackBusy(sessionId) {
  const session = agentSessions.get(sessionId)
  return Boolean(session && (
    session.agent?.state?.isStreaming || session.abortPending ||
    runtimePendingToolCalls(session).length || getPendingApprovalForSession(sessionId)
  ))
}

export function getSessionStatus(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session) return null

  const messages = session.agent.state.messages || []
  const lastMessage = messages[messages.length - 1]
  return {
    sessionId: session.sessionId,
    scope: session.scope,
    projectId: session.projectId,
    source: session.source || undefined,
    channelId: session.channelId || undefined,
    channelName: session.channelName || undefined,
    title: session.title,
    createdAt: session.createdAt,
    lastModified: session.lastModified,
    stateVersion: session.stateVersion || 0,
    status: session.status,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    isStreaming: session.abortPending ? false : session.agent.state.isStreaming,
    errorMessage: session.agent.state.errorMessage,
    messageCount: messages.length,
    lastMessageTimestamp: lastMessage?.timestamp ?? null,
    persistDegraded: session.persistDegraded ? true : undefined,
    goal: sessionGoal(session),
  }
}

/**
 * Try to claim the SSE slot for a session. Returns true if acquired, false if
 * another tab already holds the SSE connection for this session.
 */
export function tryAcquireSse(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session || session.sseConnected) return false
  session.sseConnected = true
  return true
}

/**
 * Check whether a session already has an active SSE connection, without
 * acquiring it. For use by lightweight HEAD probes.
 */
export function isSseConnected(sessionId) {
  const session = agentSessions.get(sessionId)
  return session ? session.sseConnected : false
}

/**
 * Release the SSE slot for a session.
 */
export function releaseSse(sessionId) {
  const session = agentSessions.get(sessionId)
  if (session) session.sseConnected = false
}

/**
 * Get the event bus for a session (for SSE connections).
 */
export function getSessionEventBus(sessionId) {
  const session = agentSessions.get(sessionId)
  return session?.eventBus ?? null
}

/**
 * Destroy an agent session.
 */
export async function destroyAgent(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session) return

  logger.info(`Destroying session ${sessionId} (status: ${session.status})`, { sessionId, status: session.status })

  if (session.idleTimer) clearTimeout(session.idleTimer)
  if (session.persistTimer) {
    clearTimeout(session.persistTimer)
    session.persistTimer = null
  }
  session.toolTimings?.clear()
  // Drop goal runtime bookkeeping (watchdogs, continuation guards) before the
  // final persist; the persisted goal body itself is kept.
  stopGoalForSession(session)

  try {
    session.agent.abort()
  } catch {
    // ignore
  }

  // Clean up any pending approvals for this session before removing it.
  for (const [_toolCallId, approval] of pendingApprovals) {
    if (approval.sessionId === sessionId) approval.reject(new Error('Session destroyed'))
  }
  for (const [_approvalId, approval] of pendingAutoCompactApprovals) {
    if (approval.sessionId === sessionId) approval.reject(new Error('Session destroyed'))
  }

  // Final persist (empty sessions are cleaned up by persistSession)
  try {
    await persistSession(session)
  } catch {
    // ignore
  }

  session.eventBus.removeAllListeners()
  agentSessions.delete(sessionId)
}

// In-flight restores keyed by sessionId. Concurrent route handlers
// (POST /restore, GET /state, GET /messages, GET /status, SSE) all fall back
// to restoreAgent; without dedupe each raced through createAgent and the last
// agentSessions.set overwrote the others, leaking the overwritten sessions
// (listeners, idle/persist timers) forever.
// （pendingRestores 已收口至 agent-session-store.mjs）

/**
 * Try to restore an agent session from persisted storage.
 * Concurrent calls for the same session share one in-flight restore.
 * Returns the restored session, or null if not found.
 */
export function restoreAgent(sessionId) {
  const existing = agentSessions.get(sessionId)
  if (existing) return existing

  const inFlight = pendingRestores.get(sessionId)
  if (inFlight) return inFlight

  const restorePromise = restoreAgentUnlocked(sessionId).finally(() => {
    pendingRestores.delete(sessionId)
  })
  pendingRestores.set(sessionId, restorePromise)
  return restorePromise
}

async function restoreAgentUnlocked(sessionId) {
  try {
    const sessionData = await readSessionValue(sessionId)
    if (!sessionData) {
      logger.warn(`Cannot restore session ${sessionId}: no stored data found`, { sessionId })
      return null
    }

    logger.info(`Restoring session ${sessionId} from storage (scope: ${sessionData.scope}, messages: ${sessionData.messages?.length ?? 0})`, { sessionId, scope: sessionData.scope, messageCount: sessionData.messages?.length ?? 0 })

    // Read the authoritative storage record once: the body (split marker),
    // revision for CAS, and the stored message rows (count + tail digest) used
    // for split-representation conflict detection after restore.
    const record = readSessionStateRecord(sessionId)
    const storedMessages = record?.state?.messageStorage === 'split'
      ? storedMessagesState(sessionId)
      : null

    return await createAgent(sessionId, {
      scope: sessionData.scope || 'global',
      projectId: sessionData.projectId || null,
      source: sessionData.source || null,
      channelId: sessionData.channelId || null,
      channelName: sessionData.channelName || null,
      accessMode: normalizeAccessMode(sessionData.accessMode, sessionData.yoloMode),
      yoloMode: sessionData.yoloMode || false,
      model: sessionData.model,
      modelRef: sessionData.modelRef || null,
      resolvePersistedModel: true,
      // Restore must not block on MCP (re)connects: build tools from the
      // current snapshot; background refresh + toolset notification converge.
      mcpToolsMode: 'cached',
      thinkingLevel: sessionData.thinkingLevel || 'off',
      messages: sessionData.messages || [],
      title: sessionData.title || 'New chat',
      titleSource: sessionData.titleSource || (sessionData.title && sessionData.title !== 'New chat' ? 'ai' : 'default'),
      createdAt: sessionData.createdAt,
      lastModified: sessionData.lastModified,
      contextCompaction: sessionData.contextCompaction || null,
      idleRetention: sessionData.idleRetention || null,
      stateVersion: sessionData.stateVersion,
      persistedStateVersion: sessionData.stateVersion,
      persistedStorageRevision: record?.revision ?? null,
      persistedStateJson: canonicalStateJson(stripStorageOwnedStateFields(record?.state || {})),
      persistedMessageStorage: record?.state?.messageStorage === 'split' ? 'split' : null,
      persistedMessageCount: storedMessages?.count ?? (Array.isArray(sessionData.messages) ? sessionData.messages.length : 0),
      persistedTailDigest: storedMessages?.tailDigest || sessionMessagesTailDigest(sessionData.messages),
      // Goal bodies restore from the persisted session; in-flight statuses are
      // mapped to paused (no auto-replay) inside createAgent.
      restoredGoal: sessionData.goal || null,
    })
  } catch (err) {
    logger.error(`Failed to restore agent ${sessionId}:`, err, { sessionId })
    if (err?.statusCode === 503) throw err
    return null
  }
}

/**
 * Approve a pending tool call, allowing it to execute.
 */
export function approveToolCall(sessionId, toolCallId) {
  const approval = pendingApprovals.get(toolCallId)
  if (!approval || approval.sessionId !== sessionId) {
    throw Object.assign(new Error('No pending approval for this tool call'), { statusCode: 404 })
  }
  approval.resolve(true)
  return { approved: true, toolCallId }
}

/**
 * Reject a pending tool call, skipping its execution.
 */
export function rejectToolCall(sessionId, toolCallId) {
  const approval = pendingApprovals.get(toolCallId)
  if (!approval || approval.sessionId !== sessionId) {
    throw Object.assign(new Error('No pending approval for this tool call'), { statusCode: 404 })
  }
  approval.resolve(false)
  return { rejected: true, toolCallId }
}

export function approveAutoCompact(sessionId, approvalId) {
  const approval = pendingAutoCompactApprovals.get(approvalId)
  if (!approval || approval.sessionId !== sessionId) {
    throw Object.assign(new Error('No pending auto compact approval for this session'), { statusCode: 404 })
  }
  approval.resolve(true)
  return { approved: true, approvalId }
}

export function rejectAutoCompact(sessionId, approvalId) {
  const approval = pendingAutoCompactApprovals.get(approvalId)
  if (!approval || approval.sessionId !== sessionId) {
    throw Object.assign(new Error('No pending auto compact approval for this session'), { statusCode: 404 })
  }
  approval.resolve(false)
  return { rejected: true, approvalId }
}

/**
 * Resolve a pending ask_user call with the user's answers (or a skip).
 * `answers` is an array aligned with the ask's questions:
 * `[{ choices: string[], custom?: string }]`.
 */
export function answerAsk(sessionId, askId, { answers, skipped = false } = {}) {
  const ask = pendingAsks.get(askId)
  if (!ask || ask.sessionId !== sessionId) {
    throw Object.assign(new Error('No pending ask for this session'), { statusCode: 404 })
  }
  const normalizedAnswers = (Array.isArray(answers) ? answers : []).slice(0, ask.questions.length).map((answer) => ({
    choices: (Array.isArray(answer?.choices) ? answer.choices : [])
      .filter((choice) => typeof choice === 'string')
      .map((choice) => choice.slice(0, 500))
      .slice(0, 8),
    ...(typeof answer?.custom === 'string' && answer.custom.trim()
      ? { custom: answer.custom.slice(0, 4000) }
      : {}),
  }))
  if (skipped) ask.finish({ skipped: true })
  else ask.finish({ answers: normalizedAnswers })
  return { answered: true, askId, skipped: !!skipped }
}

export function abortToolCall(sessionId, toolCallId) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  const aborted = abortRunningCommand(toolCallId)
  if (!aborted) {
    throw Object.assign(new Error('No running command for this tool call'), { statusCode: 404 })
  }
  return { aborted: true, toolCallId }
}

/**
 * List all active sessions.
 */
export function listSessions() {
  const result = []
  for (const [id, session] of agentSessions) {
    result.push({
      sessionId: id,
      scope: session.scope,
      status: session.status,
      title: session.title,
      source: session.source || undefined,
      channelId: session.channelId || undefined,
      channelName: session.channelName || undefined,
      idleRetention: session.idleRetention || undefined,
    })
  }
  return result
}

export async function refreshAllSessionTools() {
  const result = []
  for (const [sessionId, session] of agentSessions) {
    try {
      await rebuildSessionTools(session)
      const state = getSessionState(sessionId)
      emitSessionEvent(session, { type: 'state', ...state })
      result.push({ sessionId, ok: true, toolCount: session.agent.state.tools?.length || 0 })
    } catch (error) {
      logger.error(`Failed to refresh tools for session ${sessionId}:`, error, { sessionId })
      result.push({ sessionId, ok: false, error: error?.message || 'Failed to refresh tools' })
    }
  }
  return result
}

// MCP toolset changes (background reconnects, startup warmup) rebuild tools
// for all active sessions so restored sessions that took a cached MCP tool
// snapshot converge without ever blocking POST /restore. refreshAllSessionTools
// rebuilds via the default await path — with servers already connected it only
// reuses connections, and an unchanged toolset signature does not notify
// again, so this never loops. registry.mjs never imports agent-manager.mjs
// (no circular dependency).
subscribeMcpToolsetChanged(() => {
  if (agentSessions.size === 0) return
  refreshAllSessionTools().catch((error) => {
    logger.warn(`Failed to refresh session tools after MCP toolset change: ${error?.message || error}`)
  })
})

/**
 * Refresh the model binding of every active session after model
 * configuration changes (custom providers, maxTokens, ...). Streaming sessions
 * are skipped (runPrompt re-resolves the binding on the next message). Only
 * sessions whose model actually changed get a state event.
 */
export async function refreshAllSessionModels() {
  for (const [sessionId, session] of agentSessions) {
    if (session.agent?.state?.isStreaming) continue
    try {
      const before = JSON.stringify(session.model ?? null)
      await refreshSessionModelBinding(session)
      const after = JSON.stringify(session.model ?? null)
      if (before === after) continue
      const state = getSessionState(sessionId)
      emitSessionEvent(session, { type: 'state', ...state })
    } catch (error) {
      // The model may have been deleted (model_not_configured); runPrompt will
      // surface the same error on the next message. Log and keep other
      // sessions refreshing.
      logger.error(`Failed to refresh model for session ${sessionId}:`, error, { sessionId })
    }
  }
}

export async function updateSessionTitle(sessionId, title) {
  let session = agentSessions.get(sessionId)
  if (!session) session = await restoreAgent(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  const normalizedTitle = typeof title === 'string' ? title.trim() : ''
  if (!normalizedTitle) {
    throw Object.assign(new Error('Title must not be empty'), { statusCode: 400 })
  }
  if (normalizedTitle.length > 200) {
    throw Object.assign(new Error('Title is too long'), { statusCode: 400 })
  }

  session.titleGenerationId += 1
  session.title = normalizedTitle
  session.titleSource = 'manual'
  await persistSession(session)
  emitSessionEvent(session, { type: 'title_updated', title: normalizedTitle, titleSource: 'manual' })
  return { sessionId, title: normalizedTitle, titleSource: 'manual' }
}

export async function updateSessionAccessMode(sessionId, accessMode) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }

  session.accessMode = normalizeAccessMode(accessMode, session.accessMode)
  session.yoloMode = yoloModeFromAccessMode(session.accessMode)
  await rebuildSessionTools(session)
  await persistSession(session)

  const state = getSessionState(sessionId)
  emitSessionEvent(session, { type: 'state', ...state })

  return { sessionId, accessMode: session.accessMode, yoloMode: session.yoloMode }
}

export async function updateSessionYoloMode(sessionId, yoloMode) {
  return updateSessionAccessMode(sessionId, yoloMode ? AGENT_ACCESS_MODE_FULL_ACCESS : AGENT_ACCESS_MODE_DEFAULT)
}

/**
 * Update the model for an existing session.
 * Syncs the model to both the session record (for persistence) and the agent state (for API calls).
 * Does NOT force persistence — normal lifecycle events (message_end, agent_end) will persist
 * the updated model.
 */
export function updateSessionModel(sessionId, model, modelRef = null) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  if (!model) {
    throw Object.assign(new Error('Missing model'), { statusCode: 400 })
  }

  session.model = model
  session.modelRef = modelRef
  session.resolvePersistedModel = true
  session.agent.state.model = model

  return { sessionId, model, modelRef: modelRef || undefined }
}

/**
 * Update the thinking level for an existing session.
 */
export function updateSessionThinkingLevel(sessionId, thinkingLevel) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  if (!thinkingLevel) {
    throw Object.assign(new Error('Missing thinkingLevel'), { statusCode: 400 })
  }

  session.thinkingLevel = thinkingLevel
  session.agent.state.thinkingLevel = thinkingLevel

  return { sessionId, thinkingLevel }
}

/**
 * Reset stale `taskStatus: 'running'` entries in persisted session metadata.
 * Called on server startup — any sessions marked as running are clearly stale
 * since the server just started fresh.
 */
export async function resetStaleTaskStatuses() {
  try {
    let changed = false
    await atomicUpdate('sessions-metadata', (metadataStore) => {
      for (const [id, meta] of Object.entries(metadataStore)) {
        if (meta && meta.taskStatus === 'running') {
          metadataStore[id] = { ...meta, taskStatus: 'idle', taskFinishedAt: meta.taskFinishedAt ?? new Date().toISOString() }
          changed = true
        }
      }
      return metadataStore
    })
    if (changed) {
      logger.info('Reset stale task statuses in persisted metadata')
    }
  } catch (err) {
    logger.error('Failed to reset stale task statuses:', err)
  }
}

/**
 * Clean up all agents on shutdown.
 */
export async function shutdown() {
  const ids = [...agentSessions.keys()]
  await Promise.all(ids.map((id) => destroyAgent(id)))
}
