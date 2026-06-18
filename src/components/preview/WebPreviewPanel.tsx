import { Globe2, PanelRightClose } from 'lucide-react'
import type { ProjectInfo } from '@/lib/types'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { WebPreviewContent } from './WebPreviewContent'

type WebPreviewPanelProps = {
  project?: ProjectInfo
  url: string
  onUrlChange: (url: string) => void
  onOpenChange: (open: boolean) => void
}

export function WebPreviewPanel({ project, url, onUrlChange, onOpenChange }: WebPreviewPanelProps) {
  return (
    <aside className="hidden w-[440px] min-w-[320px] max-w-[560px] shrink-0 overflow-hidden flex-col border-l border-border bg-background lg:flex">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        <Globe2 className="size-4 text-sky-600 dark:text-sky-500" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground/90">{t('webPreview')}</div>
          <div className="truncate text-xs text-muted-foreground/65">{project?.name ?? t('noProjectSelected')}</div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label={t('closeWebPreview')} title={t('closeWebPreview')}>
          <PanelRightClose className="size-4" />
        </Button>
      </div>
      <WebPreviewContent url={url} onUrlChange={onUrlChange} />
    </aside>
  )
}
