/**
 * Dreaming (memory curator) — transport types and fetchers.
 *
 * The worker changed shape: instead of rewriting one bullet list, each finished
 * session gets its own agent turn that edits the working-memory folder and, when
 * warranted, promotes something into the experience library. So a run is described
 * as "what each session did", and the experience library is what you browse.
 */
import { t } from '@/lib/i18n'

export type DreamingTrigger = 'schedule' | 'manual'
export type DreamingRunStatus = 'running' | 'succeeded' | 'failed' | 'skipped'

export type DreamingModelRef = {
  source: string
  providerId?: string
  modelId?: string
  provider?: string
} | null

export type DreamingSettings = {
  enabled: boolean
  executeTime: string
  modelRef: DreamingModelRef
  allowSensitive: boolean
  contentLanguage: 'auto' | 'zh' | 'en'
  nextRunAt: number | null
  lastRunAt: number | null
}

export type MemoryScope = 'working' | 'experience'

/** One note the curator created, renamed or retired during a run. */
export type DreamingAction = {
  kind: 'write' | 'rename' | 'archive'
  scope: MemoryScope
  name: string
  title?: string
  chars?: number
  from?: string
  sessionId?: string
}

/** What one session's curator turn concluded. */
export type DreamingSessionResult = {
  ok: boolean
  sessionId: string
  reply?: string
  error?: string
  toolCalls: number
  actions: DreamingAction[]
  timedOut?: boolean
  durationMs: number
}

export type DreamingRunOperations = {
  sessions?: DreamingSessionResult[]
  actions?: DreamingAction[]
  /** Directory of the pre-run copy of both folders, or null on older runs. */
  snapshot?: string | null
  snapshotFiles?: { workingMemory: number; experiences: number } | null
  /** Set when the run stopped early, e.g. the wall-clock budget ran out. */
  stopped?: string | null
}

export type DreamingRunSession = {
  sessionId: string
  projectId: string
  title: string
  updatedAt: number
  messageCount: number
  chars: number
  correctionSignals?: number
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
  operations: DreamingRunOperations | null
  error: string | null
  startedAt: number
  finishedAt: number | null
  durationMs: number | null
}

/** One file in the experience library. */
export type DreamingExperience = {
  name: string
  title: string
  /** Front matter `description`: when someone should open this file. */
  description: string
  /** False means the procedure is special to one project and must be adapted. */
  general: boolean
  /** Marked by the curator as worth turning into an Agent Skill (a human decides). */
  candidateSkill: boolean
  chars: number
  updatedAt: number
}

export type DreamingModelOption = {
  id: string
  provider: string
  name: string
  ref: DreamingModelRef
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
  counts: { experiences: number; candidateSkills: number; runs: number }
  /** The generated index, i.e. exactly what every session's system prompt sees. */
  experienceIndex: string
  manual: string
}

export type DreamingRunPage = { runs: DreamingRun[]; page: number; pageSize: number; total: number }
export type DreamingExperiencePage = { experiences: DreamingExperience[]; index: string; archived: number }

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

export type DreamingRunDetail = { run: DreamingRun }

export function fetchDreamingRun(id: string): Promise<DreamingRunDetail> {
  return requestDreamingJson<DreamingRunDetail>(`/api/dreaming/runs/${encodeURIComponent(id)}`)
}

/**
 * Put both memory folders back the way they were before that run, from the copy
 * taken at the start of it.
 */
export function restoreDreamingRun(id: string): Promise<{
  restored: { workingMemoryFiles: number; experienceFiles: number }
  run: DreamingRun
}> {
  return requestDreamingJson(`/api/dreaming/runs/${encodeURIComponent(id)}/restore`, { method: 'POST' })
}

/**
 * The experience library, read-only here: the notes are the curator's output and
 * retiring one means archiving it, which is a file move rather than a button.
 */
export function fetchDreamingExperiences(): Promise<DreamingExperiencePage> {
  return requestDreamingJson<DreamingExperiencePage>('/api/dreaming/experiences')
}

/**
 * Reveal one experience in the system file manager — the same action the working
 * memory note list offers. The server owns the folder and validates the name, so
 * the client only ever sends a file name.
 */
export function openDreamingExperience(name: string): Promise<{ ok: boolean; name: string }> {
  return requestDreamingJson('/api/dreaming/experiences/open', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

/** Reveal the library folder itself (created on demand when it is still empty). */
export function openDreamingExperiencesFolder(): Promise<{ ok: boolean; path: string }> {
  return requestDreamingJson('/api/dreaming/experiences/open-folder', { method: 'POST' })
}

/**
 * Label for a model in the selector.
 *
 * Custom models are commonly *named* "GLM-4.6V (智谱)", i.e. the provider is
 * already part of the name. Appending it unconditionally produced
 * "GLM-4.6V (智谱) (智谱)", so only add the suffix when it is not already there.
 */
export function formatModelOptionLabel(name: string | null | undefined, provider: string | null | undefined): string {
  const modelName = String(name ?? '').trim()
  const providerName = String(provider ?? '').trim()
  if (!modelName) return providerName
  if (!providerName) return modelName
  if (modelName.toLowerCase().includes(providerName.toLowerCase())) return modelName
  return `${modelName} (${providerName})`
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
