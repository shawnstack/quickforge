import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as XLSX from 'xlsx'
import { describe, expect, it, vi } from 'vitest'

import { AttachmentPreviewErrorBoundary, AttachmentPreviewErrorFallback } from '../../src/components/chat/surface/AttachmentOverlay'
import {
  DocxAttachmentPreview,
  ExcelAttachmentPreview,
  ExcelTruncationNotices,
  PdfAttachmentPreview,
  buildExcelSheetPreviews,
  isAllowedAttachmentHref,
  isAllowedAttachmentImageSrc,
  sanitizeAttachmentImages,
  sanitizeAttachmentLinks,
  sanitizeAttachmentStyles,
} from '../../src/components/chat/surface/AttachmentPreview'

// Deterministic t stub — assertions pin the i18n keys, not the locale.
vi.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) =>
    params ? `${key} ${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')}` : key,
}))

/** Structural anchor double covering the sanitizer surface. */
class FakeAnchor {
  private readonly attributes = new Map<string, string>()

  constructor(href: string) {
    this.attributes.set('href', href)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
}

class FakeStyle {
  removed = false

  constructor(readonly textContent: string | null) {}

  remove(): void {
    this.removed = true
  }
}

class FakeImage {
  private readonly attributes = new Map<string, string>()

  constructor(src: string) {
    this.attributes.set('src', src)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }
}

describe('attachment hyperlink sanitization', () => {
  it('allows only http(s), mailto and scheme-less hrefs', () => {
    expect(isAllowedAttachmentHref('https://example.com/doc')).toBe(true)
    expect(isAllowedAttachmentHref('http://example.com')).toBe(true)
    expect(isAllowedAttachmentHref('mailto:someone@example.com')).toBe(true)
    expect(isAllowedAttachmentHref('/relative/path')).toBe(true)
    expect(isAllowedAttachmentHref('./page.html')).toBe(true)
    expect(isAllowedAttachmentHref('#anchor')).toBe(true)
    expect(isAllowedAttachmentHref('//example.com/protocol-relative')).toBe(true)
    expect(isAllowedAttachmentHref('')).toBe(true)

    expect(isAllowedAttachmentHref('javascript:alert(1)')).toBe(false)
    expect(isAllowedAttachmentHref('JAVASCRIPT:alert(1)')).toBe(false)
    expect(isAllowedAttachmentHref('jav\tascript:alert(1)')).toBe(false)
    expect(isAllowedAttachmentHref(' javascript:alert(1)')).toBe(false)
    expect(isAllowedAttachmentHref('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
    expect(isAllowedAttachmentHref('vbscript:msgbox')).toBe(false)
    expect(isAllowedAttachmentHref('blob:https://example.com/xyz')).toBe(false)
    expect(isAllowedAttachmentHref('file:///etc/passwd')).toBe(false)
  })

  it('neutralizes dangerous links to "#" and hardens every link', () => {
    const evil = new FakeAnchor('javascript:alert(1)')
    const dataUrl = new FakeAnchor('data:text/html,<script>alert(1)</script>')
    const safe = new FakeAnchor('https://example.com/page')
    const anchor = new FakeAnchor('#top')

    const count = sanitizeAttachmentLinks({ querySelectorAll: () => [evil, dataUrl, safe, anchor] })

    expect(count).toBe(4)
    expect(evil.getAttribute('href')).toBe('#')
    expect(dataUrl.getAttribute('href')).toBe('#')
    expect(safe.getAttribute('href')).toBe('https://example.com/page')
    expect(anchor.getAttribute('href')).toBe('#top')
    for (const link of [evil, dataUrl, safe, anchor]) {
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
      expect(link.getAttribute('target')).toBe('_blank')
    }
  })

  it('removes injected style elements carrying suspicious markup', () => {
    const clean = new FakeStyle('p { color: red }')
    const suspicious = new FakeStyle('p { color: red } <script>alert(1)</script>')
    const empty = new FakeStyle('')

    const removed = sanitizeAttachmentStyles({ querySelectorAll: () => [clean, suspicious, empty] })

    expect(removed).toBe(1)
    expect(clean.removed).toBe(false)
    expect(suspicious.removed).toBe(true)
    expect(empty.removed).toBe(false)
  })

  it('neutralizes unsafe image sources by dropping the src attribute', () => {
    expect(isAllowedAttachmentImageSrc('data:image/png;base64,aGk=')).toBe(true)
    expect(isAllowedAttachmentImageSrc('blob:https://example.com/xyz')).toBe(true)
    expect(isAllowedAttachmentImageSrc('https://example.com/pic.png')).toBe(true)
    expect(isAllowedAttachmentImageSrc('./media/pic.png')).toBe(true)

    const script = new FakeImage('javascript:alert(1)')
    const html = new FakeImage('data:text/html,<script>alert(1)</script>')
    const embedded = new FakeImage('data:image/jpeg;base64,aGk=')

    const count = sanitizeAttachmentImages({ querySelectorAll: () => [script, html, embedded] })

    expect(count).toBe(3)
    expect(script.getAttribute('src')).toBeNull()
    expect(html.getAttribute('src')).toBeNull()
    expect(embedded.getAttribute('src')).toBe('data:image/jpeg;base64,aGk=')
  })
})

describe('attachment preview render safety', () => {
  it('renders previews of invalid base64 payloads without decoding during render', () => {
    // Static rendering never runs effects, so a malformed payload must not
    // reach atob during render — each preview degrades to its loading state.
    const pdf = renderToStaticMarkup(createElement(PdfAttachmentPreview, { content: 'not@@valid!!base64' }))
    expect(pdf).toContain('attachmentPreviewLoading')

    const docx = renderToStaticMarkup(createElement(DocxAttachmentPreview, { content: 'not@@valid!!base64' }))
    expect(docx).toContain('quickforge-docx-scope')

    const excel = renderToStaticMarkup(createElement(ExcelAttachmentPreview, { content: 'not@@valid!!base64' }))
    expect(excel).toContain('attachmentPreviewLoading')
  })
})

describe('excel preview sampling', () => {
  it('samples columns at the 50-column cap and reports the truncation', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([Array.from({ length: 60 }, (_, index) => `col${index}`)]),
      'Wide',
    )

    const [sheet] = buildExcelSheetPreviews(XLSX, workbook)

    expect(sheet.rows[0]).toHaveLength(50)
    expect(sheet.rows[0][49]).toBe('col49')
    expect(sheet.truncatedColumns).toBe(true)
    expect(sheet.truncatedRows).toBe(false)
  })

  it('samples rows at the 5000-row cap', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(Array.from({ length: 5002 }, (_, index) => [`row${index}`])),
      'Long',
    )

    const [sheet] = buildExcelSheetPreviews(XLSX, workbook)

    expect(sheet.rows).toHaveLength(5000)
    expect(sheet.rows[4999][0]).toBe('row4999')
    expect(sheet.truncatedRows).toBe(true)
    expect(sheet.truncatedColumns).toBe(false)
  })

  it('narrows a sparse sheet with an inflated !ref before materializing rows', () => {
    const workbook = XLSX.utils.book_new()
    const sparse = XLSX.utils.aoa_to_sheet([['x']])
    sparse['!ref'] = 'A1:AZZ50000'
    XLSX.utils.book_append_sheet(workbook, sparse, 'Sparse')

    const [sheet] = buildExcelSheetPreviews(XLSX, workbook)

    expect(sheet.truncatedRows).toBe(true)
    expect(sheet.truncatedColumns).toBe(true)
    expect(sheet.rows.length).toBeLessThanOrEqual(5000)
    expect(sheet.rows[0][0]).toBe('x')
    expect(sheet.rows[0]).toHaveLength(50)
  })

  it('labels row/column truncation through i18n keys with the cap counts', () => {
    const both = renderToStaticMarkup(
      createElement(ExcelTruncationNotices, { truncatedRows: true, truncatedColumns: true }),
    )
    expect(both).toContain('attachmentExcelRowsTruncated count=5000')
    expect(both).toContain('attachmentExcelColumnsTruncated count=50')

    const neither = renderToStaticMarkup(
      createElement(ExcelTruncationNotices, { truncatedRows: false, truncatedColumns: false }),
    )
    expect(neither).toBe('')
  })
})

describe('attachment overlay error containment', () => {
  it('derives boundary state from a caught error', () => {
    expect(AttachmentPreviewErrorBoundary.getDerivedStateFromError(new Error('boom'))).toEqual({
      hasError: true,
      message: 'boom',
    })
    expect(AttachmentPreviewErrorBoundary.getDerivedStateFromError('raw failure')).toEqual({
      hasError: true,
      message: 'raw failure',
    })
  })

  it('renders children while healthy', () => {
    const markup = renderToStaticMarkup(
      createElement(AttachmentPreviewErrorBoundary, { onClose: () => undefined }, createElement('em', null, 'healthy-child')),
    )
    expect(markup).toContain('healthy-child')
  })

  it('shows an i18n error title plus a close button in the fallback', () => {
    const markup = renderToStaticMarkup(
      createElement(AttachmentPreviewErrorFallback, { message: 'boom', onClose: () => undefined }),
    )
    expect(markup).toContain('attachmentPreviewErrorTitle')
    expect(markup).toContain('boom')
    expect(markup).toContain('>close</button>')
  })
})
