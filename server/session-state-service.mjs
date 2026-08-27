import { createSessionStateRepository, encodeMessagesChunked, MESSAGES_PAGE_LIMIT_MAX, MESSAGES_SPLIT_VALUE, messageDigest } from './sqlite/session-state-repository.mjs'
import { getSqliteStorage } from './sqlite/database.mjs'

// Storage v2 integration: SQLite is the single authoritative session store.
// The JSON→SQLite phase machine (cutover, mirror queue, JSON write barrier) is
// retired; the v2 `sessions`/`session_messages`/`session_tombstones` schema
// (migration v11) is the only representation, and legacy JSON session files are
// consumed once by importSessionStateFromJson during startup.

let repositoryInstance = null
let repositoryInstanceHandle = null
let initializedAt = null

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function previewFromMessages(messages) {
  if (!Array.isArray(messages)) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'assistant') continue
    const content = message.content
    if (Array.isArray(content)) {
      return content.filter((block) => block?.type === 'text').map((block) => block.text ?? '').join(' ').slice(0, 200)
    }
    if (typeof content === 'string') return content.slice(0, 200)
    return ''
  }
  return ''
}

function storage() {
  return getSqliteStorage()
}

function repository() {
  // Rebuild when the process-wide SQLite handle changed (close/reopen cycles
  // in tests and restart flows): cached statements are bound to one handle.
  const handle = storage()
  if (!repositoryInstance || (repositoryInstanceHandle !== null && repositoryInstanceHandle !== handle)) {
    repositoryInstance = createSessionStateRepository(handle)
    repositoryInstanceHandle = handle
  }
  return repositoryInstance
}

// v2: only the repository override remains testable. The retired phase
// machine's `json`/`mirror`/`phase` options are accepted and ignored so old
// call sites keep working while they are cleaned up.
export function configureSessionStateService({ repository: configuredRepository } = {}) {
  if (configuredRepository !== undefined) {
    repositoryInstance = configuredRepository
    repositoryInstanceHandle = null
  }
}

// Constant authoritative state (startup-state/诊断展示用): there is no
// session_storage_state table any more — SQLite is authoritative by
// construction, and the live session count comes straight from the store.
export function readSessionStorageState() {
  let stateCount = null
  try {
    stateCount = repository().count()
  } catch {
    // SQLite not initialized yet (early startup diagnostics); the phase stays
    // authoritative, the count is simply unknown until the store opens.
  }
  return {
    phase: 'authoritative',
    stateCount,
    digest: null,
    backupFile: null,
    diagnostic: null,
    updatedAt: initializedAt,
  }
}

export function initializeSessionStateService() {
  initializedAt = new Date().toISOString()
  return readSessionStorageState()
}

export function isSessionStateAuthoritative() {
  return true
}

export function stopSessionStateService() {}

function normalizeBucket(value, fallback = null) {
  const scope = value?.scope ?? fallback?.scope ?? 'global'
  if (scope === 'project') {
    const projectId = value?.projectId ?? fallback?.projectId
    if (typeof projectId !== 'string' || !projectId.trim()) throw new TypeError('projectId is required for project sessions')
    return { scope, projectId }
  }
  if (scope !== 'global') throw new TypeError('scope must be global or project')
  return { scope: 'global', projectId: null }
}

function stateVersion(state, metadata, fallback = 0) {
  const value = state?.stateVersion ?? metadata?.stateVersion ?? fallback
  if (!Number.isInteger(value) || value < 0) throw new TypeError('stateVersion must be a non-negative integer')
  return value
}

function deriveMetadata(state, existing = {}) {
  const version = stateVersion(state, existing)
  const bucket = normalizeBucket(state, existing)
  const id = state.id
  const next = {
    ...existing,
    id,
    title: state.title ?? existing.title ?? 'New chat',
    titleSource: state.titleSource ?? existing.titleSource,
    createdAt: state.createdAt ?? existing.createdAt ?? new Date().toISOString(),
    lastModified: state.lastModified ?? existing.lastModified ?? state.createdAt ?? new Date().toISOString(),
    messageCount: Array.isArray(state.messages) ? state.messages.length : (existing.messageCount ?? 0),
    preview: Array.isArray(state.messages) ? previewFromMessages(state.messages) : existing.preview,
    stateVersion: version,
    thinkingLevel: state.thinkingLevel ?? existing.thinkingLevel ?? 'off',
    harness: state.harness ?? existing.harness,
    harnessSessionId: state.harnessSessionId ?? existing.harnessSessionId,
    accessMode: state.accessMode ?? existing.accessMode,
    yoloMode: state.yoloMode ?? existing.yoloMode,
    scope: bucket.scope,
    taskStatus: state.taskStatus ?? existing.taskStatus ?? 'idle',
    taskStartedAt: state.taskStartedAt ?? existing.taskStartedAt ?? null,
    taskFinishedAt: state.taskFinishedAt ?? existing.taskFinishedAt ?? null,
    contextCompaction: state.contextCompaction ?? existing.contextCompaction,
    idleRetention: state.idleRetention ?? existing.idleRetention,
    archivedAt: existing.archivedAt ?? state.archivedAt,
    pinnedAt: existing.pinnedAt ?? state.pinnedAt,
  }
  if (bucket.scope === 'project') next.projectId = bucket.projectId
  else delete next.projectId
  return Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined))
}

function synchronize(stateValue, metadataValue, sessionId, fallback = null) {
  if (!isPlainObject(stateValue) || !isPlainObject(metadataValue)) throw new TypeError('Session state and metadata must be plain objects')
  // Persist-path CPU cut: deep-clone only the body and shallow-copy the
  // messages array instead (fresh array, same element references). The fresh
  // array freezes the length snapshot, and encodeMessage turns each message
  // into an immutable JSON string the instant it runs, so a caller push or
  // in-place edit during the async chunked encode can never alter what is
  // written — byte-identical to the previous whole-state clone. The body
  // mutations below still land on the clone, never on the caller's object.
  const { messages: incomingMessages, ...stateBody } = stateValue
  const state = structuredClone(stateBody)
  if (incomingMessages !== undefined) state.messages = Array.isArray(incomingMessages) ? incomingMessages.slice() : incomingMessages
  const metadata = structuredClone(metadataValue)
  state.id = sessionId
  metadata.id = sessionId
  const bucket = normalizeBucket(state, normalizeBucket(metadata, fallback))
  const version = stateVersion(state, metadata, fallback?.stateVersion ?? 0)
  state.scope = bucket.scope
  metadata.scope = bucket.scope
  state.stateVersion = version
  metadata.stateVersion = version
  if (bucket.scope === 'project') {
    state.projectId = bucket.projectId
    metadata.projectId = bucket.projectId
  } else {
    delete state.projectId
    delete metadata.projectId
  }
  for (const field of ['pinnedAt', 'archivedAt']) {
    if (metadata[field] !== undefined && metadata[field] !== null) state[field] = metadata[field]
    else delete state[field]
  }
  return { state, metadata, ...bucket, stateVersion: version, sessionId }
}

function allMessages(record) {
  if (!record) return []
  const messages = []
  let offset = 0
  for (;;) {
    const page = repository().readMessagesPage({ scope: record.scope, projectId: record.projectId, sessionId: record.sessionId, limit: MESSAGES_PAGE_LIMIT_MAX, offset })
    messages.push(...page.messages.map((row) => row.message))
    if (!page.hasMore || page.messages.length === 0) break
    offset = page.nextOffset
  }
  return messages
}

function assembleState(record) {
  if (!record) return null
  if (record.state?.messageStorage !== MESSAGES_SPLIT_VALUE) return record.state
  const messages = Array.isArray(record.messages) ? record.messages : allMessages(record)
  return { ...record.state, messages }
}

// Decide how an incoming full state should be persisted relative to the
// currently stored session. Storage v2 keeps every session's messages in
// `session_messages` (the repository extracts any `messages` array on save),
// so only the incremental tail decision remains:
// - body-only: messages are unchanged (or absent); only the body is saved.
// - replace: full message rewrite (first save / truncation / in-place edit).
// - append: only the new tail rows are written (incremental).
function messageStoragePlan(state, existing) {
  const incoming = state?.messages
  if (incoming === undefined) return { mode: 'body-only' }
  if (!Array.isArray(incoming)) throw new TypeError('state.messages must be an array')
  if (!existing) return { mode: 'replace', messages: incoming }
  if (incoming.length === 0) return { mode: 'replace', messages: incoming }
  const storedCount = repository().messageCount({ scope: existing.scope, projectId: existing.projectId, sessionId: existing.sessionId })
  if (incoming.length < storedCount) return { mode: 'replace', messages: incoming }
  const tail = incoming.slice(storedCount)
  if (tail.length === 0) {
    if (storedCount > 0) {
      const last = repository().readLastMessage({ scope: existing.scope, projectId: existing.projectId, sessionId: existing.sessionId })
      if (last && last.digest !== messageDigest(incoming[storedCount - 1])) {
        return { mode: 'replace', messages: incoming }
      }
      // Same-length in-place edits in the middle keep count and tail digest
      // identical; probe one deterministic middle row so the edit is not
      // silently dropped. A missing row also forces the full rewrite.
      const midSeq = Math.floor(storedCount / 2)
      if (midSeq !== storedCount - 1
        && repository().readMessageDigestAt({ scope: existing.scope, projectId: existing.projectId, sessionId: existing.sessionId, seq: midSeq }) !== messageDigest(incoming[midSeq])) {
        return { mode: 'replace', messages: incoming }
      }
    }
    return { mode: 'body-only' }
  }
  return { mode: 'append', messages: tail }
}

function savePairWithPlan(state, metadata, options, plan, existing) {
  const sessionId = options.sessionId ?? state?.id ?? metadata?.id
  const record = synchronize(state, metadata, sessionId, existing)
  const finalMetadata = { ...record.metadata }
  if (plan.mode === 'replace' || plan.mode === 'append') {
    const fullMessages = Array.isArray(state.messages) ? state.messages : plan.messages
    finalMetadata.messageCount = plan.mode === 'append' ? fullMessages.length : plan.messages.length
    if (finalMetadata.preview === undefined) finalMetadata.preview = previewFromMessages(fullMessages)
  }
  // Pre-encoded rows from savePairChunked skip the synchronous re-encode
  // inside normalizeRecord (internal contract: aligned with plan.messages).
  const carriesEncoded = options.messagesEncoded !== undefined && (plan.mode === 'replace' || plan.mode === 'append')
  const finalRecord = carriesEncoded
    ? { ...record, metadata: finalMetadata, messagesEncoded: options.messagesEncoded }
    : { ...record, metadata: finalMetadata }
  let saved
  if (plan.mode === 'replace') {
    saved = repository().replaceMessages(finalRecord, plan.messages, {
      expectedRevision: options.expectedRevision,
      expectedStateVersion: options.expectedStateVersion,
    })
  } else if (plan.mode === 'append') {
    saved = repository().appendMessages(finalRecord, plan.messages, {
      expectedRevision: options.expectedRevision,
      expectedStateVersion: options.expectedStateVersion,
    })
  } else {
    saved = repository().save(finalRecord, {
      expectedRevision: options.expectedRevision,
      expectedStateVersion: options.expectedStateVersion,
    })
  }
  // Surface the storage plan and the exact persisted message count so
  // agent-manager can maintain its conflict-detection counters without
  // re-reading the message table on every save.
  const totalMessageCount = repository().messageCount({ scope: saved.scope, projectId: saved.projectId, sessionId: saved.sessionId })
  return { ...saved, messageStoragePlan: plan.mode, messageCount: totalMessageCount }
}

function savePair(state, metadata, options = {}) {
  const sessionId = options.sessionId ?? state?.id ?? metadata?.id
  const existing = options.fallback ?? (sessionId ? repository().findBySessionId(sessionId) : null)
  const plan = messageStoragePlan(state, existing)
  return savePairWithPlan(state, metadata, options, plan, existing)
}

// Agent persist path: compute the storage plan, encode the messages the plan
// will write in event-loop-yielding batches (encodeMessagesChunked), then run
// the synchronous transaction on pre-encoded rows. Big replaces no longer
// stall every in-flight request for the full encode duration. Requires a CAS
// expectedRevision: a writer committing between the yields bumps the revision
// and the pre-write CAS check turns that into a SESSION_STATE_CONFLICT retry
// instead of writing rows against a stale plan. Callers without a revision
// guard keep the fully synchronous savePair path.
async function savePairChunked(state, metadata, options = {}) {
  const sessionId = options.sessionId ?? state?.id ?? metadata?.id
  const existing = options.fallback ?? (sessionId ? repository().findBySessionId(sessionId) : null)
  // Freeze the messages snapshot before the yielding encode: the plan and
  // every encode batch read this fresh array, so a caller push during an
  // inter-batch yield can neither extend a later batch nor change the
  // persisted row count — the write stays at the call-time snapshot.
  const messages = Array.isArray(state?.messages) ? state.messages.slice() : state?.messages
  const snapshotState = messages === state?.messages ? state : { ...state, messages }
  const plan = messageStoragePlan(snapshotState, existing)
  if (plan.mode !== 'replace' && plan.mode !== 'append') {
    return savePairWithPlan(state, metadata, options, plan, existing)
  }
  const messagesEncoded = await encodeMessagesChunked(plan.messages)
  return savePairWithPlan(snapshotState, metadata, { ...options, messagesEncoded }, plan, existing)
}

/**
 * Current message representation of a stored session (conflict detection aid):
 * every v2 session is split (`split: true`); `count`/`tailDigest` describe the
 * stored rows (tail digest = row digest of the last message).
 */
export function storedMessagesState(sessionId) {
  const record = repository().findBySessionId(sessionId)
  if (!record) return { split: false, count: 0, tailDigest: '' }
  const count = repository().messageCount({ scope: record.scope, projectId: record.projectId, sessionId })
  let tailDigest = ''
  if (count > 0) {
    tailDigest = repository().readLastMessage({ scope: record.scope, projectId: record.projectId, sessionId })?.digest ?? ''
  }
  return { split: true, count, tailDigest }
}

/**
 * Canonical digest of the last message of an array — matches the row-level
 * `message_digest` written by the repository, so agent-manager can cheaply
 * verify the boundary message on reconnect/conflict checks.
 */
export function sessionMessagesTailDigest(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return ''
  return messageDigest(messages[messages.length - 1])
}

export function readSessionStateRecord(sessionId) {
  return repository().findBySessionId(sessionId)
}

export function readSessionStateValue(sessionId) {
  return assembleState(repository().findBySessionId(sessionId))
}

export function readSessionMetadataValue(sessionId) {
  return repository().findBySessionId(sessionId)?.metadata ?? null
}

function mergeMetadata(existing, update, sessionId) {
  const metadata = { ...existing, ...structuredClone(update), id: sessionId }
  for (const field of ['pinnedAt', 'archivedAt']) {
    if (Object.prototype.hasOwnProperty.call(update, field) && (update[field] === null || update[field] === undefined)) delete metadata[field]
  }
  return metadata
}

function applyMetadataToState(existing, metadata) {
  const state = { ...existing.state }
  for (const field of [
    'title', 'titleSource', 'lastModified', 'stateVersion', 'thinkingLevel', 'harness', 'harnessSessionId',
    'accessMode', 'yoloMode', 'source', 'channelId', 'channelName', 'taskStatus', 'taskStartedAt',
    'taskFinishedAt', 'contextCompaction', 'idleRetention', 'pinnedAt', 'archivedAt',
  ]) {
    if (!Object.prototype.hasOwnProperty.call(metadata, field)) continue
    if ((field === 'pinnedAt' || field === 'archivedAt') && (metadata[field] === undefined || metadata[field] === null)) delete state[field]
    else state[field] = metadata[field]
  }
  return synchronize(state, metadata, existing.sessionId, existing)
}

function metadataBucketChanges(scope, projectId, updateFn) {
  // Metadata-only projection (readSessionMetadataBuckets shape): building the
  // bucket's current map must never materialize state bodies or message rows.
  const current = {}
  for (const bucket of readSessionMetadataBuckets()) {
    if (scope && (bucket.scope !== scope || (scope === 'project' && bucket.projectId !== projectId))) continue
    Object.assign(current, bucket.metadata)
  }
  const updated = updateFn(structuredClone(current))
  if (!isPlainObject(updated)) throw new TypeError('Updated metadata bucket must be a plain object')
  const upserts = []
  const deletes = []
  for (const sessionId of new Set([...Object.keys(current), ...Object.keys(updated)])) {
    const before = current[sessionId]
    const after = updated[sessionId]
    if (JSON.stringify(before) === JSON.stringify(after)) continue
    const existing = repository().findBySessionId(sessionId)
    if (after === undefined) {
      if (existing) deletes.push(existing)
      continue
    }
    if (!existing) {
      const error = new TypeError(`Metadata-only orphan is not allowed: ${sessionId}`)
      error.statusCode = 409
      error.errorCode = 'SESSION_STATE_REQUIRED'
      throw error
    }
    const metadata = mergeMetadata(existing.metadata, after, sessionId)
    upserts.push({ record: applyMetadataToState(existing, metadata), expectedRevision: existing.revision })
  }
  return { updated, upserts, deletes }
}

export function updateSessionMetadataBucket(scope, projectId, updateFn) {
  const changes = metadataBucketChanges(scope, projectId, updateFn)
  if (changes.deletes.length > 0) {
    const error = new TypeError('Metadata bucket updates cannot delete session bodies; use full session delete')
    error.errorCode = 'SESSION_FULL_DELETE_REQUIRED'
    error.statusCode = 409
    throw error
  }
  if (changes.upserts.length > 0) {
    repository().applyBatch({ upserts: changes.upserts })
  }
  return changes.updated
}

export function readSessionStateStore(storeName, { scope, projectId } = {}) {
  // JSON-era provenance: 'sessions-metadata' has always been a metadata-only
  // bucket store ({sessionId: metadata}). Loading it must never materialize
  // state bodies or message rows — read the metadata-only projection straight
  // from the sessions table; without a filter this returns every bucket's map
  // merged, matching the JSON-era merged-store read contract.
  if (storeName === 'sessions-metadata') {
    const merged = {}
    for (const bucket of readSessionMetadataBuckets()) {
      if (scope && (bucket.scope !== scope || (scope === 'project' && bucket.projectId !== projectId))) continue
      Object.assign(merged, bucket.metadata)
    }
    return merged
  }
  const records = repository().exportSnapshot().records.filter((record) => {
    if (!scope) return true
    if (record.scope !== scope) return false
    return scope !== 'project' || record.projectId === projectId
  })
  return Object.fromEntries(records.map((record) => [record.sessionId, storeName === 'sessions' ? assembleState(record) : record.metadata]))
}

// Metadata bucket summaries straight from the authoritative sessions table
// (meta_json projection only — state bodies and message rows are never
// materialized; the historical OOM lesson). Consumed by session-index
// wiring and the storage facade's per-bucket metadata updates.
export function readSessionMetadataBuckets() {
  const rows = storage().prepare('SELECT scope, project_id, session_id, meta_json FROM sessions ORDER BY scope, project_id, session_id').all()
  const buckets = new Map()
  for (const row of rows) {
    const projectId = row.scope === 'project' ? row.project_id : null
    const key = `${row.scope}\0${projectId || ''}`
    if (!buckets.has(key)) buckets.set(key, { scope: row.scope, projectId, metadata: {} })
    buckets.get(key).metadata[row.session_id] = JSON.parse(row.meta_json)
  }
  return [...buckets.values()]
}

export async function saveSessionStatePair({ state, metadata, expectedRevision = null, expectedStateVersion = null } = {}) {
  const resolvedMetadata = metadata ?? deriveMetadata(state)
  if (expectedRevision === null || expectedRevision === undefined) {
    return savePair(state, resolvedMetadata, { expectedRevision, expectedStateVersion })
  }
  return savePairChunked(state, resolvedMetadata, { expectedRevision, expectedStateVersion })
}

export function saveSessionBody(sessionId, value, { expectedRevision = null } = {}) {
  if (!isPlainObject(value)) throw new TypeError('Session body must be a plain object')
  const existing = repository().findBySessionId(sessionId)
  const state = { ...(existing?.state || {}), ...structuredClone(value), id: sessionId }
  const metadata = deriveMetadata(state, existing?.metadata || {})
  return savePair(state, metadata, { sessionId, expectedRevision: expectedRevision ?? existing?.revision ?? 0, fallback: existing })
}

export function saveSessionMetadata(sessionId, value, { expectedRevision = null } = {}) {
  if (!isPlainObject(value)) throw new TypeError('Session metadata must be a plain object')
  const existing = repository().findBySessionId(sessionId)
  if (!existing) {
    const error = new Error(`Session state does not exist: ${sessionId}`)
    error.statusCode = 409
    error.errorCode = 'SESSION_STATE_REQUIRED'
    throw error
  }
  const metadata = mergeMetadata(existing.metadata, value, sessionId)
  const synchronized = applyMetadataToState(existing, metadata)
  return repository().save(synchronized, { expectedRevision: expectedRevision ?? existing.revision })
}

export function deleteSessionState(sessionId, { expectedRevision = null } = {}) {
  const existing = repository().findBySessionId(sessionId)
  if (!existing) return false
  return repository().deleteBySessionId(sessionId, { expectedRevision: expectedRevision ?? existing.revision })
}

export function replaceSessionStateStore(storeName, values) {
  if (!isPlainObject(values)) throw new TypeError('Session store must be a plain object')
  const current = new Map(repository().exportSnapshot().records.map((record) => [record.sessionId, record]))
  const records = []
  if (storeName === 'sessions') {
    for (const [sessionId, state] of Object.entries(values)) {
      if (!isPlainObject(state)) throw new TypeError(`Invalid session body: ${sessionId}`)
      const existing = current.get(sessionId)
      const nextState = { ...(existing?.state || {}), ...state, id: sessionId }
      records.push(synchronize(nextState, deriveMetadata(nextState, existing?.metadata || {}), sessionId, existing))
    }
  } else if (storeName === 'sessions-metadata') {
    if (Object.keys(values).length !== current.size) {
      const error = new TypeError('Metadata replacement cannot create or remove session bodies')
      error.errorCode = 'SESSION_FULL_DELETE_REQUIRED'
      error.statusCode = 409
      throw error
    }
    for (const [sessionId, metadataValue] of Object.entries(values)) {
      const existing = current.get(sessionId)
      if (!existing || !isPlainObject(metadataValue)) {
        const error = new TypeError(`Metadata-only orphan is not allowed: ${sessionId}`)
        error.statusCode = 409
        error.errorCode = 'SESSION_STATE_REQUIRED'
        throw error
      }
      const metadata = mergeMetadata(existing.metadata, metadataValue, sessionId)
      records.push(applyMetadataToState(existing, metadata))
    }
  } else {
    throw new TypeError(`Unsupported session state store: ${storeName}`)
  }
  repository().replaceAll(records)
  return values
}

export async function atomicSessionRecordUpdate(sessionId, updateFn, { maxRetries = 3 } = {}) {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const existing = repository().findBySessionId(sessionId)
    if (!existing) return null
    const updated = await updateFn({
      state: structuredClone(assembleState(existing)),
      metadata: structuredClone(existing.metadata),
      revision: existing.revision,
      stateVersion: existing.stateVersion,
    })
    if (!updated) return existing
    const state = updated.state ?? existing.state
    const metadata = updated.metadata ?? deriveMetadata(state, existing.metadata)
    try {
      return savePair(state, metadata, {
        sessionId,
        expectedRevision: existing.revision,
        fallback: existing,
      })
    } catch (error) {
      if (error?.errorCode !== 'SESSION_STATE_CONFLICT' || attempt === maxRetries - 1) throw error
    }
  }
  return null
}

export async function atomicSessionStateUpdate(sessionId, updateFn, { maxRetries = 3 } = {}) {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const existing = repository().findBySessionId(sessionId)
    if (!existing) return null
    const updated = await updateFn(structuredClone(assembleState(existing)))
    try {
      return savePair(updated, deriveMetadata(updated, existing.metadata), { sessionId, expectedRevision: existing.revision, fallback: existing }).state
    } catch (error) {
      if (error?.errorCode !== 'SESSION_STATE_CONFLICT' || attempt === maxRetries - 1) throw error
    }
  }
  return null
}

export async function atomicSessionMetadataStateUpdate(scope, projectId, updateFn, { maxRetries = 3 } = {}) {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return updateSessionMetadataBucket(scope, projectId, updateFn)
    } catch (error) {
      if (error?.errorCode !== 'SESSION_STATE_CONFLICT' || attempt === maxRetries - 1) throw error
    }
  }
  return null
}

export function applySessionBatch(operations) {
  if (!Array.isArray(operations) || operations.length === 0) throw new TypeError('Session batch operations are required')
  // pi-web-ui's SessionsStore.delete() emits a `sessions` delete AND a
  // `sessions-metadata` delete for the same key in one transaction. The
  // metadata delete is subsumed by the grouped full delete (idempotent no-op);
  // only a metadata delete without a paired body delete stays rejected.
  const fullDeleteKeys = new Set(
    operations
      .filter((operation) => operation?.type === 'delete' && operation?.store === 'sessions')
      .map((operation) => operation.key),
  )
  const grouped = new Map()
  for (const operation of operations) {
    if (!['sessions', 'sessions-metadata'].includes(operation?.store)) throw new TypeError('Session batch only accepts sessions and sessions-metadata')
    if (!['set', 'delete'].includes(operation?.type)) throw new TypeError('Invalid session batch operation')
    if (typeof operation.key !== 'string' || !operation.key) throw new TypeError('Session batch key is required')
    const entry = grouped.get(operation.key) || { sessionId: operation.key }
    if (operation.type === 'delete') {
      if (operation.store === 'sessions-metadata') {
        if (!fullDeleteKeys.has(operation.key)) throw new TypeError('Metadata-only delete is not allowed')
      } else {
        entry.delete = true
      }
    } else if (operation.store === 'sessions') entry.state = operation.value
    else entry.metadata = operation.value
    if (operation.expectedRevision !== undefined) entry.expectedRevision = operation.expectedRevision
    if (operation.expectedStateVersion !== undefined) entry.expectedStateVersion = operation.expectedStateVersion
    grouped.set(operation.key, entry)
  }

  const upserts = []
  const deletes = []
  for (const entry of grouped.values()) {
    const existing = repository().findBySessionId(entry.sessionId)
    if (entry.delete) {
      if (existing) deletes.push({ ...existing, expectedRevision: entry.expectedRevision ?? existing.revision })
      continue
    }
    if (!entry.state && !existing) throw new TypeError(`Session body is required for a new session: ${entry.sessionId}`)
    if (entry.state !== undefined && !isPlainObject(entry.state)) throw new TypeError(`Invalid session body: ${entry.sessionId}`)
    if (entry.metadata !== undefined && !isPlainObject(entry.metadata)) throw new TypeError(`Invalid session metadata: ${entry.sessionId}`)
    const state = { ...(existing?.state || {}), ...(entry.state || {}), id: entry.sessionId }
    const plan = messageStoragePlan(state, existing)
    const derivedMetadata = deriveMetadata(state, existing?.metadata || {})
    const metadata = entry.metadata
      ? mergeMetadata(derivedMetadata, entry.metadata, entry.sessionId)
      : derivedMetadata
    if (plan.mode === 'replace' || plan.mode === 'append') {
      metadata.messageCount = plan.mode === 'append' ? state.messages.length : plan.messages.length
      if (metadata.preview === undefined) metadata.preview = previewFromMessages(state.messages)
    }
    const record = entry.metadata
      ? applyMetadataToState({
          ...(existing || {}),
          state,
          metadata: existing?.metadata || {},
          sessionId: entry.sessionId,
          stateVersion: existing?.stateVersion ?? state.stateVersion ?? metadata.stateVersion ?? 0,
          ...normalizeBucket(state, metadata),
        }, metadata)
      : synchronize(state, metadata, entry.sessionId, existing)
    const upsert = {
      record,
      expectedRevision: entry.expectedRevision ?? existing?.revision ?? 0,
      expectedStateVersion: entry.expectedStateVersion,
    }
    if (plan.mode === 'replace' || plan.mode === 'append') {
      upsert.messages = plan.messages
      upsert.messagesMode = plan.mode
    }
    upserts.push(upsert)
  }
  // An idempotent batch (e.g. deleting sessions that are already gone) still
  // succeeds instead of tripping the repository's empty-change guard.
  if (upserts.length === 0 && deletes.length === 0) return { saved: 0, deleted: 0, revisions: [] }
  const result = repository().applyBatch({ upserts, deletes })
  return { saved: result.saved.length, deleted: result.deleted.filter(Boolean).length, revisions: result.saved.map((record) => ({ sessionId: record.sessionId, revision: record.revision, stateVersion: record.stateVersion })) }
}

export function exportSessionStateSnapshot() {
  const snapshot = repository().exportSnapshot()
  return {
    sessions: Object.fromEntries(snapshot.records.map((record) => [record.sessionId, assembleState(record)])),
    sessionsMetadata: Object.fromEntries(snapshot.records.map((record) => [record.sessionId, record.metadata])),
    count: snapshot.count,
    digest: snapshot.digest,
  }
}

export function normalizeSessionSnapshotValues({ sessions, sessionsMetadata }) {
  if (!isPlainObject(sessions) || !isPlainObject(sessionsMetadata)) throw new TypeError('sessions and sessionsMetadata must be objects')
  const records = []
  for (const [sessionId, state] of Object.entries(sessions)) {
    if (!isPlainObject(state)) throw new TypeError(`Invalid session body: ${sessionId}`)
    const metadata = sessionsMetadata[sessionId]
    records.push(synchronize(state, isPlainObject(metadata) ? metadata : deriveMetadata({ ...state, id: sessionId }), sessionId))
  }
  for (const sessionId of Object.keys(sessionsMetadata)) {
    if (!Object.prototype.hasOwnProperty.call(sessions, sessionId)) throw new TypeError(`Metadata-only orphan is not allowed: ${sessionId}`)
  }
  return records
}

export function replaceSessionStateSnapshot({ sessions, sessionsMetadata }, { merge = false } = {}) {
  if (!isPlainObject(sessions) || !isPlainObject(sessionsMetadata)) throw new TypeError('sessions and sessionsMetadata must be objects')
  const current = merge ? exportSessionStateSnapshot() : { sessions: {}, sessionsMetadata: {} }
  const targetSessions = { ...current.sessions, ...sessions }
  const targetMetadata = { ...current.sessionsMetadata, ...sessionsMetadata }
  const records = normalizeSessionSnapshotValues({ sessions: targetSessions, sessionsMetadata: targetMetadata })
  repository().replaceAll(records)
  return { sessions: records.length, sessionsMetadata: records.length }
}

export function getSessionStateDiagnostics() {
  const state = readSessionStorageState()
  let integrity
  try {
    // Lightweight (SQL-level) integrity: startup diagnostics on large stores
    // must not re-parse every stored body. The result carries
    // `lightweight: true`; full per-row verification stays on maintenance
    // entry points (backup export/restore, downgrade tooling).
    integrity = repository().verifyIntegrity({ quickCheck: true })
  } catch (error) {
    integrity = { ok: false, error: error?.message || String(error) }
  }
  return { ...state, authority: 'sqlite', integrity }
}
