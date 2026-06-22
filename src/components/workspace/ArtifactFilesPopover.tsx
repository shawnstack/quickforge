import { Pin, PinOff, X } from 'lucide-react'
import type { AiTurnArtifact } from '@/lib/tool-artifacts'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { artifactFileName, presentArtifacts } from './artifact-preview-utils'
import { ArtifactFileIcon } from './ArtifactFileIcon'

type ArtifactFilesPopoverProps = {
  artifacts: AiTurnArtifact[]
  activePath?: string
  pinned: boolean
  onPinnedChange: (pinned: boolean) => void
  onSelectPath: (path: string) => void
  onClose: () => void
}

export function ArtifactFilesPopover({ artifacts, activePath, pinned, onPinnedChange, onSelectPath, onClose }: ArtifactFilesPopoverProps) {
  const files = presentArtifacts(artifacts)

  return (
    <div className="absolute left-6 top-4 z-20 w-[380px] max-w-[calc(100%-3rem)] overflow-hidden rounded-2xl border border-border bg-background shadow-[0_18px_60px_-32px_rgb(15_23_42_/_0.35)]">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <div className="min-w-0 text-sm font-medium text-foreground/90">{t('artifactPreview')}</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground/65 transition-colors hover:bg-muted/25 hover:text-foreground/85"
            onClick={() => onPinnedChange(!pinned)}
            aria-label={pinned ? t('artifactPreviewUnpin') : t('artifactPreviewPin')}
            title={pinned ? t('artifactPreviewUnpin') : t('artifactPreviewPin')}
          >
            {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          </button>
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground/65 transition-colors hover:bg-muted/25 hover:text-foreground/85"
            onClick={onClose}
            aria-label={t('close')}
            title={t('close')}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div className="p-3">
        <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">{t('artifacts')}</div>
        {files.length ? (
          <div className="max-h-[360px] space-y-1 overflow-auto">
            {files.map((artifact) => {
              const path = artifact.path
              const active = activePath === path
              const kind = artifact.kind
              return (
                <button
                  key={artifact.id}
                  type="button"
                  className={cn(
                    'flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                    active ? 'bg-muted/28 text-foreground shadow-[0_10px_26px_-20px_rgb(15_23_42_/_0.42)]' : 'text-foreground/82 hover:bg-muted/20 hover:text-foreground',
                  )}
                  onClick={() => onSelectPath(path)}
                >
                  <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <ArtifactFileIcon kind={kind} className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{artifactFileName(path)}</span>
                  <span className="shrink-0 rounded-full bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground/70">{kind}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="px-2 py-4 text-xs text-muted-foreground/70">{t('artifactPreviewEmpty')}</div>
        )}
      </div>
    </div>
  )
}
