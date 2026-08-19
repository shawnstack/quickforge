import { getSqliteStorage } from './database.mjs'

export const MAX_SCHEDULED_TASK_RUNS_PER_TASK = 200

const RUN_STATUSES = new Set(['running', 'success', 'failed'])
const RUN_TRIGGERS = new Set(['schedule', 'manual'])
const TEXT_FIELDS = Object.freeze({
  inputContent: 'input_content',
  aiResult: 'ai_result',
  result: 'result',
  errorMessage: 'error_message',
  warning: 'warning',
  sessionId: 'session_id',
  finishedAt: 'finished_at',
  agentId: 'agent_id',
  agentLabel: 'agent_label',
})
const OPTIONAL_COLUMNS = Object.freeze({
  trigger: 'trigger',
  inputContent: 'input_content',
  aiResult: 'ai_result',
  result: 'result',
  errorMessage: 'error_message',
  warning: 'warning',
  sessionId: 'session_id',
  scheduledAt: 'scheduled_at',
  finishedAt: 'finished_at',
  durationMs: 'duration_ms',
})
const STORED_FIELDS = new Set([
  'id', 'taskId', 'status', 'trigger', 'inputContent', 'aiResult', 'result', 'errorMessage',
  'warning', 'sessionId', 'scheduledAt', 'startedAt', 'finishedAt', 'durationMs', 'agentId',
  'agentLabel', 'agentSnapshot', 'legacy', 'source', 'updatedAt',
])
const FILTER_FIELDS = new Set([
  'taskId', 'taskIds', 'status', 'trigger', 'startedFrom', 'startedTo', 'keyword',
  'keywordTaskIds', 'page', 'pageSize',
])
const IMMUTABLE_UPDATE_FIELDS = new Set(['id', 'taskId', 'startedAt', 'trigger', 'scheduledAt', 'source'])
const UPDATE_FIELDS = new Set(['status', ...Object.keys(TEXT_FIELDS), 'durationMs', 'agentSnapshot', 'legacy'])

function assertStorage(storage) {
  if (!storage || typeof storage.prepare !== 'function' || typeof storage.transaction !== 'function') {
    throw new TypeError('Scheduled task runs repository requires a SQLite storage handle')
  }
  return storage
}

function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${field} must be a non-empty string`)
  return value
}

function assertNullableString(value, field) {
  if (value !== null && typeof value !== 'string') throw new TypeError(`${field} must be a string or null`)
  return value
}

function assertStatus(value) {
  if (typeof value !== 'string' || !RUN_STATUSES.has(value)) throw new TypeError('status must be running, success, or failed')
  return value
}

function assertTrigger(value, { nullable = true } = {}) {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !RUN_TRIGGERS.has(value)) throw new TypeError('trigger must be schedule, manual, or null')
  return value
}

function assertDuration(value) {
  if (value !== null && (!Number.isInteger(value) || value < 0)) throw new TypeError('durationMs must be a non-negative integer or null')
  return value
}

function assertNullablePlainObject(value, field) {
  if (value !== null && (typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)) {
    throw new TypeError(`${field} must be a plain object or null`)
  }
  return value
}

function serializeJsonObject(value, field, { nullable = true } = {}) {
  if (value === null && nullable) return null
  assertNullablePlainObject(value, field)
  try {
    const serialized = JSON.stringify(value)
    if (typeof serialized !== 'string') throw new TypeError('not serializable')
    return serialized
  } catch {
    throw new TypeError(`${field} must be JSON-serializable`)
  }
}

function cloneJsonValue(value, field) {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new TypeError('not serializable')
    return JSON.parse(serialized)
  } catch {
    throw new TypeError(`${field} must be JSON-serializable`)
  }
}

function parseJsonObject(value, fallback) {
  return value === null ? fallback : JSON.parse(value)
}

function extraFields(run) {
  const extra = {}
  for (const [field, value] of Object.entries(run)) {
    if (!STORED_FIELDS.has(field) && value !== undefined) extra[field] = cloneJsonValue(value, field)
  }
  return extra
}

function mapRow(row, { includeTaskId = false } = {}) {
  if (!row) return null
  const extra = parseJsonObject(row.extra_json, {})
  const run = {
    ...extra,
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    source: row.source,
  }
  if (includeTaskId) run.taskId = row.task_id
  for (const [field, column] of Object.entries(OPTIONAL_COLUMNS)) {
    if (row[column] !== null) run[field] = row[column]
  }
  run.agentId = row.agent_id
  run.agentLabel = row.agent_label
  run.agentSnapshot = parseJsonObject(row.agent_snapshot_json, null)
  const legacy = parseJsonObject(row.legacy_json, null)
  if (legacy !== null) run.legacy = legacy
  return run
}

function normalizeFullRun(taskId, run, { source, now = () => new Date().toISOString() } = {}) {
  assertNonEmptyString(taskId, 'taskId')
  if (!run || typeof run !== 'object' || Array.isArray(run)) throw new TypeError('run must be an object')
  const normalizedSource = assertNonEmptyString(source ?? run.source ?? 'runtime', 'source')
  const values = {
    taskId,
    id: assertNonEmptyString(run.id, 'id'),
    status: assertStatus(run.status),
    trigger: run.trigger === undefined ? null : assertTrigger(run.trigger),
    startedAt: assertNonEmptyString(run.startedAt, 'startedAt'),
    durationMs: run.durationMs === undefined ? null : assertDuration(run.durationMs),
    agentSnapshotJson: run.agentSnapshot === undefined ? null : serializeJsonObject(run.agentSnapshot, 'agentSnapshot'),
    legacyJson: run.legacy === undefined ? null : serializeJsonObject(run.legacy, 'legacy'),
    extraJson: serializeJsonObject(extraFields(run), 'extra', { nullable: false }),
    source: normalizedSource,
    updatedAt: assertNonEmptyString(run.updatedAt ?? now(), 'updatedAt'),
  }
  for (const field of Object.keys(TEXT_FIELDS)) values[field] = run[field] === undefined ? null : assertNullableString(run[field], field)
  values.scheduledAt = run.scheduledAt === undefined ? null : assertNullableString(run.scheduledAt, 'scheduledAt')
  return values
}

function normalizePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('patch must be an object')
  const entries = []
  for (const [field, value] of Object.entries(patch)) {
    if (IMMUTABLE_UPDATE_FIELDS.has(field)) throw new TypeError(`${field} cannot be updated`)
    if (!UPDATE_FIELDS.has(field)) throw new TypeError(`Unknown scheduled task run patch field: ${field}`)
    if (value === undefined) continue
    if (field === 'status') entries.push(['status', assertStatus(value)])
    else if (field === 'durationMs') entries.push(['duration_ms', assertDuration(value)])
    else if (field === 'agentSnapshot') entries.push(['agent_snapshot_json', serializeJsonObject(value, 'agentSnapshot')])
    else if (field === 'legacy') entries.push(['legacy_json', serializeJsonObject(value, 'legacy')])
    else entries.push([TEXT_FIELDS[field], assertNullableString(value, field)])
  }
  return entries
}

function parsePositiveInteger(value, fallback, max) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function parseListByTaskLimit(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_SCHEDULED_TASK_RUNS_PER_TASK) {
    throw new TypeError(`limit must be an integer between 1 and ${MAX_SCHEDULED_TASK_RUNS_PER_TASK}`)
  }
  return parsed
}

function parsePruneLimit(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_SCHEDULED_TASK_RUNS_PER_TASK) {
    throw new TypeError(`limit must be an integer between 0 and ${MAX_SCHEDULED_TASK_RUNS_PER_TASK}`)
  }
  return parsed
}

function parseOffset(value) {
  if (value === undefined) return 0
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new TypeError('offset must be a non-negative integer')
  return parsed
}

function normalizeStringIds(value, field) {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`)
  const result = [...new Set(value.map((id) => assertNonEmptyString(id, field)))]
  return result
}

function escapeLike(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function normalizeFilters(filters = {}) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new TypeError('filters must be an object')
  for (const field of Object.keys(filters)) if (!FILTER_FIELDS.has(field)) throw new TypeError(`Unknown scheduled task run filter: ${field}`)
  const normalized = {
    page: parsePositiveInteger(filters.page, 1, 100_000),
    pageSize: parsePositiveInteger(filters.pageSize, 10, 100),
  }
  if (filters.taskId !== undefined && filters.taskId !== null && filters.taskId !== '') normalized.taskId = assertNonEmptyString(filters.taskId, 'taskId')
  normalized.taskIds = normalizeStringIds(filters.taskIds, 'taskIds')
  normalized.keywordTaskIds = normalizeStringIds(filters.keywordTaskIds, 'keywordTaskIds')
  if (filters.status !== undefined && filters.status !== null && filters.status !== '') normalized.status = assertStatus(filters.status)
  if (filters.trigger !== undefined && filters.trigger !== null && filters.trigger !== '') normalized.trigger = assertTrigger(filters.trigger, { nullable: false })
  if (filters.startedFrom !== undefined && filters.startedFrom !== null && filters.startedFrom !== '') normalized.startedFrom = assertNonEmptyString(filters.startedFrom, 'startedFrom')
  if (filters.startedTo !== undefined && filters.startedTo !== null && filters.startedTo !== '') normalized.startedTo = assertNonEmptyString(filters.startedTo, 'startedTo')
  if (filters.keyword !== undefined && filters.keyword !== null) {
    if (typeof filters.keyword !== 'string') throw new TypeError('keyword must be a string')
    const keyword = filters.keyword.trim()
    if (keyword) normalized.keyword = keyword
  }
  return normalized
}

function inClause(column, values, clauses, parameters) {
  if (values === undefined) return
  if (values.length === 0) {
    clauses.push('0 = 1')
    return
  }
  clauses.push(`${column} IN (${values.map(() => '?').join(', ')})`)
  parameters.push(...values)
}

function buildWhere(filters) {
  const clauses = []
  const parameters = []
  if (filters.taskId) {
    clauses.push('task_id = ?')
    parameters.push(filters.taskId)
  }
  inClause('task_id', filters.taskIds, clauses, parameters)
  if (filters.status) {
    clauses.push('status = ?')
    parameters.push(filters.status)
  }
  if (filters.trigger) {
    clauses.push('trigger = ?')
    parameters.push(filters.trigger)
  }
  if (filters.startedFrom) {
    clauses.push('started_at >= ?')
    parameters.push(filters.startedFrom)
  }
  if (filters.startedTo) {
    clauses.push('started_at <= ?')
    parameters.push(filters.startedTo)
  }
  if (filters.keyword) {
    const pattern = `%${escapeLike(filters.keyword)}%`
    const keywordClauses = [
      "input_content LIKE ? ESCAPE '\\' COLLATE NOCASE",
      "ai_result LIKE ? ESCAPE '\\' COLLATE NOCASE",
      "result LIKE ? ESCAPE '\\' COLLATE NOCASE",
      "error_message LIKE ? ESCAPE '\\' COLLATE NOCASE",
    ]
    const keywordParameters = [pattern, pattern, pattern, pattern]
    if (filters.keywordTaskIds?.length) {
      keywordClauses.unshift(`task_id IN (${filters.keywordTaskIds.map(() => '?').join(', ')})`)
      keywordParameters.unshift(...filters.keywordTaskIds)
    }
    clauses.push(`(${keywordClauses.join(' OR ')})`)
    parameters.push(...keywordParameters)
  }
  return { sql: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '', parameters }
}

const INSERT_COLUMNS = `
  task_id, id, status, trigger, input_content, ai_result, result, error_message,
  warning, session_id, scheduled_at, started_at, finished_at, duration_ms,
  agent_id, agent_label, agent_snapshot_json, extra_json, legacy_json, source, updated_at
`
const INSERT_PLACEHOLDERS = new Array(21).fill('?').join(', ')

function insertParameters(value) {
  return [
    value.taskId, value.id, value.status, value.trigger, value.inputContent, value.aiResult,
    value.result, value.errorMessage, value.warning, value.sessionId, value.scheduledAt,
    value.startedAt, value.finishedAt, value.durationMs, value.agentId, value.agentLabel,
    value.agentSnapshotJson, value.extraJson, value.legacyJson, value.source, value.updatedAt,
  ]
}

export function createScheduledTaskRunsRepository(storageHandle, options = {}) {
  const storage = assertStorage(storageHandle ?? getSqliteStorage())
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString()

  function getRow(taskId, runId, database = storage) {
    assertNonEmptyString(taskId, 'taskId')
    assertNonEmptyString(runId, 'runId')
    return database.prepare('SELECT * FROM scheduled_task_runs WHERE task_id = ? AND id = ?').get(taskId, runId)
  }

  // The optional statement lets the cutover replaceAll reuse one precompiled insert.
  function insert(database, value, statement = null) {
    const insertStatement = statement ?? database.prepare(`INSERT INTO scheduled_task_runs (${INSERT_COLUMNS}) VALUES (${INSERT_PLACEHOLDERS})`)
    insertStatement.run(...insertParameters(value))
  }

  function upsert(database, value) {
    database.prepare(`
      INSERT INTO scheduled_task_runs (${INSERT_COLUMNS}) VALUES (${INSERT_PLACEHOLDERS})
      ON CONFLICT(task_id, id) DO UPDATE SET
        status = excluded.status,
        trigger = excluded.trigger,
        input_content = excluded.input_content,
        ai_result = excluded.ai_result,
        result = excluded.result,
        error_message = excluded.error_message,
        warning = excluded.warning,
        session_id = excluded.session_id,
        scheduled_at = excluded.scheduled_at,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        duration_ms = excluded.duration_ms,
        agent_id = excluded.agent_id,
        agent_label = excluded.agent_label,
        agent_snapshot_json = excluded.agent_snapshot_json,
        extra_json = excluded.extra_json,
        legacy_json = excluded.legacy_json,
        source = excluded.source,
        updated_at = excluded.updated_at
    `).run(...insertParameters(value))
  }

  function pruneByTask(taskId, limit = MAX_SCHEDULED_TASK_RUNS_PER_TASK, database = storage) {
    assertNonEmptyString(taskId, 'taskId')
    const normalizedLimit = parsePruneLimit(limit)
    return Number(database.prepare(`
      DELETE FROM scheduled_task_runs
      WHERE task_id = ? AND id IN (
        SELECT id FROM scheduled_task_runs
        WHERE task_id = ?
        ORDER BY started_at DESC, id DESC
        LIMIT -1 OFFSET ?
      )
    `).run(taskId, taskId, normalizedLimit).changes)
  }

  return Object.freeze({
    create(taskId, run, createOptions = {}) {
      const value = normalizeFullRun(taskId, run, { source: createOptions.source, now })
      return storage.transaction((database) => {
        insert(database, value)
        const inserted = getRow(value.taskId, value.id, database)
        pruneByTask(value.taskId, MAX_SCHEDULED_TASK_RUNS_PER_TASK, database)
        return mapRow(inserted)
      })
    },

    upsert(taskId, run, upsertOptions = {}) {
      const value = normalizeFullRun(taskId, run, { source: upsertOptions.source, now })
      return storage.transaction((database) => {
        upsert(database, value)
        pruneByTask(value.taskId, MAX_SCHEDULED_TASK_RUNS_PER_TASK, database)
        return mapRow(getRow(value.taskId, value.id, database))
      })
    },

    replaceAll(entries, replaceOptions = {}) {
      if (!Array.isArray(entries)) throw new TypeError('entries must be an array')
      const values = entries.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('entry must be an object')
        return normalizeFullRun(entry.taskId, entry.run, { source: entry.source ?? replaceOptions.source, now })
      })
      const seen = new Set()
      for (const value of values) {
        const key = JSON.stringify([value.taskId, value.id])
        if (seen.has(key)) throw new TypeError(`Duplicate scheduled task run: ${value.taskId}/${value.id}`)
        seen.add(key)
      }
      return storage.transaction((database) => {
        database.prepare('DELETE FROM scheduled_task_runs').run()
        const insertStatement = database.prepare(`INSERT INTO scheduled_task_runs (${INSERT_COLUMNS}) VALUES (${INSERT_PLACEHOLDERS})`)
        for (const value of values) insert(database, value, insertStatement)
        return values.length
      })
    },

    update(taskId, runId, patch) {
      assertNonEmptyString(taskId, 'taskId')
      assertNonEmptyString(runId, 'runId')
      const entries = normalizePatch(patch)
      if (entries.length === 0) return mapRow(getRow(taskId, runId))
      entries.push(['updated_at', now()])
      const assignments = entries.map(([column]) => `${column} = ?`).join(', ')
      const values = entries.map(([, value]) => value)
      const result = storage.prepare(`UPDATE scheduled_task_runs SET ${assignments} WHERE task_id = ? AND id = ?`).run(...values, taskId, runId)
      return Number(result.changes) === 0 ? null : mapRow(getRow(taskId, runId))
    },

    get(taskId, runId) {
      return mapRow(getRow(taskId, runId))
    },

    listByTask(taskId, { limit = MAX_SCHEDULED_TASK_RUNS_PER_TASK, offset = 0 } = {}) {
      assertNonEmptyString(taskId, 'taskId')
      const normalizedLimit = parseListByTaskLimit(limit)
      const normalizedOffset = parseOffset(offset)
      return storage.prepare(`
        SELECT * FROM scheduled_task_runs
        WHERE task_id = ?
        ORDER BY started_at DESC, id DESC
        LIMIT ? OFFSET ?
      `).all(taskId, normalizedLimit, normalizedOffset).map((row) => mapRow(row))
    },

    list(filters = {}) {
      const normalized = normalizeFilters(filters)
      const where = buildWhere(normalized)
      const offset = (normalized.page - 1) * normalized.pageSize
      return storage.transaction((database) => {
        const total = Number(database.prepare(`SELECT COUNT(*) AS count FROM scheduled_task_runs${where.sql}`).get(...where.parameters).count)
        const runs = database.prepare(`
          SELECT * FROM scheduled_task_runs${where.sql}
          ORDER BY started_at DESC, id DESC, task_id DESC
          LIMIT ? OFFSET ?
        `).all(...where.parameters, normalized.pageSize, offset).map((row) => mapRow(row, { includeTaskId: true }))
        return { runs, total, page: normalized.page, pageSize: normalized.pageSize }
      }, { mode: 'deferred' })
    },

    count(filters = {}) {
      const normalized = normalizeFilters(filters)
      const where = buildWhere(normalized)
      return Number(storage.prepare(`SELECT COUNT(*) AS count FROM scheduled_task_runs${where.sql}`).get(...where.parameters).count)
    },

    delete(taskId, runId) {
      assertNonEmptyString(taskId, 'taskId')
      assertNonEmptyString(runId, 'runId')
      return Number(storage.prepare('DELETE FROM scheduled_task_runs WHERE task_id = ? AND id = ?').run(taskId, runId).changes) > 0
    },

    deleteByTask(taskId) {
      assertNonEmptyString(taskId, 'taskId')
      return Number(storage.prepare('DELETE FROM scheduled_task_runs WHERE task_id = ?').run(taskId).changes)
    },

    prune(taskId, limit = MAX_SCHEDULED_TASK_RUNS_PER_TASK) {
      return storage.transaction((database) => pruneByTask(taskId, limit, database))
    },
  })
}
