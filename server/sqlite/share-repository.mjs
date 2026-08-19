import { createHash, randomBytes } from 'node:crypto'
import { getSqliteStorage, runSharedSqliteQuickCheck } from './database.mjs'

// F10 share storage: `share_sessions` (strictly mapped columns + `extra_json`
// for opaque/unknown fields) and `share_tokens` (independent token table with
// UNIQUE(share_id, token_hash) and a ≤50 cap enforced at write time). The
// snapshot digest algorithm is shared with the JSON cutover side so a JSON
// import and its SQLite copy always hash identically.
export const MAX_SHARE_TOKENS = 50
export const SHARE_ID_PREFIX = 'qfs_'
export const SHARE_ID_PATTERN = /^qfs_[A-Za-z0-9_-]{16,80}$/

const SHARE_COLUMNS = `
  share_id, session_id, permission, title_snapshot, scope, project_id,
  password_hash, password_salt, password_version, auth_version, allow_cloud_usage,
  created_at, updated_at, expires_at, revoked_at, superseded_at,
  access_count, last_accessed_at, created_from_host, last_updated_from_host,
  revision, record_digest, deleted_at, extra_json
`

// Fields modeled as columns; anything else on the JSON record is preserved
// verbatim in `extra_json` and restored on read/export (opaque roundtrip).
const KNOWN_FIELDS = new Set([
  'id', 'sessionId', 'permission', 'titleSnapshot', 'scope', 'projectId',
  'passwordHash', 'passwordSalt', 'passwordVersion', 'authVersion',
  'allowCloudUsage', 'createdAt', 'updatedAt', 'expiresAt', 'revokedAt',
  'supersededAt', 'accessCount', 'lastAccessedAt', 'createdFromHost',
  'lastUpdatedFromHost', 'tokens', 'tokenHash', 'tokenIssuedAt', 'tokenExpiresAt',
])

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalize(value[key])]))
}

function invalid(message) {
  const error = new Error(message)
  error.statusCode = 400
  error.errorCode = 'SHARE_INVALID_INPUT'
  return error
}

function notFound(shareId) {
  const error = new Error(`Share not found: ${shareId}`)
  error.statusCode = 404
  error.errorCode = 'SHARE_NOT_FOUND'
  return error
}

function conflict(shareId, expectedRevision, actualRevision) {
  const error = new Error(`Share state conflict for ${shareId}`)
  error.statusCode = 409
  error.errorCode = 'SHARE_STATE_CONFLICT'
  error.expectedRevision = expectedRevision
  error.actualRevision = actualRevision
  return error
}

function notActive(shareId, reason) {
  const error = new Error(`Share ${shareId} is ${reason}`)
  error.statusCode = 410
  error.errorCode = 'SHARE_NOT_ACTIVE'
  error.reason = reason
  return error
}

function optionalTimestamp(value, field) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw invalid(`Invalid ${field}`)
  return value
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${field} is required`)
  return value
}

export function assertSafeShareId(shareId) {
  return nonEmptyString(shareId, 'shareId')
}

// Normalize one JSON-shape share record (camelCase, exactly the format written
// by share-store.mjs) into the canonical repository record. Shared with the
// JSON cutover snapshot builder so both sides validate identically.
export function normalizeShareRecord(input) {
  if (!isPlainObject(input)) throw invalid('Share record must be an object')
  const id = input.id
  if (typeof id !== 'string' || !SHARE_ID_PATTERN.test(id)) throw invalid('Invalid share id')
  if (input.sessionId !== undefined && typeof input.sessionId !== 'string') throw invalid('sessionId must be a string')

  const sessionId = nonEmptyString(input.sessionId, 'sessionId')
  const permission = input.permission
  if (permission !== 'read' && permission !== 'operate') throw invalid('Invalid share permission')

  const scope = input.scope === 'project' ? 'project' : 'global'
  let projectId
  if (scope === 'project') {
    projectId = nonEmptyString(input.projectId, 'projectId')
  } else if (input.projectId !== undefined && input.projectId !== null && input.projectId !== '') {
    throw invalid('Global shares cannot have a projectId')
  }

  const passwordHash = typeof input.passwordHash === 'string' && input.passwordHash.trim() ? input.passwordHash : undefined
  const passwordSalt = typeof input.passwordSalt === 'string' && input.passwordSalt.trim() ? input.passwordSalt : undefined
  const passwordVersion = input.passwordVersion === undefined ? undefined : input.passwordVersion
  if (passwordHash && !passwordSalt) throw invalid('Share password hash requires a password salt')
  if (!passwordHash && passwordSalt) throw invalid('Share password salt requires a password hash')
  if (passwordVersion !== undefined && (!Number.isInteger(passwordVersion) || passwordVersion < 1)) throw invalid('Share passwordVersion must be a positive integer')

  const authVersion = input.authVersion === undefined ? 1 : input.authVersion
  if (!Number.isInteger(authVersion) || authVersion < 0) throw invalid('Share authVersion must be a non-negative integer')

  const accessCount = input.accessCount === undefined ? 0 : input.accessCount
  if (!Number.isInteger(accessCount) || accessCount < 0) throw invalid('Share accessCount must be a non-negative integer')

  const createdAt = nonEmptyString(input.createdAt, 'createdAt')
  const updatedAt = nonEmptyString(input.updatedAt, 'updatedAt')

  // `tokens` is authoritative when present; otherwise legacy single-token
  // fields (tokenHash/tokenIssuedAt/tokenExpiresAt) are folded into one entry.
  let tokens
  if (input.tokens !== undefined) {
    if (!Array.isArray(input.tokens)) throw invalid('Share tokens must be an array')
    tokens = input.tokens
  } else if (typeof input.tokenHash === 'string' && input.tokenHash.trim()) {
    tokens = [{
      tokenHash: input.tokenHash,
      issuedAt: input.tokenIssuedAt,
      expiresAt: input.tokenExpiresAt,
      authVersion,
    }]
  } else {
    tokens = []
  }
  const normalizedTokens = tokens.slice(-MAX_SHARE_TOKENS).map((entry) => {
    if (!isPlainObject(entry)) throw invalid('Share token must be an object')
    const tokenHash = entry.tokenHash
    if (typeof tokenHash !== 'string' || !tokenHash.trim()) throw invalid('Share token hash is required')
    const tokenAuthVersion = entry.authVersion === undefined ? authVersion : entry.authVersion
    if (!Number.isInteger(tokenAuthVersion) || tokenAuthVersion < 1) throw invalid('Share token authVersion must be a positive integer')
    return {
      tokenHash,
      // Deterministic sentinel for records that omit issuedAt: the tokens table
      // column is NOT NULL, so stored rows always carry a value. Normalizing the
      // JSON-side representation to the same sentinel keeps cutover and
      // backup/restore digests stable for legacy v1 imports.
      issuedAt: optionalTimestamp(entry.issuedAt, 'token issuedAt') ?? '1970-01-01T00:00:00.000Z',
      expiresAt: optionalTimestamp(entry.expiresAt, 'token expiresAt'),
      authVersion: tokenAuthVersion,
    }
  })

  const extra = {}
  for (const [key, value] of Object.entries(input)) {
    if (!KNOWN_FIELDS.has(key)) extra[key] = value
  }

  return {
    id,
    sessionId,
    permission,
    titleSnapshot: typeof input.titleSnapshot === 'string' ? input.titleSnapshot : undefined,
    scope,
    projectId,
    passwordHash,
    passwordSalt,
    passwordVersion,
    authVersion,
    allowCloudUsage: input.allowCloudUsage === true,
    createdAt,
    updatedAt,
    expiresAt: optionalTimestamp(input.expiresAt, 'expiresAt'),
    revokedAt: optionalTimestamp(input.revokedAt, 'revokedAt'),
    supersededAt: optionalTimestamp(input.supersededAt, 'supersededAt'),
    accessCount,
    lastAccessedAt: optionalTimestamp(input.lastAccessedAt, 'lastAccessedAt'),
    createdFromHost: typeof input.createdFromHost === 'string' ? input.createdFromHost : undefined,
    lastUpdatedFromHost: typeof input.lastUpdatedFromHost === 'string' ? input.lastUpdatedFromHost : undefined,
    tokens: normalizedTokens,
    ...extra,
  }
}

function sortedTokens(tokens) {
  return (Array.isArray(tokens) ? tokens : []).slice().sort((left, right) =>
    String(left.issuedAt || '').localeCompare(String(right.issuedAt || ''))
    || String(left.tokenHash).localeCompare(String(right.tokenHash)))
}

// Canonical SHA-256 digest of a single share record (including tokens and any
// opaque fields). Excludes repository-internal `revision`/`deletedAt`.
export function shareRecordDigest(record) {
  if (!record) return ''
  const content = {
    id: record.id,
    sessionId: record.sessionId,
    permission: record.permission,
    titleSnapshot: record.titleSnapshot,
    scope: record.scope,
    projectId: record.projectId,
    passwordHash: record.passwordHash,
    passwordSalt: record.passwordSalt,
    passwordVersion: record.passwordVersion,
    authVersion: record.authVersion,
    allowCloudUsage: record.allowCloudUsage === true,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    supersededAt: record.supersededAt,
    accessCount: record.accessCount || 0,
    lastAccessedAt: record.lastAccessedAt,
    createdFromHost: record.createdFromHost,
    lastUpdatedFromHost: record.lastUpdatedFromHost,
    tokens: sortedTokens(record.tokens).map((token) => ({
      tokenHash: token.tokenHash,
      issuedAt: token.issuedAt,
      expiresAt: token.expiresAt,
      authVersion: token.authVersion,
    })),
  }
  for (const [key, value] of Object.entries(record)) {
    if (!Object.prototype.hasOwnProperty.call(content, key) && !['revision', 'deletedAt'].includes(key)) content[key] = value
  }
  return createHash('sha256').update(JSON.stringify(canonicalize(content))).digest('hex')
}

// Snapshot digest: sha256 over sorted `shareId\0recordDigest` lines.
export function shareSnapshotDigest(records) {
  const values = (Array.isArray(records) ? records : [])
    .map((record) => `${record.id}\0${shareRecordDigest(record)}`)
    .sort()
  return createHash('sha256').update(values.join('\n')).digest('hex')
}

function recordJson(record) {
  return JSON.stringify(canonicalize({ ...record, revision: undefined, deletedAt: undefined }))
}

function mapShareRow(row) {
  if (!row) return null
  let extra
  try {
    extra = row.extra_json ? JSON.parse(row.extra_json) : {}
  } catch {
    extra = {}
  }
  const record = {
    ...(isPlainObject(extra) ? extra : {}),
    id: row.share_id,
    sessionId: row.session_id,
    permission: row.permission,
    titleSnapshot: row.title_snapshot ?? undefined,
    scope: row.scope,
    projectId: row.scope === 'project' ? row.project_id : undefined,
    passwordHash: row.password_hash ?? undefined,
    passwordSalt: row.password_salt ?? undefined,
    passwordVersion: row.password_version === null ? undefined : Number(row.password_version),
    authVersion: Number(row.auth_version),
    allowCloudUsage: row.allow_cloud_usage === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    supersededAt: row.superseded_at ?? undefined,
    accessCount: Number(row.access_count),
    lastAccessedAt: row.last_accessed_at ?? undefined,
    createdFromHost: row.created_from_host ?? undefined,
    lastUpdatedFromHost: row.last_updated_from_host ?? undefined,
    revision: Number(row.revision),
  }
  return record
}

function tokenRowsFor(database, shareIds) {
  if (!shareIds || shareIds.length === 0) return []
  const placeholders = shareIds.map(() => '?').join(',')
  return database.prepare(`SELECT share_id, token_hash, issued_at, expires_at, auth_version
    FROM share_tokens WHERE share_id IN (${placeholders}) ORDER BY issued_at, token_hash`).all(...shareIds)
}

function attachTokens(records, tokenRows) {
  const groups = new Map()
  for (const row of tokenRows) {
    if (!groups.has(row.share_id)) groups.set(row.share_id, [])
    groups.get(row.share_id).push(row)
  }
  return records.map((record) => ({
    ...record,
    tokens: (groups.get(record.id) || []).map((row) => ({
      tokenHash: row.token_hash,
      issuedAt: row.issued_at ?? undefined,
      expiresAt: row.expires_at ?? undefined,
      authVersion: Number(row.auth_version),
    })),
  }))
}

const SHARE_SESSION_UPSERT_SQL = `
  INSERT INTO share_sessions (${SHARE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(share_id) DO UPDATE SET
    session_id = excluded.session_id,
    permission = excluded.permission,
    title_snapshot = excluded.title_snapshot,
    scope = excluded.scope,
    project_id = excluded.project_id,
    password_hash = excluded.password_hash,
    password_salt = excluded.password_salt,
    password_version = excluded.password_version,
    auth_version = excluded.auth_version,
    allow_cloud_usage = excluded.allow_cloud_usage,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    expires_at = excluded.expires_at,
    revoked_at = excluded.revoked_at,
    superseded_at = excluded.superseded_at,
    access_count = excluded.access_count,
    last_accessed_at = excluded.last_accessed_at,
    created_from_host = excluded.created_from_host,
    last_updated_from_host = excluded.last_updated_from_host,
    revision = excluded.revision,
    record_digest = excluded.record_digest,
    deleted_at = excluded.deleted_at,
    extra_json = excluded.extra_json
`

// The optional statement lets the cutover replaceAll reuse one precompiled upsert.
function insertShareRow(database, record, revision, createdAt, updatedAt, statement = null) {
  const extra = {}
  for (const [key, value] of Object.entries(record)) {
    if (!KNOWN_FIELDS.has(key) && !['revision', 'deletedAt'].includes(key)) extra[key] = value
  }
  const values = [
    record.id, record.sessionId, record.permission,
    record.titleSnapshot ?? null, record.scope, record.projectId ?? null,
    record.passwordHash ?? null, record.passwordSalt ?? null, record.passwordVersion ?? null,
    record.authVersion, record.allowCloudUsage === true ? 1 : 0,
    createdAt, updatedAt,
    record.expiresAt ?? null, record.revokedAt ?? null, record.supersededAt ?? null,
    record.accessCount || 0, record.lastAccessedAt ?? null,
    record.createdFromHost ?? null, record.lastUpdatedFromHost ?? null,
    revision, shareRecordDigest(record), record.deletedAt ?? null, JSON.stringify(extra),
  ]
  const insert = statement ?? database.prepare(SHARE_SESSION_UPSERT_SQL)
  insert.run(...values)
}

function replaceTokens(database, shareId, tokens) {
  database.prepare('DELETE FROM share_tokens WHERE share_id = ?').run(shareId)
  const insert = database.prepare('INSERT INTO share_tokens (share_id, token_hash, issued_at, expires_at, auth_version) VALUES (?, ?, ?, ?, ?)')
  for (const token of (tokens || []).slice(-MAX_SHARE_TOKENS)) {
    insert.run(shareId, token.tokenHash, token.issuedAt || new Date(0).toISOString(), token.expiresAt ?? null, token.authVersion)
  }
}

const ENQUEUE_SHARE_MIRROR_SQL = `
  INSERT INTO share_json_mirror_queue (share_id, operation, share_json, attempts, last_error, updated_at)
  VALUES (?, ?, ?, 0, NULL, ?)
  ON CONFLICT(share_id) DO UPDATE SET
    operation = excluded.operation,
    share_json = excluded.share_json,
    attempts = 0,
    last_error = NULL,
    updated_at = excluded.updated_at
`

function enqueueShareMirror(database, record, operation, updatedAt, statement = null) {
  const stored = record ? { ...record, revision: undefined, deletedAt: undefined } : null
  const insert = statement ?? database.prepare(ENQUEUE_SHARE_MIRROR_SQL)
  insert.run(
    record?.id || record,
    operation,
    operation === 'upsert' ? (stored ? recordJson(stored) : null) : null,
    updatedAt,
  )
}

function currentRow(database, shareId) {
  return database.prepare(`SELECT ${SHARE_COLUMNS} FROM share_sessions WHERE share_id = ?`).get(shareId)
}

function actualRevision(database, shareId) {
  const row = currentRow(database, shareId)
  if (row) return { revision: Number(row.revision), active: row.deleted_at === null, row }
  return { revision: 0, active: false, row: null }
}

function assertCas(database, shareId, expectedRevision) {
  if (expectedRevision === undefined || expectedRevision === null) return
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw invalid('expectedRevision must be a non-negative integer')
  const current = actualRevision(database, shareId)
  if (current.revision !== expectedRevision) throw conflict(shareId, expectedRevision, current.revision)
}

function updateStorageState(database, values, timestamp) {
  if (!values) return
  database.prepare(`UPDATE share_storage_state SET phase = ?, share_count = ?, digest = ?, backup_file = ?, diagnostic_json = ?, updated_at = ?
    WHERE singleton = 1`).run(
    values.phase,
    values.shareCount ?? null,
    values.digest ?? null,
    values.backupFile ?? null,
    values.diagnostic ? JSON.stringify(values.diagnostic) : null,
    timestamp,
  )
}

export function createShareRepository(storageHandle, { now = () => new Date().toISOString() } = {}) {
  const storage = storageHandle ?? getSqliteStorage()
  if (!storage || typeof storage.prepare !== 'function' || typeof storage.transaction !== 'function') {
    throw new TypeError('Share repository requires a SQLite storage handle')
  }

  function get(shareId) {
    assertSafeShareId(shareId)
    const row = currentRow(storage, shareId)
    if (!row || row.deleted_at !== null) return null
    const record = mapShareRow(row)
    return attachTokens([record], tokenRowsFor(storage, [shareId]))[0]
  }

  function list({ sessionId, includeRevoked = false } = {}) {
    const conditions = ['deleted_at IS NULL', 'superseded_at IS NULL']
    const params = []
    if (!includeRevoked) conditions.push('revoked_at IS NULL')
    if (sessionId) {
      nonEmptyString(sessionId, 'sessionId')
      conditions.push('session_id = ?')
      params.push(sessionId)
    }
    const rows = storage.prepare(`SELECT ${SHARE_COLUMNS} FROM share_sessions
      WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC, share_id DESC`).all(...params)
    return attachTokens(rows.map(mapShareRow), tokenRowsFor(storage, rows.map((row) => row.share_id)))
  }

  function create(input, { expectedRevision = null, beforeCommit } = {}) {
    const record = normalizeShareRecord(input)
    const timestamp = now()
    const passwordProvided = Object.prototype.hasOwnProperty.call(input, 'passwordHash')
      || Object.prototype.hasOwnProperty.call(input, 'passwordSalt')
      || Object.prototype.hasOwnProperty.call(input, 'passwordVersion')
    const tokensProvided = Object.prototype.hasOwnProperty.call(input, 'tokens')

    return storage.transaction((database) => {
      const sessionRows = database.prepare(`SELECT ${SHARE_COLUMNS} FROM share_sessions
        WHERE session_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, share_id DESC`).all(record.sessionId)
      const current = sessionRows.find((row) => row.superseded_at === null) || sessionRows[0]
      const targetId = current ? current.share_id : (input.id ?? null)

      // Supersede every other share record for the same session in this same
      // transaction (their tokens are cleared; later records are revoked too).
      for (const row of sessionRows) {
        if (row.share_id === targetId) continue
        const stale = mapShareRow(row)
        const superseded = {
          ...stale,
          supersededAt: stale.supersededAt || timestamp,
          revokedAt: stale.revokedAt || timestamp,
          updatedAt: timestamp,
          tokens: [],
          authVersion: stale.authVersion + 1,
        }
        assertCas(database, row.share_id, null)
        insertShareRow(database, superseded, Number(row.revision) + 1, stale.createdAt, timestamp)
        enqueueShareMirror(database, { ...superseded, revision: undefined }, 'upsert', timestamp)
      }

      if (current) {
        assertCas(database, current.share_id, expectedRevision)
        const existing = mapShareRow(current)
        const willHavePassword = passwordProvided ? Boolean(record.passwordHash) : Boolean(existing.passwordHash)
        if (record.permission === 'operate' && !willHavePassword) throw invalid('Editable shares require a non-empty password')
        const merged = {
          ...existing,
          ...record,
          id: current.share_id,
          createdAt: existing.createdAt,
          updatedAt: timestamp,
          createdFromHost: existing.createdFromHost || record.createdFromHost,
          lastUpdatedFromHost: record.lastUpdatedFromHost || timestamp,
          authVersion: passwordProvided ? (existing.authVersion || 1) + 1 : (existing.authVersion || 1),
          tokens: tokensProvided ? record.tokens : (passwordProvided ? [] : existing.tokens),
          allowCloudUsage: record.permission === 'operate' && record.allowCloudUsage === true,
          supersededAt: undefined,
          revokedAt: undefined,
        }
        const nextRevision = Number(current.revision) + 1
        insertShareRow(database, merged, nextRevision, existing.createdAt, timestamp)
        replaceTokens(database, merged.id, merged.tokens)
        enqueueShareMirror(database, { ...merged, revision: nextRevision }, 'upsert', timestamp)
        return { ...merged, revision: nextRevision }
      }

      let id = targetId
      while (!id || database.prepare('SELECT 1 FROM share_sessions WHERE share_id = ?').get(id)) {
        id = `${SHARE_ID_PREFIX}${randomBytes(18).toString('base64url')}`
      }
      assertCas(database, id, expectedRevision)
      if (record.permission === 'operate' && !record.passwordHash) throw invalid('Editable shares require a non-empty password')
      const created = { ...record, id, updatedAt: timestamp, tokens: record.tokens }
      // The row's created_at must match the createdAt used for record_digest
      // (the input value) so verifyIntegrity's digest check stays consistent.
      insertShareRow(database, created, 1, created.createdAt || timestamp, timestamp)
      replaceTokens(database, id, created.tokens)
      enqueueShareMirror(database, { ...created, revision: 1 }, 'upsert', timestamp)
      beforeCommit?.(database)
      return { ...created, revision: 1 }
    }, { mode: 'immediate' })
  }

  function update(shareId, changes, { expectedRevision = null } = {}) {
    assertSafeShareId(shareId)
    if (!isPlainObject(changes)) throw invalid('Share update changes must be an object')
    const timestamp = now()
    return storage.transaction((database) => {
      const row = currentRow(database, shareId)
      if (!row || row.deleted_at !== null) throw notFound(shareId)
      assertCas(database, shareId, expectedRevision)
      const existing = mapShareRow(row)
      if (existing.supersededAt) {
        const error = new Error('Superseded shares cannot be updated')
        error.statusCode = 409
        error.errorCode = 'SHARE_NOT_ACTIVE'
        throw error
      }
      if (existing.revokedAt) throw notActive(shareId, 'revoked')
      if (existing.expiresAt && Date.parse(existing.expiresAt) <= Date.now()) throw notActive(shareId, 'expired')

      const passwordProvided = Object.prototype.hasOwnProperty.call(changes, 'passwordHash')
        || Object.prototype.hasOwnProperty.call(changes, 'passwordSalt')
        || Object.prototype.hasOwnProperty.call(changes, 'passwordVersion')
      const nextPermission = changes.permission === undefined ? existing.permission : changes.permission
      if (nextPermission !== 'read' && nextPermission !== 'operate') throw invalid('Invalid share permission')
      const willHavePassword = passwordProvided ? Boolean(changes.passwordHash) : Boolean(existing.passwordHash)
      if (nextPermission === 'operate' && !willHavePassword) throw invalid('Editable shares require a non-empty password')
      const nextAllowCloudUsage = nextPermission === 'operate'
        && (changes.allowCloudUsage === undefined ? existing.allowCloudUsage : changes.allowCloudUsage === true)
      const nextScope = changes.scope === undefined ? existing.scope : changes.scope
      if (nextScope !== 'global' && nextScope !== 'project') throw invalid('Invalid share scope')
      if (nextScope === 'project' && !(changes.projectId || existing.projectId)) throw invalid('Project shares require a project id')
      if (nextScope === 'global' && changes.projectId) throw invalid('Global shares cannot have a projectId')

      const merged = {
        ...existing,
        permission: nextPermission,
        titleSnapshot: changes.titleSnapshot === undefined ? existing.titleSnapshot : changes.titleSnapshot,
        scope: nextScope,
        projectId: nextScope === 'project' ? (changes.projectId ?? existing.projectId) : undefined,
        expiresAt: changes.expiresAt === undefined ? existing.expiresAt : optionalTimestamp(changes.expiresAt, 'expiresAt'),
        allowCloudUsage: nextAllowCloudUsage,
        lastUpdatedFromHost: changes.lastUpdatedFromHost === undefined ? existing.lastUpdatedFromHost : changes.lastUpdatedFromHost,
        updatedAt: timestamp,
        authVersion: passwordProvided ? (existing.authVersion || 1) + 1 : existing.authVersion,
        tokens: passwordProvided ? [] : existing.tokens,
      }
      if (passwordProvided) {
        merged.passwordHash = changes.passwordHash === undefined ? undefined : (typeof changes.passwordHash === 'string' && changes.passwordHash.trim() ? changes.passwordHash : undefined)
        merged.passwordSalt = changes.passwordSalt === undefined ? undefined : (typeof changes.passwordSalt === 'string' && changes.passwordSalt.trim() ? changes.passwordSalt : undefined)
        merged.passwordVersion = changes.passwordVersion === undefined ? undefined : changes.passwordVersion
        if (merged.passwordHash && !merged.passwordSalt) throw invalid('Share password hash requires a password salt')
      }
      const nextRevision = Number(row.revision) + 1
      insertShareRow(database, merged, nextRevision, existing.createdAt, timestamp)
      replaceTokens(database, shareId, merged.tokens)
      enqueueShareMirror(database, { ...merged, revision: nextRevision }, 'upsert', timestamp)
      return { ...merged, revision: nextRevision }
    }, { mode: 'immediate' })
  }

  function revoke(shareId, { expectedRevision = null } = {}) {
    assertSafeShareId(shareId)
    const timestamp = now()
    return storage.transaction((database) => {
      const row = currentRow(database, shareId)
      if (!row || row.deleted_at !== null) throw notFound(shareId)
      assertCas(database, shareId, expectedRevision)
      const existing = mapShareRow(row)
      const merged = {
        ...existing,
        revokedAt: existing.revokedAt || timestamp,
        updatedAt: timestamp,
        authVersion: existing.authVersion + 1,
        tokens: [],
      }
      const nextRevision = Number(row.revision) + 1
      insertShareRow(database, merged, nextRevision, existing.createdAt, timestamp)
      replaceTokens(database, shareId, [])
      enqueueShareMirror(database, { ...merged, revision: nextRevision }, 'upsert', timestamp)
      return { ...merged, revision: nextRevision }
    }, { mode: 'immediate' })
  }

  function restore(shareId, { expiresAt, expectedRevision = null } = {}) {
    assertSafeShareId(shareId)
    const timestamp = now()
    if (expiresAt !== undefined && expiresAt !== null) optionalTimestamp(expiresAt, 'expiresAt')
    return storage.transaction((database) => {
      const row = currentRow(database, shareId)
      if (!row || row.deleted_at !== null) throw notFound(shareId)
      assertCas(database, shareId, expectedRevision)
      const existing = mapShareRow(row)
      if (existing.supersededAt) {
        const error = new Error('Superseded shares cannot be restored')
        error.statusCode = 409
        error.errorCode = 'SHARE_NOT_ACTIVE'
        throw error
      }
      const merged = {
        ...existing,
        revokedAt: undefined,
        expiresAt: expiresAt === undefined || expiresAt === null ? undefined : expiresAt,
        updatedAt: timestamp,
        authVersion: existing.authVersion + 1,
        tokens: [],
      }
      const nextRevision = Number(row.revision) + 1
      insertShareRow(database, merged, nextRevision, existing.createdAt, timestamp)
      replaceTokens(database, shareId, [])
      enqueueShareMirror(database, { ...merged, revision: nextRevision }, 'upsert', timestamp)
      return { ...merged, revision: nextRevision }
    }, { mode: 'immediate' })
  }

  function deleteShare(shareId, { expectedRevision = null } = {}) {
    assertSafeShareId(shareId)
    const timestamp = now()
    return storage.transaction((database) => {
      const row = currentRow(database, shareId)
      if (!row || row.deleted_at !== null) throw notFound(shareId)
      assertCas(database, shareId, expectedRevision)
      const existing = mapShareRow(row)
      const nextRevision = Number(row.revision) + 1
      database.prepare('UPDATE share_sessions SET deleted_at = ?, updated_at = ?, revision = ? WHERE share_id = ?')
        .run(timestamp, timestamp, nextRevision, shareId)
      database.prepare('DELETE FROM share_tokens WHERE share_id = ?').run(shareId)
      enqueueShareMirror(database, { ...existing, revision: nextRevision }, 'delete', timestamp)
      return true
    }, { mode: 'immediate' })
  }

  function pruneTokens(shareId, { expectedRevision = null } = {}) {
    assertSafeShareId(shareId)
    const timestamp = now()
    return storage.transaction((database) => {
      const row = currentRow(database, shareId)
      if (!row || row.deleted_at !== null) return 0
      assertCas(database, shareId, expectedRevision)
      const removed = Number(database.prepare(`DELETE FROM share_tokens WHERE share_id = ? AND expires_at IS NOT NULL AND expires_at <= ?`)
        .run(shareId, timestamp).changes)
      if (removed === 0) return 0
      const existing = mapShareRow(row)
      const merged = { ...existing, tokens: attachTokens([existing], tokenRowsFor(database, [shareId]))[0].tokens }
      const nextRevision = Number(row.revision) + 1
      insertShareRow(database, merged, nextRevision, existing.createdAt, timestamp)
      enqueueShareMirror(database, { ...merged, revision: nextRevision }, 'upsert', timestamp)
      return removed
    }, { mode: 'immediate' })
  }

  function issueToken(shareId, { expectedRevision = null } = {}) {
    assertSafeShareId(shareId)
    const timestamp = now()
    const secret = randomBytes(32).toString('base64url')
    const token = `${shareId}.${secret}`
    const tokenHash = createHash('sha256').update(secret).digest('base64url')
    const expiresAt = new Date(Date.parse(timestamp) + 7 * 24 * 60 * 60 * 1000).toISOString()
    return storage.transaction((database) => {
      const row = currentRow(database, shareId)
      if (!row || row.deleted_at !== null) throw notFound(shareId)
      assertCas(database, shareId, expectedRevision)
      const existing = mapShareRow(row)
      if (existing.supersededAt) throw notActive(shareId, 'superseded')
      if (existing.revokedAt) throw notActive(shareId, 'revoked')
      if (existing.expiresAt && Date.parse(existing.expiresAt) <= Date.now()) throw notActive(shareId, 'expired')
      const tokenAuthVersion = existing.authVersion || 1
      const activeTokens = attachTokens([existing], tokenRowsFor(database, [shareId]))[0].tokens
        .filter((entry) => !entry.expiresAt || Date.parse(entry.expiresAt) > Date.now())
      activeTokens.push({ tokenHash, issuedAt: timestamp, expiresAt, authVersion: tokenAuthVersion })
      const kept = activeTokens.slice(-MAX_SHARE_TOKENS)
      const merged = {
        ...existing,
        accessCount: existing.accessCount + 1,
        lastAccessedAt: timestamp,
        tokens: kept,
      }
      const nextRevision = Number(row.revision) + 1
      insertShareRow(database, merged, nextRevision, existing.createdAt, timestamp)
      replaceTokens(database, shareId, kept)
      enqueueShareMirror(database, { ...merged, revision: nextRevision }, 'upsert', timestamp)
      return { token, share: { ...merged, revision: nextRevision } }
    }, { mode: 'immediate' })
  }

  function verifyToken(record, token) {
    if (!record || typeof token !== 'string') return false
    const separator = token.indexOf('.')
    if (separator <= 0) return false
    const tokenShareId = token.slice(0, separator)
    const secret = token.slice(separator + 1)
    if (tokenShareId !== record.id || !secret) return false
    const actualHash = createHash('sha256').update(secret).digest('base64url')
    const authVersion = record.authVersion || 1
    const nowMs = Date.now()
    const tokenRecords = (Array.isArray(record.tokens) ? record.tokens : [])
      .filter((entry) => entry && typeof entry.tokenHash === 'string'
        && (!entry.expiresAt || Date.parse(entry.expiresAt) > nowMs))
    return tokenRecords.some((entry) => (entry.authVersion || 1) === authVersion && safeHashEqual(entry.tokenHash, actualHash))
  }

  function replaceAll(inputs, { expectedCount, expectedDigest, storageState, beforeCommit } = {}) {
    if (!Array.isArray(inputs)) throw invalid('Share records must be an array')
    const records = inputs.map(normalizeShareRecord)
    const ids = new Set()
    for (const record of records) {
      if (ids.has(record.id)) throw invalid(`Duplicate share id: ${record.id}`)
      ids.add(record.id)
    }
    const timestamp = now()
    return storage.transaction((database) => {
      database.exec('DELETE FROM share_sessions; DELETE FROM share_tokens; DELETE FROM share_json_mirror_queue;')
      const insertSession = database.prepare(SHARE_SESSION_UPSERT_SQL)
      const insertMirror = database.prepare(ENQUEUE_SHARE_MIRROR_SQL)
      for (const record of records) {
        insertShareRow(database, { ...record, updatedAt: record.updatedAt || timestamp }, 1, record.createdAt || timestamp, record.updatedAt || timestamp, insertSession)
        replaceTokens(database, record.id, record.tokens)
        enqueueShareMirror(database, { ...record, revision: 1 }, 'upsert', timestamp, insertMirror)
      }
      const digest = shareSnapshotDigest(records)
      if (expectedCount !== undefined && records.length !== expectedCount) throw new Error('Share replace count verification failed')
      if (expectedDigest !== undefined && digest !== expectedDigest) throw new Error('Share replace digest verification failed')
      updateStorageState(database, storageState ? { ...storageState, shareCount: records.length, digest, updatedAt: timestamp } : null, timestamp)
      beforeCommit?.(database)
      return records.length
    }, { mode: 'immediate' })
  }

  function exportSnapshot() {
    return storage.transaction((database) => {
      const rows = database.prepare(`SELECT ${SHARE_COLUMNS} FROM share_sessions WHERE deleted_at IS NULL ORDER BY share_id`).all()
      const records = attachTokens(rows.map(mapShareRow), tokenRowsFor(database, rows.map((row) => row.share_id)))
      const digest = shareSnapshotDigest(records)
      return { records, count: records.length, digest }
    }, { mode: 'deferred' })
  }

  function count() {
    return Number(storage.prepare('SELECT COUNT(*) AS count FROM share_sessions WHERE deleted_at IS NULL').get().count)
  }

  function digest() {
    return shareSnapshotDigest(attachTokens(
      storage.prepare(`SELECT ${SHARE_COLUMNS} FROM share_sessions WHERE deleted_at IS NULL ORDER BY share_id`).all().map(mapShareRow),
      storage.prepare(`SELECT share_id, token_hash, issued_at, expires_at, auth_version FROM share_tokens ORDER BY issued_at, token_hash`).all(),
    ))
  }

  function verifyIntegrity({ quickCheck = false, forceQuickCheck = false } = {}) {
    if (quickCheck) {
      // Shared quick_check gate (process cache + marker cadence) — see
      // runSharedSqliteQuickCheck in database.mjs; `forceQuickCheck` is the
      // manual-maintenance escape hatch that always runs a real scan.
      runSharedSqliteQuickCheck(storage, { force: forceQuickCheck === true })
    }
    const rows = storage.prepare(`SELECT ${SHARE_COLUMNS} FROM share_sessions`).all()
    let invalidRecords = 0
    let invalidDigests = 0
    let invalidPermissions = 0
    let invalidScopes = 0
    for (const row of rows) {
      if (row.deleted_at !== null) continue
      try {
        const record = attachTokens([mapShareRow(row)], tokenRowsFor(storage, [row.share_id]))[0]
        normalizeShareRecord({ ...record, revision: undefined, deletedAt: undefined })
        if (row.record_digest !== shareRecordDigest(record)) invalidDigests += 1
        if (row.permission !== 'read' && row.permission !== 'operate') invalidPermissions += 1
        if (row.scope !== 'global' && row.scope !== 'project') invalidScopes += 1
      } catch {
        invalidRecords += 1
      }
    }
    const tokenCounts = storage.prepare('SELECT share_id, COUNT(*) AS count FROM share_tokens GROUP BY share_id').all()
    const overLimitTokens = tokenCounts.filter((row) => Number(row.count) > MAX_SHARE_TOKENS).length
    const orphanTokens = Number(storage.prepare(`
      SELECT COUNT(*) AS count FROM share_tokens t
      LEFT JOIN share_sessions s ON s.share_id = t.share_id
      WHERE s.share_id IS NULL
    `).get().count)
    const tokenAuthVersionMismatch = Number(storage.prepare(`
      SELECT COUNT(*) AS count FROM share_tokens t
      JOIN share_sessions s ON s.share_id = t.share_id
      WHERE t.auth_version != s.auth_version AND s.deleted_at IS NULL
    `).get().count)
    return {
      ok: invalidRecords === 0 && invalidDigests === 0 && invalidPermissions === 0 && invalidScopes === 0
        && overLimitTokens === 0 && orphanTokens === 0 && tokenAuthVersionMismatch === 0,
      count: Number(storage.prepare('SELECT COUNT(*) AS count FROM share_sessions WHERE deleted_at IS NULL').get().count),
      digest: digest(),
      invalidRecords,
      invalidDigests,
      invalidPermissions,
      invalidScopes,
      overLimitTokens,
      orphanTokens,
      tokenAuthVersionMismatch,
    }
  }

  function listMirrorQueue() {
    return storage.prepare('SELECT * FROM share_json_mirror_queue ORDER BY updated_at, share_id').all().map((row) => ({
      shareId: row.share_id,
      operation: row.operation,
      record: row.share_json ? JSON.parse(row.share_json) : null,
      attempts: Number(row.attempts),
      lastError: row.last_error,
      updatedAt: row.updated_at,
    }))
  }

  function acknowledgeMirror(entry) {
    return Number(storage.prepare('DELETE FROM share_json_mirror_queue WHERE share_id = ?')
      .run(entry.shareId).changes) === 1
  }

  function failMirror(entry, error) {
    storage.prepare(`UPDATE share_json_mirror_queue SET attempts = attempts + 1, last_error = ?, updated_at = ?
      WHERE share_id = ?`)
      .run(String(error?.message || error).slice(0, 1000), now(), entry.shareId)
  }

  return Object.freeze({
    get,
    list,
    create,
    update,
    revoke,
    restore,
    delete: deleteShare,
    issueToken,
    verifyToken,
    pruneTokens,
    replaceAll,
    exportSnapshot,
    verifyIntegrity,
    count,
    digest,
    listMirrorQueue,
    acknowledgeMirror,
    failMirror,
  })
}

function safeHashEqual(expectedHash, actualHash) {
  if (!expectedHash || !actualHash) return false
  const expected = Buffer.from(expectedHash, 'base64url')
  const actual = Buffer.from(actualHash, 'base64url')
  if (expected.length !== actual.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ actual[index]
  return difference === 0
}
