import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { GitStatusResponse } from '@/components/workspace/workspace-types'
import { checkoutGitBranch, getGitStatus } from '@/components/workspace/workspace-api'
import { showAlert } from '@/components/ui/confirm-dialog'
import { isCurrentProjectRequest } from '@/lib/project-request-guard'
import { shouldRefreshTitleGitStatusOnToolEnd } from '@/lib/title-git-status-refresh'
import { subscribeToAgentEvents } from '@/lib/server-agent'
import { t } from '@/lib/i18n'
import { logger } from '@/lib/logger'
import type { useTaskToasts } from './useTaskToasts'

export function useAppGitState() {
  const [titleGitStatus, setTitleGitStatus] = useState<GitStatusResponse | undefined>()
  const titleGitRequestIdRef = useRef(0)
  const titleGitAbortRef = useRef<AbortController | null>(null)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [gitToolsExpanded, setGitToolsExpanded] = useState(false)
  const [gitCommitDialogOpen, setGitCommitDialogOpen] = useState(false)
  const [gitGraphOpen, setGitGraphOpen] = useState(false)
  return { titleGitStatus, setTitleGitStatus, titleGitRequestIdRef, titleGitAbortRef, branchMenuOpen, setBranchMenuOpen, gitToolsExpanded, setGitToolsExpanded, gitCommitDialogOpen, setGitCommitDialogOpen, gitGraphOpen, setGitGraphOpen }
}

type GitState = ReturnType<typeof useAppGitState>
type GitOptions = GitState & {
  projectId: string | undefined
  currentSessionId: string | undefined
  currentSessionIdRef: RefObject<string | undefined>
  currentToolProjectIdRef: RefObject<string | undefined>
  addToast: ReturnType<typeof useTaskToasts>['addToast']
}

// The shared project-scope invalidation effect remains owned by MainApp.
export function useAppGit({ projectId, currentSessionId, currentSessionIdRef, currentToolProjectIdRef, addToast, titleGitRequestIdRef, titleGitAbortRef, setTitleGitStatus, setBranchMenuOpen }: GitOptions) {
  const refreshTitleGitStatus = useCallback(async (force = false) => {
    const requestId = titleGitRequestIdRef.current + 1
    titleGitRequestIdRef.current = requestId
    titleGitAbortRef.current?.abort()
    const controller = new AbortController()
    titleGitAbortRef.current = controller
    if (!projectId) {
      setTitleGitStatus(undefined)
      return undefined
    }
    try {
      // 工具执行结束后的刷新要反映刚发生的仓库变化，必须绕过 1s 结果缓存。
      // 注意：titleGitStatus 同时供 GitToolsPinnedSummary / GitCommitPushDialog 消费，
      // 它们需要 files[].additions/deletions，因此这里必须走 full（不能传 light）。
      const status = await getGitStatus(projectId, controller.signal, { force })
      if (!isCurrentProjectRequest({ projectId, requestId }, currentToolProjectIdRef.current, titleGitRequestIdRef.current)) return undefined
      setTitleGitStatus(status)
      return status
    } catch (error) {
      if (controller.signal.aborted) return undefined
      if (!isCurrentProjectRequest({ projectId, requestId }, currentToolProjectIdRef.current, titleGitRequestIdRef.current)) return undefined
      logger.warn('Failed to refresh title git status:', error)
      setTitleGitStatus(undefined)
      return undefined
    } finally {
      if (titleGitAbortRef.current === controller) titleGitAbortRef.current = null
    }
  }, [projectId, currentToolProjectIdRef, titleGitRequestIdRef, titleGitAbortRef, setTitleGitStatus])

  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshTitleGitStatus() }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshTitleGitStatus])

  useEffect(() => {
    let refreshTimer: number | undefined
    const unsubscribe = subscribeToAgentEvents((event) => {
      if (!shouldRefreshTitleGitStatusOnToolEnd(
        event,
        currentSessionIdRef.current,
        currentToolProjectIdRef.current,
      )) return

      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined
        void refreshTitleGitStatus(true)
      }, 400)
    })

    return () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      unsubscribe()
    }
  }, [currentSessionId, currentSessionIdRef, currentToolProjectIdRef, refreshTitleGitStatus])

  const handleCheckoutTitleBranch = useCallback(async (branch: string) => {
    if (!projectId) return
    const requestId = titleGitRequestIdRef.current + 1
    titleGitRequestIdRef.current = requestId
    try {
      const status = await checkoutGitBranch(projectId, branch)
      if (!isCurrentProjectRequest({ projectId, requestId }, currentToolProjectIdRef.current, titleGitRequestIdRef.current)) return
      setTitleGitStatus(status)
      setBranchMenuOpen(false)
      addToast({
        sessionId: currentSessionId ?? '',
        title: t('gitBranchSwitched'),
        status: 'idle',
        message: branch,
      })
    } catch (error) {
      if (!isCurrentProjectRequest({ projectId, requestId }, currentToolProjectIdRef.current, titleGitRequestIdRef.current)) return
      logger.error('Failed to checkout git branch:', error)
      void showAlert(error instanceof Error ? error.message : t('gitCheckoutFailed'))
      throw error
    }
  }, [addToast, currentSessionId, projectId, currentToolProjectIdRef, titleGitRequestIdRef, setTitleGitStatus, setBranchMenuOpen])

  const handleBranchCreated = useCallback((status: GitStatusResponse) => {
    setTitleGitStatus(status)
    setBranchMenuOpen(false)
    addToast({
      sessionId: currentSessionId ?? '',
      title: t('gitBranchCreated'),
      status: 'idle',
      message: status.branch ?? '',
    })
  }, [addToast, currentSessionId, setTitleGitStatus, setBranchMenuOpen])

  const handleGitOperationCompleted = useCallback((status: GitStatusResponse) => {
    setTitleGitStatus(status)
    addToast({
      sessionId: currentSessionId ?? '',
      title: t('gitOperationCompleted'),
      status: 'idle',
      message: status.branch ?? '',
    })
  }, [addToast, currentSessionId, setTitleGitStatus])
  return { refreshTitleGitStatus, handleCheckoutTitleBranch, handleBranchCreated, handleGitOperationCompleted }
}

export function useAppGitMenu({ branchMenuOpen, setBranchMenuOpen }: Pick<GitState, 'branchMenuOpen' | 'setBranchMenuOpen'>) {
  useEffect(() => {
    if (!branchMenuOpen) return
    const closeMenu = () => setBranchMenuOpen(false)
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
    }
  }, [branchMenuOpen, setBranchMenuOpen])
}
