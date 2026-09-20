/**
 * Shared type surface for the self-hosted React chat UI
 * (`src/components/chat/surface/`, self-hosted-chat-ui T3).
 *
 * Runtime messages come from pi-agent-core / pi-ai. QuickForge owns the
 * attachment and persisted custom-message contracts below; importing them
 * does not load a UI package or register custom elements.
 */

export type { Agent, AgentEvent, AgentMessage, AgentState, AgentTool, ThinkingLevel } from '@earendil-works/pi-agent-core'

export type {
  Api,
  AssistantMessage,
  ImageContent,
  Message,
  Model,
  StopReason,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from '@earendil-works/pi-ai'

import type { Agent } from '@earendil-works/pi-agent-core'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'

/** Persisted attachment data, shared by the composer and historical messages. */
export interface Attachment {
  id: string
  type: 'image' | 'document'
  fileName: string
  mimeType: string
  size: number
  /** Original bytes encoded as base64, without a data URL prefix (also for documents). */
  content: string
  /** Extracted document text, separate from the original bytes. */
  extractedText?: string
  /** Base64 image preview, without a data URL prefix. */
  preview?: string
}

export type UserMessageWithAttachments = {
  role: 'user-with-attachments'
  content: string | (TextContent | ImageContent)[]
  timestamp: number
  attachments?: Attachment[]
}

/** Historical artifact entries keep their string timestamp; do not normalize to a number. */
export interface ArtifactMessage {
  role: 'artifact'
  action: 'create' | 'update' | 'delete'
  filename: string
  content?: string
  title?: string
  timestamp: string
}

// Keep agent state, session storage and the React surface on the same message union.
declare module '@earendil-works/pi-agent-core' {
  interface CustomAgentMessages {
    'user-with-attachments': UserMessageWithAttachments
    artifact: ArtifactMessage
  }
}

/**
 * Imperative handle exposed by `ChatSurface` via `ref`, mirroring the
 * `setInput` / `setAutoScroll` surface of the legacy `AgentInterface`.
 */
export interface ChatSurfaceHandle {
  /** Pre-fill the composer with text (and optionally attachments). */
  setInput(text: string, attachments?: Attachment[]): void
  /** Enable/disable auto-scrolling to the bottom while messages stream in. */
  setAutoScroll(enabled: boolean): void
}

/**
 * DOM-level property surface ChatSurface installs on the `.qf-message-editor`
 * root node (self-hosted-chat-ui T5). The panel-decoration layer keeps the
 * duck-typed contract of the legacy `<message-editor>` element
 * (value / attachments / contextReferences / selectedCapabilities /
 * onInput / onSend / onFilesChange / currentModel / thinkingLevel), so
 * editor-bindings, drafts and the suggestion subsystems keep working against
 * the React-rendered composer. Plain data slots (contextReferences,
 * selectedCapabilities) are owned by the host/decoration layer; value and
 * attachments are backed by the React editor state.
 */
export type SurfaceEditorBridgeElement = HTMLElement & {
  value: string
  attachments: unknown[]
  contextReferences: unknown[]
  selectedCapabilities: unknown[]
  currentModel?: { id?: string; provider?: string; reasoning?: boolean }
  thinkingLevel?: string
  onInput?: (value: string) => void
  onSend?: (input: string, attachments: unknown[]) => void
  onFilesChange?: (files: unknown[]) => void
  onThinkingChange?: (level: string) => void
  requestUpdate?: () => void
  __quickforgePlanBaseOnSend?: (input: string, attachments: unknown[]) => void
  __quickforgePlanWrappedOnSend?: (input: string, attachments: unknown[]) => void
  __quickforgeAttachmentPasteGuard?: (event: ClipboardEvent) => void
  __quickforgeAttachmentDropGuard?: (event: DragEvent) => void
  __quickforgeLargePasteHandler?: (event: ClipboardEvent) => void
}

/**
 * Props of `ChatSurface` — the merged contract of the legacy `ChatPanel`
 * (`setAgent` config callbacks) and `AgentInterface` (feature toggles).
 */
export interface ChatSurfaceProps {
  /** Agent session driving the surface. Renders an empty state while unset. */
  agent?: Agent
  enableAttachments?: boolean
  enableModelSelector?: boolean
  enableThinkingSelector?: boolean
  /** Hide the composer dock entirely (read-only conversation views). */
  readOnly?: boolean
  /**
   * Host-driven snapshot refresh counter. The host bumps it when panel-level
   * state changes without an agent event (e.g. switching models rewrites
   * `agent.state.model` in place, see `updateCurrentAgentModel`); the surface
   * re-reads its snapshot so the composer model button and other
   * state-derived UI update. Replaces the legacy Lit `requestUpdate` re-render.
   */
  chatPanelRevision?: number
  /**
   * Whether command actions ("run in terminal") on code blocks are available.
   * Provided to `CodeBlock` through `CommandActionsEnabledContext`; the host
   * passes `!sideChatMode && !readOnly` (legacy `enableTerminalCommandActions`).
   */
  commandActionsEnabled?: boolean
  /**
   * Prompt for a missing provider API key. Return true to continue sending,
   * false to abort. When omitted, a missing key aborts the send (with a
   * console error), matching the legacy `AgentInterface` behavior.
   */
  onApiKeyRequired?: (provider: string) => Promise<boolean>
  /** Hook invoked after the API-key gate passes and before the editor clears. */
  onBeforeSend?: () => void | Promise<void>
  /** Click handler for per-message and aggregated usage/cost displays. */
  onCostClick?: () => void
  /** Overrides the model-selector button behavior. */
  onModelSelect?: () => void
}
