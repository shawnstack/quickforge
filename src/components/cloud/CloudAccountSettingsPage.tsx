import { useCallback, useEffect, useState } from 'react'
import { Cloud, Database, Laptop, LogOut, RefreshCw, RotateCcw, Save, Server, ShieldCheck, Sparkles, TestTube2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { showConfirm } from '@/components/ui/confirm-dialog'
import { CLOUD_STATE_CHANGED_EVENT } from '@/hooks/useCloudModels'
import {
  getCloudConfig,
  getCloudInstallations,
  getCloudModels,
  getCloudStatus,
  getCloudUsage,
  logoutCloud,
  resetCloudIdentity,
  revokeCloudInstallation,
  startCloudGuest,
  testCloudConnection,
  updateCloudConfig,
  type CloudConnectionTest,
  type CloudInstallation,
  type CloudServiceConfig,
  type CloudStatus,
  type CloudUsage,
} from '@/lib/cloud-client'
import { cloudErrorMessage } from '@/lib/cloud-error-message'
import { getDateLocale, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { Api, Model } from '@earendil-works/pi-ai'

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

function configSourceLabel(source?: CloudServiceConfig['source']) {
  if (source === 'saved') return t('cloudConfigSourceSaved')
  if (source === 'env') return t('cloudConfigSourceEnv')
  return t('cloudConfigSourceDefault')
}

function testState(value: unknown) {
  if (!value || typeof value !== 'object') return t('cloudConnectionUnknown')
  const record = value as Record<string, unknown>
  if (record.ok === true || record.status === 'ok' || record.ready === true) return t('cloudConnectionOk')
  return t('cloudConnectionError')
}

function testValueOk(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.ok === true || record.status === 'ok' || record.ready === true
}

function testBadge(label: string, value: unknown) {
  const text = testState(value)
  const tone = text === t('cloudConnectionUnknown')
    ? 'quickforge-settings-badge-muted'
    : testValueOk(value)
      ? 'quickforge-settings-badge-success'
      : 'quickforge-settings-badge-danger'
  return (
    <span className={cn('quickforge-settings-badge', tone)}>
      {label}: {text}
    </span>
  )
}

function modelCapabilities(model: Model<Api>) {
  const capabilities = (model as Model<Api> & { quickforgeCapabilities?: Record<string, boolean> }).quickforgeCapabilities
  return [
    capabilities?.tools ? t('cloudCapabilityTools') : undefined,
    capabilities?.vision ? t('cloudCapabilityVision') : undefined,
    capabilities?.reasoning ? t('cloudCapabilityReasoning') : undefined,
  ].filter(Boolean).join(' · ') || t('cloudCapabilityText')
}

export function CloudAccountSettingsPage() {
  const [config, setConfig] = useState<CloudServiceConfig>()
  const [cloudUrl, setCloudUrl] = useState('')
  const [connectionTest, setConnectionTest] = useState<CloudConnectionTest>()
  const [status, setStatus] = useState<CloudStatus>()
  const [usage, setUsage] = useState<CloudUsage>()
  const [installations, setInstallations] = useState<CloudInstallation[]>([])
  const [models, setModels] = useState<Model<Api>[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setError('')
    try {
      const [nextConfig, nextStatus] = await Promise.all([getCloudConfig(), getCloudStatus()])
      setConfig(nextConfig)
      setCloudUrl(nextConfig.cloudUrl)
      setStatus(nextStatus)
      if (nextStatus.configured && nextStatus.hasSession) {
        const [nextUsage, nextInstallations, nextModels] = await Promise.all([
          getCloudUsage(),
          getCloudInstallations(),
          getCloudModels(),
        ])
        setUsage(nextUsage)
        setInstallations(nextInstallations)
        setModels(nextModels)
      } else {
        setUsage(undefined)
        setInstallations([])
        setModels([])
      }
    } catch (loadError) {
      setError(cloudErrorMessage(loadError, 'cloudLoadFailed'))
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const dispatchCloudChanged = () => window.dispatchEvent(new Event(CLOUD_STATE_CHANGED_EVENT))

  const testConnection = async () => {
    if (busy) return
    setBusy('test')
    setMessage('')
    setError('')
    setConnectionTest(undefined)
    try {
      const result = await testCloudConnection(cloudUrl)
      setCloudUrl(result.cloudUrl)
      setConnectionTest(result)
      setMessage(t('cloudConnectionTestSucceeded'))
    } catch (testError) {
      setError(cloudErrorMessage(testError, 'cloudConnectionFailed'))
    } finally {
      setBusy('')
    }
  }

  const saveConnection = async () => {
    if (busy) return
    setBusy('save')
    setMessage('')
    setError('')
    try {
      const nextConfig = await updateCloudConfig(cloudUrl)
      setConfig(nextConfig)
      setCloudUrl(nextConfig.cloudUrl)
      setConnectionTest(undefined)
      dispatchCloudChanged()
      setMessage(t('cloudConnectionSaved'))
      await load(false)
    } catch (saveError) {
      setError(cloudErrorMessage(saveError))
    } finally {
      setBusy('')
    }
  }

  const forceResetAndSwitch = async () => {
    const targetCloudUrl = cloudUrl.trim() || config?.cloudUrl || ''
    const confirmed = await showConfirm({
      title: t('cloudForceSwitchTitle'),
      description: t('cloudForceSwitchDescription'),
      confirmLabel: t('cloudForceSwitchConfirm'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed || busy || !targetCloudUrl) return
    setBusy('force-switch')
    setMessage('')
    setError('')
    try {
      await resetCloudIdentity()
      dispatchCloudChanged()
      const nextConfig = await updateCloudConfig(targetCloudUrl)
      setConfig(nextConfig)
      setCloudUrl(nextConfig.cloudUrl)
      setConnectionTest(undefined)
      dispatchCloudChanged()
      setMessage(t('cloudForceSwitchSucceeded'))
      await load(false)
    } catch (switchError) {
      setError(cloudErrorMessage(switchError))
      await load(false)
    } finally {
      setBusy('')
    }
  }

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
      dispatchCloudChanged()
      setMessage(t('cloudGuestStarted'))
      await load(false)
    } catch (startError) {
      setError(cloudErrorMessage(startError))
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
      dispatchCloudChanged()
      setMessage(t('cloudLoggedOut'))
      await load(false)
    } catch (logoutError) {
      setError(cloudErrorMessage(logoutError))
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
      setError(cloudErrorMessage(revokeError))
    } finally {
      setBusy('')
    }
  }

  const connected = Boolean(status?.configured && status.hasSession)
  const needsIdentityRebuild = status?.sessionServiceMismatch === true
  const changedUrl = Boolean(config?.cloudUrl && cloudUrl.trim() && config.cloudUrl !== cloudUrl.trim())
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
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || Boolean(busy)} className="quickforge-settings-heading-action">
          <RefreshCw className={`mr-2 size-4 ${loading ? 'animate-spin' : ''}`} />{t('refresh')}
        </Button>
      </div>

      {message ? <div className="quickforge-settings-note">{message}</div> : null}
      {error ? <div className="quickforge-settings-error">{error}</div> : null}

      <div className="quickforge-settings-section">
        <div className="quickforge-settings-list-header">
          <div className="quickforge-settings-row-title"><Server className="size-4" />{t('cloudServiceConnection')}</div>
          <span className="quickforge-settings-badge quickforge-settings-badge-info shrink-0">QuickForge Cloud</span>
        </div>
        <div className="quickforge-settings-row items-start">
          <div className="quickforge-settings-row-main">
            <label className="quickforge-settings-row-title" htmlFor="quickforge-cloud-url">{t('cloudUrl')}</label>
            <div className="quickforge-settings-row-description">{t('cloudUrlDescription')}</div>
          </div>
          <div className="quickforge-settings-row-control w-full max-w-xl flex-col items-stretch gap-2">
            <Input
              id="quickforge-cloud-url"
              value={cloudUrl}
              onChange={(event) => setCloudUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && cloudUrl.trim() && changedUrl && !busy) {
                  event.preventDefault()
                  void saveConnection()
                }
              }}
              placeholder={t('cloudUrlPlaceholder')}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={Boolean(busy)}
            />
            <div className="text-xs text-muted-foreground">{t('cloudConfigSource')}: {configSourceLabel(config?.source)}</div>
            <div className="quickforge-settings-cloud-actions flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => void testConnection()} disabled={!cloudUrl.trim() || Boolean(busy)}>
                {busy === 'test' ? <RefreshCw className="mr-2 size-4 animate-spin" /> : <TestTube2 className="mr-2 size-4" />}
                {t('cloudTestConnection')}
              </Button>
              <Button size="sm" onClick={() => void saveConnection()} disabled={!cloudUrl.trim() || !changedUrl || Boolean(busy)}>
                {busy === 'save' ? <RefreshCw className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
                {t('saveChanges')}
              </Button>
            </div>
            {connected && (changedUrl || needsIdentityRebuild) ? (
              <div className="quickforge-settings-cloud-force-switch flex justify-end">
                <Button variant="destructive" size="sm" onClick={() => void forceResetAndSwitch()} disabled={Boolean(busy)} title={t('cloudForceSwitchDescription')}><RotateCcw className="mr-2 size-4" />{t('cloudForceSwitch')}</Button>
              </div>
            ) : null}
          </div>
        </div>
        {config?.configurationError ? <div className="quickforge-settings-error m-3">{t('cloudConfigurationError')}</div> : null}
        {connectionTest ? (
          <div className="quickforge-settings-row">
            <div className="quickforge-settings-row-main">
              <div className="quickforge-settings-row-title">{t('cloudConnectionTestResult')}</div>
              <div className="quickforge-settings-row-description break-all">{connectionTest.cloudUrl}</div>
            </div>
            <div className="quickforge-settings-row-control flex-wrap justify-end gap-1.5">
              {testBadge(t('cloudHealth'), connectionTest.health)}
              {testBadge(t('cloudReady'), connectionTest.ready)}
            </div>
          </div>
        ) : null}
      </div>

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
              <div className="quickforge-settings-row-main"><div className="quickforge-settings-row-title">{t('cloudRemainingQuota')}</div></div>
              <div className="quickforge-settings-row-control text-sm font-medium">{usageValue(usage?.remaining)}</div>
            </div>
            <div className="quickforge-settings-row">
              <div className="quickforge-settings-row-main"><div className="quickforge-settings-row-title">{t('cloudQuotaExpiresAt')}</div></div>
              <div className="quickforge-settings-row-control text-sm text-muted-foreground">{formatDate(usage?.resetsAt || usage?.expiresAt)}</div>
            </div>
            <div className="quickforge-settings-row">
              <div className="quickforge-settings-row-main"><div className="quickforge-settings-row-title">{t('cloudLogout')}</div><div className="quickforge-settings-row-description">{t('cloudLogoutRowDescription')}</div></div>
              <div className="quickforge-settings-row-control"><Button variant="destructive" className="quickforge-settings-cloud-logout" onClick={() => void logout()} disabled={Boolean(busy)}><LogOut className="mr-2 size-4" />{t('cloudLogout')}</Button></div>
            </div>
          </>
        ) : null}
      </div>

      {!status?.configured ? null : !connected ? (
        <div className="quickforge-settings-section">
          <div className="quickforge-settings-row">
            <div className="quickforge-settings-row-main"><div className="quickforge-settings-row-title"><Sparkles className="size-4" />{t('cloudTryModels')}</div></div>
            <div className="quickforge-settings-row-control"><Button onClick={() => void startGuest()} disabled={loading || Boolean(busy)}><Sparkles className="mr-2 size-4" />{t('cloudStartGuest')}</Button></div>
          </div>
        </div>
      ) : (
        <>
          <div className="quickforge-settings-section">
            <div className="quickforge-settings-list-header"><div className="quickforge-settings-row-title"><Database className="size-4" />{t('cloudModels')}</div></div>
            {models.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">{loading ? t('loading') : t('cloudNoModels')}</div> : models.map((model) => (
              <div key={`${model.provider}:${model.id}`} className="quickforge-settings-list-item">
                <div className="quickforge-settings-list-item-main"><div className="text-sm font-medium">{model.name || model.id}</div><div className="quickforge-settings-row-description">{model.id} · {modelCapabilities(model)}</div></div>
              </div>
            ))}
          </div>

          <div className="quickforge-settings-section">
            <div className="quickforge-settings-list-header"><div className="quickforge-settings-row-title"><Laptop className="size-4" />{t('cloudDevices')}</div></div>
            {installations.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">{loading ? t('loading') : t('cloudNoDevices')}</div> : installations.map((item) => {
              const id = installationId(item)
              const current = item.current === true || id === status?.installationId
              return (
                <div key={id || installationName(item)} className="quickforge-settings-list-item">
                  <div className="quickforge-settings-list-item-main"><div className="flex min-w-0 flex-wrap items-center gap-2"><div className="truncate text-sm font-medium">{installationName(item)}</div>{current ? <span className="quickforge-settings-badge quickforge-settings-badge-info">{t('cloudCurrentDevice')}</span> : null}</div><div className="quickforge-settings-row-description">{[item.platform, item.clientVersion, item.lastSeenAt ? formatDate(item.lastSeenAt) : undefined].filter(Boolean).join(' · ') || t('cloudNotAvailable')}</div></div>
                  <div className="quickforge-settings-list-item-actions"><Button variant="outline" size="sm" onClick={() => void revoke(item)} disabled={current || Boolean(busy)}>{t('cloudRevokeDevice')}</Button></div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
