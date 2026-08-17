import { createHash } from 'node:crypto'
import { createSessionIndexRepository } from './sqlite/session-index-repository.mjs'
import { getSqliteStorage } from './sqlite/database.mjs'
import { logger } from './utils/logger.mjs'

const DEFAULT_MAX_REBUILD_ATTEMPTS = 3
const DEFAULT_VERIFY_TTL_MS = 5_000

let defaultReader = null
let defaultRepository = null
let activeService = null

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!isPlainObject(value)) return value
  const result = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) result[key] = canonicalValue(value[key])
  }
  return result
}

export function canonicalSessionMetadata(metadata, { scope, projectId, sessionId }) {
  if (!isPlainObject(metadata)) throw new TypeError('Session metadata must be a plain object')
  const canonical = canonicalValue(metadata)
  canonical.id = sessionId
  canonical.scope = scope
  if (scope === 'project') canonical.projectId = projectId
  else delete canonical.projectId
  return canonicalValue(canonical)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function sessionMetadataDigest(metadata) {
  return sha256(JSON.stringify(canonicalValue(metadata)))
}

export function sessionIndexAggregateDigest(entries) {
  const normalized = [...entries]
    .map((entry) => `${entry.scope}\0${entry.projectId || ''}\0${entry.sessionId}\0${entry.metadataDigest}`)
    .sort()
  return sha256(normalized.join('\n'))
}

function normalizeBucket(bucket) {
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) throw new TypeError('Session metadata bucket must be an object')
  if (bucket.scope === 'global') return { scope: 'global', projectId: null }
  if (bucket.scope !== 'project' || typeof bucket.projectId !== 'string' || !bucket.projectId.trim()) {
    throw new TypeError('Session metadata bucket scope/projectId is invalid')
  }
  return { scope: 'project', projectId: bucket.projectId }
}

function nullableString(value) {
  return typeof value === 'string' ? value : null
}

function nullableInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null
}

function isCanonicalIso(value) {
  if (typeof value !== 'string' || !value) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function fieldCompatibility(metadata, field, { iso = false } = {}) {
  if (metadata[field] === undefined) return true
  if (typeof metadata[field] !== 'string') return false
  return !iso || isCanonicalIso(metadata[field])
}

function metadataCompatibility(bucket, sessionId, metadata, canonical) {
  const issues = {
    keyIdMismatch: metadata.id !== undefined && metadata.id !== sessionId,
    scopeConflict: (metadata.scope !== undefined && metadata.scope !== bucket.scope)
      || (bucket.scope === 'project'
        ? metadata.projectId !== undefined && metadata.projectId !== bucket.projectId
        : Object.prototype.hasOwnProperty.call(metadata, 'projectId')),
    invalidCreatedAt: !fieldCompatibility(metadata, 'createdAt', { iso: true }),
    invalidLastModified: !fieldCompatibility(metadata, 'lastModified', { iso: true }),
    invalidPinnedAt: !fieldCompatibility(metadata, 'pinnedAt', { iso: true }),
    invalidArchivedAt: !fieldCompatibility(metadata, 'archivedAt'),
    canonicalMismatch: JSON.stringify(canonicalValue(metadata)) !== JSON.stringify(canonical),
  }
  return { compatible: !Object.values(issues).some(Boolean), issues }
}

function buildRow(bucket, sessionId, metadata, indexedAt) {
  const canonical = canonicalSessionMetadata(metadata, { ...bucket, sessionId })
  return {
    ...bucket,
    sessionId,
    createdAt: nullableString(canonical.createdAt),
    lastModified: nullableString(canonical.lastModified),
    messageCount: nullableInteger(canonical.messageCount),
    pinnedAt: nullableString(canonical.pinnedAt),
    archivedAt: nullableString(canonical.archivedAt),
    stateVersion: nullableInteger(canonical.stateVersion),
    metadata: canonical,
    metadataDigest: sessionMetadataDigest(canonical),
    indexedAt,
  }
}

function snapshotFromBuckets(buckets, indexedAt) {
  if (!Array.isArray(buckets)) throw new TypeError('Session metadata reader must return an array')
  const rows = []
  const keys = new Set()
  const sessionBuckets = new Map()
  const compatibilityIssues = {
    keyIdMismatch: 0,
    scopeConflict: 0,
    invalidCreatedAt: 0,
    invalidLastModified: 0,
    invalidPinnedAt: 0,
    invalidArchivedAt: 0,
    canonicalMismatch: 0,
  }
  let duplicateSessionIdCount = 0

  for (const rawBucket of buckets) {
    const bucket = normalizeBucket(rawBucket)
    if (!isPlainObject(rawBucket.metadata)) throw new TypeError('Session metadata bucket content must be a plain object')
    for (const [sessionId, metadata] of Object.entries(rawBucket.metadata)) {
      if (!sessionId || !isPlainObject(metadata)) throw new TypeError('Session metadata entries must be keyed plain objects')
      const compositeKey = `${bucket.scope}\0${bucket.projectId || ''}\0${sessionId}`
      if (keys.has(compositeKey)) throw new TypeError('Duplicate session metadata bucket composite key')
      keys.add(compositeKey)
      const seenBuckets = sessionBuckets.get(sessionId) || 0
      if (seenBuckets === 1) duplicateSessionIdCount += 1
      sessionBuckets.set(sessionId, seenBuckets + 1)
      const row = buildRow(bucket, sessionId, metadata, indexedAt)
      const compatibility = metadataCompatibility(bucket, sessionId, metadata, row.metadata)
      for (const [issue, present] of Object.entries(compatibility.issues)) {
        if (present) compatibilityIssues[issue] += 1
      }
      rows.push(row)
    }
  }

  rows.sort((left, right) => {
    const leftKey = `${left.scope}\0${left.projectId || ''}\0${left.sessionId}`
    const rightKey = `${right.scope}\0${right.projectId || ''}\0${right.sessionId}`
    return leftKey.localeCompare(rightKey)
  })
  return {
    rows,
    count: rows.length,
    digest: sessionIndexAggregateDigest(rows),
    keyIdMismatchCount: compatibilityIssues.keyIdMismatch,
    duplicateSessionIdCount,
    compatibilityIssues,
    queryCompatible: Object.values(compatibilityIssues).every((count) => count === 0),
  }
}

function safeError(error) {
  return {
    name: error instanceof Error ? error.name : 'Error',
    code: typeof error?.code === 'string' ? error.code : null,
  }
}

export function createSessionIndexService({
  repository,
  readBuckets,
  now = () => new Date().toISOString(),
  nowMs = () => Date.now(),
  verifyTtlMs = DEFAULT_VERIFY_TTL_MS,
  maxRebuildAttempts = DEFAULT_MAX_REBUILD_ATTEMPTS,
  log = logger,
} = {}) {
  if (!repository || typeof repository.replaceAll !== 'function' || typeof repository.applyChanges !== 'function') {
    throw new TypeError('Session index service requires a repository')
  }
  if (typeof readBuckets !== 'function') throw new TypeError('Session index service requires a bucket reader')

  let rebuildPromise = null
  const emptyDigest = sessionIndexAggregateDigest([])
  const diagnostics = {
    status: 'uninitialized',
    initialized: false,
    degraded: true,
    dirty: true,
    sourceCount: 0,
    sourceDigest: emptyDigest,
    indexCount: 0,
    indexDigest: emptyDigest,
    count: 0,
    digest: emptyDigest,
    lastVerifiedAt: null,
    rebuildCount: 0,
    rebuildGeneration: 0,
    keyIdMismatchCount: 0,
    duplicateSessionIdCount: 0,
    queryCompatible: false,
    compatibilityIssues: null,
    lastFailure: null,
  }

  async function readSnapshot() {
    return snapshotFromBuckets(await readBuckets(), now())
  }

  function indexedVerification() {
    const entries = repository.listVerification()
    return { count: entries.length, digest: sessionIndexAggregateDigest(entries) }
  }

  function projectionIntegrity() {
    if (typeof repository.listIntegrity !== 'function') return true
    return repository.listIntegrity().every((row) => {
      const metadata = row.metadata
      if (!isPlainObject(metadata)) return false
      if (row.isArchived !== Boolean(metadata.archivedAt)) return false
      if (row.isPinned !== Boolean(metadata.pinnedAt)) return false
      if (row.createdAt !== nullableString(metadata.createdAt)) return false
      if (row.lastModified !== nullableString(metadata.lastModified)) return false
      if (row.pinnedAt !== nullableString(metadata.pinnedAt)) return false
      if (row.archivedAt !== nullableString(metadata.archivedAt)) return false
      if (row.messageCount !== nullableInteger(metadata.messageCount)) return false
      return true
    })
  }

  function setVerification(snapshot, verification, { dirty = false } = {}) {
    diagnostics.sourceCount = snapshot.count
    diagnostics.sourceDigest = snapshot.digest
    diagnostics.indexCount = verification.count
    diagnostics.indexDigest = verification.digest
    diagnostics.count = snapshot.count
    diagnostics.digest = snapshot.digest
    diagnostics.keyIdMismatchCount = snapshot.keyIdMismatchCount
    diagnostics.duplicateSessionIdCount = snapshot.duplicateSessionIdCount
    diagnostics.queryCompatible = snapshot.queryCompatible
    diagnostics.compatibilityIssues = { ...snapshot.compatibilityIssues }
    diagnostics.dirty = dirty
    diagnostics.degraded = dirty || !snapshot.queryCompatible
    diagnostics.status = diagnostics.degraded ? 'degraded' : 'ready'
    diagnostics.lastVerifiedAt = now()
    if (!diagnostics.degraded) diagnostics.lastFailure = null
  }

  async function rebuildInternal(initialSnapshot = null) {
    let snapshot = initialSnapshot
    for (let attempt = 1; attempt <= maxRebuildAttempts; attempt += 1) {
      snapshot ||= await readSnapshot()
      repository.replaceAll(snapshot.rows)
      const afterSource = await readSnapshot()
      if (afterSource.count !== snapshot.count || afterSource.digest !== snapshot.digest) {
        snapshot = afterSource
        continue
      }
      const verification = indexedVerification()
      if (verification.count !== snapshot.count || verification.digest !== snapshot.digest) {
        snapshot = afterSource
        continue
      }
      diagnostics.rebuildCount += 1
      diagnostics.rebuildGeneration += 1
      setVerification(snapshot, verification)
      return { ok: true, rebuilt: true, attempts: attempt, ...getDiagnostics() }
    }
    throw new Error(`Session index source changed during ${maxRebuildAttempts} rebuild attempts`)
  }

  function rebuild(initialSnapshot = null) {
    if (rebuildPromise) return rebuildPromise
    rebuildPromise = rebuildInternal(initialSnapshot).catch((error) => {
      diagnostics.dirty = true
      diagnostics.degraded = true
      diagnostics.status = 'degraded'
      diagnostics.lastFailure = safeError(error)
      log.warn('Session index rebuild failed; JSON metadata remains authoritative.', {
        operation: 'session_index_rebuild',
        error: diagnostics.lastFailure,
      })
      throw error
    }).finally(() => { rebuildPromise = null })
    return rebuildPromise
  }

  function scheduleRebuild() {
    if (!rebuildPromise) {
      setTimeout(() => {
        if (!rebuildPromise && diagnostics.dirty) void rebuild().catch(() => {})
      }, 0).unref?.()
    }
  }

  async function initialize() {
    try {
      const snapshot = await readSnapshot()
      const verification = indexedVerification()
      if (verification.count !== snapshot.count || verification.digest !== snapshot.digest) await rebuild(snapshot)
      else setVerification(snapshot, verification)
      diagnostics.initialized = true
      return { ok: !diagnostics.degraded, rebuilt: diagnostics.rebuildCount > 0, ...getDiagnostics() }
    } catch (error) {
      diagnostics.initialized = true
      diagnostics.dirty = true
      diagnostics.degraded = true
      diagnostics.status = 'degraded'
      diagnostics.lastFailure = safeError(error)
      log.warn('Session index initialization degraded; JSON metadata remains authoritative.', {
        operation: 'session_index_initialize',
        error: diagnostics.lastFailure,
      })
      return { ok: false, degraded: true, ...getDiagnostics() }
    }
  }

  async function verifyIntegrity({ force = false } = {}) {
    if (!diagnostics.initialized) return { ready: false, reason: 'uninitialized', ...getDiagnostics() }
    const lastVerifiedMs = diagnostics.lastVerifiedAt ? Date.parse(diagnostics.lastVerifiedAt) : Number.NaN
    if (!force && Number.isFinite(lastVerifiedMs) && nowMs() - lastVerifiedMs < verifyTtlMs) {
      return { ready: !diagnostics.dirty && !diagnostics.degraded && diagnostics.queryCompatible, ...getDiagnostics() }
    }
    try {
      const snapshot = await readSnapshot()
      const verification = indexedVerification()
      const projectionValid = projectionIntegrity()
      const matches = verification.count === snapshot.count && verification.digest === snapshot.digest && projectionValid
      setVerification(snapshot, verification, { dirty: !matches })
      if (!matches) scheduleRebuild()
      return {
        ready: matches && snapshot.queryCompatible,
        reason: !projectionValid ? 'projection_mismatch' : !matches ? 'digest_mismatch' : snapshot.queryCompatible ? null : 'source_incompatible',
        ...getDiagnostics(),
      }
    } catch (error) {
      diagnostics.dirty = true
      diagnostics.degraded = true
      diagnostics.status = 'degraded'
      diagnostics.lastFailure = safeError(error)
      scheduleRebuild()
      return { ready: false, reason: 'verify_failed', ...getDiagnostics() }
    }
  }

  async function syncMetadataCommit({ scope, projectId, previous, next }) {
    const bucket = normalizeBucket({ scope, projectId })
    if (!isPlainObject(previous) || !isPlainObject(next)) throw new TypeError('previous and next metadata buckets must be plain objects')
    if (!diagnostics.initialized) return { ok: true, skipped: true }
    diagnostics.lastVerifiedAt = null
    try {
      const indexedAt = now()
      const upserts = []
      const deletes = []
      const ids = new Set([...Object.keys(previous), ...Object.keys(next)])
      for (const sessionId of ids) {
        const previousMetadata = previous[sessionId]
        const nextMetadata = next[sessionId]
        if (nextMetadata === undefined) {
          deletes.push({ ...bucket, sessionId })
          continue
        }
        const nextRow = buildRow(bucket, sessionId, nextMetadata, indexedAt)
        if (previousMetadata !== undefined) {
          const previousRow = buildRow(bucket, sessionId, previousMetadata, indexedAt)
          if (previousRow.metadataDigest === nextRow.metadataDigest) continue
        }
        upserts.push(nextRow)
      }
      repository.applyChanges({ upserts, deletes })
      const verification = indexedVerification()
      diagnostics.indexCount = verification.count
      diagnostics.indexDigest = verification.digest
      diagnostics.count = verification.count
      diagnostics.digest = verification.digest
      diagnostics.sourceCount = verification.count
      diagnostics.sourceDigest = verification.digest
      if (!diagnostics.dirty) diagnostics.lastFailure = null
      return { ok: true, upserted: upserts.length, deleted: deletes.length, dirty: diagnostics.dirty }
    } catch (error) {
      diagnostics.dirty = true
      diagnostics.degraded = true
      diagnostics.status = 'degraded'
      diagnostics.lastFailure = safeError(error)
      scheduleRebuild()
      log.warn('Session index incremental sync failed; JSON metadata commit remains successful.', {
        operation: 'session_index_sync',
        scope: bucket.scope,
        hasProjectId: bucket.scope === 'project',
        error: diagnostics.lastFailure,
      })
      return { ok: false, degraded: true }
    }
  }

  function markQueryFailure(reason, error = null) {
    diagnostics.dirty = true
    diagnostics.degraded = true
    diagnostics.status = 'degraded'
    diagnostics.lastFailure = error ? safeError(error) : { name: 'SessionIndexQueryMismatch', code: reason }
    log.warn('Session index query degraded; JSON metadata remains authoritative.', {
      operation: 'session_index_query',
      reason,
      error: error ? diagnostics.lastFailure : null,
    })
    scheduleRebuild()
  }

  async function queryPage(options) {
    const readiness = await verifyIntegrity()
    if (!readiness.ready) {
      return {
        ok: false,
        reason: readiness.reason || (readiness.queryCompatible === false ? 'source_incompatible' : 'not_ready'),
        readiness,
      }
    }
    try {
      const analysis = repository.analyzeQuery(options)
      if (analysis.duplicateSessionIdCount > 0) return { ok: false, reason: 'duplicate_session_id', analysis, readiness }
      if (analysis.fullSortKeyTieCount > 0) return { ok: false, reason: 'sort_key_tie', analysis, readiness }
      return { ok: true, page: repository.listPage(options), analysis, readiness }
    } catch (error) {
      markQueryFailure('repository_error', error)
      return { ok: false, reason: 'repository_error', error: safeError(error), readiness: getDiagnostics() }
    }
  }

  async function snapshot() {
    return readSnapshot()
  }

  function getDiagnostics() {
    return { ...diagnostics, compatibilityIssues: diagnostics.compatibilityIssues ? { ...diagnostics.compatibilityIssues } : null }
  }

  return Object.freeze({
    snapshot, initialize, rebuild, verifyIntegrity, queryPage, markQueryFailure,
    syncMetadataCommit, getDiagnostics,
  })
}

export function configureSessionIndex({ readBuckets, repository } = {}) {
  if (readBuckets !== undefined && typeof readBuckets !== 'function') throw new TypeError('readBuckets must be a function')
  defaultReader = readBuckets ?? defaultReader
  defaultRepository = repository ?? defaultRepository
}

export async function initializeSessionIndex(options = {}) {
  const readBuckets = options.readBuckets ?? defaultReader
  const repository = options.repository ?? defaultRepository ?? createSessionIndexRepository(getSqliteStorage())
  activeService = createSessionIndexService({ ...options, repository, readBuckets })
  return activeService.initialize()
}

export async function syncSessionMetadataCommit(change) {
  if (!activeService) return { ok: true, skipped: true }
  return activeService.syncMetadataCommit(change)
}

export async function querySessionIndexPage(options) {
  if (!activeService) return { ok: false, reason: 'uninitialized', readiness: getSessionIndexDiagnostics() }
  return activeService.queryPage(options)
}

export function markSessionIndexQueryFailure(reason, error) {
  activeService?.markQueryFailure(reason, error)
}

export function getSessionIndexDiagnostics() {
  return activeService?.getDiagnostics() ?? {
    status: 'uninitialized',
    initialized: false,
    degraded: true,
    dirty: true,
    sourceCount: 0,
    sourceDigest: sessionIndexAggregateDigest([]),
    indexCount: 0,
    indexDigest: sessionIndexAggregateDigest([]),
    count: 0,
    digest: sessionIndexAggregateDigest([]),
    lastVerifiedAt: null,
    rebuildCount: 0,
    rebuildGeneration: 0,
    keyIdMismatchCount: 0,
    duplicateSessionIdCount: 0,
    queryCompatible: false,
    compatibilityIssues: null,
    lastFailure: null,
  }
}
