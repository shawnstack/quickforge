import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(__filename), '../..')
const androidApkPath = path.join(projectRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
  }[extension] || 'application/octet-stream'
}

function assetPathFromSharePath(pathname) {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] !== 'share') return null
  const assetIndex = parts.indexOf('assets')
  if (assetIndex < 1) return null
  return `/${parts.slice(assetIndex).join('/')}`
}

function requestPathname(url) {
  if (url.pathname === '/') return '/index.html'
  return assetPathFromSharePath(url.pathname) || url.pathname
}

function shouldFallbackToIndex(url, pathname) {
  if (pathname.startsWith('/assets/')) return false
  if (url.pathname === '/') return true
  if (url.pathname.startsWith('/share/')) return true
  return !path.extname(pathname)
}

function cacheControlFor(filePath) {
  if (filePath.endsWith('index.html')) return 'no-cache'
  if (path.extname(filePath).toLowerCase() === '.apk') return 'no-cache'
  return 'public, max-age=31536000, immutable'
}

/** Text-like assets that `scripts/precompress-assets.mjs` emits `.br`/`.gz` for. */
const COMPRESSIBLE_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt'])

function isCompressible(filePath) {
  return COMPRESSIBLE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function isEncodingAccepted(acceptEncoding, token) {
  return acceptEncoding.split(',').some((part) => {
    const [name, ...params] = part.trim().split(';')
    if (name !== token) return false
    const quality = params.map((param) => param.trim()).find((param) => param.startsWith('q='))
    return quality === undefined || Number.parseFloat(quality.slice(2)) > 0
  })
}

/**
 * Pick a precompressed variant for the request. `available` holds the encodings
 * whose sibling files exist (`'br'` / `'gz'`); brotli wins when both are viable.
 */
export function selectContentEncoding(acceptEncoding, available) {
  const header = String(acceptEncoding ?? '').toLowerCase()
  if (!header) return null
  if (available.includes('br') && isEncodingAccepted(header, 'br')) return 'br'
  if (available.includes('gz') && isEncodingAccepted(header, 'gzip')) return 'gz'
  return null
}

async function availableEncodings(filePath) {
  if (!isCompressible(filePath)) return []
  const checks = await Promise.all(
    ['br', 'gz'].map(async (encoding) => {
      try {
        const stat = await fs.stat(`${filePath}.${encoding}`)
        return stat.isFile() ? encoding : null
      } catch {
        return null
      }
    }),
  )
  return checks.filter(Boolean)
}

export async function serveStatic(req, res, url) {
  if (url.pathname === '/downloads/quickforge-android.apk') {
    try {
      const data = await fs.readFile(androidApkPath)
      res.writeHead(200, {
        'content-type': 'application/vnd.android.package-archive',
        'content-length': data.length,
        'content-disposition': 'attachment; filename="quickforge-android.apk"',
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      })
      res.end(data)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end('Android APK not found. Run npm run android:build first.')
    }
    return
  }

  const distDir = path.join(projectRoot, 'dist')
  const requested = decodeURIComponent(requestPathname(url))
  const normalized = path.normalize(requested).replace(/^([.][.][/])+/, '').replace(/^[/\\]+/, '')
  let filePath = path.resolve(distDir, normalized)

  const relative = path.relative(distDir, filePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  try {
    const stat = await fs.stat(filePath)
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html')
  } catch {
    if (!shouldFallbackToIndex(url, requested)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end('Static asset not found')
      return
    }
    filePath = path.join(distDir, 'index.html')
  }

  try {
    const encoding = selectContentEncoding(
      req.headers['accept-encoding'],
      await availableEncodings(filePath),
    )
    const data = await fs.readFile(encoding ? `${filePath}.${encoding}` : filePath)
    const headers = {
      'content-type': getContentType(filePath),
      'cache-control': cacheControlFor(filePath),
      'content-length': String(data.length),
    }
    if (encoding) headers['content-encoding'] = encoding === 'br' ? 'br' : 'gzip'
    if (isCompressible(filePath)) headers.vary = 'Accept-Encoding'
    res.writeHead(200, headers)
    res.end(data)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Build output not found. Run npm run build first.')
  }
}
