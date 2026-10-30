import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  acquireShareMaintenanceLock,
  currentShareMaintenanceContext,
  isShareMaintenanceActive,
  releaseShareMaintenanceLock,
  renewShareMaintenanceLock,
  runShareMaintenance,
} from '../../server/share-maintenance.mjs'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'

describe('share maintenance lock', () => {
  let directory
  let storage

  beforeEach(async () => {
    await closeSqliteStorage()
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-share-maintenance-'))
    storage = await initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
  })

  afterEach(async () => {
    await closeSqliteStorage()
    await rm(directory, { recursive: true, force: true })
  })

  it('fences leases, heartbeats them, and steals only expired leases with confirmed dead PIDs', () => {
    let now = Date.parse('2026-01-01T00:00:00.000Z')
    const first = acquireShareMaintenanceLock(storage, {
      owner: { id: '111:first', pid: 111 }, now: () => now, ttlMs: 30, pidAlive: () => true,
    })
    expect(first).toMatchObject({ owner: '111:first', fencing: 1 })
    now += 20
    expect(renewShareMaintenanceLock(storage, first, { now: () => now, ttlMs: 30 })).toBe(true)
    now += 20
    expect(acquireShareMaintenanceLock(storage, {
      owner: { id: '222:second', pid: 222 }, now: () => now, ttlMs: 30, pidAlive: () => false,
    })).toBeNull()
    now += 20
    const second = acquireShareMaintenanceLock(storage, {
      owner: { id: '222:second', pid: 222 }, now: () => now, ttlMs: 30, pidAlive: () => false,
    })
    expect(second).toMatchObject({ owner: '222:second', fencing: 2 })
    expect(releaseShareMaintenanceLock(storage, first)).toBe(false)
    expect(releaseShareMaintenanceLock(storage, second)).toBe(true)
    expect(isShareMaintenanceActive(storage)).toBe(false)
  })

  it('exposes the operation context and blocks nothing once the work finishes', async () => {
    expect(isShareMaintenanceActive(storage)).toBe(false)
    const seen = await runShareMaintenance(async (context) => {
      expect(isShareMaintenanceActive()).toBe(true)
      expect(currentShareMaintenanceContext()).toBe(context)
      expect(context.lease).toMatchObject({ fencing: 1 })
      return 'done'
    }, { storage, operation: 'share-test' })
    expect(seen).toBe('done')
    expect(isShareMaintenanceActive(storage)).toBe(false)
    expect(currentShareMaintenanceContext()).toBeNull()
  })

  it('runs a nested operation on the already-held lease instead of deadlocking', async () => {
    const outer = await runShareMaintenance(async () => {
      const inner = await runShareMaintenance(async () => 'inner', { storage, operation: 'share-inner' })
      return inner
    }, { storage, operation: 'share-outer', waitTimeoutMs: 500 })
    expect(outer).toBe('inner')
    expect(isShareMaintenanceActive(storage)).toBe(false)
  })
})
