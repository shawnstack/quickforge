import { isRecord } from './guards'
import { type SubagentRunOpenRequest, type SubagentRunPayload } from './types'

/** 只有 canonical toolCallId 存在的载荷才可进入全局实时 store。 */
export function canPublishSubagentRunPayload(payload: Pick<SubagentRunPayload, 'canonicalToolCallId'>): boolean {
  return Boolean(payload.canonicalToolCallId)
}

/** canonical 任意状态可打开；无 canonical 时仅允许历史终态载荷直接打开。 */
export function canOpenSubagentRunPayload(payload: Pick<SubagentRunPayload, 'canonicalToolCallId' | 'status'>): boolean {
  return Boolean(payload.canonicalToolCallId) || (payload.status !== 'running' && payload.status !== 'called')
}

/**
 * renderer 只补齐安全快照：首次 canonical 载荷可发布；已有非终态可被恢复出的终态修正；
 * 其他已有快照不覆盖，保持 SSE 路径权威。
 */
export function shouldPublishSubagentRunPayload(
  payload: Pick<SubagentRunPayload, 'canonicalToolCallId' | 'status'>,
  existing?: Pick<SubagentRunPayload, 'status'>,
): boolean {
  if (!canPublishSubagentRunPayload(payload)) return false
  if (!existing) return true
  const existingIsRunning = existing.status === 'called' || existing.status === 'running'
  const payloadIsTerminal = payload.status === 'done' || payload.status === 'error'
  return existingIsRunning && payloadIsTerminal
}

/** canonical 点击取 store 最新同 ID 快照；历史 fallback 必须使用当前 renderer 载荷。 */
export function resolveSubagentRunPayloadForOpen(
  payload: SubagentRunPayload,
  storePayload?: SubagentRunPayload,
): SubagentRunPayload {
  if (!payload.canonicalToolCallId) return payload
  return storePayload?.canonicalToolCallId === payload.canonicalToolCallId ? storePayload : payload
}

/** 校验 `quickforge:open-subagent-run` 事件 detail，返回规范化 run id，无效输入返回 undefined。 */
export function normalizeOpenSubagentRunRequest(detail: unknown): SubagentRunOpenRequest | undefined {
  if (!isRecord(detail)) return undefined
  const runId = typeof detail.runId === 'string' ? detail.runId.trim() : ''
  if (!runId) return undefined
  const payload = isRecord(detail.payload) ? detail.payload as unknown as SubagentRunPayload : undefined
  return { runId, payload }
}
