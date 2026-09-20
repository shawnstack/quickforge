import { FileSpreadsheet, FileText, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { Attachment } from './ChatTypes'
import { openAttachmentOverlay } from './AttachmentOverlay'

/**
 * React replacement for the legacy `<attachment-tile>` custom element.
 * Compact attachment preview (image thumbnail or document icon) with an
 * optional delete button; clicking opens the full-screen attachment overlay.
 */

type AttachmentTileProps = {
  attachment: Attachment
  showDelete?: boolean
  onDelete?: () => void
}

export function AttachmentTile({ attachment, showDelete = false, onDelete }: AttachmentTileProps) {
  const fileName = attachment.fileName ?? ''
  const hasPreview = !!attachment.preview
  const isImage = attachment.type === 'image'
  const isPdf = attachment.mimeType === 'application/pdf'
  const isExcel =
    attachment.mimeType?.includes('spreadsheetml') ||
    fileName.toLowerCase().endsWith('.xlsx') ||
    fileName.toLowerCase().endsWith('.xls')

  return (
    <div className="qf-attachment-tile group relative inline-block max-h-16">
      {hasPreview ? (
        <div className="relative">
          <button
            type="button"
            className="block cursor-pointer"
            title={fileName}
            onClick={() => openAttachmentOverlay(attachment)}
          >
            <img
              src={`data:${isImage ? attachment.mimeType : 'image/png'};base64,${attachment.preview}`}
              className="h-16 w-16 rounded-lg border border-input object-cover transition-opacity hover:opacity-80"
              alt={fileName}
            />
          </button>
          {isPdf ? (
            <div className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-background/90 px-1 py-0.5">
              <div className="text-center text-[10px] font-medium text-muted-foreground">PDF</div>
            </div>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center rounded-lg border border-input bg-muted p-2 text-muted-foreground transition-opacity hover:opacity-80"
          title={fileName}
          onClick={() => openAttachmentOverlay(attachment)}
        >
          {isExcel ? <FileSpreadsheet className="size-5" /> : <FileText className="size-5" />}
          <div className="w-full truncate text-center text-[10px]">
            {fileName.length > 10 ? `${fileName.substring(0, 8)}...` : fileName}
          </div>
        </button>
      )}
      {showDelete ? (
        <button
          type="button"
          className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-input bg-background text-muted-foreground shadow-sm transition-opacity hover:bg-muted hover:text-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
          title={t('composerRemoveAttachment')}
          onClick={(event) => {
            event.stopPropagation()
            onDelete?.()
          }}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  )
}
