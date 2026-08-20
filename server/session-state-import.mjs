import { getSqliteStorage } from './sqlite/database.mjs'
import { createSessionStateRepository } from './sqlite/session-state-repository.mjs'
import { logger as defaultLogger } from './utils/logger.mjs'

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

// Bucket validation mirrors session-state-cutover.mjs's normalizeBucket: the
// importer walks the same physical JSON tree the cutover source did.
function normalizeBucket(raw) {
  if (raw.scope === 'global') {
    if (raw.projectId !== undefined && raw.projectId !== null && raw.projectId !== '') throw new TypeError('Global session bucket cannot have projectId')
    return { scope: 'global', projectId: null }
  }
  if (raw.scope !== 'project' || typeof raw.projectId !== 'string' || !raw.projectId.trim() || raw.projectId === '.' || raw.projectId === '..' || /[\\/]/.test(raw.projectId)) {
    throw new TypeError('Invalid session bucket')
  }
  return { scope: 'project', projectId: raw.projectId }
}

// Metadata derivation for body-only files (no sessions-metadata entry) —
// identical shaping to the cutover's deriveMetadata.
function deriveMetadata(sessionId, state, bucket) {
  const createdAt = typeof state.createdAt === 'string'
    ? state.createdAt
    : (typeof state.lastModified === 'string' ? state.lastModified : '1970-01-01T00:00:00.000Z')
  return {
    id: sessionId,
    title: typeof state.title === 'string' ? state.title : 'New chat',
    titleSource: state.titleSource,
    createdAt,
    lastModified: typeof state.lastModified === 'string' ? state.lastModified : createdAt,
    messageCount: state.messages.length,
    stateVersion: Number.isInteger(state.stateVersion) && state.stateVersion >= 0 ? state.stateVersion : 0,
    thinkingLevel: typeof state.thinkingLevel === 'string' ? state.thinkingLevel : 'off',
    scope: bucket.scope,
    ...(bucket.scope === 'project' ? { projectId: bucket.projectId } : {}),
    taskStatus: state.taskStatus || 'idle',
    taskStartedAt: state.taskStartedAt ?? null,
    taskFinishedAt: state.taskFinishedAt ?? null,
  }
}

// Per-session normalization with the cutover's normalizeSessionEntry
// validation semantics: id/scope/projectId consistency between bucket, body
// and metadata; orphan metadata-only entries are dropped (diagnosed by the
// caller); body-only files derive their metadata. Returns the repository
// record, or null for a metadata-only orphan.
function normalizeSessionEntry(bucket, sessionId, rawState, rawMetadata, diagnostics) {
  if (!rawState && rawMetadata) {
    diagnostics.push({ kind: 'metadata-only-orphan', scope: bucket.scope, projectId: bucket.projectId, sessionId })
    return null
  }
  if (!isPlainObject(rawState)) throw new TypeError(`Invalid session state: ${sessionId}`)
  if (!Array.isArray(rawState.messages)) throw new TypeError(`Session messages must be an array: ${sessionId}`)
  if (rawState.id !== undefined && rawState.id !== sessionId) throw new TypeError(`Session body id mismatch: ${sessionId}`)
  if (rawState.scope !== undefined && rawState.scope !== bucket.scope) throw new TypeError(`Session body scope mismatch: ${sessionId}`)
  if (bucket.scope === 'project' && rawState.projectId !== undefined && rawState.projectId !== bucket.projectId) throw new TypeError(`Session body project mismatch: ${sessionId}`)
  if (bucket.scope === 'global' && rawState.projectId !== undefined && rawState.projectId !== null) throw new TypeError(`Global session body project mismatch: ${sessionId}`)
  let metadata
  if (rawMetadata === undefined) {
    diagnostics.push({ kind: 'body-only', scope: bucket.scope, projectId: bucket.projectId, sessionId })
    metadata = deriveMetadata(sessionId, rawState, bucket)
  } else {
    if (!isPlainObject(rawMetadata)) throw new TypeError(`Invalid session metadata: ${sessionId}`)
    if (rawMetadata.id !== undefined && rawMetadata.id !== sessionId) throw new TypeError(`Session metadata id mismatch: ${sessionId}`)
    if (rawMetadata.scope !== undefined && rawMetadata.scope !== bucket.scope) throw new TypeError(`Session metadata scope mismatch: ${sessionId}`)
    if (bucket.scope === 'project' && rawMetadata.projectId !== undefined && rawMetadata.projectId !== bucket.projectId) throw new TypeError(`Session metadata project mismatch: ${sessionId}`)
    if (bucket.scope === 'global' && rawMetadata.projectId !== undefined && rawMetadata.projectId !== null) throw new TypeError(`Global session metadata project mismatch: ${sessionId}`)
    metadata = structuredClone(rawMetadata)
  }
  const stateVersion = rawState.stateVersion ?? metadata.stateVersion ?? 0
  if (!Number.isInteger(stateVersion) || stateVersion < 0) throw new TypeError(`Invalid session stateVersion: ${sessionId}`)
  const state = { ...structuredClone(rawState), id: sessionId, scope: bucket.scope, stateVersion }
  metadata = { ...metadata, id: sessionId, scope: bucket.scope, stateVersion }
  if (bucket.scope === 'project') {
    state.projectId = bucket.projectId
    metadata.projectId = bucket.projectId
  } else {
    delete state.projectId
    delete metadata.projectId
  }
  for (const field of ['pinnedAt', 'archivedAt']) {
    if (metadata[field] !== undefined) state[field] = metadata[field]
  }
  return { scope: bucket.scope, projectId: bucket.projectId ?? null, sessionId, state, metadata }
}

// Schema v11 JSON importer: streams the physical session-state JSON tree
// (the same layout createPhysicalSessionStateFsAdapter walks for the old
// cutover) and re-imports every session into the v2 SQLite store, one
// transaction per session — repository.save extracts the messages (inline or
// legacy split-marked bodies alike), so the import is idempotent and can be
// re-run after any interruption. JSON files are read-only here: nothing is
// written back, no mirror, no phase state.
//
// Resilience: a failing entry (unreadable file, validation mismatch,
// cross-bucket duplicate) never aborts the run — it is counted in `skipped`
// and described in `diagnostics` so the operator can inspect and fix the
// source tree, then simply re-run.
export async function importSessionStateFromJson({ storage = null, logger = defaultLogger } = {}) {
  const storageModule = storage ?? await import('./storage.mjs')
  const fsAdapter = storageModule.createPhysicalSessionStateFsAdapter()
  const repository = createSessionStateRepository(getSqliteStorage())
  const diagnostics = []
  let imported = 0
  let skipped = 0

  for await (const rawBucket of fsAdapter.listBuckets()) {
    const bucket = normalizeBucket(rawBucket)
    const metadata = await fsAdapter.readMetadataBucket(rawBucket)
    if (!isPlainObject(metadata)) throw new TypeError('Session bucket stores must be objects')
    const fileIds = new Set()
    for await (const sessionId of fsAdapter.listSessionFiles(rawBucket)) fileIds.add(sessionId)
    const ids = [...new Set([...fileIds, ...Object.keys(metadata)])].sort((left, right) => left.localeCompare(right))
    for (const sessionId of ids) {
      let record
      try {
        const rawState = fileIds.has(sessionId) ? await fsAdapter.readSessionState(rawBucket, sessionId) : undefined
        record = normalizeSessionEntry(bucket, sessionId, rawState, metadata[sessionId], diagnostics)
      } catch (error) {
        skipped += 1
        diagnostics.push({ kind: 'invalid-entry', scope: bucket.scope, projectId: bucket.projectId, sessionId, message: error instanceof Error ? error.message : String(error) })
        continue
      }
      if (!record) {
        skipped += 1
        continue
      }
      try {
        repository.save(record)
        imported += 1
      } catch (error) {
        skipped += 1
        diagnostics.push({
          kind: 'save-error',
          scope: record.scope,
          projectId: record.projectId,
          sessionId,
          errorCode: error?.errorCode ?? null,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  try {
    repository.checkpointWal()
  } catch (error) {
    logger.warn('Session state import WAL checkpoint failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  logger.info('Session state JSON import finished', { imported, skipped })
  return { imported, skipped, diagnostics }
}
