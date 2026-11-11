import { randomUUID } from 'node:crypto'
import { getSqliteStorage } from './database.mjs'

/**
 * The only relational state here is the run log: when a pass ran, what window it
 * covered, what it read and what it changed. The notes themselves are Markdown
 * files in the notes and experience folders, so there is no content
 * table, no full-text index and no per-entry audit to keep in sync.
 */

export const DREAMING_TRIGGERS = Object.freeze(['schedule', 'manual'])
export const DREAMING_STATUSES = Object.freeze(['running', 'succeeded', 'failed', 'skipped'])

const TRIGGER_SET = new Set(DREAMING_TRIGGERS)
const RUN_STATUS_SET = new Set(DREAMING_STATUSES)

function storage() {
  return getSqliteStorage()
}

function toRun(row) {
  if (!row) return null
  // Normalize whatever shape was persisted, so the page never branches on a run's age.
  const rawOperations = JSON.parse(row.operations_json ?? '[]')
  const operations = !rawOperations || typeof rawOperations !== 'object' || Array.isArray(rawOperations)
    ? { sessions: [], actions: [], snapshot: null, snapshotFiles: null, stopped: null }
    : {
        sessions: Array.isArray(rawOperations.sessions) ? rawOperations.sessions : [],
        actions: Array.isArray(rawOperations.actions) ? rawOperations.actions : [],
        // Where the pre-run copy of both folders lives. Null on runs that predate
        // folder snapshots, which is what makes restore refuse instead of guessing.
        snapshot: typeof rawOperations.snapshot === 'string' ? rawOperations.snapshot : null,
        snapshotFiles: rawOperations.snapshotFiles && typeof rawOperations.snapshotFiles === 'object'
          ? rawOperations.snapshotFiles
          : null,
        stopped: typeof rawOperations.stopped === 'string' ? rawOperations.stopped : null,
      }
  return {
    id: row.id,
    trigger: row.trigger,
    modelLabel: row.model_label ?? null,
    inputChars: Number(row.input_chars ?? 0),
    sessions: JSON.parse(row.sessions_json ?? '[]'),
    rawResponse: row.raw_response ?? null,
    contentLanguage: row.content_language ?? null,
    status: row.status,
    periodFrom: Number(row.period_from),
    periodTo: Number(row.period_to),
    sessionCount: Number(row.session_count),
    createdCount: Number(row.created_count),
    updatedCount: Number(row.updated_count),
    retiredCount: Number(row.retired_count),
    rejectedCount: Number(row.rejected_count),
    summary: row.summary ?? null,
    operations,
    error: row.error ?? null,
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
  }
}

export function createDreamingRepository(handle = storage()) {
  if (!handle || typeof handle.prepare !== 'function' || typeof handle.transaction !== 'function') {
    throw new TypeError('Dreaming repository requires a SQLite storage handle')
  }

  function createRun({ id, trigger, periodFrom, periodTo, startedAt, modelLabel = null, inputChars = 0, sessions = null, contentLanguage = null }) {
    if (!TRIGGER_SET.has(trigger)) throw new TypeError(`Unknown dreaming trigger: ${trigger}`)
    const runId = id || `dream_${randomUUID()}`
    handle.prepare(`INSERT INTO dreaming_runs (
        id, trigger, status, period_from, period_to, started_at, model_label, input_chars, sessions_json, content_language
      ) VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        runId,
        trigger,
        periodFrom,
        periodTo,
        startedAt,
        modelLabel,
        Math.max(0, Number(inputChars) || 0),
        JSON.stringify(sessions ?? []),
        contentLanguage,
      )
    return findRun(runId)
  }

  function finishRun(id, patch) {
    if (patch.status && !RUN_STATUS_SET.has(patch.status)) throw new TypeError(`Unknown dreaming status: ${patch.status}`)
    const current = findRun(id)
    if (!current) throw new TypeError(`Unknown dreaming run: ${id}`)
    handle.prepare(`UPDATE dreaming_runs
      SET status = ?, session_count = ?, created_count = ?, updated_count = ?, retired_count = ?,
          rejected_count = ?, summary = ?, operations_json = ?, error = ?, finished_at = ?, duration_ms = ?,
          raw_response = ?, input_chars = ?, sessions_json = ?
      WHERE id = ?`).run(
      patch.status ?? current.status,
      patch.sessionCount ?? current.sessionCount,
      patch.createdCount ?? current.createdCount,
      patch.updatedCount ?? current.updatedCount,
      patch.retiredCount ?? current.retiredCount,
      patch.rejectedCount ?? current.rejectedCount,
      patch.summary ?? current.summary,
      JSON.stringify(patch.operations ?? current.operations),
      patch.error === undefined ? current.error : patch.error,
      patch.finishedAt ?? Date.now(),
      patch.durationMs ?? null,
      patch.rawResponse === undefined ? current.rawResponse : patch.rawResponse,
      patch.inputChars === undefined ? current.inputChars : Math.max(0, Number(patch.inputChars) || 0),
      JSON.stringify(patch.sessions === undefined ? current.sessions : patch.sessions),
      String(id),
    )
    return findRun(id)
  }

  function findRun(id) {
    return toRun(handle.prepare('SELECT * FROM dreaming_runs WHERE id = ?').get(String(id)))
  }

  function listRuns({ limit = 20, offset = 0 } = {}) {
    return handle.prepare('SELECT * FROM dreaming_runs ORDER BY started_at DESC LIMIT ? OFFSET ?')
      .all(Math.max(1, Number(limit) || 20), Math.max(0, Number(offset) || 0))
      .map(toRun)
  }

  function countRuns() {
    return Number(handle.prepare('SELECT COUNT(*) AS count FROM dreaming_runs').get().count)
  }

  function latestSucceededPeriodTo() {
    const row = handle.prepare(`SELECT MAX(period_to) AS period_to FROM dreaming_runs
      WHERE status IN ('succeeded', 'skipped')`).get()
    return row?.period_to === null || row?.period_to === undefined ? null : Number(row.period_to)
  }

  function latestRun() {
    return toRun(handle.prepare('SELECT * FROM dreaming_runs ORDER BY started_at DESC LIMIT 1').get())
  }

  return {
    transaction: (callback) => handle.transaction(callback),
    createRun,
    finishRun,
    findRun,
    listRuns,
    countRuns,
    latestSucceededPeriodTo,
    latestRun,
  }
}
