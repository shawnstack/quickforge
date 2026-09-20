import { useEffect, useState } from 'react'
import { getDateLocale, t } from '@/lib/i18n'
import { showConfirm } from '@/components/ui/confirm-dialog'
import { InfoTip } from '@/components/ui/info-tip'
import { SettingsSwitch } from './shared'

function generateLanPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'
  return Array.from({ length: 16 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

type LanAccessDevice = {
  id: string
  address?: string
  userAgent?: string
  issuedAt?: string
  expiresAt?: string
}

type LanAccessStatus = {
  enabled: boolean
  hasPassword: boolean
  sessionTtlHours: number
  activeTokenCount?: number
  activeDevices?: LanAccessDevice[]
  lanUrls?: string[]
}

function deviceLabel(userAgent?: string) {
  if (!userAgent) return t('lanAccessUnknownDevice')
  const browser = userAgent.includes('Edg/')
    ? 'Edge'
    : userAgent.includes('Firefox/')
      ? 'Firefox'
      : userAgent.includes('Chrome/')
        ? 'Chrome'
        : userAgent.includes('Safari/')
          ? 'Safari'
          : t('lanAccessBrowser')
  const platform = /Android/i.test(userAgent)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? 'iOS'
      : /Windows/i.test(userAgent)
        ? 'Windows'
        : /Macintosh|Mac OS X/i.test(userAgent)
          ? 'macOS'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : ''
  return platform ? `${browser} · ${platform}` : browser
}

function formatDate(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat(getDateLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

async function requestLan<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : undefined),
      ...init?.headers,
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
  return payload as T
}

export function LanAccessSettingsTab({ active }: { active?: boolean } = {}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [hasPassword, setHasPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [sessionTtlHours, setSessionTtlHours] = useState(12)
  const [activeTokenCount, setActiveTokenCount] = useState(0)
  const [activeDevices, setActiveDevices] = useState<LanAccessDevice[]>([])
  const [lanUrls, setLanUrls] = useState<string[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const applyStatus = (status: LanAccessStatus) => {
    setEnabled(Boolean(status.enabled))
    setHasPassword(Boolean(status.hasPassword))
    setSessionTtlHours(Number(status.sessionTtlHours || 12))
    setActiveTokenCount(Number(status.activeTokenCount || 0))
    setActiveDevices(Array.isArray(status.activeDevices) ? status.activeDevices : [])
    setLanUrls(Array.isArray(status.lanUrls) ? status.lanUrls : [])
  }

  useEffect(() => {
    // 旧版元素常驻、切走仅 detach：重新激活时重新加载状态（password/passwordVisible 等草稿保留）。
    // 无 props（active === undefined）视为激活，保持既有直接调用语义。
    if (active === false) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError('')
      try {
        const status = await requestLan<LanAccessStatus>('/api/lan-access/status')
        if (cancelled) return
        applyStatus(status)
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

  const saveSettings = async () => {
    if (saving) return
    if (enabled && !hasPassword && !password.trim()) {
      setError(t('lanAccessPasswordRequired'))
      return
    }
    if (password.trim() && password.trim().length < 8) {
      setError(t('lanAccessPasswordTooShort'))
      return
    }
    if (enabled) {
      const confirmed = await showConfirm({
        description: t('lanAccessEnableConfirm'),
        confirmLabel: t('enabled'),
        cancelLabel: t('cancel'),
      })
      if (!confirmed) return
    }

    setSaving(true)
    setError('')
    setMessage('')
    try {
      const status = await requestLan<LanAccessStatus & { ok: boolean }>('/api/lan-access/settings', {
        method: 'PUT',
        body: JSON.stringify({
          enabled,
          password: password.trim() || undefined,
          sessionTtlHours,
        }),
      })
      applyStatus(status)
      setPassword('')
      setPasswordVisible(false)
      setMessage(t('lanAccessSaved'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setSaving(false)
    }
  }

  const revokeDevice = async (device: LanAccessDevice) => {
    const confirmed = await showConfirm({
      description: t('lanAccessRevokeDeviceConfirm', { device: deviceLabel(device.userAgent) }),
      confirmLabel: t('lanAccessRevokeDevice'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const status = await requestLan<LanAccessStatus & { ok: boolean }>('/api/lan-access/revoke', {
        method: 'POST',
        body: JSON.stringify({ id: device.id }),
      })
      applyStatus(status)
      setMessage(t('lanAccessDeviceRevoked'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setSaving(false)
    }
  }

  const revokeAll = async () => {
    const confirmed = await showConfirm({
      description: t('lanAccessRevokeAllConfirm'),
      confirmLabel: t('lanAccessRevokeAll'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const status = await requestLan<LanAccessStatus & { ok: boolean }>('/api/lan-access/revoke-all', { method: 'POST' })
      applyStatus(status)
      setMessage(t('lanAccessRevoked'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground">{t('loading')}</div>

  return (
    <div className="quickforge-settings-stack">
      <section className="quickforge-settings-section" aria-label={t('lanAccessStatus')}>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('lanAccessEnabled')}
              <InfoTip label={t('lanAccessEnabledDescription')} />
            </div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-readonly-value">
            {enabled ? t('enabled') : t('disabled')}
          </div>
        </div>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('lanAccessPassword')}
              <InfoTip label={t('lanAccessPasswordStatusDescription')} />
            </div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-readonly-value">
            {hasPassword ? t('configured') : t('notConfigured')}
          </div>
        </div>
        <div className="quickforge-settings-row quickforge-settings-row-top">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('lanAccessActiveDevices', { count: activeTokenCount })}
              <InfoTip label={t('lanAccessActiveDevicesDescription')} />
            </div>
          </div>
        </div>
        <div className="quickforge-settings-nested-list quickforge-lan-device-list">
          {activeDevices.length
            ? activeDevices.map((device) => (
              <div className="quickforge-settings-subrow" key={device.id}>
                <div className="quickforge-settings-list-item-main">
                  <div className="quickforge-settings-row-title">{deviceLabel(device.userAgent)}</div>
                  <div className="quickforge-settings-row-description quickforge-lan-device-meta">
                    <span>{device.address || t('lanAccessUnknownAddress')}</span>
                    <span>{t('lanAccessSignedInAt', { time: formatDate(device.issuedAt) })}</span>
                    <span>{t('lanAccessExpiresAt', { time: formatDate(device.expiresAt) })}</span>
                  </div>
                </div>
                <div className="quickforge-settings-list-item-actions">
                  <button
                    className="quickforge-settings-button quickforge-settings-button-danger quickforge-settings-button-compact"
                    type="button"
                    disabled={saving}
                    onClick={() => void revokeDevice(device)}
                  >
                    {t('lanAccessRevokeDevice')}
                  </button>
                </div>
              </div>
            ))
            : <div className="quickforge-settings-empty-row">{t('lanAccessNoActiveDevices')}</div>}
        </div>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('lanAccessUrls')}
              <InfoTip label={t('lanAccessUrlsDescription')} />
            </div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide quickforge-settings-readonly-value">
            {lanUrls.length ? lanUrls.map((url) => <div key={url}>{url}</div>) : '-'}
          </div>
        </div>
      </section>

      <section className="quickforge-settings-section" aria-label={t('lanAccess')}>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('lanAccessAllowFull')}
              <InfoTip label={t('lanAccessAllowFullDescription')} />
            </div>
          </div>
          <div className="quickforge-settings-row-control">
            <SettingsSwitch checked={enabled} onChange={setEnabled} disabled={saving} />
          </div>
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">{t('lanAccessPassword')}</div>
            <div className="quickforge-settings-row-description">
              {hasPassword ? t('lanAccessPasswordPlaceholderConfigured') : t('lanAccessPasswordPlaceholder')}
            </div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide quickforge-lan-password-control">
            <div className="quickforge-lan-password-input-wrap">
              <input
                className="quickforge-settings-input"
                type={passwordVisible ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                placeholder={hasPassword ? t('lanAccessPasswordPlaceholderConfigured') : t('lanAccessPasswordPlaceholder')}
              />
              <button
                className="quickforge-lan-password-toggle"
                type="button"
                aria-label={passwordVisible ? t('hidePassword') : t('showPassword')}
                title={passwordVisible ? t('hidePassword') : t('showPassword')}
                aria-pressed={passwordVisible ? 'true' : 'false'}
                onClick={() => setPasswordVisible(!passwordVisible)}
              >
                {passwordVisible
                  ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="m3 3 18 18" strokeLinecap="round"></path>
                      <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7"></path>
                      <path d="M9.9 4.3A10.9 10.9 0 0 1 12 4c5.5 0 9 5.3 9 8a7.3 7.3 0 0 1-1.5 3.2"></path>
                      <path d="M6.6 6.6C4.3 8.1 3 10.4 3 12c0 2.7 3.5 8 9 8 1.5 0 2.8-.4 4-1"></path>
                    </svg>
                  )
                  : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M3 12c0-2.7 3.5-8 9-8s9 5.3 9 8-3.5 8-9 8-9-5.3-9-8Z"></path>
                      <circle cx="12" cy="12" r="2.5"></circle>
                    </svg>
                  )}
              </button>
            </div>
            <button
              className="quickforge-settings-button quickforge-settings-button-secondary"
              type="button"
              onClick={() => setPassword(generateLanPassword())}
            >
              {t('generatePassword')}
            </button>
          </div>
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('lanAccessSessionTtl')}
              <InfoTip label={t('lanAccessSessionTtlDescription')} />
            </div>
          </div>
          <div className="quickforge-settings-row-control">
            <select
              className="quickforge-settings-select"
              value={String(sessionTtlHours)}
              onChange={(event) => setSessionTtlHours(Number(event.currentTarget.value) || 12)}
            >
              <option value="1">1 {t('hour')}</option>
              <option value="12">12 {t('hours')}</option>
              <option value="24">24 {t('hours')}</option>
              <option value="168">7 {t('days')}</option>
            </select>
          </div>
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('lanAccessActions')}
              <InfoTip label={t('lanAccessActionsDescription')} />
            </div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <button
              className="quickforge-settings-button quickforge-settings-button-primary"
              type="button"
              disabled={saving}
              onClick={() => void saveSettings()}
            >
              {saving ? t('saving') : t('save')}
            </button>
            <button
              className="quickforge-settings-button quickforge-settings-button-danger"
              type="button"
              disabled={saving}
              onClick={() => void revokeAll()}
            >
              {t('lanAccessRevokeAll')}
            </button>
          </div>
        </div>
      </section>

      {message ? <div className="quickforge-settings-message">{message}</div> : null}
      {error ? <div className="quickforge-settings-alert">{error}</div> : null}
    </div>
  )
}
