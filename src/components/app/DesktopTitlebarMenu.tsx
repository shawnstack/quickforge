import { Info, LogOut, RefreshCw } from 'lucide-react'
import { t } from '@/lib/i18n'

/** 桌面端标题栏左侧入口（Windows 标题栏 / macOS 菜单栏）：logo + 菜单（关于 / 检查更新 / 退出）。
 *  开合状态与动作由 useDesktopTitlebarMenu 提供。 */
export function DesktopTitlebarMenu({
  menuOpen,
  onToggleMenu,
  onOpenAbout,
  onOpenUpdate,
  onExit,
}: {
  menuOpen: boolean
  onToggleMenu: () => void
  onOpenAbout: () => void
  onOpenUpdate: () => void
  onExit: () => void
}) {
  return (
    <div className="quickforge-desktop-titlebar fixed left-0 right-0 top-0 z-40 hidden h-8 items-center px-2">
      <button
        type="button"
        className="quickforge-desktop-titlebar-trigger inline-flex h-8 translate-y-1 items-center gap-2.5 rounded-none px-3 text-[13px] font-medium leading-none transition-colors hover:bg-accent hover:text-accent-foreground"
        onClick={(event) => {
          event.stopPropagation()
          onToggleMenu()
        }}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 64 64" aria-hidden="true">
          <defs>
            <linearGradient id="titlebarIconStroke" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#9ca3af" />
              <stop offset="1" stopColor="#4b5563" />
            </linearGradient>
            <linearGradient id="titlebarIconBolt" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#374151" />
              <stop offset="1" stopColor="#0f172a" />
            </linearGradient>
          </defs>
          <polygon points="32,6 52.78,18 52.78,42 32,54 11.22,42 11.22,18" fill="none" stroke="url(#titlebarIconStroke)" strokeWidth="4.5" strokeLinejoin="round" />
          <path d="M37.2 13 L22 34 L30.6 34 L26.8 50 L42.8 26 L33.8 26 Z" fill="url(#titlebarIconBolt)" />
          <path d="M37.2 13 L22 34 L30.6 34 L33.8 26 Z" fill="#e5e7eb" opacity="0.4" />
        </svg>
        <span>QuickForge</span>
      </button>
      {menuOpen && (
        <div
          className="quickforge-desktop-titlebar-menu absolute left-2 top-8 min-w-40 overflow-hidden rounded-md border border-border bg-popover py-1 text-[13px] text-popover-foreground shadow-lg"
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" className="flex h-8 w-full items-center gap-2.5 px-3 text-left hover:bg-accent hover:text-accent-foreground" role="menuitem" onClick={onOpenAbout}>
            <Info className="size-4" />
            <span>{t('about')}</span>
          </button>
          <button type="button" className="flex h-8 w-full items-center gap-2.5 px-3 text-left hover:bg-accent hover:text-accent-foreground" role="menuitem" onClick={onOpenUpdate}>
            <RefreshCw className="size-4" />
            <span>{t('desktopUpdate')}</span>
          </button>
          <div className="my-1 border-t border-border" />
          <button type="button" className="flex h-8 w-full items-center gap-2.5 px-3 text-left text-destructive hover:bg-destructive/10" role="menuitem" onClick={onExit}>
            <LogOut className="size-4" />
            <span>{t('desktopExit')}</span>
          </button>
        </div>
      )}
    </div>
  )
}
