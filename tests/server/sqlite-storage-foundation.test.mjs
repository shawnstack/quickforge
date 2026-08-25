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
    expect(storage.health()).toMatchObject({ ok: true, schemaVersion: 12, migrationCount: 12 })
  })

  it('applies and verifies the required PRAGMAs', async () => {
    const storage = await initializeSqliteStorage({ dataDir: temporaryDirectory })

    expect(storage.prepare('PRAGMA busy_timeout').get().timeout).toBe(5_000)
    expect(storage.prepare('PRAGMA foreign_keys').get().foreign_keys).toBe(1)
    expect(storage.prepare('PRAGMA journal_mode').get().journal_mode).toBe('wal')
    expect(storage.prepare('PRAGMA synchronous').get().synchronous).toBe(2)
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
      { version: 10, name: 'session_states_metadata_covering_index' },
      { version: 11, name: 'session_state_v2_storage' },
      { version: 12, name: 'remove_share_lan_record_digests' },
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
      { name: 'session_index_v10_backup' },
      { name: 'session_json_mirror_queue_v10_backup' },
      { name: 'session_messages' },
      { name: 'session_messages_v10_backup' },
      { name: 'session_state_maintenance_lock' },
      { name: 'session_state_tombstones_v10_backup' },
      { name: 'session_states_v10_backup' },
      { name: 'session_storage_state_v10_backup' },
      { name: 'session_tombstones' },
      { name: 'sessions' },
      { name: 'share_json_mirror_queue' },
      { name: 'share_maintenance_lock' },
      { name: 'share_sessions' },
      { name: 'share_storage_state' },
      { name: 'share_tokens' },
    ])
  })

  it('creates the session_states metadata covering index and keeps metadata reads index-only with identical data', () => {
    const database = new DatabaseSync(path.join(temporaryDirectory, 'metadata-covering.sqlite3'))
    try {
      // Historical v10 schema: v11 renames session_states to
      // session_states_v10_backup, so this regression test pins the v10-era
      // migration output (and its covering-index behavior) explicitly.
      const applied = applySqliteMigrations(database, { migrations: SQLITE_MIGRATIONS.slice(0, 10) })
      expect(applied.userVersion).toBe(10)
      expect(applied.applied.at(-1)).toMatchObject({ version: 10, name: 'session_states_metadata_covering_index' })
      expect(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND name = 'session_states_metadata_cover_idx'").get())
        .toEqual({ name: 'session_states_metadata_cover_idx' })

      // Rows shaped like production: multi-KB state_json sits between the PK
      // prefix and the metadata columns inside the WITHOUT ROWID record.
      const insert = database.prepare(`
        INSERT INTO session_states (
          scope, project_id, session_id, revision, state_version,
          state_json, state_digest, metadata_json, metadata_digest, created_at, updated_at
        ) VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
      `)
      const digest = 'a'.repeat(64)
      const expected = []
      for (const [scope, projectId, sessionId] of [
        ['global', '', 'global-1'],
        ['project', 'p1', 'project-1'],
        ['project', 'p1', 'project-2'],
        ['project', 'p2', 'project-3'],
      ]) {
        const metadataJson = JSON.stringify({ id: sessionId, title: `Title ${sessionId}`, taskStatus: 'idle' })
        const stateJson = JSON.stringify({ id: sessionId, blob: 'x'.repeat(20_000) })
        insert.run(scope, projectId, sessionId, stateJson, digest, metadataJson, 'b'.repeat(64))
        expected.push({ scope, project_id: projectId, session_id: sessionId, metadata_json: metadataJson })
      }

      // Real SQL from server/session-state-service.mjs readSessionMetadataBuckets —
      // the single projection behind it, metadataBucketChanges,
      // readSessionStateStore('sessions-metadata'), auto-archive and the
      // session-index bucket source. The scoped WHERE variants match the
      // scope / scope+projectId filters readSessionStateStore applies (in JS
      // today); they guard that any future SQL pushdown stays index-only too.
      const queryPlans = database.prepare('EXPLAIN QUERY PLAN SELECT scope, project_id, session_id, metadata_json FROM session_states ORDER BY scope, project_id, session_id').all()
      expect(queryPlans.map((row) => row.detail).join(' | ')).toContain('USING COVERING INDEX session_states_metadata_cover_idx')
      expect(database.prepare("EXPLAIN QUERY PLAN SELECT scope, project_id, session_id, metadata_json FROM session_states WHERE scope = 'project'").all().map((row) => row.detail).join(' | '))
        .toContain('USING COVERING INDEX session_states_metadata_cover_idx')
      expect(database.prepare("EXPLAIN QUERY PLAN SELECT scope, project_id, session_id, metadata_json FROM session_states WHERE scope = 'project' AND project_id = 'p1'").all().map((row) => row.detail).join(' | '))
        .toContain('USING COVERING INDEX session_states_metadata_cover_idx')

      // Data equivalence: the index-only projection (verified above) must
      // return exactly the metadata_json stored in the table records. The
      // revision >= 1 filter cannot be served by the covering index (revision
      // is not an index column), forcing a plain table scan as ground truth.
      const tableScanPlan = database.prepare('EXPLAIN QUERY PLAN SELECT scope, project_id, session_id, metadata_json FROM session_states WHERE revision >= 1 ORDER BY scope, project_id, session_id').all()
      expect(tableScanPlan.map((row) => row.detail).join(' | ')).not.toContain('session_states_metadata_cover_idx')
      const viaCoveringIndex = database.prepare('SELECT scope, project_id, session_id, metadata_json FROM session_states ORDER BY scope, project_id, session_id').all()
      const viaTableRecords = database.prepare('SELECT scope, project_id, session_id, metadata_json FROM session_states WHERE revision >= 1 ORDER BY scope, project_id, session_id').all()
      expect(viaCoveringIndex).toEqual(expected)
      expect(viaCoveringIndex).toEqual(viaTableRecords)
    } finally {
      closeDatabase(database)
    }
  })

  it('migrates v11 Share/LAN data to v12 without losing tokens, foreign keys, indexes, or database integrity', () => {
    const database = new DatabaseSync(path.join(temporaryDirectory, 'v11-to-v12.sqlite3'))
    try {
      database.exec('PRAGMA foreign_keys = ON')
      applySqliteMigrations(database, { migrations: SQLITE_MIGRATIONS.slice(0, 11) })
      database.prepare(`INSERT INTO share_sessions (
        share_id, session_id, permission, scope, auth_version, allow_cloud_usage,
        created_at, updated_at, access_count, revision, record_digest, extra_json
      ) VALUES (?, ?, 'read', 'global', 1, 0, ?, ?, 3, 4, ?, ?)`)
        .run('qfs_migration_000000000001', 'share-session', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 'a'.repeat(64), JSON.stringify({ future: true }))
      database.prepare(`INSERT INTO share_tokens (share_id, token_hash, issued_at, expires_at, auth_version)
        VALUES (?, ?, ?, ?, 1)`)
        .run('qfs_migration_000000000001', 'share-token-hash', '2026-01-02T00:00:00.000Z', '2027-01-02T00:00:00.000Z')
      database.prepare(`INSERT INTO lan_access_state (
        singleton, enabled, password_hash, password_salt, password_version, auth_version,
        session_ttl_hours, updated_at, revision, record_digest, extra_json
      ) VALUES (1, 1, 'lan-hash', 'lan-salt', 1, 2, 24, ?, 5, ?, ?)`)
        .run('2026-01-03T00:00:00.000Z', 'b'.repeat(64), JSON.stringify({ future: 'kept' }))
      database.prepare(`INSERT INTO lan_access_tokens (
        token_id, seq, token_hash, issued_at, expires_at, auth_version, remote_address, user_agent
      ) VALUES ('lan-token', 0, 'lan-token-hash', ?, ?, 2, '192.168.1.9', 'Migration Test')`)
        .run('2026-01-03T00:00:00.000Z', '2027-01-03T00:00:00.000Z')

      applySqliteMigrations(database)

      expect(database.prepare('PRAGMA user_version').get().user_version).toBe(12)
      expect(database.prepare('PRAGMA table_info(share_sessions)').all().map((column) => column.name)).not.toContain('record_digest')
      expect(database.prepare('PRAGMA table_info(lan_access_state)').all().map((column) => column.name)).not.toContain('record_digest')
      expect(database.prepare(`SELECT share_id, session_id, access_count, revision, extra_json FROM share_sessions`).get()).toEqual({
        share_id: 'qfs_migration_000000000001',
        session_id: 'share-session',
        access_count: 3,
        revision: 4,
        extra_json: JSON.stringify({ future: true }),
      })
      expect(database.prepare('SELECT share_id, token_hash, auth_version FROM share_tokens').get()).toEqual({
        share_id: 'qfs_migration_000000000001', token_hash: 'share-token-hash', auth_version: 1,
      })
      expect(database.prepare('SELECT enabled, auth_version, session_ttl_hours, revision, extra_json FROM lan_access_state').get()).toEqual({
        enabled: 1, auth_version: 2, session_ttl_hours: 24, revision: 5, extra_json: JSON.stringify({ future: 'kept' }),
      })
      expect(database.prepare('SELECT token_id, token_hash, auth_version FROM lan_access_tokens').get()).toEqual({
        token_id: 'lan-token', token_hash: 'lan-token-hash', auth_version: 2,
      })
      expect(database.prepare('PRAGMA foreign_key_list(share_tokens)').all()).toEqual(expect.arrayContaining([
        expect.objectContaining({ table: 'share_sessions', from: 'share_id', to: 'share_id', on_delete: 'CASCADE' }),
      ]))
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND name IN ('share_sessions_session_id_idx', 'lan_access_tokens_issued_idx', 'lan_access_tokens_seq_idx') ORDER BY name").all().map((row) => row.name)).toEqual([
        'lan_access_tokens_issued_idx',
        'lan_access_tokens_seq_idx',
        'share_sessions_session_id_idx',
      ])
      expect(database.prepare('PRAGMA quick_check').get().quick_check).toBe('ok')
    } finally {
      closeDatabase(database)
    }
  })

  it('rolls back migration 12 atomically when it fails after dropping the first digest column', () => {
    const database = new DatabaseSync(path.join(temporaryDirectory, 'v12-rollback.sqlite3'))
    const failing = SQLITE_MIGRATIONS.map((migration) => migration.version === 12
      ? { ...migration, up(db) { db.exec('ALTER TABLE share_sessions DROP COLUMN record_digest'); throw new Error('after-share-drop') } }
      : migration)
    try {
      database.exec('PRAGMA foreign_keys = ON')
      applySqliteMigrations(database, { migrations: SQLITE_MIGRATIONS.slice(0, 11) })
      database.prepare(`INSERT INTO share_sessions (
        share_id, session_id, permission, scope, auth_version, allow_cloud_usage,
        created_at, updated_at, access_count, revision, record_digest, extra_json
      ) VALUES ('qfs_rollback_0000000000001', 'share-session', 'read', 'global', 1, 0, ?, ?, 0, 1, ?, '{}')`)
        .run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'c'.repeat(64))
      database.prepare(`INSERT INTO lan_access_state (
        singleton, enabled, auth_version, session_ttl_hours, updated_at, revision, record_digest, extra_json
      ) VALUES (1, 0, 1, 12, ?, 1, ?, '{}')`)
        .run('2026-01-01T00:00:00.000Z', 'd'.repeat(64))

      expect(() => applySqliteMigrations(database, { migrations: failing })).toThrow(/migration 12.*after-share-drop/)
      expect(database.prepare('PRAGMA user_version').get().user_version).toBe(11)
      expect(database.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all().at(-1)).toEqual({ version: 11, name: 'session_state_v2_storage' })
      expect(database.prepare('PRAGMA table_info(share_sessions)').all().map((column) => column.name)).toContain('record_digest')
      expect(database.prepare('PRAGMA table_info(lan_access_state)').all().map((column) => column.name)).toContain('record_digest')
      expect(database.prepare('SELECT record_digest FROM share_sessions').get()).toEqual({ record_digest: 'c'.repeat(64) })
      expect(database.prepare('SELECT record_digest FROM lan_access_state').get()).toEqual({ record_digest: 'd'.repeat(64) })
      expect(database.prepare('PRAGMA quick_check').get().quick_check).toBe('ok')
    } finally {
      closeDatabase(database)
    }
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
        version: 13,
        name: 'failing_migration',
        up(db) {
          db.exec('CREATE TABLE must_rollback (id INTEGER PRIMARY KEY)')
          throw new Error('deliberate failure')
        },
      },
    ]

    try {
      expect(() => applySqliteMigrations(database, { migrations })).toThrow(/migration 13.*deliberate failure/)
      expect(database.prepare('PRAGMA user_version').get().user_version).toBe(0)
      expect(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('schema_migrations', 'must_rollback')").all()).toEqual([])
    } finally {
      closeDatabase(database)
    }
  })

  it('makes a v11 runtime reject a v12 database before it can write', () => {
    const database = new DatabaseSync(path.join(temporaryDirectory, 'v11-runtime-v12-db.sqlite3'))
    try {
      applySqliteMigrations(database)
      database.exec('CREATE TABLE write_guard (value TEXT NOT NULL)')
      database.prepare('INSERT INTO write_guard (value) VALUES (?)').run('unchanged')

      expect(() => applySqliteMigrations(database, { migrations: SQLITE_MIGRATIONS.slice(0, 11) }))
        .toThrow(/schema version 12 is newer than supported version 11/)
      expect(database.prepare('SELECT value FROM write_guard').all()).toEqual([{ value: 'unchanged' }])
    } finally {
      closeDatabase(database)
    }
  })

  it('rejects newer and inconsistent schema metadata', () => {
    const tooNew = new DatabaseSync(path.join(temporaryDirectory, 'too-new.sqlite3'))
    const missingTable = new DatabaseSync(path.join(temporaryDirectory, 'missing-table.sqlite3'))
    const mismatchedRows = new DatabaseSync(path.join(temporaryDirectory, 'mismatched-rows.sqlite3'))
    try {
      tooNew.exec('PRAGMA user_version = 13')
      expect(() => inspectSqliteMigrationState(tooNew)).toThrow(/schema version 13 is newer than supported version 12/)

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
      schemaVersion: 12,
      latestSchemaVersion: 12,
      migrationCount: 12,
      journalMode: 'wal',
      busyTimeout: 5_000,
      foreignKeys: true,
      synchronous: 'full',
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

    expect(summaries.every((summary) => summary.ok && summary.schemaVersion === 12)).toBe(true)
    const database = new DatabaseSync(databasePath)
    try {
      expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count).toBe(12)
      expect(database.prepare('PRAGMA user_version').get().user_version).toBe(12)
    } finally {
      closeDatabase(database)
    }
  }, 25_000)
})
