import { EventEmitter } from 'node:events'

const DEFAULT_PROTOCOL_VERSION = '1.3'
const SEND_TIMEOUT_MS = 30_000

/**
 * CDP 命令超时。超时意味着调试会话已不可信（渲染进程未就绪、已死或卡死），
 * CdpClient 会主动断开调试器；宿主据此销毁视图，下次调用全新重建。
 */
export class CdpTimeoutError extends Error {
  constructor(method) {
    super(`CDP command timed out: ${method}`)
    this.name = 'CdpTimeoutError'
    this.method = method
  }
}

/**
 * 单个 WebContents 上的 CDP 连接，**唯一所有者**。
 *
 * 「唯一所有者」是这个模块最重要的不变量：Electron 的 `webContents.debugger`
 * 同一时刻只能挂一个调试器，第二次 attach 会直接抛 "Another debugger is
 * already attached"。因此除 BrowserHost 之外任何地方都不允许直接调用
 * `webContents.debugger`；重挂、销毁、崩溃都由这里统一收敛。
 */
export class CdpClient extends EventEmitter {
  constructor(webContents, { protocolVersion = DEFAULT_PROTOCOL_VERSION } = {}) {
    super()
    this.webContents = webContents
    this.protocolVersion = protocolVersion
    this.bound = false
  }

  get attached() {
    if (!this.webContents || this.webContents.isDestroyed()) return false
    return this.webContents.debugger.isAttached()
  }

  attach() {
    if (this.attached) return true
    if (!this.webContents || this.webContents.isDestroyed()) {
      throw new Error('Browser view is not available for debugging')
    }
    this.webContents.debugger.attach(this.protocolVersion)
    if (!this.bound) {
      this.webContents.debugger.on('message', (_event, method, params) => this.emit(method, params))
      this.webContents.debugger.on('detach', (_event, reason) => {
        this.emit('detach', { reason })
      })
      this.bound = true
    }
    return true
  }

  detach() {
    if (!this.attached) return false
    try {
      this.webContents.debugger.detach()
    } finally {
      this.bound = false
    }
    return true
  }

  async send(method, params = {}) {
    if (!this.attached) this.attach()
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new CdpTimeoutError(method)), SEND_TIMEOUT_MS)
    })
    let result
    try {
      result = await Promise.race([
        this.webContents.debugger.sendCommand(method, params),
        timeout,
      ])
    } catch (error) {
      if (error instanceof CdpTimeoutError) {
        // 命令超时说明会话已坏：主动断开调试器，避免后续调用继续在同一个
        // 坏会话上排队等死；视图是否整套重建由宿主决定。
        try { this.detach() } catch { /* 目标可能已随渲染进程一起消失 */ }
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`CDP ${method} failed: ${message}`, { cause: error })
    } finally {
      clearTimeout(timer)
    }
    return result
  }

  /** 等待某个 CDP 事件；超时返回 null，不抛错（调用方决定降级策略）。 */
  waitForEvent(method, { timeoutMs = 15_000, predicate } = {}) {
    return new Promise((resolve) => {
      let timer
      const handler = (params) => {
        if (predicate && !predicate(params)) return
        cleanup()
        resolve(params)
      }
      const cleanup = () => {
        clearTimeout(timer)
        this.off(method, handler)
      }
      timer = setTimeout(() => {
        cleanup()
        resolve(null)
      }, timeoutMs)
      this.on(method, handler)
    })
  }
}
