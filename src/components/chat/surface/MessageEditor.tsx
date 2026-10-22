/* eslint-disable react-refresh/only-export-components -- exports the MessageEditor component plus pure keyboard/limit helpers; the re-exported attachment loader is covered by tests. */
import { memo, useCallback, useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type ClipboardEvent, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Brain, Loader2, Paperclip, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t, type AppTextKey } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import type { Api, Attachment, Model, ThinkingLevel } from './ChatTypes'
import { AttachmentTile } from './AttachmentTile'
import { loadSurfaceAttachment } from './attachment-loader'
import { useComposerAttachments, useComposerText, type ComposerStore } from './composer-store'

// Re-exported so the surface barrel keeps `loadSurfaceAttachment` on MessageEditor.
export { loadSurfaceAttachment }

/**
 * React replacement for the legacy `<message-editor>` custom element.
 *
 * Composer contract (aligned with the package component):
 * - the text and attachment list live in a `ComposerStore` (see
 *   `composer-store.ts`), NOT in a parent component's state. The parent
 *   (`ChatSurface`) therefore does not re-render per keystroke; only the three
 *   leaf components below subscribe to the slice they actually read.
 * - Enter sends, Shift+Enter inserts a newline, IME composition never
 *   triggers send, Escape aborts while streaming.
 * - Paste/drop/file-picker accept attachments; `maxFiles` / `maxFileSize`
 *   are enforced (defaults 10 files / 20MB).
 *
 * `onInput` / `onFilesChange` are **notifications**, not value sources: they
 * tell the host (draft persistence + the suggestion controllers) what the user
 * just did. The store is already updated by the time they fire.
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
  /**
   * Composer hot-path state. Created once by the parent (`ChatSurface`) and
   * stable for the surface's lifetime, so this component and its leaves never
   * re-render because of a prop identity change.
   */
  store: ComposerStore
  isStreaming?: boolean
  /**
   * Streaming but no assistant output yet. Drives the waiting ring on the stop
   * button. React owns this class so the decoration layer no longer has to
   * toggle it (which used to write a class onto React-owned DOM every pass).
   */
  isWaiting?: boolean
  currentModel?: Model<Api>
  thinkingLevel?: ThinkingLevel
  showAttachmentButton?: boolean
  showModelSelector?: boolean
  showThinkingSelector?: boolean
  /**
   * Left-hand control row prefix. The QuickForge "+" menu is rendered here by
   * React; the decoration layer used to prepend it into this row on every pass.
   */
  leadingControls?: ReactNode
  /** Right-hand control row suffix (the QuickForge thinking selector). */
  trailingControls?: ReactNode
  /** Exposes the hidden file input so a sibling control can open the picker. */
  pickAttachment?: (open: () => void) => void
  /**
   * Render the QuickForge composer controls disabled (Side Chat keeps them
   * visible but inert). The model trigger uses this; the "+" and thinking
   * controls receive it as their own `disabled` prop.
   */
  composerControlsDisabled?: boolean
  /**
   * 会话写入租约：本页不是持有者时作曲区只读。
   *
   * 与 `composerControlsDisabled` 的区别是语义：后者让控件「可见但 inert」
   * （Side Chat），这里连输入与发送都必须失效 —— 服务端会以 409
   * `SESSION_LEASE_HELD` 拒绝任何写请求，所以本页不能让人以为能发。
   */
  composerReadOnly?: boolean
  maxFiles?: number
  maxFileSize?: number
  acceptedTypes?: string
  /**
   * Notification only — the store is already updated. The host uses it for the
   * draft map and the three suggestion controllers, exactly like the legacy
   * `onInput` bridge property.
   */
  onInput?: (value: string) => void
  onSend?: (input: string, attachments: Attachment[]) => void
  onAbort?: () => void
  /**
   * Clear any open command/mention suggestion popover before aborting.
   *
   * The decoration layer used to call this from its capture-phase stop handler:
   * aborting while a `@`/`/` popover is open used to leave the popover floating
   * over the stopped conversation.
   */
  onBeforeAbort?: () => void
  onModelSelect?: () => void
  onThinkingChange?: (level: ThinkingLevel) => void
  /** Notification only — the store is already updated. */
  onFilesChange?: (files: Attachment[]) => void
  /** Injectable loader (tests pass a fake; defaults to the local loader). */
  loadAttachmentFile?: (file: File) => Promise<Attachment>
}

/**
 * Textarea leaf. The ONLY component that subscribes to the text slice besides
 * the action button, so a keystroke re-renders one `<textarea>` and nothing
 * else — not the message list, not even the composer card.
 */
const ComposerTextarea = memo(function ComposerTextarea({
  store,
  textareaRef,
  isStreaming,
  processingFiles,
  readOnly = false,
  onInput,
  onSend,
  onAbort,
  onPaste,
}: {
  store: ComposerStore
  textareaRef: RefObject<HTMLTextAreaElement | null>
  isStreaming: boolean
  processingFiles: boolean
  readOnly?: boolean
  onInput?: (value: string) => void
  onSend?: (input: string, attachments: Attachment[]) => void
  onAbort?: () => void
  /** Paste belongs to the attachment pipeline, which the parent owns. */
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void
}) {
  const value = useComposerText(store)
  const hasAttachments = useComposerAttachments(store).length > 0
  const canSend = !!value.trim() || hasAttachments

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly) {
      // 只读：回车不能发送，但也不拦截默认行为以外的东西（Escape 等无效）。
      if (event.key === 'Enter' && !event.shiftKey) event.preventDefault()
      return
    }
    const decision = resolveEditorKeyDown(
      { key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing },
      { isStreaming, processingFiles, canSend },
    )
    if (decision.preventDefault) event.preventDefault()
    if (decision.action === 'send') onSend?.(store.getText(), store.getAttachments())
    else if (decision.action === 'abort') onAbort?.()
  }

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    // Single write: the store is the source of truth and the DOM already holds
    // the typed value, so no state->DOM write-back is needed (the old path wrote
    // textarea.value here and React wrote it again on commit).
    const next = event.currentTarget.value
    store.setText(next)
    onInput?.(next)
  }

  return (
    <textarea
      ref={textareaRef}
      className="w-full resize-none overflow-y-auto bg-transparent p-4 text-foreground placeholder-muted-foreground outline-none"
      placeholder={readOnly ? t('sessionLeaseComposerPlaceholder') : t('composerPlaceholder')}
      rows={1}
      style={textareaStyle}
      value={value}
      readOnly={readOnly}
      aria-readonly={readOnly || undefined}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onPaste={onPaste}
    />
  )
})

/**
 * Attachment tile row leaf. Subscribes to the attachment slice only, so
 * adding/removing a file never re-renders the textarea and vice versa.
 */
const ComposerAttachmentRow = memo(function ComposerAttachmentRow({
  store,
  onRemove,
}: {
  store: ComposerStore
  onRemove: (id: string) => void
}) {
  const attachments = useComposerAttachments(store)
  if (attachments.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2 px-4 pb-2 pt-3">
      {attachments.map((attachment) => (
        <AttachmentTile
          key={attachment.id}
          attachment={attachment}
          showDelete
          onDelete={() => onRemove(attachment.id)}
        />
      ))}
    </div>
  )
})

/**
 * Send/stop leaf. Subscribes to the text slice for `canSend` only, so the send
 * button's disabled state stays live while the rest of the composer does not
 * re-render on every keystroke.
 */
const ComposerActionButton = memo(function ComposerActionButton({
  store,
  isStreaming,
  isWaiting,
  processingFiles,
  readOnly = false,
  onSend,
  onAbort,
  onBeforeAbort,
}: {
  store: ComposerStore
  isStreaming: boolean
  isWaiting: boolean
  processingFiles: boolean
  readOnly?: boolean
  onSend?: (input: string, attachments: Attachment[]) => void
  onAbort?: () => void
  onBeforeAbort?: () => void
}) {
  const value = useComposerText(store)
  const hasAttachments = useComposerAttachments(store).length > 0
  const canSend = !!value.trim() || hasAttachments

  const handleSend = useCallback(() => {
    onSend?.(store.getText(), store.getAttachments())
  }, [onSend, store])

  if (isStreaming && !readOnly) {
    return (
      <Button
        variant="ghost"
        className={cn(
          'quickforge-stop-button h-8 w-8',
          // The waiting ring used to be toggled by the panel decoration on
          // every pass; React owns it now so the decoration only reads state.
          isWaiting && 'quickforge-stop-button--waiting',
        )}
        size="icon"
        // Literal "Stop" (not `t('stop')`) because that is what the
        // decoration layer has always written into `title`/`aria-label`
        // while streaming. Rendering the translated string instead would
        // change the visible tooltip in non-English locales.
        title="Stop"
        aria-label="Stop"
        // Abort on pointerdown in the capture phase: the decoration used
        // to install a capture listener so the abort fired before any
        // bubble-phase handler could run. `stopImmediatePropagation` then
        // guarantees no other pointerdown handler reacts to this press.
        onPointerDownCapture={(event) => {
          event.preventDefault()
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
          onBeforeAbort?.()
          onAbort?.()
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          event.stopPropagation()
          onBeforeAbort?.()
          onAbort?.()
        }}
      >
        {/* Same solid square the panel decoration used to graft in.
            Rendering it here keeps the icon React-owned so the
            isStreaming flip never swaps foreign DOM under React. */}
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-4">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      className="quickforge-send-button h-8 w-8"
      size="icon"
      title={t('composerSend')}
      disabled={readOnly || !canSend || processingFiles}
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
  )
})

export function MessageEditor({
  store,
  isStreaming = false,
  isWaiting = false,
  currentModel,
  thinkingLevel = 'off',
  showAttachmentButton = true,
  showModelSelector = true,
  showThinkingSelector = true,
  leadingControls,
  trailingControls,
  pickAttachment,
  composerControlsDisabled = false,
  composerReadOnly = false,
  maxFiles = DEFAULT_MAX_FILES,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  acceptedTypes = DEFAULT_ACCEPTED_TYPES,
  onInput,
  onSend,
  onAbort,
  onBeforeAbort,
  onModelSelect,
  onThinkingChange,
  onFilesChange,
  loadAttachmentFile = loadSurfaceAttachment,
}: MessageEditorProps) {
  const [processingFiles, setProcessingFiles] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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

  // Let a sibling control (the QuickForge "+" menu) open the file picker. The
  // input element stays owned by this component, so no DOM lookup is needed —
  // the decoration used to click `input[type=file]` found by querySelector.
  useEffect(() => {
    pickAttachment?.(() => fileInputRef.current?.click())
  }, [pickAttachment])

  const supportsThinking = currentModel?.reasoning === true

  /**
   * Merge a parsed batch into the store. Reads the *current* attachments at
   * flush time (`store.getAttachments()`) instead of a batch-start snapshot:
   * `loadAttachmentFile` awaits document parses that can run for seconds (PDF /
   * DOCX up to 30s), during which the user may delete tiles or start another
   * batch. Merging against the live list is what the `attachmentsRef` mirror
   * used to provide.
   */
  const addFiles = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) return

      const decision = filterFilesByLimits(files, store.getAttachments().length, maxFiles, maxFileSize)
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
      const current = store.getAttachments()
      const settled = filterFilesByLimits(newAttachments, current.length, maxFiles, maxFileSize)
      if (settled.countExceeded) {
        window.alert(t('composerMaxFiles', { count: maxFiles }))
      } else {
        const merged = [...current, ...settled.accepted]
        store.setAttachments(merged)
        onFilesChange?.(merged)
      }
      setProcessingFiles(false)
    },
    [store, loadAttachmentFile, maxFiles, maxFileSize, onFilesChange],
  )

  const handlePaste = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (composerReadOnly) return
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

  const removeFile = useCallback((fileId: string) => {
    const next = store.getAttachments().filter((file) => file.id !== fileId)
    store.setAttachments(next)
    onFilesChange?.(next)
  }, [store, onFilesChange])

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (composerReadOnly) return
    event.preventDefault()
    event.stopPropagation()
    if (!isDragging) setIsDragging(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (composerReadOnly) return
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
    if (composerReadOnly) return
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

        <ComposerAttachmentRow store={store} onRemove={removeFile} />

        <ComposerTextarea
          store={store}
          textareaRef={textareaRef}
          isStreaming={isStreaming}
          processingFiles={processingFiles}
          readOnly={composerReadOnly}
          onInput={onInput}
          onSend={onSend}
          onAbort={onAbort}
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
            {leadingControls}
            {processingFiles ? (
              <div className="flex h-8 w-8 items-center justify-center">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : showAttachmentButton ? (
              <Button
                variant="ghost"
                className="h-8 w-8"
                size="icon"
                title={t('composerAttachFiles')}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="size-4" />
              </Button>
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
                // The decoration layer used to tag this button with
                // `quickforge-model-trigger` on every pass and derive
                // `aria-expanded` from a document-wide menu lookup. React owns
                // the tag now. `aria-expanded` is deliberately NOT declared
                // here: the custom model menu (lib/custom-model-selector.ts)
                // sets it to "true" when it opens and "false" when it closes,
                // and a React-declared value would be re-applied on every
                // surface re-render (streaming events), wiping out the open
                // highlight.
                className="quickforge-model-trigger h-8 truncate text-xs"
                aria-haspopup="menu"
                size="sm"
                // Side Chat renders the trigger in a native disabled state (the
                // decoration used to set `button.disabled`); without this the
                // click would still open the model selector there.
                disabled={composerControlsDisabled}
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
            {/* The QuickForge thinking selector sits after the model trigger in
                the right-hand row, where the decoration inserted it
                (`modelButton.insertAdjacentElement('afterend', …)`). */}
            {trailingControls}
            <ComposerActionButton
              store={store}
              isStreaming={isStreaming}
              isWaiting={isWaiting}
              processingFiles={processingFiles}
              readOnly={composerReadOnly}
              onSend={onSend}
              onAbort={onAbort}
              onBeforeAbort={onBeforeAbort}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
