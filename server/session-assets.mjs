import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { storageDir } from './storage.mjs'

export const MAX_SESSION_IMAGE_BYTES = 25 * 1024 * 1024

const MIME_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])

const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const ASSET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp|gif)$/i

function requestError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function assertSafeSegment(value, label) {
  if (typeof value !== 'string' || !SAFE_SEGMENT_RE.test(value)) {
    throw requestError(`Invalid ${label}`)
  }
  return value
}

function normalizeBucket(bucket) {
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) {
    throw requestError('Invalid session asset scope')
  }
  if (bucket.scope === 'global') return { scope: 'global' }
  if (bucket.scope === 'project') {
    return {
      scope: 'project',
      projectId: assertSafeSegment(bucket.projectId, 'projectId'),
    }
  }
  throw requestError('Invalid session asset scope')
}

function assetsRoot(bucket) {
  if (bucket.scope === 'project') {
    return path.join(storageDir, 'conversations', 'projects', bucket.projectId, 'assets')
  }
  return path.join(storageDir, 'conversations', 'global', 'assets')
}

function sessionAssetsDir(bucket, sessionId) {
  return path.join(assetsRoot(normalizeBucket(bucket)), assertSafeSegment(sessionId, 'sessionId'))
}

function normalizeMimeType(mimeType) {
  const value = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : ''
  const extension = MIME_TYPES.get(value)
  if (!extension) throw requestError(`Unsupported image MIME type: ${mimeType || ''}`)
  return { mimeType: value, extension }
}

function decodeBase64(value) {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, '') : ''
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw requestError('Invalid base64 image data')
  }
  const buffer = Buffer.from(normalized, 'base64')
  if (buffer.toString('base64') !== normalized) throw requestError('Invalid base64 image data')
  return buffer
}

function normalizeImageData(data) {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof Uint8Array) return Buffer.from(data)
  return decodeBase64(data)
}

function mimeTypeFromAssetId(assetId) {
  const extension = path.extname(assetId).slice(1).toLowerCase()
  for (const [mimeType, candidate] of MIME_TYPES) {
    if (candidate === extension) return mimeType
  }
  throw requestError('Invalid assetId')
}

function assetMetadata(assetId, mimeType, size) {
  return { assetId, mimeType, size }
}

export function validateSessionAssetId(assetId) {
  if (typeof assetId !== 'string' || !ASSET_ID_RE.test(assetId)) {
    throw requestError('Invalid assetId')
  }
  return assetId
}

export async function writeSessionAsset(bucket, sessionId, image) {
  const dir = sessionAssetsDir(bucket, sessionId)
  const { mimeType, extension } = normalizeMimeType(image?.mimeType)
  const data = normalizeImageData(image?.data)
  if (data.byteLength > MAX_SESSION_IMAGE_BYTES) {
    throw requestError(`Image exceeds the ${MAX_SESSION_IMAGE_BYTES} byte limit`, 413)
  }

  await fs.mkdir(dir, { recursive: true })
  const assetId = `${randomUUID()}.${extension}`
  await fs.writeFile(path.join(dir, assetId), data, { flag: 'wx' })
  return assetMetadata(assetId, mimeType, data.byteLength)
}

export async function readSessionAsset(bucket, sessionId, assetId) {
  const dir = sessionAssetsDir(bucket, sessionId)
  const safeAssetId = validateSessionAssetId(assetId)
  const data = await fs.readFile(path.join(dir, safeAssetId))
  if (data.byteLength > MAX_SESSION_IMAGE_BYTES) {
    throw requestError('Stored image exceeds the allowed size', 413)
  }
  return {
    ...assetMetadata(safeAssetId, mimeTypeFromAssetId(safeAssetId), data.byteLength),
    data,
  }
}

export async function deleteSessionAsset(bucket, sessionId, assetId) {
  const dir = sessionAssetsDir(bucket, sessionId)
  const safeAssetId = validateSessionAssetId(assetId)
  await fs.rm(path.join(dir, safeAssetId), { force: true })
}

export async function deleteSessionAssets(bucket, sessionId) {
  const dir = sessionAssetsDir(bucket, sessionId)
  await fs.rm(dir, { recursive: true, force: true })
}
