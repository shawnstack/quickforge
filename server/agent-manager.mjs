import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { Agent } from '@earendil-works/pi-agent-core'
import { streamSimpleWithAiHttpLogging } from './ai-http-logger.mjs'
import { loadSkillToolContext, abortRunningCommand } from './tools/index.mjs'
import { createSkillTools, globalMemoryTool, workspaceTools } from './tools/definitions.mjs'
import { createMcpToolDefinitions, isMcpToolName, subscribeMcpToolsetChanged } from './mcp/registry.mjs'
import { createPluginToolDefinitions, isPluginToolName } from './plugins/registry.mjs'
import { createOpenCodeAcpAgent } from './opencode-acp-agent.mjs'
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
import { readSessionStateRecord, saveSessionStatePair, deleteSessionState, storedMessagesState, sessionMessagesTailDigest } from './session-state-service.mjs'
import { logger } from './utils/logger.mjs'
import { publishChannelSessionChanged } from './channels/event-relay.mjs'
import { withSessionPersistenceLock } from './session-persistence-lock.mjs'
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

export { normalizeAgentHarness, validateAgentHarness } from './agent-harness.mjs'
import { runSubagent } from './agent-subagent-runner.mjs'
import {
  createApprovalPromise,
  createAskUserPromise,
  createAcpApprovalPromise,
  createAutoCompactApprovalPromise,
} from './agent-approval-orchestrator.mjs'
import { resolveCommandState } from './agent-prompt-commands.mjs'
import { resetSessionCompaction, summarySession, compactSession, clearSession } from './agent-compaction.mjs'
import {
  AGENT_ACCESS_MODE_DEFAULT,
  AGENT_ACCESS_MODE_FULL_ACCESS,
  AGENT_HARNESS_QUICKFORGE,
  AGENT_HARNESS_OPENCODE,
  normalizeAgentHarness,
  normalizeAccessMode,
  yoloModeFromAccessMode,
  hasFullAccess,
} from './agent-harness.mjs'

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

// 内部共享导出（模块拆分临时暴露给 agent-subagent-runner，工具构建块迁移后收回）
export async function createServerTools(projectId, projectContext, skillsContext, includeWorkspaceTools, toolPermissions, options = {}) {
  const {
    allowedToolNames = null,
    includeSubagentTool = true,
    includeMcpTools = true,
    includePluginTools = true,
    mcpWaitForConnections = true,
    parentSessionId = null,
    sessionId = null,
    scope = 'global',
  } = options
  const allowedTools = allowedToolNames ? new Set(allowedToolNames) : null
  const isAllowed = (definition) => !allowedTools || allowedTools.has(definition.name)

  const skillTools = await createSkillTools({
    globalSkillNames: skillsContext.globalSkillNames,
    projectSkillNames: skillsContext.projectSkillNames,
    workspaceRoot: projectContext?.workspaceRoot,
  })
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
  if (session.harness === AGENT_HARNESS_OPENCODE) {
    session.agent.state.tools = []
    return
  }
  const profileToolNames = Array.isArray(session.agentProfile?.allowedTools) ? session.agentProfile.allowedTools : null
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
        }
      : {
          parentSessionId: session.sessionId,
          sessionId: session.sessionId,
          scope: session.scope,
        },
  )
}

// ---------------------------------------------------------------------------
// Agent Manager
// ---------------------------------------------------------------------------

// Harness/访问模式常量与归一化 helper 已迁至 agent-harness.mjs
// 斜杠命令状态解析与内置命令 prompt 模板已迁至 agent-prompt-commands.mjs
// 审批 / ask_user / ACP / 自动压缩审批 Promise 编排已迁至 agent-approval-orchestrator.mjs
// /summary、/compact、/clear 会话压缩业务已迁至 agent-compaction.mjs
// run_subagent 生命周期与 SUBAGENT_* 常量已迁至 agent-subagent-runner.mjs

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
    harness: rawHarness,
    harnessSessionId = null,
    sourceHarnessSessionId = null,
    openCodeUsage = null,
    agentProfile = null,
    idleRetention = null,
    stateVersion = 0,
    mcpToolsMode = 'await',
  } = config
  const accessMode = normalizeAccessMode(rawAccessMode, yoloMode)
  const resolvedYoloMode = yoloModeFromAccessMode(accessMode)
  const harness = normalizeAgentHarness(rawHarness)
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

  // Build system prompt and tools only for the native QuickForge runtime.
  const projectConfig = harness === AGENT_HARNESS_QUICKFORGE ? await readProjectConfig() : { projects: [], globalSkills: [] }
  const configuredProject = projectId
    ? projectConfig.projects.find((project) => project.id === projectId)
    : null
  const skillsContext = {
    globalSkillNames: projectConfig.globalSkills,
    projectSkillNames: configuredProject?.skills,
  }
  const profileSystemPrompt = agentProfileSystemPrompt(agentProfile)
  const resolvedSystemPrompt = harness === AGENT_HARNESS_QUICKFORGE
    ? systemPrompt ?? `${await buildSystemPrompt(projectId)}${profileSystemPrompt}`
    : ''
  if (harness === AGENT_HARNESS_OPENCODE && messages.length > 0 && !harnessSessionId && !sourceHarnessSessionId) {
    throw Object.assign(new Error('OpenCode history requires a persisted ACP session ID or an ACP fork source.'), { statusCode: 400 })
  }

  let resolvedAgentProfile = agentProfile

  // OpenCode owns its login, model, tools and context. QuickForge runtime keeps
  // the existing model resolution path unchanged.
  let resolvedModel = model
  let resolvedModelRef = modelRef
  if (!resolvedModel && harness === AGENT_HARNESS_QUICKFORGE) {
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
  const resolvedBinding = harness === AGENT_HARNESS_QUICKFORGE && resolvedModel
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

  // Build native tools only for QuickForge. OpenCode uses its own tools and
  // must not receive QuickForge MCP, Skills, Memory or workspace definitions.
  const profileToolNames = Array.isArray(agentProfile?.allowedTools) ? agentProfile.allowedTools : null
  const tools = harness === AGENT_HARNESS_QUICKFORGE
    ? await createServerTools(
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
            }
          : {
              mcpWaitForConnections,
              parentSessionId: sessionId,
              sessionId,
              scope,
            },
      )
    : []

  // Resolve API key
  const getApiKey = async (provider) => {
    try {
      const keys = await readStore('provider-keys')
      return keys?.[provider] || undefined
    } catch {
      return undefined
    }
  }

  const initialMemoryEnabled = harness === AGENT_HARNESS_QUICKFORGE ? await isGlobalMemoryEnabled() : false
  const initialMemoryRevision = initialMemoryEnabled ? await getGlobalMemoryRevision() : null
  let session
  const agent = harness === AGENT_HARNESS_OPENCODE
    ? await createOpenCodeAcpAgent({
        sessionId,
        cwd: projectContext.workspaceRoot,
        messages,
        harnessSessionId,
        sourceHarnessSessionId,
        restoredUsage: openCodeUsage,
        logger,
        requestPermission: (request) => createAcpApprovalPromise(session, request),
      })
    : new Agent({
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
      const isSkillTool = toolName === 'activate_skill' || toolName === 'read_skill_resource'
      if (isSkillTool) return undefined
      // ask_user only waits for the user's answer, and todo_write only records the latest plan snapshot; neither needs approval.
      if (toolName === 'ask_user' || toolName === 'todo_write') return undefined
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
    harness,
    harnessSessionId: agent.harnessSessionId || null,
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

    // OpenCode runtime usage snapshots are authoritative and lightweight; the
    // debounced write keeps the latest usage durable without blocking the run.
    if (event.type === 'acp_session_usage_update') {
      scheduleSessionPersist(session)
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
      session.abortPending = false
      session.abortEndEmitted = false
      session.status = eventEndStatus || (session.agent.state.errorMessage ? 'error' : 'idle')
      session.finishedAt = new Date().toISOString()
      session.toolTimings?.clear()
      resetIdleTimer(session)

      // Persist after run ends. Flush any debounced write so the final state is durable.
      flushSessionPersist(session).catch((err) =>
        logger.error(`Failed to persist session ${sessionId}:`, err, { sessionId }),
      )
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
            if (session.harness === AGENT_HARNESS_QUICKFORGE) scheduleSessionTitleGeneration(session, event.message)
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

function messageTimestampMs(message) {
  const timestamp = message?.timestamp
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) return timestamp
  if (typeof timestamp === 'string') {
    const trimmed = timestamp.trim()
    if (!trimmed) return undefined
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) return numeric
    const parsed = Date.parse(trimmed)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

function sessionLastModifiedFromMessages(messages, fallback) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const timestamp = messageTimestampMs(messages[index])
    if (timestamp !== undefined) return new Date(timestamp).toISOString()
  }

  const fallbackMs = Date.parse(fallback)
  return Number.isNaN(fallbackMs) ? new Date().toISOString() : new Date(fallbackMs).toISOString()
}

// Fields the agent does not own; a concurrent sidebar pin/archive update is the
// only legitimate way these change between the agent's read and its CAS save.
const SESSION_STORAGE_OWNED_STATE_FIELDS = ['pinnedAt', 'archivedAt']

function stripStorageOwnedStateFields(state) {
  const next = { ...state }
  for (const field of SESSION_STORAGE_OWNED_STATE_FIELDS) delete next[field]
  return next
}

/**
 * Split-representation conflict check: does the currently stored session match
 * the message state this session last persisted? Non-split sessions carry
 * messages inline in the body, which the caller already compares via
 * persistedStateJson; split sessions need the row count + tail digest because
 * their body excludes messages.
 */
function storedMessagesMatchLastPersist(session) {
  if (session.persistedMessageStorage !== 'split') return true
  if (session.persistedMessageCount === null) return true
  const stored = storedMessagesState(session.sessionId)
  if (!stored) return true
  return stored.count === session.persistedMessageCount
    && stored.tailDigest === session.persistedTailDigest
}

function canonicalStateJson(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonicalStateJson))
  if (value && typeof value === 'object') {
    return JSON.stringify(
      Object.fromEntries(
        Object.keys(value).sort()
          .filter((key) => value[key] !== undefined)
          .map((key) => [key, canonicalStateJson(value[key])]),
      ),
    )
  }
  return JSON.stringify(value)
}

/**
 * Mark the session as persist-degraded (an authoritative persist was skipped
 * after CAS conflicts) and notify connected clients so the UI can surface a
 * non-blocking warning instead of silently losing messages.
 */
function markPersistDegraded(session, attempts) {
  session.persistDegraded = { at: new Date().toISOString(), attempts }
  emitSessionEvent(session, { type: 'persist_degraded', persistDegraded: true })
}

/**
 * Clear the degraded marker after a successful persist and notify clients so
 * the UI warning disappears.
 */
function clearPersistDegraded(session) {
  if (!session.persistDegraded) return
  session.persistDegraded = null
  emitSessionEvent(session, { type: 'persist_degraded', persistDegraded: false })
}

/**
 * Persist a full session record in one authoritative SQLite transaction with
 * revision CAS. When the CAS fails because a concurrent metadata-only change
 * (pin/archive via the sidebar) bumped the revision, re-read the current row
 * and verify the only difference from what this session last persisted is
 * storage-owned fields; then merge and retry (bounded). If the storage row
 * changed in agent-owned fields, record the conflict and refuse to overwrite
 * the other writer — never fake success by clobbering it.
 * @returns {{state: object, metadata: object, revision: number, stateVersion: number} | null}
 */
async function persistAuthoritativeSessionState(session, sessionData, metadata) {
  const sessionId = session.sessionId
  const maxAttempts = 3
  let lastConflict = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const existing = readSessionStateRecord(sessionId)
    const existingMetadata = existing?.metadata
    const mergedMetadata = {
      ...existingMetadata,
      ...metadata,
      ...(existingMetadata?.archivedAt ? { archivedAt: existingMetadata.archivedAt } : {}),
      ...(existingMetadata?.pinnedAt ? { pinnedAt: existingMetadata.pinnedAt } : {}),
    }
    const persistedState = {
      ...(existing?.state || {}),
      ...sessionData,
      ...(mergedMetadata.archivedAt ? { archivedAt: mergedMetadata.archivedAt } : {}),
      ...(mergedMetadata.pinnedAt ? { pinnedAt: mergedMetadata.pinnedAt } : {}),
    }
    try {
      const saved = await saveSessionStatePair({
        state: persistedState,
        metadata: mergedMetadata,
        expectedRevision: session.persistedStorageRevision ?? existing?.revision ?? 0,
      })
      session.persistedStateJson = canonicalStateJson(stripStorageOwnedStateFields(saved.state))
      // F9 split bookkeeping: the savePair plan tells us exactly which
      // representation was written, so the conflict-detection counters stay in
      // sync with the stored rows (append/replace/body-only on split sessions,
      // inline on small sessions).
      if (saved.state?.messageStorage === 'split') {
        session.persistedMessageStorage = 'split'
        session.persistedMessageCount = saved.messageCount ?? sessionData.messages?.length ?? 0
      } else {
        session.persistedMessageStorage = null
        session.persistedMessageCount = Array.isArray(sessionData.messages) ? sessionData.messages.length : 0
      }
      session.persistedTailDigest = sessionMessagesTailDigest(sessionData.messages)
      clearPersistDegraded(session)
      return { ...saved, metadata: mergedMetadata }
    } catch (error) {
      if (error?.errorCode !== 'SESSION_STATE_CONFLICT') throw error
      lastConflict = error
      const current = readSessionStateRecord(sessionId)
      if (!current) return null
      const previous = session.persistedStateJson
      const bodyUnchanged = previous !== null && canonicalStateJson(stripStorageOwnedStateFields(current.state)) === previous
      // Split sessions keep messages out of the body, so the body comparison
      // alone would miss concurrent message writes. Compare the stored rows
      // (count + tail digest) against what this session last persisted.
      const messagesUnchanged = storedMessagesMatchLastPersist(session)
      if (bodyUnchanged && messagesUnchanged) {
        // Only storage-owned fields changed — adopt the storage row as the new
        // baseline and retry with the fresh revision.
        session.persistedStorageRevision = current.revision
        session.persistedStateVersion = current.stateVersion
        continue
      }
      session.persistConflictCount += 1
      logger.warn(`Session ${sessionId} persist conflict: storage changed agent-owned fields; skipping overwrite`, { sessionId })
      markPersistDegraded(session, attempt)
      return null
    }
  }
  session.persistConflictCount += 1
  logger.warn(`Session ${sessionId} persist still conflicting after ${maxAttempts} merge retries`, { sessionId, reason: lastConflict?.message })
  markPersistDegraded(session, maxAttempts)
  return null
}

/**
 * Persist session data to storage.
 */
async function persistSessionUnlocked(session) {
  const { sessionId, agent, harness, harnessSessionId, scope, projectId, source, channelId, channelName, title, titleSource, createdAt, lastModified: storedLastModified, status, startedAt, finishedAt, model, modelRef, thinkingLevel, accessMode, yoloMode, contextCompaction } = session
  const messages = agent.state.messages

  if (messages.length === 0) {
    try {
      deleteSessionState(sessionId, { expectedRevision: session.persistedStorageRevision })
      session.persistedStorageRevision = null
      session.persistedStateVersion = null
      session.persistedStateJson = null
      session.persistedMessageStorage = null
      session.persistedMessageCount = null
      session.persistedTailDigest = null
    } catch (err) {
      logger.error(`Failed to remove empty session ${sessionId}:`, err, { sessionId })
    }
    return
  }

  const now = new Date().toISOString()
  const lastModified = sessionLastModifiedFromMessages(messages, storedLastModified || createdAt || now)
  const sessionData = {
    id: sessionId,
    title,
    titleSource,
    harness,
    harnessSessionId: agent.harnessSessionId || harnessSessionId || undefined,
    openCodeUsage: harness === AGENT_HARNESS_OPENCODE && agent.state.acpSession?.usage ? agent.state.acpSession.usage : undefined,
    model,
    modelRef: modelRef || undefined,
    thinkingLevel,
    accessMode,
    yoloMode,
    messages,
    createdAt: createdAt || now,
    lastModified,
    scope,
    projectId: scope === 'project' ? projectId : undefined,
    source: source || undefined,
    channelId: channelId || undefined,
    channelName: channelName || undefined,
    taskStatus: status,
    taskStartedAt: startedAt,
    taskFinishedAt: finishedAt,
    contextCompaction: contextCompaction || undefined,
    idleRetention: session.idleRetention || undefined,
    stateVersion: Number.isFinite(session.stateVersion) ? session.stateVersion : 0,
  }
  session.lastModified = lastModified

  // Calculate usage
  let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.usage) {
      usage.input += msg.usage.input ?? 0
      usage.output += msg.usage.output ?? 0
      usage.cacheRead += msg.usage.cacheRead ?? 0
      usage.cacheWrite += msg.usage.cacheWrite ?? 0
      usage.totalTokens += msg.usage.totalTokens ?? 0
    }
  }

  // Generate preview from last assistant message
  let preview = ''
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      const content = messages[i].content
      if (Array.isArray(content)) {
        preview = content
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join(' ')
          .slice(0, 200)
      } else if (typeof content === 'string') {
        preview = content.slice(0, 200)
      }
      break
    }
  }

  const metadata = {
    id: sessionId,
    title,
    titleSource,
    createdAt: createdAt || now,
    lastModified,
    messageCount: messages.length,
    stateVersion: session.stateVersion || 0,
    usage,
    thinkingLevel,
    harness,
    harnessSessionId: agent.harnessSessionId || harnessSessionId || undefined,
    accessMode,
    yoloMode,
    preview,
    scope,
    projectId: scope === 'project' ? projectId : undefined,
    source: source || undefined,
    channelId: channelId || undefined,
    channelName: channelName || undefined,
    taskStatus: status,
    taskStartedAt: startedAt,
    taskFinishedAt: finishedAt,
    contextCompaction: contextCompaction ? {
      compactedAt: contextCompaction.compactedAt,
      compactedUpToIndex: contextCompaction.compactedUpToIndex,
      keepRecentTurns: contextCompaction.keepRecentTurns,
      thresholdPercent: contextCompaction.thresholdPercent,
      usageBefore: contextCompaction.usageBefore,
    } : undefined,
    idleRetention: session.idleRetention || undefined,
  }

  // Write body + metadata as one authoritative SQLite transaction.
  let persistedMetadata
  try {
    const saved = await persistAuthoritativeSessionState(session, sessionData, metadata)
    if (!saved) return null
    session.persistedStorageRevision = saved.revision
    session.persistedStateVersion = saved.stateVersion
    persistedMetadata = saved.metadata
  } catch (err) {
    logger.error(`Failed to persist session ${sessionId}:`, err, { sessionId })
    return null
  }

  if (source === 'acp' && channelId && persistedMetadata) {
    void publishChannelSessionChanged({
      channelId,
      channelName: channelName || undefined,
      sessionId,
      projectId: scope === 'project' ? projectId : null,
      workspace: scope === 'project'
        ? { id: projectId, kind: 'project' }
        : { id: 'default', kind: 'default' },
      change: 'upsert',
      metadata: persistedMetadata,
    })
  }

  return persistedMetadata || metadata
}

// Persist slower than this (queue wait + encode + synchronous SQLite write)
// is worth a warning: large sessions write big synchronous transactions that
// stall the event loop and make every in-flight request (including /restore)
// wait. The 200ms threshold surfaces the real-world distribution, not just
// the extreme tail, so persist optimizations stay measurable.
const SLOW_PERSIST_LOG_MS = 200

// 内部共享导出（模块拆分临时暴露，随 persistence 块迁移后收回）
export async function persistSession(session) {
  const startedAt = performance.now()
  // Serialize per session (per-row revision CAS guarantees correctness);
  // cross-session persists run independently instead of piling onto one
  // global chain that also gates destroyAgent.
  const lockKey = `session:${session.sessionId}`
  const result = await withSessionPersistenceLock(() => persistSessionUnlocked(session), lockKey)
  const durationMs = performance.now() - startedAt
  if (durationMs >= SLOW_PERSIST_LOG_MS) {
    logger.warn(`Session ${session.sessionId} persist took ${Math.round(durationMs)}ms (queue wait + write)`, {
      sessionId: session.sessionId,
      durationMs: Math.round(durationMs),
      messageCount: session.agent?.state?.messages?.length ?? 0,
    })
  }
  return result
}

export async function persistSessionState(session) {
  await flushSessionPersist(session)
}

/**
 * Coalesce fire-and-forget session persists during a run.
 *
 * persistSession() serializes the ENTIRE session (all messages) on every call,
 * and the agent event loop calls it on agent_start / each message_end / agent_end.
 * Within a single run these events fire many times (one per assistant turn +
 * tool result), so writing on each one makes cumulative disk I/O O(n^2) as a
 * conversation grows. These message_end call sites are fire-and-forget
 * (crash-recovery only), so we debounce them into at most one write per
 * PERSIST_DEBOUNCE_MS. Run boundaries (agent_end) and explicit persists cancel
 * the pending timer and write the current state immediately, so the final
 * state is always durable.
 */
const PERSIST_DEBOUNCE_MS = 400

function scheduleSessionPersist(session) {
  if (session.persistTimer) return
  session.persistTimer = setTimeout(() => {
    session.persistTimer = null
    persistSession(session).catch((err) =>
      logger.error(`Failed to persist session ${session.sessionId}:`, err, { sessionId: session.sessionId }),
    )
  }, PERSIST_DEBOUNCE_MS).unref?.()
}

/**
 * Cancel any pending debounced write and persist the current state immediately.
 * Used at run boundaries (agent_end) and by explicit persistSessionState() so
 * the final state is always durable regardless of a pending timer.
 */
async function flushSessionPersist(session) {
  if (session.persistTimer) {
    clearTimeout(session.persistTimer)
    session.persistTimer = null
  }
  return persistSession(session)
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
  if (session.harness === AGENT_HARNESS_OPENCODE) {
    throw Object.assign(new Error('OpenCode does not support rollback from a message position. This action is unavailable for OpenCode conversations.'), { statusCode: 409 })
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
  if (session.harness === AGENT_HARNESS_QUICKFORGE) await refreshSessionModelBinding(session)
  if (session.harness === AGENT_HARNESS_QUICKFORGE) await refreshMemoryState(session)
  resetIdleTimer(session)

  const commandState = session.harness === AGENT_HARNESS_QUICKFORGE
    ? await resolveCommandState(session, canonicalInitialUserMessage, promptCommand)
    : { userMessage: canonicalInitialUserMessage }
  const resolvedUserMessage = commandState.userMessage ?? canonicalInitialUserMessage

  if (session.harness === AGENT_HARNESS_OPENCODE) {
    session.agent.validatePrompt(resolvedUserMessage)
  }

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

  const userMessage = session.harness === AGENT_HARNESS_QUICKFORGE
    ? prepareCloudUserMessage(session, resolvedUserMessage)
    : resolvedUserMessage

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

  // Fire and forget — events come through eventBus
  session.agent.prompt(userMessage).catch((err) => {
    logger.error(`Agent prompt error for session ${sessionId}:`, err, { sessionId })
    if (session.harness === AGENT_HARNESS_OPENCODE) return
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
    flushSessionPersist(session).catch((persistErr) =>
      logger.error(`Failed to persist session ${sessionId} after prompt error:`, persistErr, { sessionId }),
    )
  }).finally(() => {
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
  if (session.harness === AGENT_HARNESS_OPENCODE) {
    throw Object.assign(new Error('OpenCode does not support retry from a message position. This action is unavailable for OpenCode conversations.'), { statusCode: 409 })
  }
  if (modelAccessContext) session.modelAccessContext = modelAccessContext
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
  const commandState = await resolveCommandState(session, canonicalLastUserMessage)
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

  session.agent.continue().catch((err) => {
    logger.error(`Agent continue error for session ${sessionId}:`, err, { sessionId })
    emitSessionEvent(session, { type: 'error', error: err.message || 'Unknown error' })
  }).finally(() => {
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
 * Queue a steering message to inject after the current assistant turn.
 */
export function steerAgent(sessionId, message) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }

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
    harness: session.harness,
    harnessSessionId: session.agent.harnessSessionId || session.harnessSessionId || undefined,
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
    acpSession: session.harness === AGENT_HARNESS_OPENCODE ? session.agent.state.acpSession : undefined,
    isStreaming: session.abortPending ? false : session.agent.state.isStreaming,
    errorMessage: session.agent.state.errorMessage,
    persistDegraded: session.persistDegraded ? true : undefined,
  }
}

/**
 * Get a lightweight status snapshot for SSE-first state recovery.
 */
export function getSessionStatus(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session) return null

  const messages = session.agent.state.messages || []
  const lastMessage = messages[messages.length - 1]
  return {
    sessionId: session.sessionId,
    scope: session.scope,
    projectId: session.projectId,
    harness: session.harness,
    harnessSessionId: session.agent.harnessSessionId || session.harnessSessionId || undefined,
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

  try {
    session.agent.abort()
    if (session.harness === AGENT_HARNESS_OPENCODE) await session.agent.dispose?.()
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
// (listeners, idle/persist timers, OpenCode child processes) forever.
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
      harness: normalizeAgentHarness(sessionData.harness),
      harnessSessionId: typeof sessionData.harnessSessionId === 'string' ? sessionData.harnessSessionId : null,
      openCodeUsage: sessionData.openCodeUsage || null,
      idleRetention: sessionData.idleRetention || null,
      stateVersion: sessionData.stateVersion,
      persistedStateVersion: sessionData.stateVersion,
      persistedStorageRevision: record?.revision ?? null,
      persistedStateJson: canonicalStateJson(stripStorageOwnedStateFields(record?.state || {})),
      persistedMessageStorage: record?.state?.messageStorage === 'split' ? 'split' : null,
      persistedMessageCount: storedMessages?.count ?? (Array.isArray(sessionData.messages) ? sessionData.messages.length : 0),
      persistedTailDigest: storedMessages?.tailDigest || sessionMessagesTailDigest(sessionData.messages),
    })
  } catch (err) {
    logger.error(`Failed to restore agent ${sessionId}:`, err, { sessionId })
    if (err?.statusCode === 503 || err?.errorCode === 'OPENCODE_UNAVAILABLE') throw err
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
      harness: session.harness,
      harnessSessionId: session.agent.harnessSessionId || session.harnessSessionId || undefined,
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
 * Refresh the model binding of every active QuickForge session after model
 * configuration changes (custom providers, maxTokens, ...). OpenCode owns its
 * model selection and streaming sessions are skipped (runPrompt re-resolves
 * the binding on the next message). Only sessions whose model actually
 * changed get a state event.
 */
export async function refreshAllSessionModels() {
  for (const [sessionId, session] of agentSessions) {
    if (session.harness !== AGENT_HARNESS_QUICKFORGE) continue
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
  if (session.harness === AGENT_HARNESS_QUICKFORGE) await rebuildSessionTools(session)
  await persistSession(session)

  const state = getSessionState(sessionId)
  emitSessionEvent(session, { type: 'state', ...state })

  return { sessionId, accessMode: session.accessMode, yoloMode: session.yoloMode }
}

export async function updateSessionYoloMode(sessionId, yoloMode) {
  return updateSessionAccessMode(sessionId, yoloMode ? AGENT_ACCESS_MODE_FULL_ACCESS : AGENT_ACCESS_MODE_DEFAULT)
}

function requireOpenCodeHarnessSession(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session) throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  if (session.harness !== AGENT_HARNESS_OPENCODE) {
    throw Object.assign(new Error('Harness configuration is only available for OpenCode sessions.'), { statusCode: 409 })
  }
  return session
}

export async function updateSessionHarnessConfigOption(sessionId, configId, value) {
  const session = requireOpenCodeHarnessSession(sessionId)
  await session.agent.setConfigOption(configId, value)
  const state = getSessionState(sessionId)
  emitSessionEvent(session, { type: 'state', ...state })
  return { sessionId, acpSession: state.acpSession }
}

export async function updateSessionHarnessMode(sessionId, modeId) {
  const session = requireOpenCodeHarnessSession(sessionId)
  await session.agent.setMode(modeId)
  const state = getSessionState(sessionId)
  emitSessionEvent(session, { type: 'state', ...state })
  return { sessionId, acpSession: state.acpSession }
}

/**
 * Fork the entire current OpenCode session into a new QuickForge session.
 *
 * OpenCode ACP only supports whole-session `session/fork` (no message-position
 * fork), so the new agent is created with the full message history and
 * `sourceHarnessSessionId` pointing at the current ACP session. The new session
 * is persisted immediately and announced through the existing `session_forked`
 * event so clients switch to it without a message-level fork semantic.
 */
export async function forkSession(sessionId) {
  const session = requireOpenCodeHarnessSession(sessionId)
  if (session.agent.state.isStreaming) {
    throw Object.assign(new Error('Generation is still running. Stop it or wait until it finishes before forking the conversation.'), {
      statusCode: 409,
      errorCode: 'GENERATION_STILL_RUNNING_BEFORE_FORK',
    })
  }
  const sourceHarnessSessionId = session.agent.harnessSessionId
  if (!sourceHarnessSessionId) {
    throw Object.assign(new Error('This OpenCode conversation has no ACP session to fork.'), { statusCode: 409 })
  }
  const messages = session.agent.state.messages
  if (messages.length === 0) {
    throw Object.assign(new Error('There is no conversation to fork yet.'), { statusCode: 400 })
  }
  const forkedSessionId = randomUUID()
  const forkedSession = await createAgent(forkedSessionId, {
    scope: session.scope,
    projectId: session.projectId,
    accessMode: session.accessMode,
    yoloMode: session.yoloMode,
    model: session.model,
    modelRef: session.modelRef,
    modelAccessContext: session.modelAccessContext,
    resolvePersistedModel: true,
    thinkingLevel: session.thinkingLevel,
    messages,
    title: session.title,
    titleSource: session.titleSource === 'default' ? 'manual' : session.titleSource,
    createdAt: new Date().toISOString(),
    harness: session.harness,
    sourceHarnessSessionId,
    idleRetention: session.idleRetention || null,
  })
  updateSessionMessages(forkedSession, messages)
  await persistSession(forkedSession)

  emitSessionEvent(session, {
    type: 'session_forked',
    sourceSessionId: session.sessionId,
    targetSessionId: forkedSessionId,
    title: forkedSession.title,
    createdAt: forkedSession.createdAt,
    scope: forkedSession.scope,
    projectId: forkedSession.projectId,
    messages: forkedSession.agent.state.messages,
  })
  emitSessionEvent(forkedSession, { type: 'state', ...getSessionState(forkedSessionId) })
  emitSessionEvent(forkedSession, { type: 'message_end', messages: forkedSession.agent.state.messages })
  emitSessionEvent(forkedSession, { type: 'agent_end', messages: forkedSession.agent.state.messages })
  return {
    sessionId: forkedSessionId,
    title: forkedSession.title,
    createdAt: forkedSession.createdAt,
    scope: forkedSession.scope,
    projectId: forkedSession.projectId,
  }
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
  if (session.harness === AGENT_HARNESS_OPENCODE) {
    throw Object.assign(new Error('OpenCode manages its model natively.'), { statusCode: 409 })
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
  if (session.harness === AGENT_HARNESS_OPENCODE) {
    throw Object.assign(new Error('OpenCode manages its thinking level natively.'), { statusCode: 409 })
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
