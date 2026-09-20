import { assistantContentParts, messageRenderIdentity } from '@/components/chat/surface/content-parts'
import type { AgentMessage, AssistantMessage } from '@/components/chat/surface/ChatTypes'

/**
 * Structural signature of the message DOM the subagent run-detail trace owns.
 *
 * `SubagentTrace` folds process groups by *moving* message nodes out of the
 * React-owned parents into a group. React must therefore get those nodes back
 * before any commit that mutates the structure inside the trace container
 * (a set/order change of message rows or of an assistant message's rendered
 * parts) — otherwise React inserts/replaces nodes next to nodes that are no
 * longer where it left them.
 *
 * Content-only updates (streaming text growth, tool results arriving inside an
 * existing tool card, previews turning on when the run finishes) touch nodes
 * *inside* an already-moved node, which React patches in place. Releasing for
 * those was the flicker: `releaseProcessGroups` dissolves the group and restores
 * the nodes, so the browser paints an unfolded frame and the following pass
 * re-folds (moving every node again → restarted CSS animations, re-decoded
 * images).
 *
 * The run's streaming flag is deliberately *not* part of the signature either.
 * The trace renders `MessageList` directly (there is no separate streaming
 * container), so a run finishing does not create or remove rows — it only
 * turns on code-block previews *inside* already-rendered nodes. Folding the
 * flag in added a release + full rebuild at exactly the run-end commit, i.e.
 * a one-frame flicker for a content-only change.
 *
 * The projection mirrors the rendering rules:
 * - `MessageList` renders only user / user-with-attachments / assistant rows.
 * - `AssistantMessage` (via `assistantContentParts`) drops whitespace-only text
 *   and thinking chunks and keys tool calls by id.
 * - Each rendered row also carries its own identity token (`role:timestamp`,
 *   reusing `messageRenderIdentity` — the identity behind `messageRenderKeys`),
 *   so a server-side `messages.slice(-N)` window that *replaces* same-shaped rows
 *   (same roles, same part shape, different timestamps) still changes the
 *   signature. A role-only signature missed that swap: the replaced row could be
 *   the anchor line of a folded process group (`process-folding.ts`), leaving the
 *   group holding nodes React now moves, and the release then only clears the
 *   folding flag without handing the node back (`shouldRestoreGroupedProcessNode`)
 *   → a later React `removeChild` throws `NotFoundError`.
 *
 * `pendingToolCalls` is deliberately *not* part of the signature: `MessageList`
 * keeps pending tool cards rendered inline (it never hides them — a separate
 * streaming container hides its own copy instead, see `ChatSurface`), so a
 * tool starting or finishing only repaints the inside of its own tool card.
 * Including it would release — and re-fold — on every 150ms trace tick.
 */
export function subagentTraceStructureSignature(messages: readonly unknown[]): string {
  const parts: string[] = []
  messages.forEach((message) => {
    if (!isRecord(message)) return
    const role = typeof message.role === 'string' ? message.role : ''
    // Artifacts and standalone tool results are not rendered as rows.
    if (role === 'artifact' || role === 'toolResult') return
    // Row identity is part of the structure: the renderer keys rows by it, so a
    // window slide that swaps in a different row of the same shape must release.
    const identity = messageRenderIdentity(message as unknown as AgentMessage)
    if (role === 'assistant') {
      const content = Array.isArray(message.content) ? (message.content as AssistantMessage['content']) : []
      const rendered = assistantContentParts({ ...(message as unknown as AssistantMessage), content })
      parts.push(`${identity}[${rendered.map((part) => part.key).join(',')}]`)
      return
    }
    parts.push(identity)
  })
  return parts.join('|')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
