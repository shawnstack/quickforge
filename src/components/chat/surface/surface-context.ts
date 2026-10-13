import { createContext, useContext } from 'react'
import type { ContextEvictionEntry } from './ContextEvictedBadge'

/**
 * Whether "run in terminal"-style command actions are available for code
 * blocks rendered inside this chat surface.
 *
 * `ChatSurface` provides it from its `commandActionsEnabled` prop (the host
 * computes `!sideChatMode && !readOnly`, mirroring the legacy decoration
 * gate `enableTerminalCommandActions`), and `CodeBlock` consumes it through
 * `useCommandActionsEnabled()` instead of probing the composer DOM — a
 * side-chat panel has a composer, so the old DOM probe wrongly enabled the
 * button there.
 *
 * The default is `false` so blocks rendered outside a surface (standalone
 * previews/tests) stay fail-closed, matching the legacy behavior where no
 * `.qf-chat-panel` ancestor meant no terminal affordance.
 */
export const CommandActionsEnabledContext = createContext(false)

/** Read whether terminal command actions are enabled for the enclosing surface. */
export function useCommandActionsEnabled(): boolean {
  return useContext(CommandActionsEnabledContext)
}

/**
 * Whether code blocks rendered inside this subtree belong to a message that is
 * still streaming.
 *
 * `MessageList` provides `true` around the streaming assistant row it renders
 * as its last row (the only assistant message that streams there; every other
 * row is finished), and the subagent run-detail trace provides
 * `payload.status === 'running'` for its whole trace subtree. `CodeBlock`
 * consumes it through `useAssistantStreaming()` to keep mermaid/SVG previews
 * (and the terminal-run button) off while text is still arriving.
 *
 * It replaces a `closest('.qf-streaming-message')` DOM probe: the subagent trace
 * has no such ancestor, so every 150ms trace update re-rendered mermaid/SVG
 * previews for in-flight code blocks. The default is `false` so blocks rendered
 * outside a surface (standalone previews/tests) stay fail-closed.
 */
export const AssistantStreamingContext = createContext(false)

/** Read whether the enclosing surface is still streaming this message. */
export function useAssistantStreaming(): boolean {
  return useContext(AssistantStreamingContext)
}

const EMPTY_EVICTION_ENTRIES: ReadonlyMap<string, ContextEvictionEntry> = new Map()

/**
 * Ledger entries (id → { kind, reason, forgottenAt }) for messages the agent
 * has trimmed from the runtime context (context eviction). `ChatSurface`
 * provides the snapshot's identity-stable map; tool cards and assistant rows
 * consume it through `useContextEvictionEntries()` to show a "trimmed from
 * context" badge (with the recorded reason) while still rendering the
 * preserved original content. The default is an empty map so standalone
 * previews/tests render without the feature.
 */
export const ContextEvictionEntriesContext = createContext<ReadonlyMap<string, ContextEvictionEntry>>(EMPTY_EVICTION_ENTRIES)

/** Read the evicted (trimmed-from-context) entry map for this surface. */
export function useContextEvictionEntries(): ReadonlyMap<string, ContextEvictionEntry> {
  return useContext(ContextEvictionEntriesContext)
}
