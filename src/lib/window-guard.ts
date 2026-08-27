import { randomId } from '@/lib/random-id'
import { t } from '@/lib/i18n'
import { isSystemNotificationsEnabled } from '@/lib/system-notifications'

/**
 * Web Locks 严格单窗口守卫。
 *
 * 同一浏览器上下文内只允许一个 QuickForge 主窗口：
 * - 入口在渲染前调用 `acquireAppWindowGuard()`，以 `navigator.locks` 的
 *   `ifAvailable: true` 尝试立即持锁；
 * - 抢不到锁的窗口只渲染拦截页（不加载 App、不建立 SSE），并可向持锁窗口
 *   广播 focus 请求；持锁窗口尽力 `window.focus()`（后台无 user activation
 *   常被浏览器拒绝），并以标题立即闪烁 + 系统通知点击聚焦兜底；
 * - 同窗口刷新时旧锁释放存在竞态，首次失败后短暂等待重试再判 blocked；
 * - Web Locks 或 BroadcastChannel 不可用时降级放行（unsupported）。
 */

export const WINDOW_GUARD_LOCK_NAME = 'quickforge-app-window'
export const WINDOW_GUARD_CHANNEL_NAME = 'quickforge-window-guard'

/** 刷新竞态重试等待时长 */
export const WINDOW_GUARD_RETRY_DELAY_MS = 400
/** 刷新竞态最大重试次数（不含首次尝试） */
export const WINDOW_GUARD_MAX_RETRIES = 2
/** 标题闪烁持续时长 */
export const WINDOW_GUARD_TITLE_FLASH_DURATION_MS = 5000
/** 标题闪烁交替间隔 */
export const WINDOW_GUARD_TITLE_FLASH_INTERVAL_MS = 800
/** 系统通知去重窗口：同一持锁窗口在此时长内最多弹一条通知（标题闪烁不受限） */
export const WINDOW_GUARD_NOTIFICATION_THROTTLE_MS = 10_000

const WINDOW_GUARD_TITLE_FLASH_PREFIX = '● '
const WINDOW_GUARD_NOTIFICATION_TAG = 'quickforge-window-guard'

type WindowGuardChannelMessage = {
  type: 'focus-request'
  source?: string
}

/** navigator.locks 的最小结构类型（便于测试注入） */
type WindowGuardLocks = {
  request(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: object | null) => Promise<void>,
  ): Promise<unknown>
}

/** BroadcastChannel 的最小结构类型（便于测试注入） */
type WindowGuardChannel = {
  postMessage(message: WindowGuardChannelMessage): void
  close(): void
  onmessage: ((event: MessageEvent<unknown>) => void) | null
}
type WindowGuardChannelCtor = new (name: string) => WindowGuardChannel

export type WindowGuardTimerHandle = number
export type WindowGuardSetTimeout = (handler: () => void, timeout: number) => WindowGuardTimerHandle
export type WindowGuardClearTimeout = (handle: WindowGuardTimerHandle) => void
export type WindowGuardDocument = { title: string }

/** 最小 Notification 结构（便于测试注入） */
export type WindowGuardNotification = {
  onclick: ((event: Event) => void) | null
  close(): void
}
export type WindowGuardNotificationCtor = new (
  title: string,
  options: { body: string; tag: string; requireInteraction: boolean },
) => WindowGuardNotification

export type WindowGuardDeps = {
  locks?: WindowGuardLocks
  BroadcastChannel?: WindowGuardChannelCtor
  setTimeout?: WindowGuardSetTimeout
  clearTimeout?: WindowGuardClearTimeout
  focus?: () => void
  document?: WindowGuardDocument
  retryDelayMs?: number
  maxRetries?: number
  /** Notification 构造器（默认读全局 Notification） */
  NotificationCtor?: WindowGuardNotificationCtor
  /** 通知权限查询（默认读全局 Notification.permission） */
  notificationPermission?: () => string | undefined
  /** 系统通知总开关（默认复用 system-notifications 的 localStorage 开关） */
  isNotificationsEnabled?: () => boolean
  /** window focus 事件监听注入（标题恢复兜底，默认 window.addEventListener） */
  addFocusListener?: (listener: () => void) => void
  /** 当前时间注入（默认 Date.now，用于闪烁截止判断与通知节流） */
  now?: () => number
}

export type WindowGuardResult =
  | { status: 'unsupported' }
  | { status: 'granted' | 'blocked'; requestExistingWindowFocus: () => void }

function resolveLocks(explicit?: WindowGuardLocks): WindowGuardLocks | undefined {
  if (explicit) return explicit
  if (typeof navigator === 'undefined' || !navigator.locks) return undefined
  return typeof navigator.locks.request === 'function' ? (navigator.locks as WindowGuardLocks) : undefined
}

function resolveChannelCtor(explicit?: WindowGuardChannelCtor): WindowGuardChannelCtor | undefined {
  if (explicit) return explicit
  return typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : undefined
}

function defaultSetTimeout(handler: () => void, timeout: number): number {
  return window.setTimeout(handler, timeout)
}

function defaultClearTimeout(handle: number): void {
  window.clearTimeout(handle)
}

function defaultFocus(): void {
  if (typeof window !== 'undefined') window.focus()
}

function resolveDocument(explicit?: WindowGuardDocument): WindowGuardDocument | undefined {
  return explicit ?? (typeof document !== 'undefined' ? document : undefined)
}

function resolveNotificationCtor(explicit?: WindowGuardNotificationCtor): WindowGuardNotificationCtor | undefined {
  if (explicit) return explicit
  if (typeof Notification === 'undefined') return undefined
  return Notification as unknown as WindowGuardNotificationCtor
}

function defaultNotificationPermission(): string | undefined {
  if (typeof Notification === 'undefined') return undefined
  return Notification.permission
}

function defaultAddFocusListener(listener: () => void): void {
  if (typeof window === 'undefined') return
  window.addEventListener('focus', listener)
}

function defaultNow(): number {
  return Date.now()
}

function sleep(ms: number, schedule: WindowGuardSetTimeout): Promise<void> {
  return new Promise((resolve) => {
    schedule(resolve, ms)
  })
}

/**
 * 持锁窗口的 focus 响应器：监听专用 BroadcastChannel，收到 focus-request 后
 * 尽力聚焦窗口，并立即闪烁标题 + 发送系统通知（点击通知自带 user activation，
 * 聚焦可靠）。进程级生命周期，页面卸载即结束，无需清理。
 */
export function startWindowFocusResponder(deps: WindowGuardDeps = {}): void {
  const ChannelCtor = resolveChannelCtor(deps.BroadcastChannel)
  if (!ChannelCtor) return

  const focus = deps.focus ?? defaultFocus
  const documentRef = resolveDocument(deps.document)
  const schedule = deps.setTimeout ?? defaultSetTimeout
  const cancel = deps.clearTimeout ?? defaultClearTimeout
  const addFocusListener = deps.addFocusListener ?? defaultAddFocusListener
  const now = deps.now ?? defaultNow
  const NotificationCtor = resolveNotificationCtor(deps.NotificationCtor)
  const notificationPermission = deps.notificationPermission ?? defaultNotificationPermission
  const isNotificationsEnabled = deps.isNotificationsEnabled ?? isSystemNotificationsEnabled

  let channel: WindowGuardChannel
  try {
    channel = new ChannelCtor(WINDOW_GUARD_CHANNEL_NAME)
  } catch {
    return
  }

  let flashing = false
  let originalTitle = ''
  let titleFlashed = false
  let toggleHandle: WindowGuardTimerHandle | null = null
  let deadlineHandle: WindowGuardTimerHandle | null = null
  let flashDeadlineAt = 0
  let lastNotificationAt = Number.NEGATIVE_INFINITY

  const restoreTitle = () => {
    if (documentRef) documentRef.title = originalTitle
    titleFlashed = false
  }

  const stopFlashing = () => {
    if (toggleHandle !== null) cancel(toggleHandle)
    if (deadlineHandle !== null) cancel(deadlineHandle)
    toggleHandle = null
    deadlineHandle = null
    restoreTitle()
    flashing = false
  }

  const scheduleToggle = () => {
    toggleHandle = schedule(() => {
      if (!flashing) return
      titleFlashed = !titleFlashed
      if (documentRef) {
        documentRef.title = titleFlashed ? `${WINDOW_GUARD_TITLE_FLASH_PREFIX}${originalTitle}` : originalTitle
      }
      scheduleToggle()
    }, WINDOW_GUARD_TITLE_FLASH_INTERVAL_MS)
  }

  const startFlashing = () => {
    if (!documentRef) return
    if (!flashing) {
      originalTitle = documentRef.title
      flashing = true
      scheduleToggle()
    }
    // 后台标签的 setTimeout 会被浏览器节流（低至 1 次/分钟），首个可见变化
    // 不能依赖计时器：收到请求立即进入闪烁相位。
    titleFlashed = true
    documentRef.title = `${WINDOW_GUARD_TITLE_FLASH_PREFIX}${originalTitle}`
    // 已在闪烁中收到新请求：闪烁继续，仅重置截止计时
    if (deadlineHandle !== null) cancel(deadlineHandle)
    flashDeadlineAt = now() + WINDOW_GUARD_TITLE_FLASH_DURATION_MS
    deadlineHandle = schedule(stopFlashing, WINDOW_GUARD_TITLE_FLASH_DURATION_MS)
  }

  // 兜底：截止计时器同样会被后台节流而迟到，用户切回窗口时若闪烁已超时，
  // 立即恢复原标题，保证不留脏 title（监听进程级生命周期，不清理）。
  addFocusListener(() => {
    if (flashing && now() >= flashDeadlineAt) stopFlashing()
  })

  const notifyWindowGuard = () => {
    if (!NotificationCtor) return
    if (notificationPermission() !== 'granted') return
    if (!isNotificationsEnabled()) return
    const at = now()
    // 10s 去重：避免拦截页反复点击刷屏；标题闪烁不受此限制
    if (at - lastNotificationAt < WINDOW_GUARD_NOTIFICATION_THROTTLE_MS) return
    lastNotificationAt = at
    try {
      // 点击通知自带 user activation，window.focus() 可可靠生效；复用
      // system-notifications 的 SW 路径强绑定 open-session 语义，这里用
      // 构造器通知即可（不可用/抛错时静默降级，标题闪烁仍是兜底）。
      const notification = new NotificationCtor(t('windowGuardNotificationTitle'), {
        body: t('windowGuardNotificationBody'),
        tag: WINDOW_GUARD_NOTIFICATION_TAG,
        requireInteraction: false,
      })
      notification.onclick = () => {
        notification.close()
        focus()
      }
    } catch {
      // 通知是尽力而为的兜底：失败静默
    }
  }

  channel.onmessage = (event) => {
    const message = event.data as WindowGuardChannelMessage | null | undefined
    if (!message || typeof message !== 'object' || message.type !== 'focus-request') return
    focus()
    startFlashing()
    notifyWindowGuard()
  }
}

/** 构造 focus 请求发送函数（BroadcastChannel 不可用时静默 no-op）。 */
export function createRequestExistingWindowFocus(
  ChannelCtor: WindowGuardChannelCtor | undefined,
): () => void {
  return () => {
    if (!ChannelCtor) return
    try {
      const channel = new ChannelCtor(WINDOW_GUARD_CHANNEL_NAME)
      channel.postMessage({ type: 'focus-request', source: randomId() })
      channel.close()
    } catch {
      // 聚焦协商尽力而为：失败静默
    }
  }
}

/** 使用全局 BroadcastChannel 的 focus 请求入口（拦截页默认回调）。 */
export function requestExistingWindowFocus(): void {
  createRequestExistingWindowFocus(resolveChannelCtor())()
}

/**
 * 渲染前调用：尝试持有应用级 Web Lock。
 *
 * 成功判定不依赖 request promise——持锁时回调永不结束、promise 不会结算，
 * 因此以回调内 acquired 置位（经 acquiredPromise 通知）作为 granted 信号；
 * request promise 结算（ifAvailable 拿不到锁）则按注入参数等待重试。
 */
export async function acquireAppWindowGuard(deps: WindowGuardDeps = {}): Promise<WindowGuardResult> {
  const locks = resolveLocks(deps.locks)
  const ChannelCtor = resolveChannelCtor(deps.BroadcastChannel)

  // Web Locks 或 BroadcastChannel 不可用：降级放行
  if (!locks || !ChannelCtor) {
    return { status: 'unsupported' }
  }

  const schedule = deps.setTimeout ?? defaultSetTimeout
  const retryDelayMs = deps.retryDelayMs ?? WINDOW_GUARD_RETRY_DELAY_MS
  const maxRetries = deps.maxRetries ?? WINDOW_GUARD_MAX_RETRIES
  const requestExisting = createRequestExistingWindowFocus(ChannelCtor)

  const attempts = Math.max(1, maxRetries + 1)
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // 同窗口刷新时旧锁释放有竞态：首次失败后短暂等待重试
    if (attempt > 1) {
      await sleep(retryDelayMs, schedule)
    }

    let acquired = false
    let notifyAcquired: (() => void) | undefined
    const acquiredPromise = new Promise<void>((resolve) => {
      notifyAcquired = resolve
    })

    const requestPromise = locks.request(WINDOW_GUARD_LOCK_NAME, { ifAvailable: true }, (lock) => {
      if (!lock) {
        // ifAvailable：锁被其他窗口持有，本次未获得（request promise 随即结算）
        return Promise.resolve()
      }
      acquired = true
      notifyAcquired?.()
      startWindowFocusResponder(deps)
      return new Promise<void>(() => {
        // 持有锁直到页面卸载：回调永不结束
      })
    })

    const outcome = await Promise.race([
      acquiredPromise.then(() => 'acquired' as const),
      Promise.resolve(requestPromise).then(
        () => 'settled' as const,
        () => 'settled' as const,
      ),
    ])

    if (outcome === 'acquired' || acquired) {
      return { status: 'granted', requestExistingWindowFocus: requestExisting }
    }
  }

  return { status: 'blocked', requestExistingWindowFocus: requestExisting }
}
