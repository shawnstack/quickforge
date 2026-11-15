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
