import { Capacitor } from '@capacitor/core'

const MOBILE_SERVER_STORAGE_KEY = 'quickforge:mobile-server-url'
const MOBILE_SERVER_SETTINGS_STORAGE_KEY = 'quickforge:mobile-server-settings:v1'
const MOBILE_SHELL_QUERY_KEY = 'quickforgeMobile'
const MOBILE_SHELL_SESSION_KEY = 'quickforge:mobile-shell'

export type MobileServerSettings = {
  urls: string[]
  lastUsedUrl: string
}

function isTailscaleIPv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127
}

function isTailscaleHostname(hostname: string): boolean {
  return hostname.toLowerCase().endsWith('.ts.net')
}

export function normalizeTailscaleServerUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('请输入 QuickForge 服务地址')

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  let url: URL
  try {
    url = new URL(withProtocol)
  } catch {
    throw new Error('服务地址格式不正确')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('服务地址只支持 HTTP 或 HTTPS')
  }
  if (url.username || url.password) throw new Error('服务地址不能包含用户名或密码')
  if (!isTailscaleHostname(url.hostname) && !isTailscaleIPv4(url.hostname)) {
    throw new Error('该服务器地址不受支持')
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('请输入服务根地址，不要附加路径、参数或锚点')
  }

  if (!url.port) url.port = '5176'
  return url.origin
}

function normalizeSavedUrls(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const urls: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    try {
      const normalized = normalizeTailscaleServerUrl(value)
      if (!urls.includes(normalized)) urls.push(normalized)
    } catch {
      // Ignore invalid saved entries.
    }
  }
  return urls
}

export function readMobileServerSettings(storage: Storage = window.localStorage): MobileServerSettings {
  try {
    const storedSettings = storage.getItem(MOBILE_SERVER_SETTINGS_STORAGE_KEY)
    if (storedSettings !== null) {
      try {
        const parsed = JSON.parse(storedSettings) as { urls?: unknown; lastUsedUrl?: unknown }
        const urls = normalizeSavedUrls(parsed?.urls)
        const normalizedLastUsedUrl = typeof parsed?.lastUsedUrl === 'string'
          ? normalizeSavedUrls([parsed.lastUsedUrl])[0] || ''
          : ''
        return {
          urls,
          lastUsedUrl: urls.includes(normalizedLastUsedUrl) ? normalizedLastUsedUrl : urls[0] || '',
        }
      } catch {
        // Fall back to the legacy single-server value.
      }
    }

    const legacyUrl = storage.getItem(MOBILE_SERVER_STORAGE_KEY)
    const normalizedLegacyUrl = legacyUrl ? normalizeSavedUrls([legacyUrl])[0] || '' : ''
    return normalizedLegacyUrl
      ? { urls: [normalizedLegacyUrl], lastUsedUrl: normalizedLegacyUrl }
      : { urls: [], lastUsedUrl: '' }
  } catch {
    return { urls: [], lastUsedUrl: '' }
  }
}

export function saveMobileServerSettings(settings: MobileServerSettings, storage: Storage = window.localStorage): void {
  const urls = normalizeSavedUrls(settings.urls)
  const normalizedLastUsedUrl = normalizeSavedUrls([settings.lastUsedUrl])[0] || ''
  const lastUsedUrl = urls.includes(normalizedLastUsedUrl) ? normalizedLastUsedUrl : urls[0] || ''
  storage.setItem(MOBILE_SERVER_SETTINGS_STORAGE_KEY, JSON.stringify({ urls, lastUsedUrl }))
  if (lastUsedUrl) {
    storage.setItem(MOBILE_SERVER_STORAGE_KEY, lastUsedUrl)
  } else {
    storage.removeItem(MOBILE_SERVER_STORAGE_KEY)
  }
}

export function buildMobileServerAppUrl(serverUrl: string): string {
  const url = new URL(serverUrl)
  url.searchParams.set(MOBILE_SHELL_QUERY_KEY, '1')
  return url.toString()
}

export function isNativeMobileEntry(): boolean {
  return Capacitor.isNativePlatform() && location.hostname === 'localhost'
}

export function isMobileShell(): boolean {
  const marked = new URLSearchParams(location.search).get(MOBILE_SHELL_QUERY_KEY) === '1'
  if (marked) {
    try {
      window.sessionStorage.setItem(MOBILE_SHELL_SESSION_KEY, '1')
    } catch {
      // Session storage is optional; the URL marker is enough for this page load.
    }
    return true
  }
  try {
    return window.sessionStorage.getItem(MOBILE_SHELL_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

export function isRemoteQuickForgeClient(): boolean {
  return !['localhost', '127.0.0.1', '::1'].includes(location.hostname)
}

export function openMobileServerPicker(): void {
  window.location.href = 'https://localhost/?connect=1'
}
