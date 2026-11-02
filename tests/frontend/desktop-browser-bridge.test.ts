// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDesktopBrowserBridge, isDesktopBrowserSupported } from '@/lib/desktop-browser-bridge'

type DesktopWindow = Window & { QuickForgeDesktopBrowser?: unknown; __quickforgeDesktopApp?: boolean }

afterEach(() => {
  delete (window as DesktopWindow).QuickForgeDesktopBrowser
  delete (window as DesktopWindow).__quickforgeDesktopApp
  document.body.classList.remove('quickforge-desktop-app')
})

describe('desktop browser bridge', () => {
  it('is unavailable on the web build', () => {
    expect(getDesktopBrowserBridge()).toBeNull()
    expect(isDesktopBrowserSupported()).toBe(false)
  })

  it('normalizes the state payload coming from the main process', async () => {
    const desktopWindow = window as DesktopWindow
    desktopWindow.__quickforgeDesktopApp = true
    desktopWindow.QuickForgeDesktopBrowser = {
      isAvailable: async () => true,
      getState: async () => ({ url: 'https://example.com', title: 'Example', generation: 2, hasSnapshot: true, visible: true, error: null }),
      setBounds: async () => true,
      setVisible: async () => true,
      onStateChange: () => () => {},
    }

    const bridge = getDesktopBrowserBridge()
    expect(bridge).not.toBeNull()
    expect(isDesktopBrowserSupported()).toBe(true)
    expect(await bridge?.getState()).toEqual({
      url: 'https://example.com',
      title: 'Example',
      generation: 2,
      hasSnapshot: true,
      visible: true,
      error: null,
    })
  })

  it('drops malformed state and non-object events instead of rendering junk', async () => {
    const desktopWindow = window as DesktopWindow
    const listeners: Array<(state: unknown) => void> = []
    desktopWindow.QuickForgeDesktopBrowser = {
      isAvailable: async () => true,
      getState: async () => null,
      setBounds: async () => true,
      setVisible: async () => true,
      onStateChange: (callback: (state: unknown) => void) => {
        listeners.push(callback)
        return () => {}
      },
    }

    const bridge = getDesktopBrowserBridge()
    expect(await bridge?.getState()).toBeNull()

    const received: unknown[] = []
    bridge?.onStateChange((state) => received.push(state))
    listeners.forEach((listener) => {
      listener('nonsense')
      listener({ url: 'https://example.com', error: 'boom' })
    })

    expect(received).toEqual([
      { url: 'https://example.com', title: '', generation: 0, hasSnapshot: false, visible: false, error: 'boom' },
    ])
  })

  it('forwards bounds/visibility as-is so the main process stays the single validator', async () => {
    const desktopWindow = window as DesktopWindow
    const setBounds = vi.fn(async () => true)
    const setVisible = vi.fn(async () => true)
    desktopWindow.QuickForgeDesktopBrowser = {
      isAvailable: async () => true,
      getState: async () => null,
      setBounds,
      setVisible,
      onStateChange: () => () => {},
    }

    const bridge = getDesktopBrowserBridge()
    await bridge?.setBounds({ x: 10, y: 20, width: 300, height: 400 })
    await bridge?.setVisible(false)

    expect(setBounds).toHaveBeenCalledWith({ x: 10, y: 20, width: 300, height: 400 })
    expect(setVisible).toHaveBeenCalledWith(false)
  })
})
