import { beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import {
  accumulateZipEntryBudget,
  arrayBufferToBase64,
  loadSurfaceAttachment,
  resolveAttachmentKind,
} from '../../src/components/chat/surface/attachment-loader'
import { filterFilesByLimits } from '../../src/components/chat/surface/MessageEditor'

/**
 * `pdfjs-dist` only ships a browser build (it needs `DOMMatrix`/canvas), so the
 * PDF branch is exercised against a mocked loader; the document branches run
 * against real JSZip / SheetJS payloads built in the test.
 */
const pdfjsMock = vi.hoisted(() => ({ getDocument: vi.fn() }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: pdfjsMock.getDocument,
}))

function fileFromBytes(bytes: ArrayBuffer | Uint8Array, name: string, type = ''): File {
  return new File([bytes as ArrayBuffer], name, { type })
}

function mockPdf(pages: string[]) {
  pdfjsMock.getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: async (pageNumber: number) => ({
        getTextContent: async () => ({ items: pages[pageNumber - 1].split(' ').map((str) => ({ str })) }),
      }),
      destroy: async () => undefined,
    }),
  })
}

async function zipFile(name: string, entries: Record<string, string>): Promise<File> {
  const zip = new JSZip()
  for (const [path, content] of Object.entries(entries)) zip.file(path, content)
  return fileFromBytes(await zip.generateAsync({ type: 'uint8array' }), name)
}

function workbookBytes(bookType: 'xlsx' | 'xls'): ArrayBuffer {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['name', 'qty'], ['apple', '2']]), 'Fruit')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['city'], ['Oslo']]), 'Places')
  return XLSX.write(workbook, { type: 'array', bookType })
}

beforeEach(() => {
  pdfjsMock.getDocument.mockReset()
})

describe('attachment kind detection', () => {
  it('resolves office formats by extension when the MIME type is empty', () => {
    expect(resolveAttachmentKind('handbook.pdf', '')).toBe('pdf')
    expect(resolveAttachmentKind('proposal.docx', '')).toBe('docx')
    expect(resolveAttachmentKind('deck.pptx', '')).toBe('pptx')
    expect(resolveAttachmentKind('budget.xlsx', '')).toBe('excel')
    expect(resolveAttachmentKind('legacy.xls', '')).toBe('excel')
    expect(resolveAttachmentKind('REPORT.PDF', '')).toBe('pdf')
  })

  it('prefers the MIME type when present and falls back to unknown', () => {
    expect(resolveAttachmentKind('photo', 'image/png')).toBe('image')
    expect(resolveAttachmentKind('notes', 'text/markdown')).toBe('text')
    expect(resolveAttachmentKind('notes.txt', '')).toBe('text')
    expect(resolveAttachmentKind('data.xlsm', '')).toBe('unsupported')
    expect(resolveAttachmentKind('archive.bin', 'application/octet-stream')).toBe('unsupported')
  })
})

describe('loadSurfaceAttachment images and text', () => {
  it('keeps raw base64 content with a matching preview for images', async () => {
    const attachment = await loadSurfaceAttachment(fileFromBytes(new Uint8Array([1, 2, 3]), 'pixel.png', 'image/png'))
    expect(attachment.type).toBe('image')
    expect(attachment.content).not.toContain('base64,')
    expect(attachment.preview).toBe(attachment.content)
    expect(attachment.content).toBe(arrayBufferToBase64(new Uint8Array([1, 2, 3]).buffer))
  })

  it('extracts text-like documents without a data URL prefix', async () => {
    const attachment = await loadSurfaceAttachment(fileFromBytes(new TextEncoder().encode('# Title'), 'notes.md'))
    expect(attachment.type).toBe('document')
    expect(attachment.mimeType).toBe('text/plain')
    expect(attachment.extractedText).toBe('# Title')
    expect(attachment.content).toBe(arrayBufferToBase64(new TextEncoder().encode('# Title').buffer))
  })
})

describe('loadSurfaceAttachment PDF', () => {
  it('extracts per-page text and skips headless thumbnail generation', async () => {
    mockPdf(['page one words', 'page two words'])
    const attachment = await loadSurfaceAttachment(fileFromBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'report.pdf'))

    expect(attachment.type).toBe('document')
    expect(attachment.mimeType).toBe('application/pdf')
    expect(attachment.extractedText).toContain('<pdf filename="report.pdf">')
    expect(attachment.extractedText).toContain('<page number="1">\npage one words\n</page>')
    expect(attachment.extractedText).toContain('<page number="2">\npage two words\n</page>')
    expect(attachment.extractedText?.endsWith('\n</pdf>')).toBe(true)
    // No DOM canvas in the test environment: preview is optional, not fatal.
    expect(attachment.preview).toBeUndefined()
  })

  it('surfaces parser failures with a descriptive error', async () => {
    pdfjsMock.getDocument.mockReturnValue({ promise: Promise.reject(new Error('Invalid PDF structure')) })
    await expect(loadSurfaceAttachment(fileFromBytes(new Uint8Array([1, 2, 3]), 'broken.pdf')))
      .rejects.toThrow('Failed to process PDF: Invalid PDF structure')
  })
})

describe('loadSurfaceAttachment DOCX', () => {
  it('extracts paragraph and table structure text', async () => {
    const file = await zipFile('sample.docx', {
      'word/document.xml': '<?xml version="1.0"?><w:document><w:body>'
        + '<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world</w:t></w:r></w:p>'
        + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc>'
        + '<w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
        + '</w:body></w:document>',
    })
    const attachment = await loadSurfaceAttachment(file)

    expect(attachment.type).toBe('document')
    expect(attachment.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(attachment.extractedText).toContain('<docx filename="sample.docx">')
    expect(attachment.extractedText).toContain('Hello world')
    expect(attachment.extractedText).toContain('[Table]')
    expect(attachment.extractedText).toContain('Cell A | Cell B')
  })

  it('rejects a DOCX that is not a zip', async () => {
    const file = fileFromBytes(new TextEncoder().encode('definitely not a zip'), 'broken.docx')
    await expect(loadSurfaceAttachment(file)).rejects.toThrow(/^Failed to process DOCX: /)
  })

  it('rejects a zip without the document part', async () => {
    const file = await zipFile('missing.docx', { 'word/styles.xml': '<w:styles/>' })
    await expect(loadSurfaceAttachment(file)).rejects.toThrow('word/document.xml is missing')
  })
})

describe('loadSurfaceAttachment PPTX', () => {
  it('extracts slides in numeric order plus speaker notes', async () => {
    const file = await zipFile('deck.pptx', {
      'ppt/slides/slide10.xml': '<p:sld><a:t>Tenth</a:t></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld><a:t>Second</a:t></p:sld>',
      'ppt/slides/slide1.xml': '<p:sld><a:t>Title</a:t><a:t>Body line</a:t></p:sld>',
      'ppt/notesSlides/notesSlide1.xml': '<p:notes><a:t>Speaker note</a:t></p:notes>',
    })
    const attachment = await loadSurfaceAttachment(file)

    expect(attachment.mimeType).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation')
    expect(attachment.extractedText).toContain('<pptx filename="deck.pptx">')
    expect(attachment.extractedText).toContain('<slide number="1">\nTitle\nBody line\n</slide>')
    expect(attachment.extractedText).toContain('<slide number="2">\nSecond\n</slide>')
    expect(attachment.extractedText).toContain('<slide number="3">\nTenth\n</slide>')
    expect(attachment.extractedText).toContain('<notes>')
    expect(attachment.extractedText).toContain('[Slide 1 notes]: Speaker note')
  })

  it('rejects a PPTX that is not a zip', async () => {
    const file = fileFromBytes(new Uint8Array([1, 2, 3, 4, 5]), 'broken.pptx')
    await expect(loadSurfaceAttachment(file)).rejects.toThrow(/^Failed to process PPTX: /)
  })
})

describe('loadSurfaceAttachment XLSX/XLS', () => {
  it('extracts every sheet of an xlsx as CSV text', async () => {
    const bytes = workbookBytes('xlsx')
    const attachment = await loadSurfaceAttachment(fileFromBytes(bytes, 'report.xlsx'))

    expect(attachment.type).toBe('document')
    expect(attachment.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(attachment.extractedText).toContain('<excel filename="report.xlsx">')
    expect(attachment.extractedText).toContain('<sheet name="Fruit" index="1">')
    expect(attachment.extractedText).toContain('apple,2')
    expect(attachment.extractedText).toContain('<sheet name="Places" index="2">')
    expect(attachment.extractedText).toContain('Oslo')
    expect(attachment.content).not.toContain('base64,')
    expect(atob(attachment.content).length).toBe(bytes.byteLength)
  })

  it('extracts a legacy xls and keeps the ms-excel MIME type', async () => {
    const bytes = workbookBytes('xls')
    const attachment = await loadSurfaceAttachment(
      fileFromBytes(bytes, 'legacy.xls', 'application/vnd.ms-excel'),
    )

    expect(attachment.mimeType).toBe('application/vnd.ms-excel')
    expect(attachment.extractedText).toContain('name,qty')
    expect(attachment.extractedText).toContain('Oslo')
  })

  it('rejects a zip that carries no spreadsheet part', async () => {
    const file = await zipFile('broken.xlsx', { 'xl/junk.txt': 'hello' })
    await expect(loadSurfaceAttachment(file)).rejects.toThrow(/^Failed to process Excel: /)
  })

  it('tolerates a non-workbook payload through the SheetJS text fallback', async () => {
    const file = fileFromBytes(new TextEncoder().encode('not a workbook at all'), 'notes.xlsx')
    const attachment = await loadSurfaceAttachment(file)

    // SheetJS falls back to text parsing instead of throwing; the attachment
    // still carries usable extractedText rather than failing the batch entry.
    expect(attachment.type).toBe('document')
    expect(attachment.extractedText).toContain('not a workbook at all')
  })
})

describe('attachment limits and unsupported types', () => {
  it('rejects oversized files while keeping the rest of the batch', () => {
    const twoMb = 2 * 1024 * 1024
    const maxFileSize = 20 * 1024 * 1024
    const decision = filterFilesByLimits(
      [{ name: 'huge.pdf', size: maxFileSize + 1 }, { name: 'small.pdf', size: twoMb }],
      0,
      10,
      maxFileSize,
    )

    expect(decision.countExceeded).toBe(false)
    expect(decision.oversized.map((entry) => entry.name)).toEqual(['huge.pdf'])
    expect(decision.accepted.map((entry) => entry.name)).toEqual(['small.pdf'])
  })

  it('rejects unsupported attachment types', async () => {
    const file = fileFromBytes(new Uint8Array([1, 2, 3]), 'archive.bin', 'application/octet-stream')
    await expect(loadSurfaceAttachment(file)).rejects.toThrow('Unsupported file type: application/octet-stream')
  })
})

/** Rewrite the declared uncompressed size of a named central-directory entry. */
function patchCentralDirectoryUncompressedSize(bytes: Uint8Array, entryName: string, size: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  for (let offset = 0; offset + 46 <= bytes.byteLength; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue
    const nameLength = view.getUint16(offset + 28, true)
    if (offset + 46 + nameLength > bytes.byteLength) continue
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    if (name !== entryName) continue
    view.setUint32(offset + 24, size, true)
    return
  }
  throw new Error(`central directory entry ${entryName} not found`)
}

describe('attachment zip decompression limits', () => {
  it('rejects an entry declaring more than 50MB of uncompressed data before decompressing', async () => {
    const file = await zipFile('bomb.docx', { 'word/document.xml': '<w:document/>' })
    const bytes = new Uint8Array(await file.arrayBuffer())
    patchCentralDirectoryUncompressedSize(bytes, 'word/document.xml', 60 * 1024 * 1024)

    await expect(loadSurfaceAttachment(fileFromBytes(bytes, 'bomb.docx'))).rejects.toThrow(
      'Failed to process DOCX: Zip entry "word/document.xml" declares 62914560 uncompressed bytes, above the 52428800 byte per-entry limit',
    )
  })

  it('accumulates entry budgets and rejects archives beyond the total cap', () => {
    const fortyMb = 40 * 1024 * 1024
    expect(accumulateZipEntryBudget('ppt/slides/slide1.xml', fortyMb, 0)).toBe(fortyMb)
    expect(accumulateZipEntryBudget('ppt/slides/slide2.xml', fortyMb, fortyMb)).toBe(2 * fortyMb)
    // 40 + 40 + 40 > 100MB cumulative budget.
    expect(() => accumulateZipEntryBudget('ppt/slides/slide3.xml', fortyMb, 2 * fortyMb)).toThrow(
      'Zip contents declare more than 104857600 uncompressed bytes in total',
    )
  })
})

describe('attachment extracted-text limits', () => {
  it('truncates text beyond the 2MB limit with a trailing marker', async () => {
    const twoMb = 2 * 1024 * 1024
    const file = fileFromBytes(new TextEncoder().encode('a'.repeat(twoMb + 100)), 'big.log', 'text/plain')
    const attachment = await loadSurfaceAttachment(file)

    const marker = '\n[Truncated: extracted text exceeded the 2MB limit]'
    expect(attachment.extractedText?.length).toBe(twoMb + marker.length)
    expect(attachment.extractedText?.endsWith(marker)).toBe(true)
    expect(attachment.extractedText?.startsWith('a'.repeat(64))).toBe(true)
  })
})

describe('attachment PDF hardening', () => {
  it('caps extraction at 500 pages with a truncation note', async () => {
    mockPdf(Array.from({ length: 501 }, (_, index) => `page ${index + 1}`))
    const attachment = await loadSurfaceAttachment(fileFromBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'huge.pdf'))

    expect(attachment.extractedText).toContain('<page number="1">\npage 1\n</page>')
    expect(attachment.extractedText).toContain('<page number="500">\npage 500\n</page>')
    expect(attachment.extractedText).not.toContain('<page number="501">')
    expect(attachment.extractedText).toContain(
      '<truncated pages="501" extracted="500">Only the first 500 of 501 pages were extracted.</truncated>',
    )
  })

  it('passes isEvalSupported: false to pdfjs', async () => {
    mockPdf(['single page'])
    await loadSurfaceAttachment(fileFromBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'report.pdf'))

    expect(pdfjsMock.getDocument).toHaveBeenCalledWith(expect.objectContaining({ isEvalSupported: false }))
  })

  it('times out a parser that never completes, naming the file', async () => {
    vi.useFakeTimers()
    try {
      pdfjsMock.getDocument.mockReturnValue({
        promise: Promise.resolve({
          numPages: 1,
          getPage: () => new Promise(() => undefined),
          destroy: async () => undefined,
        }),
      })
      const pending = loadSurfaceAttachment(fileFromBytes(new Uint8Array([1]), 'hang.pdf'))
      const assertion = expect(pending).rejects.toThrow(
        'Failed to process PDF: Timed out after 30000ms while processing PDF hang.pdf',
      )
      await vi.advanceTimersByTimeAsync(30_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})
