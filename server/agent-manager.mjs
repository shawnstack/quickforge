import { EventEmitter } from 'node:events'
import { Agent } from '@mariozechner/pi-agent-core'
import { streamSimple } from '@mariozechner/pi-ai'
import { Type } from 'typebox'
import { toolHandlers } from './tools/index.mjs'
import { projectContextFromId } from './project-config.mjs'
import { readStore, atomicUpdate, readSessionValue, writeSessionValue } from './storage.mjs'
import { logger } from './utils/logger.mjs'
import { buildSystemPrompt, generateAiTitle } from './session-utils.mjs'
import { restoreReasoningContentInPayload } from './reasoning-cache.mjs'

// ---------------------------------------------------------------------------
// Tool definitions (server-side, no REST roundtrip)
// ---------------------------------------------------------------------------

function createServerTools(projectId, projectContext) {
  function tool(name, label, description, parameters, handler, executionMode) {
    return {
      name,
      label,
      description,
      parameters,
      executionMode,
      execute: async (_toolCallId, params) => {
        const result = await handler(params || {}, projectContext)
        return {
          content: [{ type: 'text', text: result.content }],
          details: result.details,
        }
      },
    }
  }

  return [
    tool(
      'get_project_info', 'Project info',
      'Get the project directory bound to this chat.',
      Type.Object({}),
      toolHandlers.get_project_info,
    ),
    tool(
      'list_dir', 'List directory',
      'List files and folders inside the project bound to this chat. Paths are relative to that project root.',
      Type.Object({
        path: Type.Optional(Type.String({ description: 'Directory path relative to the workspace root. Defaults to .', default: '.' })),
      }),
      toolHandlers.list_dir,
    ),
    tool(
      'read_file', 'Read file',
      'Read a UTF-8 text file inside the project bound to this chat. Use offset and limit for large files.',
      Type.Object({
        path: Type.String({ description: 'File path relative to the workspace root.' }),
        offset: Type.Optional(Type.Number({ description: '1-based line offset.', default: 1 })),
        limit: Type.Optional(Type.Number({ description: 'Maximum number of lines to return.', default: 200 })),
      }),
      toolHandlers.read_file,
    ),
    tool(
      'grep_files', 'Search files',
      'Search text in the project files bound to this chat. Returns matching file paths and line numbers.',
      Type.Object({
        query: Type.String({ description: 'Plain text or regular expression to search for.' }),
        path: Type.Optional(Type.String({ description: 'Directory path relative to the workspace root. Defaults to .', default: '.' })),
        regex: Type.Optional(Type.Boolean({ description: 'Treat query as a regular expression.', default: false })),
        caseSensitive: Type.Optional(Type.Boolean({ description: 'Use case-sensitive matching.', default: false })),
        limit: Type.Optional(Type.Number({ description: 'Maximum matches to return.', default: 200 })),
      }),
      toolHandlers.grep_files,
    ),
    tool(
      'write_file', 'Write file',
      'Create or overwrite a UTF-8 text file inside the project bound to this chat.',
      Type.Object({
        path: Type.String({ description: 'File path relative to the workspace root.' }),
        content: Type.String({ description: 'Complete file content to write.' }),
      }),
      toolHandlers.write_file,
      'sequential',
    ),
    tool(
      'edit_file', 'Edit file',
      'Edit a text file in the project bound to this chat by replacing exact text. oldText must match exactly once.',
      Type.Object({
        path: Type.String({ description: 'File path relative to the workspace root.' }),
        oldText: Type.String({ description: 'Exact existing text to replace. Must be unique in the file.' }),
        newText: Type.String({ description: 'Replacement text.' }),
      }),
      toolHandlers.edit_file,
      'sequential',
    ),
    tool(
      'run_command', 'Run command',
      'Run a shell command in the project bound to this chat. Use this for lint, build, tests, git status, and diagnostics.',
      Type.Object({
        command: Type.String({ description: 'Command to execute in the workspace.' }),
        timeoutSeconds: Type.Optional(Type.Number({ description: 'Timeout in seconds. Defaults to 60.', default: 60 })),
      }),
      toolHandlers.run_command,
      'sequential',
    ),
  ]
}

// ---------------------------------------------------------------------------
// Agent Manager
// ---------------------------------------------------------------------------

const agentSessions = new Map()

/** @typedef {{ agent: Agent, projectContext: object|null, projectId: string|null, yoloMode: boolean, model: object, thinkingLevel: string, scope: string, title: string, createdAt: string, status: string, startedAt: string|null, finishedAt: string|null, listeners: Set<function>, idleTimer: NodeJS.Timeout|null, eventBus: EventEmitter }} AgentSession */

const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

export const agentEvents = new EventEmitter()
agentEvents.setMaxListeners(100)

function resetIdleTimer(session) {
  if (session.idleTimer) clearTimeout(session.idleTimer)
  session.idleTimer = setTimeout(() => {
    logger.info(`Session ${session.sessionId} idle timeout (${IDLE_TIMEOUT_MS / 1000}s), destroying...`)
    destroyAgent(session.sessionId).catch((err) =>
      console.error(`Failed to destroy idle agent ${session.sessionId}:`, err),
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

/**
 * Create or retrieve an Agent for a session.
 * If the session already has a running agent, return it.
 * Otherwise, create a new Agent and optionally restore from storage.
 */
export async function createAgent(sessionId, config = {}) {
  const existing = agentSessions.get(sessionId)
  if (existing) {
    resetIdleTimer(existing)
    return existing
  }

  const {
    scope = 'global',
    projectId = null,
    yoloMode = false,
    model = null,
    thinkingLevel = 'off',
    messages = [],
    systemPrompt = null,
    title = 'New chat',
    createdAt = new Date().toISOString(),
  } = config

  // Resolve project context for tool calls
  let projectContext = null
  if (projectId) {
    try {
      projectContext = await projectContextFromId(projectId)
    } catch {
      // project not found — run without tools
    }
  }

  // Build system prompt
  const resolvedSystemPrompt = systemPrompt ?? (await buildSystemPrompt(projectId))

  // Resolve model
  let resolvedModel = model
  if (!resolvedModel) {
    // Try to load from storage
    try {
      const settings = await readStore('settings')
      const raw = settings?.['active-model']
      if (raw) resolvedModel = typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch {
      // ignore
    }
  }

  // Build tools if YOLO mode + project
  const tools = yoloMode && projectContext
    ? createServerTools(projectId, projectContext)
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

  const agent = new Agent({
    initialState: {
      systemPrompt: resolvedSystemPrompt,
      model: resolvedModel,
      thinkingLevel,
      messages,
      tools,
    },
    streamFn: streamSimple,
    getApiKey,
    sessionId,
    onPayload: (payload) => {
      restoreReasoningContentInPayload(payload, agent.state.messages, agent.state.model)
    },
    beforeToolCall: async (context) => {
      if (!projectContext) {
        return { block: true, reason: 'No active project. Select a project to use tools.' }
      }
      if (!yoloMode) {
        return { block: true, reason: 'YOLO mode is disabled. Enable it to use tools.' }
      }
      return undefined
    },
  })

  const eventBus = new EventEmitter()
  eventBus.setMaxListeners(100)

  const session = {
    sessionId,
    agent,
    projectContext,
    projectId,
    yoloMode,
    model: resolvedModel,
    thinkingLevel,
    scope,
    title,
    createdAt,
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    eventBus,
    idleTimer: null,
    titleGenerated: false,
    getApiKey,
    /** Track active SSE connections. Only one SSE stream allowed per session to prevent
     *  connection-pool exhaustion when two browser tabs load the same session. */
    sseConnected: false,
  }

  // Subscribe to agent lifecycle events and forward to eventBus
  agent.subscribe((event) => {
    // Forward all events to the session event bus and the global bus.
    eventBus.emit('agent_event', event)
    agentEvents.emit('agent_event', { sessionId, ...event })

    // Track status
    if (event.type === 'agent_start') {
      session.status = 'running'
      session.startedAt = session.startedAt ?? new Date().toISOString()
      session.finishedAt = null
      // Persist running state immediately so a browser refresh still shows the green dot
      persistSession(session).catch((err) =>
        console.error(`Failed to persist session on start ${sessionId}:`, err),
      )
    }

    if (event.type === 'agent_end') {
      session.status = session.agent.state.errorMessage ? 'error' : 'idle'
      session.finishedAt = new Date().toISOString()

      // Persist after run ends
      persistSession(session).catch((err) =>
        console.error(`Failed to persist session ${sessionId}:`, err),
      )
    }

    if (event.type === 'message_end') {
      // Do a lightweight persist on message_end for crash recovery
      persistSession(session).catch((err) =>
        console.error(`Failed to persist session ${sessionId}:`, err),
      )
    }
  })

  agentSessions.set(sessionId, session)
  resetIdleTimer(session)
  logger.info(`Created session ${sessionId} (scope: ${scope}, project: ${projectId || 'none'}, yolo: ${yoloMode})`)
  return session
}

/**
 * Persist session data to storage.
 */
async function persistSession(session) {
  const { sessionId, agent, scope, projectId, title, createdAt, status, startedAt, finishedAt, model, thinkingLevel, yoloMode } = session
  const messages = agent.state.messages

  const now = new Date().toISOString()
  const sessionData = {
    id: sessionId,
    title,
    model,
    thinkingLevel,
    yoloMode,
    messages,
    createdAt: createdAt || now,
    lastModified: now,
    scope,
    projectId: scope === 'project' ? projectId : undefined,
    taskStatus: status,
    taskStartedAt: startedAt,
    taskFinishedAt: finishedAt,
  }

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
    createdAt: createdAt || now,
    lastModified: now,
    messageCount: messages.length,
    usage,
    thinkingLevel,
    preview,
    scope,
    projectId: scope === 'project' ? projectId : undefined,
    taskStatus: status,
    taskStartedAt: startedAt,
    taskFinishedAt: finishedAt,
  }

  // Write to storage atomically (read-modify-write within queue)
  try {
    await writeSessionValue(sessionId, sessionData)
    await atomicUpdate('sessions-metadata', (data) => {
      data[sessionId] = metadata
      return data
    })
  } catch (err) {
    console.error(`Failed to persist session ${sessionId}:`, err)
  }
}

/**
 * Send a user message to the agent and start the agent loop.
 * Returns immediately; events are streamed via the event bus.
 */
export async function runPrompt(sessionId, message) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }

  resetIdleTimer(session)

  // Build user message
  const userMessage = typeof message === 'string'
    ? { role: 'user', content: message, timestamp: new Date().toISOString() }
    : message

  // AI title generation on first user message (fire-and-forget, before agent runs)
  if (!session.titleGenerated && session.title === 'New chat') {
    session.titleGenerated = true
    generateAiTitle([userMessage], session.model, session.thinkingLevel, session.getApiKey).then(async (aiTitle) => {
      if (aiTitle && aiTitle !== 'New chat') {
        session.title = aiTitle
        await persistSession(session)
        session.eventBus.emit('agent_event', { type: 'title_updated', title: aiTitle })
        agentEvents.emit('agent_event', { sessionId, type: 'title_updated', title: aiTitle })
      }
    }).catch((err) => {
      logger.warn(`Title generation failed for session ${sessionId}:`, err.message || err)
    })
  }

  // Fire and forget — events come through eventBus
  session.agent.prompt(userMessage).catch((err) => {
    logger.error(`Agent prompt error for session ${sessionId}:`, err)
    const event = {
      type: 'error',
      error: err.message || 'Unknown error',
    }
    session.eventBus.emit('agent_event', event)
    agentEvents.emit('agent_event', { sessionId, ...event })
  })

  return { sessionId, status: session.status }
}

/**
 * Abort the current agent run.
 */
export async function abortRun(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }

  session.agent.abort()

  if (session.status === 'running') {
    session.status = 'aborted'
    session.finishedAt = new Date().toISOString()
    persistSession(session).catch((err) =>
      console.error(`Failed to persist aborted session ${sessionId}:`, err),
    )
    const event = {
      type: 'agent_end',
      messages: session.agent.state.messages,
    }
    session.eventBus.emit('agent_event', event)
    agentEvents.emit('agent_event', { sessionId, ...event })
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

  const agentMessage = typeof message === 'string'
    ? { role: 'user', content: message, timestamp: Date.now() }
    : message

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

  const agentMessage = typeof message === 'string'
    ? { role: 'user', content: message, timestamp: Date.now() }
    : message

  session.agent.followUp(agentMessage)
  return { sessionId, followUp: true }
}

/**
 * Get the current state of a session (for page refresh recovery).
 */
export function getSessionState(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session) return null

  return {
    sessionId: session.sessionId,
    scope: session.scope,
    projectId: session.projectId,
    yoloMode: session.yoloMode,
    systemPrompt: session.agent.state.systemPrompt,
    model: session.model,
    thinkingLevel: session.thinkingLevel,
    title: session.title,
    createdAt: session.createdAt,
    status: session.status,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    messages: session.agent.state.messages,
    isStreaming: session.agent.state.isStreaming,
    errorMessage: session.agent.state.errorMessage,
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

  logger.info(`Destroying session ${sessionId} (status: ${session.status})`)

  if (session.idleTimer) clearTimeout(session.idleTimer)

  try {
    session.agent.abort()
  } catch {
    // ignore
  }

  // Final persist
  try {
    await persistSession(session)
  } catch {
    // ignore
  }

  session.eventBus.removeAllListeners()
  agentSessions.delete(sessionId)
}

/**
 * Try to restore an agent session from persisted storage.
 * Returns the restored session, or null if not found.
 */
export async function restoreAgent(sessionId) {
  const existing = agentSessions.get(sessionId)
  if (existing) return existing

  try {
    const sessionData = await readSessionValue(sessionId)
    if (!sessionData) {
      logger.warn(`Cannot restore session ${sessionId}: no stored data found`)
      return null
    }

    logger.info(`Restoring session ${sessionId} from storage (scope: ${sessionData.scope}, messages: ${sessionData.messages?.length ?? 0})`)

    return await createAgent(sessionId, {
      scope: sessionData.scope || 'global',
      projectId: sessionData.projectId || null,
      yoloMode: sessionData.yoloMode || false,
      model: sessionData.model,
      thinkingLevel: sessionData.thinkingLevel || 'off',
      messages: sessionData.messages || [],
      title: sessionData.title || 'New chat',
      createdAt: sessionData.createdAt,
    })
  } catch (err) {
    logger.error(`Failed to restore agent ${sessionId}:`, err)
    return null
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
    })
  }
  return result
}

/**
 * Update the model for an existing session.
 * Syncs the model to both the session record (for persistence) and the agent state (for API calls).
 * Does NOT force persistence — normal lifecycle events (message_end, agent_end) will persist
 * the updated model.
 */
export function updateSessionModel(sessionId, model) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  if (!model) {
    throw Object.assign(new Error('Missing model'), { statusCode: 400 })
  }

  session.model = model
  session.agent.state.model = model

  return { sessionId, model }
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
    const metadataStore = await readStore('sessions-metadata')
    let changed = false
    for (const [id, meta] of Object.entries(metadataStore)) {
      if (meta && meta.taskStatus === 'running') {
        metadataStore[id] = { ...meta, taskStatus: 'idle', taskFinishedAt: meta.taskFinishedAt ?? new Date().toISOString() }
        changed = true
      }
    }
    if (changed) {
      await atomicUpdate('sessions-metadata', () => metadataStore)
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
