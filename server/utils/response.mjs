const DEFAULT_MAX_BODY_BYTES = Number(process.env.QUICKFORGE_MAX_BODY_BYTES || 50 * 1024 * 1024)

export function sendJson(res, status, value, cacheControl) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': cacheControl || 'no-store',
  })
  res.end(body)
}

export function sendError(res, error) {
  if (res.headersSent) {
    try { res.end() } catch { /* ignore */ }
    return
  }
  const status = error?.statusCode || 500
  const payload = { error: error?.message || 'Internal server error' }
  const code = typeof error?.errorCode === 'string' && error.errorCode
    ? error.errorCode
    : typeof error?.code === 'string' && error.code
      ? error.code
      : undefined
  if (code) payload.code = code
  sendJson(res, status, payload)
}

export async function readJsonBody(req, maxBodyBytes = DEFAULT_MAX_BODY_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBodyBytes) {
      const error = new Error('Request body is too large')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return null
  try {
    return JSON.parse(text.trimStart())
  } catch {
    const error = new Error('Invalid JSON request body')
    error.statusCode = 400
    throw error
  }
}

export function decodeSegment(value) {
  return decodeURIComponent(value || '')
}
