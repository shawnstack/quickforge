export type GeneratedImageAsset = {
  assetId: string
  mimeType: string
  size: number
}

export type GeneratedImageDetails = {
  type: 'generated_image_result'
  sessionId: string
  prompt: string
  model: string
  assets: GeneratedImageAsset[]
  text?: string
}

const ASSET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp|gif)$/i
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function parseGeneratedImageDetails(value: unknown): GeneratedImageDetails | null {
  if (!isRecord(value) || value.type !== 'generated_image_result') return null
  if (typeof value.sessionId !== 'string' || !value.sessionId) return null
  if (typeof value.prompt !== 'string' || typeof value.model !== 'string') return null
  if (!Array.isArray(value.assets)) return null

  const assets = value.assets.flatMap((asset) => {
    if (!isRecord(asset)) return []
    if (typeof asset.assetId !== 'string' || !ASSET_ID_RE.test(asset.assetId)) return []
    if (typeof asset.mimeType !== 'string' || !ALLOWED_MIME_TYPES.has(asset.mimeType)) return []
    if (typeof asset.size !== 'number' || !Number.isFinite(asset.size) || asset.size < 0) return []
    return [{ assetId: asset.assetId, mimeType: asset.mimeType, size: asset.size }]
  })
  if (!assets.length) return null

  return {
    type: 'generated_image_result',
    sessionId: value.sessionId,
    prompt: value.prompt,
    model: value.model,
    assets,
    ...(typeof value.text === 'string' && value.text ? { text: value.text } : {}),
  }
}

export function generatedImageAssetUrl(details: GeneratedImageDetails, asset: GeneratedImageAsset, pathname = window.location.pathname) {
  const shareId = pathname.match(/^\/share\/([^/]+)\/?$/)?.[1]
  if (shareId) {
    return `/api/shared/${encodeURIComponent(decodeURIComponent(shareId))}/assets/${encodeURIComponent(asset.assetId)}`
  }
  return `/api/session-assets/${encodeURIComponent(details.sessionId)}/${encodeURIComponent(asset.assetId)}`
}
