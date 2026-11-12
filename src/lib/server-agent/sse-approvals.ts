import type { ServerAgentPendingAsk, ServerAgentPendingToolApproval } from '../server-agent-types'
import type { ServerAgentCore } from './core'

/**
 * 审批与 ask 事件（原 `case 'tool_approval_required'` / `ask_user_required` /
 * `ask_user_answered`，逐字迁出）。
 */

export function handleToolApprovalRequired(core: ServerAgentCore, event: Record<string, unknown>): boolean {
  const approvalEvent = event as unknown as ServerAgentPendingToolApproval
  if (typeof approvalEvent.toolCallId === 'string' && typeof approvalEvent.toolName === 'string') {
    // 写入时保留事件归属（缺省视为本会话）：state 是 pending 审批的单一
    // 权威，UI 只消费这里，不再在组件里用 ref 重建。
    core.state.pendingToolApproval = { ...approvalEvent, sessionId: approvalEvent.sessionId ?? core.sessionId }
  }
  return true
}

export function handleAskUserRequired(core: ServerAgentCore, event: Record<string, unknown>): boolean {
  const askEvent = event as unknown as ServerAgentPendingAsk
  if (typeof askEvent.askId === 'string' && Array.isArray(askEvent.questions)) {
    // 同 tool_approval_required：归属随事件一起进权威状态。
    core.state.pendingAsk = { ...askEvent, sessionId: askEvent.sessionId ?? core.sessionId }
  }
  return true
}

export function handleAskUserAnswered(core: ServerAgentCore): boolean {
  // The answered ask lives on as a normal ask_user tool message in the
  // history (auto-collapsed by the tool message UI), so the interactive
  // card is simply removed.
  core.state.pendingAsk = null
  return true
}
