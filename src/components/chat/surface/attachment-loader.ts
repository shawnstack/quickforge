/**
 * Local attachment loader for the self-hosted React chat surface.
 *
 * Restores the document pipeline of the legacy `utils/attachment-utils.ts`
 * (self-hosted-chat-ui regression fix):
 * - PDF page text + first-page thumbnail,
 * - DOCX structure text (paragraphs, tables),
 * - PPTX slides plus speaker notes,
 * - XLS/XLSX every sheet as CSV.
 *
 * The `Attachment` contract is unchanged: `type` is `'image' | 'document'`,
 * `content` is raw base64 without a data-URL prefix, `extractedText` is the
 * only field the server forwards to the LLM (see `server/message-converters.mjs`)
 * and `preview` is an optional base64 thumbnail. Heavy parsers are imported
 * lazily so the composer stays light, mirroring
 * `src/components/workspace/WorkspaceDocumentContent.tsx`.
 */
import type JSZip from 'jszip'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Attachment } from './ChatTypes'

/** Resolved file family used to pick a parser (and, in the overlay, a preview). */
export type AttachmentKind = 'image' | 'text' | 'pdf' | 'docx' | 'pptx' | 'excel' | 'unsupported'

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const XLS_MIME = 'application/vnd.ms-excel'

const TEXT_FILE_EXTENSIONS = ['.txt', '.md', '.json', '.xml', '.html', '.css', '.js', '.ts', '.jsx', '.tsx', '.yml', '.yaml']

const PDF_EXTENSIONS = ['.pdf']
const DOCX_EXTENSIONS = ['.docx']
const PPTX_EXTENSIONS = ['.pptx']
const EXCEL_EXTENSIONS = ['.xlsx', '.xls']

const PDF_PREVIEW_MAX_EDGE = 160
const BASE64_CHUNK_SIZE = 0x8000

/** Zip-bomb guards: reject entries that claim to decompress beyond these caps. */
const ZIP_ENTRY_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
const ZIP_TOTAL_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
/** `extractedText` is the only field forwarded to the LLM — keep it bounded. */
const EXTRACTED_TEXT_MAX_LENGTH = 2 * 1024 * 1024
const EXTRACTED_TEXT_TRUNCATION_MARKER = '\n[Truncated: extracted text exceeded the 2MB limit]'
const PDF_MAX_PAGES = 500
const DOCUMENT_PROCESS_TIMEOUT_MS = 30_000

const DOCX_DOCUMENT_PART = 'word/document.xml'
const PPTX_SLIDE_PATTERN = /^ppt\/slides\/slide(\d+)\.xml$/
const PPTX_NOTES_PATTERN = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/

function endsWithAny(fileName: string, extensions: string[]): boolean {
  const lower = fileName.toLowerCase()
  return extensions.some((extension) => lower.endsWith(extension))
}

/**
 * Classify a file from its MIME type and name. Browsers do not always fill
 * `File.type`, so an empty MIME type still resolves through the extension
 * (matching the legacy attachment-utils).
 */
export function resolveAttachmentKind(fileName: string, mimeType: string): AttachmentKind {
  const mime = (mimeType || '').toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime === PDF_MIME || endsWithAny(fileName, PDF_EXTENSIONS)) return 'pdf'
  if (mime === DOCX_MIME || endsWithAny(fileName, DOCX_EXTENSIONS)) return 'docx'
  if (mime === PPTX_MIME || endsWithAny(fileName, PPTX_EXTENSIONS)) return 'pptx'
  if (mime === XLSX_MIME || mime === XLS_MIME || endsWithAny(fileName, EXCEL_EXTENSIONS)) return 'excel'
  if (mime.startsWith('text/') || endsWithAny(fileName, TEXT_FILE_EXTENSIONS)) return 'text'
  return 'unsupported'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Encode bytes as raw base64 (no data-URL prefix, chunked to avoid stack overflow). */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK_SIZE))
  }
  return btoa(binary)
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    // `&amp;` last so previously decoded entities are not decoded twice.
    .replace(/&amp;/g, '&')
}

/** Concatenate the WordprocessingML runs (`w:t` / `w:tab` / `w:br`) of one element. */
function collectDocxInlineText(xml: string): string {
  const tokenPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g
  let text = ''
  let token: RegExpExecArray | null
  while ((token = tokenPattern.exec(xml)) !== null) {
    if (token[1] !== undefined) text += decodeXmlEntities(token[1])
    else if (token[0].startsWith('<w:tab')) text += '\t'
    else text += '\n'
  }
  return text
}

/** Render `word/document.xml` as structured text (`<docx>` wrapper, tables inline). */
function formatDocxText(documentXml: string, fileName: string): string {
  const bodyMatch = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(documentXml)
  const body = bodyMatch ? bodyMatch[1] : documentXml
  const blockPattern = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g
  const blocks: string[] = []
  let block: RegExpExecArray | null
  while ((block = blockPattern.exec(body)) !== null) {
    if (block[0].startsWith('<w:tbl')) {
      const rows: string[] = []
      const rowPattern = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g
      let row: RegExpExecArray | null
      while ((row = rowPattern.exec(block[0])) !== null) {
        const cells: string[] = []
        const cellPattern = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g
        let cell: RegExpExecArray | null
        while ((cell = cellPattern.exec(row[0])) !== null) {
          const cellText = collectDocxInlineText(cell[0]).trim()
          if (cellText) cells.push(cellText)
        }
        if (cells.length > 0) rows.push(cells.join(' | '))
      }
      if (rows.length > 0) blocks.push(`[Table]\n${rows.join('\n')}\n[/Table]`)
    } else {
      const paragraphText = collectDocxInlineText(block[0]).trim()
      if (paragraphText) blocks.push(paragraphText)
    }
  }
  return `<docx filename="${fileName}">\n<page number="1">\n${blocks.join('\n')}\n</page>\n</docx>`
}

/** Collect DrawingML text runs (`a:t`) from a slide or notes part. */
function collectPptxTexts(xml: string): string[] {
  const texts: string[] = []
  const tokenPattern = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g
  let token: RegExpExecArray | null
  while ((token = tokenPattern.exec(xml)) !== null) {
    const text = decodeXmlEntities(token[1]).trim()
    if (text) texts.push(text)
  }
  return texts
}

async function loadZip(buffer: ArrayBuffer): Promise<JSZip> {
  const { default: JSZipConstructor } = await import('jszip')
  return JSZipConstructor.loadAsync(buffer.slice(0))
}

/** Cumulative declared decompressed bytes per loaded zip (zip-bomb guard). */
const zipDecompressedTotals = new WeakMap<JSZip, number>()

/**
 * Declared uncompressed size of a zip entry loaded from a real archive.
 * JSZip keeps it on the private `_data` metadata object; entries built in
 * memory have no such metadata, in which case this returns `undefined`.
 */
function zipEntryUncompressedSize(entry: JSZip.JSZipObject): number | undefined {
  const size = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data?.uncompressedSize
  return typeof size === 'number' && size >= 0 ? size : undefined
}

function rejectZipOverflow(path: string, size: number, total: number): void {
  if (size > ZIP_ENTRY_MAX_UNCOMPRESSED_BYTES) {
    throw new Error(`Zip entry "${path}" declares ${size} uncompressed bytes, above the ${ZIP_ENTRY_MAX_UNCOMPRESSED_BYTES} byte per-entry limit`)
  }
  if (total > ZIP_TOTAL_MAX_UNCOMPRESSED_BYTES) {
    throw new Error(`Zip contents declare more than ${ZIP_TOTAL_MAX_UNCOMPRESSED_BYTES} uncompressed bytes in total`)
  }
}

/**
 * Validate one zip entry against the decompression budget and return the new
 * cumulative total. Exported so the cumulative cap stays unit-testable.
 */
export function accumulateZipEntryBudget(path: string, size: number, previousTotal: number): number {
  const total = previousTotal + size
  rejectZipOverflow(path, size, total)
  return total
}

async function readZipText(zip: JSZip, path: string): Promise<string | undefined> {
  const entry = zip.file(path)
  if (!entry) return undefined
  const declaredSize = zipEntryUncompressedSize(entry)
  if (declaredSize !== undefined) {
    // Guard before decompressing so a zip bomb never materializes in memory.
    zipDecompressedTotals.set(zip, accumulateZipEntryBudget(path, declaredSize, zipDecompressedTotals.get(zip) ?? 0))
  }
  const text = await entry.async('text')
  if (declaredSize === undefined) {
    // Fallback for archives without usable metadata: account for the actual
    // decoded length so the cumulative cap still holds.
    zipDecompressedTotals.set(zip, accumulateZipEntryBudget(path, text.length, zipDecompressedTotals.get(zip) ?? 0))
  }
  return text
}

function pptxEntryNumber(name: string, pattern: RegExp): number {
  return Number.parseInt(pattern.exec(name)?.[1] ?? '0', 10)
}

function sortedPptxEntries(zip: JSZip, pattern: RegExp): string[] {
  return Object.keys(zip.files)
    .filter((name) => pattern.test(name))
    .sort((left, right) => pptxEntryNumber(left, pattern) - pptxEntryNumber(right, pattern))
}

/** Best-effort first-page PNG thumbnail; missing canvas (headless) or render errors are tolerated. */
async function renderPdfPreview(pdf: PDFDocumentProxy): Promise<string | undefined> {
  if (typeof document === 'undefined') return undefined
  try {
    const page = await pdf.getPage(1)
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = Math.min(PDF_PREVIEW_MAX_EDGE / baseViewport.width, PDF_PREVIEW_MAX_EDGE / baseViewport.height)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(viewport.width))
    canvas.height = Math.max(1, Math.round(viewport.height))
    await page.render({ canvas, viewport }).promise
    const dataUrl = canvas.toDataURL('image/png')
    const commaIndex = dataUrl.indexOf(',')
    return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : undefined
  } catch (error) {
    console.error('Error generating PDF preview:', error)
    return undefined
  }
}

async function extractPdf(buffer: ArrayBuffer, fileName: string): Promise<{ extractedText: string; preview?: string }> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer.slice(0)),
    disableRange: true,
    disableStream: true,
    isEvalSupported: false,
  })
  const pdf = await loadingTask.promise
  try {
    const pages: string[] = []
    const extractedPageCount = Math.min(pdf.numPages, PDF_MAX_PAGES)
    for (let pageNumber = 1; pageNumber <= extractedPageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const textContent = await page.getTextContent()
      const pageText = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter((text) => text.trim())
        .join(' ')
      pages.push(pageText)
    }
    let extractedText = `<pdf filename="${fileName}">`
    pages.forEach((pageText, index) => {
      extractedText += `\n<page number="${index + 1}">\n${pageText}\n</page>`
    })
    if (pdf.numPages > PDF_MAX_PAGES) {
      extractedText += `\n<truncated pages="${pdf.numPages}" extracted="${PDF_MAX_PAGES}">Only the first ${PDF_MAX_PAGES} of ${pdf.numPages} pages were extracted.</truncated>`
    }
    extractedText += '\n</pdf>'
    return { extractedText, preview: await renderPdfPreview(pdf) }
  } finally {
    await pdf.destroy()
  }
}

async function extractDocx(buffer: ArrayBuffer, fileName: string): Promise<string> {
  const zip = await loadZip(buffer)
  const documentXml = await readZipText(zip, DOCX_DOCUMENT_PART)
  if (documentXml === undefined) throw new Error(`${DOCX_DOCUMENT_PART} is missing`)
  return formatDocxText(documentXml, fileName)
}

async function extractPptx(buffer: ArrayBuffer, fileName: string): Promise<string> {
  const zip = await loadZip(buffer)
  let extractedText = `<pptx filename="${fileName}">`
  const slideNames = sortedPptxEntries(zip, PPTX_SLIDE_PATTERN)
  for (let index = 0; index < slideNames.length; index += 1) {
    const slideXml = await readZipText(zip, slideNames[index])
    if (slideXml === undefined) continue
    const slideTexts = collectPptxTexts(slideXml)
    if (slideTexts.length === 0) continue
    extractedText += `\n<slide number="${index + 1}">\n${slideTexts.join('\n')}\n</slide>`
  }
  const notesNames = sortedPptxEntries(zip, PPTX_NOTES_PATTERN)
  if (notesNames.length > 0) {
    extractedText += '\n<notes>'
    for (const notesName of notesNames) {
      const notesXml = await readZipText(zip, notesName)
      if (notesXml === undefined) continue
      const noteTexts = collectPptxTexts(notesXml)
      if (noteTexts.length === 0) continue
      extractedText += `\n[Slide ${pptxEntryNumber(notesName, PPTX_NOTES_PATTERN)} notes]: ${noteTexts.join(' ')}`
    }
    extractedText += '\n</notes>'
  }
  return `${extractedText}\n</pptx>`
}

async function extractExcel(buffer: ArrayBuffer, fileName: string): Promise<string> {
  const xlsx = await import('xlsx')
  const workbook = xlsx.read(new Uint8Array(buffer.slice(0)), { type: 'array', cellDates: true })
  let extractedText = `<excel filename="${fileName}">`
  workbook.SheetNames.forEach((sheetName, index) => {
    const worksheet = workbook.Sheets[sheetName]
    const csvText = worksheet ? xlsx.utils.sheet_to_csv(worksheet) : ''
    extractedText += `\n<sheet name="${sheetName}" index="${index + 1}">\n${csvText}\n</sheet>`
  })
  return `${extractedText}\n</excel>`
}

/**
 * Local attachment loader. Images get a base64 preview, text-like files keep
 * their decoded text and office documents are parsed into `extractedText`
 * (documents also expose optional previews). Unsupported and corrupt files
 * reject with a descriptive error; the composer reports them per-file and
 * keeps the rest of the batch.
 */
export async function loadSurfaceAttachment(file: File): Promise<Attachment> {
  const id = `${file.name}_${Date.now()}_${Math.random()}`
  const mimeType = file.type || 'application/octet-stream'
  const kind = resolveAttachmentKind(file.name, mimeType)
  if (kind === 'unsupported') throw new Error(`Unsupported file type: ${mimeType}`)

  const buffer = await file.arrayBuffer()
  const content = arrayBufferToBase64(buffer)
  const base = { id, fileName: file.name, size: file.size, content }

  switch (kind) {
    case 'image':
      return { ...base, type: 'image', mimeType, preview: content }
    case 'text':
      return {
        ...base,
        type: 'document',
        mimeType: mimeType.startsWith('text/') ? mimeType : 'text/plain',
        extractedText: clampExtractedText(new TextDecoder().decode(buffer)),
      }
    case 'pdf': {
      const { extractedText, preview } = await processDocument('PDF', file.name, () => extractPdf(buffer, file.name))
      return { ...base, type: 'document', mimeType: PDF_MIME, extractedText: clampExtractedText(extractedText), preview }
    }
    case 'docx': {
      const extractedText = await processDocument('DOCX', file.name, () => extractDocx(buffer, file.name))
      return { ...base, type: 'document', mimeType: DOCX_MIME, extractedText: clampExtractedText(extractedText) }
    }
    case 'pptx': {
      const extractedText = await processDocument('PPTX', file.name, () => extractPptx(buffer, file.name))
      return { ...base, type: 'document', mimeType: PPTX_MIME, extractedText: clampExtractedText(extractedText) }
    }
    case 'excel': {
      const extractedText = await processDocument('Excel', file.name, () => extractExcel(buffer, file.name))
      return {
        ...base,
        type: 'document',
        mimeType: mimeType.startsWith('application/vnd') ? mimeType : XLSX_MIME,
        extractedText: clampExtractedText(extractedText),
      }
    }
    default:
      throw new Error(`Unsupported file type: ${mimeType}`)
  }
}

/** Cap `extractedText` at {@link EXTRACTED_TEXT_MAX_LENGTH} with a visible truncation marker. */
function clampExtractedText(text: string): string {
  return text.length > EXTRACTED_TEXT_MAX_LENGTH
    ? text.slice(0, EXTRACTED_TEXT_MAX_LENGTH) + EXTRACTED_TEXT_TRUNCATION_MARKER
    : text
}

/** Wrap a document parser so failures surface as `Failed to process <format>: ...` and never hang forever. */
async function processDocument<T>(label: string, fileName: string, run: () => Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Timed out after ${DOCUMENT_PROCESS_TIMEOUT_MS}ms while processing ${label} ${fileName}`)),
      DOCUMENT_PROCESS_TIMEOUT_MS,
    )
  })
  try {
    return await Promise.race([run(), timeout])
  } catch (error) {
    throw new Error(`Failed to process ${label}: ${errorMessage(error)}`, { cause: error })
  } finally {
    clearTimeout(timeoutId)
  }
}
