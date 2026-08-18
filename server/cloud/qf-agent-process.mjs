import { spawn } from 'node:child_process'
import { chmodSync, existsSync, promises as fs, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir } from '../storage.mjs'
import { getNetworkProxyConfig } from '../network-proxy.mjs'
import { beginAgentAutoApproval, clearAgentAutoApproval, getAgentAutoApprovalState } from './auto-approval.mjs'

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
let identityInvalidation = null
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

function ensureAgentExecutable(executable, platform = process.platform) {
  if (platform === 'win32') return
  try {
    if (!(statSync(executable).mode & 0o111)) {
      chmodSync(executable, 0o755)
    }
  } catch {
    // Best effort: spawn will surface real permission errors through status.
  }
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

// 从 qf-agent 结构化日志安全提取一次性授权 user_code：优先 record.userCode/user_code，
// 否则从 verificationUriComplete（兼容 verificationUri）的 query 参数提取。
// 仅用于服务端自动批准流程，绝不进入公开 qf-agent 状态。
export function extractUserCodeFromVerification(record) {
  if (!record || typeof record !== 'object') return null
  const direct = record.userCode ?? record.user_code
  if (typeof direct === 'string' && direct.trim()) return direct.trim().slice(0, 64)
  const raw = record.verificationUriComplete ?? record.verificationUri
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const url = new URL(raw)
    for (const key of ['user_code', 'userCode', 'code']) {
      const value = url.searchParams.get(key)
      if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 64)
    }
  } catch {
    // 非 URL 视为无效，不自动批准
  }
  return null
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
    const userCode = extractUserCodeFromVerification(record)
    if (userCode) result.userCode = userCode
  } else if (message.includes('信令已连接')) {
    result.status = 'running'
    result.verificationUriComplete = null
  } else if (message.includes('信令连接中断') || message.includes('重连')) {
    result.status = 'starting'
  }

  const level = String(record.level || record.severity || '').toLowerCase()
  if (['error', 'fatal', 'panic'].includes(level)) result.error = safeErrorMessage(message) || 'qf-agent reported an error.'
  if (isIdentityInvalidationRecord(record)) result.identityInvalidated = true
  return Object.keys(result).length ? result : null
}

const IDENTITY_INVALIDATION_MARKERS = [
  'invalid_refresh_token',
  'refresh_token_reused',
  'installation_revoked',
  'refresh token 已失效',
]

// 仅在结构化 warn/error/fatal/panic 日志中识别身份失效错误码与既有终态提示；
// 普通文本、info 日志或无关 warning/error 不会触发。
export function isIdentityInvalidationRecord(record) {
  if (!record || typeof record !== 'object') return false
  const level = String(record.level || record.severity || '').toLowerCase()
  if (!['warn', 'error', 'fatal', 'panic'].includes(level)) return false
  const fields = [record.msg, record.message, record.error, record.err]
  if (!fields.some((value) => typeof value === 'string')) return false
  const haystack = fields.filter((value) => typeof value === 'string').join('\n')
  return IDENTITY_INVALIDATION_MARKERS.some((marker) => haystack.includes(marker))
}

// 仅当 QuickForge 配置为 manual 且 proxyUrl 非空时返回注入给 qf-agent 的代理 env；
// NO_PROXY 保留父进程已有条目并至少加入回环地址与 serverUrl 主机名。
export function buildQfAgentProxyEnv(serverUrl, config, env = process.env) {
  if (!config || config.mode !== 'manual' || !config.proxyUrl) return null
  let hostname = null
  try {
    hostname = new URL(serverUrl).hostname
  } catch {
    // serverUrl 非法时保持 null，不向 NO_PROXY 追加主机名
  }
  const existing = new Set()
  for (const key of ['NO_PROXY', 'no_proxy']) {
    const value = typeof env?.[key] === 'string' ? env[key] : ''
    for (const item of value.split(',')) {
      const trimmed = item.trim()
      if (trimmed) existing.add(trimmed)
    }
  }
  const parts = ['localhost', '127.0.0.1', '::1']
  if (hostname) parts.push(hostname)
  for (const item of existing) {
    if (!parts.includes(item)) parts.push(item)
  }
  return {
    HTTP_PROXY: config.proxyUrl,
    HTTPS_PROXY: config.proxyUrl,
    ALL_PROXY: config.proxyUrl,
    NO_PROXY: parts.join(','),
  }
}

async function resolveProxyEnvironment(serverUrl) {
  try {
    const { config } = await getNetworkProxyConfig()
    return buildQfAgentProxyEnv(serverUrl, config, process.env)
  } catch {
    return null
  }
}

// 仅清理当前 runtime 专属 identityDir/identity.json，绝不触碰
// storage/security/cloud-identity.json。优先 rename 到同目录临时 invalid 文件并尽快删除；
// Windows EPERM 安全 fallback unlink；ENOENT 幂等；只处理普通文件，不跟随 symlink。
async function isolateInvalidIdentity(identityDir) {
  const file = path.join(identityDir, 'identity.json')
  let stat
  try {
    stat = await fs.lstat(file)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  if (!stat.isFile()) return
  const invalidFile = `${file}.invalid-${process.pid}-${Date.now()}`
  try {
    await fs.rename(file, invalidFile)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    if (error?.code !== 'EPERM') throw error
    try {
      await fs.unlink(file)
    } catch (unlinkError) {
      if (unlinkError?.code !== 'ENOENT') throw unlinkError
    }
    return
  }
  try {
    await fs.unlink(invalidFile)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

// 命中身份失效后每 lifecycle 至多一次：标记身份重置、设置可操作状态并主动终止子进程。
function handleIdentityInvalidation(activeChild, generation, identityDir) {
  if (!isCurrentLifecycle(generation) || identityInvalidation?.generation === generation) return
  identityInvalidation = { generation, identityDir }
  setStatus({ status: 'authorizing', verificationUriComplete: null, error: null })
  if (activeChild && child === activeChild) {
    void terminateChild(activeChild).catch(() => {})
  }
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
  ensureAgentExecutable(executable)

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
    const proxyEnv = await resolveProxyEnvironment(serverUrl)
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
        ...(proxyEnv || {}),
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
    const invalid = identityInvalidation?.generation === generation ? identityInvalidation : null
    if (invalid) identityInvalidation = null
    void clearOwnLock().then(async () => {
      if (!isCurrentLifecycle(generation)) {
        setStatus({ status: 'stopped', pid: null, verificationUriComplete: null })
        return
      }
      if (invalid) {
        try {
          await isolateInvalidIdentity(invalid.identityDir)
        } catch {
          // 隔离失败：保留重启计数，由 MAX_CONSECUTIVE_RESTARTS 兜底约束重试
        }
        if (!isCurrentLifecycle(generation)) return
        // 无论隔离是否成功都不重置 restartCount：若新身份仍被云端拒绝，
        // 重启预算逐次消耗至 MAX_CONSECUTIVE_RESTARTS 停止，避免隔离清零导致无界循环；
        // 稳定运行（STABLE_RUN_MS）仍是唯一自然重置边界。
      }
      scheduleRestart(generation)
    }).catch(() => {
      if (isCurrentLifecycle(generation)) scheduleRestart(generation)
    })
  })

  const onLine = (line) => {
    if (!isCurrentLifecycle(generation) || child !== spawned) return
    const update = parseQfAgentLogLine(line)
    if (update) {
      const { identityInvalidated, userCode, ...statusUpdate } = update
      if (Object.keys(statusUpdate).length > 0) setStatus(statusUpdate)
      if (identityInvalidated) handleIdentityInvalidation(spawned, generation, identityDir)
      // userCode 仅供服务端自动批准使用，绝不进入公开状态。
      if (userCode) void beginAgentAutoApproval(userCode).catch(() => {})
    }
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
  identityInvalidation = null
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

export async function stopQfAgent({ disabled = false } = {}) {
  if (disabled) clearAgentAutoApproval()
  if (stopPromise) {
    const result = await stopPromise
    if (disabled && result.status !== 'disabled') {
      setStatus({ enabled: false, status: 'disabled', serverUrl: null, pid: null, verificationUriComplete: null, error: null })
      return getQfAgentStatus()
    }
    return result
  }
  stopRequested = true
  lifecycleGeneration += 1
  launchOptions = null
  identityInvalidation = null
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
    setStatus({ enabled: disabled ? false : status.enabled, status: disabled ? 'disabled' : 'stopped', serverUrl: null, pid: null, verificationUriComplete: null, error: null })
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
    autoApproval: getAgentAutoApprovalState(),
    updatedAt: status.updatedAt,
  }
}
