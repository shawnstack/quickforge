import { describe, expect, it } from 'vitest'
import { browserTabFilePath, panelTabFilePath } from '../../src/components/workspace/workspace-tab-file-path'
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
