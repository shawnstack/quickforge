import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const created = { views: [], sessions: [] }

  function makeDebugger() {
    return {
      attached: false,
      listeners: new Map(),
      isAttached() { return this.attached },
      attach() { this.attached = true; return true },
      detach() { this.attached = false },
      on(name, handler) { this.listeners.set(name, handler) },
      async sendCommand() { return {} },
    }
  }

  class FakeWebContents {
    constructor() {
      this.destroyed = false
      this.closed = false
      this.url = 'about:blank'
      this.title = ''
      this.windowOpenHandler = null
      this.events = new Map()
      this.debugger = makeDebugger()
    }
    isDestroyed() { return this.destroyed }
    getURL() { return this.url }
    getTitle() { return this.title }
    setWindowOpenHandler(handler) { this.windowOpenHandler = handler }
    on(name, handler) {
      const list = this.events.get(name) || []
      list.push(handler)
      this.events.set(name, list)
    }
    emit(name, payload) { (this.events.get(name) || []).forEach((h) => h(payload)) }
    close() { this.closed = true }
  }

  class FakeWebContentsView {
    constructor(options) {
      this.options = options
      this.webContents = new FakeWebContents()
      this.bounds = null
      this.visible = true
      this.visibilityLog = []
      created.views.push(this)
    }
    setBackgroundColor() {}
    setBounds(rect) { this.bounds = rect }
    setVisible(value) { this.visible = value; this.visibilityLog.push(value) }
  }

  const session = {
    fromPartition(partition) {
      const entry = { partition, listeners: new Map(), permissionRequest: null, permissionCheck: null, displayMedia: null }
      entry.setPermissionRequestHandler = (handler) => { entry.permissionRequest = handler }
      entry.setPermissionCheckHandler = (handler) => { entry.permissionCheck = handler }
      entry.setDisplayMediaRequestHandler = (handler) => { entry.displayMedia = handler }
      entry.on = (name, handler) => { entry.listeners.set(name, handler) }
      created.sessions.push(entry)
      return entry
    },
  }

  return { created, session, WebContentsView: FakeWebContentsView }
})

vi.mock('electron', () => ({ WebContentsView: electron.WebContentsView, session: electron.session }))

const { createBrowserHost } = await import('../../desktop/browser/browser-host.mjs')

function makeWindow({ width = 1200, height = 800 } = {}) {
  const children = []
  return {
    children,
    isDestroyed: () => false,
    getContentSize: () => [width, height],
    contentView: {
      addChildView: (view) => children.push(view),
      removeChildView: (view) => {
        const index = children.indexOf(view)
        if (index >= 0) children.splice(index, 1)
      },
    },
  }
}

function createHost() {
  const states = []
  const host = createBrowserHost({ onStateChange: (state) => states.push(state) })
  const win = makeWindow()
  host.attachWindow(win)
  return { host, win, states }
}

const latestView = () => electron.created.views[electron.created.views.length - 1]

describe('desktop browser host', () => {
  it('creates the native view lazily and reuses it', async () => {
    electron.created.views.length = 0
    const { host } = createHost()
    host.setBounds({ x: 10, y: 10, width: 300, height: 200 })
    expect(electron.created.views).toHaveLength(0)
    const first = await host.execute('unknown_tool')
    expect(first.ok).toBe(false)
    expect(electron.created.views).toHaveLength(1)
    await host.execute('unknown_tool')
    expect(electron.created.views).toHaveLength(1)
  })

  it('clamps reported bounds into the window content area', async () => {
    electron.created.views.length = 0
    const { host } = createHost()
    await host.execute('unknown_tool')
    host.setBounds({ x: -5, y: -5, width: 10, height: 10 })
    expect(latestView().bounds).toEqual({ x: 0, y: 0, width: 120, height: 120 })
    host.setBounds({ x: 100, y: 100, width: 5000, height: 5000 })
    expect(latestView().bounds).toEqual({ x: 100, y: 100, width: 1100, height: 700 })
  })

  it('shows and hides the native view on demand', async () => {
    electron.created.views.length = 0
    const { host } = createHost()
    await host.execute('unknown_tool')
    host.setVisible(true)
    expect(latestView().visible).toBe(true)
    host.setVisible(false)
    expect(latestView().visible).toBe(false)
    expect(host.getState().visible).toBe(false)
  })

  it('keeps the requested visibility across window hide and show', async () => {
    electron.created.views.length = 0
    const { host } = createHost()
    await host.execute('unknown_tool')
    host.setVisible(true)
    host.suspend()
    expect(latestView().visible).toBe(false)
    host.resume()
    expect(latestView().visible).toBe(true)
    host.setVisible(false)
    host.suspend()
    host.resume()
    expect(latestView().visible).toBe(false)
  })

  it('rejects navigation the policy forbids without touching the page', async () => {
    electron.created.views.length = 0
    const { host } = createHost()
    await host.execute('unknown_tool')
    const view = latestView()
    const before = view.webContents.url
    const result = await host.execute('navigate', { url: 'http://127.0.0.1:5177' })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('policy')
    expect(view.webContents.url).toBe(before)
    expect(host.getState().error).toContain('policy')
  })

  it('forces the view visible while an action runs then restores it', async () => {
    electron.created.views.length = 0
    const { host } = createHost()
    await host.execute('unknown_tool')
    const view = latestView()
    host.setVisible(false)
    view.visibilityLog.length = 0
    const result = await host.execute('snapshot')
    expect(result.nodeCount).toBe(0)
    expect(view.visibilityLog).toEqual([true, false])
    expect(view.visible).toBe(false)
  })

  it('denies permissions, new windows and downloads in the browser session', async () => {
    electron.created.views.length = 0
    electron.created.sessions.length = 0
    const { host } = createHost()
    await host.execute('unknown_tool')
    const ses = electron.created.sessions[0]
    const callback = vi.fn()
    ses.permissionRequest(null, 'media', callback)
    expect(callback).toHaveBeenCalledWith(false)
    expect(ses.permissionCheck()).toBe(false)
    expect(latestView().webContents.windowOpenHandler()).toEqual({ action: 'deny' })
    const download = { preventDefault: vi.fn() }
    ses.listeners.get('will-download')(download)
    expect(download.preventDefault).toHaveBeenCalled()
  })

  it('disposes the view, detaches the debugger and forgets the window', async () => {
    electron.created.views.length = 0
    const { host, win } = createHost()
    await host.execute('snapshot')
    const view = latestView()
    expect(view.webContents.debugger.isAttached()).toBe(true)
    host.dispose()
    expect(view.webContents.debugger.isAttached()).toBe(false)
    expect(view.webContents.closed).toBe(true)
    expect(win.children).toHaveLength(0)
    expect(host.isViewCreated()).toBe(false)
    expect(host.getState().visible).toBe(false)
  })

  it('discards the view when the renderer process dies and rebuilds on the next call', async () => {
    electron.created.views.length = 0
    const { host, win } = createHost()
    await host.execute('snapshot')
    const first = latestView()
    expect(win.children).toHaveLength(1)
    first.webContents.emit('render-process-gone', { reason: 'crashed' })
    expect(host.isViewCreated()).toBe(false)
    expect(first.webContents.closed).toBe(true)
    expect(win.children).toHaveLength(0)
    expect(host.getState().error).toContain('Browser renderer exited')
    const result = await host.execute('snapshot')
    expect(result.nodeCount).toBe(0)
    expect(electron.created.views).toHaveLength(2)
    expect(latestView()).not.toBe(first)
    expect(win.children).toHaveLength(1)
  })

  it('discards the view when the debugger is externally detached and rebuilds on the next call', async () => {
    electron.created.views.length = 0
    const { host } = createHost()
    await host.execute('snapshot')
    const first = latestView()
    first.webContents.debugger.attached = false
    first.webContents.debugger.listeners.get('detach')({}, 'target closed')
    expect(host.isViewCreated()).toBe(false)
    expect(host.getState().error).toContain('Debugger detached')
    const result = await host.execute('snapshot')
    expect(result.nodeCount).toBe(0)
    expect(electron.created.views).toHaveLength(2)
  })

  it('recreates the view and retries once when the first CDP command times out', async () => {
    vi.useFakeTimers()
    try {
      electron.created.views.length = 0
      const { host } = createHost()
      // 第一个视图的调试器挂起所有命令；超时熔断后宿主应整套重建并重试成功。
      let hungCommand = null
      const hook = (view) => {
        view.webContents.debugger.sendCommand = (method, params) =>
          new Promise((resolve, reject) => { hungCommand = reject })
      }
      const pending = host.execute('snapshot')
      // 微任务推进到视图已创建后挂钩。
      await Promise.resolve()
      hook(electron.created.views[0])
      const assertion = expect(pending).resolves.toMatchObject({ nodeCount: 0 })
      await vi.advanceTimersByTimeAsync(31000)
      await assertion
      expect(electron.created.views.length).toBe(2)
      expect(latestView().webContents.closed).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
