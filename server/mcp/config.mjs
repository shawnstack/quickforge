import path from 'node:path'
import { atomicUpdate, readStore } from '../storage.mjs'

const MCP_CONFIG_KEY = 'mcpServers'
const VALID_NAME_RE = /^(?!.*--)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const MAX_SERVERS = 50
const MAX_ARGS = 100
const MAX_ENV_KEYS = 100

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeName(value) {
  const name = String(value || '').trim().toLowerCase()
  if (!VALID_NAME_RE.test(name) || name.length > 64) {
    const error = new Error('MCP server name must be lowercase letters, numbers, and hyphens only.')
    error.statusCode = 400
    throw error
  }
  return name
}

function normalizeString(value, field, { required = false, max = 4096 } = {}) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (required && !text) {
    const error = new Error(`${field} is required`)
    error.statusCode = 400
    throw error
  }
  if (text.length > max) {
    const error = new Error(`${field} is too long`)
    error.statusCode = 400
    throw error
  }
  return text
}

function normalizeStringArray(value, field) {
  if (value === undefined || value === null || value === '') return []
  if (!Array.isArray(value)) {
    const error = new Error(`${field} must be an array`)
    error.statusCode = 400
    throw error
  }
  if (value.length > MAX_ARGS) {
    const error = new Error(`${field} has too many entries`)
    error.statusCode = 400
    throw error
  }
  return value.map((item, index) => normalizeString(item, `${field}[${index}]`, { max: 2048 }))
}

function normalizeEnv(value) {
  if (value === undefined || value === null || value === '') return {}
  if (!isPlainObject(value)) {
    const error = new Error('env must be an object')
    error.statusCode = 400
    throw error
  }
  const entries = Object.entries(value)
  if (entries.length > MAX_ENV_KEYS) {
    const error = new Error('env has too many entries')
    error.statusCode = 400
    throw error
  }
  const result = {}
  for (const [key, item] of entries) {
    const envKey = normalizeString(key, 'env key', { required: true, max: 128 })
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envKey)) {
      const error = new Error(`Invalid environment variable name: ${envKey}`)
      error.statusCode = 400
      throw error
    }
    result[envKey] = normalizeString(item, `env.${envKey}`, { max: 4096 })
  }
  return result
}

function normalizeHeaders(value) {
  if (value === undefined || value === null || value === '') return {}
  if (!isPlainObject(value)) {
    const error = new Error('headers must be an object')
    error.statusCode = 400
    throw error
  }
  const entries = Object.entries(value)
  if (entries.length > MAX_ENV_KEYS) {
    const error = new Error('headers has too many entries')
    error.statusCode = 400
    throw error
  }
  const result = {}
  for (const [key, item] of entries) {
    const headerKey = normalizeString(key, 'header key', { required: true, max: 128 })
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(headerKey)) {
      const error = new Error(`Invalid HTTP header name: ${headerKey}`)
      error.statusCode = 400
      throw error
    }
    result[headerKey] = normalizeString(item, `headers.${headerKey}`, { max: 4096 })
  }
  return result
}

function normalizeCwd(value) {
  const cwd = normalizeString(value, 'cwd', { max: 4096 })
  return cwd ? path.resolve(cwd) : ''
}

export function normalizeMcpServerConfig(value, fallbackName = '') {
  if (!isPlainObject(value)) {
    const error = new Error('MCP server config must be an object')
    error.statusCode = 400
    throw error
  }
  const name = normalizeName(value.name || fallbackName)
  const transport = normalizeString(value.transport || value.type || 'stdio', 'transport', { required: true, max: 32 })
  if (!['stdio', 'sse', 'http'].includes(transport)) {
    const error = new Error('MCP transport must be stdio, sse, or http')
    error.statusCode = 400
    throw error
  }
  const url = normalizeString(value.url, 'url', { required: transport !== 'stdio', max: 4096 })
  if (url) {
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol')
    } catch {
      const error = new Error('url must be a valid HTTP(S) URL')
      error.statusCode = 400
      throw error
    }
  }
  return {
    name,
    enabled: value.enabled !== false,
    transport,
    url,
    command: transport === 'stdio' ? normalizeString(value.command, 'command', { required: true, max: 1024 }) : '',
    args: transport === 'stdio' ? normalizeStringArray(value.args, 'args') : [],
    cwd: transport === 'stdio' ? normalizeCwd(value.cwd) : '',
    env: transport === 'stdio' ? normalizeEnv(value.env) : normalizeHeaders(value.headers || value.env),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  }
}

export function normalizeMcpServers(value) {
  const rawServers = Array.isArray(value)
    ? value
    : isPlainObject(value)
      ? Object.entries(value).map(([name, config]) => ({ ...config, name: config?.name || name }))
      : []
  const result = []
  const seen = new Set()
  for (const item of rawServers.slice(0, MAX_SERVERS)) {
    const server = normalizeMcpServerConfig(item)
    if (seen.has(server.name)) continue
    seen.add(server.name)
    result.push(server)
  }
  return result
}

export async function readMcpServers() {
  const settings = await readStore('settings')
  return normalizeMcpServers(settings?.[MCP_CONFIG_KEY])
}

export async function writeMcpServers(servers) {
  const normalized = normalizeMcpServers(servers)
  return atomicUpdate('settings', (settings) => {
    settings[MCP_CONFIG_KEY] = normalized.map((server) => ({ ...server, updatedAt: new Date().toISOString() }))
    return settings
  }).then((settings) => normalizeMcpServers(settings?.[MCP_CONFIG_KEY]))
}

export async function upsertMcpServer(server) {
  const normalized = normalizeMcpServerConfig(server)
  return atomicUpdate('settings', (settings) => {
    const servers = normalizeMcpServers(settings?.[MCP_CONFIG_KEY])
    const index = servers.findIndex((item) => item.name === normalized.name)
    const next = { ...normalized, updatedAt: new Date().toISOString() }
    if (index >= 0) servers[index] = next
    else servers.push(next)
    settings[MCP_CONFIG_KEY] = servers
    return settings
  }).then((settings) => normalizeMcpServers(settings?.[MCP_CONFIG_KEY]))
}

export async function deleteMcpServer(name) {
  const normalizedName = normalizeName(name)
  return atomicUpdate('settings', (settings) => {
    settings[MCP_CONFIG_KEY] = normalizeMcpServers(settings?.[MCP_CONFIG_KEY]).filter((server) => server.name !== normalizedName)
    return settings
  }).then((settings) => normalizeMcpServers(settings?.[MCP_CONFIG_KEY]))
}

export async function setMcpServerEnabled(name, enabled) {
  const normalizedName = normalizeName(name)
  return atomicUpdate('settings', (settings) => {
    const servers = normalizeMcpServers(settings?.[MCP_CONFIG_KEY])
    const index = servers.findIndex((server) => server.name === normalizedName)
    if (index < 0) {
      const error = new Error(`MCP server not found: ${normalizedName}`)
      error.statusCode = 404
      throw error
    }
    servers[index] = {
      ...servers[index],
      enabled: Boolean(enabled),
      updatedAt: new Date().toISOString(),
    }
    settings[MCP_CONFIG_KEY] = servers
    return settings
  }).then((settings) => normalizeMcpServers(settings?.[MCP_CONFIG_KEY]))
}
