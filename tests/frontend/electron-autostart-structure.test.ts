import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const preloadSource = readFileSync(new URL('../../desktop/electron-preload.cjs', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('../../desktop/electron-main.mjs', import.meta.url), 'utf8')
const aboutSource = readFileSync(new URL('../../src/components/settings/tabs/AboutSettingsTab.tsx', import.meta.url), 'utf8')

function mainFunction(name: string) {
  return mainSource.match(new RegExp(`function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
}

describe('Electron autostart security structure', () => {
  it('exposes only a narrow autostart bridge that cannot name a program', () => {
    expect(preloadSource).toContain("contextBridge.exposeInMainWorld('QuickForgeDesktopAutostart'")
    expect(preloadSource).toContain("ipcRenderer.invoke(AUTOSTART_REQUEST_CHANNEL, { type: 'get-state' })")
    expect(preloadSource).toContain("ipcRenderer.invoke(AUTOSTART_REQUEST_CHANNEL, { type: 'set-enabled', enabled: Boolean(enabled) })")
    expect(preloadSource).not.toContain('ipcRenderer.send(')
    // 登录项的参数、路径、注册表细节一律留在主进程：preload 出现这些字眼就说明
    // 「让某个程序开机自启」的能力漏到了页面手上。
    expect(preloadSource).not.toContain('openAtLogin')
    expect(preloadSource).not.toContain('setLoginItemSettings')
    expect(preloadSource).not.toMatch(/exposeInMainWorld\([^,]+,\s*ipcRenderer/)
  })

  it('routes autostart through a validated, idempotent main-process handler', () => {
    const handler = mainFunction('registerDesktopAutostartHandler')
    expect(handler).toContain('if (autostartHandlerInitialized) return')
    expect(handler).toContain('isMainWindowMainFrame(event.senderFrame)')
    expect(handler).toContain('parseAutostartRequest(request)')
    expect(mainSource).toContain('registerDesktopAutostartHandler()')

    // 读写登录项都必须走 contract 的 path/args 推导：无参调用在 Windows 上匹配不到
    // 带 --hidden 的那一条，开关会点完自己弹回去。
    expect(mainSource).toContain('buildLoginItemQuery({ platform: process.platform')
    expect(mainSource).toContain('buildLoginItemSettings({')
    expect(mainSource).not.toContain('app.getLoginItemSettings()')
    expect(mainSource).not.toContain('app.setLoginItemSettings({ openAtLogin')

    const write = mainFunction('writeAutostartEnabled')
    expect(write).toContain('readAutostartState()')

    // 开发模式的 execPath 是 electron.exe，写进登录项会在开机时拉起一个空壳 Electron。
    expect(mainSource).toContain('isAutostartSupported() && app.isPackaged')
  })

  it('keeps the login-launched process in the tray instead of popping a window', () => {
    expect(mainSource).toContain('startHidden = resolveStartHidden()')
    const readyToShow = mainSource.match(/mainWindow\.once\('ready-to-show', \(\) => \{([\s\S]*?)\n {2}\}\)/)?.[1] ?? ''
    expect(readyToShow).toContain('if (startHidden)')
    expect(readyToShow).toContain('mainWindow?.show()')
  })

  it('shows the switch only on supported desktops and explains why otherwise', () => {
    expect(aboutSource).toContain("import { useDesktopAutostart } from '@/hooks/useDesktopAutostart'")
    expect(aboutSource).toContain('useDesktopAutostart({ active })')
    expect(aboutSource).toContain('{desktopApp ? (')
    expect(aboutSource).toContain('{autostart.loading || autostart.state.supported ? (')
    expect(aboutSource).toContain('launchAtStartupUnsupported')
    expect(aboutSource).toContain('disabled={autostart.loading || autostart.saving}')
    expect(aboutSource).toContain('onChange={(checked) => void autostart.setEnabled(checked)}')
  })
})
