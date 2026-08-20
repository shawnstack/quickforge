import { createSessionIndexRepository } from './sqlite/session-index-repository.mjs'
import { getSqliteStorage } from './sqlite/database.mjs'
import { logger } from './utils/logger.mjs'

// Storage v2 session index service. The JSON-metadata convergence machinery
// (shadow verification, verify TTL, scheduled rebuilds, incremental
// syncMetadataCommit) is retired together with the session_index projection
// table: queries read the authoritative `sessions` table directly, so there is
// no second data source that could drift. The service keeps the route-facing
// boundary (readiness/analysis/queryPage) and the diagnostics shape the
// /api/system status surface renders.

let defaultRepository = null
let activeService = null

function safeError(error) {
  return {
    name: error instanceof Error ? error.name : 'Error',
    code: typeof error?.code === 'string' ? error.code : null,
  }
}

export function createSessionIndexService({ repository, log = logger } = {}) {
  if (!repository || typeof repository.listPage !== 'function' || typeof repository.analyzeQuery !== 'function') {
    throw new TypeError('Session index service requires a repository')
  }
  const diagnostics = {
    status: 'uninitialized',
    initialized: false,
    degraded: false,
    dirty: false,
    sourceCount: 0,
    indexCount: 0,
    count: 0,
    lastVerifiedAt: null,
    rebuildCount: 0,
    rebuildGeneration: 0,
    duplicateSessionIdCount: 0,
    queryCompatible: true,
    lastFailure: null,
  }

  function getDiagnostics() {
    return { ...diagnostics }
  }

  function readiness() {
    return {
      ready: diagnostics.initialized && !diagnostics.degraded,
      reason: diagnostics.initialized ? null : 'uninitialized',
      ...getDiagnostics(),
    }
  }

  async function initialize() {
    try {
      diagnostics.count = repository.count()
      diagnostics.sourceCount = diagnostics.count
      diagnostics.indexCount = diagnostics.count
      diagnostics.initialized = true
      diagnostics.status = 'ready'
      diagnostics.lastVerifiedAt = new Date().toISOString()
      return { ok: true, rebuilt: false, ...getDiagnostics() }
    } catch (error) {
      diagnostics.initialized = true
      diagnostics.degraded = true
      diagnostics.dirty = true
      diagnostics.status = 'degraded'
      diagnostics.lastFailure = safeError(error)
      log.warn('Session index initialization failed; queries will fall back.', {
        operation: 'session_index_initialize',
        error: diagnostics.lastFailure,
      })
      return { ok: false, degraded: true, ...getDiagnostics() }
    }
  }

  async function verifyIntegrity() {
    if (!diagnostics.initialized) return { ready: false, reason: 'uninitialized', ...getDiagnostics() }
    return readiness()
  }

  async function queryPage(options) {
    if (!diagnostics.initialized) return { ok: false, reason: 'uninitialized', readiness: getDiagnostics() }
    try {
      // Duplicate session ids and complete sort-key ties make LIMIT/OFFSET
      // pagination unstable; the route falls back to its legacy sorted read.
      const analysis = repository.analyzeQuery(options)
      if (analysis.duplicateSessionIdCount > 0) return { ok: false, reason: 'duplicate_session_id', analysis, readiness: readiness() }
      if (analysis.fullSortKeyTieCount > 0) return { ok: false, reason: 'sort_key_tie', analysis, readiness: readiness() }
      return { ok: true, page: repository.listPage(options), analysis, readiness: readiness() }
    } catch (error) {
      diagnostics.dirty = true
      diagnostics.degraded = true
      diagnostics.status = 'degraded'
      diagnostics.lastFailure = safeError(error)
      log.warn('Session index query failed; route falls back.', {
        operation: 'session_index_query',
        error: diagnostics.lastFailure,
      })
      return { ok: false, reason: 'repository_error', error: diagnostics.lastFailure, readiness: getDiagnostics() }
    }
  }

  // Storage v2: the index IS the sessions table, so metadata commits have
  // nothing to mirror. Kept for the storage.mjs commit-hook wiring contract.
  async function syncMetadataCommit() {
    return { ok: true, skipped: true }
  }

  function markQueryFailure() {
    // No-op: there is no separate projection to mark dirty.
  }

  return Object.freeze({
    initialize, verifyIntegrity, queryPage, syncMetadataCommit, markQueryFailure, getDiagnostics,
  })
}

export function configureSessionIndex({ repository } = {}) {
  if (repository !== undefined && repository !== null && typeof repository !== 'object') throw new TypeError('repository must be an object')
  defaultRepository = repository ?? defaultRepository
}

export async function initializeSessionIndex(options = {}) {
  const repository = options.repository ?? defaultRepository ?? createSessionIndexRepository(getSqliteStorage())
  activeService = createSessionIndexService({ ...options, repository })
  return activeService.initialize()
}

export async function syncSessionMetadataCommit() {
  if (!activeService) return { ok: true, skipped: true }
  return activeService.syncMetadataCommit()
}

export async function querySessionIndexPage(options) {
  if (!activeService) return { ok: false, reason: 'uninitialized', readiness: getSessionIndexDiagnostics() }
  return activeService.queryPage(options)
}

export function markSessionIndexQueryFailure() {
  activeService?.markQueryFailure()
}

export function getSessionIndexDiagnostics() {
  return activeService?.getDiagnostics() ?? {
    status: 'uninitialized',
    initialized: false,
    degraded: false,
    dirty: false,
    sourceCount: 0,
    indexCount: 0,
    count: 0,
    lastVerifiedAt: null,
    rebuildCount: 0,
    rebuildGeneration: 0,
    duplicateSessionIdCount: 0,
    queryCompatible: true,
    lastFailure: null,
  }
}
