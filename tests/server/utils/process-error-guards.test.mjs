import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../server/utils/logger.mjs', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  flushLogger: vi.fn(),
}))

import { logger, flushLogger } from '../../../server/utils/logger.mjs'
import { createProcessErrorHandlers } from '../../../server/utils/process-error-guards.mjs'

function createHandlers({ onFatalError = vi.fn(async () => {}), shutdownTimeoutMs } = {}) {
  const exitProcess = vi.fn()
  const handlers = createProcessErrorHandlers({ onFatalError, exitProcess, ...(shutdownTimeoutMs !== undefined ? { shutdownTimeoutMs } : {}) })
  return { handlers, onFatalError, exitProcess }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createProcessErrorHandlers', () => {
  it('logs the uncaught exception, runs graceful shutdown, flushes and exits with code 1', async () => {
    const { handlers, onFatalError, exitProcess } = createHandlers()
    const error = new Error('boom')

    await handlers.handleUncaughtException(error)

    expect(logger.error).toHaveBeenCalledWith('Uncaught exception:', error, { fatal: 'uncaughtException' })
    expect(onFatalError).toHaveBeenCalledTimes(1)
    expect(flushLogger).toHaveBeenCalledTimes(1)
    expect(exitProcess).toHaveBeenCalledTimes(1)
    expect(exitProcess).toHaveBeenCalledWith(1)
    expect(flushLogger.mock.invocationCallOrder[0]).toBeLessThan(exitProcess.mock.invocationCallOrder[0])
  })

  it('still flushes and exits when onFatalError throws', async () => {
    const onFatalError = vi.fn(async () => {
      throw new Error('shutdown boom')
    })
    const { handlers, exitProcess } = createHandlers({ onFatalError })

    await handlers.handleUncaughtException(new Error('boom'))

    expect(onFatalError).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith('Fatal shutdown failed:', expect.any(Error))
    expect(flushLogger).toHaveBeenCalledTimes(1)
    expect(exitProcess).toHaveBeenCalledTimes(1)
    expect(exitProcess).toHaveBeenCalledWith(1)
  })

  it('still flushes and exits when onFatalError hangs beyond shutdownTimeoutMs', async () => {
    const onFatalError = vi.fn(() => new Promise(() => {}))
    const { handlers, exitProcess } = createHandlers({ onFatalError, shutdownTimeoutMs: 20 })

    const startedAt = Date.now()
    await handlers.handleUncaughtException(new Error('boom'))
    const elapsed = Date.now() - startedAt

    expect(onFatalError).toHaveBeenCalledTimes(1)
    expect(elapsed).toBeGreaterThanOrEqual(15)
    expect(flushLogger).toHaveBeenCalledTimes(1)
    expect(exitProcess).toHaveBeenCalledTimes(1)
    expect(exitProcess).toHaveBeenCalledWith(1)
  })

  it('does not repeat graceful shutdown for a re-entrant uncaught exception and exits immediately', async () => {
    const { handlers, onFatalError, exitProcess } = createHandlers()
    const firstError = new Error('first')
    const secondError = new Error('second')

    const first = handlers.handleUncaughtException(firstError)
    const second = handlers.handleUncaughtException(secondError)
    await Promise.all([first, second])

    expect(onFatalError).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith('Uncaught exception during fatal shutdown:', secondError)
    // The re-entrant call exits before the first (still running) graceful
    // shutdown finishes flushing.
    expect(exitProcess.mock.invocationCallOrder[0]).toBeLessThan(flushLogger.mock.invocationCallOrder[1])
    expect(exitProcess).toHaveBeenCalledWith(1)
  })

  it('logs Error unhandled rejections without flushing or exiting', () => {
    const { handlers, onFatalError, exitProcess } = createHandlers()
    const reason = new Error('rejected')

    handlers.handleUnhandledRejection(reason)

    expect(logger.error).toHaveBeenCalledWith('Unhandled promise rejection:', reason, { fatal: 'unhandledRejection' })
    expect(onFatalError).not.toHaveBeenCalled()
    expect(flushLogger).not.toHaveBeenCalled()
    expect(exitProcess).not.toHaveBeenCalled()
  })

  it('logs non-Error unhandled rejections via inspect and keeps the process alive', () => {
    const { handlers, onFatalError, exitProcess } = createHandlers()

    handlers.handleUnhandledRejection('plain rejection')
    handlers.handleUnhandledRejection({ code: 42 })

    expect(logger.error).toHaveBeenCalledWith('Unhandled promise rejection:', "'plain rejection'", { fatal: 'unhandledRejection' })
    expect(logger.error).toHaveBeenCalledWith('Unhandled promise rejection:', '{ code: 42 }', { fatal: 'unhandledRejection' })
    expect(onFatalError).not.toHaveBeenCalled()
    expect(flushLogger).not.toHaveBeenCalled()
    expect(exitProcess).not.toHaveBeenCalled()
  })
})
