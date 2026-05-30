import path from 'node:path'
import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { readStore, writeStore, atomicUpdate, getComparable, readSessionStoreScoped, readSessionValue, writeSessionValue, deleteSessionValue, ensureStorage, dataDir, configDir, storageDir, cacheDir, logsDir } from '../storage.mjs'
import { directorySize } from '../utils/workspace.mjs'

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

    let data
    if (scope && (store === 'sessions' || store === 'sessions-metadata')) {
      data = await readSessionStoreScoped(store, scope, scope === 'project' ? projectId : undefined)
    } else {
      data = await readStore(store)
    }

    let values = Object.values(data)
    if (store === 'sessions-metadata') {
      values = values.filter((value) => value?.messageCount !== 0)
    }
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
