// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// t 只影响按钮 aria-label 文案，这里桩掉保持用例纯净。
vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}))

// 图标 URL 来自 svg 资产模块；桩成确定性前缀，避免加载资产、
// 同时验证链接把完整路径传给 fileIconUrl 并落到 img.src。
vi.mock('@/components/workspace/file-icon-assets', () => ({
  fileIconUrl: (path: string) => `mock-file-icon:${path}`,
}))

import { splitLocalFilePaths } from '../../src/components/chat/panel-decoration/local-file-path-links'
import { LocalFilePathText } from '../../src/components/chat/surface/LocalFilePathLink'
import { LocalFilePathHandlerContext } from '../../src/components/chat/surface/surface-context'

/**
 * Local file path links used to be produced by a decoration that walked the
 * rendered DOM (`decorateLocalFilePathLinks`): a TreeWalker found matching text
 * nodes and replaced them with `<button class="quickforge-file-path-link">`
 * elements, guarded by a per-message signature so the walk did not repeat.
 *
 * The detection rules are now pure (`splitLocalFilePaths`) and the surface
 * renders the segments during the Markdown pass, so these cases assert the
 * splitting rules directly plus the rendered button contract. Every rule below
 * was previously pinned through the DOM walker and must keep its behaviour.
 */

/** Paths detected in a text run, in order. */
function linkedPaths(text: string): string[] {
  return splitLocalFilePaths(text)
    .filter((segment): segment is { kind: 'path'; path: string } => segment.kind === 'path')
    .map((segment) => segment.path)
}

/** Text that stays literal (concatenated), for "nothing was swallowed" checks. */
function literalText(text: string): string {
  return splitLocalFilePaths(text)
    .filter((segment): segment is { kind: 'text'; value: string } => segment.kind === 'text')
    .map((segment) => segment.value)
    .join('')
}

const onOpenLocalFilePath = vi.fn()

describe('splitLocalFilePaths 全局正则状态不跨调用污染', () => {
  it('长路径命中后的短文本仍然被链接化（lastIndex 残留回归）', () => {
    // 第一个文本含超长路径：若 test 命中后 lastIndex 未归零，
    // 下一次调用从残留偏移开始扫描会整段漏判。
    expect(linkedPaths('已写入 D:\\workspace\\quickforge\\docs\\architecture\\patch-release-runbook.zh-CN.md 请审阅')).toEqual([
      'D:\\workspace\\quickforge\\docs\\architecture\\patch-release-runbook.zh-CN.md',
    ])
    expect(linkedPaths('也更新了 D:\\x.md 好')).toEqual(['D:\\x.md'])
    expect(linkedPaths('日志在 /home/dev/logs/run.log 以及 /Users/dev/notes.txt')).toEqual([
      '/home/dev/logs/run.log',
      '/Users/dev/notes.txt',
    ])
  })

  it('多次调用依次处理多段文本不漏匹配', () => {
    for (let round = 0; round < 5; round += 1) {
      // 交替「长路径在前 / 短路径在前」，暴露任何顺序下的残留偏移问题。
      const longFirst = round % 2 === 0
      const first = longFirst
        ? '报告在 /Users/dev/projects/quickforge/artifacts/reports/regression/full-suite.html 请查收'
        : '小文件 /Users/dev/a.txt 在'
      const second = longFirst
        ? '另见 /mnt/data/x'
        : '大文件 /home/dev/projects/quickforge/artifacts/reports/regression/full-suite.html 请查收'

      expect(linkedPaths(first).concat(linkedPaths(second)).sort(), `round ${round}`).toEqual(
        (longFirst
          ? ['/Users/dev/projects/quickforge/artifacts/reports/regression/full-suite.html', '/mnt/data/x']
          : ['/Users/dev/a.txt', '/home/dev/projects/quickforge/artifacts/reports/regression/full-suite.html']
        ).sort(),
      )
    }
  })

  it('同一文本重复调用得到相同结果（无状态残留）', () => {
    const text = '文件 D:\\repo\\logs\\today.log 已生成'
    expect(linkedPaths(text)).toEqual(['D:\\repo\\logs\\today.log'])
    expect(linkedPaths(text)).toEqual(['D:\\repo\\logs\\today.log'])
  })
})

describe('splitLocalFilePaths 工作区相对路径', () => {
  it('常见相对路径被链接化（正斜杠/反斜杠/混用）', () => {
    expect(linkedPaths('入口在 src/App.tsx，文档见 docs/wiki/README.md')).toEqual([
      'src/App.tsx',
      'docs/wiki/README.md',
    ])
    expect(linkedPaths('测试文件 tests\\frontend\\chat.test.ts 已更新')).toEqual(['tests\\frontend\\chat.test.ts'])
    expect(linkedPaths('混用分隔符 docs\\wiki/App.tsx 也识别')).toEqual(['docs\\wiki/App.tsx'])
  })

  it('相对路径不误伤普通斜杠文本', () => {
    expect(linkedPaths('and/or 与 a/b 不是路径')).toEqual([])
    expect(linkedPaths('日期 2024/05 以及版本 v1.2/beta 不是路径')).toEqual([])
    expect(linkedPaths('网址 https://example.com/a.ts 不应部分链接化')).toEqual([])
  })

  it('行内绝对路径整体只匹配一次，不产生内部相对路径重复链接', () => {
    expect(linkedPaths('行内 D:\\quickforge\\src\\App.tsx 结束')).toEqual(['D:\\quickforge\\src\\App.tsx'])
  })

  it('长相对路径命中后的短相对路径段仍被链接化（lastIndex 回归）', () => {
    expect(linkedPaths('报告 docs/architecture/patch-release-runbook.zh-CN.md 已写完')).toEqual([
      'docs/architecture/patch-release-runbook.zh-CN.md',
    ])
    expect(linkedPaths('小改 src/A.tsx 好')).toEqual(['src/A.tsx'])
  })
})

describe('splitLocalFilePaths 路径后紧贴正文的截断', () => {
  it('绝对路径后紧贴中文时截断到扩展名，剩余文字回到正文', () => {
    const windows = '已修改 D:\\quickforge\\src\\index.css后面还有文字'
    expect(linkedPaths(windows)).toEqual(['D:\\quickforge\\src\\index.css'])
    expect(literalText(windows)).toContain('后面还有文字')

    const unix = '构建产物 /workspace/src/index.css说明紧跟其后'
    expect(linkedPaths(unix)).toEqual(['/workspace/src/index.css'])
    expect(literalText(unix)).toContain('说明紧跟其后')
  })

  it('截断后剩余正文按「截断点文字 + 剥离的尾部标点」顺序回填', () => {
    const text = '输出 D:\\repo\\out.log。说明：'
    expect(linkedPaths(text)).toEqual(['D:\\repo\\out.log'])
    expect(literalText(text)).toContain('。说明：')
  })

  it('中文标点粘在路径中间（末尾剥标点救不回）同样截断', () => {
    const text = '日志 /home/u/a.css。请查看'
    expect(linkedPaths(text)).toEqual(['/home/u/a.css'])
    expect(literalText(text)).toContain('。请查看')
  })

  it('含 CJK 段的合法路径仍整体链接（扩展名结尾或 CJK 截断回退）', () => {
    expect(linkedPaths('文档 D:\\文档\\说明.md 已更新')).toEqual(['D:\\文档\\说明.md'])

    const glued = '报告 D:\\文档\\说明.md后面还有字'
    expect(linkedPaths(glued)).toEqual(['D:\\文档\\说明.md'])
    expect(literalText(glued)).toContain('后面还有字')
  })

  it('无扩展名路径后紧贴中文时放弃链接，不吞正文', () => {
    const logs = '日志目录 D:\\logs\\debug后面还有字'
    expect(linkedPaths(logs)).toEqual([])
    expect(literalText(logs)).toBe(logs)

    const mount = '挂载点 /mnt/data/x目录说明'
    expect(linkedPaths(mount)).toEqual([])
    expect(literalText(mount)).toBe(mount)
  })

  it('相对路径扩展名后紧贴英文的行为：短词并入扩展名（歧义取舍），长串不匹配', () => {
    // `and` ≤8 位字母，与真实扩展名无法区分，按现状整体并入（tsxand 视作扩展名）。
    expect(linkedPaths('见 src/lib/foo.tsxand more 说明')).toEqual(['src/lib/foo.tsxand'])
    // 超过 8 位时负向前瞻让整体匹配失败，不再截半吞字。
    expect(linkedPaths('再看 src/lib/bar.tsxabcdefghij more 说明')).toEqual([])
  })

  it('相对路径后紧贴中文的既有行为保持（字符类本就不含 CJK）', () => {
    const text = '入口 src/index.css说明文字在后'
    expect(linkedPaths(text)).toEqual(['src/index.css'])
    expect(literalText(text)).toContain('说明文字在后')
  })

  it('同一段内放弃的匹配与成功的匹配共存，放弃段保留原文', () => {
    const text = '先看 D:\\logs\\debug后面说明，再改 D:\\repo\\src\\a.ts即可'
    expect(linkedPaths(text)).toEqual(['D:\\repo\\src\\a.ts'])
    expect(literalText(text)).toContain('D:\\logs\\debug后面说明，再改')
    expect(literalText(text)).toContain('即可')
  })

  it('没有路径的文本原样返回单个文本段', () => {
    expect(splitLocalFilePaths('纯文本，没有路径')).toEqual([{ kind: 'text', value: '纯文本，没有路径' }])
  })
})

describe('LocalFilePathText 渲染', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onOpenLocalFilePath.mockClear()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(text: string, onOpen: ((path: string) => void) | null = onOpenLocalFilePath) {
    act(() => {
      root.render(createElement(
        LocalFilePathHandlerContext.Provider,
        { value: onOpen },
        createElement(LocalFilePathText, { text }),
      ))
    })
  }

  const links = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.quickforge-file-path-link'))

  it('renders one button per detected path with the decoration contract', () => {
    render('已写入 D:\\workspace\\quickforge\\docs\\architecture\\patch-release-runbook.zh-CN.md 请审阅')

    const [button] = links()
    expect(button).toBeTruthy()
    expect(button.className).toBe('quickforge-file-path-link')
    expect(button.dataset.quickforgeFilePath).toBe('D:\\workspace\\quickforge\\docs\\architecture\\patch-release-runbook.zh-CN.md')
    expect(button.title).toBe('D:\\workspace\\quickforge\\docs\\architecture\\patch-release-runbook.zh-CN.md')
    expect(button.getAttribute('aria-label')).toBe('openLocalFileWithPath')

    const img = button.querySelector('img')!
    expect(img.getAttribute('src')).toBe('mock-file-icon:D:\\workspace\\quickforge\\docs\\architecture\\patch-release-runbook.zh-CN.md')
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('draggable')).toBe('false')
    expect(img.getAttribute('aria-hidden')).toBe('true')
    // The label is the basename; the full path lives in title/aria-label.
    expect(button.textContent).toBe('patch-release-runbook.zh-CN.md')
  })

  it('normalizes the basename for backslash separators', () => {
    render('测试文件 tests\\frontend\\chat.test.ts 已更新')

    const [button] = links()
    expect(button.textContent).toBe('chat.test.ts')
    expect(button.querySelector('img')!.getAttribute('src')).toBe('mock-file-icon:tests\\frontend\\chat.test.ts')
  })

  it('dispatches the opener with the full path and stops the click from bubbling', () => {
    // A React parent handler stands in for the message bubble's own click
    // handlers: `stopPropagation` must keep the link press away from them.
    const parentClick = vi.fn()
    act(() => {
      root.render(createElement(
        LocalFilePathHandlerContext.Provider,
        { value: onOpenLocalFilePath },
        createElement('div', { onClick: parentClick }, createElement(LocalFilePathText, { text: '入口在 src/App.tsx' })),
      ))
    })

    const [button] = links()
    act(() => { button.click() })

    expect(onOpenLocalFilePath).toHaveBeenCalledWith('src/App.tsx')
    expect(parentClick).not.toHaveBeenCalled()
  })

  it('renders plain text when the surface has no file opener', () => {
    render('入口在 src/App.tsx 与 D:\\repo\\a.ts', null)

    // No dead buttons in read-only/shared views.
    expect(links()).toHaveLength(0)
    expect(container.textContent).toBe('入口在 src/App.tsx 与 D:\\repo\\a.ts')
  })

  it('keeps the surrounding text in order', () => {
    render('先改 src/a.ts 再看 docs/b.md 完成')

    expect(links().map((button) => button.dataset.quickforgeFilePath)).toEqual(['src/a.ts', 'docs/b.md'])
    expect(container.textContent).toBe('先改 a.ts 再看 b.md 完成')
  })
})
