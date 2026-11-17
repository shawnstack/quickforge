import { useEffect, useId, useMemo, useState } from 'react'
import { AlertTriangle, Copy, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'
import { copyTextToClipboard } from '@/lib/message-utils'
import {
  createConversationShare,
  defaultShareExpiresAt,
  generateSharePassword,
  listConversationShares,
  revokeConversationShare,
  type ConversationShare,
  type SharePermission,
} from '@/lib/share-client'

type ShareDialogError =
  | { kind: 'message'; text: string }
  | { kind: 'key'; key: 'shareDialogLoadFailed' | 'shareDialogCreateFailed' | 'shareDialogRevokeFailed' | 'shareDialogOperateNeedsPassword' }

export function ShareConversationDialog({
  open,
  sessionId,
  title,
  onOpenChange,
}: {
  open: boolean
  sessionId?: string
  title: string
  onOpenChange: (open: boolean) => void
}) {
  const passwordFieldId = useId()
  const [permission, setPermission] = useState<SharePermission>('read')
  const [password, setPassword] = useState('')
  const [expiresIn, setExpiresIn] = useState('24h')
  const [riskAccepted, setRiskAccepted] = useState(false)
  const [generatedText, setGeneratedText] = useState('')
  const [shares, setShares] = useState<ConversationShare[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ShareDialogError>()

  const expiresAt = useMemo(() => {
    if (expiresIn === 'never') return undefined
    if (expiresIn === '1h') return defaultShareExpiresAt(1)
    if (expiresIn === '7d') return defaultShareExpiresAt(24 * 7)
    return defaultShareExpiresAt(24)
  }, [expiresIn])

  useEffect(() => {
    if (!open || !sessionId) return
    void listConversationShares(sessionId)
      .then((payload) => setShares(payload.shares))
      .catch((err) => setError(err instanceof Error ? { kind: 'message', text: err.message } : { kind: 'key', key: 'shareDialogLoadFailed' }))
  }, [open, sessionId])

  if (!open) return null

  const passwordRequired = permission === 'operate'
  const canSubmit = Boolean(sessionId) && (permission !== 'operate' || (riskAccepted && password.trim()))

  const createShare = async () => {
    if (!sessionId || !canSubmit) return
    if (passwordRequired && !password.trim()) {
      setError({ kind: 'key', key: 'shareDialogOperateNeedsPassword' })
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const result = await createConversationShare({ sessionId, permission, password: password.trim(), expiresAt })
      setGeneratedText(result.url)
      await copyTextToClipboard(result.url)
      setRiskAccepted(false)
      const list = await listConversationShares(sessionId)
      setShares(list.shares)
    } catch (err) {
      setError(err instanceof Error ? { kind: 'message', text: err.message } : { kind: 'key', key: 'shareDialogCreateFailed' })
    } finally {
      setLoading(false)
    }
  }

  const copyExistingShare = async (share: ConversationShare) => {
    const url = share.url || `${window.location.origin}/share/${encodeURIComponent(share.id)}`
    setGeneratedText(url)
    await copyTextToClipboard(url)
  }

  const revoke = async (shareId: string) => {
    try {
      await revokeConversationShare(shareId)
      setShares((current) => current.map((item) => item.id === shareId ? { ...item, revokedAt: new Date().toISOString() } : item))
    } catch (err) {
      setError(err instanceof Error ? { kind: 'message', text: err.message } : { kind: 'key', key: 'shareDialogRevokeFailed' })
    }
  }

  return (
    <div className="quickforge-dialog-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onOpenChange(false) }}>
      <div className="quickforge-dialog-panel-in flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-quickforge" onMouseDown={(event) => event.stopPropagation()}>
        <div className="shrink-0 border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">{t('shareDialogTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('shareDialogIntro', { title })}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-sm font-medium">{t('shareDialogPermissionLabel')}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" className={`rounded-xl border p-3 text-left text-sm ${permission === 'read' ? 'border-primary bg-primary/10' : 'border-border'}`} onClick={() => setPermission('read')}>
                  <div className="font-medium">{t('shareDialogPermissionRead')}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{t('shareDialogPermissionReadHint')}</div>
                </button>
                <button type="button" className={`rounded-xl border p-3 text-left text-sm ${permission === 'operate' ? 'border-red-400 bg-red-50 text-red-950' : 'border-border'}`} onClick={() => setPermission('operate')}>
                  <div className="font-medium text-red-700">{t('shareDialogPermissionOperate')}</div>
                  <div className="mt-1 text-xs text-red-700">{t('shareDialogPermissionOperateHint')}</div>
                </button>
              </div>
            </div>

            {permission === 'operate' ? (
              <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                <div className="flex gap-2 font-semibold"><AlertTriangle className="mt-0.5 size-4" />{t('shareDialogRiskTitle')}</div>
                <p className="mt-2 text-xs leading-5">{t('shareDialogRiskBody')}</p>
                <label className="mt-3 flex items-center gap-2 text-xs font-medium">
                  <input type="checkbox" checked={riskAccepted} onChange={(event) => setRiskAccepted(event.target.checked)} />
                  {t('shareDialogRiskAcknowledge')}
                </label>
              </div>
            ) : null}

            <div className="space-y-2">
              <label htmlFor={passwordFieldId} className="block text-sm font-medium">
                {passwordRequired ? t('shareDialogPasswordRequiredLabel') : t('shareDialogPasswordOptionalLabel')}
              </label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input id={passwordFieldId} value={password} onChange={(event) => setPassword(event.target.value)} className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm" placeholder={passwordRequired ? t('shareDialogPasswordRequiredPlaceholder') : t('shareDialogPasswordOptionalPlaceholder')} />
                <Button variant="outline" className="h-10 sm:shrink-0" onClick={() => setPassword(generateSharePassword())}>
                  <RefreshCw className="mr-2 size-4" />{t('shareDialogGeneratePassword')}
                </Button>
              </div>
              <span className="block text-xs text-muted-foreground">{passwordRequired ? t('shareDialogPasswordRequiredHint') : t('shareDialogPasswordOptionalHint')}</span>
            </div>

            <label className="block text-sm font-medium">
              {t('shareDialogExpiresLabel')}
              <select value={expiresIn} onChange={(event) => setExpiresIn(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="1h">{t('shareDialogExpires1h')}</option>
                <option value="24h">{t('shareDialogExpires24h')}</option>
                <option value="7d">{t('shareDialogExpires7d')}</option>
                <option value="never">{t('shareDialogExpiresNone')}</option>
              </select>
            </label>

            {generatedText ? (
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
                {t('shareDialogCopied')}
                <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-xs">{generatedText}</pre>
              </div>
            ) : null}

            {error ? <div className="rounded-md border bg-destructive/10 px-3 py-2 text-sm text-destructive">{error.kind === 'key' ? t(error.key) : error.text}</div> : null}

            {shares.length ? (
              <div>
                <div className="mb-2 text-sm font-medium">{t('shareDialogExisting')}</div>
                <div className="space-y-2">
                  {shares.map((share) => (
                    <div key={share.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-xs">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono">{share.id}</div>
                        <div className="text-muted-foreground">{share.permission === 'operate' ? t('shareDialogOperateShort') : t('shareDialogReadShort')} · {share.hasPassword ? t('shareDialogHasPassword') : t('shareDialogNoPassword')} · {share.revokedAt ? t('shareDialogRevoked') : share.expiresAt ? t('shareDialogExpiresAtValue', { time: new Date(share.expiresAt).toLocaleString() }) : t('shareDialogNeverExpires')}</div>
                      </div>
                      {!share.revokedAt ? (
                        <>
                          <Button variant="ghost" size="icon" onClick={() => void copyExistingShare(share)} aria-label={t('shareDialogCopyLink')} title={t('shareDialogCopyLink')}>
                            <Copy className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="text-destructive" onClick={() => void revoke(share.id)} aria-label={t('shareDialogRevoke')} title={t('shareDialogRevoke')}>
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="shrink-0 border-t border-border px-5 py-4">
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
            <Button variant={permission === 'operate' ? 'destructive' : 'default'} disabled={!canSubmit || loading} onClick={() => void createShare()} title={permission === 'operate' && !password.trim() ? t('shareDialogOperateNeedsPassword') : undefined}>
              <Copy className="mr-2 size-4" />{permission === 'operate' ? t('shareDialogSaveOperate') : t('shareDialogSave')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
