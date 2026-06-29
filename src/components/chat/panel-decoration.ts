/**
 * Message and editor decoration for the ChatPanel.
 *
 * Handles injecting action buttons (copy, rollback, fork) below messages,
 * and decorating the composer area (Send/Stop toggle, Agent access selector, placeholder,
 * command bindings).
 */

import type { BuiltinPluginMention } from './capability-suggestions'
import type {
  AgentInterfaceElement,
  MessageEditorElement,
} from './chat-utils'
import { t } from '@/lib/i18n'
import type { AgentAccessMode } from '@/lib/types'
import { removeAgentAccessMenu, setupAgentAccessMenu } from './panel-decoration/agent-access-menu'
import { removeComposerPlusPopover, setupComposerPlusMenu } from './panel-decoration/composer-plus-menu'
import { decorateModelButtonLabel } from './panel-decoration/model-controls'
import { setupPlanModeControls, syncPlanModeButton } from './panel-decoration/plan-mode-controls'
import { syncSendStopButton } from './panel-decoration/send-stop-button'
import { bindEditorCallbacks } from './panel-decoration/editor-bindings'
export { readComposerDraft, captureComposerDraft, restoreComposerDraft } from './panel-decoration/drafts'
export type { ApprovalCardDeps, ToolApprovalSource } from './panel-decoration/approval-card'
export { injectApprovalCard, removeApprovalCard } from './panel-decoration/approval-card'
export { syncContextCompactionNotice } from './panel-decoration/context-compaction'

export type { MessageDecorationDeps } from './panel-decoration/message-actions'
export { decorateMessages } from './panel-decoration/message-actions'
export { syncAssistantWaitingBubble } from './panel-decoration/assistant-waiting-bubble'

// Inline local file path link decoration lives in ./panel-decoration/local-file-path-links.

// --- Editor decoration ---

export type EditorDecorationDeps = {
  panel: HTMLElement
  isStreaming: () => boolean
  abort: () => void
  agentAccessMode: AgentAccessMode
  planMode: boolean
  workspaceToolsEnabled: boolean
  readOnly: boolean
  allowModelControls: boolean
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
  insertBuiltinPluginMention: (mention: BuiltinPluginMention) => void
  onBeforeSend?: (input: string) => void
}

export function decorateEditor(deps: EditorDecorationDeps) {
  const {
    panel,
    isStreaming,
    abort,
    agentAccessMode,
    planMode,
    workspaceToolsEnabled,
    readOnly,
    allowModelControls,
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
    insertBuiltinPluginMention,
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
    updateCommandSuggestions,
    removeCapabilitySuggestions,
    updateCapabilitySuggestions,
    onBeforeSend,
  })
  setupCommandTextareaHandler(editor)
  setupCapabilityTextareaHandler(editor)
  setupPlanModeControls(editor, planMode, onTogglePlanMode)

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
    abort,
    removeCommandSuggestions,
  })

  if (!leftControls) {
    panel.querySelector<HTMLButtonElement>('.quickforge-plus-inline')?.remove()
    removeComposerPlusPopover(panel)
    panel.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline')?.remove()
    removeAgentAccessMenu(panel)
    panel.querySelector<HTMLButtonElement>('.quickforge-yolo-inline')?.remove()
    panel.querySelector<HTMLButtonElement>('.quickforge-plan-inline')?.remove()
    return
  }

  if (editor) {
    setupComposerPlusMenu({
      panel,
      editor,
      leftControls,
      insertBuiltinPluginMention,
      removeCommandSuggestions,
      removeCapabilitySuggestions,
    })
  }

  syncPlanModeButton({
    panel,
    leftControls,
    planMode,
    onTogglePlanMode,
  })

  if (!workspaceToolsEnabled) {
    panel.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline')?.remove()
    removeAgentAccessMenu(panel)
    panel.querySelector<HTMLButtonElement>('.quickforge-yolo-inline')?.remove()
    return
  }

  setupAgentAccessMenu({
    panel,
    leftControls,
    agentAccessMode,
    onAccessModeChange,
    dismissComposerMenus: () => removeComposerPlusPopover(panel),
  })
}

// Draft helpers and tool approval card rendering live in focused modules and are
// re-exported at the top of this compatibility entrypoint.
