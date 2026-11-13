// agent-manager 模块拆分（god-module-decomposition ⑤）会话生命周期编排：
// createAgent / restoreAgent / syncSessionFromStorage / destroyAgent /
// listSessions / shutdown / resetStaleTaskStatuses 与运行时刷新
// （refreshSessionModelBinding / refreshSessionRuntime）从 agent-manager.mjs
// 逐字搬移至此；公共 API 全部经 agent-manager.mjs facade re-export，
// 行为与注释语义不变。

import { EventEmitter } from 'node:events'
import { Agent } from '@earendil-works/pi-agent-core'
import { streamSimpleWithAiHttpLogging } from './ai-http-logger.mjs'
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
import { getWorkingMemoryRevision, isWorkingMemoryEnabled } from './working-memory.mjs'
import { buildSystemPrompt } from './session-utils.mjs'
import { serverConvertToLlm } from './message-converters.mjs'
import { restoreReasoningContentInPayload } from './reasoning-cache.mjs'
import {
  safeReadTools,
  pendingApprovals,
  commandToolPermissionError,
  createCommandToolPermissions,
} from './approval-store.mjs'
import { createApprovalPromise } from './agent-approval-orchestrator.mjs'
import { isMcpToolName, isReadOnlyMcpTool } from './mcp/registry.mjs'
import { isPluginToolName } from './plugins/registry.mjs'
import {
  goalPlanningToolBlockReason,
  goalRunSettlementToolBlockReason,
  stopGoalForSession,
} from './goal/engine.mjs'
import { goalAfterRestore, normalizeGoalState } from './agent-goal-state.mjs'
import { goalViewV2, normalizeGoalV2 } from './goal/state.mjs'
import {
  normalizeAccessMode,
  yoloModeFromAccessMode,
  hasFullAccess,
} from './agent-access-mode.mjs'
import { emitSessionEvent } from './agent-session-events.mjs'
import {
  persistSession,
  stripStorageOwnedStateFields,
  canonicalStateJson,
} from './agent-persistence.mjs'
import { clearSessionLease } from './agent-session-lease.mjs'
import { stopBackgroundCommandTasksForSession } from './tools/index.mjs'
import {
  agentSessions,
  pendingRestores,
  takeStashedSubagentErrorDetails,
} from './agent-session-store.mjs'
import { createServerTools, rebuildSessionTools, appendGoalTools, workflowApprovalArgs } from './agent-tool-assembly.mjs'
import { sessionSkillsContext } from './tool-wiring.mjs'
import { transformSessionContext } from './agent-context-transform.mjs'
import { resetIdleTimer } from './agent-idle-recycler.mjs'
import { subscribeAgentSessionEvents } from './agent-run-events.mjs'
import { currentSessionTurnId } from './agent-turn-ids.mjs'

// 访问模式常量与归一化 helper 见 agent-access-mode.mjs
// 斜杠命令状态解析与内置命令 prompt 模板见 agent-prompt-commands.mjs
// 审批 / ask_user / 自动压缩审批 Promise 编排见 agent-approval-orchestrator.mjs
// /summary、/compact、/clear 会话压缩业务见 agent-compaction.mjs
// run_subagent 生命周期与 SUBAGENT_* 常量见 agent-subagent-runner.mjs
// 会话持久化见 agent-persistence.mjs（persistSessionState 为公共 API 经 facade re-export）

/** @typedef {{ agent: Agent, projectContext: object|null, projectId: string|null, accessMode: string, yoloMode: boolean, model: object, thinkingLevel: string, scope: string, title: string, createdAt: string, status: string, startedAt: string|null, finishedAt: string|null, listeners: Set<function>, idleTimer: NodeJS.Timeout|null, eventBus: EventEmitter }} AgentSession */

function agentProfileSystemPrompt(agentProfile) {
  return agentProfile?.systemPrompt
    ? `\n\n<agent_profile_instructions>\nAgent Profile: ${agentProfile.label || agentProfile.name}\n${agentProfile.systemPrompt}\n</agent_profile_instructions>`
    : ''
}

async function resolvedSessionSystemPrompt(projectId, agentProfile) {
  return `${await buildSystemPrompt(projectId)}${agentProfileSystemPrompt(agentProfile)}`
}

// --- Turn-boundary runtime reconciliation -----------------------------------
//
// A session snapshots runtime settings when it is created (model binding,
// memory switches, skill selections). Snapshots exist so a running turn stays
// coherent — but they used to be permanent, so a settings change only reached
// sessions that were recreated (a live chat never saw a freshly enabled
// skill: the activate_skill enum and the <available_skills> catalog were both
// built from the creation-time names). Every top-level turn therefore starts
// by reconciling the snapshot against current config here (runPrompt,
// continueSession and goal rounds all funnel into this). One rebuild happens
// at most per turn even when several sources changed, where the previous
// per-source refreshes rebuilt twice (once for memory, once for working
// memory) in the same turn.
function skillsSelectionForSession(config, projectId) {
  const project = projectId ? config.projects.find((item) => item.id === projectId) : null
  return {
    globalSkillNames: Array.isArray(config.globalSkills) ? config.globalSkills : [],
    projectSkillNames: Array.isArray(project?.skills) ? project.skills : [],
  }
}

function sameSkillSelection(a, b) {
  const sorted = (names) => (Array.isArray(names) ? [...names].sort() : [])
  const sameList = (left, right) => {
    const a2 = sorted(left)
    const b2 = sorted(right)
    return a2.length === b2.length && a2.every((name, index) => name === b2[index])
  }
  return sameList(a?.globalSkillNames, b?.globalSkillNames)
    && sameList(a?.projectSkillNames, b?.projectSkillNames)
}

export async function refreshSessionRuntime(session) {
  await refreshSessionModelBinding(session)

  const memoryEnabled = await isGlobalMemoryEnabled()
  const memoryRevision = memoryEnabled ? await getGlobalMemoryRevision() : null
  const workingMemoryEnabled = await isWorkingMemoryEnabled()
  const workingMemoryRevision = workingMemoryEnabled ? await getWorkingMemoryRevision() : null
  // Skill selections live in the project config; readProjectConfig is served
  // from the (mtime, size) validated cache, so this reconciliation costs one
  // stat per turn when nothing changed.
  const skillsSelection = skillsSelectionForSession(await readProjectConfig(), session.projectId)

  const memoryChanged = session.memoryEnabled !== memoryEnabled || session.memoryRevision !== memoryRevision
  const workingMemoryChanged = session.workingMemoryEnabled !== workingMemoryEnabled || session.workingMemoryRevision !== workingMemoryRevision
  const skillsChanged = !sameSkillSelection(sessionSkillsContext(session), skillsSelection)
  if (!memoryChanged && !workingMemoryChanged && !skillsChanged) return

  session.memoryEnabled = memoryEnabled
  session.memoryRevision = memoryRevision
  session.workingMemoryEnabled = workingMemoryEnabled
  session.workingMemoryRevision = workingMemoryRevision
  session.globalSkillNames = skillsSelection.globalSkillNames
  session.projectSkillNames = skillsSelection.projectSkillNames

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
    // Internal: v2 is the production default. Tests for the legacy runner
    // set QUICKFORGE_GOAL_ENGINE=legacy; the settings UI no longer exposes
    // a choice.
    goalEngine = process.env.QUICKFORGE_GOAL_ENGINE === 'legacy' ? 'legacy' : 'v2',
  } = config
  // A goal that was in flight when the process stopped is paused, never
  // replayed. The restored body is normalized defensively so a malformed or
  // tampered persisted goal can never become an authoritative in-memory goal.
  // A v2 document keeps its durable phase; activation still starts disarmed.
  const resolvedGoalEngine = goalEngine
  const initialGoal = restoredGoal?.phase
    ? goalViewV2(normalizeGoalV2(restoredGoal, { sessionId }), { activation: 'disarmed', runtime: 'idle' })
    : goalAfterRestore(normalizeGoalState(restoredGoal, { sessionId }), Date.now())
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
          includeWorkflowTool: false,
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
  const initialWorkingMemoryEnabled = await isWorkingMemoryEnabled()
  const initialWorkingMemoryRevision = initialWorkingMemoryEnabled ? await getWorkingMemoryRevision() : null
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
    afterToolCall: async ({ toolCall, isError, result }) => {
      // goal_report reports validation failures as a returned result
      // (`isError: true`, details carry the stable code) instead of throwing,
      // because pi-agent-core keeps only the message of a thrown tool error.
      // The executor marks only thrown errors, so promote the returned flag to
      // keep the toolResult message an error result with its details intact.
      if (toolCall?.name === 'goal_report' && result?.isError === true) return { isError: true }
      if (!isError || (toolCall?.name !== 'run_subagent' && toolCall?.name !== 'run_workflow')) return undefined
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
      if (toolName === 'run_workflow') {
        // The workflow worker is a worker thread in the server process. In
        // default access mode the user explicitly approves starting one; the
        // agents it spawns keep their own tool-level approval policy.
        if (!hasFullAccess(currentSession)) {
          return createApprovalPromise(currentSession, toolCallId, toolName, workflowApprovalArgs(context.args), {
            type: 'workflow',
            label: 'Workflow',
          })
        }
        return undefined
      }
      if (isMcpToolName(toolName) || isPluginToolName(toolName)) {
        if (!hasFullAccess(currentSession)) {
          // 只读 MCP 工具（读页面、截图）不打断：浏览器任务天然是连续调用，
          // 逐次审批只会逼用户改用 full access，反而更不安全。
          if (isMcpToolName(toolName) && isReadOnlyMcpTool(toolName)) return undefined
          return createApprovalPromise(currentSession, toolCallId, toolName, context.args)
        }
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
    /**
     * In-flight compaction notice (`{ phase, usage, thresholdPercent,
     * requestedAt }`) or null. Projected by
     * `getSessionState` and mirrored to `state.compactionNotice` on the client;
     * see `COMPACTION_NOTICE_PHASES` in `auto-compaction.mjs` for why the whole
     * pipeline is projected instead of fire-and-forget events.
     */
    compactionNotice: null,
    stateVersion: Number.isFinite(stateVersion) ? Math.max(0, stateVersion) : 0,
    persistedStateVersion: Number.isFinite(config.persistedStateVersion) ? Math.max(0, config.persistedStateVersion) : null,
    persistedStorageRevision: Number.isFinite(config.persistedStorageRevision) ? Math.max(0, config.persistedStorageRevision) : null,
    persistedStateJson: typeof config.persistedStateJson === 'string' ? config.persistedStateJson : null,
    // F9 split-message bookkeeping: the count and tail-message digest of the
    // last authoritative persist, plus the storage representation marker. Used
    // for split-representation conflict detection and lightweight SSE frames.
    persistedMessageStorage: config.persistedMessageStorage === 'split' ? 'split' : null,
    persistedMessageCount: Number.isInteger(config.persistedMessageCount) && config.persistedMessageCount >= 0 ? config.persistedMessageCount : null,
    deliveredMessageCount: Number.isInteger(config.persistedMessageCount) && config.persistedMessageCount >= 0 ? config.persistedMessageCount : 0,
    persistedTailDigest: typeof config.persistedTailDigest === 'string' ? config.persistedTailDigest : null,
    persistConflictCount: 0,
    // Set when an authoritative persist is skipped after CAS conflicts; cleared
    // on the next successful persist. Surfaced via getSessionState/getSessionStatus
    // so the UI can warn the user instead of silently losing messages.
    persistDegraded: null,
    memoryEnabled: initialMemoryEnabled,
    memoryRevision: initialMemoryRevision,
    workingMemoryEnabled: initialWorkingMemoryEnabled,
    workingMemoryRevision: initialWorkingMemoryRevision,
    managedSystemPrompt: systemPrompt == null,
    // Goal mode: authoritative goal body (persisted with the session) plus
    // runtime-only bookkeeping for the active run and progress accounting.
    goal: initialGoal,
    goalEngine: resolvedGoalEngine,
    goalEvents: Array.isArray(config.goalEvents) ? config.goalEvents : null,
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
  // （事件扇出+落库已迁至 agent-run-events.mjs 的 subscribeAgentSessionEvents）
  subscribeAgentSessionEvents(session)

  agentSessions.set(sessionId, session)
  appendGoalTools(session)
  resetIdleTimer(session)

  // A client-created session that already carries a transcript (fork, seeded
  // conversation) must land in the session index immediately. The ordinary
  // `session_created` write only happens on the first user message_end, and that
  // path is skipped once messages were preseeded — so without this the fork
  // lives in memory only and the sidebar stays empty until the user sends yet
  // another message. No event is emitted here: the creating client already
  // refreshes the list from the index, and skipping `emitSessionEvent` keeps
  // `stateVersion` untouched at creation time.
  //
  // Restored sessions are excluded: `persistedStateJson` is produced only by the
  // restore path, and those rows already exist. Sessions created without
  // messages (deferred new chat, ACP, scheduled tasks) keep the existing
  // lazy-persist behaviour.
  if (messages.length > 0 && typeof config.persistedStateJson !== 'string') {
    try {
      await persistSession(session)
    } catch (err) {
      logger.error(`Failed to persist seeded session ${sessionId}:`, err, { sessionId })
    }
  }

  logger.info(`Created session ${sessionId} (scope: ${scope}, project: ${projectId || 'none'}, access: ${accessMode})`, { sessionId, scope, projectId: projectId || undefined, accessMode, yoloMode: resolvedYoloMode, idleRetention: idleRetention || undefined })
  return session
}

export async function refreshSessionModelBinding(session) {
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
  stopBackgroundCommandTasksForSession(sessionId)

  // Clean up any pending approvals for this session before removing it.
  for (const [_toolCallId, approval] of pendingApprovals) {
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
  // Force-clear the write lease: a destroyed session must never keep a stale
  // holder that would block the next restore (the editor is gone, so there is
  // no connection left to expire the lease naturally).
  clearSessionLease(sessionId, { force: true })
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

    const restored = await createAgent(sessionId, {
      scope: sessionData.scope || 'global',
      projectId: sessionData.projectId || null,
      source: sessionData.source || null,
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
      goalEvents: Array.isArray(sessionData.goalEvents) ? sessionData.goalEvents : null,
      goalEngine: sessionData.goalEngine === 'v2' ? 'v2' : undefined,
    })
    return restored
  } catch (err) {
    logger.error(`Failed to restore agent ${sessionId}:`, err, { sessionId })
    if (err?.statusCode === 503) throw err
    throw Object.assign(new Error('Failed to restore session. Please try again.', { cause: err }), {
      statusCode: 500,
      errorCode: 'SESSION_RESTORE_FAILED',
    })
  }
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
      idleRetention: session.idleRetention || undefined,
    })
  }
  return result
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
