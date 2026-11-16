const DEFAULT_MAX_BODY_BYTES = Number(process.env.QUICKFORGE_MAX_BODY_BYTES || 50 * 1024 * 1024)

export function sendJson(res, status, value, cacheControl) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': cacheControl || 'no-store',
  })
  res.end(body)
}

// 「请求错误」该记 ERROR 还是 WARN：4xx 是客户端/协议错（参数缺失、body 太大、JSON
// 坏、会话写租约冲突、找不到），5xx 才是服务端自己出错。index.mjs 的请求级 catch
// 以前一律 logger.error，于是「当天 ERROR 13 条」逐条读完全是 4xx 噪音，ERROR 计数
// 失去信号（decisions §42）。
//
// 保守边界：只把「数字且 4xx」判成 WARN；没有 statusCode（sendError 会当 500 写出）、
// 非数字、以及 0/200 这类非错误码一律 ERROR——宁可吵，不可漏。
export function requestErrorLogLevel(error) {
  const status = error?.statusCode
  return typeof status === 'number' && status >= 400 && status < 500 ? 'warn' : 'error'
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
