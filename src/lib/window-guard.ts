/**
 * Web Locks 严格单窗口守卫（纯锁守卫）。
 *
 * 同一浏览器上下文内只允许一个 QuickForge 主窗口：
 * - 入口在渲染前调用 `acquireAppWindowGuard()`，以 `navigator.locks` 的
 *   `ifAvailable: true` 尝试立即持锁；
 * - 抢不到锁的窗口只渲染拦截页（不加载 App、不建立 SSE），拦截页由
 *   `main.tsx` 渲染 `WindowGuardNotice`；
 * - 同窗口刷新时旧锁释放存在竞态，首次失败后短暂等待重试再判 blocked；
 * - Web Locks 不可用时降级放行（unsupported）。
 */

export const WINDOW_GUARD_LOCK_NAME = 'quickforge-app-window'

/** 刷新竞态重试等待时长 */
export const WINDOW_GUARD_RETRY_DELAY_MS = 400
/** 刷新竞态最大重试次数（不含首次尝试） */
export const WINDOW_GUARD_MAX_RETRIES = 2

/** navigator.locks 的最小结构类型（便于测试注入） */
type WindowGuardLocks = {
  request(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: object | null) => Promise<void>,
  ): Promise<unknown>
}

export type WindowGuardTimerHandle = number
export type WindowGuardSetTimeout = (handler: () => void, timeout: number) => WindowGuardTimerHandle

export type WindowGuardDeps = {
  locks?: WindowGuardLocks
  setTimeout?: WindowGuardSetTimeout
  retryDelayMs?: number
  maxRetries?: number
}

export type WindowGuardResult =
  | { status: 'unsupported' }
  | { status: 'granted' }
  | { status: 'blocked' }

function resolveLocks(explicit?: WindowGuardLocks): WindowGuardLocks | undefined {
  if (explicit) return explicit
  if (typeof navigator === 'undefined' || !navigator.locks) return undefined
  return typeof navigator.locks.request === 'function' ? (navigator.locks as WindowGuardLocks) : undefined
}

function defaultSetTimeout(handler: () => void, timeout: number): number {
  return window.setTimeout(handler, timeout)
}

function sleep(ms: number, schedule: WindowGuardSetTimeout): Promise<void> {
  return new Promise((resolve) => {
    schedule(resolve, ms)
  })
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

  // Web Locks 不可用：降级放行
  if (!locks) {
    return { status: 'unsupported' }
  }

  const schedule = deps.setTimeout ?? defaultSetTimeout
  const retryDelayMs = deps.retryDelayMs ?? WINDOW_GUARD_RETRY_DELAY_MS
  const maxRetries = deps.maxRetries ?? WINDOW_GUARD_MAX_RETRIES

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
      return { status: 'granted' }
    }
  }

  return { status: 'blocked' }
}
