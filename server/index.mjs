#!/usr/bin/env node
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const workspaceRoot = path.resolve(process.env.FASTCODE_WORKSPACE_DIR || projectRoot)
const isDev = process.argv.includes('--dev')
const host = process.env.FASTCODE_HOST || '127.0.0.1'
const port = Number(process.env.FASTCODE_PORT || (isDev ? 32176 : 5176))
const vitePort = Number(process.env.FASTCODE_VITE_PORT || 5176)
const maxBodyBytes = Number(process.env.FASTCODE_MAX_BODY_BYTES || 50 * 1024 * 1024)

const stores = new Set([
  'settings',
  'provider-keys',
  'custom-providers',
  'sessions',
  'sessions-metadata',
])

function getDataDir() {
  if (process.env.FASTCODE_DATA_DIR) return path.resolve(process.env.FASTCODE_DATA_DIR)

  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'FastCode')
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'FastCode')
  }

  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'FastCode')
}

const dataDir = getDataDir()
const storageDir = path.join(dataDir, 'storage')

function storeFile(storeName) {
  return path.join(storageDir, `${storeName}.json`)
}

const writeQueues = new Map()

async function ensureStorage() {
  await fs.mkdir(storageDir, { recursive: true })
  await Promise.all(
    [...stores].map(async (store) => {
      const file = storeFile(store)
      if (!existsSync(file)) await fs.writeFile(file, '{}\n', 'utf8')
    }),
  )
}

async function readStore(storeName) {
  assertStore(storeName)
  await ensureStorage()
  const file = storeFile(storeName)
  try {
    const text = await fs.readFile(file, 'utf8')
    return text.trim() ? JSON.parse(text) : {}
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

async function writeStore(storeName, data) {
  assertStore(storeName)
  const previous = writeQueues.get(storeName) || Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await ensureStorage()
      const file = storeFile(storeName)
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
      await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
      await fs.rename(tmp, file)
    })
  writeQueues.set(storeName, next)
  return next
}

function assertStore(storeName) {
  if (!stores.has(storeName)) {
    const error = new Error(`Unknown storage store: ${storeName}`)
    error.statusCode = 404
    throw error
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function sendError(res, error) {
  const status = error?.statusCode || 500
  sendJson(res, status, { error: error?.message || 'Internal server error' })
}

async function readJsonBody(req) {
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

function decodeSegment(value) {
  return decodeURIComponent(value || '')
}

function getComparable(value, key) {
  if (!value || typeof value !== 'object') return undefined
  return key.split('.').reduce((current, part) => {
    if (!current || typeof current !== 'object') return undefined
    return current[part]
  }, value)
}

async function directorySize(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const sizes = await Promise.all(entries.map(async (entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return directorySize(full)
      const stat = await fs.stat(full)
      return stat.size
    }))
    return sizes.reduce((sum, value) => sum + value, 0)
  } catch {
    return 0
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function resolveWorkspacePath(input = '.') {
  const candidate = path.isAbsolute(input)
    ? path.resolve(input)
    : path.resolve(workspaceRoot, input)

  if (!isInside(workspaceRoot, candidate)) {
    const error = new Error(`Path is outside the workspace: ${input}`)
    error.statusCode = 403
    throw error
  }

  return candidate
}

function toWorkspaceRelative(fullPath) {
  return path.relative(workspaceRoot, fullPath).replace(/\\/g, '/') || '.'
}

function isSensitiveWorkspacePath(fullPath) {
  const relative = toWorkspaceRelative(fullPath)
  const parts = relative.split('/')
  const name = parts.at(-1) || ''
  return (
    parts.includes('.git') ||
    name === '.env' ||
    name.startsWith('.env.') ||
    name.endsWith('.pem') ||
    name.endsWith('.key') ||
    name === 'id_rsa' ||
    name === 'id_ed25519'
  )
}

function assertSafeWorkspacePath(fullPath) {
  if (isSensitiveWorkspacePath(fullPath)) {
    const error = new Error(`Access to sensitive path is blocked: ${toWorkspaceRelative(fullPath)}`)
    error.statusCode = 403
    throw error
  }
}

function truncateText(text, maxChars = 50000) {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} characters]`
}

function splitLines(text) {
  return text.split(/\r?\n/)
}

async function toolListDir(params) {
  const dir = resolveWorkspacePath(params?.path || '.')
  assertSafeWorkspacePath(dir)

  const entries = await fs.readdir(dir, { withFileTypes: true })
  const rows = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name)
    const stat = await fs.stat(fullPath).catch(() => null)
    return {
      name: `${entry.name}${entry.isDirectory() ? '/' : ''}`,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      size: stat?.size ?? 0,
      modified: stat?.mtime?.toISOString?.() ?? '',
    }
  }))

  rows.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const content = rows.length
    ? rows.map((row) => `${row.type.padEnd(9)} ${String(row.size).padStart(10)} ${row.modified} ${row.name}`).join('\n')
    : '(empty directory)'

  return { content, details: { path: toWorkspaceRelative(dir), count: rows.length } }
}

async function toolReadFile(params) {
  const file = resolveWorkspacePath(params?.path)
  assertSafeWorkspacePath(file)

  const text = await fs.readFile(file, 'utf8')
  const lines = splitLines(text)
  const offset = Math.max(1, Number(params?.offset || 1))
  const limit = Math.min(2000, Math.max(1, Number(params?.limit || 200)))
  const selected = lines.slice(offset - 1, offset - 1 + limit)
  const content = selected.map((line, index) => `${offset + index}: ${line}`).join('\n')
  const suffix = offset - 1 + limit < lines.length ? `\n\n[showing ${selected.length} of ${lines.length} lines]` : ''

  return {
    content: truncateText(`${content}${suffix}`),
    details: { path: toWorkspaceRelative(file), totalLines: lines.length, offset, limit },
  }
}

function shouldSkipSearchDir(name) {
  return ['.git', 'node_modules', 'dist', 'dist-ssr', '.vite'].includes(name)
}

function shouldSearchFile(name) {
  const lower = name.toLowerCase()
  const blocked = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.7z', '.exe', '.dll', '.woff', '.woff2', '.ttf']
  return !blocked.some((extension) => lower.endsWith(extension))
}

async function walkFiles(root, files = []) {
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (!shouldSkipSearchDir(entry.name)) await walkFiles(fullPath, files)
    } else if (entry.isFile() && shouldSearchFile(entry.name) && !isSensitiveWorkspacePath(fullPath)) {
      files.push(fullPath)
    }
  }
  return files
}

async function toolGrepFiles(params) {
  const root = resolveWorkspacePath(params?.path || '.')
  assertSafeWorkspacePath(root)

  const query = String(params?.query || '')
  if (!query) {
    const error = new Error('query is required')
    error.statusCode = 400
    throw error
  }

  const limit = Math.min(1000, Math.max(1, Number(params?.limit || 200)))
  const flags = params?.caseSensitive ? 'g' : 'gi'
  const matcher = params?.regex
    ? new RegExp(query, flags)
    : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  const files = await walkFiles(root)
  const matches = []

  for (const file of files) {
    if (matches.length >= limit) break
    const stat = await fs.stat(file)
    if (stat.size > 1024 * 1024) continue

    const text = await fs.readFile(file, 'utf8').catch(() => '')
    const lines = splitLines(text)
    for (let index = 0; index < lines.length && matches.length < limit; index++) {
      matcher.lastIndex = 0
      if (matcher.test(lines[index])) {
        matches.push(`${toWorkspaceRelative(file)}:${index + 1}: ${lines[index]}`)
      }
    }
  }

  return {
    content: matches.length ? truncateText(matches.join('\n')) : 'No matches found.',
    details: { path: toWorkspaceRelative(root), query, count: matches.length, limit },
  }
}

async function toolWriteFile(params) {
  const file = resolveWorkspacePath(params?.path)
  assertSafeWorkspacePath(file)

  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, String(params?.content ?? ''), 'utf8')

  return {
    content: `Wrote ${toWorkspaceRelative(file)}`,
    details: { path: toWorkspaceRelative(file), bytes: Buffer.byteLength(String(params?.content ?? ''), 'utf8') },
  }
}

function countOccurrences(text, needle) {
  if (!needle) return 0
  let count = 0
  let index = 0
  while ((index = text.indexOf(needle, index)) !== -1) {
    count++
    index += needle.length
  }
  return count
}

async function toolEditFile(params) {
  const file = resolveWorkspacePath(params?.path)
  assertSafeWorkspacePath(file)

  const oldText = String(params?.oldText ?? '')
  const newText = String(params?.newText ?? '')
  const text = await fs.readFile(file, 'utf8')
  const count = countOccurrences(text, oldText)

  if (count !== 1) {
    const error = new Error(`oldText must match exactly once; found ${count} matches`)
    error.statusCode = 400
    throw error
  }

  await fs.writeFile(file, text.replace(oldText, newText), 'utf8')

  return {
    content: `Edited ${toWorkspaceRelative(file)}`,
    details: { path: toWorkspaceRelative(file), replaced: count },
  }
}

async function toolRunCommand(params) {
  const command = String(params?.command || '')
  if (!command.trim()) {
    const error = new Error('command is required')
    error.statusCode = 400
    throw error
  }

  const timeoutMs = Math.min(10 * 60, Math.max(1, Number(params?.timeoutSeconds || 60))) * 1000

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: workspaceRoot,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout = truncateText(stdout + chunk.toString())
    })
    child.stderr.on('data', (chunk) => {
      stderr = truncateText(stderr + chunk.toString())
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const content = [
        `Command: ${command}`,
        `Exit code: ${code ?? 'unknown'}${signal ? `, signal: ${signal}` : ''}${timedOut ? ' (timed out)' : ''}`,
        '',
        'STDOUT:',
        stdout || '(empty)',
        '',
        'STDERR:',
        stderr || '(empty)',
      ].join('\n')
      resolve({ content: truncateText(content), details: { command, code, signal, timedOut } })
    })
  })
}

const toolHandlers = {
  list_dir: toolListDir,
  read_file: toolReadFile,
  grep_files: toolGrepFiles,
  write_file: toolWriteFile,
  edit_file: toolEditFile,
  run_command: toolRunCommand,
}

async function handleToolApi(req, res, url) {
  if (req.method !== 'POST') {
    const error = new Error('Tool endpoints require POST')
    error.statusCode = 405
    throw error
  }

  const name = decodeSegment(url.pathname.split('/').filter(Boolean)[2])
  const handler = toolHandlers[name]
  if (!handler) {
    const error = new Error(`Unknown tool: ${name}`)
    error.statusCode = 404
    throw error
  }

  const params = await readJsonBody(req)
  const result = await handler(params || {})
  sendJson(res, 200, result)
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean)

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, mode: isDev ? 'development' : 'production', dataDir, storageDir, workspaceRoot })
    return
  }

  if (url.pathname.startsWith('/api/tools/')) {
    await handleToolApi(req, res, url)
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/storage/quota') {
    const usage = await directorySize(storageDir)
    sendJson(res, 200, { usage, quota: 0, percent: 0 })
    return
  }

  if (parts[0] !== 'api' || parts[1] !== 'storage') {
    const error = new Error('Not found')
    error.statusCode = 404
    throw error
  }

  const store = decodeSegment(parts[2])
  assertStore(store)

  if (req.method === 'GET' && parts[3] === 'keys') {
    const prefix = url.searchParams.get('prefix') || ''
    const data = await readStore(store)
    const keys = Object.keys(data).filter((key) => !prefix || key.startsWith(prefix))
    sendJson(res, 200, { keys })
    return
  }

  if (req.method === 'GET' && parts[3] === 'index') {
    const indexName = decodeSegment(parts[4])
    const direction = url.searchParams.get('direction') === 'desc' ? 'desc' : 'asc'
    const data = await readStore(store)
    const values = Object.values(data)
    values.sort((a, b) => {
      const left = getComparable(a, indexName)
      const right = getComparable(b, indexName)
      if (left === right) return 0
      if (left === undefined || left === null) return direction === 'desc' ? 1 : -1
      if (right === undefined || right === null) return direction === 'desc' ? -1 : 1
      const result = String(left).localeCompare(String(right))
      return direction === 'desc' ? -result : result
    })
    sendJson(res, 200, { values })
    return
  }

  if (req.method === 'DELETE' && parts.length === 3) {
    await writeStore(store, {})
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === 'GET' && parts[3] === 'has') {
    const key = decodeSegment(parts[4])
    const data = await readStore(store)
    sendJson(res, 200, { exists: Object.prototype.hasOwnProperty.call(data, key) })
    return
  }

  if (parts[3] === 'key') {
    const key = decodeSegment(parts[4])
    if (!key) {
      const error = new Error('Missing storage key')
      error.statusCode = 400
      throw error
    }

    if (req.method === 'GET') {
      const data = await readStore(store)
      sendJson(res, 200, { value: Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null })
      return
    }

    if (req.method === 'PUT') {
      const body = await readJsonBody(req)
      const data = await readStore(store)
      data[key] = body?.value
      await writeStore(store, data)
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'DELETE') {
      const data = await readStore(store)
      delete data[key]
      await writeStore(store, data)
      sendJson(res, 200, { ok: true })
      return
    }
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
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

async function serveStatic(req, res, url) {
  const distDir = path.join(projectRoot, 'dist')
  const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
  const normalized = path.normalize(requested).replace(/^([.][.][\/])+/, '')
  let filePath = path.join(distDir, normalized)

  if (!filePath.startsWith(distDir)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  try {
    const stat = await fs.stat(filePath)
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html')
  } catch {
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

function openBrowser(url) {
  if (process.env.FASTCODE_NO_OPEN === '1') return

  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false })
  child.unref()
}

function startVite() {
  const isWindows = process.platform === 'win32'
  const command = isWindows ? 'npm.cmd' : 'npm'
  const child = spawn(command, ['run', 'dev:web'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: isWindows,
    env: { ...process.env, FASTCODE_SERVER_PORT: String(port) },
  })
  child.on('exit', (code) => {
    if (code && code !== 0) process.exitCode = code
  })
  process.on('exit', () => child.kill())
  process.on('SIGINT', () => {
    child.kill('SIGINT')
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    child.kill('SIGTERM')
    process.exit(0)
  })
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`)
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url)
      return
    }

    if (isDev) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('FastCode local API server is running. Open the Vite app at http://127.0.0.1:5176')
      return
    }

    await serveStatic(req, res, url)
  } catch (error) {
    console.error(error)
    sendError(res, error)
  }
})

await ensureStorage()

server.listen(port, host, () => {
  console.log(`FastCode local API: http://${host}:${port}`)
  console.log(`FastCode data dir: ${dataDir}`)

  if (isDev) {
    startVite()
    setTimeout(() => openBrowser(`http://localhost:${vitePort}`), 1000)
  } else {
    openBrowser(`http://localhost:${port}`)
  }
})
