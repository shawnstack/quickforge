/**
 * 会话写入租约（session write lease）的前端客户端。
 *
 * 服务端见 `server/session-lease.mjs`：一个会话同时只允许一个客户端写入，
 * 其余客户端降级为只读旁观，并可主动「接管」。本模块负责三件事：
 *
 * 1. 生成并保持标签页级的 `clientId`（sessionStorage：同一标签页刷新不变、
 *    新标签页新值，正好对应「谁在写」这个语义）。
 * 2. 拉取/续约租约（`POST /api/agents/:id/lease`，20s 心跳，服务端 60s TTL），
 *    并处理 409 冲突（别人持有 → 本页转只读）。
 * 3. 把服务端 `session_lease` SSE 帧的变化合流成订阅式状态，供 React 消费。
 *
 * 设计约束：
 * - 只在浏览器里有意义；SSR/测试环境没有 `sessionStorage` 时退化为随机 id。
 * - 心跳与订阅都是引用计数：最后一个订阅者释放后停表，不留下空转定时器。
 * - 所有网络失败都**不**降级成「可写」：拿不到租约时按只读处理更安全。
 */

const CLIENT_ID_STORAGE_KEY = 'quickforge:client-id'

/** 与服务端 `SESSION_LEASE_TTL_MS`（60s）配套：20s 续约一次。 */
export const LEASE_HEARTBEAT_MS = 20_000

/** 租约状态：持有（可写）/ 被他人持有（只读旁观）/ 未知（按只读处理）/ 本次会话未启用。 */
export type SessionLeaseStatus = 'owner' | 'observer' | 'unknown'

export type SessionLeaseSnapshot = {
  status: SessionLeaseStatus
  /** 当前持有者的 clientId；`null` 表示无人持有。 */
  holder: string | null
  /** 持有者是否为当前标签页。 */
  isOwner: boolean
  /** 服务端给出的过期时间（ISO 字符串），仅用于展示/调试。 */
  expiresAt?: string
  /** 最近一次租约请求是否失败（网络错误等）。失败时按只读处理。 */
  degraded: boolean
}

const UNKNOWN_SNAPSHOT: SessionLeaseSnapshot = {
  status: 'unknown',
  holder: null,
  isOwner: false,
  degraded: false,
}

let cachedClientId: string | null = null

function randomId(): string {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID()
  return `qf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 本标签页的稳定标识。sessionStorage 的作用域正好是「一个标签页」：
 * 刷新保持不变（不会把自己的租约抢成第二个持有者），新标签页/新设备拿到
 * 新值（因此会正确地被判定为旁观者）。
 */
export function getClientId(): string {
  if (cachedClientId) return cachedClientId
  try {
    const stored = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(CLIENT_ID_STORAGE_KEY) : null
    if (stored && stored.trim()) {
      cachedClientId = stored.trim()
      return cachedClientId
    }
    const created = randomId()
    sessionStorage?.setItem(CLIENT_ID_STORAGE_KEY, created)
    cachedClientId = created
    return cachedClientId
  } catch {
    // sessionStorage 被禁用（隐私模式/跨源限制）：退化为进程内随机值。
    cachedClientId = randomId()
    return cachedClientId
  }
}

/** 测试用：清掉缓存的 clientId。 */
export function resetClientIdCache(): void {
  cachedClientId = null
}

export function leaseSnapshotFromWire(lease: { clientId?: string; expiresAt?: string } | null | undefined, clientId = getClientId()): SessionLeaseSnapshot {
  if (!lease || typeof lease.clientId !== 'string' || !lease.clientId) {
    // 无租约 = 无人持有（服务端语义：沿用旧的单客户端行为）。对前端来说这仍然
    // 是「我可以写」，因此按 owner 呈现，避免首屏在拿到租约前闪一下只读。
    return { status: 'owner', holder: null, isOwner: true, degraded: false }
  }
  const isOwner = lease.clientId === clientId
  return {
    status: isOwner ? 'owner' : 'observer',
    holder: lease.clientId,
    isOwner,
    expiresAt: lease.expiresAt,
    degraded: false,
  }
}

export type LeaseRequestResult =
  | { ok: true; snapshot: SessionLeaseSnapshot }
  | { ok: false; snapshot: SessionLeaseSnapshot }

function leaseUrl(baseUrl: string, sessionId: string): string {
  return `${baseUrl}/api/agents/${encodeURIComponent(sessionId)}/lease`
}

async function requestLease(
  baseUrl: string,
  sessionId: string,
  options: { method: 'POST' | 'DELETE'; takeover?: boolean },
): Promise<LeaseRequestResult> {
  const clientId = getClientId()
  try {
    const response = await fetch(leaseUrl(baseUrl, sessionId), {
      method: options.method,
      headers: {
        'content-type': 'application/json',
        'x-quickforge-client-id': clientId,
      },
      body: options.method === 'POST' ? JSON.stringify({ clientId, takeover: options.takeover === true }) : undefined,
      cache: 'no-store',
    })
    const payload = await response.json().catch(() => null) as
      | { lease?: { clientId?: string; expiresAt?: string } | null }
      | null
    if (response.ok) {
      return { ok: true, snapshot: leaseSnapshotFromWire(payload?.lease, clientId) }
    }
    // 409：别人持有。按服务端返回的 lease 展示只读，而不是猜。
    if (response.status === 409) {
      return { ok: false, snapshot: leaseSnapshotFromWire(payload?.lease, clientId) }
    }
    return { ok: false, snapshot: { ...UNKNOWN_SNAPSHOT, degraded: true } }
  } catch {
    // 网络失败：不假设自己可写。
    return { ok: false, snapshot: { ...UNKNOWN_SNAPSHOT, degraded: true } }
  }
}

/** 获取或续约租约。 */
export function acquireLease(baseUrl: string, sessionId: string): Promise<LeaseRequestResult> {
  return requestLease(baseUrl, sessionId, { method: 'POST' })
}

/** 主动接管租约（用户点「在此窗口接管」）。 */
export function takeOverLease(baseUrl: string, sessionId: string): Promise<LeaseRequestResult> {
  return requestLease(baseUrl, sessionId, { method: 'POST', takeover: true })
}

/** 释放租约（关闭页面/切换会话时）。只允许持有者释放，旁观者调用是 no-op。 */
export function releaseLease(baseUrl: string, sessionId: string): Promise<LeaseRequestResult> {
  return requestLease(baseUrl, sessionId, { method: 'DELETE' })
}
