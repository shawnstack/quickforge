export type TerminalShellProfile = {
  id: string
  name: string
  command: string
  builtin: boolean
  detected?: boolean
}

export type TerminalShellConfig = {
  terminalShell: string
  defaultProfileId: string
  profiles: TerminalShellProfile[]
}

export type TerminalCapabilities = {
  enabled: boolean
  localOnly: boolean
  maxSessions: number
  shell: string | null
  reason: string | null
  configuredShell?: string
  terminalShellProfiles?: TerminalShellProfile[]
  defaultTerminalShellProfileId?: string
  terminalShellOverride?: boolean
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
