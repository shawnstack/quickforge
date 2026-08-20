import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { readStore, writeStore, atomicUpdate, getComparable, getStoreRevision, readSessionStoreScoped, readSessionValue, writeSessionValueWithMetadata, deleteSessionWithMetadata, applySessionBatch, ensureStorage, dataDir, configDir, storageDir, cacheDir, logsDir } from '../storage.mjs'
import { AUTO_ARCHIVE_SETTINGS_KEY, archiveInactiveSessions, normalizeAutoArchiveSettings } from '../auto-archive.mjs'
import { refreshAllSessionModels, destroyAgent } from '../agent-manager.mjs'
import { logger } from '../utils/logger.mjs'
import { directorySize } from '../utils/workspace.mjs'
import { isAuthenticatedAppClient } from '../access-policy.mjs'
import { querySessionIndexPage } from '../session-index-service.mjs'
import { isSessionStateMaintenanceActive } from '../session-state-maintenance.mjs'
import { isSessionStateAuthoritative } from '../session-state-service.mjs'
import { verifySessionStateIntegrityForMaintenance } from '../session-state-backup.mjs'

const metadataIndexCache = new Map()
const MAX_METADATA_INDEX_CACHE_ENTRIES = 50
const METADATA_INDEX_CACHE_TTL_MS = 1000
const SESSION_QUERY_INDEXES = new Set(['createdAt', 'lastModified', 'pinnedAt'])

// In-memory agent disposal used when sessions are deleted from storage.
// destroyAgent performs a final persist, so deletions must destroy the agent
// BEFORE removing persisted state — otherwise the final persist resurrects
// the deleted row. Tests inject a spy through configureStorageSessionAgentDisposal.
let destroyAgentForSession = destroyAgent

export function configureStorageSessionAgentDisposal({ destroy } = {}) {
  destroyAgentForSession = destroy ?? destroyAgent
}

function parseSqlPagination(limitParam, offsetParam) {
  if (!limitParam || !/^[1-9]\d*$/.test(limitParam)) return null
  if (offsetParam !== null && !/^(?:0|[1-9]\d*)$/.test(offsetParam)) return null
  const limit = Number(limitParam)
  const offset = offsetParam === null ? 0 : Number(offsetParam)
  if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(offset)) return null
  return { limit, offset }
}

function sqlSessionQueryOptions({ store, indexName, directionParam, scope, projectId, archived, pinned, limitParam, offsetParam }) {
  if (store !== 'sessions-metadata' || !SESSION_QUERY_INDEXES.has(indexName)) return null
  if (directionParam !== null && directionParam !== 'asc' && directionParam !== 'desc') return null
  if (archived !== null && archived !== 'only' && archived !== 'include') return null
  if (pinned !== null && pinned !== 'only') return null
  const pagination = parseSqlPagination(limitParam, offsetParam)
  if (!pagination) return null

  let scopeMode = 'all'
  if (scope === 'global' && !projectId) scopeMode = 'global'
  else if (scope === 'project' && typeof projectId === 'string' && projectId.length > 0) scopeMode = 'project'
  else if ((scope === 'projects' || scope === 'project-all') && !projectId) scopeMode = 'projects'
  else if (scope !== null || projectId !== null) return null

  return {
    ...pagination,
    scopeMode,
    projectId: scopeMode === 'project' ? projectId : null,
    archive: archived === 'only' ? 'only' : archived === 'include' ? 'include' : 'exclude',
    pinnedOnly: pinned === 'only',
    sort: indexName,
    direction: directionParam === 'desc' ? 'desc' : 'asc',
  }
}

function metadataIndexCacheKey({ scope, projectId, indexName, direction, archived, pinned }) {
  return JSON.stringify({ scope: scope || '', projectId: projectId || '', indexName, direction, archived: archived || '', pinned: pinned || '' })
}

function isProjectAggregateScope(scope) {
  return scope === 'projects' || scope === 'project-all'
}

function isValidPinnedAt(value) {
  if (typeof value !== 'string') return false
  const normalized = value.trim()
  if (!normalized || normalized === 'undefined' || normalized === 'null' || normalized === 'false') return false
  return !Number.isNaN(Date.parse(normalized))
}

function sortIndexedValues(values, store, indexName, direction) {
  values.sort((a, b) => {
    if (store === 'sessions-metadata' && (indexName === 'lastModified' || indexName === 'createdAt')) {
      const leftPinned = getComparable(a, 'pinnedAt')
      const rightPinned = getComparable(b, 'pinnedAt')
      if (leftPinned !== rightPinned) {
        if (leftPinned === undefined || leftPinned === null) return 1
        if (rightPinned === undefined || rightPinned === null) return -1
        return -String(leftPinned).localeCompare(String(rightPinned))
      }
    }

    const left = getComparable(a, indexName)
    const right = getComparable(b, indexName)
    if (left === right) return 0
    if (left === undefined || left === null) return direction === 'desc' ? 1 : -1
    if (right === undefined || right === null) return direction === 'desc' ? -1 : 1
    const result = String(left).localeCompare(String(right))
    return direction === 'desc' ? -result : result
  })
  return values
}

async function readIndexedValues(store, indexName, direction, scope, projectId, archived, pinned) {
  if (store !== 'sessions-metadata') {
    let data
    if (scope && store === 'sessions') {
      data = await readSessionStoreScoped(store, scope, scope === 'project' ? projectId : undefined)
    } else {
      data = await readStore(store)
    }
    return sortIndexedValues(Object.values(data), store, indexName, direction)
  }

  const revision = getStoreRevision(store)
  const key = metadataIndexCacheKey({ scope, projectId, indexName, direction, archived, pinned })
  const cached = metadataIndexCache.get(key)
  const now = Date.now()
  if (cached && cached.revision === revision && now - cached.cachedAt < METADATA_INDEX_CACHE_TTL_MS) return cached.values

  const projectAggregateScope = isProjectAggregateScope(scope)
  const data = projectAggregateScope
    ? await readStore(store)
    : scope
      ? await readSessionStoreScoped(store, scope, scope === 'project' ? projectId : undefined)
      : await readStore(store)
  const values = sortIndexedValues(
    Object.values(data)
      .filter((value) => !projectAggregateScope || (value?.scope === 'project' && value?.projectId))
      .filter((value) => value?.messageCount !== 0)
      .filter((value) => {
        if (archived === 'only') return Boolean(value?.archivedAt)
        if (archived === 'include') return true
        return !value?.archivedAt
      })
      .filter((value) => {
        if (pinned === 'only') return isValidPinnedAt(value?.pinnedAt)
        return true
      }),
    store,
    indexName,
    direction,
  )

  metadataIndexCache.set(key, { revision, values, cachedAt: now })
  if (metadataIndexCache.size > MAX_METADATA_INDEX_CACHE_ENTRIES) {
    const firstKey = metadataIndexCache.keys().next().value
    if (firstKey) metadataIndexCache.delete(firstKey)
  }
  return values
}

export async function handleStorageApi(req, res, url, context = { isLocalRequest: true }) {
  if (!isAuthenticatedAppClient(context)) {
    const error = new Error('Storage access requires a local or authenticated remote client.')
    error.statusCode = 403
    error.errorCode = 'storage_auth_required'
    throw error
  }

  const parts = url.pathname.split('/').filter(Boolean)

  if (req.method === 'GET' && url.pathname === '/api/storage/quota') {
    const [usage, configUsage, storageUsage, cacheUsage, logsUsage] = await Promise.all([
      directorySize(dataDir),
      directorySize(configDir),
      directorySize(storageDir),
      directorySize(cacheDir),
      directorySize(logsDir),
    ])
    sendJson(res, 200, { usage, configUsage, storageUsage, cacheUsage, logsUsage, quota: 0, percent: 0 })
    return
  }

  if (parts[0] !== 'api' || parts[1] !== 'storage') {
    const error = new Error('Not found')
    error.statusCode = 404
    throw error
  }

  const store = decodeSegment(parts[2])

  // Session batch transaction endpoint: one request commits a set/delete mix
  // across `sessions` and `sessions-metadata` as a single SQLite transaction
  // (authoritative). expectedStateVersion is optional per operation.
  if (req.method === 'POST' && parts.length === 3 && store === 'batch') {
    if (isSessionStateMaintenanceActive()) {
      const error = new Error('Session storage maintenance is in progress')
      error.statusCode = 423
      error.errorCode = 'SESSION_STORAGE_MAINTENANCE'
      throw error
    }
    const body = await readJsonBody(req)
    const operations = body?.operations
    if (!Array.isArray(operations) || operations.length === 0) {
      const error = new Error('Session batch operations are required')
      error.statusCode = 400
      throw error
    }
    try {
      // Destroy in-memory agents for deleted sessions BEFORE removing the
      // persisted state: destroyAgent's final persist would otherwise
      // resurrect the deleted row right after the batch commit.
      for (const operation of operations) {
        if (operation?.type !== 'delete' || operation?.store !== 'sessions') continue
        try {
          await destroyAgentForSession(operation.key)
        } catch (error) {
          logger.warn(`Failed to destroy in-memory agent for deleted session ${operation.key}:`, error?.message || error)
        }
      }
      const result = await applySessionBatch(operations)
      sendJson(res, 200, { ok: true, saved: result?.saved ?? 0, deleted: result?.deleted ?? 0 })
    } catch (error) {
      if (['SESSION_STATE_CONFLICT', 'SESSION_STATE_DUPLICATE_ID', 'SESSION_STATE_REQUIRED', 'SESSION_FULL_DELETE_REQUIRED'].includes(error?.errorCode)) {
        error.statusCode = 409
        throw error
      }
      if (error instanceof TypeError) {
        const mapped = new Error(error.message)
        mapped.statusCode = 400
        throw mapped
      }
      throw error
    }
    return
  }

  // Manual session state integrity verification (design review suggestion
  // 9): startup only runs the lightweight SQL-level check, so per-row digest
  // rot would stay invisible until an offline full verification. POST with
  // { full: true } runs the complete per-row digest recomputation under the
  // session state maintenance lock (same pattern as the authoritative backup
  // export); the response carries only summary counters and the elapsed
  // time, never row payloads.
  if (req.method === 'POST' && parts.length === 4 && store === 'maintenance' && parts[3] === 'verify-session-integrity') {
    if (!isSessionStateAuthoritative()) {
      const error = new Error('Session state integrity verification requires authoritative SQLite storage')
      error.statusCode = 409
      error.errorCode = 'SESSION_STATE_NOT_AUTHORITATIVE'
      throw error
    }
    if (isSessionStateMaintenanceActive()) {
      const error = new Error('Session storage maintenance is in progress')
      error.statusCode = 423
      error.errorCode = 'SESSION_STORAGE_MAINTENANCE'
      throw error
    }
    const body = await readJsonBody(req)
    // forceQuickCheck: the manual endpoint always runs a real quick_check scan
    // (never the startup process-cache/marker shortcut).
    const result = await verifySessionStateIntegrityForMaintenance({ full: body?.full === true, forceQuickCheck: true, maintenance: true })
    sendJson(res, 200, result)
    return
  }

  if (req.method === 'GET' && parts[3] === 'keys') {
    const prefix = url.searchParams.get('prefix') || ''
    const data = await readStore(store)
    const keys = Object.keys(data).filter((key) => !prefix || key.startsWith(prefix))
    sendJson(res, 200, { keys })
    return
  }

  if (req.method === 'GET' && parts[3] === 'index') {
    const indexName = decodeSegment(parts[4])
    const directionParam = url.searchParams.get('direction')
    const direction = directionParam === 'desc' ? 'desc' : 'asc'
    const scope = url.searchParams.get('scope')
    const projectId = url.searchParams.get('projectId')
    const limitParam = url.searchParams.get('limit')
    const offsetParam = url.searchParams.get('offset')
    const archived = url.searchParams.get('archived')
    const pinned = url.searchParams.get('pinned')

    await ensureStorage()

    const sqlOptions = sqlSessionQueryOptions({
      store, indexName, directionParam, scope, projectId, archived, pinned, limitParam, offsetParam,
    })
    // Storage v2: sessions-metadata queries eligible for SQL LIMIT/OFFSET are
    // served straight from the authoritative sessions table (no JSON shadow —
    // the SQLite projection IS the store). Everything else keeps the legacy
    // read+sort path (which also reads from SQLite through the facade).
    if (sqlOptions) {
      const sqlResult = await querySessionIndexPage(sqlOptions)
      if (sqlResult.ok) {
        sendJson(res, 200, { values: sqlResult.page.values, total: sqlResult.page.total })
        return
      }
    }

    const values = await readIndexedValues(store, indexName, direction, scope, projectId, archived, pinned)

    const total = values.length
    const limit = limitParam ? parseInt(limitParam, 10) : undefined
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0

    if (limit && limit > 0) {
      sendJson(res, 200, { values: values.slice(offset, offset + limit), total })
    } else {
      sendJson(res, 200, { values, total })
    }
    return
  }

  if (req.method === 'DELETE' && parts.length === 3) {
    await writeStore(store, {})
    if (store === 'custom-providers') {
      try {
        await refreshAllSessionModels()
      } catch (error) {
        logger.error('Failed to refresh session models after clearing custom-providers:', error)
      }
    }
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === 'GET' && parts[3] === 'has') {
    const key = decodeSegment(parts[4])
    const data = await readStore(store)
    sendJson(res, 200, { exists: Object.prototype.hasOwnProperty.call(data, key) })
    return
  }

  if (parts[3] === 'key') {
    const key = decodeSegment(parts[4])
    if (!key) {
      const error = new Error('Missing storage key')
      error.statusCode = 400
      throw error
    }

    if (req.method === 'GET') {
      if (store === 'sessions') {
        sendJson(res, 200, { value: await readSessionValue(key) })
        return
      }

      const data = await readStore(store)
      sendJson(res, 200, { value: Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null })
      return
    }

    if (req.method === 'PUT') {
      const body = await readJsonBody(req)
      if (store === 'sessions') {
        // Single-session PUT writes the body and derives/merges metadata so it
        // never leaves a body orphaned (one SQLite transaction when authoritative).
        await writeSessionValueWithMetadata(key, body?.value)
        sendJson(res, 200, { ok: true })
        return
      }

      await atomicUpdate(store, (data) => {
        data[key] = body?.value
        return data
      })
      if (store === 'settings' && key === AUTO_ARCHIVE_SETTINGS_KEY && normalizeAutoArchiveSettings(body?.value).enabled) {
        await archiveInactiveSessions()
      }
      if (store === 'custom-providers') {
        try {
          await refreshAllSessionModels()
        } catch (error) {
          logger.error('Failed to refresh session models after custom-providers update:', error)
        }
      }
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'DELETE') {
      if (store === 'sessions') {
        // Destroy the in-memory agent first: its final persist would
        // otherwise resurrect the row right after the delete.
        try {
          await destroyAgentForSession(key)
        } catch (error) {
          logger.warn(`Failed to destroy in-memory agent for deleted session ${key}:`, error?.message || error)
        }
        await deleteSessionWithMetadata(key)
        sendJson(res, 200, { ok: true })
        return
      }

      await atomicUpdate(store, (data) => {
        delete data[key]
        return data
      })
      if (store === 'custom-providers') {
        try {
          await refreshAllSessionModels()
        } catch (error) {
          logger.error('Failed to refresh session models after custom-providers key deletion:', error)
        }
      }
      sendJson(res, 200, { ok: true })
      return
    }
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}
