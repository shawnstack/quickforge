#!/usr/bin/env node
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { sendJson, sendError } from './utils/response.mjs'
import { openBrowser, openPathInFileManager } from './utils/platform.mjs'
import { ensureStorage, dataDir, configDir, storageDir, cacheDir, logsDir, createPhysicalSessionStateFsAdapter } from './storage.mjs'
import { initializeSessionStateService, stopSessionStateService } from './session-state-service.mjs'
import { importSessionStateFromJson } from './session-state-import.mjs'
import { initializeShareCutover } from './share-cutover.mjs'
import { drainShareJsonMirror, initializeShareService, stopShareService } from './share-service.mjs'
import { initializeLanAccessCutover } from './lan-access-cutover.mjs'
import { drainLanAccessJsonMirror, initializeLanAccessService, stopLanAccessService } from './lan-access-service.mjs'
import { recoverSessionStateRestorePlan } from './session-state-backup.mjs'
import { recoverShareRestorePlan } from './share-backup.mjs'
import { recoverLanAccessRestorePlan } from './lan-access-backup.mjs'
import { getNetworkProxyConfig, initializeNetworkProxy, refreshSystemProxy, updateNetworkProxyConfig } from './network-proxy.mjs'
import { setDefaultWorkspaceRoot, initializeActiveProject, readProjectConfig, getActiveProject, readTerminalShellSetting, updateTerminalShellSetting, readTerminalShellConfig, updateTerminalShellConfig } from './project-config.mjs'
import { getWorkspaceRoot } from './utils/workspace.mjs'
import { handleStorageApi } from './routes/storage.mjs'
import { handleProjectApi } from './routes/project.mjs'
import { handleFilesystemApi, setActiveWorkspaceRootForFilesystem } from './routes/filesystem.mjs'
import { handleToolApi, handleGetTools } from './routes/tools.mjs'
import { handleInstructionsApi } from './routes/instructions.mjs'
import { handleMemoryApi } from './routes/memory.mjs'
import { handleSkillsApi } from './routes/skills.mjs'
import { ensureDefaultGlobalSkills } from './skills.mjs'
import { handleAgentApi } from './routes/agent.mjs'
import { handleAgentProfilesApi } from './routes/agent-profiles.mjs'
import { handleScheduledTasksApi, recoverStaleScheduledTaskRuns, startScheduledTaskRunner, stopScheduledTaskRunner } from './routes/scheduled-tasks.mjs'
import { startAutoArchiveRunner, stopAutoArchiveRunner } from './auto-archive.mjs'
import { handleBackupApi } from './routes/backup.mjs'
import { handleSystemApi } from './routes/system.mjs'
import { handleSharesApi } from './routes/shares.mjs'
import { handleSharedConversationApi } from './routes/shared-conversation.mjs'
import { handleSessionAssetsApi } from './routes/session-assets.mjs'
import { handleLanAccessApi, renderLanUnlockPage } from './routes/lan-access.mjs'
import { handleMcpApi } from './routes/mcp.mjs'
import { handlePluginsApi } from './routes/plugins.mjs'
import { handleWorkspaceApi, handleGitApi } from './routes/workspace.mjs'
import { handleTerminalApi, handleTerminalUpgrade } from './routes/terminal.mjs'
import { handleChannelsApi } from './routes/channels.mjs'
import { handleModelsApi } from './routes/models.mjs'
import { handleCloudApi } from './routes/cloud.mjs'
import { handleSideChatApi } from './routes/side-chat.mjs'
import { readCloudServiceConfig } from './cloud/service-config.mjs'
import { startQfAgent, stopQfAgent, getQfAgentStatus } from './cloud/qf-agent-process.mjs'
import { serveStatic } from './routes/static.mjs'
import { logger, flushLogger } from './utils/logger.mjs'
import { getPackageInfo, checkForUpdates, checkDesktopRelease } from './utils/package-update.mjs'
import { installAiHttpLogger } from './ai-http-logger.mjs'
import { isLoopbackAddress, getLanUrls } from './utils/network.mjs'
import { parseCookies } from './share-store.mjs'
import { lanAccessCookieName, verifyLanAccessToken } from './lan-access-store.mjs'
import { shutdown as shutdownAgentManager, resetStaleTaskStatuses } from './agent-manager.mjs'
import { initializeChannels, shutdownChannels } from './channels/registry.mjs'
import { shutdownMcpConnections } from './mcp/registry.mjs'
import { shutdownTerminalSessions } from './terminal/terminal-manager.mjs'
import { closeSqliteStorage, getSqliteStorage, getSqliteStorageSummary, initializeSqliteStorage } from './sqlite/database.mjs'
import { initializeScheduledRunsCutover } from './scheduled-runs-cutover.mjs'
import { recoverScheduledRunsRestorePlan } from './scheduled-runs-backup.mjs'
import { getSessionIndexDiagnostics, initializeSessionIndex } from './session-index-service.mjs'
import { createNodeProcessEnv } from './utils/process-env.mjs'
import { isAuthenticatedAppClient } from './access-policy.mjs'
import { STARTUP_STATES, getStartupError, getStartupState, readMigrationStatus, resolveMaintenanceGate, setStartupState, withStartupRecoveryGuidance } from './startup-state.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const serverScript = path.join(__dirname, 'index.mjs')
const restartSupervisorScript = path.join(__dirname, 'restart-supervisor.mjs')
const updateSupervisorScript = path.join(__dirname, 'update-supervisor.mjs')
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
let updateInProgress = false
let shutdownPromise = null
let shutdownStarted = false
let qfAgentStartPromise = null
let boundServerPort = null
let startupInitializationPromise = null

setDefaultWorkspaceRoot(process.env.QUICKFORGE_WORKSPACE_DIR || path.join(dataDir, 'workspace'))

function getRestartSupport() {
  return { supported: true, reason: null }
}

async function getSystemStatus({ isLocalRequest = true, remoteAuthorized = false } = {}) {
  const config = await readProjectConfig()
  const restartSupport = getRestartSupport()
  const packageInfo = await getPackageInfo(projectRoot)
  const restartAllowed = isAuthenticatedAppClient({ isLocalRequest, remoteAuthorized })
  const restartSupported = restartAllowed && restartSupport.supported
  return {
    ok: true,
    mode: isDev ? 'development' : 'production',
    pid: process.pid,
    bootId,
    startedAt,
    version: packageInfo.version,
    package: packageInfo,
    isLocalRequest,
    capabilities: {
      restart: restartSupported,
      openLocalApps: isLocalRequest,
      terminal: isLocalRequest,
    },
    restartSupported,
    restartUnsupportedReason: restartAllowed ? restartSupport.reason : 'Restart requires an authenticated client',
    dataDir,
    configDir,
    storageDir,
    cacheDir,
    logsDir,
    sqlite: getSqliteStorageSummary(),
    sessionIndex: getSessionIndexDiagnostics(),
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
      env: createNodeProcessEnv(process.env, {
        QUICKFORGE_NO_OPEN: '1',
      }),
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

async function shutdownRuntime() {
  shutdownStarted = true
  try {
    await stopQfAgent()
    stopScheduledTaskRunner()
    stopAutoArchiveRunner()
    stopVite()
    await shutdownAgentManager()
    await shutdownMcpConnections()
    await shutdownChannels()
    shutdownTerminalSessions()
    await closeHttpServer()
  } finally {
    stopSessionStateService()
    stopShareService()
    stopLanAccessService()
    await closeSqliteStorage()
  }
}

export function stopQuickForgeServer() {
  if (!shutdownPromise) shutdownPromise = shutdownRuntime()
  return shutdownPromise
}

async function performRestart() {
  logger.info('Restart requested from settings UI.')
  const supervisorPid = await spawnRestartSupervisor()
  logger.info(`Restart supervisor started (PID ${supervisorPid}).`)

  await stopQuickForgeServer()
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

function updateLogFile() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  return path.join(logsDir, `update-${stamp}.log`)
}

function spawnUpdateSupervisor(update) {
  const logFile = updateLogFile()
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      updateSupervisorScript,
      String(process.pid),
      update.name,
      update.latestVersion,
      serverScript,
      projectRoot,
      logFile,
      ...process.argv.slice(2),
    ], {
      cwd: dataDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
      env: createNodeProcessEnv(process.env, {
        QUICKFORGE_NO_OPEN: '1',
      }),
    })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve({ pid: child.pid, logFile })
    })
  })
}

async function shutdownForUpdate() {
  logger.info('Shutting down QuickForge for external updater.')
  await stopQuickForgeServer()
  flushLogger()
  process.exit(0)
}

async function updateQuickForge() {
  if (updateInProgress) {
    const error = new Error('Update already in progress')
    error.statusCode = 423
    throw error
  }

  updateInProgress = true
  try {
    const update = await checkForUpdates(projectRoot)
    if (!update.updateAvailable) {
      updateInProgress = false
      return { ...update, ok: true, updated: false }
    }

    logger.info(`Starting external QuickForge updater from ${update.currentVersion} to ${update.latestVersion}.`)
    const supervisor = await spawnUpdateSupervisor(update)
    logger.info(`Update supervisor started (PID ${supervisor.pid}). Log: ${supervisor.logFile}`)

    setTimeout(() => {
      void shutdownForUpdate().catch((error) => {
        logger.error('Failed to shut down for QuickForge update:', error)
        updateInProgress = false
      })
    }, 100)

    return {
      ...update,
      ok: true,
      updated: false,
      updateStarted: true,
      restarting: true,
      updaterPid: supervisor.pid,
      logFile: supervisor.logFile,
      bootId,
    }
  } catch (error) {
    updateInProgress = false
    throw error
  }
}

async function applyCloudServiceConfig(cloudConfig, { urlChanged = false, autoApprovalPolicy } = {}) {
  if (shutdownStarted) return null
  if (!cloudConfig.enabled || !cloudConfig.valid) {
    if (!cloudConfig.valid) logger.warn(`QuickForge remote agent was not started: ${cloudConfig.configurationError || 'invalid Cloud configuration'}`)
    return stopQfAgent({ disabled: true })
  }
  if (!boundServerPort) return null
  const agentStatus = getQfAgentStatus()
  if (urlChanged || agentStatus.status === 'disabled' || agentStatus.enabled === false) await stopQfAgent()
  return startQfAgent({
    serverUrl: `http://127.0.0.1:${boundServerPort}/`,
    ownerPid: process.pid,
    cloudUrl: cloudConfig.cloudUrl,
    // undefined → 'auto'：server 启动恢复等本机生命周期允许自动 arm；
    // 'manual'：认证远程客户端触发的配置变更不自动批准。
    autoApprovalPolicy,
  })
}

// --- Route dispatching ---
async function handleApi(req, res, url, requestContext = {}) {
  const pathname = url.pathname
  const parts = pathname.split('/').filter(Boolean)

  // Conversation share routes (management + public LAN access)
  if (pathname === '/api/shares' || pathname.startsWith('/api/shares/')) {
    await handleSharesApi(req, res, url, { ...requestContext, port })
    return
  }

  if (pathname.startsWith('/api/shared/')) {
    await handleSharedConversationApi(req, res, url, requestContext)
    return
  }

  if (pathname.startsWith('/api/session-assets/')) {
    await handleSessionAssetsApi(req, res, url)
    return
  }

  if (pathname === '/api/side-chat/stream') {
    await handleSideChatApi(req, res, url, requestContext)
    return
  }

  if (pathname.startsWith('/api/lan-access/')) {
    await handleLanAccessApi(req, res, url, {
      port,
      isLocalRequest: requestContext.isLocalRequest === true,
    })
    return
  }

  // Health check
  if (req.method === 'GET' && pathname === '/api/health') {
    const startupState = getStartupState()
    if (startupState === STARTUP_STATES.FAILED) {
      // Startup failed but the process stays alive: waitForQuickForge keeps
      // polling (payload.ok is false) until its timeout, preserving the
      // "startup failed" semantics for CLI/Desktop.
      sendJson(res, 200, { ok: false, startupError: getStartupError() })
      return
    }
    if (startupState === STARTUP_STATES.MIGRATING) {
      // Maintenance window: keep the existing fields (pid, sqlite summary,
      // ...) so clients can bind early, plus maintenance:true for the UI.
      // Fall back to the minimal shape if the full status is not readable.
      try {
        sendJson(res, 200, { maintenance: true, ...(await getSystemStatus(requestContext)) })
        return
      } catch {
        sendJson(res, 200, { ok: true, maintenance: true })
        return
      }
    }
    sendJson(res, 200, await getSystemStatus(requestContext))
    return
  }

  // Migration progress during the startup maintenance window
  if (req.method === 'GET' && pathname === '/api/migration-status') {
    sendJson(res, 200, readMigrationStatus())
    return
  }

  if (req.method === 'GET' && pathname === '/api/project/commands') {
    await handleProjectApi(req, res, url, requestContext)
    return
  }

  // Instructions
  if (req.method === 'GET' && pathname === '/api/instructions') {
    await handleInstructionsApi(req, res, url)
    return
  }

  // Global user memory
  if (pathname === '/api/memory') {
    await handleMemoryApi(req, res)
    return
  }

  // Agent profiles
  if (pathname === '/api/agent-profiles' || pathname.startsWith('/api/agent-profiles/')) {
    await handleAgentProfilesApi(req, res, url, requestContext)
    return
  }

  // QuickForge Cloud account and managed models (local or authenticated Tailscale requests).
  if (pathname === '/api/cloud' || pathname.startsWith('/api/cloud/')) {
    await handleCloudApi(req, res, url, {
      isLocalRequest: requestContext.isLocalRequest === true,
      remoteAddress: requestContext.remoteAddress,
      remoteAuthorized: requestContext.remoteAuthorized === true,
      onCloudServiceConfigChanged: applyCloudServiceConfig,
    })
    return
  }

  // Custom model management (connection test)
  if (pathname === '/api/models/catalog' || pathname === '/api/models/test-connection') {
    await handleModelsApi(req, res, url, requestContext)
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

  // Channels
  if (pathname === '/api/channels' || pathname.startsWith('/api/channels/')) {
    await handleChannelsApi(req, res, url, {
      isLocalRequest: requestContext.isLocalRequest === true,
      logsDir,
      openPathInFileManager,
    })
    return
  }

  // Plugins
  if (pathname === '/api/plugins' || pathname.startsWith('/api/plugins/')) {
    await handlePluginsApi(req, res, url)
    return
  }

  // Project routes
  if (pathname === '/api/project' || pathname.startsWith('/api/project/')) {
    await handleProjectApi(req, res, url, requestContext)
    return
  }

  // Project workspace inspector routes
  if (pathname === '/api/workspace/tree' || pathname === '/api/workspace/children' || pathname === '/api/workspace/search' || pathname === '/api/workspace/mention-children' || pathname === '/api/workspace/mention-search' || pathname === '/api/workspace/file' || pathname === '/api/workspace/resolve-path' || pathname === '/api/workspace/open-external' || pathname.startsWith('/api/workspace/preview/')) {
    await handleWorkspaceApi(req, res, url, requestContext)
    return
  }

  if (pathname.startsWith('/api/git/')) {
    await handleGitApi(req, res, url, requestContext)
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
    await handleAgentApi(req, res, url, requestContext)
    return
  }

  // Scheduled task routes
  if (pathname === '/api/scheduled-tasks' || pathname.startsWith('/api/scheduled-tasks/')) {
    await handleScheduledTasksApi(req, res, url, requestContext)
    return
  }

  // Backup / import-export routes
  if (pathname === '/api/backup/export' || pathname === '/api/backup/import' || pathname === '/api/backup/inspect' || pathname === '/api/backup/inspect-file') {
    await handleBackupApi(req, res, url, requestContext)
    return
  }

  // System routes
  if (pathname === '/api/system/status' || pathname === '/api/system/restart' || pathname === '/api/system/network' || pathname === '/api/system/network-proxy' || pathname === '/api/system/network-proxy/refresh' || pathname === '/api/system/terminal-shell' || pathname === '/api/system/about' || pathname === '/api/system/update/check' || pathname === '/api/system/update/desktop' || pathname === '/api/system/update') {
    await handleSystemApi(req, res, url, {
      getSystemStatus: () => getSystemStatus(requestContext),
      requestRestart,
      getPackageInfo: () => getPackageInfo(projectRoot),
      checkForUpdates: () => checkForUpdates(projectRoot),
      checkDesktopRelease: () => checkDesktopRelease(projectRoot),
      updateQuickForge,
      isLocalRequest: requestContext.isLocalRequest === true,
      remoteAuthorized: requestContext.remoteAuthorized === true,
      getTerminalShellSetting: readTerminalShellSetting,
      updateTerminalShellSetting,
      getTerminalShellConfig: readTerminalShellConfig,
      updateTerminalShellConfig,
      getNetworkProxyConfig,
      updateNetworkProxyConfig,
      refreshSystemProxy,
      host,
      port,
      remoteEnabled: host !== '127.0.0.1' && host !== 'localhost',
    })
    return
  }

  // Terminal routes (local-only; real shell access)
  if (pathname === '/api/terminal/capabilities' || pathname === '/api/terminal/sessions' || pathname.startsWith('/api/terminal/sessions/')) {
    await handleTerminalApi(req, res, url, {
      isLocalRequest: requestContext.isLocalRequest === true,
    })
    return
  }

  // Storage routes (catch-all)
  if (parts[0] === 'api' && parts[1] === 'storage') {
    await handleStorageApi(req, res, url, requestContext)
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

const trustedTunnelSocket = Symbol('trustedTunnelSocket')

function isTunnelClientRequest(req) {
  if (
    isLoopbackAddress(req.socket.remoteAddress)
    && req.headers['x-quickforge-tunnel'] === '1'
    && req.headers.host === '127.0.0.1:18080'
  ) {
    req.socket[trustedTunnelSocket] = true
  }
  return req.socket[trustedTunnelSocket] === true
}

function isAllowedRequestHost(req, isTunnelClient) {
  return isAllowedHostHeader(req.headers.host)
    || (isTunnelClient && req.headers.host === '127.0.0.1:18080')
}

function isLanAccessBootstrapPath(pathname) {
  return pathname === '/api/health'
    || pathname === '/api/lan-access/status'
    || pathname === '/api/lan-access/unlock'
}

function isStaticAssetPath(pathname) {
  return pathname.startsWith('/assets/')
    || pathname.startsWith('/downloads/')
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

  const remoteAddress = req.socket.remoteAddress
  // 云远程访问（RemoteTunnel）：agent 与 qf 同机时流量经 127.0.0.1 回环进入并携带
  // X-QuickForge-Tunnel: 1。仅该可信隧道允许手机本地入口 127.0.0.1:18080 作为 Host。
  const isTunnelClient = isTunnelClientRequest(req)
  if (!isAllowedRequestHost(req, isTunnelClient)) {
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
    // 隧道请求视为“已认证远程客户端”：认证通过，但本地能力按远程请求裁剪。
    const isRemoteRequest = isTunnelClient || !isLoopbackAddress(remoteAddress)
    const remoteAuthorized = isRemoteRequest ? (isTunnelClient ? true : await isAuthorizedRemoteRequest(req)) : true

    if (isRemoteRequest && !remoteAuthorized && !isLanAccessBootstrapPath(url.pathname) && !isSharePath(url.pathname) && !isStaticAssetPath(url.pathname)) {
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
      !remoteAuthorized &&
      !(url.pathname.startsWith('/api/shared/') || url.pathname === '/api/health' || url.pathname.startsWith('/api/lan-access/'))
    ) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'Remote API access is limited to shared conversation endpoints.' }))
      return
    }

    if (url.pathname.startsWith('/api/')) {
      // Startup maintenance gate: while the background startup chain runs (or
      // failed), refuse every business API except the whitelisted readiness
      // endpoints. Non-/api paths (static assets, /share/) stay ungated so the
      // frontend can load and show migration progress.
      const gate = resolveMaintenanceGate(req.method, url.pathname)
      if (gate) {
        res.writeHead(gate.status, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'retry-after': '5',
        })
        res.end(JSON.stringify({ ok: false, maintenance: true, state: gate.state }))
        return
      }
      await handleApi(req, res, url, {
        isLocalRequest: !isRemoteRequest,
        remoteAddress,
        remoteAuthorized,
        tunnelClient: isTunnelClient,
      })
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

    if (isRemoteRequest && !remoteAuthorized) {
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
  const isTunnelClient = isTunnelClientRequest(req)
  if (!isAllowedRequestHost(req, isTunnelClient)) {
    writeAndDestroySocket(socket, 'HTTP/1.1 403 Forbidden')
    return
  }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`)
    if (url.pathname.startsWith('/api/terminal/sessions/')) {
      handleTerminalUpgrade(req, socket, head, url, {
        // 隧道流量同样是远程客户端：终端 WebSocket 保持禁止。
        isLocalRequest: isLoopbackAddress(req.socket.remoteAddress) && !isTunnelClient,
      })
      return
    }
    writeAndDestroySocket(socket, 'HTTP/1.1 404 Not Found')
  } catch {
    writeAndDestroySocket(socket, 'HTTP/1.1 400 Bad Request')
  }
})

// --- Startup chain (P1: listen early + maintenance window) ---
// Storage + SQLite initialization stay in front of listen (the maintenance
// gate and /api/migration-status rely on the database). The remaining
// migration/initialization chain runs in the background behind the gate
// while /api/health and /api/migration-status already answer and the
// frontend page is served, so the UI can display migration progress.
//
// Fail-closed semantics changed from "abort the process" to "stay alive and
// refuse business APIs": on failure the startup state becomes 'failed',
// /api/health answers {ok:false, startupError} (waitForQuickForge keeps
// polling until its timeout, preserving the "startup failed" result) and
// every non-whitelisted /api/* route keeps answering 503 maintenance until
// the operator intervenes (fix data / restart).
try {
  await ensureStorage()
  await initializeSqliteStorage({ dataDir })
} catch (error) {
  logger.error('QuickForge startup failed', { errorName: error?.name || 'Error', errorMessage: error?.message, stack: error?.stack })
  flushLogger()
  setStartupState(STARTUP_STATES.FAILED, withStartupRecoveryGuidance(error?.message))
}

// Startup-chain step timing: logs any single initialization step that takes
// >= 500ms with its duration, so slow steps on real machines (AV scanning,
// large libraries, network calls) surface directly in server logs instead of
// hiding inside the listen→complete gap.
const STARTUP_STEP_SLOW_MS = 500
async function timedStartupStep(label, fn) {
  const start = Date.now()
  try {
    return await fn()
  } finally {
    const durationMs = Date.now() - start
    if (durationMs >= STARTUP_STEP_SLOW_MS) {
      logger.info('Startup step slow', { startupStep: label, durationMs })
    }
  }
}

async function runStartupInitialization() {
  await timedStartupStep('scheduled-runs-cutover', () => initializeScheduledRunsCutover())
  await timedStartupStep('scheduled-runs-restore-plan', () => recoverScheduledRunsRestorePlan())
  await timedStartupStep('stale-scheduled-task-runs', () => recoverStaleScheduledTaskRuns())
  // Session state (storage v2): SQLite is authoritative by construction. The
  // only startup work is the one-shot JSON import — when the v2 store is empty
  // and legacy JSON session files exist, importSessionStateFromJson re-imports
  // them (idempotent, per-session transactions, WAL checkpoint at the end);
  // otherwise the store is ready as-is. The import runs inside the maintenance
  // window, so /api/* stays gated (process state 'migrating') until it
  // completes; the sessionState domain reports 'authoritative' throughout.
  await timedStartupStep('session-state-service', () => initializeSessionStateService())
  await timedStartupStep('session-state-import', async () => {
    const { createSessionStateRepository } = await import('./sqlite/session-state-repository.mjs')
    const repository = createSessionStateRepository(getSqliteStorage())
    if (repository.count() > 0) return
    const adapter = createPhysicalSessionStateFsAdapter()
    let hasJsonSessions = false
    for await (const bucket of adapter.listBuckets()) {
      for await (const sessionId of adapter.listSessionFiles(bucket)) {
        if (sessionId) {
          hasJsonSessions = true
          break
        }
      }
      if (hasJsonSessions) break
    }
    if (!hasJsonSessions) return
    logger.info('Session state JSON import starting (empty SQLite store, legacy files detected)', { domain: 'session-state' })
    const { imported, skipped } = await importSessionStateFromJson({ logger })
    logger.info('Session state JSON import finished', { domain: 'session-state', imported, skipped })
  })
  await timedStartupStep('session-state-restore-plan', () => recoverSessionStateRestorePlan())
  // Share storage cutover: share-store writes become SQLite-authoritative once
  // pending/authoritative; integrity failures fail closed and block startup,
  // json_authoritative failures keep the legacy JSON path. The JSON file stays
  // as the best-effort mirror drained through the share mirror queue.
  await timedStartupStep('share-cutover', () => initializeShareCutover())
  await timedStartupStep('share-service', () => initializeShareService())
  await timedStartupStep('share-restore-plan', () => recoverShareRestorePlan())
  await timedStartupStep('share-json-mirror-drain', () => drainShareJsonMirror())
  // LAN access storage cutover: JSON → SQLite with the same phase machine as
  // share storage. Integrity failures while pending/authoritative fail closed
  // and block startup; json_authoritative failures keep the legacy JSON store
  // path. The JSON file stays as the best-effort mirror drained through the
  // lan-access mirror queue. Interrupted lan-access restore plans are recovered
  // (roll-forward/rollback) before the mirror drain.
  await timedStartupStep('lan-access-cutover', () => initializeLanAccessCutover())
  await timedStartupStep('lan-access-service', () => initializeLanAccessService())
  await timedStartupStep('lan-access-restore-plan', () => recoverLanAccessRestorePlan())
  await timedStartupStep('lan-access-json-mirror-drain', () => drainLanAccessJsonMirror())
  await timedStartupStep('default-global-skills', () => ensureDefaultGlobalSkills())
  await timedStartupStep('network-proxy', () => initializeNetworkProxy())
  installAiHttpLogger()
  initializeChannels({
    projectRoot,
    channelEventsUrl: `http://127.0.0.1:${port}/api/channels/events`,
    logsDir,
  })
  await timedStartupStep('reset-stale-task-statuses', () => resetStaleTaskStatuses())
  await timedStartupStep('session-index', () => initializeSessionIndex())
  await timedStartupStep('active-project', () => initializeActiveProject())
  setActiveWorkspaceRootForFilesystem(getWorkspaceRoot())
  startScheduledTaskRunner()
  startAutoArchiveRunner()
}

if (getStartupState() !== STARTUP_STATES.FAILED) {
  // Fire-and-forget: never blocks listen; the promise always settles and the
  // handlers below flip the startup state for the gate and health endpoint.
  startupInitializationPromise = runStartupInitialization().then(() => {
    setStartupState(STARTUP_STATES.READY)
    logger.info('QuickForge startup initialization complete.')
  }).catch((error) => {
    logger.error('QuickForge startup failed', { errorName: error?.name || 'Error', errorMessage: error?.message, stack: error?.stack })
    flushLogger()
    setStartupState(STARTUP_STATES.FAILED, withStartupRecoveryGuidance(error?.message))
  })
}

server.on('error', (error) => {
  // Handle listen errors (most commonly EADDRINUSE). Without this, Node would
  // throw an uncaught exception and crash with only a raw stack trace in the log.
  if (error.code === 'EADDRINUSE') {
    logger.error(`Port ${port} is already in use. QuickForge could not start.`)
    logger.error('Hint: stop the running instance with "quickforge stop" or "quickforge restart", or use a different port with QUICKFORGE_PORT=<port>.')
  } else {
    logger.error(`QuickForge failed to listen on ${host}:${port}: ${error.message}`)
  }
  flushLogger()
  process.exit(1)
})

server.listen(port, host, () => {
  const address = server.address()
  const boundPort = typeof address === 'object' && address ? address.port : port
  boundServerPort = boundPort
  logger.info(`QuickForge local API: http://${host}:${boundPort}`)
  if (shareLanEnabled) {
    const lanUrls = getLanUrls(boundPort)
    logger.info(`QuickForge LAN sharing is enabled. Share pages are available at: ${lanUrls.length ? lanUrls.join(', ') : `http://<your-lan-ip>:${boundPort}`}`)
    logger.info('Remote non-share API routes are restricted while QUICKFORGE_SHARE_LAN=1.')
  }
  logger.info(`QuickForge data dir: ${dataDir}`)
  logger.info(`QuickForge project: ${getWorkspaceRoot()}`)

  const pending = (async () => {
    // The remote agent talks to the local business API: hold it back until the
    // background startup chain settles so it never races the maintenance gate.
    if (startupInitializationPromise) await startupInitializationPromise
    if (getStartupState() === STARTUP_STATES.FAILED) return null
    return applyCloudServiceConfig(await readCloudServiceConfig({ strict: false }))
  })().catch((error) => {
    if (!shutdownStarted) logger.warn(`QuickForge remote agent failed to start: ${error?.message || error}`)
    return null
  }).finally(() => {
    if (qfAgentStartPromise === pending) qfAgentStartPromise = null
  })
  qfAgentStartPromise = pending

  if (isDev) {
    startVite()
    setTimeout(() => openBrowser(`http://localhost:${vitePort}`), 1000)
  } else if (shareLanEnabled) {
    openBrowser(`http://localhost:${boundPort}`)
  } else {
    openBrowser(`http://localhost:${boundPort}`)
  }
})

// Graceful shutdown
async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`)
  await stopQuickForgeServer()
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
