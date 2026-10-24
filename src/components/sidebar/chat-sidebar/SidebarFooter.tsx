import { DownloadCloud, Server, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import {
  iconSlotClass,
  inactiveRowClass,
  sidebarFooterRowClass,
  sidebarSessionTitleClass,
} from './sidebar-classes'

/** 侧栏底部：版本更新横幅（可暂缓）、远程服务器入口、设置。 */
export function SidebarFooter({
  sidebarOpen,
  updateAvailable,
  latestVersion,
  currentVersion,
  onOpenUpdate,
  onDismissUpdate,
  currentServerUrl,
  currentServerAlias,
  onOpenServer,
  onOpenSettings,
}: {
  sidebarOpen: boolean
  updateAvailable?: boolean
  latestVersion?: string
  currentVersion?: string
  onOpenUpdate?: () => void
  onDismissUpdate?: () => void
  currentServerUrl?: string
  currentServerAlias?: string
  onOpenServer?: () => void
  onOpenSettings: () => void
}) {
  const footerRowClass = sidebarFooterRowClass(sidebarOpen)

  return (
    <div className="mt-auto shrink-0 border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-3 py-3">
      {updateAvailable && latestVersion ? (
        <button
          type="button"
          className={cn(
            footerRowClass,
            'relative mb-2 w-full border bg-primary/5 text-primary',
          )}
          onClick={onOpenUpdate}
          aria-label={t('newVersionAvailable', { version: latestVersion })}
          title={t('newVersionAvailable', { version: latestVersion })}
        >
          <span className={cn(iconSlotClass, '')}>
            <DownloadCloud className="size-4" />
          </span>
          {sidebarOpen ? (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium leading-tight">
                {t('newVersionAvailable', { version: latestVersion })}
              </span>
              {currentVersion ? (
                <span className="block truncate text-[11px] leading-tight">
                  {t('newVersionAvailableSub', { current: currentVersion })}
                </span>
              ) : null}
            </span>
          ) : null}
          {sidebarOpen && onDismissUpdate ? (
            <span
              className="shrink-0 rounded-full px-1.5 py-0.5 text-[11px] transition-colors"
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation()
                onDismissUpdate()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.stopPropagation()
                  event.preventDefault()
                  onDismissUpdate()
                }
              }}
            >
              {t('updateLater')}
            </span>
          ) : null}
          {!sidebarOpen ? (
            <span className="absolute right-1 top-1 size-2 rounded-full bg-primary" />
          ) : null}
        </button>
      ) : null}
      {currentServerUrl && onOpenServer ? (
        <button
          type="button"
          className={cn(footerRowClass, 'min-h-9 w-full shrink-0 rounded-lg', inactiveRowClass)}
          onClick={onOpenServer}
          aria-label={currentServerAlias ? `${currentServerAlias}（${currentServerUrl}）` : currentServerUrl}
          title={currentServerUrl}
        >
          <span className={iconSlotClass}>
            <Server className="size-4" />
          </span>
          {sidebarOpen ? (
            currentServerAlias ? (
              <span className={cn(sidebarSessionTitleClass, 'min-w-0 flex-1')}>{currentServerAlias}</span>
            ) : (
              <span className={cn(sidebarSessionTitleClass, 'min-w-0 flex-1')}>{currentServerUrl}</span>
            )
          ) : null}
        </button>
      ) : null}
      <button
        type="button"
        className={cn(footerRowClass, 'min-h-9 w-full shrink-0 rounded-lg', inactiveRowClass)}
        onClick={onOpenSettings}
        aria-label={t('settings')}
        title={t('settings')}
      >
        <span className={iconSlotClass}>
          <Settings className="size-4" />
        </span>
        {sidebarOpen ? <span className={sidebarSessionTitleClass}>{t('settings')}</span> : null}
      </button>
    </div>
  )
}
