import { atomicSessionValueUpdate, atomicUpdate, readSessionValue, readStore } from './storage.mjs'
import { logger } from './utils/logger.mjs'
import { withSessionPersistenceLock } from './session-persistence-lock.mjs'

const defaultStorage = { atomicSessionValueUpdate, atomicUpdate, readSessionValue, readStore }

export const AUTO_ARCHIVE_SETTINGS_KEY = 'auto-archive-settings'
export const AUTO_ARCHIVE_AFTER_MS = 30 * 24 * 60 * 60 * 1000
const AUTO_ARCHIVE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

let autoArchiveTimer = null
let autoArchiveRunning = false

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

  for (const [sessionId, metadata] of Object.entries(metadataStore)) {
    if (!metadata || metadata.archivedAt || metadata.messageCount === 0 || metadata.taskStatus === 'running') continue
    const session = await storage.readSessionValue(sessionId)
    if (!session || session.archivedAt) continue
    const activityTime = sessionActivityTime(metadata, session)
    if (activityTime === null || activityTime >= cutoff) continue
    candidates.push(sessionId)
  }

  const archivedSessionIds = []
  for (const sessionId of candidates) {
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

export function startAutoArchiveRunner() {
  if (autoArchiveTimer) return
  autoArchiveTimer = setInterval(() => {
    archiveInactiveSessions().catch((error) => logger.error('Automatic conversation archive failed:', error))
  }, AUTO_ARCHIVE_CHECK_INTERVAL_MS)
  autoArchiveTimer.unref?.()
  archiveInactiveSessions().catch((error) => logger.error('Initial automatic conversation archive failed:', error))
}

export function stopAutoArchiveRunner() {
  if (!autoArchiveTimer) return
  clearInterval(autoArchiveTimer)
  autoArchiveTimer = null
}
