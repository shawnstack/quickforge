import { readScheduledRunsState } from './scheduled-runs-cutover.mjs'
import { readSessionStorageState } from './session-state-service.mjs'
import { readShareStorageState } from './share-service.mjs'
import { readLanAccessStorageState } from './lan-access-service.mjs'

// P1 startup maintenance window: the HTTP server listens before the storage
// migration/initialization chain completes. This module owns the process-wide
// startup state shared by server/index.mjs (maintenance gate, /api/health and
// /api/migration-status) and its tests.

export const STARTUP_STATES = Object.freeze({
  MIGRATING: 'migrating',
  READY: 'ready',
  FAILED: 'failed',
})

// Read-only endpoints that stay reachable while the maintenance gate refuses
// every other /api/* route, so CLI/Desktop clients can observe progress.
export const MAINTENANCE_API_WHITELIST = Object.freeze([
  '/api/health',
  '/api/migration-status',
])

// The server process starts in 'migrating' at module evaluation; the startup
// chain moves it to 'ready' (all domains initialized) or 'failed'.
let startupState = STARTUP_STATES.MIGRATING
let startupError = null

export function getStartupState() {
  return startupState
}

export function getStartupError() {
  return startupError
}

export function setStartupState(state, errorMessage = null) {
  startupState = state
  startupError = state === STARTUP_STATES.FAILED
    ? (errorMessage || 'Startup failed')
    : null
}

// Actionable recovery guidance appended to startup errors (fail-closed
// startup, review §5.1). The original exception text stays intact; the
// guidance is an additional multi-line paragraph shown verbatim by the
// frontend failed page (whitespace-pre-wrap).
export const STARTUP_RECOVERY_GUIDANCE = [
  'Recovery guidance:',
  '1. Stop all QuickForge processes so the data files are not locked.',
  '2. Diagnose offline: node server/maintenance/downgrade-session-state-v1.mjs --dry-run',
  '3. Export a backup: node server/maintenance/export-session-state-v1.mjs <output-path>',
  '4. Follow the recovery runbook: docs/architecture/session-storage-recovery-runbook.zh-CN.md',
].join('\n')

export function withStartupRecoveryGuidance(errorMessage) {
  return `${errorMessage || 'Startup failed'}\n\n${STARTUP_RECOVERY_GUIDANCE}`
}

// Test helper: restore the module-evaluation defaults.
export function resetStartupState() {
  startupState = STARTUP_STATES.MIGRATING
  startupError = null
}

// Maintenance gate for /api/* routes. Returns null when the request may be
// dispatched, or the maintenance refusal payload ({status, state}) otherwise.
export function resolveMaintenanceGate(method, pathname) {
  const state = getStartupState()
  if (state === STARTUP_STATES.READY) return null
  if (!pathname || !pathname.startsWith('/api/')) return null
  if (method === 'GET' && MAINTENANCE_API_WHITELIST.includes(pathname)) return null
  return { status: 503, state }
}

function readDomain(read) {
  try {
    return read()
  } catch (error) {
    // A domain whose storage is not initialized yet (or whose state table
    // cannot be read) must not fail the whole status endpoint; report the
    // error name so the UI can still render the remaining domains.
    return { phase: 'unknown', error: error?.name || 'Error' }
  }
}

// Aggregated migration status across the four storage domains. `storage` is
// optional (scheduled-runs accepts an injected handle; the other domains read
// the process-wide SQLite storage internally).
export function readMigrationStatus(storage) {
  const state = getStartupState()
  const status = {
    ok: true,
    state,
    domains: {
      scheduledRuns: readDomain(() => readScheduledRunsState(storage)),
      sessionState: readDomain(() => readSessionStorageState()),
      share: readDomain(() => readShareStorageState()),
      lanAccess: readDomain(() => readLanAccessStorageState()),
    },
  }
  if (state === STARTUP_STATES.FAILED) status.startupError = getStartupError()
  return status
}
