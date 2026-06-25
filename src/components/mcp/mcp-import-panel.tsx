import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { t } from '@/lib/i18n'

type McpImportPanelProps = {
  configText: string
  onConfigTextChange: (text: string) => void
  onImport: (mode: 'merge' | 'replace') => void
  onUseExample: () => void
  saving: boolean
}

export function McpImportPanel({ configText, onConfigTextChange, onImport, onUseExample, saving }: McpImportPanelProps) {
  return (
    <div className="space-y-3 p-3">
      <div className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/90">
        {t('mcpImportConfig')}
        <InfoTip label={t('mcpImportConfigDescription')} />
      </div>
      <textarea
        className="min-h-96 w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-ring"
        value={configText}
        onChange={(event) => onConfigTextChange(event.target.value)}
        spellCheck={false}
      />
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onUseExample} disabled={saving}>{t('mcpUseExample')}</Button>
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={() => onImport('merge')} disabled={saving || !configText.trim()}>
            {saving ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Plus className="mr-1.5 size-3.5" />}
            {t('mcpImportUpdate')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onImport('replace')} disabled={saving || !configText.trim()}>
            {t('mcpReplaceAll')}
          </Button>
        </div>
      </div>
    </div>
  )
}
