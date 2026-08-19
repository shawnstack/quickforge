import { createSessionStateRepository, MESSAGES_PAGE_LIMIT_MAX, MESSAGES_SPLIT_VALUE, messageDigest } from './sqlite/session-state-repository.mjs'
import { getSqliteStorage } from './sqlite/database.mjs'

export const SESSION_STORAGE_PHASES = Object.freeze({
  JSON_AUTHORITATIVE: 'json_authoritative',
  CUTOVER_RUNNING: 'cutover_running',
  JSON_PENDING: 'sqlite_authoritative_json_pending',
  AUTHORITATIVE: 'authoritative',
})

// F9 split-on-write gate: sessions whose message array reaches this length are
// stored incrementally in `session_messages` (body keeps only the split
// marker). Sessions below the threshold stay inline for backward compatibility.
export const MESSAGES_SPLIT_THRESHOLD = 200

// Mirror drain page size: the queue rows carry full state_json payloads, so
// the drain pulls a bounded batch at a time instead of loading the whole
// outbox (large cutover imports can enqueue thousands of entries).
const MIRROR_DRAIN_BATCH_LIMIT = 8

let repositoryInstance = null
let cachedPhase = SESSION_STORAGE_PHASES.JSON_AUTHORITATIVE
let jsonAdapter = null
let mirrorAdapter = null
let drainPromise = null
let mirrorTimer = null
const MIRROR_DRAIN_INTERVAL_MS = 1000

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
  if (!repositoryInstance) repositoryInstance = createSessionStateRepository(storage())
  return repositoryInstance
}

function stateRow() {
  return storage().prepare('SELECT * FROM session_storage_state WHERE singleton = 1').get()
}

function sqliteReadable() {
  return cachedPhase === SESSION_STORAGE_PHASES.JSON_PENDING || cachedPhase === SESSION_STORAGE_PHASES.AUTHORITATIVE
}

function requireJsonAdapter(method) {
  if (typeof jsonAdapter?.[method] !== 'function') throw new Error(`JSON authoritative session adapter does not implement ${method}`)
  return jsonAdapter[method].bind(jsonAdapter)
}

export function configureSessionStateService({ repository: configuredRepository, json, mirror, phase } = {}) {
  if (configuredRepository !== undefined) repositoryInstance = configuredRepository
  if (json !== undefined) jsonAdapter = json
  if (mirror !== undefined) mirrorAdapter = mirror
  if (phase !== undefined) {
    if (!Object.values(SESSION_STORAGE_PHASES).includes(phase)) throw new TypeError(`Invalid session storage phase: ${phase}`)
    cachedPhase = phase
  }
}

export function setSessionStoragePhase(phase, values = {}) {
  if (!Object.values(SESSION_STORAGE_PHASES).includes(phase)) throw new TypeError(`Invalid session storage phase: ${phase}`)
  const updatedAt = new Date().toISOString()
  storage().prepare(`UPDATE session_storage_state SET phase = ?, state_count = ?, digest = ?, backup_file = ?, diagnostic_json = ?, updated_at = ? WHERE singleton = 1`)
    .run(phase, values.stateCount ?? null, values.digest ?? null, values.backupFile ?? null, values.diagnostic ? JSON.stringify(values.diagnostic) : null, updatedAt)
  cachedPhase = phase
  return readSessionStorageState()
}

export function readSessionStorageState() {
  const row = stateRow()
  if (!row) throw new Error('Session storage state is missing')
  cachedPhase = row.phase
  return {
    phase: row.phase,
    stateCount: row.state_count === null ? null : Number(row.state_count),
    digest: row.digest,
    backupFile: row.backup_file,
    diagnostic: row.diagnostic_json ? JSON.parse(row.diagnostic_json) : null,
    updatedAt: row.updated_at,
  }
}

export function initializeSessionStateService() {
  return readSessionStorageState()
}

export function getSessionStoragePhase() {
  return cachedPhase
}

export function isSessionStateAuthoritative() {
  return sqliteReadable()
}

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
  const state = structuredClone(stateValue)
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
// currently stored session:
// - inline: legacy whole-body storage (body keeps its `messages` array).
// - body-only: split session whose messages are unchanged; body/metadata saved.
// - replace: full message rewrite (first split / truncation / boundary change).
// - append: only the new tail rows are written (incremental).
function messageStoragePlan(state, existing) {
  const incoming = state?.messages
  const isSplit = existing?.state?.messageStorage === MESSAGES_SPLIT_VALUE
  if (incoming === undefined) return isSplit ? { mode: 'body-only' } : { mode: 'inline' }
  if (!Array.isArray(incoming)) throw new TypeError('state.messages must be an array')
  if (isSplit) {
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
  if (incoming.length === 0) return { mode: 'inline' }
  if (incoming.length >= MESSAGES_SPLIT_THRESHOLD) return { mode: 'replace', messages: incoming }
  return { mode: 'inline' }
}

function scheduleSessionJsonMirrorDrain() {
  if (!sqliteReadable() || !mirrorAdapter || mirrorTimer) return
  mirrorTimer = setTimeout(() => {
    mirrorTimer = null
    void drainSessionJsonMirror().then(({ pending }) => {
      if (pending > 0) scheduleSessionJsonMirrorDrain()
    }).catch(() => {
      scheduleSessionJsonMirrorDrain()
    })
  }, MIRROR_DRAIN_INTERVAL_MS)
  mirrorTimer.unref?.()
}

export function requestSessionJsonMirrorDrain() {
  scheduleSessionJsonMirrorDrain()
}

export function stopSessionStateService() {
  if (mirrorTimer) clearTimeout(mirrorTimer)
  mirrorTimer = null
}

function savePair(state, metadata, options = {}) {
  const sessionId = options.sessionId ?? state?.id ?? metadata?.id
  const existing = options.fallback ?? (sessionId ? repository().findBySessionId(sessionId) : null)
  const plan = messageStoragePlan(state, existing)
  const record = synchronize(state, metadata, sessionId, existing)
  const finalMetadata = { ...record.metadata }
  if (plan.mode === 'inline') {
    if (Array.isArray(state.messages)) {
      finalMetadata.messageCount = state.messages.length
      if (finalMetadata.preview === undefined) finalMetadata.preview = previewFromMessages(state.messages)
    }
  } else if (plan.mode === 'replace' || plan.mode === 'append') {
    const fullMessages = Array.isArray(state.messages) ? state.messages : plan.messages
    finalMetadata.messageCount = plan.mode === 'append' ? fullMessages.length : plan.messages.length
    if (finalMetadata.preview === undefined) finalMetadata.preview = previewFromMessages(fullMessages)
  }
  const finalRecord = { ...record, metadata: finalMetadata }
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
  requestSessionJsonMirrorDrain()
  // F9 Phase 3: surface the storage plan and the exact persisted message count
  // so agent-manager can maintain its conflict-detection counters without
  // re-reading the message table on every save.
  const totalMessageCount = plan.mode === 'inline'
    ? (Array.isArray(state.messages) ? state.messages.length : finalMetadata.messageCount)
    : repository().messageCount({ scope: saved.scope, projectId: saved.projectId, sessionId: saved.sessionId })
  return { ...saved, messageStoragePlan: plan.mode, messageCount: totalMessageCount }
}

/**
 * Current message representation of a stored session (conflict detection aid):
 * - `split`: messages live in `session_messages`; `count`/`tailDigest` describe
 *   the stored rows (tail digest = row digest of the last message).
 * - non-split: messages are inline in the body; `count`/`tailDigest` are derived
 *   from the body for parity, but agent-manager conflict detection relies on the
 *   body canonical comparison in that case.
 */
export function storedMessagesState(sessionId) {
  if (!sqliteReadable()) return { split: false, count: 0, tailDigest: '' }
  const record = repository().findBySessionId(sessionId)
  if (!record) return { split: false, count: 0, tailDigest: '' }
  if (record.state?.messageStorage !== MESSAGES_SPLIT_VALUE) {
    const messages = Array.isArray(record.state.messages) ? record.state.messages : []
    return { split: false, count: messages.length, tailDigest: messages.length ? messageDigest(messages[messages.length - 1]) : '' }
  }
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
  if (!sqliteReadable()) return requireJsonAdapter('readRecord')(sessionId)
  return repository().findBySessionId(sessionId)
}

export function readSessionStateValue(sessionId) {
  if (!sqliteReadable()) return requireJsonAdapter('readState')(sessionId)
  return assembleState(repository().findBySessionId(sessionId))
}

export function readSessionMetadataValue(sessionId) {
  if (!sqliteReadable()) return requireJsonAdapter('readMetadata')(sessionId)
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
  const snapshot = repository().exportSnapshot().records.filter((record) => !scope || (record.scope === scope && (scope !== 'project' || record.projectId === projectId)) )
  const current = Object.fromEntries(snapshot.map((record) => [record.sessionId, structuredClone(record.metadata)]))
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
  if (!sqliteReadable()) return requireJsonAdapter('updateMetadataBucket')(scope, projectId, updateFn)
  const changes = metadataBucketChanges(scope, projectId, updateFn)
  if (changes.deletes.length > 0) {
    const error = new TypeError('Metadata bucket updates cannot delete session bodies; use full session delete')
    error.errorCode = 'SESSION_FULL_DELETE_REQUIRED'
    error.statusCode = 409
    throw error
  }
  if (changes.upserts.length > 0) {
    repository().applyBatch({ upserts: changes.upserts })
    requestSessionJsonMirrorDrain()
  }
  return changes.updated
}

export function readSessionStateStore(storeName, { scope, projectId } = {}) {
  if (!sqliteReadable()) return requireJsonAdapter('readStore')(storeName, { scope, projectId })
  const records = repository().exportSnapshot().records.filter((record) => {
    if (!scope) return true
    if (record.scope !== scope) return false
    return scope !== 'project' || record.projectId === projectId
  })
  return Object.fromEntries(records.map((record) => [record.sessionId, storeName === 'sessions' ? assembleState(record) : record.metadata]))
}

// session_index readiness source in SQLite-readable phases: bucket-shaped
// metadata read straight from the authoritative store — the same store whose
// repository maintains session_index transactionally — so a lagging JSON
// mirror (pending drain) never flaps index readiness. Only metadata_json is
// loaded; state bodies and message rows stay untouched.
export function readSessionMetadataBuckets() {
  if (!sqliteReadable()) throw new Error('Session metadata buckets require a SQLite-readable phase')
  const rows = storage().prepare('SELECT scope, project_id, session_id, metadata_json FROM session_states ORDER BY scope, project_id, session_id').all()
  const buckets = new Map()
  for (const row of rows) {
    const projectId = row.scope === 'project' ? row.project_id : null
    const key = `${row.scope}\0${projectId || ''}`
    if (!buckets.has(key)) buckets.set(key, { scope: row.scope, projectId, metadata: {} })
    buckets.get(key).metadata[row.session_id] = JSON.parse(row.metadata_json)
  }
  return [...buckets.values()]
}

export function saveSessionStatePair({ state, metadata, expectedRevision = null, expectedStateVersion = null } = {}) {
  if (!sqliteReadable()) return requireJsonAdapter('savePair')({ state, metadata, expectedRevision, expectedStateVersion })
  return savePair(state, metadata ?? deriveMetadata(state), { expectedRevision, expectedStateVersion })
}

export function saveSessionBody(sessionId, value, { expectedRevision = null } = {}) {
  if (!isPlainObject(value)) throw new TypeError('Session body must be a plain object')
  if (!sqliteReadable()) return requireJsonAdapter('saveBody')(sessionId, value, { expectedRevision })
  const existing = repository().findBySessionId(sessionId)
  const state = { ...(existing?.state || {}), ...structuredClone(value), id: sessionId }
  const metadata = deriveMetadata(state, existing?.metadata || {})
  return savePair(state, metadata, { sessionId, expectedRevision: expectedRevision ?? existing?.revision ?? 0, fallback: existing })
}

export function saveSessionMetadata(sessionId, value, { expectedRevision = null } = {}) {
  if (!isPlainObject(value)) throw new TypeError('Session metadata must be a plain object')
  if (!sqliteReadable()) return requireJsonAdapter('saveMetadata')(sessionId, value, { expectedRevision })
  const existing = repository().findBySessionId(sessionId)
  if (!existing) {
    const error = new Error(`Session state does not exist: ${sessionId}`)
    error.statusCode = 409
    error.errorCode = 'SESSION_STATE_REQUIRED'
    throw error
  }
  const metadata = mergeMetadata(existing.metadata, value, sessionId)
  const synchronized = applyMetadataToState(existing, metadata)
  const saved = repository().save(synchronized, { expectedRevision: expectedRevision ?? existing.revision })
  requestSessionJsonMirrorDrain()
  return saved
}

export function deleteSessionState(sessionId, { expectedRevision = null } = {}) {
  if (!sqliteReadable()) return requireJsonAdapter('delete')(sessionId, { expectedRevision })
  const existing = repository().findBySessionId(sessionId)
  if (!existing) return false
  const deleted = repository().deleteBySessionId(sessionId, { expectedRevision: expectedRevision ?? existing.revision })
  requestSessionJsonMirrorDrain()
  return deleted
}

export function replaceSessionStateStore(storeName, values) {
  if (!isPlainObject(values)) throw new TypeError('Session store must be a plain object')
  if (!sqliteReadable()) return requireJsonAdapter('replaceStore')(storeName, values)
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
  requestSessionJsonMirrorDrain()
  return values
}

export async function atomicSessionRecordUpdate(sessionId, updateFn, { maxRetries = 3 } = {}) {
  if (!sqliteReadable()) return requireJsonAdapter('atomicRecordUpdate')(sessionId, updateFn)
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
  if (!sqliteReadable()) return requireJsonAdapter('atomicStateUpdate')(sessionId, updateFn)
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
  if (!sqliteReadable()) return requireJsonAdapter('atomicMetadataUpdate')(scope, projectId, updateFn)
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
  if (!sqliteReadable()) return requireJsonAdapter('applyBatch')(operations)
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
  requestSessionJsonMirrorDrain()
  return { saved: result.saved.length, deleted: result.deleted.filter(Boolean).length, revisions: result.saved.map((record) => ({ sessionId: record.sessionId, revision: record.revision, stateVersion: record.stateVersion })) }
}

export function exportSessionStateSnapshot() {
  if (!sqliteReadable()) return requireJsonAdapter('exportSnapshot')()
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
  if (!sqliteReadable()) return requireJsonAdapter('replaceSnapshot')({ sessions, sessionsMetadata }, { merge })
  const current = merge ? exportSessionStateSnapshot() : { sessions: {}, sessionsMetadata: {} }
  const targetSessions = { ...current.sessions, ...sessions }
  const targetMetadata = { ...current.sessionsMetadata, ...sessionsMetadata }
  const records = normalizeSessionSnapshotValues({ sessions: targetSessions, sessionsMetadata: targetMetadata })
  repository().replaceAll(records)
  requestSessionJsonMirrorDrain()
  return { sessions: records.length, sessionsMetadata: records.length }
}

export async function drainSessionJsonMirror() {
  if (drainPromise) return drainPromise
  drainPromise = (async () => {
    if (!mirrorAdapter) return { drained: 0, pending: repository().countMirrorQueue(), deadLetters: repository().countMirrorDeadLetters() }
    let drained = 0
    // Page through the outbox in small batches. A failed entry gets its
    // updated_at bumped by failMirror, so it sorts behind the remaining
    // entries and the next page drains others first; entries that keep
    // failing are retried by the scheduled drain until attempts are exhausted
    // (MIRROR_MAX_ATTEMPTS), after which they stay queued as dead letters and
    // no longer block pending. A batch with zero acknowledgements stops the
    // loop (no head-of-line livelock).
    for (;;) {
      const batch = repository().listMirrorQueue({ limit: MIRROR_DRAIN_BATCH_LIMIT })
      if (batch.length === 0) break
      // Coalesce by session key: only the newest queued operation per key is
      // worth materializing (a delete landing after an upsert wins by sort
      // order). The queue is keyed per session, so this mainly guards the
      // snapshot against saves landing mid-drain.
      const latestByKey = new Map()
      for (const entry of batch) {
        latestByKey.set(`${entry.scope}${entry.projectId || ''}${entry.sessionId}`, entry)
      }
      let acknowledged = 0
      for (const entry of latestByKey.values()) {
        try {
          // A save that landed after the batch snapshot supersedes this entry;
          // skip the (potentially expensive) materialization — the newer
          // payload drains in a later round.
          if (repository().mirrorQueueRevision(entry) !== entry.revision) continue
          if (entry.operation === 'upsert') {
            const state = entry.state?.messageStorage === MESSAGES_SPLIT_VALUE
              ? { ...entry.state, messages: allMessages(entry) }
              : entry.state
            await mirrorAdapter.upsert({ ...entry, state })
          } else {
            await mirrorAdapter.delete(entry)
          }
          // acknowledgeMirror deletes by (key, revision): a false result means
          // a newer save replaced the row mid-materialization; leave it queued
          // so the newer payload is drained instead of counting stale work.
          if (repository().acknowledgeMirror(entry)) {
            drained += 1
            acknowledged += 1
          }
        } catch (error) {
          repository().failMirror(entry, error)
        }
      }
      if (acknowledged === 0) break
    }
    return { drained, pending: repository().countMirrorQueue(), deadLetters: repository().countMirrorDeadLetters() }
  })().finally(() => { drainPromise = null })
  const result = await drainPromise
  if (result.pending > 0) scheduleSessionJsonMirrorDrain()
  return result
}

export function getSessionStateDiagnostics() {
  const state = (() => {
    try { return readSessionStorageState() } catch { return { phase: cachedPhase } }
  })()
  if (!sqliteReadable()) return { ...state, authority: 'json', integrity: null, mirrorPending: null, mirrorDeadLetters: null }
  let integrity
  let mirrorPending = null
  let mirrorDeadLetters = null
  try {
    // Lightweight (SQL-level) integrity: startup diagnostics on large stores
    // must not re-parse every stored body. The result carries
    // `lightweight: true`; full per-row verification stays on maintenance
    // entry points (backup export/restore, downgrade tooling).
    integrity = repository().verifyIntegrity({ quickCheck: true })
    mirrorPending = repository().countMirrorQueue()
    mirrorDeadLetters = repository().countMirrorDeadLetters()
  } catch (error) {
    integrity = { ok: false, error: error?.message || String(error) }
  }
  return { ...state, authority: 'sqlite', integrity, mirrorPending, mirrorDeadLetters }
}
