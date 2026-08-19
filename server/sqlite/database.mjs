import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { logger } from '../utils/logger.mjs'
import { applySqliteMigrations, inspectSqliteMigrationState, SQLITE_MIGRATIONS } from './migrations.mjs'

export const SQLITE_BUSY_TIMEOUT_MS = 5_000
export const SQLITE_JOURNAL_MODE = 'wal'
export const SQLITE_SYNCHRONOUS = 2

const sqliteLogger = logger.child({ component: 'sqlite' })
const TRANSACTION_MODES = new Set(['deferred', 'immediate', 'exclusive'])
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
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA journal_mode = WAL')
  // FULL (not NORMAL): decision finalized in docs/architecture/sqlite-storage-foundation.zh-CN.md §3.1
  // — measured cost is ~0.46 ms/op on the save hot path, in exchange for zero committed-transaction
  // loss on OS crash/power loss.
  database.exec('PRAGMA synchronous = FULL')
  return verifyPragmas(database)
}

function publicHealth(state, { quickCheck = false } = {}) {
  const alive = Number(state.database.prepare('SELECT 1 AS ok').get().ok) === 1
  const pragmas = verifyPragmas(state.database)
  const migration = inspectSqliteMigrationState(state.database, { migrations: state.migrations })
  let quickCheckResult = null
  if (quickCheck) {
    quickCheckResult = state.database.prepare('PRAGMA quick_check').all().map((row) => row.quick_check)
    if (quickCheckResult.length !== 1 || quickCheckResult[0] !== 'ok') {
      throw new Error(`SQLite quick_check failed: ${quickCheckResult.join(', ')}`)
    }
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
    synchronous: 'full',
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
