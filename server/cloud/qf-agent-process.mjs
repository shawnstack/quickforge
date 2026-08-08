import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir } from '../storage.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '../..')
const RESTART_DELAYS_MS = [1_000, 5_000, 30_000]
const MAX_CONSECUTIVE_RESTARTS = 5
const STABLE_RUN_MS = 60_000
const VERSION_TIMEOUT_MS = 5_000
const STOP_TIMEOUT_MS = 3_000

let child = null
let childStartedAt = 0
let lockPath = null
let lockOwnerPid = null
let lockCleanupPromise = null
let restartTimer = null
let restartCount = 0
let stopRequested = false
let startPromise = null
let stopPromise = null
let lifecycleGeneration = 0
let versionCheckChild = null
let launchOptions = null
let status = createStatus()

function createStatus(overrides = {}) {
  return {
    enabled: process.env.QUICKFORGE_QF_AGENT_ENABLED !== '0',
    status: 'stopped',
    serverUrl: null,
    pid: null,
    verificationUriComplete: null,
    error: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function setStatus(next) {
  status = createStatus({ ...status, ...next, updatedAt: new Date().toISOString() })
}

function nodePlatformTarget(platform = process.platform) {
  if (platform === 'win32') return 'windows'
  return platform
}

function nodeArchTarget(arch = process.arch) {
  if (arch === 'x64') return 'amd64'
  if (arch === 'ia32') return '386'
  return arch
}

function runtimeAssetName(platform = process.platform) {
  return platform === 'win32' ? 'qf-agent.exe' : 'qf-agent'
}

function isDevelopmentRuntime(env = process.env) {
  return process.argv.includes('--dev')
    || env.NODE_ENV === 'development'
    || env.QUICKFORGE_QF_AGENT_DEV_FALLBACK === '1'
    || process.defaultApp === true
}

export function resolveQfAgentExecutable({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  root = projectRoot,
  development = isDevelopmentRuntime(env),
  pathExists = existsSync,
} = {}) {
  const name = runtimeAssetName(platform)
  const candidates = []
  if (env.QUICKFORGE_QF_AGENT_PATH) candidates.push(path.resolve(env.QUICKFORGE_QF_AGENT_PATH))
  candidates.push(path.join(root, 'runtime-assets', 'agent', `${platform}-${arch}`, name))
  if (development && platform === 'win32') {
    candidates.push(path.resolve(root, '..', 'quickforge-cloud', 'bin', 'agent.exe'))
  }
  return candidates.find((candidate) => pathExists(candidate)) || null
}

function identityDirectory(serverUrl) {
  if (process.env.QUICKFORGE_QF_AGENT_IDENTITY_DIR) {
    return path.resolve(process.env.QUICKFORGE_QF_AGENT_IDENTITY_DIR)
  }
  const runtimeKind = String(process.env.QUICKFORGE_RUNTIME_KIND || 'server').trim() || 'server'
  const safeRuntimeKind = runtimeKind.replace(/[^a-zA-Z0-9_-]/g, '-')
  const parsed = new URL(serverUrl)
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
  return path.join(dataDir, 'remote-agent', `${safeRuntimeKind}-${port}`)
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function readLock(file) {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'))
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

async function acquireLock(identityDir, ownerPid, serverUrl) {
  await fs.mkdir(path.dirname(identityDir), { recursive: true })
  const file = `${identityDir}.lock.json`

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(file, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify({ ownerPid, agentPid: null, serverUrl })}\n`, 'utf8')
      } finally {
        await handle.close()
      }
      lockPath = file
      lockOwnerPid = ownerPid
      return { acquired: true }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const existing = await readLock(file)
      if (existing && isProcessAlive(Number(existing.ownerPid)) && Number(existing.ownerPid) !== ownerPid) {
        return { acquired: false, conflict: true }
      }
      try {
        await fs.unlink(file)
      } catch (unlinkError) {
        if (unlinkError?.code !== 'ENOENT') throw unlinkError
      }
    }
  }
  return { acquired: false, conflict: true }
}

async function updateOwnLock(agentPid, serverUrl) {
  if (!lockPath) return
  const temporary = `${lockPath}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify({ ownerPid: lockOwnerPid, agentPid, serverUrl })}\n`, { encoding: 'utf8', mode: 0o600 })
    await fs.rename(temporary, lockPath)
  } catch (error) {
    await fs.unlink(temporary).catch(() => {})
    throw error
  }
}

async function clearOwnLock() {
  if (lockCleanupPromise) return lockCleanupPromise
  const file = lockPath
  const ownerPid = lockOwnerPid
  lockPath = null
  lockOwnerPid = null
  if (!file) return

  const pending = (async () => {
    const existing = await readLock(file)
    if (existing && Number(existing.ownerPid) !== ownerPid) return
    try {
      await fs.unlink(file)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  })().finally(() => {
    if (lockCleanupPromise === pending) lockCleanupPromise = null
  })
  lockCleanupPromise = pending
  return pending
}

function isCurrentLifecycle(generation) {
  return !stopRequested && generation === lifecycleGeneration && launchOptions !== null
}

async function terminateChild(activeChild) {
  if (!activeChild) return
  const exited = new Promise((resolve) => activeChild.once('exit', resolve))
  try { activeChild.kill('SIGTERM') } catch { /* best effort */ }
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS)),
  ])
  if (process.platform === 'win32' && isProcessAlive(activeChild.pid)) {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(activeChild.pid), '/T', '/F'], {
        windowsHide: true,
        shell: false,
        stdio: 'ignore',
      })
      killer.once('error', resolve)
      killer.once('exit', resolve)
    })
  }
}

function safeErrorMessage(value) {
  const text = String(value || '').trim()
  if (!text) return null
  return text
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(token|secret|password|api[_-]?key|private[_-]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[A-Za-z]:\\[^\s"']+/g, '[path]')
    .replace(/\/(?:[^\s/]+\/)+[^\s"']*/g, '[path]')
    .slice(0, 500)
}

function safeVerificationUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null
  } catch {
    return null
  }
}

export function parseQfAgentLogLine(line) {
  const text = String(line || '').trim()
  if (!text) return null
  let record
  try {
    record = JSON.parse(text)
  } catch {
    return null
  }
  if (!record || typeof record !== 'object') return null

  const message = typeof record.msg === 'string' ? record.msg : typeof record.message === 'string' ? record.message : ''
  const result = {}
  if (message.includes('等待设备授权')) {
    result.status = 'authorizing'
    result.verificationUriComplete = safeVerificationUrl(record.verificationUriComplete)
  } else if (message.includes('信令已连接')) {
    result.status = 'running'
    result.verificationUriComplete = null
  } else if (message.includes('信令连接中断') || message.includes('重连')) {
    result.status = 'starting'
  }

  const level = String(record.level || record.severity || '').toLowerCase()
  if (['error', 'fatal', 'panic'].includes(level)) result.error = safeErrorMessage(message) || 'qf-agent reported an error.'
  return Object.keys(result).length ? result : null
}

function consumeLines(stream, onLine) {
  let buffered = ''
  stream?.setEncoding('utf8')
  stream?.on('data', (chunk) => {
    buffered += chunk
    let newline = buffered.indexOf('\n')
    while (newline >= 0) {
      onLine(buffered.slice(0, newline).replace(/\r$/, ''))
      buffered = buffered.slice(newline + 1)
      newline = buffered.indexOf('\n')
    }
  })
  stream?.on('end', () => {
    if (buffered) onLine(buffered.replace(/\r$/, ''))
  })
}

function parseVersionOutput(output) {
  const lines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (const line of lines.reverse()) {
    try {
      const value = JSON.parse(line)
      if (value && typeof value === 'object') return value
    } catch {
      // Ignore non-JSON diagnostic lines.
    }
  }
  return null
}

export function validateQfAgentVersion(version, { platform = process.platform, arch = process.arch } = {}) {
  const expectedTarget = `${nodePlatformTarget(platform)}-${nodeArchTarget(arch)}`
  const actualTarget = String(version?.target || '').trim().toLowerCase().replace(/[/_]/g, '-')
  if (Number(version?.protocolVersion) !== 1) {
    throw new Error('qf-agent protocol version is not supported.')
  }
  if (actualTarget !== expectedTarget) {
    throw new Error(`qf-agent target is incompatible with ${expectedTarget}.`)
  }
  return true
}

async function checkVersion(executable) {
  const result = await new Promise((resolve, reject) => {
    const versionChild = spawn(executable, ['--version'], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    versionCheckChild = versionChild
    let stdout = ''
    let stderr = ''
    const finish = (callback, value) => {
      if (versionCheckChild === versionChild) versionCheckChild = null
      clearTimeout(timer)
      callback(value)
    }
    const timer = setTimeout(() => {
      try { versionChild.kill('SIGKILL') } catch { /* best effort */ }
      finish(reject, new Error('qf-agent version check timed out.'))
    }, VERSION_TIMEOUT_MS)
    timer.unref?.()
    versionChild.stdout?.setEncoding('utf8')
    versionChild.stderr?.setEncoding('utf8')
    versionChild.stdout?.on('data', (chunk) => { stdout += chunk })
    versionChild.stderr?.on('data', (chunk) => { stderr += chunk })
    versionChild.once('error', (error) => finish(reject, error))
    versionChild.once('exit', (code) => {
      if (code !== 0) {
        finish(reject, new Error(safeErrorMessage(stderr) || `qf-agent version check exited with code ${code}.`))
        return
      }
      finish(resolve, stdout)
    })
  })
  const version = parseVersionOutput(result)
  if (!version) throw new Error('qf-agent returned an invalid version response.')
  validateQfAgentVersion(version)
}

function scheduleRestart(generation) {
  if (!isCurrentLifecycle(generation) || restartTimer) return
  if (restartCount >= MAX_CONSECUTIVE_RESTARTS) {
    setStatus({ status: 'error', pid: null, error: status.error || 'qf-agent stopped after repeated failures.' })
    return
  }
  const delay = RESTART_DELAYS_MS[Math.min(restartCount, RESTART_DELAYS_MS.length - 1)]
  restartCount += 1
  setStatus({ status: 'starting', pid: null })
  restartTimer = setTimeout(() => {
    restartTimer = null
    if (!isCurrentLifecycle(generation)) return
    void beginLaunch(generation).catch((error) => {
      if (!isCurrentLifecycle(generation)) return
      setStatus({ status: 'error', pid: null, error: safeErrorMessage(error?.message) || 'qf-agent failed to restart.' })
      scheduleRestart(generation)
    })
  }, delay)
  restartTimer.unref?.()
}

async function launchQfAgent(generation) {
  const options = launchOptions
  if (!options || !isCurrentLifecycle(generation)) return getQfAgentStatus()
  const { serverUrl, ownerPid, cloudUrl } = options
  const executable = resolveQfAgentExecutable()
  if (!executable) {
    if (isCurrentLifecycle(generation)) {
      setStatus({ status: 'unavailable', serverUrl, pid: null, verificationUriComplete: null, error: null })
    }
    return getQfAgentStatus()
  }

  setStatus({ status: 'starting', serverUrl, pid: null, verificationUriComplete: null })
  try {
    await checkVersion(executable)
  } catch (error) {
    if (isCurrentLifecycle(generation)) {
      setStatus({ status: 'error', pid: null, error: safeErrorMessage(error?.message) || 'qf-agent version check failed.' })
    }
    return getQfAgentStatus()
  }
  if (!isCurrentLifecycle(generation)) return getQfAgentStatus()

  const identityDir = identityDirectory(serverUrl)
  const lock = await acquireLock(identityDir, ownerPid, serverUrl)
  if (!lock.acquired) {
    if (isCurrentLifecycle(generation)) setStatus({ status: 'conflict', pid: null, error: null })
    return getQfAgentStatus()
  }
  if (!isCurrentLifecycle(generation)) {
    await clearOwnLock().catch(() => {})
    return getQfAgentStatus()
  }
  await fs.mkdir(identityDir, { recursive: true })
  if (!isCurrentLifecycle(generation)) {
    await clearOwnLock().catch(() => {})
    return getQfAgentStatus()
  }

  let spawned
  try {
    spawned = spawn(executable, [], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        QF_CLOUD_URL: cloudUrl,
        QF_CLOUD_AGENT_DATA_DIR: identityDir,
        QF_CLOUD_AGENT_QF_URL: serverUrl,
        QF_CLOUD_AGENT_OWNER_PID: String(ownerPid),
      },
    })
    await new Promise((resolve, reject) => {
      spawned.once('spawn', resolve)
      spawned.once('error', reject)
    })
  } catch (error) {
    await clearOwnLock().catch(() => {})
    throw error
  }

  child = spawned
  childStartedAt = Date.now()
  spawned.once('exit', () => {
    if (child !== spawned) return
    const stableRun = Date.now() - childStartedAt >= STABLE_RUN_MS
    child = null
    childStartedAt = 0
    if (stableRun) restartCount = 0
    void clearOwnLock().then(() => {
      if (!isCurrentLifecycle(generation)) {
        setStatus({ status: 'stopped', pid: null, verificationUriComplete: null })
        return
      }
      scheduleRestart(generation)
    }).catch(() => {
      if (isCurrentLifecycle(generation)) scheduleRestart(generation)
    })
  })

  const onLine = (line) => {
    if (!isCurrentLifecycle(generation) || child !== spawned) return
    const update = parseQfAgentLogLine(line)
    if (update) setStatus(update)
  }
  consumeLines(spawned.stdout, onLine)
  consumeLines(spawned.stderr, onLine)

  try {
    await updateOwnLock(spawned.pid, serverUrl)
  } catch (error) {
    if (child === spawned) child = null
    await terminateChild(spawned)
    await clearOwnLock().catch(() => {})
    throw error
  }

  if (!isCurrentLifecycle(generation) || child !== spawned) {
    if (child === spawned) child = null
    await terminateChild(spawned)
    await clearOwnLock().catch(() => {})
    return getQfAgentStatus()
  }

  setStatus({ status: 'starting', pid: spawned.pid })
  return getQfAgentStatus()
}

function beginLaunch(generation) {
  if (startPromise) return startPromise
  const pending = launchQfAgent(generation).finally(() => {
    if (startPromise === pending) startPromise = null
  })
  startPromise = pending
  return pending
}

export async function startQfAgent({ serverUrl, ownerPid, cloudUrl }) {
  if (process.env.QUICKFORGE_QF_AGENT_ENABLED === '0') {
    setStatus({ enabled: false, status: 'disabled', serverUrl: null, pid: null, verificationUriComplete: null, error: null })
    return getQfAgentStatus()
  }
  if (stopPromise) await stopPromise
  if (child || restartTimer) return getQfAgentStatus()
  if (startPromise) return startPromise

  const options = {
    serverUrl: new URL(serverUrl).href,
    ownerPid: Number(ownerPid),
    cloudUrl: new URL(cloudUrl).href,
  }
  if (!Number.isInteger(options.ownerPid) || options.ownerPid <= 0) {
    setStatus({ status: 'error', error: 'qf-agent owner PID is invalid.' })
    return getQfAgentStatus()
  }
  lifecycleGeneration += 1
  const generation = lifecycleGeneration
  launchOptions = options
  stopRequested = false
  stopPromise = null
  restartCount = 0
  setStatus({ enabled: true, error: null })
  try {
    return await beginLaunch(generation)
  } catch (error) {
    if (isCurrentLifecycle(generation)) {
      setStatus({ status: 'error', pid: null, error: safeErrorMessage(error?.message) || 'qf-agent failed to start.' })
    }
    return getQfAgentStatus()
  }
}

export async function stopQfAgent() {
  if (stopPromise) return stopPromise
  stopRequested = true
  lifecycleGeneration += 1
  launchOptions = null
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  const activeVersionCheck = versionCheckChild
  if (activeVersionCheck) {
    try { activeVersionCheck.kill('SIGKILL') } catch { /* best effort */ }
  }

  stopPromise = (async () => {
    const pendingStart = startPromise
    if (pendingStart) await pendingStart.catch(() => {})
    const activeChild = child
    if (activeChild) {
      if (child === activeChild) child = null
      await terminateChild(activeChild)
    }
    await clearOwnLock().catch(() => {})
    setStatus({ status: 'stopped', pid: null, verificationUriComplete: null })
    return getQfAgentStatus()
  })()
  return stopPromise
}

export function getQfAgentStatus() {
  return {
    enabled: status.enabled,
    status: status.status,
    serverUrl: status.serverUrl,
    pid: status.pid,
    verificationUriComplete: status.verificationUriComplete,
    error: status.error,
    updatedAt: status.updatedAt,
  }
}
