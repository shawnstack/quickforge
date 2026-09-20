import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { applyAppLanguageFromSnapshot } from '../../src/lib/i18n'
import { renderCodeBlock } from '../../src/lib/tool-renderers/shared'

// T7 评审回归：工具卡 renderCodeBlock 与聊天 CodeBlock.tsx 共用同一套
// code-highlight 高亮与复制按钮语义；此文件只断言静态标记（交互态见
// tool-renderer-shared-state.test.ts）。
beforeEach(() => applyAppLanguageFromSnapshot('en'))

function markup(code: string, language?: string) {
  return renderToStaticMarkup(renderCodeBlock(code, language))
}

/** Inner markup of the rendered `<code>` element. */
function codeInnerMarkup(html: string) {
  return html.match(/<code[^>]*>([\s\S]*)<\/code>/)?.[1] ?? ''
}

/** Markup → visible text (tags stripped, React entity escapes decoded). */
function visibleCodeText(html: string) {
  return codeInnerMarkup(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

describe('tool renderer renderCodeBlock', () => {
  it('highlights known languages with the shared qf-hl token classes', () => {
    const html = markup('const total = 42 // answer', 'typescript')

    expect(html).toContain('<code class="language-typescript">')
    expect(html).toContain('<span class="qf-hl-keyword">const</span>')
    expect(html).toContain('<span class="qf-hl-number">42</span>')
    expect(html).toContain('<span class="qf-hl-comment">// answer</span>')
  })

  it('keeps the code text verbatim (selection/copy target)', () => {
    const source = 'if (x < 2) { return "a&b" }'
    const html = markup(source, 'javascript')

    expect(visibleCodeText(html)).toBe(source)
    expect(codeInnerMarkup(html)).toContain('qf-hl-string')
    expect(codeInnerMarkup(html)).toContain('&quot;a&amp;b&quot;')
  })

  it('renders unknown and default languages without highlight spans', () => {
    expect(markup('val x = 1', 'kotlin')).not.toContain('qf-hl-')
    expect(markup('plain output')).toContain('<code class="language-text">plain output</code>')
  })

  it('keeps the tool-card frame and the copy button only (no run button / preview menu)', () => {
    const html = markup('echo "hi"', 'bash')

    expect(html).toContain('qf-code-block')
    expect(html).toContain('data-qf-action="copy-code"')
    expect(html).toContain('title="Copy"')
    // 工具卡旧版即无终端运行按钮与 SVG/Mermaid 预览菜单。
    expect(html).not.toContain('data-qf-action="execute-markdown-command"')
    expect(html).not.toContain('quickforge-svg-code-menu')
    expect(html).not.toContain('quickforge-svg-code-preview')
    // 与聊天 CodeBlock 一致：高亮 span 出现在 pre>code 内。
    expect(html).toContain('<span class="qf-hl-builtin">echo</span>')
    expect(html).toContain('<span class="qf-hl-string">&quot;hi&quot;</span>')
  })
})
