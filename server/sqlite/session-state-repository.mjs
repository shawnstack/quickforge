import { createHash } from 'node:crypto'
import { getSqliteStorage } from './database.mjs'

const STATE_COLUMNS = `
  scope, project_id, session_id, revision, state_version, state_json, state_digest,
  metadata_json, metadata_digest, created_at, updated_at
`

// F9 split-message representation: a session whose messages live in
// `session_messages` stores a body without the `messages` key plus this marker.
export const MESSAGES_SPLIT_VALUE = 'split'
export const MESSAGES_PAGE_LIMIT_MAX = 5000

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
// values hash identically to their stored (split) representation.
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
// separate message rows contributes an empty `messagesDigest`.
export function snapshotDigestLine(scope, projectId, sessionId, stateDigest, metadataDigest, messagesDigestValue = '') {
  return `${scope}\0${projectId || ''}\0${sessionId}\0${stateDigest}\0${metadataDigest}\0${messagesDigestValue || ''}`
}

// Split a (possibly assembled) state into its stored body and message array.
// - `messageStorage: 'split'` bodies: messages are stripped out and returned.
// - inline `messages` bodies: kept whole (non-split) and return no messages.
// Never mutates the input and never forces a marker onto legacy bodies.
export function splitStateForStorage(state) {
  const copy = structuredClone(state)
  if (!isPlainObject(copy)) throw new TypeError('state must be a plain object')
  if (copy.messageStorage === MESSAGES_SPLIT_VALUE) {
    const messages = Array.isArray(copy.messages) ? copy.messages : []
    delete copy.messages
    return { storedState: copy, messages }
  }
  return { storedState: copy, messages: undefined }
}

function encodeMessage(message, timestamp) {
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
    created: timestamp,
    updated: timestamp,
  }
}

function encodeMessages(messages, timestamp) {
  if (!Array.isArray(messages)) throw new TypeError('messages must be an array')
  return messages.map((message) => encodeMessage(message, timestamp))
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

  // Optional split-message payload: when `input.messages` is provided the body
  // is stored without `messages` and carries the split marker; the message rows
  // are written in the same transaction by the caller-selected mode.
  const messages = input.messages !== undefined ? encodeMessages(input.messages, timestamp) : undefined
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
    state: JSON.parse(row.state_json),
    stateDigest: row.state_digest,
    metadata: JSON.parse(row.metadata_json),
    metadataDigest: row.metadata_digest,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function nullableString(value) {
  return typeof value === 'string' ? value : null
}

function nullableInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null
}

// Cutover importers precompile these once per batch and pass the statement in;
// runtime paths omit `statement` and prepare per call exactly as before.
const UPSERT_SESSION_INDEX_SQL = `
  INSERT INTO session_index (
    scope, project_id, session_id, created_at, last_modified, message_count,
    pinned_at, archived_at, is_pinned, is_archived, state_version,
    metadata_json, metadata_digest, indexed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

const ENQUEUE_SESSION_MIRROR_SQL = `
  INSERT INTO session_json_mirror_queue (
    scope, project_id, session_id, operation, revision, state_json, metadata_json, attempts, last_error, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
  ON CONFLICT(scope, project_id, session_id) DO UPDATE SET
    operation = excluded.operation,
    revision = excluded.revision,
    state_json = excluded.state_json,
    metadata_json = excluded.metadata_json,
    attempts = 0,
    last_error = NULL,
    updated_at = excluded.updated_at
`

function upsertIndex(database, record, statement = null) {
  const metadata = record.metadata
  const insert = statement ?? database.prepare(UPSERT_SESSION_INDEX_SQL)
  insert.run(
    record.scope, record.projectId, record.sessionId,
    nullableString(metadata.createdAt), nullableString(metadata.lastModified), nullableInteger(metadata.messageCount),
    nullableString(metadata.pinnedAt), nullableString(metadata.archivedAt), metadata.pinnedAt ? 1 : 0, metadata.archivedAt ? 1 : 0,
    record.stateVersion, record.metadataJson, record.metadataDigest, record.now,
  )
}

function enqueueMirror(database, record, operation, revision, statement = null) {
  const insert = statement ?? database.prepare(ENQUEUE_SESSION_MIRROR_SQL)
  insert.run(
    record.scope, record.projectId, record.sessionId, operation, revision,
    operation === 'upsert' ? record.stateJson : null,
    operation === 'upsert' ? record.metadataJson : null,
    record.now,
  )
}

function digestRows(database) {
  const rows = database.prepare('SELECT scope, project_id, session_id, state_digest, metadata_digest FROM session_states').all()
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
    state_digest: row.state_digest,
    metadata_digest: row.metadata_digest,
    messages_digest: messagesDigest(groups.get(`${row.scope}\0${row.project_id}\0${row.session_id}`) || []),
  }))
}

function digestFromLines(lines) {
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
  const active = database.prepare('SELECT revision, state_version, created_at FROM session_states WHERE scope = ? AND project_id = ? AND session_id = ?')
    .get(record.scope, record.projectId, record.sessionId)
  if (active) return { revision: Number(active.revision), stateVersion: Number(active.state_version), createdAt: active.created_at, active: true }
  const tombstone = database.prepare('SELECT revision FROM session_state_tombstones WHERE scope = ? AND project_id = ? AND session_id = ?')
    .get(record.scope, record.projectId, record.sessionId)
  return { revision: Number(tombstone?.revision || 0), stateVersion: null, createdAt: null, active: false }
}

function assertNoCrossBucketDuplicate(database, record) {
  const other = database.prepare(`SELECT scope, project_id FROM session_states
    WHERE session_id = ? AND NOT (scope = ? AND project_id = ?) LIMIT 1`)
    .get(record.sessionId, record.scope, record.projectId)
  if (other) throw duplicate(record.sessionId)
}

function writeMessages(database, record, mode, timestamp) {
  if (record.messages === undefined) return
  if (mode !== 'replace' && mode !== 'append') throw new TypeError('messagesMode must be replace or append')
  const params = [record.scope, record.projectId, record.sessionId]
  if (mode === 'replace') {
    database.prepare('DELETE FROM session_messages WHERE scope = ? AND project_id = ? AND session_id = ?').run(...params)
    const insert = database.prepare(`
      INSERT INTO session_messages (scope, project_id, session_id, seq, message_id, message_json, message_digest, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    record.messages.forEach((message, seq) => {
      insert.run(record.scope, record.projectId, record.sessionId, seq, message.messageId, message.messageJson, message.messageDigest, timestamp, timestamp)
    })
    return
  }
  const maxSeq = Number(database.prepare('SELECT COALESCE(MAX(seq), -1) AS max_seq FROM session_messages WHERE scope = ? AND project_id = ? AND session_id = ?').get(...params).max_seq)
  const existingIds = new Set(database.prepare('SELECT message_id FROM session_messages WHERE scope = ? AND project_id = ? AND session_id = ? AND message_id IS NOT NULL').all(...params).map((row) => row.message_id))
  const insert = database.prepare(`
    INSERT INTO session_messages (scope, project_id, session_id, seq, message_id, message_json, message_digest, created, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  let seq = maxSeq + 1
  for (const message of record.messages) {
    if (message.messageId !== null && existingIds.has(message.messageId)) continue
    insert.run(record.scope, record.projectId, record.sessionId, seq, message.messageId, message.messageJson, message.messageDigest, timestamp, timestamp)
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
  database.prepare('DELETE FROM session_state_tombstones WHERE scope = ? AND project_id = ? AND session_id = ?')
    .run(record.scope, record.projectId, record.sessionId)
  if (record.messages !== undefined) writeMessages(database, record, messagesMode ?? 'replace', record.now)
  database.prepare(`
    INSERT INTO session_states (${STATE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, project_id, session_id) DO UPDATE SET
      revision = excluded.revision,
      state_version = excluded.state_version,
      state_json = excluded.state_json,
      state_digest = excluded.state_digest,
      metadata_json = excluded.metadata_json,
      metadata_digest = excluded.metadata_digest,
      updated_at = excluded.updated_at
  `).run(
    record.scope, record.projectId, record.sessionId, revision, record.stateVersion,
    record.stateJson, record.stateDigest, record.metadataJson, record.metadataDigest,
    current.createdAt || record.now, record.now,
  )
  upsertIndex(database, record)
  enqueueMirror(database, record, 'upsert', revision)
  return { ...record, revision, createdAt: current.createdAt || record.now, updatedAt: record.now }
}

function deleteInTransaction(database, input, expectedRevision, timestamp) {
  const normalizedBucket = bucket(input.scope, input.projectId)
  const record = { ...normalizedBucket, sessionId: nonEmptyString(input.sessionId, 'sessionId') }
  const current = actualRevision(database, record)
  if (expectedRevision !== null && current.revision !== expectedRevision) throw conflict(record.sessionId, expectedRevision, current.revision)
  if (!current.active) return false
  const deletionRevision = current.revision + 1
  database.prepare('DELETE FROM session_states WHERE scope = ? AND project_id = ? AND session_id = ?')
    .run(record.scope, record.projectId, record.sessionId)
  database.prepare('DELETE FROM session_messages WHERE scope = ? AND project_id = ? AND session_id = ?')
    .run(record.scope, record.projectId, record.sessionId)
  database.prepare('DELETE FROM session_index WHERE scope = ? AND project_id = ? AND session_id = ?')
    .run(record.scope, record.projectId, record.sessionId)
  database.prepare(`INSERT INTO session_state_tombstones (scope, project_id, session_id, revision, deleted_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(scope, project_id, session_id) DO UPDATE SET revision = excluded.revision, deleted_at = excluded.deleted_at`)
    .run(record.scope, record.projectId, record.sessionId, deletionRevision, timestamp)
  enqueueMirror(database, { ...record, stateJson: null, metadataJson: null, now: timestamp }, 'delete', deletionRevision)
  return true
}

function updateStorageState(database, values) {
  if (!values) return
  database.prepare(`UPDATE session_storage_state SET phase = ?, state_count = ?, digest = ?, backup_file = ?, diagnostic_json = ?, updated_at = ?
    WHERE singleton = 1`).run(
    values.phase,
    values.stateCount ?? null,
    values.digest ?? null,
    values.backupFile ?? null,
    values.diagnostic ? JSON.stringify(values.diagnostic) : null,
    values.updatedAt,
  )
}

export function createSessionStateRepository(storageHandle, { now = () => new Date().toISOString() } = {}) {
  const storage = storageHandle ?? getSqliteStorage()
  if (!storage || typeof storage.prepare !== 'function' || typeof storage.transaction !== 'function') {
    throw new TypeError('Session state repository requires a SQLite storage handle')
  }

  function get(scope, projectId, sessionId) {
    const normalizedBucket = bucket(scope, projectId)
    nonEmptyString(sessionId, 'sessionId')
    return mapRow(storage.prepare(`SELECT ${STATE_COLUMNS} FROM session_states WHERE scope = ? AND project_id = ? AND session_id = ?`)
      .get(normalizedBucket.scope, normalizedBucket.projectId, sessionId))
  }

  function findBySessionId(sessionId) {
    nonEmptyString(sessionId, 'sessionId')
    const rows = storage.prepare(`SELECT ${STATE_COLUMNS} FROM session_states WHERE session_id = ? ORDER BY scope, project_id`).all(sessionId)
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
      const current = actualRevision(database, record)
      if (current.active) {
        const stored = database.prepare('SELECT state_json FROM session_states WHERE scope = ? AND project_id = ? AND session_id = ?')
          .get(record.scope, record.projectId, record.sessionId)
        const parsed = JSON.parse(stored.state_json)
        if (Array.isArray(parsed.messages)) throw new TypeError('Session is not split; use replaceMessages to split it first')
      }
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
    const rows = storage.prepare(`SELECT seq, message_id, message_json, message_digest FROM session_messages
      WHERE ${where.join(' AND ')} ORDER BY seq ASC LIMIT ?${offset > 0 && afterSeq === null ? ' OFFSET ?' : ''}`)
      .all(...params, ...limitParams)
    const total = Number(storage.prepare('SELECT COUNT(*) AS count FROM session_messages WHERE scope = ? AND project_id = ? AND session_id = ?')
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
    return Number(storage.prepare('SELECT COUNT(*) AS count FROM session_messages WHERE scope = ? AND project_id = ? AND session_id = ?')
      .get(normalizedBucket.scope, normalizedBucket.projectId, sessionId).count)
  }

  function deleteRecord({ scope, projectId, sessionId, expectedRevision = null, beforeCommit } = {}) {
    const expected = normalizeRevision(expectedRevision, { optional: true })
    const timestamp = now()
    return storage.transaction((database) => {
      const result = deleteInTransaction(database, { scope, projectId, sessionId }, expected, timestamp)
      beforeCommit?.(database)
      return result
    }, { mode: 'immediate' })
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
      const messages = entry.messages !== undefined ? entry.messages : input.messages
      const record = normalizeRecord(messages === undefined ? input : { ...input, messages }, timestamp)
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
    return storage.transaction((database) => {
      const saved = normalizedUpserts.map(({ record, expectedRevision, expectedStateVersion, messagesMode }) => saveInTransaction(database, record, expectedRevision, expectedStateVersion, { messagesMode }))
      const deleted = normalizedDeletes.map(({ input, expectedRevision }) => deleteInTransaction(database, input, expectedRevision, timestamp))
      beforeCommit?.(database)
      return { saved, deleted }
    }, { mode: 'immediate' })
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

  function replaceAll(inputs, { beforeCommit, storageState, expectedCount, expectedDigest, mirrorDeletes = [] } = {}) {
    if (!Array.isArray(inputs)) throw new TypeError('records must be an array')
    if (!Array.isArray(mirrorDeletes)) throw new TypeError('mirrorDeletes must be an array')
    const timestamp = now()
    const records = inputs.map((input) => {
      let messages = input.messages
      if (messages === undefined && input.state?.messageStorage === 'split') {
        messages = Array.isArray(input.state.messages) ? input.state.messages : []
      }
      return normalizeRecord(messages === undefined ? input : { ...input, messages }, timestamp)
    })
    const ids = new Set()
    for (const record of records) {
      if (ids.has(record.sessionId)) throw new TypeError(`Duplicate session id: ${record.sessionId}`)
      ids.add(record.sessionId)
    }
    const deletes = mirrorDeletes.map((input) => ({ ...bucket(input.scope, input.projectId), sessionId: nonEmptyString(input.sessionId, 'sessionId') }))
    const recordKeys = new Set(records.map((record) => JSON.stringify([record.scope, record.projectId, record.sessionId])))
    for (const entry of deletes) {
      if (recordKeys.has(JSON.stringify([entry.scope, entry.projectId, entry.sessionId]))) {
        throw new TypeError(`mirrorDeletes entry duplicates a record key: ${entry.sessionId}`)
      }
    }
    return storage.transaction((database) => {
      database.exec('DELETE FROM session_states; DELETE FROM session_state_tombstones; DELETE FROM session_index; DELETE FROM session_json_mirror_queue; DELETE FROM session_messages;')
      const insert = database.prepare(`INSERT INTO session_states (${STATE_COLUMNS}) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`)
      const insertIndex = database.prepare(UPSERT_SESSION_INDEX_SQL)
      const insertMirror = database.prepare(ENQUEUE_SESSION_MIRROR_SQL)
      for (const record of records) {
        insert.run(record.scope, record.projectId, record.sessionId, record.stateVersion, record.stateJson, record.stateDigest, record.metadataJson, record.metadataDigest, timestamp, timestamp)
        if (record.messages !== undefined) writeMessages(database, record, 'replace', timestamp)
        upsertIndex(database, record, insertIndex)
        enqueueMirror(database, record, 'upsert', 1, insertMirror)
      }
      // Orphan deletes intentionally have no session_states/session_index rows
      // (they were dropped as stale residue); enqueue mirror deletes so the
      // drain physically clears leftover JSON files (idempotent when absent).
      for (const entry of deletes) {
        enqueueMirror(database, { ...entry, stateJson: null, metadataJson: null, now: timestamp }, 'delete', 1, insertMirror)
      }
      const digest = verificationDigest(digestRows(database))
      if (expectedCount !== undefined && records.length !== expectedCount) throw new Error('Session state replace count verification failed')
      if (expectedDigest !== undefined && digest !== expectedDigest) throw new Error('Session state replace digest verification failed')
      updateStorageState(database, storageState ? { ...storageState, stateCount: records.length, digest, updatedAt: timestamp } : null)
      beforeCommit?.(database)
      return records.length
    }, { mode: 'immediate' })
  }

  // Streaming equivalent of replaceAll for sources that cannot be materialized
  // in memory (large JSON cutover imports). Consumes a sync or async iterable
  // record-by-record inside one immediate transaction; only the per-record
  // digest lines accumulate. `storage.transaction` requires a synchronous
  // callback, so the transaction is managed manually: any error — including
  // one thrown by the iterator mid-stream — rolls everything back, preserving
  // replaceAll's all-or-nothing semantics. Callers must hold the session
  // state maintenance lock (a concurrent writer hitting the open transaction
  // fails loudly instead of interleaving).
  async function replaceAllStream(recordIterable, { beforeCommit, storageState, expectedCount, expectedDigest, mirrorDeletes = [] } = {}) {
    if (!recordIterable || (typeof recordIterable[Symbol.asyncIterator] !== 'function' && typeof recordIterable[Symbol.iterator] !== 'function')) {
      throw new TypeError('records must be a sync or async iterable')
    }
    if (!Array.isArray(mirrorDeletes)) throw new TypeError('mirrorDeletes must be an array')
    const timestamp = now()
    const deletes = mirrorDeletes.map((input) => ({ ...bucket(input.scope, input.projectId), sessionId: nonEmptyString(input.sessionId, 'sessionId') }))
    // Record keys arrive incrementally while streaming, so the mirrorDeletes
    // conflict check runs per record against the precomputed delete keys (the
    // mirror image of replaceAll's post-hoc set comparison).
    const deleteKeys = new Set(deletes.map((entry) => JSON.stringify([entry.scope, entry.projectId, entry.sessionId])))
    storage.exec('BEGIN IMMEDIATE')
    let count = 0
    const digestLines = []
    try {
      storage.exec('DELETE FROM session_states; DELETE FROM session_state_tombstones; DELETE FROM session_index; DELETE FROM session_json_mirror_queue; DELETE FROM session_messages;')
      const insert = storage.prepare(`INSERT INTO session_states (${STATE_COLUMNS}) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`)
      const insertIndex = storage.prepare(UPSERT_SESSION_INDEX_SQL)
      const insertMirror = storage.prepare(ENQUEUE_SESSION_MIRROR_SQL)
      const ids = new Set()
      for await (const input of recordIterable) {
        let messages = input.messages
        if (messages === undefined && input.state?.messageStorage === 'split') {
          messages = Array.isArray(input.state.messages) ? input.state.messages : []
        }
        const record = normalizeRecord(messages === undefined ? input : { ...input, messages }, timestamp)
        if (ids.has(record.sessionId)) throw new TypeError(`Duplicate session id: ${record.sessionId}`)
        ids.add(record.sessionId)
        if (deleteKeys.has(JSON.stringify([record.scope, record.projectId, record.sessionId]))) {
          throw new TypeError(`mirrorDeletes entry duplicates a record key: ${record.sessionId}`)
        }
        insert.run(record.scope, record.projectId, record.sessionId, record.stateVersion, record.stateJson, record.stateDigest, record.metadataJson, record.metadataDigest, timestamp, timestamp)
        if (record.messages !== undefined) writeMessages(storage, record, 'replace', timestamp)
        upsertIndex(storage, record, insertIndex)
        enqueueMirror(storage, record, 'upsert', 1, insertMirror)
        // Streamed imports are non-split (messages inline, none in
        // session_messages), so the empty messages digest matches what
        // digestRows computes for freshly imported non-split rows.
        digestLines.push(snapshotDigestLine(record.scope, record.projectId, record.sessionId, record.stateDigest, record.metadataDigest, ''))
        count += 1
      }
      // Orphan deletes intentionally have no session_states/session_index rows;
      // see replaceAll for the mirror-drain rationale.
      for (const entry of deletes) {
        enqueueMirror(storage, { ...entry, stateJson: null, metadataJson: null, now: timestamp }, 'delete', 1, insertMirror)
      }
      const digest = digestFromLines(digestLines)
      if (expectedCount !== undefined && count !== expectedCount) throw new Error('Session state replace count verification failed')
      if (expectedDigest !== undefined && digest !== expectedDigest) throw new Error('Session state replace digest verification failed')
      updateStorageState(storage, storageState ? { ...storageState, stateCount: count, digest, updatedAt: timestamp } : null)
      beforeCommit?.(storage)
      storage.exec('COMMIT')
      return count
    } catch (error) {
      try { storage.exec('ROLLBACK') } catch { /* transaction already closed */ }
      throw error
    }
  }

  function exportSnapshot() {
    return storage.transaction((database) => {
      const rows = database.prepare(`SELECT ${STATE_COLUMNS} FROM session_states ORDER BY scope, project_id, session_id`).all()
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
        if (group.length > 0) record.messages = group.map((messageRow) => JSON.parse(messageRow.message_json))
        record.messagesDigest = messagesDigest(group)
        return record
      })
      return { records, count: records.length, digest: verificationDigest(digestRows(database)) }
    }, { mode: 'deferred' })
  }

  function count() {
    return Number(storage.prepare('SELECT COUNT(*) AS count FROM session_states').get().count)
  }

  function digest() {
    return verificationDigest(digestRows(storage))
  }

  // SQL-only integrity counts shared by both verification modes (no row
  // bodies are loaded; joins and aggregates run inside SQLite).
  function sqlIntegrityCounts() {
    return {
      missingIndex: Number(storage.prepare(`
        SELECT COUNT(*) AS count FROM session_states s
        LEFT JOIN session_index i ON i.scope = s.scope AND i.project_id = s.project_id AND i.session_id = s.session_id
        WHERE i.session_id IS NULL OR i.metadata_digest <> s.metadata_digest OR i.state_version <> s.state_version
      `).get().count),
      orphanIndex: Number(storage.prepare(`
        SELECT COUNT(*) AS count FROM session_index i
        LEFT JOIN session_states s ON s.scope = i.scope AND s.project_id = i.project_id AND s.session_id = i.session_id
        WHERE s.session_id IS NULL
      `).get().count),
      duplicateIds: Number(storage.prepare('SELECT COUNT(*) AS count FROM (SELECT session_id FROM session_states GROUP BY session_id HAVING COUNT(*) > 1)').get().count),
      activeTombstones: Number(storage.prepare(`SELECT COUNT(*) AS count FROM session_state_tombstones t
        JOIN session_states s ON s.scope = t.scope AND s.project_id = t.project_id AND s.session_id = t.session_id`).get().count),
      staleTombstones: Number(storage.prepare(`SELECT COUNT(*) AS count FROM session_state_tombstones t
        JOIN session_states s ON s.session_id = t.session_id AND NOT (s.scope = t.scope AND s.project_id = t.project_id)`).get().count),
      orphanMessages: Number(storage.prepare(`
        SELECT COUNT(*) AS count FROM session_messages m
        LEFT JOIN session_states s ON s.scope = m.scope AND s.project_id = m.project_id AND s.session_id = m.session_id
        WHERE s.session_id IS NULL
      `).get().count),
    }
  }

  function verifyIntegrity({ quickCheck = false } = {}) {
    const counts = sqlIntegrityCounts()
    if (quickCheck) {
      const result = storage.prepare('PRAGMA quick_check').all().map((row) => row.quick_check)
      if (result.length !== 1 || result[0] !== 'ok') throw new Error(`SQLite quick_check failed: ${result.join(', ')}`)
      // Lightweight mode: SQL-level checks only. Per-row JSON.parse and digest
      // recomputation (invalidRecords/invalidDigests/invalidIndexDigests/
      // invalidMessageDigests/invalidMessageRepresentations) and the snapshot
      // digest are left to a full verification (maintenance entry points).
      return {
        ok: counts.missingIndex === 0 && counts.orphanIndex === 0 && counts.duplicateIds === 0
          && counts.activeTombstones === 0 && counts.staleTombstones === 0 && counts.orphanMessages === 0,
        count: Number(storage.prepare('SELECT COUNT(*) AS count FROM session_states').get().count),
        digest: null,
        ...counts,
        invalidRecords: 0,
        invalidDigests: 0,
        invalidIndexDigests: 0,
        invalidMessageDigests: 0,
        invalidMessageRepresentations: 0,
        lightweight: true,
      }
    }
    const rows = storage.prepare(`SELECT ${STATE_COLUMNS} FROM session_states`).all()
    let invalidRecords = 0
    let invalidDigests = 0
    let invalidMessageRepresentations = 0
    for (const row of rows) {
      try {
        const stateEncoded = jsonAndDigest(JSON.parse(row.state_json), 'state')
        const metadataEncoded = jsonAndDigest(JSON.parse(row.metadata_json), 'metadata')
        if (stateEncoded.digest !== row.state_digest || metadataEncoded.digest !== row.metadata_digest) invalidDigests += 1
        const record = normalizeRecord(mapRow(row), row.updated_at)
        if (record.stateJson !== row.state_json || record.metadataJson !== row.metadata_json) invalidRecords += 1
        const parsedState = JSON.parse(row.state_json)
        if (parsedState.messageStorage === 'split' && Array.isArray(parsedState.messages)) invalidMessageRepresentations += 1
      } catch {
        invalidRecords += 1
      }
    }
    const messageRows = storage.prepare('SELECT * FROM session_messages').all()
    let invalidMessageDigests = 0
    for (const row of messageRows) {
      try {
        if (jsonAndDigest(JSON.parse(row.message_json), 'message').digest !== row.message_digest) invalidMessageDigests += 1
      } catch {
        invalidMessageDigests += 1
      }
    }
    const indexRows = storage.prepare('SELECT metadata_json, metadata_digest FROM session_index').all()
    let invalidIndexDigests = 0
    for (const row of indexRows) {
      try {
        if (jsonAndDigest(JSON.parse(row.metadata_json), 'metadata').digest !== row.metadata_digest) invalidIndexDigests += 1
      } catch {
        invalidIndexDigests += 1
      }
    }
    const { missingIndex, orphanIndex, duplicateIds, activeTombstones, staleTombstones, orphanMessages } = counts
    return {
      ok: missingIndex === 0 && orphanIndex === 0 && duplicateIds === 0 && activeTombstones === 0 && staleTombstones === 0
        && invalidRecords === 0 && invalidDigests === 0 && invalidIndexDigests === 0
        && invalidMessageDigests === 0 && orphanMessages === 0 && invalidMessageRepresentations === 0,
      count: rows.length,
      digest: verificationDigest(digestRows(storage)),
      missingIndex,
      orphanIndex,
      duplicateIds,
      activeTombstones,
      staleTombstones,
      invalidRecords,
      invalidDigests,
      invalidIndexDigests,
      invalidMessageDigests,
      orphanMessages,
      invalidMessageRepresentations,
    }
  }

  function rebuildIndex() {
    return storage.transaction((database) => {
      database.exec('DELETE FROM session_index')
      const rows = database.prepare(`SELECT ${STATE_COLUMNS} FROM session_states ORDER BY scope, project_id, session_id`).all()
      for (const row of rows) upsertIndex(database, normalizeRecord(mapRow(row), row.updated_at))
      const indexCount = Number(database.prepare('SELECT COUNT(*) AS count FROM session_index').get().count)
      if (indexCount !== rows.length) throw new Error('Session index rebuild verification failed')
      return rows.length
    }, { mode: 'immediate' })
  }

  function listMirrorQueue({ limit } = {}) {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new TypeError('limit must be a positive integer')
    // The queue rows carry full state_json payloads, so callers draining large
    // queues page through with `limit` instead of loading every row at once.
    const rows = storage.prepare(`SELECT * FROM session_json_mirror_queue ORDER BY updated_at, scope, project_id, session_id${limit !== undefined ? ' LIMIT ?' : ''}`)
      .all(...(limit !== undefined ? [limit] : []))
    return rows.map((row) => ({
      scope: row.scope,
      projectId: row.scope === 'project' ? row.project_id : null,
      sessionId: row.session_id,
      operation: row.operation,
      revision: Number(row.revision),
      state: row.state_json ? JSON.parse(row.state_json) : null,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
      attempts: Number(row.attempts),
      lastError: row.last_error,
      updatedAt: row.updated_at,
    }))
  }

  function countMirrorQueue() {
    return Number(storage.prepare('SELECT COUNT(*) AS count FROM session_json_mirror_queue').get().count)
  }

  function acknowledgeMirror(entry) {
    return Number(storage.prepare('DELETE FROM session_json_mirror_queue WHERE scope = ? AND project_id = ? AND session_id = ? AND revision = ?')
      .run(entry.scope, entry.scope === 'project' ? entry.projectId : '', entry.sessionId, entry.revision).changes) === 1
  }

  function failMirror(entry, error) {
    storage.prepare(`UPDATE session_json_mirror_queue SET attempts = attempts + 1, last_error = ?, updated_at = ?
      WHERE scope = ? AND project_id = ? AND session_id = ? AND revision = ?`)
      .run(String(error?.message || error).slice(0, 1000), now(), entry.scope, entry.scope === 'project' ? entry.projectId : '', entry.sessionId, entry.revision)
  }

  return Object.freeze({
    get,
    findBySessionId,
    save,
    replaceMessages,
    appendMessages,
    readMessagesPage,
    messageCount,
    saveMany,
    applyBatch,
    delete: deleteRecord,
    deleteBySessionId,
    replaceAll,
    replaceAllStream,
    exportSnapshot,
    verifyIntegrity,
    count,
    digest,
    rebuildIndex,
    listMirrorQueue,
    countMirrorQueue,
    acknowledgeMirror,
    failMirror,
  })
}
