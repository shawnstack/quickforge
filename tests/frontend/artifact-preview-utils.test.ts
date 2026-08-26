import { describe, expect, it } from 'vitest'
import { artifactPreviewMode, documentFormatFromPath, inferArtifactKind, isBrowserPreviewablePath, isDocumentPreviewablePath, isPreviewablePath } from '../../src/components/workspace/artifact-preview-utils'

describe('artifact preview classification', () => {
  it.each([
    ['README.md', 'markdown'],
    ['guide.mdx', 'markdown'],
    ['guide.markdown', 'markdown'],
    ['src/App.tsx', 'code'],
    ['report.csv', 'code'],
    ['handbook.pdf', 'pdf'],
    ['proposal.docx', 'docx'],
    ['legacy.xls', 'excel'],
    ['budget.xlsx', 'excel'],
    ['proposal.doc', 'unknown'],
    ['slides.pptx', 'unknown'],
    ['macro.xlsm', 'unknown'],
    ['query.sql', 'code'],
    ['app.log', 'code'],
    ['Dockerfile', 'code'],
    ['build/Makefile', 'code'],
    ['archive.bin', 'unknown'],
    ['image.bmp', 'unknown'],
  ] as const)('classifies %s as %s', (path, kind) => {
    expect(inferArtifactKind(path)).toBe(kind)
  })

  it.each([
    ['index.html', 'browser'],
    ['diagram.svg', 'browser'],
    ['README.md', 'reader'],
    ['src/App.tsx', 'reader'],
    ['report.csv', 'reader'],
    ['handbook.pdf', 'document'],
    ['proposal.docx', 'document'],
    ['legacy.xls', 'document'],
    ['budget.xlsx', 'document'],
    ['proposal.doc', undefined],
    ['slides.pptx', undefined],
    ['macro.xlsm', undefined],
    ['archive.bin', undefined],
  ] as const)('opens %s using %s', (path, mode) => {
    expect(artifactPreviewMode(path)).toBe(mode)
    expect(isPreviewablePath(path)).toBe(mode !== undefined)
  })
})

describe('document preview classification', () => {
  it.each([
    ['handbook.pdf', 'pdf'],
    ['proposal.docx', 'docx'],
    ['legacy.xls', 'excel'],
    ['budget.xlsx', 'excel'],
  ] as const)('maps %s to %s', (path, format) => {
    expect(documentFormatFromPath(path)).toBe(format)
    expect(isDocumentPreviewablePath(path)).toBe(true)
  })

  it.each(['proposal.doc', 'slides.ppt', 'slides.pptx', 'macro.xlsm'])('rejects unsupported office path %s', (path) => {
    expect(documentFormatFromPath(path)).toBeUndefined()
    expect(isDocumentPreviewablePath(path)).toBe(false)
  })
})

describe('isBrowserPreviewablePath', () => {
  it.each([
    'index.html',
    'index.htm',
    'diagram.svg',
    'preview.png',
    'photo.jpeg',
    'image.webp',
    'animated.gif',
    'favicon.ico',
  ])('allows Browser preview for %s', (path) => {
    expect(isBrowserPreviewablePath(path)).toBe(true)
  })

  it.each([
    'README.md',
    'src/App.tsx',
    'notes.txt',
    'image.bmp',
    'Dockerfile',
    'handbook.pdf',
    'proposal.docx',
    'budget.xlsx',
  ])('keeps %s outside Browser preview', (path) => {
    expect(isBrowserPreviewablePath(path)).toBe(false)
  })
})
