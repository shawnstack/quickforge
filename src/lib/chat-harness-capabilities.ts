import type { AgentHarness } from './types'

export type ChatHarnessCapabilities = {
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
  forkSession: boolean
  harnessConfig: boolean
  attachments: boolean
}

export const QUICKFORGE_CHAT_HARNESS_CAPABILITIES: ChatHarnessCapabilities = Object.freeze({
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
  forkSession: false,
  harnessConfig: false,
  attachments: true,
})

export const OPENCODE_P0_CHAT_HARNESS_CAPABILITIES: ChatHarnessCapabilities = Object.freeze({
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
  forkSession: true,
  harnessConfig: true,
  attachments: true,
})

export function resolveChatHarnessCapabilities(harness: AgentHarness | null | undefined): ChatHarnessCapabilities {
  return harness === 'opencode'
    ? OPENCODE_P0_CHAT_HARNESS_CAPABILITIES
    : QUICKFORGE_CHAT_HARNESS_CAPABILITIES
}

export type ChatPagePolicy = {
  readOnly?: boolean
  disableFork?: boolean
}

export function applyChatPagePolicy(
  capabilities: ChatHarnessCapabilities,
  policy: ChatPagePolicy,
): ChatHarnessCapabilities {
  if (!policy.readOnly && !policy.disableFork) return capabilities
  return {
    ...capabilities,
    rollback: capabilities.rollback && !policy.readOnly,
    retry: capabilities.retry && !policy.readOnly,
    forkFromMessage: capabilities.forkFromMessage && !policy.readOnly && !policy.disableFork,
    forkSession: capabilities.forkSession && !policy.readOnly && !policy.disableFork,
    harnessConfig: capabilities.harnessConfig && !policy.readOnly,
    attachments: capabilities.attachments && !policy.readOnly,
    planMode: capabilities.planMode && !policy.readOnly,
    accessMode: capabilities.accessMode && !policy.readOnly,
    commands: capabilities.commands && !policy.readOnly,
    capabilitySuggestions: capabilities.capabilitySuggestions && !policy.readOnly,
  }
}

export function shouldSendComposerInput(
  capabilities: Pick<ChatHarnessCapabilities, 'attachments'>,
  input: string,
  attachments: readonly unknown[] | null | undefined,
) {
  const hasText = String(input ?? '').trim().length > 0
  const hasAttachments = (attachments?.length ?? 0) > 0
  if (!capabilities.attachments && hasAttachments) return false
  return hasText || hasAttachments
}
