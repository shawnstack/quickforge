import { useCallback } from 'react'
import { t } from '@/lib/i18n'
import { logger } from '@/lib/logger'
import { showAlert } from '@/components/ui/confirm-dialog'
import type { ProjectInfo } from '@/lib/types'

/** 「在资源管理器 / VS Code / IDEA 中打开项目」：裸请求 + 带 toast/alert 反馈的两层封装。
 *  远程客户端（remoteClient）不会拿到这些入口。 */
export function useProjectExternalOpen() {
  const openProjectInExplorer = useCallback(async (project: ProjectInfo) => {
    const response = await fetch(`/api/project/${encodeURIComponent(project.id)}/open-in-explorer`, {
      method: 'POST',
    })
    if (response.ok) return
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || t('openInExplorerFailed'))
  }, [])

  const openProjectInVSCode = useCallback(async (project: ProjectInfo) => {
    const response = await fetch(`/api/project/${encodeURIComponent(project.id)}/open-in-vscode`, {
      method: 'POST',
    })
    if (response.ok) return
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || t('openInVSCodeFailed'))
  }, [])

  const openProjectInIDEA = useCallback(async (project: ProjectInfo) => {
    const response = await fetch(`/api/project/${encodeURIComponent(project.id)}/open-in-idea`, {
      method: 'POST',
    })
    if (response.ok) return
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || t('openInIDEAFailed'))
  }, [])

  // --- Desktop handlers (stable; do not auto-close the sidebar) ---
  const openProjectInExplorerWithFeedback = useCallback((project: ProjectInfo) => {
    void openProjectInExplorer(project).catch((error) => {
      logger.error('Failed to open project in explorer:', error)
      void showAlert(error instanceof Error ? error.message : t('openInExplorerFailed'))
    })
  }, [openProjectInExplorer])

  const openProjectInVSCodeWithFeedback = useCallback((project: ProjectInfo) => {
    void openProjectInVSCode(project).catch((error) => {
      logger.error('Failed to open project in VS Code:', error)
      void showAlert(error instanceof Error ? error.message : t('openInVSCodeFailed'))
    })
  }, [openProjectInVSCode])

  const openProjectInIDEAWithFeedback = useCallback((project: ProjectInfo) => {
    void openProjectInIDEA(project).catch((error) => {
      logger.error('Failed to open project in IntelliJ IDEA:', error)
      void showAlert(error instanceof Error ? error.message : t('openInIDEAFailed'))
    })
  }, [openProjectInIDEA])

  return {
    openProjectInExplorer,
    openProjectInVSCode,
    openProjectInIDEA,
    openProjectInExplorerWithFeedback,
    openProjectInVSCodeWithFeedback,
    openProjectInIDEAWithFeedback,
  }
}
