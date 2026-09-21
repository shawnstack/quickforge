import { describe, expect, it } from 'vitest'

import {
  HIGHLIGHT_LANGUAGES,
  HIGHLIGHT_TOKEN_CLASSES,
  MAX_HIGHLIGHT_LENGTH,
  highlightCode,
  type CodeHighlightSegment,
} from '../../src/lib/code-highlight'

/** Non-plain segments of a highlighted block. */
function colored(code: string, language: string): CodeHighlightSegment[] {
  return highlightCode(code, language).filter((segment) => segment.token !== 'plain')
}

/** Asserts the token stream reassembles into the exact source text. */
function expectRoundTrip(code: string, language: string) {
  const joined = highlightCode(code, language).map((segment) => segment.text).join('')
  expect(joined).toBe(code)
}

/** Asserts a specific segment exists verbatim. */
function expectSegment(code: string, language: string, text: string, token: string) {
  const segments = highlightCode(code, language)
  expect(segments).toContainEqual({ text, token })
}

describe('code-highlight language coverage', () => {
  it('covers the common fenced languages used by the project and agent output', () => {
    for (const language of [
      'js', 'jsx', 'javascript', 'ts', 'tsx', 'typescript', 'json', 'bash', 'sh', 'shell',
      'python', 'css', 'scss', 'html', 'xml', 'svg', 'sql', 'java', 'c', 'cpp', 'go', 'rust',
      'yaml', 'yml', 'markdown', 'md', 'diff',
      // 补齐的高频缺失语言（旧版 hljs 能着色、自研 tokenizer 曾整块退化为纯文本）。
      'toml', 'ini', 'dockerfile', 'makefile', 'powershell', 'ps1', 'gql', 'protobuf',
      'proto', 'nginx', 'apache', 'httpd',
    ]) {
      expect(HIGHLIGHT_LANGUAGES).toContain(language)
    }
    expect(Object.keys(HIGHLIGHT_LANGUAGES).length).toBeGreaterThan(10)
  })

  it('maps every token to a qf-hl-* CSS class', () => {
    expect(Object.keys(HIGHLIGHT_TOKEN_CLASSES).sort()).toEqual([
      'addition', 'attr', 'builtin', 'code', 'comment', 'deletion', 'emphasis', 'function', 'heading', 'keyword',
      'link', 'list', 'number', 'plain', 'property', 'punct', 'quote', 'string', 'strong', 'tag',
    ])
    for (const [token, className] of Object.entries(HIGHLIGHT_TOKEN_CLASSES)) {
      expect(className).toBe(`qf-hl-${token}`)
    }
  })

  it('keeps the legacy highlight.js class names for the re-added semantics', () => {
    // 逐条对应旧 `.hljs-*` 规则里被移除后丢失的语义（详见
    // docs/reviews/parity-audit-parts/fix-w3-highlight.zh-CN.md）。
    expect(HIGHLIGHT_TOKEN_CLASSES.heading).toBe('qf-hl-heading')   // ← .hljs-section
    expect(HIGHLIGHT_TOKEN_CLASSES.list).toBe('qf-hl-list')         // ← .hljs-bullet
    expect(HIGHLIGHT_TOKEN_CLASSES.code).toBe('qf-hl-code')         // ← .hljs-code
    expect(HIGHLIGHT_TOKEN_CLASSES.quote).toBe('qf-hl-quote')       // ← .hljs-quote
    expect(HIGHLIGHT_TOKEN_CLASSES.link).toBe('qf-hl-link')         // ← .hljs-link（旧无规则）
    expect(HIGHLIGHT_TOKEN_CLASSES.strong).toBe('qf-hl-strong')     // ← .hljs-strong
    expect(HIGHLIGHT_TOKEN_CLASSES.emphasis).toBe('qf-hl-emphasis') // ← .hljs-emphasis
  })
})

describe('code-highlight javascript/typescript', () => {
  const tsSource = [
    '// note',
    'const total: number = compute(42, "x");',
    'const tpl = `multi',
    'line`;',
    '/* block */ let re = /a+b/g;',
  ].join('\n')

  it('tokenizes comments, keywords, numbers, functions and strings', () => {
    expectSegment(tsSource, 'ts', '// note', 'comment')
    expectSegment(tsSource, 'ts', '/* block */', 'comment')
    expectSegment(tsSource, 'ts', 'const', 'keyword')
    expectSegment(tsSource, 'ts', 'number', 'keyword')
    expectSegment(tsSource, 'ts', 'compute', 'function')
    expectSegment(tsSource, 'ts', '42', 'number')
    expectSegment(tsSource, 'ts', '"x"', 'string')
    expectSegment(tsSource, 'ts', '/a+b/g', 'string')
  })

  it('keeps multi-line template literals as one string segment', () => {
    expectSegment(tsSource, 'ts', '`multi\nline`', 'string')
  })

  it('round-trips the exact source text', () => {
    expectRoundTrip(tsSource, 'ts')
    expectRoundTrip(tsSource, 'typescript')
  })

  it('treats division as punctuation when an identifier precedes the slash', () => {
    const segments = colored('const half = width / 2', 'javascript')
    expect(segments).toContainEqual({ text: '/', token: 'punct' })
    expect(segments).not.toContainEqual({ text: '/ 2', token: 'string' })
  })

  it('highlights JSX tags, attributes and interpolations', () => {
    const jsx = [
      'export function App() {',
      '  return (',
      '    <div className="box" onClick={handle}>',
      '      {items.map((x) => <li key={x}>{x}</li>)}',
      '    </div>',
      '  )',
      '}',
    ].join('\n')
    expectSegment(jsx, 'tsx', 'export', 'keyword')
    expectSegment(jsx, 'tsx', 'App', 'function')
    expectSegment(jsx, 'tsx', 'div', 'tag')
    expectSegment(jsx, 'tsx', 'li', 'tag')
    expectSegment(jsx, 'tsx', '</', 'punct')
    expectSegment(jsx, 'tsx', 'className', 'attr')
    expectSegment(jsx, 'tsx', 'onClick', 'attr')
    expectSegment(jsx, 'tsx', '"box"', 'string')
    expectSegment(jsx, 'tsx', 'handle', 'plain')
    expectRoundTrip(jsx, 'tsx')
  })

  it('does not treat spaced comparisons as JSX tags', () => {
    const segments = colored('for (let i = 0; i < n; i++) step()', 'ts')
    expect(segments).toContainEqual({ text: '<', token: 'punct' })
    expect(segments).not.toContainEqual({ text: 'n', token: 'tag' })
  })
})

describe('code-highlight json', () => {
  const source = [
    '{',
    '  "name": "quickforge",',
    '  "count": 3,',
    '  "active": true,',
    '  "missing": null',
    '}',
  ].join('\n')

  it('colors keys as properties and values by type', () => {
    expectSegment(source, 'json', '"name"', 'property')
    expectSegment(source, 'json', '"quickforge"', 'string')
    expectSegment(source, 'json', '3', 'number')
    // 旧 hljs JSON：`keywords:{ literal: ['true','false','null'] }` → `.hljs-literal`
    // 与 `.hljs-number` 同在 `--syntax-constant` 规则 → 复用 `number` token。
    expectSegment(source, 'json', 'true', 'number')
    expectSegment(source, 'json', 'null', 'number')
    expectSegment(source, 'json', '{', 'punct')
    expectRoundTrip(source, 'json')
  })

  it('keeps escaped quotes inside strings', () => {
    expectSegment('{"msg": "say \\"hi\\""}', 'json', '"say \\"hi\\""', 'string')
  })
})

describe('code-highlight bash', () => {
  const source = [
    '#!/usr/bin/env bash',
    '# install deps',
    'set -e',
    'NODE_ENV=production npm install --no-audit',
    'echo "done: $USER"',
    'if [ -f lock ]; then',
    '  rm -rf node_modules | grep -v pnpm || true',
    'fi',
  ].join('\n')

  it('tokenizes shebang, comments, keywords, assignments and flags', () => {
    expectSegment(source, 'bash', '#!/usr/bin/env bash', 'comment')
    expectSegment(source, 'bash', '# install deps', 'comment')
    expectSegment(source, 'sh', 'set', 'builtin')
    expectSegment(source, 'sh', '-e', 'attr')
    expectSegment(source, 'shell', 'NODE_ENV', 'property')
    expectSegment(source, 'shell', 'npm', 'function')
    expectSegment(source, 'shell', '--no-audit', 'attr')
    expectSegment(source, 'bash', '"done: $USER"', 'string')
    expectSegment(source, 'bash', 'if', 'keyword')
    expectSegment(source, 'bash', 'then', 'keyword')
    expectSegment(source, 'bash', 'fi', 'keyword')
    expectRoundTrip(source, 'bash')
  })

  it('highlights variables and command substitutions as builtins', () => {
    expectSegment('echo ${HOME}/x $USER', 'bash', '${HOME}', 'builtin')
    expectSegment('echo $USER', 'bash', '$USER', 'builtin')
    expectSegment('out=$(date)', 'bash', '$(date)', 'builtin')
    expectSegment('echo `date`', 'bash', '`date`', 'builtin')
  })
})

describe('code-highlight python', () => {
  const source = [
    '# comment',
    'import os',
    '',
    '@dataclass',
    'class Point:',
    '    """Doc',
    '    string"""',
    '    x: int = 0',
    '',
    '    def move(self, dx: float) -> str:',
    '        return f"moved {dx}"',
  ].join('\n')

  it('tokenizes comments, decorators, triple strings and f-strings', () => {
    expectSegment(source, 'python', '# comment', 'comment')
    expectSegment(source, 'python', 'import', 'keyword')
    expectSegment(source, 'python', 'class', 'keyword')
    expectSegment(source, 'python', 'def', 'keyword')
    expectSegment(source, 'python', 'return', 'keyword')
    expectSegment(source, 'python', '@dataclass', 'builtin')
    expectSegment(source, 'python', '"""Doc\n    string"""', 'string')
    expectSegment(source, 'python', 'f"moved {dx}"', 'string')
    expectSegment(source, 'python', 'int', 'builtin')
    expectSegment(source, 'python', 'self', 'builtin')
    expectSegment(source, 'python', 'move', 'function')
    expectSegment(source, 'python', '0', 'number')
    expectRoundTrip(source, 'python')
  })
})

describe('code-highlight css', () => {
  const source = [
    '/* theme */',
    '.card {',
    '  color: var(--foreground);',
    '  border-radius: 8px;',
    '}',
    '@media (min-width: 600px) { .card { padding: 1rem } }',
  ].join('\n')

  it('tokenizes comments, selectors, properties and values', () => {
    expectSegment(source, 'css', '/* theme */', 'comment')
    // 旧 `.hljs-selector-class` 与 `.hljs-attr` 同在 `--syntax-constant` 规则
    // （@3520）→ 复用 `attr` token（fix-w10 收敛，详见 fix-w10-buckets 分片）。
    expectSegment(source, 'css', '.card', 'attr')
    expectSegment(source, 'css', 'color', 'property')
    expectSegment(source, 'css', 'border-radius', 'property')
    // 旧 CSS `FUNCTION_DISPATCH = { className: 'built_in', begin: /[\w-]+(?=\()/ }`
    // → `--syntax-variable` 橙（`.hljs-built_in` 规则 @3780）。
    expectSegment(source, 'css', 'var', 'builtin')
    expectSegment(source, 'css', '8px', 'number')
    expectSegment(source, 'css', '@media', 'keyword')
    expectSegment(source, 'css', 'min-width', 'property')
    expectSegment(source, 'css', '600px', 'number')
    expectSegment(source, 'css', '1rem', 'number')
    expectRoundTrip(source, 'css')
  })

  it('keeps selector-class / selector-id and custom properties in the legacy constant bucket', () => {
    // 旧 hljs CSS：`{className:'selector-id',begin:/#[A-Za-z0-9_-]+/}`、
    // `{className:'selector-class',begin:'\\.[a-zA-Z-][a-zA-Z0-9_-]*'}` 与
    // `.hljs-attr` 共享 `--syntax-constant` 规则（@3520）→ 两点都用 `attr`。
    expectSegment('.card { color: red }', 'css', '.card', 'attr')
    expectSegment('#app { color: red }', 'css', '#app', 'attr')
    expect(colored('.card { color: red }', 'css')).not.toContainEqual({ text: '.card', token: 'function' })
    expect(colored('#app { color: red }', 'css')).not.toContainEqual({ text: '#app', token: 'builtin' })
    // SCSS 嵌套规则（声明块内的 `.child`）走另一条映射分支，桶必须一致。
    expectSegment('.parent { .child { color: red } }', 'css', '.child', 'attr')
    // 旧 `CSS_VARIABLE`（className 'attr'）在顶层匹配：声明名 `--x:` 是 constant 桶。
    expectSegment('#app { --brand: red }', 'css', '--brand', 'property')
    // 声明值里的 `var(--foreground)`：旧语法在该上下文没有 CSS_VARIABLE 规则，
    // `--foreground` 与正文同色（plain）——锁定不回退。
    expectSegment('a { color: var(--foreground) }', 'css', '--foreground', 'plain')
  })

  it('colors CSS function dispatch as built_in, not function', () => {
    // 旧 `FUNCTION_DISPATCH`（@2324636）对声明值里所有 `name(` 生效：
    // `var(` / `rgb(` / `url(` 都是 `.hljs-built_in`（`--syntax-variable` 橙）。
    expectSegment('a { color: var(--foreground) }', 'css', 'var', 'builtin')
    expectSegment('a { color: rgb(0 0 0) }', 'css', 'rgb', 'builtin')
    expect(colored('a { color: var(--foreground) }', 'css')).not.toContainEqual({ text: 'var', token: 'function' })
  })

  it('colors hex colors and pseudo selectors', () => {
    // 旧 `.hljs-selector-pseudo` 与 `.hljs-selector-tag` 同属 `--syntax-tag`
    // 桶，伪类因此复用 `tag` token；`.x` 是 selector-class，属 `--syntax-constant`
    // 桶（复用 `attr`，fix-w10 起与 `.hljs-attr` 同色）。相邻同色段会被 sink
    // 合并，故用 `.x:hover` 而不是 `a:hover` 来隔离伪类段。
    expectSegment('.x:hover { color: #ff8800 }', 'css', ':hover', 'tag')
    expectSegment('.x:hover { color: #ff8800 }', 'css', '.x', 'attr')
    expectSegment('a { color: #ff8800 }', 'css', 'a', 'tag')
    expectSegment('a:hover { color: #ff8800 }', 'css', '#ff8800', 'number')
  })
})

describe('code-highlight html/xml/svg', () => {
  const source = [
    '<!doctype html>',
    '<!-- hero -->',
    '<div class="hero" data-id=3>',
    '  <br/>',
    '  text &amp; more',
    '</div>',
  ].join('\n')

  it('tokenizes doctype, comments, tags, attributes and values', () => {
    expectSegment(source, 'html', '<!doctype html>', 'keyword')
    expectSegment(source, 'html', '<!-- hero -->', 'comment')
    expectSegment(source, 'html', 'div', 'tag')
    expectSegment(source, 'html', 'br', 'tag')
    expectSegment(source, 'html', '</', 'punct')
    expectSegment(source, 'html', 'class', 'attr')
    expectSegment(source, 'html', 'data-id', 'attr')
    expectSegment(source, 'html', '"hero"', 'string')
    expectSegment(source, 'html', '3', 'string')
    expectRoundTrip(source, 'html')
    expectRoundTrip(source, 'svg')
  })

  it('highlights svg sources like markup', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4"/></svg>'
    expectSegment(svg, 'svg', 'svg', 'tag')
    expectSegment(svg, 'svg', 'rect', 'tag')
    expectSegment(svg, 'svg', 'width', 'attr')
    expectRoundTrip(svg, 'svg')
  })
})

describe('code-highlight sql', () => {
  const source = [
    '-- top rows',
    'SELECT u.name, COUNT(*) AS total',
    'FROM users u',
    "WHERE u.age >= 21 AND u.name LIKE 'O''Brien';",
  ].join('\n')

  it('tokenizes keywords case-insensitively, strings with escaped quotes', () => {
    expectSegment(source, 'sql', '-- top rows', 'comment')
    expectSegment(source, 'sql', 'SELECT', 'keyword')
    expectSegment(source, 'sql', 'FROM', 'keyword')
    expectSegment(source, 'sql', 'WHERE', 'keyword')
    expectSegment(source, 'sql', 'AND', 'keyword')
    expectSegment(source, 'sql', 'COUNT', 'function')
    expectSegment(source, 'sql', "'O''Brien'", 'string')
    expectSegment(source, 'sql', '21', 'number')
    expectRoundTrip(source, 'sql')
  })
})

describe('code-highlight yaml', () => {
  const source = [
    '# config',
    'name: quickforge',
    'count: 3',
    'nested:',
    '  - key: value',
    'enabled: true',
  ].join('\n')

  it('tokenizes comments, keys, scalars and list markers', () => {
    expectSegment(source, 'yaml', '# config', 'comment')
    expectSegment(source, 'yaml', 'name', 'property')
    expectSegment(source, 'yaml', 'count', 'property')
    expectSegment(source, 'yaml', 'nested', 'property')
    expectSegment(source, 'yaml', 'key', 'property')
    expectSegment(source, 'yaml', '3', 'number')
    // 旧 hljs YAML：`{ beginKeywords: 'true false yes no null', keywords: { literal: … } }`
    // → `.hljs-literal` 与 `.hljs-number` 同在 `--syntax-constant` 规则 → 复用 `number`。
    expectSegment(source, 'yaml', 'true', 'number')
    expectSegment(source, 'yaml', '-', 'list')
    expectRoundTrip(source, 'yaml')
    expectRoundTrip(source, 'yml')
  })

  it('colors the legacy YAML literal words in the constant bucket', () => {
    for (const word of ['true', 'false', 'yes', 'no', 'null']) {
      expectSegment(`enabled: ${word}`, 'yaml', word, 'number')
    }
    // 旧字号表之外、且当前实现仍画成 keyword 的 `on`/`off`/`~`：旧语法走的是
    // 裸标量 `string` 规则（属未登记的差异，见 fix-w10 分片【剩余不确定】），
    // 这里锁定它们不被顺手改桶。
    for (const word of ['on', 'off', '~']) {
      expectSegment(`enabled: ${word}`, 'yaml', word, 'keyword')
    }
    expect(colored('enabled: true', 'yaml')).not.toContainEqual({ text: 'true', token: 'keyword' })
  })
})

describe('code-highlight go / rust / java / c / cpp', () => {
  it('go: comments, keywords, builtins, raw strings', () => {
    const source = [
      '// greet',
      'package main',
      'import "fmt"',
      'func greet(name string) string {',
      '\treturn fmt.Sprintf("hi %s", name)',
      '}',
    ].join('\n')
    expectSegment(source, 'go', '// greet', 'comment')
    expectSegment(source, 'go', 'package', 'keyword')
    expectSegment(source, 'go', 'greet', 'function')
    expectSegment(source, 'go', 'string', 'builtin')
    expectSegment(source, 'go', 'Sprintf', 'function')
    expectSegment(source, 'go', '"hi %s"', 'string')
    expectRoundTrip(source, 'go')
  })

  it('rust: lifetimes, char literals, numeric suffixes', () => {
    const source = [
      'fn main() {',
      '    let n: u32 = 42;',
      '    let s = String::from("it\'s");',
      '    let ch = \'x\';',
      '    println!("{n}");',
      '}',
      'fn size<\'a>(x: &\'a str) -> usize { 0 }',
    ].join('\n')
    expectSegment(source, 'rust', 'fn', 'keyword')
    expectSegment(source, 'rust', 'let', 'keyword')
    expectSegment(source, 'rust', 'u32', 'builtin')
    expectSegment(source, 'rust', '42', 'number')
    expectSegment(source, 'rust', '"it\'s"', 'string')
    expectSegment(source, 'rust', "'x'", 'string')
    expectSegment(source, 'rust', "'a", 'builtin')
    expectRoundTrip(source, 'rust')
  })

  it('java: annotations, keywords, builtins', () => {
    const source = [
      '// entry',
      'public class Main {',
      '    @Override',
      '    public String toString() {',
      '        return "Main";',
      '    }',
      '}',
    ].join('\n')
    expectSegment(source, 'java', '// entry', 'comment')
    expectSegment(source, 'java', 'public', 'keyword')
    expectSegment(source, 'java', '@Override', 'builtin')
    expectSegment(source, 'java', 'String', 'builtin')
    expectSegment(source, 'java', 'toString', 'function')
    expectRoundTrip(source, 'java')
  })

  it('c: preprocessor directives and calls', () => {
    const source = [
      '#include <stdio.h>',
      '/* main */',
      'int main(void) {',
      '    printf("hi\\n");',
      '    return 0;',
      '}',
    ].join('\n')
    expectSegment(source, 'c', '#include', 'keyword')
    expectSegment(source, 'c', '/* main */', 'comment')
    expectSegment(source, 'c', 'int', 'keyword')
    expectSegment(source, 'c', 'main', 'function')
    expectSegment(source, 'c', 'printf', 'builtin')
    expectSegment(source, 'c', '"hi\\n"', 'string')
    expectRoundTrip(source, 'c')
    expectRoundTrip(source, 'cpp')
  })
})

describe('code-highlight markdown / diff', () => {
  it('markdown: headings, inline code, links, list markers', () => {
    const source = [
      '# Title',
      '',
      'Some `code` and [link](https://x.dev).',
      '',
      '- item',
      '> quote',
    ].join('\n')
    // 旧 highlight.js `Markdown` 语法逐条对照：`section`(粗体) / `code`(行内代码) /
    // `string`(链接文字) / `bullet`(列表符) / `quote`(引用符)；链接目标旧语法是
    // `link`，调色板里没有 `.hljs-link` 规则，故与正文同色。
    expectSegment(source, 'markdown', '# Title', 'heading')
    expectSegment(source, 'markdown', '`code`', 'code')
    expectSegment(source, 'markdown', 'link', 'string')
    expectSegment(source, 'markdown', 'https://x.dev', 'link')
    expectSegment(source, 'markdown', '-', 'list')
    expectSegment(source, 'markdown', '>', 'quote')
    expectRoundTrip(source, 'md')
  })

  it('markdown: emphasis / strong keep the legacy glyph-only effects', () => {
    const source = 'plain **bold** and *italic* with _under_ and __double__ ends'

    // 旧 `.hljs-strong` 只声明 font-weight:700、`.hljs-emphasis` 只声明
    // font-style:italic（颜色变量 `--color-text-primary` 在旧产物里不存在，
    // 声明无效→继承正文字色），因此这里只断言字形语义，不断言颜色 token。
    expectSegment(source, 'markdown', '**bold**', 'strong')
    expectSegment(source, 'markdown', '*italic*', 'emphasis')
    expectSegment(source, 'markdown', '_under_', 'emphasis')
    expectSegment(source, 'markdown', '__double__', 'strong')
    expectRoundTrip(source, 'markdown')
  })

  it('markdown: four-space indented lines are the legacy code block variant', () => {
    const source = ['    const x = 1', '    # not a heading', '  # also not', '> quoted'].join('\n')

    // 行首四空格/制表符 = 旧 `.hljs-code` 缩进代码块变体；缩进本身是空白，
    // 仍按 plain 输出（视觉与旧版一致）。旧 `^#{1,6}` / `^>\s+` 锚定在原始行首，
    // 所以缩进后的 `#` 既不是标题也不是代码（1-3 空格）／是代码（4 空格）。
    expect(highlightCode(source, 'markdown').filter((segment) => segment.token !== 'plain')).toEqual([
      { text: 'const x = 1', token: 'code' },
      { text: '# not a heading', token: 'code' },
      { text: '>', token: 'quote' },
    ])
    expectRoundTrip(source, 'markdown')
  })

  it('markdown: the block rules still win over the indented-code variant', () => {
    const source = ['    - item', '  - indented item'].join('\n')

    // 旧 `bullet` 允许前导空白（`^[ \t]*([*+-]|\d+\.)(?=\s+)`）且在 `code` 之前。
    expect(highlightCode(source, 'markdown').filter((segment) => segment.token === 'list').length).toBe(2)
    expectRoundTrip(source, 'markdown')
  })

  it('markdown: Setext headings (title + underline) open the legacy section span', () => {
    // 旧 hljs `section` 变体 2 = 零宽 lookahead `(?=^.+?\n[=-]{2,}$)`（@2340703）。
    // 没有 `end` 的模式在编译期被补成 `end = /\B|\b/`，核心在标题行起点开启
    // section span、在下划线行之后关闭，所以标题行与下划线行都落在同一个
    // `.hljs-section`（颜色 + 粗体）里。
    const source = ['Title', '=====', 'body', 'Sub', '---', 'tail'].join('\n')
    expect(colored(source, 'markdown')).toEqual([
      { text: 'Title', token: 'heading' },
      { text: '=====', token: 'heading' },
      { text: 'Sub', token: 'heading' },
      { text: '---', token: 'heading' },
    ])
    expectRoundTrip(source, 'md')
    // 旧 lookahead 的 `.+?` 允许标题行前导空白：缩进行的 Setext 标题同样成立。
    expect(colored('    code\n===\nx', 'markdown')).toEqual([
      { text: 'code', token: 'heading' },
      { text: '===', token: 'heading' },
    ])
    // 旧 lookahead 要求标题行非空、下划线行整行都是 `=`/`-`（≥2 个字符、无尾随
    // 空格），这些输入都不成立（保持既有 plain/其它规则行为）。
    expect(highlightCode('Title\n-', 'markdown')).not.toContainEqual({ text: 'Title', token: 'heading' })
    expect(highlightCode('Title\n=== ', 'markdown')).not.toContainEqual({ text: 'Title', token: 'heading' })
    expect(highlightCode('\n===\nx', 'markdown')).not.toContainEqual({ text: '===', token: 'heading' })
    expectRoundTrip('Title\n-', 'markdown')
    expectRoundTrip('Title\n=== ', 'markdown')
  })

  it('diff: added/removed/hunk lines', () => {
    const source = ['@@ -1,2 +1,3 @@', ' context', '-removed', '+added'].join('\n')
    // 旧 highlight.js Diff 语法：hunk 头是 meta（沿用 --syntax-constant 色，
    // 即 `--qf-hl-number`），整行加减分别是 addition / deletion。
    expectSegment(source, 'diff', '@@ -1,2 +1,3 @@', 'number')
    expectSegment(source, 'diff', '-removed', 'deletion')
    expectSegment(source, 'diff', '+added', 'addition')
    expectRoundTrip(source, 'patch')
  })

  it('diff: legacy meta → comment → addition → deletion rule order', () => {
    const source = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 3e10f58..b1c2d3e 100644',
      'Index: src/legacy.ts',
      '=== modified file',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '--- 1,2 ----',
      '*** 1,2 ****',
      '***************',
      '@@ -1,2 +1,3 @@',
      ' context',
      '-removed',
      '+added',
      '!replacement',
      'not a marker',
    ].join('\n')
    expectSegment(source, 'diff', 'diff --git a/src/a.ts b/src/a.ts', 'comment')
    expectSegment(source, 'diff', 'index 3e10f58..b1c2d3e 100644', 'comment')
    expectSegment(source, 'diff', 'Index: src/legacy.ts', 'comment')
    expectSegment(source, 'diff', '=== modified file', 'comment')
    // `---` / `+++` 文件头是注释，只有带范围数字的 `--- 1,2 ----` 才是 meta。
    expectSegment(source, 'diff', '--- a/src/a.ts', 'comment')
    expectSegment(source, 'diff', '+++ b/src/a.ts', 'comment')
    expectSegment(source, 'diff', '--- 1,2 ----', 'number')
    expectSegment(source, 'diff', '*** 1,2 ****', 'number')
    expectSegment(source, 'diff', '***************', 'comment')
    expectSegment(source, 'diff', '-removed', 'deletion')
    expectSegment(source, 'diff', '+added', 'addition')
    expectSegment(source, 'diff', '!replacement', 'addition')
    // 注释规则含未锚定的 `Index: ` / `===`：整行判定与旧语法一致。
    expect(colored(source, 'diff').map((segment) => `${segment.token}:${segment.text}`)).toEqual([
      'comment:diff --git a/src/a.ts b/src/a.ts',
      'comment:index 3e10f58..b1c2d3e 100644',
      'comment:Index: src/legacy.ts',
      'comment:=== modified file',
      'comment:--- a/src/a.ts',
      'comment:+++ b/src/a.ts',
      'number:--- 1,2 ----',
      'number:*** 1,2 ****',
      'comment:***************',
      'number:@@ -1,2 +1,3 @@',
      'deletion:-removed',
      'addition:+added',
      'addition:!replacement',
    ])
    expectRoundTrip(source, 'patch')
  })

  it('diff: keeps the legacy comment-from-match-point behaviour', () => {
    // 旧语法里这些 begin 未锚定：匹配点之前的文本仍是普通文本。
    expectSegment('head ==== tail', 'diff', '==== tail', 'comment')
    expectSegment('head ==== tail', 'diff', 'head ', 'plain')
    expectSegment('see Index: src/a.ts', 'diff', 'Index: src/a.ts', 'comment')
    // `-{1,2}` 与 4 个星号都不触发注释规则，按增删/普通文本处理。
    expectSegment('-', 'diff', '-', 'deletion')
    expectSegment('--', 'diff', '--', 'deletion')
    expectSegment('****', 'diff', '****', 'plain')
  })
})

describe('code-highlight toml / ini', () => {
  const toml = [
    '# server config',
    '[server]',
    'host = "0.0.0.0"',
    'port = 8080',
    'enabled = true',
    'tags = ["a", "b"]',
    'created = 1979-05-27T07:32:00Z',
  ].join('\n')

  it('toml: comments, tables, keys, values and datetimes', () => {
    expectSegment(toml, 'toml', '# server config', 'comment')
    expectSegment(toml, 'toml', 'server', 'builtin')
    expectSegment(toml, 'toml', 'host', 'property')
    expectSegment(toml, 'toml', '"0.0.0.0"', 'string')
    expectSegment(toml, 'toml', 'port', 'property')
    expectSegment(toml, 'toml', '8080', 'number')
    expectSegment(toml, 'toml', 'enabled', 'property')
    // 旧产物里 toml/ini 是同一个 `TOML, also INI` 语法（`registerLanguage('ini',…)`
    // + alias `toml`），字面量规则 `{className:'literal',…}` → `--syntax-constant`。
    expectSegment(toml, 'toml', 'true', 'number')
    expectSegment(toml, 'toml', 'tags', 'property')
    expectSegment(toml, 'toml', '"a"', 'string')
    expectSegment(toml, 'toml', '1979-05-27T07:32:00Z', 'number')
    expectRoundTrip(toml, 'toml')
  })

  it('toml: multiline strings and array-of-tables headers', () => {
    const source = ['[[steps]]', 'name = "build"', 'run = """', 'npm ci', 'npm run build"""'].join('\n')
    expectSegment(source, 'toml', 'steps', 'builtin')
    expectSegment(source, 'toml', 'name', 'property')
    expectSegment(source, 'toml', 'run', 'property')
    expectSegment(source, 'toml', '"""\nnpm ci\nnpm run build"""', 'string')
    expectRoundTrip(source, 'toml')
  })

  it('ini: semicolon comments, sections, `=`/`:` separators', () => {
    const ini = [
      '; legacy config',
      '[paths]',
      'root=/srv/app',
      'name = "demo"',
      'enabled: true',
      'retries : 3',
    ].join('\n')
    expectSegment(ini, 'ini', '; legacy config', 'comment')
    expectSegment(ini, 'ini', 'paths', 'builtin')
    expectSegment(ini, 'ini', 'root', 'property')
    expectSegment(ini, 'ini', 'name', 'property')
    expectSegment(ini, 'ini', '"demo"', 'string')
    expectSegment(ini, 'ini', 'enabled', 'property')
    expectSegment(ini, 'ini', 'true', 'number')
    expectSegment(ini, 'ini', 'retries', 'property')
    expectSegment(ini, 'ini', '3', 'number')
    expectRoundTrip(ini, 'ini')
  })

  it('toml/ini: literal words use the legacy constant bucket', () => {
    // 旧 `TOML, also INI` 语法的字面量集合是 `\bon|off|true|false|yes|no\b`
    // （@2481459）：两者都属 `.hljs-literal` → `--syntax-constant`，复用 `number`。
    expectSegment('enabled = true', 'toml', 'true', 'number')
    expectSegment('enabled = true', 'ini', 'true', 'number')
    for (const word of ['yes', 'no', 'on', 'off']) {
      expectSegment(`flag = ${word}`, 'ini', word, 'number')
    }
    expect(colored('enabled = true', 'ini')).not.toContainEqual({ text: 'true', token: 'keyword' })
  })
})

describe('code-highlight dockerfile', () => {
  const source = [
    '# build stage',
    'FROM node:20-alpine AS build',
    'WORKDIR /app',
    'COPY package.json ./',
    'RUN npm ci --no-audit',
    'ENV NODE_ENV=production',
    'CMD ["node", "server.js"]',
  ].join('\n')

  it('tokenizes comments, instructions, flags and JSON-ish arguments', () => {
    expectSegment(source, 'dockerfile', '# build stage', 'comment')
    expectSegment(source, 'dockerfile', 'FROM', 'keyword')
    expectSegment(source, 'dockerfile', 'AS', 'keyword')
    expectSegment(source, 'dockerfile', 'WORKDIR', 'keyword')
    expectSegment(source, 'dockerfile', 'RUN', 'keyword')
    expectSegment(source, 'dockerfile', '--no-audit', 'attr')
    expectSegment(source, 'dockerfile', '20', 'number')
    expectSegment(source, 'dockerfile', '"server.js"', 'string')
    expectRoundTrip(source, 'dockerfile')
    expectRoundTrip(source, 'docker')
  })

  it('keeps `#` inside an argument out of the comment rule', () => {
    const buildArgs = 'RUN npm ci --tag="#not-a-comment"'
    expectSegment(buildArgs, 'dockerfile', '"#not-a-comment"', 'string')
    expect(colored(buildArgs, 'dockerfile').every((segment) => segment.token !== 'comment')).toBe(true)
    expectRoundTrip(buildArgs, 'dockerfile')
  })
})

describe('code-highlight makefile', () => {
  const source = [
    '# build targets',
    'BIN := app',
    '.PHONY: all clean',
    'all: main.o',
    '\tnpm run build',
    'clean:',
    '\trm -f $(BIN)',
    'ifeq ($(CI),true)',
    'endif',
  ].join('\n')

  it('tokenizes comments, variables, assignments, targets and recipe commands', () => {
    expectSegment(source, 'makefile', '# build targets', 'comment')
    expectSegment(source, 'makefile', 'BIN', 'property')
    expectSegment(source, 'makefile', '.PHONY', 'function')
    expectSegment(source, 'makefile', 'all', 'function')
    expectSegment(source, 'makefile', 'clean', 'function')
    expectSegment(source, 'makefile', 'npm', 'function')
    expectSegment(source, 'makefile', '-f', 'attr')
    expectSegment(source, 'makefile', '$(BIN)', 'builtin')
    expectSegment(source, 'makefile', 'ifeq', 'keyword')
    expectSegment(source, 'makefile', 'endif', 'keyword')
    expectRoundTrip(source, 'makefile')
  })
})

describe('code-highlight powershell', () => {
  const source = [
    '# cleanup temp files',
    "$ErrorActionPreference = 'Stop'",
    'Get-ChildItem -Path C:\\Temp -Recurse | Where-Object { $_.Length -gt 1024 }',
    "if ($env:CI -eq 'true') { Write-Host \"done\" }",
  ].join('\n')

  it('tokenizes comments, variables, cmdlets, parameters and operators', () => {
    expectSegment(source, 'powershell', '# cleanup temp files', 'comment')
    expectSegment(source, 'powershell', '$ErrorActionPreference', 'builtin')
    expectSegment(source, 'powershell', "'Stop'", 'string')
    expectSegment(source, 'powershell', 'Get-ChildItem', 'function')
    expectSegment(source, 'powershell', '-Path', 'attr')
    expectSegment(source, 'powershell', '$env:CI', 'builtin')
    expectSegment(source, 'powershell', '-eq', 'keyword')
    expectSegment(source, 'powershell', '-gt', 'keyword')
    expectSegment(source, 'powershell', '1024', 'number')
    expectSegment(source, 'powershell', 'Write-Host', 'function')
    expectSegment(source, 'powershell', '"done"', 'string')
    expectRoundTrip(source, 'powershell')
    expectRoundTrip(source, 'ps1')
  })
})

describe('code-highlight graphql', () => {
  const source = [
    '# fetch one user',
    'query User($id: ID!) {',
    '  user(id: $id) {',
    '    name',
    '    posts(first: 3) { title }',
    '  }',
    '}',
  ].join('\n')

  it('tokenizes comments, keywords, variables, fields and types', () => {
    expectSegment(source, 'graphql', '# fetch one user', 'comment')
    expectSegment(source, 'graphql', 'query', 'keyword')
    expectSegment(source, 'graphql', 'User', 'function')
    expectSegment(source, 'graphql', '$id', 'builtin')
    expectSegment(source, 'graphql', 'ID', 'builtin')
    expectSegment(source, 'graphql', 'id', 'property')
    expectSegment(source, 'graphql', 'first', 'property')
    expectSegment(source, 'graphql', '3', 'number')
    expectRoundTrip(source, 'graphql')
    expectRoundTrip(source, 'gql')
  })
})

describe('code-highlight protobuf', () => {
  const source = [
    '// user message',
    'syntax = "proto3";',
    'package demo;',
    'message User {',
    '  int64 id = 1;',
    '  repeated string tags = 3;',
    '}',
  ].join('\n')

  it('tokenizes comments, keywords, scalar types and numbers', () => {
    expectSegment(source, 'protobuf', '// user message', 'comment')
    expectSegment(source, 'protobuf', 'syntax', 'keyword')
    expectSegment(source, 'protobuf', '"proto3"', 'string')
    expectSegment(source, 'protobuf', 'message', 'keyword')
    expectSegment(source, 'protobuf', 'int64', 'builtin')
    expectSegment(source, 'protobuf', 'repeated', 'keyword')
    expectSegment(source, 'protobuf', '1', 'number')
    expectRoundTrip(source, 'protobuf')
    expectRoundTrip(source, 'proto')
  })
})

describe('code-highlight nginx / apache configs', () => {
  it('nginx: contexts, directives, numbers, strings and variables', () => {
    const source = [
      '# reverse proxy',
      'server {',
      '  listen 8080;',
      '  server_name example.com;',
      '  location /api/ {',
      '    proxy_set_header Host $host;',
      '  }',
      '}',
    ].join('\n')
    expectSegment(source, 'nginx', '# reverse proxy', 'comment')
    expectSegment(source, 'nginx', 'server', 'keyword')
    expectSegment(source, 'nginx', 'listen', 'keyword')
    expectSegment(source, 'nginx', '8080', 'number')
    expectSegment(source, 'nginx', 'server_name', 'keyword')
    expectSegment(source, 'nginx', 'location', 'keyword')
    expectSegment(source, 'nginx', 'proxy_set_header', 'keyword')
    expectSegment(source, 'nginx', '$host', 'builtin')
    expectRoundTrip(source, 'nginx')
  })

  it('apache: directives, `<Section>` tags, arguments and numbers', () => {
    const source = [
      '# site config',
      'Listen 8080',
      '<Directory /var/www>',
      '  Require all granted',
      '  Header set X-Frame-Options DENY',
      '</Directory>',
    ].join('\n')
    expectSegment(source, 'apache', '# site config', 'comment')
    expectSegment(source, 'apache', 'Listen', 'keyword')
    expectSegment(source, 'apache', '8080', 'number')
    expectSegment(source, 'apache', 'Directory', 'tag')
    expectSegment(source, 'apache', '/var/www', 'attr')
    expectSegment(source, 'apache', 'Require', 'keyword')
    expectSegment(source, 'apache', 'Header', 'keyword')
    expectRoundTrip(source, 'apache')
    expectRoundTrip(source, 'apacheconf')
    expectRoundTrip(source, 'httpd')
  })
})

describe('code-highlight unknown-language fallback', () => {
  /*
   * 旧版 `<code-block>` 对 hljs 未注册的语言走 `hljs.highlightAuto(code)`（自动识别并
   * 着色）；自研实现不猜测语言，改用一套保守的通用规则近似：注释、字符串、数字与常见
   * 跨语言关键字。这些断言锁定“未知语言名不再整块纯文本”这一相对旧版的差距收窄。
   */

  it('colors comments, strings, numbers and common keywords for unknown names', () => {
    const source = [
      '// deploy profile',
      'name = "demo"',
      'retries = 3',
      'if enabled then start()',
    ].join('\n')

    expectSegment(source, 'unknown-dsl', '// deploy profile', 'comment')
    expectSegment(source, 'unknown-dsl', '"demo"', 'string')
    expectSegment(source, 'unknown-dsl', '3', 'number')
    expectSegment(source, 'unknown-dsl', 'if', 'keyword')
    expectRoundTrip(source, 'unknown-dsl')
    expect(colored(source, 'unknown-dsl').length).toBeGreaterThan(2)
  })

  it('keeps `#` comments and escapes the source text verbatim', () => {
    const source = '<a href="x&y">\'q\'</a> { 42 } # tail'
    expect(colored(source, 'some-unknown-language').length).toBeGreaterThan(0)
    expectRoundTrip(source, 'some-unknown-language')
    expect(highlightCode(source, 'some-unknown-language').map((segment) => segment.text).join('')).toBe(source)
  })

  it('keeps plaintext spellings and missing language names uncolored', () => {
    const source = 'if x = 1 // not a comment for plaintext'
    for (const language of ['text', 'plaintext', 'txt']) {
      expect(highlightCode(source, language)).toEqual([{ text: source, token: 'plain' }])
    }
    // Markdown 层给无信息串围栏传 `text`；undefined/空串同样保持纯文本。
    expect(highlightCode(source, undefined)).toEqual([{ text: source, token: 'plain' }])
    expect(highlightCode(source, '   ')).toEqual([{ text: source, token: 'plain' }])
  })

  it('stays plain when the generic rules only see bare numbers (conservative threshold)', () => {
    // 没有注释/字符串/关键字这类判别性 token 时不做通用着色（低置信度，避免把数据表/
    // ID 列表染成数字色），与既有的 kotlin/mermaid 契约断言保持一致。
    expect(highlightCode('val x = 1', 'kotlin')).toEqual([{ text: 'val x = 1', token: 'plain' }])
    expect(highlightCode('graph TD; A-->B;', 'mermaid')).toEqual([{ text: 'graph TD; A-->B;', token: 'plain' }])
  })
})

describe('code-highlight fallbacks and guards', () => {
  it('returns a single plain segment for plaintext spellings, missing names and all-plain scans', () => {
    // 未知语言名不再无条件纯文本（见 'code-highlight unknown-language fallback'）；
    // 这里锁定仍需保持单一 plain 段的输入：判别性 token 缺失 / 语言名为空 / plaintext。
    expect(highlightCode('val x = 1', 'kotlin')).toEqual([{ text: 'val x = 1', token: 'plain' }])
    expect(highlightCode('foo(bar)', undefined)).toEqual([{ text: 'foo(bar)', token: 'plain' }])
    expect(highlightCode('plain text', 'plaintext')).toEqual([{ text: 'plain text', token: 'plain' }])
    expect(highlightCode('graph TD; A-->B;', 'mermaid')).toEqual([{ text: 'graph TD; A-->B;', token: 'plain' }])
  })

  it('returns no segments for empty input', () => {
    expect(highlightCode('', 'typescript')).toEqual([])
  })

  it('returns a single plain segment above the size guard', () => {
    const oversized = 'const x = 1\n'.repeat(20_000)
    expect(oversized.length).toBeGreaterThan(MAX_HIGHLIGHT_LENGTH)
    expect(highlightCode(oversized, 'ts')).toEqual([{ text: oversized, token: 'plain' }])
  })

  it('still highlights at exactly the size guard boundary', () => {
    const atLimit = '// c\n'.repeat(MAX_HIGHLIGHT_LENGTH / 5)
    expect(atLimit.length).toBe(MAX_HIGHLIGHT_LENGTH)
    const segments = highlightCode(atLimit, 'ts')
    expect(segments.length).toBeGreaterThan(1)
    expect(segments[0]).toEqual({ text: '// c', token: 'comment' })
  })

  it('keeps unterminated strings bounded to the line', () => {
    const streaming = 'const s = "open\nconst next = 1'
    const segments = highlightCode(streaming, 'js')
    expect(segments).toContainEqual({ text: '"open', token: 'string' })
    expect(segments).toContainEqual({ text: 'const', token: 'keyword' })
    expectRoundTrip(streaming, 'js')
  })

  it('caps JSX interpolation recursion on adversarial deep nesting', () => {
    const deep = '<a {<a {<a '.repeat(2_000)
    const started = performance.now()
    const segments = highlightCode(deep, 'jsx')
    const elapsed = performance.now() - started
    // Depth-capped scan: no stack overflow, bounded work, plain fallback output.
    expect(elapsed).toBeLessThan(500)
    expect(segments.length).toBeGreaterThan(0)
    expect(segments.some((segment) => segment.token === 'plain')).toBe(true)
    expectRoundTrip(deep, 'jsx')
  })

  it('degrades over-cap balanced JSX nesting to plain while shallow tags still highlight', () => {
    const overCap = `${'<a {'.repeat(40)}const hidden = 1${'}'.repeat(40)}`
    const segments = highlightCode(overCap, 'jsx')
    // Outer tags stay highlighted; the code past the depth cap is plain.
    expect(segments).toContainEqual({ text: 'a', token: 'tag' })
    expect(segments).not.toContainEqual({ text: 'const', token: 'keyword' })
    expect(segments.some((segment) => segment.token === 'plain')).toBe(true)
    expectRoundTrip(overCap, 'jsx')
  })

  it('preserves every character of an unterminated deep interpolation', () => {
    const unterminated = '<a {<a {'.repeat(100)
    const segments = highlightCode(unterminated, 'jsx')
    expect(segments.some((segment) => segment.token === 'plain')).toBe(true)
    expectRoundTrip(unterminated, 'jsx')
  })
})

describe('code-highlight performance smoke', () => {
  it('tokenizes ~100KB of TypeScript well within the linear-scan budget', () => {
    const unit = [
      'export function handler(req: Request): Response {',
      '  const id = req.headers.get("x-id") ?? 42;',
      '  // process the request',
      '  const tpl = `ok ${id}`;',
      '  return Response.json({ ok: true, id, tpl });',
      '}',
      '',
    ].join('\n')
    const source = unit.repeat(Math.ceil(100_000 / unit.length))
    expect(source.length).toBeGreaterThanOrEqual(100_000)
    const started = performance.now()
    const segments = highlightCode(source, 'ts')
    const elapsed = performance.now() - started
    // Generous bound (observed: a few ms): this is a catastrophic-backtracking
    // regression guard, not a benchmark.
    expect(elapsed).toBeLessThan(500)
    expect(segments.map((segment) => segment.text).join('')).toBe(source)
  })
})
