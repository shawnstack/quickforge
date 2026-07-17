import { describe, expect, it } from 'vitest'
import { isBrowserPreviewablePath } from '../../src/components/workspace/artifact-preview-utils'

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
