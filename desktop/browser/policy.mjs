/**
 * 内嵌 AI 浏览器的导航策略。
 *
 * 内嵌浏览器是「Agent 手里的一台真浏览器」：它能带 cookie 访问任意站点，
 * 也能把本机服务暴露给一个被诱导的页面。因此这里的策略是**默认拒绝**：
 * 只允许公网 http(s)，本地/私网/链路本地/文件协议一律拒绝，并给出可读原因，
 * 让 Agent 能把失败原因转述给用户，而不是静默卡住。
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

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!hostname) return denied('invalid', 'URL has no host')
  // `.localhost` 的任意子域在 Chromium 里同样解析到回环地址，必须按后缀拦。
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    return denied('blocked-host', `${NAVIGATION_DENIED_MESSAGE}: local host ${hostname} is not reachable from the agent browser`)
  }
  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
    return denied('blocked-host', `${NAVIGATION_DENIED_MESSAGE}: private address ${hostname} is not reachable from the agent browser`)
  }

  return { ok: true, url: parsed.toString(), origin: parsed.origin, hostname }
}

/** 仅做规范化（不套用策略），用于展示当前地址等场景。 */
export function safeOriginOf(value) {
  try {
    return new URL(String(value || '')).origin
  } catch {
    return ''
  }
}
