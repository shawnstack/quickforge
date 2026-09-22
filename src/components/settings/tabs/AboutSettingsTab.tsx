import { useEffect, useState } from 'react'
import { getAppStorage } from '@/storage'
import { getDateLocale, t } from '@/lib/i18n'
import { showConfirm } from '@/components/ui/confirm-dialog'
import {
  DEFAULT_UPDATE_CHECK_SETTINGS,
  loadUpdateCheckSettings,
  saveUpdateCheckSettings,
  type UpdateCheckFrequency,
} from '@/lib/update-check-settings'
import { requestUpdateCheck } from '@/lib/update-check-poll'
import { InfoTip } from '@/components/ui/info-tip'

type AboutInfo = {
  name: string
  version: string
  repositoryUrl: string
  homepage?: string
  bugsUrl?: string
}

type UpdateInfo = AboutInfo & {
  channel?: 'npm-runtime'
  distribution?: 'npm'
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  localVersionIsNewer?: boolean
  installCommand: string
  releaseUrl?: string
  updateStarted?: boolean
  updaterPid?: number
  logFile?: string
  bootId?: string
}

type ServiceStatus = {
  ok: boolean
  bootId: string
  restartSupported?: boolean
  restartUnsupportedReason?: string | null
  isLocalRequest?: boolean
}

const UPDATE_TIMEOUT_MS = 180_000
const RESTART_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 1000
const QUICKFORGE_RELEASES_URL = 'https://github.com/shawnstack/quickforge/releases/latest'

function isDesktopApp() {
  if (typeof document === 'undefined') return false
  const desktopWindow = window as Window & { __quickforgeDesktopApp?: boolean }
  return document.body.classList.contains('quickforge-desktop-app') || desktopWindow.__quickforgeDesktopApp === true
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function translateSystemError(payload: { error?: string; code?: string } | null, fallback: string) {
  if (payload?.code === 'system_restart_requires_auth') return t('systemRestartRequiresAuth')
  if (payload?.code === 'system_update_requires_auth') return t('systemUpdateRequiresAuth')
  return payload?.error || fallback
}

const FREQUENCY_OPTIONS: { value: UpdateCheckFrequency; label: () => string }[] = [
  { value: 'startup', label: () => t('frequencyStartup') },
  { value: 'daily', label: () => t('frequencyDaily') },
  { value: 'weekly', label: () => t('frequencyWeekly') },
  { value: 'off', label: () => t('frequencyOff') },
]

export function AboutSettingsTab({ active }: { active?: boolean } = {}) {
  const [about, setAbout] = useState<AboutInfo | undefined>(undefined)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [frequency, setFrequency] = useState<UpdateCheckFrequency>(DEFAULT_UPDATE_CHECK_SETTINGS.frequency)
  const [lastCheckAt, setLastCheckAt] = useState<string | null>(null)
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | undefined>(undefined)

  const loadServiceStatus = async () => {
    const response = await fetch('/api/health', { cache: 'no-store' })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
    return payload as ServiceStatus
  }

  useEffect(() => {
    // 旧版元素常驻、切走仅 detach：重新激活时重新加载版本信息（message/进行中提示保留）。
    // 无 props（active === undefined）视为激活，保持既有直接调用语义。
    if (active === false) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError('')
      try {
        const response = await fetch('/api/system/about', { cache: 'no-store' })
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
        if (cancelled) return
        setAbout(payload as AboutInfo)
        try {
          const [settings, status] = await Promise.all([
            loadUpdateCheckSettings(getAppStorage()),
            loadServiceStatus(),
          ])
          if (cancelled) return
          setFrequency(settings.frequency)
          setLastCheckAt(settings.lastCheckAt)
          setServiceStatus(status)
        } catch {
          // ignore — defaults are fine
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('requestFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active])

  const checkUpdate = async () => {
    if (checking || updating) return

    if (isDesktopApp()) {
      window.open(QUICKFORGE_RELEASES_URL, '_blank', 'noopener,noreferrer')
      setMessage(t('desktopUpdateHint'))
      setError('')
      return
    }

    setChecking(true)
    setMessage('')
    setError('')

    try {
      // 手动检查带 force=1 跳过服务端缓存；接口立即返回快照，这里轮询到终态。
      const outcome = await requestUpdateCheck({
        force: true,
        intervalMs: POLL_INTERVAL_MS,
      })
      if (outcome.kind !== 'ok') throw new Error(outcome.message || t('updateCheckFailed'))
      const payload = outcome.payload
      setUpdateInfo(payload as UpdateInfo)
      setAbout(payload as AboutInfo)

      if ((payload as UpdateInfo).updateAvailable) {
        setMessage(t('updateAvailableMessage', {
          current: (payload as UpdateInfo).currentVersion,
          latest: (payload as UpdateInfo).latestVersion,
        }))
      } else if ((payload as UpdateInfo).localVersionIsNewer) {
        setMessage(t('localVersionNewerMessage', {
          current: (payload as UpdateInfo).currentVersion,
          latest: (payload as UpdateInfo).latestVersion,
        }))
      } else {
        setMessage(t('alreadyLatestVersion', { version: (payload as UpdateInfo).currentVersion }))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('updateCheckFailed'))
    } finally {
      setChecking(false)
    }
  }

  const pollUntilUpdated = async (previousBootId?: string) => {
    const started = Date.now()

    while (Date.now() - started < UPDATE_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS)
      try {
        const response = await fetch(`/api/health?updatePoll=${Date.now()}`, { cache: 'no-store' })
        const payload = await response.json().catch(() => null) as ServiceStatus | null
        if (response.ok && payload?.ok && payload.bootId && payload.bootId !== previousBootId) {
          setMessage(t('updateRestarted'))
          window.setTimeout(() => window.location.reload(), 300)
          return
        }
      } catch {
        // Expected while the local service is updating and restarting.
      }
    }

    throw new Error(t('updateRestartTimeout'))
  }

  const pollUntilRestarted = async (previousBootId?: string) => {
    const started = Date.now()

    while (Date.now() - started < RESTART_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS)
      try {
        const response = await fetch(`/api/health?restartPoll=${Date.now()}`, { cache: 'no-store' })
        const payload = await response.json().catch(() => null) as ServiceStatus | null
        if (response.ok && payload?.ok && payload.bootId && payload.bootId !== previousBootId) {
          setMessage(t('backendRestarted'))
          window.setTimeout(() => window.location.reload(), 300)
          return
        }
      } catch {
        // Expected while the local service is restarting.
      }
    }

    throw new Error(t('backendRestartTimeout'))
  }

  const restartService = async () => {
    if (!serviceStatus || restarting) return
    const confirmed = await showConfirm({
      description: t('restartBackendConfirm'),
      confirmLabel: t('restartBackendService'),
      cancelLabel: t('cancel'),
    })
    if (!confirmed) return

    setRestarting(true)
    setMessage(t('backendRestarting'))
    setError('')

    const previousBootId = serviceStatus.bootId

    try {
      const response = await fetch('/api/system/restart', {
        method: 'POST',
        headers: { 'x-quickforge-action': 'restart' },
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(translateSystemError(payload, t('backendRestartFailed')))
      await pollUntilRestarted(previousBootId)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('backendRestartFailed'))
      setMessage('')
      setRestarting(false)
    }
  }

  const updateQuickForge = async () => {
    if (isDesktopApp()) {
      window.open(QUICKFORGE_RELEASES_URL, '_blank', 'noopener,noreferrer')
      setMessage(t('desktopUpdateHint'))
      setError('')
      return
    }

    if (!updateInfo?.updateAvailable || updating) return

    const confirmed = await showConfirm({
      description: t('updateConfirm', { command: updateInfo.installCommand }),
      confirmLabel: t('updateRuntimeNow'),
      cancelLabel: t('cancel'),
    })
    if (!confirmed) return

    setUpdating(true)
    setMessage(t('updatingQuickForge'))
    setError('')

    try {
      const response = await fetch('/api/system/update', {
        method: 'POST',
        headers: { 'x-quickforge-action': 'update' },
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(translateSystemError(payload, t('updateFailed')))
      setUpdateInfo(payload as UpdateInfo)
      if (payload?.updateStarted) {
        const logHint = payload.logFile ? ` ${t('updateLogFile', { path: payload.logFile })}` : ''
        setMessage(`${t('updateStarted')}${logHint}`)
        await pollUntilUpdated(payload.bootId)
      } else {
        setMessage(payload?.updated
          ? t('updateCompleted')
          : t('alreadyLatestVersion', { version: payload?.currentVersion || about?.version || '-' }))
        setUpdating(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('updateFailed'))
      setMessage('')
      setUpdating(false)
    }
  }

  const selectFrequency = async (next: UpdateCheckFrequency) => {
    if (frequency === next) return
    setFrequency(next)
    try {
      const storage = getAppStorage()
      const settings = await loadUpdateCheckSettings(storage)
      await saveUpdateCheckSettings(storage, { ...settings, frequency: next })
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  const renderFrequencyOption = (option: { value: UpdateCheckFrequency; label: () => string }) => {
    const selected = frequency === option.value
    return (
      <button
        key={option.value}
        type="button"
        className={`quickforge-settings-segmented-option${selected ? ' quickforge-settings-segmented-option-active' : ''}`}
        aria-pressed={selected ? 'true' : 'false'}
        onClick={() => void selectFrequency(option.value)}
      >
        {option.label()}
      </button>
    )
  }

  const infoRows = () => {
    if (!about) return null

    return (
      <>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('packageName')}
              <InfoTip label={t('packageNameDescription')} />
            </div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-readonly-value">{about.name}</div>
        </div>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('currentVersion')}
              <InfoTip label={t('currentVersionDescription')} />
            </div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-readonly-value">{about.version}</div>
        </div>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('github')}
              <InfoTip label={t('githubDescription')} />
            </div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide quickforge-settings-readonly-value">
            <a className="quickforge-settings-link" href={about.repositoryUrl} target="_blank" rel="noreferrer">
              {about.repositoryUrl}
            </a>
          </div>
        </div>
      </>
    )
  }

  const updateStatus = () => {
    if (!updateInfo) return null

    return (
      <>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('latestVersion')}
              <InfoTip label={t('latestVersionDescription')} />
            </div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-readonly-value">{updateInfo.latestVersion}</div>
        </div>
        {updateInfo.logFile ? (
          <div className="quickforge-settings-row">
            <div className="quickforge-settings-row-main">
              <div className="quickforge-settings-row-title">
                {t('updateLog')}
                <InfoTip label={t('updateLogDescription')} />
              </div>
            </div>
            <div className="quickforge-settings-row-control quickforge-settings-row-control-wide quickforge-settings-readonly-value">
              <code>{updateInfo.logFile}</code>
            </div>
          </div>
        ) : null}
      </>
    )
  }

  const restartSection = () => {
    const unsupportedReason = serviceStatus?.restartUnsupportedReason || t('backendRestartUnsupported')
    const restartDisabled = restarting || !serviceStatus?.restartSupported

    return (
      <section className="quickforge-settings-section" aria-label={t('restartBackendService')}>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('restartBackendService')}
              <InfoTip label={t('restartBackendServiceDescription')} />
            </div>
            {serviceStatus?.restartSupported ? null : (
              <div className="quickforge-settings-row-description">{unsupportedReason}</div>
            )}
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <button
              className="quickforge-settings-button quickforge-settings-button-danger"
              type="button"
              disabled={restartDisabled}
              onClick={() => void restartService()}
            >
              {restarting ? t('backendRestarting') : t('restartBackendService')}
            </button>
          </div>
        </div>
      </section>
    )
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('loading')}</div>
  }

  const updateDisabled = checking || updating || !updateInfo?.updateAvailable
  const desktopApp = isDesktopApp()

  return (
    <div className="quickforge-settings-stack">
      <section className="quickforge-settings-section" aria-label={t('projectInfo')}>
        {infoRows()}
      </section>

      <section className="quickforge-settings-section" aria-label={desktopApp ? t('desktopUpdates') : t('runtimeUpdates')}>
        {desktopApp ? null : (
          <>
            <div className="quickforge-settings-row">
              <div className="quickforge-settings-row-main">
                <div className="quickforge-settings-row-title">
                  {t('updateFrequencySection')}
                  <InfoTip label={t('updateFrequencyDescription')} />
                </div>
                <div className="quickforge-settings-row-description">
                  {lastCheckAt
                    ? t('lastCheckedAt', { time: new Date(lastCheckAt).toLocaleString(getDateLocale()) })
                    : t('lastCheckedNever')}
                </div>
              </div>
              <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
                <div
                  className="quickforge-settings-segmented quickforge-settings-segmented-wrap"
                  role="group"
                  aria-label={t('updateFrequencySection')}
                >
                  {FREQUENCY_OPTIONS.map((option) => renderFrequencyOption(option))}
                </div>
              </div>
            </div>

            {updateStatus()}
          </>
        )}

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {desktopApp ? t('desktopUpdates') : t('runtimeUpdates')}
              <InfoTip label={desktopApp ? t('desktopUpdatesDescription') : t('runtimeUpdatesDescription')} />
            </div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <button
              className="quickforge-settings-button quickforge-settings-button-secondary"
              type="button"
              disabled={checking || updating}
              onClick={() => void checkUpdate()}
            >
              {checking ? t('checkingUpdate') : (desktopApp ? t('openDesktopReleases') : t('checkRuntimeUpdate'))}
            </button>
            {desktopApp ? null : (
              <button
                className="quickforge-settings-button quickforge-settings-button-primary"
                type="button"
                disabled={updateDisabled}
                onClick={() => void updateQuickForge()}
              >
                {updating ? t('updatingQuickForge') : t('updateRuntimeNow')}
              </button>
            )}
          </div>
        </div>
      </section>

      {restartSection()}

      {message ? <div className="quickforge-settings-message">{message}</div> : null}
      {error ? <div className="quickforge-settings-alert">{error}</div> : null}
    </div>
  )
}
