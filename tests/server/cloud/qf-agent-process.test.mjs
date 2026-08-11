import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process')
  return { ...actual, spawn: mocks.spawn }
})

vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs')
  return { ...actual, existsSync: mocks.existsSync }
})

import {
  getQfAgentStatus,
  parseQfAgentLogLine,
  resolveQfAgentExecutable,
  startQfAgent,
  stopQfAgent,
  validateQfAgentVersion,
} from '../../../server/cloud/qf-agent-process.mjs'

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
  mocks.spawn.mockImplementation((_executable, args) => {
    const child = createChild()
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
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quickforge-qf-agent-'))
  process.env.QUICKFORGE_QF_AGENT_PATH = process.execPath
  process.env.QUICKFORGE_QF_AGENT_IDENTITY_DIR = path.join(tempDir, 'identity')
  delete process.env.QUICKFORGE_QF_AGENT_ENABLED
  mocks.existsSync.mockReset()
  mocks.existsSync.mockImplementation((candidate) => candidate === process.execPath)
  mocks.spawn.mockReset()
})

afterEach(async () => {
  vi.useRealTimers()
  delete process.env.QUICKFORGE_QF_AGENT_ENABLED
  delete process.env.QUICKFORGE_QF_AGENT_PATH
  delete process.env.QUICKFORGE_QF_AGENT_IDENTITY_DIR
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
      .toEqual({ status: 'authorizing', verificationUriComplete: 'https://cloud.example/device?code=ABCD' })
    expect(parseQfAgentLogLine(JSON.stringify({ msg: '信令已连接' })))
      .toEqual({ status: 'running', verificationUriComplete: null })
    expect(parseQfAgentLogLine(JSON.stringify({ msg: '信令连接中断，准备重连' })))
      .toEqual({ status: 'starting' })
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
