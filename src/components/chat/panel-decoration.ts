/**
 * Message and editor decoration for the ChatPanel.
 *
 * Handles injecting action buttons (copy, rollback, fork) below messages,
 * and decorating the composer area (Send/Stop toggle, Agent access selector, placeholder,
 * command bindings).
 */

import type { CapabilitySuggestion } from './capability-suggestions'
import type {
  AgentInterfaceElement,
  MessageEditorElement,
} from './chat-utils'
import { t } from '@/lib/i18n'
import type { AgentAccessMode } from '@/lib/types'
import type { OpenCodeAcpSession } from '@/lib/server-agent'
import { removeAgentAccessMenu, setupAgentAccessMenu } from './panel-decoration/agent-access-menu'
import { removeOpenCodeConfigMenu, setupOpenCodeConfigMenu } from './panel-decoration/opencode-config-menu'
import { removeOpenCodeModeMenu, setupOpenCodeModeMenu } from './panel-decoration/opencode-mode-menu'
import { hideNativeAttachmentControls, removeComposerPlusPopover, setupComposerPlusMenu } from './panel-decoration/composer-plus-menu'
import { decorateModelButtonLabel } from './panel-decoration/model-controls'
import { removePlanModeControls, setupPlanModeControls, syncPlanModeButton } from './panel-decoration/plan-mode-controls'
import { syncSendStopButton } from './panel-decoration/send-stop-button'
import { bindEditorCallbacks } from './panel-decoration/editor-bindings'
import { closeComposerModelMenu } from '@/lib/custom-model-selector'
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
export { injectAskUserCard, removeAskUserCard } from './panel-decoration/ask-user-card'
export { syncContextCompactionNotice } from './panel-decoration/context-compaction'
export { syncPersistDegradedNotice } from './panel-decoration/persist-degraded-notice'
export { createOpenCodeUsageIndicator } from './panel-decoration/opencode-usage'
export { releaseStreamingProcessGroups } from './panel-decoration/process-folding'

export type { MessageDecorationDeps } from './panel-decoration/message-actions'
export { decorateMessages, decorateSubagentProcessBlocks } from './panel-decoration/message-actions'
export { syncAssistantWaitingBubble } from './panel-decoration/assistant-waiting-bubble'
export { createScrollToBottomButton } from './panel-decoration/scroll-to-bottom-button'
export {
  createTodoWriteSummaryController,
  extractLatestTodoWriteSnapshot,
  isTodoWriteAcpMetadata,
  normalizeTodoWriteTodos,
  todoWriteCounts,
} from './panel-decoration/todo-write-summary'
export type {
  TodoWriteItem,
  TodoWriteMessage,
  TodoWriteSnapshot,
  TodoWriteStatus,
  TodoWriteSummaryController,
} from './panel-decoration/todo-write-summary'

// Inline local file path link decoration lives in ./panel-decoration/local-file-path-links.

// --- Editor decoration ---

export type EditorDecorationDeps = {
  panel: HTMLElement
  isStreaming: () => boolean
  isWaiting?: () => boolean
  abort: () => void
  agentAccessMode: AgentAccessMode
  harness?: 'quickforge' | 'claude-code' | 'opencode'
  getAcpSession?: () => OpenCodeAcpSession | null | undefined
  onOpenCodeConfigOptionChange?: (configId: string, value: boolean | string) => void
  onOpenCodeModeChange?: (modeId: string) => void
  planMode: boolean
  workspaceToolsEnabled: boolean
  readOnly: boolean
  allowModelControls: boolean
  planModeEnabled: boolean
  accessModeEnabled: boolean
  commandSuggestionsEnabled: boolean
  capabilitySuggestionsEnabled: boolean
  attachmentsEnabled: boolean
  fileReferenceSuggestionsEnabled: boolean
  disabledControls?: boolean
  onAccessModeChange: (mode: AgentAccessMode) => void
  onTogglePlanMode: () => void
  onInput: (value: string) => void
  onFilesChange: (files: unknown[]) => void
  removeCommandSuggestions: () => void
  updateCommandSuggestions: (value?: string) => void
  setupCommandTextareaHandler: (editor: MessageEditorElement | null) => void
  removeCapabilitySuggestions: () => void
  updateCapabilitySuggestions: (value?: string) => void
  setupCapabilityTextareaHandler: (editor: MessageEditorElement | null) => void
  removeFileReferenceSuggestions: () => void
  updateFileReferenceSuggestions: (value?: string) => void
  setupFileReferenceTextareaHandler: (editor: MessageEditorElement | null) => void
  syncContextChips: () => void
  selectPluginCapability: (pluginName: string) => void
  availablePluginRows: () => CapabilitySuggestion[]
  onBeforeSend?: (input: string) => void
}

export function disableComposerControls(panel: HTMLElement, editor: MessageEditorElement | null) {
  removeComposerPlusPopover(panel)
  removeAgentAccessMenu(panel, true)
  removePlanModeControls(editor)
  closeComposerModelMenu(panel.querySelector<HTMLElement>('.quickforge-model-trigger'), true)

  const controls = [
    panel.querySelector<HTMLButtonElement>('.quickforge-plus-inline'),
    panel.querySelector<HTMLButtonElement>('.quickforge-model-trigger'),
    panel.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline'),
    panel.querySelector<HTMLButtonElement>('.quickforge-plan-inline'),
  ]
  controls.forEach((button) => {
    if (!button) return
    button.disabled = true
    button.setAttribute('aria-expanded', 'false')
  })
  editor?.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((input) => {
    input.disabled = true
    input.value = ''
  })
}

export function decorateEditor(deps: EditorDecorationDeps) {
  const {
    panel,
    isStreaming,
    isWaiting,
    abort,
    agentAccessMode,
    harness,
    getAcpSession,
    onOpenCodeConfigOptionChange,
    onOpenCodeModeChange,
    planMode,
    workspaceToolsEnabled,
    readOnly,
    allowModelControls,
    planModeEnabled,
    accessModeEnabled,
    commandSuggestionsEnabled,
    capabilitySuggestionsEnabled,
    attachmentsEnabled,
    fileReferenceSuggestionsEnabled,
    disabledControls = false,
    onAccessModeChange,
    onTogglePlanMode,
    onInput,
    onFilesChange,
    removeCommandSuggestions,
    updateCommandSuggestions,
    setupCommandTextareaHandler,
    removeCapabilitySuggestions,
    updateCapabilitySuggestions,
    setupCapabilityTextareaHandler,
    removeFileReferenceSuggestions,
    updateFileReferenceSuggestions,
    setupFileReferenceTextareaHandler,
    syncContextChips,
    selectPluginCapability,
    availablePluginRows,
    onBeforeSend,
  } = deps

  const editor = panel.querySelector<MessageEditorElement>('message-editor')
  editor?.classList.add('quickforge-composer')
  editor?.parentElement?.classList.add('quickforge-composer-shell')
  editor?.parentElement?.parentElement?.classList.add('quickforge-composer-dock')
  const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
  if (textarea) textarea.placeholder = t('composerPlaceholder')

  if (readOnly) {
    panel.querySelector<HTMLElement>('.quickforge-composer-dock')?.remove()
    return
  }

  bindEditorCallbacks({
    editor,
    onInput,
    onFilesChange,
    removeCommandSuggestions,
    updateCommandSuggestions: commandSuggestionsEnabled ? updateCommandSuggestions : () => removeCommandSuggestions(),
    removeCapabilitySuggestions,
    updateCapabilitySuggestions: capabilitySuggestionsEnabled ? updateCapabilitySuggestions : () => removeCapabilitySuggestions(),
    removeFileReferenceSuggestions,
    updateFileReferenceSuggestions: fileReferenceSuggestionsEnabled ? updateFileReferenceSuggestions : () => removeFileReferenceSuggestions(),
    attachmentsEnabled,
    onBeforeSend,
  })
  if (commandSuggestionsEnabled) setupCommandTextareaHandler(editor)
  else removeCommandSuggestions()
  if (capabilitySuggestionsEnabled) setupCapabilityTextareaHandler(editor)
  else removeCapabilitySuggestions()
  if (fileReferenceSuggestionsEnabled) setupFileReferenceTextareaHandler(editor)
  else removeFileReferenceSuggestions()
  syncContextChips()
  if (planModeEnabled) setupPlanModeControls(editor, planMode, onTogglePlanMode)
  else removePlanModeControls(editor)

  const agentInterface = panel.querySelector<AgentInterfaceElement>('agent-interface')
  if (agentInterface) {
    const shouldRequestUpdate = agentInterface.enableModelSelector !== allowModelControls
    agentInterface.enableModelSelector = allowModelControls
    agentInterface.enableThinkingSelector = false
    if (shouldRequestUpdate) agentInterface.requestUpdate?.()
  }

  const editorRows = editor?.querySelectorAll<HTMLElement>('.flex.gap-2.items-center')
  const leftControls = editorRows?.[0]
  const rightControls = editorRows?.[editorRows.length - 1]
  if (!rightControls) return
  decorateModelButtonLabel(editor, rightControls)

  syncSendStopButton({
    rightControls,
    isStreaming,
    isWaiting,
    abort,
    removeCommandSuggestions,
  })

  if (!leftControls) {
    panel.querySelector<HTMLButtonElement>('.quickforge-plus-inline')?.remove()
    removeComposerPlusPopover(panel)
    if (!attachmentsEnabled && editor) hideNativeAttachmentControls(editor)
    panel.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline')?.remove()
    removeAgentAccessMenu(panel, disabledControls)
    panel.querySelector<HTMLButtonElement>('.quickforge-opencode-config-inline')?.remove()
    removeOpenCodeConfigMenu(panel)
    panel.querySelector<HTMLButtonElement>('.quickforge-opencode-mode-inline')?.remove()
    removeOpenCodeModeMenu(panel)
    panel.querySelector<HTMLButtonElement>('.quickforge-yolo-inline')?.remove()
    panel.querySelector<HTMLButtonElement>('.quickforge-plan-inline')?.remove()
    return
  }

  // All composer popovers/menus are mutually exclusive: opening one closes the
  // others (including the custom model menu) so they can never overlap.
  const dismissComposerMenus = () => {
    removeComposerPlusPopover(panel)
    removeOpenCodeConfigMenu(panel)
    removeOpenCodeModeMenu(panel)
    removeAgentAccessMenu(panel)
    closeComposerModelMenu()
  }

  if (editor) {
    editor.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((input) => { input.disabled = !attachmentsEnabled })
    if (!attachmentsEnabled) hideNativeAttachmentControls(editor, leftControls)
  }

  if (editor && (attachmentsEnabled || capabilitySuggestionsEnabled || disabledControls)) {
    setupComposerPlusMenu({
      panel,
      editor,
      leftControls,
      selectPluginCapability,
      availablePluginRows,
      removeCommandSuggestions,
      removeCapabilitySuggestions,
      removeFileReferenceSuggestions,
      attachmentsEnabled,
      pluginsEnabled: capabilitySuggestionsEnabled,
    })
  } else {
    panel.querySelector<HTMLButtonElement>('.quickforge-plus-inline')?.remove()
    removeComposerPlusPopover(panel)
    if (editor) hideNativeAttachmentControls(editor, leftControls)
  }

  if (planModeEnabled) {
    syncPlanModeButton({
      panel,
      leftControls,
      planMode,
      onTogglePlanMode,
    })
  } else {
    panel.querySelector<HTMLButtonElement>('.quickforge-plan-inline')?.remove()
  }

  if (harness === 'opencode' && getAcpSession && onOpenCodeConfigOptionChange && onOpenCodeModeChange) {
    setupOpenCodeConfigMenu({
      panel,
      leftControls,
      getAcpSession,
      isStreaming,
      onConfigOptionChange: onOpenCodeConfigOptionChange,
      onModeChange: onOpenCodeModeChange,
      dismissComposerMenus,
    })
    setupOpenCodeModeMenu({
      panel,
      rightControls,
      getAcpSession,
      isStreaming,
      onModeChange: onOpenCodeModeChange,
      dismissComposerMenus,
    })
  } else {
    panel.querySelector<HTMLButtonElement>('.quickforge-opencode-config-inline')?.remove()
    removeOpenCodeConfigMenu(panel)
    panel.querySelector<HTMLButtonElement>('.quickforge-opencode-mode-inline')?.remove()
    removeOpenCodeModeMenu(panel)
  }

  if (!workspaceToolsEnabled || !accessModeEnabled) {
    removeAgentAccessMenu(panel, disabledControls)
    panel.querySelector<HTMLButtonElement>('.quickforge-yolo-inline')?.remove()
    if (disabledControls) {
      setupAgentAccessMenu({
        panel,
        leftControls,
        agentAccessMode,
        onAccessModeChange,
        dismissComposerMenus,
      })
      disableComposerControls(panel, editor)
    } else {
      panel.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline')?.remove()
    }
    return
  }

  setupAgentAccessMenu({
    panel,
    leftControls,
    agentAccessMode,
    onAccessModeChange,
    dismissComposerMenus,
  })
}

// Draft helpers and tool approval card rendering live in focused modules and are
// re-exported at the top of this compatibility entrypoint.
