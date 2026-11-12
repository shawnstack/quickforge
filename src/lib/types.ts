import type { SessionMetadata, SessionData } from '@/storage'
import type { ServerAgent } from '@/lib/server-agent/agent'
import type { ServerAgentContextCompaction } from '@/lib/server-agent-types'
import type { AgentAccessMode } from './agent-access-mode'
import { t } from './i18n'

export type { AgentAccessMode } from './agent-access-mode'
export { agentAccessModeFromYoloMode, normalizeAgentAccessMode, agentAccessModeToYoloMode } from './agent-access-mode'

export type BackgroundTaskStatus = 'running' | 'idle' | 'error' | 'aborted'

export type ChatScope = 'global' | 'project'

export type SidebarSessionViewMode = 'project' | 'timeline'

export type SidebarSessionSortMode = 'updatedAt' | 'createdAt'

export type ProjectInfo = {
  id: string
  name: string
  path: string
  lastOpenedAt: string
  sortOrder?: number
  skills?: string[]
  commandDir?: string
  /** 'bot' 表示这是某个 bot 的专属目录。它是真实项目（工具要用），但不该出现在项目切换器里。 */
  kind?: 'bot'
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

export type SessionTitleSource = 'default' | 'fallback' | 'ai' | 'manual'

export type QuickForgeSessionMetadata = SessionMetadata & {
  scope?: ChatScope
  projectId?: string
  source?: 'acp'
  titleSource?: SessionTitleSource
  accessMode?: AgentAccessMode
  yoloMode?: boolean
  taskStatus?: BackgroundTaskStatus
  taskStartedAt?: string
  taskFinishedAt?: string
  contextCompaction?: ServerAgentContextCompaction | null
  pinnedAt?: string
  archivedAt?: string
}

export type QuickForgeSessionData = SessionData & {
  scope?: ChatScope
  projectId?: string
  source?: 'acp'
  titleSource?: SessionTitleSource
  accessMode?: AgentAccessMode
  yoloMode?: boolean
  taskStatus?: BackgroundTaskStatus
  taskStartedAt?: string
  taskFinishedAt?: string
  contextCompaction?: ServerAgentContextCompaction | null
  pinnedAt?: string
  archivedAt?: string
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
  lastAccessedAt?: number
  unsubscribe: () => void
}

export function sessionTitle(title: string) {
  return title === 'New chat' ? t('newChat') : title
}
