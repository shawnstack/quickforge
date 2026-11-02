const { contextBridge, ipcRenderer } = require('electron')

const NOTIFICATION_REQUEST_CHANNEL = 'quickforge:desktop-notification-request'
const NOTIFICATION_OPEN_SESSION_CHANNEL = 'quickforge:desktop-notification-open-session'
const BROWSER_REQUEST_CHANNEL = 'quickforge:desktop-browser-request'
const BROWSER_STATE_CHANNEL = 'quickforge:desktop-browser-state'

contextBridge.exposeInMainWorld('QuickForgeDesktopNotifications', {
  isSupported() {
    return ipcRenderer.invoke(NOTIFICATION_REQUEST_CHANNEL, { type: 'is-supported' })
  },
  show(payload) {
    return ipcRenderer.invoke(NOTIFICATION_REQUEST_CHANNEL, {
      type: 'show',
      payload: {
        title: payload?.title,
        body: payload?.body,
        ...(payload?.sessionId === undefined ? {} : { sessionId: payload.sessionId }),
      },
    })
  },
  onOpenSession(callback) {
    if (typeof callback !== 'function') throw new TypeError('callback must be a function')
    const listener = (_event, sessionId) => {
      if (typeof sessionId === 'string') callback(sessionId)
    }
    ipcRenderer.on(NOTIFICATION_OPEN_SESSION_CHANNEL, listener)
    return () => {
      ipcRenderer.removeListener(NOTIFICATION_OPEN_SESSION_CHANNEL, listener)
    }
  },
})

// 内嵌 AI 浏览器桥：只暴露「报告这块区域的位置」和「显示/隐藏」两件事。
// 浏览器本身在主进程里，渲染进程既拿不到 webContents，也拿不到网页内容。
contextBridge.exposeInMainWorld('QuickForgeDesktopBrowser', {
  isAvailable() {
    return ipcRenderer.invoke(BROWSER_REQUEST_CHANNEL, { type: 'is-available' })
  },
  getState() {
    return ipcRenderer.invoke(BROWSER_REQUEST_CHANNEL, { type: 'get-state' })
  },
  setBounds(rect) {
    return ipcRenderer.invoke(BROWSER_REQUEST_CHANNEL, {
      type: 'set-bounds',
      rect: {
        x: Number(rect?.x),
        y: Number(rect?.y),
        width: Number(rect?.width),
        height: Number(rect?.height),
      },
    })
  },
  setVisible(visible) {
    return ipcRenderer.invoke(BROWSER_REQUEST_CHANNEL, { type: 'set-visible', visible: Boolean(visible) })
  },
  onStateChange(callback) {
    if (typeof callback !== 'function') throw new TypeError('callback must be a function')
    const listener = (_event, state) => {
      if (state && typeof state === 'object') callback(state)
    }
    ipcRenderer.on(BROWSER_STATE_CHANNEL, listener)
    return () => {
      ipcRenderer.removeListener(BROWSER_STATE_CHANNEL, listener)
    }
  },
})
