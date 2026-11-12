/**
 * Editor decoration for the ChatPanel composer.
 *
 * Split out of the panel-decoration barrel so the barrel stays a pure
 * re-export surface. Behaviour is unchanged.
 */

import type {
  MessageEditorElement,
} from '../chat-utils'
import { t } from '@/lib/i18n'
import { removeAgentAccessMenu } from './agent-access-menu'
import {
  removeSubagentRunningIndicator,
  removeSubagentRunningIndicatorMenu,
  setupSubagentRunningIndicator,
  type BackgroundCommandSummary,
} from './subagent-running-indicator'
import { removePlanModeControls, setupPlanModeControls } from './plan-mode-controls'

import { bindEditorCallbacks } from './editor-bindings'
import { closeComposerModelMenu } from '@/lib/custom-model-selector'

type EditorDecorationDeps = {
  panel: HTMLElement
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
  subagentRunningIndicatorEnabled?: boolean
  getPendingToolCalls?: () => Iterable<string>
  getBackgroundCommands?: () => BackgroundCommandSummary[]
  disabledControls?: boolean
  /** Shift+Tab shortcut handler; the trigger itself is React-rendered. */
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
  onBeforeSend?: (input: string) => void
  sessionId?: string
  onOpenLocalFilePath?: (path: string) => void
}

export function disableComposerControls(panel: HTMLElement, editor: MessageEditorElement | null) {
  removeAgentAccessMenu(panel, true)
  removeSubagentRunningIndicator(panel)
  removePlanModeControls(editor)
  closeComposerModelMenu(panel.querySelector<HTMLElement>('.quickforge-model-trigger'), true)

  // The "+" and thinking triggers are React-rendered now; disabling them is a
  // surface concern (`enableAttachments` / `disabledControls`), so this pass only
  // disables the buttons it still owns.
  const controls = [
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
    planMode,
    workspaceToolsEnabled,
    readOnly,
    planModeEnabled,
    accessModeEnabled,
    commandSuggestionsEnabled,
    capabilitySuggestionsEnabled,
    attachmentsEnabled,
    fileReferenceSuggestionsEnabled,
    subagentRunningIndicatorEnabled = false,
    getPendingToolCalls = () => [],
    getBackgroundCommands = () => [],
    disabledControls = false,
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
    onBeforeSend,
    sessionId,
    onOpenLocalFilePath,
  } = deps

  const editor = panel.querySelector<MessageEditorElement>('.qf-message-editor')
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
    sessionId,
    onOpenLocalFilePath,
  })
  if (commandSuggestionsEnabled) setupCommandTextareaHandler(editor)
  else removeCommandSuggestions()
  if (capabilitySuggestionsEnabled) setupCapabilityTextareaHandler(editor)
  else removeCapabilitySuggestions()
  if (fileReferenceSuggestionsEnabled) setupFileReferenceTextareaHandler(editor)
  else removeFileReferenceSuggestions()
  syncContextChips()
  // `onTogglePlanMode` stays in the deps: the Shift+Tab shortcut still lives in
  // the decoration layer (it is bound to the editor textarea, not rendered).
  if (planModeEnabled) setupPlanModeControls(editor, planMode, onTogglePlanMode)
  else removePlanModeControls(editor)

  // The React ChatSurface receives enableModelSelector/enableThinkingSelector
  // as props from ChatPanelHost; the decoration layer no longer flips legacy
  // element properties here.

  const editorRows = editor?.querySelectorAll<HTMLElement>('.flex.gap-2.items-center')
  const leftControls = editorRows?.[0]
  const rightControls = editorRows?.[editorRows.length - 1]
  if (!rightControls) return

  if (!leftControls) {
    panel.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline')?.remove()
    removeAgentAccessMenu(panel, disabledControls)
    removeSubagentRunningIndicator(panel)
    panel.querySelector<HTMLButtonElement>('.quickforge-yolo-inline')?.remove()
    panel.querySelector<HTMLButtonElement>('.quickforge-plan-inline')?.remove()
    return
  }

  // All composer popovers/menus are mutually exclusive: opening one closes the
  // others (including the custom model menu) so they can never overlap.
  const dismissComposerMenus = () => {
    removeAgentAccessMenu(panel)
    removeSubagentRunningIndicatorMenu(panel)
    closeComposerModelMenu(panel.querySelector<HTMLElement>('.quickforge-model-trigger'), true)
  }

  // The QuickForge "+" menu (composer-plus-menu), thinking selector
  // (thinking-level-controls), plan-mode toggle (plan-mode-controls) and
  // agent-access trigger + menu (agent-access-menu) are rendered by the surface
  // now. Only the subagent running indicator stays in this pass — it owns a
  // body-level floating list and DOM diffing that is not a render concern.
  if (editor) {
    editor.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((input) => { input.disabled = !attachmentsEnabled })
  }

  if (!workspaceToolsEnabled || !accessModeEnabled) {
    panel.querySelector<HTMLButtonElement>('.quickforge-yolo-inline')?.remove()
    if (!disabledControls) {
      setupSubagentRunningIndicator({
        panel,
        leftControls,
        enabled: subagentRunningIndicatorEnabled,
        getPendingToolCalls,
        getBackgroundCommands,
        sessionId,
        dismissComposerMenus,
      })
    }
    return
  }

  setupSubagentRunningIndicator({
    panel,
    leftControls,
    enabled: subagentRunningIndicatorEnabled,
    getPendingToolCalls,
    getBackgroundCommands,
    sessionId,
    dismissComposerMenus,
  })
}
