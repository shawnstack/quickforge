/**
 * 内嵌 AI 浏览器的导航策略。
 *
 * 内嵌浏览器是「Agent 手里的一台真浏览器」：它能带 cookie 访问任意站点，
 * 也能把本机服务暴露给一个被诱导的页面。因此这里的策略是**默认拒绝**：
 * 只允许公网 http(s)，本地/私网/链路本地/文件协议一律拒绝，并给出可读原因，
 * 让 Agent 能把失败原因转述给用户，而不是静默卡住。
 *
 * 策略有同一个 host 判定的两个入口：normalizeNavigableUrl 管「导航」（顶层去哪），
 * shouldBlockSubresource 管「页面内请求」（fetch/XHR/WebSocket/重定向）。
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
])

// [网络地址, 前缀长度]
const PRIVATE_IPV4_RANGES = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10 CGNAT
  [0x7f000000, 8], // 127.0.0.0/8
  [0xa9fe0000, 16], // 169.254.0.0/16
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0000000, 24], // 192.0.0.0/24
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xc6120000, 15], // 198.18.0.0/15
]

const PRIVATE_IPV6_PREFIXES = ['::1', '::', 'fe80:', 'fc', 'fd', 'ff']

// 子资源判定里不携带 host、属于浏览器本地语义的 scheme：直接交给浏览器处理。
const INTERNAL_SCHEMES = new Set([
  'data:',
  'blob:',
  'about:',
  'javascript:',
  'chrome-extension:',
  'devtools:',
  'filesystem:',
])

// 子资源里带 host、必须过同一份网段判定的 scheme。
const SUBRESOURCE_HOST_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:'])

export const BROWSER_SESSION_PARTITION = 'persist:quickforge-agent-browser'

export const NAVIGATION_DENIED_MESSAGE = 'Blocked by the desktop browser policy'

function ipv4ToInt(host) {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = (value * 256) + octet
  }
  return value >>> 0
}

function isPrivateIpv4(host) {
  const value = ipv4ToInt(host)
  if (value === null) return false
  return PRIVATE_IPV4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return (value & mask) >>> 0 === (base & mask) >>> 0
  })
}

function isPrivateIpv6(host) {
  const normalized = host.toLowerCase()
  if (!normalized.includes(':')) return false
  // IPv4-mapped 地址（::ffff:127.0.0.1）按内嵌的 v4 判断，避免绕过 v4 网段规则。
  const mapped = normalized.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped && isPrivateIpv4(mapped[1])) return true
  return PRIVATE_IPV6_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(prefix))
}

function denied(reason, message) {
  return { ok: false, reason, message }
}

/** 规范 host：去 IPv6 方括号、转小写、去尾点（`localhost.` 与 `localhost` 同判）。 */
function normalizeHostname(hostname) {
  return String(hostname).replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
}

/**
 * host 级判定（**唯一一份**）：blocked 名单 / `*.localhost` / 私网 / 链路本地 / CGNAT。
 * 导航（normalizeNavigableUrl）与页面内请求（shouldBlockSubresource）共用它；
 * 出现第二份网段表或第二套 blocked 名单就说明两层判定开始漂移，属于不合格实现。
 * @returns {{ blocked: true, message: string } | null} 拦下时给出沿用 NAVIGATION_DENIED_MESSAGE 的可读原因。
 */
function hostVerdict(hostname) {
  const host = normalizeHostname(hostname)
  // `.localhost` 的任意子域在 Chromium 里同样解析到回环地址，必须按后缀拦。
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
    return { blocked: true, message: `${NAVIGATION_DENIED_MESSAGE}: local host ${host} is not reachable from the agent browser` }
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    return { blocked: true, message: `${NAVIGATION_DENIED_MESSAGE}: private address ${host} is not reachable from the agent browser` }
  }
  return null
}

/**
 * 把用户/模型的输入规范成可导航的 URL，并给出策略结论。
 *
 * @param {unknown} input
 * @returns {{ ok: true, url: string, origin: string, hostname: string }
 *   | { ok: false, reason: 'empty' | 'protocol' | 'invalid' | 'blocked-host', message: string }}
 */
export function normalizeNavigableUrl(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return denied('empty', 'URL is required')
  }
  const raw = input.trim()
  if (/\s/.test(raw)) return denied('invalid', 'URL must not contain whitespace')

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw)
  const candidate = hasScheme ? raw : `https://${raw}`

  let parsed
  try {
    parsed = new URL(candidate)
  } catch {
    return denied('invalid', `Not a valid URL: ${raw}`)
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return denied('protocol', `Only http and https URLs can be opened in the agent browser (got ${parsed.protocol})`)
  }

  const hostname = normalizeHostname(parsed.hostname)
  if (!hostname) return denied('invalid', 'URL has no host')
  const verdict = hostVerdict(hostname)
  if (verdict) return denied('blocked-host', verdict.message)

  return { ok: true, url: parsed.toString(), origin: parsed.origin, hostname }
}

/**
 * 判定内嵌浏览器「页面内请求」是否必须拦下。
 *
 * 导航层只看得到「谁在导航」；页面被注入/被诱导后自己发起的 fetch/XHR/WebSocket
 * 不经过 will-navigate，必须按同一份 host 网段表在网络层拦下。与
 * normalizeNavigableUrl 的关键差异：无 scheme 的相对路径与内部 scheme（data:/blob:
 * 等）不是「公网目标」，不能套用导航规则补 https 或判 protocol 违规——相对 URL 的
 * host 与顶层一致，顶层已被导航策略把关。
 * @param {unknown} input
 * @returns {{ block: boolean, reason?: 'blocked-host' | 'invalid', message?: string }}
 */
export function shouldBlockSubresource(input) {
  if (typeof input !== 'string' || !input.trim()) return { block: false }
  const raw = input.trim()
  const scheme = raw.match(/^[a-z][a-z0-9+.-]*:/i)?.[0]?.toLowerCase()
  if (!scheme) return { block: false }
  if (INTERNAL_SCHEMES.has(scheme)) return { block: false }
  if (!SUBRESOURCE_HOST_SCHEMES.has(scheme)) return { block: false }

  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return { block: true, reason: 'invalid' }
  }
  const verdict = hostVerdict(parsed.hostname)
  if (verdict) return { block: true, reason: 'blocked-host', message: verdict.message }
  return { block: false }
}

/** 仅做规范化（不套用策略），用于展示当前地址等场景。 */
export function safeOriginOf(value) {
  try {
    return new URL(String(value || '')).origin
  } catch {
    return ''
  }
}
