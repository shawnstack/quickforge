import { hashPassword, verifyPassword } from './utils/password-auth.mjs'
import { lanAccessTokenId, normalizeLanAccessAddress, normalizeLanAccessText } from './sqlite/lan-access-repository.mjs'
import { getLanAccessRepository } from './lan-access-service.mjs'
import { isLanAccessMaintenanceActive } from './lan-access-maintenance.mjs'

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

// Every read/write goes through the LAN access repository: SQLite is the single
// authoritative store (no JSON file, no mirror, no storage phase).
function repository() {
  return getLanAccessRepository()
}

// Export/restore operations hold the LAN access maintenance lock; concurrent
// writes fail closed with 423 instead of racing the locked transaction.
function assertLanAccessWritesAllowed() {
  if (isLanAccessMaintenanceActive()) {
    const error = new Error('LAN access storage is under maintenance')
    error.statusCode = 423
    error.errorCode = 'LAN_ACCESS_MAINTENANCE_ACTIVE'
    throw error
  }
}

// A fresh database has no config row yet: LAN access then starts disabled,
// which is the fail-closed default (remote clients stay blocked until an admin
// sets a password and enables it).
export function defaultLanAccessConfig() {
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

function currentConfig() {
  return repository().getConfig() || defaultLanAccessConfig()
}

function publicTokenRecord(tokenRecord) {
  return {
    id: lanAccessTokenId(tokenRecord),
    address: normalizeLanAccessAddress(tokenRecord.remoteAddress),
    userAgent: normalizeLanAccessText(tokenRecord.userAgent, 300),
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
      id: lanAccessTokenId(tokenRecord),
      remoteAddress: normalizeLanAccessAddress(tokenRecord.remoteAddress),
      userAgent: normalizeLanAccessText(tokenRecord.userAgent, 300),
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
  return publicStatus(currentConfig())
}

export async function updateLanAccessSettings({ enabled, password, sessionTtlHours }) {
  return enqueueWrite(writeQueueName, async () => {
    assertLanAccessWritesAllowed()
    const passwordProvided = typeof password === 'string' && password.length > 0
    if (passwordProvided) assertPasswordAllowed(password)
    const passwordInfo = passwordProvided ? await hashPassword(password.trim()) : {}
    const updated = repository().updateSettings({
      enabled,
      sessionTtlHours,
      ...passwordInfo,
    })
    return publicStatus(updated.config)
  })
}

export async function revokeLanAccessTokens() {
  return enqueueWrite(writeQueueName, async () => {
    assertLanAccessWritesAllowed()
    const updated = repository().revokeAll()
    return publicStatus(updated.config)
  })
}

export async function revokeLanAccessTokenById(id) {
  const normalizedId = normalizeLanAccessText(id, 128)
  if (!normalizedId) {
    const error = new Error('LAN access session id is required.')
    error.statusCode = 400
    throw error
  }
  return enqueueWrite(writeQueueName, async () => {
    assertLanAccessWritesAllowed()
    const updated = repository().revokeTokenById(normalizedId)
    return publicStatus(updated.config)
  })
}

export async function revokeLanAccessToken(token) {
  if (!token || typeof token !== 'string') return false
  const [, secret] = token.split('.')
  if (!secret) return false
  return enqueueWrite(writeQueueName, async () => {
    assertLanAccessWritesAllowed()
    return repository().revokeToken(token)
  })
}

export function lanAccessCookieName() {
  return 'qf_lan_access'
}

export async function issueLanAccessToken(password, metadata = {}) {
  return enqueueWrite(writeQueueName, async () => {
    assertLanAccessWritesAllowed()
    const current = currentConfig()
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
    const result = repository().issueToken({
      remoteAddress: metadata.remoteAddress,
      userAgent: metadata.userAgent,
    })
    return {
      token: result.token,
      expiresAt: result.expiresAt,
      maxAge: result.maxAge,
    }
  })
}

export async function verifyLanAccessToken(token) {
  try {
    return repository().verifyToken(token)
  } catch {
    // Fail closed on any storage error or malformed input: LAN access is
    // denied rather than accidentally allowed.
    return false
  }
}
