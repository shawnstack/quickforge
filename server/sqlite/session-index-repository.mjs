import { getSqliteStorage } from './database.mjs'

const SELECT_COLUMNS = `
  scope, project_id, session_id, created_at, last_modified, message_count,
  pinned_at, archived_at, is_pinned, is_archived, state_version,
  metadata_json, metadata_digest, indexed_at
`

function assertStorage(storage) {
  if (!storage || typeof storage.prepare !== 'function' || typeof storage.transaction !== 'function') {
    throw new TypeError('Session index repository requires a SQLite storage handle')
  }
  return storage
}

function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${field} must be a non-empty string`)
  return value
}

function normalizeBucket(scope, projectId) {
  if (scope === 'global') return { scope, projectId: '' }
  if (scope !== 'project') throw new TypeError('scope must be global or project')
  return { scope, projectId: assertNonEmptyString(projectId, 'projectId') }
}

function assertPlainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${field} must be a plain object`)
  }
  return value
}

function nullableString(value, field) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string or null`)
  return value
}

function nullableInteger(value, field) {
  if (value === undefined || value === null) return null
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative integer or null`)
  return value
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('row must be an object')
  const bucket = normalizeBucket(row.scope, row.projectId)
  const metadata = assertPlainObject(row.metadata, 'metadata')
  let metadataJson
  try {
    metadataJson = JSON.stringify(metadata)
  } catch {
    throw new TypeError('metadata must be JSON-serializable')
  }
  if (typeof row.metadataDigest !== 'string' || !/^[0-9a-f]{64}$/.test(row.metadataDigest)) {
    throw new TypeError('metadataDigest must be a lowercase SHA-256 hex digest')
  }
  return {
    ...bucket,
    sessionId: assertNonEmptyString(row.sessionId, 'sessionId'),
    createdAt: nullableString(row.createdAt, 'createdAt'),
    lastModified: nullableString(row.lastModified, 'lastModified'),
    messageCount: nullableInteger(row.messageCount, 'messageCount'),
    pinnedAt: nullableString(row.pinnedAt, 'pinnedAt'),
    archivedAt: nullableString(row.archivedAt, 'archivedAt'),
    isPinned: row.pinnedAt ? 1 : 0,
    isArchived: row.archivedAt ? 1 : 0,
    stateVersion: nullableInteger(row.stateVersion, 'stateVersion'),
    metadataJson,
    metadataDigest: row.metadataDigest,
    indexedAt: assertNonEmptyString(row.indexedAt, 'indexedAt'),
  }
}

function mapRow(row) {
  if (!row) return null
  return {
    scope: row.scope,
    projectId: row.scope === 'project' ? row.project_id : null,
    sessionId: row.session_id,
    createdAt: row.created_at,
    lastModified: row.last_modified,
    messageCount: row.message_count,
    pinnedAt: row.pinned_at,
    archivedAt: row.archived_at,
    isPinned: row.is_pinned === 1,
    isArchived: row.is_archived === 1,
    stateVersion: row.state_version,
    metadata: JSON.parse(row.metadata_json),
    metadataDigest: row.metadata_digest,
    indexedAt: row.indexed_at,
  }
}

function rowParameters(row) {
  return [
    row.scope, row.projectId, row.sessionId, row.createdAt, row.lastModified,
    row.messageCount, row.pinnedAt, row.archivedAt, row.isPinned, row.isArchived,
    row.stateVersion, row.metadataJson, row.metadataDigest, row.indexedAt,
  ]
}

function normalizeQuery(options = {}) {
  const scopeMode = options.scopeMode ?? 'all'
  if (!['all', 'global', 'project', 'projects'].includes(scopeMode)) throw new TypeError('scopeMode is invalid')
  const projectId = scopeMode === 'project' ? assertNonEmptyString(options.projectId, 'projectId') : null
  const archive = options.archive ?? 'exclude'
  if (!['exclude', 'only', 'include'].includes(archive)) throw new TypeError('archive is invalid')
  const sort = options.sort ?? 'lastModified'
  if (!['createdAt', 'lastModified', 'pinnedAt'].includes(sort)) throw new TypeError('sort is invalid')
  const direction = options.direction ?? 'desc'
  if (!['asc', 'desc'].includes(direction)) throw new TypeError('direction is invalid')
  const limit = options.limit
  const offset = options.offset ?? 0
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError('limit must be a positive safe integer')
  if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError('offset must be a non-negative safe integer')
  return { scopeMode, projectId, archive, pinnedOnly: options.pinnedOnly === true, sort, direction, limit, offset }
}

const SORT_COLUMNS = Object.freeze({ createdAt: 'created_at', lastModified: 'last_modified', pinnedAt: 'pinned_at' })

function buildQuery(options, { page = true } = {}) {
  const query = normalizeQuery(options)
  const where = ['(message_count IS NULL OR message_count <> 0)']
  const parameters = []
  if (query.scopeMode === 'global') where.push("scope = 'global' AND project_id = ''")
  else if (query.scopeMode === 'project') {
    where.push("scope = 'project' AND project_id = ?")
    parameters.push(query.projectId)
  } else if (query.scopeMode === 'projects') where.push("scope = 'project'")
  if (query.archive === 'exclude') where.push('is_archived = 0')
  else if (query.archive === 'only') where.push('is_archived = 1')
  if (query.pinnedOnly) where.push('is_pinned = 1')

  const column = SORT_COLUMNS[query.sort]
  const order = query.sort === 'pinnedAt'
    ? `${column} ${query.direction.toUpperCase()}`
    : `is_pinned DESC, pinned_at DESC, ${column} ${query.direction.toUpperCase()}`
  const whereSql = `WHERE ${where.join(' AND ')}`
  return {
    query,
    parameters,
    whereSql,
    order,
    rowsSql: `SELECT ${SELECT_COLUMNS} FROM session_index ${whereSql} ORDER BY ${order}${page ? ' LIMIT ? OFFSET ?' : ''}`,
    countSql: `SELECT COUNT(*) AS count FROM session_index ${whereSql}`,
  }
}

function analyzeInto(database, options) {
  const built = buildQuery(options, { page: false })
  const aggregate = built.query.scopeMode === 'all' || built.query.scopeMode === 'projects'
  const duplicateSessionIdCount = aggregate
    ? Number(database.prepare(`SELECT COUNT(*) AS count FROM (SELECT session_id FROM session_index ${built.whereSql} GROUP BY session_id HAVING COUNT(*) > 1)`).get(...built.parameters).count)
    : 0
  const column = SORT_COLUMNS[built.query.sort]
  const tieColumns = built.query.sort === 'pinnedAt' ? column : `is_pinned, pinned_at, ${column}`
  const fullSortKeyTieCount = Number(database.prepare(`SELECT COUNT(*) AS count FROM (SELECT ${tieColumns} FROM session_index ${built.whereSql} GROUP BY ${tieColumns} HAVING COUNT(*) > 1)`).get(...built.parameters).count)
  return { duplicateSessionIdCount, fullSortKeyTieCount }
}

export function createSessionIndexRepository(storageHandle) {
  const storage = assertStorage(storageHandle ?? getSqliteStorage())
  const upsertSql = `
    INSERT INTO session_index (${SELECT_COLUMNS}) VALUES (${new Array(14).fill('?').join(', ')})
    ON CONFLICT(scope, project_id, session_id) DO UPDATE SET
      created_at = excluded.created_at,
      last_modified = excluded.last_modified,
      message_count = excluded.message_count,
      pinned_at = excluded.pinned_at,
      archived_at = excluded.archived_at,
      is_pinned = excluded.is_pinned,
      is_archived = excluded.is_archived,
      state_version = excluded.state_version,
      metadata_json = excluded.metadata_json,
      metadata_digest = excluded.metadata_digest,
      indexed_at = excluded.indexed_at
  `

  function upsertInto(database, row) {
    const normalized = normalizeRow(row)
    database.prepare(upsertSql).run(...rowParameters(normalized))
    return normalized
  }

  function get(scope, projectId, sessionId) {
    const bucket = normalizeBucket(scope, projectId)
    assertNonEmptyString(sessionId, 'sessionId')
    return mapRow(storage.prepare(`SELECT ${SELECT_COLUMNS} FROM session_index WHERE scope = ? AND project_id = ? AND session_id = ?`)
      .get(bucket.scope, bucket.projectId, sessionId))
  }

  function upsert(row) {
    const normalized = upsertInto(storage, row)
    return get(normalized.scope, normalized.projectId, normalized.sessionId)
  }

  function deleteRow(scope, projectId, sessionId) {
    const bucket = normalizeBucket(scope, projectId)
    assertNonEmptyString(sessionId, 'sessionId')
    return storage.prepare('DELETE FROM session_index WHERE scope = ? AND project_id = ? AND session_id = ?')
      .run(bucket.scope, bucket.projectId, sessionId).changes > 0
  }

  function applyChanges({ upserts = [], deletes = [] } = {}) {
    if (!Array.isArray(upserts) || !Array.isArray(deletes)) throw new TypeError('upserts and deletes must be arrays')
    const normalizedUpserts = upserts.map(normalizeRow)
    const normalizedDeletes = deletes.map((entry) => ({
      ...normalizeBucket(entry?.scope, entry?.projectId),
      sessionId: assertNonEmptyString(entry?.sessionId, 'sessionId'),
    }))
    return storage.transaction((database) => {
      const deleteStatement = database.prepare('DELETE FROM session_index WHERE scope = ? AND project_id = ? AND session_id = ?')
      for (const entry of normalizedDeletes) deleteStatement.run(entry.scope, entry.projectId, entry.sessionId)
      for (const row of normalizedUpserts) database.prepare(upsertSql).run(...rowParameters(row))
      return { upserted: normalizedUpserts.length, deleted: normalizedDeletes.length }
    })
  }

  function replaceBucket(scope, projectId, rows) {
    const bucket = normalizeBucket(scope, projectId)
    if (!Array.isArray(rows)) throw new TypeError('rows must be an array')
    const normalizedRows = rows.map((row) => normalizeRow({ ...row, ...bucket }))
    return storage.transaction((database) => {
      database.prepare('DELETE FROM session_index WHERE scope = ? AND project_id = ?').run(bucket.scope, bucket.projectId)
      for (const row of normalizedRows) database.prepare(upsertSql).run(...rowParameters(row))
      return normalizedRows.length
    })
  }

  function replaceAll(rows) {
    if (!Array.isArray(rows)) throw new TypeError('rows must be an array')
    const normalizedRows = rows.map(normalizeRow)
    const keys = new Set()
    for (const row of normalizedRows) {
      const key = `${row.scope}\0${row.projectId}\0${row.sessionId}`
      if (keys.has(key)) throw new TypeError('Duplicate session index composite key')
      keys.add(key)
    }
    return storage.transaction((database) => {
      database.exec('DELETE FROM session_index')
      for (const row of normalizedRows) database.prepare(upsertSql).run(...rowParameters(row))
      return normalizedRows.length
    })
  }

  function count() {
    return Number(storage.prepare('SELECT COUNT(*) AS count FROM session_index').get().count)
  }

  function listVerification() {
    return storage.prepare(`SELECT scope, project_id, session_id, metadata_digest FROM session_index ORDER BY scope, project_id, session_id`)
      .all()
      .map((row) => ({
        scope: row.scope,
        projectId: row.scope === 'project' ? row.project_id : null,
        sessionId: row.session_id,
        metadataDigest: row.metadata_digest,
      }))
  }

  function listIntegrity() {
    return storage.prepare(`SELECT ${SELECT_COLUMNS} FROM session_index ORDER BY scope, project_id, session_id`).all().map(mapRow)
  }

  function listAll() {
    return storage.prepare(`SELECT ${SELECT_COLUMNS} FROM session_index ORDER BY scope, project_id, session_id`).all().map(mapRow)
  }

  function listPage(options) {
    const built = buildQuery(options)
    return storage.transaction((database) => {
      const total = Number(database.prepare(built.countSql).get(...built.parameters).count)
      const rows = database.prepare(built.rowsSql).all(...built.parameters, built.query.limit, built.query.offset).map(mapRow)
      return { values: rows.map((row) => row.metadata), rows, total }
    }, { mode: 'deferred' })
  }

  function readMetadataEntries() {
    return storage.prepare('SELECT metadata_json FROM session_index').all().map((row) => JSON.parse(row.metadata_json))
  }

  function analyzeQuery(options) {
    return analyzeInto(storage, options)
  }

  function explainQueryPlan(options) {
    const built = buildQuery(options)
    return storage.prepare(`EXPLAIN QUERY PLAN ${built.rowsSql}`).all(...built.parameters, built.query.limit, built.query.offset)
  }

  return Object.freeze({
    get, upsert, delete: deleteRow, applyChanges, replaceBucket, replaceAll,
    count, listVerification, listIntegrity, listAll, listPage, readMetadataEntries, analyzeQuery, explainQueryPlan,
  })
}
