import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { readStore, writeStore, atomicUpdate, getComparable, getStoreRevision, readSessionStoreScoped, readSessionValue, writeSessionValue, deleteSessionValue, ensureStorage, dataDir, configDir, storageDir, cacheDir, logsDir } from '../storage.mjs'
import { directorySize } from '../utils/workspace.mjs'

const metadataIndexCache = new Map()
const MAX_METADATA_INDEX_CACHE_ENTRIES = 50
const METADATA_INDEX_CACHE_TTL_MS = 1000

function metadataIndexCacheKey({ scope, projectId, indexName, direction }) {
  return JSON.stringify({ scope: scope || '', projectId: projectId || '', indexName, direction })
}

function sortIndexedValues(values, store, indexName, direction) {
  values.sort((a, b) => {
    if (store === 'sessions-metadata' && indexName === 'lastModified') {
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

async function readIndexedValues(store, indexName, direction, scope, projectId) {
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
  const key = metadataIndexCacheKey({ scope, projectId, indexName, direction })
  const cached = metadataIndexCache.get(key)
  const now = Date.now()
  if (cached && cached.revision === revision && now - cached.cachedAt < METADATA_INDEX_CACHE_TTL_MS) return cached.values

  const data = scope
    ? await readSessionStoreScoped(store, scope, scope === 'project' ? projectId : undefined)
    : await readStore(store)
  const values = sortIndexedValues(
    Object.values(data).filter((value) => value?.messageCount !== 0),
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

export async function handleStorageApi(req, res, url) {
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

  if (req.method === 'GET' && parts[3] === 'keys') {
    const prefix = url.searchParams.get('prefix') || ''
    const data = await readStore(store)
    const keys = Object.keys(data).filter((key) => !prefix || key.startsWith(prefix))
    sendJson(res, 200, { keys })
    return
  }

  if (req.method === 'GET' && parts[3] === 'index') {
    const indexName = decodeSegment(parts[4])
    const direction = url.searchParams.get('direction') === 'desc' ? 'desc' : 'asc'
    const scope = url.searchParams.get('scope')
    const projectId = url.searchParams.get('projectId')
    const limitParam = url.searchParams.get('limit')
    const offsetParam = url.searchParams.get('offset')

    await ensureStorage()

    const values = await readIndexedValues(store, indexName, direction, scope, projectId)

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
        await writeSessionValue(key, body?.value)
        sendJson(res, 200, { ok: true })
        return
      }

      await atomicUpdate(store, (data) => {
        data[key] = body?.value
        return data
      })
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'DELETE') {
      if (store === 'sessions') {
        await deleteSessionValue(key)
        await atomicUpdate('sessions-metadata', (data) => {
          delete data[key]
          return data
        })
        sendJson(res, 200, { ok: true })
        return
      }

      await atomicUpdate(store, (data) => {
        delete data[key]
        return data
      })
      sendJson(res, 200, { ok: true })
      return
    }
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}
