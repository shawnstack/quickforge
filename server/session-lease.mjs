// 会话级写入租约（session write lease）。
//
// 背景：一个会话可以被多个客户端同时打开（两个浏览器标签页、局域网多设备、
// 定时任务/ACP 等后台驱动）。服务端过去只有 `session.sseConnected` 这一个
// 布尔位，而且它只保护会话级 SSE 连接（`/api/agents/:id/stream`），前端早已
// 改用全局事件流 `/api/agents/events`，那条独占链因此没有任何消费方；写入口
// `runPrompt` 也只有 `state.isStreaming` 这道本地检查，检查与真正开跑之间还
// 隔着若干 await（TOCTOU 窗口）。多端并发写同一个会话时，持久化层只能靠
// revision CAS 拒绝覆盖并标记 `persist_degraded`，表现为「消息保存失败」。
//
// 本模块提供一把显式租约：谁持有它，谁才有写权限；其余客户端降级为只读旁观，
// 并可以主动「接管」。租约是按 sessionId 的内存状态，语义与
// `session.sseConnected` 一致（单进程、不跨进程）——跨进程的正确性仍然由
// SQLite revision CAS 兜底。
//
// 关键设计：
// - 租约挂在 owner 上（clientId），续约只允许原持有者，避免 A 的心跳续掉 B 的租约。
// - TTL 过期即可被抢占：客户端崩溃/关标签页不会把会话永久锁死。
// - 变化经全局 SSE 广播（`session_lease`），其他标签页据此切换只读提示。
// - 无租约的会话沿用旧行为（任何客户端都可写），保证未接入 lease 的调用方
//   （ACP、定时任务、共享会话）与升级前的单端使用完全不受影响。

/** 租约有效期：客户端每 20s 续约一次，60s 无续约即视为放弃。 */
export const SESSION_LEASE_TTL_MS = 60_000

/** clientId 长度上限，防止异常客户端写入超长标识。 */
const MAX_CLIENT_ID_LENGTH = 128

function normalizeClientId(clientId) {
  if (typeof clientId !== 'string') return null
  const trimmed = clientId.trim()
  if (!trimmed || trimmed.length > MAX_CLIENT_ID_LENGTH) return null
  return trimmed
}

function readClock(now) {
  return Number.isFinite(now) ? now : Date.now()
}

/**
 * 创建一把会话租约表。返回的全是纯同步函数，因此「检查 + 写入」之间没有
 * await 空窗，天然原子。
 *
 * @param {{ publish?: (sessionId: string, lease: object|null) => void, ttlMs?: number }} [options]
 */
export function createSessionLeaseStore(options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : SESSION_LEASE_TTL_MS
  const publish = typeof options.publish === 'function' ? options.publish : () => {}
  /** sessionId -> { clientId, acquiredAt, renewedAt, expiresAtMs, fence } */
  const leases = new Map()
  // fence 单调递增：接管/释放后的旧请求即使带着同样的 clientId 也无法冒充。
  let nextFence = 1

  function snapshot(entry) {
    if (!entry) return null
    return {
      clientId: entry.clientId,
      acquiredAt: entry.acquiredAt,
      renewedAt: entry.renewedAt,
      expiresAt: new Date(entry.expiresAtMs).toISOString(),
      fence: entry.fence,
    }
  }

  /**
   * 广播失败绝不能让写入失败：租约是并发保护，不是可用性依赖。
   */
  function emit(sessionId, lease) {
    try {
      publish(sessionId, lease)
    } catch {
      // 事件总线（会话已销毁 / 监听器抛错）不应影响租约本身的正确性。
    }
  }

  function isExpired(entry, now) {
    return !entry || now >= entry.expiresAtMs
  }

  function take(sessionId, clientId, now) {
    const at = readClock(now)
    const entry = {
      clientId,
      acquiredAt: new Date(at).toISOString(),
      renewedAt: new Date(at).toISOString(),
      expiresAtMs: at + ttlMs,
      fence: nextFence++,
    }
    leases.set(sessionId, entry)
    return entry
  }

  /**
   * 获取或续约租约。
   *
   * @returns {{ ok: true, lease: object, acquired: boolean }
   *   | { ok: false, lease: object, reason: 'held', holder: string }}
   */
  function acquire(sessionId, rawClientId, now) {
    const clientId = normalizeClientId(rawClientId)
    if (!clientId) return { ok: false, reason: 'invalid', lease: null, holder: null }
    const at = readClock(now)
    const current = leases.get(sessionId)

    if (!current || isExpired(current, at)) {
      const lease = take(sessionId, clientId, at)
      emit(sessionId, snapshot(lease))
      return { ok: true, lease: snapshot(lease), acquired: true }
    }

    if (current.clientId === clientId) {
      current.renewedAt = new Date(at).toISOString()
      current.expiresAtMs = at + ttlMs
      // 续约不广播：其他客户端关心的只是「谁是持有者」，续约不改变这个事实。
      return { ok: true, lease: snapshot(current), acquired: false }
    }

    return { ok: false, reason: 'held', lease: snapshot(current), holder: current.clientId }
  }

  /**
   * 主动接管（用户点「在此窗口接管」）。无条件覆盖当前持有者并广播。
   */
  function forceTake(sessionId, rawClientId, now) {
    const clientId = normalizeClientId(rawClientId)
    if (!clientId) return { ok: false, reason: 'invalid', lease: null }
    const lease = take(sessionId, clientId, now)
    emit(sessionId, snapshot(lease))
    return { ok: true, lease: snapshot(lease), acquired: true }
  }

  /**
   * 释放租约。只允许持有者释放，避免旁观者关闭页面时把持有者的写权限打掉。
   */
  function release(sessionId, rawClientId) {
    const clientId = normalizeClientId(rawClientId)
    const current = leases.get(sessionId)
    if (!current) return { ok: true, released: false }
    if (clientId && current.clientId !== clientId) {
      return { ok: false, reason: 'held', holder: current.clientId, released: false }
    }
    leases.delete(sessionId)
    emit(sessionId, null)
    return { ok: true, released: true }
  }

  /**
   * 只读查询：过期租约按「无人持有」返回，避免调用方读到已失效的持有者。
   */
  function get(sessionId, now) {
    const current = leases.get(sessionId)
    if (!current) return null
    if (isExpired(current, readClock(now))) return null
    return snapshot(current)
  }

  /**
   * 写权限判定。无租约 → 允许（沿用旧行为）；有租约 → 必须持有者本人。
   * 这是所有写路由的统一守卫口径。
   */
  function canWrite(sessionId, rawClientId, now) {
    const current = get(sessionId, now)
    if (!current) return { ok: true, takeover: false }
    const clientId = normalizeClientId(rawClientId)
    if (clientId && clientId === current.clientId) return { ok: true, takeover: false }
    return { ok: false, holder: current.clientId, lease: current }
  }

  /**
   * 会话销毁时清理（`destroyAgent`）。带 fence 释放，避免「旧连接的迟到释放
   * 清掉新会话租约」这一类跨代误释放。force 为 true 时无条件删除。
   */
  function clear(sessionId, { fence, force = false } = {}) {
    const current = leases.get(sessionId)
    if (!current) return false
    if (!force && Number.isFinite(fence) && current.fence !== fence) return false
    leases.delete(sessionId)
    emit(sessionId, null)
    return true
  }

  /** 仅用于测试/诊断。 */
  function size() {
    return leases.size
  }

  return { acquire, forceTake, release, get, canWrite, clear, size, ttlMs }
}

