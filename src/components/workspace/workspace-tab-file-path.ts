import type { WorkspacePanelTab } from './workspace-inspector-tabs'

export function browserTabFilePath(rawUrl: string | undefined) {
  const value = rawUrl?.trim()
  if (!value) return undefined
  if (/^[a-zA-Z]:[\\/]/.test(value) || (value.startsWith('/') && !value.startsWith('/api/'))) return value
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') return undefined
    return decodeURIComponent(url.pathname)
  } catch {
    return undefined
  }
}

export function panelTabFilePath(tab: WorkspacePanelTab) {
  if (tab.kind === 'browser') return browserTabFilePath(tab.url)
  if (tab.kind !== 'reader') return undefined
  const reader = tab.readerTabs?.find((item) => item.id === tab.activeReaderTabId) ?? tab.readerTabs?.[0]
  return reader?.path
}

// 同一 Browser 预览复用时的匹配键：本地文件路径统一为归一化 file key（
// 兼容 Windows 反斜杠/正斜杠混用），其余（workspace 预览 URL、普通 web URL）按去除首尾空白的精确 url key 比较。
export function browserPreviewReuseKey(rawUrl: string | undefined) {
  const filePath = browserTabFilePath(rawUrl)
  if (filePath !== undefined) return `file:${filePath.replace(/\\/g, '/')}`
  const value = rawUrl?.trim()
  if (!value) return undefined
  return `url:${value}`
}

// 仅在同为 browser 的 tab 中按 key 去重，不做 reader/browser 跨类型合并。
export function findBrowserTabToReuse(tabs: WorkspacePanelTab[], url: string | undefined): WorkspacePanelTab | undefined {
  const key = browserPreviewReuseKey(url)
  if (!key) return undefined
  return tabs.find((tab) => tab.kind === 'browser' && browserPreviewReuseKey(tab.url) === key)
}
