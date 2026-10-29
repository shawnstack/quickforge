import { sendJson } from '../utils/response.mjs'

const ATTACHMENT_CACHE_CONTROL = 'private, max-age=31536000, immutable'

/**
 * Serve one resolved attachment.
 *
 * `?raw=1` returns the decoded bytes (image thumbnails / image overlay /
 * download); the default JSON form carries the stored base64 plus extracted
 * text for the document preview components. Both are immutable: the attachment
 * id is generated once and its bytes never change.
 */
export function sendMessageAttachment(req, res, attachment) {
  const raw = new URL(req.url ?? '/', 'http://localhost').searchParams.get('raw') === '1'
  if (raw && typeof attachment.content === 'string') {
    const data = Buffer.from(attachment.content, 'base64')
    res.writeHead(200, {
      'content-type': attachment.mimeType || 'application/octet-stream',
      'content-length': String(data.length),
      'cache-control': ATTACHMENT_CACHE_CONTROL,
      'x-content-type-options': 'nosniff',
    })
    res.end(data)
    return
  }
  sendJson(res, 200, {
    content: typeof attachment.content === 'string' ? attachment.content : '',
    extractedText: typeof attachment.extractedText === 'string' ? attachment.extractedText : undefined,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    type: attachment.type,
    size: attachment.size,
  }, ATTACHMENT_CACHE_CONTROL)
}
