type LogLevel = 'error' | 'warn' | 'info' | 'debug'

const PREFIX = '[QuickForge]'

function isDebugEnabled(): boolean {
  try {
    return localStorage.getItem('quickforge_debug') === '1'
  } catch {
    return false
  }
}

function shouldLog(level: LogLevel): boolean {
  if (level === 'debug') return isDebugEnabled()
  return true
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return arg.stack || arg.message
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

function write(level: LogLevel, msg: string, ...extra: unknown[]) {
  if (!shouldLog(level)) return

  const ts = new Date().toISOString()
  const extraStr = extra.length > 0 ? ' ' + extra.map(formatArg).join(' ') : ''
  const line = `${ts} [${level.toUpperCase()}] ${PREFIX} ${msg}${extraStr}`

  switch (level) {
    case 'error':
      console.error(line)
      break
    case 'warn':
      console.warn(line)
      break
    case 'info':
      console.info(line)
      break
    case 'debug':
      console.debug(line)
      break
  }
}

export const logger = {
  error: (msg: string, ...extra: unknown[]) => write('error', msg, ...extra),
  warn: (msg: string, ...extra: unknown[]) => write('warn', msg, ...extra),
  info: (msg: string, ...extra: unknown[]) => write('info', msg, ...extra),
  debug: (msg: string, ...extra: unknown[]) => write('debug', msg, ...extra),
}
