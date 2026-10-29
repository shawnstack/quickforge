import type { AgentMessage, Attachment } from './ChatTypes'

/**
 * Client side of the attachment transport boundary.
 *
 * Historical messages carry `assetUrl` instead of inline base64. Bytes are
 * pulled on demand: the overlay resolves the full payload, the tile renders a
 * small canvas thumbnail, and draft/fork flows rehydrate only the attachments
 * they are about to send back to the server.
 */

type AttachmentPayload = {
  content?: string
  extractedText?: string
}

const THUMBNAIL_MAX_EDGE = 160
const THUMBNAIL_CACHE_LIMIT = 40
const thumbnails = new Map<string, Promise<string>>()
const thumbnailOrder: string[] = []

function rememberThumbnail(assetUrl: string, promise: Promise<string>): Promise<string> {
  thumbnails.set(assetUrl, promise)
  thumbnailOrder.push(assetUrl)
  while (thumbnailOrder.length > THUMBNAIL_CACHE_LIMIT) {
    const oldest = thumbnailOrder.shift()
    if (!oldest) break
    const cached = thumbnails.get(oldest)
    thumbnails.delete(oldest)
    cached?.then((url) => URL.revokeObjectURL(url)).catch(() => {})
  }
  return promise
}

async function fetchAttachmentBlob(assetUrl: string): Promise<Blob> {
  const separator = assetUrl.includes('?') ? '&' : '?'
  const response = await fetch(`${assetUrl}${separator}raw=1`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`Attachment request failed: HTTP ${response.status}`)
  return response.blob()
}

/** Downscale an attachment image for the 64px composer/history tile. */
export function getAttachmentThumbnail(assetUrl: string): Promise<string> {
  const cached = thumbnails.get(assetUrl)
  if (cached) return cached
  const promise = (async () => {
    const bitmap = await createImageBitmap(await fetchAttachmentBlob(assetUrl))
    const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D is unavailable')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8))
    if (!blob) throw new Error('Thumbnail encoding failed')
    return URL.createObjectURL(blob)
  })()
  promise.catch(() => {
    if (thumbnails.get(assetUrl) === promise) thumbnails.delete(assetUrl)
  })
  return rememberThumbnail(assetUrl, promise)
}

/** Resolve the stored bytes for one attachment (no-op for local attachments). */
export async function resolveAttachmentPayload(attachment: Attachment): Promise<Attachment> {
  if (attachment.content !== undefined || !attachment.assetUrl) return attachment
  const response = await fetch(attachment.assetUrl, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`Attachment request failed: HTTP ${response.status}`)
  const payload = await response.json() as AttachmentPayload
  return {
    ...attachment,
    content: payload.content ?? '',
    extractedText: attachment.extractedText ?? payload.extractedText,
  }
}

export async function resolveAttachmentsForDraft(attachments?: Attachment[]): Promise<Attachment[] | undefined> {
  if (!attachments?.length) return attachments
  return Promise.all(attachments.map((attachment) => resolveAttachmentPayload(attachment)))
}

/**
 * Rehydrate projected messages before they are sent back to the server
 * (fork upload, shared-conversation draft).
 */
export async function resolveMessagesForUpload(messages: AgentMessage[]): Promise<AgentMessage[]> {
  let changed = false
  const next = await Promise.all(messages.map(async (message) => {
    if (message.role !== 'user-with-attachments' || !Array.isArray(message.attachments) || message.attachments.length === 0) {
      return message
    }
    changed = true
    return { ...message, attachments: await resolveAttachmentsForDraft(message.attachments) }
  }))
  return changed ? next : messages
}
