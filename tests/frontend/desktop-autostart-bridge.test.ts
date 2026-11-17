// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_DESKTOP_AUTOSTART_STATE, getDesktopAutostartBridge, normalizeDesktopAutostartState } from '@/lib/desktop-autostart-bridge'

type DesktopWindow = Window & { QuickForgeDesktopAutostart?: unknown; __quickforgeDesktopApp?: boolean }

afterEach(() => {
  delete (window as DesktopWindow).QuickForgeDesktopAutostart
  delete (window as DesktopWindow).__quickforgeDesktopApp
  document.body.classList.remove('quickforge-desktop-app')
})

function installBridge(bridge: unknown) {
  const desktopWindow = window as DesktopWindow
  desktopWindow.__quickforgeDesktopApp = true
  desktopWindow.QuickForgeDesktopAutostart = bridge
}

describe('desktop autostart bridge', () => {
  it('is unavailable on the web build', () => {
    // 桥对象在浏览器里也可能被别的脚本塞进去（用户脚本、扩展），所以桌面标记才是门禁。
    ;(window as DesktopWindow).QuickForgeDesktopAutostart = {
      getState: async () => ({ supported: true, openAtLogin: true }),
      setEnabled: async () => ({ supported: true, openAtLogin: true }),
    }
    expect(getDesktopAutostartBridge()).toBeNull()
  })

  it('requires both halves of the bridge', () => {
    installBridge({ getState: async () => ({ supported: true, openAtLogin: true }) })
    expect(getDesktopAutostartBridge()).toBeNull()
  })

  it('normalizes the state payload coming from the main process', async () => {
    installBridge({
      getState: async () => ({ supported: true, openAtLogin: true }),
      setEnabled: async () => ({ supported: true, openAtLogin: false }),
    })

    const bridge = getDesktopAutostartBridge()
    expect(bridge).not.toBeNull()
    expect(await bridge?.getState()).toEqual({ supported: true, openAtLogin: true })
    expect(await bridge?.setEnabled(true)).toEqual({ supported: true, openAtLogin: false })
  })

  it('never reports "enabled" on a platform that does not support login items', () => {
    // 主进程在不支持的平台上仍会回 supported: false；残留的 openAtLogin 不能渲染成「已开启」。
    expect(normalizeDesktopAutostartState({ supported: false, openAtLogin: true }))
      .toEqual({ supported: false, openAtLogin: false })
    expect(normalizeDesktopAutostartState({ supported: 'true', openAtLogin: true }))
      .toEqual({ supported: false, openAtLogin: false })
    expect(normalizeDesktopAutostartState(null)).toEqual(DEFAULT_DESKTOP_AUTOSTART_STATE)
    expect(normalizeDesktopAutostartState('on')).toEqual(DEFAULT_DESKTOP_AUTOSTART_STATE)
    expect(normalizeDesktopAutostartState([])).toEqual(DEFAULT_DESKTOP_AUTOSTART_STATE)
  })
})
