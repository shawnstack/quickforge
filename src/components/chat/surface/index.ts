/**
 * Self-hosted React chat surface (self-hosted-chat-ui T3).
 *
 * React replacement for the legacy ChatPanel/AgentInterface component tree.
 * Mounted by ChatPanelHost (the host owns wiring; this module only exposes the surface API).
 */
export { ChatSurface, readAgentSnapshot, runSendMessage, type AgentSurfaceSnapshot, type SendMessageContext } from './ChatSurface'
export type { ChatSurfaceHandle, ChatSurfaceProps, SurfaceEditorBridgeElement } from './ChatTypes'
export { MessageList, collectToolResultsById } from './MessageList'
export { UserMessage } from './UserMessage'
export { AssistantMessage } from './AssistantMessage'
export { ToolMessage } from './ToolMessage'
export { ThinkingBlock } from './ThinkingBlock'
export { MessageEditor, filterFilesByLimits, loadSurfaceAttachment, resolveEditorKeyDown } from './MessageEditor'
export { AttachmentTile } from './AttachmentTile'
export { AttachmentOverlay, openAttachmentOverlay } from './AttachmentOverlay'
export { UsageBar, aggregateUsage, formatUsage } from './UsageBar'
export { ApiKeyPromptDialog, promptApiKey, startApiKeyPolling } from './ApiKeyPromptDialog'
export { MarkdownBlock } from './Markdown'
