import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { Check, GitBranch, Loader2, Sparkles, UploadCloud, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { defaultThinkingLevelForModel, getConfiguredModels, initializePiStorage, loadDefaultOptions, loadInitialConfiguredModel } from '@/lib/pi-chat'
import { commitAndPushGitChanges, commitGitChanges, generateGitCommitMessage, pushGitBranch } from '@/components/workspace/workspace-api'
import type { GitStatusResponse } from '@/components/workspace/workspace-types'

type GitCommitPushDialogProps = {
  open: boolean
  projectId?: string
  status?: GitStatusResponse
  onClose: () => void
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

export function GitCommitPushDialog({ open, projectId, status, onClose, onCompleted }: GitCommitPushDialogProps) {
  const [message, setMessage] = useState('')
  const [includeUnstaged, setIncludeUnstaged] = useState(true)
  const [busy, setBusy] = useState<ActionKind | 'generate'>()
  const [error, setError] = useState('')
  const [selectedModel, setSelectedModel] = useState<AnyModel>()
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('off')
  const totals = useMemo(() => gitTotals(status), [status])
  const fileCount = status?.counts?.total ?? status?.files.length ?? 0
  const canCommit = fileCount > 0 && !status?.counts?.conflicts

  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function loadDefaultModel() {
      try {
        const storage = await initializePiStorage()
        const configuredModels = await getConfiguredModels(storage)
        const defaultOptions = await loadDefaultOptions(storage)
        const activeModel = defaultOptions.model ?? await loadInitialConfiguredModel(storage) ?? configuredModels[0]
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
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose, open])

  if (!open) return null

  async function ensureCommitMessage() {
    const trimmed = message.trim()
    if (trimmed) return trimmed
    return generateMessage(false)
  }

  async function generateMessage(showLoading = true) {
    if (!projectId) throw new Error(t('gitCommitNoProject'))
    if (!selectedModel) throw new Error(t('gitCommitNoModel'))
    if (showLoading) setBusy('generate')
    setError('')
    try {
      const payload = await generateGitCommitMessage(projectId, selectedModel, thinkingLevel)
      setMessage(payload.message)
      return payload.message
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('gitGenerateCommitMessageFailed')
      setError(msg)
      throw err
    } finally {
      if (showLoading) setBusy(undefined)
    }
  }

  async function runAction(action: ActionKind) {
    if (!projectId) return
    setBusy(action)
    setError('')
    try {
      let payload: GitStatusResponse
      if (action === 'push') {
        payload = await pushGitBranch(projectId)
      } else {
        const finalMessage = await ensureCommitMessage()
        payload = action === 'commit-push'
          ? await commitAndPushGitChanges(projectId, finalMessage, includeUnstaged)
          : await commitGitChanges(projectId, finalMessage, includeUnstaged)
      }
      onCompleted(payload)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('gitOperationFailed'))
    } finally {
      setBusy(undefined)
    }
  }

  const dialog = (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-6 py-8" role="dialog" aria-modal="true" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <div className="flex max-h-[min(640px,calc(100vh-64px))] w-full max-w-[760px] flex-col overflow-hidden rounded-3xl border border-[color-mix(in_oklab,var(--border)_42%,transparent)] bg-background shadow-2xl">
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex min-w-0 items-center gap-2.5 text-base text-muted-foreground">
            <GitBranch className="size-5" />
            <span className="min-w-0 truncate">{status?.branch || t('unknown')}</span>
            <span className="text-sm">⌄</span>
          </div>
          <div className="flex items-center gap-3 text-base font-medium">
            <span className="text-emerald-600">+{totals.additions}</span>
            <span className="text-red-600">-{totals.deletions}</span>
            <button type="button" className="ml-2 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={onClose} disabled={Boolean(busy)} aria-label={t('close')}>
              <X className="size-5" />
            </button>
          </div>
        </div>

        <div className="relative min-h-52 px-6 pb-5">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                if (!busy && canCommit) void runAction('commit-push')
              }
            }}
            placeholder={t('gitCommitMessagePlaceholder')}
            className="min-h-48 w-full resize-none bg-transparent pr-12 text-base leading-7 text-foreground/90 outline-none placeholder:text-muted-foreground/72"
          />
          <button
            type="button"
            className={cn(
              'absolute right-6 top-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              busy === 'generate' && 'pointer-events-none',
            )}
            onClick={() => void generateMessage()}
            disabled={Boolean(busy)}
            title={t('gitGenerateCommitMessage')}
            aria-label={t('gitGenerateCommitMessage')}
          >
            {busy === 'generate' ? <Loader2 className="size-5 animate-spin" /> : <Sparkles className="size-5" />}
          </button>
        </div>

        <div className="flex items-center justify-between px-6 py-4 text-base">
          <label className="flex min-w-0 items-center gap-3 text-foreground/92">
            <button
              type="button"
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                includeUnstaged ? 'border-black bg-black text-white' : 'border-border bg-background text-transparent',
              )}
              onClick={() => setIncludeUnstaged((value) => !value)}
              aria-pressed={includeUnstaged}
            >
              <Check className="size-3.5" />
            </button>
            <span>{t('gitIncludeUnstagedChanges')}</span>
          </label>
          <span className="text-muted-foreground">{t('filesCount', { count: fileCount })}</span>
        </div>

        {error ? <div className="mx-6 mb-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
        {status?.counts?.conflicts ? <div className="mx-6 mb-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{t('gitCommitConflictsBlocked')}</div> : null}

        <div className="border-t border-[color-mix(in_oklab,var(--border)_34%,transparent)] px-6 py-4">
          <div className="space-y-1.5 text-base">
            <button type="button" className="flex h-11 w-full items-center gap-3 rounded-2xl px-3 text-left transition-colors hover:bg-muted/55 disabled:cursor-not-allowed disabled:opacity-45" disabled={Boolean(busy) || !canCommit} onClick={() => void runAction('commit')}>
              {busy === 'commit' ? <Loader2 className="size-4 animate-spin" /> : <span className="text-muted-foreground">⊸</span>}
              <span>{t('gitCommitOnly')}</span>
            </button>
            <button type="button" className="flex h-12 w-full items-center gap-3 rounded-2xl bg-muted/70 px-3 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45" disabled={Boolean(busy) || !canCommit} onClick={() => void runAction('commit-push')}>
              {busy === 'commit-push' ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
              <span className="flex-1">{t('gitCommitAndPush')}</span>
              <span className="text-xs text-muted-foreground">Ctrl+↵</span>
            </button>
            <button type="button" className="flex h-11 w-full items-center gap-3 rounded-2xl px-3 text-left text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35" disabled={Boolean(busy)} onClick={() => void runAction('push')}>
              {busy === 'push' ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
              <span>{t('gitPushOnly')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(dialog, document.body)
}
