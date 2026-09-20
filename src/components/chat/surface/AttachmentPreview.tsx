/* eslint-disable react-refresh/only-export-components -- exports the attachment preview components plus the base64/sanitization helpers covered by the loader tests. */
import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { WorkBook, WorkSheet } from 'xlsx'
import { RefreshCw } from 'lucide-react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Inline previews for chat attachments, mirroring the document renderers of
 * `src/components/workspace/WorkspaceDocumentContent.tsx` but decoupled from
 * `projectId` / `path`: the bytes come from the `Attachment.content` base64
 * payload instead of a workspace fetch. PDF pages, DOCX layout and Excel
 * sheets are rendered; PPTX stays text-only (extracted in the loader) and is
 * handled by the overlay.
 *
 * Rendered attachment markup is untrusted: docx output is sanitized after
 * every render (hyperlink and image scheme allowlists plus style scanning)
 * and base64 decoding happens in effects, never during render.
 */

const PDF_PREVIEW_SCALE = 1.5
const PDF_RENDER_MARGIN = '900px 0px'
const EXCEL_MAX_ROWS = 5000
const EXCEL_MAX_COLUMNS = 50

/** Decode raw base64 (no data-URL prefix) into bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * Decode attachment bytes outside of render so a malformed payload degrades
 * to an inline error message instead of crashing the React tree.
 */
function useDecodedAttachmentBytes(content: string): { data?: Uint8Array; error: string } {
  const [data, setData] = useState<Uint8Array>()
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return
      try {
        setData(base64ToBytes(content))
        setError('')
      } catch (decodeError) {
        setError(errorText(decodeError))
      }
    })
    return () => {
      cancelled = true
    }
  }, [content])
  return { data, error }
}

// ---------------------------------------------------------------------------
// Post-render sanitization of docx-preview output (XSS hardening)
// ---------------------------------------------------------------------------

/** Hyperlink schemes allowed to survive an attachment render. */
const ATTACHMENT_ALLOWED_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/** Strip the ASCII control/space characters browsers ignore when parsing URLs. */
function normalizeHrefForSchemeCheck(href: string): string {
  let normalized = ''
  for (let index = 0; index < href.length; index += 1) {
    const code = href.charCodeAt(index)
    if (code <= 0x20 || code === 0x7f) continue
    normalized += href[index]
  }
  return normalized
}

/**
 * URL schemes are matched after stripping control characters (browsers ignore
 * tabs/newlines inside `href`, so `jav\tascript:` must not slip through).
 */
export function isAllowedAttachmentHref(href: string): boolean {
  const normalized = normalizeHrefForSchemeCheck(href)
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(normalized)
  if (!schemeMatch) return true // relative path, query or `#anchor`
  return ATTACHMENT_ALLOWED_LINK_SCHEMES.has(`${schemeMatch[1].toLowerCase()}:`)
}

/** Minimal structural surface of an anchor element (satisfied by the DOM and test fakes). */
export type SanitizableAnchor = {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
}

/** Minimal structural surface of a query root such as an element. */
export type AttachmentSanitizeRoot<T> = {
  querySelectorAll(selector: string): Iterable<T>
}

/**
 * Neutralize unsafe hyperlinks after a docx render: anything that is not
 * http(s)/mailto/relative/anchor is pointed at `#`, and every link gets
 * `rel="noopener noreferrer"` + `target="_blank"`.
 */
export function sanitizeAttachmentLinks(root: AttachmentSanitizeRoot<SanitizableAnchor>): number {
  let sanitized = 0
  for (const anchor of root.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href') ?? ''
    if (!isAllowedAttachmentHref(href)) anchor.setAttribute('href', '#')
    anchor.setAttribute('rel', 'noopener noreferrer')
    anchor.setAttribute('target', '_blank')
    sanitized += 1
  }
  return sanitized
}

/** Image source schemes allowed to survive an attachment render. */
const ATTACHMENT_ALLOWED_IMAGE_SCHEMES = new Set(['http:', 'https:', 'blob:'])

/**
 * Image sources follow the same scheme checks as hyperlinks: docx-preview
 * emits `data:`/`blob:` URLs for embedded media, http(s) covers linked
 * images, and anything else (`javascript:`, `vbscript:`, `file:`, …) is
 * rejected.
 */
export function isAllowedAttachmentImageSrc(src: string): boolean {
  const normalized = normalizeHrefForSchemeCheck(src)
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(normalized)
  if (!schemeMatch) return true // relative path
  const scheme = `${schemeMatch[1].toLowerCase()}:`
  // `data:` is narrowed to images: an <img> only renders image payloads, so
  // `data:text/html` and friends are conservatively dropped.
  if (scheme === 'data:') return /^data:image\//i.test(normalized)
  return ATTACHMENT_ALLOWED_IMAGE_SCHEMES.has(scheme)
}

/** Minimal structural surface of an image element (satisfied by the DOM and test fakes). */
export type SanitizableImage = {
  getAttribute(name: string): string | null
  removeAttribute(name: string): void
}

/**
 * Neutralize unsafe image sources after a docx render by dropping the `src`
 * attribute outright (a placeholder like `#` would re-request the current
 * document as an image).
 */
export function sanitizeAttachmentImages(root: AttachmentSanitizeRoot<SanitizableImage>): number {
  let sanitized = 0
  for (const image of root.querySelectorAll('img[src]')) {
    const src = image.getAttribute('src') ?? ''
    if (!isAllowedAttachmentImageSrc(src)) image.removeAttribute('src')
    sanitized += 1
  }
  return sanitized
}

/** Minimal structural surface of an injected `<style>` element. */
export type SanitizableStyle = {
  textContent: string | null
  remove(): void
}

/**
 * docx-preview injects `<style>` elements built from document part text; a
 * crafted document could smuggle markup through them. Valid CSS essentially
 * never contains `<`, so drop any style block that does (cosmetic loss only).
 */
export function sanitizeAttachmentStyles(root: AttachmentSanitizeRoot<SanitizableStyle>): number {
  let removed = 0
  for (const style of root.querySelectorAll('style')) {
    if ((style.textContent ?? '').includes('<')) {
      style.remove()
      removed += 1
    }
  }
  return removed
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function PreviewLoading() {
  return (
    <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
      <RefreshCw className="mr-2 size-4 animate-spin" />
      {t('attachmentPreviewLoading')}
    </div>
  )
}

function PdfAttachmentPage({ pdf, pageNumber }: { pdf: Pick<PDFDocumentProxy, 'getPage'>; pageNumber: number }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Only render pages near the viewport (same heuristic as WorkspaceDocumentContent).
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [rendered, setRendered] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: PDF_RENDER_MARGIN })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || rendered) return undefined
    let cancelled = false
    let renderTask: { cancel?: () => void; promise: Promise<unknown> } | undefined
    void pdf.getPage(pageNumber).then((page) => {
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      const viewport = page.getViewport({ scale: PDF_PREVIEW_SCALE })
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const nextRenderTask = page.render({ canvas, viewport })
      renderTask = nextRenderTask
      return nextRenderTask.promise
    }).then(() => {
      if (!cancelled) setRendered(true)
    }).catch((renderError: unknown) => {
      const cancelledByPdfJs = renderError instanceof Error && renderError.name === 'RenderingCancelledException'
      if (!cancelled && !cancelledByPdfJs) setError(errorText(renderError))
    })
    return () => {
      cancelled = true
      renderTask?.cancel?.()
    }
  }, [pageNumber, pdf, rendered, visible])

  return (
    <div ref={hostRef} className="relative flex w-full flex-col items-center rounded-lg border border-border bg-background p-3 shadow-sm">
      <div className="mb-2 text-[11px] font-medium text-muted-foreground">{t('attachmentPreviewPage', { page: pageNumber })}</div>
      {error ? <div className="p-4 text-sm text-destructive">{error}</div> : null}
      {!error ? <canvas ref={canvasRef} className={cn('max-w-full bg-white', !rendered && 'min-h-40')} /> : null}
      {!error && !rendered ? <div className="absolute py-1 text-xs text-muted-foreground">{t('attachmentPreviewLoading')}</div> : null}
    </div>
  )
}

export function PdfAttachmentPreview({ content }: { content: string }) {
  const { data, error: decodeError } = useDecodedAttachmentBytes(content)
  const [pdf, setPdf] = useState<PDFDocumentProxy>()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!data) return undefined
    let disposed = false
    let loadingTask: ReturnType<typeof import('pdfjs-dist')['getDocument']> | undefined
    void import('pdfjs-dist').then((pdfjs) => {
      if (disposed) return undefined
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
      loadingTask = pdfjs.getDocument({
        data: data.slice(0),
        disableRange: true,
        disableStream: true,
        isEvalSupported: false,
      })
      return loadingTask.promise
    }).then((document) => {
      if (!disposed && document) {
        setPdf(document)
        setError('')
      }
    }).catch((parseError: unknown) => {
      if (!disposed) {
        setPdf(undefined)
        setError(errorText(parseError))
      }
    })
    return () => {
      disposed = true
      void loadingTask?.destroy?.()
    }
  }, [data])

  if (decodeError) return <div className="p-4 text-sm text-destructive">{decodeError}</div>
  if (error) return <div className="p-4 text-sm text-destructive">{error}</div>
  if (!pdf) return <PreviewLoading />
  return (
    <div className="h-full w-full overflow-auto">
      <div className="mx-auto flex max-w-[1000px] flex-col gap-4">
        {Array.from({ length: pdf.numPages }, (_, index) => (
          <PdfAttachmentPage key={index + 1} pdf={pdf} pageNumber={index + 1} />
        ))}
      </div>
    </div>
  )
}

export function DocxAttachmentPreview({ content }: { content: string }) {
  const { data, error: decodeError } = useDecodedAttachmentBytes(content)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const styleRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const body = bodyRef.current
    const styles = styleRef.current
    if (!body || !styles || !data) return undefined
    let disposed = false
    body.replaceChildren()
    styles.replaceChildren()
    void import('docx-preview').then(({ renderAsync }) => renderAsync(data.slice(0), body, styles, {
      className: 'quickforge-docx-preview',
      inWrapper: true,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      ignoreWidth: true,
      ignoreHeight: false,
      useBase64URL: false,
    })).then(() => {
      // docx-preview renders untrusted document markup; sanitize the result
      // (hyperlink + image schemes, injected styles) before it becomes interactive.
      if (disposed) return
      sanitizeAttachmentLinks(body)
      sanitizeAttachmentImages(body)
      sanitizeAttachmentStyles(styles)
    }).catch((parseError: unknown) => {
      if (!disposed) setError(errorText(parseError))
    })
    return () => {
      disposed = true
      body.replaceChildren()
      styles.replaceChildren()
    }
  }, [data])

  if (decodeError) return <div className="p-4 text-sm text-destructive">{decodeError}</div>
  if (error) return <div className="p-4 text-sm text-destructive">{error}</div>
  return (
    <div className="h-full w-full overflow-auto">
      <div ref={styleRef} />
      <div className="quickforge-docx-scope mx-auto max-w-[1000px] overflow-hidden rounded-lg border border-border bg-background shadow-sm">
        <div ref={bodyRef} />
      </div>
    </div>
  )
}

type ExcelSheetPreview = {
  name: string
  rows: string[][]
  truncatedRows: boolean
  truncatedColumns: boolean
}

type XlsxModule = typeof import('xlsx')

/** Estimated sheet dimensions from the `!ref` range, before any row is materialized. */
export function estimateExcelSheetDimensions(
  xlsx: XlsxModule,
  worksheet: WorkSheet,
): { rows: number; columns: number } | undefined {
  const ref = worksheet['!ref']
  if (!ref) return undefined
  try {
    const range = xlsx.utils.decode_range(ref)
    return { rows: range.e.r - range.s.r + 1, columns: range.e.c - range.s.c + 1 }
  } catch {
    return undefined
  }
}

/** Narrow a sheet's `!ref` to the preview window so conversion only materializes the sampled cells. */
function narrowExcelSheetForPreview(xlsx: XlsxModule, worksheet: WorkSheet): WorkSheet {
  const ref = worksheet['!ref']
  if (!ref) return worksheet
  let range: ReturnType<XlsxModule['utils']['decode_range']>
  try {
    range = xlsx.utils.decode_range(ref)
  } catch {
    return worksheet
  }
  range.e.r = Math.min(range.e.r, range.s.r + EXCEL_MAX_ROWS - 1)
  range.e.c = Math.min(range.e.c, range.s.c + EXCEL_MAX_COLUMNS - 1)
  return { ...worksheet, '!ref': xlsx.utils.encode_range(range) }
}

/**
 * Build preview rows for every sheet, sampling at most
 * {@link EXCEL_MAX_ROWS} rows × {@link EXCEL_MAX_COLUMNS} columns and
 * reporting which caps actually truncated the sheet.
 */
export function buildExcelSheetPreviews(xlsx: XlsxModule, workbook: WorkBook): ExcelSheetPreview[] {
  return workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name]
    const estimate = worksheet ? estimateExcelSheetDimensions(xlsx, worksheet) : undefined
    const truncatedRows = (estimate?.rows ?? 0) > EXCEL_MAX_ROWS
    const truncatedColumns = (estimate?.columns ?? 0) > EXCEL_MAX_COLUMNS
    const effective = worksheet && (truncatedRows || truncatedColumns) ? narrowExcelSheetForPreview(xlsx, worksheet) : worksheet
    const rawRows = effective ? xlsx.utils.sheet_to_json<unknown[]>(effective, { header: 1, raw: false, defval: '' }) : []
    return {
      name,
      rows: rawRows.slice(0, EXCEL_MAX_ROWS).map((row) => row.map((cell) => String(cell ?? ''))),
      truncatedRows,
      truncatedColumns,
    }
  })
}

export function ExcelAttachmentPreview({ content }: { content: string }) {
  const { data, error: decodeError } = useDecodedAttachmentBytes(content)
  const [sheets, setSheets] = useState<ExcelSheetPreview[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!data) return undefined
    let disposed = false
    void import('xlsx').then((xlsx) => {
      const workbook = xlsx.read(data.slice(0), { type: 'array', cellDates: true })
      return buildExcelSheetPreviews(xlsx, workbook)
    }).then((nextSheets) => {
      if (!disposed) setSheets(nextSheets)
    }).catch((parseError: unknown) => {
      if (!disposed) setError(errorText(parseError))
    })
    return () => { disposed = true }
  }, [data])

  const sheet = sheets[activeSheet]
  const columnCount = sheet ? sheet.rows.reduce((max, row) => Math.max(max, row.length), 0) : 0

  if (decodeError) return <div className="p-4 text-sm text-destructive">{decodeError}</div>
  if (error) return <div className="p-4 text-sm text-destructive">{error}</div>
  if (!sheet) return <PreviewLoading />
  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background">
      {sheets.length > 1 ? (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-muted/30 px-3 py-2">
          {sheets.map((item, index) => (
            <button
              key={`${item.name}-${index}`}
              type="button"
              className={cn('h-8 shrink-0 rounded-md px-3 text-xs font-medium transition-colors', index === activeSheet ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
              onClick={() => setActiveSheet(index)}
            >
              {item.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-left text-xs">
          <tbody>
            {sheet.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th className="sticky left-0 z-10 w-12 border-b border-r border-[color-mix(in_oklab,var(--border)_45%,transparent)] bg-muted/30 px-2 py-1.5 text-right font-mono font-normal text-muted-foreground">
                  {rowIndex + 1}
                </th>
                {Array.from({ length: columnCount }, (_, columnIndex) => (
                  <td key={columnIndex} className="max-w-80 whitespace-pre-wrap break-words border-b border-r border-[color-mix(in_oklab,var(--border)_35%,transparent)] px-2.5 py-1.5 align-top text-foreground">
                    {row[columnIndex] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ExcelTruncationNotices truncatedRows={sheet.truncatedRows} truncatedColumns={sheet.truncatedColumns} />
    </div>
  )
}

/** Row/column sampling notices for the Excel preview (i18n-aware). */
export function ExcelTruncationNotices({ truncatedRows, truncatedColumns }: { truncatedRows: boolean; truncatedColumns: boolean }) {
  if (!truncatedRows && !truncatedColumns) return null
  return (
    <div className="shrink-0 border-t border-border px-3 py-2 text-xs text-muted-foreground">
      {truncatedRows ? <div>{t('attachmentExcelRowsTruncated', { count: EXCEL_MAX_ROWS })}</div> : null}
      {truncatedColumns ? <div>{t('attachmentExcelColumnsTruncated', { count: EXCEL_MAX_COLUMNS })}</div> : null}
    </div>
  )
}
