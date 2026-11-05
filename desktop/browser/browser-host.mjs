import path from 'node:path'
import { WebContentsView, session as electronSession } from 'electron'
import { CdpClient, CdpTimeoutError } from './cdp-client.mjs'
import { PageActions } from './page-actions.mjs'
import { BROWSER_SESSION_PARTITION, normalizeNavigableUrl } from './policy.mjs'
import { DEFAULT_BOUNDS, clampBounds, isFiniteRect } from './layout.mjs'

/** 新视图等待渲染进程就绪（首个 dom-ready）的上限。 */
const VIEW_READINESS_TIMEOUT_MS = 15_000

/**
 * 内嵌 AI 浏览器宿主：**唯一**持有 WebContentsView 与 CDP 连接的地方。
 *
 * 生命周期上只有一个实例；视图懒创建，首次使用时挂到主窗口的 contentView。
 * 视图是真原生层，永远盖在 DOM 之上，所以「何时可见」必须由渲染进程显式汇报
 * （面板挂载/卸载、标签切换、窗口隐藏），主进程不做任何猜测。
 *
 * 会话坏死（渲染进程崩溃、调试器被外部断开、CDP 命令超时）时整套视图作废，
 * 下一次工具调用自动从全新视图重建 —— 不存在「坏会话被永久复用」的路径。
 */
export function createBrowserHost({ screenshotDir, onStateChange } = {}) {
  let window = null
  let view = null
  let cdp = null
  let actions = null
  let bounds = { ...DEFAULT_BOUNDS }
  let visible = false
  let preferredVisible = false
  let lastError = null
  let wakeReadiness = null

  function emitState() {
    if (typeof onStateChange !== 'function') return
    try {
      onStateChange(getState())
    } catch {
      // 状态广播失败不应影响工具执行。
    }
  }

  /** 会话坏死（崩溃/外部断开/命令超时）后视图整体作废，下次调用全新重建。 */
  function discardView() {
    if (!view) return
    try {
      cdp?.detach()
    } catch {
      // 调试器可能已被动断开。
    }
    try {
      if (!view.webContents.isDestroyed()) {
        window?.contentView?.removeChildView?.(view)
        view.webContents.close?.()
      }
    } catch {
      // 窗口/视图可能已销毁。
    }
    view = null
    cdp = null
    actions = null
    // 唤醒还卡在就绪门里的调用，让它们立即失败而不是白等满 15 秒。
    wakeReadiness?.()
    wakeReadiness = null
    emitState()
  }

  function getState() {
    const page = actions?.state?.() || { url: '', title: '', generation: 0, hasSnapshot: false }
    return { ...page, visible, error: lastError }
  }

  function configureSession() {
    const ses = electronSession.fromPartition(BROWSER_SESSION_PARTITION)
    // 内嵌浏览器与主窗口 cookie 隔离：绝不共享登录态，否则被诱导的页面能带着
    // 用户身份访问本机服务。
    ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    ses.setDisplayMediaRequestHandler?.((_request, callback) => callback({}))
    ses.on('will-download', (event) => event.preventDefault())
    return ses
  }

  function ensureView() {
    if (view && !view.webContents.isDestroyed()) return view
    if (!window || window.isDestroyed()) {
      throw new Error('Desktop browser is not ready: the QuickForge window is closed')
    }
    configureSession()
    view = new WebContentsView({
      webPreferences: {
        partition: BROWSER_SESSION_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        devTools: false,
        // 内嵌页永远拿不到 preload / Node / Electron 桥。
        preload: undefined,
      },
    })
    view.setBackgroundColor('#ffffff')
    view.setBounds(bounds)
    view.setVisible(visible)
    window.contentView.addChildView(view)

    cdp = new CdpClient(view.webContents)
    actions = new PageActions({
      cdp,
      webContents: view.webContents,
      screenshotDir: screenshotDir || path.join(process.cwd(), 'browser-screenshots'),
    })

    const wc = view.webContents
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.on('will-navigate', (event, targetUrl) => {
      const policy = normalizeNavigableUrl(targetUrl)
      if (!policy.ok) {
        event.preventDefault()
        lastError = policy.message
        emitState()
      }
    })

    for (const eventName of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page']) {
      wc.on(eventName, emitState)
    }
    wc.on('page-title-updated', emitState)
    wc.on('render-process-gone', (_event, details) => {
      lastError = `Browser renderer exited (${details?.reason || 'unknown'})`
      // 渲染进程已死：视图整体作废，下次调用全新重建，绝不复用僵尸 webContents。
      discardView()
    })
    cdp.on('detach', ({ reason }) => {
      lastError = `Debugger detached (${reason || 'unknown'})`
      // 外部断开（崩溃、被占用等）：同样作废整套视图，自愈而非报错后卡死。
      discardView()
    })
    return view
  }

  /**
   * 首条 CDP 命令前的就绪门：渲染进程未起好时 DevTools agent 不应答，
   * 命令会一直挂到超时。等待首个 dom-ready（15s 封顶）消除这一冷启动竞态；
   * 超时不炸——继续尝试执行，让真实的命令超时把会话熔断掉。
   */
  function waitForViewReadiness() {
    if (!view) return null
    const wc = view.webContents
    // 查不到加载状态（测试替身/异常环境）时不阻塞，由命令超时熔断兜底。
    if (typeof wc.isLoadingMainFrame !== 'function') return null
    if (wc.isLoadingMainFrame() === false) return null
    const waitedView = view
    return new Promise((resolve) => {
      let timer
      const done = () => {
        clearTimeout(timer)
        wc.off?.('dom-ready', done)
        if (wakeReadiness === done) wakeReadiness = null
        resolve()
      }
      timer = setTimeout(() => {
        // 等待期间视图被作废（崩溃/断开）时不写错误、不阻塞重建后的下一次调用。
        if (view === waitedView) lastError = 'Browser view readiness wait timed out'
        done()
      }, VIEW_READINESS_TIMEOUT_MS)
      wakeReadiness = done
      wc.on?.('dom-ready', done)
    })
  }

  function attachWindow(nextWindow) {
    window = nextWindow
    emitState()
  }

  function setBounds(rect) {
    if (!isFiniteRect(rect)) return
    const size = window && !window.isDestroyed() ? window.getContentSize() : null
    bounds = clampBounds(rect, size ? { width: size[0], height: size[1] } : null)
    if (view && !view.webContents.isDestroyed()) {
      view.setBounds(bounds)
    }
    emitState()
  }

  function setVisible(nextVisible) {
    preferredVisible = Boolean(nextVisible)
    visible = preferredVisible
    if (view && !view.webContents.isDestroyed()) {
      view.setVisible(visible)
      if (visible) view.setBounds(bounds)
    }
    emitState()
  }

  /** 窗口被隐藏（托盘最小化）时暂停显示，但记住调用方想要的可见状态。 */
  function suspend() {
    if (!view || view.webContents.isDestroyed()) return
    view.setVisible(false)
    visible = false
    emitState()
  }

  function resume() {
    if (!view || view.webContents.isDestroyed()) return
    visible = preferredVisible
    view.setVisible(visible)
    emitState()
  }

  /**
   * 视图隐藏时 Chromium 不合成帧，截图/点击会拿到空数据。执行动作期间强制可见，
   * 结束后恢复原状 —— 正常路径下面板已由工具调用自动打开，这一步是无操作。
   * 新建视图先过就绪门（等首个 dom-ready），消除冷启动期命令进黑洞的竞态。
   */
  async function withOperationalView(run) {
    ensureView()
    await waitForViewReadiness()
    const restoreHidden = !visible
    if (restoreHidden) view.setVisible(true)
    try {
      return await run()
    } finally {
      if (restoreHidden && view && !view.webContents.isDestroyed()) view.setVisible(false)
    }
  }

  async function execute(toolName, args = {}) {
    const call = async () => {
      switch (toolName) {
        case 'navigate': {
          const policy = normalizeNavigableUrl(args.url)
          if (!policy.ok) return { ok: false, message: policy.message }
          return actions.navigate(policy.url)
        }
        case 'snapshot':
          return actions.captureSnapshot({ maxChars: args.maxChars })
        case 'click':
          return actions.click({ ref: args.ref, button: args.button, clickCount: args.clickCount })
        case 'type':
          return actions.typeText({ ref: args.ref, text: args.text, submit: args.submit })
        case 'press_key':
          return actions.pressKey({ key: args.key, modifiers: args.modifiers })
        case 'scroll':
          return actions.scroll({ deltaY: args.deltaY })
        case 'wait_for':
          return actions.waitFor({ text: args.text, timeoutMs: args.timeoutMs })
        case 'screenshot':
          return actions.screenshot({ fullPage: args.fullPage })
        case 'evaluate':
          return actions.evaluate({ expression: args.expression, awaitPromise: args.awaitPromise })
        default:
          return { ok: false, message: `Unknown browser tool: ${toolName}` }
      }
    }

    try {
      let result
      try {
        result = await withOperationalView(call)
      } catch (error) {
        // 只有 CDP 会话坏死才值得整套重建后重试；策略拒绝、参数错误等
        // 业务失败会以 { ok: false } 返回，根本不会走到这里。超时路径上
        // CdpClient 已主动断开调试器并可能触发 discardView，这里幂等地
        // 再作废一次，然后从全新视图重试。
        if (!(error instanceof CdpTimeoutError)) throw error
        lastError = `${error.message} — recreating browser view and retrying once`
        emitState()
        discardView()
        result = await withOperationalView(call)
      }
      lastError = result?.ok === false ? result.message : null
      emitState()
      return result
    } catch (error) {
      // 会话坏死时调试器已被 CdpClient 主动断开，这里补一刀把视图作废，
      // 保证下一次调用从全新视图开始，而不是继续在坏会话上排队。
      if (error instanceof CdpTimeoutError) discardView()
      lastError = error instanceof Error ? error.message : String(error)
      emitState()
      return { ok: false, message: lastError }
    }
  }

  function dispose() {
    discardView()
    window = null
  }

  return {
    attachWindow,
    setBounds,
    setVisible,
    suspend,
    resume,
    getState,
    execute,
    dispose,
    /** 测试/诊断用：当前视图是否已创建。 */
    isViewCreated: () => Boolean(view) && !view.webContents.isDestroyed(),
  }
}
