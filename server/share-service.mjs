import { createShareRepository } from './sqlite/share-repository.mjs'
import { getSqliteStorage } from './sqlite/database.mjs'
import { materializeShareJsonEntry } from './share-json-file.mjs'

// F10 share storage phases — the same state machine as F8 session state but in
// its own storage domain (`share_storage_state`, independent maintenance lock).
export const SHARE_STORAGE_PHASES = Object.freeze({
  JSON_AUTHORITATIVE: 'json_authoritative',
  CUTOVER_RUNNING: 'cutover_running',
  JSON_PENDING: 'sqlite_authoritative_json_pending',
  AUTHORITATIVE: 'authoritative',
})

let repositoryInstance = null
let cachedPhase = SHARE_STORAGE_PHASES.JSON_AUTHORITATIVE
let jsonAdapter = null
let mirrorAdapter = null
let drainPromise = null
let mirrorTimer = null
const MIRROR_DRAIN_INTERVAL_MS = 1000

function storage() {
  return getSqliteStorage()
}

function repository() {
  if (!repositoryInstance) repositoryInstance = createShareRepository(storage())
  return repositoryInstance
}

// JSON-authoritative read/write adapter slot (same pattern as
// session-state-service). share-store keeps its legacy JSON path, so this is a
// public extension point rather than an internal call site.
export function requireShareJsonAdapter(method) {
  if (typeof jsonAdapter?.[method] !== 'function') throw new Error(`JSON authoritative share adapter does not implement ${method}`)
  return jsonAdapter[method].bind(jsonAdapter)
}

function sqliteReadable() {
  return cachedPhase === SHARE_STORAGE_PHASES.JSON_PENDING || cachedPhase === SHARE_STORAGE_PHASES.AUTHORITATIVE
}

export function createDefaultShareMirror() {
  return {
    async upsert(record) {
      await materializeShareJsonEntry({ operation: 'upsert', record })
    },
    async delete(shareId) {
      await materializeShareJsonEntry({ operation: 'delete', shareId })
    },
  }
}

export function configureShareService({ repository: configuredRepository, mirror, phase, json } = {}) {
  if (configuredRepository !== undefined) repositoryInstance = configuredRepository
  if (json !== undefined) jsonAdapter = json
  if (mirror !== undefined) mirrorAdapter = mirror
  if (phase !== undefined) {
    if (!Object.values(SHARE_STORAGE_PHASES).includes(phase)) throw new TypeError(`Invalid share storage phase: ${phase}`)
    cachedPhase = phase
  }
}

/**
 * The active share repository (lazily created from the SQLite storage handle).
 * Only callable while the share storage is SQLite-readable (pending or
 * authoritative); JSON-authoritative phases keep the legacy JSON store path.
 */
export function getShareRepository() {
  return repository()
}

export function setShareStoragePhase(phase, values = {}) {
  if (!Object.values(SHARE_STORAGE_PHASES).includes(phase)) throw new TypeError(`Invalid share storage phase: ${phase}`)
  const updatedAt = new Date().toISOString()
  storage().prepare(`UPDATE share_storage_state SET phase = ?, share_count = ?, digest = ?, backup_file = ?, diagnostic_json = ?, updated_at = ? WHERE singleton = 1`)
    .run(phase, values.shareCount ?? null, values.digest ?? null, values.backupFile ?? null, values.diagnostic ? JSON.stringify(values.diagnostic) : null, updatedAt)
  cachedPhase = phase
  return readShareStorageState()
}

export function readShareStorageState() {
  const row = storage().prepare('SELECT * FROM share_storage_state WHERE singleton = 1').get()
  if (!row) throw new Error('Share storage state is missing')
  cachedPhase = row.phase
  return {
    phase: row.phase,
    shareCount: row.share_count === null ? null : Number(row.share_count),
    digest: row.digest,
    backupFile: row.backup_file,
    diagnostic: row.diagnostic_json ? JSON.parse(row.diagnostic_json) : null,
    updatedAt: row.updated_at,
  }
}

export function initializeShareService() {
  return readShareStorageState()
}

export function getShareStoragePhase() {
  return cachedPhase
}

export function isShareStorageAuthoritative() {
  return sqliteReadable()
}

function scheduleShareJsonMirrorDrain() {
  if (!sqliteReadable() || !mirrorAdapter || mirrorTimer) return
  mirrorTimer = setTimeout(() => {
    mirrorTimer = null
    void drainShareJsonMirror().then(({ pending }) => {
      if (pending > 0) scheduleShareJsonMirrorDrain()
    }).catch(() => {
      scheduleShareJsonMirrorDrain()
    })
  }, MIRROR_DRAIN_INTERVAL_MS)
  mirrorTimer.unref?.()
}

export function requestShareJsonMirrorDrain() {
  scheduleShareJsonMirrorDrain()
}

export function stopShareService() {
  if (mirrorTimer) clearTimeout(mirrorTimer)
  mirrorTimer = null
}

export async function drainShareJsonMirror() {
  if (!sqliteReadable() || !mirrorAdapter) return { pending: 0, drained: 0, failed: 0 }
  if (drainPromise) return drainPromise
  drainPromise = (async () => {
    let drained = 0
    let failed = 0
    for (;;) {
      const entries = repository().listMirrorQueue()
      if (entries.length === 0) break
      let progressed = false
      for (const entry of entries) {
        try {
          if (entry.operation === 'upsert') await mirrorAdapter.upsert(entry.record)
          else await mirrorAdapter.delete(entry.shareId)
          repository().acknowledgeMirror(entry)
          drained += 1
          progressed = true
        } catch (error) {
          repository().failMirror(entry, error)
          failed += 1
        }
      }
      if (!progressed) break
    }
    return { pending: repository().listMirrorQueue().length, drained, failed }
  })().finally(() => {
    drainPromise = null
  })
  return drainPromise
}

export function listShareMirrorQueue() {
  return repository().listMirrorQueue()
}
