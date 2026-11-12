import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { fetchJsonWithTimeout } from '../server-agent-http'
import type {
  ServerRollbackResult,
  ServerTurnRollbackPreview,
  ServerTurnRollbackResult,
} from '../server-agent-types'
import type { ServerAgentCore } from './core'
import { serverErrorMessage, type ServerErrorPayload } from './errors'

function isTurnRollbackPreview(value: unknown): value is ServerTurnRollbackPreview {
  if (!value || typeof value !== 'object') return false
  const preview = value as ServerTurnRollbackPreview
  return typeof preview.revision === 'string'
    && Array.isArray(preview.turnIds) && preview.turnIds.every((turnId) => typeof turnId === 'string')
    && Array.isArray(preview.files) && preview.files.every((file) => file
      && typeof file.path === 'string'
      && typeof file.safe === 'boolean'
      && (file.reason === null || typeof file.reason === 'string')
      && (file.action === 'restore' || file.action === 'delete'))
}

function isTurnRollbackResult(value: unknown): value is ServerTurnRollbackResult {
  if (!value || typeof value !== 'object') return false
  const result = value as ServerTurnRollbackResult
  return (result.status === 'completed' || result.status === 'partial')
    && Array.isArray(result.rolledBack) && result.rolledBack.every((file) => file
      && typeof file.path === 'string'
      && (file.action === 'restore' || file.action === 'delete'))
    && Array.isArray(result.conflicts) && result.conflicts.every((file) => file
      && typeof file.path === 'string'
      && (file.reason === null || typeof file.reason === 'string'))
}

/** 轮级回滚 API 错误：附 HTTP status（WorkspaceApiError 风格），供 UI 区分 409 等语义。 */
function turnRollbackApiError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number }
  error.status = status
  return error
}

/**
 * 轻量 HTTP 目标：轮级回滚的两个方法只依赖这三项，测试里存在不经构造函数的
 * 原型实例（无租约控制器时 `writeHeaders()` 退化为无头，行为不变）。
 */
export type AgentHttpTarget = {
  baseUrl: string
  sessionId: string
  writeHeaders: () => Record<string, string>
}

/** 每轮产物卡「撤销本轮」预检：只读安全检查；执行必须使用预检返回的 revision。 */
export async function fetchTurnRollbackPreview(target: AgentHttpTarget, turnIds: string[], signal?: AbortSignal): Promise<ServerTurnRollbackPreview> {
  // 空集合防御：无 turnId 的轮不该发起请求，直接按预检失败拒绝。
  if (turnIds.length === 0) return Promise.reject(new Error('Turn rollback requires at least one turn id'))
  const url = `${target.baseUrl}/api/agents/${encodeURIComponent(target.sessionId)}/rollback-turn/preview?turnIds=${encodeURIComponent(turnIds.join(','))}`
  const { response, body } = await fetchJsonWithTimeout<ServerTurnRollbackPreview & ServerErrorPayload>(url, 30_000, { signal })
  if (!response.ok || !isTurnRollbackPreview(body)) {
    throw turnRollbackApiError(response.status, serverErrorMessage(body ?? null, `Failed to preview turn rollback: HTTP ${response.status}`))
  }
  return body
}

/**
 * 轮级撤销执行：200 = completed/partial；409 = revision 过期（预览已失效）；
 * 500 = 失败。网络/超时异常无法确认服务端是否已写入，同样按错误抛出（带 status）。
 */
export async function executeTurnRollback(target: AgentHttpTarget, turnIds: string[], revision: string, signal?: AbortSignal): Promise<ServerTurnRollbackResult> {
  // 空集合防御：与预检同口径，空轮不发起执行请求。
  if (turnIds.length === 0) return Promise.reject(new Error('Turn rollback requires at least one turn id'))
  const url = `${target.baseUrl}/api/agents/${encodeURIComponent(target.sessionId)}/rollback-turn`
  const { response, body } = await fetchJsonWithTimeout<ServerTurnRollbackResult & ServerErrorPayload>(url, 60_000, {
    method: 'POST',
    headers: { ...target.writeHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ turnIds, revision }),
    signal,
  })
  if (response.ok && isTurnRollbackResult(body)) return body
  throw turnRollbackApiError(response.status, serverErrorMessage(body ?? null, `Turn rollback result unconfirmed: HTTP ${response.status}`))
}

/**
 * Roll back from a message index on the authoritative server state.
 *
 * 响应带的是**截断后的完整会话历史**（不是本连接的尾部窗口），所以采纳也
 * 必须按「全量」坐标来：`baseSeq` 归零 + 整体替换 + 广播刷新。交给调用方
 * 去写 `state.messages` 是错的——本地可能正处于尾部窗口（`baseSeq > 0`），
 * 直接覆盖会让「数组」与「起点」拆开，之后所有下标换算、增量落位整体偏移
 * （表现为回滚后显示的历史不对）；而同一时刻 SSE 的 `messages_replaced`
 * 帧只带尾部窗口，两路谁后到决定本地是否自洽。收进本方法后两路都走
 * `applyLog`，无论先后都收敛到同一份自洽状态。
 */
export async function rollbackSession(core: ServerAgentCore, messageIndex: number): Promise<ServerRollbackResult> {
  if (!core.canWrite()) throw new Error('Another window is writing to this session')
  // 调用方给的是**本地数组下标**（渲染层坐标）。服务端要的是会话绝对 seq；
  // 窗口态下两者相差 `messageBaseSeq`，少了这一步换算会回滚到错误的轮次
  // ——旧实现直接把本地下标发给服务端，窗口会话必然删错消息。
  const absoluteIndex = core.messageBaseSeq + messageIndex
  const url = `${core.baseUrl}/api/agents/${encodeURIComponent(core.sessionId)}/rollback`
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...core.writeHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ messageIndex: absoluteIndex }),
  })
  const payload = await res.json().catch(() => null) as (ServerRollbackResult & ServerErrorPayload) | null
  if (!res.ok) throw new Error(serverErrorMessage(payload, `Failed to roll back: HTTP ${res.status}`))
  acceptRolledBackHistory(core, payload?.session?.messages)
  return payload as ServerRollbackResult
}

/** 采纳回滚接口返回的全量历史（坐标口径见 `rollbackSession`）。 */
function acceptRolledBackHistory(core: ServerAgentCore, messages?: AgentMessage[]): void {
  if (!Array.isArray(messages)) return
  core.applyLog({ kind: 'snapshot', baseSeq: 0, messages })
  core.state.streamingMessage = undefined
  core.stateVersion++
  core.notifyMessageMetadataChanged()
}

/**
 * 本地乐观截断尾部（重试的「先剪再续」半步）。
 *
 * 只截**窗口内的尾部**，`baseSeq` 语义不变，所以可以走 `applyLog` 的
 * snapshot 而对齐坐标；这里刻意不广播：这次操作的权威结果由紧随其后的
 * `continue()` 服务端帧给出，提前通知会让列表在流式开始前白抖一次。
 */
export function trimTrailingMessages(core: ServerAgentCore, keepCount: number): void {
  const limit = Number.isFinite(keepCount) ? Math.max(0, Math.trunc(keepCount)) : core.state.messages.length
  const count = Math.min(limit, core.state.messages.length)
  if (count === core.state.messages.length) return
  core.applyLog({
    kind: 'snapshot',
    baseSeq: core.messageBaseSeq,
    messages: core.state.messages.slice(0, count),
  })
}
