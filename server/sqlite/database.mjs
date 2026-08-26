import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { logger } from '../utils/logger.mjs'
import { applySqliteMigrations, inspectSqliteMigrationState, SQLITE_MIGRATIONS } from './migrations.mjs'

export const SQLITE_BUSY_TIMEOUT_MS = 5_000
export const SQLITE_JOURNAL_MODE = 'wal'
// 1 = NORMAL（2026-08-26 用户决策切回，历史与权衡见
// docs/architecture/sqlite-storage-foundation.zh-CN.md §3.1 修订记录）。
export const SQLITE_SYNCHRONOUS = 1
const SQLITE_SYNCHRONOUS_NAMES = { 0: 'off', 1: 'normal', 2: 'full', 3: 'extra' }

// Startup quick_check tax optimization. All four storage domains share one
// quickforge.sqlite3 file, and `PRAGMA quick_check` scans the whole file, so
// four per-domain startup checks used to pay the full-scan cost four times
// (~30s on a 3GB production library). One gated scan per database per process
// (sharedQuickCheckCache) plus a cross-restart marker file reduce it to at
// most one real scan per database per 7 days.
//
// Safety argument: WAL frame checksums make every committed transaction
// atomic under any crash mode — recovery either replays or rolls back whole
// transactions and the database file never tears, including with
// synchronous=NORMAL. NORMAL gives up only the per-COMMIT fsync: after an OS
// crash / power loss, commits since the last WAL checkpoint may roll back
// (bounded by the checkpoint interval); an application crash loses nothing.
// quick_check therefore only guards against bit-rot / filesystem-level
// corruption, which evolves on disk timescales, not per startup; the 7-day
// cadence plus the manual force entry points (maintenance
// verify-session-integrity endpoint, QUICKFORGE_SQLITE_QUICK_CHECK=force)
// keep the blind window bounded. When quick_check is skipped, all other
// SQL-level count/join checks still run.
export const SQLITE_QUICK_CHECK_MARKER_FILENAME = 'quickforge-quick-check.marker.json'
export const SQLITE_QUICK_CHECK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const sqliteLogger = logger.child({ component: 'sqlite' })
const TRANSACTION_MODES = new Set(['deferred', 'immediate', 'exclusive'])
const sharedQuickCheckCache = new Map()
let initializationPromise = null
let openState = null
let savepointCounter = 0

function defaultDataDir() {
  return process.env.QUICKFORGE_DATA_DIR
    ? path.resolve(process.env.QUICKFORGE_DATA_DIR)
    : path.join(os.homedir(), '.quickforge')
}

export function resolveSqliteDatabasePath({ dataDir, databasePath } = {}) {
  if (databasePath) return path.resolve(databasePath)
  return path.join(path.resolve(dataDir || defaultDataDir()), 'storage', 'quickforge.sqlite3')
}

function normalizeMode(mode = 'immediate') {
  const normalized = String(mode).toLowerCase()
  if (!TRANSACTION_MODES.has(normalized)) {
    throw new Error(`Unsupported SQLite transaction mode: ${mode}`)
  }
  return normalized
}

function assertSynchronousResult(result) {
  if (result && (typeof result === 'object' || typeof result === 'function') && typeof result.then === 'function') {
    void Promise.resolve(result).catch(() => {})
    throw new Error('SQLite transaction callback must be synchronous; async/thenable results are not supported')
  }
}

function pragmaValue(database, name, field = name) {
  return database.prepare(`PRAGMA ${name}`).get()[field]
}

function readPragmas(database) {
  return {
    busyTimeout: Number(pragmaValue(database, 'busy_timeout', 'timeout')),
    foreignKeys: Number(pragmaValue(database, 'foreign_keys', 'foreign_keys')) === 1,
    journalMode: String(pragmaValue(database, 'journal_mode', 'journal_mode')).toLowerCase(),
    synchronous: Number(pragmaValue(database, 'synchronous', 'synchronous')),
  }
}

function verifyPragmas(database) {
  const summary = readPragmas(database)
  if (summary.busyTimeout !== SQLITE_BUSY_TIMEOUT_MS) throw new Error(`SQLite busy_timeout verification failed: ${summary.busyTimeout}`)
  if (!summary.foreignKeys) throw new Error('SQLite foreign_keys verification failed')
  if (summary.journalMode !== SQLITE_JOURNAL_MODE) throw new Error(`SQLite journal_mode verification failed: ${summary.journalMode}`)
  if (summary.synchronous !== SQLITE_SYNCHRONOUS) throw new Error(`SQLite synchronous verification failed: ${summary.synchronous}`)
  return summary
}

function configurePragmas(database) {
  database.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`)
  // Session-domain deletes reclaim disk pages through incremental_vacuum (see
  // the session-state repository), which requires auto_vacuum = INCREMENTAL.
  // The flag only takes effect on a freshly created (empty) database; an
  // existing library keeps its current layout until a full VACUUM rebuilds
  // it, so applying it here is best-effort for old databases. PRAGMA cannot
  // run inside a transaction — this executes before applySqliteMigrations
  // opens its BEGIN IMMEDIATE — and it must come AFTER busy_timeout: during
  // a multi-process first initialization another worker can already hold the
  // fresh database inside its migration transaction, and without the busy
  // timeout this pragma would fail immediately with SQLITE_BUSY.
  database.exec('PRAGMA auto_vacuum = INCREMENTAL')
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA journal_mode = WAL')
  // NORMAL (2026-08-26, user decision superseding the earlier FULL ruling in
  // docs/architecture/sqlite-storage-foundation.zh-CN.md §3.1): after the
  // persist hot path moved to single-pass encoding + chunked yields, the
  // per-COMMIT fsync (and its latency spikes on AV-scanned / HDD / network
  // volumes) is the dominant remaining event-loop stall on large persists.
  // Accepted trade-off: OS crash / power loss may roll back commits since
  // the last WAL checkpoint; application crashes stay safe.
  database.exec(`PRAGMA synchronous = ${SQLITE_SYNCHRONOUS}`)
  return verifyPragmas(database)
}

function quickCheckMarkerPath(databasePath) {
  return path.join(path.dirname(databasePath), SQLITE_QUICK_CHECK_MARKER_FILENAME)
}

// Resolve the main database file path from any storage surface (raw
// DatabaseSync, the controlled handle, or test duck-typed handles). Returns
// null for in-memory databases, where no marker is possible and every call
// runs a real scan.
function resolveQuickCheckDatabasePath(database) {
  try {
    const rows = database.prepare('PRAGMA database_list').all()
    const main = Array.isArray(rows) ? rows.find((row) => row && row.name === 'main') : null
    const file = typeof main?.file === 'string' ? main.file.trim() : ''
    return file ? path.resolve(file) : null
  } catch {
    return null
  }
}

// Marker read failures (missing, unreadable, malformed) are treated as "no
// marker": the caller falls through to a real scan.
function readQuickCheckMarker(databasePath) {
  try {
    const marker = JSON.parse(readFileSync(quickCheckMarkerPath(databasePath), 'utf8'))
    const lastOkAt = Number(marker?.lastOkAt)
    return Number.isFinite(lastOkAt) ? { ...marker, lastOkAt } : null
  } catch {
    return null
  }
}

// Best-effort atomic marker write: failures only warn, never affect the
// quick_check verdict.
function writeQuickCheckMarker(databasePath, okAt, database) {
  try {
    const markerPath = quickCheckMarkerPath(databasePath)
    const temporaryPath = `${markerPath}.${process.pid}.tmp`
    let sqliteVersion = null
    try {
      sqliteVersion = String(database.prepare('SELECT sqlite_version() AS version').get().version)
    } catch { /* Optional diagnostic field. */ }
    let databaseBytes = null
    try {
      databaseBytes = statSync(databasePath).size
    } catch { /* Optional diagnostic field. */ }
    writeFileSync(temporaryPath, `${JSON.stringify({ app: 'quickforge', lastOkAt: okAt, sqliteVersion, databaseBytes })}\n`, 'utf8')
    renameSync(temporaryPath, markerPath)
  } catch (error) {
    sqliteLogger.warn('SQLite quick_check marker write failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Shared startup `PRAGMA quick_check` gate (see the block comment above for
 * the rationale and safety argument). Semantics:
 * - In-process: one successful scan per database file path is reused for the
 *   process lifetime (unless `maxAgeMs` elapses or `resetSharedQuickCheckCache`
 *   is called); `force` skips this reuse but still refreshes it after success.
 * - Cross-restart: a marker file next to the database (`lastOkAt`) skips the
 *   real scan while younger than `maxAgeMs` (default 7 days). Missing or
 *   unreadable markers are treated as absent.
 * - On a real scan success the marker is rewritten (atomic, best-effort).
 * - On failure the quick_check error is re-thrown as-is: no marker is written
 *   and the process cache never caches failures, so the next call scans again.
 * - QUICKFORGE_SQLITE_QUICK_CHECK=force forces a real scan every call.
 * Returns `{ ok: true, skipped: null | 'process' | 'marker', lastOkAt? }`.
 */
export function runSharedSqliteQuickCheck(database, {
  force = false, maxAgeMs = SQLITE_QUICK_CHECK_MAX_AGE_MS, now = Date.now, writeMarker = true, databasePath = null,
} = {}) {
  const forced = force === true || process.env.QUICKFORGE_SQLITE_QUICK_CHECK === 'force'
  const resolvedPath = databasePath ? path.resolve(databasePath) : resolveQuickCheckDatabasePath(database)
  if (!forced && resolvedPath) {
    const cached = sharedQuickCheckCache.get(resolvedPath)
    if (cached && now() - cached.okAt < maxAgeMs) {
      return { ok: true, skipped: 'process', lastOkAt: cached.okAt }
    }
    const marker = readQuickCheckMarker(resolvedPath)
    if (marker && now() - marker.lastOkAt < maxAgeMs) {
      sharedQuickCheckCache.set(resolvedPath, { okAt: marker.lastOkAt })
      return { ok: true, skipped: 'marker', lastOkAt: marker.lastOkAt }
    }
  }
  const result = database.prepare('PRAGMA quick_check').all().map((row) => row.quick_check)
  if (result.length !== 1 || result[0] !== 'ok') {
    throw new Error(`SQLite quick_check failed: ${result.join(', ')}`)
  }
  const okAt = now()
  if (resolvedPath) sharedQuickCheckCache.set(resolvedPath, { okAt })
  if (writeMarker !== false && resolvedPath) {
    writeQuickCheckMarker(resolvedPath, okAt, database)
  }
  return { ok: true, skipped: null, lastOkAt: okAt }
}

/** Test helper: clears the in-process quick_check cache, marker files stay. */
export function resetSharedQuickCheckCache() {
  sharedQuickCheckCache.clear()
}

function publicHealth(state, { quickCheck = false } = {}) {
  const alive = Number(state.database.prepare('SELECT 1 AS ok').get().ok) === 1
  const pragmas = verifyPragmas(state.database)
  const migration = inspectSqliteMigrationState(state.database, { migrations: state.migrations })
  let quickCheckResult = null
  if (quickCheck) {
    // Shared gate: process-level dedupe + marker-based cadence; throws on
    // failure exactly like the previous inline PRAGMA quick_check did.
    runSharedSqliteQuickCheck(state.database, { databasePath: state.databasePath })
    quickCheckResult = ['ok']
  }
  return {
    ok: alive && migration.consistent,
    sqliteVersion: String(state.database.prepare('SELECT sqlite_version() AS version').get().version),
    schemaVersion: migration.userVersion,
    latestSchemaVersion: migration.latestVersion,
    migrationCount: migration.applied.length,
    journalMode: pragmas.journalMode,
    busyTimeout: pragmas.busyTimeout,
    foreignKeys: pragmas.foreignKeys,
    synchronous: SQLITE_SYNCHRONOUS_NAMES[SQLITE_SYNCHRONOUS] ?? String(SQLITE_SYNCHRONOUS),
    ...(quickCheck ? { quickCheck: quickCheckResult[0] } : {}),
  }
}

function createHandle(state) {
  return Object.freeze({
    exec(sql) {
      return state.database.exec(sql)
    },
    prepare(sql) {
      return state.database.prepare(sql)
    },
    transaction(callback, { mode = 'immediate' } = {}) {
      if (typeof callback !== 'function') throw new TypeError('SQLite transaction callback must be a function')
      const normalizedMode = normalizeMode(mode)
      const nested = state.transactionDepth > 0
      const savepoint = nested ? `quickforge_sp_${++savepointCounter}` : null
      if (nested) state.database.exec(`SAVEPOINT ${savepoint}`)
      else state.database.exec(`BEGIN ${normalizedMode.toUpperCase()}`)
      state.transactionDepth += 1

      try {
        const result = callback(state.handle)
        assertSynchronousResult(result)
        if (nested) state.database.exec(`RELEASE SAVEPOINT ${savepoint}`)
        else state.database.exec('COMMIT')
        return result
      } catch (error) {
        try {
          if (nested) {
            state.database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
            state.database.exec(`RELEASE SAVEPOINT ${savepoint}`)
          } else {
            state.database.exec('ROLLBACK')
          }
        } catch (rollbackError) {
          throw new Error(`${error instanceof Error ? error.message : String(error)}; SQLite rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`, { cause: rollbackError })
        }
        throw error
      } finally {
        state.transactionDepth -= 1
      }
    },
    health(options) {
      return publicHealth(state, options)
    },
    get summary() {
      return publicHealth(state)
    },
  })
}

export function initializeSqliteStorage({ dataDir, databasePath, migrations = SQLITE_MIGRATIONS } = {}) {
  const resolvedPath = resolveSqliteDatabasePath({ dataDir, databasePath })
  if (openState) {
    if (openState.databasePath !== resolvedPath) {
      return Promise.reject(new Error('SQLite storage is already initialized with a different database path'))
    }
    return Promise.resolve(openState.handle)
  }
  if (initializationPromise) {
    if (initializationPromise.databasePath !== resolvedPath) {
      return Promise.reject(new Error('SQLite storage initialization is already in progress for a different database path'))
    }
    return initializationPromise.promise
  }

  const pending = (async () => {
    let database = null
    try {
      await mkdir(path.dirname(resolvedPath), { recursive: true })
      database = new DatabaseSync(resolvedPath)
      const pragmas = configurePragmas(database)
      const migration = applySqliteMigrations(database, { migrations })
      const sqliteVersion = String(database.prepare('SELECT sqlite_version() AS version').get().version)
      const state = {
        database,
        databasePath: resolvedPath,
        migrations,
        transactionDepth: 0,
        handle: null,
      }
      state.handle = createHandle(state)
      openState = state
      sqliteLogger.info('SQLite storage initialized', {
        sqliteVersion,
        schemaVersion: migration.userVersion,
        migrationCount: migration.applied.length,
        journalMode: pragmas.journalMode,
        busyTimeout: pragmas.busyTimeout,
      })
      return state.handle
    } catch (error) {
      if (database) {
        try { database.close() } catch { /* Preserve initialization failure. */ }
      }
      sqliteLogger.error('SQLite storage initialization failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  })()

  const promise = pending.finally(() => {
    if (initializationPromise?.promise === promise) initializationPromise = null
  })
  initializationPromise = { databasePath: resolvedPath, promise }
  return promise
}

export function getSqliteStorage() {
  if (!openState) throw new Error('SQLite storage is not initialized')
  return openState.handle
}

export function getSqliteStorageSummary(options) {
  return getSqliteStorage().health(options)
}

export async function closeSqliteStorage() {
  if (initializationPromise) {
    try { await initializationPromise.promise } catch { /* Failed initialization has no open handle. */ }
  }
  if (!openState) return
  const state = openState
  openState = null
  try {
    state.database.close()
    sqliteLogger.info('SQLite storage closed', {
      sqliteVersion: process.versions.sqlite,
      schemaVersion: state.migrations.length,
    })
  } catch (error) {
    sqliteLogger.error('SQLite storage close failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
