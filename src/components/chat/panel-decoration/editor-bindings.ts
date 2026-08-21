import type { MessageEditorElement } from '../chat-utils'
import { shouldSendComposerInput } from '@/lib/chat-harness-capabilities'

export function bindEditorCallbacks(options: {
  editor: MessageEditorElement | null
  onInput: (value: string) => void
  onFilesChange: (files: unknown[]) => void
  removeCommandSuggestions: () => void
  updateCommandSuggestions: (value?: string) => void
  removeCapabilitySuggestions: () => void
  updateCapabilitySuggestions: (value?: string) => void
  removeFileReferenceSuggestions?: () => void
  updateFileReferenceSuggestions?: (value?: string) => void
  attachmentsEnabled?: boolean
  onBeforeSend?: (input: string) => void
}) {
  const {
    editor,
    onInput,
    onFilesChange,
    removeCommandSuggestions,
    updateCommandSuggestions,
    removeCapabilitySuggestions,
    updateCapabilitySuggestions,
    removeFileReferenceSuggestions = () => {},
    updateFileReferenceSuggestions = () => {},
    attachmentsEnabled = true,
    onBeforeSend,
  } = options
  if (!editor) return

  if (editor.__quickforgeAttachmentPasteGuard) editor.removeEventListener('paste', editor.__quickforgeAttachmentPasteGuard, true)
  if (editor.__quickforgeAttachmentDropGuard) editor.removeEventListener('drop', editor.__quickforgeAttachmentDropGuard, true)
  if (!attachmentsEnabled) {
    editor.attachments = []
    editor.onFilesChange = () => onFilesChange([])
    editor.__quickforgeAttachmentPasteGuard = (event: ClipboardEvent) => {
      const hasFiles = [...(event.clipboardData?.items ?? [])].some((item) => item.kind === 'file')
      if (!hasFiles) return
      event.preventDefault()
      event.stopPropagation()
    }
    editor.__quickforgeAttachmentDropGuard = (event: DragEvent) => {
      if ((event.dataTransfer?.files.length ?? 0) === 0) return
      event.preventDefault()
      event.stopPropagation()
    }
    editor.addEventListener('paste', editor.__quickforgeAttachmentPasteGuard, true)
    editor.addEventListener('drop', editor.__quickforgeAttachmentDropGuard, true)
  } else {
    editor.__quickforgeAttachmentPasteGuard = undefined
    editor.__quickforgeAttachmentDropGuard = undefined
    editor.onFilesChange = (attachments) => {
      onFilesChange(attachments ? [...attachments] : [])
    }
  }

  editor.onInput = (value) => {
    onInput(value)
    updateCommandSuggestions(value)
    updateCapabilitySuggestions(value)
    updateFileReferenceSuggestions(value)
  }
  const currentOnSend = editor.onSend
  if (currentOnSend && currentOnSend !== editor.__quickforgePlanWrappedOnSend) {
    editor.__quickforgePlanBaseOnSend = currentOnSend
  }
  const baseOnSend = editor.__quickforgePlanBaseOnSend
  if (baseOnSend) {
    const wrappedOnSend = (input: string, attachments: unknown[]) => {
      const rawText = String(input ?? '')
      if (!shouldSendComposerInput({ attachments: attachmentsEnabled }, rawText, attachments)) return
      onBeforeSend?.(rawText)
      removeCommandSuggestions()
      removeCapabilitySuggestions()
      removeFileReferenceSuggestions()
      baseOnSend(rawText, attachmentsEnabled ? attachments : [])
    }
    editor.__quickforgePlanWrappedOnSend = wrappedOnSend
    editor.onSend = wrappedOnSend
  }
  updateCommandSuggestions()
  updateCapabilitySuggestions()
  updateFileReferenceSuggestions()
}
