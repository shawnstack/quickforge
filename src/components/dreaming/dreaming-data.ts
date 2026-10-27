import { t } from '@/lib/i18n'

export type DreamingTrigger = 'schedule' | 'manual'
export type DreamingRunStatus = 'running' | 'succeeded' | 'failed' | 'skipped'
export type MemoryKind = 'fact' | 'preference' | 'experience' | 'pitfall' | 'decision'
export type MemoryStatus = 'active' | 'superseded' | 'retired'

export type DreamingSettings = {
  enabled: boolean
  scheduleEnabled: boolean
  executeTime: string
  /** Pinned model reference, or null to follow the chat model. */
  modelRef: { source: string; providerId?: string; modelId?: string } | null
  allowSensitive: boolean
  contentLanguage: 'auto' | 'zh' | 'en'
  nextRunAt: number | null
  lastRunAt: number | null
}

export type DreamingRunOperation = {
  action: string
  phase: 'applied' | 'rejected' | 'decayed'
  id?: string
  kind?: string | null
  scope?: string | null
  content?: string | null
  reason?: string | null
  targetId?: string | null
  replacementId?: string
  replacementContent?: string | null
}

export type DreamingRunSession = {
  sessionId: string
  projectId: string
  title: string
  updatedAt: number
  messageCount: number
  chars: number
  preview: string
}

export type DreamingRun = {
  id: string
  trigger: DreamingTrigger
  status: DreamingRunStatus
  modelLabel: string | null
  inputChars: number
  sessions: DreamingRunSession[]
  rawResponse: string | null
  contentLanguage: 'zh' | 'en' | null
  periodFrom: number
  periodTo: number
  sessionCount: number
  createdCount: number
  updatedCount: number
  retiredCount: number
  rejectedCount: number
  summary: string | null
  operations: DreamingRunOperation[]
  error: string | null
  startedAt: number
  finishedAt: number | null
  durationMs: number | null
}

export type DreamingMemory = {
  id: string
  scope: 'global' | 'project'
  projectId: string
  kind: MemoryKind
  content: string
  evidence: { sessionId: string; seq: number | null; note: string }[]
  confidence: number
  strength: number
  status: MemoryStatus
  supersededBy: string | null
  createdAt: number
  updatedAt: number
  lastRecalledAt: number | null
  recallCount: number
}

export type DreamingModelOption = {
  id: string
  provider: string
  name: string
  ref: { source: string; providerId?: string; modelId?: string } | null
}

export type DreamingEffectiveModel = {
  /** "provider/model" of the model a run would use right now, or null. */
  effective: string | null
  /** explicit = pinned; active = follows the last chat model; catalog = first entry; none = no model. */
  source: 'explicit' | 'active' | 'catalog' | 'none'
  available: DreamingModelOption[]
}

export type DreamingOverview = {
  settings: DreamingSettings
  /** Optional because a server older than the model-picker feature omits it;
   *  the page must degrade to "no model info" instead of crashing. */
  model?: DreamingEffectiveModel
  running: boolean
  nextRunAt: number | null
  lastRun: DreamingRun | null
  counts: { active: number; retired: number; superseded: number; runs: number }
  memoryDocument: { hasAutoSection: boolean; manual: string }
}

export type DreamingRunPage = { runs: DreamingRun[]; page: number; pageSize: number; total: number }
export type DreamingMemoryPage = { memories: DreamingMemory[]; page: number; pageSize: number; total: number }

export async function requestDreamingJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error((payload as { error?: string } | null)?.error || t('requestFailed'))
  return payload as T
}

export function fetchDreamingOverview(): Promise<DreamingOverview> {
  return requestDreamingJson<DreamingOverview>('/api/dreaming')
}

export function saveDreamingSettings(patch: Partial<DreamingSettings>): Promise<DreamingSettings> {
  return requestDreamingJson<DreamingSettings>('/api/dreaming/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

export function triggerDreamingRun(): Promise<{ skipped: boolean; reason?: string; run: DreamingRun | null }> {
  return requestDreamingJson('/api/dreaming/run', { method: 'POST' })
}

export function fetchDreamingRuns(page: number, pageSize: number): Promise<DreamingRunPage> {
  return requestDreamingJson<DreamingRunPage>(`/api/dreaming/runs?page=${page}&pageSize=${pageSize}`)
}

export type DreamingRunDetail = {
  run: DreamingRun
  events: {
    id: number
    memoryId: string
    action: string
    before: DreamingMemory | null
    after: DreamingMemory | null
    runId: string | null
    ts: number
  }[]
  memories: Record<string, DreamingMemory>
}

export function fetchDreamingRun(id: string): Promise<DreamingRunDetail> {
  return requestDreamingJson<DreamingRunDetail>(`/api/dreaming/runs/${encodeURIComponent(id)}`)
}

export function fetchDreamingMemories(params: {
  query?: string
  kind?: string
  status?: string
  page?: number
  pageSize?: number
}): Promise<DreamingMemoryPage> {
  const search = new URLSearchParams()
  search.set('page', String(params.page ?? 1))
  search.set('pageSize', String(params.pageSize ?? 20))
  if (params.query?.trim()) search.set('query', params.query.trim())
  if (params.kind) search.set('kind', params.kind)
  if (params.status) search.set('status', params.status)
  return requestDreamingJson<DreamingMemoryPage>(`/api/dreaming/memories?${search.toString()}`)
}

export function retireDreamingMemory(id: string): Promise<{ memory: DreamingMemory }> {
  return requestDreamingJson(`/api/dreaming/memories/${encodeURIComponent(id)}/retire`, { method: 'POST' })
}

/** Stable select value for a model reference ("follow chat" is the empty string). */
export function modelRefKey(ref: DreamingSettings['modelRef'] | null | undefined): string {
  if (!ref) return ''
  if (ref.source === 'custom') return `custom::${ref.providerId ?? ''}::${ref.modelId ?? ''}`
  return `${ref.source}::${(ref as { provider?: string }).provider ?? ''}::${ref.modelId ?? ''}`
}

export function formatDreamingTimestamp(value: number | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

export function formatDreamingDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value < 1000) return `${value} ms`
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`
}
