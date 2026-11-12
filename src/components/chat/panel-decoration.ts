/**
 * Message and editor decoration for the ChatPanel.
 *
 * Handles injecting action buttons (copy, rollback, fork) below messages,
 * and decorating the composer area (Send/Stop toggle, Agent access selector, placeholder,
 * command bindings).
 */

export {
  readComposerDraft,
  captureComposerDraft,
  restoreComposerDraft,
  scheduleComposerDraftRestore,
} from './panel-decoration/drafts'
export type { ComposerDraftRestoreHandle } from './panel-decoration/drafts'
export type { ApprovalCardDeps, ToolApprovalSource } from './panel-decoration/approval-card'
export { injectApprovalCard, removeApprovalCard } from './panel-decoration/approval-card'
export type { AskUserCardDeps } from './panel-decoration/ask-user-card'
export { injectAskUserCard, removeAskUserCard, submitAskTextToPendingAsk } from './panel-decoration/ask-user-card'
export type { GoalCardViewModel, GoalCardTone, GoalCardCriteriaView } from './panel-decoration/goal-card'
export { buildGoalCardViewModel } from './panel-decoration/goal-card'
export type {
  GoalControlStripUiState,
  GoalControlStripView,
} from './panel-decoration/goal-control-strip'
export { buildGoalControlStripView } from './panel-decoration/goal-control-strip'

export { createTurnErrorTracker } from './panel-decoration/turn-error-state'
export type { TurnErrorTracker, TurnErrorView } from './panel-decoration/turn-error-state'
export { decorateAssistantArtifactCard, syncAssistantArtifactCard } from './panel-decoration/assistant-artifact-card'

export type { MessageDecorationDeps } from './panel-decoration/message-actions'
export { decorateMessages, decorateStreamingMessages } from './panel-decoration/message-actions'
export { createScrollToBottomButton } from './panel-decoration/scroll-to-bottom-button'
export {
  extractLatestTodoWriteSnapshot,
  normalizeTodoWriteTodos,
  readLatestTodoWriteSnapshot,
  isFinalTodoSnapshot,
  shouldRetireTodoSummary,
  todoWriteCounts,
} from './panel-decoration/todo-write-summary'
export type {
  TodoWriteItem,
  TodoWriteMessage,
  TodoWriteSnapshot,
  TodoWriteStatus,
} from './panel-decoration/todo-write-summary'
export { createMessageQueuePanelController } from './panel-decoration/message-queue'
export type { MessageQueuePanelController, MessageQueuePanelState } from './panel-decoration/message-queue'
export type { BackgroundCommandSummary } from './panel-decoration/subagent-running-indicator'
export {
  getRunningSubagentRuns,
  removeSubagentRunningIndicator,
  removeSubagentRunningIndicatorMenu,
  setupSubagentRunningIndicator,
} from './panel-decoration/subagent-running-indicator'

// Inline local file path link decoration lives in ./panel-decoration/local-file-path-links.

export { decorateEditor, disableComposerControls } from './panel-decoration/editor-decorations'

// Draft helpers and tool approval card rendering live in focused modules and are
// re-exported at the top of this compatibility entrypoint.
