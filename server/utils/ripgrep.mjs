import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let cachedRipgrepExecutable

export function ripgrepCandidatePath() {
  try {
    return require('@vscode/ripgrep').rgPath || null
  } catch {
    return null
  }
}

export async function verifyRipgrepExecutable(command) {
  return new Promise((resolve) => {
    const child = spawn(command, ['--version'], { shell: false, windowsHide: true })
    child.once('error', () => resolve(false))
    child.once('close', (code) => resolve(code === 0))
  })
}

export async function resolveRipgrepExecutable() {
  if (cachedRipgrepExecutable !== undefined) return cachedRipgrepExecutable

  const bundled = ripgrepCandidatePath()
  if (bundled && await verifyRipgrepExecutable(bundled)) {
    cachedRipgrepExecutable = { command: bundled, source: 'bundled' }
    return cachedRipgrepExecutable
  }

  if (await verifyRipgrepExecutable('rg')) {
    cachedRipgrepExecutable = { command: 'rg', source: 'system' }
    return cachedRipgrepExecutable
  }

  cachedRipgrepExecutable = null
  return cachedRipgrepExecutable
}
