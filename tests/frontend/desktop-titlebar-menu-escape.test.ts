// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useDesktopTitlebarMenu } from '../../src/hooks/useDesktopTitlebarMenu'

type TitlebarMenuApi = ReturnType<typeof useDesktopTitlebarMenu>

/**
 * 键盘可达性回归：桌面标题栏菜单打开后，window 上的 keydown Escape 必须收起；
 * 其他按键（Enter）不得误关。此前该 hook 零测试引用，这两条是新守护。
 */
describe('useDesktopTitlebarMenu Escape', () => {
  let container: HTMLDivElement
  let root: Root
  let api: TitlebarMenuApi

  function Harness() {
    // 每次渲染把最新 api 投影给测试断言；Esc 的真身是 effect 挂在 window 的监听。
    api = useDesktopTitlebarMenu({ openAboutSettings: () => {} })
    return null
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(createElement(Harness))
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('closes the open menu on window Escape and stays open for other keys', () => {
    act(() => {
      api.setDesktopTitlebarMenuOpen(true)
    })
    expect(api.desktopTitlebarMenuOpen).toBe(true)

    // 防误关：非 Esc 按键不得把菜单一刀切关闭。
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })
    expect(api.desktopTitlebarMenuOpen).toBe(true)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(api.desktopTitlebarMenuOpen).toBe(false)
  })
})
