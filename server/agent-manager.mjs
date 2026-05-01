import { EventEmitter } from 'node:events'
import { Agent } from '@mariozechner/pi-agent-core'
import { streamSimple } from '@mariozechner/pi-ai'
import { Type } from 'typebox'
import { toolHandlers } from './tools/index.mjs'
import { projectContextFromId, readInstructionsFile } from './project-config.mjs'
import { readStore, writeStore, dataDir } from './storage.mjs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const BASE_SYSTEM_PROMPT =
  'You are a helpful AI assistant. Answer clearly and pragmatically. If the user asks for code, prefer concise working examples. When YOLO mode is enabled, you may use the local workspace tools to inspect files, edit files, and run commands in the current project.'

async function buildSystemPrompt(projectId) {
  const parts = [BASE_SYSTEM_PROMPT]

  const globalInstructions = await readInstructionsFile(path.join(dataDir, 'AGENTS.md'))
  if (globalInstructions) {
    parts.push(`\n<user_instructions>\n${globalInstructions}\n</user_instructions>`)
  }

  if (projectId) {
    try {
      const { workspaceRoot } = await projectContextFromId(projectId)
      const projectInstructions = await readInstructionsFile(path.join(workspaceRoot, 'AGENTS.md'))
      if (projectInstructions) {
        parts.push(`\n<project_instructions>\n${projectInstructions}\n</project_instructions>`)
      }
    } catch {
      // project not found — skip
    }
  }

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// AI title generation
// ---------------------------------------------------------------------------

function generateTitle(messages) {
  const firstUser = messages.find(
    (m) => m.role === 'user' || m.role === 'user-with-attachments',
  )
  if (!firstUser) return 'New chat'
  const content = firstUser.content
  const text = typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' ')
    : ''
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized) return 'New chat'
  return normalized.length > 46 ? `${normalized.slice(0, 43)}...` : normalized
}

function normalizeAiTitle(value) {
  return value
    .trim()
    .replace(/^[[\s"'""''`]+|[\]`\s"'""''.。,！!？?，,:：;；]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
}

async function generateAiTitle(messages, model, thinkingLevel, getApiKey) {
  const firstUser = messages.find((m) => m.role === 'user' || m.role === 'user-with-attachments')
  if (!firstUser) return null

  const userText = typeof firstUser.content === 'string'
    ? firstUser.content
    : Array.isArray(firstUser.content)
      ? firstUser.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' ')
      : ''

  if (!userText.trim()) return null

  const firstAssistant = messages.find((m) => m.role === 'assistant')
  let assistantReply = ''
  if (firstAssistant) {
    const content = firstAssistant.content
    if (typeof content === 'string') {
      assistantReply = content.slice(0, 2000)
    } else if (Array.isArray(content)) {
      assistantReply = content
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join(' ')
        .slice(0, 2000)
    }
  }

  const conversationText = assistantReply
    ? `User: ${userText.trim()}\n\nAssistant: ${assistantReply}`
    : `User: ${userText.trim()}`

  try {
    const apiKey = getApiKey ? await getApiKey(model.provider) : undefined
    const stream = streamSimple(
      model,
      {
        systemPrompt: '你是对话标题生成器。请用和用户相同的语言，根据对话主题生成 3 到 5 个词的短标题。只输出标题，不要解释，不要标点。',
        messages: [{ role: 'user', content: conversationText, timestamp: Date.now() }],
        tools: [],
      },
      {
        apiKey,
        maxTokens: 160,
        temperature: 0.2,
        reasoning: thinkingLevel === 'off' ? 'minimal' : 'low',
        maxRetryDelayMs: 60000,
      },
    )
    const titleMessage = await stream.result()
    const titleText = Array.isArray(titleMessage.content)
      ? titleMessage.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' ').trim()
      : ''
    if (!titleText) return null
    const title = normalizeAiTitle(titleText)
    return title || null
  } catch (error) {
    console.warn('Failed to generate AI title:', error.message || error)
    return null
  }
}

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
// Reasoning content cache (server-side port)
// ---------------------------------------------------------------------------

const REASONING_FIELDS = ['reasoning_content', 'reasoning', 'reasoning_text']

function isDeepSeekThinkingModel(model) {
  if (!model) return false
  const provider = String(model.provider ?? '').toLowerCase()
  const baseUrl = String(model.baseUrl ?? '').toLowerCase()
  const modelId = String(model.id ?? '').toLowerCase()
  return (
    modelId.includes('deepseek-v4') &&
    (provider.includes('deepseek') ||
      baseUrl.includes('api.deepseek.com') ||
      baseUrl.includes('deepseek.com'))
  )
}

function restoreReasoningContentInPayload(payload, messages, model) {
  if (!isDeepSeekThinkingModel(model)) return
  if (!payload?.messages || !Array.isArray(payload.messages)) return

  const assistantMessages = messages.filter((m) => m.role === 'assistant')
  const payloadMessages = payload.messages

  for (let i = payloadMessages.length - 1; i >= 0; i--) {
    const msg = payloadMessages[i]
    if (!msg || typeof msg !== 'object' || msg.role !== 'assistant') continue
    if (msg.reasoning_content || msg.reasoning || msg.reasoning_text) continue

    // Find corresponding message from agent state
    for (let j = assistantMessages.length - 1; j >= 0; j--) {
      const cached = assistantMessages[j]
      if (!cached) continue
      for (const field of REASONING_FIELDS) {
        if (cached[field]) {
          msg[field] = cached[field]
          break
        }
      }
      if (msg.reasoning_content || msg.reasoning || msg.reasoning_text) break
    }
  }
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
    destroyAgent(session.sessionId).catch((err) =>
      console.error(`Failed to destroy idle agent ${session.sessionId}:`, err),
    )
  }, IDLE_TIMEOUT_MS)
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
  }

  // Subscribe to agent lifecycle events and forward to eventBus
  agent.subscribe((event) => {
    // Forward all events to the session event bus
    eventBus.emit('agent_event', event)

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

      // AI title generation (fire-and-forget)
      if (!session.titleGenerated && session.title === 'New chat') {
        const messages = agent.state.messages
        if (messages.some((m) => m.role === 'user') && messages.some((m) => m.role === 'assistant')) {
          session.titleGenerated = true
          generateAiTitle(messages, resolvedModel, thinkingLevel, getApiKey).then(async (aiTitle) => {
            if (aiTitle && aiTitle !== 'New chat') {
              session.title = aiTitle
              await persistSession(session)
              eventBus.emit('agent_event', { type: 'title_updated', title: aiTitle })
            }
          }).catch(() => {})
        }
      }

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
  return session
}

/**
 * Persist session data to storage.
 */
async function persistSession(session) {
  const { sessionId, agent, scope, projectId, title, createdAt, status, startedAt, finishedAt, model, thinkingLevel } = session
  const messages = agent.state.messages

  const now = new Date().toISOString()
  const sessionData = {
    id: sessionId,
    title,
    model,
    thinkingLevel,
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

  // Write to storage
  try {
    const sessionsStore = await readStore('sessions')
    sessionsStore[sessionId] = sessionData
    await writeStore('sessions', sessionsStore)

    const metadataStore = await readStore('sessions-metadata')
    metadataStore[sessionId] = metadata
    await writeStore('sessions-metadata', metadataStore)
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

  // Fire and forget — events come through eventBus
  session.agent.prompt(userMessage).catch((err) => {
    console.error(`Agent prompt error for session ${sessionId}:`, err)
    session.eventBus.emit('agent_event', {
      type: 'error',
      error: err.message || 'Unknown error',
    })
  })

  return { sessionId, status: session.status }
}

/**
 * Abort the current agent run.
 */
export function abortRun(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }

  session.agent.abort()
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
 * Clean up all agents on shutdown.
 */
export async function shutdown() {
  const ids = [...agentSessions.keys()]
  await Promise.all(ids.map((id) => destroyAgent(id)))
}
