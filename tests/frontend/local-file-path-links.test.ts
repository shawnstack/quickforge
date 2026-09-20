import { beforeEach, describe, expect, it, vi } from 'vitest'

// t 只影响按钮 aria-label 文案，这里桩掉保持用例纯净。
vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}))

// 图标 URL 来自 svg 资产模块；桩成确定性前缀，避免加载资产、
// 同时验证 createLocalFilePathLink 把完整路径传给 fileIconUrl 并落到 img.src。
vi.mock('@/components/workspace/file-icon-assets', () => ({
  fileIconUrl: (path: string) => `mock-file-icon:${path}`,
}))

import { decorateLocalFilePathLinks } from '../../src/components/chat/panel-decoration/local-file-path-links'
import type { MessageWithUsage } from '../../src/components/chat/chat-utils'

// ---------------------------------------------------------------------------
// 最小 Fake DOM：仅实现 local-file-path-links.ts 用到的接口
// （createTreeWalker / createElement / createDocumentFragment / closest /
//  querySelectorAll / replaceWith），风格对齐 message-actions.test.ts。
// ---------------------------------------------------------------------------

const NODE_ELEMENT = 1
const NODE_TEXT = 3
const NODE_FRAGMENT = 11

class FakeNode {
  constructor(
    public nodeType: number,
    public data = '',
  ) {}
  tagName = ''
  className = ''
  childNodes: FakeNode[] = []
  parentElement: FakeElement | null = null

  get textContent(): string {
    if (this.nodeType === NODE_TEXT) return this.data
    return this.childNodes.map((child) => child.textContent).join('')
  }

  appendChild(node: FakeNode) {
    node.parentElement = this as unknown as FakeElement
    this.childNodes.push(node)
    return node
  }

  append(...nodes: FakeNode[]) {
    for (const node of nodes) this.appendChild(node)
  }

  replaceWith(replacement: FakeNode) {
    const parent = this.parentElement
    if (!parent) return
    const index = parent.childNodes.indexOf(this)
    if (index < 0) return
    const incoming = replacement.nodeType === NODE_FRAGMENT ? [...replacement.childNodes] : [replacement]
    parent.childNodes.splice(index, 1, ...incoming)
    for (const node of incoming) node.parentElement = parent
  }
}

class FakeElement extends FakeNode {
  constructor(tagName: string) {
    super(NODE_ELEMENT)
    this.tagName = tagName.toLowerCase()
  }
  dataset: Record<string, string> = {}
  attributes: Record<string, string> = {}
  title = ''
  type = ''
  // createLocalFilePathLink 生成的 img 元素属性（装饰层直接赋值，Fake DOM 同步记录）。
  src = ''
  alt = ''
  draggable = false
  onclick: ((event: unknown) => void) | null = null

  override get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('')
  }
  set textContent(value: string) {
    this.childNodes = []
    if (value) this.append(new FakeNode(NODE_TEXT, value))
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value
  }

  private get classList(): string[] {
    return this.className ? this.className.split(/\s+/) : []
  }

  private matchesSelector(part: string): boolean {
    const trimmed = part.trim()
    if (trimmed.startsWith('.')) return this.classList.includes(trimmed.slice(1))
    return this.tagName === trimmed
  }

  closest(selector: string): FakeElement | null {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let node: FakeElement | null = this
    while (node) {
      if (selector.split(',').some((part) => node!.matchesSelector(part))) return node
      node = node.parentElement
    }
    return null
  }

  querySelectorAll(selector: string): FakeElement[] {
    const parts = selector.split(',').map((part) => part.trim())
    const found: FakeElement[] = []
    const walk = (node: FakeNode) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== NODE_ELEMENT) continue
        const element = child as FakeElement
        if (parts.some((part) => element.matchesSelector(part))) found.push(element)
        walk(element)
      }
    }
    walk(this)
    return found
  }
}

class FakeFragment extends FakeNode {
  constructor() {
    super(NODE_FRAGMENT)
  }
}

function installFakeDom() {
  const fakeDocument = {
    createElement: (tagName: string) => new FakeElement(tagName),
    createTextNode: (data: string) => new FakeNode(NODE_TEXT, data),
    createDocumentFragment: () => new FakeFragment(),
    createTreeWalker: (
      root: FakeNode,
      _whatToShow: number,
      filter: { acceptNode(node: FakeNode): number },
    ) => {
      const order: FakeNode[] = []
      const walk = (node: FakeNode) => {
        for (const child of node.childNodes) {
          order.push(child)
          walk(child)
        }
      }
      walk(root)
      let cursor = 0
      return {
        nextNode(): FakeNode | null {
          while (cursor < order.length) {
            const node = order[cursor]!
            cursor += 1
            if (node.nodeType !== NODE_TEXT) continue
            if (filter.acceptNode(node) === 1 /* NodeFilter.FILTER_ACCEPT */) return node
          }
          return null
        },
      }
    },
  }
  const fakeNodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 }
  vi.stubGlobal('document', fakeDocument)
  vi.stubGlobal('NodeFilter', fakeNodeFilter)
}

// ---------------------------------------------------------------------------
// 用例辅助
// ---------------------------------------------------------------------------

function buildContainer(blockTexts: string[][]) {
  const container = new FakeElement('div')
  for (const paragraphTexts of blockTexts) {
    const block = new FakeElement('markdown-block')
    for (const text of paragraphTexts) {
      const paragraph = new FakeElement('p')
      paragraph.append(new FakeNode(NODE_TEXT, text))
      block.append(paragraph)
    }
    container.append(block)
  }
  return container
}

function assistantMessage(text: string, timestamp: number): MessageWithUsage {
  return { role: 'assistant', content: [{ type: 'text', text }], timestamp }
}

function linkedPaths(root: FakeElement) {
  return root
    .querySelectorAll('.quickforge-file-path-link')
    .map((button) => button.dataset.quickforgeFilePath)
}

// 按钮内容由「img 图标 + span basename」组成：拆出两个子元素便于逐项断言。
function linkParts(button: FakeElement) {
  const children = button.childNodes.filter((child) => child.nodeType === NODE_ELEMENT) as FakeElement[]
  return {
    img: children.find((child) => child.tagName === 'img'),
    span: children.find((child) => child.tagName === 'span'),
  }
}

const onOpenLocalFilePath = vi.fn()

beforeEach(() => {
  installFakeDom()
  onOpenLocalFilePath.mockClear()
})

describe('decorateLocalFilePathLinks 全局正则状态不跨节点/跨调用污染', () => {
  it('长路径命中后的短文本节点仍然被链接化（lastIndex 残留回归）', () => {
    // 第一个文本节点路径很长：若 test 命中后 lastIndex 未归零，
    // 第二个短节点「也更新了 D:\x.md 好」从残留偏移开始扫描将整段漏判。
    const container = buildContainer([
      ['已写入 D:\\workspace\\quickforge\\docs\\architecture\\patch-release-runbook.zh-CN.md 请审阅', '也更新了 D:\\x.md 好'],
      ['日志在 /home/dev/logs/run.log 以及 /Users/dev/notes.txt'],
    ])
    const message = assistantMessage(
      '已写入 D:\\workspace\\quickforge\\docs\\architecture\\patch-release-runbook.zh-CN.md 请审阅\n\n也更新了 D:\\x.md 好\n\n日志在 /home/dev/logs/run.log 以及 /Users/dev/notes.txt',
      1,
    )

    decorateLocalFilePathLinks(container as unknown as HTMLElement, message, onOpenLocalFilePath)

    expect(linkedPaths(container)).toEqual([
      'D:\\workspace\\quickforge\\docs\\architecture\\patch-release-runbook.zh-CN.md',
      'D:\\x.md',
      '/home/dev/logs/run.log',
      '/Users/dev/notes.txt',
    ])
    const buttons = container.querySelectorAll('.quickforge-file-path-link')
    expect(buttons[0]!.className).toBe('quickforge-file-path-link')
    expect(buttons[0]!.title).toBe('D:\\workspace\\quickforge\\docs\\architecture\\patch-release-runbook.zh-CN.md')
    const { img, span } = linkParts(buttons[0]!)
    expect(img?.src).toBe('mock-file-icon:D:\\workspace\\quickforge\\docs\\architecture\\patch-release-runbook.zh-CN.md')
    expect(img?.alt).toBe('')
    expect(img?.draggable).toBe(false)
    expect(img?.attributes['aria-hidden']).toBe('true')
    expect(span?.textContent).toBe('patch-release-runbook.zh-CN.md')
    expect(buttons[0]!.textContent).toBe('patch-release-runbook.zh-CN.md')
    expect(buttons[0]!.attributes['aria-label']).toBe('openLocalFileWithPath')
  })

  it('多次调用 decorate 依次处理多个容器不漏匹配', () => {
    for (let round = 0; round < 5; round += 1) {
      // 交替「长路径在前 / 短路径在前」，暴露任何顺序下的残留偏移问题。
      const longFirst = round % 2 === 0
      const container = buildContainer([
        [
          longFirst
            ? '报告在 /Users/dev/projects/quickforge/artifacts/reports/regression/full-suite.html 请查收'
            : '小文件 /Users/dev/a.txt 在',
          longFirst ? '另见 /mnt/data/x' : '大文件 /home/dev/projects/quickforge/artifacts/reports/regression/full-suite.html 请查收',
        ],
      ])

      decorateLocalFilePathLinks(
        container as unknown as HTMLElement,
        assistantMessage(
          longFirst
            ? '报告在 /Users/dev/projects/quickforge/artifacts/reports/regression/full-suite.html 请查收\n\n另见 /mnt/data/x'
            : '小文件 /Users/dev/a.txt 在\n\n大文件 /home/dev/projects/quickforge/artifacts/reports/regression/full-suite.html 请查收',
          round,
        ),
        onOpenLocalFilePath,
      )

      expect(linkedPaths(container).sort(), `round ${round}`).toEqual(
        (longFirst
          ? ['/Users/dev/projects/quickforge/artifacts/reports/regression/full-suite.html', '/mnt/data/x']
          : ['/Users/dev/a.txt', '/home/dev/projects/quickforge/artifacts/reports/regression/full-suite.html']
        ).sort(),
      )
    }
  })

  it('同签名重复调用保持幂等，不重复生成链接', () => {
    const container = buildContainer([['文件 D:\\repo\\logs\\today.log 已生成']])
    const message = assistantMessage('文件 D:\\repo\\logs\\today.log 已生成', 42)

    decorateLocalFilePathLinks(container as unknown as HTMLElement, message, onOpenLocalFilePath)
    decorateLocalFilePathLinks(container as unknown as HTMLElement, message, onOpenLocalFilePath)

    expect(linkedPaths(container)).toEqual(['D:\\repo\\logs\\today.log'])
  })

  it('跳过选择器行为保持不变（pre/code 内路径不链接化）', () => {
    const block = new FakeElement('markdown-block')
    const plain = new FakeElement('p')
    plain.append(new FakeNode(NODE_TEXT, '路径 D:\\repo\\docs\\guide.md 已更新'))
    const codeParagraph = new FakeElement('p')
    const code = new FakeElement('code')
    code.append(new FakeNode(NODE_TEXT, 'D:\\repo\\bin\\tool.exe'))
    codeParagraph.append(code)
    block.append(plain, codeParagraph)
    const container = new FakeElement('div')
    container.append(block)

    decorateLocalFilePathLinks(
      container as unknown as HTMLElement,
      assistantMessage('路径 D:\\repo\\docs\\guide.md 已更新', 7),
      onOpenLocalFilePath,
    )

    expect(linkedPaths(container)).toEqual(['D:\\repo\\docs\\guide.md'])
  })
})

describe('decorateLocalFilePathLinks 工作区相对路径', () => {
  it('常见相对路径被链接化（正斜杠/反斜杠/混用/多行）', () => {
    const container = buildContainer([
      ['入口在 src/App.tsx，文档见 docs/wiki/README.md'],
      ['测试文件 tests\\frontend\\chat.test.ts 已更新'],
      ['混用分隔符 docs\\wiki/App.tsx 也识别'],
    ])
    const message = assistantMessage(
      '入口在 src/App.tsx，文档见 docs/wiki/README.md\n\n测试文件 tests\\frontend\\chat.test.ts 已更新\n\n混用分隔符 docs\\wiki/App.tsx 也识别',
      11,
    )

    decorateLocalFilePathLinks(container as unknown as HTMLElement, message, onOpenLocalFilePath)

    expect(linkedPaths(container)).toEqual([
      'src/App.tsx',
      'docs/wiki/README.md',
      'tests\\frontend\\chat.test.ts',
      'docs\\wiki/App.tsx',
    ])
    // 正文只显示 basename（反斜杠分隔符同样归一化），icon src 仍用完整路径解析。
    const [appTsx, , , mixedSlash] = container.querySelectorAll('.quickforge-file-path-link')
    expect(linkParts(appTsx!).span?.textContent).toBe('App.tsx')
    expect(linkParts(appTsx!).img?.src).toBe('mock-file-icon:src/App.tsx')
    expect(linkParts(mixedSlash!).span?.textContent).toBe('App.tsx')
    expect(linkParts(mixedSlash!).img?.src).toBe('mock-file-icon:docs\\wiki/App.tsx')
  })

  it('相对路径不误伤普通斜杠文本', () => {
    const container = buildContainer([
      ['and/or 与 a/b 不是路径'],
      ['日期 2024/05 以及版本 v1.2/beta 不是路径'],
      ['网址 https://example.com/a.ts 不应部分链接化'],
    ])

    decorateLocalFilePathLinks(
      container as unknown as HTMLElement,
      assistantMessage('and/or 与 a/b 不是路径\n\n日期 2024/05 以及版本 v1.2/beta 不是路径\n\n网址 https://example.com/a.ts 不应部分链接化', 12),
      onOpenLocalFilePath,
    )

    expect(linkedPaths(container)).toEqual([])
  })

  it('行内绝对路径整体只匹配一次，不产生内部相对路径重复链接', () => {
    const container = buildContainer([['行内 D:\\quickforge\\src\\App.tsx 结束']])

    decorateLocalFilePathLinks(
      container as unknown as HTMLElement,
      assistantMessage('行内 D:\\quickforge\\src\\App.tsx 结束', 13),
      onOpenLocalFilePath,
    )

    expect(linkedPaths(container)).toEqual(['D:\\quickforge\\src\\App.tsx'])
  })

  it('pre/code（含反引号内联代码渲染产物）内的相对路径仍跳过', () => {
    const block = new FakeElement('markdown-block')
    const plain = new FakeElement('p')
    plain.append(new FakeNode(NODE_TEXT, '正文 docs/wiki/README.md 已更新'))
    const codeParagraph = new FakeElement('p')
    const code = new FakeElement('code')
    code.append(new FakeNode(NODE_TEXT, 'src/App.tsx'))
    codeParagraph.append(code)
    const preParagraph = new FakeElement('p')
    const pre = new FakeElement('pre')
    pre.append(new FakeNode(NODE_TEXT, 'tests\\frontend\\chat.test.ts'))
    preParagraph.append(pre)
    block.append(plain, codeParagraph, preParagraph)
    const container = new FakeElement('div')
    container.append(block)

    decorateLocalFilePathLinks(
      container as unknown as HTMLElement,
      assistantMessage('正文 docs/wiki/README.md 已更新', 14),
      onOpenLocalFilePath,
    )

    expect(linkedPaths(container)).toEqual(['docs/wiki/README.md'])
  })

  it('长相对路径命中后的短相对路径节点仍被链接化（lastIndex 回归）', () => {
    const container = buildContainer([
      ['报告 docs/architecture/patch-release-runbook.zh-CN.md 已写完', '小改 src/A.tsx 好'],
    ])

    decorateLocalFilePathLinks(
      container as unknown as HTMLElement,
      assistantMessage('报告 docs/architecture/patch-release-runbook.zh-CN.md 已写完\n\n小改 src/A.tsx 好', 15),
      onOpenLocalFilePath,
    )

    expect(linkedPaths(container)).toEqual([
      'docs/architecture/patch-release-runbook.zh-CN.md',
      'src/A.tsx',
    ])
  })
})
