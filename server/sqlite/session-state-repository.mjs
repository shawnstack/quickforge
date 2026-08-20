import { createHash } from 'node:crypto'
import { logger } from '../utils/logger.mjs'
import { getSqliteStorage, runSharedSqliteQuickCheck } from './database.mjs'

const SESSION_ROW_COLUMNS = `
  scope, project_id, session_id, revision, state_version, created_at, updated_at,
  message_count, title, title_source, harness, task_status, archived_at, pinned_at,
  body_json, meta_json, updated_at_ms
`

// v2 message representation (schema v11): every session's messages live in
// `session_messages`; the stored body carries this marker and never carries a
// `messages` key. Kept for the service's assembleState/plan readers.
export const MESSAGES_SPLIT_VALUE = 'split'
export const MESSAGES_PAGE_LIMIT_MAX = 5000

// Runtime hot-path statement cache (review P4): save/append used to re-prepare
// the same handful of statements on every call. Statements are cached per
// storage handle; the WeakMap releases the whole cache when the handle is
// dropped, so a closed DatabaseSync never leaks stale statements.
const statementCache = new WeakMap()

function cachedStatement(database, sql) {
  let statements = statementCache.get(database)
  if (!statements) {
    statements = new Map()
    statementCache.set(database, statements)
  }
  let statement = statements.get(sql)
  if (!statement) {
    statement = database.prepare(sql)
    statements.set(sql, statement)
  }
  return statement
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalize(value[key])]))
}

function jsonAndDigest(value, field) {
  if (!isPlainObject(value)) throw new TypeError(`${field} must be a plain object`)
  let parsed
  try {
    parsed = JSON.parse(JSON.stringify(value))
  } catch {
    throw new TypeError(`${field} must be JSON-serializable`)
  }
  if (!isPlainObject(parsed)) throw new TypeError(`${field} must be a JSON object`)
  const json = JSON.stringify(canonicalize(parsed))
  return { value: parsed, json, digest: createHash('sha256').update(json).digest('hex') }
}

// Canonical SHA-256 digest of a single message object (identical algorithm to
// the row-level `message_digest` written by the repository).
export function messageDigest(message) {
  return jsonAndDigest(message, 'message').digest
}

// Digest over an ordered message array (seq = array index). Mirrors the
// per-session aggregate computed from stored rows, so assembled plan/backup
// values hash identically to their stored representation.
export function messagesDigestFromValues(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return ''
  const rows = messages.map((message, seq) => ({ seq, message_digest: messageDigest(message) }))
  return messagesDigest(rows)
}

// sha256 over `${seq}\0${message_digest}` lines (rows must be ordered by seq).
function messagesDigest(rows) {
  if (!rows || rows.length === 0) return ''
  return createHash('sha256').update(rows.map((row) => `${row.seq}\0${row.message_digest}`).join('\n')).digest('hex')
}

// Canonical digest line shared by the repository snapshot digest, the JSON
// cutover snapshot, restore-plan digest and offline tools. A session with no
// message rows contributes an empty `messagesDigest`.
export function snapshotDigestLine(scope, projectId, sessionId, stateDigest, metadataDigest, messagesDigestValue = '') {
  return `${scope}\0${projectId || ''}\0${sessionId}\0${stateDigest}\0${metadataDigest}\0${messagesDigestValue || ''}`
}

// Split a (possibly assembled) state into its stored body and message array,
// mirroring the repository's v2 extraction rule: ANY body carrying a plain
// `messages` array (inline or split-marked) has it extracted wholesale, and
// the stored body carries the split marker. Never mutates the input.
export function splitStateForStorage(state) {
  const copy = structuredClone(state)
  if (!isPlainObject(copy)) throw new TypeError('state must be a plain object')
  if (Array.isArray(copy.messages)) {
    const messages = copy.messages
    delete copy.messages
    copy.messageStorage = MESSAGES_SPLIT_VALUE
    return { storedState: copy, messages }
  }
  return { storedState: copy, messages: undefined }
}

function encodeMessage(message) {
  if (!isPlainObject(message)) throw new TypeError('message must be a plain object')
  let parsed
  try {
    parsed = JSON.parse(JSON.stringify(message))
  } catch {
    throw new TypeError('message must be JSON-serializable')
  }
  if (!isPlainObject(parsed)) throw new TypeError('message must be a JSON object')
  const json = JSON.stringify(canonicalize(parsed))
  const messageId = typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id : null
  return {
    messageId,
    messageJson: json,
    messageDigest: createHash('sha256').update(json).digest('hex'),
  }
}

function encodeMessages(messages) {
  if (!Array.isArray(messages)) throw new TypeError('messages must be an array')
  return messages.map((message) => encodeMessage(message))
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string`)
  return value
}

function bucket(scope, projectId) {
  if (scope === 'global') return { scope, projectId: '' }
  if (scope !== 'project') throw new TypeError('scope must be global or project')
  return { scope, projectId: nonEmptyString(projectId, 'projectId') }
}

function normalizeRevision(value, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return null
  if (!Number.isInteger(value) || value < 0) throw new TypeError('expectedRevision must be a non-negative integer or null')
  return value
}

function normalizeExpectedStateVersion(value) {
  if (value === undefined || value === null) return null
  if (!Number.isInteger(value) || value < 0) throw new TypeError('expectedStateVersion must be a non-negative integer or null')
  return value
}

function nullableString(value) {
  return typeof value === 'string' ? value : null
}

// Column projection timestamps: updated_at_ms / tombstone deleted_at carry
// epoch milliseconds derived from the injected clock.
function epochMillis(timestamp) {
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function normalizeRecord(input, timestamp) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('session state record must be an object')
  const state = structuredClone(input.state)
  const metadata = structuredClone(input.metadata)
  if (!isPlainObject(state) || !isPlainObject(metadata)) throw new TypeError('state and metadata must be plain objects')
  const sessionId = nonEmptyString(input.sessionId ?? state.id ?? metadata.id, 'sessionId')
  const normalizedBucket = bucket(input.scope ?? state.scope ?? metadata.scope, input.projectId ?? state.projectId ?? metadata.projectId)
  const stateVersion = input.stateVersion ?? state.stateVersion ?? metadata.stateVersion ?? 0
  if (!Number.isInteger(stateVersion) || stateVersion < 0) throw new TypeError('stateVersion must be a non-negative integer')

  for (const [value, field] of [[state, 'state'], [metadata, 'metadata']]) {
    if (value.id !== undefined && value.id !== sessionId) throw new TypeError(`${field}.id must match sessionId`)
    if (value.scope !== undefined && value.scope !== normalizedBucket.scope) throw new TypeError(`${field}.scope must match scope`)
    if (normalizedBucket.scope === 'project') {
      if (value.projectId !== undefined && value.projectId !== normalizedBucket.projectId) throw new TypeError(`${field}.projectId must match projectId`)
    } else if (value.projectId !== undefined && value.projectId !== null) {
      throw new TypeError(`${field}.projectId is not allowed for global sessions`)
    }
    if (value.stateVersion !== undefined && value.stateVersion !== stateVersion) throw new TypeError(`${field}.stateVersion must match stateVersion`)
    value.id = sessionId
    value.scope = normalizedBucket.scope
    value.stateVersion = stateVersion
    if (normalizedBucket.scope === 'project') value.projectId = normalizedBucket.projectId
    else delete value.projectId
  }

  // v2 unified message handling: ANY body carrying `messages` (a plain inline
  // array, or a legacy split-marked body with its inline copy) is extracted
  // wholesale — the caller-selected mode ('replace' by default, 'append' for
  // incremental tails) writes the rows, and body_json never contains the
  // messages array. A body without messages (body-only save) leaves the
  // stored message rows untouched.
  let incomingMessages = input.messages
  if (incomingMessages === undefined && Array.isArray(state.messages)) incomingMessages = state.messages
  const messages = incomingMessages !== undefined ? encodeMessages(incomingMessages) : undefined
  if (messages !== undefined) {
    delete state.messages
    state.messageStorage = MESSAGES_SPLIT_VALUE
  }

  const stateEncoded = jsonAndDigest(state, 'state')
  const metadataEncoded = jsonAndDigest(metadata, 'metadata')
  return {
    ...normalizedBucket,
    sessionId,
    stateVersion,
    state: stateEncoded.value,
    metadata: metadataEncoded.value,
    stateJson: stateEncoded.json,
    stateDigest: stateEncoded.digest,
    metadataJson: metadataEncoded.json,
    metadataDigest: metadataEncoded.digest,
    messages,
    now: timestamp,
  }
}

function conflict(sessionId, expectedRevision, actualRevision) {
  const error = new Error(`Session state conflict for ${sessionId}`)
  error.statusCode = 409
  error.errorCode = 'SESSION_STATE_CONFLICT'
  error.expectedRevision = expectedRevision
  error.actualRevision = actualRevision
  return error
}

function stateVersionConflict(sessionId, expectedStateVersion, actualStateVersion) {
  const error = new Error(`Session state version conflict for ${sessionId}`)
  error.statusCode = 409
  error.errorCode = 'SESSION_STATE_CONFLICT'
  error.expectedStateVersion = expectedStateVersion
  error.actualStateVersion = actualStateVersion
  return error
}

function duplicate(sessionId) {
  const error = new Error(`Duplicate authoritative session id: ${sessionId}`)
  error.statusCode = 409
  error.errorCode = 'SESSION_STATE_DUPLICATE_ID'
  return error
}

function mapRow(row) {
  if (!row) return null
  return {
    scope: row.scope,
    projectId: row.scope === 'project' ? row.project_id : null,
    sessionId: row.session_id,
    revision: Number(row.revision),
    stateVersion: Number(row.state_version),
    state: JSON.parse(row.body_json),
    stateDigest: createHash('sha256').update(row.body_json).digest('hex'),
    metadata: JSON.parse(row.meta_json),
    metadataDigest: createHash('sha256').update(row.meta_json).digest('hex'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// Canonical digest over digest lines: lines are sorted in UTF-16 code unit
// (byte) order before hashing. Source-side cutover digests MUST be computed
// through this function so verification never diverges on collation-sensitive
// session ids.
export function digestFromLines(lines) {
  return createHash('sha256').update([...lines].sort().join('\n')).digest('hex')
}

function verificationDigest(rows) {
  return digestFromLines(rows.map((row) => snapshotDigestLine(row.scope, row.project_id, row.session_id, row.state_digest, row.metadata_digest, row.messages_digest)))
}

export function sessionStateSnapshotDigest(records) {
  return verificationDigest(records.map((record) => ({
    scope: record.scope,
    project_id: record.projectId || '',
    session_id: record.sessionId,
    state_digest: record.stateDigest,
    metadata_digest: record.metadataDigest,
    messages_digest: typeof record.messagesDigest === 'string'
      ? record.messagesDigest
      : (Array.isArray(record.messages) ? messagesDigestFromValues(record.messages) : ''),
  })))
}

function actualRevision(database, record) {
  const active = cachedStatement(database, 'SELECT revision, state_version, created_at, message_count FROM sessions WHERE scope = ? AND project_id = ? AND session_id = ?')
    .get(record.scope, record.projectId, record.sessionId)
  if (active) {
    return { revision: Number(active.revision), stateVersion: Number(active.state_version), createdAt: active.created_at, messageCount: Number(active.message_count), active: true }
  }
  // v2 tombstones carry no revision: a same-key tombstone resolves to
  // revision 0, so a stale CAS write (expectedRevision > 0) still conflicts
  // while a fresh recreate (expectedRevision null/0) succeeds.
  const tombstone = cachedStatement(database, 'SELECT deleted_at FROM session_tombstones WHERE scope = ? AND project_id = ? AND session_id = ?')
    .get(record.scope, record.projectId, record.sessionId)
  return { revision: 0, stateVersion: null, createdAt: null, messageCount: 0, tombstoneAt: tombstone ? Number(tombstone.deleted_at) : null, active: false }
}

function assertNoCrossBucketDuplicate(database, record) {
  const other = cachedStatement(database, `SELECT scope, project_id FROM sessions
    WHERE session_id = ? AND NOT (scope = ? AND project_id = ?) LIMIT 1`)
    .get(record.sessionId, record.scope, record.projectId)
  if (other) throw duplicate(record.sessionId)
}

const INSERT_MESSAGE_SQL = `
  INSERT INTO session_messages (scope, project_id, session_id, seq, message_id, message_json, message_digest)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`
const MESSAGE_COUNT_SQL = 'SELECT COUNT(*) AS count FROM session_messages WHERE scope = ? AND project_id = ? AND session_id = ?'
// Append dedup probes stored ids in bounded IN(...) chunks (review P1).
const MESSAGE_ID_DEDUP_BATCH_SIZE = 500

const UPSERT_SESSION_SQL = `
  INSERT INTO sessions (
    scope, project_id, session_id, title, title_source, created_at, updated_at,
    message_count, state_version, harness, task_status, archived_at, pinned_at,
    body_json, meta_json, revision, updated_at_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(scope, project_id, session_id) DO UPDATE SET
    title = excluded.title,
    title_source = excluded.title_source,
    updated_at = excluded.updated_at,
    message_count = excluded.message_count,
    state_version = excluded.state_version,
    harness = excluded.harness,
    task_status = excluded.task_status,
    archived_at = excluded.archived_at,
    pinned_at = excluded.pinned_at,
    body_json = excluded.body_json,
    meta_json = excluded.meta_json,
    revision = excluded.revision,
    updated_at_ms = excluded.updated_at_ms
`

// sessions.message_count is derived state (never trusted from callers): after
// any message write it is recomputed from the stored rows in the same
// transaction, and full integrity verification re-checks it per session.
const SYNC_MESSAGE_COUNT_SQL = `
  UPDATE sessions SET message_count = (
    SELECT COUNT(*) FROM session_messages
    WHERE scope = sessions.scope AND project_id = sessions.project_id AND session_id = sessions.session_id
  ) WHERE scope = ? AND project_id = ? AND session_id = ?
`

// Column values for the sessions projection; list columns come from the
// normalized state/metadata pair (state wins, metadata is the fallback).
function sessionRowValues(record, { revision, createdAt, messageCount }) {
  const state = record.state
  const metadata = record.metadata
  return [
    record.scope, record.projectId, record.sessionId,
    nullableString(state.title) ?? nullableString(metadata.title) ?? '',
    nullableString(state.titleSource) ?? nullableString(metadata.titleSource),
    createdAt, record.now,
    messageCount, record.stateVersion,
    nullableString(state.harness) ?? nullableString(metadata.harness),
    nullableString(state.taskStatus) ?? nullableString(metadata.taskStatus),
    nullableString(state.archivedAt) ?? nullableString(metadata.archivedAt),
    nullableString(state.pinnedAt) ?? nullableString(metadata.pinnedAt),
    record.stateJson, record.metadataJson, revision,
    epochMillis(record.now),
  ]
}

function writeMessages(database, record, mode) {
  if (record.messages === undefined) return
  if (mode !== 'replace' && mode !== 'append') throw new TypeError('messagesMode must be replace or append')
  const params = [record.scope, record.projectId, record.sessionId]
  if (mode === 'replace') {
    cachedStatement(database, 'DELETE FROM session_messages WHERE scope = ? AND project_id = ? AND session_id = ?').run(...params)
    const insert = cachedStatement(database, INSERT_MESSAGE_SQL)
    record.messages.forEach((message, seq) => {
      insert.run(record.scope, record.projectId, record.sessionId, seq, message.messageId, message.messageJson, message.messageDigest)
    })
    return
  }
  // Conservative retry dedup for id-less batches: when every incoming message
  // lacks an id AND the batch digest sequence exactly equals the stored tail
  // (same length, same order), the batch is a retry of an append that already
  // persisted and is skipped wholesale. Partial overlaps and mixed id/no-id
  // batches are appended as usual, so a genuinely new message whose content
  // repeats is only skipped when the ENTIRE batch replays the tail.
  if (record.messages.length > 0 && record.messages.every((message) => message.messageId === null)) {
    const tailRows = cachedStatement(database, `SELECT message_digest FROM session_messages
      WHERE scope = ? AND project_id = ? AND session_id = ? ORDER BY seq DESC LIMIT ?`).all(...params, record.messages.length)
    if (tailRows.length === record.messages.length
      && tailRows.every((row, index) => row.message_digest === record.messages[record.messages.length - 1 - index].messageDigest)) {
      return
    }
  }
  const maxSeq = Number(cachedStatement(database, 'SELECT COALESCE(MAX(seq), -1) AS max_seq FROM session_messages WHERE scope = ? AND project_id = ? AND session_id = ?').get(...params).max_seq)
  // Id dedup costs O(incoming) instead of O(stored): only the ids this batch
  // carries are probed against the stored rows.
  const existingIds = new Set()
  const incomingIds = [...new Set(record.messages.map((message) => message.messageId).filter((messageId) => messageId !== null))]
  for (let start = 0; start < incomingIds.length; start += MESSAGE_ID_DEDUP_BATCH_SIZE) {
    const chunk = incomingIds.slice(start, start + MESSAGE_ID_DEDUP_BATCH_SIZE)
    const probe = cachedStatement(database, `SELECT message_id FROM session_messages
      WHERE scope = ? AND project_id = ? AND session_id = ? AND message_id IN (${chunk.map(() => '?').join(', ')})`)
    for (const row of probe.all(...params, ...chunk)) existingIds.add(row.message_id)
  }
  const insert = cachedStatement(database, INSERT_MESSAGE_SQL)
  let seq = maxSeq + 1
  for (const message of record.messages) {
    if (message.messageId !== null && existingIds.has(message.messageId)) continue
    insert.run(record.scope, record.projectId, record.sessionId, seq, message.messageId, message.messageJson, message.messageDigest)
    if (message.messageId !== null) existingIds.add(message.messageId)
    seq += 1
  }
}

function saveInTransaction(database, record, expectedRevision, expectedStateVersion = null, { messagesMode } = {}) {
  assertNoCrossBucketDuplicate(database, record)
  const current = actualRevision(database, record)
  if (expectedRevision !== null && current.revision !== expectedRevision) throw conflict(record.sessionId, expectedRevision, current.revision)
  if (expectedStateVersion !== null && current.stateVersion !== expectedStateVersion) throw stateVersionConflict(record.sessionId, expectedStateVersion, current.stateVersion)
  const revision = current.revision + 1
  // A same-key tombstone whose deletion is below the live CAS chain is
  // collected here: the CAS chain has taken over resurrection protection
  // (tombstones of never-recreated sessions are kept by design).
  cachedStatement(database, 'DELETE FROM session_tombstones WHERE scope = ? AND project_id = ? AND session_id = ?')
    .run(record.scope, record.projectId, record.sessionId)
  const createdAt = current.createdAt || nullableString(record.metadata.createdAt) || record.now
  // The sessions row (FK parent) goes first; message rows reference it.
  cachedStatement(database, UPSERT_SESSION_SQL).run(...sessionRowValues(record, {
    revision,
    createdAt,
    messageCount: current.messageCount,
  }))
  if (record.messages !== undefined) {
    writeMessages(database, record, messagesMode ?? 'replace')
    cachedStatement(database, SYNC_MESSAGE_COUNT_SQL).run(record.scope, record.projectId, record.sessionId)
  }
  const messageCount = record.messages !== undefined
    ? Number(cachedStatement(database, MESSAGE_COUNT_SQL).get(record.scope, record.projectId, record.sessionId).count)
    : current.messageCount
  return { ...record, revision, createdAt, updatedAt: record.now, messageCount }
}

function deleteInTransaction(database, input, expectedRevision, timestamp) {
  const normalizedBucket = bucket(input.scope, input.projectId)
  const record = { ...normalizedBucket, sessionId: nonEmptyString(input.sessionId, 'sessionId') }
  const current = actualRevision(database, record)
  if (expectedRevision !== null && current.revision !== expectedRevision) throw conflict(record.sessionId, expectedRevision, current.revision)
  if (!current.active) return false
  // Message rows follow through the FK ON DELETE CASCADE.
  cachedStatement(database, 'DELETE FROM sessions WHERE scope = ? AND project_id = ? AND session_id = ?')
    .run(record.scope, record.projectId, record.sessionId)
  cachedStatement(database, `INSERT INTO session_tombstones (scope, project_id, session_id, deleted_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(scope, project_id, session_id) DO UPDATE SET deleted_at = excluded.deleted_at`)
    .run(record.scope, record.projectId, record.sessionId, epochMillis(timestamp))
  return true
}

// Space reclamation (schema v11): with auto_vacuum = INCREMENTAL a bounded
// incremental_vacuum returns freed pages to the OS. Best-effort by design —
// it runs OUTSIDE any transaction after a deletion actually removed rows and
// a failure only logs (never fails the caller's operation).
function vacuumAfterDelete(storageHandle) {
  try {
    storageHandle.prepare('PRAGMA incremental_vacuum(512)').all()
  } catch (error) {
    logger.warn('SQLite incremental_vacuum after session delete failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function createSessionStateRepository(storageHandle, { now = () => new Date().toISOString() } = {}) {
  const storage = storageHandle ?? getSqliteStorage()
  if (!storage || typeof storage.prepare !== 'function' || typeof storage.transaction !== 'function') {
    throw new TypeError('Session state repository requires a SQLite storage handle')
  }

  function get(scope, projectId, sessionId) {
    const normalizedBucket = bucket(scope, projectId)
    nonEmptyString(sessionId, 'sessionId')
    return mapRow(cachedStatement(storage, `SELECT ${SESSION_ROW_COLUMNS} FROM sessions WHERE scope = ? AND project_id = ? AND session_id = ?`)
      .get(normalizedBucket.scope, normalizedBucket.projectId, sessionId))
  }

  function findBySessionId(sessionId) {
    nonEmptyString(sessionId, 'sessionId')
    const rows = cachedStatement(storage, `SELECT ${SESSION_ROW_COLUMNS} FROM sessions WHERE session_id = ? ORDER BY scope, project_id`).all(sessionId)
    if (rows.length > 1) throw duplicate(sessionId)
    return mapRow(rows[0])
  }

  function save(input, { expectedRevision = null, expectedStateVersion = null, beforeCommit } = {}) {
    const expected = normalizeRevision(expectedRevision, { optional: true })
    const expectedVersion = normalizeExpectedStateVersion(expectedStateVersion)
    const record = normalizeRecord(input, now())
    return storage.transaction((database) => {
      const result = saveInTransaction(database, record, expected, expectedVersion, { messagesMode: record.messages !== undefined ? 'replace' : undefined })
      beforeCommit?.(database)
      return result
    }, { mode: 'immediate' })
  }

  function replaceMessages(input, messages, { expectedRevision = null, expectedStateVersion = null, beforeCommit } = {}) {
    const expected = normalizeRevision(expectedRevision, { optional: true })
    const expectedVersion = normalizeExpectedStateVersion(expectedStateVersion)
    const record = normalizeRecord({ ...input, messages }, now())
    return storage.transaction((database) => {
      const result = saveInTransaction(database, record, expected, expectedVersion, { messagesMode: 'replace' })
      beforeCommit?.(database)
      return result
    }, { mode: 'immediate' })
  }

  function appendMessages(input, messages, { expectedRevision = null, expectedStateVersion = null, beforeCommit } = {}) {
    const expected = normalizeRevision(expectedRevision, { optional: true })
    const expectedVersion = normalizeExpectedStateVersion(expectedStateVersion)
    const record = normalizeRecord({ ...input, messages }, now())
    return storage.transaction((database) => {
      const result = saveInTransaction(database, record, expected, expectedVersion, { messagesMode: 'append' })
      beforeCommit?.(database)
      return result
    }, { mode: 'immediate' })
  }

  function readMessagesPage({ scope, projectId, sessionId, limit = 100, offset = 0, afterSeq = null } = {}) {
    const normalizedBucket = bucket(scope, projectId)
    nonEmptyString(sessionId, 'sessionId')
    if (!Number.isInteger(limit) || limit < 1 || limit > MESSAGES_PAGE_LIMIT_MAX) throw new TypeError('limit must be an integer between 1 and 5000')
    if (!Number.isInteger(offset) || offset < 0) throw new TypeError('offset must be a non-negative integer')
    if (afterSeq !== null && (!Number.isInteger(afterSeq) || afterSeq < 0)) throw new TypeError('afterSeq must be a non-negative integer or null')
    const where = ['scope = ?', 'project_id = ?', 'session_id = ?']
    const params = [normalizedBucket.scope, normalizedBucket.projectId, sessionId]
    let limitParams = [limit]
    if (afterSeq !== null) {
      where.push('seq > ?')
      params.push(afterSeq)
    } else if (offset > 0) {
      limitParams = [limit, offset]
    }
    const rows = cachedStatement(storage, `SELECT seq, message_json, message_digest FROM session_messages
      WHERE ${where.join(' AND ')} ORDER BY seq ASC LIMIT ?${offset > 0 && afterSeq === null ? ' OFFSET ?' : ''}`)
      .all(...params, ...limitParams)
    const total = Number(cachedStatement(storage, MESSAGE_COUNT_SQL)
      .get(normalizedBucket.scope, normalizedBucket.projectId, sessionId).count)
    const lastSeq = rows.length > 0 ? Number(rows[rows.length - 1].seq) : null
    return {
      messages: rows.map((row) => ({ seq: Number(row.seq), message: JSON.parse(row.message_json), digest: row.message_digest })),
      total,
      limit,
      offset,
      hasMore: afterSeq !== null ? rows.length === limit : offset + rows.length < total,
      nextOffset: offset + rows.length,
      lastSeq,
    }
  }

  function messageCount({ scope, projectId, sessionId }) {
    const normalizedBucket = bucket(scope, projectId)
    nonEmptyString(sessionId, 'sessionId')
    return Number(cachedStatement(storage, MESSAGE_COUNT_SQL)
      .get(normalizedBucket.scope, normalizedBucket.projectId, sessionId).count)
  }

  // O(log n) tail probe: the primary key ends with `seq`, so DESC LIMIT 1
  // rides the index instead of scanning a deep OFFSET.
  function readLastMessage({ scope, projectId, sessionId }) {
    const normalizedBucket = bucket(scope, projectId)
    nonEmptyString(sessionId, 'sessionId')
    const row = cachedStatement(storage, `SELECT seq, message_json, message_digest FROM session_messages
      WHERE scope = ? AND project_id = ? AND session_id = ? ORDER BY seq DESC LIMIT 1`)
      .get(normalizedBucket.scope, normalizedBucket.projectId, sessionId)
    if (!row) return null
    return { seq: Number(row.seq), message: JSON.parse(row.message_json), digest: row.message_digest }
  }

  // Single-row digest probe used by the service's body-only plan check.
  function readMessageDigestAt({ scope, projectId, sessionId, seq }) {
    const normalizedBucket = bucket(scope, projectId)
    nonEmptyString(sessionId, 'sessionId')
    if (!Number.isInteger(seq) || seq < 0) throw new TypeError('seq must be a non-negative integer')
    const row = cachedStatement(storage, `SELECT message_digest FROM session_messages
      WHERE scope = ? AND project_id = ? AND session_id = ? AND seq = ?`)
      .get(normalizedBucket.scope, normalizedBucket.projectId, sessionId, seq)
    return row ? row.message_digest : null
  }

  function deleteRecord({ scope, projectId, sessionId, expectedRevision = null, beforeCommit } = {}) {
    const expected = normalizeRevision(expectedRevision, { optional: true })
    const timestamp = now()
    const deleted = storage.transaction((database) => {
      const result = deleteInTransaction(database, { scope, projectId, sessionId }, expected, timestamp)
      beforeCommit?.(database)
      return result
    }, { mode: 'immediate' })
    if (deleted) vacuumAfterDelete(storage)
    return deleted
  }

  function deleteBySessionId(sessionId, options = {}) {
    const existing = findBySessionId(sessionId)
    if (!existing) {
      if (options.expectedRevision !== undefined && options.expectedRevision !== null) throw conflict(sessionId, options.expectedRevision, 0)
      return false
    }
    return deleteRecord({ ...existing, ...options })
  }

  function applyBatch({ upserts = [], deletes = [] } = {}, { beforeCommit } = {}) {
    if (!Array.isArray(upserts) || !Array.isArray(deletes) || upserts.length + deletes.length === 0) throw new TypeError('Session batch changes are required')
    const timestamp = now()
    const normalizedUpserts = upserts.map((entry) => {
      const input = entry.record ?? entry
      const record = normalizeRecord(entry.messages !== undefined ? { ...input, messages: entry.messages } : input, timestamp)
      return {
        record,
        expectedRevision: normalizeRevision(entry.expectedRevision, { optional: true }),
        expectedStateVersion: normalizeExpectedStateVersion(entry.expectedStateVersion),
        messagesMode: entry.messagesMode ?? (record.messages !== undefined ? 'replace' : undefined),
      }
    })
    const normalizedDeletes = deletes.map((entry) => ({
      input: entry,
      expectedRevision: normalizeRevision(entry.expectedRevision, { optional: true }),
    }))
    const keys = new Set()
    for (const entry of [...normalizedUpserts.map(({ record }) => record), ...normalizedDeletes.map(({ input }) => ({ ...bucket(input.scope, input.projectId), sessionId: input.sessionId }))]) {
      const key = JSON.stringify([entry.scope, entry.projectId || '', entry.sessionId])
      if (keys.has(key)) throw new TypeError(`Duplicate session batch key: ${entry.sessionId}`)
      keys.add(key)
    }
    const result = storage.transaction((database) => {
      const saved = normalizedUpserts.map(({ record, expectedRevision, expectedStateVersion, messagesMode }) => saveInTransaction(database, record, expectedRevision, expectedStateVersion, { messagesMode }))
      const deleted = normalizedDeletes.map(({ input, expectedRevision }) => deleteInTransaction(database, input, expectedRevision, timestamp))
      beforeCommit?.(database)
      return { saved, deleted }
    }, { mode: 'immediate' })
    if (result.deleted.some(Boolean)) vacuumAfterDelete(storage)
    return result
  }

  function saveMany(inputs, options = {}) {
    if (!Array.isArray(inputs) || inputs.length === 0) throw new TypeError('records must be a non-empty array')
    return applyBatch({
      upserts: inputs.map((input) => ({
        record: input.record ?? input,
        expectedRevision: input.expectedRevision,
        expectedStateVersion: input.expectedStateVersion,
      })),
    }, options).saved
  }

  // Fresh-import semantics inside one immediate transaction: every table is
  // wiped, then each record (inline messages or legacy split-marked bodies —
  // both extracted exactly like save) is inserted with revision 1. The
  // count/digest verification runs before COMMIT so a mismatch rolls the
  // wipe back.
  function replaceAll(inputs, { beforeCommit, expectedCount, expectedDigest } = {}) {
    if (!Array.isArray(inputs)) throw new TypeError('records must be an array')
    const timestamp = now()
    const records = inputs.map((input) => normalizeRecord(input, timestamp))
    const ids = new Set()
    for (const record of records) {
      if (ids.has(record.sessionId)) throw new TypeError(`Duplicate session id: ${record.sessionId}`)
      ids.add(record.sessionId)
    }
    const count = storage.transaction((database) => {
      database.exec('DELETE FROM sessions; DELETE FROM session_messages; DELETE FROM session_tombstones;')
      const insert = database.prepare(UPSERT_SESSION_SQL)
      for (const record of records) {
        insert.run(...sessionRowValues(record, {
          revision: 1,
          createdAt: nullableString(record.metadata.createdAt) || timestamp,
          messageCount: record.messages !== undefined ? record.messages.length : 0,
        }))
        if (record.messages !== undefined) writeMessages(database, record, 'replace')
      }
      const digest = verificationDigest(digestRows(database))
      if (expectedCount !== undefined && records.length !== expectedCount) throw new Error('Session state replace count verification failed')
      if (expectedDigest !== undefined && digest !== expectedDigest) throw new Error('Session state replace digest verification failed')
      beforeCommit?.(database)
      return records.length
    }, { mode: 'immediate' })
    vacuumAfterDelete(storage)
    return count
  }

  function exportSnapshot() {
    return storage.transaction((database) => {
      const rows = database.prepare(`SELECT ${SESSION_ROW_COLUMNS} FROM sessions ORDER BY scope, project_id, session_id`).all()
      const messageRows = database.prepare('SELECT scope, project_id, session_id, seq, message_json, message_digest FROM session_messages ORDER BY scope, project_id, session_id, seq').all()
      const groups = new Map()
      for (const row of messageRows) {
        const key = `${row.scope}\0${row.project_id}\0${row.session_id}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(row)
      }
      const records = rows.map((row) => {
        const group = groups.get(`${row.scope}\0${row.project_id}\0${row.session_id}`) || []
        const record = mapRow(row)
        // Old-shape snapshot record: state carries the reassembled messages so
        // consumers (backups, replaceAll round-trips) never see a torn body.
        record.state = { ...record.state, messages: group.map((messageRow) => JSON.parse(messageRow.message_json)) }
        record.messages = group.map((messageRow) => JSON.parse(messageRow.message_json))
        record.messagesDigest = messagesDigest(group)
        return record
      })
      return { records, count: records.length, digest: verificationDigest(digestRows(database)) }
    }, { mode: 'deferred' })
  }

  function count() {
    return Number(storage.prepare('SELECT COUNT(*) AS count FROM sessions').get().count)
  }

  function digest() {
    return verificationDigest(digestRows(storage))
  }

  // SQL-only integrity counts shared by both verification modes (no row
  // bodies are loaded; joins and aggregates run inside SQLite).
  function sqlIntegrityCounts() {
    return {
      duplicateIds: Number(storage.prepare('SELECT COUNT(*) AS count FROM (SELECT session_id FROM sessions GROUP BY session_id HAVING COUNT(*) > 1)').get().count),
      activeTombstones: Number(storage.prepare(`SELECT COUNT(*) AS count FROM session_tombstones t
        JOIN sessions s ON s.scope = t.scope AND s.project_id = t.project_id AND s.session_id = t.session_id`).get().count),
      staleTombstones: Number(storage.prepare(`SELECT COUNT(*) AS count FROM session_tombstones t
        JOIN sessions s ON s.session_id = t.session_id AND NOT (s.scope = t.scope AND s.project_id = t.project_id)`).get().count),
      orphanMessages: Number(storage.prepare(`
        SELECT COUNT(*) AS count FROM session_messages m
        LEFT JOIN sessions s ON s.scope = m.scope AND s.project_id = m.project_id AND s.session_id = m.session_id
        WHERE s.session_id IS NULL
      `).get().count),
      messageCountMismatches: Number(storage.prepare(`
        SELECT COUNT(*) AS count FROM sessions s
        WHERE s.message_count <> (
          SELECT COUNT(*) FROM session_messages m
          WHERE m.scope = s.scope AND m.project_id = s.project_id AND m.session_id = s.session_id
        )
      `).get().count),
    }
  }

  function verifyIntegrity({ quickCheck = false, forceQuickCheck = false } = {}) {
    const counts = sqlIntegrityCounts()
    const structuralOk = counts.duplicateIds === 0 && counts.activeTombstones === 0 && counts.staleTombstones === 0
      && counts.orphanMessages === 0 && counts.messageCountMismatches === 0
    if (quickCheck) {
      // Shared quick_check gate (process cache + marker cadence) — see
      // runSharedSqliteQuickCheck in database.mjs; `forceQuickCheck` is the
      // manual-maintenance escape hatch that always runs a real scan.
      runSharedSqliteQuickCheck(storage, { force: forceQuickCheck === true })
      // Lightweight mode: SQL-level checks only (row-count consistency and
      // the derived message_count projection). Per-row JSON.parse and digest
      // recomputation are left to a full verification (maintenance entry
      // points).
      return {
        ok: structuralOk,
        count: Number(storage.prepare('SELECT COUNT(*) AS count FROM sessions').get().count),
        digest: null,
        ...counts,
        invalidRecords: 0,
        invalidMessageDigests: 0,
        invalidMessageRepresentations: 0,
        lightweight: true,
      }
    }
    const rows = storage.prepare(`SELECT ${SESSION_ROW_COLUMNS} FROM sessions`).all()
    let invalidRecords = 0
    let invalidMessageRepresentations = 0
    for (const row of rows) {
      try {
        const parsedState = JSON.parse(row.body_json)
        JSON.parse(row.meta_json)
        // v2 bodies never carry a messages array (the rows are authoritative).
        if (Array.isArray(parsedState.messages)) invalidMessageRepresentations += 1
        // Canonical round-trip: normalizeRecord must reproduce body_json and
        // meta_json byte-for-byte.
        const record = normalizeRecord(mapRow(row), row.updated_at)
        if (record.stateJson !== row.body_json || record.metadataJson !== row.meta_json) invalidRecords += 1
      } catch {
        invalidRecords += 1
      }
    }
    const messageRows = storage.prepare('SELECT message_json, message_digest FROM session_messages').all()
    let invalidMessageDigests = 0
    for (const row of messageRows) {
      try {
        if (jsonAndDigest(JSON.parse(row.message_json), 'message').digest !== row.message_digest) invalidMessageDigests += 1
      } catch {
        invalidMessageDigests += 1
      }
    }
    return {
      ok: structuralOk && invalidRecords === 0 && invalidMessageDigests === 0 && invalidMessageRepresentations === 0,
      count: rows.length,
      digest: verificationDigest(digestRows(storage)),
      ...counts,
      invalidRecords,
      invalidMessageDigests,
      invalidMessageRepresentations,
    }
  }

  // Truncates the WAL back into the main database file. A bulk import (or
  // repeated failed migration attempts) can leave the WAL far larger than the
  // database itself; TRUNCATE resets it to zero bytes once the checkpoint
  // completes. The returned pragma row carries `busy` (nonzero when another
  // reader held the WAL and some frames were skipped — non-fatal).
  function checkpointWal() {
    return storage.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()
  }

  return Object.freeze({
    get,
    findBySessionId,
    save,
    replaceMessages,
    appendMessages,
    readMessagesPage,
    messageCount,
    readLastMessage,
    readMessageDigestAt,
    saveMany,
    applyBatch,
    delete: deleteRecord,
    deleteBySessionId,
    replaceAll,
    exportSnapshot,
    verifyIntegrity,
    count,
    digest,
    checkpointWal,
  })
}

// Digest rows for the canonical snapshot digest: one line per session with
// the body/meta digests recomputed from the stored canonical JSON (they are
// not persisted as columns in schema v11 — bodies are small by design, so the
// recompute is cheap even for maintenance-time full scans) and the per-
// session aggregate message digest from the stored rows.
function digestRows(database) {
  const rows = database.prepare('SELECT scope, project_id, session_id, body_json, meta_json FROM sessions').all()
  const groups = new Map()
  for (const row of database.prepare('SELECT scope, project_id, session_id, seq, message_digest FROM session_messages ORDER BY scope, project_id, session_id, seq').all()) {
    const key = `${row.scope}\0${row.project_id}\0${row.session_id}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return rows.map((row) => ({
    scope: row.scope,
    project_id: row.project_id,
    session_id: row.session_id,
    state_digest: createHash('sha256').update(row.body_json).digest('hex'),
    metadata_digest: createHash('sha256').update(row.meta_json).digest('hex'),
    messages_digest: messagesDigest(groups.get(`${row.scope}\0${row.project_id}\0${row.session_id}`) || []),
  }))
}
