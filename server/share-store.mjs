import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { hashPassword, sha256Base64Url, verifyPassword } from './utils/password-auth.mjs'
import { getShareRepository } from './share-service.mjs'
import { isShareMaintenanceActive } from './share-maintenance.mjs'

const SHARE_ID_PREFIX = 'qfs_'
const writeQueueName = 'conversation-shares'
const writeQueues = new Map()
const shareLifecycleEvents = new EventEmitter()
shareLifecycleEvents.setMaxListeners(0)

export function onConversationShareInvalidated(listener) {
  shareLifecycleEvents.on('invalidated', listener)
  return () => shareLifecycleEvents.removeListener('invalidated', listener)
}

function emitConversationShareInvalidated(shareId, reason) {
  shareLifecycleEvents.emit('invalidated', { shareId, reason })
}

// Share writes have a single SQLite-authoritative path; while the share
// maintenance lock is held they fail fast with 423 so backup/restore can never
// observe a concurrent write.
function assertShareWritesAllowed() {
  if (isShareMaintenanceActive()) {
    const error = new Error('Share storage is under maintenance')
    error.statusCode = 423
    error.errorCode = 'SHARE_MAINTENANCE_ACTIVE'
    throw error
  }
}

function enqueueWrite(queueName, operation) {
  const previous = writeQueues.get(queueName) || Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(operation)
  writeQueues.set(queueName, next)
  return next
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

export async function hashSharePassword(password, salt) {
  if (password === undefined || password === null || typeof password !== 'string') return {}
  if (!password) return { passwordHash: undefined, passwordSalt: undefined, passwordVersion: undefined }
  return hashPassword(password, salt)
}

export async function verifySharePassword(record, password) {
  if (!record?.passwordHash || !record?.passwordSalt) return !password
  return verifyPassword(record, password)
}

export function createShareToken(shareId) {
  assertSafeShareId(shareId)
  const secret = randomToken(32)
  const secretHash = sha256Base64Url(secret)
  return {
    token: `${shareId}.${secret}`,
    tokenHash: secretHash,
  }
}

export function verifyShareToken(record, token) {
  if (!record || !token || typeof token !== 'string') return false
  return getShareRepository().verifyToken(record, token)
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
    assertShareWritesAllowed()
    const repository = getShareRepository()
    const existingShares = repository.list({ sessionId, includeRevoked: true })
    const current = existingShares.find((record) => !record.supersededAt)

    if (permission === 'operate') {
      const willHavePassword = passwordProvided ? Boolean(normalizedPassword) : Boolean(current?.passwordHash)
      if (!willHavePassword) {
        const error = new Error('Editable shares require a non-empty password')
        error.statusCode = 400
        throw error
      }
    }

    const timestamp = new Date().toISOString()
    // Preserve the existing password when the client did not send a new one,
    // and keep access counters intact.
    const existingPassword = current?.passwordHash
      ? { passwordHash: current.passwordHash, passwordSalt: current.passwordSalt, passwordVersion: current.passwordVersion }
      : {}
    const created = repository.create({
      id: current?.id || generateShareId(),
      sessionId,
      permission,
      titleSnapshot: titleSnapshot || current?.titleSnapshot || 'New chat',
      scope: scope === 'project' ? 'project' : 'global',
      projectId: scope === 'project' ? projectId : undefined,
      expiresAt: expiresAt || undefined,
      createdAt: current?.createdAt || timestamp,
      updatedAt: timestamp,
      accessCount: current?.accessCount ?? 0,
      lastAccessedAt: current?.lastAccessedAt,
      createdFromHost,
      lastUpdatedFromHost: createdFromHost,
      ...(passwordProvided ? passwordInfo : existingPassword),
    }, { passwordChanged: passwordProvided })

    for (const record of existingShares) {
      if (record.id !== current?.id && !record.supersededAt) emitConversationShareInvalidated(record.id, 'superseded')
    }
    if (current) {
      const lifecycleChanged = Boolean(current.revokedAt)
        || String(current.expiresAt || '') !== String(created.expiresAt || '')
        || (passwordProvided && (current.authVersion || 1) !== (created.authVersion || 1))
      if (lifecycleChanged) emitConversationShareInvalidated(current.id, 'updated')
    }
    return publicShareRecord(created)
  })
}

export async function readConversationShare(shareId) {
  assertSafeShareId(shareId)
  return getShareRepository().get(shareId)
}

export async function listConversationShares(sessionId) {
  const records = getShareRepository().list({ sessionId: sessionId || undefined, includeRevoked: true })
  return records.map(publicShareRecord)
}

export async function revokeConversationShare(shareId) {
  assertSafeShareId(shareId)
  return enqueueWrite(writeQueueName, async () => {
    assertShareWritesAllowed()
    const repository = getShareRepository()
    const record = repository.get(shareId)
    if (!record) {
      const error = new Error('Share not found')
      error.statusCode = 404
      throw error
    }
    const wasActive = !record.revokedAt
    const revoked = repository.revoke(shareId, {})
    if (wasActive) emitConversationShareInvalidated(shareId, 'revoked')
    return publicShareRecord(revoked)
  })
}

export async function restoreConversationShare(shareId, expiresAt) {
  assertSafeShareId(shareId)
  if (expiresAt && (Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
    const error = new Error('Expiration time must be in the future')
    error.statusCode = 400
    throw error
  }
  return enqueueWrite(writeQueueName, async () => {
    assertShareWritesAllowed()
    const restored = getShareRepository().restore(shareId, { expiresAt })
    return publicShareRecord(restored)
  })
}

export async function updateConversationShareExpiration(shareId, expiresAt) {
  assertSafeShareId(shareId)
  if (expiresAt && (Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
    const error = new Error('Expiration time must be in the future')
    error.statusCode = 400
    throw error
  }
  return enqueueWrite(writeQueueName, async () => {
    assertShareWritesAllowed()
    const updated = getShareRepository().update(shareId, { expiresAt: expiresAt || null })
    emitConversationShareInvalidated(shareId, 'updated')
    return publicShareRecord(updated)
  })
}

export async function updateConversationShare(shareId, { permission, password, expiresAt } = {}) {
  assertSafeShareId(shareId)
  const passwordProvided = typeof password === 'string'
  const normalizedPassword = passwordProvided ? password.trim() : undefined
  if (expiresAt && (Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
    const error = new Error('Expiration time must be in the future')
    error.statusCode = 400
    throw error
  }
  const passwordInfo = passwordProvided ? await hashSharePassword(normalizedPassword) : {}
  return enqueueWrite(writeQueueName, async () => {
    assertShareWritesAllowed()
    const repository = getShareRepository()
    const existing = repository.get(shareId)
    if (!existing) {
      const error = new Error('Share not found')
      error.statusCode = 404
      throw error
    }
    const updated = repository.update(shareId, {
      permission,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...passwordInfo,
    })
    const lifecycleChanged = (permission !== undefined && permission !== existing.permission)
      || (expiresAt !== undefined && String(existing.expiresAt || '') !== String(expiresAt || ''))
      || passwordProvided
    if (lifecycleChanged) emitConversationShareInvalidated(shareId, 'updated')
    return publicShareRecord(updated)
  })
}

export async function deleteConversationShare(shareId) {
  assertSafeShareId(shareId)
  return enqueueWrite(writeQueueName, async () => {
    assertShareWritesAllowed()
    const repository = getShareRepository()
    const record = repository.get(shareId)
    if (!record) {
      const error = new Error('Share not found')
      error.statusCode = 404
      throw error
    }
    repository.delete(shareId, {})
    emitConversationShareInvalidated(shareId, 'deleted')
    return publicShareRecord(record)
  })
}

export async function issueConversationShareToken(shareId) {
  assertSafeShareId(shareId)
  return enqueueWrite(writeQueueName, async () => {
    assertShareWritesAllowed()
    const result = getShareRepository().issueToken(shareId, {})
    return { token: result.token, share: publicShareRecord(result.share) }
  })
}

function messageTimestampMs(message) {
  const timestamp = message?.timestamp
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) return timestamp
  if (typeof timestamp === 'string') {
    const trimmed = timestamp.trim()
    if (!trimmed) return undefined
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) return numeric
    const parsed = Date.parse(trimmed)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

function lastModifiedFromMessages(messages, fallback) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const timestamp = messageTimestampMs(messages[index])
    if (timestamp !== undefined) return new Date(timestamp).toISOString()
  }
  const fallbackMs = Date.parse(fallback)
  return Number.isNaN(fallbackMs) ? new Date().toISOString() : new Date(fallbackMs).toISOString()
}

export async function rollbackSharedSessionMessages(record, rollbackMessageIndex) {
  const { readSessionValue, atomicSessionRecordUpdate } = await import('./storage.mjs')
  const { rollbackSessionMessages, rollbackStartIndexFromMessage } = await import('./agent-manager.mjs')
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

  try {
    return await rollbackSessionMessages(record.sessionId, rollbackMessageIndex)
  } catch (error) {
    if (error?.statusCode !== 404) throw error
  }

  const nextMessages = messages.slice(0, rollbackIndex)
  const lastModified = lastModifiedFromMessages(nextMessages, session.createdAt || session.lastModified)
  // Body + metadata roll back as one atomic session record update (single
  // SQLite transaction), so the shared page never observes a body rolled back
  // while metadata still counts the removed messages.
  const updated = await atomicSessionRecordUpdate(record.sessionId, ({ state, metadata }) => {
    if (state.archivedAt) return null
    return {
      state: { ...state, messages: nextMessages, lastModified },
      metadata: { ...metadata, messageCount: nextMessages.length, lastModified, preview: previewFromMessages(nextMessages) },
    }
  })
  if (!updated) {
    const error = new Error('Session not found')
    error.statusCode = 404
    throw error
  }
  return { session: { ...session, messages: nextMessages, lastModified }, rollbackIndex }
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
