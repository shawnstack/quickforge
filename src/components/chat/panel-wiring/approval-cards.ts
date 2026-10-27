/**
 * Pending tool-approval / ask-user card subsystem for `ChatPanelHost`.
 *
 * Cards render from pending state that arrives both through agent state and
 * through SSE events (the host stores event payloads in refs). This module
 * reconciles those pending sources into the DOM on every decoration pass, with
 * the same session guards as before.
 *
 * Auto-compaction used to live here too (an `info`-toned approval card). It is a
 * React row inside the message list now — see
 * `surface/ContextCompactionDecisionRow` — because a decoration-owned card could
 * not be kept in sync with the server dropping the approval, and it scrolled the
 * list on its own.
 *
 * Plain sync function (no React hooks): the host calls it from inside its
 * decorate pass.
 */

import type { ServerAgentAskAnswer, ServerAgentPendingAsk } from '@/lib/server-agent'
import { injectApprovalCard, removeApprovalCard, type ToolApprovalSource } from '../panel-decoration/approval-card'
import { injectAskUserCard, removeAskUserCard } from '../panel-decoration/ask-user-card'

export type PendingToolApproval = {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  sessionId: string
  source?: ToolApprovalSource
}

export type PendingAutoCompactApproval = {
  approvalId: string
  usage?: { percent?: number }
  thresholdPercent?: number
  keepRecentTurns?: number
  sessionId: string
}

export type PendingAsk = ServerAgentPendingAsk & { sessionId: string }

export type ApprovalCardsAgent = {
  sessionId: string
  state: {
    pendingToolApproval?: PendingToolApproval | null
    pendingAsk?: ServerAgentPendingAsk | null
  }
}

/** The approval-related subset of the host's stable props ref. */
export type ApprovalCardCallbacks = {
  onApproveToolCall: (toolCallId: string) => Promise<void> | void
  onRejectToolCall: (toolCallId: string) => Promise<void> | void
  onAnswerAsk?: (askId: string, answers: ServerAgentAskAnswer[], skipped: boolean, remark?: string) => Promise<void> | void
}

/** The approval-related subset of the host's render-time props. */
export type ApprovalCardsProps = {
  approvalReadOnly: boolean
  approvalReadOnlyMessage?: string
}

export type ApprovalCardsDeps = {
  panel: HTMLElement
  agent: ApprovalCardsAgent
  sideChatMode: boolean
  props: ApprovalCardsProps
  propsRef: { current: ApprovalCardCallbacks }
  pendingApprovalRef: { current: PendingToolApproval | null }
  pendingAskRef: { current: PendingAsk | null }
}

export function syncPendingApprovalCards({
  panel,
  agent,
  sideChatMode,
  props,
  propsRef,
  pendingApprovalRef,
  pendingAskRef,
}: ApprovalCardsDeps) {
  if (sideChatMode) {
    removeApprovalCard(panel)
    removeAskUserCard(panel)
    return
  }

  // Render or remove approval card based on pending state.
  // Must match the current session — otherwise a pending approval from a
  // different session would leak into this panel.
  const pending = pendingApprovalRef.current ?? (() => {
    const statePending = agent.state.pendingToolApproval
    return statePending ? { ...statePending, sessionId: agent.sessionId } : null
  })()
  if (pending && pending.sessionId === agent.sessionId && typeof pending.toolCallId === 'string' && typeof pending.toolName === 'string') {
    // Capture the toolCallId now — propsRef.current may change by click time
    const capturedToolCallId = pending.toolCallId
    injectApprovalCard(
      {
        panel,
        disabled: props.approvalReadOnly,
        disabledReason: props.approvalReadOnlyMessage,
        onApprove: async () => { await propsRef.current.onApproveToolCall(capturedToolCallId); pendingApprovalRef.current = null; agent.state.pendingToolApproval = null; removeApprovalCard(panel) },
        onReject: async () => { await propsRef.current.onRejectToolCall(capturedToolCallId); pendingApprovalRef.current = null; agent.state.pendingToolApproval = null; removeApprovalCard(panel) },
      },
      pending.toolName,
      capturedToolCallId,
      pending.args,
      pending.source,
    )
  } else {
    removeApprovalCard(panel)
  }

  // Render or remove the ask-user card based on pending state. Same
  // session guard as the approval card.
  const pendingAsk = pendingAskRef.current ?? (() => {
    const statePending = agent.state.pendingAsk
    return statePending ? { ...statePending, sessionId: agent.sessionId } : null
  })()
  if (pendingAsk && pendingAsk.sessionId === agent.sessionId && typeof pendingAsk.askId === 'string' && Array.isArray(pendingAsk.questions) && pendingAsk.questions.length > 0) {
    const capturedAskId = pendingAsk.askId
    const askDisabled = props.approvalReadOnly || !propsRef.current.onAnswerAsk
    injectAskUserCard(
      {
        panel,
        disabled: askDisabled,
        disabledReason: props.approvalReadOnly ? props.approvalReadOnlyMessage : undefined,
        onSubmit: async (answers, remark) => {
          await propsRef.current.onAnswerAsk?.(capturedAskId, answers, false, remark)
          pendingAskRef.current = null
          removeAskUserCard(panel)
        },
        onSkip: async () => {
          await propsRef.current.onAnswerAsk?.(capturedAskId, [], true)
          pendingAskRef.current = null
          removeAskUserCard(panel)
        },
      },
      pendingAsk,
    )
  } else {
    removeAskUserCard(panel)
  }
}
