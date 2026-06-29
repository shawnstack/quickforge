import type { MessageEditorElement } from '../chat-utils'

export function bindEditorCallbacks(options: {
  editor: MessageEditorElement | null
  onInput: (value: string) => void
  onFilesChange: (files: unknown[]) => void
  removeCommandSuggestions: () => void
  updateCommandSuggestions: (value?: string) => void
  removeCapabilitySuggestions: () => void
  updateCapabilitySuggestions: (value?: string) => void
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
    onBeforeSend,
  } = options
  if (!editor) return

  editor.onInput = (value) => {
    onInput(value)
    updateCommandSuggestions(value)
    updateCapabilitySuggestions(value)
  }
  editor.onFilesChange = (attachments) => {
    onFilesChange(attachments ? [...attachments] : [])
  }
  const currentOnSend = editor.onSend
  if (currentOnSend && currentOnSend !== editor.__quickforgePlanWrappedOnSend) {
    editor.__quickforgePlanBaseOnSend = currentOnSend
  }
  const baseOnSend = editor.__quickforgePlanBaseOnSend
  if (baseOnSend) {
    const wrappedOnSend = (input: string, attachments: unknown[]) => {
      const rawText = String(input ?? '')
      const text = rawText.trim()
      if (text.length > 0) onBeforeSend?.(rawText)
      removeCommandSuggestions()
      removeCapabilitySuggestions()
      baseOnSend(rawText, attachments)
    }
    editor.__quickforgePlanWrappedOnSend = wrappedOnSend
    editor.onSend = wrappedOnSend
  }
  updateCommandSuggestions()
  updateCapabilitySuggestions()
}
