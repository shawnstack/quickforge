export const SQLITE_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    name: 'create_schema_migrations',
    up(database) {
      database.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY CHECK (version > 0),
          name TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL
        )
      `)
    },
  }),
  Object.freeze({
    version: 2,
    name: 'create_scheduled_task_runs',
    up(database) {
      database.exec(`
        CREATE TABLE scheduled_task_runs (
          id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
          task_id TEXT NOT NULL CHECK (length(trim(task_id)) > 0),
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
          agent_snapshot_json TEXT CHECK (agent_snapshot_json IS NULL OR json_valid(agent_snapshot_json))
        );

        CREATE INDEX scheduled_task_runs_task_started_idx
          ON scheduled_task_runs (task_id, started_at DESC, id DESC);
        CREATE INDEX scheduled_task_runs_started_idx
          ON scheduled_task_runs (started_at DESC, id DESC);
        CREATE INDEX scheduled_task_runs_status_started_idx
          ON scheduled_task_runs (status, started_at DESC, id DESC);
        CREATE INDEX scheduled_task_runs_trigger_started_idx
          ON scheduled_task_runs (trigger, started_at DESC, id DESC);
      `)
    },
  }),
  Object.freeze({
    version: 3,
    name: 'scheduled_task_runs_authoritative_cutover',
    up(database) {
      database.exec(`
        ALTER TABLE scheduled_task_runs RENAME TO scheduled_task_runs_v2;

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

        INSERT INTO scheduled_task_runs (
          task_id, id, status, trigger, input_content, ai_result, result, error_message,
          warning, session_id, scheduled_at, started_at, finished_at, duration_ms,
          agent_id, agent_label, agent_snapshot_json, extra_json, legacy_json, source, updated_at
        )
        SELECT
          task_id, id, status, trigger, input_content, ai_result, result, error_message,
          warning, session_id, scheduled_at, started_at, finished_at, duration_ms,
          agent_id, agent_label, agent_snapshot_json, '{}', NULL, 'v2_shadow',
          COALESCE(finished_at, started_at)
        FROM scheduled_task_runs_v2;

        DROP TABLE scheduled_task_runs_v2;

        CREATE INDEX scheduled_task_runs_task_started_idx
          ON scheduled_task_runs (task_id, started_at DESC, id DESC);
        CREATE INDEX scheduled_task_runs_started_idx
          ON scheduled_task_runs (started_at DESC, id DESC, task_id DESC);
        CREATE INDEX scheduled_task_runs_status_started_idx
          ON scheduled_task_runs (status, started_at DESC, id DESC, task_id DESC);
        CREATE INDEX scheduled_task_runs_trigger_started_idx
          ON scheduled_task_runs (trigger, started_at DESC, id DESC, task_id DESC);

        CREATE TABLE scheduled_runs_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          phase TEXT NOT NULL CHECK (phase IN ('hybrid', 'cutover_running', 'sqlite_authoritative_json_pending', 'authoritative')),
          run_count INTEGER CHECK (run_count IS NULL OR run_count >= 0),
          digest TEXT,
          backup_file TEXT,
          diagnostic_json TEXT CHECK (diagnostic_json IS NULL OR json_valid(diagnostic_json)),
          updated_at TEXT NOT NULL
        );
        INSERT INTO scheduled_runs_state (singleton, phase, updated_at)
          VALUES (1, 'hybrid', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

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
      `)
    },
  }),
  Object.freeze({
    version: 4,
    name: 'create_session_index',
    up(database) {
      database.exec(`
        CREATE TABLE session_index (
          scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
          project_id TEXT NOT NULL,
          session_id TEXT NOT NULL CHECK (length(trim(session_id)) > 0),
          created_at TEXT,
          last_modified TEXT,
          message_count INTEGER CHECK (message_count IS NULL OR (typeof(message_count) = 'integer' AND message_count >= 0)),
          pinned_at TEXT,
          archived_at TEXT,
          is_pinned INTEGER NOT NULL CHECK (is_pinned IN (0, 1)),
          is_archived INTEGER NOT NULL CHECK (is_archived IN (0, 1)),
          state_version INTEGER CHECK (state_version IS NULL OR (typeof(state_version) = 'integer' AND state_version >= 0)),
          metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
          metadata_digest TEXT NOT NULL CHECK (length(metadata_digest) = 64 AND metadata_digest NOT GLOB '*[^0-9a-f]*'),
          indexed_at TEXT NOT NULL CHECK (length(trim(indexed_at)) > 0),
          PRIMARY KEY (scope, project_id, session_id),
          CHECK (
            (scope = 'global' AND project_id = '') OR
            (scope = 'project' AND length(trim(project_id)) > 0)
          )
        ) WITHOUT ROWID;

        CREATE INDEX session_index_created_idx
          ON session_index (scope, project_id, created_at DESC, session_id DESC);
        CREATE INDEX session_index_modified_idx
          ON session_index (scope, project_id, last_modified DESC, session_id DESC);
        CREATE INDEX session_index_pinned_idx
          ON session_index (scope, project_id, pinned_at DESC, session_id DESC)
          WHERE is_pinned = 1;
        CREATE INDEX session_index_archived_idx
          ON session_index (scope, project_id, archived_at DESC, session_id DESC)
          WHERE is_archived = 1;
      `)
    },
  }),
  Object.freeze({
    version: 5,
    name: 'add_session_index_query_indexes',
    up(database) {
      database.exec(`
        CREATE INDEX session_index_scope_created_query_idx
          ON session_index (scope, project_id, is_archived, is_pinned DESC, pinned_at DESC, created_at DESC);
        CREATE INDEX session_index_scope_modified_query_idx
          ON session_index (scope, project_id, is_archived, is_pinned DESC, pinned_at DESC, last_modified DESC);
        CREATE INDEX session_index_projects_created_query_idx
          ON session_index (scope, is_archived, is_pinned DESC, pinned_at DESC, created_at DESC);
        CREATE INDEX session_index_projects_modified_query_idx
          ON session_index (scope, is_archived, is_pinned DESC, pinned_at DESC, last_modified DESC);
        CREATE INDEX session_index_aggregate_modified_query_idx
          ON session_index (is_archived, is_pinned DESC, pinned_at DESC, last_modified DESC);
      `)
    },
  }),
  Object.freeze({
    version: 6,
    name: 'session_state_transactional_storage',
    up(database) {
      database.exec(`
        CREATE TABLE session_states (
          scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
          project_id TEXT NOT NULL,
          session_id TEXT NOT NULL CHECK (length(trim(session_id)) > 0),
          revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision > 0),
          state_version INTEGER NOT NULL CHECK (typeof(state_version) = 'integer' AND state_version >= 0),
          state_json TEXT NOT NULL CHECK (json_valid(state_json) AND json_type(state_json) = 'object'),
          state_digest TEXT NOT NULL CHECK (length(state_digest) = 64 AND state_digest NOT GLOB '*[^0-9a-f]*'),
          metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
          metadata_digest TEXT NOT NULL CHECK (length(metadata_digest) = 64 AND metadata_digest NOT GLOB '*[^0-9a-f]*'),
          created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
          updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0),
          PRIMARY KEY (scope, project_id, session_id),
          CHECK (
            (scope = 'global' AND project_id = '') OR
            (scope = 'project' AND length(trim(project_id)) > 0)
          )
        ) WITHOUT ROWID;

        CREATE INDEX session_states_session_id_idx ON session_states (session_id);

        CREATE TABLE session_state_tombstones (
          scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
          project_id TEXT NOT NULL,
          session_id TEXT NOT NULL CHECK (length(trim(session_id)) > 0),
          revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision > 0),
          deleted_at TEXT NOT NULL CHECK (length(trim(deleted_at)) > 0),
          PRIMARY KEY (scope, project_id, session_id),
          CHECK (
            (scope = 'global' AND project_id = '') OR
            (scope = 'project' AND length(trim(project_id)) > 0)
          )
        ) WITHOUT ROWID;
        CREATE INDEX session_state_tombstones_session_id_idx ON session_state_tombstones (session_id);

        CREATE TABLE session_storage_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          phase TEXT NOT NULL CHECK (phase IN ('json_authoritative', 'cutover_running', 'sqlite_authoritative_json_pending', 'authoritative')),
          state_count INTEGER CHECK (state_count IS NULL OR state_count >= 0),
          digest TEXT,
          backup_file TEXT,
          diagnostic_json TEXT CHECK (diagnostic_json IS NULL OR json_valid(diagnostic_json)),
          updated_at TEXT NOT NULL
        );
        INSERT INTO session_storage_state (singleton, phase, updated_at)
          VALUES (1, 'json_authoritative', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

        CREATE TABLE session_json_mirror_queue (
          scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
          project_id TEXT NOT NULL,
          session_id TEXT NOT NULL CHECK (length(trim(session_id)) > 0),
          operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
          revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision >= 0),
          state_json TEXT CHECK (state_json IS NULL OR (json_valid(state_json) AND json_type(state_json) = 'object')),
          metadata_json TEXT CHECK (metadata_json IS NULL OR (json_valid(metadata_json) AND json_type(metadata_json) = 'object')),
          attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
          last_error TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (scope, project_id, session_id),
          CHECK (
            (scope = 'global' AND project_id = '') OR
            (scope = 'project' AND length(trim(project_id)) > 0)
          ),
          CHECK (
            (operation = 'upsert' AND state_json IS NOT NULL AND metadata_json IS NOT NULL) OR
            (operation = 'delete' AND state_json IS NULL AND metadata_json IS NULL)
          )
        ) WITHOUT ROWID;

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
      `)
    },
  }),
  Object.freeze({
    version: 7,
    name: 'session_messages_incremental_storage',
    up(database) {
      database.exec(`
        CREATE TABLE session_messages (
          scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
          project_id TEXT NOT NULL,
          session_id TEXT NOT NULL CHECK (length(trim(session_id)) > 0),
          seq INTEGER NOT NULL CHECK (typeof(seq) = 'integer' AND seq >= 0),
          message_id TEXT CHECK (message_id IS NULL OR length(trim(message_id)) > 0),
          message_json TEXT NOT NULL CHECK (json_valid(message_json) AND json_type(message_json) = 'object'),
          message_digest TEXT NOT NULL CHECK (length(message_digest) = 64 AND message_digest NOT GLOB '*[^0-9a-f]*'),
          created TEXT NOT NULL CHECK (length(trim(created)) > 0),
          updated TEXT NOT NULL CHECK (length(trim(updated)) > 0),
          PRIMARY KEY (scope, project_id, session_id, seq),
          UNIQUE (scope, project_id, session_id, message_id),
          CHECK (
            (scope = 'global' AND project_id = '') OR
            (scope = 'project' AND length(trim(project_id)) > 0)
          )
        ) WITHOUT ROWID;

        CREATE INDEX session_messages_session_id_idx ON session_messages (session_id);
      `)
    },
  }),
  Object.freeze({
    version: 8,
    name: 'share_storage_migration',
    up(database) {
      database.exec(`
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
          record_digest TEXT NOT NULL CHECK (length(record_digest) = 64 AND record_digest NOT GLOB '*[^0-9a-f]*'),
          deleted_at TEXT,
          extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND json_type(extra_json) = 'object'),
          CHECK (
            (scope = 'global' AND (project_id IS NULL OR project_id = '')) OR
            (scope = 'project' AND length(trim(project_id)) > 0)
          )
        ) WITHOUT ROWID;

        CREATE INDEX share_sessions_session_id_idx ON share_sessions (session_id);

        CREATE TABLE share_tokens (
          share_id TEXT NOT NULL CHECK (length(trim(share_id)) > 0),
          token_hash TEXT NOT NULL CHECK (length(trim(token_hash)) > 0),
          issued_at TEXT NOT NULL CHECK (length(trim(issued_at)) > 0),
          expires_at TEXT,
          auth_version INTEGER NOT NULL CHECK (typeof(auth_version) = 'integer' AND auth_version >= 0),
          PRIMARY KEY (share_id, token_hash),
          FOREIGN KEY (share_id) REFERENCES share_sessions (share_id) ON DELETE CASCADE
        ) WITHOUT ROWID;

        CREATE TABLE share_storage_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          phase TEXT NOT NULL CHECK (phase IN ('json_authoritative', 'cutover_running', 'sqlite_authoritative_json_pending', 'authoritative')),
          share_count INTEGER CHECK (share_count IS NULL OR share_count >= 0),
          digest TEXT,
          backup_file TEXT,
          diagnostic_json TEXT CHECK (diagnostic_json IS NULL OR json_valid(diagnostic_json)),
          updated_at TEXT NOT NULL
        );
        INSERT INTO share_storage_state (singleton, phase, updated_at)
          VALUES (1, 'json_authoritative', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

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

        CREATE TABLE share_json_mirror_queue (
          share_id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(share_id)) > 0),
          operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
          share_json TEXT CHECK (share_json IS NULL OR (json_valid(share_json) AND json_type(share_json) = 'object')),
          attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
          last_error TEXT,
          updated_at TEXT NOT NULL,
          CHECK (
            (operation = 'upsert' AND share_json IS NOT NULL) OR
            (operation = 'delete' AND share_json IS NULL)
          )
        ) WITHOUT ROWID;
      `)
    },
  }),
  Object.freeze({
    version: 9,
    name: 'lan_access_storage_migration',
    up(database) {
      database.exec(`
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
          record_digest TEXT NOT NULL CHECK (length(record_digest) = 64 AND record_digest NOT GLOB '*[^0-9a-f]*'),
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
        CREATE INDEX lan_access_tokens_issued_idx ON lan_access_tokens (issued_at DESC, token_id DESC);
        CREATE INDEX lan_access_tokens_seq_idx ON lan_access_tokens (seq DESC, token_id DESC);

        CREATE TABLE lan_access_storage_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          phase TEXT NOT NULL CHECK (phase IN ('json_authoritative', 'cutover_running', 'sqlite_authoritative_json_pending', 'authoritative')),
          lan_token_count INTEGER CHECK (lan_token_count IS NULL OR lan_token_count >= 0),
          digest TEXT,
          backup_file TEXT,
          diagnostic_json TEXT CHECK (diagnostic_json IS NULL OR json_valid(diagnostic_json)),
          updated_at TEXT NOT NULL
        );
        INSERT INTO lan_access_storage_state (singleton, phase, updated_at)
          VALUES (1, 'json_authoritative', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

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

        CREATE TABLE lan_access_json_mirror_queue (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
          config_json TEXT CHECK (config_json IS NULL OR (json_valid(config_json) AND json_type(config_json) = 'object')),
          attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
          last_error TEXT,
          updated_at TEXT NOT NULL,
          CHECK (
            (operation = 'upsert' AND config_json IS NOT NULL) OR
            (operation = 'delete' AND config_json IS NULL)
          )
        ) WITHOUT ROWID;
      `)
    },
  }),
  Object.freeze({
    // Root cause: session_states is WITHOUT ROWID, so the PK b-tree IS the
    // table and stores the multi-MB state_json payload inline. metadata_json /
    // metadata_digest sit AFTER state_json in the record, so every metadata
    // read must walk the preceding state_json overflow-page chain — an
    // implicit full-database read (2.93GB cold DB: ~45s for a metadata-only
    // projection). This covering index carries the metadata columns next to
    // the PK prefix, making metadata reads index-only (KB-sized entries); the
    // planner picks it up automatically with zero query changes.
    // Note: CREATE INDEX scans the table once — on first upgrade of a large
    // existing database this migration is a one-time cost paid inside
    // initializeSqliteStorage, before the server starts listening.
    version: 10,
    name: 'session_states_metadata_covering_index',
    up(database) {
      database.exec(`
        CREATE INDEX session_states_metadata_cover_idx
          ON session_states (scope, project_id, session_id, metadata_json, metadata_digest);
      `)
    },
  }),
  Object.freeze({
    // v11 session-domain rebuild (session storage v2): one small `sessions`
    // row per session (no giant state_json column — the multi-GB bloat root
    // cause), messages always stored row-per-message in `session_messages`
    // (append-only, no inline/split dual mode), deletes tombstone into
    // `session_tombstones` and space is reclaimed through incremental_vacuum
    // (auto_vacuum=INCREMENTAL, set in database.mjs). The JSON mirror outbox
    // chain, the session_index derived table and the session_storage_state
    // phase machine are retired with this schema. Old session-domain tables
    // are RENAMED (not dropped) as a rollback safety net; the maintenance
    // lock and the share/lan-access/scheduled-runs domains are untouched.
    // A fresh database runs v1..v11 sequentially, so every renamed table
    // necessarily exists by the time v11 executes. Renamed tables keep their
    // old index names (index names are schema-global), so the new tables use
    // the idx_* naming convention to avoid collisions.
    version: 11,
    name: 'session_state_v2_storage',
    up(database) {
      database.exec(`
        ALTER TABLE session_states RENAME TO session_states_v10_backup;
        ALTER TABLE session_messages RENAME TO session_messages_v10_backup;
        ALTER TABLE session_index RENAME TO session_index_v10_backup;
        ALTER TABLE session_state_tombstones RENAME TO session_state_tombstones_v10_backup;
        ALTER TABLE session_json_mirror_queue RENAME TO session_json_mirror_queue_v10_backup;
        ALTER TABLE session_storage_state RENAME TO session_storage_state_v10_backup;

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

        CREATE INDEX idx_sessions_list ON sessions (scope, project_id, archived_at, updated_at DESC);
        CREATE INDEX idx_sessions_pinned ON sessions (scope, project_id, updated_at DESC) WHERE pinned_at IS NOT NULL;
        CREATE INDEX idx_sessions_session_id ON sessions (session_id);

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

        CREATE INDEX idx_session_messages_session_id ON session_messages (session_id);

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
      `)
    },
  }),
  Object.freeze({
    // Share/LAN record digests were online-derived compatibility columns. Their
    // authoritative integrity remains snapshot-based, so remove the redundant
    // per-row columns without rewriting the original v8/v9 migrations.
    version: 12,
    name: 'remove_share_lan_record_digests',
    up(database) {
      database.exec(`
        ALTER TABLE share_sessions DROP COLUMN record_digest;
        ALTER TABLE lan_access_state DROP COLUMN record_digest;
      `)
    },
  }),
  Object.freeze({
    // Dreaming long-term memory (see docs/architecture/dreaming-memory.zh-CN.md).
    // `memories` is the structured experience store written only by the
    // background Dreaming worker; `memories_fts` is a plain (non-external)
    // FTS5 index keyed by the memories implicit rowid, because the default
    // unicode61 tokenizer cannot match CJK substrings and trigram can (verified
    // against the bundled SQLite). `dreaming_runs` is the run log the settings
    // page renders; `memory_events` is the per-entry audit trail.
    version: 13,
    name: 'create_dreaming_memory',
    up(database) {
      database.exec(`
        CREATE TABLE memories (
          id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
          scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
          project_id TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL CHECK (kind IN ('fact', 'preference', 'experience', 'pitfall', 'decision')),
          content TEXT NOT NULL CHECK (length(trim(content)) > 0),
          fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
          evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'array'),
          confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
          strength REAL NOT NULL CHECK (strength >= 0),
          status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'retired')),
          superseded_by TEXT,
          source_run_id TEXT,
          created_at INTEGER NOT NULL CHECK (created_at >= 0),
          updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
          last_recalled_at INTEGER,
          recall_count INTEGER NOT NULL DEFAULT 0 CHECK (recall_count >= 0),
          CHECK (
            (scope = 'global' AND project_id = '') OR
            (scope = 'project' AND length(trim(project_id)) > 0)
          )
        );

        CREATE UNIQUE INDEX idx_memories_fingerprint ON memories (scope, project_id, fingerprint);
        CREATE INDEX idx_memories_lookup ON memories (scope, project_id, status, strength DESC);

        CREATE VIRTUAL TABLE memories_fts USING fts5 (content, tokenize = 'trigram');

        CREATE TABLE memory_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id TEXT NOT NULL,
          action TEXT NOT NULL CHECK (action IN ('create', 'update', 'supersede', 'retire', 'reject')),
          before_json TEXT,
          after_json TEXT,
          run_id TEXT,
          ts INTEGER NOT NULL CHECK (ts >= 0)
        );

        CREATE INDEX idx_memory_events_memory ON memory_events (memory_id, ts DESC);

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
        );

        CREATE INDEX idx_dreaming_runs_started ON dreaming_runs (started_at DESC);
      `)
    },
  }),
  Object.freeze({
    // Dreaming run detail: the run page has to answer "what did it read, and
    // what exactly did the model propose", which the counters alone cannot.
    // `sessions_json` stores one bounded preview block per session (the same
    // text that was sent to the model, capped) so the page never has to
    // reconstruct a transcript whose window may already be out of retention.
    version: 14,
    name: 'dreaming_run_details',
    up(database) {
      database.exec(`
        ALTER TABLE dreaming_runs ADD COLUMN model_label TEXT;
        ALTER TABLE dreaming_runs ADD COLUMN input_chars INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE dreaming_runs ADD COLUMN sessions_json TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE dreaming_runs ADD COLUMN raw_response TEXT;
      `)
    },
  }),
  Object.freeze({
    // Detected output language of a run. Shown on the run page so a user writing
    // Chinese can see at a glance whether the worker was told to answer in
    // Chinese, instead of guessing why memories came back in English.
    version: 15,
    name: 'dreaming_run_content_language',
    up(database) {
      database.exec(`
        ALTER TABLE dreaming_runs ADD COLUMN content_language TEXT;
      `)
    },
  }),
  Object.freeze({
    // Semantic recall for the experience store. Vectors are produced by whatever
    // OpenAI-compatible /embeddings endpoint the user points at (Ollama, LM Studio,
    // llama.cpp, vLLM) and kept as raw Float32 blobs instead of a vector index:
    // the table holds a few thousand rows at most, so scoring every candidate in
    // Node is cheaper than shipping and verifying a SQLite extension.
    //
    // `model` is part of the row rather than a column on `memories` so switching
    // the embedding model invalidates vectors by mismatch instead of requiring a
    // migration, and `content_hash` reuses the memory fingerprint so an edited
    // memory is re-embedded instead of silently keeping a stale vector.
    version: 16,
    name: 'create_memory_embeddings',
    up(database) {
      database.exec(`
        CREATE TABLE memory_embeddings (
          memory_id TEXT PRIMARY KEY REFERENCES memories (id) ON DELETE CASCADE,
          model TEXT NOT NULL CHECK (length(trim(model)) > 0),
          dim INTEGER NOT NULL CHECK (dim > 0),
          content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
          vector BLOB NOT NULL CHECK (length(vector) = dim * 4),
          updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
        );

        CREATE INDEX idx_memory_embeddings_model ON memory_embeddings (model);
      `)
    },
  }),
  Object.freeze({
    // The structured experience store (rows + FTS index + per-entry audit +
    // vectors) was replaced by a single LLM-owned notes block in MEMORY.md.
    // Dropping the tables is the point: with no second store there is no
    // dedupe/decay/retrieval pipeline to keep consistent with the notes file.
    // Existing rows are intentionally discarded rather than migrated - the next
    // run rebuilds the notes from the same session history.
    version: 17,
    name: 'drop_structured_memory_store',
    up(database) {
      database.exec(`
        DROP TABLE IF EXISTS memory_embeddings;
        DROP TABLE IF EXISTS memory_events;
        DROP TABLE IF EXISTS memories_fts;
        DROP TABLE IF EXISTS memories;
      `)
    },
  }),
  Object.freeze({
    // Feedback loop for the notes file. The notes themselves stay a plain file
    // owned by the model; this table only remembers "was this note ever actually
    // recalled?", which is the one piece of evidence a file cannot carry.
    //
    // Keyed by the derived note id (hash of the text) instead of a row id, so the
    // note has no identity to keep in sync: rewrite the wording and it is a new
    // note with a fresh record.
    version: 18,
    name: 'create_dreaming_note_stats',
    up(database) {
      database.exec(`
        CREATE TABLE dreaming_note_stats (
          note_id TEXT PRIMARY KEY CHECK (length(trim(note_id)) > 0),
          note_text TEXT NOT NULL CHECK (length(trim(note_text)) > 0),
          recall_count INTEGER NOT NULL DEFAULT 0 CHECK (recall_count >= 0),
          last_recalled_at INTEGER,
          created_at INTEGER NOT NULL CHECK (created_at >= 0),
          updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
        );

        CREATE INDEX idx_dreaming_note_stats_recall
          ON dreaming_note_stats (recall_count, last_recalled_at);
      `)
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

  const names = new Set()
  for (let index = 0; index < migrations.length; index += 1) {
    const migration = migrations[index]
    const expectedVersion = index + 1
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
  const latestVersion = migrations.length
  const userVersion = readUserVersion(database)
  const tableExists = hasMigrationTable(database)
  const applied = readAppliedMigrations(database, tableExists)

  if (userVersion > latestVersion) {
    throw new Error(`SQLite schema version ${userVersion} is newer than supported version ${latestVersion}`)
  }
  if (userVersion === 0 && tableExists) {
    throw new Error('SQLite migration metadata is inconsistent: schema_migrations exists while user_version is 0')
  }
  if (userVersion > 0 && !tableExists) {
    throw new Error(`SQLite migration metadata is inconsistent: user_version is ${userVersion} but schema_migrations is missing`)
  }
  if (applied.length !== userVersion) {
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
    for (const migration of migrations.slice(before.userVersion)) {
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
