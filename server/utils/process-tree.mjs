import { spawn } from 'node:child_process'
import { once } from 'node:events'

const DEFAULT_GRACE_MS = 1000
const DEFAULT_FORCE_WAIT_MS = 1000
const TASKKILL_TIMEOUT_MS = 10_000

function isRunning(child) {
  return Boolean(child?.pid) && child.exitCode == null && child.signalCode == null
}

function waitForExit(child, timeoutMs, setTimer = setTimeout, clearTimer = clearTimeout) {
  if (!isRunning(child)) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const finish = (exited) => {
      if (settled) return
      settled = true
      clearTimer(timer)
      child.removeListener?.('exit', onExit)
      resolve(exited)
    }
    const onExit = () => finish(true)
    const timer = setTimer(() => finish(!isRunning(child)), Math.max(0, timeoutMs))
    timer?.unref?.()
    child.once?.('exit', onExit)
  })
}

function runTaskkill(pid, force, spawnImpl = spawn) {
  return new Promise((resolve) => {
    const args = ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])]
    let command
    try {
      command = spawnImpl('taskkill.exe', args, { windowsHide: true, stdio: 'ignore' })
    } catch {
      resolve(false)
      return
    }
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }
    // taskkill normally exits immediately, but a wedged taskkill.exe must not
    // hang dispose()/destroyAgent forever on a dangling child process.
    const timer = setTimeout(() => finish(false), TASKKILL_TIMEOUT_MS)
    timer.unref?.()
    command.once?.('error', () => finish(false))
    command.once?.('exit', (code) => finish(code === 0))
  })
}

export async function signalProcessTree(child, signal, options = {}) {
  if (!child?.pid) return false
  const platform = options.platform ?? process.platform
  if (platform === 'win32') {
    return runTaskkill(child.pid, signal === 'SIGKILL', options.spawnImpl)
  }

  const killImpl = options.killImpl ?? process.kill
  try {
    killImpl(-child.pid, signal)
    return true
  } catch {
    try {
      return child.kill?.(signal) !== false
    } catch {
      return false
    }
  }
}

export async function terminateProcessTree(child, options = {}) {
  if (!isRunning(child)) return
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS
  const forceWaitMs = options.forceWaitMs ?? DEFAULT_FORCE_WAIT_MS
  const timerOptions = { setTimer: options.setTimer, clearTimer: options.clearTimer }

  await signalProcessTree(child, 'SIGTERM', options)
  if (await waitForExit(child, graceMs, timerOptions.setTimer, timerOptions.clearTimer)) return

  await signalProcessTree(child, 'SIGKILL', options)
  await Promise.race([
    once(child, 'exit').catch(() => {}),
    waitForExit(child, forceWaitMs, timerOptions.setTimer, timerOptions.clearTimer),
  ])
}
