import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { ensureStorage, storageDir } from './storage.mjs'

const scrypt = promisify(scryptCallback)
const SHARE_ID_PREFIX = 'qfs_'
const PASSWORD_VERSION = 1
const SHARE_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_SHARE_TOKENS = 50
const SHARES_DIR = path.join(storageDir, 'shares')
const SHARES_FILE = path.join(SHARES_DIR, 'conversation-shares.json')
const writeQueueName = 'conversation-shares'
const writeQueues = new Map()

function enqueueWrite(queueName, operation) {
  const previous = writeQueues.get(queueName) || Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(operation)
  writeQueues.set(queueName, next)
  return next
}

async function ensureShareStore() {
  await ensureStorage()
  await fs.mkdir(SHARES_DIR, { recursive: true })
  try {
    await fs.access(SHARES_FILE)
  } catch {
    await fs.writeFile(SHARES_FILE, '{}\n', 'utf8')
  }
}

async function readShareStoreFile() {
  await ensureShareStore()
  try {
    const raw = await fs.readFile(SHARES_FILE, 'utf8')
    const text = raw.trimStart()
    const parsed = text ? JSON.parse(text) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

async function writeShareStoreFile(data) {
  await ensureShareStore()
  await fs.writeFile(SHARES_FILE, `${JSON.stringify(data || {}, null, 2)}\n`, 'utf8')
}

function publicShareRecord(record) {
  if (!record) return null
  return {
    id: record.id,
    sessionId: record.sessionId,
    permission: record.permission,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    updatedAt: record.updatedAt,
    titleSnapshot: record.titleSnapshot,
    scope: record.scope,
    projectId: record.projectId,
    accessCount: record.accessCount || 0,
    lastAccessedAt: record.lastAccessedAt,
    hasPassword: Boolean(record.passwordHash),
  }
}

function assertValidPermission(permission) {
  if (permission !== 'read' && permission !== 'operate') {
    const error = new Error('Invalid share permission')
    error.statusCode = 400
    throw error
  }
}

function assertSafeShareId(shareId) {
  if (!shareId || typeof shareId !== 'string' || !/^qfs_[A-Za-z0-9_-]{16,80}$/.test(shareId)) {
    const error = new Error('Invalid share id')
    error.statusCode = 400
    throw error
  }
}

function randomToken(bytes = 24) {
  return randomBytes(bytes).toString('base64url')
}

function generateShareId() {
  return `${SHARE_ID_PREFIX}${randomToken(18)}`
}

export function generateSharePassword() {
  return `${randomToken(4).slice(0, 6).toUpperCase()}-${randomToken(4).slice(0, 6).toUpperCase()}`
}

export async function hashSharePassword(password, salt = randomToken(16)) {
  if (password === undefined || password === null || typeof password !== 'string') return {}
  if (!password) return { passwordHash: undefined, passwordSalt: undefined, passwordVersion: undefined }

  const derived = await scrypt(password, salt, 32)
  return {
    passwordHash: derived.toString('base64url'),
    passwordSalt: salt,
    passwordVersion: PASSWORD_VERSION,
  }
}

export async function verifySharePassword(record, password) {
  if (!record?.passwordHash || !record?.passwordSalt) return !password
  if (!password) return false
  const { passwordHash } = await hashSharePassword(password, record.passwordSalt)
  const expected = Buffer.from(record.passwordHash, 'base64url')
  const actual = Buffer.from(passwordHash, 'base64url')
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

export function createShareToken(shareId) {
  assertSafeShareId(shareId)
  const secret = randomToken(32)
  const secretHash = createHash('sha256').update(secret).digest('base64url')
  return {
    token: `${shareId}.${secret}`,
    tokenHash: secretHash,
  }
}

function pruneShareTokens(tokens, now = Date.now()) {
  return (Array.isArray(tokens) ? tokens : [])
    .filter((tokenRecord) => {
      if (!tokenRecord?.tokenHash) return false
      if (!tokenRecord.expiresAt) return true
      return Date.parse(tokenRecord.expiresAt) > now
    })
    .slice(-MAX_SHARE_TOKENS)
}

function safeHashEqual(expectedHash, actualHash) {
  if (!expectedHash || !actualHash) return false
  const expected = Buffer.from(expectedHash)
  const actual = Buffer.from(actualHash)
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

export function verifyShareToken(record, token) {
  if (!record || !token || typeof token !== 'string') return false
  const [tokenShareId, secret] = token.split('.')
  if (tokenShareId !== record.id || !secret) return false
  const actualHash = createHash('sha256').update(secret).digest('base64url')
  const authVersion = record.authVersion || 1
  const tokenRecords = pruneShareTokens(record.tokens)

  if (record.tokenHash) {
    tokenRecords.push({ tokenHash: record.tokenHash, authVersion: record.authVersion || 1 })
  }

  return tokenRecords.some((tokenRecord) => {
    if ((tokenRecord.authVersion || 1) !== authVersion) return false
    return safeHashEqual(tokenRecord.tokenHash, actualHash)
  })
}

export function parseCookies(cookieHeader) {
  const cookies = new Map()
  for (const part of String(cookieHeader || '').split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (!name) continue
    cookies.set(name, decodeURIComponent(value))
  }
  return cookies
}

export function shareCookieName(shareId) {
  return `qf_share_${shareId}`
}

export function assertShareActive(record) {
  if (!record) {
    const error = new Error('Share not found')
    error.statusCode = 404
    throw error
  }
  if (record.supersededAt) {
    const error = new Error('Share has been replaced by the current link for this conversation')
    error.statusCode = 410
    throw error
  }
  if (record.revokedAt) {
    const error = new Error('Share has been revoked')
    error.statusCode = 410
    throw error
  }
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) {
    const error = new Error('Share has expired')
    error.statusCode = 410
    throw error
  }
}

function currentRecordForSession(data, sessionId) {
  return Object.values(data)
    .filter((record) => record?.sessionId === sessionId && !record.supersededAt)
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0]
}

export async function createConversationShare({
  sessionId,
  permission,
  password,
  expiresAt,
  titleSnapshot,
  scope,
  projectId,
  createdFromHost,
}) {
  if (!sessionId || typeof sessionId !== 'string') {
    const error = new Error('Missing session id')
    error.statusCode = 400
    throw error
  }
  assertValidPermission(permission)
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
    const error = new Error('Invalid expiration time')
    error.statusCode = 400
    throw error
  }

  const passwordProvided = typeof password === 'string'
  const normalizedPassword = passwordProvided ? password.trim() : undefined
  const passwordInfo = passwordProvided ? await hashSharePassword(normalizedPassword) : {}
  return enqueueWrite(writeQueueName, async () => {
    const data = await readShareStoreFile()
    const now = new Date().toISOString()
    const existingRecords = Object.values(data)
      .filter((record) => record?.sessionId === sessionId)
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
    const existing = currentRecordForSession(data, sessionId)

    if (permission === 'operate') {
      const willHavePassword = passwordProvided ? Boolean(normalizedPassword) : Boolean(existing?.passwordHash)
      if (!willHavePassword) {
        const error = new Error('Editable shares require a non-empty password')
        error.statusCode = 400
        throw error
      }
    }

    for (const stale of existingRecords.filter((record) => record?.id !== existing?.id)) {
      stale.supersededAt = stale.supersededAt || now
      stale.revokedAt = stale.revokedAt || now
      stale.updatedAt = now
      stale.tokens = []
      stale.tokenHash = undefined
      stale.tokenIssuedAt = undefined
      stale.tokenExpiresAt = undefined
      data[stale.id] = stale
    }

    if (existing?.id) {
      const record = {
        ...existing,
        permission,
        ...passwordInfo,
        updatedAt: now,
        supersededAt: undefined,
        expiresAt: expiresAt || undefined,
        revokedAt: undefined,
        titleSnapshot: titleSnapshot || existing.titleSnapshot || 'New chat',
        scope: scope === 'project' ? 'project' : 'global',
        projectId: scope === 'project' ? projectId : undefined,
        createdFromHost: existing.createdFromHost || createdFromHost,
        lastUpdatedFromHost: createdFromHost,
        authVersion: existing.authVersion || 1,
        tokens: existing.tokens,
        tokenHash: existing.tokenHash,
        tokenIssuedAt: existing.tokenIssuedAt,
        tokenExpiresAt: existing.tokenExpiresAt,
      }
      if (passwordProvided) {
        record.authVersion = (existing.authVersion || 1) + 1
        record.tokens = []
        record.tokenHash = undefined
        record.tokenIssuedAt = undefined
        record.tokenExpiresAt = undefined
      }
      if (passwordProvided && !passwordInfo.passwordHash) {
        record.passwordHash = undefined
        record.passwordSalt = undefined
        record.passwordVersion = undefined
      }
      data[record.id] = record
      await writeShareStoreFile(data)
      return publicShareRecord(record)
    }

    let id = generateShareId()
    while (data[id]) id = generateShareId()
    const record = {
      id,
      sessionId,
      permission,
      ...passwordInfo,
      authVersion: 1,
      createdAt: now,
      updatedAt: now,
      supersededAt: undefined,
      expiresAt: expiresAt || undefined,
      revokedAt: undefined,
      titleSnapshot: titleSnapshot || 'New chat',
      scope: scope === 'project' ? 'project' : 'global',
      projectId: scope === 'project' ? projectId : undefined,
      accessCount: 0,
      lastAccessedAt: undefined,
      createdFromHost,
      tokens: [],
      tokenHash: undefined,
      tokenIssuedAt: undefined,
      tokenExpiresAt: undefined,
    }
    data[id] = record
    await writeShareStoreFile(data)
    return publicShareRecord(record)
  })
}

export async function readConversationShare(shareId) {
  assertSafeShareId(shareId)
  const data = await readShareStoreFile()
  return data[shareId] || null
}

export async function listConversationShares(sessionId) {
  const data = await readShareStoreFile()
  return Object.values(data)
    .filter((record) => !sessionId || record.sessionId === sessionId)
    .filter((record) => !record.supersededAt)
    .map(publicShareRecord)
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
}

export async function revokeConversationShare(shareId) {
  assertSafeShareId(shareId)
  return enqueueWrite(writeQueueName, async () => {
    const data = await readShareStoreFile()
    const record = data[shareId]
    if (!record) {
      const error = new Error('Share not found')
      error.statusCode = 404
      throw error
    }
    record.revokedAt = record.revokedAt || new Date().toISOString()
    record.updatedAt = record.revokedAt
    record.tokens = []
    record.tokenHash = undefined
    record.tokenIssuedAt = undefined
    record.tokenExpiresAt = undefined
    data[shareId] = record
    await writeShareStoreFile(data)
    return publicShareRecord(record)
  })
}

export async function issueConversationShareToken(shareId) {
  assertSafeShareId(shareId)
  return enqueueWrite(writeQueueName, async () => {
    const data = await readShareStoreFile()
    const record = data[shareId]
    assertShareActive(record)
    const { token, tokenHash } = createShareToken(shareId)
    const issuedAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + SHARE_TOKEN_MAX_AGE_MS).toISOString()
    record.tokens = pruneShareTokens(record.tokens)
    record.tokens.push({ tokenHash, issuedAt, expiresAt, authVersion: record.authVersion || 1 })
    record.tokens = record.tokens.slice(-MAX_SHARE_TOKENS)
    record.tokenHash = undefined
    record.tokenIssuedAt = undefined
    record.tokenExpiresAt = undefined
    record.accessCount = (record.accessCount || 0) + 1
    record.lastAccessedAt = issuedAt
    data[shareId] = record
    await writeShareStoreFile(data)
    return { token, share: publicShareRecord(record) }
  })
}

export async function rollbackSharedSessionMessages(record, rollbackMessageIndex) {
  const { readSessionValue, writeSessionValue, atomicUpdate } = await import('./storage.mjs')
  const { replaceSessionMessages } = await import('./agent-manager.mjs')
  const session = await readSessionValue(record.sessionId)
  if (!session) {
    const error = new Error('Session not found')
    error.statusCode = 404
    throw error
  }
  const messages = Array.isArray(session.messages) ? session.messages : []
  const rollbackIndex = rollbackStartIndexFromMessage(messages, rollbackMessageIndex)
  if (rollbackIndex < 0) {
    const error = new Error('There is no conversation turn to roll back.')
    error.statusCode = 400
    throw error
  }
  const nextMessages = messages.slice(0, rollbackIndex)
  const activeState = await replaceSessionMessages(record.sessionId, nextMessages)
  if (activeState) return { session: activeState, rollbackIndex }

  const now = new Date().toISOString()
  await writeSessionValue(record.sessionId, {
    ...session,
    messages: nextMessages,
    lastModified: now,
  })
  await atomicUpdate('sessions-metadata', (metadata) => {
    const existing = metadata[record.sessionId]
    if (existing) {
      metadata[record.sessionId] = {
        ...existing,
        messageCount: nextMessages.length,
        lastModified: now,
        preview: previewFromMessages(nextMessages),
      }
    }
    return metadata
  })
  return { session: { ...session, messages: nextMessages, lastModified: now }, rollbackIndex }
}

function rollbackStartIndexFromMessage(messages, messageIndex) {
  let rollbackIndex = Number(messageIndex)
  if (!Number.isInteger(rollbackIndex) || rollbackIndex < 0 || rollbackIndex >= messages.length) return -1

  if (messages[rollbackIndex]?.role === 'assistant') {
    for (let index = rollbackIndex - 1; index >= 0; index--) {
      if (messages[index].role === 'user' || messages[index].role === 'user-with-attachments') {
        rollbackIndex = index
        break
      }
    }
  }

  const message = messages[rollbackIndex]
  if (!message || (message.role !== 'user' && message.role !== 'user-with-attachments')) return -1
  return rollbackIndex
}

function textFromContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ')
}

function previewFromMessages(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'assistant') return textFromContent(messages[i].content).slice(0, 200)
  }
  return ''
}
