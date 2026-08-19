import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { applySqliteMigrations, SQLITE_MIGRATIONS } from '../../server/sqlite/migrations.mjs'
import { createScheduledTaskRunsRepository, MAX_SCHEDULED_TASK_RUNS_PER_TASK } from '../../server/sqlite/scheduled-task-runs-repository.mjs'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const initWorkerScript = path.join(projectRoot, 'tests', 'fixtures', 'sqlite-init-worker.mjs')

function run(id, overrides = {}) {
  return { id, status: 'running', trigger: 'manual', startedAt: '2026-08-17T10:00:00.000Z', ...overrides }
}

function spawnInitializationWorker(databasePath) {
  const child = spawn(process.execPath, [initWorkerScript, databasePath], {
    cwd: projectRoot,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, QUICKFORGE_LOG_LEVEL: 'ERROR', ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
  child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(stderr)) }, 15_000)
    child.once('error', reject)
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(stderr))
      else resolve(JSON.parse(stdout.trim()))
    })
  })
}

describe('scheduled task runs repository schema v3', () => {
  let directory
  let databasePath
  let storage
  let repository

  beforeEach(async () => {
    await closeSqliteStorage()
    directory = await mkdtemp(path.join(os.tmpdir(), 'quickforge-scheduled-runs-v3-'))
    databasePath = path.join(directory, 'quickforge.sqlite3')
    storage = await initializeSqliteStorage({ databasePath })
    repository = createScheduledTaskRunsRepository(storage, { now: () => '2026-08-17T12:00:00.000Z' })
  })

  afterEach(async () => {
    await closeSqliteStorage()
    await rm(directory, { recursive: true, force: true })
  })

  it('creates the composite-key table, state/lock tables, and global stable indexes', () => {
    expect(storage.health()).toMatchObject({ schemaVersion: 10, latestSchemaVersion: 10, migrationCount: 10 })
    expect(storage.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()).toEqual([
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
    ])
    const columns = storage.prepare('PRAGMA table_info(scheduled_task_runs)').all()
    expect(columns.find((column) => column.name === 'task_id')).toMatchObject({ pk: 1, notnull: 1 })
    expect(columns.find((column) => column.name === 'id')).toMatchObject({ pk: 2, notnull: 1 })
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(['extra_json', 'legacy_json', 'source', 'updated_at']))
    expect(storage.prepare('SELECT phase FROM scheduled_runs_state WHERE singleton = 1').get()).toEqual({ phase: 'hybrid' })
    const indexes = storage.prepare("SELECT sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'scheduled_task_runs' AND sql IS NOT NULL").all()
    expect(indexes.some((row) => /started_at DESC, id DESC, task_id DESC/.test(row.sql))).toBe(true)
  })

  it('migrates v2 shadow rows atomically and preserves their values', async () => {
    await closeSqliteStorage()
    const raw = new DatabaseSync(databasePath)
    raw.exec(`
      DROP TABLE session_state_maintenance_lock;
      DROP TABLE session_json_mirror_queue;
      DROP TABLE session_storage_state;
      DROP TABLE session_state_tombstones;
      DROP TABLE session_states;
      DROP TABLE session_messages;
      DROP TABLE session_index;
      DROP TABLE scheduled_runs_maintenance_lock;
      DROP TABLE scheduled_runs_state;
      DROP TABLE scheduled_task_runs;
      DROP TABLE share_json_mirror_queue;
      DROP TABLE share_maintenance_lock;
      DROP TABLE share_sessions;
      DROP TABLE share_storage_state;
      DROP TABLE share_tokens;
      DROP TABLE lan_access_json_mirror_queue;
      DROP TABLE lan_access_maintenance_lock;
      DROP TABLE lan_access_state;
      DROP TABLE lan_access_storage_state;
      DROP TABLE lan_access_tokens;
      DELETE FROM schema_migrations WHERE version >= 3;
      PRAGMA user_version = 2;
    `)
    SQLITE_MIGRATIONS[1].up(raw)
    raw.prepare(`INSERT INTO scheduled_task_runs (id, task_id, status, started_at, result) VALUES (?, ?, ?, ?, ?)`)
      .run('same', 'task-a', 'success', '2026-01-01T00:00:00.000Z', 'kept')
    raw.close()

    storage = await initializeSqliteStorage({ databasePath })
    repository = createScheduledTaskRunsRepository(storage)
    expect(repository.get('task-a', 'same')).toMatchObject({ id: 'same', result: 'kept', source: 'v2_shadow' })
  })

  it('rolls back a failing v3 migration without losing the real v2 table, indexes, or data', () => {
    const rawPath = path.join(directory, 'rollback.sqlite3')
    const raw = new DatabaseSync(rawPath)
    const v1v2 = SQLITE_MIGRATIONS.slice(0, 2)
    const failing = SQLITE_MIGRATIONS.map((migration) => migration.version === 3
      ? { ...migration, up(database) { migration.up(database); throw new Error('after rebuild') } }
      : migration)
    try {
      applySqliteMigrations(raw, { migrations: v1v2 })
      raw.prepare(`INSERT INTO scheduled_task_runs (id, task_id, status, started_at, result) VALUES (?, ?, ?, ?, ?)`)
        .run('shadow', 'task-v2', 'success', '2026-01-01T00:00:00.000Z', 'preserved')
      expect(() => applySqliteMigrations(raw, { migrations: failing })).toThrow(/migration 3.*after rebuild/)
      expect(raw.prepare('PRAGMA user_version').get().user_version).toBe(2)
      expect(raw.prepare('SELECT id, task_id, result FROM scheduled_task_runs').all()).toEqual([
        { id: 'shadow', task_id: 'task-v2', result: 'preserved' },
      ])
      const indexes = raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'scheduled_task_runs' AND sql IS NOT NULL ORDER BY name").all()
      expect(indexes.map((row) => row.name)).toEqual([
        'scheduled_task_runs_started_idx',
        'scheduled_task_runs_status_started_idx',
        'scheduled_task_runs_task_started_idx',
        'scheduled_task_runs_trigger_started_idx',
      ])
      expect(raw.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()).toEqual([
        { version: 1, name: 'create_schema_migrations' },
        { version: 2, name: 'create_scheduled_task_runs' },
      ])
    } finally {
      raw.close()
    }
  })

  it('uses taskId+runId for all single-row operations and preserves unknown/legacy fields', () => {
    const first = repository.create('task-a', run('same', { custom: { nested: true }, legacy: { old: 1 } }), { source: 'cutover' })
    repository.create('task-b', run('same', { result: 'task-b' }))
    expect(first).toMatchObject({ id: 'same', custom: { nested: true }, legacy: { old: 1 }, source: 'cutover' })
    expect(repository.get('task-b', 'same')).toMatchObject({ result: 'task-b' })
    expect(repository.update('task-a', 'same', { status: 'failed', errorMessage: 'x' })).toMatchObject({ status: 'failed', custom: { nested: true } })
    expect(repository.delete('task-a', 'same')).toBe(true)
    expect(repository.get('task-b', 'same')).not.toBeNull()
  })

  it('supports idempotent full upsert and atomic replaceAll', () => {
    repository.upsert('task-a', run('one', { extraOne: true }), { source: 'runtime' })
    repository.upsert('task-a', run('one', { status: 'success', result: 'done', extraTwo: true }), { source: 'runtime' })
    expect(repository.get('task-a', 'one')).toMatchObject({ status: 'success', result: 'done', extraTwo: true })
    expect(repository.get('task-a', 'one')).not.toHaveProperty('extraOne')

    repository.replaceAll([
      { taskId: 'task-a', run: run('shared', { result: 'a' }) },
      { taskId: 'task-b', run: run('shared', { result: 'b' }) },
    ], { source: 'restore' })
    expect(repository.count()).toBe(2)
    expect(repository.get('task-a', 'one')).toBeNull()
    expect(() => repository.replaceAll([
      { taskId: 'task-a', run: run('duplicate') },
      { taskId: 'task-a', run: run('duplicate') },
    ])).toThrow(/Duplicate/)
    expect(repository.count()).toBe(2)
  })

  it('performs database filtering, keyword task-title OR text, stable sorting, and pagination', () => {
    repository.create('task-a', run('same', { status: 'success', startedAt: '2026-01-03T00:00:00.000Z', result: 'other' }))
    repository.create('task-z', run('same', { status: 'success', startedAt: '2026-01-03T00:00:00.000Z', result: 'other' }))
    repository.create('task-b', run('old', { status: 'failed', startedAt: '2026-01-02T00:00:00.000Z', errorMessage: 'needle' }))
    repository.create('orphan', run('hidden', { startedAt: '2026-01-04T00:00:00.000Z' }))

    expect(repository.list({ taskIds: ['task-a', 'task-z', 'task-b'], pageSize: 2 }).runs.map((value) => `${value.taskId}/${value.id}`))
      .toEqual(['task-z/same', 'task-a/same'])
    const result = repository.list({
      taskIds: ['task-a', 'task-z', 'task-b'],
      keyword: 'needle',
      keywordTaskIds: ['task-z'],
      page: 1,
      pageSize: 1,
    })
    expect(result).toMatchObject({ total: 2, page: 1, pageSize: 1 })
    expect(repository.count({ taskIds: ['task-a', 'task-z', 'task-b'], keyword: 'needle', keywordTaskIds: ['task-z'] })).toBe(2)
  })

  it('prunes composite keys per task without crossing tasks', () => {
    expect(MAX_SCHEDULED_TASK_RUNS_PER_TASK).toBe(200)
    for (let index = 0; index < 205; index += 1) {
      repository.create('task-a', run(`run-${String(index).padStart(3, '0')}`, { startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString() }))
    }
    repository.create('task-b', run('run-000'))
    expect(repository.count({ taskId: 'task-a' })).toBe(200)
    expect(repository.get('task-a', 'run-004')).toBeNull()
    expect(repository.get('task-b', 'run-000')).not.toBeNull()
  })

  it('initializes schema v4 safely from multiple processes', async () => {
    await closeSqliteStorage()
    const concurrentPath = path.join(directory, 'concurrent.sqlite3')
    const summaries = await Promise.all([
      spawnInitializationWorker(concurrentPath),
      spawnInitializationWorker(concurrentPath),
      spawnInitializationWorker(concurrentPath),
    ])
    expect(summaries.every((summary) => summary.ok && summary.schemaVersion === 10 && summary.migrationCount === 10)).toBe(true)
    const raw = new DatabaseSync(concurrentPath)
    try {
      expect(raw.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count).toBe(10)
      expect(raw.prepare('PRAGMA user_version').get().user_version).toBe(10)
    } finally {
      raw.close()
    }
  }, 25_000)
})
