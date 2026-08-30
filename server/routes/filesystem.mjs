import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sendJson, readJsonBody } from '../utils/response.mjs'
import { pathExists, assertDirectory } from '../utils/workspace.mjs'

const __filename = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(__filename), '../..')
let _activeWorkspaceRoot = projectRoot

export function setActiveWorkspaceRootForFilesystem(root) {
  _activeWorkspaceRoot = path.resolve(root)
}

async function getFilesystemRoots() {
  const roots = []
  const addRoot = async (name, rootPath) => {
    if (!rootPath) return
    const resolved = path.resolve(rootPath)
    if (!(await pathExists(resolved))) return
    if (roots.some((entry) => path.resolve(entry.path) === resolved)) return
    roots.push({ name, path: resolved })
  }

  const home = os.homedir()
  await addRoot('Home', home)
  await addRoot('Desktop', path.join(home, 'Desktop'))
  await addRoot('Documents', path.join(home, 'Documents'))
  await addRoot('Current project', _activeWorkspaceRoot)

  if (process.platform === 'win32') {
    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`
      await addRoot(drive, drive)
    }
  } else {
    await addRoot('Filesystem', '/')
    if (process.platform === 'darwin' && (await pathExists('/Volumes'))) {
      const volumes = await fs.readdir('/Volumes', { withFileTypes: true }).catch(() => [])
      for (const volume of volumes) {
        if (volume.isDirectory() || volume.isSymbolicLink()) {
          await addRoot(volume.name, path.join('/Volumes', volume.name))
        }
      }
    }
  }

  return roots
}

function isPathWithinRoots(resolved, allowedRoots) {
  return allowedRoots.some((root) => {
    const rel = path.relative(root, resolved)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  })
}

async function getAllowedRootPaths() {
  const roots = await getFilesystemRoots()
  const allowedRootPaths = roots.map((r) => path.resolve(r.path))
  // Always allow browsing from home directory as a fallback
  allowedRootPaths.push(os.homedir())
  return allowedRootPaths
}

async function listFilesystemDirectories(inputPath, allowedRoots) {
  const requestedPath = String(inputPath || os.homedir())
  const resolved = path.resolve(requestedPath)

  // Only allow browsing within or at known filesystem roots
  if (!isPathWithinRoots(resolved, allowedRoots)) {
    const error = new Error('Access denied: path is outside allowed roots')
    error.statusCode = 403
    throw error
  }

  await assertDirectory(resolved)

  const entries = await fs.readdir(resolved, { withFileTypes: true }).catch((error) => {
    error.statusCode = error?.code === 'EACCES' || error?.code === 'EPERM' ? 403 : 400
    throw error
  })

  const directories = entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => ({ name: entry.name, path: path.join(resolved, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))

  const parsed = path.parse(resolved)
  const parent = resolved === parsed.root ? null : path.dirname(resolved)
  return { path: resolved, parent, directories }
}

async function createFilesystemDirectory(parentPath, name, allowedRoots) {
  const parent = String(parentPath || '').trim()
  if (!parent) {
    const error = new Error('parentPath is required')
    error.statusCode = 400
    throw error
  }

  const trimmed = String(name || '').trim()
  if (
    !trimmed
    || trimmed.includes('/')
    || trimmed.includes('\\')
    || trimmed === '.'
    || trimmed === '..'
    || trimmed.includes('\0')
  ) {
    const error = new Error('Invalid directory name')
    error.statusCode = 400
    throw error
  }

  const resolvedParent = path.resolve(parent)
  if (!isPathWithinRoots(resolvedParent, allowedRoots)) {
    const error = new Error('Access denied: path is outside allowed roots')
    error.statusCode = 403
    throw error
  }

  try {
    await assertDirectory(resolvedParent)
  } catch {
    const error = new Error(`Parent directory does not exist: ${resolvedParent}`)
    error.statusCode = 404
    throw error
  }

  const target = path.join(resolvedParent, trimmed)
  try {
    await fs.mkdir(target, { recursive: false })
  } catch (mkdirError) {
    if (mkdirError?.code === 'EEXIST') {
      const error = new Error('Directory already exists')
      error.statusCode = 409
      throw error
    }
    if (mkdirError?.code === 'EACCES' || mkdirError?.code === 'EPERM') {
      const error = new Error('Access denied: cannot create directory')
      error.statusCode = 403
      throw error
    }
    throw mkdirError
  }

  return { ok: true, path: target }
}

export async function handleFilesystemApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/filesystem/roots') {
    sendJson(res, 200, { roots: await getFilesystemRoots() })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/filesystem/directories') {
    sendJson(res, 200, await listFilesystemDirectories(url.searchParams.get('path'), await getAllowedRootPaths()))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/filesystem/mkdir') {
    const body = await readJsonBody(req)
    sendJson(res, 200, await createFilesystemDirectory(body?.parentPath, body?.name, await getAllowedRootPaths()))
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}
