import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { showAlert, showConfirm } from '@/components/ui/confirm-dialog'
import { t } from '@/lib/i18n'
import { getGitStatus, getGitFileDiff, stageGitFile, stageAllGitChanges, unstageGitFile, unstageAllGitChanges, restoreGitFile, restoreAllGitChanges } from './workspace-api'
import { shouldLoadWorkspaceGit, type WorkspaceGitLoadStatus } from './workspace-inspector-on-demand-state'
import type { GitChangedFile, GitFileDiffResponse } from './workspace-types'
import type { WorkspaceInspectorProjectGuard, WorkspacePanelTab } from './workspace-inspector-tabs'

export type ReviewFilter = 'unstaged' | 'staged' | 'all' | 'last'

export type GitChangeAction = 'restore' | 'stage' | 'unstage'

export function isNoWorkingTreeChangesError(err: unknown) {
  return err instanceof Error && err.message === 'File has no working tree changes'
}

export function useInspectorGitState() {
  const [changes, setChanges] = useState<GitChangedFile[]>([])

  const [gitBranch, setGitBranch] = useState<string>()

  const [isGitRepository, setIsGitRepository] = useState(false)

  const [gitLoadStatus, setGitLoadStatus] = useState<WorkspaceGitLoadStatus>('idle')

  const [gitError, setGitError] = useState<string>()

  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('unstaged')

  const [expandedDiffPath, setExpandedDiffPath] = useState<string>()

  const [expandedDiff, setExpandedDiff] = useState<GitFileDiffResponse>()

  const [expandedDiffLoading, setExpandedDiffLoading] = useState(false)

  const [expandedDiffError, setExpandedDiffError] = useState<string>()

  const [expandedDiffNoChanges, setExpandedDiffNoChanges] = useState(false)

  const [pendingGitAction, setPendingGitAction] = useState<{ action: GitChangeAction; path?: string }>()

  const expandedDiffRequestRef = useRef(0)

  const gitControllerRef = useRef<AbortController | null>(null)
  return { changes, setChanges, gitBranch, setGitBranch, isGitRepository, setIsGitRepository, gitLoadStatus, setGitLoadStatus, gitError, setGitError, reviewFilter, setReviewFilter, expandedDiffPath, setExpandedDiffPath, expandedDiff, setExpandedDiff, expandedDiffLoading, setExpandedDiffLoading, expandedDiffError, setExpandedDiffError, expandedDiffNoChanges, setExpandedDiffNoChanges, pendingGitAction, setPendingGitAction, expandedDiffRequestRef, gitControllerRef }
}

type GitState = ReturnType<typeof useInspectorGitState>
type GitOptions = GitState & { projectId?: string; projectGuardRef: RefObject<WorkspaceInspectorProjectGuard>; lastRunPaths: Set<string> }

export function useInspectorGit({ changes, setChanges, setGitBranch, setIsGitRepository, gitLoadStatus, setGitLoadStatus, setGitError, reviewFilter, expandedDiffPath, setExpandedDiffPath, setExpandedDiff, setExpandedDiffLoading, setExpandedDiffError, setExpandedDiffNoChanges, setPendingGitAction, expandedDiffRequestRef, gitControllerRef, projectId, projectGuardRef, lastRunPaths }: GitOptions) {
  const gitStatuses = useMemo(() => {
    const map: Record<string, GitChangedFile> = {}
    for (const file of changes) map[file.path] = file
    return map
  }, [changes])

  const changedPaths = useMemo(() => {
    const paths = new Set<string>()
    for (const file of changes) {
      paths.add(file.path)
      if (file.oldPath) paths.add(file.oldPath)
    }
    return paths
  }, [changes])

  const gitLoading = gitLoadStatus === 'loading'

  const reviewFiles = useMemo(() => {
    if (reviewFilter === 'staged') return changes.filter((file) => file.staged)
    if (reviewFilter === 'all') return changes
    if (reviewFilter === 'last') return changes.filter((file) => lastRunPaths.has(file.path) || (file.oldPath ? lastRunPaths.has(file.oldPath) : false))
    return changes.filter((file) => file.unstaged || file.status === 'untracked' || file.conflict || file.status === 'conflicted')
  }, [changes, lastRunPaths, reviewFilter])

  const selectedReviewFile = expandedDiffPath
    ? reviewFiles.find((file) => file.path === expandedDiffPath)
    : undefined

  function applyGitStatus(statusResponse: { files: GitChangedFile[]; branch?: string; isGitRepository: boolean }) {
    setChanges(statusResponse.files)
    setGitBranch(statusResponse.branch)
    setIsGitRepository(statusResponse.isGitRepository)
    setGitLoadStatus('loaded')
    setGitError(undefined)
  }

  async function runGitAction(action: GitChangeAction, path: string | undefined, operation: () => Promise<{ files: GitChangedFile[]; branch?: string; isGitRepository: boolean }>, fallbackError: string) {
    setPendingGitAction({ action, path })
    try {
      const statusResponse = await operation()
      applyGitStatus(statusResponse)
    } catch (err) {
      await showAlert(err instanceof Error ? err.message : fallbackError)
    } finally {
      setPendingGitAction(undefined)
    }
  }

  async function handleStageFile(file: GitChangedFile) {
    if (!projectId) return
    await runGitAction('stage', file.path, () => stageGitFile(projectId, file.path), t('workspaceStageFailed'))
  }

  async function handleStageAll() {
    if (!projectId) return
    await runGitAction('stage', undefined, () => stageAllGitChanges(projectId), t('workspaceStageFailed'))
  }

  async function handleUnstageFile(file: GitChangedFile) {
    if (!projectId) return
    await runGitAction('unstage', file.path, () => unstageGitFile(projectId, file.path), t('workspaceUnstageFailed'))
  }

  async function handleUnstageAll() {
    if (!projectId) return
    await runGitAction('unstage', undefined, () => unstageAllGitChanges(projectId), t('workspaceUnstageFailed'))
  }

  async function handleRestoreFile(file: GitChangedFile) {
    if (!projectId) return
    const confirmed = await showConfirm({
      title: t('workspaceRestoreConfirmTitle'),
      description: t('workspaceRestoreFileConfirm', { path: file.path }),
      confirmLabel: t('workspaceRestoreFile'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return
    await runGitAction('restore', file.path, () => restoreGitFile(projectId, file.path), t('workspaceRestoreFailed'))
  }

  async function handleRestoreAll() {
    if (!projectId) return
    const confirmed = await showConfirm({
      title: t('workspaceRestoreConfirmTitle'),
      description: t('workspaceRestoreAllConfirm'),
      confirmLabel: t('workspaceRestoreAll'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return
    await runGitAction('restore', undefined, () => restoreAllGitChanges(projectId), t('workspaceRestoreFailed'))
  }

  const loadGitStatus = useCallback(async (force = false) => {
    if (!projectId) return
    if (gitControllerRef.current && !force) return
    gitControllerRef.current?.abort()
    const controller = new AbortController()
    gitControllerRef.current = controller
    const projectToken = projectGuardRef.current.token(projectId)
    setGitLoadStatus('loading')
    setGitError(undefined)
    try {
      const statusResponse = await getGitStatus(projectId, controller.signal, { force })
      if (controller.signal.aborted || !projectGuardRef.current.isCurrent(projectToken)) return
      applyGitStatus(statusResponse)
    } catch (err) {
      if (controller.signal.aborted || !projectGuardRef.current.isCurrent(projectToken)) return
      setGitError(err instanceof Error ? err.message : t('workspaceLoadFailed'))
      setGitLoadStatus('error')
    } finally {
      if (gitControllerRef.current === controller) gitControllerRef.current = null
    }
  // applyGitStatus only closes over stable setters; retain the original project-scoped callback identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, gitControllerRef, projectGuardRef, setGitError, setGitLoadStatus])

  async function toggleReviewDiff(path: string) {
    if (!projectId) return
    const projectToken = projectGuardRef.current.token(projectId)
    if (expandedDiffPath === path) {
      expandedDiffRequestRef.current += 1
      setExpandedDiffPath(undefined)
      setExpandedDiff(undefined)
      setExpandedDiffError(undefined)
      setExpandedDiffLoading(false)
      setExpandedDiffNoChanges(false)
      return
    }

    const requestId = expandedDiffRequestRef.current + 1
    expandedDiffRequestRef.current = requestId
    setExpandedDiffPath(path)
    setExpandedDiff(undefined)
    setExpandedDiffError(undefined)
    setExpandedDiffLoading(true)
    setExpandedDiffNoChanges(false)
    try {
      const diff = await getGitFileDiff(projectId, path)
      if (expandedDiffRequestRef.current !== requestId || !projectGuardRef.current.isCurrent(projectToken)) return
      setExpandedDiff(diff)
      setExpandedDiffNoChanges(false)
    } catch (err) {
      if (expandedDiffRequestRef.current !== requestId || !projectGuardRef.current.isCurrent(projectToken)) return
      if (isNoWorkingTreeChangesError(err)) {
        // 同 openDiffTab：无工作区变更的 404 转为友好空态，不显示红色错误。
        setExpandedDiffError(undefined)
        setExpandedDiffNoChanges(true)
      } else {
        setExpandedDiffError(err instanceof Error ? err.message : t('workspaceOpenDiffFailed'))
        setExpandedDiffNoChanges(false)
      }
    } finally {
      if (expandedDiffRequestRef.current === requestId && projectGuardRef.current.isCurrent(projectToken)) setExpandedDiffLoading(false)
    }
  }
  return { gitStatuses, changedPaths, gitLoading, reviewFiles, selectedReviewFile, applyGitStatus, runGitAction, handleStageFile, handleStageAll, handleUnstageFile, handleUnstageAll, handleRestoreFile, handleRestoreAll, loadGitStatus, toggleReviewDiff }
}

export function useInspectorReviewSelection({ expandedDiffPath, setExpandedDiffPath, setExpandedDiff, setExpandedDiffLoading, setExpandedDiffError, setExpandedDiffNoChanges, reviewFiles }: GitState & { reviewFiles: GitChangedFile[] }) {
  useEffect(() => {
    if (!expandedDiffPath || reviewFiles.some((file) => file.path === expandedDiffPath)) return
    setExpandedDiffPath(undefined)
    setExpandedDiff(undefined)
    setExpandedDiffError(undefined)
    setExpandedDiffLoading(false)
    setExpandedDiffNoChanges(false)
  }, [expandedDiffPath, reviewFiles, setExpandedDiff, setExpandedDiffError, setExpandedDiffLoading, setExpandedDiffNoChanges, setExpandedDiffPath])
}

export function useInspectorGitDemand({ gitLoadStatus, projectId, activePanelTab, loadGitStatus }: GitState & { projectId?: string; activePanelTab?: WorkspacePanelTab; loadGitStatus: (force?: boolean) => Promise<void> }) {
  useEffect(() => {
    if (!projectId || activePanelTab?.kind !== 'review') return
    if (shouldLoadWorkspaceGit(gitLoadStatus)) void loadGitStatus()
  }, [activePanelTab?.kind, gitLoadStatus, loadGitStatus, projectId])
}

