import { EventEmitter } from 'node:events'
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
