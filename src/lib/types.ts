import type { SessionMetadata, SessionData } from '@mariozechner/pi-web-ui'
import type { ServerAgent, ServerAgentContextCompaction } from '@/lib/server-agent'
import { t } from '@/lib/i18n'

export type BackgroundTaskStatus = 'running' | 'idle' | 'error' | 'aborted'

export type ChatScope = 'global' | 'project'

export type ProjectInfo = {
  id: string
  name: string
  path: string
  lastOpenedAt: string
  skills?: string[]
  commandDir?: string
}

export type SkillsScope = 'global' | 'project'

export type SkillSummary = {
  name: string
  displayName?: string
  description?: string
  version?: string
  tags?: string[]
  triggers?: string[]
  entry?: string
  source?: string
  license?: string
  compatibility?: string
  allowedTools?: string
  metadata?: Record<string, string>
}

export type RestoredDraft = {
  id: number
  sessionId?: string
  text: string
  attachments?: unknown[]
}

export type QuickForgeSessionMetadata = SessionMetadata & {
  scope?: ChatScope
  projectId?: string
  projectName?: string
  projectPath?: string
  yoloMode?: boolean
  taskStatus?: BackgroundTaskStatus
  taskStartedAt?: string
  taskFinishedAt?: string
  contextCompaction?: ServerAgentContextCompaction | null
  pinnedAt?: string
}

export type QuickForgeSessionData = SessionData & {
  scope?: ChatScope
  projectId?: string
  projectName?: string
  projectPath?: string
  yoloMode?: boolean
  taskStatus?: BackgroundTaskStatus
  taskStartedAt?: string
  taskFinishedAt?: string
  contextCompaction?: ServerAgentContextCompaction | null
  pinnedAt?: string
}

export type BackgroundTask = {
  sessionId: string
  agent: ServerAgent
  scope: ChatScope
  project?: ProjectInfo
  title: string
  createdAt?: string
  status: BackgroundTaskStatus
  startedAt?: string
  finishedAt?: string
  unsubscribe: () => void
}

export function sessionScope(
  session: QuickForgeSessionMetadata | QuickForgeSessionData | null | undefined,
): ChatScope {
  return session?.scope === 'project' ? 'project' : 'global'
}

export function sessionTitle(title: string) {
  return title === 'New chat' ? t('newChat') : title
}
