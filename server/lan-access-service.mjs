import { createLanAccessRepository } from './sqlite/lan-access-repository.mjs'
import { getSqliteStorage } from './sqlite/database.mjs'
import { materializeLanAccessJsonEntry } from './lan-access-json-file.mjs'

// F11 LAN access storage phases — the same state machine as F8 session state /
// F10 share storage but in its own storage domain (`lan_access_storage_state`,
// independent maintenance lock).
export const LAN_ACCESS_STORAGE_PHASES = Object.freeze({
  JSON_AUTHORITATIVE: 'json_authoritative',
  CUTOVER_RUNNING: 'cutover_running',
  JSON_PENDING: 'sqlite_authoritative_json_pending',
  AUTHORITATIVE: 'authoritative',
})

let repositoryInstance = null
let cachedPhase = LAN_ACCESS_STORAGE_PHASES.JSON_AUTHORITATIVE
let mirrorAdapter = null
let drainPromise = null
let mirrorTimer = null
const MIRROR_DRAIN_INTERVAL_MS = 1000

function storage() {
  return getSqliteStorage()
}

function repository() {
  if (!repositoryInstance) repositoryInstance = createLanAccessRepository(storage())
  return repositoryInstance
}

function sqliteReadable() {
  return cachedPhase === LAN_ACCESS_STORAGE_PHASES.JSON_PENDING || cachedPhase === LAN_ACCESS_STORAGE_PHASES.AUTHORITATIVE
}

export function createDefaultLanAccessMirror() {
  return {
    async upsert(config) {
      await materializeLanAccessJsonEntry({ operation: 'upsert', config })
    },
    async delete() {
      await materializeLanAccessJsonEntry({ operation: 'delete' })
    },
  }
}

export function configureLanAccessService({ repository: configuredRepository, mirror, phase } = {}) {
  if (configuredRepository !== undefined) repositoryInstance = configuredRepository
  if (mirror !== undefined) mirrorAdapter = mirror
  if (phase !== undefined) {
    if (!Object.values(LAN_ACCESS_STORAGE_PHASES).includes(phase)) throw new TypeError(`Invalid LAN access storage phase: ${phase}`)
    cachedPhase = phase
  }
}

/**
 * The active LAN access repository (lazily created from the SQLite storage
 * handle). Only callable while the LAN access storage is SQLite-readable
 * (pending or authoritative); JSON-authoritative phases keep the legacy JSON
 * store path.
 */
export function getLanAccessRepository() {
  return repository()
}

export function setLanAccessStoragePhase(phase, values = {}) {
  if (!Object.values(LAN_ACCESS_STORAGE_PHASES).includes(phase)) throw new TypeError(`Invalid LAN access storage phase: ${phase}`)
  const updatedAt = new Date().toISOString()
  storage().prepare(`UPDATE lan_access_storage_state SET phase = ?, lan_token_count = ?, digest = ?, backup_file = ?, diagnostic_json = ?, updated_at = ? WHERE singleton = 1`)
    .run(phase, values.lanTokenCount ?? null, values.digest ?? null, values.backupFile ?? null, values.diagnostic ? JSON.stringify(values.diagnostic) : null, updatedAt)
  cachedPhase = phase
  return readLanAccessStorageState()
}

export function readLanAccessStorageState() {
  const row = storage().prepare('SELECT * FROM lan_access_storage_state WHERE singleton = 1').get()
  if (!row) throw new Error('LAN access storage state is missing')
  cachedPhase = row.phase
  return {
    phase: row.phase,
    lanTokenCount: row.lan_token_count === null ? null : Number(row.lan_token_count),
    digest: row.digest,
    backupFile: row.backup_file,
    diagnostic: row.diagnostic_json ? JSON.parse(row.diagnostic_json) : null,
    updatedAt: row.updated_at,
  }
}

export function initializeLanAccessService() {
  return readLanAccessStorageState()
}

export function getLanAccessStoragePhase() {
  return cachedPhase
}

export function isLanAccessStorageAuthoritative() {
  return sqliteReadable()
}

function scheduleLanAccessJsonMirrorDrain() {
  if (!sqliteReadable() || !mirrorAdapter || mirrorTimer) return
  mirrorTimer = setTimeout(() => {
    mirrorTimer = null
    void drainLanAccessJsonMirror().then(({ pending }) => {
      if (pending > 0) scheduleLanAccessJsonMirrorDrain()
    }).catch(() => {
      scheduleLanAccessJsonMirrorDrain()
    })
  }, MIRROR_DRAIN_INTERVAL_MS)
  mirrorTimer.unref?.()
}

export function requestLanAccessJsonMirrorDrain() {
  scheduleLanAccessJsonMirrorDrain()
}

export function stopLanAccessService() {
  if (mirrorTimer) clearTimeout(mirrorTimer)
  mirrorTimer = null
}

export async function drainLanAccessJsonMirror() {
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
          if (entry.operation === 'upsert') await mirrorAdapter.upsert(entry.config)
          else await mirrorAdapter.delete()
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

export function listLanAccessMirrorQueue() {
  return repository().listMirrorQueue()
}
