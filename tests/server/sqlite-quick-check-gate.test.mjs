import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  closeSqliteStorage,
  initializeSqliteStorage,
  resetSharedQuickCheckCache,
  runSharedSqliteQuickCheck,
  SQLITE_QUICK_CHECK_MARKER_FILENAME,
  SQLITE_QUICK_CHECK_MAX_AGE_MS,
} from '../../server/sqlite/database.mjs'
import { createLanAccessRepository } from '../../server/sqlite/lan-access-repository.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import { createShareRepository } from '../../server/sqlite/share-repository.mjs'

const markerPathFor = (databasePath) => path.join(path.dirname(databasePath), SQLITE_QUICK_CHECK_MARKER_FILENAME)

async function writeMarker(databasePath, lastOkAt) {
  await writeFile(markerPathFor(databasePath), `${JSON.stringify({ lastOkAt })}\n`, 'utf8')
}

// Wraps a storage surface while counting (or breaking) PRAGMA quick_check
// calls; everything else delegates to the real database handle. This mirrors
// the duck-typed handles tests and production repositories already share.
function spyStorage(storage, { quickCheckRows = null, quickCheckError = null } = {}) {
  const calls = { quickCheck: 0 }
  const handle = {
    exec: (sql) => storage.exec(sql),
    prepare: (sql) => {
      if (sql.includes('PRAGMA quick_check')) {
        calls.quickCheck += 1
        if (quickCheckError) throw quickCheckError
        if (quickCheckRows) return { all: () => quickCheckRows }
      }
      return storage.prepare(sql)
    },
    transaction: (callback, options) => storage.transaction(callback, options),
  }
  return { handle, calls }
}

describe('SQLite startup quick_check gate', () => {
  let directory

  beforeEach(async () => {
    resetSharedQuickCheckCache()
    delete process.env.QUICKFORGE_SQLITE_QUICK_CHECK
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-quick-check-gate-'))
  })

  afterEach(async () => {
    delete process.env.QUICKFORGE_SQLITE_QUICK_CHECK
    resetSharedQuickCheckCache()
    await closeSqliteStorage()
    await rm(directory, { recursive: true, force: true })
  })

  async function openStorage() {
    const databasePath = path.join(directory, 'gate.sqlite3')
    return { storage: await initializeSqliteStorage({ databasePath }), databasePath }
  }

  it('runs a real scan and writes a marker when none exists', async () => {
    const { storage, databasePath } = await openStorage()
    const { handle, calls } = spyStorage(storage)

    const result = runSharedSqliteQuickCheck(handle)

    expect(result).toMatchObject({ ok: true, skipped: null })
    expect(calls.quickCheck).toBe(1)
    const marker = JSON.parse(await readFile(markerPathFor(databasePath), 'utf8'))
    expect(marker).toMatchObject({ app: 'quickforge', lastOkAt: result.lastOkAt })
    expect(marker.sqliteVersion).toEqual(expect.any(String))
    expect(marker.databaseBytes).toEqual(expect.any(Number))
  })

  it('skips the scan while the marker is fresh', async () => {
    const { storage, databasePath } = await openStorage()
    const { handle, calls } = spyStorage(storage)
    const lastOkAt = Date.now()
    await writeMarker(databasePath, lastOkAt)

    const result = runSharedSqliteQuickCheck(handle)

    expect(result).toMatchObject({ ok: true, skipped: 'marker', lastOkAt })
    expect(calls.quickCheck).toBe(0)
  })

  it('re-runs a real scan once the marker has expired', async () => {
    const { storage, databasePath } = await openStorage()
    const { handle, calls } = spyStorage(storage)
    await writeMarker(databasePath, Date.now() - SQLITE_QUICK_CHECK_MAX_AGE_MS - 1)

    const result = runSharedSqliteQuickCheck(handle)

    expect(result).toMatchObject({ ok: true, skipped: null })
    expect(calls.quickCheck).toBe(1)
  })

  it('force bypasses the cache and marker and refreshes the marker', async () => {
    const { storage, databasePath } = await openStorage()
    const { handle, calls } = spyStorage(storage)
    await writeMarker(databasePath, Date.now())
    const fixedNow = Date.now()

    const result = runSharedSqliteQuickCheck(handle, { force: true, now: () => fixedNow })

    expect(result).toMatchObject({ ok: true, skipped: null, lastOkAt: fixedNow })
    expect(calls.quickCheck).toBe(1)
    const marker = JSON.parse(await readFile(markerPathFor(databasePath), 'utf8'))
    expect(marker.lastOkAt).toBe(fixedNow)
  })

  it('reuses the process cache and rescans after reset', async () => {
    const { storage, databasePath } = await openStorage()
    const { handle, calls } = spyStorage(storage)

    const first = runSharedSqliteQuickCheck(handle)
    expect(first.skipped).toBeNull()

    const second = runSharedSqliteQuickCheck(handle)
    expect(second).toMatchObject({ ok: true, skipped: 'process', lastOkAt: first.lastOkAt })
    expect(calls.quickCheck).toBe(1)

    // The process cache wins even when the marker file disappears.
    await rm(markerPathFor(databasePath), { force: true })
    expect(runSharedSqliteQuickCheck(handle).skipped).toBe('process')

    // After the reset the marker layer is consulted again; a missing marker
    // means a fresh real scan.
    resetSharedQuickCheckCache()
    expect(runSharedSqliteQuickCheck(handle).skipped).toBeNull()
    expect(calls.quickCheck).toBe(2)
  })

  it('treats a malformed or unreadable marker as absent', async () => {
    const { storage, databasePath } = await openStorage()
    const { handle, calls } = spyStorage(storage)
    await writeFile(markerPathFor(databasePath), '{ not valid json', 'utf8')

    expect(runSharedSqliteQuickCheck(handle).skipped).toBeNull()
    expect(calls.quickCheck).toBe(1)
  })

  it('throws on quick_check failure without writing a marker or caching', async () => {
    const { storage, databasePath } = await openStorage()
    const { handle, calls } = spyStorage(storage, { quickCheckRows: [{ quick_check: 'file is not a database' }] })

    expect(() => runSharedSqliteQuickCheck(handle)).toThrow(/SQLite quick_check failed/)
    expect(existsSync(markerPathFor(databasePath))).toBe(false)

    // Failures are never cached: the next call scans (and fails) again.
    expect(() => runSharedSqliteQuickCheck(handle)).toThrow(/SQLite quick_check failed/)
    expect(calls.quickCheck).toBe(2)
  })

  it('propagates quick_check prepare errors without writing a marker', async () => {
    const { storage, databasePath } = await openStorage()
    const { handle } = spyStorage(storage, { quickCheckError: new Error('quick_check exploded') })

    expect(() => runSharedSqliteQuickCheck(handle)).toThrow('quick_check exploded')
    expect(existsSync(markerPathFor(databasePath))).toBe(false)
  })

  it('honors QUICKFORGE_SQLITE_QUICK_CHECK=force', async () => {
    const { storage, databasePath } = await openStorage()
    const { handle, calls } = spyStorage(storage)
    await writeMarker(databasePath, Date.now())
    process.env.QUICKFORGE_SQLITE_QUICK_CHECK = 'force'

    expect(runSharedSqliteQuickCheck(handle)).toMatchObject({ ok: true, skipped: null })
    expect(runSharedSqliteQuickCheck(handle)).toMatchObject({ ok: true, skipped: null })
    expect(calls.quickCheck).toBe(2)
  })

  it('always runs a real scan for in-memory databases', () => {
    const database = new DatabaseSync(':memory:')
    try {
      expect(runSharedSqliteQuickCheck(database).skipped).toBeNull()
      expect(runSharedSqliteQuickCheck(database).skipped).toBeNull()
    } finally {
      database.close()
    }
  })

  it('threads the gate through repository verifyIntegrity and health quick_check', async () => {
    const { storage, databasePath } = await openStorage()
    const { handle, calls } = spyStorage(storage)
    await writeMarker(databasePath, Date.now())

    // All three domain repositories share the gate: the fresh marker skips
    // their real scans while SQL-level checks keep running.
    // The session and share repositories return ok on an empty library; the
    // lan-access repository reports a domain-level "no config yet" (ok:false)
    // — either way the quick_check layer was skipped, not scanned.
    for (const repository of [createSessionStateRepository(handle), createShareRepository(handle)]) {
      expect(repository.verifyIntegrity({ quickCheck: true }).ok).toBe(true)
    }
    expect(createLanAccessRepository(handle).verifyIntegrity({ quickCheck: true }).ok).toBe(false)
    expect(calls.quickCheck).toBe(0)

    // forceQuickCheck is the manual-maintenance escape hatch: real scan.
    createShareRepository(handle).verifyIntegrity({ quickCheck: true, forceQuickCheck: true })
    expect(calls.quickCheck).toBe(1)

    // health({ quickCheck: true }) rides the same gate: with the marker gone
    // and the cache reset it performs the real scan itself and writes a fresh
    // marker...
    await rm(markerPathFor(databasePath), { force: true })
    resetSharedQuickCheckCache()
    expect(storage.health({ quickCheck: true })).toMatchObject({ quickCheck: 'ok' })
    expect(existsSync(markerPathFor(databasePath))).toBe(true)
    // ...and the shared process cache now holds that fresh result.
    expect(runSharedSqliteQuickCheck(handle).skipped).toBe('process')
  })
})
