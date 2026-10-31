// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownBlock } from '../../src/components/chat/surface/Markdown'
import { splitStableMarkdown } from '../../src/components/chat/surface/markdown-stream-chunks'

function render(content: string, finalized: boolean): string {
  return renderToStaticMarkup(createElement(MarkdownBlock, { content, finalized }))
}

const paragraph = (index: number) => `第 ${index} 段：${'这是一段足够长的正文，用来让流式切分真正生效，并验证分块渲染与整段渲染逐字一致。'.repeat(4)}`

describe('splitStableMarkdown', () => {
  it('splits plain paragraphs at blank lines', () => {
    const content = `${paragraph(1)}\n\n${paragraph(2)}\n\n${paragraph(3)}\n\n尾`
    const chunks = splitStableMarkdown(content)
    expect(chunks).not.toBeNull()
    expect(chunks!.blocks.length).toBeGreaterThan(0)
    expect(chunks!.blocks.join('') + chunks!.tail).toBe(content)
  })

  it('never splits inside an unclosed fence', () => {
    const content = `${paragraph(1)}\n\n${paragraph(2)}\n\n${paragraph(3)}\n\n\`\`\`ts\nconst a = 1\n\nconst b = 2\n`
    const chunks = splitStableMarkdown(content)
    // 只能切在围栏之前：尾块必须包含未闭合的围栏。
    expect(chunks).not.toBeNull()
    expect(chunks!.tail.startsWith('```ts')).toBe(true)
    expect(chunks!.blocks.join('')).not.toContain('const a = 1')
  })

  it('does not split a loose list across a blank line', () => {
    const content = `${paragraph(1)}\n\n- 第一项\n\n- 第二项\n\n- 第三项\n`
    const chunks = splitStableMarkdown(content)
    // 列表项之间的空行不是安全边界：切开会让它变成三个独立列表。
    if (chunks) expect(chunks!.tail.startsWith('- ')).toBe(true)
  })

  it('does not freeze a prefix with an unbalanced display-math delimiter', () => {
    const content = `${paragraph(1)}\n\n\\[\nx = y\n\n+ z\n\\]\n\n${paragraph(2)}\n`
    const chunks = splitStableMarkdown(content)
    if (chunks) expect(chunks!.blocks.join('')).not.toContain('\\[')
  })

  it('ignores HTML start lines inside a closed fence when freezing the prefix', () => {
    const content = `${paragraph(1)}\n\n\`\`\`tsx\n<div className="x">\n  {value}\n</div>\n\`\`\`\n\n${paragraph(2)}\n\n${paragraph(3)}\n`
    const chunks = splitStableMarkdown(content)
    // 围栏内的 `<div>` 是代码字面量，不是 HTML 块；不得因此退回整段解析。
    expect(chunks).not.toBeNull()
    expect(chunks!.blocks.join('') + chunks!.tail).toBe(content)
    expect(chunks!.blocks.join('')).toContain('<div className="x">')
  })

  it('ignores unbalanced math delimiters inside a closed fence', () => {
    const content = `${paragraph(1)}\n\n\`\`\`md\n\\[\nliteral delimiter\n\`\`\`\n\n${paragraph(2)}\n\n${paragraph(3)}\n`
    expect(splitStableMarkdown(content)).not.toBeNull()
  })

  it('still refuses to freeze a prefix with an HTML block outside fences', () => {
    const content = `${paragraph(1)}\n\n<div>\nraw\n\n${paragraph(2)}\n\n${paragraph(3)}\n`
    const chunks = splitStableMarkdown(content)
    if (chunks) expect(chunks!.blocks.join('')).not.toContain('<div>')
  })

  it('returns null for short content', () => {
    expect(splitStableMarkdown('短内容\n\n也很短')).toBeNull()
  })
})

describe('streaming markdown chunk rendering', () => {
  const cases: Array<[string, string]> = [
    ['plain paragraphs', `${paragraph(1)}\n\n${paragraph(2)}\n\n${paragraph(3)}\n\n${paragraph(4)}\n`],
    ['closed fence', `${paragraph(1)}\n\n\`\`\`ts\nconst a = 1\nconst b = 2\n\`\`\`\n\n${paragraph(2)}\n\n${paragraph(3)}\n`],
    ['jsx fence', `${paragraph(1)}\n\n\`\`\`tsx\n<div className="x">\n  {value}\n</div>\n\`\`\`\n\n${paragraph(2)}\n\n${paragraph(3)}\n`],
    ['headings and list', `${paragraph(1)}\n\n## 标题\n\n${paragraph(2)}\n\n- 甲\n- 乙\n\n${paragraph(3)}\n`],
    ['unclosed fence tail', `${paragraph(1)}\n\n${paragraph(2)}\n\n\`\`\`ts\nconst a = 1\n`],
    ['table', `${paragraph(1)}\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n${paragraph(2)}\n`],
  ]

  it.each(cases)('renders the streaming split identically to the whole document (%s)', (_name, content) => {
    // 流式路径（分块冻结）与定稿路径（整段解析）必须逐字一致。
    // 唯一的差异是 React SSR 在相邻块级元素之间插入的换行分隔符：块级元素之间
    // 的空白不影响布局，归一化后比较。
    const normalize = (html: string) => html.replace(/>\n</g, '><')
    expect(normalize(render(content, false))).toBe(normalize(render(content, true)))
  })

  it('actually splits the long streaming content (not a no-op pass-through)', () => {
    // 等价性测试不能因为「切分从未发生」而恒真。
    expect(splitStableMarkdown(cases[0][1])).not.toBeNull()
    expect(splitStableMarkdown(cases[1][1])).not.toBeNull()
    expect(splitStableMarkdown(cases[2][1])).not.toBeNull()
  })
})
