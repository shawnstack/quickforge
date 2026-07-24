import { AlertTriangle, Ban, FileQuestion, FileX2, HardDrive, RefreshCw, ServerCrash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'
import type { PreviewIssue } from '@/components/preview/preview-error'

const issuePresentation = {
  'not-found': { icon: FileX2, title: 'previewErrorNotFoundTitle', description: 'previewErrorNotFoundDescription' },
  unsupported: { icon: FileQuestion, title: 'artifactPreviewUnsupported', description: 'artifactPreviewUnsupportedDescription' },
  'too-large': { icon: HardDrive, title: 'previewErrorTooLargeTitle', description: 'previewErrorTooLargeDescription' },
  'permission-denied': { icon: Ban, title: 'previewErrorPermissionTitle', description: 'previewErrorPermissionDescription' },
  'service-failed': { icon: ServerCrash, title: 'previewErrorServiceTitle', description: 'previewErrorServiceDescription' },
  unknown: { icon: AlertTriangle, title: 'previewErrorUnknownTitle', description: 'previewErrorUnknownDescription' },
} as const

type PreviewErrorStateProps = {
  issue: PreviewIssue
  onRetry?: () => void
}

export function PreviewErrorState({ issue, onRetry }: PreviewErrorStateProps) {
  const presentation = issuePresentation[issue.kind]
  const Icon = presentation.icon

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-auto px-8 py-10 text-center">
      <Icon className="size-20 shrink-0 stroke-[1.55] text-muted-foreground/75" />
      <div className="mt-8 text-xl font-semibold tracking-tight text-foreground/88">{t(presentation.title)}</div>
      <div className="mt-4 max-w-md text-base leading-6 text-muted-foreground/82">{t(presentation.description)}</div>

      {issue.retryable && onRetry ? (
        <Button type="button" variant="outline" size="sm" className="mt-6" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          {t('retry')}
        </Button>
      ) : null}

      <details className="mt-6 w-full max-w-xl rounded-xl border border-[color-mix(in_oklab,var(--border)_55%,transparent)] bg-background/65 text-left text-sm text-muted-foreground">
        <summary className="cursor-pointer select-none px-4 py-3 font-medium text-foreground/78 marker:text-muted-foreground">
          {t('previewErrorDetails')}
        </summary>
        <dl className="space-y-3 border-t border-border/60 px-4 py-3">
          {typeof issue.status === 'number' ? (
            <div>
              <dt className="text-xs text-muted-foreground/70">{t('previewErrorStatusCode')}</dt>
              <dd className="mt-1 font-mono text-xs text-foreground/82">{issue.status}</dd>
            </div>
          ) : null}
          {issue.code ? (
            <div>
              <dt className="text-xs text-muted-foreground/70">{t('previewErrorCode')}</dt>
              <dd className="mt-1 break-all font-mono text-xs text-foreground/82">{issue.code}</dd>
            </div>
          ) : null}
          {issue.path ? (
            <div>
              <dt className="text-xs text-muted-foreground/70">{t('previewErrorFilePath')}</dt>
              <dd className="mt-1 break-all font-mono text-xs text-foreground/82">{issue.path}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-muted-foreground/70">{t('previewErrorRawMessage')}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-all font-mono text-xs leading-5 text-foreground/82">{issue.error}</dd>
          </div>
        </dl>
      </details>
    </div>
  )
}
