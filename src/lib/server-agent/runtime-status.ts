import type { ActiveAgentStatus } from '../server-agent-types'

// ---------------------------------------------------------------------------
// Runtime status helpers for sidebar indicators
// ---------------------------------------------------------------------------

// 合并同一 baseUrl 在短时间窗口内的并发轮询请求（in-flight 去抖）。
// 仅合并并发、不缓存结果数据：窗口外或请求完成后下次调用重新请求，
// 保证侧边栏状态始终尽量实时。
const ACTIVE_AGENT_STATUS_DEDUPE_MS = 200

let activeAgentStatusInflight: {
  baseUrl: string
  startedAt: number
  promise: Promise<ActiveAgentStatus[]>
} | null = null

export function fetchActiveAgentStatuses(baseUrl = ''): Promise<ActiveAgentStatus[]> {
  const now = Date.now()
  const inflight = activeAgentStatusInflight
  if (inflight && inflight.baseUrl === baseUrl && now - inflight.startedAt < ACTIVE_AGENT_STATUS_DEDUPE_MS) {
    return inflight.promise
  }

  const promise = (async (): Promise<ActiveAgentStatus[]> => {
    const res = await fetch(`${baseUrl}/api/agents`, { cache: 'no-store' })
    if (!res.ok) return []
    const payload = await res.json().catch(() => null) as { sessions?: ActiveAgentStatus[] } | null
    return Array.isArray(payload?.sessions) ? payload.sessions : []
  })()

  activeAgentStatusInflight = { baseUrl, startedAt: now, promise }
  void promise.finally(() => {
    if (activeAgentStatusInflight?.promise === promise) activeAgentStatusInflight = null
  })
  return promise
}
