/**
 * Composer draft lifecycle + input handlers for `ChatPanelHost`.
 *
 * Owns the composer's draft capture/flush rules, the side-chat input memory
 * mirror, the editor input/file-change handlers, the restored-draft apply path
 * and the initial draft restore. The three flags that gate draft capture
 * (`initialComposerStateReady`, `composerInteracted`, `composerClearedForSend`)
 * live here so every path agrees on when a draft is written or cleared.
 *
 * Factory (no React hooks): the host creates it once per panel effect, then
 * calls the returned functions from the surface hooks / decoration passes.
 */

import type { ComposerDraft, MessageEditorElement } from '../chat-utils'
import { emptyDraft, hasDraft } from '../chat-utils'
import type { ComposerDraftContext } from '@/lib/composer-drafts'
import { clearComposerDraft, createComposerDraftRestoreGuard, loadComposerDraft } from '@/lib/composer-drafts'
import type { RestoredDraft } from '@/lib/types'
import type { SelectedCapability } from '@/lib/selected-capabilities'
import { logger } from '@/lib/logger'
import {
  captureComposerDraft,
  readComposerDraft,
  scheduleComposerDraftRestore,
  type ComposerDraftRestoreHandle,
} from '../panel-decoration'

type ComposerDraftRestoreGuard = ReturnType<typeof createComposerDraftRestoreGuard>

export type ComposerInputDeps = {
  panel: HTMLElement
  hostRef: { current: HTMLElement | null }
  sideChatMode: boolean
  sideChatInputMemory?: { get: () => string; set: (text: string) => void }
  sessionId: string
  currentDraftKey: string
  currentDraftContext: ComposerDraftContext
  composerDraftsRef: { current: Map<string, ComposerDraft> }
  readyComposerPanels: WeakSet<HTMLElement>
  draftRestoreGuard: ComposerDraftRestoreGuard
  restoredDraftRef: { current: RestoredDraft | undefined }
  restoredDraftIdRef: { current: number | undefined }
  restoredDraftRestoreRef: { current: ComposerDraftRestoreHandle | null }
  applyingRestoredDraftRef: { current: boolean }
  isDisposed: () => boolean
  cancelRestoredDraftRestore: () => void
  cancelPendingDraftSave: () => void
  schedulePersistDraft: (key: string, draft: ComposerDraft, context: ComposerDraftContext) => void
  persistCurrentComposerDraft: (panel: HTMLElement, key?: string, context?: ComposerDraftContext) => void
  consumeRestoredDraft: (draftId: number) => void
  restoreDraftForSession: (panel: HTMLElement, draft: RestoredDraft, sessionId: string, key: string) => void
  /** Capability chips owned by the capability-suggestion subsystem. */
  getSelectedCapabilities: () => SelectedCapability[]
  restoreSelectedCapabilities: (capabilities: SelectedCapability[]) => void
  syncTaskLauncher: () => void
  scheduleDecorate: () => void
}

export function createComposerInputWiring(deps: ComposerInputDeps) {
  const {
    panel,
    currentDraftKey,
    currentDraftContext,
    composerDraftsRef,
    readyComposerPanels,
    draftRestoreGuard,
    restoredDraftRef,
    restoredDraftIdRef,
    restoredDraftRestoreRef,
    applyingRestoredDraftRef,
  } = deps
  let composerClearedForSend = false
  let initialComposerStateReady = false
  let composerInteracted = false

  const isReady = () => initialComposerStateReady || composerInteracted || readyComposerPanels.has(panel)

  const flushComposerDraft = () => {
    if (deps.sideChatMode) {
      deps.sideChatInputMemory?.set(readComposerDraft(panel).text)
    } else if (composerClearedForSend) {
      composerDraftsRef.current.delete(currentDraftKey)
      void clearComposerDraft(currentDraftKey).catch((err) => logger.error('Failed to clear composer draft:', err))
    } else if (isReady()) {
      captureComposerDraft(panel, composerDraftsRef.current, currentDraftKey)
      deps.persistCurrentComposerDraft(panel, currentDraftKey, currentDraftContext)
    }
  }

  const handleComposerInteraction = () => {
    if (applyingRestoredDraftRef.current) return
    composerInteracted = true
    draftRestoreGuard.invalidate()
    deps.cancelRestoredDraftRestore()
    const draft = restoredDraftRef.current
    if (draft && (!draft.sessionId || draft.sessionId === deps.sessionId)) {
      deps.consumeRestoredDraft(draft.id)
    }
  }

  const updateSideChatInputMemory = (text?: string) => {
    if (!deps.sideChatMode) return
    const editor = panel.querySelector<MessageEditorElement>('.qf-message-editor')
    const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
    deps.sideChatInputMemory?.set(text ?? editor?.value ?? textarea?.value ?? '')
  }

  const updateComposerDraft = (draft: ComposerDraft) => {
    if (deps.sideChatMode) {
      updateSideChatInputMemory(draft.text)
      return
    }
    if (hasDraft(draft)) {
      composerDraftsRef.current.set(currentDraftKey, draft)
      deps.schedulePersistDraft(currentDraftKey, draft, currentDraftContext)
    } else {
      composerDraftsRef.current.delete(currentDraftKey)
      deps.cancelPendingDraftSave()
      void clearComposerDraft(currentDraftKey).catch((err) => logger.error('Failed to clear composer draft:', err))
    }
  }

  /**
   * Cached `.qf-message-editor` lookup.
   *
   * `handleEditorInput` runs on every keystroke and used to resolve the editor
   * node (and its `<textarea>`) with two `querySelector` calls per key. The node
   * only changes when the surface re-mounts (session switch / agent swap), so
   * the lookup is validated with `isConnected` and reused; the query re-runs
   * only when the cached node was detached.
   */
  let cachedEditor: MessageEditorElement | null = null
  const resolveEditor = () => {
    if (cachedEditor?.isConnected) return cachedEditor
    cachedEditor = panel.querySelector<MessageEditorElement>('.qf-message-editor')
    return cachedEditor
  }

  const handleEditorInput = (value: string) => {
    handleComposerInteraction()
    composerClearedForSend = false
    if (deps.sideChatMode) {
      updateSideChatInputMemory(value)
      return
    }
    // Draft persistence needs the attachment/context/capability slots, not the
    // textarea: the text arrives as the argument.
    const editor = resolveEditor()
    const attachments = editor?.attachments ? [...editor.attachments] : []
    const contextReferences = editor?.contextReferences ? [...editor.contextReferences] : []
    const selectedCapabilities = deps.getSelectedCapabilities()
    updateComposerDraft({ text: value, attachments, contextReferences, selectedCapabilities })
  }

  const handleEditorFilesChange = (files: unknown[]) => {
    handleComposerInteraction()
    composerClearedForSend = false
    const editor = resolveEditor()
    if (deps.sideChatMode) {
      if (editor) {
        editor.attachments = []
        editor.contextReferences = []
        editor.selectedCapabilities = []
        editor.requestUpdate?.()
      }
      updateSideChatInputMemory()
      return
    }
    const contextReferences = editor?.contextReferences ? [...editor.contextReferences] : []
    const selectedCapabilities = deps.getSelectedCapabilities()
    updateComposerDraft({ text: editor?.value ?? '', attachments: files ? [...files] : [], contextReferences, selectedCapabilities })

    window.requestAnimationFrame(() => deps.scheduleDecorate())
  }

  const restoreSideChatDraft = () => {
    if (!deps.sideChatMode) return
    const text = deps.sideChatInputMemory?.get() ?? ''
    const editor = panel.querySelector<MessageEditorElement>('.qf-message-editor')
    const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
    if (editor) {
      editor.value = text
      editor.attachments = []
      editor.contextReferences = []
      editor.selectedCapabilities = []
      editor.requestUpdate?.()
    }
    if (textarea) textarea.value = text
  }

  /** Must run from panel initialization, after the surface's first paint. */
  const restoreInitialDraft = () => {
    const draft = restoredDraftRef.current
    const restoreVersion = draftRestoreGuard.version()
    const restoreStoredDraft = (storedDraft?: ComposerDraft) => {
      if (deps.sideChatMode) {
        restoreSideChatDraft()
        initialComposerStateReady = true
        readyComposerPanels.add(panel)
        return
      }
      if (deps.isDisposed() || !draftRestoreGuard.isCurrent(restoreVersion)) return
      deps.restoreSelectedCapabilities(storedDraft?.selectedCapabilities ?? [])
      if (draft && restoredDraftIdRef.current !== draft.id) {
        deps.restoreDraftForSession(panel, draft, deps.sessionId, currentDraftKey)
      } else {
        const draftToRestore = storedDraft ?? composerDraftsRef.current.get(currentDraftKey) ?? emptyDraft()
        if (!hasDraft(draftToRestore)) {
          initialComposerStateReady = true
          deps.syncTaskLauncher()
        }
        deps.cancelRestoredDraftRestore()
        restoredDraftRestoreRef.current = scheduleComposerDraftRestore(panel, draftToRestore, composerDraftsRef.current, currentDraftKey, {
          shouldApply: () => (
            !deps.isDisposed()
            && draftRestoreGuard.isCurrent(restoreVersion)
            && panel.isConnected
            && Boolean(deps.hostRef.current?.contains(panel))
          ),
          onApplyStart: () => { applyingRestoredDraftRef.current = true },
          onApplyEnd: () => { applyingRestoredDraftRef.current = false },
          onApplied: () => {
            initialComposerStateReady = true
            readyComposerPanels.add(panel)
            deps.syncTaskLauncher()
          },
        })
      }
    }
    if (deps.sideChatMode) {
      restoreStoredDraft()
    } else if (draft && restoredDraftIdRef.current !== draft.id) {
      restoreStoredDraft()
    } else {
      const memoryDraft = composerDraftsRef.current.get(currentDraftKey)
      if (memoryDraft) {
        restoreStoredDraft(memoryDraft)
      } else {
        void loadComposerDraft(currentDraftKey)
          .then((storedDraft) => restoreStoredDraft(storedDraft))
          .catch((err) => {
            logger.error('Failed to load composer draft:', err)
            restoreStoredDraft()
          })
      }
    }
  }

  return {
    isReady,
    flushComposerDraft,
    handleComposerInteraction,
    handleEditorInput,
    handleEditorFilesChange,
    updateSideChatInputMemory,
    restoreSideChatDraft,
    restoreInitialDraft,
    /** Send started: the next flush must clear, not persist. */
    markComposerClearedForSend() {
      composerClearedForSend = true
    },
  }
}
