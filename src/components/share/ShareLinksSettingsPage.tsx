import { useEffect, useMemo, useState } from 'react'
import { Copy, Edit3, ExternalLink, Link2, MoreHorizontal, Power, RefreshCw, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { showConfirm } from '@/components/ui/confirm-dialog'
import { getDateLocale, t } from '@/lib/i18n'
import { copyTextToClipboard } from '@/lib/message-utils'
import {
  conversationShareStatus,
  defaultShareExpiresAt,
  deleteConversationShare,
  disableConversationShare,
  generateSharePassword,
  listConversationShares,
  restoreConversationShare,
  type ConversationShare,
  type SharePermission,
  updateConversationShare,
  updateConversationShareExpiration,
} from '@/lib/share-client'

const RESTORE_EXPIRATION_OPTIONS = [
  { value: '1h', hours: 1 },
  { value: '24h', hours: 24 },
  { value: '7d', hours: 24 * 7 },
  { value: 'never' },
] as const

function shareUrl(share: ConversationShare) {
  return share.url || `${window.location.origin}/share/${encodeURIComponent(share.id)}`
}

function formatDate(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString(getDateLocale())
}

function statusLabel(status: ReturnType<typeof conversationShareStatus>) {
  if (status === 'disabled') return t('shareStatusDisabled')
  if (status === 'expired') return t('shareStatusExpired')
  return t('shareStatusActive')
}

function statusClass(status: ReturnType<typeof conversationShareStatus>) {
  if (status === 'disabled') return 'quickforge-settings-badge-muted'
  if (status === 'expired') return 'quickforge-settings-badge-warning'
  return 'quickforge-settings-badge-success'
}

function expirationFromOption(option: string) {
  const matched = RESTORE_EXPIRATION_OPTIONS.find((item) => item.value === option)
  return matched && 'hours' in matched ? defaultShareExpiresAt(matched.hours) : undefined
}

function ShareEditDialog({
  share,
  onClose,
  onSaved,
}: {
  share: ConversationShare
  onClose: () => void
  onSaved: (share: ConversationShare) => void
}) {
  const [permission, setPermission] = useState<SharePermission>(share.permission)
  const [passwordInput, setPasswordInput] = useState('')
  const [removePassword, setRemovePassword] = useState(false)
  const [allowCloudUsage, setAllowCloudUsage] = useState(share.allowCloudUsage === true)
  const [expirationChoice, setExpirationChoice] = useState<'keep' | '1h' | '24h' | '7d' | 'never'>('keep')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const passwordRequired = permission === 'operate'
  const willHavePassword = removePassword ? false : Boolean(share.hasPassword || passwordInput.trim())

  const save = async () => {
    if (passwordRequired && !willHavePassword) {
      setError(t('operateRequiresPassword'))
      return
    }
    setSaving(true)
    setError('')
    try {
      const password = removePassword ? '' : passwordInput ? passwordInput.trim() : undefined
      const expiresAt = expirationChoice === 'keep' ? undefined : expirationFromOption(expirationChoice)
      const result = await updateConversationShare(share.id, { permission, password, expiresAt, allowCloudUsage: permission === 'operate' && allowCloudUsage })
      onSaved(result.share)
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('requestFailed'))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-quickforge" onMouseDown={(event) => event.stopPropagation()}>
        <div className="shrink-0 border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">{t('editShareTitle')}</h2>
          <p className="mt-1 truncate text-sm text-muted-foreground">{share.titleSnapshot || t('untitledConversation')}</p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <div className="mb-2 text-sm font-medium">{t('sharePermissionTitle')}</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" className={`rounded-xl border p-3 text-left text-sm ${permission === 'read' ? 'border-primary bg-primary/10' : 'border-border'}`} onClick={() => setPermission('read')}>
                <div className="font-medium">{t('sharePermissionRead')}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t('sharePermissionReadHint')}</div>
              </button>
              <button type="button" className={`rounded-xl border p-3 text-left text-sm ${permission === 'operate' ? 'border-red-400 bg-red-50 text-red-950' : 'border-border'}`} onClick={() => setPermission('operate')}>
                <div className="font-medium text-red-700">{t('sharePermissionOperate')}</div>
                <div className="mt-1 text-xs text-red-700">{t('sharePermissionOperateHint')}</div>
              </button>
            </div>
          </div>

          {permission === 'operate' ? (
            <label className="flex items-start gap-2 rounded-xl border border-border bg-muted/20 p-3 text-xs font-medium">
              <input type="checkbox" checked={allowCloudUsage} onChange={(event) => setAllowCloudUsage(event.target.checked)} />
              <span>允许该分享使用宿主机的 QuickForge Cloud 模型和额度。默认关闭。</span>
            </label>
          ) : null}

          <div className="space-y-2">
            <label className="block text-sm font-medium">{t('sharePasswordTitle')}</label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                disabled={removePassword}
                className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                placeholder={share.hasPassword ? t('sharePasswordPlaceholderKeep') : t('sharePasswordPlaceholderNone')}
                type="text"
                autoComplete="new-password"
              />
              <Button variant="outline" className="h-10 sm:shrink-0" onClick={() => { setRemovePassword(false); setPasswordInput(generateSharePassword()) }}>
                <RefreshCw className="mr-2 size-4" />{t('generatePassword')}
              </Button>
            </div>
            {removePassword ? (
              <span className="block text-xs text-destructive">{t('sharePasswordRemovalSelected')}</span>
            ) : (
              <span className="block text-xs text-muted-foreground">
                {share.hasPassword
                  ? t('sharePasswordEditHint')
                  : t('sharePasswordSetHint')}
              </span>
            )}
            {share.hasPassword && !removePassword ? (
              <Button variant="ghost" size="sm" className="h-8 text-destructive" onClick={() => { setPasswordInput(''); setRemovePassword(true) }}>
                <Trash2 className="mr-2 size-3.5" />{t('removePassword')}
              </Button>
            ) : null}
          </div>

          <label className="block text-sm font-medium">
            {t('shareExpiresAt')}
            <select value={expirationChoice} onChange={(event) => setExpirationChoice(event.target.value as typeof expirationChoice)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="keep">{t('keepCurrentExpiration')}</option>
              <option value="1h">{t('oneHour')}</option>
              <option value="24h">{t('twentyFourHours')}</option>
              <option value="7d">{t('sevenDays')}</option>
              <option value="never">{t('shareNeverExpires')}</option>
            </select>
          </label>

          {error ? <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
        </div>

        <div className="shrink-0 border-t border-border px-5 py-4">
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>{t('cancel')}</Button>
            <Button variant={permission === 'operate' ? 'destructive' : 'default'} onClick={() => void save()} disabled={saving}>
              {t('saveChanges')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ShareActionsSheet({
  share,
  status,
  onClose,
  onAction,
}: {
  share: ConversationShare
  status: ReturnType<typeof conversationShareStatus>
  onClose: () => void
  onAction: (action: 'copy' | 'open' | 'edit' | 'disable' | 'restore' | 'delete') => void
}) {
  const canOpen = status === 'active'
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="w-full max-w-md rounded-t-2xl border border-border bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-quickforge sm:rounded-2xl sm:pb-4" role="dialog" aria-modal="true" aria-label={t('manageShare')}>
        <div className="truncate px-1 text-sm font-medium text-foreground">{share.titleSnapshot || t('untitledConversation')}</div>
        <div className="mt-1 truncate px-1 font-mono text-xs text-muted-foreground" title={shareUrl(share)}>{shareUrl(share)}</div>
        <div className="mt-3 space-y-1">
          <Button variant="ghost" className="w-full justify-start" onClick={() => onAction('copy')}><Copy className="mr-2 size-4" />{t('copyShareLink')}</Button>
          <Button variant="ghost" className="w-full justify-start" disabled={!canOpen} onClick={() => onAction('open')}><ExternalLink className="mr-2 size-4" />{t('openShareLink')}</Button>
          {status === 'active' ? (
            <Button variant="ghost" className="w-full justify-start" onClick={() => onAction('edit')}><Edit3 className="mr-2 size-4" />{t('editShare')}</Button>
          ) : null}
          {status === 'active' ? (
            <Button variant="ghost" className="w-full justify-start" onClick={() => onAction('disable')}><Power className="mr-2 size-4" />{t('disableShare')}</Button>
          ) : (
            <Button variant="ghost" className="w-full justify-start" onClick={() => onAction('restore')}><RefreshCw className="mr-2 size-4" />{t('restoreShare')}</Button>
          )}
          <Button variant="ghost" className="w-full justify-start hover:text-destructive" onClick={() => onAction('delete')}><Trash2 className="mr-2 size-4" />{t('deleteShare')}</Button>
        </div>
        <Button variant="outline" className="mt-3 w-full" onClick={onClose}>{t('cancel')}</Button>
      </div>
    </div>
  )
}

export function ShareLinksSettingsPage() {
  const [shares, setShares] = useState<ConversationShare[]>([])
  const [loading, setLoading] = useState(true)
  const [busyShareId, setBusyShareId] = useState('')
  const [query, setQuery] = useState('')
  const [expirationSelection, setExpirationSelection] = useState<Record<string, string>>({})
  const [editingShare, setEditingShare] = useState<ConversationShare | null>(null)
  const [actionsShare, setActionsShare] = useState<ConversationShare | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const loadShares = async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setError('')
    try {
      const result = await listConversationShares()
      setShares(result.shares)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('shareLinksLoadFailed'))
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    listConversationShares()
      .then((result) => {
        if (!cancelled) setShares(result.shares)
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t('shareLinksLoadFailed'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filteredShares = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return shares
    return shares.filter((share) => `${share.titleSnapshot || ''} ${share.id} ${share.projectId || ''}`.toLowerCase().includes(normalized))
  }, [query, shares])

  const updateShare = (share: ConversationShare) => {
    setShares((current) => current.map((item) => item.id === share.id ? { ...item, ...share } : item))
  }

  const runShareAction = async (shareId: string, action: () => Promise<{ share: ConversationShare }>, successMessage: string) => {
    if (busyShareId) return
    setBusyShareId(shareId)
    setMessage('')
    setError('')
    try {
      const result = await action()
      updateShare(result.share)
      setMessage(successMessage)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('requestFailed'))
    } finally {
      setBusyShareId('')
    }
  }

  const copyLink = async (share: ConversationShare) => {
    try {
      await copyTextToClipboard(shareUrl(share))
      setMessage(t('shareLinkCopied'))
      setError('')
    } catch {
      setError(t('copyFailed'))
    }
  }

  const disableShare = async (share: ConversationShare) => {
    const confirmed = await showConfirm({
      description: t('disableShareConfirm', { title: share.titleSnapshot || share.id }),
      confirmLabel: t('disableShare'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return
    await runShareAction(share.id, () => disableConversationShare(share.id), t('shareDisabled'))
  }

  const restoreShare = async (share: ConversationShare) => {
    const option = expirationSelection[share.id] || '24h'
    await runShareAction(
      share.id,
      () => restoreConversationShare(share.id, expirationFromOption(option)),
      t('shareRestored'),
    )
  }

  const updateExpiration = async (share: ConversationShare) => {
    const option = expirationSelection[share.id] || '24h'
    await runShareAction(
      share.id,
      () => updateConversationShareExpiration(share.id, expirationFromOption(option)),
      t('shareExpirationUpdated'),
    )
  }

  const deleteShare = async (share: ConversationShare) => {
    const confirmed = await showConfirm({
      description: t('deleteShareConfirm', { title: share.titleSnapshot || share.id }),
      confirmLabel: t('confirmDelete'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed || busyShareId) return
    setBusyShareId(share.id)
    setMessage('')
    setError('')
    try {
      await deleteConversationShare(share.id)
      setShares((current) => current.filter((item) => item.id !== share.id))
      setMessage(t('shareDeleted'))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t('requestFailed'))
    } finally {
      setBusyShareId('')
    }
  }

  const handleSheetAction = (share: ConversationShare, action: 'copy' | 'open' | 'edit' | 'disable' | 'restore' | 'delete') => {
    setActionsShare(null)
    if (action === 'copy') void copyLink(share)
    if (action === 'open') window.open(shareUrl(share), '_blank', 'noopener,noreferrer')
    if (action === 'edit') setEditingShare(share)
    if (action === 'disable') void disableShare(share)
    if (action === 'restore') void restoreShare(share)
    if (action === 'delete') void deleteShare(share)
  }

  const editingStatus = editingShare ? conversationShareStatus(editingShare) : null
  const actionsStatus = actionsShare ? conversationShareStatus(actionsShare) : null

  return (
    <div className="quickforge-settings-stack">
      <div className="quickforge-settings-heading">
        <div>
          <h2 className="quickforge-settings-title"><Link2 className="size-5" />{t('shareLinks')}</h2>
          <p className="quickforge-settings-row-description">{t('shareLinksDescription')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadShares()} disabled={loading || Boolean(busyShareId)}>
          <RefreshCw className={`mr-2 size-4 ${loading ? 'animate-spin' : ''}`} />{t('refresh')}
        </Button>
      </div>

      <div className="quickforge-settings-section">
        <div className="quickforge-settings-toolbar">
          <div className="quickforge-settings-inline-field max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="quickforge-settings-input"
              placeholder={t('searchShareLinks')}
              aria-label={t('searchShareLinks')}
            />
          </div>
          <span className="text-xs text-muted-foreground">{t('shareLinksCount', { count: filteredShares.length })}</span>
        </div>

        {message ? <div className="quickforge-settings-note quickforge-share-links-message">{message}</div> : null}
        {error ? <div className="quickforge-settings-error quickforge-share-links-message">{error}</div> : null}

        {loading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">{t('loading')}</div>
        ) : filteredShares.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{query ? t('noMatchingShareLinks') : t('noShareLinks')}</div>
        ) : (
          filteredShares.map((share) => {
            const status = conversationShareStatus(share)
            const busy = busyShareId === share.id
            const canOpen = status === 'active'
            return (
              <div key={share.id} className="quickforge-settings-list-item quickforge-share-link-item">
                <div className="quickforge-settings-list-item-main">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <div className="truncate text-sm font-medium text-foreground">{share.titleSnapshot || t('untitledConversation')}</div>
                    <span className={`quickforge-settings-badge ${statusClass(status)}`}>{statusLabel(status)}</span>
                    <span className="quickforge-settings-badge quickforge-settings-badge-info">{share.permission === 'operate' ? t('sharePermissionOperate') : t('sharePermissionRead')}</span>
                    {share.hasPassword ? <span className="quickforge-settings-badge quickforge-settings-badge-muted">{t('sharePasswordProtected')}</span> : null}
                  </div>
                  <div className="quickforge-share-link-url" title={shareUrl(share)}>{shareUrl(share)}</div>
                  <div className="quickforge-settings-meta text-xs text-muted-foreground">
                    <span>{t('shareCreatedAt')}: {formatDate(share.createdAt)}</span>
                    <span>·</span>
                    <span>{t('shareExpiresAt')}: {share.expiresAt ? formatDate(share.expiresAt) : t('shareNeverExpires')}</span>
                    <span>·</span>
                    <span>{t('shareAccessCount', { count: share.accessCount || 0 })}</span>
                    {share.lastAccessedAt ? <><span>·</span><span>{t('shareLastAccessedAt')}: {formatDate(share.lastAccessedAt)}</span></> : null}
                  </div>
                </div>

                <div className="quickforge-settings-list-item-actions quickforge-share-link-actions">
                  <div className="hidden flex-wrap items-center justify-end gap-2 md:flex">
                    {status === 'active' ? (
                      <>
                        <select
                          className="quickforge-settings-select quickforge-share-expiration-select"
                          value={expirationSelection[share.id] || '24h'}
                          onChange={(event) => setExpirationSelection((current) => ({ ...current, [share.id]: event.target.value }))}
                          aria-label={t('shareUpdateExpiration')}
                          disabled={busy}
                        >
                          <option value="1h">{t('oneHour')}</option>
                          <option value="24h">{t('twentyFourHours')}</option>
                          <option value="7d">{t('sevenDays')}</option>
                          <option value="never">{t('shareNeverExpires')}</option>
                        </select>
                        <Button variant="outline" size="sm" onClick={() => void updateExpiration(share)} disabled={busy}>
                          {t('updateShareExpiration')}
                        </Button>
                      </>
                    ) : null}
                    <Button variant="ghost" size="icon" onClick={() => void copyLink(share)} aria-label={t('copyShareLink')} title={t('copyShareLink')}>
                      <Copy className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => window.open(shareUrl(share), '_blank', 'noopener,noreferrer')} disabled={!canOpen} aria-label={t('openShareLink')} title={t('openShareLink')}>
                      <ExternalLink className="size-4" />
                    </Button>
                    {status === 'active' ? (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setEditingShare(share)} disabled={busy}>
                          <Edit3 className="mr-2 size-4" />{t('editShare')}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => void disableShare(share)} disabled={busy}>
                          <Power className="mr-2 size-4" />{t('disableShare')}
                        </Button>
                      </>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => void restoreShare(share)} disabled={busy}>
                        <RefreshCw className="mr-2 size-4" />{t('restoreShare')}
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="hover:text-destructive" onClick={() => void deleteShare(share)} disabled={busy} aria-label={t('deleteShare')} title={t('deleteShare')}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <Button variant="outline" size="sm" className="md:hidden" onClick={() => setActionsShare(share)} disabled={busy}>
                    <MoreHorizontal className="mr-2 size-4" />{t('manageShare')}
                  </Button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {editingShare && editingStatus === 'active' ? (
        <ShareEditDialog
          key={editingShare.id}
          share={editingShare}
          onClose={() => setEditingShare(null)}
          onSaved={(share) => {
            updateShare(share)
            setMessage(t('shareUpdated'))
            setError('')
          }}
        />
      ) : null}

      {actionsShare && actionsStatus ? (
        <ShareActionsSheet
          share={actionsShare}
          status={actionsStatus}
          onClose={() => setActionsShare(null)}
          onAction={(action) => handleSheetAction(actionsShare, action)}
        />
      ) : null}
    </div>
  )
}
