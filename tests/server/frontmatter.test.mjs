import { describe, expect, it } from 'vitest'
import { parseFrontmatter, parseSimpleYamlMap } from '../../server/frontmatter.mjs'

// frontmatter.mjs 此前没有任何直接测试（零覆盖盘点里出现过）。第一条用例钉的是仓库自带
// 插件 SKILL.md 的真实写法：metadata.tags 用短横线列表。解析器不认 seq，读出来是空串——
// 技能面板里那三个插件技能的标签/触发词因此一直是空的。
describe('frontmatter YAML sequences', () => {
  it('parses a nested dash list into an array (shipped plugin SKILL.md shape)', () => {
    const text = [
      '---',
      'name: documents',
      'metadata:',
      '  displayName: Documents',
      '  version: 0.1.0',
      '  tags:',
      '    - documents',
      '    - writing',
      '---',
      '',
      'Body text.',
    ].join('\n')

    const { metadata, body } = parseFrontmatter(text)
    expect(metadata.metadata).toMatchObject({ displayName: 'Documents', version: '0.1.0' })
    expect(metadata.metadata.tags).toEqual(['documents', 'writing'])
    expect(body).toBe('Body text.')
  })

  it('parses a dash list whose items sit at the key indent', () => {
    const map = parseSimpleYamlMap('tags:\n- alpha\n- beta\nname: x')
    expect(map.tags).toEqual(['alpha', 'beta'])
    expect(map.name).toBe('x')
  })

  it('parses an indented dash list with inline comments stripped', () => {
    const map = parseSimpleYamlMap('tags:\n  - alpha # first\n  - beta\n')
    expect(map.tags).toEqual(['alpha', 'beta'])
  })

  it('keeps literal and folded block scalars unchanged', () => {
    const map = parseSimpleYamlMap('lit: |\n  a\n  b\nfold: >\n  c\n  d\n')
    expect(map.lit).toBe('a\nb')
    expect(map.fold).toBe('c d')
  })

  it('leaves a nested map without a list as a map', () => {
    const map = parseSimpleYamlMap('metadata:\n  displayName: X\n  version: 1\n')
    expect(map.metadata).toEqual({ displayName: 'X', version: '1' })
  })
})

// YAML 允许块标量头带 chomping（`-` / `+`）和缩进指示符（`1`~`9`）。只认裸 `|` / `>` 时，
// `description: |-` 会被当成字面量 "-"，真正的多行正文随后被当成「缩进过深、不属于任何键」逐行丢掉：
// 值变成 "|-"，正文一个字都不剩，而且没有任何错误标记。`|-` 是 Jekyll/Hexo/多数技能文档的默认写法。
describe('frontmatter block scalars with indicators', () => {
  it('parses a literal block scalar that carries a chomping indicator', () => {
    const map = parseSimpleYamlMap('description: |-\n  line one\n  line two\ntitle: x')
    expect(map.description).toBe('line one\nline two')
    expect(map.title).toBe('x')
  })

  it('parses a folded block scalar that carries a chomping indicator', () => {
    const map = parseSimpleYamlMap('summary: >-\n  c\n  d\n')
    expect(map.summary).toBe('c d')
  })

  it('parses an indentation indicator without leaking the header', () => {
    const map = parseSimpleYamlMap('description: |2-\n  indented body\n')
    expect(map.description).toBe('indented body')
  })

  it('keeps a plain "-" value that is not a block header', () => {
    const map = parseSimpleYamlMap('dash: -\nplus: +\n')
    expect(map.dash).toBe('-')
    expect(map.plus).toBe('+')
  })
})
