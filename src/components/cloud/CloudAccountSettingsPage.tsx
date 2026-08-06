import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Cloud, Copy, Database, ExternalLink, Laptop, LogIn, LogOut, RefreshCw, RotateCcw, Save, Server, ShieldCheck, TestTube2, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { showConfirm } from '@/components/ui/confirm-dialog'
import { CLOUD_STATE_CHANGED_EVENT } from '@/hooks/useCloudModels'
import {
  cancelCloudDeviceFlow,
  getCloudConfig,
  getCloudInstallations,
  getCloudModels,
  getCloudStatus,
  getCloudUsage,
  logoutCloud,
  pollCloudDeviceFlow,
  resetCloudIdentity,
  revokeCloudInstallation,
  startCloudDeviceFlow,
  testCloudConnection,
  updateCloudConfig,
  type CloudConnectionTest,
  type CloudInstallation,
  type CloudServiceConfig,
  type CloudStatus,
} from '@/lib/cloud-client'
import { cloudErrorMessage } from '@/lib/cloud-error-message'
import { getDateLocale, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { Api, Model } from '@earendil-works/pi-ai'
import {
  canRebuildCloudIdentity,
  cloudDetailsReducer,
  emptyCloudDetailsState,
  getCloudAccountContentVisibility,
  getCloudAccountViewState,
  loadCloudAccountDetails,
  rebuildCloudIdentityAndSaveUrl,
  type CloudDetailError,
} from './cloud-account-settings-state'

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

function detailError(kind: 'usage' | 'installations' | 'models', error: unknown): CloudDetailError {
  const fallback = kind === 'usage'
    ? 'cloudUsageLoadFailed'
    : kind === 'installations'
      ? 'cloudDevicesLoadFailed'
      : 'cloudModelsLoadFailed'
  const message = cloudErrorMessage(error)
  return {
    message: message === t('cloudRequestFailed') ? t(fallback) : message,
    unavailable: !('code' in Object(error)) || ['cloud_request_failed', 'cloud_unavailable'].includes(String((error as { code?: unknown })?.code || '')),
  }
}

function DetailFailure({ error, onRetry, disabled }: { error: CloudDetailError; onRetry: () => void; disabled: boolean }) {
  return (
    <div className="p-4 text-sm">
      <div className="quickforge-settings-error">{error.message}</div>
      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry} disabled={disabled}>
        <RefreshCw className="mr-2 size-4" />{t('retry')}
      </Button>
    </div>
  )
}

export function CloudAccountSettingsPage() {
  const [config, setConfig] = useState<CloudServiceConfig>()
  const [cloudUrl, setCloudUrl] = useState('')
  const [connectionTest, setConnectionTest] = useState<CloudConnectionTest>()
  const [status, setStatus] = useState<CloudStatus>()
  const [details, dispatchDetails] = useReducer(cloudDetailsReducer, emptyCloudDetailsState)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [switchWarning, setSwitchWarning] = useState('')
  const [now, setNow] = useState(0)
  const loadGenerationRef = useRef(0)
  const pendingDeviceFlow = status?.pendingDeviceFlow
  const deviceFlowSecondsLeft = pendingDeviceFlow ? Math.max(0, Math.ceil((pendingDeviceFlow.expiresAt - now) / 1_000)) : 0

  const clearDetails = useCallback(() => dispatchDetails({ type: 'clear' }), [])

  const load = useCallback(async (showLoading = true, preserveDraftUrl = false) => {
    const generation = ++loadGenerationRef.current
    if (showLoading) setLoading(true)
    setError('')
    dispatchDetails({ type: 'begin' })
    try {
      const [nextConfig, nextStatus] = await Promise.all([getCloudConfig(), getCloudStatus()])
      if (generation !== loadGenerationRef.current) return
      setConfig(nextConfig)
      if (!preserveDraftUrl) setCloudUrl(nextConfig.cloudUrl)
      setStatus(nextStatus)

      if (!nextStatus.configured || !nextStatus.hasSession || nextStatus.sessionServiceMismatch) {
        clearDetails()
        return
      }

      const nextDetails = await loadCloudAccountDetails({
        usage: getCloudUsage,
        installations: getCloudInstallations,
        models: getCloudModels,
      }, detailError)
      if (generation !== loadGenerationRef.current) return
      dispatchDetails({ type: 'replace', state: nextDetails })
    } catch (loadError) {
      if (generation !== loadGenerationRef.current) return
      setConfig(undefined)
      setStatus(undefined)
      clearDetails()
      setError(cloudErrorMessage(loadError, 'cloudLoadFailed'))
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false)
    }
  }, [clearDetails])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => {
      window.clearTimeout(timer)
      loadGenerationRef.current += 1
    }
  }, [load])

  useEffect(() => {
    if (!status?.pendingDeviceFlow) return
    const updateNow = () => setNow(Date.now())
    const initialTimer = window.setTimeout(updateNow, 0)
    const timer = window.setInterval(updateNow, 1_000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [status?.pendingDeviceFlow])

  useEffect(() => {
    const pending = status?.pendingDeviceFlow
    if (!pending || deviceFlowSecondsLeft > 0) return
    const timer = window.setTimeout(() => { void load(false) }, 0)
    return () => window.clearTimeout(timer)
  }, [deviceFlowSecondsLeft, load, status?.pendingDeviceFlow])

  useEffect(() => {
    const pending = status?.pendingDeviceFlow
    if (!pending || busy === 'device-start' || busy === 'device-cancel') return
    const delay = Math.max(1, Number(pending.interval) || 5) * 1_000
    const timer = window.setTimeout(async () => {
      try {
        const nextStatus = await pollCloudDeviceFlow()
        setStatus(nextStatus)
        if (nextStatus.deviceFlowResult === 'success') {
          window.dispatchEvent(new Event(CLOUD_STATE_CHANGED_EVENT))
          setError('')
          setMessage(t('cloudDeviceFlowSucceeded'))
          await load(false)
        } else if (nextStatus.deviceFlowResult === 'denied') {
          setError(t('cloudDeviceFlowDenied'))
        } else if (nextStatus.deviceFlowResult === 'expired') {
          setError(t('cloudDeviceFlowExpired'))
        } else if (nextStatus.deviceFlowResult === 'network') {
          setError(t('cloudDeviceFlowNetwork'))
        }
      } catch (pollError) {
        setError(cloudErrorMessage(pollError))
      }
    }, delay)
    return () => window.clearTimeout(timer)
  }, [busy, load, status?.pendingDeviceFlow])

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
      setSwitchWarning('')
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
    setSwitchWarning('')
    try {
      const result = await rebuildCloudIdentityAndSaveUrl(targetCloudUrl, {
        reset: resetCloudIdentity,
        save: updateCloudConfig,
        onIdentityReset: () => {
          loadGenerationRef.current += 1
          setStatus((current) => current ? { ...current, mode: 'local', hasSession: false, sessionServiceMismatch: false } : current)
          clearDetails()
          dispatchCloudChanged()
        },
      })
      if (result.status === 'url-save-failed') {
        const saveErrorMessage = cloudErrorMessage(result.error)
        setSwitchWarning(t('cloudIdentityRebuiltUrlSaveFailed'))
        await load(false, true)
        setError(saveErrorMessage)
        return
      }

      setConfig(result.config)
      setCloudUrl(result.config.cloudUrl)
      setConnectionTest(undefined)
      dispatchCloudChanged()
      setMessage(t('cloudForceSwitchSucceeded'))
      await load(false)
    } catch (switchError) {
      setError(cloudErrorMessage(switchError))
    } finally {
      setBusy('')
    }
  }

  const startDeviceFlow = async () => {
    if (busy) return
    setBusy('device-start')
    setMessage('')
    setError('')
    setSwitchWarning('')
    try {
      const nextStatus = await startCloudDeviceFlow()
      setStatus(nextStatus)
      dispatchCloudChanged()
    } catch (startError) {
      setError(cloudErrorMessage(startError))
    } finally {
      setBusy('')
    }
  }

  const cancelDeviceFlow = async () => {
    if (busy) return
    setBusy('device-cancel')
    setMessage('')
    setError('')
    try {
      const nextStatus = await cancelCloudDeviceFlow()
      setStatus(nextStatus)
      setMessage(t('cloudDeviceFlowCancelled'))
    } catch (cancelError) {
      setError(cloudErrorMessage(cancelError))
    } finally {
      setBusy('')
    }
  }

  const copyUserCode = async () => {
    const code = status?.pendingDeviceFlow?.userCode
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setMessage(t('cloudDeviceCodeCopied'))
    } catch {
      setError(t('copyFailed'))
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
    setSwitchWarning('')
    try {
      await logoutCloud()
      loadGenerationRef.current += 1
      clearDetails()
      setStatus((current) => current ? { ...current, mode: 'local', hasSession: false, sessionServiceMismatch: false } : current)
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
      dispatchDetails({ type: 'replace', state: { ...details, installations: details.installations.filter((candidate) => installationId(candidate) !== id) } })
      setMessage(t('cloudDeviceRevoked'))
    } catch (revokeError) {
      setError(cloudErrorMessage(revokeError))
    } finally {
      setBusy('')
    }
  }

  const hasSession = Boolean(status?.configured && status.hasSession)
  const needsIdentityRebuild = status?.sessionServiceMismatch === true
  const connected = hasSession && !needsIdentityRebuild
  const changedUrl = Boolean(config?.cloudUrl && cloudUrl.trim() && config.cloudUrl !== cloudUrl.trim())
  const viewState = getCloudAccountViewState({ loading, loadError: error, status, details })
  const contentVisibility = getCloudAccountContentVisibility(status)
  const cloudUnavailable = viewState === 'cloud-unavailable'
  const modeLabel = needsIdentityRebuild
    ? t('cloudSessionMismatchLabel')
    : status?.mode === 'account'
      ? t('cloudFormalAccount')
      : t('cloudNotConnected')

  const identityDescription = !status?.configured
    ? t('cloudNotConfiguredDescription')
    : needsIdentityRebuild
      ? t('cloudSessionServiceMismatch')
      : connected
        ? cloudUnavailable ? t('cloudUnavailableDescription') : t('cloudConnectedDescription')
        : t('cloudLocalOnlyDescription')

  const retryDetails = () => { void load() }
  const detailLoading = loading || details.loading

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

      {message ? <div className="quickforge-settings-message">{message}</div> : null}
      {switchWarning ? <div className="quickforge-settings-warning">{switchWarning}</div> : null}
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
            {canRebuildCloudIdentity(status, changedUrl) ? (
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
            <div className="quickforge-settings-row-description">{identityDescription}</div>
          </div>
          <div className="quickforge-settings-row-control">
            <span className={`quickforge-settings-badge ${connected && !cloudUnavailable ? 'quickforge-settings-badge-success' : needsIdentityRebuild || cloudUnavailable ? 'quickforge-settings-badge-warning' : 'quickforge-settings-badge-muted'}`}>{modeLabel}</span>
          </div>
        </div>
        {cloudUnavailable ? <div className="quickforge-settings-warning quickforge-settings-warning-attached">{t('cloudUnavailableDescription')}</div> : null}
        {needsIdentityRebuild ? <div className="quickforge-settings-warning quickforge-settings-warning-attached">{t('cloudSessionServiceMismatch')}</div> : null}
        {connected ? (
          <>
            {status?.mode === 'account' ? (
              <>
                <div className="quickforge-settings-row">
                  <div className="quickforge-settings-row-main"><div className="quickforge-settings-row-title">{t('cloudAccountEmail')}</div></div>
                  <div className="quickforge-settings-row-control text-sm font-medium">{status.account?.email || t('cloudNotAvailable')}</div>
                </div>
                <div className="quickforge-settings-row">
                  <div className="quickforge-settings-row-main"><div className="quickforge-settings-row-title">{t('cloudAccountPlan')}</div></div>
                  <div className="quickforge-settings-row-control text-sm font-medium">{status.account?.plan || t('cloudNotAvailable')}</div>
                </div>
              </>
            ) : null}
            {details.errors.usage ? (
              <DetailFailure error={details.errors.usage} onRetry={retryDetails} disabled={detailLoading || Boolean(busy)} />
            ) : (
              <>
                <div className="quickforge-settings-row">
                  <div className="quickforge-settings-row-main"><div className="quickforge-settings-row-title">{t('cloudRemainingQuota')}</div></div>
                  <div className="quickforge-settings-row-control text-sm font-medium">{usageValue(details.usage?.remaining)}</div>
                </div>
                <div className="quickforge-settings-row">
                  <div className="quickforge-settings-row-main"><div className="quickforge-settings-row-title">{t('cloudQuotaExpiresAt')}</div></div>
                  <div className="quickforge-settings-row-control text-sm text-muted-foreground">{formatDate(details.usage?.resetsAt || details.usage?.expiresAt)}</div>
                </div>
              </>
            )}
            <div className="quickforge-settings-row">
              <div className="quickforge-settings-row-main"><div className="quickforge-settings-row-title">{t('cloudLogout')}</div><div className="quickforge-settings-row-description">{t('cloudLogoutRowDescription')}</div></div>
              <div className="quickforge-settings-row-control"><Button variant="destructive" className="quickforge-settings-cloud-logout" onClick={() => void logout()} disabled={Boolean(busy)}><LogOut className="mr-2 size-4" />{t('cloudLogout')}</Button></div>
            </div>
          </>
        ) : null}
      </div>

      {!status?.configured ? null : contentVisibility.showDeviceFlow && pendingDeviceFlow ? (
        <div className="quickforge-settings-section">
          <div className="quickforge-settings-list-header">
            <div className="quickforge-settings-row-main">
              <div className="quickforge-settings-row-title"><UserRound className="size-4" />{t('cloudDeviceFlowTitle')}</div>
              <div className="quickforge-settings-row-description">{t('cloudDeviceFlowDescription')}</div>
            </div>
            <span className="quickforge-settings-badge quickforge-settings-badge-info">{t('cloudDeviceFlowCountdown', { seconds: deviceFlowSecondsLeft })}</span>
          </div>
          <div className="quickforge-settings-row items-start">
            <div className="quickforge-settings-row-main">
              <div className="quickforge-settings-row-description">{t('cloudDeviceCode')}</div>
              <div className="mt-1 font-mono text-2xl font-semibold tracking-[0.18em] text-foreground">{pendingDeviceFlow.userCode}</div>
            </div>
            <div className="quickforge-settings-row-control flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void copyUserCode()}><Copy className="mr-2 size-4" />{t('copy')}</Button>
              <Button size="sm" onClick={() => window.open(pendingDeviceFlow.verificationUriComplete || pendingDeviceFlow.verificationUri, '_blank', 'noopener,noreferrer')}><ExternalLink className="mr-2 size-4" />{t('cloudOpenVerificationPage')}</Button>
              <Button variant="outline" size="sm" onClick={() => void cancelDeviceFlow()} disabled={Boolean(busy)}>{t('cancel')}</Button>
            </div>
          </div>
          {status.deviceFlowResult === 'slow_down' ? <div className="quickforge-settings-warning quickforge-settings-warning-attached">{t('cloudDeviceFlowSlowDown')}</div> : null}
        </div>
      ) : contentVisibility.showDisconnectedActions ? (
        <div className="quickforge-settings-section">
          <div className="quickforge-settings-row">
            <div className="quickforge-settings-row-main"><div className="quickforge-settings-row-title"><UserRound className="size-4" />{t('cloudLoginOrRegister')}</div><div className="quickforge-settings-row-description">{t('cloudLoginOrRegisterDescription')}</div></div>
            <div className="quickforge-settings-row-control"><Button onClick={() => void startDeviceFlow()} disabled={loading || Boolean(busy)}><LogIn className="mr-2 size-4" />{t('cloudLoginOrRegister')}</Button></div>
          </div>
        </div>
      ) : contentVisibility.showDetails ? (
        <>
          <div className="quickforge-settings-section">
            <div className="quickforge-settings-list-header"><div className="quickforge-settings-row-title"><Database className="size-4" />{t('cloudModels')}</div></div>
            {details.errors.models ? <DetailFailure error={details.errors.models} onRetry={retryDetails} disabled={detailLoading || Boolean(busy)} /> : details.models.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">{detailLoading ? t('loading') : t('cloudNoModels')}</div> : details.models.map((model) => (
              <div key={`${model.provider}:${model.id}`} className="quickforge-settings-list-item">
                <div className="quickforge-settings-list-item-main"><div className="text-sm font-medium">{model.name || model.id}</div><div className="quickforge-settings-row-description">{model.id} · {modelCapabilities(model)}</div></div>
              </div>
            ))}
          </div>

          <div className="quickforge-settings-section">
            <div className="quickforge-settings-list-header"><div className="quickforge-settings-row-title"><Laptop className="size-4" />{t('cloudDevices')}</div></div>
            {details.errors.installations ? <DetailFailure error={details.errors.installations} onRetry={retryDetails} disabled={detailLoading || Boolean(busy)} /> : details.installations.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">{detailLoading ? t('loading') : t('cloudNoDevices')}</div> : details.installations.map((item) => {
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
      ) : null}
    </div>
  )
}
