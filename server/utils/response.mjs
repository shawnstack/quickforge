const DEFAULT_MAX_BODY_BYTES = Number(process.env.QUICKFORGE_MAX_BODY_BYTES || 50 * 1024 * 1024)

export function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

export function sendError(res, error) {
  const status = error?.statusCode || 500
  sendJson(res, status, { error: error?.message || 'Internal server error' })
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
  return text ? JSON.parse(text) : null
}

export function decodeSegment(value) {
  return decodeURIComponent(value || '')
}
