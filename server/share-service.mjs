import { createShareRepository } from './sqlite/share-repository.mjs'
import { getSqliteStorage } from './sqlite/database.mjs'

// Storage v2: SQLite is the single authoritative share store. The historical
// JSON→SQLite phase machine (cutover, JSON-authoritative window, mirror queue
// drain) is deleted; `share_sessions`/`share_tokens` are the only
// representation and every read/write goes through the share repository.

let repositoryInstance = null
let repositoryInstanceHandle = null
let initializedAt = null

function storage() {
  return getSqliteStorage()
}

function repository() {
  // Rebuild when the process-wide SQLite handle changed (close/reopen cycles in
  // tests and restart flows): cached statements are bound to one handle.
  const handle = storage()
  if (!repositoryInstance || (repositoryInstanceHandle !== null && repositoryInstanceHandle !== handle)) {
    repositoryInstance = createShareRepository(handle)
    repositoryInstanceHandle = handle
  }
  return repositoryInstance
}

// Only the repository override remains testable/maintenance-injectable.
export function configureShareService({ repository: configuredRepository } = {}) {
  if (configuredRepository !== undefined) {
    repositoryInstance = configuredRepository
    repositoryInstanceHandle = null
  }
}

export function getShareRepository() {
  return repository()
}

// Constant authoritative state (startup-state / migration-status diagnostics):
// there is no share_storage_state phase any more — SQLite is authoritative by
// construction, and the live share count comes straight from the store.
export function readShareStorageState() {
  let shareCount = null
  try {
    shareCount = repository().count()
  } catch {
    // SQLite not initialized yet (early startup diagnostics): the count is
    // simply unknown until the store opens.
  }
  return {
    phase: 'authoritative',
    shareCount,
    digest: null,
    backupFile: null,
    diagnostic: null,
    updatedAt: initializedAt,
  }
}

export function initializeShareService() {
  initializedAt = new Date().toISOString()
  return readShareStorageState()
}

export function stopShareService() {}
