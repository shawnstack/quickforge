import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { terminateProcessTree } from './utils/process-tree.mjs'

const OPEN_CODE_COMMAND = process.platform === 'win32' ? 'opencode.cmd' : 'opencode'
const ACP_CLIENT_NAME = 'QuickForge'
const DIAGNOSTIC_LIMIT = 2048
const TOOL_OUTPUT_LIMIT = 16 * 1024
const TOOL_METADATA_LOCATION_LIMIT = 20
const SETUP_METADATA_BUFFER_LIMIT = 100
const ACP_TOOL_KIND_NAMES = Object.freeze({
  read: 'read_file',
  edit: 'edit_file',
  search: 'grep_files',
  execute: 'run_command',
})
const OPENCODE_RENDERER_TOOL_NAMES = new Set([
  'read_file',
  'edit_file',
  'grep_files',
  'run_command',
  'opencode_tool',
])
const ACP_METADATA_UPDATE_TYPES = new Set([
  'available_commands_update',
  'current_mode_update',
  'config_option_update',
  'session_info_update',
  'usage_update',
])

export const DEFAULT_OPENCODE_ACP_TIMEOUTS = Object.freeze({
  initialize: 15_000,
  sessionSetup: 30_000,
  prompt: 60 * 60_000,
  close: 2_000,
})

function pathEntries() {
  return String(process.env.PATH || '').split(path.delimiter).filter(Boolean)
}

export async function resolveOpenCodeCommand() {
  for (const directory of pathEntries()) {
    const candidate = path.join(directory, OPEN_CODE_COMMAND)
    try {
      const stat = await fs.stat(candidate)
      if (stat.isFile()) return candidate
    } catch {
      // Continue searching PATH.
    }
  }
  throw Object.assign(new Error('OpenCode is unavailable. Install OpenCode and ensure the opencode command is on PATH.'), {
    statusCode: 503,
    errorCode: 'OPENCODE_UNAVAILABLE',
  })
}

function quoteWindowsCommandArg(value) {
  const text = String(value).replace(/%/g, '%%')
  if (/^[A-Za-z0-9_./:\\-]+$/.test(text)) return text
  return `"${text.replace(/"/g, '\\"')}"`
}

function spawnOpenCode(command, cwd, spawnImpl = spawn, platform = process.platform) {
  const args = ['acp', '--pure', '--cwd', cwd]
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(command)) {
    return spawnImpl(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...(platform === 'win32' ? {} : { detached: true }),
    })
  }

  const commandLine = [command, ...args].map(quoteWindowsCommandArg).join(' ')
  return spawnImpl(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

function messageText(message) {
  if (typeof message === 'string') return message
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => typeof part === 'string' ? part : part?.type === 'text' ? part.text || '' : '').filter(Boolean).join('\n')
}

function attachmentError(message, errorCode = 'OPENCODE_ATTACHMENT_INVALID') {
  return Object.assign(new Error(message), { statusCode: 400, errorCode })
}

function isBase64(value) {
  return typeof value === 'string'
    && value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
}

function promptCapabilities(agentCapabilities) {
  const capabilities = agentCapabilities?.promptCapabilities
  return capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities) ? capabilities : {}
}

function attachmentPrompt(message, agentCapabilities) {
  const text = messageText(message)
  if (!message || typeof message === 'string') return [{ type: 'text', text }]
  const attachments = message.attachments
  const hasAttachmentRole = message.role === 'user-with-attachments'
  const hasNonTextContent = Array.isArray(message.content) && message.content.some((part) => part && typeof part === 'object' && part.type !== 'text')
  if (hasNonTextContent) throw attachmentError('OpenCode attachments must use the QuickForge attachments field.')
  if (!hasAttachmentRole && attachments === undefined) return [{ type: 'text', text }]
  if (!Array.isArray(attachments)) throw attachmentError('OpenCode attachments must be an array.')

  const capabilities = promptCapabilities(agentCapabilities)
  const prompt = text.trim() ? [{ type: 'text', text }] : []
  attachments.forEach((attachment, index) => {
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
      throw attachmentError(`OpenCode attachment ${index + 1} is invalid.`)
    }
    if (attachment.type !== 'image' && attachment.type !== 'document') {
      throw attachmentError(`OpenCode attachment ${index + 1} has an unsupported type.`)
    }
    if (typeof attachment.id !== 'string' || !attachment.id
      || typeof attachment.fileName !== 'string' || !attachment.fileName
      || typeof attachment.mimeType !== 'string' || !attachment.mimeType
      || !Number.isFinite(attachment.size) || attachment.size < 0
      || !isBase64(attachment.content)
      || (attachment.extractedText !== undefined && typeof attachment.extractedText !== 'string')) {
      throw attachmentError(`OpenCode attachment ${index + 1} has invalid fields.`)
    }

    if (attachment.type === 'image') {
      if (!attachment.mimeType.startsWith('image/')) throw attachmentError(`OpenCode attachment ${index + 1} has an invalid image MIME type.`)
      if (capabilities.image !== true) {
        throw attachmentError('OpenCode does not advertise ACP image prompt support.', 'OPENCODE_IMAGE_UNSUPPORTED')
      }
      prompt.push({ type: 'image', data: attachment.content, mimeType: attachment.mimeType })
      return
    }

    if (capabilities.embeddedContext !== true) {
      throw attachmentError('OpenCode does not advertise ACP embedded resource prompt support.', 'OPENCODE_EMBEDDED_CONTEXT_UNSUPPORTED')
    }
    const resource = {
      uri: `quickforge-attachment://prompt/${index + 1}`,
      mimeType: attachment.mimeType,
      ...(attachment.extractedText !== undefined
        ? { text: attachment.extractedText }
        : { blob: attachment.content }),
    }
    prompt.push({ type: 'resource', resource })
  })

  if (prompt.length === 0) throw attachmentError('OpenCode prompt must contain text or at least one attachment.')
  return prompt
}

function stripMeta(value) {
  if (Array.isArray(value)) return value.map(stripMeta)
  if (!value || typeof value !== 'object') return value
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    if (key !== '_meta') result[key] = stripMeta(item)
  }
  return result
}

function sanitizeToolLocations(locations) {
  if (!Array.isArray(locations)) return []
  return locations.slice(0, TOOL_METADATA_LOCATION_LIMIT).map((location) => {
    if (!location || typeof location.path !== 'string' || !location.path) return null
    return {
      path: location.path,
      ...(Number.isInteger(location.line) && location.line >= 0 ? { line: location.line } : {}),
    }
  }).filter(Boolean)
}

function toolMetadata(update, fallback = {}) {
  const title = typeof update?.title === 'string' && update.title ? update.title : fallback.title
  const kind = typeof update?.kind === 'string' && update.kind ? update.kind : fallback.kind
  const locations = sanitizeToolLocations(update?.locations)
  return {
    ...(title ? { title } : {}),
    ...(kind ? { kind } : {}),
    ...(locations.length > 0 ? { locations } : fallback.locations?.length ? { locations: fallback.locations } : {}),
  }
}

function toolName(update) {
  return ACP_TOOL_KIND_NAMES[update?.kind] || 'opencode_tool'
}

function normalizedToolInput(update, metadata) {
  const raw = stripMeta(update?.rawInput ?? {})
  const args = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : { rawInput: raw }
  if (args.path === undefined && typeof args.file_path === 'string') args.path = args.file_path
  if (args.path === undefined && typeof metadata.locations?.[0]?.path === 'string') args.path = metadata.locations[0].path
  if (args.command === undefined && typeof args.cmd === 'string') args.command = args.cmd
  if (args.query === undefined && typeof args.pattern === 'string') args.query = args.pattern
  if (args.regex === undefined && typeof args.useRegex === 'boolean') args.regex = args.useRegex
  args.__quickforgeAcp = metadata
  return args
}

function historyToolMetadata(value, fallbackName, legacyName) {
  const metadata = toolMetadata(value)
  if (!metadata.title && !metadata.kind && fallbackName) metadata.kind = fallbackName
  else if (legacyName && metadata.title !== fallbackName && metadata.kind !== fallbackName) metadata.kind = fallbackName
  return metadata
}

function normalizeHistoryToolCall(block) {
  const originalName = typeof block.name === 'string' && block.name ? block.name : 'Tool Call'
  const rendererName = OPENCODE_RENDERER_TOOL_NAMES.has(originalName)
  const name = rendererName ? originalName : ACP_TOOL_KIND_NAMES[originalName] || 'opencode_tool'
  const rawArguments = stripMeta(block.arguments)
  const args = rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)
    ? { ...rawArguments }
    : { rawInput: rawArguments }
  const metadata = historyToolMetadata(args.__quickforgeAcp, originalName, !rendererName)
  args.__quickforgeAcp = metadata
  return {
    block: { ...block, name, arguments: args },
    name,
    metadata,
  }
}

export function normalizeOpenCodeHistoryMessages(messages) {
  if (!Array.isArray(messages)) return []
  const toolCalls = new Map()
  return messages.map((message) => {
    if (message?.role === 'assistant' && message.api === 'acp' && message.provider === 'opencode' && Array.isArray(message.content)) {
      let changed = false
      const content = message.content.map((block) => {
        if (block?.type !== 'toolCall') return block
        const normalized = normalizeHistoryToolCall(block)
        if (block.id !== undefined && block.id !== null) toolCalls.set(String(block.id), normalized)
        changed = true
        return normalized.block
      })
      return changed ? { ...message, content } : message
    }

    if (message?.role === 'toolResult' && message.toolCallId !== undefined && message.toolCallId !== null) {
      const normalized = toolCalls.get(String(message.toolCallId))
      if (!normalized) return message
      const details = message.details && typeof message.details === 'object' && !Array.isArray(message.details)
        ? { ...message.details, __quickforgeAcp: normalized.metadata }
        : { __quickforgeAcp: normalized.metadata }
      return { ...message, toolName: normalized.name, details }
    }

    return message
  })
}

function safeJson(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value ?? '')
  }
}

function boundedText(value, limit = TOOL_OUTPUT_LIMIT) {
  const text = String(value ?? '')
  return text.length > limit ? `${text.slice(0, limit)}\n…[truncated]` : text
}

function safeRawOutput(value) {
  const text = typeof value === 'string' ? value : safeJson(stripMeta(value))
  return boundedText(text
    .replace(/-----BEGIN[\s\S]*?PRIVATE KEY-----[\s\S]*?-----END[\s\S]*?PRIVATE KEY-----/gi, '[private key]')
    .replace(/\bBearer\s+[^\s,;"}]+/gi, 'Bearer [redacted]')
    .replace(/(["']?(?:token|secret|password|api[-_ ]?key|private[-_ ]?key)["']?\s*[:=]\s*)["']?[^\s,;"}]+["']?/gi, '$1"[redacted]"'))
}

function diffDetails(item) {
  const hasOldText = typeof item?.oldText === 'string'
  const oldText = hasOldText ? item.oldText : ''
  const newText = typeof item?.newText === 'string' ? item.newText : ''
  const oldLines = oldText ? oldText.split('\n') : []
  const newLines = newText ? newText.split('\n') : []
  const path = typeof item?.path === 'string' ? item.path : ''
  const text = hasOldText
    ? [
        `--- ${path || 'before'}`,
        `+++ ${path || 'after'}`,
        ...oldLines.map((line) => `-${line}`),
        ...newLines.map((line) => `+${line}`),
      ].join('\n')
    : newText
  return {
    format: hasOldText ? 'unified' : 'raw',
    path,
    addedLines: newLines.length,
    removedLines: oldLines.length,
    text: boundedText(text),
  }
}

function toolResult(update, fallbackMetadata = {}) {
  const metadata = toolMetadata(update, fallbackMetadata)
  const output = []
  let diff
  for (const item of Array.isArray(update?.content) ? update.content : []) {
    if (item?.type === 'content') {
      const block = item.content
      if (block?.type === 'text' && typeof block.text === 'string') output.push(block.text)
      else if (block?.type === 'resource' && typeof block.resource?.text === 'string') output.push(block.resource.text)
      else if (block?.type === 'resource' && typeof block.resource?.blob === 'string') {
        output.push(`[binary resource: ${block.resource.mimeType || 'application/octet-stream'}, ${block.resource.blob.length} base64 chars]`)
      }
    } else if (item?.type === 'diff') {
      const nextDiff = diffDetails(item)
      if (!diff) diff = nextDiff
      output.push(`[diff: ${nextDiff.path || 'unknown path'}, +${nextDiff.addedLines} -${nextDiff.removedLines}]`)
    } else if (item?.type === 'terminal' && typeof item.terminalId === 'string') {
      output.push(`[terminal: ${item.terminalId}]`)
    }
  }
  if (output.length === 0 && update?.rawOutput !== undefined) output.push(safeRawOutput(update.rawOutput))
  const value = boundedText(output.filter(Boolean).join('\n'))
  return {
    content: value ? [{ type: 'text', text: value }] : [],
    details: {
      __quickforgeAcp: metadata,
      ...(value ? { output: value } : {}),
      ...(diff ? { diff } : {}),
    },
  }
}

function baseAssistantMessage(content, id, stopReason = 'stop') {
  return {
    role: 'assistant',
    content,
    api: 'acp',
    provider: 'opencode',
    model: 'opencode',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
    ...(id ? { id } : {}),
  }
}

function assistantErrorMessage(text) {
  return {
    ...baseAssistantMessage([], undefined, 'error'),
    errorMessage: text,
  }
}

export function sanitizeOpenCodeDiagnostic(value) {
  return String(value ?? '')
    .replace(/-----BEGIN[\s\S]*?PRIVATE KEY-----[\s\S]*?-----END[\s\S]*?PRIVATE KEY-----/gi, '[private key]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(token|secret|password|api[-_ ]?key|private[-_ ]?key)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b(?:https?|file):\/\/[^\s)\]}]+/gi, '[url]')
    .replace(/\b[A-Za-z]:\\(?:[^\s<>:"|?*]+\\)*[^\s<>:"|?*]*/g, '[local path]')
    .replace(/(^|[\s(])\/(?:Users|home|var|tmp|private|opt|etc)\/[^\s)\]}]+/g, '$1[local path]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DIAGNOSTIC_LIMIT)
}

function authRequiredError(error) {
  return error?.code === -32000 || /auth(?:entication|orization)?\s+(?:is\s+)?required|not\s+authenticated|login required/i.test(error?.message || '')
}

function publicAcpError(error, stage, fallback = 'OpenCode ACP request failed.') {
  if (error?.errorCode && error?.statusCode) return error
  if (authRequiredError(error)) {
    return Object.assign(new Error('OpenCode authentication is required. Complete OpenCode login in a terminal, then try again.'), {
      statusCode: 401,
      errorCode: 'OPENCODE_AUTH_REQUIRED',
      stage,
    })
  }
  const detail = sanitizeOpenCodeDiagnostic(error?.message)
  return Object.assign(new Error(detail || fallback), {
    statusCode: error?.statusCode || 503,
    errorCode: error?.errorCode || 'OPENCODE_ACP_RUNTIME_ERROR',
    stage,
  })
}

function timeoutError(stage, timeoutMs) {
  return Object.assign(new Error(`OpenCode ACP ${stage} timed out after ${timeoutMs}ms.`), {
    statusCode: 504,
    errorCode: 'OPENCODE_ACP_TIMEOUT',
    stage,
  })
}

function incompatibleError(message, stage = 'initialize') {
  return Object.assign(new Error(message), {
    statusCode: 503,
    errorCode: 'OPENCODE_ACP_INCOMPATIBLE',
    stage,
  })
}

function capabilityEnabled(value) {
  return value !== undefined && value !== null && value !== false
}

function optionalString(value) {
  return typeof value === 'string' ? value : undefined
}

function sanitizeConfigSelectOption(option) {
  if (!option || typeof option.value !== 'string' || typeof option.name !== 'string') return null
  return {
    value: option.value,
    name: option.name,
    ...(optionalString(option.description) !== undefined ? { description: option.description } : {}),
  }
}

function sanitizeConfigSelectOptions(options) {
  if (!Array.isArray(options)) return []
  return options.map((option) => {
    if (option && typeof option.group === 'string' && typeof option.name === 'string' && Array.isArray(option.options)) {
      return {
        group: option.group,
        name: option.name,
        options: option.options.map(sanitizeConfigSelectOption).filter(Boolean),
      }
    }
    return sanitizeConfigSelectOption(option)
  }).filter(Boolean)
}

function sanitizeConfigOption(option) {
  if (!option || typeof option.id !== 'string' || typeof option.name !== 'string') return null
  const common = {
    id: option.id,
    name: option.name,
    ...(optionalString(option.description) !== undefined ? { description: option.description } : {}),
    ...(optionalString(option.category) !== undefined ? { category: option.category } : {}),
  }
  if (option.type === 'boolean' && typeof option.currentValue === 'boolean') {
    return { ...common, type: 'boolean', currentValue: option.currentValue }
  }
  if (option.type === 'select' && typeof option.currentValue === 'string') {
    return { ...common, type: 'select', currentValue: option.currentValue, options: sanitizeConfigSelectOptions(option.options) }
  }
  return null
}

function sanitizeConfigOptions(configOptions) {
  return Array.isArray(configOptions) ? configOptions.map(sanitizeConfigOption).filter(Boolean) : []
}

function sanitizeModes(modes) {
  if (!modes || typeof modes.currentModeId !== 'string' || !Array.isArray(modes.availableModes)) return null
  return {
    currentModeId: modes.currentModeId,
    availableModes: modes.availableModes.map((mode) => {
      if (!mode || typeof mode.id !== 'string' || typeof mode.name !== 'string') return null
      return {
        id: mode.id,
        name: mode.name,
        ...(optionalString(mode.description) !== undefined ? { description: mode.description } : {}),
      }
    }).filter(Boolean),
  }
}

function sanitizeAvailableCommands(availableCommands) {
  if (!Array.isArray(availableCommands)) return []
  return availableCommands.map((command) => {
    if (!command || typeof command.name !== 'string' || typeof command.description !== 'string') return null
    const input = command.input && typeof command.input.hint === 'string' ? { hint: command.input.hint } : undefined
    return { name: command.name, description: command.description, ...(input ? { input } : {}) }
  }).filter(Boolean)
}

function sanitizeSessionInfo(update) {
  const result = {}
  if (update?.title === null || typeof update?.title === 'string') result.title = update.title
  if (update?.updatedAt === null || typeof update?.updatedAt === 'string') result.updatedAt = update.updatedAt
  return result
}

function sanitizeUsage(update) {
  if (!Number.isFinite(update?.used) || !Number.isFinite(update?.size)) return null
  const usage = { used: update.used, size: update.size }
  if (update.cost && Number.isFinite(update.cost.amount) && typeof update.cost.currency === 'string') {
    usage.cost = { amount: update.cost.amount, currency: update.cost.currency }
  } else if (update?.cost === null) {
    usage.cost = null
  }
  return usage
}

function configOptionValues(option) {
  if (option?.type !== 'select' || !Array.isArray(option.options)) return []
  return option.options.flatMap((item) => Array.isArray(item?.options) ? item.options : [item]).map((item) => item?.value).filter((value) => typeof value === 'string')
}

export function normalizeOpenCodeSessionSetupResult(result) {
  return {
    configOptions: sanitizeConfigOptions(result?.configOptions),
    modes: sanitizeModes(result?.modes),
  }
}

export class OpenCodeAcpAgent {
  constructor({
    sessionId,
    cwd,
    messages = [],
    harnessSessionId = null,
    sourceHarnessSessionId = null,
    restoredUsage = null,
    requestPermission,
    logger,
    timeouts = {},
    dependencies = {},
  }) {
    this.sessionId = sessionId
    this.cwd = cwd
    this.harnessSessionId = harnessSessionId
    this.sourceHarnessSessionId = sourceHarnessSessionId
    this.restoredUsage = sanitizeUsage(restoredUsage)
    this.requestPermission = requestPermission
    this.logger = logger
    this.timeouts = { ...DEFAULT_OPENCODE_ACP_TIMEOUTS, ...timeouts }
    this.dependencies = {
      resolveCommand: resolveOpenCodeCommand,
      spawnOpenCode,
      terminateProcessTree,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
      ...dependencies,
    }
    this.listeners = new Set()
    this.toolCalls = new Map()
    this.acceptUpdates = false
    this.disposed = false
    this.connection = null
    this.context = null
    this.process = null
    this.stderr = ''
    this.idleWaiters = new Set()
    this.abortController = null
    this.signal = undefined
    this.currentPromptPromise = null
    this.promptRunSequence = 0
    this.activePromptRunId = 0
    this.runtimeFailure = null
    this.runtimeFailureHandled = false
    this.runtimeTerminationPromise = null
    this.activeRunEnded = false
    this.initialized = false
    this.initializeResult = null
    this.protocolVersion = null
    this.agentInfo = null
    this.agentCapabilities = {}
    this.authMethods = []
    this.setupMetadataBuffer = []
    this.runtimeFailurePromise = new Promise((resolve) => { this.resolveRuntimeFailure = resolve })
    this.state = {
      systemPrompt: '',
      model: null,
      thinkingLevel: 'off',
      messages: normalizeOpenCodeHistoryMessages(messages),
      tools: [],
      isStreaming: false,
      streamingMessage: undefined,
      pendingToolCalls: new Set(),
      errorMessage: undefined,
      acpSession: {
        configOptions: [],
        modes: null,
        availableCommands: [],
        sessionInfo: {},
        usage: this.restoredUsage,
      },
    }
  }

  async initialize() {
    const command = await this.dependencies.resolveCommand()
    const child = this.dependencies.spawnOpenCode(command, this.cwd, this.dependencies.spawnImpl, this.dependencies.platform)
    this.process = child
    child.stdin?.on('error', () => {})
    child.stdout?.on('error', () => {})
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk) => {
      this.stderr = sanitizeOpenCodeDiagnostic(`${this.stderr}${chunk}`).slice(-DIAGNOSTIC_LIMIT)
    })
    child.once('error', (error) => this.handleRuntimeFailure(error, 'process'))
    child.once('exit', (code, signal) => {
      if (this.disposed) return
      const exitReason = signal || (code ?? 'unknown')
      const detail = this.stderr.trim()
      this.handleRuntimeFailure(new Error(`OpenCode ACP process exited (${exitReason}).${detail ? ` ${detail}` : ''}`), 'process')
    })

    const app = client({ name: ACP_CLIENT_NAME })
      .onRequest(methods.client.session.requestPermission, ({ params }) => this.handlePermissionRequest(params))
      .onNotification(methods.client.session.update, ({ params }) => this.handleSessionUpdate(params))
      .onRequest(methods.client.fs.readTextFile, async () => { throw new Error('OpenCode must use its native filesystem tools.') })
      .onRequest(methods.client.fs.writeTextFile, async () => { throw new Error('OpenCode must use its native filesystem tools.') })

    const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))
    const connection = app.connect(stream)
    this.connection = connection
    void connection.closed.then(
      () => this.handleRuntimeFailure(new Error('OpenCode ACP connection closed.'), 'transport'),
      (error) => this.handleRuntimeFailure(error, 'transport'),
    )
    this.context = connection.agent

    const initialized = await this.requestWithDeadline('initialize', this.timeouts.initialize, () => this.context.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: ACP_CLIENT_NAME, version: '1' },
    }))
    this.validateInitializeResult(initialized)
    this.initialized = true

    if (this.harnessSessionId) {
      await this.loadExistingSession()
    } else if (this.sourceHarnessSessionId) {
      this.requireCapability(this.supportsSessionCapability('fork'), 'OpenCode does not advertise ACP session/fork support.', 'session/fork')
      const forked = await this.requestWithDeadline('session/fork', this.timeouts.sessionSetup, () => this.context.request(methods.agent.session.fork, {
        sessionId: this.sourceHarnessSessionId,
        cwd: this.cwd,
        mcpServers: [],
      }))
      this.harnessSessionId = forked.sessionId
      this.applySessionSetupResult(forked)
    } else {
      const created = await this.requestWithDeadline('session/new', this.timeouts.sessionSetup, () => this.context.request(methods.agent.session.new, {
        cwd: this.cwd,
        mcpServers: [],
      }))
      this.harnessSessionId = created.sessionId
      this.applySessionSetupResult(created)
    }
    this.acceptUpdates = true
    this.flushSetupMetadataBuffer()
    return this
  }

  validateInitializeResult(result) {
    if (!result || result.protocolVersion !== PROTOCOL_VERSION) {
      throw incompatibleError(`OpenCode ACP protocol version ${result?.protocolVersion ?? 'unknown'} is incompatible with QuickForge protocol version ${PROTOCOL_VERSION}.`)
    }
    if (result.agentCapabilities != null && (typeof result.agentCapabilities !== 'object' || Array.isArray(result.agentCapabilities))) {
      throw incompatibleError('OpenCode returned invalid ACP agent capabilities.')
    }
    if (result.authMethods != null && !Array.isArray(result.authMethods)) {
      throw incompatibleError('OpenCode returned invalid ACP authentication methods.')
    }
    this.initializeResult = result
    this.protocolVersion = result.protocolVersion
    this.agentInfo = result.agentInfo ?? null
    this.agentCapabilities = result.agentCapabilities ?? {}
    this.authMethods = result.authMethods ?? []
  }

  supportsSessionCapability(name) {
    return capabilityEnabled(this.agentCapabilities?.sessionCapabilities?.[name])
  }

  requireCapability(supported, message, stage) {
    if (!supported) throw incompatibleError(message, stage)
  }

  async loadExistingSession() {
    const params = { sessionId: this.harnessSessionId, cwd: this.cwd, mcpServers: [] }
    let loadError
    if (this.agentCapabilities?.loadSession === true) {
      try {
        const loaded = await this.requestWithDeadline('session/load', this.timeouts.sessionSetup, () => this.context.request(methods.agent.session.load, params))
        this.applySessionSetupResult(loaded)
        return
      } catch (error) {
        loadError = error
      }
    }
    if (this.supportsSessionCapability('resume')) {
      try {
        const resumed = await this.requestWithDeadline('session/resume', this.timeouts.sessionSetup, () => this.context.request(methods.agent.session.resume, params))
        this.applySessionSetupResult(resumed)
        return
      } catch (error) {
        throw publicAcpError(error, 'session/resume', `OpenCode session ${this.harnessSessionId} could not be restored.`)
      }
    }
    if (loadError) throw publicAcpError(loadError, 'session/load', `OpenCode session ${this.harnessSessionId} could not be restored.`)
    throw incompatibleError('OpenCode does not advertise ACP session/load or session/resume support.', 'session/restore')
  }

  applySessionSetupResult(result) {
    const normalized = normalizeOpenCodeSessionSetupResult(result)
    this.state.acpSession.configOptions = normalized.configOptions
    this.state.acpSession.modes = normalized.modes
  }

  bufferSetupMetadataUpdate(params) {
    if (params?.sessionId !== this.harnessSessionId && this.harnessSessionId) return
    if (!ACP_METADATA_UPDATE_TYPES.has(params?.update?.sessionUpdate)) return
    if (this.setupMetadataBuffer.length >= SETUP_METADATA_BUFFER_LIMIT) this.setupMetadataBuffer.shift()
    this.setupMetadataBuffer.push(params)
  }

  flushSetupMetadataBuffer() {
    const buffered = this.setupMetadataBuffer
    this.setupMetadataBuffer = []
    for (const params of buffered) this.handleSessionUpdate(params)
  }

  clearSetupMetadataBuffer() {
    this.setupMetadataBuffer = []
  }

  applyMetadataUpdate(update) {
    switch (update?.sessionUpdate) {
      case 'available_commands_update':
        this.state.acpSession.availableCommands = sanitizeAvailableCommands(update.availableCommands)
        return true
      case 'current_mode_update': {
        if (typeof update.currentModeId !== 'string') return true
        const modes = this.state.acpSession.modes
        this.state.acpSession.modes = modes
          ? { ...modes, currentModeId: update.currentModeId }
          : { currentModeId: update.currentModeId, availableModes: [] }
        return true
      }
      case 'config_option_update':
        this.state.acpSession.configOptions = sanitizeConfigOptions(update.configOptions)
        return true
      case 'session_info_update':
        this.state.acpSession.sessionInfo = { ...this.state.acpSession.sessionInfo, ...sanitizeSessionInfo(update) }
        return true
      case 'usage_update':
        this.state.acpSession.usage = sanitizeUsage(update)
        this.emit({ type: 'acp_session_usage_update', sessionId: this.harnessSessionId, usage: this.state.acpSession.usage })
        return true
      default:
        return false
    }
  }

  requestWithDeadline(stage, timeoutMs, request, options = {}) {
    if (this.runtimeFailure && options.includeRuntimeFailure !== false) return Promise.reject(this.runtimeFailure)
    let timer
    let deadlineError = null
    const timeout = new Promise((_, reject) => {
      timer = this.dependencies.setTimer(() => {
        deadlineError = timeoutError(stage, timeoutMs)
        reject(deadlineError)
      }, timeoutMs)
      timer?.unref?.()
    })
    const contenders = [Promise.resolve().then(request), timeout]
    if (options.includeRuntimeFailure !== false) {
      contenders.push(this.runtimeFailurePromise.then((error) => Promise.reject(error)))
    }
    return Promise.race(contenders)
      .catch((error) => {
        const publicError = publicAcpError(error, stage)
        if (error === deadlineError && options.fatal !== false) this.handleRuntimeFailure(publicError, stage)
        throw publicError
      })
      .finally(() => this.dependencies.clearTimer(timer))
  }

  terminateFailedRuntime() {
    if (this.runtimeTerminationPromise) return this.runtimeTerminationPromise
    try { this.connection?.close() } catch { /* best-effort transport cleanup */ }
    this.runtimeTerminationPromise = Promise.resolve(this.dependencies.terminateProcessTree(this.process)).catch(() => {})
    return this.runtimeTerminationPromise
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event) {
    for (const listener of this.listeners) {
      try { listener(event) } catch { /* ignore listener failures */ }
    }
  }

  validatePrompt(message) {
    return attachmentPrompt(message, this.agentCapabilities)
  }

  async prompt(message) {
    if (this.disposed) throw new Error('OpenCode session is closed.')
    if (this.state.isStreaming) throw new Error('Generation is still running.')
    if (this.runtimeFailure) throw this.runtimeFailure
    const prompt = this.validatePrompt(message)
    const text = messageText(message)
    const userMessage = typeof message === 'string'
      ? { role: 'user', content: text, timestamp: Date.now() }
      : message
    const isInitialUserMessage = this.state.messages.length === 0
    this.state.messages = [...this.state.messages, userMessage]
    this.emit({ type: 'message_start', message: userMessage })
    this.emit({ type: 'message_end', message: userMessage, isInitialUserMessage })
    this.state.isStreaming = true
    this.state.errorMessage = undefined
    this.abortController = new AbortController()
    const promptAbortController = this.abortController
    this.signal = promptAbortController.signal
    this.activeRunEnded = false
    const runId = ++this.promptRunSequence
    this.activePromptRunId = runId
    this.emit({ type: 'agent_start' })

    const run = async () => {
      try {
        const result = await this.requestWithDeadline('session/prompt', this.timeouts.prompt, () => this.context.request(methods.agent.session.prompt, {
          sessionId: this.harnessSessionId,
          prompt,
        }))
        if (promptAbortController.signal.aborted || this.activeRunEnded || this.activePromptRunId !== runId) return
        this.finishAssistantMessage(result.stopReason)
        this.state.isStreaming = false
        this.signal = undefined
        this.activeRunEnded = true
        this.emit({ type: 'agent_end', messages: this.state.messages, stopReason: result.stopReason })
        this.resolveIdleWaiters()
      } catch (error) {
        if (promptAbortController.signal.aborted || this.activePromptRunId !== runId) {
          if (this.activePromptRunId !== runId) return
          this.finishAssistantMessage()
          this.clearRunState()
          return
        }
        const publicError = publicAcpError(error, error?.stage || 'session/prompt', 'OpenCode ACP prompt failed.')
        if (!this.activeRunEnded) this.failActiveRun(publicError)
        throw publicError
      } finally {
        if (this.activePromptRunId === runId) this.currentPromptPromise = null
      }
    }
    this.currentPromptPromise = run()
    await this.currentPromptPromise
  }

  clearRunState() {
    this.activePromptRunId = 0
    this.currentPromptPromise = null
    this.state.isStreaming = false
    this.state.streamingMessage = undefined
    this.state.pendingToolCalls = new Set()
    this.toolCalls.clear()
    this.signal = undefined
    this.activeRunEnded = true
    this.resolveIdleWaiters()
  }

  failActiveRun(error) {
    if (this.activeRunEnded) return
    this.finishAssistantMessage()
    const errorMessage = error?.message || 'OpenCode ACP runtime failed.'
    const last = this.state.messages[this.state.messages.length - 1]
    if (!(last?.role === 'assistant' && last?.stopReason === 'error' && last?.errorMessage)) {
      const message = assistantErrorMessage(errorMessage)
      this.state.messages = [...this.state.messages, message]
      this.emit({ type: 'message_start', message })
      this.emit({ type: 'message_end', message })
    }
    this.state.isStreaming = false
    this.state.streamingMessage = undefined
    this.state.pendingToolCalls = new Set()
    this.toolCalls.clear()
    this.state.errorMessage = errorMessage
    this.signal = undefined
    this.activeRunEnded = true
    this.emit({ type: 'error', error: errorMessage, errorCode: error?.errorCode, stage: error?.stage })
    this.emit({ type: 'agent_end', messages: this.state.messages, errorMessage, stopReason: 'error' })
    this.resolveIdleWaiters()
  }

  handleRuntimeFailure(error, stage = 'runtime') {
    if (this.disposed || this.runtimeFailureHandled) return
    this.runtimeFailureHandled = true
    this.clearSetupMetadataBuffer()
    const runtimeError = publicAcpError(error, stage, 'OpenCode runtime is unavailable.')
    this.runtimeFailure = runtimeError
    this.acceptUpdates = false
    this.resolveRuntimeFailure(runtimeError)
    if (this.state.isStreaming) this.failActiveRun(runtimeError)
    else this.state.errorMessage = runtimeError.message
    void this.terminateFailedRuntime()
  }

  appendAssistantChunk(update, type) {
    const text = update?.content?.text || ''
    if (!text) return
    const current = this.state.streamingMessage
    const id = String(update.messageId || current?.id || `opencode-${Date.now()}`)
    if (current && current.id !== id) this.finishAssistantMessage()
    const active = this.state.streamingMessage
    const block = type === 'thinking' ? { type: 'thinking', thinking: text } : { type: 'text', text }
    const content = active ? active.content.slice() : []
    const last = content[content.length - 1]
    if (type === 'thinking' && last?.type === 'thinking') last.thinking = `${last.thinking || ''}${text}`
    else if (type === 'text' && last?.type === 'text') last.text = `${last.text || ''}${text}`
    else content.push(block)
    const next = baseAssistantMessage(content, id)
    this.state.streamingMessage = next
    this.emit({ type: active ? 'message_update' : 'message_start', message: next })
  }

  handleSessionUpdate(params) {
    if (!this.acceptUpdates) {
      if (!this.initialized || this.disposed || this.runtimeFailure) return
      this.bufferSetupMetadataUpdate(params)
      return
    }
    if (params?.sessionId !== this.harnessSessionId) return
    const update = params.update
    if (this.applyMetadataUpdate(update)) return
    if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
      this.appendAssistantChunk(update, 'text')
      return
    }
    if (update?.sessionUpdate === 'agent_thought_chunk' && update.content?.type === 'text') {
      this.appendAssistantChunk(update, 'thinking')
      return
    }

    if (update?.sessionUpdate === 'tool_call') {
      this.finishAssistantMessage()
      const id = String(update.toolCallId)
      const name = toolName(update)
      const metadata = toolMetadata(update)
      const args = normalizedToolInput(update, metadata)
      this.toolCalls.set(id, { name, input: args, metadata })
      const message = baseAssistantMessage([{ type: 'toolCall', id, name, arguments: args }], update.messageId)
      message.details = { __quickforgeAcp: metadata }
      this.state.messages = [...this.state.messages, message]
      this.emit({ type: 'message_start', message })
      this.emit({ type: 'message_end', message })
      this.state.pendingToolCalls = new Set([...this.state.pendingToolCalls, id])
      this.emit({ type: 'tool_execution_start', toolCallId: id, toolName: name, args, details: { __quickforgeAcp: metadata } })
      return
    }

    if (update?.sessionUpdate === 'tool_call_update') {
      const id = String(update.toolCallId)
      const previous = this.toolCalls.get(id)
      if (!previous) return
      const name = previous.name
      const metadata = toolMetadata(update, previous.metadata)
      previous.metadata = metadata
      if (update.status === 'completed' || update.status === 'failed') {
        this.state.pendingToolCalls = new Set([...this.state.pendingToolCalls].filter((item) => item !== id))
        this.toolCalls.delete(id)
        const result = toolResult(update, metadata)
        this.state.messages = [...this.state.messages, {
          role: 'toolResult',
          toolCallId: id,
          toolName: name,
          content: result.content,
          details: result.details,
          isError: update.status === 'failed',
          timestamp: Date.now(),
        }]
        this.emit({
          type: 'tool_execution_end',
          toolCallId: id,
          toolName: name,
          args: previous.input,
          result,
          isError: update.status === 'failed',
          error: update.status === 'failed' ? sanitizeOpenCodeDiagnostic(update.rawOutput) : undefined,
          details: { __quickforgeAcp: metadata },
        })
      } else {
        this.emit({
          type: 'tool_execution_update',
          toolCallId: id,
          toolName: name,
          args: previous.input,
          partialResult: toolResult(update, metadata),
          details: { __quickforgeAcp: metadata },
        })
      }
    }
  }

  finishAssistantMessage(stopReason) {
    const current = this.state.streamingMessage
    if (!current) return
    const message = stopReason === undefined ? current : { ...current, stopReason }
    this.state.messages = [...this.state.messages, message]
    this.state.streamingMessage = undefined
    this.emit({ type: 'message_end', message })
  }

  async handlePermissionRequest(params) {
    if (!this.requestPermission) return { outcome: { outcome: 'cancelled' } }
    return this.requestPermission({
      toolCallId: String(params.toolCall?.toolCallId || ''),
      toolName: params.toolCall?.title || params.toolCall?.kind || 'OpenCode tool',
      args: params.toolCall?.rawInput,
      options: params.options || [],
    })
  }

  async setConfigOption(configId, value) {
    if (this.disposed) throw new Error('OpenCode session is closed.')
    if (this.state.isStreaming) throw Object.assign(new Error('Generation is still running. Stop it or wait until it finishes.'), { statusCode: 409 })
    const option = this.state.acpSession.configOptions.find((item) => item.id === configId)
    if (!option) throw Object.assign(new Error(`OpenCode did not advertise config option: ${configId}`), { statusCode: 400 })
    if (option.type === 'boolean') {
      if (typeof value !== 'boolean') throw Object.assign(new Error(`Config option ${configId} requires a boolean value.`), { statusCode: 400 })
    } else if (option.type === 'select') {
      if (typeof value !== 'string' || !configOptionValues(option).includes(value)) {
        throw Object.assign(new Error(`Invalid value for OpenCode config option: ${configId}`), { statusCode: 400 })
      }
    } else {
      throw Object.assign(new Error(`Unsupported OpenCode config option type: ${configId}`), { statusCode: 400 })
    }
    const params = {
      sessionId: this.harnessSessionId,
      configId,
      value,
      ...(option.type === 'boolean' ? { type: 'boolean' } : {}),
    }
    const result = await this.requestWithDeadline('session/set_config_option', this.timeouts.sessionSetup, () => this.context.request(methods.agent.session.setConfigOption, params), { fatal: false })
    this.state.acpSession.configOptions = sanitizeConfigOptions(result?.configOptions)
    return this.state.acpSession
  }

  async setMode(modeId) {
    if (this.disposed) throw new Error('OpenCode session is closed.')
    if (this.state.isStreaming) throw Object.assign(new Error('Generation is still running. Stop it or wait until it finishes.'), { statusCode: 409 })
    const modes = this.state.acpSession.modes
    if (!modes?.availableModes.some((mode) => mode.id === modeId)) {
      throw Object.assign(new Error(`OpenCode did not advertise mode: ${modeId}`), { statusCode: 400 })
    }
    await this.requestWithDeadline('session/set_mode', this.timeouts.sessionSetup, () => this.context.request(methods.agent.session.setMode, {
      sessionId: this.harnessSessionId,
      modeId,
    }), { fatal: false })
    this.state.acpSession.modes = { ...modes, currentModeId: modeId }
    return this.state.acpSession
  }

  steer() {
    throw new Error('Steering is not supported by the OpenCode Harness.')
  }

  followUp() {
    throw new Error('Follow-up queuing is not supported by the OpenCode Harness.')
  }

  reset() {
    this.state.messages = []
    this.state.streamingMessage = undefined
    this.state.pendingToolCalls = new Set()
    this.state.errorMessage = undefined
    this.toolCalls.clear()
  }

  abort() {
    if (!this.state.isStreaming) return
    this.finishAssistantMessage()
    this.abortController?.abort()
    this.activePromptRunId = 0
    this.currentPromptPromise = null
    this.state.isStreaming = false
    this.state.streamingMessage = undefined
    this.state.pendingToolCalls = new Set()
    this.toolCalls.clear()
    this.signal = undefined
    this.activeRunEnded = true
    this.resolveIdleWaiters()
    if (this.context && this.harnessSessionId) {
      void this.context.notify(methods.agent.session.cancel, { sessionId: this.harnessSessionId }).catch(() => {})
    }
  }

  waitForIdle() {
    if (!this.state.isStreaming) return Promise.resolve()
    if (this.currentPromptPromise) return this.currentPromptPromise.catch(() => {})
    return new Promise((resolve) => this.idleWaiters.add(resolve))
  }

  resolveIdleWaiters() {
    for (const resolve of this.idleWaiters) resolve()
    this.idleWaiters.clear()
  }

  async dispose() {
    if (this.disposed) return
    this.abort()
    this.disposed = true
    this.acceptUpdates = false
    this.clearSetupMetadataBuffer()
    try {
      if (this.context && this.harnessSessionId && this.supportsSessionCapability('close')) {
        await this.requestWithDeadline('session/close', this.timeouts.close, () => this.context.request(methods.agent.session.close, {
          sessionId: this.harnessSessionId,
        }), { includeRuntimeFailure: false, fatal: false }).catch(() => {})
      }
    } finally {
      this.connection?.close()
      await (this.runtimeTerminationPromise ?? Promise.resolve(this.dependencies.terminateProcessTree(this.process)).catch(() => {}))
      this.clearRunState()
      this.listeners.clear()
    }
  }
}

export async function createOpenCodeAcpAgent(options) {
  const agent = new OpenCodeAcpAgent(options)
  try {
    return await agent.initialize()
  } catch (error) {
    agent.acceptUpdates = false
    await agent.dispose().catch(() => {})
    if (error?.code === 'ENOENT') {
      throw Object.assign(new Error('OpenCode is unavailable. Install OpenCode and ensure the opencode command is on PATH.'), {
        statusCode: 503,
        errorCode: 'OPENCODE_UNAVAILABLE',
      })
    }
    throw publicAcpError(error, error?.stage || 'initialize')
  }
}
