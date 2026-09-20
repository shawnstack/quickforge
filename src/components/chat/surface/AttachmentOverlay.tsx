/* eslint-disable react-refresh/only-export-components -- exports the overlay component, the preview error boundary and the imperative openAttachmentOverlay entry. */
import { Component, useCallback, useEffect, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Download, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { Attachment } from './ChatTypes'
import { resolveAttachmentKind } from './attachment-loader'
import { DocxAttachmentPreview, ExcelAttachmentPreview, PdfAttachmentPreview } from './AttachmentPreview'

/**
 * React replacement for the legacy `<attachment-overlay>` dialog.
 *
 * Full-screen viewer for a chat attachment: images render inline, PDF pages /
 * DOCX layout / Excel sheets are rendered by the local preview components,
 * PPTX and text-like documents show their extracted text, and the download /
 * close actions match the package component.
 */

type AttachmentOverlayProps = {
  attachment: Attachment
  onClose: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Fallback UI shown when a preview crashes the boundary; exported for static tests. */
export function AttachmentPreviewErrorFallback({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6" role="alertdialog" aria-modal="true">
      <div className="max-w-md rounded-lg border border-border bg-background p-4 text-center shadow-lg">
        <div className="text-sm font-medium text-destructive">{t('attachmentPreviewErrorTitle')}</div>
        {message ? <div className="mt-2 break-words text-xs text-muted-foreground">{message}</div> : null}
        <button
          type="button"
          className="mt-4 h-8 rounded-md bg-muted px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          onClick={onClose}
        >
          {t('close')}
        </button>
      </div>
    </div>
  )
}

type AttachmentPreviewErrorBoundaryProps = {
  onClose: () => void
  children: ReactNode
}

type AttachmentPreviewErrorBoundaryState = {
  hasError: boolean
  message: string
}

/** Keeps a broken attachment preview from unmounting the whole overlay root. */
export class AttachmentPreviewErrorBoundary extends Component<AttachmentPreviewErrorBoundaryProps, AttachmentPreviewErrorBoundaryState> {
  state: AttachmentPreviewErrorBoundaryState = { hasError: false, message: '' }

  static getDerivedStateFromError(error: unknown): AttachmentPreviewErrorBoundaryState {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Attachment preview crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return <AttachmentPreviewErrorFallback message={this.state.message} onClose={this.props.onClose} />
  }
}

export function AttachmentOverlay({ attachment, onClose }: AttachmentOverlayProps) {
  const [showExtractedText, setShowExtractedText] = useState(false)
  const kind = resolveAttachmentKind(attachment.fileName, attachment.mimeType)
  const isImage = kind === 'image'
  const hasDocumentPreview = kind === 'pdf' || kind === 'docx' || kind === 'excel'
  const canToggleText = !isImage && !!attachment.extractedText

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    },
    [onClose],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const [downloadError, setDownloadError] = useState('')
  const handleDownload = () => {
    try {
      const byteCharacters = atob(attachment.content)
      const byteArray = Uint8Array.from(byteCharacters, (char) => char.charCodeAt(0))
      const blob = new Blob([byteArray], { type: attachment.mimeType })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = attachment.fileName
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
      setDownloadError('')
    } catch (downloadFailure) {
      setDownloadError(t('attachmentDownloadFailed', { error: errorMessage(downloadFailure) }))
    }
  }

  const renderPreview = () => {
    if (isImage) {
      return (
        <img
          src={`data:${attachment.mimeType};base64,${attachment.content}`}
          alt={attachment.fileName}
          className="max-h-full max-w-full object-contain"
        />
      )
    }
    if (showExtractedText || !hasDocumentPreview) {
      if (!attachment.extractedText) {
        return (
          <div className="max-w-2xl rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
            {t('attachmentPreviewUnavailable')}
          </div>
        )
      }
      return showExtractedText ? (
        <pre className="max-h-full w-full max-w-4xl overflow-auto rounded-lg border border-border bg-background p-4 text-sm text-foreground">
          <code>{attachment.extractedText}</code>
        </pre>
      ) : (
        <div className="max-h-full w-full max-w-4xl overflow-auto rounded-lg border border-border bg-background p-4 text-sm text-foreground">
          {attachment.extractedText}
        </div>
      )
    }
    if (kind === 'pdf') return <PdfAttachmentPreview content={attachment.content} />
    if (kind === 'docx') return <DocxAttachmentPreview content={attachment.content} />
    return <ExcelAttachmentPreview content={attachment.content} />
  }

  return createPortal(
    // `qf-attachment-overlay` has no CSS rule and no production querySelector:
    // it is a test/style hook class — keep it when refactoring the overlay markup.
    <div
      className="qf-attachment-overlay fixed inset-0 z-50 flex flex-col bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label={attachment.fileName}
      onClick={onClose}
    >
      <div className="border-b border-border bg-background/95 backdrop-blur" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-sm font-medium text-foreground">{attachment.fileName}</span>
          </div>
          <div className="flex items-center gap-2">
            {canToggleText ? (
              <button
                type="button"
                className="h-8 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => setShowExtractedText((value) => !value)}
              >
                {showExtractedText ? t('attachmentShowPreview') : t('attachmentShowText')}
              </button>
            ) : null}
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t('download')}
              onClick={handleDownload}
            >
              <Download className="size-4" />
            </button>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t('close')}
              onClick={onClose}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        {downloadError ? <div className="px-4 pb-2 text-xs text-destructive">{downloadError}</div> : null}
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-4" onClick={(event) => event.stopPropagation()}>
        {renderPreview()}
      </div>
    </div>,
    document.body,
  )
}

/**
 * Imperatively open the attachment overlay on a detached root, mirroring
 * `AttachmentOverlay.open(attachment)` on the legacy overlay. A minimal
 * error boundary keeps a crashing preview from tearing down the root;
 * a synchronous render failure still unmounts and cleans the container.
 */
export function openAttachmentOverlay(attachment: Attachment, onClose?: () => void): void {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const close = () => {
    onClose?.()
    root.unmount()
    container.remove()
  }
  try {
    root.render(
      <AttachmentPreviewErrorBoundary onClose={close}>
        <AttachmentOverlay attachment={attachment} onClose={close} />
      </AttachmentPreviewErrorBoundary>,
    )
  } catch (renderError) {
    // Synchronous render errors bypass the boundary — still clean the root up.
    console.error('Attachment overlay failed to render:', renderError)
    root.unmount()
    container.remove()
  }
}
