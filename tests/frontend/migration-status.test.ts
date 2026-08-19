import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MIGRATION_POLL_FAILURE_LIMIT,
  MIGRATION_POLL_INTERVAL_MS,
  fetchMigrationStatus,
  migrationPhaseStage,
  waitForMigrationSettled,
  type MigrationStatus,
  type MigrationStatusResult,
} from '../../src/lib/migration-status'

function maintenancePayload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    state: 'migrating',
    domains: {
      scheduledRuns: { phase: 'hybrid', runCount: 3, updatedAt: '2026-08-19T00:00:00.000Z' },
      sessionState: { phase: 'cutover_running', stateCount: 42, updatedAt: '2026-08-19T00:00:01.000Z' },
      share: { phase: 'authoritative', shareCount: 5 },
      lanAccess: { phase: 'sqlite_authoritative_json_pending', lanTokenCount: 1 },
    },
    ...overrides,
  }
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response
}

describe('fetchMigrationStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses a maintenance payload into the four domains', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(maintenancePayload()))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchMigrationStatus()

    expect(fetchMock).toHaveBeenCalledWith('/api/migration-status', { method: 'GET', cache: 'no-store' })
    expect(result).toEqual({
      ok: true,
      state: 'migrating',
      domains: {
        scheduledRuns: { phase: 'hybrid', runCount: 3, updatedAt: '2026-08-19T00:00:00.000Z' },
        sessionState: { phase: 'cutover_running', stateCount: 42, updatedAt: '2026-08-19T00:00:01.000Z' },
        share: { phase: 'authoritative', shareCount: 5 },
        lanAccess: { phase: 'sqlite_authoritative_json_pending', lanTokenCount: 1 },
      },
    })
  })

  it('prefixes the request with baseUrl and normalizes missing domains', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      ok: true,
      state: 'failed',
      startupError: 'boom',
      domains: { scheduledRuns: { phase: 'authoritative', runCount: 0 } },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchMigrationStatus('http://127.0.0.1:32176')

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:32176/api/migration-status', expect.anything())
    expect(result).toEqual({
      ok: true,
      state: 'failed',
      startupError: 'boom',
      domains: {
        scheduledRuns: { phase: 'authoritative', runCount: 0 },
        sessionState: { phase: 'unknown' },
        share: { phase: 'unknown' },
        lanAccess: { phase: 'unknown' },
      },
    })
  })

  it('reports { ok: false } for non-200 responses, network errors and malformed payloads', async () => {
    const cases: Array<() => Promise<Response>> = [
      () => Promise.resolve(jsonResponse({ ok: true, state: 'migrating' }, 503)),
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.resolve(jsonResponse(null)),
      () => Promise.resolve(jsonResponse({ ok: false })),
      () => Promise.resolve(jsonResponse({ ok: true, state: 'nonsense' })),
    ]
    for (const respond of cases) {
      vi.stubGlobal('fetch', vi.fn(respond))
      expect(await fetchMigrationStatus()).toEqual({ ok: false })
    }
  })
})

describe('migrationPhaseStage', () => {
  it('maps the server phase constants to user-facing stages', () => {
    expect(migrationPhaseStage('json_authoritative')).toBe('pending')
    expect(migrationPhaseStage('hybrid')).toBe('pending')
    expect(migrationPhaseStage('cutover_running')).toBe('running')
    expect(migrationPhaseStage('sqlite_authoritative_json_pending')).toBe('finalizing')
    expect(migrationPhaseStage('authoritative')).toBe('done')
  })

  it('falls back to unknown for anything else', () => {
    expect(migrationPhaseStage('unknown')).toBe('unknown')
    expect(migrationPhaseStage('future_phase')).toBe('unknown')
    expect(migrationPhaseStage('')).toBe('unknown')
  })
})

describe('waitForMigrationSettled', () => {
  function statusResult(overrides: Record<string, unknown> = {}): MigrationStatusResult {
    return maintenancePayload(overrides) as MigrationStatus
  }

  it('resolves ready without polling when the server is already ready', async () => {
    const fetchStatus = vi.fn(async () => statusResult({ state: 'ready' }))
    const delay = vi.fn(async () => undefined)

    const outcome = await waitForMigrationSettled({ fetchStatus, delay })

    expect(outcome).toEqual({ state: 'ready' })
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    expect(delay).not.toHaveBeenCalled()
  })

  it('polls on the migration interval and streams each migrating snapshot', async () => {
    const statuses = [
      statusResult(),
      statusResult({ state: 'migrating', domains: { scheduledRuns: { phase: 'cutover_running' } } }),
      statusResult({ state: 'ready' }),
    ]
    const fetchStatus = vi.fn(async () => statuses.shift()!)
    const delay = vi.fn(async () => undefined)
    const onStatus = vi.fn()

    const outcome = await waitForMigrationSettled({ fetchStatus, delay, onStatus })

    expect(outcome).toEqual({ state: 'ready' })
    expect(fetchStatus).toHaveBeenCalledTimes(3)
    expect(delay).toHaveBeenCalledTimes(2)
    expect(delay).toHaveBeenCalledWith(MIGRATION_POLL_INTERVAL_MS)
    expect(onStatus).toHaveBeenCalledTimes(3)
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ready' }))
  })

  it('resolves failed with the server startupError', async () => {
    const fetchStatus = vi.fn(async () => statusResult({ state: 'failed', startupError: 'cutover failed' }))

    const outcome = await waitForMigrationSettled({ fetchStatus, delay: vi.fn(async () => undefined) })

    expect(outcome).toEqual({ state: 'failed', startupError: 'cutover failed' })
  })

  it(`throws after ${MIGRATION_POLL_FAILURE_LIMIT} consecutive unreachable polls`, async () => {
    const fetchStatus = vi.fn(async () => ({ ok: false as const }))
    const delay = vi.fn(async () => undefined)

    await expect(waitForMigrationSettled({ fetchStatus, delay }))
      .rejects.toThrow('QuickForge migration status is unavailable.')
    expect(fetchStatus).toHaveBeenCalledTimes(MIGRATION_POLL_FAILURE_LIMIT)
    expect(delay).toHaveBeenCalledTimes(MIGRATION_POLL_FAILURE_LIMIT - 1)
  })

  it('tolerates an isolated failed poll and keeps waiting', async () => {
    const statuses: MigrationStatusResult[] = [
      { ok: false },
      statusResult(),
      statusResult({ state: 'ready' }),
    ]
    const fetchStatus = vi.fn(async () => statuses.shift()!)
    const delay = vi.fn(async () => undefined)
    const onStatus = vi.fn()

    const outcome = await waitForMigrationSettled({ fetchStatus, delay, onStatus })

    expect(outcome).toEqual({ state: 'ready' })
    expect(fetchStatus).toHaveBeenCalledTimes(3)
    // The failed poll retries on the same interval and never reaches onStatus.
    expect(delay).toHaveBeenCalledTimes(2)
    expect(delay).toHaveBeenCalledWith(MIGRATION_POLL_INTERVAL_MS)
    expect(onStatus).toHaveBeenCalledTimes(2)
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ready' }))
  })

  it('resets the failure streak after any successful poll', async () => {
    const statuses: MigrationStatusResult[] = [
      { ok: false },
      { ok: false },
      statusResult(),
      { ok: false },
      statusResult({ state: 'ready' }),
    ]
    const fetchStatus = vi.fn(async () => statuses.shift()!)
    const delay = vi.fn(async () => undefined)

    const outcome = await waitForMigrationSettled({ fetchStatus, delay })

    // Two failures, a migrating snapshot resets the streak, one more failure,
    // then ready — never three in a row, so the loop survives and resolves.
    expect(outcome).toEqual({ state: 'ready' })
    expect(fetchStatus).toHaveBeenCalledTimes(5)
    expect(delay).toHaveBeenCalledTimes(4)
  })

  it('stops without fetching once cancelled', async () => {
    const fetchStatus = vi.fn(async () => statusResult())

    const outcome = await waitForMigrationSettled({ fetchStatus, isCancelled: () => true })

    expect(outcome).toEqual({ state: 'cancelled' })
    expect(fetchStatus).not.toHaveBeenCalled()
  })

  it('stops after the pending delay when cancelled mid-poll', async () => {
    const fetchStatus = vi.fn(async () => statusResult())
    let cancelled = false
    const delay = vi.fn(async () => { cancelled = true })

    const outcome = await waitForMigrationSettled({
      fetchStatus,
      delay,
      isCancelled: () => cancelled,
    })

    expect(outcome).toEqual({ state: 'cancelled' })
    expect(fetchStatus).toHaveBeenCalledTimes(1)
  })
})
