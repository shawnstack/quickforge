import { spawn } from 'node:child_process'
import { once } from 'node:events'
// 必须取 node:timers 的真实实现，不能依赖全局 setTimeout/clearTimeout：
// waitForExit 的宽限/升级定时器决定的是真实 OS 进程的生死，不应被调用方
// 测试里的 vi.useFakeTimers 冻结（fake timers 只替换 globalThis 上的绑定，
// 不动 node:timers 的导出）。需要确定性驱动升级的测试走 options.setTimer。
import { setTimeout as realSetTimeout, clearTimeout as realClearTimeout } from 'node:timers'

const DEFAULT_GRACE_MS = 1000
const DEFAULT_FORCE_WAIT_MS = 1000
const TASKKILL_TIMEOUT_MS = 10_000

function isRunning(child) {
  return Boolean(child?.pid) && child.exitCode == null && child.signalCode == null
}

function waitForExit(child, timeoutMs, setTimer = realSetTimeout, clearTimer = realClearTimeout) {
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
    // 有意保持全局 setTimeout：wedged-taskkill 看门狗的既有契约
    // (tests/server/process-tree.test.mjs) 靠 vi.advanceTimersByTimeAsync 驱动
    // 它；且 taskkill.exe 的真实 exit 事件不经过定时器，fake timers 下不挂。
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
