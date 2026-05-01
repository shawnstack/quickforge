#!/usr/bin/env node
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sendJson, sendError } from './utils/response.mjs'
import { openBrowser } from './utils/platform.mjs'
import { ensureStorage, dataDir, storageDir } from './storage.mjs'
import { setDefaultWorkspaceRoot, initializeActiveProject, readProjectConfig, getActiveProject } from './project-config.mjs'
import { getWorkspaceRoot } from './utils/workspace.mjs'
import { handleStorageApi } from './routes/storage.mjs'
import { handleProjectApi } from './routes/project.mjs'
import { handleFilesystemApi } from './routes/filesystem.mjs'
import { handleToolApi } from './routes/tools.mjs'
import { handleInstructionsApi } from './routes/instructions.mjs'
import { serveStatic } from './routes/static.mjs'
import { setActiveWorkspaceRootForFilesystem } from './routes/filesystem.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

const isDev = process.argv.includes('--dev')
const host = process.env.QUICKFORGE_HOST || '127.0.0.1'
const port = Number(process.env.QUICKFORGE_PORT || (isDev ? 32176 : 5176))
const vitePort = Number(process.env.QUICKFORGE_VITE_PORT || 5176)

setDefaultWorkspaceRoot(process.env.QUICKFORGE_WORKSPACE_DIR || projectRoot)

// --- Route dispatching ---
async function handleApi(req, res, url) {
  const pathname = url.pathname
  const parts = pathname.split('/').filter(Boolean)

  // Health check
  if (req.method === 'GET' && pathname === '/api/health') {
    const config = await readProjectConfig()
    sendJson(res, 200, {
      ok: true,
      mode: isDev ? 'development' : 'production',
      dataDir,
      storageDir,
      workspaceRoot: getWorkspaceRoot(),
      project: getActiveProject(config),
    })
    return
  }

  // Instructions
  if (req.method === 'GET' && pathname === '/api/instructions') {
    await handleInstructionsApi(req, res, url)
    return
  }

  // Project routes
  if (pathname === '/api/project' || pathname.startsWith('/api/project/')) {
    await handleProjectApi(req, res, url)
    return
  }

  // Filesystem routes
  if (pathname === '/api/filesystem' || pathname.startsWith('/api/filesystem/')) {
    await handleFilesystemApi(req, res, url)
    return
  }

  // Tool routes
  if (pathname.startsWith('/api/tools/') || (parts[0] === 'api' && parts[1] === 'projects' && parts[3] === 'tools')) {
    await handleToolApi(req, res, url)
    return
  }

  // Storage routes (catch-all)
  if (parts[0] === 'api' && parts[1] === 'storage') {
    await handleStorageApi(req, res, url)
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}

// --- Vite dev server ---
function startVite() {
  const viteCli = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, QUICKFORGE_SERVER_PORT: String(port) },
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

// --- Bootstrap ---
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`)
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url)
      return
    }

    if (isDev) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('QuickForge local API server is running. Open the Vite app at http://127.0.0.1:5176')
      return
    }

    await serveStatic(req, res, url)
  } catch (error) {
    console.error(error)
    sendError(res, error)
  }
})

await ensureStorage()
await initializeActiveProject()
setActiveWorkspaceRootForFilesystem(getWorkspaceRoot())

server.listen(port, host, () => {
  console.log(`QuickForge local API: http://${host}:${port}`)
  console.log(`QuickForge data dir: ${dataDir}`)
  console.log(`QuickForge project: ${getWorkspaceRoot()}`)

  if (isDev) {
    startVite()
    setTimeout(() => openBrowser(`http://localhost:${vitePort}`), 1000)
  } else {
    openBrowser(`http://localhost:${port}`)
  }
})
