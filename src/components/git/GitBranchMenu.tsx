import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch, GitGraph, Loader2, Plus, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { createGitBranch, getGitBranches } from '@/components/workspace/workspace-api'
import type { GitBranchSummary, GitStatusResponse } from '@/components/workspace/workspace-types'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { showPrompt } from '@/components/ui/prompt-dialog'
import { showAlert } from '@/components/ui/confirm-dialog'

export type GitBranchMenuProps = {
  projectId: string
  currentBranch?: string
  dirtyCount?: number
  className?: string
  openChangesClassName?: string
  onCheckout: (branch: string) => Promise<void>
  onCreated?: (status: GitStatusResponse) => void
  onOpenGraph?: () => void
  onOpenChanges?: () => void
}

export function GitBranchMenu({
  projectId,
  currentBranch,
  dirtyCount = 0,
  className,
  openChangesClassName,
  onCheckout,
  onCreated,
  onOpenGraph,
  onOpenChanges,
}: GitBranchMenuProps) {
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [branches, setBranches] = useState<GitBranchSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [busyBranch, setBusyBranch] = useState<string>()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const payload = await getGitBranches(projectId)
      setBranches(payload.branches)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('gitBranchesFailed'))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh()
      searchRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  const visibleBranches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return branches
    return branches.filter((branch) => branch.name.toLowerCase().includes(needle))
  }, [branches, query])

  const handleCheckout = useCallback(async (branch: GitBranchSummary) => {
    if (branch.current || busyBranch) return
    setBusyBranch(branch.name)
    try {
      await onCheckout(branch.name)
      await refresh()
    } finally {
      setBusyBranch(undefined)
    }
  }, [busyBranch, onCheckout, refresh])

  const handleCreateBranch = useCallback(async () => {
    const branch = await showPrompt({
      title: t('createBranchTitle'),
      description: t('createBranchDescription'),
      placeholder: t('createBranchPlaceholder'),
      confirmLabel: t('createAndCheckoutBranch'),
      cancelLabel: t('cancel'),
    })
    if (!branch) return
    setBusyBranch(branch)
    try {
      const status = await createGitBranch(projectId, branch)
      onCreated?.(status)
      await refresh()
    } catch (err) {
      void showAlert(err instanceof Error ? err.message : t('gitCheckoutFailed'))
    } finally {
      setBusyBranch(undefined)
    }
  }, [onCreated, projectId, refresh])

  return (
    <div className={cn('absolute left-0 top-10 z-40 w-[340px] overflow-hidden rounded-2xl border border-border bg-popover shadow-quickforge', className)} onClick={(event) => event.stopPropagation()}>
      <div className="border-b-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchBranches')}
            className="h-10 rounded-xl border-transparent bg-background pl-9 text-sm shadow-none focus-visible:border-border"
          />
        </div>
      </div>

      {onOpenChanges ? (
        <button
          type="button"
          className={cn('flex w-full items-center justify-center gap-2 border-b-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] px-3 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground', openChangesClassName)}
          onClick={onOpenChanges}
        >
          <span>{t('uncommittedChanges')}</span>
          <span>{t('filesCount', { count: dirtyCount })}</span>
        </button>
      ) : null}

      <div className="max-h-[340px] overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span>{t('loading')}</span>
          </div>
        ) : error ? (
          <div className="rounded-xl bg-muted/40 px-3 py-4 text-sm text-muted-foreground">{error}</div>
        ) : visibleBranches.length === 0 ? (
          <div className="rounded-xl bg-muted/40 px-3 py-4 text-sm text-muted-foreground">{t('noBranchesFound')}</div>
        ) : visibleBranches.map((branch) => {
          const active = branch.current || branch.name === currentBranch
          const busy = busyBranch === branch.name
          return (
            <button
              key={`${branch.remote ? 'remote' : 'local'}:${branch.name}`}
              type="button"
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors',
                active ? 'bg-muted text-foreground' : 'text-foreground/88 hover:bg-muted/70',
              )}
              onClick={() => void handleCheckout(branch)}
              disabled={active || Boolean(busyBranch)}
              title={branch.name}
            >
              {busy ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <GitBranch className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground')} />}
              <span className="min-w-0 flex-1 truncate">{branch.name}</span>
              {active ? <span className="text-xs text-muted-foreground">{t('currentBranch')}</span> : null}
            </button>
          )
        })}
      </div>

      {onCreated || onOpenGraph ? (
        <div className="border-t-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] p-2">
          {onCreated ? (
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/88 transition-colors hover:bg-muted/70"
              onClick={() => void handleCreateBranch()}
              disabled={Boolean(busyBranch)}
            >
              <Plus className="size-4 text-muted-foreground" />
              <span>{t('createAndCheckoutBranchEllipsis')}</span>
            </button>
          ) : null}
          {onOpenGraph ? (
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/88 transition-colors hover:bg-muted/70"
              onClick={onOpenGraph}
            >
              <GitGraph className="size-4 text-muted-foreground" />
              <span>{t('gitGraph')}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
