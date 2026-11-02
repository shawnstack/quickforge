// The forked server must never start inside the package root: packaged desktop
// builds keep server/ inside app.asar, which is a file rather than a directory,
// and spawning with it fails with ENOENT. spawn and the health probe are mocked
// here so no real child process or port is involved.
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

const { startQuickForge } = await import('../../server/public-api.mjs')

const callerCwd = path.join(os.tmpdir(), 'qf-caller-cwd')

function createFakeChild() {
  const child = new EventEmitter()
  child.pid = 4242
  child.killed = false
  child.kill = vi.fn(() => true)
  child.unref = vi.fn()
  queueMicrotask(() => child.emit('spawn'))
  return child
}

describe('startQuickForge child working directory', () => {
  let cwdSpy

  beforeEach(() => {
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(callerCwd)
    spawnMock.mockReset()
    spawnMock.mockImplementation(() => createFakeChild())
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, pid: 4242, version: '1.0.0' }),
    })))
  })

  afterEach(() => {
    cwdSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('inherits the caller working directory instead of the package root', async () => {
    const instance = await startQuickForge({ host: '127.0.0.1', port: 5199, reuseExisting: false })

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock.mock.calls[0][2].cwd).toBe(callerCwd)
    expect(instance.pid).toBe(4242)
  })

  it('resolves an explicit cwd option', async () => {
    const target = path.join('relative', 'workspace')
    await startQuickForge({ host: '127.0.0.1', port: 5199, reuseExisting: false, cwd: target })

    expect(spawnMock.mock.calls[0][2].cwd).toBe(path.resolve(target))
  })
})
