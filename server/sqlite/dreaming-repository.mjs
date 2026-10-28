import { randomUUID } from 'node:crypto'
import { getSqliteStorage } from './database.mjs'

/**
 * Dreaming keeps exactly one piece of relational state: the run log.
 *
 * The memory itself is a notes block inside MEMORY.md, owned and rewritten by the
 * model on every pass. There is no `memories` table, no FTS index, no per-entry
 * audit and no vectors — see docs/architecture/dreaming-memory.zh-CN.md. What a
 * run still needs to persist is "when did it last succeed, what did it read, what
 * did it change", because that is what the settings page shows and what the
 * watermark for the next window is computed from.
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
  // Older rows stored an operation array; the current shape is a line diff. Both
  // are normalized here so the page never has to branch on the run's age.
  const rawOperations = JSON.parse(row.operations_json ?? '[]')
  const operations = Array.isArray(rawOperations) || !rawOperations || typeof rawOperations !== 'object'
    ? { added: [], removed: [], dropped: [], notesAfter: null }
    : {
        added: Array.isArray(rawOperations.added) ? rawOperations.added : [],
        removed: Array.isArray(rawOperations.removed) ? rawOperations.removed : [],
        dropped: Array.isArray(rawOperations.dropped) ? rawOperations.dropped : [],
        // Full notes list at the end of that run. Missing on runs written before
        // this field existed, which is why restore checks for it explicitly.
        notesAfter: Array.isArray(rawOperations.notesAfter) ? rawOperations.notesAfter : null,
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
    // `{ added: string[], removed: string[], dropped: [...] }` for notes runs.
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

  /**
   * Recall feedback. Keyed by the caller-supplied note id (hash of the text), so
   * this table never has to know what a note is — it only counts.
   */
  function recordNoteRecall(notes, now) {
    const entries = (Array.isArray(notes) ? notes : []).filter((note) => note?.id && note?.text)
    if (entries.length === 0) return 0
    const statement = handle.prepare(`INSERT INTO dreaming_note_stats (
        note_id, note_text, recall_count, last_recalled_at, created_at, updated_at
      ) VALUES (?, ?, 1, ?, ?, ?)
      ON CONFLICT(note_id) DO UPDATE SET
        note_text = excluded.note_text,
        recall_count = dreaming_note_stats.recall_count + 1,
        last_recalled_at = excluded.last_recalled_at`)
    for (const note of entries) statement.run(note.id, note.text, now, now, now)
    return entries.length
  }

  function listNoteStats() {
    const rows = handle.prepare('SELECT note_id, note_text, recall_count, last_recalled_at, created_at FROM dreaming_note_stats').all()
    const stats = new Map()
    for (const row of rows) {
      stats.set(row.note_id, {
        text: row.note_text,
        recallCount: Number(row.recall_count),
        lastRecalledAt: row.last_recalled_at === null ? null : Number(row.last_recalled_at),
        createdAt: Number(row.created_at),
      })
    }
    return stats
  }

  /**
   * Keep the stats table exactly in step with the notes file: new notes get a row
   * (so their age is known), vanished notes lose theirs (so a re-added wording
   * starts clean instead of inheriting an old count).
   */
  function syncNoteStats(notes, now) {
    const entries = (Array.isArray(notes) ? notes : []).filter((note) => note?.id && note?.text)
    const insert = handle.prepare('INSERT OR IGNORE INTO dreaming_note_stats (note_id, note_text, recall_count, created_at, updated_at) VALUES (?, ?, 0, ?, ?)')
    for (const note of entries) insert.run(note.id, note.text, now, now)
    if (entries.length === 0) {
      handle.prepare('DELETE FROM dreaming_note_stats').run()
      return { kept: 0, removed: 0 }
    }
    const placeholders = entries.map(() => '?').join(', ')
    const removed = handle.prepare(`DELETE FROM dreaming_note_stats WHERE note_id NOT IN (${placeholders})`)
      .run(...entries.map((note) => note.id))
    return { kept: entries.length, removed: Number(removed.changes ?? 0) }
  }

  function deleteNoteStat(noteId) {
    handle.prepare('DELETE FROM dreaming_note_stats WHERE note_id = ?').run(String(noteId))
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
    recordNoteRecall,
    listNoteStats,
    syncNoteStats,
    deleteNoteStat,
    createRun,
    finishRun,
    findRun,
    listRuns,
    countRuns,
    latestSucceededPeriodTo,
    latestRun,
  }
}
