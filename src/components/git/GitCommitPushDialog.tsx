import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { ArrowUpFromLine, Check, ChevronDown, GitBranch, GitCommitHorizontal, Loader2, Sparkles, UploadCloud, X } from 'lucide-react'
import { GitBranchMenu } from '@/components/git/GitBranchMenu'
import { canCommitGitChanges, gitFilesForCommit, isDetachedGitStatus } from '@/components/git/git-commit-dialog-logic'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { defaultThinkingLevelForModel, initializePiStorage, loadDefaultOptions, loadInitialConfiguredModel } from '@/lib/pi-chat'
import { commitAndPushGitChanges, commitGitChanges, generateGitCommitMessage, pushGitBranch } from '@/components/workspace/workspace-api'
import type { GitChangedFile, GitStatusResponse } from '@/components/workspace/workspace-types'

type GitCommitPushDialogProps = {
  open: boolean
  projectId?: string
  status?: GitStatusResponse
  onClose: () => void
  onCheckout: (branch: string) => Promise<void>
  onRefreshStatus: () => Promise<GitStatusResponse | undefined>
  onStatusChange: (status: GitStatusResponse) => void
  onCompleted: (status: GitStatusResponse) => void
}

type AnyModel = Model<Api>
type ActionKind = 'commit' | 'commit-push' | 'push'

function gitTotals(status?: GitStatusResponse) {
  return (status?.files ?? []).reduce((totals, file) => {
    totals.additions += file.additions ?? 0
    totals.deletions += file.deletions ?? 0
    return totals
  }, { additions: 0, deletions: 0 })
}

function gitFileCode(file: GitChangedFile) {
  if (file.conflict) return '!'
  if (file.status === 'untracked') return '?'
  if (file.status === 'added') return 'A'
  if (file.status === 'deleted') return 'D'
  if (file.status === 'renamed') return 'R'
  return 'M'
}

export function GitCommitPushDialog({ open, projectId, status, onClose, onCheckout, onRefreshStatus, onStatusChange, onCompleted }: GitCommitPushDialogProps) {
  const [message, setMessage] = useState('')
  const [includeUnstaged, setIncludeUnstaged] = useState(false)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [filesExpanded, setFilesExpanded] = useState(false)
  const [refreshing, setRefreshing] = useState(true)
  const [busy, setBusy] = useState<ActionKind | 'generate'>()
  const [error, setError] = useState('')
  const [pushError, setPushError] = useState('')
  const [selectedModel, setSelectedModel] = useState<AnyModel>()
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('off')
  const totals = useMemo(() => gitTotals(status), [status])
  const selectedFiles = useMemo(() => gitFilesForCommit(status, includeUnstaged), [includeUnstaged, status])
  const selectedPaths = useMemo(() => new Set(selectedFiles.map((file) => file.path)), [selectedFiles])
  const fileCount = status?.counts?.total ?? status?.files.length ?? 0
  const detached = isDetachedGitStatus(status)
  const canCommit = !refreshing && canCommitGitChanges(status, includeUnstaged, message)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void onRefreshStatus().then((nextStatus) => {
      if (!cancelled && !nextStatus) setError(t('gitStatusRefreshFailed'))
    }).finally(() => {
      if (!cancelled) setRefreshing(false)
    })
    return () => { cancelled = true }
  }, [onRefreshStatus, open, projectId])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function loadDefaultModel() {
      try {
        const storage = await initializePiStorage()
        const defaultOptions = await loadDefaultOptions(storage)
        const activeModel = await loadInitialConfiguredModel(storage, [], defaultOptions.model)
        if (cancelled || !activeModel) return
        setSelectedModel(activeModel)
        setThinkingLevel(defaultOptions.thinkingLevel ?? defaultThinkingLevelForModel(activeModel))
      } catch {
        // 生成时会给出明确错误。
      }
    }
    void loadDefaultModel()
    return () => { cancelled = true }
  }, [open])

  useEffect(() => {
    if (!branchMenuOpen) return
    const closeMenu = () => setBranchMenuOpen(false)
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
    }
  }, [branchMenuOpen])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) {
        setBranchMenuOpen(false)
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose, open])

  if (!open) return null

  async function generateMessage() {
    if (!projectId) {
      setError(t('gitCommitNoProject'))
      return
    }
    if (!selectedModel) {
      setError(t('gitCommitNoModel'))
      return
    }
    if (!selectedFiles.length) {
      setError(t('gitNoStagedChanges'))
      return
    }
    setBusy('generate')
    setError('')
    try {
      const payload = await generateGitCommitMessage(projectId, selectedModel, thinkingLevel, includeUnstaged)
      setMessage(payload.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('gitGenerateCommitMessageFailed'))
    } finally {
      setBusy(undefined)
    }
  }

  async function runAction(action: ActionKind) {
    if (!projectId) return
    if (action !== 'push') {
      if (!message.trim()) {
        setError(t('gitCommitMessageRequired'))
        return
      }
      if (!canCommit) {
        setError(detached ? t('gitDetachedHeadBlocked') : t('gitNoStagedChanges'))
        return
      }
    }
    if (detached) {
      setError(t('gitDetachedHeadBlocked'))
      return
    }
    setBusy(action)
    setError('')
    try {
      if (action === 'push') {
        const payload = await pushGitBranch(projectId)
        setPushError('')
        onCompleted(payload)
        return
      }
      if (action === 'commit-push') {
        const payload = await commitAndPushGitChanges(projectId, message.trim(), includeUnstaged)
        if (!payload.pushed) {
          onStatusChange(payload)
          setMessage('')
          setPushError(payload.pushError || t('gitOperationFailed'))
          return
        }
        setMessage('')
        onCompleted(payload)
        return
      }
      const payload = await commitGitChanges(projectId, message.trim(), includeUnstaged)
      setMessage('')
      onCompleted(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('gitOperationFailed'))
    } finally {
      setBusy(undefined)
    }
  }

  const dialog = (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-6 py-8" role="dialog" aria-modal="true" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) {
        setBranchMenuOpen(false)
        onClose()
      }
    }}>
      <div className="flex max-h-[min(700px,calc(100vh-64px))] w-full max-w-[760px] flex-col overflow-hidden rounded-3xl border border-[color-mix(in_oklab,var(--border)_42%,transparent)] bg-background shadow-2xl">
        <div className="flex items-center justify-between px-6 py-5">
          <div className="relative min-w-0" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="flex max-w-[280px] items-center gap-2.5 rounded-xl px-2 py-1.5 text-base text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => setBranchMenuOpen((value) => !value)}
              disabled={!projectId || Boolean(busy)}
              aria-label={t('gitBranchMenu')}
              aria-haspopup="menu"
              aria-expanded={branchMenuOpen}
            >
              <GitBranch className="size-5 shrink-0" />
              <span className="min-w-0 truncate">{status?.branch || t('unknown')}</span>
              <ChevronDown className="size-4 shrink-0" />
            </button>
            {branchMenuOpen && projectId ? (
              <GitBranchMenu
                projectId={projectId}
                currentBranch={status?.branch}
                className="top-11"
                onCheckout={async (branch) => {
                  await onCheckout(branch)
                  setBranchMenuOpen(false)
                }}
              />
            ) : null}
          </div>
          <div className="flex items-center gap-3 text-base font-medium">
            <span className="text-emerald-600">+{totals.additions}</span>
            <span className="text-red-600">-{totals.deletions}</span>
            <button type="button" className="ml-2 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => {
              setBranchMenuOpen(false)
              onClose()
            }} disabled={Boolean(busy)} aria-label={t('close')}>
              <X className="size-5" />
            </button>
          </div>
        </div>

        <div className="relative min-h-44 px-6 pb-4">
          <textarea
            value={message}
            onChange={(event) => {
              setMessage(event.target.value)
              setError('')
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                if (!busy && canCommit) void runAction('commit')
              }
            }}
            placeholder={t('gitCommitMessagePlaceholder')}
            disabled={Boolean(busy)}
            className="min-h-40 w-full resize-none bg-transparent pr-12 text-base leading-7 text-foreground/90 outline-none placeholder:text-muted-foreground/72 disabled:opacity-60"
          />
          <button
            type="button"
            className={cn(
              'absolute right-6 top-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              busy === 'generate' && 'pointer-events-none',
            )}
            onClick={() => void generateMessage()}
            disabled={Boolean(busy) || refreshing || !selectedFiles.length || detached}
            title={t('gitGenerateCommitMessage')}
            aria-label={t('gitGenerateCommitMessage')}
          >
            {busy === 'generate' ? <Loader2 className="size-5 animate-spin" /> : <Sparkles className="size-5" />}
          </button>
        </div>

        <div className="border-t border-[color-mix(in_oklab,var(--border)_24%,transparent)] px-6 py-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <label className="flex min-w-0 items-center gap-3 text-foreground/92">
              <button
                type="button"
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                  includeUnstaged ? 'border-black bg-black text-white' : 'border-border bg-background text-transparent',
                )}
                onClick={() => {
                  setIncludeUnstaged((value) => !value)
                  setPushError('')
                  setError('')
                }}
                disabled={Boolean(busy) || refreshing}
                aria-pressed={includeUnstaged}
              >
                <Check className="size-3.5" />
              </button>
              <span>{t('gitIncludeUnstagedChanges')}</span>
            </label>
            <button type="button" className="flex shrink-0 items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground" onClick={() => setFilesExpanded((value) => !value)} disabled={!fileCount}>
              <span>{t('gitCommitFilesSummary', { selected: selectedFiles.length, total: fileCount })}</span>
              <ChevronDown className={cn('size-4 transition-transform', filesExpanded && 'rotate-180')} />
            </button>
          </div>
          {includeUnstaged ? <div className="mt-2 text-xs text-muted-foreground">{t('gitIncludeUnstagedWarning')}</div> : null}
          {filesExpanded ? (
            <div className="mt-3 max-h-44 space-y-1 overflow-y-auto border-t border-[color-mix(in_oklab,var(--border)_24%,transparent)] pt-3">
              {(status?.files ?? []).map((file) => {
                const selected = selectedPaths.has(file.path)
                return (
                  <div key={`${file.oldPath ?? ''}:${file.path}`} className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5', !selected && 'opacity-45')}>
                    <span className="w-4 shrink-0 text-center font-mono text-xs text-muted-foreground">{gitFileCode(file)}</span>
                    <span className="min-w-0 flex-1 truncate" title={file.path}>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
                    {!selected ? <span className="shrink-0 text-xs text-muted-foreground">{t('gitFileNotIncluded')}</span> : null}
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>

        {refreshing ? <div className="mx-6 mb-3 rounded-2xl bg-muted/55 px-4 py-3 text-sm text-muted-foreground">{t('gitRefreshingStatus')}</div> : null}
        {detached ? <div className="mx-6 mb-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{t('gitDetachedHeadBlocked')}</div> : null}
        {pushError ? (
          <div className="mx-6 mb-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <div className="font-medium">{t('gitCommitSucceededPushFailed')}</div>
            <div className="mt-1 break-words text-xs opacity-90">{pushError}</div>
          </div>
        ) : null}
        {error ? <div className="mx-6 mb-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
        {status?.counts?.conflicts ? <div className="mx-6 mb-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{t('gitCommitConflictsBlocked')}</div> : null}

        <div className="border-t border-[color-mix(in_oklab,var(--border)_34%,transparent)] px-6 py-4">
          {pushError ? (
            <button type="button" className="flex h-12 w-full items-center gap-3 rounded-2xl bg-muted/70 px-3 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45" disabled={Boolean(busy) || detached} onClick={() => void runAction('push')}>
              {busy === 'push' ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <ArrowUpFromLine className="size-4 shrink-0 text-muted-foreground" />}
              <span>{t('gitRetryPush')}</span>
            </button>
          ) : (
            <div className="space-y-1.5 text-base">
              <button type="button" className="flex h-11 w-full items-center gap-3 rounded-2xl px-3 text-left transition-colors hover:bg-muted/55 disabled:cursor-not-allowed disabled:opacity-45" disabled={Boolean(busy) || !canCommit} onClick={() => void runAction('commit')}>
                {busy === 'commit' ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <GitCommitHorizontal className="size-4 shrink-0 text-muted-foreground" />}
                <span>{t('gitCommitOnly')}</span>
              </button>
              <button type="button" className="flex h-12 w-full items-center gap-3 rounded-2xl bg-muted/70 px-3 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45" disabled={Boolean(busy) || !canCommit} onClick={() => void runAction('commit-push')}>
                {busy === 'commit-push' ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <UploadCloud className="size-4 shrink-0 text-muted-foreground" />}
                <span className="flex-1">{t('gitCommitAndPush')}</span>
              </button>
              <button type="button" className="flex h-11 w-full items-center gap-3 rounded-2xl px-3 text-left text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35" disabled={Boolean(busy) || refreshing || detached} onClick={() => void runAction('push')}>
                {busy === 'push' ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <ArrowUpFromLine className="size-4 shrink-0 text-muted-foreground" />}
                <span>{t('gitPushOnly')}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(dialog, document.body)
}
