import { createHash, randomUUID } from 'node:crypto'
import { getSqliteStorage } from './database.mjs'

export const MEMORY_KINDS = Object.freeze(['fact', 'preference', 'experience', 'pitfall', 'decision'])
export const MEMORY_STATUSES = Object.freeze(['active', 'superseded', 'retired'])
export const DREAMING_TRIGGERS = Object.freeze(['schedule', 'manual'])
export const DREAMING_STATUSES = Object.freeze(['running', 'succeeded', 'failed', 'skipped'])

const KIND_SET = new Set(MEMORY_KINDS)
const STATUS_SET = new Set(MEMORY_STATUSES)
const TRIGGER_SET = new Set(DREAMING_TRIGGERS)
const RUN_STATUS_SET = new Set(DREAMING_STATUSES)

const MEMORY_COLUMNS = `
  id, scope, project_id, kind, content, fingerprint, evidence_json, confidence, strength,
  status, superseded_by, source_run_id, created_at, updated_at, last_recalled_at, recall_count
`

// The FTS table also has a `content` column, so joined queries must qualify every
// memory column or SQLite reports "ambiguous column name: content".
const MEMORY_COLUMNS_QUALIFIED = MEMORY_COLUMNS
  .split(',')
  .map((column) => column.trim())
  .filter(Boolean)
  .map((column) => `m.${column}`)
  .join(', ')

function storage() {
  return getSqliteStorage()
}

function normalizeContent(content) {
  return String(content ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Dedupe key. Whitespace, case and full-width/half-width punctuation differences
 * must not create a second row for the same fact, so normalize before hashing.
 */
export function memoryFingerprint(content) {
  const normalized = normalizeContent(content).toLowerCase()
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}

function bucket(scope, projectId) {
  const normalizedScope = scope === 'project' ? 'project' : 'global'
  const normalizedProjectId = normalizedScope === 'project' ? String(projectId || '') : ''
  if (normalizedScope === 'project' && !normalizedProjectId) throw new TypeError('project scope requires projectId')
  return { scope: normalizedScope, projectId: normalizedProjectId }
}

function toMemory(row) {
  if (!row) return null
  return {
    id: row.id,
    scope: row.scope,
    projectId: row.project_id,
    kind: row.kind,
    content: row.content,
    fingerprint: row.fingerprint,
    evidence: JSON.parse(row.evidence_json),
    confidence: Number(row.confidence),
    strength: Number(row.strength),
    status: row.status,
    supersededBy: row.superseded_by ?? null,
    sourceRunId: row.source_run_id ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastRecalledAt: row.last_recalled_at === null ? null : Number(row.last_recalled_at),
    recallCount: Number(row.recall_count),
  }
}

function toRun(row) {
  if (!row) return null
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
    operations: JSON.parse(row.operations_json),
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

  function findById(id) {
    return toMemory(handle.prepare(`SELECT ${MEMORY_COLUMNS} FROM memories WHERE id = ?`).get(String(id)))
  }

  function findByFingerprint(scope, projectId, fingerprint) {
    const target = bucket(scope, projectId)
    return toMemory(handle.prepare(`SELECT ${MEMORY_COLUMNS} FROM memories
      WHERE scope = ? AND project_id = ? AND fingerprint = ?`).get(target.scope, target.projectId, fingerprint))
  }

  function listMemories({ scope = null, projectId = null, kind = null, status = 'active', query = '', limit = 50, offset = 0 } = {}) {
    const where = []
    const params = []
    if (scope) {
      const target = bucket(scope, projectId)
      where.push('m.scope = ?', 'm.project_id = ?')
      params.push(target.scope, target.projectId)
    }
    if (kind) {
      if (!KIND_SET.has(kind)) throw new TypeError(`Unknown memory kind: ${kind}`)
      where.push('m.kind = ?')
      params.push(kind)
    }
    if (status && status !== 'any') {
      if (!STATUS_SET.has(status)) throw new TypeError(`Unknown memory status: ${status}`)
      where.push('m.status = ?')
      params.push(status)
    }
    const normalizedQuery = String(query || '').trim()
    // The trigram tokenizer cannot match fewer than 3 characters, so short
    // queries (very common in Chinese, e.g. "发布") fall back to a LIKE scan.
    // The table stays small enough for that to be cheap.
    const useFts = normalizedQuery.length >= 3
    let sql
    if (normalizedQuery && useFts) {
      where.push('m.rowid IN (SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?)')
      params.push(`"${normalizedQuery.replace(/"/g, '""')}"`)
      sql = `SELECT ${MEMORY_COLUMNS_QUALIFIED}, bm25(memories_fts) AS rank
        FROM memories m JOIN memories_fts ON memories_fts.rowid = m.rowid
        WHERE ${where.join(' AND ')}
        ORDER BY rank ASC, m.strength DESC
        LIMIT ? OFFSET ?`
    } else if (normalizedQuery) {
      where.push('m.content LIKE ?')
      params.push(`%${normalizedQuery}%`)
      sql = `SELECT ${MEMORY_COLUMNS} FROM memories m
        WHERE ${where.join(' AND ')}
        ORDER BY m.strength DESC, m.updated_at DESC
        LIMIT ? OFFSET ?`
    } else {
      sql = `SELECT ${MEMORY_COLUMNS} FROM memories m
        WHERE ${where.length ? where.join(' AND ') : '1 = 1'}
        ORDER BY m.strength DESC, m.updated_at DESC
        LIMIT ? OFFSET ?`
    }
    return handle.prepare(sql).all(...params, Math.max(1, Number(limit) || 50), Math.max(0, Number(offset) || 0)).map(toMemory)
  }

  function countMemories({ status = 'active' } = {}) {
    const row = status && status !== 'any'
      ? handle.prepare('SELECT COUNT(*) AS count FROM memories WHERE status = ?').get(status)
      : handle.prepare('SELECT COUNT(*) AS count FROM memories').get()
    return Number(row.count)
  }

  /**
   * Strongest active memories across every project. Used to render the
   * MEMORY.md auto section, which is a single global document and therefore
   * cannot be scoped to one project.
   */
  function listStrongestAcrossProjects({ limit = 36 } = {}) {
    return handle.prepare(`SELECT ${MEMORY_COLUMNS} FROM memories
      WHERE status = 'active'
      ORDER BY strength DESC, updated_at DESC
      LIMIT ?`)
      .all(Math.max(1, Number(limit) || 36))
      .map(toMemory)
  }

  /**
   * Strongest active memories for system-prompt injection: project scope first
   * (it is the more specific instruction), then global.
   */
  function selectForPrompt({ projectId = null, projectLimit = 8, globalLimit = 3 } = {}) {
    const projectMemories = projectId
      ? listMemories({ scope: 'project', projectId, limit: projectLimit })
      : []
    const globalMemories = listMemories({ scope: 'global', limit: globalLimit })
    return [...projectMemories, ...globalMemories]
  }

  function insertMemory({ scope, projectId, kind, content, evidence, confidence, strength, sourceRunId, now }) {
    const target = bucket(scope, projectId)
    if (!KIND_SET.has(kind)) throw new TypeError(`Unknown memory kind: ${kind}`)
    const normalized = normalizeContent(content)
    if (!normalized) throw new TypeError('memory content must not be empty')
    const id = `mem_${randomUUID()}`
    const fingerprint = memoryFingerprint(normalized)
    handle.prepare(`INSERT INTO memories (
        id, scope, project_id, kind, content, fingerprint, evidence_json, confidence, strength,
        status, superseded_by, source_run_id, created_at, updated_at, last_recalled_at, recall_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, NULL, 0)`)
      .run(
        id,
        target.scope,
        target.projectId,
        kind,
        normalized,
        fingerprint,
        JSON.stringify(evidence ?? []),
        Math.min(1, Math.max(0, Number(confidence) || 0)),
        Math.max(0, Number(strength) || 1),
        sourceRunId ?? null,
        now,
        now,
      )
    handle.prepare('INSERT INTO memories_fts (rowid, content) SELECT rowid, content FROM memories WHERE id = ?').run(id)
    return findById(id)
  }

  function updateMemory(id, patch, now) {
    const current = findById(id)
    if (!current) throw new TypeError(`Unknown memory id: ${id}`)
    const next = {
      kind: patch.kind && KIND_SET.has(patch.kind) ? patch.kind : current.kind,
      content: patch.content === undefined ? current.content : normalizeContent(patch.content),
      confidence: patch.confidence === undefined ? current.confidence : Math.min(1, Math.max(0, Number(patch.confidence) || 0)),
      strength: patch.strength === undefined ? current.strength : Math.max(0, Number(patch.strength)),
    }
    if (!next.content) throw new TypeError('memory content must not be empty')
    handle.prepare(`UPDATE memories
      SET kind = ?, content = ?, fingerprint = ?, confidence = ?, strength = ?, updated_at = ?
      WHERE id = ?`)
      .run(next.kind, next.content, memoryFingerprint(next.content), next.confidence, next.strength, now, id)
    handle.prepare('DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)').run(id)
    handle.prepare('INSERT INTO memories_fts (rowid, content) SELECT rowid, content FROM memories WHERE id = ?').run(id)
    return findById(id)
  }

  function setStatus(id, status, { supersededBy = null, now }) {
    if (!STATUS_SET.has(status)) throw new TypeError(`Unknown memory status: ${status}`)
    handle.prepare('UPDATE memories SET status = ?, superseded_by = ?, updated_at = ? WHERE id = ?')
      .run(status, supersededBy, now, String(id))
    return findById(id)
  }

  function recordRecall(ids, now, { strengthGain = 0.2 } = {}) {
    if (!Array.isArray(ids) || ids.length === 0) return 0
    const statement = handle.prepare(`UPDATE memories
      SET recall_count = recall_count + 1, last_recalled_at = ?, strength = strength + ?
      WHERE id = ? AND status = 'active'`)
    for (const id of ids) statement.run(now, strengthGain, String(id))
    return ids.length
  }

  /**
   * Strength/confidence decay sweep. Retirement needs all three weak signals at
   * once (low strength, low confidence, not recalled recently) so a single
   * noisy run can never drop a memory by itself.
   */
  function retireWeakMemories({ now, minStrength = 1, minConfidence = 0.5, staleBefore, limit = 50 } = {}) {
    const rows = handle.prepare(`SELECT ${MEMORY_COLUMNS} FROM memories
      WHERE status = 'active'
        AND strength < ?
        AND confidence < ?
        AND (last_recalled_at IS NULL OR last_recalled_at < ?)
      ORDER BY strength ASC, updated_at ASC
      LIMIT ?`).all(minStrength, minConfidence, staleBefore, limit)
    const retired = []
    for (const row of rows) {
      setStatus(row.id, 'retired', { now })
      retired.push(row.id)
    }
    return retired
  }

  function logEvent({ memoryId, action, before = null, after = null, runId = null, now }) {
    handle.prepare(`INSERT INTO memory_events (memory_id, action, before_json, after_json, run_id, ts)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(String(memoryId), String(action), before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), runId, now)
  }

  function listEvents(memoryId, limit = 50) {
    return handle.prepare(`SELECT id, memory_id, action, before_json, after_json, run_id, ts
      FROM memory_events WHERE memory_id = ? ORDER BY ts DESC, id DESC LIMIT ?`)
      .all(String(memoryId), Math.max(1, Number(limit) || 50))
      .map((row) => ({
        id: Number(row.id),
        memoryId: row.memory_id,
        action: row.action,
        before: row.before_json ? JSON.parse(row.before_json) : null,
        after: row.after_json ? JSON.parse(row.after_json) : null,
        runId: row.run_id ?? null,
        ts: Number(row.ts),
      }))
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
    findById,
    findByFingerprint,
    listMemories,
    listStrongestAcrossProjects,
    countMemories,
    selectForPrompt,
    insertMemory,
    updateMemory,
    setStatus,
    recordRecall,
    retireWeakMemories,
    logEvent,
    listEvents,
    createRun,
    finishRun,
    findRun,
    listRuns,
    countRuns,
    latestSucceededPeriodTo,
    latestRun,
  }
}
