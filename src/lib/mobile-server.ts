import { Capacitor } from '@capacitor/core'

const MOBILE_SERVER_STORAGE_KEY = 'quickforge:mobile-server-url'
const MOBILE_SHELL_QUERY_KEY = 'quickforgeMobile'
const MOBILE_SHELL_SESSION_KEY = 'quickforge:mobile-shell'

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
    throw new Error('请输入 .ts.net MagicDNS 完整域名或 Tailscale 100.x 地址')
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('请输入服务根地址，不要附加路径、参数或锚点')
  }

  if (!url.port) url.port = '5176'
  return url.origin
}

export function readSavedMobileServerUrl(): string {
  try {
    return window.localStorage.getItem(MOBILE_SERVER_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function saveMobileServerUrl(url: string): void {
  window.localStorage.setItem(MOBILE_SERVER_STORAGE_KEY, url)
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
