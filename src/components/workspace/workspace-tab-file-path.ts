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
