import { t } from '@/lib/i18n'

/**
 * Web Locks 单窗口拦截页：仅在被 blocked 的窗口渲染（不加载 App、不发任何
 * /api 请求），纯静态提示用户关闭本窗口并回到已有窗口使用（浏览器不允许
 * 脚本关闭手动打开的标签页，故不提供关闭按钮）。
 */
export function WindowGuardNotice() {
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
      </div>
    </div>
  )
}
