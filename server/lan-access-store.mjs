import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ensureStorage, storageDir } from './storage.mjs'
import { createRandomToken, hashPassword, safeHashEqual, sha256Base64Url, verifyPassword } from './utils/password-auth.mjs'
import { getLanAccessRepository, isLanAccessStorageAuthoritative, requestLanAccessJsonMirrorDrain } from './lan-access-service.mjs'
import { isLanAccessMaintenanceActive } from './lan-access-cutover.mjs'

const LAN_ACCESS_DIR = path.join(storageDir, 'security')
const LAN_ACCESS_FILE = path.join(LAN_ACCESS_DIR, 'lan-access.json')
const LAN_TOKEN_MAX_COUNT = 100
const DEFAULT_SESSION_TTL_HOURS = 12
const MIN_PASSWORD_LENGTH = 8
const writeQueueName = 'lan-access'
const writeQueues = new Map()

function enqueueWrite(queueName, operation) {
  const previous = writeQueues.get(queueName) || Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(operation)
  writeQueues.set(queueName, next)
  return next
}

// F11 Phase 2: once the LAN access storage is SQLite-readable
// (sqlite_authoritative_json_pending/authoritative) every read/write routes
// through the repository and the JSON file degrades to a best-effort mirror.
// json_authoritative/cutover_running keep the legacy JSON path below.
function repositoryActive() {
  return isLanAccessStorageAuthoritative()
}

// Maintenance writes are only blocked while the SQLite store is authoritative;
// the legacy JSON path keeps working during cutover/maintenance.
function assertLanAccessWritesAllowed() {
  if (!repositoryActive()) return
  if (isLanAccessMaintenanceActive()) {
    const error = new Error('LAN access storage is under maintenance')
    error.statusCode = 423
    error.errorCode = 'LAN_ACCESS_MAINTENANCE_ACTIVE'
    throw error
  }
}

// Fail closed on a missing config record: pending/authoritative states are only
// entered after cutover integrity verification, so a missing row means the
// store is damaged and must not be silently treated as default-disabled.
function requireLanAccessRepositoryConfig() {
  const config = getLanAccessRepository().getConfig()
  if (!config) {
    const error = new Error('LAN access state is unavailable')
    error.statusCode = 503
    error.errorCode = 'LAN_ACCESS_STATE_UNAVAILABLE'
    throw error
  }
  return config
}

function defaultLanAccessConfig() {
  return {
    enabled: false,
    passwordHash: undefined,
    passwordSalt: undefined,
    passwordVersion: undefined,
    authVersion: 1,
    sessionTtlHours: DEFAULT_SESSION_TTL_HOURS,
    updatedAt: new Date().toISOString(),
    tokens: [],
  }
}

function normalizeSessionTtlHours(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_SESSION_TTL_HOURS
  return Math.min(24 * 7, Math.max(1, Math.round(numeric)))
}

function normalizeConfig(value) {
  const base = defaultLanAccessConfig()
  const input = value && typeof value === 'object' ? value : {}
  return {
    ...base,
    ...input,
    enabled: Boolean(input.enabled),
    authVersion: Number(input.authVersion || base.authVersion),
    sessionTtlHours: normalizeSessionTtlHours(input.sessionTtlHours),
    tokens: pruneTokens(input.tokens),
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : base.updatedAt,
  }
}

async function ensureLanAccessStore() {
  await ensureStorage()
  await fs.mkdir(LAN_ACCESS_DIR, { recursive: true })
  try {
    await fs.access(LAN_ACCESS_FILE)
  } catch {
    await fs.writeFile(LAN_ACCESS_FILE, `${JSON.stringify(defaultLanAccessConfig(), null, 2)}\n`, 'utf8')
  }
}

async function readLanAccessFile() {
  await ensureLanAccessStore()
  try {
    const raw = await fs.readFile(LAN_ACCESS_FILE, 'utf8')
    const text = raw.trimStart()
    return normalizeConfig(text ? JSON.parse(text) : {})
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultLanAccessConfig()
    throw error
  }
}

async function writeLanAccessFile(config) {
  await ensureLanAccessStore()
  await fs.writeFile(LAN_ACCESS_FILE, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, 'utf8')
}

function normalizeText(value, maxLength) {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text ? text.slice(0, maxLength) : undefined
}

function normalizeRemoteAddress(value) {
  const address = normalizeText(value, 128)
  return address?.startsWith('::ffff:') ? address.slice(7) : address
}

function tokenRecordId(tokenRecord) {
  const id = normalizeText(tokenRecord?.id, 128)
  return id || `legacy_${sha256Base64Url(tokenRecord?.tokenHash || '').slice(0, 24)}`
}

function publicTokenRecord(tokenRecord) {
  return {
    id: tokenRecordId(tokenRecord),
    address: normalizeRemoteAddress(tokenRecord.remoteAddress),
    userAgent: normalizeText(tokenRecord.userAgent, 300),
    issuedAt: tokenRecord.issuedAt,
    expiresAt: tokenRecord.expiresAt,
  }
}

function publicStatus(config) {
  const activeTokens = pruneTokens(config.tokens)
  return {
    enabled: Boolean(config.enabled),
    hasPassword: Boolean(config.passwordHash),
    sessionTtlHours: config.sessionTtlHours,
    authVersion: config.authVersion || 1,
    activeTokenCount: activeTokens.length,
    activeDevices: activeTokens.map(publicTokenRecord),
    updatedAt: config.updatedAt,
  }
}

function pruneTokens(tokens, now = Date.now()) {
  return (Array.isArray(tokens) ? tokens : [])
    .filter((tokenRecord) => {
      if (!tokenRecord?.tokenHash) return false
      if (!tokenRecord.expiresAt) return true
      return Date.parse(tokenRecord.expiresAt) > now
    })
    .map((tokenRecord) => ({
      ...tokenRecord,
      id: tokenRecordId(tokenRecord),
      remoteAddress: normalizeRemoteAddress(tokenRecord.remoteAddress),
      userAgent: normalizeText(tokenRecord.userAgent, 300),
    }))
    .slice(-LAN_TOKEN_MAX_COUNT)
}

function assertPasswordAllowed(password) {
  if (typeof password !== 'string' || password.trim().length < MIN_PASSWORD_LENGTH) {
    const error = new Error(`LAN access password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    error.statusCode = 400
    throw error
  }
}

export async function readLanAccessStatus() {
  if (repositoryActive()) return publicStatus(requireLanAccessRepositoryConfig())
  return publicStatus(await readLanAccessFile())
}

export async function readLanAccessConfig() {
  if (repositoryActive()) return requireLanAccessRepositoryConfig()
  return readLanAccessFile()
}

export async function updateLanAccessSettings({ enabled, password, sessionTtlHours }) {
  return enqueueWrite(writeQueueName, async () => {
    assertLanAccessWritesAllowed()
    if (repositoryActive()) {
      const passwordProvided = typeof password === 'string' && password.length > 0
      if (passwordProvided) assertPasswordAllowed(password)
      const passwordInfo = passwordProvided ? await hashPassword(password.trim()) : {}
      const updated = getLanAccessRepository().updateSettings({
        enabled,
        sessionTtlHours,
        ...passwordInfo,
      })
      requestLanAccessJsonMirrorDrain()
      return publicStatus(updated.config)
    }
    const current = await readLanAccessFile()
    const passwordProvided = typeof password === 'string' && password.length > 0
    const nextEnabled = Boolean(enabled)

    if (passwordProvided) assertPasswordAllowed(password)
    if (nextEnabled && !passwordProvided && !current.passwordHash) {
      const error = new Error('LAN access password is required before enabling full LAN access.')
      error.statusCode = 400
      throw error
    }

    const passwordInfo = passwordProvided ? await hashPassword(password.trim()) : {}
    const now = new Date().toISOString()
    const authChanged = passwordProvided || current.enabled !== nextEnabled
    const next = normalizeConfig({
      ...current,
      ...passwordInfo,
      enabled: nextEnabled,
      authVersion: authChanged ? (current.authVersion || 1) + 1 : (current.authVersion || 1),
      sessionTtlHours: normalizeSessionTtlHours(sessionTtlHours ?? current.sessionTtlHours),
      updatedAt: now,
      tokens: authChanged ? [] : pruneTokens(current.tokens),
    })

    await writeLanAccessFile(next)
    return publicStatus(next)
  })
}

export async function revokeLanAccessTokens() {
  return enqueueWrite(writeQueueName, async () => {
    assertLanAccessWritesAllowed()
    if (repositoryActive()) {
      const updated = getLanAccessRepository().revokeAll()
      requestLanAccessJsonMirrorDrain()
      return publicStatus(updated.config)
    }
    const current = await readLanAccessFile()
    const next = normalizeConfig({
      ...current,
      authVersion: (current.authVersion || 1) + 1,
      tokens: [],
      updatedAt: new Date().toISOString(),
    })
    await writeLanAccessFile(next)
    return publicStatus(next)
  })
}

export async function revokeLanAccessTokenById(id) {
  const normalizedId = normalizeText(id, 128)
  if (!normalizedId) {
    const error = new Error('LAN access session id is required.')
    error.statusCode = 400
    throw error
  }
  return enqueueWrite(writeQueueName, async () => {
    assertLanAccessWritesAllowed()
    if (repositoryActive()) {
      const updated = getLanAccessRepository().revokeTokenById(normalizedId)
      requestLanAccessJsonMirrorDrain()
      return publicStatus(updated.config)
    }
    const current = await readLanAccessFile()
    const tokens = pruneTokens(current.tokens)
    const nextTokens = tokens.filter((tokenRecord) => tokenRecordId(tokenRecord) !== normalizedId)
    if (nextTokens.length === tokens.length) {
      const error = new Error('LAN access session not found.')
      error.statusCode = 404
      throw error
    }
    const next = normalizeConfig({
      ...current,
      tokens: nextTokens,
      updatedAt: new Date().toISOString(),
    })
    await writeLanAccessFile(next)
    return publicStatus(next)
  })
}

export async function revokeLanAccessToken(token) {
  if (!token || typeof token !== 'string') return false
  const [versionText, secret] = token.split('.')
  if (!secret) return false
  const actualHash = sha256Base64Url(secret)
  return enqueueWrite(writeQueueName, async () => {
    assertLanAccessWritesAllowed()
    if (repositoryActive()) {
      const revoked = getLanAccessRepository().revokeToken(token)
      requestLanAccessJsonMirrorDrain()
      return revoked
    }
    const current = await readLanAccessFile()
    if (Number(versionText) !== (current.authVersion || 1)) return false
    const tokens = pruneTokens(current.tokens)
    const nextTokens = tokens.filter((tokenRecord) => !safeHashEqual(tokenRecord.tokenHash, actualHash))
    if (nextTokens.length === tokens.length) return false
    const next = normalizeConfig({
      ...current,
      tokens: nextTokens,
      updatedAt: new Date().toISOString(),
    })
    await writeLanAccessFile(next)
    return true
  })
}

export function lanAccessCookieName() {
  return 'qf_lan_access'
}

export async function issueLanAccessToken(password, metadata = {}) {
  return enqueueWrite(writeQueueName, async () => {
    assertLanAccessWritesAllowed()
    if (repositoryActive()) {
      const repository = getLanAccessRepository()
      const current = repository.getConfig()
      if (!current?.enabled || !current.passwordHash) {
        const error = new Error('LAN access is not enabled.')
        error.statusCode = 403
        throw error
      }
      if (!(await verifyPassword(current, typeof password === 'string' ? password.trim() : ''))) {
        const error = new Error('Invalid LAN access password')
        error.statusCode = 401
        throw error
      }
      const result = repository.issueToken({
        remoteAddress: metadata.remoteAddress,
        userAgent: metadata.userAgent,
      })
      requestLanAccessJsonMirrorDrain()
      return {
        token: result.token,
        expiresAt: result.expiresAt,
        maxAge: result.maxAge,
      }
    }
    const current = await readLanAccessFile()
    if (!current.enabled || !current.passwordHash) {
      const error = new Error('LAN access is not enabled.')
      error.statusCode = 403
      throw error
    }
    if (!(await verifyPassword(current, typeof password === 'string' ? password.trim() : ''))) {
      const error = new Error('Invalid LAN access password')
      error.statusCode = 401
      throw error
    }

    const secret = createRandomToken(32)
    const tokenHash = sha256Base64Url(secret)
    const issuedAt = new Date().toISOString()
    const ttlMs = normalizeSessionTtlHours(current.sessionTtlHours) * 60 * 60 * 1000
    const expiresAt = new Date(Date.now() + ttlMs).toISOString()
    const tokenRecord = {
      id: createRandomToken(18),
      tokenHash,
      issuedAt,
      expiresAt,
      authVersion: current.authVersion || 1,
      remoteAddress: normalizeRemoteAddress(metadata.remoteAddress),
      userAgent: normalizeText(metadata.userAgent, 300),
    }
    const next = normalizeConfig({
      ...current,
      tokens: [
        ...pruneTokens(current.tokens),
        tokenRecord,
      ].slice(-LAN_TOKEN_MAX_COUNT),
      updatedAt: issuedAt,
    })
    await writeLanAccessFile(next)
    return {
      token: `${current.authVersion || 1}.${secret}`,
      expiresAt,
      maxAge: Math.floor(ttlMs / 1000),
    }
  })
}

export async function verifyLanAccessToken(token) {
  try {
    if (repositoryActive()) return getLanAccessRepository().verifyToken(token)
    const current = await readLanAccessFile()
    if (!current.enabled || !current.passwordHash || !token || typeof token !== 'string') return false
    const [versionText, secret] = token.split('.')
    if (Number(versionText) !== (current.authVersion || 1) || !secret) return false
    const actualHash = sha256Base64Url(secret)
    return pruneTokens(current.tokens).some((tokenRecord) => {
      if ((tokenRecord.authVersion || 1) !== (current.authVersion || 1)) return false
      return safeHashEqual(tokenRecord.tokenHash, actualHash)
    })
  } catch {
    // Fail closed on any storage error or malformed input: LAN access is
    // denied rather than accidentally allowed.
    return false
  }
}
