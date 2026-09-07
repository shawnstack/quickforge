import type { MessageEditorElement } from '../chat-utils'
import { shouldSendComposerInput } from '@/lib/chat-harness-capabilities'

const LARGE_PASTE_ATTACHMENT_THRESHOLD = 3000

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
  sessionId?: string
  onOpenLocalFilePath?: (path: string) => void
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
    sessionId,
    onOpenLocalFilePath,
  } = options
  if (!editor) return

  if (editor.__quickforgeAttachmentPasteGuard) editor.removeEventListener('paste', editor.__quickforgeAttachmentPasteGuard, true)
  if (editor.__quickforgeAttachmentDropGuard) editor.removeEventListener('drop', editor.__quickforgeAttachmentDropGuard, true)
  if (editor.__quickforgeLargePasteHandler) editor.removeEventListener('paste', editor.__quickforgeLargePasteHandler, true)
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
    if (sessionId) {
      editor.__quickforgeLargePasteHandler = (event: ClipboardEvent) => {
        const text = event.clipboardData?.getData('text/plain') ?? ''
        if (text.length < LARGE_PASTE_ATTACHMENT_THRESHOLD || text.length > 2_000_000) return
        event.preventDefault()
        event.stopPropagation()
        const target = event.target as HTMLTextAreaElement | null
        const currentText = target?.value ?? editor.value ?? ''
        void fetch(`/api/agents/${encodeURIComponent(sessionId)}/text-attachment`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, fileName: `pasted-content-${new Date().toISOString().slice(0, 10)}.txt` }),
        }).then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = await response.json() as { attachment?: unknown }
          if (!payload.attachment) throw new Error('Missing attachment')
          const attachment = payload.attachment as { path?: string }
          editor.attachments = [...(editor.attachments ?? []), payload.attachment]
          if (attachment.path) {
            window.setTimeout(() => {
              const tile = editor.querySelector<HTMLElement>('attachment-tile:last-of-type')
              if (!tile) return
              tile.setAttribute('title', `在系统文件管理器中打开：${attachment.path}`)
              tile.dataset.quickforgeTextAttachmentPath = attachment.path
              // 持久劫持点击（不能 once：第二次点击会落回 pi 自带的附件预览），
              // 每 tile 只安装一个读取当前路径的监听。
              if (tile.dataset.quickforgeTextAttachmentBound === '1') return
              tile.dataset.quickforgeTextAttachmentBound = '1'
              tile.addEventListener('click', (clickEvent) => {
                clickEvent.stopPropagation()
                const currentPath = tile.dataset.quickforgeTextAttachmentPath
                if (currentPath) onOpenLocalFilePath?.(currentPath)
              }, true)
            }, 0)
          }
          onFilesChange(editor.attachments)
          editor.requestUpdate?.()
        }).catch(() => {
          editor.value = `${currentText}${currentText ? '\\n\\n' : ''}${text}`
          editor.requestUpdate?.()
        })
      }
      editor.addEventListener('paste', editor.__quickforgeLargePasteHandler, true)
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
