import { Code2, ExternalLink, PanelRightClose, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'
import { artifactFileName, inferArtifactKind, workspacePreviewUrl } from './artifact-preview-utils'
import { ArtifactFileIcon } from './ArtifactFileIcon'

type ArtifactPreviewHeaderProps = {
  projectId: string
  path?: string
  onToggleFiles: () => void
  onRefresh: () => void
  onOpenSource: () => void
  onClose: () => void
}

export function ArtifactPreviewHeader({ projectId, path, onToggleFiles, onRefresh, onOpenSource, onClose }: ArtifactPreviewHeaderProps) {
  const kind = path ? inferArtifactKind(path) : 'unknown'

  function openInBrowser() {
    if (!path) return
    window.open(workspacePreviewUrl(projectId, path), '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-3">
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onToggleFiles} aria-label={t('artifactPreviewFiles')} title={t('artifactPreviewFiles')}>
          <PanelRightClose className="size-4 rotate-180" />
        </Button>
        <div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/25 px-3 py-2 text-sm font-medium text-foreground/90">
          <ArtifactFileIcon kind={kind} className="size-4 shrink-0 text-muted-foreground/75" />
          <span className="truncate">{path ? artifactFileName(path) : t('artifactPreview')}</span>
          <button
            type="button"
            className="-mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted/40 hover:text-foreground/85"
            onClick={onClose}
            aria-label={t('close')}
            title={t('close')}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon" onClick={onOpenSource} disabled={!path} aria-label={t('artifactPreviewViewSource')} title={t('artifactPreviewViewSource')}>
          <Code2 className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onRefresh} disabled={!path} aria-label={t('refreshPreview')} title={t('refreshPreview')}>
          <RefreshCw className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={openInBrowser} disabled={!path} aria-label={t('openInBrowser')} title={t('openInBrowser')}>
          <ExternalLink className="size-4" />
        </Button>
      </div>
    </div>
  )
}
