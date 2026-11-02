/**
 * 解析缓存归属的服务器标识。
 *
 * 浏览器的 IndexedDB / localStorage 缓存按「哪一台后端」分区，避免把 A 服务
 * 的快照用到 B 服务上：显式 baseUrl 优先（去尾部斜杠归一化），其次直连后端
 * 地址（dev 模式下 Vite 与 API 不同端口），再次当前页面 origin，最后 'unknown'。
 */
import { getDirectBackendBaseUrl } from '@/lib/backend-url'

export function resolveServerCacheKey(baseUrl = ''): string {
  const trimmed = baseUrl.trim()
  if (trimmed) return trimmed.replace(/\/+$/, '')
  const direct = getDirectBackendBaseUrl()
  if (direct) return direct
  if (typeof location !== 'undefined' && location.origin) return location.origin
  return 'unknown'
}
