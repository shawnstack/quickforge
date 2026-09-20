import type { MessageEditorElement } from '../chat-utils'
import { shouldSendComposerInput } from '@/lib/chat-capabilities'
import { t } from '@/lib/i18n'

const LARGE_PASTE_ATTACHMENT_THRESHOLD = 3000

/** 命中次数不足时重试的节奏（首个 rAF 之外的兜底），全部命中即取消。 */
const TEXT_ATTACHMENT_DECORATION_RETRY_DELAYS = [0, 50, 150, 300, 600]

/**
 * Composer 大段粘贴文本附件 tile 装饰：给最后一块 `.qf-attachment-tile`
 * 挂上「系统文件管理器中打开」提示与点击劫持（path 存在 dataset，点击时读取，
 * 路径变化无需重绑；bound 保证每 tile 只安装一个监听，重复装饰幂等）。
 *
 * React 提交附件列表是异步的（onFilesChange → setState → 渲染），一次性
 * `setTimeout(0)` 可能在 DOM 提交前跑空，因此沿用草稿恢复的「先执行 + rAF/定时
 * 重试」策略：命中即取消，未命中按固定节奏重试有限次后放弃。
 *
 * 导出仅供测试（tests/frontend/editor-bindings.test.ts 驱动重试与幂等）。
 */
export function decorateComposerTextAttachmentTile(
  editor: MessageEditorElement,
  path: string,
  onOpenLocalFilePath?: (path: string) => void,
): () => void {
  let cancelled = false
  let animationFrame: number | undefined
  const timers = new Set<number>()

  const cancel = () => {
    cancelled = true
    if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame)
    animationFrame = undefined
    timers.forEach((timer) => window.clearTimeout(timer))
    timers.clear()
  }

  const apply = () => {
    if (cancelled) return
    const tile = editor.querySelector<HTMLElement>('.qf-attachment-tile:last-of-type')
    if (!tile) return
    tile.setAttribute('title', `${t('openAttachmentInFileManager')}：${path}`)
    tile.dataset.quickforgeTextAttachmentPath = path
    if (tile.dataset.quickforgeTextAttachmentBound !== '1') {
      tile.dataset.quickforgeTextAttachmentBound = '1'
      // 持久劫持点击（不能 once：第二次点击会落回自带的附件预览），
      // 每 tile 只安装一个读取当前路径的监听。
      tile.addEventListener('click', (clickEvent) => {
        clickEvent.stopPropagation()
        const currentPath = tile.dataset.quickforgeTextAttachmentPath
        if (currentPath) onOpenLocalFilePath?.(currentPath)
      }, true)
    }
    cancel()
  }

  apply()
  if (!cancelled) {
    animationFrame = window.requestAnimationFrame(apply)
    for (const delay of TEXT_ATTACHMENT_DECORATION_RETRY_DELAYS) {
      const timer = window.setTimeout(() => {
        timers.delete(timer)
        apply()
      }, delay)
      timers.add(timer)
    }
  }
  return cancel
}

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
          onFilesChange(editor.attachments)
          editor.requestUpdate?.()
          // 附件列表由 React 异步提交（见函数注释）；装饰在提交后自行收敛。
          if (attachment.path) {
            decorateComposerTextAttachmentTile(editor, attachment.path, onOpenLocalFilePath)
          }
        }).catch(() => {
          editor.value = `${currentText}${currentText ? '\n\n' : ''}${text}`
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
