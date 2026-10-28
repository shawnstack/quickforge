import { t } from '@/lib/i18n'

export type DreamingTrigger = 'schedule' | 'manual'
export type DreamingRunStatus = 'running' | 'succeeded' | 'failed' | 'skipped'
export type MemoryKind = 'fact' | 'preference' | 'experience' | 'pitfall' | 'decision'

export type DreamingSettings = {
  enabled: boolean
  executeTime: string
  /** Pinned model reference, or null to follow the chat model. */
  modelRef: { source: string; providerId?: string; modelId?: string } | null
  allowSensitive: boolean
  contentLanguage: 'auto' | 'zh' | 'en'
  nextRunAt: number | null
  lastRunAt: number | null
}

/**
 * What a run changed in the notes block.
 *
 * There are no per-entry rows any more, so "what did it learn / what did it
 * forget" is recorded as a line diff. `dropped` explains lines the code refused
 * (sensitive content, or over the size budget).
 */
export type DreamingRunDiff = {
  added: string[]
  removed: string[]
  dropped?: { reason: string; content: string }[]
  /** Full notes list at the end of that run; null on runs recorded before it. */
  notesAfter?: string[] | null
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
  operations: DreamingRunDiff
  error: string | null
  startedAt: number
  finishedAt: number | null
  durationMs: number | null
}

/** One bullet of the Dreaming notes block in MEMORY.md. */
export type DreamingNote = {
  id: string
  kind: MemoryKind | null
  text: string
  /** Where it first appeared, resolved from recent run snapshots. */
  firstSeen?: { runId: string; at: number } | null
  /** How many times recall_experience actually returned this note. */
  recallCount?: number
  lastRecalledAt?: number | null
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
  counts: { notes: number; runs: number }
  memoryDocument: { dreamingNotes: boolean; manual: string }
}

export type DreamingRunPage = { runs: DreamingRun[]; page: number; pageSize: number; total: number }
export type DreamingNotePage = { notes: DreamingNote[]; page: number; pageSize: number; total: number; hasNotes: boolean }

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
 * Write a past run's snapshot back into DREAMING.md. This is the escape hatch for
 * memory drift: the notes are the model's output, so "undo that run" has to be a
 * real operation rather than a manual file edit.
 */
export function restoreDreamingRun(id: string): Promise<{ restored: number; changed: boolean; run: DreamingRun }> {
  return requestDreamingJson(`/api/dreaming/runs/${encodeURIComponent(id)}/restore`, { method: 'POST' })
}

/**
 * The notes are read-only in the UI: they are the model's output, and the only
 * supported way to change them is the next Dreaming run (or editing MEMORY.md's
 * manual section by hand, which is a different block).
 */
export function fetchDreamingNotes(params: {
  query?: string
  kind?: string
  page?: number
  pageSize?: number
}): Promise<DreamingNotePage> {
  const search = new URLSearchParams()
  search.set('page', String(params.page ?? 1))
  search.set('pageSize', String(params.pageSize ?? 50))
  if (params.query?.trim()) search.set('query', params.query.trim())
  if (params.kind) search.set('kind', params.kind)
  return requestDreamingJson<DreamingNotePage>(`/api/dreaming/notes?${search.toString()}`)
}

/**
 * Delete one note. The notes file is the only store, so this is a real edit of the
 * file — the next run sees the shortened list and cannot bring the line back.
 */
export function deleteDreamingNote(id: string): Promise<{ removed: number; total: number }> {
  return requestDreamingJson(`/api/dreaming/notes/${encodeURIComponent(id)}`, { method: 'DELETE' })
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
