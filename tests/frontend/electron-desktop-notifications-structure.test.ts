import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const preloadSource = readFileSync(new URL('../../desktop/electron-preload.cjs', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('../../desktop/electron-main.mjs', import.meta.url), 'utf8')
const builderSource = readFileSync(new URL('../../desktop/electron-builder.config.cjs', import.meta.url), 'utf8')

describe('Electron desktop notification security structure', () => {
  it('exposes only the narrow notification bridge from the preload', () => {
    expect(preloadSource).toContain("contextBridge.exposeInMainWorld('QuickForgeDesktopNotifications'")
    expect(preloadSource).toContain("ipcRenderer.invoke(NOTIFICATION_REQUEST_CHANNEL")
    expect(preloadSource).toContain("ipcRenderer.on(NOTIFICATION_OPEN_SESSION_CHANNEL")
    expect(preloadSource).toContain('ipcRenderer.removeListener(NOTIFICATION_OPEN_SESSION_CHANNEL, listener)')
    expect(preloadSource).not.toMatch(/exposeInMainWorld\([^,]+,\s*ipcRenderer/)
    expect(preloadSource).not.toContain('ipcRenderer.send(')
  })

  it('keeps BrowserWindow isolated and routes validated native notifications through the main process', () => {
    expect(mainSource).toContain("preload: path.join(__dirname, 'electron-preload.cjs')")
    expect(mainSource).toContain('contextIsolation: true')
    expect(mainSource).toContain('nodeIntegration: false')
    expect(mainSource).toContain('sandbox: true')
    expect(mainSource).toContain("import { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, shell } from 'electron'")
    expect(mainSource).toContain('if (notificationHandlerInitialized) return')
    expect(mainSource).toContain('senderFrame === mainWindow.webContents.mainFrame')
    expect(mainSource).toContain('senderFrame.top === senderFrame')
    expect(mainSource).toContain("payloadKeys.some((key) => !['title', 'body', 'sessionId'].includes(key))")
    expect(mainSource).toContain('maxNotificationTitleLength = 200')
    expect(mainSource).toContain('maxNotificationBodyLength = 2_000')
    expect(mainSource).toContain('maxNotificationSessionIdLength = 512')
    expect(mainSource).toContain('new Notification({ title: payload.title, body: payload.body })')
    expect(mainSource).toContain('activeNotifications.add(notification)')
    expect(mainSource).toMatch(/notification\.once\('click',[\s\S]*showMainWindow\(\)[\s\S]*webContents\.send\(notificationOpenSessionChannel, payload\.sessionId\)/)
    expect(mainSource).toContain("app.setAppUserModelId(appUserModelId)")
    expect(mainSource).toContain("const appUserModelId = 'com.shawnstack.quickforge'")
  })

  it('does not persistently disable the default-on preference while permission is not granted', () => {
    const source = readFileSync(new URL('../../src/lib/default-options-settings-tab.ts', import.meta.url), 'utf8')
    const loadSettingsGuard = source.match(/if \(this\.systemNotificationsEnabled && this\.systemNotificationPermission !== 'granted'\) \{([\s\S]*?)\n\s*\}/)?.[1]

    expect(loadSettingsGuard).toContain('this.systemNotificationsEnabled = false')
    expect(loadSettingsGuard).not.toContain('setSystemNotificationsEnabled(false)')
  })

  it('packages the complete desktop directory including the preload', () => {
    expect(builderSource).toContain("appId: 'com.shawnstack.quickforge'")
    expect(builderSource).toContain("'desktop/**'")
  })
})
