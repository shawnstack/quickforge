/**
 * Pending tool-approval / ask-user card subsystem for `ChatPanelHost`.
 *
 * Single source of truth: `agent.state.pendingToolApproval` / `agent.state.pendingAsk`
 * (the ServerAgent state machine). Pending payloads arrive through SSE events
 * which ServerAgent adopts into its state (tagged with the owning sessionId);
 * this module just reconciles that authoritative state into the DOM on every
 * decoration pass, with the same session guards as before. Settling the card
 * (approve / reject / answer / skip) clears the state inside ServerAgent's own
 * approveToolCall / rejectToolCall / answerAsk (CAS by id), so no second copy
 * of pending state exists on the panel side.
 *
 * Auto-compaction used to live here too (an `info`-toned approval card). It is a
 * React row inside the message list now (`surface/ContextCompactionStatusRow`)
 * because a decoration-owned card could not track the run's own phase, and it
 * scrolled the list on its own. Compaction no longer asks for approval at all.
 *
 * Plain sync function (no React hooks): the host calls it from inside its
 * decorate pass.
 */

import type { ServerAgentAskAnswer, ServerAgentPendingAsk, ServerAgentPendingToolApproval } from '@/lib/server-agent'
import { injectApprovalCard, removeApprovalCard } from '../panel-decoration/approval-card'
import { injectAskUserCard, removeAskUserCard } from '../panel-decoration/ask-user-card'

export type ApprovalCardsAgent = {
  sessionId: string
  state: {
    pendingToolApproval?: ServerAgentPendingToolApproval | null
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
}

/** Session guard: a pending state without an owning sessionId (snapshot-sourced)
 *  is treated as local — same fallback the host-side ref rebuild used to apply. */
function belongsToSession(pending: { sessionId?: string } | null, sessionId: string): boolean {
  return (pending?.sessionId ?? sessionId) === sessionId
}

export function syncPendingApprovalCards({
  panel,
  agent,
  sideChatMode,
  props,
  propsRef,
}: ApprovalCardsDeps) {
  if (sideChatMode) {
    removeApprovalCard(panel)
    removeAskUserCard(panel)
    return
  }

  // Render or remove approval card based on the authoritative pending state.
  // Must match the current session — otherwise a pending approval from a
  // different session would leak into this panel.
  const pending = agent.state.pendingToolApproval ?? null
  if (pending && belongsToSession(pending, agent.sessionId) && typeof pending.toolCallId === 'string' && typeof pending.toolName === 'string') {
    // Capture the toolCallId now — propsRef.current may change by click time
    const capturedToolCallId = pending.toolCallId
    injectApprovalCard(
      {
        panel,
        disabled: props.approvalReadOnly,
        disabledReason: props.approvalReadOnlyMessage,
        // ServerAgent.approveToolCall / rejectToolCall settle the state (CAS
        // by toolCallId) once the request succeeds; removing the card here is
        // the optimistic UI, not a second authority.
        onApprove: async () => { await propsRef.current.onApproveToolCall(capturedToolCallId); removeApprovalCard(panel) },
        onReject: async () => { await propsRef.current.onRejectToolCall(capturedToolCallId); removeApprovalCard(panel) },
      },
      pending.toolName,
      capturedToolCallId,
      pending.args,
      pending.source,
    )
  } else {
    removeApprovalCard(panel)
  }

  // Render or remove the ask-user card based on the authoritative pending
  // state. Same session guard as the approval card.
  const pendingAsk = agent.state.pendingAsk ?? null
  if (pendingAsk && belongsToSession(pendingAsk, agent.sessionId) && typeof pendingAsk.askId === 'string' && Array.isArray(pendingAsk.questions) && pendingAsk.questions.length > 0) {
    const capturedAskId = pendingAsk.askId
    const askDisabled = props.approvalReadOnly || !propsRef.current.onAnswerAsk
    injectAskUserCard(
      {
        panel,
        disabled: askDisabled,
        disabledReason: props.approvalReadOnly ? props.approvalReadOnlyMessage : undefined,
        // ServerAgent.answerAsk clears the pending state (CAS by askId) after
        // the request succeeds; the card removal below is the optimistic UI.
        onSubmit: async (answers, remark) => {
          await propsRef.current.onAnswerAsk?.(capturedAskId, answers, false, remark)
          removeAskUserCard(panel)
        },
        onSkip: async () => {
          await propsRef.current.onAnswerAsk?.(capturedAskId, [], true)
          removeAskUserCard(panel)
        },
      },
      pendingAsk,
    )
  } else {
    removeAskUserCard(panel)
  }
}
