import { inspect } from 'node:util'
import { logger, flushLogger } from './logger.mjs'

// Process-level error guards for the detached background server (stdio is
// ignored, so an unlogged crash looks like the process silently dying):
// - uncaughtException (fatal): log the error with its stack, run best-effort
//   graceful shutdown capped at shutdownTimeoutMs, then flushLogger() and
//   exit(1).
// - unhandledRejection (non-fatal): log the reason and keep running (no
//   flushLogger, no exit) because the logger stream must stay open.
export function createProcessErrorHandlers({
  onFatalError,
  exitProcess = process.exit.bind(process),
  shutdownTimeoutMs = 5000,
} = {}) {
  let fatalShutdownInProgress = false

  async function handleUncaughtException(error) {
    if (fatalShutdownInProgress) {
      logger.error('Uncaught exception during fatal shutdown:', error)
      flushLogger()
      exitProcess(1)
      return
    }
    fatalShutdownInProgress = true

    logger.error('Uncaught exception:', error, { fatal: 'uncaughtException' })

    if (onFatalError) {
      try {
        await Promise.race([
          Promise.resolve().then(onFatalError),
          new Promise((resolve) => setTimeout(resolve, shutdownTimeoutMs).unref()),
        ])
      } catch (shutdownError) {
        logger.error('Fatal shutdown failed:', shutdownError)
      }
    }

    flushLogger()
    exitProcess(1)
  }

  function handleUnhandledRejection(reason) {
    if (reason instanceof Error) {
      logger.error('Unhandled promise rejection:', reason, { fatal: 'unhandledRejection' })
    } else {
      logger.error('Unhandled promise rejection:', inspect(reason), { fatal: 'unhandledRejection' })
    }
  }

  return { handleUncaughtException, handleUnhandledRejection }
}

export function installProcessErrorHandlers(options) {
  const { handleUncaughtException, handleUnhandledRejection } = createProcessErrorHandlers(options)
  process.on('uncaughtException', (error) => {
    void handleUncaughtException(error)
  })
  process.on('unhandledRejection', (reason) => {
    handleUnhandledRejection(reason)
  })
}
