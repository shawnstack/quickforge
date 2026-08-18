import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { signalProcessTree, terminateProcessTree } from '../../server/utils/process-tree.mjs'

function fakeChild(pid = 42) {
  const child = new EventEmitter()
  child.pid = pid
  child.exitCode = null
  child.signalCode = null
  child.kill = vi.fn(() => true)
  return child
}

describe('process tree termination', () => {
  it('uses a POSIX process group signal', async () => {
    const child = fakeChild()
    const killImpl = vi.fn()

    await signalProcessTree(child, 'SIGTERM', { platform: 'linux', killImpl })

    expect(killImpl).toHaveBeenCalledWith(-42, 'SIGTERM')
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('uses taskkill /T and /F only for force on Windows', async () => {
    const calls = []
    const spawnImpl = vi.fn((_command, args) => {
      calls.push(args)
      const taskkill = new EventEmitter()
      queueMicrotask(() => taskkill.emit('exit', 0))
      return taskkill
    })
    const child = fakeChild(77)

    await signalProcessTree(child, 'SIGTERM', { platform: 'win32', spawnImpl })
    await signalProcessTree(child, 'SIGKILL', { platform: 'win32', spawnImpl })

    expect(calls).toEqual([
      ['/PID', '77', '/T'],
      ['/PID', '77', '/T', '/F'],
    ])
  })

  it('times out a wedged taskkill.exe instead of hanging forever', async () => {
    vi.useFakeTimers()
    try {
      const spawnImpl = vi.fn(() => new EventEmitter())
      const child = fakeChild(99)

      const result = signalProcessTree(child, 'SIGKILL', { platform: 'win32', spawnImpl })
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(result).resolves.toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('escalates after the grace deadline without killing a real process', async () => {
    const child = fakeChild()
    const signals = []
    const setTimer = (callback) => {
      queueMicrotask(callback)
      return { unref() {} }
    }
    await terminateProcessTree(child, {
      graceMs: 1,
      forceWaitMs: 1,
      setTimer,
      clearTimer: () => {},
      platform: 'linux',
      killImpl: (_pid, signal) => signals.push(signal),
    })

    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
  })
})
