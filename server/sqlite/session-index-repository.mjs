import { createHash } from 'node:crypto'
import { getSqliteStorage } from './database.mjs'

// Storage v2 session index query layer. The dedicated `session_index`
// projection table is retired (renamed away by migration v11): the
// authoritative `sessions` table carries the promoted list columns
// (created_at, message_count, archived_at, pinned_at, meta_json) and this
// repository is now a read-only LIMIT/OFFSET query facade over it. There is
// nothing to sync, shadow or rebuild — the store and the index are the same
// rows.

// Sorting by lastModified stays metadata-driven: sessions.updated_at is the
// wall-clock write time, while the list UI (and the retired index) order by
// metadata.lastModified, which sessions may legitimately backdate.
const LAST_MODIFIED_EXPR = "json_extract(meta_json, '$.lastModified')"

const SELECT_COLUMNS = `
  scope, project_id, session_id, created_at, updated_at,
  ${LAST_MODIFIED_EXPR} AS last_modified, message_count,
  pinned_at, archived_at, state_version, meta_json
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

const SORT_COLUMNS = Object.freeze({ createdAt: 'created_at', lastModified: LAST_MODIFIED_EXPR, pinnedAt: 'pinned_at' })

function buildQuery(options, { page = true } = {}) {
  const query = normalizeQuery(options)
  const where = ['message_count <> 0']
  const parameters = []
  if (query.scopeMode === 'global') where.push("scope = 'global' AND project_id = ''")
  else if (query.scopeMode === 'project') {
    where.push("scope = 'project' AND project_id = ?")
    parameters.push(query.projectId)
  } else if (query.scopeMode === 'projects') where.push("scope = 'project'")
  if (query.archive === 'exclude') where.push('archived_at IS NULL')
  else if (query.archive === 'only') where.push('archived_at IS NOT NULL')
  if (query.pinnedOnly) where.push('pinned_at IS NOT NULL')

  const column = SORT_COLUMNS[query.sort]
  // Pinned-first ordering (metadata pinnedAt promoted to the pinned_at
  // column): DESC on `pinned_at IS NOT NULL` matches the retired index's
  // is_pinned DESC, and DESC on pinned_at itself keeps NULLs last.
  const order = query.sort === 'pinnedAt'
    ? `${column} ${query.direction.toUpperCase()}`
    : `(pinned_at IS NOT NULL) DESC, pinned_at DESC, ${column} ${query.direction.toUpperCase()}`
  const whereSql = `WHERE ${where.join(' AND ')}`
  return {
    query,
    parameters,
    whereSql,
    order,
    rowsSql: `SELECT ${SELECT_COLUMNS} FROM sessions ${whereSql} ORDER BY ${order}${page ? ' LIMIT ? OFFSET ?' : ''}`,
    countSql: `SELECT COUNT(*) AS count FROM sessions ${whereSql}`,
  }
}

function mapRow(row) {
  if (!row) return null
  return {
    scope: row.scope,
    projectId: row.scope === 'project' ? row.project_id : null,
    sessionId: row.session_id,
    createdAt: row.created_at,
    lastModified: row.last_modified ?? null,
    messageCount: row.message_count,
    pinnedAt: row.pinned_at ?? null,
    archivedAt: row.archived_at ?? null,
    isPinned: row.pinned_at != null,
    isArchived: row.archived_at != null,
    stateVersion: row.state_version,
    metadata: JSON.parse(row.meta_json),
    metadataDigest: createHash('sha256').update(row.meta_json).digest('hex'),
    indexedAt: row.updated_at,
  }
}

function analyzeInto(database, options) {
  const built = buildQuery(options, { page: false })
  const aggregate = built.query.scopeMode === 'all' || built.query.scopeMode === 'projects'
  const duplicateSessionIdCount = aggregate
    ? Number(database.prepare(`SELECT COUNT(*) AS count FROM (SELECT session_id FROM sessions ${built.whereSql} GROUP BY session_id HAVING COUNT(*) > 1)`).get(...built.parameters).count)
    : 0
  const column = SORT_COLUMNS[built.query.sort]
  const tieColumns = built.query.sort === 'pinnedAt' ? column : `(pinned_at IS NOT NULL), pinned_at, ${column}`
  const fullSortKeyTieCount = Number(database.prepare(`SELECT COUNT(*) AS count FROM (SELECT ${tieColumns} FROM sessions ${built.whereSql} GROUP BY ${tieColumns} HAVING COUNT(*) > 1)`).get(...built.parameters).count)
  return { duplicateSessionIdCount, fullSortKeyTieCount }
}

export function createSessionIndexRepository(storageHandle) {
  const storage = assertStorage(storageHandle ?? getSqliteStorage())

  function listPage(options) {
    const built = buildQuery(options)
    return storage.transaction((database) => {
      const total = Number(database.prepare(built.countSql).get(...built.parameters).count)
      const rows = database.prepare(built.rowsSql).all(...built.parameters, built.query.limit, built.query.offset).map(mapRow)
      return { values: rows.map((row) => row.metadata), rows, total }
    }, { mode: 'deferred' })
  }

  function analyzeQuery(options) {
    return analyzeInto(storage, options)
  }

  function explainQueryPlan(options) {
    const built = buildQuery(options)
    return storage.prepare(`EXPLAIN QUERY PLAN ${built.rowsSql}`).all(...built.parameters, built.query.limit, built.query.offset)
  }

  function count() {
    return Number(storage.prepare('SELECT COUNT(*) AS count FROM sessions').get().count)
  }

  return Object.freeze({
    listPage,
    analyzeQuery,
    explainQueryPlan,
    count,
  })
}
