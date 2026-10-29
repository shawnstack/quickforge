import { atomicUpdate, readStore } from '../storage.mjs'

export const DREAMING_SETTINGS_KEY = 'dreaming-settings'

/**
 * Dreaming is an opt-in background job: it spends tokens while the user is not
 * watching, so the default is off. `allowSensitive` defaults on because the
 * user asked for a fully automatic pipeline; the settings page carries the
 * one-time warning instead of a per-run confirmation.
 */
export const DEFAULT_DREAMING_SETTINGS = Object.freeze({
  // Enabling Dreaming means "run daily at executeTime": there is no separate
  // scheduling switch, and "process now" is a manual trigger.
  enabled: false,
  executeTime: '03:00',
  modelRef: null,
  allowSensitive: true,
  // 'auto' detects the language from the user turns of the transcript. 'zh'/'en'
  // pin it, which is the escape hatch when detection picks the wrong side of a
  // mixed-language history.
  contentLanguage: 'auto',
  // Pruning thresholds. `pruneMinNotes` still only governs the "deletion
  // candidates" section of the prompt: on a short list every note looks unused,
  // so proposing deletions there would be noise. `pruneUnusedDays` and
  // `pruneMaxRecalls` decide what counts as stale.
  pruneMinNotes: 40,
  pruneUnusedDays: 60,
  pruneMaxRecalls: 0,
  // Destructive and irreversible in the file itself (only a run snapshot can
  // bring the notes back), so it stays off until the user asks for it.
  pruneStaleNotes: false,
  nextRunAt: null,
  lastRunAt: null,
})

const CONTENT_LANGUAGES = new Set(['auto', 'zh', 'en'])

function normalizeContentLanguage(value) {
  return CONTENT_LANGUAGES.has(value) ? value : DEFAULT_DREAMING_SETTINGS.contentLanguage
}

function normalizeExecuteTime(value) {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(String(value || '').trim())
  if (!match) return DEFAULT_DREAMING_SETTINGS.executeTime
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return DEFAULT_DREAMING_SETTINGS.executeTime
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function normalizeModelRef(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

function normalizeTimestamp(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

export function normalizeDreamingSettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    enabled: source.enabled === true,
    executeTime: normalizeExecuteTime(source.executeTime),
    modelRef: normalizeModelRef(source.modelRef),
    allowSensitive: source.allowSensitive !== false,
    contentLanguage: normalizeContentLanguage(source.contentLanguage),
    pruneMinNotes: clampNumber(source.pruneMinNotes, DEFAULT_DREAMING_SETTINGS.pruneMinNotes, 1, 500),
    pruneUnusedDays: clampNumber(source.pruneUnusedDays, DEFAULT_DREAMING_SETTINGS.pruneUnusedDays, 1, 3650),
    pruneMaxRecalls: clampNumber(source.pruneMaxRecalls, DEFAULT_DREAMING_SETTINGS.pruneMaxRecalls, 0, 1000),
    pruneStaleNotes: source.pruneStaleNotes === true,
    nextRunAt: normalizeTimestamp(source.nextRunAt),
    lastRunAt: normalizeTimestamp(source.lastRunAt),
  }
}

export async function readDreamingSettings() {
  const settings = await readStore('settings')
  return normalizeDreamingSettings(settings?.[DREAMING_SETTINGS_KEY])
}

/**
 * Partial update on top of the normalized current value. `nextRunAt`/`lastRunAt`
 * are written by the runner, so they must survive a settings-page save that
 * only carries the user-visible fields.
 */
export async function saveDreamingSettings(patch) {
  let saved = null
  await atomicUpdate('settings', (data) => {
    const current = normalizeDreamingSettings(data?.[DREAMING_SETTINGS_KEY])
    saved = normalizeDreamingSettings({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) })
    return { ...data, [DREAMING_SETTINGS_KEY]: saved }
  })
  return saved
}
