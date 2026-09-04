import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ensureStorage, storageDir } from './storage.mjs'
import { hashPassword, safeHashEqual, sha256Base64Url, verifyPassword } from './utils/password-auth.mjs'
import { getShareRepository, isShareStorageAuthoritative, requestShareJsonMirrorDrain } from './share-service.mjs'
import { isShareMaintenanceActive } from './share-cutover.mjs'
const SHARE_ID_PREFIX = 'qfs_'
const SHARE_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_SHARE_TOKENS = 50
const SHARES_DIR = path.join(storageDir, 'shares')
const SHARES_FILE = path.join(SHARES_DIR, 'conversation-shares.json')
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

// F10 Phase 2: share writes are SQLite-authoritative once the share storage is
// pending/authoritative. The JSON file degrades to a best-effort mirror fed by
// the share mirror queue; json_authoritative/cutover_running keep the legacy
// JSON read/write path below.
function repositoryActive() {
  return isShareStorageAuthoritative()
}

function assertShareWritesAllowed() {
  if (!repositoryActive()) return
  if (isShareMaintenanceActive()) {
    const error = new Error('Share storage is under maintenance')
    error.statusCode = 423
    error.errorCode = 'SHARE_MAINTENANCE_ACTIVE'
    throw error
  }
}

function clearShareTokens(record) {
  record.authVersion = (record.authVersion || 1) + 1
  record.tokens = []
  record.tokenHash = undefined
  record.tokenIssuedAt = undefined
  record.tokenExpiresAt = undefined
}

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
    allowCloudUsage: record.allowCloudUsage === true,
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

function pruneTokenRecords(tokens, now = Date.now()) {
  return (Array.isArray(tokens) ? tokens : [])
    .filter((tokenRecord) => {
      if (!tokenRecord?.tokenHash) return false
      if (!tokenRecord.expiresAt) return true
      return Date.parse(tokenRecord.expiresAt) > now
    })
    .slice(-MAX_SHARE_TOKENS)
}

export function verifyShareToken(record, token) {
  if (!record || !token || typeof token !== 'string') return false
  if (repositoryActive()) return getShareRepository().verifyToken(record, token)
  const [tokenShareId, secret] = token.split('.')
  if (tokenShareId !== record.id || !secret) return false
  const actualHash = sha256Base64Url(secret)
  const authVersion = record.authVersion || 1
  const tokenRecords = pruneTokenRecords(record.tokens)

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
  allowCloudUsage = false,
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
    if (repositoryActive()) {
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
      // Preserve the existing password when the client did not send a new one
      // (matching the legacy JSON create), and keep access counters intact.
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
        allowCloudUsage: permission === 'operate' && allowCloudUsage === true,
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
          || current.allowCloudUsage === true !== (created.allowCloudUsage === true)
          || (passwordProvided && (current.authVersion || 1) !== (created.authVersion || 1))
        if (lifecycleChanged) emitConversationShareInvalidated(current.id, 'updated')
      }
      requestShareJsonMirrorDrain()
      return publicShareRecord(created)
    }

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
      const newlySuperseded = !stale.supersededAt
      stale.supersededAt = stale.supersededAt || now
      stale.revokedAt = stale.revokedAt || now
      stale.updatedAt = now
      clearShareTokens(stale)
      data[stale.id] = stale
      if (newlySuperseded) emitConversationShareInvalidated(stale.id, 'superseded')
    }

    if (existing?.id) {
      const record = {
        ...existing,
        permission,
        ...passwordInfo,
        updatedAt: now,
        supersededAt: undefined,
        expiresAt: expiresAt || undefined,
        allowCloudUsage: permission === 'operate' && allowCloudUsage === true,
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
        clearShareTokens(record)
      }
      if (passwordProvided && !passwordInfo.passwordHash) {
        record.passwordHash = undefined
        record.passwordSalt = undefined
        record.passwordVersion = undefined
      }
      const lifecycleChanged = Boolean(existing.revokedAt)
        || String(existing.expiresAt || '') !== String(record.expiresAt || '')
        || existing.allowCloudUsage === true !== (record.allowCloudUsage === true)
        || (passwordProvided && existing.authVersion !== record.authVersion)
      data[record.id] = record
      await writeShareStoreFile(data)
      if (lifecycleChanged) emitConversationShareInvalidated(record.id, 'updated')
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
      allowCloudUsage: permission === 'operate' && allowCloudUsage === true,
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
  if (repositoryActive()) return getShareRepository().get(shareId)
  const data = await readShareStoreFile()
  return data[shareId] || null
}

export async function listConversationShares(sessionId) {
  if (repositoryActive()) {
    const records = getShareRepository().list({ sessionId: sessionId || undefined, includeRevoked: true })
    return records.map(publicShareRecord)
  }
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
    assertShareWritesAllowed()
    if (repositoryActive()) {
      const repository = getShareRepository()
      const record = repository.get(shareId)
      if (!record) {
        const error = new Error('Share not found')
        error.statusCode = 404
        throw error
      }
      const wasActive = !record.revokedAt
      const revoked = repository.revoke(shareId, {})
      requestShareJsonMirrorDrain()
      if (wasActive) emitConversationShareInvalidated(shareId, 'revoked')
      return publicShareRecord(revoked)
    }
    const data = await readShareStoreFile()
    const record = data[shareId]
    if (!record) {
      const error = new Error('Share not found')
      error.statusCode = 404
      throw error
    }
    const wasActive = !record.revokedAt
    record.revokedAt = record.revokedAt || new Date().toISOString()
    record.updatedAt = record.revokedAt
    clearShareTokens(record)
    data[shareId] = record
    await writeShareStoreFile(data)
    if (wasActive) emitConversationShareInvalidated(shareId, 'revoked')
    return publicShareRecord(record)
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
    if (repositoryActive()) {
      const restored = getShareRepository().restore(shareId, { expiresAt })
      requestShareJsonMirrorDrain()
      return publicShareRecord(restored)
    }
    const data = await readShareStoreFile()
    const record = data[shareId]
    if (!record) {
      const error = new Error('Share not found')
      error.statusCode = 404
      throw error
    }
    if (record.supersededAt) {
      const error = new Error('Superseded shares cannot be restored')
      error.statusCode = 409
      throw error
    }
    record.revokedAt = undefined
    record.expiresAt = expiresAt || undefined
    record.updatedAt = new Date().toISOString()
    clearShareTokens(record)
    data[shareId] = record
    await writeShareStoreFile(data)
    return publicShareRecord(record)
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
    if (repositoryActive()) {
      const updated = getShareRepository().update(shareId, { expiresAt: expiresAt || null })
      requestShareJsonMirrorDrain()
      emitConversationShareInvalidated(shareId, 'updated')
      return publicShareRecord(updated)
    }
    const data = await readShareStoreFile()
    const record = data[shareId]
    if (!record) {
      const error = new Error('Share not found')
      error.statusCode = 404
      throw error
    }
    if (record.supersededAt) {
      const error = new Error('Superseded shares cannot be updated')
      error.statusCode = 409
      throw error
    }
    assertShareActive(record)
    record.expiresAt = expiresAt || undefined
    record.updatedAt = new Date().toISOString()
    data[shareId] = record
    await writeShareStoreFile(data)
    emitConversationShareInvalidated(shareId, 'updated')
    return publicShareRecord(record)
  })
}

export async function updateConversationShare(shareId, { permission, password, expiresAt, allowCloudUsage } = {}) {
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
    if (repositoryActive()) {
      const repository = getShareRepository()
      const existing = repository.get(shareId)
      if (!existing) {
        const error = new Error('Share not found')
        error.statusCode = 404
        throw error
      }
      const updated = repository.update(shareId, {
        permission,
        allowCloudUsage,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...passwordInfo,
      })
      requestShareJsonMirrorDrain()
      const lifecycleChanged = (permission !== undefined && permission !== existing.permission)
        || (expiresAt !== undefined && String(existing.expiresAt || '') !== String(expiresAt || ''))
        || (allowCloudUsage !== undefined && (existing.allowCloudUsage === true) !== (allowCloudUsage === true))
        || passwordProvided
      if (lifecycleChanged) emitConversationShareInvalidated(shareId, 'updated')
      return publicShareRecord(updated)
    }
    const data = await readShareStoreFile()
    const record = data[shareId]
    if (!record) {
      const error = new Error('Share not found')
      error.statusCode = 404
      throw error
    }
    if (record.supersededAt) {
      const error = new Error('Superseded shares cannot be updated')
      error.statusCode = 409
      throw error
    }
    assertShareActive(record)
    const nextPermission = permission === undefined ? record.permission : permission
    assertValidPermission(nextPermission)
    const willHavePassword = passwordProvided ? Boolean(normalizedPassword) : Boolean(record.passwordHash)
    if (nextPermission === 'operate' && !willHavePassword) {
      const error = new Error('Editable shares require a non-empty password')
      error.statusCode = 400
      throw error
    }
    const nextAllowCloudUsage = nextPermission === 'operate'
      && (allowCloudUsage === undefined ? record.allowCloudUsage === true : allowCloudUsage === true)
    const lifecycleChanged = nextPermission !== record.permission
      || nextAllowCloudUsage !== (record.allowCloudUsage === true)
      || (expiresAt !== undefined && String(record.expiresAt || '') !== String(expiresAt || ''))
      || passwordProvided
    if (passwordProvided) {
      record.passwordHash = passwordInfo.passwordHash
      record.passwordSalt = passwordInfo.passwordSalt
      record.passwordVersion = passwordInfo.passwordVersion
      clearShareTokens(record)
    }
    record.permission = nextPermission
    record.allowCloudUsage = nextAllowCloudUsage
    if (expiresAt !== undefined) record.expiresAt = expiresAt || undefined
    record.updatedAt = new Date().toISOString()
    data[shareId] = record
    await writeShareStoreFile(data)
    if (lifecycleChanged) emitConversationShareInvalidated(shareId, 'updated')
    return publicShareRecord(record)
  })
}

export async function deleteConversationShare(shareId) {
  assertSafeShareId(shareId)
  return enqueueWrite(writeQueueName, async () => {
    assertShareWritesAllowed()
    if (repositoryActive()) {
      const repository = getShareRepository()
      const record = repository.get(shareId)
      if (!record) {
        const error = new Error('Share not found')
        error.statusCode = 404
        throw error
      }
      repository.delete(shareId, {})
      requestShareJsonMirrorDrain()
      emitConversationShareInvalidated(shareId, 'deleted')
      return publicShareRecord(record)
    }
    const data = await readShareStoreFile()
    const record = data[shareId]
    if (!record) {
      const error = new Error('Share not found')
      error.statusCode = 404
      throw error
    }
    delete data[shareId]
    await writeShareStoreFile(data)
    emitConversationShareInvalidated(shareId, 'deleted')
    return publicShareRecord(record)
  })
}

export async function issueConversationShareToken(shareId) {
  assertSafeShareId(shareId)
  return enqueueWrite(writeQueueName, async () => {
    assertShareWritesAllowed()
    if (repositoryActive()) {
      const result = getShareRepository().issueToken(shareId, {})
      requestShareJsonMirrorDrain()
      return { token: result.token, share: publicShareRecord(result.share) }
    }
    const data = await readShareStoreFile()
    const record = data[shareId]
    assertShareActive(record)
    const { token, tokenHash } = createShareToken(shareId)
    const issuedAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + SHARE_TOKEN_MAX_AGE_MS).toISOString()
    record.tokens = pruneTokenRecords(record.tokens)
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
  // SQLite transaction when authoritative), so the shared page never observes
  // a body rolled back while metadata still counts the removed messages.
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
