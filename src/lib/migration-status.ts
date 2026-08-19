// P1 startup maintenance window: while the server migrates its storage to
// SQLite in the background, /api/health still reports ok:true but every other
// /api/* route answers 503. This module wraps GET /api/migration-status
// (whitelisted during the window) so the boot flow can park the UI until the
// window closes.
//
// Server contract (server/startup-state.mjs + server/index.mjs):
//   200 {
//     ok: true,
//     state: 'migrating' | 'ready' | 'failed',
//     startupError?: string,   // present when state === 'failed'
//     domains: {
//       scheduledRuns: { phase, runCount?, updatedAt? },
//       sessionState: { phase, stateCount?, updatedAt? },
//       share: { phase, shareCount?, updatedAt? },
//       lanAccess: { phase, lanTokenCount?, updatedAt? },
//     },
//   }
//
// Domain phases come from the four *-service.mjs state machines: scheduled-runs
// uses 'hybrid' where the other domains use 'json_authoritative'; 'unknown' is
// the endpoint fallback when a domain state table cannot be read yet.

export const MIGRATION_POLL_INTERVAL_MS = 2000

export type MigrationWindowState = 'migrating' | 'ready' | 'failed'

export type MigrationDomainStatus = {
  phase: string
  runCount?: number
  stateCount?: number
  shareCount?: number
  lanTokenCount?: number
  updatedAt?: string
  error?: string
}

export type MigrationStatus = {
  ok: true
  state: MigrationWindowState
  startupError?: string
  domains: {
    scheduledRuns: MigrationDomainStatus
    sessionState: MigrationDomainStatus
    share: MigrationDomainStatus
    lanAccess: MigrationDomainStatus
  }
}

// { ok: false } marks an unreachable/unusable endpoint (network error,
// non-200, malformed payload); callers decide how to surface it.
export type MigrationStatusResult = MigrationStatus | { ok: false }

// User-facing progression stage derived from a domain phase. The phase strings
// are server constants; unknown values (including future phases) map to
// 'unknown' so the UI keeps rendering the remaining domains.
export function migrationPhaseStage(phase: string): 'pending' | 'running' | 'finalizing' | 'done' | 'unknown' {
  if (phase === 'json_authoritative' || phase === 'hybrid') return 'pending'
  if (phase === 'cutover_running') return 'running'
  if (phase === 'sqlite_authoritative_json_pending') return 'finalizing'
  if (phase === 'authoritative') return 'done'
  return 'unknown'
}

function numberField(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseDomain(raw: unknown): MigrationDomainStatus {
  if (typeof raw !== 'object' || raw === null) return { phase: 'unknown' }
  const source = raw as Record<string, unknown>
  const domain: MigrationDomainStatus = {
    phase: typeof source.phase === 'string' ? source.phase : 'unknown',
  }
  const runCount = numberField(source, 'runCount')
  if (runCount !== undefined) domain.runCount = runCount
  const stateCount = numberField(source, 'stateCount')
  if (stateCount !== undefined) domain.stateCount = stateCount
  const shareCount = numberField(source, 'shareCount')
  if (shareCount !== undefined) domain.shareCount = shareCount
  const lanTokenCount = numberField(source, 'lanTokenCount')
  if (lanTokenCount !== undefined) domain.lanTokenCount = lanTokenCount
  if (typeof source.updatedAt === 'string') domain.updatedAt = source.updatedAt
  if (typeof source.error === 'string') domain.error = source.error
  return domain
}

function parseMigrationStatus(payload: unknown): MigrationStatus | null {
  if (typeof payload !== 'object' || payload === null) return null
  const source = payload as Record<string, unknown>
  if (source.ok !== true) return null
  const state = source.state
  if (state !== 'migrating' && state !== 'ready' && state !== 'failed') return null

  const status: MigrationStatus = {
    ok: true,
    state,
    domains: {
      scheduledRuns: parseDomain((source.domains as Record<string, unknown> | undefined)?.scheduledRuns),
      sessionState: parseDomain((source.domains as Record<string, unknown> | undefined)?.sessionState),
      share: parseDomain((source.domains as Record<string, unknown> | undefined)?.share),
      lanAccess: parseDomain((source.domains as Record<string, unknown> | undefined)?.lanAccess),
    },
  }
  if (typeof source.startupError === 'string') status.startupError = source.startupError
  return status
}

export async function fetchMigrationStatus(baseUrl = ''): Promise<MigrationStatusResult> {
  try {
    const response = await fetch(`${baseUrl}/api/migration-status`, {
      method: 'GET',
      cache: 'no-store',
    })
    if (!response.ok) return { ok: false }
    const payload = await response.json().catch(() => null)
    return parseMigrationStatus(payload) ?? { ok: false }
  } catch {
    // Network error / service restarting: let the caller fall back to its
    // existing error path.
    return { ok: false }
  }
}

export type MigrationGateOutcome =
  | { state: 'ready' }
  | { state: 'failed'; startupError?: string }
  | { state: 'cancelled' }

// Poll the migration status until the maintenance window closes. Resolves
// 'ready' when the server finished migrating, 'failed' with the server error
// detail when the startup chain failed, or 'cancelled' when isCancelled()
// reported true (effect cleanup / retry). Throws when the endpoint itself
// becomes unreachable — e.g. the service died mid-migration — so the caller's
// existing error handling takes over.
export async function waitForMigrationSettled(options: {
  fetchStatus?: () => Promise<MigrationStatusResult>
  intervalMs?: number
  delay?: (ms: number) => Promise<void>
  onStatus?: (status: MigrationStatus) => void
  isCancelled?: () => boolean
} = {}): Promise<MigrationGateOutcome> {
  const fetchStatus = options.fetchStatus ?? fetchMigrationStatus
  const intervalMs = options.intervalMs ?? MIGRATION_POLL_INTERVAL_MS
  const delay = options.delay ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) }))

  for (;;) {
    if (options.isCancelled?.()) return { state: 'cancelled' }
    const status = await fetchStatus()
    if (!status.ok) throw new Error('QuickForge migration status is unavailable.')
    options.onStatus?.(status)
    if (status.state !== 'migrating') {
      if (status.state === 'failed') return { state: 'failed', startupError: status.startupError }
      return { state: 'ready' }
    }
    await delay(intervalMs)
  }
}
