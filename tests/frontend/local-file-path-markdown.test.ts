// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MarkdownBlock } from '../../src/components/chat/surface/Markdown'
import { LocalFilePathHandlerContext } from '../../src/components/chat/surface/surface-context'

/**
 * The rehype plugin that turns local paths into `<qf-file-path>` elements must
 * not re-enter its own output: the element's child text is the same path, so a
 * naive "walk every element again" pass would keep splitting it. The contract
 * is "one element per path, no nesting".
 */
describe('local file path markdown integration', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(content: string, onOpen: ((path: string) => void) | null = () => {}) {
    act(() => {
      root.render(createElement(LocalFilePathHandlerContext.Provider, { value: onOpen },
        createElement(MarkdownBlock, { content })))
    })
  }

  it('renders one link per path without nesting or infinite recursion', () => {
    render('see src/App.tsx and D:\\repo\\index.css now')

    const links = Array.from(container.querySelectorAll('.quickforge-file-path-link'))
    expect(links).toHaveLength(2)
    expect(links.map((link) => link.dataset.quickforgeFilePath)).toEqual(['src/App.tsx', 'D:\\repo\\index.css'])
    // No link nested inside another: the plugin must not re-split its output.
    expect(container.querySelector('.quickforge-file-path-link .quickforge-file-path-link')).toBeNull()
    expect(container.textContent).toBe('see App.tsx and index.css now')
  })

  it('leaves inline code and fenced code untouched', () => {
    render('use `src/App.tsx` or:\n\n```\nD:\\repo\\index.css\n```\n')

    expect(container.querySelectorAll('.quickforge-file-path-link')).toHaveLength(0)
  })

  it('keeps link text literal inside an anchor', () => {
    render('[src/App.tsx](https://example.com)')

    expect(container.querySelectorAll('.quickforge-file-path-link')).toHaveLength(0)
    expect(container.querySelector('a')!.textContent).toBe('src/App.tsx')
  })

  it('renders plain text when the surface has no opener', () => {
    render('see src/App.tsx', null)

    expect(container.querySelectorAll('.quickforge-file-path-link')).toHaveLength(0)
    expect(container.textContent).toBe('see src/App.tsx')
  })
})
