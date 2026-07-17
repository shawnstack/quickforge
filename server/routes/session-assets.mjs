import { findSessionBucket } from '../storage.mjs'
import { readSessionAsset } from '../session-assets.mjs'
import { decodeSegment } from '../utils/response.mjs'

function notFound(message = 'Image asset not found') {
  const error = new Error(message)
  error.statusCode = 404
  return error
}

export async function sendSessionAsset(res, bucket, sessionId, assetId) {
  let asset
  try {
    asset = await readSessionAsset(bucket, sessionId, assetId)
  } catch (error) {
    if (error?.code === 'ENOENT') throw notFound()
    throw error
  }

  res.writeHead(200, {
    'content-type': asset.mimeType,
    'content-length': String(asset.size),
    'cache-control': 'private, max-age=31536000, immutable',
    'content-disposition': 'inline',
    'x-content-type-options': 'nosniff',
  })
  res.end(asset.data)
}

export async function handleSessionAssetsApi(req, res, url) {
  if (req.method !== 'GET') {
    const error = new Error('Session asset endpoints require GET')
    error.statusCode = 405
    throw error
  }

  const parts = url.pathname.split('/').filter(Boolean)
  const sessionId = decodeSegment(parts[2])
  const assetId = decodeSegment(parts[3])
  if (!sessionId || !assetId || parts.length !== 4) {
    const error = new Error('Missing session image asset path')
    error.statusCode = 400
    throw error
  }

  const bucket = await findSessionBucket(sessionId)
  if (!bucket) throw notFound('Session not found')
  await sendSessionAsset(res, bucket, sessionId, assetId)
}
