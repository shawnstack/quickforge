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
//    patch-release-runbook.zh-CN.md），扩展名 1-8 位字母数字。
// 整体前置的行后行断言 (?<![\w./\\:-]) 对三条分支统一生效，排除前面紧跟
// 单词字符/点/分隔符/冒号的起点：防 URL 子串（https://example.com/a.ts 的 s:// 与
// example.com/a.ts 两处）、盘符/Unix 路径内部重复匹配（D:\x\src）与版本号（v1.2/file）误伤。
const LOCAL_FILE_PATH_REGEX =
  /(?<![\w./\\:-])(?:[A-Za-z]:[\\/][^\s"'<>`]+|(?:\/Users|\/home|\/workspace|\/mnt|\/Volumes)\/[^\s"'<>`]+|[A-Za-z0-9_-]+(?:[\\/][A-Za-z0-9_.-]+)*[\\/][A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8})/g
const TRAILING_PATH_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', '>', '。', '，', '；', '：', '！', '？', '）', '】', '》'])
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
    const rawMatch = match[0]
    const { path: pathValue, suffix } = trimTrailingPathPunctuation(rawMatch)
    if (!pathValue) continue

    const start = match.index
    const end = start + rawMatch.length
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
