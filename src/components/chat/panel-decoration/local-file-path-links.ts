import type { MessageWithUsage } from '../chat-utils'
import { assistantText } from '@/lib/message-utils'

const LOCAL_FILE_PATH_REGEX = /[A-Za-z]:[\\/][^\s"'<>`]+|(?:\/Users|\/home|\/workspace|\/mnt|\/Volumes)\/[^\s"'<>`]+/g
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
  'tool-message',
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

function createLocalFilePathLink(pathValue: string, onOpenLocalFilePath: (path: string) => void) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'quickforge-file-path-link'
  button.dataset.quickforgeFilePath = pathValue
  button.textContent = pathValue
  button.title = 'Open file'
  button.setAttribute('aria-label', `Open file ${pathValue}`)
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
      if (!LOCAL_FILE_PATH_REGEX.test(text)) return NodeFilter.FILTER_REJECT
      LOCAL_FILE_PATH_REGEX.lastIndex = 0
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
  const markdownBlocks = Array.from(element.querySelectorAll<HTMLElement>('markdown-block'))
  const markdownTextLength = markdownBlocks.reduce((total, block) => total + (block.textContent?.length ?? 0), 0)
  const messageTextLength = assistantText(message as Parameters<typeof assistantText>[0]).length
  const signature = `${String(message.timestamp ?? '')}:${messageTextLength}:${markdownBlocks.length}:${markdownTextLength}`
  if (element.dataset.quickforgeLocalPathSignature === signature) return

  markdownBlocks.forEach((block) => {
    collectLocalFilePathTextNodes(block).forEach((node) => linkLocalFilePathTextNode(node, onOpenLocalFilePath))
  })
  element.dataset.quickforgeLocalPathSignature = signature
}
