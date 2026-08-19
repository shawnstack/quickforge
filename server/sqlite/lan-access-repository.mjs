import { createHash } from 'node:crypto'
import { getSqliteStorage, runSharedSqliteQuickCheck } from './database.mjs'
import { createRandomToken, safeHashEqual, sha256Base64Url } from '../utils/password-auth.mjs'

// F11 LAN access storage: `lan_access_state` (single config row with a fixed
// `singleton = 1` primary key, strict column mapping + `extra_json` for
// opaque/unknown fields) and `lan_access_tokens` (independent token table with
// PK token_id and a ≤100 cap enforced at write time, keeping the newest tokens
// by insertion order — the same `slice(-100)` semantics as lan-access-store).
// The snapshot digest algorithm is shared with the JSON cutover side so a JSON
// import and its SQLite copy always hash identically.
export const LAN_TOKEN_MAX_COUNT = 100
export const DEFAULT_SESSION_TTL_HOURS = 12

const CONFIG_COLUMNS = `
  singleton, enabled, password_hash, password_salt, password_version, auth_version,
  session_ttl_hours, updated_at, revision, record_digest, extra_json
`

const TOKEN_COLUMNS = `
  token_id, seq, token_hash, issued_at, expires_at, auth_version, remote_address, user_agent
`

// Fields modeled as config columns; anything else on the JSON config is
// preserved verbatim in `extra_json` and restored on read/export (opaque
// roundtrip). Token-level records use fixed columns only (same as share_tokens).
const KNOWN_CONFIG_FIELDS = new Set([
  'enabled', 'passwordHash', 'passwordSalt', 'passwordVersion', 'authVersion',
  'sessionTtlHours', 'updatedAt', 'tokens',
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
  error.errorCode = 'LAN_ACCESS_INVALID_INPUT'
  return error
}

function conflict(expectedRevision, actualRevision) {
  const error = new Error('LAN access state conflict')
  error.statusCode = 409
  error.errorCode = 'LAN_ACCESS_STATE_CONFLICT'
  error.expectedRevision = expectedRevision
  error.actualRevision = actualRevision
  return error
}

function notFound() {
  const error = new Error('LAN access session not found.')
  error.statusCode = 404
  error.errorCode = 'LAN_ACCESS_NOT_FOUND'
  return error
}

function notEnabled() {
  const error = new Error('LAN access is not enabled.')
  error.statusCode = 403
  error.errorCode = 'LAN_ACCESS_NOT_ENABLED'
  return error
}

function optionalTimestamp(value, field) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw invalid(`Invalid ${field}`)
  return value
}

export function normalizeSessionTtlHours(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_SESSION_TTL_HOURS
  return Math.min(24 * 7, Math.max(1, Math.round(numeric)))
}

export function normalizeLanAccessText(value, maxLength) {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text ? text.slice(0, maxLength) : undefined
}

export function normalizeLanAccessAddress(value) {
  const address = normalizeLanAccessText(value, 128)
  return address?.startsWith('::ffff:') ? address.slice(7) : address
}

// Deterministic public id for a token record; legacy tokens without an id get a
// stable derived id from the token hash (same rule as lan-access-store).
export function lanAccessTokenId(token) {
  const id = normalizeLanAccessText(token?.id, 128)
  return id || `legacy_${sha256Base64Url(token?.tokenHash || '').slice(0, 24)}`
}

// Normalize one JSON-shape LAN access config (exactly the format written by
// lan-access-store.mjs) into the canonical repository record. Shared with the
// JSON cutover snapshot builder so both sides validate and hash identically.
// Expired tokens are pruned like `pruneTokens` on the JSON side; the ≤100 cap
// keeps the newest entries by array order (`slice(-100)` semantics).
export function normalizeLanAccessConfig(input, { now = () => new Date().toISOString() } = {}) {
  if (!isPlainObject(input)) throw invalid('LAN access config must be an object')
  const enabled = Boolean(input.enabled)
  const passwordHash = typeof input.passwordHash === 'string' && input.passwordHash.trim() ? input.passwordHash : undefined
  const passwordSalt = typeof input.passwordSalt === 'string' && input.passwordSalt.trim() ? input.passwordSalt : undefined
  if (passwordHash && !passwordSalt) throw invalid('LAN access password hash requires a password salt')
  if (!passwordHash && passwordSalt) throw invalid('LAN access password salt requires a password hash')
  const passwordVersion = input.passwordVersion === undefined ? undefined : input.passwordVersion
  if (passwordVersion !== undefined && (!Number.isInteger(passwordVersion) || passwordVersion < 1)) throw invalid('LAN access passwordVersion must be a positive integer')
  const authVersion = input.authVersion === undefined ? 1 : input.authVersion
  if (!Number.isInteger(authVersion) || authVersion < 1) throw invalid('LAN access authVersion must be a positive integer')
  if (enabled && !passwordHash) throw invalid('LAN access enabled requires a password hash')
  const sessionTtlHours = normalizeSessionTtlHours(input.sessionTtlHours)
  const updatedAt = typeof input.updatedAt === 'string' && input.updatedAt.trim() ? input.updatedAt : now()

  const nowMs = Date.now()
  let tokens = []
  if (input.tokens !== undefined) {
    if (!Array.isArray(input.tokens)) throw invalid('LAN access tokens must be an array')
    tokens = input.tokens
      .filter((entry) => !entry?.expiresAt || Date.parse(entry.expiresAt) > nowMs)
      .map((entry) => normalizeLanAccessToken(entry, authVersion))
  }
  const normalizedTokens = tokens.slice(-LAN_TOKEN_MAX_COUNT)

  const extra = {}
  for (const [key, value] of Object.entries(input)) {
    if (!KNOWN_CONFIG_FIELDS.has(key)) extra[key] = value
  }

  return {
    enabled,
    passwordHash,
    passwordSalt,
    passwordVersion,
    authVersion,
    sessionTtlHours,
    updatedAt,
    tokens: normalizedTokens,
    ...extra,
  }
}

function normalizeLanAccessToken(entry, configAuthVersion) {
  if (!isPlainObject(entry)) throw invalid('LAN access token must be an object')
  const tokenHash = entry.tokenHash
  if (typeof tokenHash !== 'string' || !tokenHash.trim()) throw invalid('LAN access token hash is required')
  const tokenAuthVersion = entry.authVersion === undefined ? configAuthVersion : entry.authVersion
  if (!Number.isInteger(tokenAuthVersion) || tokenAuthVersion < 1) throw invalid('LAN access token authVersion must be a positive integer')
  return {
    id: lanAccessTokenId(entry),
    tokenHash,
    // Deterministic sentinel for records that omit issuedAt: the tokens table
    // column is NOT NULL, so stored rows always carry a value (same rule as
    // share_tokens so cutover/backup digests stay stable for legacy imports).
    issuedAt: optionalTimestamp(entry.issuedAt, 'token issuedAt') ?? '1970-01-01T00:00:00.000Z',
    expiresAt: optionalTimestamp(entry.expiresAt, 'token expiresAt'),
    authVersion: tokenAuthVersion,
    remoteAddress: normalizeLanAccessAddress(entry.remoteAddress),
    userAgent: normalizeLanAccessText(entry.userAgent, 300),
  }
}

function sortedTokens(tokens) {
  return (Array.isArray(tokens) ? tokens : []).slice().sort((left, right) =>
    String(left.issuedAt || '').localeCompare(String(right.issuedAt || ''))
    || String(left.id || '').localeCompare(String(right.id || '')))
}

// Canonical SHA-256 digest of the full LAN access config (including tokens and
// any opaque config fields). Excludes the repository-internal `revision`.
export function lanAccessConfigDigest(config) {
  if (!config) return ''
  const content = {
    enabled: config.enabled === true,
    passwordHash: config.passwordHash,
    passwordSalt: config.passwordSalt,
    passwordVersion: config.passwordVersion,
    authVersion: config.authVersion,
    sessionTtlHours: config.sessionTtlHours,
    updatedAt: config.updatedAt,
    tokens: sortedTokens(config.tokens).map((token) => ({
      id: token.id,
      tokenHash: token.tokenHash,
      issuedAt: token.issuedAt,
      expiresAt: token.expiresAt,
      authVersion: token.authVersion,
      remoteAddress: token.remoteAddress,
      userAgent: token.userAgent,
    })),
  }
  for (const [key, value] of Object.entries(config)) {
    if (!Object.prototype.hasOwnProperty.call(content, key) && key !== 'revision') content[key] = value
  }
  return createHash('sha256').update(JSON.stringify(canonicalize(content))).digest('hex')
}

function configJson(record) {
  return JSON.stringify(canonicalize({ ...record, revision: undefined }))
}

function mapConfigRow(row) {
  if (!row) return null
  let extra
  try {
    extra = row.extra_json ? JSON.parse(row.extra_json) : {}
  } catch {
    extra = {}
  }
  return {
    ...(isPlainObject(extra) ? extra : {}),
    enabled: row.enabled === 1,
    passwordHash: row.password_hash ?? undefined,
    passwordSalt: row.password_salt ?? undefined,
    passwordVersion: row.password_version === null ? undefined : Number(row.password_version),
    authVersion: Number(row.auth_version),
    sessionTtlHours: Number(row.session_ttl_hours),
    updatedAt: row.updated_at,
    revision: Number(row.revision),
  }
}

function tokenRowsFor(database) {
  return database.prepare(`SELECT ${TOKEN_COLUMNS} FROM lan_access_tokens ORDER BY seq, token_id`).all()
}

function attachTokens(config, tokenRows) {
  if (!config) return config
  return {
    ...config,
    tokens: (Array.isArray(tokenRows) ? tokenRows : []).map((row) => ({
      id: row.token_id,
      tokenHash: row.token_hash,
      issuedAt: row.issued_at ?? undefined,
      expiresAt: row.expires_at ?? undefined,
      authVersion: Number(row.auth_version),
      remoteAddress: row.remote_address ?? undefined,
      userAgent: row.user_agent ?? undefined,
    })),
  }
}

function insertConfigRow(database, record, revision, updatedAt) {
  const extra = {}
  for (const [key, value] of Object.entries(record)) {
    if (!KNOWN_CONFIG_FIELDS.has(key) && key !== 'revision') extra[key] = value
  }
  const digest = lanAccessConfigDigest(record)
  database.prepare(`
    INSERT INTO lan_access_state (${CONFIG_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET
      enabled = excluded.enabled,
      password_hash = excluded.password_hash,
      password_salt = excluded.password_salt,
      password_version = excluded.password_version,
      auth_version = excluded.auth_version,
      session_ttl_hours = excluded.session_ttl_hours,
      updated_at = excluded.updated_at,
      revision = excluded.revision,
      record_digest = excluded.record_digest,
      extra_json = excluded.extra_json
  `).run(
    1, record.enabled === true ? 1 : 0,
    record.passwordHash ?? null, record.passwordSalt ?? null, record.passwordVersion ?? null,
    record.authVersion, record.sessionTtlHours, updatedAt,
    revision, digest, JSON.stringify(extra),
  )
  return digest
}

function insertTokenRow(database, token, seq) {
  database.prepare(`
    INSERT INTO lan_access_tokens (${TOKEN_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    token.id, seq, token.tokenHash, token.issuedAt, token.expiresAt ?? null,
    token.authVersion, token.remoteAddress ?? null, token.userAgent ?? null,
  )
}

function replaceTokens(database, tokens) {
  database.prepare('DELETE FROM lan_access_tokens').run()
  const insert = database.prepare(`INSERT INTO lan_access_tokens (${TOKEN_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  ;(Array.isArray(tokens) ? tokens : []).slice(-LAN_TOKEN_MAX_COUNT).forEach((token, index) => {
    insert.run(token.id, index, token.tokenHash, token.issuedAt, token.expiresAt ?? null, token.authVersion, token.remoteAddress ?? null, token.userAgent ?? null)
  })
}

function enqueueLanAccessMirror(database, record, operation, updatedAt) {
  const stored = record ? { ...record, revision: undefined } : null
  database.prepare(`
    INSERT INTO lan_access_json_mirror_queue (singleton, operation, config_json, attempts, last_error, updated_at)
    VALUES (1, ?, ?, 0, NULL, ?)
    ON CONFLICT(singleton) DO UPDATE SET
      operation = excluded.operation,
      config_json = excluded.config_json,
      attempts = 0,
      last_error = NULL,
      updated_at = excluded.updated_at
  `).run(
    operation,
    operation === 'upsert' ? (stored ? configJson(stored) : null) : null,
    updatedAt,
  )
}

function currentConfigRow(database) {
  return database.prepare(`SELECT ${CONFIG_COLUMNS} FROM lan_access_state WHERE singleton = 1`).get()
}

function actualRevision(database) {
  const row = currentConfigRow(database)
  return row ? { revision: Number(row.revision), exists: true, row } : { revision: 0, exists: false, row: null }
}

function assertCas(database, expectedRevision) {
  if (expectedRevision === undefined || expectedRevision === null) return
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw invalid('expectedRevision must be a non-negative integer')
  const current = actualRevision(database)
  if (current.revision !== expectedRevision) throw conflict(expectedRevision, current.revision)
}

function updateStorageState(database, values, timestamp) {
  if (!values) return
  database.prepare(`UPDATE lan_access_storage_state SET phase = ?, lan_token_count = ?, digest = ?, backup_file = ?, diagnostic_json = ?, updated_at = ?
    WHERE singleton = 1`).run(
    values.phase,
    values.lanTokenCount ?? null,
    values.digest ?? null,
    values.backupFile ?? null,
    values.diagnostic ? JSON.stringify(values.diagnostic) : null,
    timestamp,
  )
}

function tokenNotExpiredWhere(cutoffIso) {
  return `(expires_at IS NULL OR expires_at > '${String(cutoffIso).replace(/'/g, "''")}')`
}

export function createLanAccessRepository(storageHandle, { now = () => new Date().toISOString() } = {}) {
  const storage = storageHandle ?? getSqliteStorage()
  if (!storage || typeof storage.prepare !== 'function' || typeof storage.transaction !== 'function') {
    throw new TypeError('LAN access repository requires a SQLite storage handle')
  }

  function getConfig() {
    const row = currentConfigRow(storage)
    if (!row) return null
    const config = mapConfigRow(row)
    return attachTokens(config, tokenRowsFor(storage))
  }

  function updateSettings(changes, { expectedRevision = null } = {}) {
    if (!isPlainObject(changes)) throw invalid('LAN access settings must be an object')
    const timestamp = now()
    const passwordProvided = Object.prototype.hasOwnProperty.call(changes, 'passwordHash')
      || Object.prototype.hasOwnProperty.call(changes, 'passwordSalt')
      || Object.prototype.hasOwnProperty.call(changes, 'passwordVersion')
    const enabledProvided = Object.prototype.hasOwnProperty.call(changes, 'enabled')
    return storage.transaction((database) => {
      const current = actualRevision(database)
      assertCas(database, expectedRevision)
      const existing = current.exists ? mapConfigRow(current.row) : null
      const nextEnabled = enabledProvided ? Boolean(changes.enabled) : (existing ? existing.enabled : false)
      if (nextEnabled && !passwordProvided && !(existing && existing.passwordHash)) {
        const error = new Error('LAN access password is required before enabling full LAN access.')
        error.statusCode = 400
        throw error
      }
      const authChanged = passwordProvided || Boolean(existing && existing.enabled) !== nextEnabled
      const passwordInfo = passwordProvided
        ? {
            passwordHash: typeof changes.passwordHash === 'string' && changes.passwordHash.trim() ? changes.passwordHash : undefined,
            passwordSalt: typeof changes.passwordSalt === 'string' && changes.passwordSalt.trim() ? changes.passwordSalt : undefined,
            passwordVersion: changes.passwordVersion,
          }
        : {}
      const merged = {
        ...(existing || {}),
        ...passwordInfo,
        enabled: nextEnabled,
        authVersion: authChanged ? (existing?.authVersion || 1) + 1 : (existing?.authVersion || 1),
        sessionTtlHours: changes.sessionTtlHours === undefined
          ? (existing?.sessionTtlHours ?? DEFAULT_SESSION_TTL_HOURS)
          : normalizeSessionTtlHours(changes.sessionTtlHours),
        updatedAt: timestamp,
        tokens: authChanged ? [] : (existing ? existing.tokens : []),
      }
      const normalized = normalizeLanAccessConfig(merged, { now })
      const nextRevision = (current.revision || 0) + 1
      insertConfigRow(database, normalized, nextRevision, timestamp)
      replaceTokens(database, normalized.tokens)
      enqueueLanAccessMirror(database, { ...normalized, revision: nextRevision }, 'upsert', timestamp)
      return { config: { ...normalized, revision: nextRevision }, revision: nextRevision }
    }, { mode: 'immediate' })
  }

  function issueToken({ remoteAddress, userAgent, expectedRevision = null } = {}) {
    const timestamp = now()
    const secret = createRandomToken(32)
    const tokenHash = sha256Base64Url(secret)
    return storage.transaction((database) => {
      const row = currentConfigRow(database)
      if (!row) throw notEnabled()
      assertCas(database, expectedRevision)
      const existing = mapConfigRow(row)
      if (!existing.enabled || !existing.passwordHash) throw notEnabled()
      const ttlMs = existing.sessionTtlHours * 60 * 60 * 1000
      const expiresAt = new Date(Date.parse(timestamp) + ttlMs).toISOString()
      const tokenRecord = {
        id: createRandomToken(18),
        tokenHash,
        issuedAt: timestamp,
        expiresAt,
        authVersion: existing.authVersion,
        remoteAddress: normalizeLanAccessAddress(remoteAddress),
        userAgent: normalizeLanAccessText(userAgent, 300),
      }
      // Prune expired tokens and keep only the newest 100 by insertion order
      // (same `slice(-100)` semantics as the JSON store) in this same
      // transaction along with the config update and mirror enqueue.
      database.prepare(`DELETE FROM lan_access_tokens WHERE expires_at IS NOT NULL AND expires_at <= ?`)
        .run(new Date(Date.now()).toISOString())
      const nextSeq = Number(database.prepare('SELECT COALESCE(MAX(seq), -1) AS seq FROM lan_access_tokens').get().seq) + 1
      insertTokenRow(database, tokenRecord, nextSeq)
      database.prepare(`DELETE FROM lan_access_tokens WHERE token_id NOT IN (
        SELECT token_id FROM lan_access_tokens ORDER BY seq DESC, token_id DESC LIMIT ?)`).run(LAN_TOKEN_MAX_COUNT)
      const merged = { ...existing, updatedAt: timestamp, tokens: attachTokens(existing, tokenRowsFor(database)).tokens }
      const nextRevision = Number(row.revision) + 1
      insertConfigRow(database, { ...merged, revision: undefined }, nextRevision, timestamp)
      enqueueLanAccessMirror(database, { ...merged, revision: nextRevision }, 'upsert', timestamp)
      return {
        token: `${existing.authVersion}.${secret}`,
        expiresAt,
        maxAge: Math.floor(ttlMs / 1000),
        config: { ...merged, revision: nextRevision },
        revision: nextRevision,
      }
    }, { mode: 'immediate' })
  }

  function revokeTokenById(tokenId) {
    const normalizedId = normalizeLanAccessText(tokenId, 128)
    if (!normalizedId) {
      const error = new Error('LAN access session id is required.')
      error.statusCode = 400
      throw error
    }
    const timestamp = now()
    return storage.transaction((database) => {
      const row = currentConfigRow(database)
      if (!row) throw notFound()
      const existing = mapConfigRow(row)
      const removed = Number(database.prepare('DELETE FROM lan_access_tokens WHERE token_id = ?').run(normalizedId).changes)
      if (removed === 0) throw notFound()
      const merged = { ...existing, updatedAt: timestamp, tokens: attachTokens(existing, tokenRowsFor(database)).tokens }
      const nextRevision = Number(row.revision) + 1
      insertConfigRow(database, { ...merged, revision: undefined }, nextRevision, timestamp)
      enqueueLanAccessMirror(database, { ...merged, revision: nextRevision }, 'upsert', timestamp)
      return { config: { ...merged, revision: nextRevision }, revision: nextRevision }
    }, { mode: 'immediate' })
  }

  function revokeToken(token) {
    if (!token || typeof token !== 'string') return false
    const [versionText, secret] = token.split('.')
    if (!secret) return false
    const actualHash = sha256Base64Url(secret)
    const timestamp = now()
    return storage.transaction((database) => {
      const row = currentConfigRow(database)
      if (!row) return false
      const existing = mapConfigRow(row)
      if (Number(versionText) !== (existing.authVersion || 1)) return false
      const removed = Number(database.prepare('DELETE FROM lan_access_tokens WHERE token_hash = ?').run(actualHash).changes)
      if (removed === 0) return false
      const merged = { ...existing, updatedAt: timestamp, tokens: attachTokens(existing, tokenRowsFor(database)).tokens }
      const nextRevision = Number(row.revision) + 1
      insertConfigRow(database, { ...merged, revision: undefined }, nextRevision, timestamp)
      enqueueLanAccessMirror(database, { ...merged, revision: nextRevision }, 'upsert', timestamp)
      return true
    }, { mode: 'immediate' })
  }

  function revokeAll({ expectedRevision = null } = {}) {
    const timestamp = now()
    return storage.transaction((database) => {
      const row = currentConfigRow(database)
      if (!row) throw notFound()
      assertCas(database, expectedRevision)
      const existing = mapConfigRow(row)
      const merged = {
        ...existing,
        authVersion: existing.authVersion + 1,
        tokens: [],
        updatedAt: timestamp,
      }
      database.prepare('DELETE FROM lan_access_tokens').run()
      const nextRevision = Number(row.revision) + 1
      insertConfigRow(database, { ...merged, revision: undefined }, nextRevision, timestamp)
      enqueueLanAccessMirror(database, { ...merged, revision: nextRevision }, 'upsert', timestamp)
      return { config: { ...merged, revision: nextRevision }, revision: nextRevision }
    }, { mode: 'immediate' })
  }

  function replaceAll(inputConfig, { expectedCount, expectedDigest, storageState, beforeCommit } = {}) {
    const record = normalizeLanAccessConfig(inputConfig, { now })
    const count = record.tokens.length
    const digest = lanAccessConfigDigest(record)
    if (expectedCount !== undefined && count !== expectedCount) throw new Error('LAN access replace token count verification failed')
    if (expectedDigest !== undefined && digest !== expectedDigest) throw new Error('LAN access replace digest verification failed')
    const timestamp = record.updatedAt || now()
    return storage.transaction((database) => {
      database.exec('DELETE FROM lan_access_state; DELETE FROM lan_access_tokens; DELETE FROM lan_access_json_mirror_queue;')
      insertConfigRow(database, record, 1, timestamp)
      replaceTokens(database, record.tokens)
      enqueueLanAccessMirror(database, { ...record, revision: 1 }, 'upsert', timestamp)
      updateStorageState(database, storageState ? { ...storageState, lanTokenCount: count, digest, updatedAt: timestamp } : null, timestamp)
      beforeCommit?.(database)
      return count
    }, { mode: 'immediate' })
  }

  function exportSnapshot() {
    return storage.transaction((database) => {
      const row = currentConfigRow(database)
      if (!row) return { config: null, tokenCount: 0, digest: '' }
      const config = attachTokens(mapConfigRow(row), tokenRowsFor(database))
      return { config, tokenCount: config.tokens.length, digest: lanAccessConfigDigest(config) }
    }, { mode: 'deferred' })
  }

  function count() {
    const cutoff = new Date(Date.now()).toISOString()
    return Number(storage.prepare(`SELECT COUNT(*) AS count FROM lan_access_tokens WHERE ${tokenNotExpiredWhere(cutoff)}`).get().count)
  }

  function digest() {
    return exportSnapshot().digest
  }

  function verifyIntegrity({ quickCheck = false, forceQuickCheck = false } = {}) {
    if (quickCheck) {
      // Shared quick_check gate (process cache + marker cadence) — see
      // runSharedSqliteQuickCheck in database.mjs; `forceQuickCheck` is the
      // manual-maintenance escape hatch that always runs a real scan.
      runSharedSqliteQuickCheck(storage, { force: forceQuickCheck === true })
    }
    const row = currentConfigRow(storage)
    let invalidRecords = 0
    let invalidDigests = 0
    let invalidPasswordPairs = 0
    let missingConfig = 0
    if (!row) {
      missingConfig = 1
    } else {
      try {
        const config = attachTokens(mapConfigRow(row), tokenRowsFor(storage))
        normalizeLanAccessConfig({ ...config, revision: undefined }, { now })
        if (row.record_digest !== lanAccessConfigDigest(config)) invalidDigests += 1
        if (Boolean(config.passwordHash) !== Boolean(config.passwordSalt)) invalidPasswordPairs += 1
        if (config.enabled === true && !config.passwordHash) invalidPasswordPairs += 1
      } catch {
        invalidRecords += 1
      }
    }
    const totalTokens = Number(storage.prepare('SELECT COUNT(*) AS count FROM lan_access_tokens').get().count)
    const overLimitTokens = totalTokens > LAN_TOKEN_MAX_COUNT ? 1 : 0
    const orphanTokens = !row ? totalTokens : 0
    const tokenAuthVersionMismatch = row
      ? Number(storage.prepare('SELECT COUNT(*) AS count FROM lan_access_tokens WHERE auth_version != ?').get(Number(row.auth_version)).count)
      : 0
    return {
      ok: invalidRecords === 0 && invalidDigests === 0 && invalidPasswordPairs === 0 && missingConfig === 0
        && overLimitTokens === 0 && orphanTokens === 0 && tokenAuthVersionMismatch === 0,
      count: count(),
      digest: row ? digest() : '',
      invalidRecords,
      invalidDigests,
      invalidPasswordPairs,
      missingConfig,
      overLimitTokens,
      orphanTokens,
      tokenAuthVersionMismatch,
    }
  }

  function listMirrorQueue() {
    const row = storage.prepare('SELECT * FROM lan_access_json_mirror_queue WHERE singleton = 1').get()
    if (!row) return []
    return [{
      operation: row.operation,
      config: row.config_json ? JSON.parse(row.config_json) : null,
      attempts: Number(row.attempts),
      lastError: row.last_error,
      updatedAt: row.updated_at,
    }]
  }

  function acknowledgeMirror(_entry) {
    return Number(storage.prepare('DELETE FROM lan_access_json_mirror_queue WHERE singleton = 1').run().changes) === 1
  }

  function failMirror(_entry, error) {
    storage.prepare(`UPDATE lan_access_json_mirror_queue SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE singleton = 1`)
      .run(String(error?.message || error).slice(0, 1000), now())
  }

  return Object.freeze({
    getConfig,
    updateSettings,
    issueToken,
    verifyToken(token) {
      return verifyLanAccessTokenRecord(getConfig(), token)
    },
    revokeTokenById,
    revokeToken,
    revokeAll,
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

/**
 * Exact LAN access token verification: version number must match the current
 * authVersion, the derived SHA-256 hash must match a stored token (constant
 * time) with the same authVersion that is not expired. Fails closed on any
 * mismatch, including a missing/disabled config.
 */
export function verifyLanAccessTokenRecord(config, token) {
  if (!config || !config.enabled || !config.passwordHash || !token || typeof token !== 'string') return false
  const separator = token.indexOf('.')
  if (separator <= 0) return false
  const versionText = token.slice(0, separator)
  const secret = token.slice(separator + 1)
  if (Number(versionText) !== (config.authVersion || 1) || !secret) return false
  const actualHash = sha256Base64Url(secret)
  const nowMs = Date.now()
  const tokens = (Array.isArray(config.tokens) ? config.tokens : [])
    .filter((entry) => entry && typeof entry.tokenHash === 'string'
      && (!entry.expiresAt || Date.parse(entry.expiresAt) > nowMs))
  return tokens.some((entry) => (entry.authVersion || 1) === (config.authVersion || 1) && safeHashEqual(entry.tokenHash, actualHash))
}
