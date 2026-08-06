import net from 'node:net'

const DEFAULT_TIMEOUT_MS = 10_000

function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  const ip = net.isIP(host)
  if (ip === 4) return host.startsWith('127.')
  if (ip === 6) return host === '::1' || host === '0:0:0:0:0:0:0:1'
  return false
}

export function parseCloudBaseUrl(value, _options = {}) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return undefined

  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('QUICKFORGE_CLOUD_URL must be a valid URL.')
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error('QUICKFORGE_CLOUD_URL must not contain credentials, query parameters, or fragments.')
  }
  if (url.protocol !== 'https:') {
    if (!(url.protocol === 'http:' && isLoopbackHost(url.hostname))) {
      throw new Error('QUICKFORGE_CLOUD_URL must use HTTPS. HTTP is allowed only for loopback addresses.')
    }
  }
  if (url.pathname.includes('..')) throw new Error('QUICKFORGE_CLOUD_URL contains an unsafe path.')
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
