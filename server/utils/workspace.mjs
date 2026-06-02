import { promises as fs } from 'node:fs'
import path from 'node:path'

let _workspaceRoot = ''

export function setWorkspaceRoot(root) {
  _workspaceRoot = path.resolve(root)
}

export function getWorkspaceRoot() {
  return _workspaceRoot
}

export function getToolWorkspaceRoot(context) {
  return context?.workspaceRoot || getWorkspaceRoot()
}

export function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function resolveWorkspacePath(input = '.', context) {
  const workspaceRoot = getToolWorkspaceRoot(context)
  const candidate = path.isAbsolute(input)
    ? path.resolve(input)
    : path.resolve(workspaceRoot, input)

  if (!isInside(workspaceRoot, candidate)) {
    const error = new Error(`Path is outside the selected project: ${input}`)
    error.statusCode = 403
    throw error
  }

  return candidate
}

export function toWorkspaceRelative(fullPath, context) {
  return path.relative(getToolWorkspaceRoot(context), fullPath).replace(/\\/g, '/') || '.'
}

export function isSensitiveWorkspacePath(fullPath, context) {
  const relative = toWorkspaceRelative(fullPath, context)
  const parts = relative.split('/')
  const name = parts.at(-1) || ''
  return (
    parts.includes('.git') ||
    name === '.env' ||
    name.startsWith('.env.') ||
    name.endsWith('.pem') ||
    name.endsWith('.key') ||
    name.endsWith('.p12') ||
    name.endsWith('.pfx') ||
    name.endsWith('.crt') ||
    name.endsWith('.cer') ||
    name.endsWith('.token') ||
    name === 'credentials.json' ||
    name === 'secrets.json' ||
    name === 'id_rsa' ||
    name === 'id_ed25519'
  )
}

async function realpathNearestExistingParent(inputPath) {
  let current = path.resolve(inputPath)
  while (true) {
    try {
      return await fs.realpath(current)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const parent = path.dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

export async function assertSafeWorkspacePath(fullPath, context, options = {}) {
  if (isSensitiveWorkspacePath(fullPath, context)) {
    const error = new Error(`Access to sensitive path is blocked: ${toWorkspaceRelative(fullPath, context)}`)
    error.statusCode = 403
    throw error
  }

  const workspaceRoot = getToolWorkspaceRoot(context)
  const workspaceReal = await fs.realpath(workspaceRoot)
  let targetReal
  try {
    targetReal = await fs.realpath(fullPath)
  } catch (error) {
    if (options.forWrite && error?.code === 'ENOENT') {
      targetReal = await realpathNearestExistingParent(path.dirname(fullPath))
    } else if (options.ignoreMissing && error?.code === 'ENOENT') {
      return
    } else {
      throw error
    }
  }

  if (!isInside(workspaceReal, targetReal)) {
    const error = new Error(`Path resolves outside the selected project: ${toWorkspaceRelative(fullPath, context)}`)
    error.statusCode = 403
    throw error
  }
}

export function truncateText(text, maxChars = 50000) {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} characters]`
}

export function splitLines(text) {
  return text.split(/\r?\n/)
}

export async function pathExists(dir) {
  try {
    await fs.access(dir)
    return true
  } catch {
    return false
  }
}

export async function assertDirectory(dir) {
  const stat = await fs.stat(dir).catch(() => null)
  if (!stat || !stat.isDirectory()) {
    const error = new Error(`Project directory does not exist: ${dir}`)
    error.statusCode = 400
    throw error
  }
}

const SIZE_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'dist-ssr', '.vite', '.cache', '.next', '.nuxt', '__pycache__', '.venv', 'venv'])
const directorySizeCache = new Map()
const DIRECTORY_SIZE_CACHE_TTL_MS = 10_000

export async function directorySize(dir) {
  try {
    const now = Date.now()
    const cached = directorySizeCache.get(dir)
    if (cached && now - cached.ts < DIRECTORY_SIZE_CACHE_TTL_MS) return cached.size

    const entries = await fs.readdir(dir, { withFileTypes: true })
    const sizes = await Promise.all(entries.map(async (entry) => {
      if (entry.isDirectory() && SIZE_SKIP_DIRS.has(entry.name)) return 0
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return directorySize(full)
      const stat = await fs.stat(full)
      return stat.size
    }))
    const size = sizes.reduce((sum, value) => sum + value, 0)
    directorySizeCache.set(dir, { size, ts: now })
    return size
  } catch {
    return 0
  }
}

export function invalidateDirectorySizeCache(dir) {
  if (dir) {
    directorySizeCache.delete(dir)
  } else {
    directorySizeCache.clear()
  }
}

export function shouldSkipSearchDir(name) {
  return ['.git', 'node_modules', 'dist', 'dist-ssr', '.vite'].includes(name)
}

export function shouldSearchFile(name) {
  const lower = name.toLowerCase()
  const blocked = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.7z', '.exe', '.dll', '.woff', '.woff2', '.ttf']
  return !blocked.some((extension) => lower.endsWith(extension))
}

export async function walkFiles(root, files = [], context) {
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (!shouldSkipSearchDir(entry.name)) {
        try {
          await assertSafeWorkspacePath(fullPath, context)
          await walkFiles(fullPath, files, context)
        } catch {
          // Skip directories that resolve outside the workspace.
        }
      }
    } else if (entry.isFile() && shouldSearchFile(entry.name)) {
      try {
        await assertSafeWorkspacePath(fullPath, context, { ignoreMissing: true })
        files.push(fullPath)
      } catch {
        // Skip symlinks or files that resolve outside the workspace.
      }
    }
  }
  return files
}
