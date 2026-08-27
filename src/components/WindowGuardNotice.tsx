import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'
import { requestExistingWindowFocus } from '@/lib/window-guard'

type WindowGuardNoticeProps = {
  onSwitchFocus?: () => void
}

/**
 * Web Locks 单窗口拦截页：仅在被 blocked 的窗口渲染（不加载 App、不发任何
 * /api 请求），提示用户回到已有窗口，并可广播 focus 请求把已有窗口带到前台。
 * 点击后立即显示本地提示（不依赖窗口是否真的切换成功），引导用户通过系统
 * 通知或任务栏中的 ● 标记定位已有窗口。
 */
export function WindowGuardNotice({ onSwitchFocus = requestExistingWindowFocus }: WindowGuardNoticeProps) {
  const [switchRequested, setSwitchRequested] = useState(false)

  const handleSwitchFocus = () => {
    onSwitchFocus()
    setSwitchRequested(true)
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-background p-6 text-center shadow-quickforge">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          {/* 层叠窗口图标：内联 SVG，拦截页不依赖 lucide provider */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-6"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6a3 3 0 0 0-3 3v6.5A2.5 2.5 0 0 0 5.5 15" />
          </svg>
        </div>
        <h1 className="mt-4 text-lg font-medium text-foreground">{t('windowGuardTitle')}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('windowGuardDescription')}</p>
        <Button onClick={handleSwitchFocus} className="mt-6">
          {t('windowGuardSwitchButton')}
        </Button>
        {switchRequested && (
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{t('windowGuardSwitchHint')}</p>
        )}
      </div>
    </div>
  )
}
