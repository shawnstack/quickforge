export type TerminalCapabilities = {
  enabled: boolean
  localOnly: boolean
  maxSessions: number
  shell: string | null
  reason: string | null
  platform?: string
}

export type TerminalSession = {
  id: string
  name: string
  projectId: string | null
  cwd: string
  shell: string
  createdAt: string
  updatedAt: string
  exited: boolean
  exitCode?: number | null
  signal?: number | string | null
}

export type TerminalMessage =
  | { type: 'ready'; session: TerminalSession }
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode: number | null; signal: number | string | null }
  | { type: 'error'; message: string }
  | { type: 'pong' }
