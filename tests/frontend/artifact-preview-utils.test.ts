import { describe, expect, it } from 'vitest'
import { artifactPreviewMode, inferArtifactKind, isBrowserPreviewablePath, isPreviewablePath } from '../../src/components/workspace/artifact-preview-utils'

describe('artifact preview classification', () => {
  it.each([
    ['README.md', 'markdown'],
    ['guide.mdx', 'markdown'],
    ['guide.markdown', 'markdown'],
    ['src/App.tsx', 'code'],
    ['report.csv', 'code'],
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
    ['archive.bin', undefined],
  ] as const)('opens %s using %s', (path, mode) => {
    expect(artifactPreviewMode(path)).toBe(mode)
    expect(isPreviewablePath(path)).toBe(mode !== undefined)
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
  ])('keeps %s in the Reader or unsupported flow', (path) => {
    expect(isBrowserPreviewablePath(path)).toBe(false)
  })
})
