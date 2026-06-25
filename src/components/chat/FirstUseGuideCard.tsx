import { Bot, FolderPlus, MessageSquareText, Settings2, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'

type FirstUseGuideCardProps = {
  hasProject: boolean
  onConfigureModel: () => void
  onAddProject: () => void
  onCopyExamplePrompt: () => void
  onDismiss: () => void
}

export function FirstUseGuideCard({
  hasProject,
  onConfigureModel,
  onAddProject,
  onCopyExamplePrompt,
  onDismiss,
}: FirstUseGuideCardProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/35 p-3 backdrop-blur-sm sm:p-6">
      <div className="pointer-events-auto w-full max-w-4xl rounded-2xl border border-border bg-background/95 p-5 shadow-quickforge backdrop-blur-md sm:p-6">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Bot className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-foreground sm:text-lg">{t('firstUseGuideTitle')}</h2>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{t('firstUseGuideDescription')}</p>
              </div>
              <Button variant="ghost" size="icon" className="-mr-1 -mt-1 size-7 shrink-0" onClick={onDismiss} aria-label={t('firstUseGuideDismiss')}>
                <X className="size-4" />
              </Button>
            </div>

            <div className="mt-4 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
              <div className="flex gap-2.5 rounded-xl border border-border/70 bg-muted/15 p-3">
                <Settings2 className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{t('firstUseGuideStepModel')}</span>
              </div>
              <div className="flex gap-2.5 rounded-xl border border-border/70 bg-muted/15 p-3">
                <FolderPlus className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{t('firstUseGuideStepProject')}</span>
              </div>
              <div className="flex gap-2.5 rounded-xl border border-border/70 bg-muted/15 p-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{t('firstUseGuideStepPlan')}</span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2.5">
              <Button size="sm" onClick={onConfigureModel}>
                <Settings2 className="size-4" />
                {t('firstUseGuideConfigureModel')}
              </Button>
              <Button size="sm" variant={hasProject ? 'outline' : 'default'} onClick={onAddProject}>
                <FolderPlus className="size-4" />
                {t('firstUseGuideAddProject')}
              </Button>
              <Button size="sm" variant="outline" onClick={onCopyExamplePrompt}>
                <MessageSquareText className="size-4" />
                {t('firstUseGuideCopyPrompt')}
              </Button>
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                {t('firstUseGuideDismiss')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
