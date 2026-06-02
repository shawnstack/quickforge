import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sendJson } from '../utils/response.mjs'
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
  await addRoot('QuickForge', projectRoot)
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

async function listFilesystemDirectories(inputPath, allowedRoots) {
  const requestedPath = String(inputPath || os.homedir())
  const resolved = path.resolve(requestedPath)

  // Only allow browsing within or at known filesystem roots
  const isAllowed = allowedRoots.some((root) => {
    const rel = path.relative(root, resolved)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  })
  if (!isAllowed) {
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

export async function handleFilesystemApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/filesystem/roots') {
    sendJson(res, 200, { roots: await getFilesystemRoots() })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/filesystem/directories') {
    const roots = await getFilesystemRoots()
    const allowedRootPaths = roots.map((r) => path.resolve(r.path))
    // Always allow browsing from home directory as a fallback
    allowedRootPaths.push(os.homedir())
    sendJson(res, 200, await listFilesystemDirectories(url.searchParams.get('path'), allowedRootPaths))
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}
