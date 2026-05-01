#!/usr/bin/env node
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sendJson, sendError } from './utils/response.mjs'
import { openBrowser } from './utils/platform.mjs'
import { ensureStorage, dataDir, configDir, storageDir, cacheDir, logsDir } from './storage.mjs'
import { setDefaultWorkspaceRoot, initializeActiveProject, readProjectConfig, getActiveProject } from './project-config.mjs'
import { getWorkspaceRoot } from './utils/workspace.mjs'
import { handleStorageApi } from './routes/storage.mjs'
import { handleProjectApi } from './routes/project.mjs'
import { handleFilesystemApi } from './routes/filesystem.mjs'
import { handleToolApi, handleGetTools } from './routes/tools.mjs'
import { handleInstructionsApi } from './routes/instructions.mjs'
import { handleAgentApi } from './routes/agent.mjs'
import { handleScheduledTasksApi, startScheduledTaskRunner, stopScheduledTaskRunner } from './routes/scheduled-tasks.mjs'
import { serveStatic } from './routes/static.mjs'
import { setActiveWorkspaceRootForFilesystem } from './routes/filesystem.mjs'
import { shutdown as shutdownAgentManager, resetStaleTaskStatuses } from './agent-manager.mjs'

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
      configDir,
      storageDir,
      cacheDir,
      logsDir,
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

  // Tool definitions (canonical)
  if (req.method === 'GET' && pathname === '/api/tools') {
    handleGetTools(req, res)
    return
  }

  // Tool routes
  if (pathname.startsWith('/api/tools/') || (parts[0] === 'api' && parts[1] === 'projects' && parts[3] === 'tools')) {
    await handleToolApi(req, res, url)
    return
  }

  // Agent routes
  if (parts[0] === 'api' && parts[1] === 'agents') {
    await handleAgentApi(req, res, url)
    return
  }

  // Scheduled task routes
  if (pathname === '/api/scheduled-tasks' || pathname.startsWith('/api/scheduled-tasks/')) {
    await handleScheduledTasksApi(req, res, url)
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
let viteChild = null

function startVite() {
  const viteCli = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  viteChild = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, QUICKFORGE_SERVER_PORT: String(port) },
  })
  viteChild.on('exit', (code) => {
    if (code && code !== 0) process.exitCode = code
  })
}

function stopVite() {
  if (viteChild) {
    viteChild.kill('SIGTERM')
    viteChild = null
  }
}

function isAllowedCorsOrigin(origin) {
  try {
    const parsed = new URL(origin)
    if (!['http:', 'https:'].includes(parsed.protocol)) return false
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) return false
    const originPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
    return originPort === String(port) || originPort === String(vitePort)
  } catch {
    return false
  }
}

function parseHostHeader(value) {
  if (!value) return null
  try {
    const parsed = new URL(`http://${value}`)
    return { hostname: parsed.hostname, port: parsed.port }
  } catch {
    return null
  }
}

function isAllowedHostHeader(value) {
  const parsed = parseHostHeader(value)
  if (!parsed) return false
  const allowedHosts = new Set(['localhost', '127.0.0.1', host])
  const expectedPort = String(port)
  const hostPort = parsed.port || '80'
  return allowedHosts.has(parsed.hostname) && hostPort === expectedPort
}

// --- Bootstrap ---
const server = createServer(async (req, res) => {
  if (!isAllowedHostHeader(req.headers.host)) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'Forbidden host' }))
    return
  }

  // Allow direct browser connections to the API server (e.g. SSE from dev mode
  // where the Vite proxy on :5176 would otherwise consume HTTP/1.1 connections).
  const origin = req.headers.origin
  if (origin && isAllowedCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    res.setHeader('Access-Control-Max-Age', '86400')
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(origin && !isAllowedCorsOrigin(origin) ? 403 : 204)
    res.end()
    return
  }
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`)
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url)
      return
    }

    if (isDev) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`QuickForge local API server is running. Open the Vite app at http://127.0.0.1:${vitePort}`)
      return
    }

    await serveStatic(req, res, url)
  } catch (error) {
    console.error(error)
    sendError(res, error)
  }
})

await ensureStorage()
await resetStaleTaskStatuses()
await initializeActiveProject()
setActiveWorkspaceRootForFilesystem(getWorkspaceRoot())
startScheduledTaskRunner()

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

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`)
  stopScheduledTaskRunner()
  stopVite()
  await shutdownAgentManager()
  process.exit(0)
}

process.on('SIGINT', (signal) => gracefulShutdown(signal))
process.on('SIGTERM', (signal) => gracefulShutdown(signal))
