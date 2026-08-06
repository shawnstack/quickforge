import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/components/workspace/MermaidDiagram', () => ({
  MermaidDiagram: ({ source }: { source: string }) => createElement('pre', null, source),
}))

vi.mock('../../src/components/workspace/MonacoCodeViewer', () => ({
  MonacoCodeViewer: () => null,
}))

import { MarkdownReader } from '../../src/components/workspace/MarkdownReader'

describe('MarkdownReader', () => {
  it('renders Markdown image syntax with a workspace-relative source', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownReader, {
      projectId: 'project 1',
      path: 'docs/guide.md',
      content: '![数据流水线](docs_flow.svg)',
      language: 'markdown',
      mode: 'preview',
    }))

    expect(markup).toContain('<img')
    expect(markup).toContain('alt="数据流水线"')
    expect(markup).toContain('src="/api/workspace/preview/project%201/docs/docs_flow.svg"')
  })

  it('does not render raw HTML from workspace Markdown', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownReader, {
      projectId: 'project',
      path: 'README.md',
      content: '<script>alert(1)</script>',
      language: 'markdown',
      mode: 'preview',
    }))

    expect(markup).not.toContain('<script>')
  })
})
