import path from 'node:path'
import { atomicUpdate, readStore } from '../storage.mjs'
import { isCanonicalMcpServerName } from './tool-name.mjs'

const MCP_CONFIG_KEY = 'mcpServers'
const MAX_SERVERS = 50
const MAX_ARGS = 100
const MAX_ENV_KEYS = 100
const PLAYWRIGHT_PRESET = { name: 'playwright', enabled: false, command: 'npx', args: ['-y', '@playwright/mcp@latest'] }
// 桌面端内嵌浏览器：MCP server 跑在 Electron 主进程，随进程启动生成随机端口与
// 一次性 token 并通过 env 传给本服务。它不写死在配置里，也不可能手工编辑。
const DESKTOP_BROWSER_NAME = 'desktop-browser'

function desktopBrowserServer() {
  const url = process.env.QUICKFORGE_DESKTOP_BROWSER_URL
  const token = process.env.QUICKFORGE_DESKTOP_BROWSER_TOKEN
  if (!url || !token) return null
  return {
    name: DESKTOP_BROWSER_NAME,
    enabled: true,
    transport: 'http',
    url,
    headers: { authorization: `Bearer ${token}` },
  }
}

function withPlaywrightPreset(servers) {
  return servers.some((server) => server.name === PLAYWRIGHT_PRESET.name)
    ? servers
    : [normalizeMcpServerConfig(PLAYWRIGHT_PRESET), ...servers]
}

/**
 * 内置 server 的权威来源是「运行环境」，不是配置文件：
 * desktop-browser 每次读取都按当前 env 重建（端口/token 每次启动都不同），
 * 环境不存在时连同历史遗留项一起剔除，避免 UI 里留一个永远连不上的僵尸条目。
 */
function withBuiltinServers(servers) {
  let result = withPlaywrightPreset(servers)
  const desktop = desktopBrowserServer()
  if (!desktop) return result.filter((server) => server.name !== DESKTOP_BROWSER_NAME)
  const index = result.findIndex((server) => server.name === DESKTOP_BROWSER_NAME)
  const enabled = index >= 0 ? result[index].enabled !== false : true
  const fresh = normalizeMcpServerConfig({ ...desktop, enabled })
  result = index >= 0 ? result.map((server, itemIndex) => (itemIndex === index ? fresh : server)) : [fresh, ...result]
  return result
}

const BUILTIN_SERVER_NAMES = new Set([PLAYWRIGHT_PRESET.name, DESKTOP_BROWSER_NAME])

function isBuiltinServerName(name) {
  return BUILTIN_SERVER_NAMES.has(name)
}

/** 落盘前剥掉内置项里的凭据：token 只存在于进程内存。 */
function prepareForStorage(servers) {
  return servers.map((server) => (
    server.name === DESKTOP_BROWSER_NAME ? { ...server, env: {} } : server
  ))
}

function assertPlaywrightCapacity(servers, name) {
  if (isBuiltinServerName(name) && servers.length >= MAX_SERVERS
    && !servers.some((server) => server.name === name)) {
    const error = new Error(`MCP server capacity reached (${MAX_SERVERS}); remove a server before adding ${name}.`)
    error.statusCode = 409
    throw error
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeName(value) {
  const name = String(value || '').trim().toLowerCase()
  if (!isCanonicalMcpServerName(name)) {
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
  const mcp = await readStore('mcp')
  return withBuiltinServers(normalizeMcpServers(mcp?.[MCP_CONFIG_KEY])).map((server) => (
    isBuiltinServerName(server.name) ? { ...server, builtin: true } : server
  ))
}

export async function writeMcpServers(servers) {
  const normalized = normalizeMcpServers(servers)
  return atomicUpdate('mcp', (mcp) => {
    mcp[MCP_CONFIG_KEY] = prepareForStorage(normalized).map((server) => ({ ...server, updatedAt: new Date().toISOString() }))
    return mcp
  }).then((mcp) => normalizeMcpServers(mcp?.[MCP_CONFIG_KEY]))
}

export async function upsertMcpServer(server) {
  const normalized = normalizeMcpServerConfig(server)
  if (normalized.name === DESKTOP_BROWSER_NAME) {
    const error = new Error('Built-in MCP server cannot be modified: desktop-browser')
    error.statusCode = 409
    throw error
  }
  return atomicUpdate('mcp', (mcp) => {
    const servers = normalizeMcpServers(mcp?.[MCP_CONFIG_KEY])
    assertPlaywrightCapacity(servers, normalized.name)
    const index = servers.findIndex((item) => item.name === normalized.name)
    const next = { ...normalized, updatedAt: new Date().toISOString() }
    if (index >= 0) servers[index] = next
    else servers.push(next)
    mcp[MCP_CONFIG_KEY] = servers
    return mcp
  }).then((mcp) => normalizeMcpServers(mcp?.[MCP_CONFIG_KEY]))
}

export async function deleteMcpServer(name) {
  const normalizedName = normalizeName(name)
  if (isBuiltinServerName(normalizedName)) {
    const error = new Error(`Built-in MCP server cannot be deleted: ${normalizedName}`)
    error.statusCode = 409
    throw error
  }
  return atomicUpdate('mcp', (mcp) => {
    mcp[MCP_CONFIG_KEY] = prepareForStorage(normalizeMcpServers(mcp?.[MCP_CONFIG_KEY])).filter((server) => server.name !== normalizedName)
    return mcp
  }).then((mcp) => normalizeMcpServers(mcp?.[MCP_CONFIG_KEY]))
}

export async function setMcpServerEnabled(name, enabled) {
  const normalizedName = normalizeName(name)
  return atomicUpdate('mcp', (mcp) => {
    const persisted = normalizeMcpServers(mcp?.[MCP_CONFIG_KEY])
    assertPlaywrightCapacity(persisted, normalizedName)
    const servers = isBuiltinServerName(normalizedName) ? withBuiltinServers(persisted) : persisted
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
    mcp[MCP_CONFIG_KEY] = prepareForStorage(servers)
    return mcp
  }).then((mcp) => normalizeMcpServers(mcp?.[MCP_CONFIG_KEY]))
}
