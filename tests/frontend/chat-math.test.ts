import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { KatexOptions } from 'katex'

import { KatexMath } from '../../src/components/chat/surface/KatexMath'
import { MarkdownBlock } from '../../src/components/chat/surface/Markdown'

// Deterministic t stub — assertions pin the i18n keys, not the locale.
vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}))

// katex passthrough with an injectable failure mode, so the KatexMath catch
// branch can be exercised without breaking real rendering elsewhere.
const katexStub = vi.hoisted(() => ({ fail: false }))
vi.mock('katex', async (importOriginal) => {
  const actual = await importOriginal<typeof import('katex')>()
  const real = actual.default
  return {
    default: {
      renderToString: (expression: string, options?: KatexOptions) => {
        if (katexStub.fail) throw new Error('katex stub failure')
        return real.renderToString(expression, options)
      },
    },
  }
})

function renderMarkdown(content: string) {
  return renderToStaticMarkup(createElement(MarkdownBlock, { content }))
}

/**
 * 旧 `<markdown-block>` 渲染器的数学公式对齐护栏（迁移前基线：pi-web-ui
 * 的 marked 数学扩展，四种定界符 `$…$` / `$$…$$` / `\(…\)` / `\[…\]`）。
 * 断言以实际渲染输出为准。
 */
describe('chat math parity with the legacy markdown-block renderer', () => {
  it('renders inline dollar math with KaTeX', () => {
    const markup = renderMarkdown('value $x^2$ here')

    expect(markup).toContain('class="katex"')
    expect(markup).not.toContain('katex-display')
    // 行内公式仍留在段落里。
    expect(markup).toContain('<p>')
  })

  it('renders a lone double-dollar paragraph as display math in a my-4 container', () => {
    const markup = renderMarkdown('$$\\int_0^1 x\\,dx$$')

    expect(markup).toContain('katex-display')
    expect(markup).toContain('class="my-4"')
    // 块级公式不嵌在 <p> 内（div 不进 p）。
    expect(markup).not.toContain('<p><div')
  })

  it('renders backslash-paren inline and backslash-bracket display math via placeholder tokens', () => {
    const inline = renderMarkdown('mass \\(E=mc^2\\) energy')
    expect(inline).toContain('class="katex"')
    expect(inline).not.toContain('katex-display')
    expect(inline).not.toContain('\\(')

    const display = renderMarkdown('前文\n\n\\[E=mc^2\\]\n\n后文')
    expect(display).toContain('katex-display')
    expect(display).toContain('class="my-4"')
    expect(display).not.toContain('<p><div')
  })

  it('renders mid-line double-dollar as display math between paragraphs', () => {
    const markup = renderMarkdown('a $$E=mc^2$$ b')

    expect(markup).toContain('katex-display')
    expect(markup).toContain('class="my-4"')
    // 旧 marked 块级扩展的 start:indexOf('$$') 在行中 $$ 处截断段落，公式成为
    // 段落之间的块级兄弟节点，而不是嵌在 <p> 里的 div。
    expect(markup).toContain('<p>a </p>')
    expect(markup).toContain('<p> b</p>')
    expect(markup).not.toContain('<p>a <div')
  })

  it('keeps an unclosed mid-line double-dollar literal', () => {
    const markup = renderMarkdown('a $$x b')

    expect(markup).not.toContain('katex')
    expect(markup).toContain('$$x b')
  })

  it('does not treat double-dollar as display math when the content holds a dollar', () => {
    const markup = renderMarkdown('a $$a$b$$ c')

    // 旧 tokenizer 的内容约束是 [^$]+?：内容含 $ 时块级公式不成立。
    expect(markup).not.toContain('katex-display')
  })

  it('does not render math inside fenced, indented or inline code', () => {
    const markup = renderMarkdown('```\n$x$ and \\(x\\)\n```\n\n    $x$ indented\n\ninline `$x$` and `\\(x\\)` stay code')

    expect(markup).not.toContain('katex')
    expect(markup).toContain('$x$')
    expect(markup).toContain('\\(x\\)')
  })

  it('keeps currency-like dollar text literal', () => {
    const markup = renderMarkdown('价格 $5 和 $6 之间')

    expect(markup).not.toContain('katex')
    expect(markup).toContain('$5')
    expect(markup).toContain('$6')
  })

  it('falls back visibly when KaTeX cannot parse the latex', () => {
    // throwOnError:false → KaTeX 对解析失败输出 katex-error（红色源码），
    // 组件不崩（实测 0.16：未知命令为内联红字、语法错误为 katex-error）。
    const markup = renderMarkdown('$x^$')

    expect(markup).toContain('katex-error')
    expect(markup).toContain('katex')
  })

  it('shows the raw latex fallback when renderToString throws', () => {
    katexStub.fail = true
    try {
      const markup = renderToStaticMarkup(createElement(KatexMath, { latex: 'x^2' }))

      expect(markup).toContain('text-red-500')
      expect(markup).toContain('font-mono')
      expect(markup).toContain('x^2')
      expect(markup).not.toContain('katex')
    } finally {
      katexStub.fail = false
    }
  })
})
