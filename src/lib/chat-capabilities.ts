/**
 * Chat surface capability flags.
 *
 * The main conversation enables the full QuickForge surface; Side Chat and
 * read-only pages narrow it through `applyChatPagePolicy`. Unsupported controls
 * are rendered separately in a native disabled state by the shared panel
 * decoration.
 */

export type ChatCapabilities = {
  modelSelection: boolean
  thinkingSelection: boolean
  clientApiKeyCheck: boolean
  planMode: boolean
  accessMode: boolean
  commands: boolean
  capabilitySuggestions: boolean
  contextUsage: boolean
  compaction: boolean
  rollback: boolean
  retry: boolean
  forkFromMessage: boolean
  attachments: boolean
  /** Steer a queued message into the running turn. */
  messageSteering: boolean
  /** Goal mode card and actions (QuickForge main chat only). */
  goal: boolean
}

export const QUICKFORGE_CHAT_CAPABILITIES: ChatCapabilities = Object.freeze({
  modelSelection: true,
  thinkingSelection: true,
  clientApiKeyCheck: true,
  planMode: true,
  accessMode: true,
  commands: true,
  capabilitySuggestions: true,
  contextUsage: true,
  compaction: true,
  rollback: true,
  retry: true,
  forkFromMessage: true,
  attachments: true,
  messageSteering: true,
  goal: true,
})

/**
 * Side Chat reuses the QuickForge surface, but capability flags represent
 * executable UI actions. Unsupported controls are rendered separately in a
 * native disabled state by the shared panel decoration.
 */
export const SIDE_CHAT_UI_CAPABILITIES: ChatCapabilities = Object.freeze({
  modelSelection: false,
  thinkingSelection: false,
  clientApiKeyCheck: false,
  planMode: false,
  accessMode: false,
  commands: false,
  capabilitySuggestions: false,
  contextUsage: false,
  compaction: false,
  rollback: false,
  retry: false,
  forkFromMessage: false,
  attachments: false,
  messageSteering: false,
  goal: false,
})

// Backward-compatible name for callers/tests that still import the old policy.
export const SIDE_CHAT_CAPABILITIES = SIDE_CHAT_UI_CAPABILITIES

export type ChatPagePolicy = {
  readOnly?: boolean
  disableFork?: boolean
}

export function applyChatPagePolicy(
  capabilities: ChatCapabilities,
  policy: ChatPagePolicy,
): ChatCapabilities {
  if (!policy.readOnly && !policy.disableFork) return capabilities
  return {
    ...capabilities,
    rollback: capabilities.rollback && !policy.readOnly,
    retry: capabilities.retry && !policy.readOnly,
    forkFromMessage: capabilities.forkFromMessage && !policy.readOnly && !policy.disableFork,
    attachments: capabilities.attachments && !policy.readOnly,
    planMode: capabilities.planMode && !policy.readOnly,
    accessMode: capabilities.accessMode && !policy.readOnly,
    commands: capabilities.commands && !policy.readOnly,
    capabilitySuggestions: capabilities.capabilitySuggestions && !policy.readOnly,
    goal: capabilities.goal && !policy.readOnly,
  }
}

export function shouldSendComposerInput(
  capabilities: Pick<ChatCapabilities, 'attachments'>,
  input: string,
  attachments: readonly unknown[] | null | undefined,
) {
  const hasText = String(input ?? '').trim().length > 0
  const hasAttachments = (attachments?.length ?? 0) > 0
  if (!capabilities.attachments && hasAttachments) return false
  return hasText || hasAttachments
}
