import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * 焦点环不变式。
 *
 * 规则：TSX 里任何显式写了 `outline-none` 的元素，必须在同一个元素上给出
 * `focus-visible:` / `focus:` 替代，或者由容器 `focus-within` 承接 —— 后者必须登记在
 * `EXEMPTIONS` 里并写明理由。
 *
 * 为什么是「不变式 + 白名单」而不是逐个组件断言类名：断言具体实现会锁死重构
 * （改一次装配方式就要改测试），而不变式只约束「键盘用户是否还看得见焦点」，
 * 新增控件时忘了补环会立刻红，补齐后白名单自然不需要扩充。
 *
 * 已知边界：只覆盖 TSX 的 className，不覆盖 `src/styles/**` 里独立写的
 * `outline: none`（CSS 侧由 tests/frontend/css-architecture.test.ts 与人工评审兜底）。
 */

type FocusRingExemption = {
  /** 相对仓库根的 posix 路径 */
  file: string
  /** JSX 标签名 */
  tag: string
  /** 该元素 className 里用于精确识别的一段（避免同文件里新增的同名标签被误豁免） */
  classNameIncludes: string
  /** 为什么可以没有自己的焦点环 */
  reason: string
}

const EXEMPTIONS: FocusRingExemption[] = [
  {
    file: 'src/App.tsx',
    tag: 'div',
    classNameIncludes: 'md:hidden',
    reason: '移动端抽屉容器（role="dialog" + tabIndex={-1}），只为消除程序化聚焦轮廓，不是可聚焦控件；焦点落在内部侧栏。',
  },
  {
    file: 'src/components/chat/surface/MessageEditor.tsx',
    tag: 'textarea',
    classNameIncludes: 'resize-none',
    reason: 'Composer 输入框，焦点反馈由 .quickforge-composer:focus-within 的边框/阴影承接（见 src/styles/chat/composer.css）；再加环会与设计里的一整块 composer 描边重复。',
  },
  {
    file: 'src/components/preview/WebPreviewContent.tsx',
    tag: 'input',
    classNameIncludes: 'text-center',
    reason: 'URL 输入框自身去环，焦点环由外层胶囊 <label> 的 focus-within:ring-2 承接。',
  },
  {
    file: 'src/components/sidebar/chat-sidebar/SidebarSearchDialog.tsx',
    tag: 'input',
    classNameIncludes: 'flex-1 bg-transparent',
    reason: '会话搜索输入框自身去环，焦点环由外层容器 div 的 focus-within:ring-2 承接。',
  },
  {
    file: 'src/components/workspace/WorkspaceTreePanel.tsx',
    tag: 'input',
    classNameIncludes: 'flex-1 bg-transparent',
    reason: '工作区过滤输入框自身去环，焦点环由外层 <label> 的 focus-within:ring-2 承接。',
  },
]

type Candidate = {
  file: string
  tag: string
  line: number
  classNameText: string
}

const SRC_ROOT = join(process.cwd(), 'src')

function listTsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listTsxFiles(path)
    return entry.name.endsWith('.tsx') ? [path] : []
  })
}

function classNameAttributeText(sourceFile: ts.SourceFile, element: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string | null {
  for (const attribute of element.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue
    if (attribute.name.getText(sourceFile) !== 'className') continue
    // 取整个属性文本（含 cn(...) 调用），这样条件类名也能被看到。
    return attribute.getText(sourceFile)
  }
  return null
}

function collectCandidates(): Candidate[] {
  const candidates: Candidate[] = []

  for (const path of listTsxFiles(SRC_ROOT)) {
    const source = readFileSync(path, 'utf8')
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const file = relative(process.cwd(), path).split('\\').join('/')

    const visit = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const classNameText = classNameAttributeText(sourceFile, node)
        // 只在「去环且没有任何焦点替代」时才算候选；focus-within 是容器方案，视为已覆盖。
        if (
          classNameText
          && /\boutline-none\b/.test(classNameText)
          && !/focus-visible:|focus:|focus-within:/.test(classNameText)
        ) {
          candidates.push({
            file,
            tag: node.tagName.getText(sourceFile),
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            classNameText,
          })
        }
      }
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  return candidates
}

describe('focus ring invariant', () => {
  it('every element that removes the outline either ships a focus ring or is a documented container-focus exemption', () => {
    const candidates = collectCandidates()
    const unexplained = candidates.filter((candidate) => !EXEMPTIONS.some((exemption) => (
      exemption.file === candidate.file
      && exemption.tag === candidate.tag
      && candidate.classNameText.includes(exemption.classNameIncludes)
    )))

    const report = unexplained
      .map((candidate) => `  ${candidate.file}:${candidate.line} <${candidate.tag}>`)
      .join('\n')

    expect(
      unexplained,
      `以下元素移除了默认焦点环但没有焦点替代：\n${report}\n\n`
      + '修法（二选一）：① 在同一 className 上补 '
      + '`focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring`'
      + '（无边框容器的内联编辑用 `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`）；'
      + '② 焦点由容器承接时，给容器补 `focus-within:border-ring focus-within:ring-2 focus-within:ring-ring`，'
      + '并把该元素登记到本文件的 EXEMPTIONS（写明理由）。',
    ).toEqual([])
  })

  it('keeps the exemption list honest: every entry still matches a current element', () => {
    const candidates = collectCandidates()

    const stale = EXEMPTIONS.filter((exemption) => !candidates.some((candidate) => (
      exemption.file === candidate.file
      && exemption.tag === candidate.tag
      && candidate.classNameText.includes(exemption.classNameIncludes)
    )))

    expect(
      stale.map((exemption) => `${exemption.file} <${exemption.tag}>`),
      '这些豁免条目已经不再命中任何元素（元素被删掉或已自带焦点环），请从 EXEMPTIONS 里移除。',
    ).toEqual([])
  })
})
