/**
 * Chat surface capability flags.
 *
 * The main conversation enables the full QuickForge surface. Side Chat uses a
 * fixed table, bot sessions use `BOT_CHAT_CAPABILITIES` (history is memory), and
 * read-only pages narrow a table through `applyChatPagePolicy`. Unsupported
 * controls are rendered separately in a native disabled state by the shared panel
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

/**
 * bot 的会话就是它的长期记忆（一个 bot = 一个持久会话）。它需要压缩给自己
 * 腾上下文，但历史不能被剪短：
 * - `forkFromMessage` 会复制出一份带着同样记忆和心跳指令的分身；
 * - `rollback` / `retry` 会直接从数组里抹掉轮次，压缩指针随后悬空
 *   （摘要消息被删、或摘要描述的那段已不存在）。
 * 文件回滚（`/rollback-turn`）只写磁盘、不碰 messages，不在能力位里。
 * 服务端 `rollbackSessionMessages` 另有无条件 403 兜底。
 */
export const BOT_CHAT_CAPABILITIES: ChatCapabilities = Object.freeze({
  ...QUICKFORGE_CHAT_CAPABILITIES,
  rollback: false,
  retry: false,
  forkFromMessage: false,
})

type ChatPagePolicy = {
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
