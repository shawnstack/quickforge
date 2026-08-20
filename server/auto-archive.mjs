import { atomicSessionValueUpdate, atomicUpdate, atomicSessionRecordUpdate, isSessionStateAuthoritative, readSessionValue, readStore } from './storage.mjs'
import { logger } from './utils/logger.mjs'
import { withSessionPersistenceLock } from './session-persistence-lock.mjs'

const defaultStorage = { atomicSessionValueUpdate, atomicUpdate, atomicSessionRecordUpdate, readSessionValue, readStore, isSessionStateAuthoritative }

export const AUTO_ARCHIVE_SETTINGS_KEY = 'auto-archive-settings'
export const AUTO_ARCHIVE_AFTER_MS = 30 * 24 * 60 * 60 * 1000
const AUTO_ARCHIVE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
export const AUTO_ARCHIVE_INITIAL_DELAY_MS = 30_000

let autoArchiveTimer = null
let autoArchiveInitialTimer = null
let autoArchiveRunning = false

// Yield one macrotask turn between heavy archive commits: each archive is a
// synchronous SQLite transaction (or JSON read-modify-write) that blocks the
// thread while it runs, and without yields a large batch of back-to-back
// archives starves every pending HTTP request for the whole batch.
function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve))
}

export function normalizeAutoArchiveSettings(value) {
  if (!value || typeof value !== 'object') return { enabled: false }
  return { enabled: value.enabled === true }
}

function parseTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized) return null
  const numeric = Number(normalized)
  if (Number.isFinite(numeric)) return numeric
  const timestamp = Date.parse(normalized)
  return Number.isNaN(timestamp) ? null : timestamp
}

function latestMessageTimestamp(messages) {
  if (!Array.isArray(messages)) return null
  let latest = null
  for (const message of messages) {
    const timestamp = parseTimestamp(message?.timestamp)
    if (timestamp !== null && (latest === null || timestamp > latest)) latest = timestamp
  }
  return latest
}

export function sessionActivityTime(...values) {
  let latest = null
  for (const value of values) {
    if (!value || typeof value !== 'object') continue
    for (const candidate of [
      parseTimestamp(value.lastModified),
      latestMessageTimestamp(value.messages),
      parseTimestamp(value.createdAt),
    ]) {
      if (candidate !== null && (latest === null || candidate > latest)) latest = candidate
    }
  }
  return latest
}

async function archiveInactiveSessionsUnlocked(options = {}) {
  const storage = options.storage || defaultStorage
  const settings = await storage.readStore('settings')
  if (!normalizeAutoArchiveSettings(settings[AUTO_ARCHIVE_SETTINGS_KEY]).enabled) {
    return { archivedCount: 0, disabled: true }
  }

  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const cutoff = now - AUTO_ARCHIVE_AFTER_MS
  const archivedAt = new Date(now).toISOString()
  const metadataStore = await storage.readStore('sessions-metadata')
  const candidates = []

  // Metadata-first scan: metadata alone decides activeness whenever it carries
  // any timestamp, so the common case never loads the session body (loading and
  // JSON.parsing every 2.9GB-library body is what stalled the event loop for
  // ~minutes on startup). The body is only read when metadata has no usable
  // timestamp at all. The scan is therefore deliberately conservative — a body
  // newer than its (stale) metadata is treated as a candidate — which is safe:
  // a wrongly suspected candidate is rejected by the full-state re-check inside
  // the archive transactions below, and a missed candidate is simply picked up
  // by the next scan. persistSession refreshes metadata timestamps on every
  // save, so active sessions always stay fresh in metadata.
  for (const [sessionId, metadata] of Object.entries(metadataStore)) {
    if (!metadata || metadata.archivedAt || metadata.messageCount === 0 || metadata.taskStatus === 'running') continue
    const metadataActivityTime = sessionActivityTime(metadata)
    if (metadataActivityTime !== null) {
      if (metadataActivityTime >= cutoff) continue
      candidates.push(sessionId)
      continue
    }
    // Metadata carries no timestamp at all: fall back to the body.
    const session = await storage.readSessionValue(sessionId)
    if (!session || session.archivedAt) continue
    const activityTime = sessionActivityTime(metadata, session)
    if (activityTime === null || activityTime >= cutoff) continue
    candidates.push(sessionId)
  }

  const archivedSessionIds = []
  // Authoritative: archive body + metadata in one SQLite transaction (CAS
  // retried on concurrent metadata-only changes), so no half-archived state.
  if (typeof storage.atomicSessionRecordUpdate === 'function') {
    for (const [index, sessionId] of candidates.entries()) {
      // Let pending requests run between archive transactions (not before the
      // first candidate — nothing to yield from yet).
      if (index > 0) await yieldToEventLoop()
      const updated = await storage.atomicSessionRecordUpdate(sessionId, ({ state, metadata }) => {
        const activityTime = sessionActivityTime(metadata, state)
        if (state.archivedAt || metadata.archivedAt || metadata.messageCount === 0 || metadata.taskStatus === 'running' || activityTime === null || activityTime >= cutoff) return null
        return { state: { ...state, archivedAt }, metadata: { ...metadata, archivedAt } }
      })
      if (updated?.state?.archivedAt === archivedAt) archivedSessionIds.push(sessionId)
    }
  } else {
    for (const [index, sessionId] of candidates.entries()) {
      // Let pending requests run between archive transactions (not before the
      // first candidate — nothing to yield from yet).
      if (index > 0) await yieldToEventLoop()
      const updatedSession = await storage.atomicSessionValueUpdate(sessionId, (session) => {
        const activityTime = sessionActivityTime(session)
        if (session.archivedAt || activityTime === null || activityTime >= cutoff) return session
        return { ...session, archivedAt }
      })
      if (!updatedSession || updatedSession.archivedAt !== archivedAt) continue

      let metadataArchived = false
      await storage.atomicUpdate('sessions-metadata', (current) => {
        const metadata = current[sessionId]
        const activityTime = sessionActivityTime(metadata, updatedSession)
        if (!metadata || metadata.archivedAt || metadata.messageCount === 0 || metadata.taskStatus === 'running' || activityTime === null || activityTime >= cutoff) {
          return current
        }
        current[sessionId] = { ...metadata, archivedAt }
        metadataArchived = true
        return current
      })

      if (metadataArchived) {
        archivedSessionIds.push(sessionId)
      } else {
        await storage.atomicSessionValueUpdate(sessionId, (session) => {
          if (session.archivedAt !== archivedAt) return session
          const next = { ...session }
          delete next.archivedAt
          return next
        })
      }
    }
  }

  if (archivedSessionIds.length > 0) logger.info(`Automatically archived ${archivedSessionIds.length} inactive conversation(s).`)
  return { archivedCount: archivedSessionIds.length, archivedSessionIds, archivedAt }
}

export async function archiveInactiveSessions(options = {}) {
  if (autoArchiveRunning) return { archivedCount: 0, skipped: true }
  autoArchiveRunning = true
  try {
    return await withSessionPersistenceLock(() => archiveInactiveSessionsUnlocked(options))
  } finally {
    autoArchiveRunning = false
  }
}

// `options` exists for tests (inject storage/now like archiveInactiveSessions);
// production callers pass nothing and get defaultStorage + Date.now().
export function startAutoArchiveRunner(options = {}) {
  if (autoArchiveTimer) return
  autoArchiveTimer = setInterval(() => {
    archiveInactiveSessions(options).catch((error) => logger.error('Automatic conversation archive failed:', error))
  }, AUTO_ARCHIVE_CHECK_INTERVAL_MS)
  autoArchiveTimer.unref?.()
  // Delay the first pass off the startup path: right after listen() the server
  // is absorbing the browser's initial request burst, and the scan + archive
  // transactions on a large library can block the event loop for a long
  // stretch. The timer is unref'd so it never keeps the process alive.
  autoArchiveInitialTimer = setTimeout(() => {
    autoArchiveInitialTimer = null
    archiveInactiveSessions(options).catch((error) => logger.error('Initial automatic conversation archive failed:', error))
  }, AUTO_ARCHIVE_INITIAL_DELAY_MS)
  autoArchiveInitialTimer.unref?.()
}

export function stopAutoArchiveRunner() {
  if (autoArchiveInitialTimer) {
    clearTimeout(autoArchiveInitialTimer)
    autoArchiveInitialTimer = null
  }
  if (!autoArchiveTimer) return
  clearInterval(autoArchiveTimer)
  autoArchiveTimer = null
}
