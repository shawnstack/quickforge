import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'

export type StartupError = {
  message: string
  detail?: string
}

/** 本地服务不可用时的整屏错误页（原 MainApp 内联块）。
 *  提供重试（走 bootstrap 的 retry）与整页刷新两条出路。 */
export function StartupErrorScreen({ startupError, onRetry }: { startupError: StartupError; onRetry: () => void }) {
  return (
    <div className="flex h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-md rounded-lg border border-border bg-background p-5 text-center">
        <h1 className="text-base font-semibold">{t('localServiceUnavailableTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{startupError.message}</p>
        {startupError.detail ? (
          <p className="mt-2 whitespace-pre-wrap break-all text-left text-xs text-muted-foreground">{startupError.detail}</p>
        ) : null}
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t('retry')}
          </Button>
          <Button variant="default" size="sm" onClick={() => window.location.reload()}>
            {t('reloadPage')}
          </Button>
        </div>
      </div>
    </div>
  )
}
