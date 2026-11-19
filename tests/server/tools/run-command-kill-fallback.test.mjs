import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toolRunCommand } from '../../../server/tools/run-command.mjs'

// run_command 超时 / abort 的终止必须是「两阶段」的：先宽限信号（POSIX SIGTERM /
// Windows taskkill /T），宽限期后升级为 SIGKILL（taskkill /T /F），而且这次升级
// 不能因为调用方立刻 finish()→cleanup() 就消失。
// 历史实现（2026-11-19 缺陷）把 SIGKILL 放在自己的 forceKillTimer 里：
//   stopChild() → killProcessTree(SIGTERM) + setTimeout(SIGKILL, 1500)
//   同一个 tick 里 timeout/abort 回调紧接着 finish() → cleanup() → clearTimeout
// 于是 POSIX 上 SIGKILL 兜底永不执行。
//
// 这里用一个「忠实但可观测」的替身顶替共享的 terminateProcessTree：两阶段照样真
// 发信号（测试不留下跑飞的进程），同时把两阶段记进 killPhases。关键在于升级动作
// 活在 run-command 之外 —— run-command 的 cleanup 够不着它，这正是修复后的契约。
// 判据可验：把 stopChild 换回「killProcessTree + 自维护 forceKillTimer +
// cleanup 里 clearTimeout」，本文件两条用例都会变红（killPhases 一条都收不到）。
const { killPhases } = vi.hoisted(() => ({ killPhases: [] }))

vi.mock('../../../server/utils/process-tree.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    terminateProcessTree: (child) => {
      const pid = child?.pid ?? null
      killPhases.push({ phase: 'grace', pid })
      sendSignal(pid, 'grace')
      // 模拟真实实现：宽限期一到就无条件升级，不看调用方是否已经收摊。
      const timer = setTimeout(() => {
        killPhases.push({ phase: 'force', pid })
        sendSignal(pid, 'force')
      }, 50)
      timer.unref?.()
      return Promise.resolve()
    },
  }
})

const tempDirs = []
const leftoverPids = []

function sendSignal(pid, phase) {
  if (!pid) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', ...(phase === 'force' ? ['/F'] : [])], {
        stdio: 'ignore',
        windowsHide: true,
      })
      return
    }
    process.kill(-pid, phase === 'force' ? 'SIGKILL' : 'SIGTERM')
  } catch {
    try { process.kill(pid, phase === 'force' ? 'SIGKILL' : 'SIGTERM') } catch { /* already gone */ }
  }
}

async function waitForPhase(phase, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (killPhases.some((entry) => entry.phase === phase)) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return false
}

// 比 timeoutMs 下限（1000ms）活得久、但到点自己退出：即使替身的两阶段信号没
// 生效（比如极端负载下 timeout 回调晚了），测试也不会把进程留在机器上。
const SLOW_COMMAND = 'node -e "setTimeout(() => process.exit(0), 5000)"'

beforeEach(() => {
  killPhases.length = 0
})

afterEach(async () => {
  for (const pid of leftoverPids.splice(0)) sendSignal(pid, 'force')
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})))
})

describe('run_command process-tree kill fallback', () => {
  it('escalates to SIGKILL after a timeout even though cleanup ran in the same tick', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'qf-kill-timeout-'))
    tempDirs.push(cwd)

    // timeoutMs 下限是 1000ms；到点后 stopChild() 与 finish() 在同一个 tick，
    // 修复前 SIGKILL 定时器就死在这里被调用的 cleanup() 里。
    const result = await toolRunCommand(
      { command: SLOW_COMMAND, description: 'kill fallback timeout probe', timeoutMs: 1000 },
      { workspaceRoot: cwd },
      { toolCallId: 'tool-kill-timeout' },
    )
    const pid = result.details.pid
    leftoverPids.push(pid)

    expect(result.details.timedOut).toBe(true)
    expect(result.details.signal).toBe('SIGTERM')
    expect(typeof pid).toBe('number')
    // 第一阶段：宽限信号必须指到同一个子进程。
    expect(killPhases[0]).toEqual({ phase: 'grace', pid })

    // 第二阶段：调用方早已 finish()/cleanup()，升级仍必须到达。
    expect(await waitForPhase('force')).toBe(true)
    expect(killPhases).toEqual([
      { phase: 'grace', pid },
      { phase: 'force', pid },
    ])
  }, 30_000)

  it('escalates to SIGKILL after an abort, not just the grace signal', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'qf-kill-abort-'))
    tempDirs.push(cwd)
    const controller = new AbortController()

    const pending = toolRunCommand(
      { command: SLOW_COMMAND, description: 'kill fallback abort probe', timeoutMs: 60_000 },
      { workspaceRoot: cwd },
      { toolCallId: 'tool-kill-abort', signal: controller.signal },
    )
    // 等命令真正跑起来（子进程已存在、注册表已登记）再中断：这条用例盯的是
    // 「中断之后仍要升级到 SIGKILL」，进程不在场就测不出两阶段；同 tick 中断
    // 由下一条用例直接覆盖。
    await new Promise((resolve) => setTimeout(resolve, 100))
    controller.abort()
    const result = await pending
    const pid = result.details.pid
    leftoverPids.push(pid)

    expect(result.details.aborted).toBe(true)
    expect(result.details.signal).toBe('SIGTERM')
    expect(killPhases[0]).toEqual({ phase: 'grace', pid })
    expect(await waitForPhase('force')).toBe(true)
    expect(killPhases).toEqual([
      { phase: 'grace', pid },
      { phase: 'force', pid },
    ])
  }, 30_000)

  it('resolves an abort fired in the same tick as the call', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'qf-kill-sametick-'))
    tempDirs.push(cwd)
    const controller = new AbortController()

    const pending = toolRunCommand(
      { command: SLOW_COMMAND, description: 'same-tick abort probe', timeoutMs: 60_000 },
      { workspaceRoot: cwd },
      { toolCallId: 'tool-kill-sametick', signal: controller.signal },
    )
    // 不等命令跑起来：调用返回的同一个 tick 里立刻 abort。toolRunCommand 在
    // 创建日志流的 await 期间挂起，这个窗口里的 abort 在原实现里会整个丢失
    // （Node 不给「已 abort 之后才 add 的监听器」补发事件），promise 只能等
    // SLOW_COMMAND 五秒自退——watchdog 定在 4s，就是为了掐着「未按时 resolve」
    // 这一点变红，而不是靠命令自然结束混过去。
    controller.abort()

    let watchdog
    const result = await Promise.race([
      pending,
      new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error('same-tick abort: promise did not resolve in 4s')), 4_000)
      }),
    ])
    clearTimeout(watchdog)
    const pid = result.details.pid
    leftoverPids.push(pid)

    expect(result.details.aborted).toBe(true)
    expect(result.details.signal).toBe('SIGTERM')
  }, 30_000)

  it('terminates with real timers even when the caller faked global timers', async () => {
    // 回归（fake-timers 冻结）：terminateProcessTree 的宽限/升级默认定时器曾
    // 解析到 globalThis.setTimeout，被调用方测试的 vi.useFakeTimers 冻结后，
    // 温和 taskkill 杀不掉的后台进程永远等不到 SIGKILL 升级（表现为
    // agent-manager.background-idle 的注册表清不掉、afterEach 挂死）。
    // 这里绕过本文件顶部的替身直接调真实实现，在 fake timers 下不推进假
    // 时钟，断言升级仍按真实时间完成。
    // 判据可验：把 waitForExit 默认 setTimer 改回裸 setTimeout（全局），
    // 本用例必须变红（2.5s 真实时间内收不到 SIGKILL、promise 不 settle）。
    const actual = await vi.importActual('../../../server/utils/process-tree.mjs')
    const child = new EventEmitter()
    child.pid = 4242
    child.exitCode = null
    child.signalCode = null
    const signals = []

    // 与 agent-manager.background-idle 相同的 toFake 子集：Date/setImmediate
    // 保持真实，只有 setTimeout/clearTimeout(+Interval) 被替换。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    try {
      let done = false
      actual.terminateProcessTree(child, {
        graceMs: 150,
        forceWaitMs: 150,
        platform: 'linux',
        killImpl: (_pid, signal) => signals.push(signal),
      }).then(() => { done = true })

      const deadline = Date.now() + 2500
      while (!done && Date.now() < deadline) {
        await new Promise((resolve) => setImmediate(resolve))
      }

      expect(done).toBe(true)
      expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
    } finally {
      vi.useRealTimers()
    }
  }, 10_000)
})
