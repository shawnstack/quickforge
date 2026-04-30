import path from 'node:path'
import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { readStore, writeStore, getComparable, storageDir } from '../storage.mjs'
import { directorySize } from '../utils/workspace.mjs'

export async function handleStorageApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean)

  if (req.method === 'GET' && url.pathname === '/api/storage/quota') {
    const usage = await directorySize(storageDir)
    sendJson(res, 200, { usage, quota: 0, percent: 0 })
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
    const data = await readStore(store)
    const values = Object.values(data)
    values.sort((a, b) => {
      const left = getComparable(a, indexName)
      const right = getComparable(b, indexName)
      if (left === right) return 0
      if (left === undefined || left === null) return direction === 'desc' ? 1 : -1
      if (right === undefined || right === null) return direction === 'desc' ? -1 : 1
      const result = String(left).localeCompare(String(right))
      return direction === 'desc' ? -result : result
    })
    sendJson(res, 200, { values })
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
      const data = await readStore(store)
      sendJson(res, 200, { value: Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null })
      return
    }

    if (req.method === 'PUT') {
      const body = await readJsonBody(req)
      const data = await readStore(store)
      data[key] = body?.value
      await writeStore(store, data)
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'DELETE') {
      const data = await readStore(store)
      delete data[key]
      await writeStore(store, data)
      sendJson(res, 200, { ok: true })
      return
    }
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}
