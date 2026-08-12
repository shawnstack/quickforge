const DEFAULT_TIMEOUT_MS = 10_000

function invalidUrl(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

export function parseCloudBaseUrl(value, _options = {}) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return undefined

  let url
  try {
    url = new URL(raw)
  } catch {
    throw invalidUrl('QuickForge Cloud URL must be a valid URL.')
  }

  if (url.username || url.password || url.search || url.hash) {
    throw invalidUrl('QuickForge Cloud URL must not contain credentials, query parameters, or fragments.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw invalidUrl('QuickForge Cloud URL must use http or https.')
  }
  if (url.pathname.includes('..')) throw invalidUrl('QuickForge Cloud URL contains an unsafe path.')
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
  return url
}

export function cloudEndpoint(baseUrl, pathname) {
  if (!(baseUrl instanceof URL)) throw new Error('QuickForge Cloud is not configured.')
  const relative = String(pathname || '').replace(/^\/+/, '')
  if (!relative || relative.split('/').includes('..')) throw new Error('Invalid QuickForge Cloud endpoint.')
  return new URL(relative, baseUrl)
}

export function readCloudConfig(env = process.env) {
  const baseUrl = parseCloudBaseUrl(env.QUICKFORGE_CLOUD_URL)
  const timeoutValue = Number(env.QUICKFORGE_CLOUD_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  return {
    enabled: Boolean(baseUrl),
    baseUrl,
    timeoutMs: Number.isFinite(timeoutValue) ? Math.min(60_000, Math.max(1_000, timeoutValue)) : DEFAULT_TIMEOUT_MS,
  }
}
