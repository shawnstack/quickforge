import type { SessionMetadata, SessionData } from '@mariozechner/pi-web-ui'
import type { Agent } from '@mariozechner/pi-agent-core'
import { t } from '@/lib/i18n'

export type BackgroundTaskStatus = 'running' | 'idle' | 'error' | 'aborted'

export type ChatScope = 'global' | 'project'

export type ProjectInfo = {
  id: string
  name: string
  path: string
  lastOpenedAt: string
}

export type RestoredDraft = {
  id: number
  text: string
  attachments?: unknown[]
}

export type QuickForgeSessionMetadata = SessionMetadata & {
  scope?: ChatScope
  projectId?: string
  projectName?: string
  projectPath?: string
  taskStatus?: BackgroundTaskStatus
  taskStartedAt?: string
  taskFinishedAt?: string
}

export type QuickForgeSessionData = SessionData & {
  scope?: ChatScope
  projectId?: string
  projectName?: string
  projectPath?: string
  taskStatus?: BackgroundTaskStatus
  taskStartedAt?: string
  taskFinishedAt?: string
}

export type BackgroundTask = {
  sessionId: string
  agent: Agent
  scope: ChatScope
  project?: ProjectInfo
  title: string
  createdAt?: string
  status: BackgroundTaskStatus
  startedAt?: string
  finishedAt?: string
  unsubscribe: () => void
}

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
}

type UsageLike = Partial<typeof EMPTY_USAGE> & {
  cost?: Partial<typeof EMPTY_USAGE.cost>
}

export function calculateUsage(messages: Array<{ role: string; usage?: UsageLike }>) {
  return messages.reduce(
    (usage, message) => {
      if (message.role !== 'assistant' || !message.usage) return usage
      usage.input += message.usage.input ?? 0
      usage.output += message.usage.output ?? 0
      usage.cacheRead += message.usage.cacheRead ?? 0
      usage.cacheWrite += message.usage.cacheWrite ?? 0
      usage.totalTokens += message.usage.totalTokens ?? 0
      usage.cost.input += message.usage.cost?.input ?? 0
      usage.cost.output += message.usage.cost?.output ?? 0
      usage.cost.cacheRead += message.usage.cost?.cacheRead ?? 0
      usage.cost.cacheWrite += message.usage.cost?.cacheWrite ?? 0
      usage.cost.total += message.usage.cost?.total ?? 0
      return usage
    },
    structuredClone(EMPTY_USAGE),
  )
}

export function sessionScope(
  session: QuickForgeSessionMetadata | QuickForgeSessionData | null | undefined,
): ChatScope {
  return session?.scope === 'project' ? 'project' : 'global'
}

export function sessionTitle(title: string) {
  return title === 'New chat' ? t('newChat') : title
}
