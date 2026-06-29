import type {
  AgentInterfaceElement,
  MessageEditorElement,
  ComposerDraft,
} from '../chat-utils'
import { hasDraft } from '../chat-utils'

export function readComposerDraft(panel: HTMLElement): ComposerDraft {
  const editor = panel.querySelector<MessageEditorElement>('message-editor')
  const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
  const text = editor?.value ?? textarea?.value ?? ''
  const attachments = editor?.attachments ? [...editor.attachments] : []
  return { text, attachments }
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
) {
  if (!hasDraft(draft)) return
  const normalizedDraft = {
    text: draft.text,
    attachments: draft.attachments ? [...draft.attachments] : [],
  }

  const applyToEditor = () => {
    const editor = panel.querySelector<MessageEditorElement>('message-editor')
    const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
    if (editor) {
      editor.value = normalizedDraft.text
      editor.attachments = normalizedDraft.attachments
      ;(editor as MessageEditorElement & { requestUpdate?: () => void }).requestUpdate?.()
      editor.onInput?.(normalizedDraft.text)
      editor.onFilesChange?.(normalizedDraft.attachments)
    }
    if (textarea) {
      textarea.value = normalizedDraft.text
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.focus()
    }
  }

  const agentInterface = panel.querySelector<AgentInterfaceElement>('agent-interface')
  agentInterface?.setInput?.(normalizedDraft.text, normalizedDraft.attachments)
  applyToEditor()
  requestAnimationFrame(applyToEditor)
  window.setTimeout(applyToEditor, 0)
  drafts.set(sessionId, normalizedDraft)
}
