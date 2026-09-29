import type { MessageWithUsage } from '../chat-utils'
import { assistantText } from '@/lib/message-utils'
import { t } from '@/lib/i18n'
import { artifactFileName } from '@/components/workspace/artifact-preview-utils'
import { fileIconUrl } from '@/components/workspace/file-icon-assets'

// 三条备选分支（绝对路径优先，避免相对分支在绝对路径内部产生子串匹配）：
// 1. Windows 盘符绝对路径：`D:\x\y.md` / `D:/x/y.md`；
// 2. Unix 常见家目录/挂载点前缀的绝对路径；
// 3. 工作区相对路径：≥2 段、`/` 或 `\` 分隔（可混用）：
//    首段 [A-Za-z0-9_-]+（不含点，排除 example.com / v1.2 这类形态），
//    中间段 [A-Za-z0-9_.-]+，末段必须带扩展名（basename 允许多个点，如 chat.test.ts、
//    patch-release-runbook.zh-CN.md），扩展名 1-8 位字母数字，尾部负向前瞻
//    (?![A-Za-z0-9]) 防止紧跟的英文单词并进扩展名（foo.tsxand 整体不匹配，保持原文）。
// 整体前置的行后行断言 (?<![\w./\\:-]) 对三条分支统一生效，排除前面紧跟
// 单词字符/点/分隔符/冒号的起点：防 URL 子串（https://example.com/a.ts 的 s:// 与
// example.com/a.ts 两处）、盘符/Unix 路径内部重复匹配（D:\x\src）与版本号（v1.2/file）误伤。
// 分支 1/2 的尾部字符类故意宽松（只排空白/引号/尖括号/反引号）以保住含 CJK 段的合法路径
// （D:\文档\说明.md），代价是会把路径后紧贴的正文一起吞进匹配——真正的路径终点由
// resolveLocalFilePathCandidate 在解析阶段截断（见其注释）。
const LOCAL_FILE_PATH_REGEX =
  /(?<![\w./\\:-])(?:[A-Za-z]:[\\/][^\s"'<>`]+|(?:\/Users|\/home|\/workspace|\/mnt|\/Volumes)\/[^\s"'<>`]+|[A-Za-z0-9_-]+(?:[\\/][A-Za-z0-9_.-]+)*[\\/][A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8}(?![A-Za-z0-9]))/g
const TRAILING_PATH_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', '>', '。', '，', '；', '：', '！', '？', '）', '】', '》'])
// CJK 标点/假名/表意/扩展/兼容/谚文/全角字符：绝对路径分支的宽松尾部字符类会把这些连同
// 后面的正文一起吞进匹配，解析阶段把它们当作路径终点候选。
const CJK_TEXT_REGEX = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\uff00-\uffef]/
// 有效路径终点：候选以 1-8 位字母数字扩展名结尾（`...\index.css`）。
const PATH_EXTENSION_TAIL_REGEX = /\.[A-Za-z0-9]{1,8}$/
const SKIP_LOCAL_PATH_SELECTOR = [
  'pre',
  'code',
  'a',
  'button',
  'textarea',
  'input',
  'select',
  'thinking-block',
  '.qf-thinking-block',
  'tool-message',
  '.qf-tool-message',
  '.quickforge-file-path-link',
  '.quickforge-message-actions',
  '.quickforge-process-group',
  '.quickforge-approval-card',
].join(',')

function trimTrailingPathPunctuation(value: string) {
  let end = value.length
  while (end > 0 && TRAILING_PATH_PUNCTUATION.has(value[end - 1])) end -= 1
  return { path: value.slice(0, end), suffix: value.slice(end) }
}

// 正则只负责召回，真正要链接的路径终点由这里解析（按序）：
// 1. 剥掉末尾标点（中英文均含）；
// 2. 候选无 CJK 字符 → 直接接受（`D:\repo\dist 后面` 这类无扩展名目录路径不受影响）；
// 3. 候选本身以扩展名结尾 → 接受整串（含 CJK 段的合法路径，如 `D:\文档\说明.md`）；
// 4. 从左到右找 CJK 位置截断，取第一个使剩余部分以扩展名结尾的位置：
//    `D:\repo\index.css后面还有文字` → `D:\repo\index.css`，剩余文字回到正文；
// 5. 找不到有效截断（如 `D:\logs\debug后面`，无扩展名定位不了终点）→ 返回 null 放弃链接，
//    宁可不链接也不把正文吞进路径。
function resolveLocalFilePathCandidate(rawMatch: string): { path: string; suffix: string } | null {
  const { path: trimmed, suffix } = trimTrailingPathPunctuation(rawMatch)
  if (!trimmed) return null
  if (!CJK_TEXT_REGEX.test(trimmed) || PATH_EXTENSION_TAIL_REGEX.test(trimmed)) {
    return { path: trimmed, suffix }
  }

  for (let index = 0; index < trimmed.length; index += 1) {
    if (!CJK_TEXT_REGEX.test(trimmed.charAt(index))) continue
    const candidate = trimmed.slice(0, index)
    if (candidate && PATH_EXTENSION_TAIL_REGEX.test(candidate)) {
      return { path: candidate, suffix: trimmed.slice(index) + suffix }
    }
  }
  return null
}

// 按钮正文只展示「文件图标 + basename」，完整路径收进 title（hover 提示）与
// aria-label（读屏可达），图标与工具卡摘要区（renderToolFileSummary）同源。
function createLocalFilePathLink(pathValue: string, onOpenLocalFilePath: (path: string) => void) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'quickforge-file-path-link'
  button.dataset.quickforgeFilePath = pathValue
  button.title = pathValue
  const icon = document.createElement('img')
  icon.src = fileIconUrl(pathValue)
  icon.alt = ''
  icon.draggable = false
  icon.setAttribute('aria-hidden', 'true')
  const label = document.createElement('span')
  label.textContent = artifactFileName(pathValue)
  button.append(icon, label)
  button.setAttribute('aria-label', t('openLocalFileWithPath', { path: pathValue }))
  button.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    onOpenLocalFilePath(pathValue)
  }
  return button
}

function collectLocalFilePathTextNodes(root: HTMLElement) {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent ?? ''
      // 全局正则带 lastIndex 状态：先归零再 test，避免上一次匹配的残留位置让本节点漏判。
      LOCAL_FILE_PATH_REGEX.lastIndex = 0
      if (!LOCAL_FILE_PATH_REGEX.test(text)) return NodeFilter.FILTER_REJECT
      const parent = node.parentElement
      if (!parent || parent.closest(SKIP_LOCAL_PATH_SELECTOR)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let current = walker.nextNode()
  while (current) {
    nodes.push(current as Text)
    current = walker.nextNode()
  }
  return nodes
}

function linkLocalFilePathTextNode(node: Text, onOpenLocalFilePath: (path: string) => void) {
  const text = node.textContent ?? ''
  LOCAL_FILE_PATH_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  let lastIndex = 0
  const fragment = document.createDocumentFragment()
  let changed = false

  while ((match = LOCAL_FILE_PATH_REGEX.exec(text))) {
    const resolved = resolveLocalFilePathCandidate(match[0])
    if (!resolved) continue
    const { path: pathValue, suffix } = resolved

    const start = match.index
    const end = start + match[0].length
    if (start > lastIndex) fragment.append(document.createTextNode(text.slice(lastIndex, start)))
    fragment.append(createLocalFilePathLink(pathValue, onOpenLocalFilePath))
    if (suffix) fragment.append(document.createTextNode(suffix))
    lastIndex = end
    changed = true
  }

  if (!changed) return
  if (lastIndex < text.length) fragment.append(document.createTextNode(text.slice(lastIndex)))
  node.replaceWith(fragment)
}

export function decorateLocalFilePathLinks(element: HTMLElement, message: MessageWithUsage, onOpenLocalFilePath: (path: string) => void) {
  const markdownBlocks = Array.from(element.querySelectorAll<HTMLElement>('markdown-block, .qf-markdown-block'))
  const markdownTextLength = markdownBlocks.reduce((total, block) => total + (block.textContent?.length ?? 0), 0)
  const messageTextLength = assistantText(message as Parameters<typeof assistantText>[0]).length
  const signature = `${String(message.timestamp ?? '')}:${messageTextLength}:${markdownBlocks.length}:${markdownTextLength}`
  if (element.dataset.quickforgeLocalPathSignature === signature) return

  markdownBlocks.forEach((block) => {
    collectLocalFilePathTextNodes(block).forEach((node) => linkLocalFilePathTextNode(node, onOpenLocalFilePath))
  })
  element.dataset.quickforgeLocalPathSignature = signature
}
