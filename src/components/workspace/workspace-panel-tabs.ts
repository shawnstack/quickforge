import { Activity, Folder, GitBranch, Globe, MessageCircle, SquareTerminal } from 'lucide-react'
import { t } from '@/lib/i18n'
import { workflowStatusLabelKey } from '@/lib/workflow-run-detail'
import { artifactFileName } from './artifact-preview-utils'
import type { WorkspacePanelPrimaryTabKind, WorkspacePanelTab } from './workspace-inspector-tabs'

export type WorkspacePanelTabMeta = {
  kind: WorkspacePanelPrimaryTabKind
  label: string
  description: string
  icon: typeof Folder
}

export const PANEL_TAB_ITEMS: WorkspacePanelTabMeta[] = [
  { kind: 'files', label: t('rightPanelFiles'), description: t('rightPanelFilesDesc'), icon: Folder },
  { kind: 'review', label: t('rightPanelReview'), description: t('rightPanelReviewDesc'), icon: GitBranch },
  { kind: 'terminal', label: t('rightPanelTerminal'), description: t('rightPanelTerminalDesc'), icon: SquareTerminal },
  { kind: 'background-tasks', label: t('backgroundTaskPanelTitle'), description: t('backgroundTaskPanelDesc'), icon: Activity },
  { kind: 'browser', label: t('rightPanelBrowser'), description: t('rightPanelBrowserDesc'), icon: Globe },
  { kind: 'side-chat', label: t('sideChatTitle'), description: t('sideChatDescription'), icon: MessageCircle },
]

export const PANEL_TAB_BY_KIND = Object.fromEntries(PANEL_TAB_ITEMS.map((item) => [item.kind, item])) as Record<WorkspacePanelPrimaryTabKind, WorkspacePanelTabMeta>

export function browserTabLabel(previewUrl: string) {
  const value = previewUrl.trim()
  if (!value) return 'about:blank'
  if (/^[a-zA-Z]:[\\/]/.test(value)) return artifactFileName(value)
  try {
    const url = new URL(value)
    if (url.protocol === 'about:') return value
    if (url.protocol === 'file:') return artifactFileName(decodeURIComponent(url.pathname))
    return url.host || value
  } catch {
    return artifactFileName(value)
  }
}

export function panelTabMeta(tab: WorkspacePanelTab) {
  if (tab.kind === 'reader' || tab.kind === 'document' || tab.kind === 'subagent' || tab.kind === 'workflow' || tab.kind === 'goal') return undefined
  return PANEL_TAB_BY_KIND[tab.kind]
}

export function panelTabLabel(tab: WorkspacePanelTab, projectName: string | undefined) {
  if (tab.kind === 'goal') return t('goalTitle')
  if (tab.kind === 'workflow') {
    const phases = tab.workflowRun?.view.phases.length ?? 0
    return phases > 0 ? t('workflowTabTitle', { count: phases }) : t('workflowTabTitleNoPhases')
  }
  if (tab.kind === 'subagent') {
    const label = tab.subagentRun?.label || t('subagentRunDetails')
    return tab.subagentRun?.task ? `${label} · ${tab.subagentRun.task}` : label
  }
  if (tab.kind === 'terminal') return projectName || t('rightPanelTerminal')
  if (tab.kind === 'browser') return browserTabLabel(tab.url || '')
  if (tab.kind === 'document') return artifactFileName(tab.document?.path || '')
  if (tab.kind === 'reader') {
    const reader = tab.readerTabs?.find((item) => item.id === tab.activeReaderTabId) ?? tab.readerTabs?.[0]
    // 命令日志 tab 用「命令日志 · <命令摘要>」而不是日志文件名：日志名是
    // 时间戳 + toolCallId，对用户没有辨识度。
    if (reader?.source === 'command-log') {
      return reader.label ? t('commandLogTabLabel', { command: reader.label }) : t('commandLogTabFallback')
    }
    return reader ? artifactFileName(reader.path) : t('rightPanelFiles')
  }
  return PANEL_TAB_BY_KIND[tab.kind].label
}

export function panelTabTitle(tab: WorkspacePanelTab, fallbackLabel: string) {
  if (tab.kind === 'workflow') {
    const run = tab.workflowRun?.view
    if (!run) return fallbackLabel
    return `${t(workflowStatusLabelKey(run.status))} · ${run.phases.length}`
  }
  if (tab.kind === 'subagent') return tab.subagentRun?.statusLabel || fallbackLabel
  if (tab.kind === 'browser') return tab.url || fallbackLabel
  if (tab.kind === 'document') return tab.document?.path || fallbackLabel
  if (tab.kind !== 'reader') return fallbackLabel
  const reader = tab.readerTabs?.find((item) => item.id === tab.activeReaderTabId) ?? tab.readerTabs?.[0]
  return reader?.path || fallbackLabel
}
