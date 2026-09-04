import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  spawn: vi.fn(),
  getNetworkProxyConfig: vi.fn(),
  getCloudRuntime: vi.fn(),
}))

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process')
  return { ...actual, spawn: mocks.spawn }
})

vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs')
  return { ...actual, existsSync: mocks.existsSync }
})

vi.mock('../../../server/network-proxy.mjs', () => ({
  getNetworkProxyConfig: mocks.getNetworkProxyConfig,
}))

vi.mock('../../../server/cloud/runtime.mjs', () => ({
  getCloudRuntime: mocks.getCloudRuntime,
}))

import {
  buildQfAgentProxyEnv,
  extractUserCodeFromVerification,
  getQfAgentStatus,
  isIdentityInvalidationRecord,
  parseQfAgentLogLine,
  resolveQfAgentExecutable,
  startQfAgent,
  stopQfAgent,
  validateQfAgentVersion,
} from '../../../server/cloud/qf-agent-process.mjs'
import { resetAgentAutoApprovalForTests } from '../../../server/cloud/auto-approval.mjs'

let tempDir
let nextPid = 41_000

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createChild({ pid = nextPid++ } = {}) {
  const child = new EventEmitter()
  child.pid = pid
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit('exit', 1))
    return true
  })
  return child
}

function useSuccessfulAgentSpawn({ runtimeSpawnGate = null } = {}) {
  const versionChildren = []
  const runtimeChildren = []
  mocks.spawn.mockImplementation((executable, args) => {
    const child = createChild()
    if (executable === 'taskkill') {
      queueMicrotask(() => child.emit('exit', 0))
      return child
    }
    if (Array.isArray(args) && args.includes('--version')) {
      versionChildren.push(child)
      queueMicrotask(() => {
        child.stdout.write(`${JSON.stringify({ protocolVersion: 1, target: process.platform === 'win32' ? 'windows-amd64' : `${process.platform}-amd64` })}\n`)
        child.emit('exit', 0)
      })
    } else {
      runtimeChildren.push(child)
      if (runtimeSpawnGate) runtimeSpawnGate.promise.then(() => child.emit('spawn'))
      else queueMicrotask(() => child.emit('spawn'))
    }
    return child
  })
  return { versionChildren, runtimeChildren }
}

function startOptions() {
  return {
    serverUrl: 'http://127.0.0.1:5176/',
    ownerPid: process.pid,
    cloudUrl: 'https://cloud.example/',
  }
}

beforeEach(async () => {
  vi.useRealTimers()
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quickforge-qf-agent-'))
  process.env.QUICKFORGE_QF_AGENT_PATH = process.execPath
  process.env.QUICKFORGE_QF_AGENT_IDENTITY_DIR = path.join(tempDir, 'identity')
  delete process.env.QUICKFORGE_QF_AGENT_ENABLED
  mocks.existsSync.mockReset()
  mocks.existsSync.mockImplementation((candidate) => candidate === process.execPath)
  mocks.spawn.mockReset()
  mocks.getNetworkProxyConfig.mockReset()
  mocks.getNetworkProxyConfig.mockResolvedValue({ config: { mode: 'direct', proxyUrl: '' } })
  mocks.getCloudRuntime.mockReset()
  resetAgentAutoApprovalForTests()
})

afterEach(async () => {
  vi.useRealTimers()
  delete process.env.QUICKFORGE_QF_AGENT_ENABLED
  delete process.env.QUICKFORGE_QF_AGENT_PATH
  delete process.env.QUICKFORGE_QF_AGENT_IDENTITY_DIR
  delete process.env.HTTP_PROXY
  delete process.env.NO_PROXY
  delete process.env.http_proxy
  delete process.env.no_proxy
  resetAgentAutoApprovalForTests()
  await stopQfAgent()
  await fs.rm(tempDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('qf-agent process manager', () => {
  it('returns a redacted public status shape', () => {
    const status = getQfAgentStatus()
    expect(status).toEqual(expect.objectContaining({ status: expect.any(String), enabled: expect.any(Boolean) }))
    expect(status).not.toHaveProperty('executable')
    expect(status).not.toHaveProperty('identityDir')
    expect(JSON.stringify(status)).not.toContain('token')
  })

  it('reports unavailable without starting a real agent when no binary exists', async () => {
    process.env.QUICKFORGE_QF_AGENT_PATH = path.join(tempDir, 'missing-agent.exe')
    process.env.NODE_ENV = 'production'
    delete process.env.QUICKFORGE_QF_AGENT_DEV_FALLBACK
    const status = await startQfAgent(startOptions())
    expect(status.status).toBe('unavailable')
    expect(status.pid).toBeNull()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('serializes concurrent starts and spawns only one agent', async () => {
    const { runtimeChildren } = useSuccessfulAgentSpawn()
    const [first, second] = await Promise.all([
      startQfAgent(startOptions()),
      startQfAgent(startOptions()),
    ])

    expect(runtimeChildren).toHaveLength(1)
    expect(first.pid).toBe(runtimeChildren[0].pid)
    expect(second.pid).toBe(runtimeChildren[0].pid)
  })

  it('stops an in-flight version check without spawning an agent', async () => {
    const versionChild = createChild()
    mocks.spawn.mockReturnValueOnce(versionChild)

    const starting = startQfAgent(startOptions())
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1))
    const stopped = await stopQfAgent()
    await starting

    expect(versionChild.kill).toHaveBeenCalledWith('SIGKILL')
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
    expect(stopped.status).toBe('stopped')
    expect(stopped.pid).toBeNull()
  })

  it('clears a lock acquired after stop was requested', async () => {
    useSuccessfulAgentSpawn()
    const realOpen = fs.open.bind(fs)
    const lockOpenStarted = deferred()
    const releaseOpen = deferred()
    vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
      const handle = await realOpen(...args)
      lockOpenStarted.resolve()
      await releaseOpen.promise
      return handle
    })

    const starting = startQfAgent(startOptions())
    await lockOpenStarted.promise
    const stopping = stopQfAgent()
    releaseOpen.resolve()
    await Promise.all([starting, stopping])

    expect(mocks.spawn).toHaveBeenCalledTimes(1)
    await expect(fs.access(`${process.env.QUICKFORGE_QF_AGENT_IDENTITY_DIR}.lock.json`)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(getQfAgentStatus().status).toBe('stopped')
  })

  it('terminates an agent whose spawn completes after stop was requested', async () => {
    const runtimeSpawnGate = deferred()
    const { runtimeChildren } = useSuccessfulAgentSpawn({ runtimeSpawnGate })
    const starting = startQfAgent(startOptions())
    await vi.waitFor(() => expect(runtimeChildren).toHaveLength(1))

    const stopping = stopQfAgent()
    runtimeSpawnGate.resolve()
    await Promise.all([starting, stopping])

    expect(runtimeChildren[0].kill).toHaveBeenCalledWith('SIGTERM')
    expect(getQfAgentStatus()).toEqual(expect.objectContaining({ status: 'stopped', pid: null }))
    await expect(fs.access(`${process.env.QUICKFORGE_QF_AGENT_IDENTITY_DIR}.lock.json`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('terminates the agent and clears the lock when updating the lock fails', async () => {
    const { runtimeChildren } = useSuccessfulAgentSpawn()
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename failed'))

    const result = await startQfAgent(startOptions())

    expect(result.status).toBe('error')
    expect(result.pid).toBeNull()
    expect(runtimeChildren).toHaveLength(1)
    expect(runtimeChildren[0].kill).toHaveBeenCalledWith('SIGTERM')
    await expect(fs.access(`${process.env.QUICKFORGE_QF_AGENT_IDENTITY_DIR}.lock.json`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('waits for an exit-triggered lock cleanup before stop resolves', async () => {
    const { runtimeChildren } = useSuccessfulAgentSpawn()
    await startQfAgent(startOptions())
    const realUnlink = fs.unlink.bind(fs)
    const cleanupStarted = deferred()
    const releaseCleanup = deferred()
    vi.spyOn(fs, 'unlink').mockImplementationOnce(async (file) => {
      cleanupStarted.resolve()
      await releaseCleanup.promise
      return realUnlink(file)
    })

    runtimeChildren[0].emit('exit', 1)
    await cleanupStarted.promise
    let stopResolved = false
    const stopping = stopQfAgent().then((value) => {
      stopResolved = true
      return value
    })
    await Promise.resolve()
    expect(stopResolved).toBe(false)

    releaseCleanup.resolve()
    await stopping
    await expect(fs.access(`${process.env.QUICKFORGE_QF_AGENT_IDENTITY_DIR}.lock.json`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not double start while a restart timer is pending', async () => {
    vi.useFakeTimers()
    const { runtimeChildren } = useSuccessfulAgentSpawn()
    await startQfAgent(startOptions())
    expect(runtimeChildren).toHaveLength(1)

    runtimeChildren[0].emit('exit', 1)
    await vi.advanceTimersByTimeAsync(0)
    await startQfAgent(startOptions())
    await vi.advanceTimersByTimeAsync(1_000)

    expect(runtimeChildren).toHaveLength(2)
  })

  it('parses authorization and signaling JSON logs without exposing extra fields', () => {
    expect(parseQfAgentLogLine(JSON.stringify({ msg: '等待设备授权', verificationUriComplete: 'https://cloud.example/device?code=ABCD', token: 'secret' })))
      .toEqual({ status: 'authorizing', verificationUriComplete: 'https://cloud.example/device?code=ABCD', userCode: 'ABCD' })
    expect(parseQfAgentLogLine(JSON.stringify({ msg: '等待设备授权', verificationUriComplete: 'https://cloud.example/device?user_code=WXYZ-1234' })))
      .toEqual({ status: 'authorizing', verificationUriComplete: 'https://cloud.example/device?user_code=WXYZ-1234', userCode: 'WXYZ-1234' })
    expect(parseQfAgentLogLine(JSON.stringify({ msg: '信令已连接' })))
      .toEqual({ status: 'running', verificationUriComplete: null })
    expect(parseQfAgentLogLine(JSON.stringify({ msg: '信令连接中断，准备重连' })))
      .toEqual({ status: 'starting' })
  })

  it('extracts a one-time user code from structured authorization logs only', () => {
    expect(extractUserCodeFromVerification({ verificationUriComplete: 'https://cloud.example/device?user_code=ABCD-EFGH' })).toBe('ABCD-EFGH')
    expect(extractUserCodeFromVerification({ verificationUriComplete: 'https://cloud.example/device?userCode=ABCD-EFGH' })).toBe('ABCD-EFGH')
    expect(extractUserCodeFromVerification({ verificationUriComplete: 'https://cloud.example/device?code=ABCD-EFGH' })).toBe('ABCD-EFGH')
    expect(extractUserCodeFromVerification({ userCode: 'WXYZ-1234' })).toBe('WXYZ-1234')
    expect(extractUserCodeFromVerification({ user_code: 'WXYZ-1234' })).toBe('WXYZ-1234')
    expect(extractUserCodeFromVerification({ verificationUriComplete: 'https://cloud.example/device' })).toBeNull()
    expect(extractUserCodeFromVerification({ verificationUriComplete: 'not a url' })).toBeNull()
    expect(extractUserCodeFromVerification({ msg: '等待设备授权' })).toBeNull()
    expect(extractUserCodeFromVerification(null)).toBeNull()
    expect(extractUserCodeFromVerification('text')).toBeNull()
    // 超长值截断，避免日志注入放大内存
    expect(extractUserCodeFromVerification({ userCode: 'A'.repeat(200) })).toBe('A'.repeat(64))
  })

  it('keeps the parsed user code out of the public remote status', async () => {
    const { runtimeChildren } = useSuccessfulAgentSpawn()
    await startQfAgent(startOptions())
    runtimeChildren[0].stderr.write(`${JSON.stringify({ msg: '等待设备授权', verificationUriComplete: 'https://cloud.example/device?user_code=SECRET-CODE', token: 'leaked-token' })}\n`)
    await vi.waitFor(() => expect(getQfAgentStatus().status).toBe('authorizing'))
    const serialized = JSON.stringify(getQfAgentStatus())
    // userCode 不作为独立字段暴露；token 永不出现在公开状态
    expect(serialized).not.toContain('"userCode"')
    expect(serialized).not.toContain('leaked-token')
    // verificationUriComplete 是既有的人工授权链接（含自动填充码），仍保留
    expect(serialized).toContain('autoApproval')
    expect(JSON.parse(serialized).autoApproval).toEqual({ status: 'none' })
  })

  it('resolves candidates in priority order and validates Go targets', () => {
    const seen = []
    const customPath = path.resolve('C:\\custom\\agent.exe')
    const resolved = resolveQfAgentExecutable({
      env: { QUICKFORGE_QF_AGENT_PATH: customPath },
      platform: 'win32',
      arch: 'x64',
      root: 'C:\\quickforge',
      development: true,
      pathExists(candidate) {
        seen.push(candidate)
        return candidate === customPath
      },
    })
    expect(resolved).toBe(customPath)
    expect(seen).toEqual([customPath])
    expect(validateQfAgentVersion({ protocolVersion: 1, target: 'windows-amd64' }, { platform: 'win32', arch: 'x64' })).toBe(true)
    expect(() => validateQfAgentVersion({ protocolVersion: 2, target: 'windows-amd64' }, { platform: 'win32', arch: 'x64' })).toThrow(/protocol/i)
  })

  it('resolves darwin/linux agent assets and validates their Go targets', () => {
    const cases = [
      { platform: 'darwin', arch: 'x64', dir: 'darwin-x64', target: 'darwin-amd64' },
      { platform: 'darwin', arch: 'arm64', dir: 'darwin-arm64', target: 'darwin-arm64' },
      { platform: 'linux', arch: 'x64', dir: 'linux-x64', target: 'linux-amd64' },
      { platform: 'linux', arch: 'arm64', dir: 'linux-arm64', target: 'linux-arm64' },
    ]
    for (const { platform, arch, dir, target } of cases) {
      const expected = path.join('runtime-assets', 'agent', dir, 'qf-agent')
      const seen = []
      const resolved = resolveQfAgentExecutable({
        env: {},
        platform,
        arch,
        root: '/opt/quickforge',
        development: false,
        pathExists(candidate) {
          seen.push(candidate)
          return candidate.endsWith(expected)
        },
      })
      expect(resolved).toBe(path.join('/opt/quickforge', expected))
      expect(seen).toHaveLength(1)
      expect(seen[0].endsWith(expected)).toBe(true)
      expect(validateQfAgentVersion({ protocolVersion: 1, target }, { platform, arch })).toBe(true)
    }
    expect(() => validateQfAgentVersion({ protocolVersion: 1, target: 'windows-amd64' }, { platform: 'linux', arch: 'arm64' })).toThrow(/incompatible/i)
  })
})

describe('qf-agent proxy environment', () => {
  it('builds manual proxy env with merged NO_PROXY entries', () => {
    const env = { NO_PROXY: 'example.com, localhost', no_proxy: 'internal.corp' }
    const result = buildQfAgentProxyEnv('https://cloud.example.com:8443/', { mode: 'manual', proxyUrl: 'http://127.0.0.1:7890' }, env)
    expect(result.HTTP_PROXY).toBe('http://127.0.0.1:7890')
    expect(result.HTTPS_PROXY).toBe('http://127.0.0.1:7890')
    expect(result.ALL_PROXY).toBe('http://127.0.0.1:7890')
    const noProxy = result.NO_PROXY.split(',')
    expect(noProxy).toEqual(expect.arrayContaining(['localhost', '127.0.0.1', '::1', 'cloud.example.com', 'example.com', 'internal.corp']))
    expect(new Set(noProxy).size).toBe(noProxy.length)
  })

  it('returns null unless a manual proxy URL is configured', () => {
    const env = {}
    expect(buildQfAgentProxyEnv('http://127.0.0.1:5176/', { mode: 'direct', proxyUrl: '' }, env)).toBeNull()
    expect(buildQfAgentProxyEnv('http://127.0.0.1:5176/', { mode: 'system', proxyUrl: '' }, env)).toBeNull()
    expect(buildQfAgentProxyEnv('http://127.0.0.1:5176/', { mode: 'pac', proxyUrl: 'https://example.com/proxy.pac' }, env)).toBeNull()
    expect(buildQfAgentProxyEnv('http://127.0.0.1:5176/', { mode: 'manual', proxyUrl: '' }, env)).toBeNull()
    expect(buildQfAgentProxyEnv(undefined, { mode: 'manual', proxyUrl: 'http://127.0.0.1:7890' }, env)).not.toBeNull()
  })

  it('injects the manual proxy into the spawned agent env without exposing it in status', async () => {
    mocks.getNetworkProxyConfig.mockResolvedValue({ config: { mode: 'manual', proxyUrl: 'http://127.0.0.1:7890' } })
    const { runtimeChildren } = useSuccessfulAgentSpawn()
    await startQfAgent(startOptions())
    expect(runtimeChildren).toHaveLength(1)
    const env = mocks.spawn.mock.calls.find(([, args]) => Array.isArray(args) && !args.includes('--version'))[2].env
    expect(env.HTTP_PROXY).toBe('http://127.0.0.1:7890')
    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:7890')
    expect(env.ALL_PROXY).toBe('http://127.0.0.1:7890')
    expect(env.NO_PROXY).toContain('127.0.0.1')
    expect(JSON.stringify(getQfAgentStatus())).not.toContain('7890')
  })

  it('preserves parent proxy env for direct/system/pac modes', async () => {
    process.env.HTTP_PROXY = 'http://parent-proxy:8888'
    process.env.NO_PROXY = 'parent.internal'
    mocks.getNetworkProxyConfig.mockResolvedValue({ config: { mode: 'system', proxyUrl: '' } })
    const { runtimeChildren } = useSuccessfulAgentSpawn()
    await startQfAgent(startOptions())
    expect(runtimeChildren).toHaveLength(1)
    const env = mocks.spawn.mock.calls.find(([, args]) => Array.isArray(args) && !args.includes('--version'))[2].env
    expect(env.HTTP_PROXY).toBe('http://parent-proxy:8888')
    expect(env.NO_PROXY).toBe('parent.internal')
  })
})

describe('qf-agent identity invalidation detection', () => {
  it('recognizes invalid refresh token markers only in structured warn/error/fatal/panic logs', () => {
    expect(isIdentityInvalidationRecord({ level: 'WARN', msg: '重连失败', error: '云 API 401: invalid_refresh_token (Invalid refresh token.)' })).toBe(true)
    expect(isIdentityInvalidationRecord({ level: 'error', msg: '刷新失败', error: 'refresh_token_reused' })).toBe(true)
    expect(isIdentityInvalidationRecord({ level: 'fatal', msg: 'installation_revoked' })).toBe(true)
    expect(isIdentityInvalidationRecord({ level: 'panic', msg: '身份异常', err: 'refresh token 已失效，请删除 identity.json 后重新运行完成设备授权' })).toBe(true)
    expect(isIdentityInvalidationRecord({ severity: 'warn', msg: '信令连接中断', error: '刷新 token: refresh token 已失效' })).toBe(true)
  })

  it('ignores info logs, plain text, and unrelated warnings/errors', () => {
    expect(isIdentityInvalidationRecord({ level: 'INFO', msg: '刷新 token 已失效' })).toBe(false)
    expect(isIdentityInvalidationRecord({ level: 'warn', msg: '连接不稳定' })).toBe(false)
    expect(isIdentityInvalidationRecord({ level: 'error', msg: '普通错误', error: 'socket closed' })).toBe(false)
    expect(isIdentityInvalidationRecord({ msg: 'invalid_refresh_token' })).toBe(false)
    expect(isIdentityInvalidationRecord(null)).toBe(false)
    expect(isIdentityInvalidationRecord('invalid_refresh_token')).toBe(false)
  })

  it('marks identityInvalidated on parsed structured log lines without leaking the flag into status', () => {
    expect(parseQfAgentLogLine(JSON.stringify({ level: 'WARN', msg: '云 API 调用失败', error: '云 API 401: invalid_refresh_token (Invalid refresh token.)' })))
      .toEqual({ identityInvalidated: true })
    expect(parseQfAgentLogLine(JSON.stringify({ level: 'INFO', msg: '刷新 token 已失效' }))).toBeNull()
    expect(parseQfAgentLogLine('invalid_refresh_token')).toBeNull()
  })
})

describe('qf-agent identity invalidation recovery', () => {
  async function writeIdentityFile(identityDir) {
    const identityFile = path.join(identityDir, 'identity.json')
    await fs.mkdir(identityDir, { recursive: true })
    await fs.writeFile(identityFile, JSON.stringify({ installationId: 'install-1', privateKey: 'key', refreshToken: 'refresh-1', cloudURL: 'https://cloud.example/' }))
    return identityFile
  }

  it('terminates the agent, isolates the runtime identity, and restarts into authorization', async () => {
    const { runtimeChildren } = useSuccessfulAgentSpawn()
    await startQfAgent(startOptions())
    expect(runtimeChildren).toHaveLength(1)

    const identityDir = process.env.QUICKFORGE_QF_AGENT_IDENTITY_DIR
    const identityFile = await writeIdentityFile(identityDir)

    const cleanupStarted = deferred()
    const releaseCleanup = deferred()
    const realUnlink = fs.unlink.bind(fs)
    vi.spyOn(fs, 'unlink').mockImplementationOnce(async (file) => {
      cleanupStarted.resolve()
      await releaseCleanup.promise
      return realUnlink(file)
    })

    const line = `${JSON.stringify({ level: 'WARN', msg: '云请求失败', error: '云 API 401: invalid_refresh_token (Invalid refresh token.)' })}\n`
    runtimeChildren[0].stderr.write(line)
    runtimeChildren[0].stderr.write(line)

    try {
      await vi.waitFor(() => expect(runtimeChildren[0].kill).toHaveBeenCalledWith('SIGTERM'))
      await cleanupStarted.promise
      expect(runtimeChildren[0].kill).toHaveBeenCalledTimes(1)
      expect(getQfAgentStatus()).toEqual(expect.objectContaining({ status: 'authorizing', pid: runtimeChildren[0].pid }))
    } finally {
      releaseCleanup.resolve()
    }
    await vi.waitFor(async () => {
      await expect(fs.access(identityFile)).rejects.toMatchObject({ code: 'ENOENT' })
    }, { timeout: 5000 })
    await vi.waitFor(() => {
      expect(getQfAgentStatus().pid).toBe(runtimeChildren[1].pid)
    }, { timeout: 5000 })
    expect(runtimeChildren[0].kill).toHaveBeenCalledTimes(1)
  })

  it('does not touch the runtime identity on ordinary error logs', async () => {
    const { runtimeChildren } = useSuccessfulAgentSpawn()
    await startQfAgent(startOptions())
    const identityDir = process.env.QUICKFORGE_QF_AGENT_IDENTITY_DIR
    const identityFile = await writeIdentityFile(identityDir)

    runtimeChildren[0].stderr.write(`${JSON.stringify({ level: 'ERROR', msg: '转发失败', error: '连接已断开' })}\n`)
    await vi.waitFor(() => expect(getQfAgentStatus().error).toContain('转发失败'))

    expect(runtimeChildren[0].kill).not.toHaveBeenCalled()
    await fs.access(identityFile)
    await fs.access(`${identityDir}.lock.json`)
  })

  it('does not clean the runtime identity when stop is requested before the warning is processed', async () => {
    const { runtimeChildren } = useSuccessfulAgentSpawn()
    await startQfAgent(startOptions())
    const identityDir = process.env.QUICKFORGE_QF_AGENT_IDENTITY_DIR
    const identityFile = await writeIdentityFile(identityDir)

    runtimeChildren[0].stderr.write(`${JSON.stringify({ level: 'WARN', msg: '重连失败', error: '云 API 401: invalid_refresh_token (Invalid refresh token.)' })}\n`)
    await stopQfAgent()

    expect(getQfAgentStatus().status).toBe('stopped')
    await fs.access(identityFile)
    await expect(fs.access(`${identityDir}.lock.json`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps the restart budget bounded when newly isolated identities keep getting rejected', async () => {
    vi.useFakeTimers()
    // 将进程管理链路的 fs 步骤全部变为立即完成，使 fake timer 推进不依赖真实 IO 事件循环；
    // 本测试只验证重启预算有界性，真实隔离行为由上方集成测试覆盖。
    vi.spyOn(fs, 'readFile').mockResolvedValue('{}')
    vi.spyOn(fs, 'open').mockResolvedValue({
      writeFile: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    })
    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined)
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined)
    vi.spyOn(fs, 'lstat').mockResolvedValue({ isFile: () => true })
    vi.spyOn(fs, 'rename').mockResolvedValue(undefined)
    vi.spyOn(fs, 'unlink').mockResolvedValue(undefined)
    const { runtimeChildren } = useSuccessfulAgentSpawn()
    await startQfAgent(startOptions())
    const identityDir = process.env.QUICKFORGE_QF_AGENT_IDENTITY_DIR
    await writeIdentityFile(identityDir)
    const line = `${JSON.stringify({ level: 'WARN', msg: '云请求失败', error: '云 API 401: invalid_refresh_token (Invalid refresh token.)' })}\n`

    // 初始进程 + MAX_CONSECUTIVE_RESTARTS(5) 次重启：每轮身份失效 → 隔离 → 重启，
    // 新身份仍被云端拒绝时 restartCount 逐次累积，隔离成功也不清零。
    // 重启延迟随 restartCount 递增（1s/5s/30s），统一推进 31s 覆盖最大延迟。
    for (let cycle = 0; cycle < 6; cycle += 1) {
      const child = runtimeChildren[cycle]
      child.stderr.write(line)
      expect(child.kill).toHaveBeenCalledWith('SIGTERM')
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(31_000)
    }

    // 第 6 次失效后重启预算耗尽：不再 spawn 新进程，状态转为 error。
    expect(runtimeChildren).toHaveLength(6)
    expect(getQfAgentStatus().status).toBe('error')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(runtimeChildren).toHaveLength(6)
  })
})

describe('qf-agent first-authorization auto approval', () => {
  function useDesktopCloudSession() {
    const authorizeRemoteAgent = vi.fn(async () => ({ ok: true }))
    const withAccessToken = vi.fn(async (operation) => operation('desktop-secret-token'))
    const identity = {
      status: vi.fn(async () => ({ mode: 'account', hasSession: true })),
      withAccessToken,
    }
    mocks.getCloudRuntime.mockResolvedValue({ identity, client: { authorizeRemoteAgent } })
    return { authorizeRemoteAgent }
  }

  function authorizingLine(code) {
    return `${JSON.stringify({ msg: '等待设备授权', verificationUriComplete: `https://cloud.example/device?user_code=${code}` })}\n`
  }

  it('auto-arms and approves the first device authorization when a desktop session exists', async () => {
    const { runtimeChildren } = useSuccessfulAgentSpawn()
    const { authorizeRemoteAgent } = useDesktopCloudSession()
    await startQfAgent(startOptions())

    runtimeChildren[0].stderr.write(authorizingLine('FIRST-CODE'))
    await vi.waitFor(() => expect(getQfAgentStatus().autoApproval).toEqual({ status: 'consumed' }))
    expect(authorizeRemoteAgent).toHaveBeenCalledWith('desktop-secret-token', 'FIRST-CODE', undefined)

    const serialized = JSON.stringify(getQfAgentStatus())
    // userCode 不作为独立字段暴露；desktop token 永不出现在公开状态
    // （verificationUriComplete 是既有的人工授权链接，含自动填充码，属预期保留）
    expect(serialized).not.toContain('"userCode"')
    expect(serialized).not.toContain('desktop-secret-token')
  })

  it('does not auto-arm a lifecycle started by an authenticated remote client', async () => {
    const { runtimeChildren } = useSuccessfulAgentSpawn()
    const { authorizeRemoteAgent } = useDesktopCloudSession()
    await startQfAgent({ ...startOptions(), autoApprovalPolicy: 'manual' })

    runtimeChildren[0].stderr.write(authorizingLine('REMOTE-CODE'))
    await vi.waitFor(() => expect(getQfAgentStatus().status).toBe('authorizing'))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(getQfAgentStatus().autoApproval).toEqual({ status: 'none' })
    expect(authorizeRemoteAgent).not.toHaveBeenCalled()
  })

  it('does not auto-arm without a valid desktop session on this computer', async () => {
    const { runtimeChildren } = useSuccessfulAgentSpawn()
    mocks.getCloudRuntime.mockResolvedValue({})
    await startQfAgent(startOptions())

    runtimeChildren[0].stderr.write(authorizingLine('NO-SESSION'))
    await vi.waitFor(() => expect(getQfAgentStatus().status).toBe('authorizing'))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(getQfAgentStatus().autoApproval).toEqual({ status: 'none' })
  })
})
