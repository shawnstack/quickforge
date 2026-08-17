const { contextBridge, ipcRenderer } = require('electron')

const NOTIFICATION_REQUEST_CHANNEL = 'quickforge:desktop-notification-request'
const NOTIFICATION_OPEN_SESSION_CHANNEL = 'quickforge:desktop-notification-open-session'

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
