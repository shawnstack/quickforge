import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { MarkdownBlock } from '../../src/components/chat/surface/Markdown'

// Deterministic t stub — assertions pin the i18n keys, not the locale.
vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}))

function renderMarkdown(content: string) {
  return renderToStaticMarkup(createElement(MarkdownBlock, { content }))
}

/**
 * 旧 `<markdown-block>` 渲染器的对齐护栏（迁移前基线：`pi-web-ui-*.js` 的
 * markdown 渲染器）——超链接无条件 `target="_blank" rel="noopener noreferrer"`，
 * 表格外包 `overflow-x-auto my-2 border border-border rounded` 滚动容器。
 */
describe('markdown link parity with the legacy markdown-block renderer', () => {
  it('opens every link in a new tab with the legacy rel pair', () => {
    const markup = renderMarkdown('[docs](https://example.com/docs) and [local](/workspace/notes.md)')
    const anchors = markup.match(/<a[^>]*>/g) ?? []

    expect(anchors).toHaveLength(2)
    for (const anchor of anchors) {
      expect(anchor).toContain('target="_blank"')
      expect(anchor).toContain('rel="noopener noreferrer"')
    }
  })

  it('keeps anchors without href in the legacy shape', () => {
    const markup = renderMarkdown('[](#anchor)')
    const anchor = markup.match(/<a[^>]*>/)?.[0] ?? ''

    expect(anchor).toContain('target="_blank"')
    expect(anchor).toContain('rel="noopener noreferrer"')
  })
})

describe('markdown table parity with the legacy markdown-block renderer', () => {
  it('wraps the table in the legacy scroll container', () => {
    const markup = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')

    expect(markup).toContain('<div class="overflow-x-auto my-2 border border-border rounded"><table>')
    expect(markup).toContain('</tbody></table></div>')
  })

  it('keeps the wrapper around every table in a message', () => {
    const markup = renderMarkdown('| a |\n| --- |\n| 1 |\n\n| b |\n| --- |\n| 2 |')

    expect(markup.match(/<div class="overflow-x-auto my-2 border border-border rounded">/g)).toHaveLength(2)
  })
})
