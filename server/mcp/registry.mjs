import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { readMcpServers } from './config.mjs'
import { logger } from '../utils/logger.mjs'

const TOOL_PREFIX = 'mcp__'
const CONNECT_TIMEOUT_MS = 15_000
const CALL_TIMEOUT_MS = 120_000
const MAX_TEXT_LENGTH = 60_000

const connections = new Map()
let refreshPromise = null

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function sanitizeToolName(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '') || 'tool'
}

function quickForgeToolName(serverName, toolName) {
  return `${TOOL_PREFIX}${serverName}__${sanitizeToolName(toolName)}`
}

function parseQuickForgeToolName(value) {
  const name = String(value || '')
  if (!name.startsWith(TOOL_PREFIX)) return null
  const rest = name.slice(TOOL_PREFIX.length)
  const index = rest.indexOf('__')
  if (index <= 0 || index >= rest.length - 2) return null
  return {
    serverName: rest.slice(0, index),
    toolName: rest.slice(index + 2),
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
}

function truncateText(value, max = MAX_TEXT_LENGTH) {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max)}\n\n[truncated ${text.length - max} characters]` : text
}

function resolveEnv(env = {}) {
  const result = { ...process.env }
  for (const [key, value] of Object.entries(env || {})) {
    const text = String(value ?? '')
    const match = text.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/)
    result[key] = match ? (process.env[match[1]] || '') : text
  }
  return result
}

function resolveHeaders(env = {}) {
  const headers = {}
  for (const [key, value] of Object.entries(env || {})) {
    const text = String(value ?? '')
    const match = text.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/)
    const resolved = match ? (process.env[match[1]] || '') : text
    if (resolved) headers[key] = resolved
  }
  return headers
}

function createTransport(config) {
  if (config.transport === 'stdio') {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd: config.cwd || undefined,
      env: resolveEnv(config.env),
      stderr: 'pipe',
    })
  }

  const requestInit = { headers: resolveHeaders(config.env) }
  if (config.transport === 'sse') return new SSEClientTransport(new URL(config.url), { requestInit })
  if (config.transport === 'http') return new StreamableHTTPClientTransport(new URL(config.url), { requestInit })

  throw new Error(`Unsupported MCP transport: ${config.transport}`)
}

function resultContentToText(result) {
  if (Array.isArray(result?.content)) {
    return result.content.map((item) => {
      if (item?.type === 'text') return item.text || ''
      if (item?.type === 'image') return `[image: ${item.mimeType || 'unknown mime'}]`
      if (item?.type === 'audio') return `[audio: ${item.mimeType || 'unknown mime'}]`
      if (item?.type === 'resource') {
        const resource = item.resource || {}
        if (typeof resource.text === 'string') return `[resource: ${resource.uri || 'unknown'}]\n${resource.text}`
        return `[resource: ${resource.uri || 'unknown'}]`
      }
      if (item?.type === 'resource_link') return `[resource link: ${item.uri || item.name || 'unknown'}]`
      return JSON.stringify(item)
    }).join('\n')
  }
  if (Object.prototype.hasOwnProperty.call(result || {}, 'toolResult')) return JSON.stringify(result.toolResult, null, 2)
  if (result?.structuredContent) return JSON.stringify(result.structuredContent, null, 2)
  return JSON.stringify(result, null, 2)
}

async function connectServer(config) {
  const client = new Client({ name: 'quickforge', version: '1.0.0' }, { capabilities: {} })
  const transport = createTransport(config)

  const connection = {
    config,
    client,
    transport,
    status: 'connecting',
    error: null,
    tools: [],
    connectedAt: null,
    stderr: '',
  }

  transport.stderr?.on?.('data', (chunk) => {
    connection.stderr = truncateText(connection.stderr + chunk.toString(), 4000)
  })
  transport.onclose = () => {
    connection.status = 'disconnected'
  }
  transport.onerror = (error) => {
    connection.status = 'error'
    connection.error = error?.message || 'MCP transport error'
  }

  await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `MCP server ${config.name} connection timed out`)
  const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, `MCP server ${config.name} tool discovery timed out`)
  connection.tools = Array.isArray(listed?.tools) ? listed.tools : []
  connection.status = 'connected'
  connection.connectedAt = new Date().toISOString()
  return connection
}

async function closeConnection(connection) {
  try {
    await connection?.transport?.close?.()
  } catch {
    // ignore close errors
  }
}

function isSameConfig(left, right) {
  return JSON.stringify({
    enabled: left?.enabled,
    transport: left?.transport,
    url: left?.url || '',
    command: left?.command,
    args: left?.args || [],
    cwd: left?.cwd || '',
    env: left?.env || {},
  }) === JSON.stringify({
    enabled: right?.enabled,
    transport: right?.transport,
    url: right?.url || '',
    command: right?.command,
    args: right?.args || [],
    cwd: right?.cwd || '',
    env: right?.env || {},
  })
}

async function refreshConnections() {
  const servers = await readMcpServers()
  const enabled = new Map(servers.filter((server) => server.enabled).map((server) => [server.name, server]))

  for (const [name, connection] of connections) {
    const nextConfig = enabled.get(name)
    if (!nextConfig || !isSameConfig(connection.config, nextConfig)) {
      connections.delete(name)
      await closeConnection(connection)
    }
  }

  for (const config of enabled.values()) {
    if (connections.has(config.name)) continue
    try {
      const connection = await connectServer(config)
      connections.set(config.name, connection)
    } catch (error) {
      logger.error(`Failed to connect MCP server ${config.name}:`, error)
      connections.set(config.name, {
        config,
        client: null,
        transport: null,
        status: 'error',
        error: error?.message || 'Failed to connect MCP server',
        tools: [],
        connectedAt: null,
        stderr: '',
      })
    }
  }

  return connections
}

export async function refreshMcpConnections() {
  if (!refreshPromise) {
    refreshPromise = refreshConnections().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

export async function getMcpStatus() {
  await refreshMcpConnections()
  const servers = await readMcpServers()
  return servers.map((server) => {
    const connection = connections.get(server.name)
    return {
      ...server,
      command: server.transport === 'stdio' ? server.command : '',
      args: server.transport === 'stdio' ? server.args : [],
      cwd: server.transport === 'stdio' ? server.cwd : '',
      status: server.enabled ? (connection?.status || 'disconnected') : 'disabled',
      error: connection?.error || null,
      connectedAt: connection?.connectedAt || null,
      toolCount: connection?.tools?.length || 0,
      tools: (connection?.tools || []).map((tool) => ({
        name: tool.name,
        quickForgeName: quickForgeToolName(server.name, tool.name),
        description: tool.description || '',
      })),
      stderr: connection?.status === 'error' ? connection?.stderr || '' : '',
    }
  })
}

export async function createMcpToolDefinitions() {
  await refreshMcpConnections()
  const definitions = []
  for (const [serverName, connection] of connections) {
    if (connection.status !== 'connected') continue
    for (const tool of connection.tools || []) {
      definitions.push({
        name: quickForgeToolName(serverName, tool.name),
        label: tool.title || tool.name,
        description: `[MCP:${serverName}] ${tool.description || tool.name}`,
        parameters: isPlainObject(tool.inputSchema) ? tool.inputSchema : { type: 'object', properties: {} },
        mcp: { serverName, toolName: tool.name },
      })
    }
  }
  return definitions
}

export function isMcpToolName(name) {
  return Boolean(parseQuickForgeToolName(name))
}

export async function callMcpTool(toolName, params = {}) {
  await refreshMcpConnections()
  const parsed = parseQuickForgeToolName(toolName)
  if (!parsed) {
    const error = new Error(`Invalid MCP tool name: ${toolName}`)
    error.statusCode = 400
    throw error
  }
  const connection = connections.get(parsed.serverName)
  if (!connection || connection.status !== 'connected' || !connection.client) {
    const error = new Error(`MCP server is not connected: ${parsed.serverName}`)
    error.statusCode = 503
    throw error
  }
  const tool = (connection.tools || []).find((item) => sanitizeToolName(item.name) === parsed.toolName || item.name === parsed.toolName)
  if (!tool) {
    const error = new Error(`Unknown MCP tool: ${toolName}`)
    error.statusCode = 404
    throw error
  }
  const result = await withTimeout(
    connection.client.callTool({ name: tool.name, arguments: params || {} }),
    CALL_TIMEOUT_MS,
    `MCP tool ${toolName} timed out`,
  )
  return {
    isError: Boolean(result?.isError),
    content: truncateText(resultContentToText(result)),
    details: {
      mcp: true,
      server: parsed.serverName,
      tool: tool.name,
      structuredContent: result?.structuredContent,
    },
  }
}

export async function shutdownMcpConnections() {
  const current = [...connections.values()]
  connections.clear()
  await Promise.all(current.map(closeConnection))
}
