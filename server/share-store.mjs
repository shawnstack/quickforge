import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { ensureStorage, storageDir } from './storage.mjs'

const scrypt = promisify(scryptCallback)
const SHARE_ID_PREFIX = 'qfs_'
const PASSWORD_VERSION = 1
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
    const parsed = raw.trim() ? JSON.parse(raw) : {}
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
    titleSnapshot: record.titleSnapshot,
    scope: record.scope,
    projectId: record.projectId,
    accessCount: record.accessCount || 0,
    lastAccessedAt: record.lastAccessedAt,
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
  if (!password || typeof password !== 'string') {
    const error = new Error('Missing share password')
    error.statusCode = 400
    throw error
  }

  const derived = await scrypt(password, salt, 32)
  return {
    passwordHash: derived.toString('base64url'),
    passwordSalt: salt,
    passwordVersion: PASSWORD_VERSION,
  }
}

export async function verifySharePassword(record, password) {
  if (!record?.passwordHash || !record?.passwordSalt || !password) return false
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

export function verifyShareToken(record, token) {
  if (!record?.tokenHash || !token || typeof token !== 'string') return false
  const [tokenShareId, secret] = token.split('.')
  if (tokenShareId !== record.id || !secret) return false
  const actual = Buffer.from(createHash('sha256').update(secret).digest('base64url'))
  const expected = Buffer.from(record.tokenHash)
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
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

  const passwordInfo = await hashSharePassword(password)
  return enqueueWrite(writeQueueName, async () => {
    const data = await readShareStoreFile()
    let id = generateShareId()
    while (data[id]) id = generateShareId()
    const now = new Date().toISOString()
    const record = {
      id,
      sessionId,
      permission,
      ...passwordInfo,
      createdAt: now,
      expiresAt: expiresAt || undefined,
      revokedAt: undefined,
      titleSnapshot: titleSnapshot || 'New chat',
      scope: scope === 'project' ? 'project' : 'global',
      projectId: scope === 'project' ? projectId : undefined,
      accessCount: 0,
      lastAccessedAt: undefined,
      createdFromHost,
      tokenHash: undefined,
      tokenIssuedAt: undefined,
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
    .map(publicShareRecord)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
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
    record.tokenHash = undefined
    record.tokenIssuedAt = undefined
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
    record.tokenHash = tokenHash
    record.tokenIssuedAt = new Date().toISOString()
    record.accessCount = (record.accessCount || 0) + 1
    record.lastAccessedAt = new Date().toISOString()
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
