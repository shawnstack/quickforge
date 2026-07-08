import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { GitBranch, GitGraph, Loader2, RefreshCw, Tag, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getGitLog } from '@/components/workspace/workspace-api'
import type { GitLogCommit, GitLogDecoration } from '@/components/workspace/workspace-types'
import { getDateLocale, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export type GitGraphDialogProps = {
  projectId: string
  projectName: string
  onClose: () => void
}

function formatCommitDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(getDateLocale(), {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function decorationClass(decoration: GitLogDecoration) {
  if (decoration.type === 'head') return 'border-amber-500 text-foreground'
  if (decoration.type === 'tag') return 'border-emerald-600 text-emerald-700 dark:text-emerald-300'
  if (decoration.type === 'remote') return 'border-border bg-muted/40 text-muted-foreground'
  return 'border-border bg-muted/30 text-muted-foreground'
}

function CommitDecoration({ decoration }: { decoration: GitLogDecoration }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-lg border px-2 text-xs', decorationClass(decoration))}>
      {decoration.type === 'tag' ? <Tag className="size-3" /> : <GitBranch className="size-3" />}
      <span>{decoration.name}</span>
    </span>
  )
}

function CommitGraphCell({ index, isLast }: { index: number; isLast: boolean }) {
  return (
    <div className="relative flex h-full min-h-14 w-full justify-center" aria-hidden="true">
      {!isLast ? <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-amber-500/20" /> : null}
      {index > 0 ? <div className="absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2 bg-amber-500/20" /> : null}
      <div className={cn('relative z-10 mt-5 rounded-full border bg-background', index === 0 ? 'size-3.5 border-2 border-amber-500/80' : 'size-2.5 border-amber-500/65')} />
    </div>
  )
}

export function GitGraphDialog({ projectId, projectName, onClose }: GitGraphDialogProps) {
  const [commits, setCommits] = useState<GitLogCommit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const payload = await getGitLog(projectId)
      setCommits(payload.commits)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('gitGraphFailed'))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const rows = useMemo(() => commits, [commits])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6 backdrop-blur-sm" onClick={(event) => event.target === event.currentTarget ? onClose() : undefined}>
      <div className="flex h-[78vh] w-[86vw] max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-quickforge">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] px-5">
          <GitGraph className="size-5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-medium text-foreground">{t('gitGraph')}</div>
            <div className="truncate text-xs text-muted-foreground">{projectName}</div>
          </div>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => void refresh()} aria-label={t('refresh')} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label={t('close')}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="grid shrink-0 grid-cols-[72px_minmax(360px,1fr)_160px_140px_120px] border-b-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-muted/20 text-sm font-medium text-muted-foreground">
          <div className="border-r-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] px-5 py-3">{t('graphColumn')}</div>
          <div className="border-r-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] px-5 py-3">{t('description')}</div>
          <div className="border-r-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] px-5 py-3">{t('date')}</div>
          <div className="border-r-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] px-5 py-3">{t('author')}</div>
          <div className="px-5 py-3">{t('commit')}</div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span>{t('loading')}</span>
            </div>
          ) : error ? (
            <div className="m-5 rounded-2xl border border-border bg-muted/30 p-5 text-sm text-muted-foreground">{error}</div>
          ) : rows.length === 0 ? (
            <div className="m-5 rounded-2xl border border-border bg-muted/30 p-5 text-sm text-muted-foreground">{t('noGitCommits')}</div>
          ) : rows.map((commit, index) => {
            const highlighted = commit.decorations.some((decoration) => decoration.type === 'head' || decoration.name === 'HEAD')
            return (
              <div
                key={commit.hash}
                className={cn(
                  'grid min-h-14 grid-cols-[72px_minmax(360px,1fr)_160px_140px_120px] border-b-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] text-sm',
                  highlighted ? 'bg-muted/28' : 'bg-background',
                )}
              >
                <CommitGraphCell index={index} isLast={index === rows.length - 1} />
                <div className="flex min-w-0 items-center gap-2 px-5 py-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {commit.decorations.map((decoration) => <CommitDecoration key={`${commit.hash}:${decoration.type}:${decoration.name}`} decoration={decoration} />)}
                    <span className="min-w-0 break-words text-foreground/90">{commit.subject}</span>
                  </div>
                </div>
                <div className="flex items-center border-l-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] px-5 py-3 text-muted-foreground">{formatCommitDate(commit.date)}</div>
                <div className="flex min-w-0 items-center border-l-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] px-5 py-3 text-muted-foreground">
                  <span className="truncate">{commit.author}</span>
                </div>
                <div className="flex items-center border-l-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] px-5 py-3 font-mono text-muted-foreground">{commit.shortHash}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
