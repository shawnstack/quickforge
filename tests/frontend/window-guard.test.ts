import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

// window-guard 经 system-notifications → i18n 传递依赖 pi-web-ui 与 Capacitor；
// 延续 system-notifications.test.ts 的最小桩做法，聚焦守卫行为本身。
vi.mock('@earendil-works/pi-web-ui', () => ({
  translations: { en: {}, zh: {} },
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, isPluginAvailable: () => false },
}))

import { t } from '../../src/lib/i18n'
import {
  WINDOW_GUARD_CHANNEL_NAME,
  WINDOW_GUARD_LOCK_NAME,
  WINDOW_GUARD_NOTIFICATION_THROTTLE_MS,
  WINDOW_GUARD_TITLE_FLASH_DURATION_MS,
  WINDOW_GUARD_TITLE_FLASH_INTERVAL_MS,
  acquireAppWindowGuard,
  createRequestExistingWindowFocus,
  type WindowGuardNotificationCtor,
} from '../../src/lib/window-guard'

// --- Fakes -------------------------------------------------------------------

class FakeChannel {
  name: string
  posted: unknown[] = []
  closed = false
  onmessage: ((event: { data: unknown }) => void) | null = null

  constructor(name: string) {
    this.name = name
  }

  postMessage(message: unknown) {
    this.posted.push(message)
  }

  close() {
    this.closed = true
  }
}

function createFakeBroadcastChannelCtor() {
  const instances: FakeChannel[] = []
  const BroadcastChannel = class extends FakeChannel {
    constructor(name: string) {
      super(name)
      instances.push(this)
    }
  }
  return { BroadcastChannel, instances }
}

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
    clearTimeout(id: number) {
      timers.delete(id)
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

function focusRequestEvent(source = 'other-window') {
  return { data: { type: 'focus-request', source } }
}

class FakeNotification {
  static instances: FakeNotification[] = []

  onclick: ((event: Event) => void) | null = null
  close = vi.fn()

  constructor(
    public readonly title: string,
    public readonly options: { body: string; tag: string; requireInteraction: boolean },
  ) {
    FakeNotification.instances.push(this)
  }
}

/** 建立一个持锁 responder 场景，返回触发 focus-request 与各注入件的句柄 */
async function setupResponder(overrides: {
  NotificationCtor?: WindowGuardNotificationCtor
  notificationPermission?: () => string | undefined
  isNotificationsEnabled?: () => boolean
  now?: () => number
  addFocusListener?: (listener: () => void) => void
} = {}) {
  const { locks } = createFakeLocks(grantLock)
  const { BroadcastChannel, instances } = createFakeBroadcastChannelCtor()
  const timers = createManualTimers()
  const focus = vi.fn()
  const documentRef = { title: 'QuickForge' }
  const focusListeners: Array<() => void> = []

  const result = await acquireAppWindowGuard({
    locks,
    BroadcastChannel,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    focus,
    document: documentRef,
    addFocusListener: overrides.addFocusListener ?? ((listener) => focusListeners.push(listener)),
    ...overrides,
  })
  expect(result.status).toBe('granted')

  const responderChannel = instances.find((channel) => channel.onmessage !== null)!
  const requestFocus = () => responderChannel.onmessage!(focusRequestEvent())
  return { timers, focus, documentRef, focusListeners, requestFocus, result }
}

// --- Behavior ----------------------------------------------------------------

describe('acquireAppWindowGuard behavior', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('returns unsupported when Web Locks or BroadcastChannel is unavailable', async () => {
    const { BroadcastChannel, instances } = createFakeBroadcastChannelCtor()

    // navigator.locks 缺失
    vi.stubGlobal('navigator', {})
    expect((await acquireAppWindowGuard({ BroadcastChannel })).status).toBe('unsupported')

    // locks.request 不是函数
    vi.stubGlobal('navigator', { locks: {} })
    expect((await acquireAppWindowGuard({ BroadcastChannel })).status).toBe('unsupported')

    // BroadcastChannel 缺失（即使锁可用）
    const { locks } = createFakeLocks(grantLock)
    vi.stubGlobal('navigator', { locks })
    vi.stubGlobal('BroadcastChannel', undefined)
    expect((await acquireAppWindowGuard({ locks })).status).toBe('unsupported')
    expect(instances).toHaveLength(0)
  })

  it('grants immediately when the lock is free and holds it forever', async () => {
    const { locks, requests } = createFakeLocks(grantLock)
    const { BroadcastChannel, instances } = createFakeBroadcastChannelCtor()
    const timers = createManualTimers()

    const result = await acquireAppWindowGuard({
      locks,
      BroadcastChannel,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      focus: vi.fn(),
      document: { title: 'QuickForge' },
    })

    expect(result.status).toBe('granted')
    expect(requests).toHaveLength(1)
    expect(requests[0].name).toBe(WINDOW_GUARD_LOCK_NAME)
    expect(requests[0].options.ifAvailable).toBe(true)
    // 持锁回调永不结束：request promise 不会结算，锁持续持有
    expect(requests[0].settled).toBe(false)
    // granted 后 focus 响应器已激活（专用频道已监听）
    const responderChannel = instances.find(
      (channel) => channel.name === WINDOW_GUARD_CHANNEL_NAME && channel.onmessage !== null,
    )
    expect(responderChannel).toBeDefined()
  })

  it('retries with the injected delay then reports blocked when the lock stays held', async () => {
    const { locks, requests } = createFakeLocks(denyLock)
    const { BroadcastChannel, instances } = createFakeBroadcastChannelCtor()
    const timers = createManualTimers()

    const pending = acquireAppWindowGuard({
      locks,
      BroadcastChannel,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
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
    // blocked 结果仍可广播 focus 请求（尽力把已有窗口带到前台）
    result.requestExistingWindowFocus()
    expect(instances).toHaveLength(1)
    expect(instances[0].name).toBe(WINDOW_GUARD_CHANNEL_NAME)
    expect(instances[0].posted).toEqual([{ type: 'focus-request', source: expect.any(String) }])
    expect(instances[0].closed).toBe(true)
  })

  it('grants when a retry succeeds after a refresh race releases the lock', async () => {
    const { locks, requests } = createFakeLocks((request, index) => {
      if (index === 0) denyLock(request, index)
      else grantLock(request, index)
    })
    const { BroadcastChannel } = createFakeBroadcastChannelCtor()
    const timers = createManualTimers()

    const pending = acquireAppWindowGuard({
      locks,
      BroadcastChannel,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
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

  it('focus responder focuses and flashes the title, resetting the timer on repeats', async () => {
    const { locks } = createFakeLocks(grantLock)
    const { BroadcastChannel, instances } = createFakeBroadcastChannelCtor()
    const timers = createManualTimers()
    const focus = vi.fn()
    const documentRef = { title: 'QuickForge' }

    const result = await acquireAppWindowGuard({
      locks,
      BroadcastChannel,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      focus,
      document: documentRef,
    })
    expect(result.status).toBe('granted')

    const responderChannel = instances.find((channel) => channel.onmessage !== null)!
    responderChannel.onmessage!(focusRequestEvent())
    expect(focus).toHaveBeenCalledTimes(1)
    // 标题立即进入闪烁相位：不依赖任何计时器推进（后台 setTimeout 会被节流）
    expect(documentRef.title).toBe('● QuickForge')
    // 闪烁启动：一个交替计时器 + 一个截止计时器
    const firstToggle = timers.pending().find((timer) => timer.ms === WINDOW_GUARD_TITLE_FLASH_INTERVAL_MS)!
    const firstDeadline = timers.pending().find((timer) => timer.ms === WINDOW_GUARD_TITLE_FLASH_DURATION_MS)!
    expect(firstToggle).toBeDefined()
    expect(firstDeadline).toBeDefined()

    timers.fire(firstToggle.id)
    expect(documentRef.title).toBe('QuickForge')

    // 重复请求：focus 再次调用、立即回到闪烁相位并重置截止计时（旧 deadline 已清除）
    responderChannel.onmessage!(focusRequestEvent())
    expect(focus).toHaveBeenCalledTimes(2)
    expect(documentRef.title).toBe('● QuickForge')
    timers.fire(firstDeadline.id)
    expect(documentRef.title).toBe('● QuickForge')

    const secondDeadline = timers.pending().find((timer) => timer.ms === WINDOW_GUARD_TITLE_FLASH_DURATION_MS)!
    timers.fire(secondDeadline.id)
    expect(documentRef.title).toBe('QuickForge')
    // 截止后闪烁停止，交替计时器也已清除
    expect(timers.pending()).toHaveLength(0)
  })

  it('shows a system notification on focus-request and focuses the window on click', async () => {
    FakeNotification.instances.length = 0
    const currentTime = 1_000
    const { focus, requestFocus } = await setupResponder({
      NotificationCtor: FakeNotification,
      notificationPermission: () => 'granted',
      isNotificationsEnabled: () => true,
      now: () => currentTime,
    })

    requestFocus()
    expect(FakeNotification.instances).toHaveLength(1)
    const notification = FakeNotification.instances[0]
    expect(notification.title).toBe(t('windowGuardNotificationTitle'))
    expect(notification.options.body).toBe(t('windowGuardNotificationBody'))
    expect(notification.options.tag).toBe('quickforge-window-guard')
    expect(notification.options.requireInteraction).toBe(false)

    // 通知点击自带 user activation：close + focus 可靠生效
    notification.onclick?.({} as Event)
    expect(notification.close).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledTimes(2)
  })

  it('skips the notification without granted permission or when the switch is off', async () => {
    FakeNotification.instances.length = 0
    const { requestFocus: requestWhenDenied } = await setupResponder({
      NotificationCtor: FakeNotification,
      notificationPermission: () => 'denied',
      isNotificationsEnabled: () => true,
    })
    requestWhenDenied()
    expect(FakeNotification.instances).toHaveLength(0)

    const { requestFocus: requestWhenDisabled } = await setupResponder({
      NotificationCtor: FakeNotification,
      notificationPermission: () => 'granted',
      isNotificationsEnabled: () => false,
    })
    requestWhenDisabled()
    expect(FakeNotification.instances).toHaveLength(0)
  })

  it('throttles repeat notifications within the window but flashes the title every time', async () => {
    FakeNotification.instances.length = 0
    let currentTime = 1_000
    const { documentRef, requestFocus } = await setupResponder({
      NotificationCtor: FakeNotification,
      notificationPermission: () => 'granted',
      isNotificationsEnabled: () => true,
      now: () => currentTime,
    })

    requestFocus()
    expect(FakeNotification.instances).toHaveLength(1)

    // 节流窗内：不重复弹通知
    currentTime += WINDOW_GUARD_NOTIFICATION_THROTTLE_MS - 1
    requestFocus()
    expect(FakeNotification.instances).toHaveLength(1)
    // 标题闪烁不受节流限制：每次请求立即进入闪烁相位
    expect(documentRef.title).toBe('● QuickForge')

    // 超过节流窗：再次弹一条
    currentTime += WINDOW_GUARD_NOTIFICATION_THROTTLE_MS
    requestFocus()
    expect(FakeNotification.instances).toHaveLength(2)
  })

  it('restores the title via the focus listener after the flash deadline passes in background', async () => {
    let currentTime = 1_000
    const { timers, documentRef, focusListeners, requestFocus } = await setupResponder({
      now: () => currentTime,
    })

    requestFocus()
    expect(documentRef.title).toBe('● QuickForge')

    // 截止前用户切回窗口：不打断闪烁
    currentTime += WINDOW_GUARD_TITLE_FLASH_DURATION_MS - 1
    for (const listener of focusListeners) listener()
    expect(documentRef.title).toBe('● QuickForge')

    // 后台节流导致截止计时器迟到：切回窗口时已超时 → 立即恢复并停止闪烁
    currentTime += 1
    for (const listener of focusListeners) listener()
    expect(documentRef.title).toBe('QuickForge')
    expect(timers.pending()).toHaveLength(0)
  })

  it('degrades silently when notification dependencies are unavailable or throw', async () => {
    const { requestFocus } = await setupResponder()
    // 未注入构造器且全局 Notification 不可用：静默不抛错
    expect(() => requestFocus()).not.toThrow()

    class ThrowingNotification {
      onclick: ((event: Event) => void) | null = null
      close() {}
      constructor() {
        throw new Error('notification unavailable')
      }
    }
    const { requestFocus: requestThrowing } = await setupResponder({
      NotificationCtor: ThrowingNotification,
      notificationPermission: () => 'granted',
      isNotificationsEnabled: () => true,
    })
    expect(() => requestThrowing()).not.toThrow()
  })

  it('requestExistingWindowFocus broadcasts on the guard channel and closes it', () => {
    const { BroadcastChannel, instances } = createFakeBroadcastChannelCtor()
    const requestExistingWindowFocus = createRequestExistingWindowFocus(BroadcastChannel)

    requestExistingWindowFocus()

    expect(instances).toHaveLength(1)
    expect(instances[0].name).toBe(WINDOW_GUARD_CHANNEL_NAME)
    expect(instances[0].posted).toEqual([{ type: 'focus-request', source: expect.any(String) }])
    expect(instances[0].closed).toBe(true)

    // BroadcastChannel 不可用：静默 no-op
    expect(() => createRequestExistingWindowFocus(undefined)()).not.toThrow()
  })
})

// --- Source contracts ----------------------------------------------------------

const mainSource = readFileSync(new URL('../../src/main.tsx', import.meta.url), 'utf8')
const guardSource = readFileSync(new URL('../../src/lib/window-guard.ts', import.meta.url), 'utf8')
const noticeSource = readFileSync(new URL('../../src/components/WindowGuardNotice.tsx', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
const packageSource = readFileSync(new URL('../../package.json', import.meta.url), 'utf8')

describe('window guard source contracts', () => {
  it('main.tsx gates rendering on the window guard', () => {
    expect(mainSource).toContain('acquireAppWindowGuard()')
    expect(mainSource).toMatch(/guard\.status === 'blocked'/)

    // blocked 分支：自动广播一次 focus 请求、渲染拦截页、不渲染 App
    const blockedBranch = mainSource.split("guard.status === 'blocked'")[1]?.split('return')[0] ?? ''
    expect(blockedBranch).toContain('requestExistingWindowFocus()')
    expect(blockedBranch).toContain('<WindowGuardNotice')
    expect(blockedBranch).not.toContain('<App')

    // granted / unsupported 分支正常渲染 App
    expect(mainSource).toContain('<App />')
  })

  it('i18n carries paired zh/en keys for the window guard copy', () => {
    const keys = [
      'windowGuardTitle',
      'windowGuardDescription',
      'windowGuardSwitchButton',
      'windowGuardNotificationTitle',
      'windowGuardNotificationBody',
      'windowGuardSwitchHint',
    ]
    for (const key of keys) {
      expect((i18nSource.match(new RegExp(`${key}: '`, 'g')) ?? []).length).toBe(2)
    }
    expect(i18nSource).toContain("windowGuardTitle: 'QuickForge is already open in another window'")
    expect(i18nSource).toContain(
      "windowGuardDescription: 'Opening more windows would use up the browser connection limit and queue requests. Please return to the existing window.'",
    )
    expect(i18nSource).toContain("windowGuardSwitchButton: 'Switch to the existing window'")
    expect(i18nSource).toContain("windowGuardNotificationTitle: 'QuickForge'")
    expect(i18nSource).toContain("windowGuardNotificationBody: 'Another window is asking to switch here")
    expect(i18nSource).toContain("windowGuardSwitchHint: 'Switch request sent.")
    expect(i18nSource).toContain("windowGuardTitle: 'QuickForge 已在另一个窗口打开'")
    expect(i18nSource).toContain(
      "windowGuardDescription: '同时打开多个窗口会占满浏览器连接数，导致请求排队卡顿。建议回到已有窗口继续使用。'",
    )
    expect(i18nSource).toContain("windowGuardSwitchButton: '切换到已有窗口'")
    expect(i18nSource).toContain("windowGuardNotificationBody: '在另一个窗口请求切换——点击此处切换到此窗口。'")
    expect(i18nSource).toContain("windowGuardSwitchHint: '已发送切换请求。若浏览器未自动切换，请点击系统通知或任务栏中带 ● 标记的 QuickForge 窗口。'")
  })

  it('WindowGuardNotice stays isolated and uses existing design tokens', () => {
    // 拦截页不加载 App、不发任何请求
    expect(noticeSource).not.toMatch(/import .*\/App\b/)
    expect(noticeSource).not.toMatch(/\bfetch\s*\(/)
    expect(noticeSource).not.toContain('/api/')
    // 点击后本地 state 反馈：显示切换提示，引导用户找系统通知/任务栏 ● 标记
    expect(noticeSource).toContain('useState')
    expect(noticeSource).toContain("t('windowGuardSwitchHint')")
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
