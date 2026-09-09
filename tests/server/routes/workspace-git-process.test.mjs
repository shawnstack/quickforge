import { EventEmitter, getEventListeners } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}))

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process')
  return { ...actual, spawn: mocks.spawn }
})

function fakeChild(pid = 1234) {
  const child = new EventEmitter()
  child.pid = pid
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

describe('workspace git process timeout', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    mocks.spawn.mockReset()
  })

  it('uses non-interactive stdio and terminates a git command after timeout', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    const killer = fakeChild(5678)
    mocks.spawn.mockReturnValueOnce(child).mockReturnValueOnce(killer)
    const { git } = await import('../../../server/routes/workspace.mjs')

    const result = git(['status'], process.cwd(), { timeoutMs: 1000 })
    const rejection = expect(result).rejects.toMatchObject({ code: 'GIT_TIMEOUT', statusCode: 504 })
    await vi.advanceTimersByTimeAsync(1000)

    await rejection
    expect(mocks.spawn).toHaveBeenNthCalledWith(1, 'git', ['status'], expect.objectContaining({
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: expect.objectContaining({
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'Never',
      }),
    }))
    if (process.platform === 'win32') {
      expect(mocks.spawn).toHaveBeenNthCalledWith(2, 'taskkill', ['/pid', '1234', '/T', '/F'], expect.any(Object))
    } else {
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    }
  })
})

describe('workspace git process abort', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    mocks.spawn.mockReset()
  })

  it('rejects with an AbortError without spawning when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    mocks.spawn.mockReturnValueOnce(fakeChild())
    const { git } = await import('../../../server/routes/workspace.mjs')

    await expect(git(['status'], process.cwd(), { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ABORT_ERR',
    })
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('kills the process tree and rejects with an AbortError when the signal aborts mid-run', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    const killer = fakeChild(5678)
    mocks.spawn.mockReturnValueOnce(child).mockReturnValueOnce(killer)
    const { git } = await import('../../../server/routes/workspace.mjs')
    const controller = new AbortController()

    const rejection = expect(git(['status'], process.cwd(), { timeoutMs: 1000, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' })
    controller.abort()
    await rejection

    if (process.platform === 'win32') {
      expect(mocks.spawn).toHaveBeenNthCalledWith(2, 'taskkill', ['/pid', '1234', '/T', '/F'], expect.any(Object))
    } else {
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    }
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  })

  it('does not kill or reject when the signal aborts after the process settles', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    mocks.spawn.mockReturnValueOnce(child)
    const { git } = await import('../../../server/routes/workspace.mjs')
    const controller = new AbortController()

    const resolution = expect(git(['status'], process.cwd(), { timeoutMs: 1000, signal: controller.signal }))
      .resolves.toMatchObject({ code: 0 })
    child.stdout.emit('data', Buffer.from('ok'))
    child.emit('close', 0)
    await resolution
    controller.abort()

    expect(child.kill).not.toHaveBeenCalled()
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  })
})
