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
import { BASE_SCHEMA_VERSION, LATEST_SCHEMA_VERSION, NEXT_SCHEMA_VERSION } from '../helpers/sqlite-schema.mjs'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const workerScript = path.join(projectRoot, 'tests', 'fixtures', 'sqlite-init-worker.mjs')

// The retired compat-era objects (v1..v18 migration chain, JSON mirror queues and
// *_v10_backup rollback tables). The baseline must not recreate any of them.
const LEGACY_COMPAT_TABLES = [
  'lan_access_json_mirror_queue',
  'lan_access_storage_state',
  'scheduled_runs_state',
  'session_index_v10_backup',
  'session_json_mirror_queue',
  'session_json_mirror_queue_v10_backup',
  'session_messages_v10_backup',
  'session_state_tombstones_v10_backup',
  'session_states_v10_backup',
  'session_storage_state',
  'session_storage_state_v10_backup',
  'share_json_mirror_queue',
  'share_storage_state',
]

const LEGACY_COMPAT_INDEXES = ['session_states_metadata_cover_idx']

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
    expect(storage.health()).toMatchObject({ ok: true })
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
    const indexes = reopened.prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name").all()

    expect(rowsAfter).toEqual(rowsBefore)
    // The database must record exactly the migration list, in order: this
    // guards against partially applied or duplicated rows without restating
    // the version number in the test.
    expect(rowsAfter).toEqual(SQLITE_MIGRATIONS.map((migration) => ({ version: migration.version, name: migration.name })))

    // Exactly the baseline business tables. The memories* tables are gone (v17:
    // Dreaming keeps only its run log in SQLite), and the compat-era
    // *_v10_backup / *_storage_state / *_json_mirror_queue / scheduled_runs_state
    // tables were retired together with the v1..v18 chain.
    expect(tables.map((row) => row.name)).toEqual([
      'dreaming_note_stats',
      'dreaming_runs',
      'lan_access_maintenance_lock',
      'lan_access_state',
      'lan_access_tokens',
      'scheduled_runs_maintenance_lock',
      'scheduled_task_runs',
      'schema_migrations',
      'session_messages',
      'session_state_maintenance_lock',
      'session_tombstones',
      'sessions',
      'share_maintenance_lock',
      'share_sessions',
      'share_tokens',
    ])

    // The 13 indexes declared by BASELINE_SQL.
    expect(indexes.map((row) => row.name)).toEqual([
      'idx_dreaming_note_stats_recall',
      'idx_dreaming_runs_started',
      'idx_session_messages_session_id',
      'idx_sessions_list',
      'idx_sessions_pinned',
      'idx_sessions_session_id',
      'lan_access_tokens_issued_idx',
      'lan_access_tokens_seq_idx',
      'scheduled_task_runs_started_idx',
      'scheduled_task_runs_status_started_idx',
      'scheduled_task_runs_task_started_idx',
      'scheduled_task_runs_trigger_started_idx',
      'share_sessions_session_id_idx',
    ])

    // Reverse guard: no retired compat-era object may come back.
    const tableNames = tables.map((row) => row.name)
    const indexNames = indexes.map((row) => row.name)
    expect(tableNames.filter((name) => LEGACY_COMPAT_TABLES.includes(name))).toEqual([])
    expect(indexNames.filter((name) => LEGACY_COMPAT_INDEXES.includes(name))).toEqual([])
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
    const baselineMigration = SQLITE_MIGRATIONS[0]
    const failingMigration = {
      version: NEXT_SCHEMA_VERSION,
      name: 'failing_migration',
      up(db) {
        db.exec('CREATE TABLE must_rollback (id INTEGER PRIMARY KEY)')
        throw new Error('deliberate failure')
      },
    }

    try {
      // The baseline is already committed, so the failed append must leave the
      // database exactly at the baseline version instead of unwinding the schema.
      applySqliteMigrations(database, { migrations: [baselineMigration] })
      expect(database.prepare('PRAGMA user_version').get().user_version).toBe(BASE_SCHEMA_VERSION)

      expect(() => applySqliteMigrations(database, { migrations: [baselineMigration, failingMigration] }))
        .toThrow(new RegExp(`migration ${NEXT_SCHEMA_VERSION}.*deliberate failure`))

      expect(database.prepare('PRAGMA user_version').get().user_version).toBe(BASE_SCHEMA_VERSION)
      expect(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'must_rollback'").all()).toEqual([])
      expect(database.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all())
        .toEqual([{ version: baselineMigration.version, name: baselineMigration.name }])
      expect(database.prepare('PRAGMA quick_check').get().quick_check).toBe('ok')
    } finally {
      closeDatabase(database)
    }
  })

  it('rejects newer and inconsistent schema metadata', () => {
    const tooNew = new DatabaseSync(path.join(temporaryDirectory, 'too-new.sqlite3'))
    const missingTable = new DatabaseSync(path.join(temporaryDirectory, 'missing-table.sqlite3'))
    const zeroUserVersion = new DatabaseSync(path.join(temporaryDirectory, 'zero-user-version.sqlite3'))
    const mismatchedRows = new DatabaseSync(path.join(temporaryDirectory, 'mismatched-rows.sqlite3'))
    try {
      tooNew.exec(`PRAGMA user_version = ${NEXT_SCHEMA_VERSION}`)
      expect(() => inspectSqliteMigrationState(tooNew))
        .toThrow(new RegExp(`schema version ${NEXT_SCHEMA_VERSION} is newer than supported version ${LATEST_SCHEMA_VERSION}`))

      missingTable.exec(`PRAGMA user_version = ${BASE_SCHEMA_VERSION}`)
      expect(() => inspectSqliteMigrationState(missingTable)).toThrow(/schema_migrations is missing/)

      applySqliteMigrations(zeroUserVersion)
      zeroUserVersion.exec('PRAGMA user_version = 0')
      expect(() => inspectSqliteMigrationState(zeroUserVersion)).toThrow(/schema_migrations exists while user_version is 0/)

      applySqliteMigrations(mismatchedRows)
      mismatchedRows.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(NEXT_SCHEMA_VERSION, 'phantom_migration', '2026-01-01T00:00:00.000Z')
      expect(() => inspectSqliteMigrationState(mismatchedRows))
        .toThrow(new RegExp(`user_version is ${BASE_SCHEMA_VERSION} but 2 migration rows exist`))
    } finally {
      closeDatabase(tooNew)
      closeDatabase(missingTable)
      closeDatabase(zeroUserVersion)
      closeDatabase(mismatchedRows)
    }
  })

  it('rejects a pre-baseline database that still carries schema_migrations', () => {
    const databasePath = path.join(temporaryDirectory, 'pre-baseline.sqlite3')
    const database = new DatabaseSync(databasePath)
    const legacyVersion = BASE_SCHEMA_VERSION - 1
    try {
      // Shaped like the retired v18 layout: migration metadata exists, but the
      // user_version predates the baseline this build understands.
      database.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY CHECK (version > 0),
          name TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL
        )
      `)
      database.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(legacyVersion, 'session_state_v2_storage', '2026-01-01T00:00:00.000Z')
      database.exec(`PRAGMA user_version = ${legacyVersion}`)

      expect(() => inspectSqliteMigrationState(database)).toThrow(/predates the supported baseline/)
      expect(() => applySqliteMigrations(database)).toThrow(/predates the supported baseline/)

      // Refusing to migrate must leave the legacy database untouched.
      expect(database.prepare('PRAGMA user_version').get().user_version).toBe(legacyVersion)
      expect(database.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: legacyVersion }])
      expect(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'sessions'").all()).toEqual([])
    } finally {
      closeDatabase(database)
    }
  })

  it('reports non-sensitive health and optional quick_check', async () => {
    const databasePath = path.join(temporaryDirectory, 'health.sqlite3')
    const storage = await initializeSqliteStorage({ databasePath })

    const health = storage.health({ quickCheck: true })
    expect(health).toMatchObject({
      ok: true,
      journalMode: 'wal',
      busyTimeout: 5_000,
      foreignKeys: true,
      synchronous: 'normal',
      quickCheck: 'ok',
    })
    expect(JSON.stringify(health)).not.toContain(databasePath)
  })

  it('supports concurrent first initialization from multiple processes without duplicating migrations', async () => {
    const databasePath = path.join(temporaryDirectory, 'concurrent.sqlite3')
    const summaries = await Promise.all([
      spawnInitializationWorker(databasePath),
      spawnInitializationWorker(databasePath),
      spawnInitializationWorker(databasePath),
    ])

    expect(summaries.every((summary) => summary.ok)).toBe(true)
    const database = new DatabaseSync(databasePath)
    try {
      // Concurrent first starts must converge on exactly one copy of each
      // migration (the baseline), with a user_version that agrees with it.
      const applied = database.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version)
      expect(applied).toEqual(SQLITE_MIGRATIONS.map((migration) => migration.version))
      expect(database.prepare('PRAGMA user_version').get().user_version).toBe(BASE_SCHEMA_VERSION)
    } finally {
      closeDatabase(database)
    }
  }, 25_000)
})
