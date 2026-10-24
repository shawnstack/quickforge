import { useCallback, useEffect, useState } from 'react'

const QUICKFORGE_RELEASES_URL = 'https://github.com/shawnstack/quickforge/releases/latest'

/** 桌面端标题栏菜单（Windows 标题栏 / macOS 菜单栏左侧入口）：
 *  开合状态 + 关于/检查更新/退出三个动作，任意处点击或窗口失焦自动收起。 */
export function useDesktopTitlebarMenu({ openAboutSettings }: { openAboutSettings: () => void }) {
  const [desktopTitlebarMenuOpen, setDesktopTitlebarMenuOpen] = useState(false)
  const closeDesktopTitlebarMenu = useCallback(() => setDesktopTitlebarMenuOpen(false), [])
  const openDesktopUpdatePage = useCallback(() => {
    setDesktopTitlebarMenuOpen(false)
    window.open(QUICKFORGE_RELEASES_URL, '_blank', 'noopener,noreferrer')
  }, [])
  const exitDesktopApp = useCallback(() => {
    setDesktopTitlebarMenuOpen(false)
    window.open('quickforge://exit', '_blank', 'noopener,noreferrer')
  }, [])
  const openDesktopAbout = useCallback(() => {
    setDesktopTitlebarMenuOpen(false)
    openAboutSettings()
  }, [openAboutSettings])

  useEffect(() => {
    if (!desktopTitlebarMenuOpen) return
    window.addEventListener('click', closeDesktopTitlebarMenu)
    window.addEventListener('blur', closeDesktopTitlebarMenu)
    return () => {
      window.removeEventListener('click', closeDesktopTitlebarMenu)
      window.removeEventListener('blur', closeDesktopTitlebarMenu)
    }
  }, [closeDesktopTitlebarMenu, desktopTitlebarMenuOpen])

  return {
    desktopTitlebarMenuOpen,
    setDesktopTitlebarMenuOpen,
    closeDesktopTitlebarMenu,
    openDesktopAbout,
    openDesktopUpdatePage,
    exitDesktopApp,
  }
}
