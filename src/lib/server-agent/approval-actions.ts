import type { ServerAgentAskAnswer } from '../server-agent-types'
import type { ServerAgentCore } from './core'

/**
 * 多窗口下「这次审批／提问已被另一个窗口处理」不是错误。
 *
 * 两个窗口都能看到同一张审批卡，条目的生命周期只有一次：先点的那个 resolve 并
 * `cleanup()`，后点的必然查不到。服务端为此返回 `APPROVAL_ALREADY_SETTLED` /
 * `ASK_ALREADY_SETTLED`（仍是 404，语义就是「没有待处理项」）。这里把它收敛成
 * 幂等成功——清掉本地 pending、不抛错，否则用户会在一个什么都没发生的窗口里
 * 看到一句英文红字报错。
 */
function settledElsewhereCode(payload: { code?: string } | null, ...codes: string[]): boolean {
  const code = payload?.code
  return typeof code === 'string' && codes.includes(code)
}

/**
 * Approve a pending tool call so it can execute.
 */
export async function approveToolCall(core: ServerAgentCore, toolCallId: string): Promise<void> {
  const url = `${core.baseUrl}/api/agents/${encodeURIComponent(core.sessionId)}/approve-tool`
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...core.writeHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ toolCallId }),
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => null) as { error?: string; code?: string } | null
    if (settledElsewhereCode(payload, 'APPROVAL_ALREADY_SETTLED')) {
      if (core.state.pendingToolApproval?.toolCallId === toolCallId) {
        core.state.pendingToolApproval = null
      }
      return
    }
    throw new Error(payload?.error || `Failed to approve tool call: HTTP ${res.status}`)
  }
  if (core.state.pendingToolApproval?.toolCallId === toolCallId) {
    core.state.pendingToolApproval = null
  }
}

/**
 * Reject a pending tool call, skipping its execution.
 */
export async function rejectToolCall(core: ServerAgentCore, toolCallId: string): Promise<void> {
  const url = `${core.baseUrl}/api/agents/${encodeURIComponent(core.sessionId)}/reject-tool`
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...core.writeHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ toolCallId }),
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => null) as { error?: string; code?: string } | null
    if (settledElsewhereCode(payload, 'APPROVAL_ALREADY_SETTLED')) {
      if (core.state.pendingToolApproval?.toolCallId === toolCallId) {
        core.state.pendingToolApproval = null
      }
      return
    }
    throw new Error(payload?.error || `Failed to reject tool call: HTTP ${res.status}`)
  }
  if (core.state.pendingToolApproval?.toolCallId === toolCallId) {
    core.state.pendingToolApproval = null
  }
}

/**
 * Answer or skip a pending ask_user call.
 *
 * `remark` is the review-step free-form note (not tied to any question); the
 * server appends it to the tool result after the per-question answers.
 */
export async function answerAsk(core: ServerAgentCore, askId: string, payload: { answers?: ServerAgentAskAnswer[]; skipped?: boolean; remark?: string } = {}): Promise<void> {
  const url = `${core.baseUrl}/api/agents/${encodeURIComponent(core.sessionId)}/answer-ask`
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...core.writeHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ askId, answers: payload.answers, skipped: payload.skipped === true, remark: payload.remark }),
  })
  if (!res.ok) {
    const errorPayload = await res.json().catch(() => null) as { error?: string; code?: string } | null
    if (settledElsewhereCode(errorPayload, 'ASK_ALREADY_SETTLED')) {
      if (core.state.pendingAsk?.askId === askId) {
        core.state.pendingAsk = null
      }
      return
    }
    throw new Error(errorPayload?.error || `Failed to answer ask: HTTP ${res.status}`)
  }
  if (core.state.pendingAsk?.askId === askId) {
    core.state.pendingAsk = null
  }
}
