import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { ndJsonStream, AgentSideConnection, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import {
  createAgent,
  runPrompt,
  abortRun,
  destroyAgent,
  restoreAgent,
  getSessionState,
  getSessionEventBus,
  listSessions as listAgentSessions,
  approveToolCall,
  rejectToolCall,
  updateSessionModel,
  updateSessionThinkingLevel,
} from '../agent-manager.mjs'
import { getActiveProject, getDefaultWorkspaceRoot, readProjectConfig, setActiveProjectPath, sameProjectPath } from '../project-config.mjs'
import { readSessionValue, readStore } from '../storage.mjs'
import { logger } from '../utils/logger.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageJsonPath = path.resolve(__dirname, '..', '..', 'package.json')

const APP_NAME = 'QuickForge'
const DEFAULT_MODE_ID = 'default'
const MODEL_CONFIG_ID = 'quickforge.model'
const THINKING_LEVEL_CONFIG_ID = 'quickforge.thinkingLevel'
const THINKING_LEVELS = [
  { value: 'off', name: 'Off' },
  { value: 'low', name: 'Low' },
  { value: 'medium', name: 'Medium' },
  { value: 'high', name: 'High' },
  { value: 'xhigh', name: 'Extra High' },
]
const EVENT_TEXT_LIMIT = 64 * 1024
const DOCUMENT_CONTEXT_LIMIT = 24 * 1024
const DOCUMENT_PREVIEW_LIMIT = 4 * 1024
const MAX_CONTEXT_DOCUMENTS = 4
const DANGEROUS_WORKSPACE_ROOTS = new Set([
  path.parse(process.cwd()).root,
  os.homedir(),
].map((item) => path.resolve(item).toLowerCase()))

const pendingPrompts = new Map()
const pendingPermissions = new Set()
const acpSessions = new Map()
const acpDocuments = new Map()
let focusedDocumentUri = null

let packageInfoPromise = null

async function readPackageInfo() {
  if (!packageInfoPromise) {
    packageInfoPromise = fs.readFile(packageJsonPath, 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => ({ name: '@shawnstack/quickforge', version: '0.0.0' }))
  }
  return packageInfoPromise
}

function normalizePromptText(prompt = []) {
  const parts = []
  for (const block of Array.isArray(prompt) ? prompt : []) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
      continue
    }
    if (block.type === 'resource_link') {
      parts.push(`[resource: ${block.uri || block.name || 'unknown'}]`)
      continue
    }
    if (block.type === 'resource' && block.resource?.text) {
      parts.push(block.resource.text)
      continue
    }
    parts.push(`[unsupported ${block.type || 'content'} content omitted]`)
  }
  return parts.join('\n\n').trim()
}

function textContent(text) {
  return { type: 'text', text: String(text ?? '') }
}

function truncateText(value, limit = EVENT_TEXT_LIMIT) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2)
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n… truncated ${text.length - limit} characters`
}

function messageContentText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part
      if (part?.type === 'text' && typeof part.text === 'string') return part.text
      if (typeof part?.text === 'string') return part.text
      return ''
    }).filter(Boolean).join('\n')
  }
  return ''
}

function eventMessageText(event) {
  return messageContentText(event?.message)
}

function documentUriFromParams(params = {}) {
  return params.textDocument?.uri || params.document?.uri || params.uri || params.textDocumentUri || null
}

function documentTextFromParams(params = {}) {
  if (typeof params.text === 'string') return params.text
  if (typeof params.content === 'string') return params.content
  if (typeof params.textDocument?.text === 'string') return params.textDocument.text
  if (typeof params.document?.text === 'string') return params.document.text
  const fullChange = Array.isArray(params.contentChanges)
    ? params.contentChanges.find((change) => change && typeof change.text === 'string' && !change.range)
    : null
  return fullChange?.text ?? null
}

function documentLanguageFromParams(params = {}) {
  return params.textDocument?.languageId || params.document?.languageId || params.languageId || ''
}

function documentVersionFromParams(params = {}) {
  return params.textDocument?.version ?? params.document?.version ?? params.version ?? null
}

function updateAcpDocument(params = {}, reason = 'open') {
  const uri = documentUriFromParams(params)
  if (!uri) return
  const previous = acpDocuments.get(uri) || { uri, text: '', languageId: '', version: null, updatedAt: new Date().toISOString() }
  const text = documentTextFromParams(params)
  const next = {
    ...previous,
    uri,
    languageId: documentLanguageFromParams(params) || previous.languageId || '',
    version: documentVersionFromParams(params) ?? previous.version ?? null,
    text: typeof text === 'string' ? text : previous.text,
    reason,
    updatedAt: new Date().toISOString(),
  }
  acpDocuments.set(uri, next)
}

function closeAcpDocument(params = {}) {
  const uri = documentUriFromParams(params)
  if (!uri) return
  acpDocuments.delete(uri)
  if (focusedDocumentUri === uri) focusedDocumentUri = null
}

function focusAcpDocument(params = {}) {
  const uri = documentUriFromParams(params)
  if (!uri) return
  focusedDocumentUri = uri
  if (!acpDocuments.has(uri)) updateAcpDocument({ ...params, text: '' }, 'focus')
}

function formatDocumentContext(doc, limit) {
  if (!doc) return ''
  const header = [`URI: ${doc.uri}`]
  if (doc.languageId) header.push(`Language: ${doc.languageId}`)
  if (doc.version !== null && doc.version !== undefined) header.push(`Version: ${doc.version}`)
  const text = truncateText(doc.text || '', limit)
  return `${header.join('\n')}\nContent:\n${text}`
}

function sessionContext(sessionId) {
  return acpSessions.get(sessionId) || null
}

function acpContextPrompt(sessionId) {
  const parts = []
  const session = sessionContext(sessionId)
  if (session?.cwd) parts.push(`Workspace root: ${session.cwd}`)
  if (Array.isArray(session?.additionalDirectories) && session.additionalDirectories.length > 0) {
    parts.push(`Additional workspace roots:\n${session.additionalDirectories.map((dir) => `- ${dir}`).join('\n')}`)
  }

  const docs = []
  if (focusedDocumentUri && acpDocuments.has(focusedDocumentUri)) docs.push(acpDocuments.get(focusedDocumentUri))
  for (const doc of acpDocuments.values()) {
    if (docs.length >= MAX_CONTEXT_DOCUMENTS) break
    if (!docs.some((item) => item.uri === doc.uri)) docs.push(doc)
  }
  if (docs.length > 0) {
    const renderedDocs = docs.map((doc, index) => {
      const limit = index === 0 ? DOCUMENT_CONTEXT_LIMIT : DOCUMENT_PREVIEW_LIMIT
      return `<document${doc.uri === focusedDocumentUri ? ' focused="true"' : ''}>\n${formatDocumentContext(doc, limit)}\n</document>`
    }).join('\n\n')
    parts.push(`Open editor documents:\n${renderedDocs}`)
  }

  if (parts.length === 0) return ''
  return `<acp_context>\n${parts.join('\n\n')}\n</acp_context>`
}

function withAcpContext(sessionId, message) {
  const context = acpContextPrompt(sessionId)
  return context ? `${context}\n\n${message}` : message
}

function historyMessageUpdate(message, index) {
  const role = message?.role
  const text = messageContentText(message)
  if (!text) return null
  if (role === 'assistant') {
    return {
      sessionUpdate: 'agent_message_chunk',
      content: textContent(text),
      messageId: `history-assistant-${index}`,
    }
  }
  if (role === 'user' || role === 'user-with-attachments') {
    return {
      sessionUpdate: 'user_message_chunk',
      content: textContent(text),
      messageId: `history-user-${index}`,
    }
  }
  return null
}

export function convertMessagesToHistoryUpdates(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((message, index) => historyMessageUpdate(message, index))
    .filter(Boolean)
}

async function replaySessionHistory(sessionId, conn) {
  if (!conn?.sessionUpdate) return
  const state = getSessionState(sessionId)
  const messages = state?.messages || (await readSessionValue(sessionId))?.messages || []
  for (const update of convertMessagesToHistoryUpdates(messages)) {
    await conn.sessionUpdate({ sessionId, update })
  }
}

function toolKind(toolName = '') {
  if (/read|list|cat|show/i.test(toolName)) return 'read'
  if (/write|edit|patch|present/i.test(toolName)) return 'edit'
  if (/grep|search|find/i.test(toolName)) return 'search'
  if (/run|command|terminal|subagent/i.test(toolName)) return 'execute'
  if (/fetch|http|web/i.test(toolName)) return 'fetch'
  return 'other'
}

function toolTitle(event) {
  const name = event?.toolName || event?.name || 'tool'
  return event?.label || `Run ${name}`
}

function toolCallIdFromEvent(event) {
  return String(event?.toolCallId || event?.id || '')
}

function toolInput(event) {
  if (event?.args !== undefined) return event.args
  if (event?.input !== undefined) return event.input
  if (event?.params !== undefined) return event.params
  return undefined
}

function toolOutput(event) {
  if (event?.result !== undefined) return event.result
  if (event?.output !== undefined) return event.output
  if (event?.error !== undefined) return { error: event.error }
  return undefined
}

function toolContentFromOutput(output) {
  if (output === undefined) return undefined
  return [{ type: 'content', content: textContent(truncateText(output)) }]
}

function permissionKey(sessionId, toolCallId) {
  return `${sessionId}:${toolCallId}`
}

async function requestToolPermission(sessionId, event, conn) {
  const toolCallId = toolCallIdFromEvent(event)
  if (!toolCallId) return
  const key = permissionKey(sessionId, toolCallId)
  if (pendingPermissions.has(key)) return
  pendingPermissions.add(key)
  try {
    const response = await conn.requestPermission({
      sessionId,
      toolCall: {
        toolCallId,
        kind: toolKind(event.toolName),
        status: 'pending',
        title: toolTitle(event),
        rawInput: event.args,
      },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
      ],
    })
    const selected = response?.outcome?.outcome === 'selected' ? response.outcome.optionId : null
    if (selected === 'allow_once') {
      approveToolCall(sessionId, toolCallId)
    } else {
      rejectToolCall(sessionId, toolCallId)
    }
  } finally {
    pendingPermissions.delete(key)
  }
}

export function convertEventToUpdates(event, state = {}) {
  if (!event || typeof event !== 'object') return []
  const updates = []

  if (event.type === 'message_start' || event.type === 'message_update' || event.type === 'message_end') {
    const text = eventMessageText(event)
    const messageId = String(event.message?.id || event.messageId || 'assistant')
    const previous = state.messageTextById?.get(messageId) || ''
    const chunk = text.startsWith(previous) ? text.slice(previous.length) : text
    if (chunk && event.message?.role === 'assistant') {
      state.messageTextById?.set(messageId, text)
      updates.push({
        sessionUpdate: 'agent_message_chunk',
        content: textContent(chunk),
        messageId,
      })
    }
  }

  if (event.type === 'tool_execution_start') {
    const id = toolCallIdFromEvent(event)
    if (id) {
      updates.push({
        sessionUpdate: 'tool_call',
        toolCallId: id,
        title: toolTitle(event),
        kind: toolKind(event.toolName),
        status: 'in_progress',
        rawInput: toolInput(event),
      })
    }
  }

  if (event.type === 'tool_execution_update') {
    const id = toolCallIdFromEvent(event)
    if (id) {
      updates.push({
        sessionUpdate: 'tool_call_update',
        toolCallId: id,
        status: 'in_progress',
        rawOutput: toolOutput(event),
        content: toolContentFromOutput(toolOutput(event)),
      })
    }
  }

  if (event.type === 'tool_execution_end') {
    const id = toolCallIdFromEvent(event)
    if (id) {
      const output = toolOutput(event)
      updates.push({
        sessionUpdate: 'tool_call_update',
        toolCallId: id,
        status: event.error ? 'failed' : 'completed',
        rawOutput: output,
        content: toolContentFromOutput(output),
      })
    }
  }

  if (event.type === 'tool_approval_required') {
    const id = toolCallIdFromEvent(event)
    if (id) {
      updates.push({
        sessionUpdate: 'tool_call',
        toolCallId: id,
        title: toolTitle(event),
        kind: toolKind(event.toolName),
        status: 'pending',
        rawInput: event.args,
      })
    }
  }

  if (event.type === 'title_updated' && typeof event.title === 'string') {
    updates.push({
      sessionUpdate: 'session_info_update',
      title: event.title,
      updatedAt: new Date().toISOString(),
    })
  }

  if (event.contextUsage?.used && event.contextUsage?.size) {
    updates.push({
      sessionUpdate: 'usage_update',
      used: event.contextUsage.used,
      size: event.contextUsage.size,
    })
  }

  return updates
}

function sessionModes() {
  return {
    currentModeId: DEFAULT_MODE_ID,
    availableModes: [{
      id: DEFAULT_MODE_ID,
      name: 'Default',
      description: 'QuickForge default agent mode',
    }],
  }
}

function parseStoredJson(value) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return null }
}

function isUsableModel(model) {
  return Boolean(model?.id && model?.provider && model?.api && model?.baseUrl)
}

function sameBaseUrl(a, b) {
  return String(a || '').trim().replace(/\/$/, '') === String(b || '').trim().replace(/\/$/, '')
}

function sameModel(a, b) {
  return Boolean(a && b && a.id === b.id && a.provider === b.provider && a.api === b.api && sameBaseUrl(a.baseUrl, b.baseUrl))
}

function modelValueId(model) {
  const payload = JSON.stringify({
    id: model.id,
    provider: model.provider,
    api: model.api,
    baseUrl: model.baseUrl,
  })
  return Buffer.from(payload, 'utf8').toString('base64url')
}

function modelDisplayName(model) {
  return model.name || `${model.provider}/${model.id}`
}

function isThinkingLevel(value) {
  return THINKING_LEVELS.some((level) => level.value === value)
}

function thinkingLevelConfigOption(currentModel = null, currentThinkingLevel = 'off') {
  const supportsThinking = currentModel?.reasoning === true
  const options = supportsThinking ? THINKING_LEVELS : THINKING_LEVELS.slice(0, 1)
  const currentValue = supportsThinking && isThinkingLevel(currentThinkingLevel) ? currentThinkingLevel : 'off'
  return {
    id: THINKING_LEVEL_CONFIG_ID,
    name: 'Thinking Level',
    description: supportsThinking
      ? 'Select the reasoning/thinking level for this ACP session.'
      : 'The selected model does not support reasoning, so thinking is disabled.',
    category: 'thought_level',
    type: 'select',
    currentValue,
    options,
  }
}

async function readConfiguredModels() {
  const store = await readStore('custom-providers').catch(() => [])
  const providers = Array.isArray(store) ? store : Object.values(store || {})
  return providers
    .flatMap((provider) => Array.isArray(provider?.models) ? provider.models : [])
    .filter(isUsableModel)
}

async function readActiveModel() {
  const settings = await readStore('settings').catch(() => ({}))
  const model = parseStoredJson(settings?.['active-model'])
  return isUsableModel(model) ? model : null
}

async function resolveInitialModel() {
  const [configuredModels, activeModel] = await Promise.all([readConfiguredModels(), readActiveModel()])
  if (activeModel) {
    return configuredModels.find((model) => sameModel(model, activeModel)) || activeModel
  }
  return configuredModels[0] || null
}

// Resolve the initial thinking level for a new ACP session, mirroring the web UI
// (src/hooks/useAgentManager.ts): prefer the user's saved default thinking level,
// otherwise fall back to 'medium' for reasoning models and 'off' otherwise.
async function resolveInitialThinkingLevel(model) {
  const settings = await readStore('settings').catch(() => ({}))
  const defaultOptions = parseStoredJson(settings?.['default-options'])
  const saved = defaultOptions?.thinkingLevel
  if (isThinkingLevel(saved)) return saved
  return model?.reasoning === true ? 'medium' : 'off'
}

async function sessionConfigOptions(currentModel = null, currentThinkingLevel = 'off') {
  const configuredModels = await readConfiguredModels()
  const models = [...configuredModels]
  const options = []
  if (currentModel && !models.some((model) => sameModel(model, currentModel))) models.unshift(currentModel)

  if (models.length > 0) {
    const selectedModel = currentModel || models[0]
    const groups = []
    for (const model of models) {
      const groupId = model.provider || 'custom'
      let group = groups.find((item) => item.group === groupId)
      if (!group) {
        group = { group: groupId, name: model.provider || 'Custom', options: [] }
        groups.push(group)
      }
      group.options.push({
        value: modelValueId(model),
        name: modelDisplayName(model),
        description: `${model.provider} · ${model.api} · ${model.baseUrl}`,
        _meta: { quickforgeModel: model },
      })
    }

    options.push({
      id: MODEL_CONFIG_ID,
      name: 'Model',
      description: 'Select the QuickForge model used by this ACP session.',
      category: 'model',
      type: 'select',
      currentValue: modelValueId(selectedModel),
      options: groups,
    })
  }

  options.push(thinkingLevelConfigOption(currentModel, currentThinkingLevel))
  return options
}

async function sessionConfigOptionsForSession(sessionId) {
  const state = getSessionState(sessionId)
  if (!state) throw new Error('Session not found')
  return sessionConfigOptions(state.model, state.thinkingLevel)
}

async function selectSessionModel(sessionId, value) {
  const state = getSessionState(sessionId)
  if (!state) throw new Error('Session not found')
  const models = await readConfiguredModels()
  if (state.model && !models.some((model) => sameModel(model, state.model))) models.unshift(state.model)
  const model = models.find((candidate) => modelValueId(candidate) === value)
  if (!model) throw new Error('Selected model is not configured in QuickForge.')
  updateSessionModel(sessionId, model)
  const thinkingLevel = model.reasoning === true ? state.thinkingLevel : 'off'
  if (thinkingLevel !== state.thinkingLevel) updateSessionThinkingLevel(sessionId, thinkingLevel)
  return { configOptions: await sessionConfigOptions(model, thinkingLevel) }
}

async function selectSessionThinkingLevel(sessionId, value) {
  const state = getSessionState(sessionId)
  if (!state) throw new Error('Session not found')
  if (!isThinkingLevel(value)) throw new Error(`Unknown thinking level: ${value}`)
  if (value !== 'off' && state.model?.reasoning !== true) throw new Error('The selected model does not support reasoning.')
  updateSessionThinkingLevel(sessionId, value)
  return { configOptions: await sessionConfigOptions(state.model, value) }
}

async function assertSafeAcpCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) {
    throw new Error('ACP session cwd is required.')
  }
  if (!path.isAbsolute(cwd)) {
    throw new Error('ACP session cwd must be an absolute path.')
  }

  const resolved = path.resolve(cwd)
  const stat = await fs.stat(resolved).catch(() => null)
  if (!stat?.isDirectory()) {
    throw new Error(`ACP session cwd is not a directory: ${resolved}`)
  }

  const real = await fs.realpath(resolved)
  const normalized = path.resolve(real).toLowerCase()
  if (DANGEROUS_WORKSPACE_ROOTS.has(normalized)) {
    throw new Error(`Refusing to use unsafe ACP workspace root: ${real}`)
  }
  return real
}

async function assertSafeAcpAdditionalDirectories(additionalDirectories = []) {
  if (!Array.isArray(additionalDirectories)) return []
  const result = []
  const seen = new Set()
  for (const dir of additionalDirectories) {
    const safeDir = await assertSafeAcpCwd(dir)
    const key = safeDir.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(safeDir)
    }
  }
  return result
}

function isDefaultWorkspaceCwd(cwd) {
  const defaultWorkspaceRoot = getDefaultWorkspaceRoot()
  return defaultWorkspaceRoot && sameProjectPath(cwd, defaultWorkspaceRoot)
}

async function resolveProjectForCwd(cwd) {
  const resolvedCwd = await assertSafeAcpCwd(cwd)
  if (isDefaultWorkspaceCwd(resolvedCwd)) return null
  const config = await readProjectConfig()
  let project = config.projects.find((item) => sameProjectPath(item.path, resolvedCwd))
  if (!project) {
    const updated = await setActiveProjectPath(resolvedCwd)
    project = updated.project
  }
  return project || getActiveProject(config)
}

async function createQuickForgeSession(params = {}) {
  const cwd = await assertSafeAcpCwd(params.cwd)
  const additionalDirectories = await assertSafeAcpAdditionalDirectories(params.additionalDirectories)
  const project = await resolveProjectForCwd(cwd)
  const sessionId = params._meta?.quickforgeSessionId || randomUUID()
  const model = await resolveInitialModel()
  const thinkingLevel = await resolveInitialThinkingLevel(model)
  await createAgent(sessionId, {
    scope: project?.id ? 'project' : 'global',
    projectId: project?.id || null,
    accessMode: 'default',
    yoloMode: false,
    model,
    thinkingLevel,
    title: 'ACP session',
    idleRetention: 'always',
  })
  acpSessions.set(sessionId, { cwd, additionalDirectories, projectId: project?.id || null })
  return { sessionId, modes: sessionModes(), configOptions: await sessionConfigOptions(model, thinkingLevel) }
}

function waitForPromptEnd(sessionId, conn, signal) {
  if (pendingPrompts.has(sessionId)) return Promise.reject(new Error('ACP prompt is already running for this session.'))
  const eventBus = getSessionEventBus(sessionId)
  if (!eventBus) return Promise.reject(new Error('Session not found'))

  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      pendingPrompts.delete(sessionId)
      eventBus.off('agent_event', onEvent)
      signal?.removeEventListener?.('abort', onAbort)
    }

    const finish = (result) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const fail = (err) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    const sendUpdate = (update) => {
      conn.sessionUpdate({ sessionId, update }).catch((err) => {
        logger.warn(`ACP session/update failed for ${sessionId}: ${err?.message || err}`, { sessionId })
      })
    }

    const conversionState = { messageTextById: new Map() }

    const onEvent = (event) => {
      for (const update of convertEventToUpdates(event, conversionState)) sendUpdate(update)

      if (event?.type === 'tool_approval_required') {
        requestToolPermission(sessionId, event, conn).catch((err) => {
          logger.warn(`ACP tool permission failed for ${sessionId}: ${err?.message || err}`, { sessionId })
          try { rejectToolCall(sessionId, event.toolCallId) } catch { /* ignore */ }
        })
      }

      if (event?.type === 'error') {
        fail(new Error(event.error || 'QuickForge agent error'))
        return
      }

      if (event?.type === 'agent_end') {
        finish({ stopReason: event.status === 'aborted' ? 'cancelled' : 'end_turn' })
      }
    }

    const onAbort = () => {
      abortRun(sessionId).catch(() => {})
      finish({ stopReason: 'cancelled' })
    }

    pendingPrompts.set(sessionId, { cancel: onAbort })

    eventBus.on('agent_event', onEvent)
    if (signal) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

async function listPersistedAcpSessions(params = {}) {
  const [metadata, projectConfig] = await Promise.all([
    readStore('sessions-metadata').catch(() => ({})),
    readProjectConfig().catch(() => ({ projects: [] })),
  ])
  const projectPathById = new Map((projectConfig.projects || []).map((project) => [project.id, path.resolve(project.path)]))
  const requestedCwd = params.cwd ? path.resolve(params.cwd) : null
  const sessionsById = new Map()

  for (const meta of Object.values(metadata || {})) {
    if (!meta?.id) continue
    const cwd = meta.scope === 'project' && meta.projectId && projectPathById.has(meta.projectId)
      ? projectPathById.get(meta.projectId)
      : process.cwd()
    if (requestedCwd && path.resolve(cwd) !== requestedCwd) continue
    sessionsById.set(meta.id, {
      sessionId: meta.id,
      cwd,
      additionalDirectories: [],
      title: meta.title || 'ACP session',
      updatedAt: meta.lastModified || meta.createdAt || new Date().toISOString(),
    })
  }

  for (const session of listAgentSessions()) {
    const context = acpSessions.get(session.sessionId)
    const cwd = context?.cwd || process.cwd()
    if (requestedCwd && path.resolve(cwd) !== requestedCwd) continue
    sessionsById.set(session.sessionId, {
      sessionId: session.sessionId,
      cwd,
      additionalDirectories: context?.additionalDirectories || [],
      title: session.title || sessionsById.get(session.sessionId)?.title || 'ACP session',
      updatedAt: new Date().toISOString(),
    })
  }

  return [...sessionsById.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

export async function createQuickForgeAcpAgent() {
  const pkg = await readPackageInfo()
  return {
    async initialize(params = {}) {
      return {
        protocolVersion: Math.min(params.protocolVersion || PROTOCOL_VERSION, PROTOCOL_VERSION),
        agentCapabilities: {
          promptCapabilities: {
            embeddedContext: true,
          },
          sessionCapabilities: {
            list: {},
            delete: {},
            close: {},
            additionalDirectories: {},
          },
          nes: {
            events: {
              document: {
                didOpen: {},
                didChange: { syncKind: 'full' },
                didClose: {},
                didSave: {},
                didFocus: {},
              },
            },
          },
        },
        authMethods: [],
        agentInfo: {
          name: APP_NAME,
          version: pkg.version || '0.0.0',
        },
      }
    },

    async newSession(params = {}) {
      return createQuickForgeSession(params)
    },

    async loadSession(params = {}, conn = null) {
      const additionalDirectories = await assertSafeAcpAdditionalDirectories(params.additionalDirectories)
      const session = await restoreAgent(params.sessionId)
      if (!session) throw new Error('Session not found')
      const projectConfig = await readProjectConfig().catch(() => ({ projects: [] }))
      const project = session.projectId ? projectConfig.projects.find((item) => item.id === session.projectId) : null
      acpSessions.set(params.sessionId, {
        cwd: params.cwd ? await assertSafeAcpCwd(params.cwd) : path.resolve(project?.path || process.cwd()),
        additionalDirectories,
        projectId: session.projectId || null,
      })
      await replaySessionHistory(params.sessionId, conn)
      return { modes: sessionModes(), configOptions: await sessionConfigOptionsForSession(params.sessionId) }
    },

    async listSessions(params = {}) {
      return { sessions: await listPersistedAcpSessions(params) }
    },

    async deleteSession(params = {}) {
      await destroyAgent(params.sessionId)
      acpSessions.delete(params.sessionId)
      return {}
    },

    async closeSession(params = {}) {
      try {
        await abortRun(params.sessionId)
      } catch {
        // ignore idle or missing active run during close
      }
      await destroyAgent(params.sessionId)
      acpSessions.delete(params.sessionId)
      return {}
    },

    async setSessionConfigOption(params = {}) {
      if (params.type === 'boolean') throw new Error('QuickForge ACP config options require select values.')
      if (params.configId === MODEL_CONFIG_ID) return selectSessionModel(params.sessionId, params.value)
      if (params.configId === THINKING_LEVEL_CONFIG_ID) return selectSessionThinkingLevel(params.sessionId, params.value)
      throw new Error(`Unknown ACP config option: ${params.configId}`)
    },

    async prompt(params = {}, conn, signal) {
      const message = normalizePromptText(params.prompt)
      if (!message) throw new Error('Prompt is empty or unsupported.')
      const state = getSessionState(params.sessionId)
      if (!state) throw new Error('Session not found')
      const done = waitForPromptEnd(params.sessionId, conn, signal)
      await runPrompt(params.sessionId, withAcpContext(params.sessionId, message))
      return done
    },

    async cancel(params = {}) {
      const pendingPrompt = pendingPrompts.get(params.sessionId)
      if (pendingPrompt) {
        pendingPrompt.cancel()
        return
      }
      await abortRun(params.sessionId)
    },

    async didOpenDocument(params = {}) {
      updateAcpDocument(params, 'open')
    },

    async didChangeDocument(params = {}) {
      updateAcpDocument(params, 'change')
    },

    async didSaveDocument(params = {}) {
      updateAcpDocument(params, 'save')
    },

    async didCloseDocument(params = {}) {
      closeAcpDocument(params)
    },

    async didFocusDocument(params = {}) {
      focusAcpDocument(params)
    },
  }
}

export async function runQuickForgeAcpStdio() {
  const originalConsoleLog = console.log
  console.log = (...args) => console.error(...args)
  try {
    const quickForgeAgent = await createQuickForgeAcpAgent()
    const stream = ndJsonStream(
      Writable.toWeb(process.stdout),
      Readable.toWeb(process.stdin),
    )
    const connection = new AgentSideConnection((conn) => ({
      initialize: (params) => quickForgeAgent.initialize(params),
      newSession: (params) => quickForgeAgent.newSession(params),
      loadSession: (params) => quickForgeAgent.loadSession(params, conn),
      listSessions: (params) => quickForgeAgent.listSessions(params),
      deleteSession: (params) => quickForgeAgent.deleteSession(params),
      closeSession: (params) => quickForgeAgent.closeSession(params),
      setSessionConfigOption: (params) => quickForgeAgent.setSessionConfigOption(params),
      prompt: (params) => quickForgeAgent.prompt(params, conn, connection.signal),
      cancel: (params) => quickForgeAgent.cancel(params),
      unstable_didOpenDocument: (params) => quickForgeAgent.didOpenDocument(params),
      unstable_didChangeDocument: (params) => quickForgeAgent.didChangeDocument(params),
      unstable_didSaveDocument: (params) => quickForgeAgent.didSaveDocument(params),
      unstable_didCloseDocument: (params) => quickForgeAgent.didCloseDocument(params),
      unstable_didFocusDocument: (params) => quickForgeAgent.didFocusDocument(params),
    }), stream)
    await connection.closed
  } finally {
    console.log = originalConsoleLog
  }
}
