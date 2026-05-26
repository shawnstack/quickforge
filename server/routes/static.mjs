import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(__filename), '../..')

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

export async function serveStatic(req, res, url) {
  const distDir = path.join(projectRoot, 'dist')
  const requested = decodeURIComponent(requestPathname(url))
  const normalized = path.normalize(requested).replace(/^([.][.][\/])+/, '').replace(/^[/\\]+/, '')
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
    const data = await fs.readFile(filePath)
    res.writeHead(200, {
      'content-type': getContentType(filePath),
      'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    })
    res.end(data)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Build output not found. Run npm run build first.')
  }
}
