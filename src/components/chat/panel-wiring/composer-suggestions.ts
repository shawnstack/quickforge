/**
 * Composer suggestion subsystems for `ChatPanelHost`: `/` commands, `+`
 * plugin capabilities, `@` project file references, and the task launcher.
 *
 * They are created together because they share the composer draft restore
 * path and remove each other's popovers (only one menu may be open). The
 * module is a plain setup function (no React hooks) so the host effect count
 * and ordering stay unchanged.
 */

import type { ComposerDraft, CustomCommandSummary } from '../chat-utils'
import { createCommandSuggestions } from '../command-suggestions'
import { fetchSlashCatalog } from '@/lib/slash-catalog'
import { createCapabilitySuggestions, type CapabilitySuggestion } from '../capability-suggestions'
import { createTaskLauncher } from '../task-launcher'
import { createFileReferenceSuggestions, canUseFileReferenceSuggestions } from '../file-reference-suggestions'
import { readComposerDraft, restoreComposerDraft } from '../panel-decoration'
import type { ComposerDraftContext } from '@/lib/composer-drafts'

type TaskLauncherState = {
  visible: boolean
  dismiss?: () => void
}

export type ComposerSuggestionsAgent = {
  state: {
    isStreaming: boolean
    messages: unknown[]
  }
}

export type ComposerSuggestionsDeps = {
  panel: HTMLElement
  currentDraftKey: string
  currentDraftContext: ComposerDraftContext
  composerDraftsRef: { current: Map<string, ComposerDraft> }
  customCommandsRef: { current: CustomCommandSummary[] }
  slashCatalogProjectIdRef: { current: string | undefined }
  schedulePersistDraft: (key: string, draft: ComposerDraft, context: ComposerDraftContext) => void
  /** Publishes the "+" menu handlers on the surface's send-hooks ref. */
  surfaceSendHooksRef: {
    current: {
      availablePluginRows?: () => CapabilitySuggestion[]
      selectPluginCapability?: (pluginName: string) => void
    } | null
  }
  taskLauncherStateRef: { current: TaskLauncherState }
  handleComposerInteraction: () => void
  isComposerReady: () => boolean
  isDisposed: () => boolean
  taskLauncherEnabled: boolean
  sideChatMode: boolean
  readOnly: boolean
  capabilitiesEnabled: boolean
  agent: ComposerSuggestionsAgent
  projectId?: string
}

export function setupComposerSuggestions(deps: ComposerSuggestionsDeps) {
  const {
    panel,
    currentDraftKey,
    currentDraftContext,
    capabilitiesEnabled,
    sideChatMode,
    readOnly,
    taskLauncherEnabled,
    agent,
    projectId,
  } = deps

  const restoreSuggestionDraft = (draft: ComposerDraft) => {
    restoreComposerDraft(panel, draft, deps.composerDraftsRef.current, currentDraftKey)
    deps.schedulePersistDraft(currentDraftKey, draft, currentDraftContext)
  }
  // --- Command suggestions subsystem ---
  const cmdSuggestions = createCommandSuggestions({
    panel,
    getCustomCommands: () => deps.customCommandsRef.current,
    getComposerDrafts: () => deps.composerDraftsRef.current,
    sessionId: currentDraftKey,
    setComposerDrafts: (drafts) => { deps.composerDraftsRef.current = drafts },
    restoreDraftIntoComposer: restoreSuggestionDraft,
    loadSlashCatalog: () => fetchSlashCatalog(deps.slashCatalogProjectIdRef.current),
  })

  // --- Plugin capability selection subsystem (+ menu only; never inferred from @ text) ---
  const capabilitySuggestions = createCapabilitySuggestions({
    panel,
    enabled: capabilitiesEnabled,
    restoreDraftIntoComposer: restoreSuggestionDraft,
  })
  // The "+" menu is rendered by the surface, but its data comes from this
  // subsystem: publish the handlers on the same ref the surface reads.
  if (deps.surfaceSendHooksRef.current) {
    deps.surfaceSendHooksRef.current.availablePluginRows = capabilitySuggestions.availablePluginRows
    deps.surfaceSendHooksRef.current.selectPluginCapability = capabilitySuggestions.selectPlugin
  }

  const taskLauncher = taskLauncherEnabled && !sideChatMode && !readOnly && !('shareId' in agent)
    ? createTaskLauncher({
        panel,
        visible: () => deps.taskLauncherStateRef.current.visible && !agent.state.isStreaming && agent.state.messages.length === 0,
        read: () => readComposerDraft(panel),
        restore: restoreSuggestionDraft,
        interact: () => deps.handleComposerInteraction(),
        ready: () => !deps.isDisposed() && deps.isComposerReady(),
        capabilities: capabilitySuggestions,
        capabilitiesEnabled,
      })
    : null

  // --- @ current-project file reference subsystem ---
  const fileReferenceSuggestions = createFileReferenceSuggestions({
    panel,
    projectId,
    enabled: !sideChatMode && canUseFileReferenceSuggestions({
      projectId,
      readOnly,
      shared: 'shareId' in agent,
    }),
    restoreDraftIntoComposer: restoreSuggestionDraft,
    removeCommandSuggestions: cmdSuggestions.remove,
    removeCapabilitySuggestions: capabilitySuggestions.remove,
    // The "+" popover is React-owned and closes itself when a suggestion menu
    // opens (both see the same outside pointerdown), so no remover is needed.
  })

  return {
    cmdSuggestions,
    capabilitySuggestions,
    taskLauncher,
    fileReferenceSuggestions,
    restoreSuggestionDraft,
    /** Suggestion-owned cleanup; the task launcher is disposed separately by the host. */
    cleanup() {
      cmdSuggestions.remove()
      cmdSuggestions.cleanupTextareaHandler()
      capabilitySuggestions.remove()
      capabilitySuggestions.cleanupTextareaHandler()
      fileReferenceSuggestions.remove()
      fileReferenceSuggestions.cleanupTextareaHandler()
    },
  }
}
