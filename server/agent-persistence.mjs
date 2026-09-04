// agent-manager 模块拆分（agent-manager-module-split）：会话持久化（CAS 权威快照、
// 400ms debounce、慢持久化日志、persist 降级标记）从 agent-manager.mjs 逐字符
// 搬移至此；行为与注释语义保持不变。destroyAgent 仍由 agent-manager.mjs 提供。

import { logger } from './utils/logger.mjs'
import { publishChannelSessionChanged } from './channels/event-relay.mjs'
import { withSessionPersistenceLock } from './session-persistence-lock.mjs'
import {
  readSessionStateRecord,
  saveSessionStatePair,
  deleteSessionState,
  storedMessagesState,
  sessionMessagesTailDigest,
} from './session-state-service.mjs'
import { emitSessionEvent } from './agent-session-events.mjs'
import { AGENT_HARNESS_OPENCODE } from './agent-harness.mjs'

function messageTimestampMs(message) {
  const timestamp = message?.timestamp
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) return timestamp
  if (typeof timestamp === 'string') {
    const trimmed = timestamp.trim()
    if (!trimmed) return undefined
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) return numeric
    const parsed = Date.parse(trimmed)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

function sessionLastModifiedFromMessages(messages, fallback) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const timestamp = messageTimestampMs(messages[index])
    if (timestamp !== undefined) return new Date(timestamp).toISOString()
  }

  const fallbackMs = Date.parse(fallback)
  return Number.isNaN(fallbackMs) ? new Date().toISOString() : new Date(fallbackMs).toISOString()
}

// Fields the agent does not own; a concurrent sidebar pin/archive update is the
// only legitimate way these change between the agent's read and its CAS save.
const SESSION_STORAGE_OWNED_STATE_FIELDS = ['pinnedAt', 'archivedAt']

export function stripStorageOwnedStateFields(state) {
  const next = { ...state }
  for (const field of SESSION_STORAGE_OWNED_STATE_FIELDS) delete next[field]
  return next
}

/**
 * Split-representation conflict check: does the currently stored session match
 * the message state this session last persisted? Non-split sessions carry
 * messages inline in the body, which the caller already compares via
 * persistedStateJson; split sessions need the row count + tail digest because
 * their body excludes messages.
 */
function storedMessagesMatchLastPersist(session) {
  if (session.persistedMessageStorage !== 'split') return true
  if (session.persistedMessageCount === null) return true
  const stored = storedMessagesState(session.sessionId)
  if (!stored) return true
  return stored.count === session.persistedMessageCount
    && stored.tailDigest === session.persistedTailDigest
}

export function canonicalStateJson(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonicalStateJson))
  if (value && typeof value === 'object') {
    return JSON.stringify(
      Object.fromEntries(
        Object.keys(value).sort()
          .filter((key) => value[key] !== undefined)
          .map((key) => [key, canonicalStateJson(value[key])]),
      ),
    )
  }
  return JSON.stringify(value)
}

/**
 * Mark the session as persist-degraded (an authoritative persist was skipped
 * after CAS conflicts) and notify connected clients so the UI can surface a
 * non-blocking warning instead of silently losing messages.
 */
function markPersistDegraded(session, attempts) {
  session.persistDegraded = { at: new Date().toISOString(), attempts }
  emitSessionEvent(session, { type: 'persist_degraded', persistDegraded: true })
}

/**
 * Clear the degraded marker after a successful persist and notify clients so
 * the UI warning disappears.
 */
function clearPersistDegraded(session) {
  if (!session.persistDegraded) return
  session.persistDegraded = null
  emitSessionEvent(session, { type: 'persist_degraded', persistDegraded: false })
}

/**
 * Persist a full session record in one authoritative SQLite transaction with
 * revision CAS. When the CAS fails because a concurrent metadata-only change
 * (pin/archive via the sidebar) bumped the revision, re-read the current row
 * and verify the only difference from what this session last persisted is
 * storage-owned fields; then merge and retry (bounded). If the storage row
 * changed in agent-owned fields, record the conflict and refuse to overwrite
 * the other writer — never fake success by clobbering it.
 * @returns {{state: object, metadata: object, revision: number, stateVersion: number} | null}
 */
async function persistAuthoritativeSessionState(session, sessionData, metadata) {
  const sessionId = session.sessionId
  const maxAttempts = 3
  let lastConflict = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const existing = readSessionStateRecord(sessionId)
    const existingMetadata = existing?.metadata
    const mergedMetadata = {
      ...existingMetadata,
      ...metadata,
      ...(existingMetadata?.archivedAt ? { archivedAt: existingMetadata.archivedAt } : {}),
      ...(existingMetadata?.pinnedAt ? { pinnedAt: existingMetadata.pinnedAt } : {}),
    }
    const persistedState = {
      ...(existing?.state || {}),
      ...sessionData,
      ...(mergedMetadata.archivedAt ? { archivedAt: mergedMetadata.archivedAt } : {}),
      ...(mergedMetadata.pinnedAt ? { pinnedAt: mergedMetadata.pinnedAt } : {}),
    }
    try {
      const saved = await saveSessionStatePair({
        state: persistedState,
        metadata: mergedMetadata,
        expectedRevision: session.persistedStorageRevision ?? existing?.revision ?? 0,
      })
      session.persistedStateJson = canonicalStateJson(stripStorageOwnedStateFields(saved.state))
      // F9 split bookkeeping: the savePair plan tells us exactly which
      // representation was written, so the conflict-detection counters stay in
      // sync with the stored rows (append/replace/body-only on split sessions,
      // inline on small sessions).
      if (saved.state?.messageStorage === 'split') {
        session.persistedMessageStorage = 'split'
        session.persistedMessageCount = saved.messageCount ?? sessionData.messages?.length ?? 0
      } else {
        session.persistedMessageStorage = null
        session.persistedMessageCount = Array.isArray(sessionData.messages) ? sessionData.messages.length : 0
      }
      session.persistedTailDigest = sessionMessagesTailDigest(sessionData.messages)
      clearPersistDegraded(session)
      return { ...saved, metadata: mergedMetadata }
    } catch (error) {
      if (error?.errorCode !== 'SESSION_STATE_CONFLICT') throw error
      lastConflict = error
      const current = readSessionStateRecord(sessionId)
      if (!current) return null
      const previous = session.persistedStateJson
      const bodyUnchanged = previous !== null && canonicalStateJson(stripStorageOwnedStateFields(current.state)) === previous
      // Split sessions keep messages out of the body, so the body comparison
      // alone would miss concurrent message writes. Compare the stored rows
      // (count + tail digest) against what this session last persisted.
      const messagesUnchanged = storedMessagesMatchLastPersist(session)
      if (bodyUnchanged && messagesUnchanged) {
        // Only storage-owned fields changed — adopt the storage row as the new
        // baseline and retry with the fresh revision.
        session.persistedStorageRevision = current.revision
        session.persistedStateVersion = current.stateVersion
        continue
      }
      session.persistConflictCount += 1
      logger.warn(`Session ${sessionId} persist conflict: storage changed agent-owned fields; skipping overwrite`, { sessionId })
      markPersistDegraded(session, attempt)
      return null
    }
  }
  session.persistConflictCount += 1
  logger.warn(`Session ${sessionId} persist still conflicting after ${maxAttempts} merge retries`, { sessionId, reason: lastConflict?.message })
  markPersistDegraded(session, maxAttempts)
  return null
}

/**
 * Persist session data to storage.
 */
async function persistSessionUnlocked(session) {
  const { sessionId, agent, harness, harnessSessionId, scope, projectId, source, channelId, channelName, title, titleSource, createdAt, lastModified: storedLastModified, status, startedAt, finishedAt, model, modelRef, thinkingLevel, accessMode, yoloMode, contextCompaction } = session
  const messages = agent.state.messages

  if (messages.length === 0) {
    try {
      deleteSessionState(sessionId, { expectedRevision: session.persistedStorageRevision })
      session.persistedStorageRevision = null
      session.persistedStateVersion = null
      session.persistedStateJson = null
      session.persistedMessageStorage = null
      session.persistedMessageCount = null
      session.persistedTailDigest = null
    } catch (err) {
      logger.error(`Failed to remove empty session ${sessionId}:`, err, { sessionId })
    }
    return
  }

  const now = new Date().toISOString()
  const lastModified = sessionLastModifiedFromMessages(messages, storedLastModified || createdAt || now)
  const sessionData = {
    id: sessionId,
    title,
    titleSource,
    harness,
    harnessSessionId: agent.harnessSessionId || harnessSessionId || undefined,
    openCodeUsage: harness === AGENT_HARNESS_OPENCODE && agent.state.acpSession?.usage ? agent.state.acpSession.usage : undefined,
    model,
    modelRef: modelRef || undefined,
    thinkingLevel,
    accessMode,
    yoloMode,
    messages,
    createdAt: createdAt || now,
    lastModified,
    scope,
    projectId: scope === 'project' ? projectId : undefined,
    source: source || undefined,
    channelId: channelId || undefined,
    channelName: channelName || undefined,
    taskStatus: status,
    taskStartedAt: startedAt,
    taskFinishedAt: finishedAt,
    contextCompaction: contextCompaction || undefined,
    idleRetention: session.idleRetention || undefined,
    stateVersion: Number.isFinite(session.stateVersion) ? session.stateVersion : 0,
  }
  session.lastModified = lastModified

  // Calculate usage
  let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.usage) {
      usage.input += msg.usage.input ?? 0
      usage.output += msg.usage.output ?? 0
      usage.cacheRead += msg.usage.cacheRead ?? 0
      usage.cacheWrite += msg.usage.cacheWrite ?? 0
      usage.totalTokens += msg.usage.totalTokens ?? 0
    }
  }

  // Generate preview from last assistant message
  let preview = ''
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      const content = messages[i].content
      if (Array.isArray(content)) {
        preview = content
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join(' ')
          .slice(0, 200)
      } else if (typeof content === 'string') {
        preview = content.slice(0, 200)
      }
      break
    }
  }

  const metadata = {
    id: sessionId,
    title,
    titleSource,
    createdAt: createdAt || now,
    lastModified,
    messageCount: messages.length,
    stateVersion: session.stateVersion || 0,
    usage,
    thinkingLevel,
    harness,
    harnessSessionId: agent.harnessSessionId || harnessSessionId || undefined,
    accessMode,
    yoloMode,
    preview,
    scope,
    projectId: scope === 'project' ? projectId : undefined,
    source: source || undefined,
    channelId: channelId || undefined,
    channelName: channelName || undefined,
    taskStatus: status,
    taskStartedAt: startedAt,
    taskFinishedAt: finishedAt,
    contextCompaction: contextCompaction ? {
      compactedAt: contextCompaction.compactedAt,
      compactedUpToIndex: contextCompaction.compactedUpToIndex,
      keepRecentTurns: contextCompaction.keepRecentTurns,
      thresholdPercent: contextCompaction.thresholdPercent,
      usageBefore: contextCompaction.usageBefore,
    } : undefined,
    idleRetention: session.idleRetention || undefined,
  }

  // Write body + metadata as one authoritative SQLite transaction.
  let persistedMetadata
  try {
    const saved = await persistAuthoritativeSessionState(session, sessionData, metadata)
    if (!saved) return null
    session.persistedStorageRevision = saved.revision
    session.persistedStateVersion = saved.stateVersion
    persistedMetadata = saved.metadata
  } catch (err) {
    logger.error(`Failed to persist session ${sessionId}:`, err, { sessionId })
    return null
  }

  if (source === 'acp' && channelId && persistedMetadata) {
    void publishChannelSessionChanged({
      channelId,
      channelName: channelName || undefined,
      sessionId,
      projectId: scope === 'project' ? projectId : null,
      workspace: scope === 'project'
        ? { id: projectId, kind: 'project' }
        : { id: 'default', kind: 'default' },
      change: 'upsert',
      metadata: persistedMetadata,
    })
  }

  return persistedMetadata || metadata
}

// Persist slower than this (queue wait + encode + synchronous SQLite write)
// is worth a warning: large sessions write big synchronous transactions that
// stall the event loop and make every in-flight request (including /restore)
// wait. The 200ms threshold surfaces the real-world distribution, not just
// the extreme tail, so persist optimizations stay measurable.
const SLOW_PERSIST_LOG_MS = 200

// 内部共享导出（模块拆分临时暴露，随 persistence 块迁移后收回）
export async function persistSession(session) {
  const startedAt = performance.now()
  // Serialize per session (per-row revision CAS guarantees correctness);
  // cross-session persists run independently instead of piling onto one
  // global chain that also gates destroyAgent.
  const lockKey = `session:${session.sessionId}`
  const result = await withSessionPersistenceLock(() => persistSessionUnlocked(session), lockKey)
  const durationMs = performance.now() - startedAt
  if (durationMs >= SLOW_PERSIST_LOG_MS) {
    logger.warn(`Session ${session.sessionId} persist took ${Math.round(durationMs)}ms (queue wait + write)`, {
      sessionId: session.sessionId,
      durationMs: Math.round(durationMs),
      messageCount: session.agent?.state?.messages?.length ?? 0,
    })
  }
  return result
}

export async function persistSessionState(session) {
  await flushSessionPersist(session)
}

/**
 * Coalesce fire-and-forget session persists during a run.
 *
 * persistSession() serializes the ENTIRE session (all messages) on every call,
 * and the agent event loop calls it on agent_start / each message_end / agent_end.
 * Within a single run these events fire many times (one per assistant turn +
 * tool result), so writing on each one makes cumulative disk I/O O(n^2) as a
 * conversation grows. These message_end call sites are fire-and-forget
 * (crash-recovery only), so we debounce them into at most one write per
 * PERSIST_DEBOUNCE_MS. Run boundaries (agent_end) and explicit persists cancel
 * the pending timer and write the current state immediately, so the final
 * state is always durable.
 */
const PERSIST_DEBOUNCE_MS = 400

export function scheduleSessionPersist(session) {
  if (session.persistTimer) return
  session.persistTimer = setTimeout(() => {
    session.persistTimer = null
    persistSession(session).catch((err) =>
      logger.error(`Failed to persist session ${session.sessionId}:`, err, { sessionId: session.sessionId }),
    )
  }, PERSIST_DEBOUNCE_MS).unref?.()
}

/**
 * Cancel any pending debounced write and persist the current state immediately.
 * Used at run boundaries (agent_end) and by explicit persistSessionState() so
 * the final state is always durable regardless of a pending timer.
 */
export async function flushSessionPersist(session) {
  if (session.persistTimer) {
    clearTimeout(session.persistTimer)
    session.persistTimer = null
  }
  return persistSession(session)
}
