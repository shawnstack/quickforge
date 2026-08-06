import { Bot, Database, Plus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'

type ModelSetupEmptyStateProps = {
  onAddModel: () => void
  onUseExample: () => void
}

export function ModelSetupEmptyState({ onAddModel, onUseExample }: ModelSetupEmptyStateProps) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-xl border border-border bg-background p-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Bot className="size-6" />
        </div>
        <h2 className="mt-4 text-lg font-medium text-foreground">{t('modelSetupTitle')}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{t('modelSetupDescription')}</p>

        <div className="mt-5 grid gap-3 rounded-xl border border-border bg-muted/20 p-4 text-left text-sm">
          <div className="flex gap-3">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="text-muted-foreground">{t('modelSetupSupports')}</span>
          </div>
          <div className="flex gap-3">
            <Database className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="text-muted-foreground">{t('modelSetupLocalStorage')}</span>
          </div>
        </div>

        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button onClick={onAddModel} className="gap-2">
            <Plus className="size-4" />
            {t('modelSetupAddModel')}
          </Button>
          <Button variant="outline" onClick={onUseExample}>
            {t('modelSetupUseLiteLlmExample')}
          </Button>
        </div>
      </div>
    </div>
  )
}
