import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import { getConfiguredModels, initializePiStorage, loadActiveThinkingLevel, loadInitialConfiguredModel, resolveNewSessionThinkingLevel } from '@/lib/pi-chat'
import { isModelSelectable } from '@/lib/model-visibility'
import { t } from '@/lib/i18n'
import { loadModelCatalog } from '@/lib/model-reference'
import type { AgentProfile, AnyModel, HistoryFilters, HistoryPayload, ProjectOption, ScheduledTask } from './scheduled-tasks-types'

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
  return payload as T
}

export async function fetchScheduledTasks(): Promise<ScheduledTask[]> {
  const payload = await requestJson<{ tasks: ScheduledTask[] }>('/api/scheduled-tasks')
  return payload.tasks
}

export function historySearchParams(filters: HistoryFilters) {
  const params = new URLSearchParams()
  params.set('page', String(filters.page))
  params.set('pageSize', String(filters.pageSize))
  if (filters.taskId) params.set('taskId', filters.taskId)
  if (filters.status) params.set('status', filters.status)
  if (filters.trigger) params.set('trigger', filters.trigger)
  if (filters.keyword.trim()) params.set('keyword', filters.keyword.trim())
  if (filters.startedFrom) params.set('startedFrom', filters.startedFrom)
  if (filters.startedTo) params.set('startedTo', filters.startedTo)
  return params
}

export async function fetchScheduledTaskHistory(filters: HistoryFilters): Promise<HistoryPayload> {
  const params = historySearchParams(filters)
  return requestJson<HistoryPayload>(`/api/scheduled-tasks/runs?${params.toString()}`)
}

export async function fetchProjects(): Promise<ProjectOption[]> {
  const payload = await requestJson<{ project?: ProjectOption; projects: ProjectOption[] }>('/api/project')
  return payload.projects ?? []
}

export async function fetchAgentProfiles(): Promise<AgentProfile[]> {
  const payload = await requestJson<{ agents: AgentProfile[] }>('/api/agent-profiles')
  return payload.agents
}

export type ScheduledTaskModelSettings = {
  models: AnyModel[]
  selectedModel?: AnyModel
  thinkingLevel: ThinkingLevel
}

export async function fetchScheduledTaskModelSettings(): Promise<ScheduledTaskModelSettings> {
  const storage = await initializePiStorage()
  const [configuredModels, catalogModels] = await Promise.all([
    getConfiguredModels(storage),
    loadModelCatalog().catch(() => []),
  ])
  const availableModels = catalogModels.length ? catalogModels : configuredModels
  const selectableModels = availableModels.filter(isModelSelectable)
  const [activeModel, savedThinkingLevel] = await Promise.all([
    loadInitialConfiguredModel(storage),
    loadActiveThinkingLevel(storage),
  ])
  const nextModel = (activeModel && isModelSelectable(activeModel) ? activeModel : undefined) ?? selectableModels[0]
  return {
    models: availableModels,
    selectedModel: nextModel,
    thinkingLevel: resolveNewSessionThinkingLevel(nextModel, savedThinkingLevel),
  }
}
