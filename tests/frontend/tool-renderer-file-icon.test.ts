import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { applyAppLanguageFromSnapshot, t } from '../../src/lib/i18n'
import { fileIconUrls } from '../../src/components/workspace/file-icon-assets'
import { PREVIEW_ARTIFACT_EVENT } from '../../src/lib/tool-renderers/shared'
import { LocalWorkspaceToolRenderer } from '../../src/lib/tool-renderers/local-workspace-tool-renderer'

// 工具卡摘要区文件元素（write_file / edit_file / read_file）：summary 最左侧仍是工具图标
// （renderToolIcon），摘要文本渲染为 FileIcon + basename 的整体元素（可见文本
// 不含目录，hover title 保留完整路径）。结构断言直接遍历 React 元素树（与
// tool-renderer-shared-state.test.ts 同一套 nodes() 遍历模式，无 DOM 依赖）；
// window 派发用 stub 全局捕获。文件元素是 summary 内的纯文本（HTML 规范禁止
// summary 内嵌交互元素），预览入口统一在右侧 quickforge-tool-actions 的眼睛
// 按钮（write/edit/read/present_files 共用 renderPreviewButton）。
type TestNode = ReactElement<Record<string, unknown> & { children?: unknown }>

const LABEL_KEYS = {
  write_file: 'writeFile',
  edit_file: 'editFile',
  read_file: 'readFile',
  grep_files: 'searchFiles',
  present_files: 'presentFiles',
} as const

function nodes(tree: unknown): TestNode[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return []
  const node = tree as TestNode
  return [node, ...nodes(node.props.children)]
}

function classNameOf(node: TestNode) {
  return String(node.props.className ?? '')
}

function renderToolContent(toolName: keyof typeof LABEL_KEYS, params: Record<string, unknown> | undefined) {
  const renderer = new LocalWorkspaceToolRenderer(toolName, LABEL_KEYS[toolName])
  return renderer.render(params, { content: [], isError: false }).content
}

/** summary 行最左侧的第一个元素子节点（工具图标位）。 */
function firstSummaryElementChild(content: unknown): TestNode {
  const summary = nodes(content).find((node) => classNameOf(node).includes('quickforge-tool-summary'))
  expect(summary).toBeDefined()
  const children = Array.isArray(summary!.props.children) ? summary!.props.children : [summary!.props.children]
  const first = children.find((child): child is TestNode => Boolean(child && typeof child === 'object' && 'props' in (child as object)))
  expect(first).toBeDefined()
  return first!
}

/** summary 摘要区节点（quickforge-tool-summary-detail）。 */
function summaryDetailNode(content: unknown): TestNode {
  const detail = nodes(content).find((node) => classNameOf(node).includes('quickforge-tool-summary-detail'))
  expect(detail).toBeDefined()
  return detail!
}

/** 摘要区内的文件元素（FileIcon + basename 整体）。 */
function fileSummaryNode(content: unknown): TestNode {
  const detail = summaryDetailNode(content)
  const children = Array.isArray(detail.props.children) ? detail.props.children : [detail.props.children]
  const element = children.find((child): child is TestNode => Boolean(child && typeof child === 'object' && 'props' in (child as object)))
  expect(element).toBeDefined()
  return element!
}

/** 右侧动作区（quickforge-tool-actions）节点。 */
function actionsNode(content: unknown): TestNode {
  const actions = nodes(content).find((node) => classNameOf(node).includes('quickforge-tool-actions'))
  expect(actions).toBeDefined()
  return actions!
}

/** 收集元素树内的全部可见文本。 */
function textOf(tree: unknown): string {
  if (typeof tree === 'string') return tree
  if (typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(textOf).join('')
  if (tree && typeof tree === 'object' && 'props' in tree) return textOf((tree as TestNode).props.children)
  return ''
}

/** 从静态标记提取 img src（实体转义解码后与 fileIconUrls 全等比较）。 */
function fileIconMarkupSrc(markup: string) {
  const src = markup.match(/<img[^>]* src="([^"]*)"/)?.[1]
  expect(src).toBeDefined()
  return src!.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

beforeEach(() => applyAppLanguageFromSnapshot('en'))

afterEach(() => vi.unstubAllGlobals())

describe('tool summary keeps the tool icon on the left', () => {
  it('keeps renderToolIcon as the leftmost summary element for every tool', () => {
    for (const [toolName, params] of [
      ['write_file', { path: 'src/components/App.tsx', content: 'export {}' }],
      ['edit_file', { path: 'README.md', oldText: 'a', newText: 'b' }],
      ['read_file', { path: 'a.ts', offset: 1 }],
      ['grep_files', { query: 'icon' }],
    ] as const) {
      const content = renderToolContent(toolName, params)
      const icon = firstSummaryElementChild(content)
      expect(icon.type).toBe('svg')
      expect(classNameOf(icon)).toContain('quickforge-tool-type-icon')
    }
  })
})

describe('write_file / edit_file summary file element', () => {
  it('renders the file-type icon with only the basename as visible text', () => {
    const write = renderToolContent('write_file', { path: 'src/components/App.tsx', content: 'export {}' })
    const writeElement = fileSummaryNode(write)
    expect(classNameOf(writeElement)).toContain('quickforge-tool-file-summary')
    expect(writeElement.props.title).toBe('src/components/App.tsx')
    expect(textOf(writeElement)).toBe('App.tsx')
    expect(fileIconMarkupSrc(renderToStaticMarkup(writeElement as ReactElement))).toBe(fileIconUrls['react-ts'])

    const edit = renderToolContent('edit_file', { path: 'README.md', oldText: 'a', newText: 'b' })
    const editElement = fileSummaryNode(edit)
    expect(editElement.props.title).toBe('README.md')
    expect(textOf(editElement)).toBe('README.md')
    expect(fileIconMarkupSrc(renderToStaticMarkup(editElement as ReactElement))).toBe(fileIconUrls.readme)
  })

  it('derives the basename from windows-style path separators', () => {
    const content = renderToolContent('edit_file', { path: 'docs\\guide.md', oldText: 'a', newText: 'b' })
    const element = fileSummaryNode(content)
    expect(textOf(element)).toBe('guide.md')
    expect(textOf(element)).not.toContain('docs')
    expect(element.props.title).toBe('docs\\guide.md')
  })

  it('omits the summary detail entirely when the path is missing or not a string', () => {
    for (const toolName of ['write_file', 'read_file'] as const) {
      for (const params of [undefined, {}, { path: 42 }]) {
        const content = renderToolContent(toolName, params)
        expect(nodes(content).some((node) => classNameOf(node).includes('quickforge-tool-summary-detail'))).toBe(false)
        expect(nodes(content).some((node) => node.type === 'img')).toBe(false)
        expect(classNameOf(firstSummaryElementChild(content))).toContain('quickforge-tool-type-icon')
      }
    }
  })
})

describe('read_file summary file element', () => {
  it('renders the file icon with basename and previews from the actions-area eye button for relative paths', () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    const content = renderToolContent('read_file', { path: 'src/lib/foo.ts', offset: 1 })

    // 摘要文件名是纯文本（HTML 规范禁止 summary 内嵌交互元素）。
    const element = fileSummaryNode(content)
    expect(classNameOf(element)).toContain('quickforge-tool-file-summary')
    expect(element.type).toBe('span')
    expect(element.props.title).toBe('src/lib/foo.ts')
    expect(element.props.onClick).toBeUndefined()
    expect(textOf(element)).toBe('foo.ts')
    expect(textOf(element)).not.toContain('src/lib')
    expect(fileIconMarkupSrc(renderToStaticMarkup(element as ReactElement))).toBe(fileIconUrls.typescript)

    // 预览入口在右侧动作区眼睛按钮：阻断 details 折叠开关后派发预览事件。
    const buttons = nodes(actionsNode(content)).filter((node) => node.type === 'button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].props.title).toBe(t('previewArtifact'))
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    ;(buttons[0].props.onClick as (event: { preventDefault(): void; stopPropagation(): void }) => void)({ preventDefault, stopPropagation })

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(stopPropagation).toHaveBeenCalledTimes(1)
    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    const event = dispatchEvent.mock.calls[0][0] as CustomEvent<{ path: string; kind?: string }>
    expect(event.type).toBe(PREVIEW_ARTIFACT_EVENT)
    expect(event.detail).toEqual({ path: 'src/lib/foo.ts', kind: undefined })
  })

  it('renders a static, non-clickable element for absolute or home-relative paths', () => {
    // 预览链路（openArtifactPreview → 工作区文件 API）只认工作区内路径：工作区外
    // 绝对路径 403、`~` 不展开，且渲染层无法区分工作区内绝对路径，统一静态展示
    // 且不渲染右侧眼睛按钮。
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    for (const [path, basename] of [
      ['C:\\Users\\me\\.claude\\CLAUDE.md', 'CLAUDE.md'],
      ['~/.claude/CLAUDE.md', 'CLAUDE.md'],
      ['/etc/hosts', 'hosts'],
    ] as const) {
      const content = renderToolContent('read_file', { path })
      const element = fileSummaryNode(content)
      expect(element.type).toBe('span')
      expect(classNameOf(element)).toContain('quickforge-tool-file-summary')
      expect(element.props.title).toBe(path)
      expect(element.props.onClick).toBeUndefined()
      expect(textOf(element)).toBe(basename)
      expect(nodes(actionsNode(content)).filter((node) => node.type === 'button')).toHaveLength(0)
    }
    expect(dispatchEvent).not.toHaveBeenCalled()
  })
})

describe('tool summary file element preview click', () => {
  it('dispatches the preview artifact event from the actions-area eye button when the path is previewable', () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    const content = renderToolContent('write_file', { path: 'docs/guide.md', content: '# hi' })

    // 摘要文件名是纯文本（HTML 规范禁止 summary 内嵌交互元素）。
    const element = fileSummaryNode(content)
    expect(element.type).toBe('span')
    expect(element.props.onClick).toBeUndefined()

    // 预览入口在右侧动作区：阻断 summary 的 details 折叠开关（不冒泡、不触发默认行为）。
    const buttons = nodes(actionsNode(content)).filter((node) => node.type === 'button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].props.title).toBe(t('previewArtifact'))
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    ;(buttons[0].props.onClick as (event: { preventDefault(): void; stopPropagation(): void }) => void)({ preventDefault, stopPropagation })

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(stopPropagation).toHaveBeenCalledTimes(1)
    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    const event = dispatchEvent.mock.calls[0][0] as CustomEvent<{ path: string; kind?: string }>
    expect(event.type).toBe(PREVIEW_ARTIFACT_EVENT)
    expect(event.detail).toEqual({ path: 'docs/guide.md', kind: undefined })
  })

  it('renders the basename as plain text without click affordance', () => {
    const content = renderToolContent('write_file', { path: 'docs/guide.md', content: '# hi' })
    const element = fileSummaryNode(content)
    expect(element.type).toBe('span')

    // 不再暗示可点：无 cursor、无 hover 下划线（预览入口移至右侧动作区）。
    expect(classNameOf(element)).not.toContain('cursor-pointer')
    const nameSpan = nodes(element).find((node) => classNameOf(node).includes('quickforge-command-summary'))
    expect(nameSpan).toBeDefined()
    expect(classNameOf(nameSpan!)).not.toContain('hover:underline')
    expect(classNameOf(nameSpan!)).not.toContain('group-hover:underline')

    const fileIcon = nodes(element).find((node) => typeof node.type === 'function')
    expect(fileIcon).toBeDefined()
    expect(classNameOf(fileIcon!)).not.toContain('underline')
  })

  it('keeps the eye preview button in the actions area for present_files', () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    const content = renderToolContent('present_files', { files: [{ path: 'docs/guide.md', kind: 'markdown' }] })

    const buttons = nodes(actionsNode(content)).filter((node) => node.type === 'button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].props.title).toBe(t('previewArtifact'))
    ;(buttons[0].props.onClick as (event: { preventDefault(): void; stopPropagation(): void }) => void)({ preventDefault: vi.fn(), stopPropagation: vi.fn() })

    const event = dispatchEvent.mock.calls[0][0] as CustomEvent<{ path: string; kind?: string }>
    expect(event.type).toBe(PREVIEW_ARTIFACT_EVENT)
    expect(event.detail).toEqual({ path: 'docs/guide.md', kind: 'markdown' })
  })

  it('shares the same dispatch for edit_file html artifacts', () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    const content = renderToolContent('edit_file', { path: 'app/page.html', oldText: 'a', newText: 'b' })

    const element = fileSummaryNode(content)
    expect(element.type).toBe('span')
    expect(element.props.onClick).toBeUndefined()
    const buttons = nodes(actionsNode(content)).filter((node) => node.type === 'button')
    expect(buttons).toHaveLength(1)
    ;(buttons[0].props.onClick as (event: { preventDefault(): void; stopPropagation(): void }) => void)({ preventDefault: vi.fn(), stopPropagation: vi.fn() })

    const event = dispatchEvent.mock.calls[0][0] as CustomEvent<{ path: string; kind?: string }>
    expect(event.type).toBe(PREVIEW_ARTIFACT_EVENT)
    expect(event.detail).toEqual({ path: 'app/page.html', kind: undefined })
  })

  it('renders a static, non-clickable element for non-previewable extensions', () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    const content = renderToolContent('write_file', { path: 'build/artifact.bin', content: 'blob' })

    const element = fileSummaryNode(content)
    expect(element.type).toBe('span')
    expect(classNameOf(element)).toContain('quickforge-tool-file-summary')
    expect(element.props.onClick).toBeUndefined()
    expect(element.props.title).toBe('build/artifact.bin')
    expect(fileIconMarkupSrc(renderToStaticMarkup(element as ReactElement))).toBe(fileIconUrls.document)
    // 不可预览扩展同样不渲染右侧眼睛按钮。
    expect(nodes(actionsNode(content)).filter((node) => node.type === 'button')).toHaveLength(0)
    expect(dispatchEvent).not.toHaveBeenCalled()
  })
})

describe('other tools keep the plain full-path summary', () => {
  it('keeps full path text without file icons for grep_files', () => {
    const grep = renderToolContent('grep_files', { query: 'icon', path: 'src' })
    expect(textOf(summaryDetailNode(grep))).toContain('text: icon in src')
    expect(nodes(grep).some((node) => node.type === 'img')).toBe(false)
  })
})
