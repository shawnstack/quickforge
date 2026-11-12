import type { ServerAgentAskAnswer } from '../server-agent-types'
import type { ServerAgentCore } from './core'

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
    const payload = await res.json().catch(() => null) as { error?: string } | null
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
    const payload = await res.json().catch(() => null) as { error?: string } | null
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
    const errorPayload = await res.json().catch(() => null) as { error?: string } | null
    throw new Error(errorPayload?.error || `Failed to answer ask: HTTP ${res.status}`)
  }
  if (core.state.pendingAsk?.askId === askId) {
    core.state.pendingAsk = null
  }
}
