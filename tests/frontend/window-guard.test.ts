import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WINDOW_GUARD_LOCK_NAME, acquireAppWindowGuard } from '../../src/lib/window-guard'

// --- Fakes -------------------------------------------------------------------

type FakeLockRequest = {
  name: string
  options: { ifAvailable: boolean }
  callback: (lock: object | null) => Promise<void>
  settled: boolean
  resolve: () => void
  reject: (reason?: unknown) => void
}

type LockPlan = (request: FakeLockRequest, index: number) => void

function createFakeLocks(plan: LockPlan) {
  const requests: FakeLockRequest[] = []
  const locks = {
    request(name: string, options: { ifAvailable: boolean }, callback: (lock: object | null) => Promise<void>) {
      return new Promise<void>((resolve, reject) => {
        const request: FakeLockRequest = {
          name,
          options,
          callback,
          settled: false,
          resolve: () => {
            request.settled = true
            resolve()
          },
          reject: (reason?: unknown) => {
            request.settled = true
            reject(reason)
          },
        }
        requests.push(request)
        plan(request, requests.length - 1)
      })
    },
  }
  return { locks, requests }
}

/** 立即持锁：进入回调但永不结束（request promise 不会结算） */
const grantLock: LockPlan = (request) => {
  void request.callback({ name: request.name })
}

/** ifAvailable 抢锁失败：回调收到 null，request promise 随即结算 */
const denyLock: LockPlan = (request) => {
  void request.callback(null).then(
    () => request.resolve(),
    (error) => request.reject(error),
  )
}

function createManualTimers() {
  type Timer = { id: number; fn: () => void; ms: number }
  let nextId = 1
  const timers = new Map<number, Timer>()
  const queue: number[] = []
  return {
    setTimeout(fn: () => void, ms: number) {
      const id = nextId
      nextId += 1
      timers.set(id, { id, fn, ms })
      queue.push(id)
      return id
    },
    pending: () => [...timers.values()],
    fire(id: number) {
      const timer = timers.get(id)
      if (!timer) return
      timers.delete(id)
      timer.fn()
    },
    /** 按注册顺序触发下一个计时器（跳过已被清除的），返回是否触发了计时器 */
    fireNext(): boolean {
      while (queue.length > 0) {
        const id = queue.shift()!
        if (timers.has(id)) {
          this.fire(id)
          return true
        }
      }
      return false
    },
  }
}

/** 手动计时器场景下抽干微任务，让抢锁尝试流转到下一个 await 点 */
async function flushMicrotasks(rounds = 10) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve()
  }
}

// --- Behavior ----------------------------------------------------------------

describe('acquireAppWindowGuard behavior', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns unsupported when Web Locks is unavailable', async () => {
    // navigator.locks 缺失
    vi.stubGlobal('navigator', {})
    expect((await acquireAppWindowGuard()).status).toBe('unsupported')

    // locks.request 不是函数
    vi.stubGlobal('navigator', { locks: {} })
    expect((await acquireAppWindowGuard()).status).toBe('unsupported')
  })

  it('stays supported without BroadcastChannel: lock availability alone decides', async () => {
    // 新语义：BroadcastChannel 不再是守卫依赖，即使全局缺失也照常抢锁
    const { locks } = createFakeLocks(grantLock)
    vi.stubGlobal('BroadcastChannel', undefined)
    expect((await acquireAppWindowGuard({ locks })).status).toBe('granted')
  })

  it('grants immediately when the lock is free and holds it forever', async () => {
    const { locks, requests } = createFakeLocks(grantLock)
    const timers = createManualTimers()

    const result = await acquireAppWindowGuard({
      locks,
      setTimeout: timers.setTimeout,
    })

    expect(result.status).toBe('granted')
    expect(requests).toHaveLength(1)
    expect(requests[0].name).toBe(WINDOW_GUARD_LOCK_NAME)
    expect(requests[0].options.ifAvailable).toBe(true)
    // 持锁回调永不结束：request promise 不会结算，锁持续持有
    expect(requests[0].settled).toBe(false)
  })

  it('retries with the injected delay then reports blocked when the lock stays held', async () => {
    const { locks, requests } = createFakeLocks(denyLock)
    const timers = createManualTimers()

    const pending = acquireAppWindowGuard({
      locks,
      setTimeout: timers.setTimeout,
      retryDelayMs: 400,
      maxRetries: 2,
    })

    // 首次失败后注册重试等待
    await flushMicrotasks()
    expect(timers.pending()).toHaveLength(1)
    expect(timers.pending()[0].ms).toBe(400)
    timers.fireNext()

    // 第二次失败后再注册一次重试等待
    await flushMicrotasks()
    expect(timers.pending()).toHaveLength(1)
    timers.fireNext()

    const result = await pending

    expect(result.status).toBe('blocked')
    expect(requests).toHaveLength(3)
    for (const request of requests) {
      expect(request.settled).toBe(true)
    }
  })

  it('grants when a retry succeeds after a refresh race releases the lock', async () => {
    const { locks, requests } = createFakeLocks((request, index) => {
      if (index === 0) denyLock(request, index)
      else grantLock(request, index)
    })
    const timers = createManualTimers()

    const pending = acquireAppWindowGuard({
      locks,
      setTimeout: timers.setTimeout,
      retryDelayMs: 400,
      maxRetries: 2,
    })

    await flushMicrotasks()
    timers.fireNext()

    const result = await pending

    expect(result.status).toBe('granted')
    expect(requests).toHaveLength(2)
    // 第二次持锁持续持有
    expect(requests[1].settled).toBe(false)
  })
})

// --- Source contracts ----------------------------------------------------------

const mainSource = readFileSync(new URL('../../src/main.tsx', import.meta.url), 'utf8')
const guardSource = readFileSync(new URL('../../src/lib/window-guard.ts', import.meta.url), 'utf8')
const noticeSource = readFileSync(new URL('../../src/components/WindowGuardNotice.tsx', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
const packageSource = readFileSync(new URL('../../package.json', import.meta.url), 'utf8')

describe('window guard source contracts', () => {
  it('main.tsx gates rendering on the window guard without any focus broadcast', () => {
    expect(mainSource).toContain('acquireAppWindowGuard()')
    expect(mainSource).toMatch(/guard\.status === 'blocked'/)

    // blocked 分支：只渲染拦截页、不渲染 App，不做任何聚焦广播
    const blockedBranch = mainSource.split("guard.status === 'blocked'")[1]?.split('return')[0] ?? ''
    expect(blockedBranch).toContain('<WindowGuardNotice')
    expect(blockedBranch).not.toContain('<App')
    expect(mainSource).not.toContain('requestExistingWindowFocus')

    // granted / unsupported 分支正常渲染 App
    expect(mainSource).toContain('<App />')
  })

  it('window-guard stays a pure lock guard', () => {
    // 聚焦协商 / 系统通知 / 标题闪烁 / BroadcastChannel 链路已整体移除
    expect(guardSource).not.toContain('BroadcastChannel')
    expect(guardSource).not.toContain('Notification')
    expect(guardSource).not.toContain('requestExistingWindowFocus')
    expect(guardSource).not.toContain('random-id')
    expect(guardSource).not.toContain('system-notifications')
  })

  it('i18n carries paired zh/en keys for the window guard copy', () => {
    const keys = [
      'windowGuardTitle',
      'windowGuardDescription',
    ]
    for (const key of keys) {
      expect((i18nSource.match(new RegExp(`${key}: '`, 'g')) ?? []).length).toBe(2)
    }

    // 旧切换/通知/关闭文案 key 已成对删除，无残留引用
    const removedKeys = [
      'windowGuardSwitchButton',
      'windowGuardSwitchHint',
      'windowGuardNotificationTitle',
      'windowGuardNotificationBody',
      'windowGuardCloseButton',
      'windowGuardCloseHint',
    ]
    for (const key of removedKeys) {
      expect(i18nSource).not.toContain(key)
      expect(mainSource).not.toContain(key)
      expect(noticeSource).not.toContain(key)
    }

    expect(i18nSource).toContain("windowGuardTitle: 'QuickForge is already open in another window'")
    expect(i18nSource).toContain(
      "windowGuardDescription: 'Opening more windows would use up the browser connection limit and queue requests. Please close this window and return to the existing one.'",
    )
    expect(i18nSource).toContain("windowGuardTitle: 'QuickForge 已在另一个窗口打开'")
    expect(i18nSource).toContain(
      "windowGuardDescription: '同时打开多个窗口会占满浏览器连接数，导致请求排队卡顿。请关闭本窗口并回到已有窗口使用。'",
    )
  })

  it('WindowGuardNotice is a static notice without any close button', () => {
    // 拦截页不加载 App、不发任何请求
    expect(noticeSource).not.toMatch(/import .*\/App\b/)
    expect(noticeSource).not.toMatch(/\bfetch\s*\(/)
    expect(noticeSource).not.toContain('/api/')
    // 纯静态提示：无按钮、无 window.close（浏览器不允许脚本关闭手动打开的标签页）
    expect(noticeSource).toContain("t('windowGuardTitle')")
    expect(noticeSource).toContain("t('windowGuardDescription')")
    expect(noticeSource).not.toContain('window.close')
    expect(noticeSource).not.toContain('windowGuardClose')
    expect(noticeSource).not.toContain('<Button')
    expect(noticeSource).not.toContain('useState')
    // 仅使用既有 Tailwind token，无新增样式规则
    expect(noticeSource).toContain('bg-background')
    expect(noticeSource).toContain('border-border')
    expect(noticeSource).toContain('text-muted-foreground')
    expect(noticeSource).toContain('shadow-quickforge')
    expect(noticeSource).toContain('rounded-xl')
  })

  it('does not add runtime dependencies', () => {
    const importSpecifiers = [
      ...guardSource.matchAll(/from '([^']+)'/g),
      ...noticeSource.matchAll(/from '([^']+)'/g),
    ].map((match) => match[1])
    expect(importSpecifiers.length).toBeGreaterThan(0)
    for (const specifier of importSpecifiers) {
      // react 是既有核心依赖；本契约防的是新增 lock/broadcast 之类的运行时依赖
      expect(specifier === 'react' || specifier.startsWith('.') || specifier.startsWith('@/')).toBe(true)
    }

    const pkg = JSON.parse(packageSource) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> }
    const dependencyNames = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]
    expect(dependencyNames.some((name) => /lock|broadcast/i.test(name))).toBe(false)
  })
})
