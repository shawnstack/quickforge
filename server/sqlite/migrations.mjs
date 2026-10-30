// SQLite schema baseline.
//
// The compat-era migration chain (v1..v18: JSON→SQLite cutover phases, mirror
// queues, *_v10_backup rollback tables) is retired. Schema changes are applied
// append-only from BASELINE_VERSION onwards: each entry runs in its own
// immediate transaction, records itself in schema_migrations and bumps
// PRAGMA user_version.
//
// A database created before the baseline carries an older user_version and is
// rejected by database.mjs with recovery guidance; there is no in-place upgrade
// path from the compat-era layout.

export const BASELINE_VERSION = 19

const BASELINE_SQL = `
CREATE TABLE dreaming_note_stats (
          note_id TEXT PRIMARY KEY CHECK (length(trim(note_id)) > 0),
          note_text TEXT NOT NULL CHECK (length(trim(note_text)) > 0),
          recall_count INTEGER NOT NULL DEFAULT 0 CHECK (recall_count >= 0),
          last_recalled_at INTEGER,
          created_at INTEGER NOT NULL CHECK (created_at >= 0),
          updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
        );

CREATE TABLE dreaming_runs (
          id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
          trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual')),
          status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
          period_from INTEGER NOT NULL CHECK (period_from >= 0),
          period_to INTEGER NOT NULL CHECK (period_to >= 0),
          session_count INTEGER NOT NULL DEFAULT 0,
          created_count INTEGER NOT NULL DEFAULT 0,
          updated_count INTEGER NOT NULL DEFAULT 0,
          retired_count INTEGER NOT NULL DEFAULT 0,
          rejected_count INTEGER NOT NULL DEFAULT 0,
          summary TEXT,
          operations_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(operations_json)),
          error TEXT,
          started_at INTEGER NOT NULL CHECK (started_at >= 0),
          finished_at INTEGER,
          duration_ms INTEGER
        , model_label TEXT, input_chars INTEGER NOT NULL DEFAULT 0, sessions_json TEXT NOT NULL DEFAULT '[]', raw_response TEXT, content_language TEXT);

CREATE TABLE lan_access_maintenance_lock (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          owner TEXT NOT NULL,
          owner_pid INTEGER,
          fencing INTEGER NOT NULL DEFAULT 1,
          operation TEXT NOT NULL,
          acquired_at TEXT NOT NULL,
          heartbeat_at TEXT,
          expires_at TEXT NOT NULL
        );

CREATE TABLE lan_access_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
          password_hash TEXT,
          password_salt TEXT,
          password_version INTEGER CHECK (password_version IS NULL OR (typeof(password_version) = 'integer' AND password_version > 0)),
          auth_version INTEGER NOT NULL CHECK (typeof(auth_version) = 'integer' AND auth_version >= 1),
          session_ttl_hours INTEGER NOT NULL CHECK (typeof(session_ttl_hours) = 'integer' AND session_ttl_hours >= 1 AND session_ttl_hours <= 168),
          updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0),
          revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision > 0),
          extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND json_type(extra_json) = 'object'),
          CHECK (
            (enabled = 0) OR (password_hash IS NOT NULL AND password_salt IS NOT NULL)
          )
        ) WITHOUT ROWID;

CREATE TABLE lan_access_tokens (
          token_id TEXT NOT NULL CHECK (length(trim(token_id)) > 0),
          seq INTEGER NOT NULL CHECK (typeof(seq) = 'integer' AND seq >= 0),
          token_hash TEXT NOT NULL CHECK (length(trim(token_hash)) > 0),
          issued_at TEXT NOT NULL CHECK (length(trim(issued_at)) > 0),
          expires_at TEXT,
          auth_version INTEGER NOT NULL CHECK (typeof(auth_version) = 'integer' AND auth_version >= 1),
          remote_address TEXT,
          user_agent TEXT,
          PRIMARY KEY (token_id)
        ) WITHOUT ROWID;

CREATE TABLE scheduled_runs_maintenance_lock (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          owner TEXT NOT NULL,
          owner_pid INTEGER,
          fencing INTEGER NOT NULL DEFAULT 1,
          operation TEXT NOT NULL,
          acquired_at TEXT NOT NULL,
          heartbeat_at TEXT,
          expires_at TEXT NOT NULL
        );

CREATE TABLE scheduled_task_runs (
          task_id TEXT NOT NULL CHECK (length(trim(task_id)) > 0),
          id TEXT NOT NULL CHECK (length(trim(id)) > 0),
          status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
          trigger TEXT CHECK (trigger IS NULL OR trigger IN ('schedule', 'manual')),
          input_content TEXT,
          ai_result TEXT,
          result TEXT,
          error_message TEXT,
          warning TEXT,
          session_id TEXT,
          scheduled_at TEXT,
          started_at TEXT NOT NULL CHECK (length(trim(started_at)) > 0),
          finished_at TEXT,
          duration_ms INTEGER CHECK (duration_ms IS NULL OR (typeof(duration_ms) = 'integer' AND duration_ms >= 0)),
          agent_id TEXT,
          agent_label TEXT,
          agent_snapshot_json TEXT CHECK (agent_snapshot_json IS NULL OR json_valid(agent_snapshot_json)),
          extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND json_type(extra_json) = 'object'),
          legacy_json TEXT CHECK (legacy_json IS NULL OR (json_valid(legacy_json) AND json_type(legacy_json) = 'object')),
          source TEXT NOT NULL CHECK (length(trim(source)) > 0),
          updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0),
          PRIMARY KEY (task_id, id)
        ) WITHOUT ROWID;

CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY CHECK (version > 0),
          name TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL
        );

CREATE TABLE session_messages (
          scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
          project_id TEXT NOT NULL,
          session_id TEXT NOT NULL CHECK (length(trim(session_id)) > 0),
          seq INTEGER NOT NULL CHECK (typeof(seq) = 'integer' AND seq >= 0),
          message_id TEXT CHECK (message_id IS NULL OR length(trim(message_id)) > 0),
          message_json TEXT NOT NULL CHECK (json_valid(message_json) AND json_type(message_json) = 'object'),
          message_digest TEXT NOT NULL CHECK (length(message_digest) = 64 AND message_digest NOT GLOB '*[^0-9a-f]*'),
          PRIMARY KEY (scope, project_id, session_id, seq),
          UNIQUE (scope, project_id, session_id, message_id),
          FOREIGN KEY (scope, project_id, session_id) REFERENCES sessions (scope, project_id, session_id) ON DELETE CASCADE,
          CHECK (
            (scope = 'global' AND project_id = '') OR
            (scope = 'project' AND length(trim(project_id)) > 0)
          )
        );

CREATE TABLE session_state_maintenance_lock (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          owner TEXT NOT NULL,
          owner_pid INTEGER,
          fencing INTEGER NOT NULL DEFAULT 1,
          operation TEXT NOT NULL,
          acquired_at TEXT NOT NULL,
          heartbeat_at TEXT,
          expires_at TEXT NOT NULL
        );

CREATE TABLE session_tombstones (
          scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
          project_id TEXT NOT NULL,
          session_id TEXT NOT NULL CHECK (length(trim(session_id)) > 0),
          deleted_at INTEGER NOT NULL CHECK (typeof(deleted_at) = 'integer' AND deleted_at >= 0),
          PRIMARY KEY (scope, project_id, session_id),
          CHECK (
            (scope = 'global' AND project_id = '') OR
            (scope = 'project' AND length(trim(project_id)) > 0)
          )
        ) WITHOUT ROWID;

CREATE TABLE sessions (
          scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
          project_id TEXT NOT NULL,
          session_id TEXT NOT NULL CHECK (length(trim(session_id)) > 0),
          title TEXT NOT NULL DEFAULT '',
          title_source TEXT,
          created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
          updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0),
          message_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(message_count) = 'integer' AND message_count >= 0),
          state_version INTEGER NOT NULL DEFAULT 0 CHECK (typeof(state_version) = 'integer' AND state_version >= 0),
          task_status TEXT,
          archived_at TEXT,
          pinned_at TEXT,
          body_json TEXT NOT NULL CHECK (json_valid(body_json) AND json_type(body_json) = 'object'),
          meta_json TEXT NOT NULL CHECK (json_valid(meta_json) AND json_type(meta_json) = 'object'),
          revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision > 0),
          updated_at_ms INTEGER NOT NULL CHECK (typeof(updated_at_ms) = 'integer' AND updated_at_ms >= 0),
          PRIMARY KEY (scope, project_id, session_id),
          CHECK (
            (scope = 'global' AND project_id = '') OR
            (scope = 'project' AND length(trim(project_id)) > 0)
          )
        );

CREATE TABLE share_maintenance_lock (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          owner TEXT NOT NULL,
          owner_pid INTEGER,
          fencing INTEGER NOT NULL DEFAULT 1,
          operation TEXT NOT NULL,
          acquired_at TEXT NOT NULL,
          heartbeat_at TEXT,
          expires_at TEXT NOT NULL
        );

CREATE TABLE share_sessions (
          share_id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(share_id)) > 0),
          session_id TEXT NOT NULL CHECK (length(trim(session_id)) > 0),
          permission TEXT NOT NULL CHECK (permission IN ('read', 'operate')),
          title_snapshot TEXT,
          scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
          project_id TEXT CHECK (project_id IS NULL OR project_id = '' OR length(trim(project_id)) > 0),
          password_hash TEXT,
          password_salt TEXT,
          password_version INTEGER CHECK (password_version IS NULL OR (typeof(password_version) = 'integer' AND password_version > 0)),
          auth_version INTEGER NOT NULL CHECK (typeof(auth_version) = 'integer' AND auth_version >= 0),
          allow_cloud_usage INTEGER NOT NULL CHECK (allow_cloud_usage IN (0, 1)),
          created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
          updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0),
          expires_at TEXT,
          revoked_at TEXT,
          superseded_at TEXT,
          access_count INTEGER NOT NULL CHECK (typeof(access_count) = 'integer' AND access_count >= 0),
          last_accessed_at TEXT,
          created_from_host TEXT,
          last_updated_from_host TEXT,
          revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision > 0),
          deleted_at TEXT,
          extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND json_type(extra_json) = 'object'),
          CHECK (
            (scope = 'global' AND (project_id IS NULL OR project_id = '')) OR
            (scope = 'project' AND length(trim(project_id)) > 0)
          )
        ) WITHOUT ROWID;

CREATE TABLE share_tokens (
          share_id TEXT NOT NULL CHECK (length(trim(share_id)) > 0),
          token_hash TEXT NOT NULL CHECK (length(trim(token_hash)) > 0),
          issued_at TEXT NOT NULL CHECK (length(trim(issued_at)) > 0),
          expires_at TEXT,
          auth_version INTEGER NOT NULL CHECK (typeof(auth_version) = 'integer' AND auth_version >= 0),
          PRIMARY KEY (share_id, token_hash),
          FOREIGN KEY (share_id) REFERENCES share_sessions (share_id) ON DELETE CASCADE
        ) WITHOUT ROWID;

CREATE INDEX idx_dreaming_note_stats_recall
          ON dreaming_note_stats (recall_count, last_recalled_at);

CREATE INDEX idx_dreaming_runs_started ON dreaming_runs (started_at DESC);

CREATE INDEX idx_session_messages_session_id ON session_messages (session_id);

CREATE INDEX idx_sessions_list ON sessions (scope, project_id, archived_at, updated_at DESC);

CREATE INDEX idx_sessions_pinned ON sessions (scope, project_id, updated_at DESC) WHERE pinned_at IS NOT NULL;

CREATE INDEX idx_sessions_session_id ON sessions (session_id);

CREATE INDEX lan_access_tokens_issued_idx ON lan_access_tokens (issued_at DESC, token_id DESC);

CREATE INDEX lan_access_tokens_seq_idx ON lan_access_tokens (seq DESC, token_id DESC);

CREATE INDEX scheduled_task_runs_started_idx
          ON scheduled_task_runs (started_at DESC, id DESC, task_id DESC);

CREATE INDEX scheduled_task_runs_status_started_idx
          ON scheduled_task_runs (status, started_at DESC, id DESC, task_id DESC);

CREATE INDEX scheduled_task_runs_task_started_idx
          ON scheduled_task_runs (task_id, started_at DESC, id DESC);

CREATE INDEX scheduled_task_runs_trigger_started_idx
          ON scheduled_task_runs (trigger, started_at DESC, id DESC, task_id DESC);

CREATE INDEX share_sessions_session_id_idx ON share_sessions (session_id);
`

export const SQLITE_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: BASELINE_VERSION,
    name: 'baseline',
    up(database) {
      database.exec(BASELINE_SQL)
    },
  }),
])

function readUserVersion(database) {
  return Number(database.prepare('PRAGMA user_version').get().user_version)
}

function hasMigrationTable(database) {
  return Boolean(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'").get())
}

function validateMigrationList(migrations) {
  if (!Array.isArray(migrations) || migrations.length === 0) {
    throw new Error('SQLite migration list must contain at least one migration')
  }

  const firstVersion = migrations[0]?.version
  if (!Number.isInteger(firstVersion) || firstVersion < 1) {
    throw new Error('SQLite migration list must start at a positive integer version')
  }

  const names = new Set()
  for (let index = 0; index < migrations.length; index += 1) {
    const migration = migrations[index]
    const expectedVersion = firstVersion + index
    if (!migration || migration.version !== expectedVersion || typeof migration.name !== 'string' || !migration.name || typeof migration.up !== 'function') {
      throw new Error(`SQLite migrations must be continuous and append-only; expected version ${expectedVersion}`)
    }
    if (names.has(migration.name)) throw new Error(`SQLite migration name must be unique: ${migration.name}`)
    names.add(migration.name)
  }
}

function readAppliedMigrations(database, tableExists) {
  if (!tableExists) return []
  try {
    return database.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version').all()
  } catch (error) {
    throw new Error(`SQLite migration metadata is inconsistent: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

export function inspectSqliteMigrationState(database, { migrations = SQLITE_MIGRATIONS } = {}) {
  validateMigrationList(migrations)
  const baseVersion = migrations[0].version
  const latestVersion = migrations[migrations.length - 1].version
  const userVersion = readUserVersion(database)
  const tableExists = hasMigrationTable(database)
  const applied = readAppliedMigrations(database, tableExists)

  if (userVersion > latestVersion) {
    throw new Error(`SQLite schema version ${userVersion} is newer than supported version ${latestVersion}`)
  }
  // Pre-baseline layouts (the retired v1..v18 chain) are not readable: this
  // build has no upgrade path from them and refuses to touch the database
  // rather than half-migrating user data.
  if (userVersion > 0 && userVersion < baseVersion) {
    throw new Error(`SQLite schema version ${userVersion} predates the supported baseline (${baseVersion}); this build cannot read the legacy layout. Back up the data directory, then restore from an export or start with an empty database.`)
  }
  if (userVersion === 0 && tableExists) {
    throw new Error('SQLite migration metadata is inconsistent: schema_migrations exists while user_version is 0')
  }
  if (userVersion > 0 && !tableExists) {
    throw new Error(`SQLite migration metadata is inconsistent: user_version is ${userVersion} but schema_migrations is missing`)
  }
  if (applied.length !== userVersion - baseVersion + 1 && userVersion > 0) {
    throw new Error(`SQLite migration metadata is inconsistent: user_version is ${userVersion} but ${applied.length} migration rows exist`)
  }

  for (let index = 0; index < applied.length; index += 1) {
    const expected = migrations[index]
    const actual = applied[index]
    if (Number(actual.version) !== expected.version || actual.name !== expected.name) {
      throw new Error(`SQLite migration metadata is inconsistent at version ${expected.version}`)
    }
  }

  return {
    userVersion,
    latestVersion,
    tableExists,
    applied,
    consistent: true,
  }
}

export function applySqliteMigrations(database, { migrations = SQLITE_MIGRATIONS, now = () => new Date().toISOString() } = {}) {
  validateMigrationList(migrations)
  let transactionOpen = false
  let currentMigration = null

  try {
    database.exec('BEGIN IMMEDIATE')
    transactionOpen = true

    const before = inspectSqliteMigrationState(database, { migrations })
    for (const migration of migrations.slice(before.applied.length)) {
      currentMigration = migration
      try {
        migration.up(database)
        database.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
          .run(migration.version, migration.name, now())
        database.exec(`PRAGMA user_version = ${migration.version}`)
      } catch (error) {
        throw new Error(`SQLite migration ${migration.version} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
      }
    }

    const after = inspectSqliteMigrationState(database, { migrations })
    database.exec('COMMIT')
    transactionOpen = false
    return after
  } catch (error) {
    let rollbackError = null
    if (transactionOpen) {
      try {
        database.exec('ROLLBACK')
      } catch (rollbackFailure) {
        rollbackError = rollbackFailure
      }
    }
    if (rollbackError) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`, { cause: error })
    }
    if (currentMigration || error instanceof Error) throw error
    throw new Error(`SQLite migration failed: ${String(error)}`, { cause: error })
  }
}
