import { Check, Copy, MessageSquare, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { MarkdownReader } from './MarkdownReader'
import { MonacoCodeViewer } from './MonacoCodeViewer'
import { MonacoDiffViewer } from './MonacoDiffViewer'
import { countDiffLines } from './diff-line-counts'
import type { GitFileDiffResponse, WorkspaceFileResponse } from './workspace-types'
import { t } from '@/lib/i18n'

type WorkspaceReaderDialogProps = {
  open: boolean
  mode: 'file' | 'diff'
  file?: WorkspaceFileResponse
  diff?: GitFileDiffResponse
  loading?: boolean
  error?: string
  onOpenChange: (open: boolean) => void
  onDraftRequest?: (text: string) => void
}

function formatBytes(value: number) {
  if (!Number.isFinite(value)) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function statusText(diff?: GitFileDiffResponse) {
  if (!diff) return ''
  if (diff.status === 'added') return t('workspaceStatusAdded')
  if (diff.status === 'deleted') return t('workspaceStatusDeleted')
  if (diff.status === 'renamed') return t('workspaceStatusRenamed')
  if (diff.status === 'untracked') return t('workspaceStatusUntracked')
  return t('workspaceStatusModified')
}

function isMarkdownFile(file?: WorkspaceFileResponse) {
  if (!file) return false
  return file.language === 'markdown' || /\.(md|markdown)$/i.test(file.path)
}

function filePrompt(path: string, markdown = false) {
  if (markdown) {
    return t('readerFileMarkdownPrompt', { path })
  }
  return t('readerFilePrompt', { path })
}

function diffPrompt(path: string) {
  return t('readerDiffPrompt', { path })
}

function diffText(diff: GitFileDiffResponse) {
  const header = diff.oldPath ? `${diff.oldPath} -> ${diff.path}` : diff.path
  return `Diff for ${header}\n\n--- OLD\n${diff.oldContent}\n\n--- NEW\n${diff.newContent}`
}

export function WorkspaceReaderDialog({ open, mode, file, diff, loading, error, onOpenChange, onDraftRequest }: WorkspaceReaderDialogProps) {
  const [copied, setCopied] = useState<'path' | 'content'>()
  const [markdownMode, setMarkdownMode] = useState<'preview' | 'source'>('preview')

  async function copyToClipboard(kind: 'path' | 'content', value?: string) {
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopied(kind)
    window.setTimeout(() => setCopied(undefined), 1200)
  }

  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onOpenChange, open])

  const diffStats = useMemo(
    () => (mode === 'diff' && diff ? countDiffLines(diff.oldContent, diff.newContent) : undefined),
    [mode, diff],
  )

  if (!open) return null

  const title = mode === 'file' ? file?.path : diff?.path
  const isMarkdown = mode === 'file' && isMarkdownFile(file)
  const copyableContent = mode === 'file' ? file?.content : diff ? diffText(diff) : undefined
  const aiPrompt = mode === 'file' && file ? filePrompt(file.path, isMarkdown) : mode === 'diff' && diff ? diffPrompt(diff.path) : undefined
  const subtitle = mode === 'file' && file
    ? `${file.language} · ${formatBytes(file.size)}`
    : mode === 'diff' && diff
      ? `${statusText(diff)} · ${diff.language}`
      : ''

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/65 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label={t('close')}
        onClick={() => onOpenChange(false)}
      />
      <div className="relative flex h-[min(88vh,900px)] w-[min(92vw,1280px)] min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-quickforge">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground/90">{title ?? (mode === 'file' ? 'Code reader' : 'Diff reader')}</div>
            {subtitle ? <div className="truncate text-xs text-muted-foreground/65">{subtitle}</div> : null}
          </div>
          {isMarkdown ? (
            <div className="inline-flex shrink-0 rounded-full bg-muted/25 p-1 text-xs">
              {(['preview', 'source'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={item === markdownMode
                    ? 'rounded-full bg-background px-3 py-1 font-medium text-foreground/90 shadow-[0_8px_20px_-16px_rgb(15_23_42_/_0.42)]'
                    : 'rounded-full px-3 py-1 text-muted-foreground/70 hover:text-foreground/85'}
                  onClick={() => setMarkdownMode(item)}
                >
                  {item === 'preview' ? t('markdownPreview') : t('markdownSource')}
                </button>
              ))}
            </div>
          ) : null}
          {diffStats ? (
            <span className="shrink-0 font-mono text-xs font-medium">
              <span className="text-emerald-600 dark:text-emerald-400">+{diffStats.added}</span>
              <span className="ml-1.5 text-red-600 dark:text-red-400">-{diffStats.removed}</span>
            </span>
          ) : null}
          <Button variant="ghost" size="icon" onClick={() => void copyToClipboard('path', title)} disabled={!title} aria-label={t('copyPath')} title={t('copyPath')}>
            {copied === 'path' ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => void copyToClipboard('content', copyableContent)} disabled={!copyableContent} aria-label={t('copyContent')} title={mode === 'file' ? t('copyContent') : t('copyDiffContent')}>
            {copied === 'content' ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => aiPrompt && onDraftRequest?.(aiPrompt)} disabled={!aiPrompt || !onDraftRequest} aria-label={t('askAiAboutThis')} title={t('askAiAboutThis')}>
            <MessageSquare className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label={t('close')} title={t('close')}>
            <X className="size-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 bg-background">
          {loading ? <div className="p-4 text-sm text-muted-foreground/70">{t('openingReader')}</div> : null}
          {!loading && error ? <div className="p-4 text-sm text-destructive">{error}</div> : null}
          {!loading && !error && mode === 'file' && file ? (
            isMarkdown ? (
              <MarkdownReader key={file.path} path={file.path} content={file.content} language={file.language} mode={markdownMode} />
            ) : (
              <MonacoCodeViewer path={file.path} content={file.content} language={file.language} />
            )
          ) : null}
          {!loading && !error && mode === 'diff' && diff ? (
            <MonacoDiffViewer
              path={diff.path}
              oldContent={diff.oldContent}
              newContent={diff.newContent}
              language={diff.language}
              status={diff.status}
            />
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
