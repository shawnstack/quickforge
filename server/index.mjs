#!/usr/bin/env node
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { sendJson, sendError } from './utils/response.mjs'
import { openBrowser } from './utils/platform.mjs'
import { ensureStorage, dataDir, configDir, storageDir, cacheDir, logsDir } from './storage.mjs'
import { setDefaultWorkspaceRoot, initializeActiveProject, readProjectConfig, getActiveProject, readTerminalShellSetting, updateTerminalShellSetting, readTerminalShellConfig, updateTerminalShellConfig } from './project-config.mjs'
import { getWorkspaceRoot } from './utils/workspace.mjs'
import { handleStorageApi } from './routes/storage.mjs'
import { handleProjectApi } from './routes/project.mjs'
import { handleFilesystemApi, setActiveWorkspaceRootForFilesystem } from './routes/filesystem.mjs'
import { handleToolApi, handleGetTools } from './routes/tools.mjs'
import { handleInstructionsApi } from './routes/instructions.mjs'
import { handleSkillsApi } from './routes/skills.mjs'
import { handleAgentApi } from './routes/agent.mjs'
import { handleAgentProfilesApi } from './routes/agent-profiles.mjs'
import { handleScheduledTasksApi, startScheduledTaskRunner, stopScheduledTaskRunner } from './routes/scheduled-tasks.mjs'
import { handleBackupApi } from './routes/backup.mjs'
import { handleSystemApi } from './routes/system.mjs'
import { handleSharesApi } from './routes/shares.mjs'
import { handleSharedConversationApi } from './routes/shared-conversation.mjs'
import { handleLanAccessApi, renderLanUnlockPage } from './routes/lan-access.mjs'
import { handleMcpApi } from './routes/mcp.mjs'
import { handleWorkspaceApi, handleGitApi } from './routes/workspace.mjs'
import { handleTerminalApi, handleTerminalUpgrade } from './routes/terminal.mjs'
import { serveStatic } from './routes/static.mjs'
import { logger, flushLogger } from './utils/logger.mjs'
import { installAiHttpLogger } from './ai-http-logger.mjs'
import { isLoopbackAddress, getLanUrls } from './utils/network.mjs'
import { parseCookies } from './share-store.mjs'
import { lanAccessCookieName, verifyLanAccessToken } from './lan-access-store.mjs'
import { shutdown as shutdownAgentManager, resetStaleTaskStatuses } from './agent-manager.mjs'
import { shutdownMcpConnections } from './mcp/registry.mjs'
import { shutdownTerminalSessions } from './terminal/terminal-manager.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const serverScript = path.join(__dirname, 'index.mjs')
const restartSupervisorScript = path.join(__dirname, 'restart-supervisor.mjs')
const bootId = randomUUID()
const startedAt = new Date().toISOString()

const isDev = process.argv.includes('--dev')
const shareLanEnabled = process.env.QUICKFORGE_SHARE_LAN !== '0'
const host = process.env.QUICKFORGE_HOST || '0.0.0.0'
if (!['127.0.0.1', 'localhost'].includes(host) && process.env.QUICKFORGE_ALLOW_REMOTE !== '1' && !shareLanEnabled) {
  throw new Error('Remote binding is disabled by default. Set QUICKFORGE_ALLOW_REMOTE=1 or keep QUICKFORGE_SHARE_LAN enabled to allow it.')
}
const port = Number(process.env.QUICKFORGE_PORT || (isDev ? 32176 : 5176))
const vitePort = Number(process.env.QUICKFORGE_VITE_PORT || 5176)
let restartInProgress = false

setDefaultWorkspaceRoot(process.env.QUICKFORGE_WORKSPACE_DIR || projectRoot)
installAiHttpLogger()

function getRestartSupport() {
  return { supported: true, reason: null }
}

async function getSystemStatus() {
  const config = await readProjectConfig()
  const restartSupport = getRestartSupport()
  return {
    ok: true,
    mode: isDev ? 'development' : 'production',
    pid: process.pid,
    bootId,
    startedAt,
    restartSupported: restartSupport.supported,
    restartUnsupportedReason: restartSupport.reason,
    dataDir,
    configDir,
    storageDir,
    cacheDir,
    logsDir,
    workspaceRoot: getWorkspaceRoot(),
    host,
    port,
    shareLanEnabled,
    lanUrls: getLanUrls(port),
    project: getActiveProject(config),
  }
}

function spawnRestartSupervisor() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      restartSupervisorScript,
      String(process.pid),
      serverScript,
      projectRoot,
      ...process.argv.slice(2),
    ], {
      cwd: projectRoot,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        QUICKFORGE_NO_OPEN: '1',
      },
    })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve(child.pid)
    })
  })
}

function closeHttpServer() {
  return new Promise((resolve) => {
    const forceTimer = setTimeout(() => {
      server.closeAllConnections?.()
      resolve()
    }, 1500)

    server.close(() => {
      clearTimeout(forceTimer)
      resolve()
    })
    server.closeIdleConnections?.()
  })
}

async function performRestart() {
  logger.info('Restart requested from settings UI.')
  const supervisorPid = await spawnRestartSupervisor()
  logger.info(`Restart supervisor started (PID ${supervisorPid}).`)

  stopScheduledTaskRunner()
  stopVite()
  await shutdownAgentManager()
  await shutdownMcpConnections()
  shutdownTerminalSessions()
  await closeHttpServer()
  process.exit(0)
}

async function requestRestart() {
  if (restartInProgress) {
    const error = new Error('Restart already in progress')
    error.statusCode = 423
    throw error
  }

  const restartSupport = getRestartSupport()
  if (!restartSupport.supported) {
    const error = new Error(restartSupport.reason || 'Restart is not supported')
    error.statusCode = 409
    throw error
  }

  restartInProgress = true
  setTimeout(() => {
    void performRestart().catch((error) => {
      logger.error('Failed to restart QuickForge:', error)
      restartInProgress = false
    })
  }, 100)

  return { ok: true, restarting: true, bootId }
}

// --- Route dispatching ---
async function handleApi(req, res, url) {
  const pathname = url.pathname
  const parts = pathname.split('/').filter(Boolean)

  // Conversation share routes (management + public LAN access)
  if (pathname === '/api/shares' || pathname.startsWith('/api/shares/')) {
    await handleSharesApi(req, res, url, { port })
    return
  }

  if (pathname.startsWith('/api/shared/')) {
    await handleSharedConversationApi(req, res, url)
    return
  }

  if (pathname === '/api/lan-access/status' || pathname === '/api/lan-access/settings' || pathname === '/api/lan-access/unlock' || pathname === '/api/lan-access/logout' || pathname === '/api/lan-access/revoke-all') {
    await handleLanAccessApi(req, res, url, {
      port,
      isLocalRequest: isLoopbackAddress(req.socket.remoteAddress),
    })
    return
  }

  // Health check
  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, await getSystemStatus())
    return
  }

  if (req.method === 'GET' && pathname === '/api/project/commands') {
    await handleProjectApi(req, res, url)
    return
  }

  // Instructions
  if (req.method === 'GET' && pathname === '/api/instructions') {
    await handleInstructionsApi(req, res, url)
    return
  }

  // Agent profiles
  if (pathname === '/api/agent-profiles' || pathname.startsWith('/api/agent-profiles/')) {
    await handleAgentProfilesApi(req, res, url)
    return
  }

  // Skills
  if (pathname === '/api/skills' || pathname.startsWith('/api/skills/')) {
    await handleSkillsApi(req, res, url)
    return
  }

  // MCP servers
  if (pathname === '/api/mcp' || pathname.startsWith('/api/mcp/')) {
    await handleMcpApi(req, res, url)
    return
  }

  // Project routes
  if (pathname === '/api/project' || pathname.startsWith('/api/project/')) {
    await handleProjectApi(req, res, url)
    return
  }

  // Project workspace inspector routes
  if (pathname === '/api/workspace/tree' || pathname === '/api/workspace/file' || pathname === '/api/workspace/resolve-path') {
    await handleWorkspaceApi(req, res, url)
    return
  }

  if (pathname === '/api/git/status' || pathname === '/api/git/file-diff') {
    await handleGitApi(req, res, url)
    return
  }

  // Filesystem routes
  if (pathname === '/api/filesystem' || pathname.startsWith('/api/filesystem/')) {
    await handleFilesystemApi(req, res, url)
    return
  }

  // Tool definitions (canonical)
  if (req.method === 'GET' && pathname === '/api/tools') {
    await handleGetTools(req, res)
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

  // Backup / import-export routes
  if (pathname === '/api/backup/export' || pathname === '/api/backup/import' || pathname === '/api/backup/inspect') {
    await handleBackupApi(req, res, url)
    return
  }

  // System routes
  if (pathname === '/api/system/status' || pathname === '/api/system/restart' || pathname === '/api/system/network' || pathname === '/api/system/terminal-shell') {
    await handleSystemApi(req, res, url, {
      getSystemStatus,
      requestRestart,
      getTerminalShellSetting: readTerminalShellSetting,
      updateTerminalShellSetting,
      getTerminalShellConfig: readTerminalShellConfig,
      updateTerminalShellConfig,
      host,
      port,
      remoteEnabled: host !== '127.0.0.1' && host !== 'localhost',
    })
    return
  }

  // Terminal routes (local-only; real shell access)
  if (pathname === '/api/terminal/capabilities' || pathname === '/api/terminal/sessions' || pathname.startsWith('/api/terminal/sessions/')) {
    await handleTerminalApi(req, res, url, {
      isLocalRequest: isLoopbackAddress(req.socket.remoteAddress),
    })
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
  viteChild.on('error', (error) => {
    logger.error('Failed to start Vite dev server:', error)
    process.exitCode = 1
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
  if (process.env.QUICKFORGE_ALLOW_REMOTE === '1' || shareLanEnabled) {
    allowedHosts.add('0.0.0.0')
    allowedHosts.add(parsed.hostname)
  }
  const expectedPort = String(port)
  const hostPort = parsed.port || '80'
  return allowedHosts.has(parsed.hostname) && hostPort === expectedPort
}

function isLanAccessBootstrapPath(pathname) {
  return pathname === '/api/health'
    || pathname === '/api/lan-access/status'
    || pathname === '/api/lan-access/unlock'
}

function isStaticAssetPath(pathname) {
  return pathname.startsWith('/assets/')
    || pathname === '/favicon.svg'
    || pathname === '/vite.svg'
    || pathname === '/manifest.webmanifest'
}

function isSharePath(pathname) {
  return pathname.startsWith('/share/')
    || pathname.startsWith('/api/shared/')
}

async function isAuthorizedRemoteRequest(req) {
  const token = parseCookies(req.headers.cookie).get(lanAccessCookieName())
  return verifyLanAccessToken(token)
}

function sendLanAuthRequired(res) {
  res.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify({ error: 'LAN authentication required' }))
}

// --- Bootstrap ---
const server = createServer(async (req, res) => {
  const reqId = randomUUID().slice(0, 8)
  const reqLogger = logger.child({ reqId })
  const startedAt = Date.now()
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt
    reqLogger.info(`${req.method} ${req.url} ${res.statusCode}`, { method: req.method, url: req.url, status: res.statusCode, durationMs })
  })

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
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-quickforge-action')
    res.setHeader('Access-Control-Max-Age', '86400')
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(origin && !isAllowedCorsOrigin(origin) ? 403 : 204)
    res.end()
    return
  }
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`)
    const remoteAddress = req.socket.remoteAddress
    const isRemoteRequest = !isLoopbackAddress(remoteAddress)
    const remoteAuthorized = isRemoteRequest ? await isAuthorizedRemoteRequest(req) : true

    if (isRemoteRequest && shareLanEnabled && !remoteAuthorized && !isLanAccessBootstrapPath(url.pathname) && !isSharePath(url.pathname) && !isStaticAssetPath(url.pathname)) {
      if (url.pathname.startsWith('/api/')) {
        sendLanAuthRequired(res)
      } else {
        renderLanUnlockPage(res)
      }
      return
    }

    if (
      url.pathname.startsWith('/api/') &&
      isRemoteRequest &&
      shareLanEnabled &&
      !remoteAuthorized &&
      !(url.pathname.startsWith('/api/shared/') || url.pathname === '/api/health' || url.pathname.startsWith('/api/lan-access/'))
    ) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'Remote API access is limited to shared conversation endpoints.' }))
      return
    }

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url)
      return
    }

    if (url.pathname.startsWith('/share/')) {
      await serveStatic(req, res, url)
      return
    }

    if (isStaticAssetPath(url.pathname)) {
      await serveStatic(req, res, url)
      return
    }

    if (isRemoteRequest && shareLanEnabled && !remoteAuthorized) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'Remote access is limited to shared conversation links.' }))
      return
    }

    if (isDev) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`QuickForge local API server is running. Open the Vite app at http://127.0.0.1:${vitePort}`)
      return
    }

    await serveStatic(req, res, url)
  } catch (error) {
    reqLogger.error(error.message || 'Request error', { stack: error.stack })
    sendError(res, error)
  }
})

function writeAndDestroySocket(socket, statusLine) {
  socket.on('error', () => {})
  if (!socket.destroyed) {
    try { socket.write(`${statusLine}\r\n\r\n`) } catch { /* ignore */ }
  }
  socket.destroy()
}

server.on('upgrade', (req, socket, head) => {
  if (!isAllowedHostHeader(req.headers.host)) {
    writeAndDestroySocket(socket, 'HTTP/1.1 403 Forbidden')
    return
  }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`)
    if (url.pathname.startsWith('/api/terminal/sessions/')) {
      handleTerminalUpgrade(req, socket, head, url, {
        isLocalRequest: isLoopbackAddress(req.socket.remoteAddress),
      })
      return
    }
    writeAndDestroySocket(socket, 'HTTP/1.1 404 Not Found')
  } catch {
    writeAndDestroySocket(socket, 'HTTP/1.1 400 Bad Request')
  }
})

await ensureStorage()
await resetStaleTaskStatuses()
await initializeActiveProject()
setActiveWorkspaceRootForFilesystem(getWorkspaceRoot())
startScheduledTaskRunner()

server.listen(port, host, () => {
  logger.info(`QuickForge local API: http://${host}:${port}`)
  if (shareLanEnabled) {
    const lanUrls = getLanUrls(port)
    logger.info(`QuickForge LAN sharing is enabled. Share pages are available at: ${lanUrls.length ? lanUrls.join(', ') : `http://<your-lan-ip>:${port}`}`)
    logger.info('Remote non-share API routes are restricted while QUICKFORGE_SHARE_LAN=1.')
  }
  logger.info(`QuickForge data dir: ${dataDir}`)
  logger.info(`QuickForge project: ${getWorkspaceRoot()}`)

  if (isDev) {
    startVite()
    setTimeout(() => openBrowser(`http://localhost:${vitePort}`), 1000)
  } else if (shareLanEnabled) {
    openBrowser(`http://localhost:${port}`)
  } else {
    openBrowser(`http://localhost:${port}`)
  }
})

// Graceful shutdown
async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`)
  stopScheduledTaskRunner()
  stopVite()
  await shutdownAgentManager()
  await shutdownMcpConnections()
  shutdownTerminalSessions()
  flushLogger()
  process.exit(0)
}

function handleShutdownSignal(signal) {
  void gracefulShutdown(signal).catch((error) => {
    logger.error('Graceful shutdown failed:', error)
    flushLogger()
    process.exit(1)
  })
}

process.on('SIGINT', handleShutdownSignal)
process.on('SIGTERM', handleShutdownSignal)
