import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { applySqliteMigrations, BASELINE_VERSION } from '../../server/sqlite/migrations.mjs'
import { LEGACY_MIGRATIONS } from '../../server/sqlite/legacy-migrations.mjs'

const BASELINE_TABLES = [
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
]

const BASELINE_INDEXES = [
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
]

const MESSAGE_DIGEST = 'a'.repeat(64)

function createLegacyDatabase(databasePath, version, { withHarness = false } = {}) {
  const database = new DatabaseSync(databasePath)
  try {
    for (const migration of LEGACY_MIGRATIONS.slice(0, version)) {
      migration.up(database)
      database.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, '2026-01-01T00:00:00.000Z')
      database.exec(`PRAGMA user_version = ${migration.version}`)
    }
    if (withHarness) database.exec('ALTER TABLE sessions ADD COLUMN harness TEXT')
  } finally {
    database.close()
  }
}

function seedSessionState(databasePath, { harness } = {}) {
  const database = new DatabaseSync(databasePath)
  try {
    const columns = [
      'scope', 'project_id', 'session_id', 'title', 'created_at', 'updated_at', 'message_count',
      'state_version', 'body_json', 'meta_json', 'revision', 'updated_at_ms',
    ]
    const values = [
      'global', '', 'legacy-session', 'legacy title', '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z', 1, 0, '{}', '{}', 1, 1,
    ]
    if (harness !== undefined) {
      columns.push('harness')
      values.push(harness)
    }
    database.prepare(`INSERT INTO sessions (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
      .run(...values)
    database.prepare(`
      INSERT INTO session_messages (scope, project_id, session_id, seq, message_id, message_json, message_digest)
      VALUES ('global', '', 'legacy-session', 1, 'm1', '{"role":"user","content":"hi"}', ?)
    `).run(MESSAGE_DIGEST)
  } finally {
    database.close()
  }
}

function schemaNames(database, type) {
  return database.prepare(`SELECT name FROM sqlite_schema WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all(type)
    .map((row) => row.name)
}

function indexNames(database) {
  return database.prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name")
    .all()
    .map((row) => row.name)
}

describe('legacy SQLite auto-upgrade', () => {
  let temporaryDirectory

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-legacy-upgrade-'))
  })

  afterEach(async () => {
    await closeSqliteStorage()
    await rm(temporaryDirectory, { recursive: true, force: true })
  })

  it.each(Array.from({ length: LEGACY_MIGRATIONS.length }, (_, index) => index + 1))(
    'upgrades a v%d database to the baseline schema',
    (version) => {
      const databasePath = path.join(temporaryDirectory, `legacy-v${version}.sqlite3`)
      createLegacyDatabase(databasePath, version)
      const database = new DatabaseSync(databasePath)
      try {
        const state = applySqliteMigrations(database)
        expect(state.userVersion).toBe(BASELINE_VERSION)
        expect(state.legacy).toBe(false)
        expect(database.prepare('SELECT version, name FROM schema_migrations').all())
          .toEqual([{ version: BASELINE_VERSION, name: 'baseline' }])
        expect(schemaNames(database, 'table')).toEqual(BASELINE_TABLES)
        expect(indexNames(database)).toEqual(BASELINE_INDEXES)
        expect(database.prepare('PRAGMA quick_check').get().quick_check).toBe('ok')
      } finally {
        database.close()
      }
    },
  )

  it('preserves session data and drops the retired harness column', () => {
    const databasePath = path.join(temporaryDirectory, 'legacy-v12-data.sqlite3')
    createLegacyDatabase(databasePath, 12, { withHarness: true })
    seedSessionState(databasePath, { harness: 'opencode' })
    const database = new DatabaseSync(databasePath)
    try {
      applySqliteMigrations(database)
      expect(database.prepare('SELECT title, revision FROM sessions WHERE session_id = ?').get('legacy-session'))
        .toMatchObject({ title: 'legacy title', revision: 1 })
      expect(database.prepare('SELECT COUNT(*) AS count FROM session_messages').get().count).toBe(1)
      expect(database.prepare('PRAGMA table_info(sessions)').all().map((column) => column.name)).not.toContain('harness')
    } finally {
      database.close()
    }
  })

  it('writes a pre-upgrade backup when initialization upgrades a legacy database', async () => {
    const databasePath = path.join(temporaryDirectory, 'legacy-init.sqlite3')
    createLegacyDatabase(databasePath, 12)
    seedSessionState(databasePath)

    const storage = await initializeSqliteStorage({ databasePath })
    expect(storage.health()).toMatchObject({ ok: true, schemaVersion: BASELINE_VERSION, migrationCount: 1 })
    expect(storage.prepare('SELECT title FROM sessions WHERE session_id = ?').get('legacy-session').title).toBe('legacy title')
    expect(Number(storage.prepare('PRAGMA auto_vacuum').get().auto_vacuum)).toBe(2)

    const backups = (await readdir(temporaryDirectory))
      .filter((name) => name.startsWith('legacy-init.sqlite3.pre-v19-from-v12-') && name.endsWith('.bak'))
    expect(backups).toHaveLength(1)

    const backup = new DatabaseSync(path.join(temporaryDirectory, backups[0]), { readOnly: true })
    try {
      expect(backup.prepare('PRAGMA user_version').get().user_version).toBe(12)
      expect(backup.prepare('SELECT title FROM sessions WHERE session_id = ?').get('legacy-session').title).toBe('legacy title')
    } finally {
      backup.close()
    }
  })

  it('refuses an inconsistent legacy database without writing or backing up', async () => {
    const databasePath = path.join(temporaryDirectory, 'legacy-inconsistent.sqlite3')
    const database = new DatabaseSync(databasePath)
    try {
      database.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY CHECK (version > 0),
          name TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL
        )
      `)
      database.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(18, 'wrong_migration_name', '2026-01-01T00:00:00.000Z')
      database.exec('PRAGMA user_version = 18')
    } finally {
      database.close()
    }

    const reopened = new DatabaseSync(databasePath)
    try {
      expect(() => applySqliteMigrations(reopened)).toThrow(/inconsistent/)
      expect(reopened.prepare('PRAGMA user_version').get().user_version).toBe(18)
      expect(schemaNames(reopened, 'table')).toEqual(['schema_migrations'])
    } finally {
      reopened.close()
    }

    await expect(initializeSqliteStorage({ databasePath })).rejects.toThrow(/inconsistent/)
    expect((await readdir(temporaryDirectory)).some((name) => name.endsWith('.bak'))).toBe(false)
  })
})
