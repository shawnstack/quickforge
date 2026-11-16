import { t } from '@/lib/i18n'
import type { McpServer, McpTransport } from '@/lib/types/mcp'

export type McpServerFormData = {
  name: string
  transport: McpTransport
  command: string
  args: string[]
  url: string
  cwd: string
  env: Record<string, string>
}

export function emptyMcpDraft(): McpServerFormData {
  return { name: '', transport: 'stdio', command: '', args: [], url: '', cwd: '', env: {} }
}

export function serverToDraft(server: McpServer): McpServerFormData {
  return {
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: server.args || [],
    url: server.url || '',
    cwd: server.cwd || '',
    env: server.env || {},
  }
}

export function argsToText(args?: string[]): string {
  return (args || []).join('\n')
}

export function envToText(env?: Record<string, string>): string {
  return Object.entries(env || {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

export function textToArgs(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function textToEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex <= 0) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    if (key) result[key] = value
  }
  return result
}

/** Serialize a single server draft into mcpServers JSON text. */
export function draftToJson(draft: McpServerFormData): string {
  const config: Record<string, unknown> = { type: draft.transport || 'stdio' }
  if (draft.transport === 'stdio') {
    config.command = draft.command || ''
    config.args = draft.args || []
    if (draft.cwd) config.cwd = draft.cwd
    if (draft.env && Object.keys(draft.env).length > 0) config.env = draft.env
  } else {
    config.url = draft.url || ''
    if (draft.env && Object.keys(draft.env).length > 0) config.headers = draft.env
  }
  const name = draft.name || 'server'
  return JSON.stringify({ mcpServers: { [name]: config } }, null, 2)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/** Parse mcpServers JSON text (or a bare server object) into a single draft. */
export function jsonToDraft(text: string): McpServerFormData {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(t('mcpInvalidJson'))
  }
  if (!isRecord(payload)) throw new Error(t('mcpInvalidConfigJson'))

  let serverName = ''
  let serverConfig: Record<string, unknown> | null = null
  if (isRecord(payload.mcpServers)) {
    const entries = Object.entries(payload.mcpServers)
    if (entries.length === 0) throw new Error(t('mcpEmptyConfigJson'))
    const [name, config] = entries[0]
    serverName = name
    if (isRecord(config)) serverConfig = config
  } else {
    // Treat the object itself as a single server config
    serverConfig = payload
  }
  if (!serverConfig) throw new Error(t('mcpInvalidConfigJson'))

  const transport = String(serverConfig.transport || serverConfig.type || 'stdio') as McpTransport
  if (!['stdio', 'http', 'sse'].includes(transport)) throw new Error(t('mcpInvalidTransport', { name: serverName || 'server' }))
  const envSource = serverConfig.env ?? serverConfig.headers ?? {}
  return {
    name: serverName,
    transport,
    command: String(serverConfig.command || ''),
    args: Array.isArray(serverConfig.args) ? (serverConfig.args as string[]) : [],
    url: String(serverConfig.url || ''),
    cwd: String(serverConfig.cwd || ''),
    env: isRecord(envSource) ? (envSource as Record<string, string>) : {},
  }
}

/**
 * 一份配置文本里到底有几台服务器（解析不出时返回空数组）。
 *
 * 草稿只装得下一台（`jsonToDraft` 取 `mcpServers` 的第一条），所以保存前要用它判断：
 * 粘贴了多台的配置如果照常保存，其余服务器会静默消失。
 */
export function mcpServerNamesInJson(text: string): string[] {
  try {
    const payload: unknown = JSON.parse(text)
    if (!isRecord(payload) || !isRecord(payload.mcpServers)) return []
    return Object.keys(payload.mcpServers)
  } catch {
    return []
  }
}

/**
 * 切到 JSON 视图时该显示什么文本。
 *
 * 只有当前文本仍是我们上次从 draft 生成的那份副本时才重新生成。单服务器的 draft 装不下
 * 多服务器配置与未知字段（`jsonToDraft` 只取 `mcpServers` 的第一条），拿它去覆盖用户手写
 * 的原文就是静默丢数据——粘贴两台服务器、切一下标签页就剩一台。
 */
export function jsonTextForTab(
  currentText: string,
  lastGeneratedText: string,
  draft: McpServerFormData,
): string {
  if (currentText !== lastGeneratedText) return currentText
  return draftToJson(draft)
}
