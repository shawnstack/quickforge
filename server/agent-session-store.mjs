// agent-manager 模块拆分（agent-manager-module-split）第一步：收口 agent-manager.mjs
// 原有的模块级可变状态，确立唯一 owner。本文件只持有状态与最小访问 API，
// 不承载业务逻辑；语义与搬移前逐字符一致（原注释随状态一并迁入）。

/** Active in-memory agent sessions keyed by sessionId. */
export const agentSessions = new Map()

/**
 * 运行中会话的去重 restore：并发 restoreAgent 对同一 sessionId 共享一个
 * in-flight Promise。注释原文见 agent-manager.mjs（防并发重复 createAgent 泄漏）：
 * to restoreAgent; without dedupe each raced through createAgent and the last
 * agentSessions.set overwrote the others, leaking the overwritten sessions
 * (listeners, idle/persist timers, OpenCode child processes) forever.
 */
export const pendingRestores = new Map()

// run_subagent 错误 details 暂存条目的兜底 TTL；正常路径 afterToolCall 即取走删除。
const SUBAGENT_ERROR_DETAILS_STASH_TTL_MS = 6 * 60 * 60 * 1000

/**
 * 超时/失败等错误的 quickforgeSubagentDetails 暂存（原 agent-manager.mjs 状态）：
 * （messages/toolCalls/pendingToolCalls 等）持久化并在 Inspector 中可见。正常路径
 * afterToolCall 立即取走并删除；遗留条目仅按 TTL 兜底清理，防异常销毁泄漏。
 */
const stashedSubagentErrorDetails = new Map()

export function stashSubagentErrorDetails(toolCallId, details) {
  if (typeof toolCallId !== 'string' || !toolCallId) return
  const now = Date.now()
  for (const [stashedId, entry] of stashedSubagentErrorDetails) {
    if (now - entry.stashedAt > SUBAGENT_ERROR_DETAILS_STASH_TTL_MS) stashedSubagentErrorDetails.delete(stashedId)
  }
  stashedSubagentErrorDetails.set(toolCallId, { stashedAt: now, details })
}

export function takeStashedSubagentErrorDetails(toolCallId) {
  if (typeof toolCallId !== 'string') return undefined
  const entry = stashedSubagentErrorDetails.get(toolCallId)
  if (!entry) return undefined
  stashedSubagentErrorDetails.delete(toolCallId)
  return entry.details
}
