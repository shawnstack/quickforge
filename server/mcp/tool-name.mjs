const TOOL_PREFIX = 'mcp__'
const VALID_MCP_SERVER_NAME_RE = /^(?!.*--)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

export function isCanonicalMcpServerName(value) {
  return typeof value === 'string'
    && value.length <= 64
    && VALID_MCP_SERVER_NAME_RE.test(value)
}

export function sanitizeMcpToolName(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '') || 'tool'
}

export function createMcpToolName(serverName, toolName) {
  return `${TOOL_PREFIX}${serverName}__${sanitizeMcpToolName(toolName)}`
}

export function parseMcpToolName(value) {
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

export function isCanonicalMcpToolName(name) {
  const parsed = parseMcpToolName(name)
  return Boolean(
    typeof name === 'string'
    && parsed
    && isCanonicalMcpServerName(parsed.serverName)
    && createMcpToolName(parsed.serverName, parsed.toolName) === name,
  )
}
