import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  closeSqliteStorage,
  getSqliteStorage,
  initializeSqliteStorage,
  resolveSqliteDatabasePath,
} from '../../server/sqlite/database.mjs'
import { applySqliteMigrations, inspectSqliteMigrationState, SQLITE_MIGRATIONS } from '../../server/sqlite/migrations.mjs'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const workerScript = path.join(projectRoot, 'tests', 'fixtures', 'sqlite-init-worker.mjs')

function closeDatabase(database) {
  try { database.close() } catch { /* already closed */ }
}

function spawnInitializationWorker(databasePath) {
  const child = spawn(process.execPath, [workerScript, databasePath], {
    cwd: projectRoot,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      QUICKFORGE_LOG_LEVEL: 'ERROR',
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
  child.stderr.on('data', (chunk) => { stderr += chunk.toString() })

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`SQLite initialization worker timed out: ${stderr}`))
    }, 15_000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`SQLite initialization worker failed (${code}): ${stderr}`))
      else resolve(JSON.parse(stdout.trim()))
    })
  })
}

describe('SQLite storage foundation', () => {
  let temporaryDirectory

  beforeEach(async () => {
    await closeSqliteStorage()
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-sqlite-storage-'))
  })

  afterEach(async () => {
    await closeSqliteStorage()
    await rm(temporaryDirectory, { recursive: true, force: true })
  })

  it('resolves the default storage path and creates its parent directory', async () => {
    const dataDir = path.join(temporaryDirectory, 'nested', 'data')
    const expectedPath = path.join(dataDir, 'storage', 'quickforge.sqlite3')

    expect(resolveSqliteDatabasePath({ dataDir })).toBe(expectedPath)
    const storage = await initializeSqliteStorage({ dataDir })

    expect(existsSync(expectedPath)).toBe(true)
    expect(storage.health()).toMatchObject({ ok: true, schemaVersion: 9, migrationCount: 9 })
  })

  it('applies and verifies the required PRAGMAs', async () => {
    const storage = await initializeSqliteStorage({ dataDir: temporaryDirectory })

    expect(storage.prepare('PRAGMA busy_timeout').get().timeout).toBe(5_000)
    expect(storage.prepare('PRAGMA foreign_keys').get().foreign_keys).toBe(1)
    expect(storage.prepare('PRAGMA journal_mode').get().journal_mode).toBe('wal')
    expect(storage.prepare('PRAGMA synchronous').get().synchronous).toBe(1)
  })

  it('deduplicates initialization, rejects path conflicts, retries failures, and reinitializes after close', async () => {
    const dataDir = path.join(temporaryDirectory, 'data')
    const firstPromise = initializeSqliteStorage({ dataDir })
    const secondPromise = initializeSqliteStorage({ dataDir })

    expect(secondPromise).toBe(firstPromise)
    const first = await firstPromise
    expect(await initializeSqliteStorage({ dataDir })).toBe(first)
    await expect(initializeSqliteStorage({ dataDir: path.join(temporaryDirectory, 'other') })).rejects.toThrow(/different database path/)

    await closeSqliteStorage()
    await closeSqliteStorage()
    expect(() => first.prepare('SELECT 1').get()).toThrow()
    expect(() => getSqliteStorage()).toThrow(/not initialized/)

    const failedPath = path.join(temporaryDirectory, 'directory-as-database')
    await mkdir(failedPath)
    await expect(initializeSqliteStorage({ databasePath: failedPath })).rejects.toThrow()
    await rm(failedPath, { recursive: true, force: true })
    const reopened = await initializeSqliteStorage({ databasePath: failedPath })
    expect(reopened.health().ok).toBe(true)
  })

  it('keeps migrations idempotent and creates only the registered business tables', async () => {
    const databasePath = path.join(temporaryDirectory, 'migration.sqlite3')
    const storage = await initializeSqliteStorage({ databasePath })
    const rowsBefore = storage.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()

    await closeSqliteStorage()
    const reopened = await initializeSqliteStorage({ databasePath })
    const rowsAfter = reopened.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()
    const tables = reopened.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()

    expect(rowsAfter).toEqual(rowsBefore)
    expect(rowsAfter).toEqual([
      { version: 1, name: 'create_schema_migrations' },
      { version: 2, name: 'create_scheduled_task_runs' },
      { version: 3, name: 'scheduled_task_runs_authoritative_cutover' },
      { version: 4, name: 'create_session_index' },
      { version: 5, name: 'add_session_index_query_indexes' },
      { version: 6, name: 'session_state_transactional_storage' },
      { version: 7, name: 'session_messages_incremental_storage' },
      { version: 8, name: 'share_storage_migration' },
      { version: 9, name: 'lan_access_storage_migration' },
    ])
    expect(tables).toEqual([
      { name: 'lan_access_json_mirror_queue' },
      { name: 'lan_access_maintenance_lock' },
      { name: 'lan_access_state' },
      { name: 'lan_access_storage_state' },
      { name: 'lan_access_tokens' },
      { name: 'scheduled_runs_maintenance_lock' },
      { name: 'scheduled_runs_state' },
      { name: 'scheduled_task_runs' },
      { name: 'schema_migrations' },
      { name: 'session_index' },
      { name: 'session_json_mirror_queue' },
      { name: 'session_messages' },
      { name: 'session_state_maintenance_lock' },
      { name: 'session_state_tombstones' },
      { name: 'session_states' },
      { name: 'session_storage_state' },
      { name: 'share_json_mirror_queue' },
      { name: 'share_maintenance_lock' },
      { name: 'share_sessions' },
      { name: 'share_storage_state' },
      { name: 'share_tokens' },
    ])
  })

  it('commits, rolls back, and supports nested savepoints', async () => {
    const storage = await initializeSqliteStorage({ dataDir: temporaryDirectory })
    storage.exec('CREATE TABLE transaction_events (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')

    const result = storage.transaction((database) => {
      database.prepare('INSERT INTO transaction_events (value) VALUES (?)').run('committed')
      return 'result'
    }, { mode: 'deferred' })
    expect(result).toBe('result')

    expect(() => storage.transaction((database) => {
      database.prepare('INSERT INTO transaction_events (value) VALUES (?)').run('rolled-back')
      throw new Error('stop')
    }, { mode: 'exclusive' })).toThrow('stop')

    storage.transaction((database) => {
      database.prepare('INSERT INTO transaction_events (value) VALUES (?)').run('outer-before')
      try {
        database.transaction((nested) => {
          nested.prepare('INSERT INTO transaction_events (value) VALUES (?)').run('nested-rollback')
          throw new Error('nested failure')
        })
      } catch (error) {
        expect(error.message).toBe('nested failure')
      }
      database.prepare('INSERT INTO transaction_events (value) VALUES (?)').run('outer-after')
    })

    expect(storage.prepare('SELECT value FROM transaction_events ORDER BY id').all().map((row) => row.value)).toEqual([
      'committed',
      'outer-before',
      'outer-after',
    ])
  })

  it('rejects async transaction callbacks and rolls back their synchronous writes', async () => {
    const storage = await initializeSqliteStorage({ dataDir: temporaryDirectory })
    storage.exec('CREATE TABLE async_events (value TEXT NOT NULL)')

    expect(() => storage.transaction(async (database) => {
      database.prepare('INSERT INTO async_events (value) VALUES (?)').run('must-rollback')
    })).toThrow(/must be synchronous/)
    expect(storage.prepare('SELECT COUNT(*) AS count FROM async_events').get().count).toBe(0)
  })

  it('rolls back all migration effects when a migration fails', () => {
    const databasePath = path.join(temporaryDirectory, 'failed-migration.sqlite3')
    const database = new DatabaseSync(databasePath)
    const migrations = [
      ...SQLITE_MIGRATIONS,
      {
        version: 10,
        name: 'failing_migration',
        up(db) {
          db.exec('CREATE TABLE must_rollback (id INTEGER PRIMARY KEY)')
          throw new Error('deliberate failure')
        },
      },
    ]

    try {
      expect(() => applySqliteMigrations(database, { migrations })).toThrow(/migration 10.*deliberate failure/)
      expect(database.prepare('PRAGMA user_version').get().user_version).toBe(0)
      expect(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('schema_migrations', 'must_rollback')").all()).toEqual([])
    } finally {
      closeDatabase(database)
    }
  })

  it('rejects newer and inconsistent schema metadata', () => {
    const tooNew = new DatabaseSync(path.join(temporaryDirectory, 'too-new.sqlite3'))
    const missingTable = new DatabaseSync(path.join(temporaryDirectory, 'missing-table.sqlite3'))
    const mismatchedRows = new DatabaseSync(path.join(temporaryDirectory, 'mismatched-rows.sqlite3'))
    try {
      tooNew.exec('PRAGMA user_version = 10')
      expect(() => inspectSqliteMigrationState(tooNew)).toThrow(/newer than supported/)

      missingTable.exec('PRAGMA user_version = 1')
      expect(() => inspectSqliteMigrationState(missingTable)).toThrow(/schema_migrations is missing/)

      applySqliteMigrations(mismatchedRows)
      mismatchedRows.exec('PRAGMA user_version = 0')
      expect(() => inspectSqliteMigrationState(mismatchedRows)).toThrow(/schema_migrations exists while user_version is 0/)
    } finally {
      closeDatabase(tooNew)
      closeDatabase(missingTable)
      closeDatabase(mismatchedRows)
    }
  })

  it('reports non-sensitive health and optional quick_check', async () => {
    const databasePath = path.join(temporaryDirectory, 'health.sqlite3')
    const storage = await initializeSqliteStorage({ databasePath })

    const health = storage.health({ quickCheck: true })
    expect(health).toMatchObject({
      ok: true,
      schemaVersion: 9,
      latestSchemaVersion: 9,
      migrationCount: 9,
      journalMode: 'wal',
      busyTimeout: 5_000,
      foreignKeys: true,
      synchronous: 'normal',
      quickCheck: 'ok',
    })
    expect(JSON.stringify(health)).not.toContain(databasePath)
  })

  it('supports concurrent first initialization from multiple processes with four migration rows', async () => {
    const databasePath = path.join(temporaryDirectory, 'concurrent.sqlite3')
    const summaries = await Promise.all([
      spawnInitializationWorker(databasePath),
      spawnInitializationWorker(databasePath),
      spawnInitializationWorker(databasePath),
    ])

    expect(summaries.every((summary) => summary.ok && summary.schemaVersion === 9)).toBe(true)
    const database = new DatabaseSync(databasePath)
    try {
      expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count).toBe(9)
      expect(database.prepare('PRAGMA user_version').get().user_version).toBe(9)
    } finally {
      closeDatabase(database)
    }
  }, 25_000)
})
