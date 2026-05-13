import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ensureStorage, storageDir } from './storage.mjs'
import { createRandomToken, hashPassword, safeHashEqual, sha256Base64Url, verifyPassword } from './utils/password-auth.mjs'

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

function publicStatus(config) {
  return {
    enabled: Boolean(config.enabled),
    hasPassword: Boolean(config.passwordHash),
    sessionTtlHours: config.sessionTtlHours,
    authVersion: config.authVersion || 1,
    activeTokenCount: pruneTokens(config.tokens).length,
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
  return publicStatus(await readLanAccessFile())
}

export async function readLanAccessConfig() {
  return readLanAccessFile()
}

export async function updateLanAccessSettings({ enabled, password, sessionTtlHours }) {
  return enqueueWrite(writeQueueName, async () => {
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

export function lanAccessCookieName() {
  return 'qf_lan_access'
}

export async function issueLanAccessToken(password) {
  return enqueueWrite(writeQueueName, async () => {
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
    const next = normalizeConfig({
      ...current,
      tokens: [
        ...pruneTokens(current.tokens),
        { tokenHash, issuedAt, expiresAt, authVersion: current.authVersion || 1 },
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
  const current = await readLanAccessFile()
  if (!current.enabled || !current.passwordHash || !token || typeof token !== 'string') return false
  const [versionText, secret] = token.split('.')
  if (Number(versionText) !== (current.authVersion || 1) || !secret) return false
  const actualHash = sha256Base64Url(secret)
  return pruneTokens(current.tokens).some((tokenRecord) => {
    if ((tokenRecord.authVersion || 1) !== (current.authVersion || 1)) return false
    return safeHashEqual(tokenRecord.tokenHash, actualHash)
  })
}
