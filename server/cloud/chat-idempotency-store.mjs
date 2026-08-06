import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ensureStorage, storageDir } from '../storage.mjs'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function assertIdentifier(value, label, pattern) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!pattern.test(normalized)) throw new Error(`Invalid ${label}.`)
  return normalized
}

export function createCloudChatIdempotencyStore({
  directory = path.join(storageDir, 'security', 'cloud-chat-idempotency'),
  ensureBaseStorage = ensureStorage,
} = {}) {
  function entryPath(sessionId, messageId) {
    return path.join(directory, digest(sessionId), `${digest(messageId)}.json`)
  }

  async function ensureDirectory(file) {
    await ensureBaseStorage()
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  }

  async function readEntry(file, sessionId, messageId) {
    try {
      const raw = await fs.readFile(file, 'utf8')
      const entry = raw.trim() ? JSON.parse(raw) : null
      if (entry?.sessionId !== sessionId || entry?.messageId !== messageId || !UUID_PATTERN.test(entry?.idempotencyKey || '')) {
        throw new Error('Invalid QuickForge Cloud chat idempotency record.')
      }
      return entry
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async function ensure(sessionIdInput, messageIdInput) {
    const sessionId = assertIdentifier(sessionIdInput, 'session ID', /^.{1,512}$/)
    const messageId = assertIdentifier(messageIdInput, 'logical message ID', MESSAGE_ID_PATTERN)
    const file = entryPath(sessionId, messageId)
    await ensureDirectory(file)

    const existing = await readEntry(file, sessionId, messageId)
    if (existing) return existing.idempotencyKey

    const entry = {
      schemaVersion: 1,
      sessionId,
      messageId,
      idempotencyKey: randomUUID(),
      createdAt: new Date().toISOString(),
    }

    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
    await fs.writeFile(temporary, `${JSON.stringify(entry, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    try { await fs.chmod(temporary, 0o600) } catch { /* best effort on Windows */ }
    try {
      await fs.link(temporary, file)
      try { await fs.chmod(file, 0o600) } catch { /* best effort on Windows */ }
      return entry.idempotencyKey
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const concurrent = await readEntry(file, sessionId, messageId)
      if (!concurrent) throw error
      return concurrent.idempotencyKey
    } finally {
      await fs.rm(temporary, { force: true })
    }
  }

  async function removeSession(sessionIdInput) {
    const sessionId = assertIdentifier(sessionIdInput, 'session ID', /^.{1,512}$/)
    await fs.rm(path.join(directory, digest(sessionId)), { recursive: true, force: true })
  }

  return { directory, ensure, removeSession }
}

const defaultStore = createCloudChatIdempotencyStore()

export function ensureCloudChatIdempotencyKey(sessionId, messageId) {
  return defaultStore.ensure(sessionId, messageId)
}

export function deleteCloudChatIdempotencySession(sessionId) {
  return defaultStore.removeSession(sessionId)
}
