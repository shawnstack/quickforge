import { Capacitor } from '@capacitor/core'

const MOBILE_SERVER_STORAGE_KEY = 'quickforge:mobile-server-url'
const MOBILE_SERVER_SETTINGS_STORAGE_KEY = 'quickforge:mobile-server-settings:v1'
const MOBILE_SHELL_QUERY_KEY = 'quickforgeMobile'
const MOBILE_SHELL_SESSION_KEY = 'quickforge:mobile-shell'
// Carries the alias for the currently connected server from the native settings
// page (https://localhost) to the remote QuickForge page (different origin, so
// localStorage is not shared there).
const MOBILE_SHELL_ALIAS_QUERY_KEY = 'quickforgeAlias'

export type MobileServerSettings = {
  urls: string[]
  lastUsedUrl: string
  /** 服务器地址 → 用户设置的别名（仅保留规范化后仍有效的地址）。 */
  aliases?: Record<string, string>
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

function normalizeSavedAliases(values: unknown, urls: string[]): Record<string, string> {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) return {}
  const aliases: Record<string, string> = {}
  for (const [key, raw] of Object.entries(values)) {
    if (typeof raw !== 'string') continue
    const alias = raw.trim()
    if (!alias) continue
    const normalizedKey = normalizeSavedUrls([key])[0]
    if (!normalizedKey || !urls.includes(normalizedKey)) continue
    aliases[normalizedKey] = alias
  }
  return aliases
}

export function readMobileServerSettings(storage: Storage = window.localStorage): MobileServerSettings {
  try {
    const storedSettings = storage.getItem(MOBILE_SERVER_SETTINGS_STORAGE_KEY)
    if (storedSettings !== null) {
      try {
        const parsed = JSON.parse(storedSettings) as { urls?: unknown; lastUsedUrl?: unknown; aliases?: unknown }
        const urls = normalizeSavedUrls(parsed?.urls)
        const normalizedLastUsedUrl = typeof parsed?.lastUsedUrl === 'string'
          ? normalizeSavedUrls([parsed.lastUsedUrl])[0] || ''
          : ''
        return {
          urls,
          lastUsedUrl: urls.includes(normalizedLastUsedUrl) ? normalizedLastUsedUrl : urls[0] || '',
          aliases: normalizeSavedAliases(parsed?.aliases, urls),
        }
      } catch {
        // Fall back to the legacy single-server value.
      }
    }

    const legacyUrl = storage.getItem(MOBILE_SERVER_STORAGE_KEY)
    const normalizedLegacyUrl = legacyUrl ? normalizeSavedUrls([legacyUrl])[0] || '' : ''
    return normalizedLegacyUrl
      ? { urls: [normalizedLegacyUrl], lastUsedUrl: normalizedLegacyUrl, aliases: {} }
      : { urls: [], lastUsedUrl: '', aliases: {} }
  } catch {
    return { urls: [], lastUsedUrl: '', aliases: {} }
  }
}

export function saveMobileServerSettings(settings: MobileServerSettings, storage: Storage = window.localStorage): void {
  const urls = normalizeSavedUrls(settings.urls)
  const normalizedLastUsedUrl = normalizeSavedUrls([settings.lastUsedUrl])[0] || ''
  const lastUsedUrl = urls.includes(normalizedLastUsedUrl) ? normalizedLastUsedUrl : urls[0] || ''
  const aliases = normalizeSavedAliases(settings.aliases, urls)
  storage.setItem(MOBILE_SERVER_SETTINGS_STORAGE_KEY, JSON.stringify({ urls, lastUsedUrl, aliases }))
  if (lastUsedUrl) {
    storage.setItem(MOBILE_SERVER_STORAGE_KEY, lastUsedUrl)
  } else {
    storage.removeItem(MOBILE_SERVER_STORAGE_KEY)
  }
}

function readMobileServerAlias(serverUrl: string): string | undefined {
  try {
    const normalized = normalizeTailscaleServerUrl(serverUrl)
    const alias = readMobileServerSettings().aliases?.[normalized]?.trim()
    return alias || undefined
  } catch {
    // The settings page may not be available in every environment; without an
    // alias the shell keeps showing the plain server URL.
    return undefined
  }
}

export function buildMobileServerAppUrl(serverUrl: string): string {
  const url = new URL(serverUrl)
  url.searchParams.set(MOBILE_SHELL_QUERY_KEY, '1')
  const alias = readMobileServerAlias(serverUrl)
  if (alias) url.searchParams.set(MOBILE_SHELL_ALIAS_QUERY_KEY, alias)
  return url.toString()
}

/** Reads the alias of the connected server, carried over by the shell URL. */
export function readMobileServerAliasFromUrl(search: string = typeof window !== 'undefined' ? window.location.search : ''): string | undefined {
  return new URLSearchParams(search).get(MOBILE_SHELL_ALIAS_QUERY_KEY)?.trim() || undefined
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
  // 云远程访问隧道：原生层把 WebView 导航到 http://127.0.0.1:18080/?quickforgeRemote=1。
  // 隧道模式下 hostname 是 127.0.0.1，必须用显式标记识别远程客户端，否则会误判为本机。
  if (isCloudTunnelClient()) return true
  return !['localhost', '127.0.0.1', '::1'].includes(location.hostname)
}

/** 云账户 P2P 隧道客户端：仅安卓壳导航到本地隧道（quickforgeRemote=1）时为 true。 */
export function isCloudTunnelClient(): boolean {
  return new URLSearchParams(location.search).get('quickforgeRemote') === '1'
}

/** 跳回原生壳的连接页（https://localhost）；[tab] 指定初始选中项（servers=局域网设备 / cloud=云账户设备）。 */
export function openMobileServerPicker(tab?: 'servers' | 'cloud'): void {
  const params = new URLSearchParams({ connect: '1' })
  if (tab) params.set('tab', tab)
  window.location.href = `https://localhost/?${params.toString()}`
}
