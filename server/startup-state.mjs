// Process-wide startup state shared by server/index.mjs (maintenance gate and
// /api/health) and its tests.
//
// Storage is SQLite-authoritative by construction: there is no JSON→SQLite
// migration window any more, so the only states are 'starting' (the startup
// initialization chain is still running), 'ready' and 'failed'.

export const STARTUP_STATES = Object.freeze({
  STARTING: 'starting',
  READY: 'ready',
  FAILED: 'failed',
})

// Read-only endpoint that stays reachable while the maintenance gate refuses
// every other /api/* route, so CLI/Desktop clients can observe startup.
export const MAINTENANCE_API_WHITELIST = Object.freeze([
  '/api/health',
])

let startupState = STARTUP_STATES.STARTING
let startupError = null

export function getStartupState() {
  return startupState
}

export function getStartupError() {
  return startupError
}

export function setStartupState(state, errorMessage = null) {
  if (!Object.values(STARTUP_STATES).includes(state)) throw new TypeError(`Invalid startup state: ${state}`)
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
  '1. Stop all QuickForge processes so no data files are being changed or locked.',
  '2. Before recovery, make a complete copy of the entire QuickForge dataDir, including the SQLite database and any -wal/-shm files.',
  '3. Review the server logs to identify the failing storage domain and operation.',
  '4. Use the runbook or the maintenance export/restore tool for that domain; do not delete the database.',
].join('\n')

export function withStartupRecoveryGuidance(errorMessage) {
  return `${errorMessage || 'Startup failed'}\n\n${STARTUP_RECOVERY_GUIDANCE}`
}

// Test helper: restore the module-evaluation defaults.
export function resetStartupState() {
  startupState = STARTUP_STATES.STARTING
  startupError = null
}

// Maintenance gate for /api/* routes. Returns null when the request may be
// dispatched, or the maintenance refusal payload ({status, state}) otherwise.
// Non-/api paths (static assets, /share/) stay ungated so the frontend can
// load and show its splash/error page.
export function resolveMaintenanceGate(method, pathname) {
  const state = getStartupState()
  if (state === STARTUP_STATES.READY) return null
  if (!pathname || !pathname.startsWith('/api/')) return null
  if (method === 'GET' && MAINTENANCE_API_WHITELIST.includes(pathname)) return null
  return { status: 503, state }
}
