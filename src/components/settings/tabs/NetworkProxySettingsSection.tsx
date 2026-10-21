import { useEffect, useRef, useState } from 'react'
import { t } from '@/lib/i18n'
import { InfoTip } from '@/components/ui/info-tip'

type NetworkProxyMode = 'direct' | 'system' | 'manual' | 'pac'

type NetworkProxyState = {
  config: {
    mode: NetworkProxyMode
    proxyUrl: string
  }
  status: {
    effectiveMode: NetworkProxyMode | 'unsupported'
    supported: boolean
    source: string
    runtimeKind: string
    features?: {
      pac?: boolean
      pacUrl?: boolean
      wpad?: boolean
      socks?: boolean
    }
    error?: string
  }
}

export function NetworkProxySettingsSection({ active }: { active?: boolean } = {}) {
  const [networkProxyMode, setNetworkProxyMode] = useState<NetworkProxyMode>('direct')
  const [networkProxyUrl, setNetworkProxyUrl] = useState('')
  const [savedNetworkProxyConfig, setSavedNetworkProxyConfig] = useState({ mode: 'direct' as NetworkProxyMode, proxyUrl: '' })
  const [networkProxyStatus, setNetworkProxyStatus] = useState<NetworkProxyState['status'] | null>(null)
  const [networkProxySaving, setNetworkProxySaving] = useState(false)
  const [networkProxyLoaded, setNetworkProxyLoaded] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const networkProxyRef = useRef({ mode: networkProxyMode, url: networkProxyUrl, saving: networkProxySaving, loaded: networkProxyLoaded, status: networkProxyStatus })

  const markSaved = (text: string) => {
    setMessage(text)
    setError('')
  }

  const loadNetworkProxy = async () => {
    try {
      const response = await fetch('/api/system/network-proxy', { cache: 'no-store' })
      const payload = await response.json().catch(() => null) as NetworkProxyState | null
      if (!response.ok) throw new Error((payload as { error?: string } | null)?.error || t('requestFailed'))
      const mode = payload?.config?.mode || 'direct'
      const url = payload?.config?.proxyUrl || ''
      setNetworkProxyMode(mode)
      setNetworkProxyUrl(url)
      setSavedNetworkProxyConfig({ mode, proxyUrl: url })
      setNetworkProxyStatus(payload?.status || null)
      setNetworkProxyLoaded(true)
      networkProxyRef.current = { ...networkProxyRef.current, mode, url, status: payload?.status || null, loaded: true }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  useEffect(() => {
    // Re-read the system proxy whenever the panel becomes visible again.
    if (active === false) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadNetworkProxy()
  }, [active])

  const updateNetworkProxyMode = (mode: NetworkProxyMode) => {
    const proxy = networkProxyRef.current
    if (proxy.mode === mode || proxy.saving || !proxy.loaded) return
    if (mode === 'pac' && proxy.status?.features?.pacUrl !== true) return
    setNetworkProxyMode(mode)
    networkProxyRef.current = { ...proxy, mode }
    setMessage('')
    setError('')
    if (mode === 'manual' || mode === 'pac') return
    void saveNetworkProxy()
  }

  const updateNetworkProxyUrl = (value: string) => {
    setNetworkProxyUrl(value)
    networkProxyRef.current = { ...networkProxyRef.current, url: value }
    setMessage('')
  }

  const networkProxyValidationError = (proxy = { mode: networkProxyMode, url: networkProxyUrl }) => {
    const value = proxy.url.trim()
    const isPac = proxy.mode === 'pac'
    if (!value) return t(isPac ? 'networkProxyPacUrlRequired' : 'networkProxyAddressRequired')
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol)) {
        return t(isPac ? 'networkProxyPacUrlProtocolError' : 'networkProxyAddressProtocolError')
      }
      if (!url.hostname) return t(isPac ? 'networkProxyPacUrlHostError' : 'networkProxyAddressPortError')
      if (!isPac && !url.port) return t('networkProxyAddressPortError')
      if (url.username || url.password) {
        return t(isPac ? 'networkProxyPacUrlCredentialsError' : 'networkProxyAddressCredentialsError')
      }
      if (isPac && url.hash) return t('networkProxyPacUrlFragmentError')
      if (!isPac && ((url.pathname && url.pathname !== '/') || url.search || url.hash)) {
        return t('networkProxyAddressPathError')
      }
      return ''
    } catch {
      return t(isPac ? 'networkProxyPacUrlInvalid' : 'networkProxyAddressInvalid')
    }
  }

  const saveNetworkProxy = async () => {
    const proxy = networkProxyRef.current
    if (proxy.saving || !proxy.loaded) return
    if (proxy.mode === 'pac' && proxy.status?.features?.pacUrl !== true) {
      setMessage('')
      setError(t('networkProxyPacUnsupported'))
      return
    }
    if (proxy.mode === 'manual' || proxy.mode === 'pac') {
      const validationError = networkProxyValidationError(proxy)
      if (validationError) {
        setMessage('')
        setError(validationError)
        return
      }
    }
    setNetworkProxySaving(true)
    networkProxyRef.current = { ...proxy, saving: true }
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/system/network-proxy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: proxy.mode, proxyUrl: proxy.url }),
      })
      const payload = await response.json().catch(() => null) as NetworkProxyState | null
      if (!response.ok) throw new Error((payload as { error?: string } | null)?.error || t('requestFailed'))
      const mode = payload?.config?.mode || proxy.mode
      const url = payload?.config?.proxyUrl || ''
      setNetworkProxyMode(mode)
      setNetworkProxyUrl(url)
      setSavedNetworkProxyConfig({ mode, proxyUrl: url })
      setNetworkProxyStatus(payload?.status || null)
      networkProxyRef.current = { mode, url, saving: false, loaded: true, status: payload?.status || null }
      markSaved(t('networkProxySaved'))
    } catch (err) {
      setNetworkProxyMode(savedNetworkProxyConfig.mode)
      setNetworkProxyUrl(savedNetworkProxyConfig.proxyUrl)
      networkProxyRef.current = { ...networkProxyRef.current, mode: savedNetworkProxyConfig.mode, url: savedNetworkProxyConfig.proxyUrl }
      setMessage('')
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setNetworkProxySaving(false)
      networkProxyRef.current = { ...networkProxyRef.current, saving: false }
    }
  }

  const refreshNetworkProxy = async () => {
    const proxy = networkProxyRef.current
    if (proxy.saving || !proxy.loaded) return
    setNetworkProxySaving(true)
    networkProxyRef.current = { ...proxy, saving: true }
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/system/network-proxy/refresh', { method: 'POST' })
      const payload = await response.json().catch(() => null) as NetworkProxyState | null
      if (!response.ok) throw new Error((payload as { error?: string } | null)?.error || t('requestFailed'))
      setNetworkProxyStatus(payload?.status || null)
      networkProxyRef.current = { ...networkProxyRef.current, status: payload?.status || null }
      markSaved(t('networkProxyRefreshed'))
    } catch (err) {
      setMessage('')
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setNetworkProxySaving(false)
      networkProxyRef.current = { ...networkProxyRef.current, saving: false }
    }
  }

  const renderNetworkProxyModeOption = (mode: NetworkProxyMode, label: string) => {
    const selected = networkProxyMode === mode
    const unsupported = mode === 'pac' && networkProxyStatus?.features?.pacUrl !== true
    return (
      <button
        key={mode}
        type="button"
        className={`quickforge-settings-segmented-option${selected ? ' quickforge-settings-segmented-option-active' : ''}`}
        aria-pressed={selected ? 'true' : 'false'}
        title={unsupported ? t('networkProxyPacUnsupported') : ''}
        disabled={networkProxySaving || !networkProxyLoaded || unsupported}
        onClick={() => updateNetworkProxyMode(mode)}
      >
        {label}
      </button>
    )
  }

  const hasProxyUrlInput = networkProxyMode === 'manual' || networkProxyMode === 'pac'
  const pacUnsupported = networkProxyMode === 'pac' && networkProxyStatus?.features?.pacUrl !== true
  const proxyValidationError = hasProxyUrlInput ? networkProxyValidationError() : ''
  const hasUnsavedProxyUrl = hasProxyUrlInput && (
    networkProxyUrl !== savedNetworkProxyConfig.proxyUrl
    || savedNetworkProxyConfig.mode !== networkProxyMode
  )
  const statusText = !networkProxyLoaded
    ? t('networkProxyLoadFailed')
    : pacUnsupported
      ? t('networkProxyPacUnsupported')
      : networkProxyStatus?.supported === false
        ? networkProxyStatus.error || t('networkProxyUnsupported')
        : t('networkProxyStatus', {
            source: networkProxyStatus?.source || t('unknown'),
            runtime: networkProxyStatus?.runtimeKind || t('unknown'),
          })

  return (
    <>
      <section className="quickforge-settings-section" aria-label={t('networkConnection')}>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('networkProxyMode')}
              <InfoTip label={t('networkProxyDescription')} />
            </div>
            <div className="quickforge-settings-row-description">{statusText}</div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <div className="quickforge-settings-segmented quickforge-settings-segmented-wrap" role="group" aria-label={t('networkProxyMode')}>
              {renderNetworkProxyModeOption('direct', t('networkProxyDirect'))}
              {renderNetworkProxyModeOption('system', t('networkProxySystem'))}
              {renderNetworkProxyModeOption('manual', t('networkProxyManual'))}
              {renderNetworkProxyModeOption('pac', t('networkProxyPac'))}
            </div>
          </div>
        </div>

        {hasProxyUrlInput
          ? (
            <div className="quickforge-settings-row">
              <div className="quickforge-settings-row-main">
                <div className="quickforge-settings-row-title">
                  {t(networkProxyMode === 'pac' ? 'networkProxyPacUrl' : 'networkProxyAddress')}
                  <InfoTip label={t(networkProxyMode === 'pac' ? 'networkProxyPacUrlDescription' : 'networkProxyAddressDescription')} />
                </div>
              </div>
              <div className="quickforge-settings-row-control quickforge-settings-row-control-wide quickforge-network-proxy-control">
                <input
                  id="quickforge-network-proxy-url"
                  className="quickforge-settings-input quickforge-settings-mono"
                  type="url"
                  aria-label={t(networkProxyMode === 'pac' ? 'networkProxyPacUrl' : 'networkProxyAddress')}
                  aria-invalid={hasUnsavedProxyUrl && proxyValidationError ? 'true' : 'false'}
                  value={networkProxyUrl}
                  placeholder={networkProxyMode === 'pac' ? 'https://example.com/proxy.pac' : 'http://127.0.0.1:7890'}
                  disabled={networkProxySaving || !networkProxyLoaded || pacUnsupported}
                  onChange={(event) => updateNetworkProxyUrl(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && networkProxyUrl.trim()) {
                      event.preventDefault()
                      void saveNetworkProxy()
                    }
                  }}
                />
                <button
                  className="quickforge-settings-button quickforge-settings-button-primary"
                  type="button"
                  disabled={networkProxySaving || !networkProxyLoaded || pacUnsupported || Boolean(proxyValidationError) || !hasUnsavedProxyUrl}
                  onClick={() => void saveNetworkProxy()}
                >
                  {networkProxySaving ? t('saving') : t('networkProxySave')}
                </button>
              </div>
            </div>
          )
          : null}

        {networkProxyMode === 'system'
          ? (
            <div className="quickforge-settings-row">
              <div className="quickforge-settings-row-main">
                <div className="quickforge-settings-row-title">
                  {t('networkProxyRefresh')}
                  <InfoTip label={t('networkProxyRefreshDescription')} />
                </div>
              </div>
              <div className="quickforge-settings-row-control">
                <button
                  className="quickforge-settings-button"
                  type="button"
                  disabled={networkProxySaving || !networkProxyLoaded}
                  onClick={() => void refreshNetworkProxy()}
                >
                  {networkProxySaving ? t('saving') : t('networkProxyRefresh')}
                </button>
              </div>
            </div>
          )
          : null}
      </section>
      {message ? <div className="quickforge-settings-message" role="status">{message}</div> : null}
      {error ? <div className="quickforge-settings-alert" role="alert">{error}</div> : null}
    </>
  )
}
