import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runSqliteCompatibilitySpike } from '../../scripts/sqlite-compatibility-spike.mjs'

describe('SQLite compatibility spike', () => {
  it('validates the shared node:sqlite behavior on a cleaned-up file database', async () => {
    const result = await runSqliteCompatibilitySpike()

    expect(result).toMatchObject({
      ok: true,
      runtime: {
        node: expect.any(String),
        electron: process.versions.electron ?? null,
        sqlite: expect.any(String),
      },
      crud: {
        passed: true,
        updatedName: 'beta',
        remainingRows: 0,
      },
      rollback: {
        passed: true,
        remainingRows: 0,
      },
      wal: {
        passed: true,
        journalMode: 'wal',
      },
      busyTimeout: {
        passed: true,
        milliseconds: 5_000,
      },
      twoProcessConcurrency: {
        passed: true,
        signals: ['locked', 'ready', 'released', 'written'],
        waitedForLock: true,
        actors: ['A', 'B'],
      },
      temporaryDatabase: {
        fileBacked: true,
        cleanedUp: true,
      },
    })
    expect(result.twoProcessConcurrency.writerElapsedMs).toBeGreaterThanOrEqual(300)
    expect(existsSync(result.temporaryDatabase.path ?? '')).toBe(false)
  }, 30_000)
})
