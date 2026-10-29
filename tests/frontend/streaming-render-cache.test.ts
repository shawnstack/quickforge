import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clearMarkdownElementCache, MarkdownBlock } from '../../src/components/chat/surface/Markdown'
import { clearPreprocessedMathCache, preprocessLatexDelimiters } from '../../src/lib/chat-math'
import { highlightCode } from '../../src/lib/code-highlight'

const markdownRenderCalls = vi.hoisted(() => [] as unknown[])
vi.mock('react-markdown', async (importOriginal) => {
  const actual = await importOriginal<{ default: (options: unknown) => unknown }>()
  const real = actual.default
  return {
    default: (options: unknown) => {
      markdownRenderCalls.push(options)
      return real(options)
    },
  }
})

function renderBlock(content: string, finalized: boolean) {
  return renderToStaticMarkup(createElement(MarkdownBlock, { content, finalized }))
}

beforeEach(() => {
  markdownRenderCalls.length = 0
  clearMarkdownElementCache()
  clearPreprocessedMathCache()
})

describe('streaming render cache policy', () => {
  it('never caches in-flight markdown content', () => {
    renderBlock('first frame', false)
    renderBlock('second frame', false)
    renderBlock('first frame', false)

    expect(markdownRenderCalls).toHaveLength(3)
  })

  it('caches the finalized body once', () => {
    renderBlock('final body $x^2$', true)
    renderBlock('final body $x^2$', true)

    expect(markdownRenderCalls).toHaveLength(1)
  })

  it('bypasses the math preprocess cache for in-flight content', () => {
    expect(preprocessLatexDelimiters('value $a$', false)).not.toBe(preprocessLatexDelimiters('value $a$', false))
    const finalized = preprocessLatexDelimiters('value $b$')
    expect(preprocessLatexDelimiters('value $b$')).toBe(finalized)
  })

  it('bypasses the highlight cache for in-flight code', () => {
    expect(highlightCode('const a = 1', 'ts', { cache: false })).not.toBe(
      highlightCode('const a = 1', 'ts', { cache: false }),
    )
    const finalized = highlightCode('const b = 2', 'ts')
    expect(highlightCode('const b = 2', 'ts')).toBe(finalized)
  })
})
