import { describe, expect, it } from 'vitest'
import { browserPreviewReuseKey, browserTabFilePath, findBrowserTabToReuse, panelTabFilePath } from '../../src/components/workspace/workspace-tab-file-path'
import type { WorkspacePanelTab } from '../../src/components/workspace/workspace-inspector-tabs'

describe('browserTabFilePath', () => {
  it.each([
    ['D:\\workspace\\report.html', 'D:\\workspace\\report.html'],
    ['D:/workspace/preview.png', 'D:/workspace/preview.png'],
    ['/Users/me/workspace/report.html', '/Users/me/workspace/report.html'],
    ['file:///D:/workspace/report.html', '/D:/workspace/report.html'],
  ])('recognizes local file path %s', (value, expected) => {
    expect(browserTabFilePath(value)).toBe(expected)
  })

  it.each([
    'https://example.com/report.html',
    'http://localhost:3000',
    'about:blank',
    '/api/workspace/preview/project/report.html',
    '',
  ])('does not treat %s as a local artifact path', (value) => {
    expect(browserTabFilePath(value)).toBeUndefined()
  })
})

describe('panelTabFilePath', () => {
  it('returns the active Reader file path', () => {
    const tab: WorkspacePanelTab = {
      id: 'reader-1',
      kind: 'reader',
      activeReaderTabId: 'file:src/App.tsx',
      readerTabs: [
        { id: 'file:src/other.ts', mode: 'file', path: 'src/other.ts', loading: false },
        { id: 'file:src/App.tsx', mode: 'file', path: 'src/App.tsx', loading: false },
      ],
    }
    expect(panelTabFilePath(tab)).toBe('src/App.tsx')
  })

  it('returns a local Browser artifact path', () => {
    expect(panelTabFilePath({ id: 'browser-1', kind: 'browser', url: 'D:\\workspace\\preview.png' })).toBe('D:\\workspace\\preview.png')
  })

  it('keeps ordinary Browser tabs on the Globe icon', () => {
    expect(panelTabFilePath({ id: 'browser-1', kind: 'browser', url: 'https://example.com' })).toBeUndefined()
  })
})

describe('browserPreviewReuseKey', () => {
  it('maps local file paths to a normalized file key', () => {
    expect(browserPreviewReuseKey('D:\\workspace\\report.html')).toBe('file:D:/workspace/report.html')
    expect(browserPreviewReuseKey('D:/workspace/report.html')).toBe('file:D:/workspace/report.html')
    expect(browserPreviewReuseKey('/Users/me/workspace/report.html')).toBe('file:/Users/me/workspace/report.html')
    expect(browserPreviewReuseKey('file:///D:/workspace/report.html')).toBe('file:/D:/workspace/report.html')
  })

  it('keeps web URLs on an exact url key', () => {
    expect(browserPreviewReuseKey('https://example.com/report.html')).toBe('url:https://example.com/report.html')
    expect(browserPreviewReuseKey('http://localhost:3000')).toBe('url:http://localhost:3000')
  })

  it('returns undefined for empty input', () => {
    expect(browserPreviewReuseKey('')).toBeUndefined()
    expect(browserPreviewReuseKey('   ')).toBeUndefined()
    expect(browserPreviewReuseKey(undefined)).toBeUndefined()
  })
})

describe('findBrowserTabToReuse', () => {
  const tabs: WorkspacePanelTab[] = [
    { id: 'browser-1', kind: 'browser', url: 'D:\\workspace\\report.html' },
    { id: 'browser-2', kind: 'browser', url: 'https://example.com' },
    { id: 'reader-3', kind: 'reader', readerTabs: [{ id: 'file:src/a.ts', mode: 'file', path: 'src/a.ts', loading: false }], activeReaderTabId: 'file:src/a.ts' },
  ]

  it('reuses a browser tab opened for the same local file', () => {
    expect(findBrowserTabToReuse(tabs, 'D:\\workspace\\report.html')?.id).toBe('browser-1')
  })

  it('reuses across Windows path separator variants', () => {
    expect(findBrowserTabToReuse(tabs, 'D:/workspace/report.html')?.id).toBe('browser-1')
  })

  it('does not reuse for a different file', () => {
    expect(findBrowserTabToReuse(tabs, 'D:\\workspace\\other.html')).toBeUndefined()
  })

  it('reuses the same web URL exactly', () => {
    expect(findBrowserTabToReuse(tabs, 'https://example.com')?.id).toBe('browser-2')
  })

  it('does not reuse a web URL for a local file', () => {
    expect(findBrowserTabToReuse(tabs, 'https://example.com/report.html')).toBeUndefined()
  })

  it('does not merge across kinds even when the path matches', () => {
    expect(findBrowserTabToReuse(tabs, 'src/a.ts')).toBeUndefined()
  })

  it('returns undefined for an empty url', () => {
    expect(findBrowserTabToReuse(tabs, '')).toBeUndefined()
  })
})
