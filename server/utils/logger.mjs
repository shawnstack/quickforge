import fs from 'node:fs'
import path from 'node:path'
import { logsDir } from '../storage.mjs'

function timestamp() {
  return new Date().toISOString()
}

function logFile() {
  const date = new Date().toISOString().slice(0, 10)
  return path.join(logsDir, `server-${date}.log`)
}

function formatArgs(args) {
  return args.map((a) =>
    typeof a === 'string' ? a : a instanceof Error ? a.stack : JSON.stringify(a),
  ).join(' ')
}

function writeLog(level, ...args) {
  const line = `${timestamp()} [${level}] ${formatArgs(args)}\n`
  process.stderr.write(line)
  try {
    fs.appendFileSync(logFile(), line)
  } catch {
    // ignore write errors
  }
}

export const logger = {
  info: (...args) => writeLog('INFO', ...args),
  warn: (...args) => writeLog('WARN', ...args),
  error: (...args) => writeLog('ERROR', ...args),
}
