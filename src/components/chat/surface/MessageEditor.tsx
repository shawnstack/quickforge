/* eslint-disable react-refresh/only-export-components -- exports the MessageEditor component plus pure keyboard/limit helpers; the re-exported attachment loader is covered by tests. */
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type ClipboardEvent, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Brain, Loader2, Paperclip, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t, type AppTextKey } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import type { Api, Attachment, Model, ThinkingLevel } from './ChatTypes'
import { AttachmentTile } from './AttachmentTile'
import { loadSurfaceAttachment } from './attachment-loader'

// Re-exported so the surface barrel keeps `loadSurfaceAttachment` on MessageEditor.
export { loadSurfaceAttachment }

/**
 * React replacement for the legacy `<message-editor>` custom element.
 *
 * Composer contract (aligned with the package component):
 * - `value` / `attachments` are controlled by the parent (the chat surface
 *   clears them after a successful send).
 * - Enter sends, Shift+Enter inserts a newline, IME composition never
 *   triggers send, Escape aborts while streaming.
 * - Paste/drop/file-picker accept attachments; `maxFiles` / `maxFileSize`
 *   are enforced (defaults 10 files / 20MB).
 */

export const DEFAULT_MAX_FILES = 10
export const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB
export const DEFAULT_ACCEPTED_TYPES =
  'image/*,application/pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.json,.xml,.html,.css,.js,.ts,.jsx,.tsx,.yml,.yaml'

/**
 * Composer thinking levels. Mirrors the application-wide vocabulary
 * (`QuickForgeThinkingLevel` in panel-decoration/thinking-level-controls.ts and
 * `isThinkingLevel` in lib/pi-chat.ts): off / low / medium / high / xhigh.
 * Labels are resolved through `t()` at render time so a language switch is
 * picked up (the i18n module reads the active language per call).
 */
const THINKING_LEVELS: Array<{ value: ThinkingLevel; labelKey: AppTextKey }> = [
  { value: 'off', labelKey: 'thinkingOff' },
  { value: 'low', labelKey: 'thinkingLow' },
  { value: 'medium', labelKey: 'thinkingMedium' },
  { value: 'high', labelKey: 'thinkingHigh' },
  { value: 'xhigh', labelKey: 'thinkingXHigh' },
]

/** Minimal keyboard-event shape so the decision logic is unit-testable. */
export interface EditorKeyEventLike {
  key: string
  shiftKey?: boolean
  /** IME composition flag (KeyboardEvent.isComposing); "Process" keys are Safari's variant. */
  isComposing?: boolean
}

export interface EditorKeyDownContext {
  isStreaming: boolean
  processingFiles: boolean
  /** Parent-computed sendability: non-empty text or at least one attachment. */
  canSend: boolean
}

export interface EditorKeyDownDecision {
  action: 'none' | 'send' | 'abort'
  preventDefault: boolean
}

/**
 * Pure keyboard decision for the composer textarea:
 * - IME composition (`isComposing` or the `Process` key) never acts.
 * - Enter without Shift always prevents default; sends only when the editor
 *   can send and no files are being processed.
 * - Escape aborts (and prevents default) while streaming.
 */
export function resolveEditorKeyDown(event: EditorKeyEventLike, context: EditorKeyDownContext): EditorKeyDownDecision {
  // Ignore key events during IME composition (e.g. CJK input).
  if (event.isComposing || event.key === 'Process') {
    return { action: 'none', preventDefault: false }
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    const canSendNow = !context.isStreaming && !context.processingFiles && context.canSend
    return { action: canSendNow ? 'send' : 'none', preventDefault: true }
  }

  if (event.key === 'Escape' && context.isStreaming) {
    return { action: 'abort', preventDefault: true }
  }

  return { action: 'none', preventDefault: false }
}

/**
 * Minimal file shape so limit checks are unit-testable without real Files and
 * work for both `File` and persisted `Attachment` values (which expose
 * `fileName` instead of `name`).
 */
export interface EditorFileLike {
  size: number
}

export interface FileLimitDecision<TFile extends EditorFileLike> {
  /** Files that pass both the count and size limits. */
  accepted: TFile[]
  /** True when the whole batch was rejected because of the max-file limit. */
  countExceeded: boolean
  /** Files within the count limit but larger than maxFileSize. */
  oversized: TFile[]
}

/**
 * Enforce attachment limits. Mirrors the package behavior: exceeding
 * maxFiles rejects the whole batch; oversized files are dropped individually.
 */
export function filterFilesByLimits<TFile extends EditorFileLike>(
  files: TFile[],
  currentCount: number,
  maxFiles: number,
  maxFileSize: number,
): FileLimitDecision<TFile> {
  if (files.length === 0) {
    return { accepted: [], countExceeded: false, oversized: [] }
  }
  if (files.length + currentCount > maxFiles) {
    return { accepted: [], countExceeded: true, oversized: [] }
  }
  const accepted: TFile[] = []
  const oversized: TFile[] = []
  for (const file of files) {
    if (file.size > maxFileSize) oversized.push(file)
    else accepted.push(file)
  }
  return { accepted, countExceeded: false, oversized }
}

const textareaStyle = {
  maxHeight: '200px',
  minHeight: '1lh',
  height: 'auto',
  fieldSizing: 'content',
} as CSSProperties

export interface MessageEditorProps {
  value: string
  attachments?: Attachment[]
  isStreaming?: boolean
  currentModel?: Model<Api>
  thinkingLevel?: ThinkingLevel
  showAttachmentButton?: boolean
  showModelSelector?: boolean
  showThinkingSelector?: boolean
  maxFiles?: number
  maxFileSize?: number
  acceptedTypes?: string
  onInput?: (value: string) => void
  onSend?: (input: string, attachments: Attachment[]) => void
  onAbort?: () => void
  onModelSelect?: () => void
  onThinkingChange?: (level: ThinkingLevel) => void
  onFilesChange?: (files: Attachment[]) => void
  /** Injectable loader (tests pass a fake; defaults to the local loader). */
  loadAttachmentFile?: (file: File) => Promise<Attachment>
}

export function MessageEditor({
  value,
  attachments = [],
  isStreaming = false,
  currentModel,
  thinkingLevel = 'off',
  showAttachmentButton = true,
  showModelSelector = true,
  showThinkingSelector = true,
  maxFiles = DEFAULT_MAX_FILES,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  acceptedTypes = DEFAULT_ACCEPTED_TYPES,
  onInput,
  onSend,
  onAbort,
  onModelSelect,
  onThinkingChange,
  onFilesChange,
  loadAttachmentFile = loadSurfaceAttachment,
}: MessageEditorProps) {
  const [processingFiles, setProcessingFiles] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // `addFiles` awaits document parses that can run for seconds (PDF/DOCX up to
  // 30s), so it must not merge into the `attachments` captured when the batch
  // started — that would resurrect deleted files and drop concurrent batches.
  // The ref mirrors the latest `attachments` prop for those async reads.
  const attachmentsRef = useRef(attachments)
  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  // Mount-time focus, mirroring the legacy `<message-editor>`'s
  // `firstUpdated()` → `textarea.focus()`. The surface is keyed per session,
  // so this also re-focuses on session switches. Mount-only (`[]` deps): a
  // per-render focus would steal focus from dialogs and menus opened later.
  // Focus is not motion, so reduced-motion users are unaffected; the textarea
  // is the panel's primary input, so taking focus on mount matches the
  // package behavior (read-only surfaces never mount this composer at all).
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const supportsThinking = currentModel?.reasoning === true
  const canSend = !!value.trim() || attachments.length > 0

  const handleSend = useCallback(() => {
    onSend?.(value, attachments)
  }, [onSend, value, attachments])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const decision = resolveEditorKeyDown(
      { key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing },
      { isStreaming, processingFiles, canSend },
    )
    if (decision.preventDefault) event.preventDefault()
    if (decision.action === 'send') handleSend()
    else if (decision.action === 'abort') onAbort?.()
  }

  const addFiles = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) return

      const decision = filterFilesByLimits(files, attachmentsRef.current.length, maxFiles, maxFileSize)
      if (decision.countExceeded) {
        window.alert(t('composerMaxFiles', { count: maxFiles }))
        return
      }
      for (const file of decision.oversized) {
        window.alert(t('composerFileTooLarge', { name: file.name, size: Math.round(maxFileSize / 1024 / 1024) }))
      }
      if (decision.accepted.length === 0) return

      setProcessingFiles(true)
      const newAttachments: Attachment[] = []
      for (const file of decision.accepted) {
        try {
          newAttachments.push(await loadAttachmentFile(file))
        } catch (error) {
          window.alert(t('composerFileFailed', { name: file.name, error: String(error) }))
        }
      }
      // The parses above may have outlived composer changes (deleted files,
      // other completed batches): re-check the limits and merge against the
      // freshest attachment list instead of the batch-start snapshot.
      const settled = filterFilesByLimits(newAttachments, attachmentsRef.current.length, maxFiles, maxFileSize)
      if (settled.countExceeded) {
        window.alert(t('composerMaxFiles', { count: maxFiles }))
      } else {
        onFilesChange?.([...attachmentsRef.current, ...settled.accepted])
      }
      setProcessingFiles(false)
    },
    [loadAttachmentFile, maxFiles, maxFileSize, onFilesChange],
  )

  const handlePaste = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items
    if (!items) return

    const imageFiles: File[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }

    if (imageFiles.length > 0) {
      event.preventDefault()
      await addFiles(imageFiles)
    }
  }

  const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const files = Array.from(input.files ?? [])
    if (files.length > 0) await addFiles(files)
    input.value = ''
  }

  const removeFile = (fileId: string) => {
    onFilesChange?.(attachments.filter((file) => file.id !== fileId))
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!isDragging) setIsDragging(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    // Only clear the highlight when leaving the component bounds entirely.
    const rect = event.currentTarget.getBoundingClientRect()
    const { clientX: x, clientY: y } = event
    if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
      setIsDragging(false)
    }
  }

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
    await addFiles(Array.from(event.dataTransfer?.files ?? []))
  }

  return (
    // DOM contract with src/index.css: the panel decoration adds
    // `quickforge-composer` to this `.qf-message-editor` node, and the composer
    // card styles are anchored on `.quickforge-composer > div:first-child`
    // (the card) plus `.quickforge-composer > div:first-child > .px-2.pb-2`
    // (the control row). The card therefore has to be the first child div of
    // this wrapper — never a sibling (drag/attachment rows live inside the
    // card). Drag handlers stay on the wrapper so the whole composer reacts.
    <div
      className="qf-message-editor"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className={cn(
          'relative rounded-xl border bg-card shadow-sm',
          isDragging ? 'border-2 border-primary bg-primary/5' : 'border-border',
        )}
      >
        {isDragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-primary/10">
            <div className="font-medium text-primary">{t('composerDropFiles')}</div>
          </div>
        ) : null}

        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-4 pb-2 pt-3">
            {attachments.map((attachment) => (
              <AttachmentTile
                key={attachment.id}
                attachment={attachment}
                showDelete
                onDelete={() => removeFile(attachment.id)}
              />
            ))}
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          className="w-full resize-none overflow-y-auto bg-transparent p-4 text-foreground placeholder-muted-foreground outline-none"
          placeholder={t('composerPlaceholder')}
          rows={1}
          style={textareaStyle}
          value={value}
          onChange={(event) => onInput?.(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          accept={acceptedTypes}
          aria-label={t('composerAttachFiles')}
          onChange={handleFilesSelected}
        />

        <div className="flex items-center justify-between px-2 pb-2">
          <div className="flex items-center gap-2">
            {showAttachmentButton ? (
              processingFiles ? (
                <div className="flex h-8 w-8 items-center justify-center">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Button
                  variant="ghost"
                  className="h-8 w-8"
                  size="icon"
                  title={t('composerAttachFiles')}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="size-4" />
                </Button>
              )
            ) : null}
            {supportsThinking && showThinkingSelector ? (
              <label className="flex h-8 cursor-pointer select-none items-center gap-1 rounded-md px-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <Brain className="size-4" />
                <select
                  className="cursor-pointer bg-transparent text-xs outline-none"
                  aria-label={t('thinkingLevel')}
                  value={thinkingLevel}
                  onChange={(event) => onThinkingChange?.(event.currentTarget.value as ThinkingLevel)}
                >
                  {THINKING_LEVELS.map((level) => (
                    <option key={level.value} value={level.value}>
                      {t(level.labelKey)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {showModelSelector && currentModel ? (
              <Button
                variant="ghost"
                className="h-8 truncate text-xs"
                size="sm"
                onClick={() => {
                  // Focus the textarea first so focus returns after the dialog closes.
                  textareaRef.current?.focus()
                  requestAnimationFrame(() => onModelSelect?.())
                }}
              >
                <Sparkles className="size-4" />
                <span className="ml-1">{currentModel.id}</span>
              </Button>
            ) : null}
            {isStreaming ? (
              <Button
                variant="ghost"
                className="quickforge-stop-button h-8 w-8"
                size="icon"
                title={t('stop')}
                onClick={onAbort}
              >
                {/* Same solid square the panel decoration used to graft in.
                    Rendering it here keeps the icon React-owned so the
                    isStreaming flip never swaps foreign DOM under React. */}
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-4">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="quickforge-send-button h-8 w-8"
                size="icon"
                title={t('composerSend')}
                disabled={!canSend || processingFiles}
                onClick={handleSend}
              >
                {/* Upward arrow (was lucide Send rotated -45deg + a decorator
                    graft). React-owned so the streaming flip stays safe; the
                    panel decoration only toggles state classes on the button. */}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="size-4"
                >
                  <path d="M12 19V5" />
                  <path d="m5 12 7-7 7 7" />
                </svg>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
