export type McpTransport = 'stdio' | 'sse' | 'http'

export type McpTool = {
  name: string
  quickForgeName: string
  description?: string
}

export type McpServer = {
  name: string
  enabled: boolean
  transport: McpTransport
  url?: string
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  status?: string
  error?: string | null
  connectedAt?: string | null
  toolCount?: number
  tools?: McpTool[]
  stderr?: string
}

export type McpServersPayload = {
  servers: McpServer[]
  refreshedSessions?: string[]
}
