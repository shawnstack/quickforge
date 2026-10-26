import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { ScheduleFields, ScheduleForm, ScheduleType } from '@/lib/scheduled-task-form'

export type TaskStatus = 'enabled' | 'paused' | 'running' | 'failed' | 'completed'
export type RunStatus = 'running' | 'success' | 'failed'
export type ExecutionMode = 'serial' | 'parallel'
export type ActiveTab = 'tasks' | 'history'

export type AgentProfile = {
  id: string
  name: string
  label: string
}

export type ScheduledTaskRun = {
  id: string
  status: RunStatus
  trigger?: string
  result?: string
  aiResult?: string
  inputContent?: string
  errorMessage?: string
  warning?: string
  sessionId?: string
  scheduledAt?: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
  agentId?: string | null
  agentLabel?: string | null
}

export type AnyModel = Model<Api>

export type ScheduledTask = ScheduleFields & {
  id: string
  title: string
  instruction: string
  scheduleType: ScheduleType
  scheduleRule: string
  cronExpression?: string
  status: TaskStatus
  nextRunAt: string
  lastRunAt?: string
  lastSessionId?: string
  currentRunId?: string | null
  currentRunIds?: string[]
  createdAt: string
  runs: ScheduledTaskRun[]
  projectName?: string
  projectId?: string | null
  agentId?: string | null
  executionMode?: ExecutionMode
  model?: AnyModel
  thinkingLevel?: ThinkingLevel
}

export type ScheduledTaskHistoryRun = ScheduledTaskRun & {
  taskId: string
  taskTitle: string
  scheduleRule?: string
  projectName?: string
}

export type HistoryFilters = {
  taskId: string
  status: '' | RunStatus
  trigger: '' | 'manual' | 'schedule'
  keyword: string
  startedFrom: string
  startedTo: string
  page: number
  pageSize: number
}

export type HistoryPayload = {
  runs: ScheduledTaskHistoryRun[]
  total: number
  page: number
  pageSize: number
}

export type ParsedTask = Pick<ScheduledTask, 'title' | 'instruction' | 'scheduleType' | 'scheduleRule' | 'cronExpression' | 'nextRunAt'>

export type FormState = ScheduleForm & {
  scheduleText: string
  title: string
  instruction: string
  cronExpression: string
  scheduleRule: string
  nextRunAt: string
  enabled: boolean
  agentId: string
  executionMode: ExecutionMode
}

export type ProjectOption = { id: string; name: string; path: string }

export type TaskMenuPosition = { left: number; top: number }
