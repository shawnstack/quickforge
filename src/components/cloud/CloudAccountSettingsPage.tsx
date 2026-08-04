import { useCallback, useEffect, useState } from 'react'
import { Cloud, Laptop, LogOut, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { showConfirm } from '@/components/ui/confirm-dialog'
import { CLOUD_STATE_CHANGED_EVENT } from '@/hooks/useCloudModels'
import {
  getCloudInstallations,
  getCloudStatus,
  getCloudUsage,
  logoutCloud,
  revokeCloudInstallation,
  startCloudGuest,
  type CloudInstallation,
  type CloudStatus,
  type CloudUsage,
} from '@/lib/cloud-client'
import { getDateLocale, t } from '@/lib/i18n'

function formatDate(value?: string) {
  if (!value) return t('cloudNotAvailable')
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? t('cloudNotAvailable') : date.toLocaleString(getDateLocale())
}

function installationId(item: CloudInstallation) {
  const candidate = item.id || item.installationId
  return typeof candidate === 'string' ? candidate : ''
}

function installationName(item: CloudInstallation) {
  const candidate = item.name || item.installationName
  return typeof candidate === 'string' && candidate ? candidate : t('cloudUnnamedDevice')
}

function usageValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(getDateLocale()) : t('cloudNotAvailable')
}

export function CloudAccountSettingsPage() {
  const [status, setStatus] = useState<CloudStatus>()
  const [usage, setUsage] = useState<CloudUsage>()
  const [installations, setInstallations] = useState<CloudInstallation[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setError('')
    try {
      const nextStatus = await getCloudStatus()
      setStatus(nextStatus)
      if (nextStatus.configured && nextStatus.hasSession) {
        const [nextUsage, nextInstallations] = await Promise.all([
          getCloudUsage(),
          getCloudInstallations(),
        ])
        setUsage(nextUsage)
        setInstallations(nextInstallations)
      } else {
        setUsage(undefined)
        setInstallations([])
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('cloudLoadFailed'))
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const startGuest = async () => {
    const confirmed = await showConfirm({
      title: t('cloudStartGuestTitle'),
      description: t('cloudDataConsentDescription'),
      confirmLabel: t('cloudAgreeAndStart'),
      cancelLabel: t('cancel'),
    })
    if (!confirmed || busy) return
    setBusy('start')
    setMessage('')
    setError('')
    try {
      await startCloudGuest()
      window.dispatchEvent(new Event(CLOUD_STATE_CHANGED_EVENT))
      setMessage(t('cloudGuestStarted'))
      await load(false)
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : t('requestFailed'))
    } finally {
      setBusy('')
    }
  }

  const logout = async () => {
    const confirmed = await showConfirm({
      title: t('cloudLogoutTitle'),
      description: t('cloudLogoutDescription'),
      confirmLabel: t('cloudLogout'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed || busy) return
    setBusy('logout')
    setMessage('')
    setError('')
    try {
      await logoutCloud()
      window.dispatchEvent(new Event(CLOUD_STATE_CHANGED_EVENT))
      setMessage(t('cloudLoggedOut'))
      await load(false)
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : t('requestFailed'))
    } finally {
      setBusy('')
    }
  }

  const revoke = async (item: CloudInstallation) => {
    const id = installationId(item)
    if (!id || id === status?.installationId || busy) return
    const confirmed = await showConfirm({
      description: t('cloudRevokeDeviceConfirm', { name: installationName(item) }),
      confirmLabel: t('cloudRevokeDevice'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return
    setBusy(id)
    setMessage('')
    setError('')
    try {
      await revokeCloudInstallation(id)
      setInstallations((current) => current.filter((candidate) => installationId(candidate) !== id))
      setMessage(t('cloudDeviceRevoked'))
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : t('requestFailed'))
    } finally {
      setBusy('')
    }
  }

  const connected = Boolean(status?.configured && status.hasSession)
  const modeLabel = status?.mode === 'account'
    ? t('cloudFormalAccount')
    : status?.mode === 'guest'
      ? t('cloudGuestAccount')
      : t('cloudNotConnected')

  return (
    <div className="quickforge-settings-stack">
      <div className="quickforge-settings-heading">
        <div>
          <h2 className="quickforge-settings-title"><Cloud className="size-5" />{t('cloudAccount')}</h2>
          <p className="quickforge-settings-row-description">{t('cloudAccountDescription')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || Boolean(busy)}>
          <RefreshCw className={`mr-2 size-4 ${loading ? 'animate-spin' : ''}`} />{t('refresh')}
        </Button>
      </div>

      {message ? <div className="quickforge-settings-note">{message}</div> : null}
      {error ? <div className="quickforge-settings-error">{error}</div> : null}

      <div className="quickforge-settings-section">
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title"><ShieldCheck className="size-4" />{t('cloudIdentityStatus')}</div>
            <div className="quickforge-settings-row-description">
              {!status?.configured ? t('cloudNotConfiguredDescription') : connected ? t('cloudConnectedDescription') : t('cloudLocalOnlyDescription')}
            </div>
          </div>
          <div className="quickforge-settings-row-control">
            <span className={`quickforge-settings-badge ${connected ? 'quickforge-settings-badge-success' : 'quickforge-settings-badge-muted'}`}>{modeLabel}</span>
          </div>
        </div>
        {connected ? (
          <>
            <div className="quickforge-settings-row">
              <div className="quickforge-settings-row-main">
                <div className="quickforge-settings-row-title">{t('cloudRemainingQuota')}</div>
                <div className="quickforge-settings-row-description">{t('cloudQuotaDescription')}</div>
              </div>
              <div className="quickforge-settings-row-control text-sm font-medium">{usageValue(usage?.remaining)}</div>
            </div>
            <div className="quickforge-settings-row">
              <div className="quickforge-settings-row-main">
                <div className="quickforge-settings-row-title">{t('cloudQuotaExpiresAt')}</div>
              </div>
              <div className="quickforge-settings-row-control text-sm text-muted-foreground">{formatDate(usage?.resetsAt || usage?.expiresAt)}</div>
            </div>
          </>
        ) : null}
      </div>

      {!status?.configured ? null : !connected ? (
        <div className="quickforge-settings-section">
          <div className="quickforge-settings-row">
            <div className="quickforge-settings-row-main">
              <div className="quickforge-settings-row-title"><Sparkles className="size-4" />{t('cloudTryModels')}</div>
              <div className="quickforge-settings-row-description">{t('cloudTryModelsDescription')}</div>
            </div>
            <div className="quickforge-settings-row-control">
              <Button onClick={() => void startGuest()} disabled={loading || Boolean(busy)}>{t('cloudStartGuest')}</Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="quickforge-settings-section">
            <div className="quickforge-settings-list-header">
              <div>
                <div className="quickforge-settings-row-title"><Laptop className="size-4" />{t('cloudDevices')}</div>
                <div className="quickforge-settings-row-description">{t('cloudDevicesDescription')}</div>
              </div>
            </div>
            {installations.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">{loading ? t('loading') : t('cloudNoDevices')}</div>
            ) : installations.map((item) => {
              const id = installationId(item)
              const current = item.current === true || id === status?.installationId
              return (
                <div key={id || installationName(item)} className="quickforge-settings-list-item">
                  <div className="quickforge-settings-list-item-main">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <div className="truncate text-sm font-medium">{installationName(item)}</div>
                      {current ? <span className="quickforge-settings-badge quickforge-settings-badge-info">{t('cloudCurrentDevice')}</span> : null}
                    </div>
                    <div className="quickforge-settings-row-description">
                      {[item.platform, item.clientVersion, item.lastSeenAt ? formatDate(item.lastSeenAt) : undefined].filter(Boolean).join(' · ') || t('cloudNotAvailable')}
                    </div>
                  </div>
                  <div className="quickforge-settings-list-item-actions">
                    <Button variant="outline" size="sm" onClick={() => void revoke(item)} disabled={current || Boolean(busy)}>{t('cloudRevokeDevice')}</Button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="quickforge-settings-section">
            <div className="quickforge-settings-row">
              <div className="quickforge-settings-row-main">
                <div className="quickforge-settings-row-title">{t('cloudLogout')}</div>
                <div className="quickforge-settings-row-description">{t('cloudLogoutRowDescription')}</div>
              </div>
              <div className="quickforge-settings-row-control">
                <Button variant="destructive" onClick={() => void logout()} disabled={Boolean(busy)}><LogOut className="mr-2 size-4" />{t('cloudLogout')}</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
