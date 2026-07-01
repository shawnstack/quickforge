import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const serverScript = path.join(__dirname, 'index.mjs')
const serverScriptUrl = pathToFileURL(serverScript).href

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeHost(host) {
  return host || '127.0.0.1'
}

function getProbeHost(host) {
  if (host === '0.0.0.0' || host === '::') return '127.0.0.1'
  return host || '127.0.0.1'
}

function getDisplayHost(host) {
  if (host === '0.0.0.0') return '<LAN-IP>'
  if (host === '::') return '<LAN-IP>'
  return host || '127.0.0.1'
}

function getPort(port) {
  return Number(port || 5176)
}

function buildEnv(options = {}) {
  const host = normalizeHost(options.host)
  const port = getPort(options.port)
  const shareLan = options.shareLan === true
  const env = {
    ...process.env,
    QUICKFORGE_HOST: host,
    QUICKFORGE_PORT: String(port),
    QUICKFORGE_SHARE_LAN: shareLan ? '1' : '0',
    QUICKFORGE_NO_OPEN: options.openBrowser ? '0' : '1',
  }

  if (options.dataDir) env.QUICKFORGE_DATA_DIR = path.resolve(options.dataDir)
  if (options.workspaceDir) env.QUICKFORGE_WORKSPACE_DIR = path.resolve(options.workspaceDir)
  if (options.vitePort) env.QUICKFORGE_VITE_PORT = String(options.vitePort)
  if (options.terminal === false) env.QUICKFORGE_TERMINAL = '0'
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1'
  if (options.allowRemote || shareLan) env.QUICKFORGE_ALLOW_REMOTE = '1'

  return env
}

export function getQuickForgeUrl(options = {}) {
  const host = getDisplayHost(normalizeHost(options.host))
  const port = getPort(options.port)
  return `http://${host}:${port}`
}

export function getQuickForgeHealthUrl(options = {}) {
  const host = getProbeHost(normalizeHost(options.host))
  const port = getPort(options.port)
  return `http://${host}:${port}/api/health`
}

export async function checkQuickForgeHealth(options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs || 800)
  timeout.unref?.()

  try {
    const response = await fetch(getQuickForgeHealthUrl(options), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) return null
    const payload = await response.json()
    if (!payload || payload.ok !== true || !payload.pid) return null
    return payload
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function waitForQuickForge(options = {}) {
  const timeoutMs = options.timeoutMs || 15000
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const health = await checkQuickForgeHealth(options)
    if (health) return health
    await sleep(options.pollIntervalMs || 300)
  }

  return null
}

export async function startQuickForge(options = {}) {
  const existingHealth = options.reuseExisting === false ? null : await checkQuickForgeHealth(options)
  const url = getQuickForgeUrl(options)
  const healthUrl = getQuickForgeHealthUrl(options)

  if (existingHealth) {
    return {
      url,
      healthUrl,
      health: existingHealth,
      pid: existingHealth.pid,
      child: null,
      reused: true,
      async stop() {
        return false
      },
    }
  }

  if (options.inline === true) {
    await import(serverScriptUrl)
    const health = await waitForQuickForge(options)
    if (!health) throw new Error('QuickForge failed to start: health check timed out')
    return {
      url,
      healthUrl,
      health,
      pid: health.pid || process.pid,
      child: null,
      reused: false,
      inline: true,
      async stop() {
        return false
      },
    }
  }

  const child = spawn(process.execPath, [serverScript], {
    cwd: options.cwd ? path.resolve(options.cwd) : projectRoot,
    detached: options.detached === true,
    stdio: options.stdio || 'ignore',
    windowsHide: true,
    shell: false,
    env: buildEnv(options),
  })

  let exitInfo = null
  child.once('exit', (code, signal) => {
    exitInfo = { code, signal }
  })

  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })

  const health = await waitForQuickForge(options)
  if (!health) {
    if (!child.killed && exitInfo === null) {
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore best-effort cleanup errors
      }
    }

    const reason = exitInfo
      ? `process exited early (code ${exitInfo.code ?? 'null'}, signal ${exitInfo.signal ?? 'null'})`
      : 'health check timed out'
    throw new Error(`QuickForge failed to start: ${reason}`)
  }

  if (options.detached === true) child.unref()

  return {
    url,
    healthUrl,
    health,
    pid: health.pid || child.pid,
    child,
    reused: false,
    async stop() {
      if (child.killed) return false
      child.kill('SIGTERM')
      return true
    },
  }
}

export async function stopQuickForge(instance) {
  if (!instance?.child || instance.reused) return false
  if (instance.child.killed) return false
  instance.child.kill('SIGTERM')
  return true
}
