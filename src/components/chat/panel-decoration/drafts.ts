import type {
  MessageEditorElement,
  ComposerDraft,
} from '../chat-utils'
import { hasDraft } from '../chat-utils'

export function readComposerDraft(panel: HTMLElement): ComposerDraft {
  const editor = panel.querySelector<MessageEditorElement>('message-editor')
  const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
  const text = editor?.value ?? textarea?.value ?? ''
  const attachments = editor?.attachments ? [...editor.attachments] : []
  const contextReferences = editor?.contextReferences ? [...editor.contextReferences] : []
  const selectedCapabilities = editor?.selectedCapabilities ? [...editor.selectedCapabilities] : []
  return { text, attachments, contextReferences, selectedCapabilities }
}

export function captureComposerDraft(panel: HTMLElement, drafts: Map<string, ComposerDraft>, sessionId: string) {
  const draft = readComposerDraft(panel)
  if (hasDraft(draft)) {
    drafts.set(sessionId, draft)
  } else {
    drafts.delete(sessionId)
  }
}

export function restoreComposerDraft(
  panel: HTMLElement,
  draft: ComposerDraft,
  drafts: Map<string, ComposerDraft>,
  sessionId: string,
): boolean {
  if (!hasDraft(draft)) return false
  const normalizedDraft = {
    text: draft.text,
    attachments: draft.attachments ? [...draft.attachments] : [],
    contextReferences: draft.contextReferences ? [...draft.contextReferences] : [],
    selectedCapabilities: draft.selectedCapabilities ? [...draft.selectedCapabilities] : [],
  }
  const editor = panel.querySelector<MessageEditorElement>('message-editor')
  const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
  if (!editor && !textarea) return false

  if (editor) {
    editor.value = normalizedDraft.text
    editor.attachments = normalizedDraft.attachments
    editor.contextReferences = normalizedDraft.contextReferences
    editor.selectedCapabilities = normalizedDraft.selectedCapabilities
    ;(editor as MessageEditorElement & { requestUpdate?: () => void }).requestUpdate?.()
    editor.onInput?.(normalizedDraft.text)
    editor.onFilesChange?.(normalizedDraft.attachments)
  }
  if (textarea) {
    textarea.value = normalizedDraft.text
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.focus()
  }
  drafts.set(sessionId, normalizedDraft)
  return true
}

type ComposerDraftRestoreOptions = {
  shouldApply?: () => boolean
  onApplyStart?: () => void
  onApplyEnd?: () => void
  onApplied?: () => void
  updateComplete?: Promise<unknown>
}

export type ComposerDraftRestoreHandle = {
  cancel: () => void
}

export function scheduleComposerDraftRestore(
  panel: HTMLElement,
  draft: ComposerDraft,
  drafts: Map<string, ComposerDraft>,
  sessionId: string,
  options: ComposerDraftRestoreOptions = {},
): ComposerDraftRestoreHandle {
  let active = true
  let animationFrame: number | undefined
  const timers = new Set<number>()

  const clearScheduled = () => {
    if (animationFrame !== undefined) {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = undefined
    }
    for (const timer of timers) window.clearTimeout(timer)
    timers.clear()
  }
  const cancel = () => {
    if (!active) return
    active = false
    clearScheduled()
  }
  const apply = () => {
    if (!active) return
    if (options.shouldApply && !options.shouldApply()) {
      cancel()
      return
    }

    options.onApplyStart?.()
    try {
      if (!restoreComposerDraft(panel, draft, drafts, sessionId)) return
      options.onApplied?.()
      cancel()
    } finally {
      options.onApplyEnd?.()
    }
  }

  apply()
  if (active) {
    animationFrame = window.requestAnimationFrame(apply)
    for (const delay of [0, 50, 150, 300, 600]) {
      const timer = window.setTimeout(() => {
        timers.delete(timer)
        apply()
      }, delay)
      timers.add(timer)
    }
    void options.updateComplete?.then(apply)
  }

  return { cancel }
}
