import { createLanAccessRepository } from './sqlite/lan-access-repository.mjs'
import { getSqliteStorage } from './sqlite/database.mjs'

// LAN access storage: SQLite (`lan_access_state` + `lan_access_tokens`) is the
// single authoritative store. The JSON-authoritative phase machine, the
// security/lan-access.json mirror and its drain loop are retired (historical
// note: they lived in the deleted lan-access-cutover.mjs / lan-access-json-file
// modules); lan-access-store.mjs reads and writes the repository only.

let repositoryInstance = null
let initializedAt = null
let lastInitializationError = null

function storage() {
  return getSqliteStorage()
}

function repository() {
  if (!repositoryInstance) repositoryInstance = createLanAccessRepository(storage())
  return repositoryInstance
}

// The only testable seam: an injected repository override.
export function configureLanAccessService({ repository: configuredRepository } = {}) {
  if (configuredRepository !== undefined) repositoryInstance = configuredRepository
}

export function getLanAccessRepository() {
  return repository()
}

// Constant authoritative storage state for startup diagnostics
// (server/startup-state.mjs / GET /api/migration-status): SQLite is the only
// representation, so there is no phase to read. The live token count comes
// straight from the store and degrades to null before SQLite is open.
export function readLanAccessStorageState() {
  let stateCount = null
  try {
    stateCount = repository().count()
  } catch {
    // SQLite not initialized yet (early startup diagnostics); the phase stays
    // authoritative, the count is simply unknown until the store opens.
  }
  return {
    phase: 'authoritative',
    stateCount,
    digest: null,
    backupFile: null,
    diagnostic: lastInitializationError ? { operation: 'initialize', error: lastInitializationError } : null,
    updatedAt: initializedAt,
  }
}

// Startup: materialize the singleton config row on a fresh database so the
// authoritative store always has its disabled-default state (integrity checks
// treat a missing config row as a damaged store). Existing installs are
// untouched — the row is never rewritten here.
export function initializeLanAccessService() {
  initializedAt = new Date().toISOString()
  try {
    const repositoryInstance = repository()
    if (!repositoryInstance.getConfig()) repositoryInstance.updateSettings({ enabled: false })
  } catch (error) {
    // SQLite not available yet (or read-only): LAN access stays disabled and
    // the store reports the failure on first use instead of failing startup.
    lastInitializationError = error?.message || String(error)
  }
  return readLanAccessStorageState()
}

export function stopLanAccessService() {}
